// The store conformance suite (ADR 0009). Adapters run it with their test runner's
// functions, so shoehive/testing has no test-runner dependency:
//
//   import { describe, it, expect } from 'vitest';
//   runStoreConformance(() => myStore(), { describe, it, expect });

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

const entry = (seq: number, data = `{"seq":${String(seq)}}`): StoredEntry => ({ seq, data });
const snapshot = (seq: number, data = '{}') => ({ seq, rev: seq, game: 'g', version: 1, data });

/** Registers the conformance tests for the store returned by `createStore`. */
export function runStoreConformance(
  createStore: () => Store | Promise<Store>,
  { describe, it, expect }: ConformanceRunner,
): void {
  const withStore = (fn: (store: Store) => Promise<void>) => async () => {
    const store = await createStore();
    try {
      await fn(store);
    } finally {
      await store.close();
    }
  };

  describe('Store conformance (ADR 0009)', () => {
    it(
      'appends entries in order and reads them back',
      withStore(async (store) => {
        await store.appendLog('t1', [entry(0), entry(1)]);
        await store.appendLog('t1', [entry(2)]);
        expect((await store.readLog('t1', 0)).map((e) => e.seq)).toEqual([0, 1, 2]);
        expect((await store.readLog('t1', 1, 1)).map((e) => e.seq)).toEqual([1]);
      }),
    );

    it(
      'rejects a seq gap or a repeated seq with StoreConflictError',
      withStore(async (store) => {
        await store.appendLog('t1', [entry(0)]);
        let gap: unknown;
        await store.appendLog('t1', [entry(2)]).catch((e: unknown) => (gap = e));
        expect(gap instanceof StoreConflictError).toBe(true);
        let repeat: unknown;
        await store.appendLog('t1', [entry(0)]).catch((e: unknown) => (repeat = e));
        expect(repeat instanceof StoreConflictError).toBe(true);
        expect(await store.readLog('t1', 0)).toHaveLength(1);
      }),
    );

    it(
      'replaces the snapshot and loads only the tail after it',
      withStore(async (store) => {
        await store.appendLog('t1', [entry(0), entry(1), entry(2), entry(3)]);
        await store.saveSnapshot('t1', snapshot(0, '{"a":0}'));
        await store.saveSnapshot('t1', snapshot(2, '{"a":2}'));
        const loaded = await store.loadTable('t1');
        expect(loaded?.snapshot).toEqual(snapshot(2, '{"a":2}'));
        expect(loaded?.tail.map((e) => e.seq)).toEqual([3]);
        expect(await store.loadTable('missing')).toBeNull();
      }),
    );

    it(
      'lists open tables and stops listing closed ones',
      withStore(async (store) => {
        for (const id of ['a', 'b']) {
          await store.appendLog(id, [entry(0)]);
          await store.saveSnapshot(id, snapshot(0));
        }
        expect((await store.listOpenTables()).sort()).toEqual(['a', 'b']);
        await store.closeTable('a', 'ended');
        expect(await store.listOpenTables()).toEqual(['b']);
        expect((await store.loadTable('a'))?.snapshot.seq).toBe(0); // closed tables are kept
      }),
    );

    it(
      'stores, replaces and deletes sessions',
      withStore(async (store) => {
        const record = { playerId: 'p1', name: 'Ada', metadata: { tier: 'gold' }, updatedAt: 1 };
        expect(await store.sessions.get('p1')).toBeNull();
        await store.sessions.put(record);
        expect(await store.sessions.get('p1')).toEqual(record);
        await store.sessions.put({ ...record, name: 'Ada L', updatedAt: 2 });
        expect((await store.sessions.get('p1'))?.name).toBe('Ada L');
        await store.sessions.delete('p1');
        expect(await store.sessions.get('p1')).toBeNull();
      }),
    );

    it(
      'handles 1 MiB payloads and keeps tables independent',
      withStore(async (store) => {
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
  });
}
