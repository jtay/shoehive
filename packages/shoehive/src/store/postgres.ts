/**
 * shoehive/store/postgres: the Postgres Store adapter (ADR 0009), built on `pg`, an
 * optional peer dependency (`npm install pg`). You construct the pool, so you control
 * pooling, TLS and credentials; the store borrows it and never ends it.
 *
 * ```ts
 * import pg from 'pg';
 * import { createServer } from 'shoehive/server';
 * import { postgresStore } from 'shoehive/store/postgres';
 *
 * const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
 * const server = createServer({ games, secret, store: postgresStore({ pool }) });
 * await server.listen({ port: 8080 });
 * // On shutdown: close the server (which closes the store), then end your pool.
 * await server.close();
 * await pool.end();
 * ```
 *
 * The store creates its tables on first use (`CREATE TABLE IF NOT EXISTS`, skipped when
 * they already exist). To create them ahead of time, for example from a deploy step with
 * a role that has DDL rights, call {@link migratePostgres} with the same options.
 *
 * Schema, in `schema` (default `public`), each table name prefixed with `tablePrefix`:
 *
 * - `entries (table_id, seq, data)`: the append-only logs, primary key `(table_id, seq)`.
 * - `snapshots (table_id, seq, rev, game, version, data)`: the latest snapshot per table.
 * - `sessions (player_id, name, metadata, updated_at)`: player sessions.
 * - `open_tables (table_id, open, closed_reason, closed_at)`: whether a table is open.
 *   Closed tables are kept; deleting them is up to you.
 *
 * JSON is stored as `text`, not `jsonb`, so it round-trips exactly (`jsonb` reorders
 * keys and rejects the `\u0000` escape). Postgres `text` cannot hold a NUL character, so
 * table and player ids must not contain one (JSON text never does: it escapes NUL).
 *
 * @packageDocumentation
 */
import type { Pool } from 'pg';
import {
  StoreConflictError,
  type SessionRecord,
  type Store,
  type StoredEntry,
  type StoredSnapshot,
} from './types';

export { StoreConflictError } from './types';
export type { SessionRecord, Store, StoredEntry, StoredSnapshot } from './types';

/** What the store needs from a `pg.Pool`: `query`, and `connect` for transactions. */
export type PostgresPool = Pick<Pool, 'query' | 'connect'>;

/** Where the store's tables live. Use the same values for the store and the migration. */
export interface PostgresSchemaOptions {
  /** The Postgres schema, created if missing. Default `public`. At most 63 bytes. */
  schema?: string;
  /**
   * Prepended to each table name (`entries` becomes `${tablePrefix}entries`). Default none.
   * At most 52 bytes, so that `${tablePrefix}open_tables` fits Postgres's 63-byte limit.
   */
  tablePrefix?: string;
}

/** Options for {@link postgresStore}. */
export interface PostgresStoreOptions extends PostgresSchemaOptions {
  /** Your pool. The store runs its queries on it and never ends it. */
  pool: PostgresPool;
}

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Postgres silently truncates identifiers to 63 bytes (NAMEDATALEN - 1). */
const MAX_IDENTIFIER_BYTES = 63;
const TABLES = ['entries', 'snapshots', 'sessions', 'open_tables'] as const;

/**
 * Rejects a schema or table name Postgres would not keep as given: empty, with a NUL, or
 * longer than 63 bytes, which Postgres truncates without an error, so that two of the
 * store's tables (or two apps' prefixes) could end up as the same table.
 */
function checkIdentifier(what: string, name: string): void {
  const bytes = Buffer.byteLength(name, 'utf8');
  if (name === '' || name.includes('\u0000') || bytes > MAX_IDENTIFIER_BYTES) {
    throw new TypeError(
      `postgresStore: ${what} ${JSON.stringify(name)} must be 1 to ${String(MAX_IDENTIFIER_BYTES)} bytes with no NUL character`,
    );
  }
}

function tableNames({ schema = 'public', tablePrefix = '' }: PostgresSchemaOptions) {
  checkIdentifier('schema', schema);
  for (const name of TABLES) checkIdentifier('table name', tablePrefix + name);
  const table = (name: (typeof TABLES)[number]) => `${ident(schema)}.${ident(tablePrefix + name)}`;
  return {
    schema,
    entries: table('entries'),
    snapshots: table('snapshots'),
    sessions: table('sessions'),
    openTables: table('open_tables'),
  };
}

/**
 * Creates the store's schema and tables if they do not exist. Safe to run repeatedly
 * and concurrently (a transaction-scoped advisory lock serializes runs per schema).
 * {@link postgresStore} does this lazily, so calling it is optional; it is named
 * `migratePostgres` rather than `migrate` so it cannot be confused with a game's
 * `migrate` hook (ADR 0009) or with the other adapters' helpers.
 */
export async function migratePostgres(
  pool: PostgresPool,
  options: PostgresSchemaOptions = {},
): Promise<void> {
  const t = tableNames(options);
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`shoehive:${t.schema}`]);
    // Checked first because CREATE SCHEMA IF NOT EXISTS needs CREATE on the database
    // even when the schema (say `public`) is already there.
    const found = await client.query('SELECT 1 FROM pg_namespace WHERE nspname = $1', [t.schema]);
    if (found.rowCount === 0) await client.query(`CREATE SCHEMA ${ident(t.schema)}`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ${t.entries} (
        table_id text NOT NULL,
        seq bigint NOT NULL,
        data text NOT NULL,
        PRIMARY KEY (table_id, seq)
      );
      CREATE TABLE IF NOT EXISTS ${t.snapshots} (
        table_id text PRIMARY KEY,
        seq bigint NOT NULL,
        rev bigint NOT NULL,
        game text NOT NULL,
        version integer NOT NULL,
        data text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ${t.sessions} (
        player_id text PRIMARY KEY,
        name text NOT NULL,
        metadata text NOT NULL,
        updated_at bigint NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ${t.openTables} (
        table_id text PRIMARY KEY,
        open boolean NOT NULL DEFAULT true,
        closed_reason text,
        closed_at timestamptz
      );
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => (broken = true));
    throw error;
  } finally {
    client.release(broken); // `true` discards a connection that could not roll back
  }
}

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';

/**
 * Creates a Postgres store over your pool. It returns synchronously, so it can go
 * straight into `createServer({ store })`; the tables are created before the first
 * operation runs (see {@link migratePostgres}).
 *
 * `appendLog` is one `INSERT ... SELECT` that writes the whole batch only if its first
 * seq is the stored last seq plus one, so a batch is atomic, gaps are rejected, and of
 * two concurrent writers of the same seq exactly one wins (the other hits the primary
 * key). When nothing was written, a batch whose entries are all stored with identical
 * data succeeds (a retried write, including one that raced an identical write); any
 * other batch rejects with a `StoreConflictError`.
 *
 * `close()` waits for the store's queries in flight, then rejects further calls. It
 * does not end the pool.
 */
export function postgresStore(options: PostgresStoreOptions): Store {
  const { pool } = options;
  const t = tableNames(options);
  const pending = new Set<Promise<unknown>>();
  let ready: Promise<void> | undefined;
  let closed = false;

  const ensureSchema = async () => {
    const names = [t.entries, t.snapshots, t.sessions, t.openTables];
    const found = await pool.query<{ n: number }>(
      'SELECT count(to_regclass(name))::int AS n FROM unnest($1::text[]) AS name',
      [names],
    );
    if (found.rows[0]?.n !== names.length) await migratePostgres(pool, options);
  };

  /** Runs `work` once the schema exists, tracking it so `close()` can wait for it. */
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(new Error('postgresStore: the store is closed'));
    ready ??= ensureSchema().catch((error: unknown) => {
      ready = undefined; // retry on the next call
      throw error;
    });
    const promise = ready.then(work);
    const done = () => pending.delete(promise);
    pending.add(promise);
    void promise.then(done, done);
    return promise;
  };

  const lastSeq = async (tableId: string) => {
    const result = await pool.query<{ seq: string | null }>(
      `SELECT max(seq) AS seq FROM ${t.entries} WHERE table_id = $1`,
      [tableId],
    );
    const seq = result.rows[0]?.seq;
    return seq == null ? -1 : Number(seq);
  };

  /** Whether every entry is already stored with identical data (a retried write). */
  const allStored = async (tableId: string, entries: StoredEntry[]) => {
    const result = await pool.query<{ seq: string; data: string }>(
      `SELECT seq, data FROM ${t.entries} WHERE table_id = $1 AND seq = ANY($2::bigint[])`,
      [tableId, entries.map((e) => e.seq)],
    );
    const stored = new Map(result.rows.map((row) => [Number(row.seq), row.data]));
    return entries.every((e) => stored.get(e.seq) === e.data);
  };

  /** The conflict for `entries`, given the stored last seq (the memory store's order). */
  const conflict = (tableId: string, entries: StoredEntry[], last: number) => {
    for (const entry of entries) {
      if (entry.seq !== last + 1) return new StoreConflictError(tableId, last + 1, entry.seq);
      last = entry.seq;
    }
    return null;
  };

  /** Inserts a contiguous batch if it follows the stored log; false if nothing was written. */
  const insert = async (tableId: string, entries: StoredEntry[]) => {
    try {
      const result = await pool.query(
        `INSERT INTO ${t.entries} (table_id, seq, data)
         SELECT $1, e.seq, e.data FROM unnest($2::bigint[], $3::text[]) AS e (seq, data)
         WHERE (SELECT coalesce(max(seq), -1) FROM ${t.entries} WHERE table_id = $1) = $4`,
        [tableId, entries.map((e) => e.seq), entries.map((e) => e.data), entries[0]!.seq - 1],
      );
      return result.rowCount === entries.length;
    } catch (error) {
      // A concurrent writer committed one of these seqs first (primary key violation).
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  };

  const toEntry = (row: { seq: string; data: string }): StoredEntry => ({
    seq: Number(row.seq),
    data: row.data,
  });

  return {
    appendLog: (tableId, entries) =>
      run(async () => {
        const first = entries[0];
        if (!first) return; // an empty batch is a no-op
        const contiguous = conflict(tableId, entries, first.seq - 1) === null;
        if (contiguous && (await insert(tableId, entries))) return;
        // Nothing was written. Read after the failed insert, so a concurrent writer that
        // won with identical data has committed: that counts as this write succeeding.
        const [retry, last] = await Promise.all([allStored(tableId, entries), lastSeq(tableId)]);
        if (retry) return;
        throw (
          conflict(tableId, entries, last) ?? new StoreConflictError(tableId, last + 1, first.seq)
        );
      }),

    saveSnapshot: (tableId, snapshot) =>
      run(async () => {
        await pool.query(
          `WITH saved AS (
             INSERT INTO ${t.snapshots} (table_id, seq, rev, game, version, data)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (table_id) DO UPDATE SET seq = EXCLUDED.seq, rev = EXCLUDED.rev,
               game = EXCLUDED.game, version = EXCLUDED.version, data = EXCLUDED.data
           )
           INSERT INTO ${t.openTables} (table_id) VALUES ($1) ON CONFLICT (table_id) DO NOTHING`,
          [tableId, snapshot.seq, snapshot.rev, snapshot.game, snapshot.version, snapshot.data],
        );
      }),

    loadTable: (tableId) =>
      run(async () => {
        const found = await pool.query<{
          seq: string;
          rev: string;
          game: string;
          version: number;
          data: string;
        }>(`SELECT seq, rev, game, version, data FROM ${t.snapshots} WHERE table_id = $1`, [
          tableId,
        ]);
        const row = found.rows[0];
        if (!row) return null;
        const snapshot: StoredSnapshot = {
          seq: Number(row.seq),
          rev: Number(row.rev),
          game: row.game,
          version: row.version,
          data: row.data,
        };
        const tail = await pool.query<{ seq: string; data: string }>(
          `SELECT seq, data FROM ${t.entries} WHERE table_id = $1 AND seq > $2 ORDER BY seq`,
          [tableId, snapshot.seq],
        );
        return { snapshot, tail: tail.rows.map(toEntry) };
      }),

    readLog: (tableId, fromSeq, toSeq) =>
      run(async () => {
        const result = await pool.query<{ seq: string; data: string }>(
          `SELECT seq, data FROM ${t.entries}
           WHERE table_id = $1 AND seq >= $2 AND ($3::bigint IS NULL OR seq <= $3)
           ORDER BY seq`,
          [tableId, fromSeq, toSeq !== undefined && Number.isFinite(toSeq) ? toSeq : null],
        );
        return result.rows.map(toEntry);
      }),

    listOpenTables: () =>
      run(async () => {
        const result = await pool.query<{ table_id: string }>(
          `SELECT s.table_id FROM ${t.snapshots} s
           JOIN ${t.openTables} o ON o.table_id = s.table_id WHERE o.open`,
        );
        return result.rows.map((row) => row.table_id);
      }),

    closeTable: (tableId, reason) =>
      run(async () => {
        await pool.query(
          `INSERT INTO ${t.openTables} (table_id, open, closed_reason, closed_at)
           VALUES ($1, false, $2, now())
           ON CONFLICT (table_id) DO UPDATE
           SET open = false, closed_reason = EXCLUDED.closed_reason, closed_at = EXCLUDED.closed_at`,
          [tableId, reason],
        );
      }),

    sessions: {
      get: (playerId) =>
        run(async () => {
          const result = await pool.query<{ name: string; metadata: string; updated_at: string }>(
            `SELECT name, metadata, updated_at FROM ${t.sessions} WHERE player_id = $1`,
            [playerId],
          );
          const row = result.rows[0];
          if (!row) return null;
          const record: SessionRecord = {
            playerId,
            name: row.name,
            metadata: JSON.parse(row.metadata) as SessionRecord['metadata'],
            updatedAt: Number(row.updated_at),
          };
          return record;
        }),
      put: (record) =>
        run(async () => {
          await pool.query(
            `INSERT INTO ${t.sessions} (player_id, name, metadata, updated_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (player_id) DO UPDATE SET name = EXCLUDED.name,
               metadata = EXCLUDED.metadata, updated_at = EXCLUDED.updated_at`,
            [record.playerId, record.name, JSON.stringify(record.metadata), record.updatedAt],
          );
        }),
      delete: (playerId) =>
        run(async () => {
          await pool.query(`DELETE FROM ${t.sessions} WHERE player_id = $1`, [playerId]);
        }),
    },

    async close() {
      closed = true;
      await Promise.allSettled(pending);
    },
  };
}
