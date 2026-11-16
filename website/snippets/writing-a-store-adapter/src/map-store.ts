// A small Store adapter over a plain object, as a model for your own
// (/how-to/writing-a-store-adapter/). Real adapters put the same four ideas on a database:
// one log per table, one snapshot per table, a set of open tables, and sessions.
import {
  StoreConflictError,
  type SessionRecord,
  type Store,
  type StoredEntry,
  type StoredSnapshot,
} from 'shoehive/server';

/** The data a store keeps. Share one between open() calls to simulate a disk. */
export interface Shelf {
  logs: Map<string, StoredEntry[]>;
  snapshots: Map<string, StoredSnapshot>;
  closed: Set<string>;
  sessions: Map<string, SessionRecord>;
}

export const newShelf = (): Shelf => ({
  logs: new Map(),
  snapshots: new Map(),
  closed: new Set(),
  sessions: new Map(),
});

// #region store
export function mapStore(shelf: Shelf): Store {
  return {
    // async, so a conflict is a rejected promise rather than a thrown error
    async appendLog(tableId, entries) {
      const log = shelf.logs.get(tableId) ?? [];
      // An exact retry (every entry already stored, same data) succeeds without writing.
      // A batch that is empty also lands here.
      if (entries.every((e) => log[e.seq] !== undefined)) {
        const bad = entries.find((e) => log[e.seq]?.data !== e.data);
        if (bad) throw new StoreConflictError(tableId, log.length, bad.seq);
        return;
      }
      // Otherwise every entry must follow the last stored one, in order, from seq 0.
      let next = log.length;
      for (const entry of entries) {
        if (entry.seq !== next) throw new StoreConflictError(tableId, next, entry.seq);
        next += 1;
      }
      shelf.logs.set(tableId, [...log, ...entries]); // all or nothing
    },
    saveSnapshot(tableId, snapshot) {
      shelf.snapshots.set(tableId, snapshot);
      return Promise.resolve();
    },
    loadTable(tableId) {
      const snapshot = shelf.snapshots.get(tableId);
      if (!snapshot) return Promise.resolve(null);
      const tail = (shelf.logs.get(tableId) ?? []).filter((e) => e.seq > snapshot.seq);
      return Promise.resolve({ snapshot, tail });
    },
    readLog(tableId, fromSeq, toSeq = Infinity) {
      const log = shelf.logs.get(tableId) ?? [];
      return Promise.resolve(log.filter((e) => e.seq >= fromSeq && e.seq <= toSeq));
    },
    listOpenTables() {
      const open = [...shelf.snapshots.keys()].filter((id) => !shelf.closed.has(id));
      return Promise.resolve(open);
    },
    closeTable(tableId) {
      shelf.closed.add(tableId); // saveSnapshot never removes it from this set
      return Promise.resolve();
    },
    sessions: {
      get: (playerId) => Promise.resolve(shelf.sessions.get(playerId) ?? null),
      put(record) {
        shelf.sessions.set(record.playerId, record);
        return Promise.resolve();
      },
      delete(playerId) {
        shelf.sessions.delete(playerId);
        return Promise.resolve();
      },
    },
    close: () => Promise.resolve(), // release your own connections here, not the caller's
  };
}
// #endregion store
