import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { migratePostgres, postgresStore, StoreConflictError } from '../../src/store/postgres';
import { runStoreConformance, type StoreBackend } from '../../src/testing/index';
import { describeRecovery, POSTGRES_URL, uniqueName } from './recovery';

// Phase 8 security review (docs/security/review-1.0-platform.md, finding P-10). No server
// needed: the names are checked before any query.
describe('postgresStore names', () => {
  const pool = {} as pg.Pool;
  it('refuses schema and table names Postgres would truncate or cannot hold', () => {
    // 62 bytes: `snapshots` and `sessions` would both become `<prefix>s`.
    expect(() => postgresStore({ pool, tablePrefix: 'x'.repeat(62) })).toThrow(TypeError);
    expect(() => postgresStore({ pool, tablePrefix: 'x'.repeat(53) })).toThrow(TypeError);
    expect(() => postgresStore({ pool, schema: 's'.repeat(64) })).toThrow(TypeError);
    expect(() => postgresStore({ pool, schema: '' })).toThrow(TypeError);
    expect(() => postgresStore({ pool, schema: 'a\u0000b' })).toThrow(TypeError);
    expect(() => postgresStore({ pool, tablePrefix: 'é'.repeat(27) })).toThrow(TypeError);
    expect(() =>
      postgresStore({ pool, tablePrefix: 'x'.repeat(52), schema: 's'.repeat(63) }),
    ).not.toThrow();
    expect(() => postgresStore({ pool, schema: 'odd "quoted" name' })).not.toThrow();
  });
});

if (!POSTGRES_URL) {
  describe.skip('postgres store (set SHOEHIVE_TEST_POSTGRES_URL to run)', () => {
    it('needs a Postgres server', () => undefined);
  });
} else {
  const pool = new pg.Pool({ connectionString: POSTGRES_URL });
  afterAll(() => pool.end());

  const dropSchema = async (schema: string) => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  };
  const schemaExists = async (schema: string) =>
    (await pool.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [schema])).rowCount === 1;
  const tablesIn = async (schema: string) =>
    (
      await pool.query<{ table_name: string }>(
        'SELECT table_name FROM information_schema.tables WHERE table_schema = $1',
        [schema],
      )
    ).rows
      .map((r) => r.table_name)
      .sort();

  /** A fresh schema per test; every `open()` is a new store over it, like a restart. */
  const backend = (): Promise<StoreBackend> => {
    const schema = uniqueName('shoehive');
    return Promise.resolve({
      open: () => postgresStore({ pool, schema }),
      destroy: () => dropSchema(schema),
    });
  };

  runStoreConformance(backend, { describe, it, expect });
  describeRecovery('postgres', backend);

  describe('postgresStore', () => {
    const withSchema = (fn: (schema: string) => Promise<void>) => async () => {
      const schema = uniqueName('shoehive');
      try {
        await fn(schema);
      } finally {
        await dropSchema(schema);
      }
    };

    it(
      'creates its schema lazily, on the first operation',
      withSchema(async (schema) => {
        const store = postgresStore({ pool, schema });
        expect(await schemaExists(schema)).toBe(false);
        expect(await store.listOpenTables()).toEqual([]);
        expect(await tablesIn(schema)).toEqual(['entries', 'open_tables', 'sessions', 'snapshots']);
        await store.close();
      }),
    );

    it(
      'migratePostgres creates the tables ahead of time and is idempotent under concurrency',
      withSchema(async (schema) => {
        const options = { schema, tablePrefix: 'sh_' };
        await Promise.all([1, 2, 3].map(() => migratePostgres(pool, options)));
        await migratePostgres(pool, options);
        expect(await tablesIn(schema)).toEqual([
          'sh_entries',
          'sh_open_tables',
          'sh_sessions',
          'sh_snapshots',
        ]);
        const store = postgresStore({ pool, ...options });
        await store.appendLog('t1', [{ seq: 0, data: '{}' }]);
        expect(await store.readLog('t1', 0)).toEqual([{ seq: 0, data: '{}' }]);
        await store.close();
      }),
    );

    it(
      'close() waits for queries in flight, rejects new calls and leaves the pool usable',
      withSchema(async (schema) => {
        const store = postgresStore({ pool, schema });
        const write = store.appendLog('t1', [{ seq: 0, data: '{}' }]);
        await store.close();
        await write; // finished, not cut off
        let error: unknown;
        await store.readLog('t1', 0).catch((e: unknown) => (error = e));
        expect(error instanceof Error && error.message.includes('closed')).toBe(true);
        expect((await pool.query<{ one: number }>('SELECT 1 AS one')).rows).toEqual([{ one: 1 }]);
        expect(await postgresStore({ pool, schema }).readLog('t1', 0)).toHaveLength(1);
      }),
    );

    it(
      'keeps schemas and table prefixes isolated from each other',
      withSchema(async (schema) => {
        const other = uniqueName('shoehive');
        try {
          const stores = [
            postgresStore({ pool, schema }),
            postgresStore({ pool, schema: other }),
            postgresStore({ pool, schema, tablePrefix: 'b_' }),
          ];
          for (const [i, store] of stores.entries()) {
            await store.appendLog('same', [{ seq: 0, data: `{"store":${String(i)}}` }]);
            await store.saveSnapshot('same', { seq: 0, rev: 0, game: 'g', version: 1, data: '{}' });
            await store.sessions.put({
              playerId: 'p',
              name: `n${String(i)}`,
              metadata: null,
              updatedAt: i,
            });
          }
          await stores[0]!.closeTable('same', 'ended');
          for (const [i, store] of stores.entries()) {
            expect((await store.readLog('same', 0)).map((e) => e.data)).toEqual([
              `{"store":${String(i)}}`,
            ]);
            expect((await store.sessions.get('p'))?.name).toBe(`n${String(i)}`);
            expect(await store.listOpenTables()).toEqual(i === 0 ? [] : ['same']);
            await store.close();
          }
        } finally {
          await dropSchema(other);
        }
      }),
    );

    it(
      'reports the stored position to the loser of a race between two stores',
      withSchema(async (schema) => {
        // Two stores over one schema stand in for two processes writing the same table.
        const a = postgresStore({ pool, schema });
        const b = postgresStore({ pool, schema });
        await a.appendLog('t1', [{ seq: 0, data: '{}' }]);
        for (let round = 1; round <= 20; round++) {
          const results = await Promise.allSettled([
            a.appendLog('t1', [{ seq: round, data: '"a"' }]),
            b.appendLog('t1', [{ seq: round, data: '"b"' }]),
          ]);
          const rejected = results.filter((r) => r.status === 'rejected');
          expect(rejected).toHaveLength(1);
          const reason: unknown = rejected[0]!.reason;
          expect(reason instanceof StoreConflictError).toBe(true);
          expect([
            (reason as StoreConflictError).expected,
            (reason as StoreConflictError).got,
          ]).toEqual([round + 1, round]);
        }
        expect((await a.readLog('t1', 0)).map((e) => e.seq)).toEqual(
          Array.from({ length: 21 }, (_, i) => i),
        );
        await Promise.all([a.close(), b.close()]);
      }),
    );

    it(
      'reports a gap inside a batch at the first entry that breaks the sequence',
      withSchema(async (schema) => {
        const store = postgresStore({ pool, schema });
        await store.appendLog('t1', [{ seq: 0, data: '{}' }]);
        const entries = [1, 2, 4].map((seq) => ({ seq, data: '{}' }));
        const gap = await store.appendLog('t1', entries).catch((e: unknown) => e);
        expect(gap instanceof StoreConflictError).toBe(true);
        expect([(gap as StoreConflictError).expected, (gap as StoreConflictError).got]).toEqual([
          3, 4,
        ]);
        const stale = await store
          .appendLog('t1', [{ seq: 5, data: '{}' }])
          .catch((e: unknown) => e);
        expect([(stale as StoreConflictError).expected, (stale as StoreConflictError).got]).toEqual(
          [1, 5],
        );
        await store.appendLog('t1', []); // an empty batch is a no-op
        expect(await store.readLog('t1', 0)).toHaveLength(1);
        await store.close();
      }),
    );

    it(
      'lets concurrent identical writes all succeed, but not differing ones',
      withSchema(async (schema) => {
        // A retried write can race the original: identical data at the seq is success.
        const a = postgresStore({ pool, schema });
        const b = postgresStore({ pool, schema });
        await a.appendLog('t1', [{ seq: 0, data: '{}' }]);
        for (let round = 1; round <= 20; round++) {
          const batch = [{ seq: round, data: `{"r":${String(round)}}` }];
          await Promise.all([a.appendLog('t1', batch), b.appendLog('t1', batch)]);
        }
        expect(await a.readLog('t1', 0)).toHaveLength(21);
        const changed = await b
          .appendLog('t1', [{ seq: 20, data: '{"r":"other"}' }])
          .catch((e: unknown) => e);
        expect(changed instanceof StoreConflictError).toBe(true);
        expect([
          (changed as StoreConflictError).tableId,
          (changed as StoreConflictError).expected,
          (changed as StoreConflictError).got,
        ]).toEqual(['t1', 21, 20]);
        expect((await a.readLog('t1', 20))[0]?.data).toBe('{"r":20}');
        await Promise.all([a.close(), b.close()]);
      }),
    );

    it(
      'retries schema setup on the next call after it fails',
      withSchema(async (schema) => {
        let failures = 1;
        const flaky = {
          query: pool.query.bind(pool),
          connect: () =>
            failures-- > 0 ? Promise.reject(new Error('connection refused')) : pool.connect(),
        } as unknown as pg.Pool;
        const store = postgresStore({ pool: flaky, schema });
        const first = await store.listOpenTables().catch((e: unknown) => e);
        expect(first instanceof Error && first.message).toBe('connection refused');
        expect(await store.listOpenTables()).toEqual([]);
        await store.close();
      }),
    );
  });
}
