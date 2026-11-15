import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { sqliteStore } from '../../src/store/sqlite';
import { StoreConflictError, type Store } from '../../src/store/types';
import { runStoreConformance, type StoreBackend } from '../../src/testing/index';
import { describeRecovery, uniqueName } from './recovery';

/** A fresh directory under the OS temp dir, holding one database file. */
function tempFile(): { file: string; remove: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${uniqueName('shoehive-sqlite')}-`));
  return {
    file: path.join(dir, 'shoehive.db'),
    remove: () => {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Each open() is a new store (a new connection) over the same file, like a restart. */
function fileBackend(): Promise<StoreBackend> {
  const { file, remove } = tempFile();
  return Promise.resolve({ open: () => sqliteStore({ file }), destroy: remove });
}

describe('sqliteStore({ file })', () => {
  runStoreConformance(fileBackend, { describe, it, expect });
});

describe('sqliteStore({ database })', () => {
  // One caller-owned connection per test; every open() wraps it in a new store. Reopening
  // only works if the previous store's close() left the connection open.
  runStoreConformance(
    () => {
      const { file, remove } = tempFile();
      const database = new Database(file);
      return {
        open: () => sqliteStore({ database }),
        destroy: () => {
          expect(database.open).toBe(true);
          database.close();
          remove();
        },
      };
    },
    { describe, it, expect },
  );
});

describeRecovery('sqlite', fileBackend);

describe('sqlite adapter specifics', () => {
  const cleanup: (() => void | Promise<void>)[] = [];
  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
  });
  const file = () => {
    const temp = tempFile();
    cleanup.push(temp.remove);
    return temp.file;
  };
  const track = (store: Store) => {
    cleanup.push(() => store.close());
    return store;
  };
  const connect = (path: string, options?: Database.Options) => {
    const database = new Database(path, options);
    cleanup.push(() => {
      database.close();
    });
    return database;
  };
  const tableNames = (database: Database.Database) =>
    database
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name)
      .sort();

  it('opens a file in WAL mode and creates the ADR 0009 tables', async () => {
    const path = file();
    const store = track(sqliteStore({ file: path }));
    await store.appendLog('t1', [{ seq: 0, data: '{}' }]);
    const probe = connect(path);
    expect(probe.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(tableNames(probe)).toEqual([
      'shoehive_entries',
      'shoehive_meta',
      'shoehive_open_tables',
      'shoehive_sessions',
      'shoehive_snapshots',
    ]);
    expect(
      probe.prepare("SELECT value FROM shoehive_meta WHERE key = 'schema_version'").pluck().get(),
    ).toBe('1');
  });

  it('works with :memory:', async () => {
    const store = track(sqliteStore({ file: ':memory:' }));
    await store.appendLog('t1', [{ seq: 0, data: '{}' }]);
    await store.saveSnapshot('t1', { seq: 0, rev: 0, game: 'g', version: 1, data: '{}' });
    expect(await store.listOpenTables()).toEqual(['t1']);
  });

  it('leaves an injected connection open on close(), and its journal mode alone', async () => {
    const database = connect(file());
    const store = sqliteStore({ database });
    expect(database.pragma('journal_mode', { simple: true })).toBe('delete');
    await store.appendLog('t1', [{ seq: 0, data: '{}' }]);
    await store.close();
    await store.close(); // idempotent
    expect(database.open).toBe(true);
    expect(database.prepare('SELECT count(*) FROM shoehive_entries').pluck().get()).toBe(1);
    await expect(store.readLog('t1', 0)).rejects.toThrow(/closed/);
  });

  it('closes the file it opened', async () => {
    const store = sqliteStore({ file: file() });
    await store.close();
    await expect(store.listOpenTables()).rejects.toThrow(/closed/);
  });

  it('keeps stores with different prefixes on one file apart', async () => {
    const path = file();
    const a = track(sqliteStore({ file: path, tablePrefix: 'app_a_' }));
    const b = track(sqliteStore({ file: path, tablePrefix: 'app_b_' }));
    await a.appendLog('t1', [{ seq: 0, data: '"a"' }]);
    await a.saveSnapshot('t1', { seq: 0, rev: 0, game: 'g', version: 1, data: '"a"' });
    await a.sessions.put({ playerId: 'p1', name: 'Ada', metadata: null, updatedAt: 1 });
    expect(await b.listOpenTables()).toEqual([]);
    expect(await b.loadTable('t1')).toBeNull();
    expect(await b.sessions.get('p1')).toBeNull();
    await b.appendLog('t1', [{ seq: 0, data: '"b"' }]); // seq 0 again: a separate log
    expect((await a.readLog('t1', 0)).map((e) => e.data)).toEqual(['"a"']);
    expect((await b.readLog('t1', 0)).map((e) => e.data)).toEqual(['"b"']);
    expect(tableNames(connect(path)).filter((n) => n.startsWith('app_b_'))).toHaveLength(5);
  });

  it('rejects a table prefix that is not a plain SQL identifier', () => {
    for (const tablePrefix of ['', 'a-b', 'x"; DROP TABLE y; --', '1abc']) {
      expect(() => sqliteStore({ file: ':memory:', tablePrefix })).toThrow(TypeError);
    }
  });

  it('refuses a database written by a newer schema version', () => {
    const path = file();
    const database = connect(path);
    track(sqliteStore({ database }));
    database.prepare("UPDATE shoehive_meta SET value = '99' WHERE key = 'schema_version'").run();
    expect(() => sqliteStore({ file: path })).toThrow(/schema version 99/);
  });

  it('lets exactly one of two connections on one file append the same seq', async () => {
    const path = file();
    const a = track(sqliteStore({ file: path }));
    const b = track(sqliteStore({ file: path }));
    await a.appendLog('t1', [{ seq: 0, data: '{}' }]);
    await a.appendLog('t1', [{ seq: 1, data: '"a"' }]);
    const error: unknown = await b
      .appendLog('t1', [{ seq: 1, data: '"b"' }])
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StoreConflictError);
    expect(error).toMatchObject({ tableId: 't1', expected: 2, got: 1 });
    expect((await b.readLog('t1', 0)).map((e) => e.data)).toEqual(['{}', '"a"']);
  });

  it('returns plain numbers from a connection with BigInt integers turned on', async () => {
    const database = connect(':memory:');
    database.defaultSafeIntegers(true);
    const store = track(sqliteStore({ database }));
    await store.appendLog('t1', [{ seq: 0, data: '{}' }]);
    await store.saveSnapshot('t1', { seq: 0, rev: 4, game: 'g', version: 2, data: '{}' });
    await store.sessions.put({ playerId: 'p1', name: 'Ada', metadata: [1], updatedAt: 5 });
    expect(await store.loadTable('t1')).toEqual({
      snapshot: { seq: 0, rev: 4, game: 'g', version: 2, data: '{}' },
      tail: [],
    });
    expect((await store.sessions.get('p1'))?.updatedAt).toBe(5);
  });

  it('accepts a retry from another connection and rejects a partly new batch', async () => {
    const path = file();
    const a = track(sqliteStore({ file: path }));
    const b = track(sqliteStore({ file: path }));
    const batch = [
      { seq: 0, data: '"x"' },
      { seq: 1, data: '"y"' },
    ];
    await a.appendLog('t1', batch);
    await b.appendLog('t1', batch); // the reply to a was lost; b retries the same write
    const error: unknown = await b
      .appendLog('t1', [...batch, { seq: 2, data: '"z"' }])
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'StoreConflictError', expected: 2, got: 0 });
    expect((await a.readLog('t1', 0)).map((e) => e.data)).toEqual(['"x"', '"y"']);
  });
});
