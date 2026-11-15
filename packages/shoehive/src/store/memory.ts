/**
 * shoehive/store/memory: the default in-memory Store adapter (ADR 0009). Data is lost
 * when the process exits; it survives a server `close()` and a new `createServer()`
 * with the same store object, which is how restart recovery is tested in-process.
 *
 * @packageDocumentation
 */
import {
  StoreConflictError,
  type SessionRecord,
  type Store,
  type StoredEntry,
  type StoredSnapshot,
} from './types';

export { StoreConflictError } from './types';
export type { SessionRecord, Store, StoredEntry, StoredSnapshot } from './types';

interface TableData {
  entries: StoredEntry[];
  snapshot: StoredSnapshot | null;
  open: boolean;
  closedReason: string | null;
}

/** Creates an in-memory store. */
export function memoryStore(): Store {
  const tables = new Map<string, TableData>();
  const sessions = new Map<string, SessionRecord>();
  const table = (id: string): TableData => {
    let data = tables.get(id);
    if (!data) {
      data = { entries: [], snapshot: null, open: true, closedReason: null };
      tables.set(id, data);
    }
    return data;
  };

  return {
    appendLog(tableId, entries) {
      const data = table(tableId);
      let last = data.entries.at(-1)?.seq ?? -1;
      for (const entry of entries) {
        if (entry.seq !== last + 1)
          return Promise.reject(new StoreConflictError(tableId, last + 1, entry.seq));
        last = entry.seq;
      }
      data.entries.push(...entries.map((e) => ({ seq: e.seq, data: e.data })));
      return Promise.resolve();
    },
    saveSnapshot(tableId, snapshot) {
      table(tableId).snapshot = { ...snapshot };
      return Promise.resolve();
    },
    loadTable(tableId) {
      const data = tables.get(tableId);
      if (!data?.snapshot) return Promise.resolve(null);
      const seq = data.snapshot.seq;
      return Promise.resolve({
        snapshot: { ...data.snapshot },
        tail: data.entries.filter((e) => e.seq > seq),
      });
    },
    readLog(tableId, fromSeq, toSeq = Number.POSITIVE_INFINITY) {
      const data = tables.get(tableId);
      return Promise.resolve(
        (data?.entries ?? []).filter((e) => e.seq >= fromSeq && e.seq <= toSeq),
      );
    },
    listOpenTables() {
      return Promise.resolve([...tables].filter(([, d]) => d.open && d.snapshot).map(([id]) => id));
    },
    closeTable(tableId, reason) {
      const data = table(tableId);
      data.open = false;
      data.closedReason = reason;
      return Promise.resolve();
    },
    sessions: {
      get: (playerId) => Promise.resolve(sessions.get(playerId) ?? null),
      put: (record) => {
        sessions.set(record.playerId, { ...record });
        return Promise.resolve();
      },
      delete: (playerId) => {
        sessions.delete(playerId);
        return Promise.resolve();
      },
    },
    close: () => Promise.resolve(),
  };
}
