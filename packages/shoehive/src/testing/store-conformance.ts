// The store conformance suite (ADR 0009). Adapters run it with their test runner's
// functions, so shoehive/testing has no test-runner dependency:
//
//   import { describe, it, expect } from 'vitest';
//   runStoreConformance(() => myStore(), { describe, it, expect });
//
// For durable adapters, pass a backend instead, so the suite can close a store and open
// a new one over the same storage (what a server restart does):
//
//   runStoreConformance(async () => {
//     const db = await freshDatabase();
//     return { open: () => myStore(db), destroy: () => db.drop() };
//   }, { describe, it, expect });

import { StoreConflictError, type Store, type StoredEntry } from '../store/types';

interface Expectation {
  toBe(value: unknown): void;
  toEqual(value: unknown): void;
  toBeNull(): void;
  toHaveLength(length: number): void;
}

export interface ConformanceRunner {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => Promise<void>) => void;
  expect: (value: unknown) => Expectation;
}

/**
 * Fresh, empty storage for one test. `open` may be called again after the previous
 * store was closed: the new store must see everything the old one wrote.
 */
export interface StoreBackend {
  open(): Store | Promise<Store>;
  /** Removes the test's data (called after the last store is closed). */
  destroy?(): void | Promise<void>;
}

/** A store factory (each call: fresh storage) or a backend factory (fresh storage per call). */
export type StoreConformanceTarget = () => Store | StoreBackend | Promise<Store | StoreBackend>;

const entry = (seq: number, data = `{"seq":${String(seq)}}`): StoredEntry => ({ seq, data });
const snapshot = (seq: number, data = '{}') => ({ seq, rev: seq, game: 'g', version: 1, data });

const isStore = (value: Store | StoreBackend): value is Store =>
  typeof (value as Partial<Store>).appendLog === 'function';

async function conflictOf(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
    return null;
  } catch (error) {
    return error;
  }
}

/** Registers the conformance tests for the store (or backend) returned by `create`. */
export function runStoreConformance(
  create: StoreConformanceTarget,
  { describe, it, expect }: ConformanceRunner,
): void {
  interface Ctx {
    store: Store;
    /** Closes the current store and opens a new one over the same storage. */
    reopen(): Promise<Store>;
  }
  // Tests that reopen storage need a backend; with a plain store factory they pass
  // trivially (an in-memory store has nothing to reopen).
  const withStore =
    (fn: (ctx: Ctx) => Promise<void>, needsReopen = false) =>
    async () => {
      const target = await create();
      const backend: StoreBackend = isStore(target) ? { open: () => target } : target;
      if (needsReopen && isStore(target)) return; // nothing to reopen: in-memory store
      const ctx: Ctx = {
        store: await backend.open(),
        async reopen() {
          await ctx.store.close();
          ctx.store = await backend.open();
          return ctx.store;
        },
      };
      try {
        await fn(ctx);
      } finally {
        await ctx.store.close();
        await backend.destroy?.();
      }
    };

  describe('Store conformance (ADR 0009)', () => {
    it(
      'appends entries in order and reads them back',
      withStore(async ({ store }) => {
        await store.appendLog('t1', [entry(0), entry(1)]);
        await store.appendLog('t1', [entry(2)]);
        expect((await store.readLog('t1', 0)).map((e) => e.seq)).toEqual([0, 1, 2]);
        expect((await store.readLog('t1', 1, 1)).map((e) => e.seq)).toEqual([1]);
        expect((await store.readLog('t1', 1)).map((e) => e.seq)).toEqual([1, 2]);
        expect(await store.readLog('t1', 5)).toEqual([]);
        expect(await store.readLog('unknown', 0)).toEqual([]);
      }),
    );

    it(
      'rejects a seq gap or a repeated seq with StoreConflictError',
      withStore(async ({ store }) => {
        expect(
          (await conflictOf(store.appendLog('t1', [entry(1)]))) instanceof StoreConflictError,
        ).toBe(true); // a log starts at seq 0
        await store.appendLog('t1', [entry(0)]);
        const gap = await conflictOf(store.appendLog('t1', [entry(2)]));
        expect(gap instanceof StoreConflictError).toBe(true);
        expect((gap as StoreConflictError).expected).toBe(1);
        expect((gap as StoreConflictError).got).toBe(2);
        const repeat = await conflictOf(store.appendLog('t1', [entry(0)]));
        expect(repeat instanceof StoreConflictError).toBe(true);
        expect(await store.readLog('t1', 0)).toHaveLength(1);
      }),
    );

    it(
      'appends a batch atomically: a conflict anywhere writes nothing',
      withStore(async ({ store }) => {
        await store.appendLog('t1', [entry(0)]);
        const error = await conflictOf(store.appendLog('t1', [entry(1), entry(2), entry(4)]));
        expect(error instanceof StoreConflictError).toBe(true);
        expect((await store.readLog('t1', 0)).map((e) => e.seq)).toEqual([0]);
        await store.appendLog('t1', [entry(1)]); // and the log is still usable
      }),
    );

    it(
      'lets exactly one of two concurrent writers of the same seq win',
      withStore(async ({ store }) => {
        await store.appendLog('t1', [entry(0)]);
        const results = await Promise.allSettled([
          store.appendLog('t1', [entry(1, '{"writer":"a"}')]),
          store.appendLog('t1', [entry(1, '{"writer":"b"}')]),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find((r) => r.status === 'rejected');
        expect(rejected?.reason instanceof StoreConflictError).toBe(true);
        expect(await store.readLog('t1', 0)).toHaveLength(2);
      }),
    );

    it(
      'replaces the snapshot and loads only the tail after it',
      withStore(async ({ store }) => {
        await store.appendLog('t1', [entry(0), entry(1), entry(2), entry(3)]);
        await store.saveSnapshot('t1', snapshot(0, '{"a":0}'));
        await store.saveSnapshot('t1', snapshot(2, '{"a":2}'));
        const loaded = await store.loadTable('t1');
        expect(loaded?.snapshot).toEqual(snapshot(2, '{"a":2}'));
        expect(loaded?.tail.map((e) => e.seq)).toEqual([3]);
        await store.saveSnapshot('t1', snapshot(3, '{"a":3}'));
        expect((await store.loadTable('t1'))?.tail).toEqual([]);
        expect(await store.loadTable('missing')).toBeNull();
      }),
    );

    it(
      'treats a table with entries but no snapshot as unknown',
      withStore(async ({ store }) => {
        await store.appendLog('t1', [entry(0)]);
        expect(await store.loadTable('t1')).toBeNull();
        expect(await store.listOpenTables()).toEqual([]);
      }),
    );

    it(
      'lists open tables and stops listing closed ones',
      withStore(async ({ store }) => {
        for (const id of ['a', 'b']) {
          await store.appendLog(id, [entry(0)]);
          await store.saveSnapshot(id, snapshot(0));
        }
        expect((await store.listOpenTables()).sort()).toEqual(['a', 'b']);
        await store.closeTable('a', 'ended');
        expect(await store.listOpenTables()).toEqual(['b']);
        expect((await store.loadTable('a'))?.snapshot.seq).toBe(0); // closed tables are kept
        expect(await store.readLog('a', 0)).toHaveLength(1);
      }),
    );

    it(
      'stores, replaces and deletes sessions',
      withStore(async ({ store }) => {
        const record = { playerId: 'p1', name: 'Ada', metadata: { tier: 'gold' }, updatedAt: 1 };
        expect(await store.sessions.get('p1')).toBeNull();
        await store.sessions.put(record);
        expect(await store.sessions.get('p1')).toEqual(record);
        await store.sessions.put({ ...record, name: 'Ada L', metadata: null, updatedAt: 2 });
        expect(await store.sessions.get('p1')).toEqual({
          playerId: 'p1',
          name: 'Ada L',
          metadata: null,
          updatedAt: 2,
        });
        await store.sessions.delete('p1');
        expect(await store.sessions.get('p1')).toBeNull();
        await store.sessions.delete('never-existed');
      }),
    );

    it(
      'handles 1 MiB payloads and keeps tables independent',
      withStore(async ({ store }) => {
        const big = JSON.stringify({ blob: 'x'.repeat(1024 * 1024) });
        await Promise.all([
          store.appendLog('x', [entry(0, big)]),
          store.appendLog('y', [entry(0), entry(1)]),
          store.saveSnapshot('x', snapshot(0, big)),
        ]);
        expect((await store.readLog('x', 0))[0]?.data).toBe(big);
        expect((await store.loadTable('x'))?.snapshot.data).toBe(big);
        expect(await store.readLog('y', 0)).toHaveLength(2);
      }),
    );

    it(
      'round-trips any JSON text and any table or player id exactly',
      withStore(async ({ store }) => {
        // JSON.stringify output: escapes, quotes, unicode (including astral and line
        // separators), and the escaped forms of NUL and other control characters.
        const data = JSON.stringify({
          s: 'quote " backslash \\ nul \u0000 bell \u0007 line sep emoji \u{1F0A1} é',
          n: [0, -1.5, 1e21],
        });
        const ids = ['t:1', 'tbl_ü', "it's", 'a b', 'x'.repeat(128)];
        for (const id of ids) {
          await store.appendLog(id, [entry(0, data)]);
          await store.saveSnapshot(id, snapshot(0, data));
          expect((await store.readLog(id, 0))[0]?.data).toBe(data);
          expect((await store.loadTable(id))?.snapshot.data).toBe(data);
        }
        expect((await store.listOpenTables()).sort()).toEqual([...ids].sort());
        const record = { playerId: 'g:ü 1', name: 'Zoë "Z"', metadata: { s: data }, updatedAt: 3 };
        await store.sessions.put(record);
        expect(await store.sessions.get(record.playerId)).toEqual(record);
      }),
    );

    it(
      'lists many open tables',
      withStore(async ({ store }) => {
        const ids = Array.from({ length: 120 }, (_, i) => `many-${String(i)}`);
        await Promise.all(
          ids.map(async (id) => {
            await store.appendLog(id, [entry(0)]);
            await store.saveSnapshot(id, snapshot(0));
          }),
        );
        expect((await store.listOpenTables()).sort()).toEqual([...ids].sort());
      }),
    );

    it(
      'keeps everything across close and reopen (durable adapters)',
      withStore(async (ctx) => {
        await ctx.store.appendLog('t1', [entry(0), entry(1), entry(2)]);
        await ctx.store.saveSnapshot('t1', snapshot(1, '{"a":1}'));
        await ctx.store.appendLog('t2', [entry(0)]);
        await ctx.store.saveSnapshot('t2', snapshot(0));
        await ctx.store.closeTable('t2', 'ended');
        await ctx.store.sessions.put({ playerId: 'p1', name: 'Ada', metadata: null, updatedAt: 1 });
        const store = await ctx.reopen();
        const loaded = await store.loadTable('t1');
        expect(loaded?.snapshot).toEqual(snapshot(1, '{"a":1}'));
        expect(loaded?.tail.map((e) => e.seq)).toEqual([2]);
        expect(await store.listOpenTables()).toEqual(['t1']);
        expect((await store.sessions.get('p1'))?.name).toBe('Ada');
        // The log continues where it stopped, and still rejects conflicts.
        await store.appendLog('t1', [entry(3)]);
        const repeat = await conflictOf(store.appendLog('t1', [entry(3)]));
        expect(repeat instanceof StoreConflictError).toBe(true);
      }, true),
    );

    it(
      'can be opened twice over existing storage (schema setup is idempotent)',
      withStore(async (ctx) => {
        await ctx.store.appendLog('t1', [entry(0)]);
        const again = await ctx.reopen();
        const third = await ctx.reopen();
        expect(again === third || (await third.readLog('t1', 0)).length === 1).toBe(true);
      }, true),
    );
  });
}
