// The Store interface (ADR 0009). Stores are thin and game-agnostic: they keep opaque
// JSON strings and append-only logs, and never parse game state.

import type { Json } from '../core/json';

/** One log entry: `data` is the JSON of a `LogEntry` (ADR 0006). */
export interface StoredEntry {
  seq: number;
  data: string;
}

/** The latest snapshot of a table: `data` is the JSON of a `Snapshot`. */
export interface StoredSnapshot {
  seq: number;
  rev: number;
  game: string;
  version: number;
  data: string;
}

export interface SessionRecord {
  playerId: string;
  name: string;
  metadata: Json;
  updatedAt: number;
}

export interface Store {
  /**
   * Appends entries in seq order, all or nothing. A table's log starts at seq 0 and each
   * entry must follow the last stored one; otherwise rejects with `StoreConflictError`.
   * A batch whose entries are all already stored with identical `data` succeeds without
   * writing (so a driver may safely retry after a lost reply); any other overlap is a
   * conflict. An empty batch is a no-op.
   */
  appendLog(tableId: string, entries: StoredEntry[]): Promise<void>;
  /** Replaces the table's snapshot. */
  saveSnapshot(tableId: string, snapshot: StoredSnapshot): Promise<void>;
  /** The latest snapshot and every entry after it, or `null` for an unknown table. */
  loadTable(tableId: string): Promise<{ snapshot: StoredSnapshot; tail: StoredEntry[] } | null>;
  /** Entries with `fromSeq <= seq <= toSeq` (devtools replay). */
  readLog(tableId: string, fromSeq: number, toSeq?: number): Promise<StoredEntry[]>;
  /** Tables to recover on startup. */
  listOpenTables(): Promise<string[]>;
  /**
   * Marks a table closed: it is kept but no longer recovered. A snapshot saved after this
   * (the engine snapshots a table as it ends) does not reopen it.
   */
  closeTable(tableId: string, reason: string): Promise<void>;
  sessions: {
    get(playerId: string): Promise<SessionRecord | null>;
    put(record: SessionRecord): Promise<void>;
    delete(playerId: string): Promise<void>;
  };
  close(): Promise<void>;
}

/** Thrown by `appendLog` when the entry seq does not follow the stored log. */
export class StoreConflictError extends Error {
  override readonly name = 'StoreConflictError';
  constructor(
    readonly tableId: string,
    readonly expected: number,
    readonly got: number,
  ) {
    super(
      `Store conflict on table ${tableId}: expected seq ${String(expected)}, got ${String(got)}`,
    );
  }
}
