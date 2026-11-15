/**
 * shoehive/store/sqlite: the SQLite Store adapter (ADR 0009), built on `better-sqlite3`
 * (an optional peer dependency: install it next to `shoehive`).
 *
 * ```ts
 * import { createServer } from 'shoehive/server';
 * import { sqliteStore } from 'shoehive/store/sqlite';
 *
 * const server = createServer({ games, store: sqliteStore({ file: './shoehive.db' }) });
 * ```
 *
 * Tables survive a process restart: on startup the server lists the open tables, loads
 * each snapshot and replays the log after it. Several apps can share one file by giving
 * each a different `tablePrefix`.
 *
 * @packageDocumentation
 */
import Database from 'better-sqlite3';
import {
  StoreConflictError,
  type SessionRecord,
  type Store,
  type StoredEntry,
  type StoredSnapshot,
} from './types';

export { StoreConflictError } from './types';
export type { SessionRecord, Store, StoredEntry, StoredSnapshot } from './types';

/** Options shared by both ways of opening a SQLite store. */
export interface SqliteStoreBaseOptions {
  /**
   * Prefix for the SQL table names (`<prefix>entries`, `<prefix>snapshots`,
   * `<prefix>sessions`, `<prefix>open_tables`, `<prefix>meta`), so several apps can
   * share one database. Letters, digits and underscores only. Default `'shoehive_'`.
   */
  tablePrefix?: string;
}

/**
 * The adapter opens `file` itself and closes it in `close()`. A file database is put in
 * WAL mode with `synchronous = FULL`, so every acknowledged action survives a process
 * crash and a power loss (ADR 0009: an ack means durable). `':memory:'` keeps no data.
 */
export interface SqliteStoreFileOptions extends SqliteStoreBaseOptions {
  /** Path of the database file, created if missing. */
  file: string;
}

/**
 * A `better-sqlite3` connection the caller owns: `close()` leaves it open, and its
 * pragmas are left as they are. WAL mode is recommended (`db.pragma('journal_mode = WAL')`);
 * `synchronous = NORMAL` with WAL trades the last transactions on a power loss (not on a
 * process crash) for fewer fsyncs.
 */
export interface SqliteStoreDatabaseOptions extends SqliteStoreBaseOptions {
  /** An open `better-sqlite3` connection (`new Database(file)`). */
  database: Database.Database;
}

/** Options for {@link sqliteStore}: a file to open, or an existing connection. */
export type SqliteStoreOptions = SqliteStoreFileOptions | SqliteStoreDatabaseOptions;

/** The schema version this adapter writes, kept in `<prefix>meta` for later migrations. */
const SCHEMA_VERSION = 1;

/**
 * Creates a SQLite store. The schema is created right away (synchronously) if missing, so
 * opening an existing database again is safe. Every write is one transaction, and `appendLog` takes the
 * write lock before reading the last seq, so concurrent writers (in this process or
 * another one) cannot both append the same seq. Retrying a batch that is already stored
 * with identical data succeeds without writing.
 *
 * @throws `TypeError` for an invalid `tablePrefix`, or an `Error` if the database holds a
 * newer schema than this version of Shoehive understands.
 */
export function sqliteStore(options: SqliteStoreOptions): Store {
  const prefix = options.tablePrefix ?? 'shoehive_';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) {
    throw new TypeError(`sqliteStore: invalid tablePrefix ${JSON.stringify(prefix)}`);
  }
  const owned = !('database' in options);
  const db = 'database' in options ? options.database : new Database(options.file);
  if (owned && !db.memory) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
  }

  const name = (table: string) => `"${prefix}${table}"`;
  const [entries, snapshots, sessions, openTables, meta] = [
    name('entries'),
    name('snapshots'),
    name('sessions'),
    name('open_tables'),
    name('meta'),
  ];
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${meta} (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ${entries} (table_id TEXT NOT NULL, seq INTEGER NOT NULL,
        data TEXT NOT NULL, PRIMARY KEY (table_id, seq));
      CREATE TABLE IF NOT EXISTS ${snapshots} (table_id TEXT PRIMARY KEY, seq INTEGER NOT NULL,
        rev INTEGER NOT NULL, game TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ${sessions} (player_id TEXT PRIMARY KEY, name TEXT NOT NULL,
        metadata TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ${openTables} (table_id TEXT PRIMARY KEY,
        closed_reason TEXT, closed_at INTEGER);
      INSERT INTO ${meta} (key, value) VALUES ('schema_version', '${String(SCHEMA_VERSION)}')
        ON CONFLICT (key) DO NOTHING;`);
  }).immediate();
  const version = db
    .prepare<[], { value: string }>(`SELECT value FROM ${meta} WHERE key = 'schema_version'`)
    .get();
  if (Number(version?.value) > SCHEMA_VERSION) {
    if (owned) db.close();
    const found = String(version?.value);
    throw new Error(`sqliteStore: schema version ${found} is newer than this shoehive supports`);
  }

  const sql = {
    lastSeq: db.prepare<[string], { seq: number | null }>(
      `SELECT max(seq) AS seq FROM ${entries} WHERE table_id = ?`,
    ),
    entryData: db.prepare<[string, number], { data: string }>(
      `SELECT data FROM ${entries} WHERE table_id = ? AND seq = ?`,
    ),
    insertEntry: db.prepare<[string, number, string]>(`INSERT INTO ${entries} VALUES (?, ?, ?)`),
    readLog: db.prepare<[string, number, number], StoredEntry>(
      `SELECT seq, data FROM ${entries} WHERE table_id = ? AND seq >= ? AND seq <= ? ORDER BY seq`,
    ),
    saveSnapshot: db.prepare<[string, number, number, string, number, string]>(
      `INSERT OR REPLACE INTO ${snapshots} VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    markOpen: db.prepare<[string]>(
      `INSERT INTO ${openTables} (table_id) VALUES (?) ON CONFLICT (table_id) DO NOTHING`,
    ),
    loadSnapshot: db.prepare<[string], StoredSnapshot>(
      `SELECT seq, rev, game, version, data FROM ${snapshots} WHERE table_id = ?`,
    ),
    listOpen: db.prepare<[], { table_id: string }>(
      `SELECT table_id FROM ${openTables} WHERE closed_reason IS NULL`, // rows come from snapshots
    ),
    closeTable: db.prepare<[string, string, number]>(
      `INSERT INTO ${openTables} VALUES (?, ?, ?) ON CONFLICT (table_id)
       DO UPDATE SET closed_reason = excluded.closed_reason, closed_at = excluded.closed_at`,
    ),
    getSession: db.prepare<[string], { name: string; metadata: string; updated_at: number }>(
      `SELECT name, metadata, updated_at FROM ${sessions} WHERE player_id = ?`,
    ),
    putSession: db.prepare<[string, string, string, number]>(
      `INSERT OR REPLACE INTO ${sessions} VALUES (?, ?, ?, ?)`,
    ),
    deleteSession: db.prepare<[string]>(`DELETE FROM ${sessions} WHERE player_id = ?`),
  };
  // Plain numbers even if the caller's connection has BigInt integers turned on.
  for (const statement of Object.values(sql)) statement.safeIntegers(false);

  const append = db.transaction((tableId: string, batch: StoredEntry[]) => {
    // An exact repeat of stored entries is a retried write: succeed without writing.
    const stored = (e: StoredEntry) => sql.entryData.get(tableId, e.seq)?.data === e.data;
    if (batch.length > 0 && batch.every(stored)) return;
    let next = (sql.lastSeq.get(tableId)?.seq ?? -1) + 1;
    for (const entry of batch) {
      if (entry.seq !== next) throw new StoreConflictError(tableId, next, entry.seq);
      next += 1;
    }
    for (const entry of batch) sql.insertEntry.run(tableId, entry.seq, entry.data);
  });
  const save = db.transaction((tableId: string, s: StoredSnapshot) => {
    sql.saveSnapshot.run(tableId, s.seq, s.rev, s.game, s.version, s.data);
    sql.markOpen.run(tableId);
  });
  const load = db.transaction((tableId: string) => {
    const snapshot = sql.loadSnapshot.get(tableId);
    if (!snapshot) return null;
    return { snapshot, tail: sql.readLog.all(tableId, snapshot.seq + 1, Number.MAX_SAFE_INTEGER) };
  });

  let closed = false;
  /** Runs synchronous work as a Promise; a throw becomes a rejection. */
  const run = <T>(work: () => T): Promise<T> =>
    new Promise<T>((resolve) => {
      if (closed) throw new Error('sqliteStore: the store is closed');
      resolve(work());
    });

  return {
    appendLog: (tableId, batch) =>
      run(() => {
        append.immediate(tableId, batch);
      }),
    saveSnapshot: (tableId, snapshot) =>
      run(() => {
        save.immediate(tableId, snapshot);
      }),
    loadTable: (tableId) => run(() => load(tableId)),
    readLog: (tableId, fromSeq, toSeq = Number.MAX_SAFE_INTEGER) =>
      run(() => sql.readLog.all(tableId, fromSeq, toSeq)),
    listOpenTables: () => run(() => sql.listOpen.all().map((row) => row.table_id)),
    closeTable: (tableId, reason) =>
      run(() => {
        sql.closeTable.run(tableId, reason, Date.now());
      }),
    sessions: {
      get: (playerId) =>
        run((): SessionRecord | null => {
          const row = sql.getSession.get(playerId);
          if (!row) return null;
          const metadata = JSON.parse(row.metadata) as SessionRecord['metadata'];
          return { playerId, name: row.name, metadata, updatedAt: row.updated_at };
        }),
      put: (record) =>
        run(() => {
          const metadata = JSON.stringify(record.metadata);
          sql.putSession.run(record.playerId, record.name, metadata, record.updatedAt);
        }),
      delete: (playerId) =>
        run(() => {
          sql.deleteSession.run(playerId);
        }),
    },
    close: () => {
      if (!closed && owned) db.close();
      closed = true;
      return Promise.resolve();
    },
  };
}
