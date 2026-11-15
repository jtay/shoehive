import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { memoryStore } from '../../src/store/memory';
import { redisStore } from '../../src/store/redis';
import { StoreConflictError, type StoredEntry } from '../../src/store/types';
import { runStoreConformance, type StoreBackend } from '../../src/testing/index';
import { describeRecovery, REDIS_URL, uniqueName } from './recovery';

const entry = (seq: number, data = `{"seq":${String(seq)}}`): StoredEntry => ({ seq, data });
const snapshot = (seq: number) => ({ seq, rev: seq, game: 'g', version: 1, data: '{}' });

if (!REDIS_URL) {
  describe.skip('redis store (set SHOEHIVE_TEST_REDIS_URL to run)', () => {
    it('needs a Redis server', () => undefined);
  });
} else {
  // One shared client: stores never quit it, and each test gets its own key prefix.
  const client = new Redis(REDIS_URL);
  afterAll(async () => {
    await client.quit();
  });

  /** Every key under `prefix`, found with SCAN (never KEYS: the server is shared). */
  async function keysOf(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 1000);
      keys.push(...batch);
      cursor = next;
    } while (cursor !== '0');
    return keys;
  }

  async function deletePrefix(prefix: string): Promise<void> {
    const keys = await keysOf(prefix);
    if (keys.length > 0) await client.unlink(...keys);
  }

  function backend(): StoreBackend {
    const prefix = `${uniqueName('shoehive_test')}:`;
    return { open: () => redisStore({ client, prefix }), destroy: () => deletePrefix(prefix) };
  }

  runStoreConformance(() => Promise.resolve(backend()), { describe, it, expect });
  describeRecovery('redis', () => Promise.resolve(backend()));

  describe('redis store adapter', () => {
    const prefixes: string[] = [];
    const fresh = () => {
      const prefix = `${uniqueName('shoehive_test')}:`;
      prefixes.push(prefix);
      return { prefix, store: redisStore({ client, prefix }) };
    };
    afterAll(async () => {
      for (const prefix of prefixes) await deletePrefix(prefix);
    });

    it('isolates stores with different prefixes on one client', async () => {
      const a = fresh().store;
      const b = fresh().store;
      await a.appendLog('t', [entry(0)]);
      await a.saveSnapshot('t', snapshot(0));
      await a.sessions.put({ playerId: 'p', name: 'Ada', metadata: null, updatedAt: 1 });
      expect(await b.loadTable('t')).toBeNull();
      expect(await b.readLog('t', 0)).toEqual([]);
      expect(await b.listOpenTables()).toEqual([]);
      expect(await b.sessions.get('p')).toBeNull();
      await b.appendLog('t', [entry(0)]); // b's log for "t" is its own, starting at 0
      expect(await a.listOpenTables()).toEqual(['t']);
    });

    it('uses the documented key layout', async () => {
      const { prefix, store } = fresh();
      await store.appendLog('t:1', [entry(0), entry(1)]);
      await store.saveSnapshot('t:1', snapshot(0));
      await store.closeTable('t:1', 'ended');
      await store.sessions.put({ playerId: 'p', name: 'Ada', metadata: null, updatedAt: 1 });
      expect((await keysOf(prefix)).sort()).toEqual(
        ['log:t:1', 'snap:t:1', 'closed', 'sessions'].map((k) => prefix + k).sort(),
      );
      expect(await client.lrange(`${prefix}log:t:1`, 0, -1)).toEqual(['{"seq":0}', '{"seq":1}']);
      expect(await client.hget(`${prefix}closed`, 't:1')).toBe('ended');
      expect(await client.exists(`${prefix}open`)).toBe(0); // the set emptied on close
    });

    it('keeps ids that contain the separator or match fixed key names apart', async () => {
      const { store } = fresh();
      const ids = ['x', 'log:x', 'snap:x', ':', 'open', 'closed', 'sessions', 'x:', ':x'];
      for (const [i, id] of ids.entries()) {
        await store.appendLog(
          id,
          Array.from({ length: i + 1 }, (_, seq) => entry(seq, id)),
        );
        await store.saveSnapshot(id, { ...snapshot(0), game: id });
      }
      await store.closeTable('open', 'ended');
      for (const [i, id] of ids.entries()) {
        const log = await store.readLog(id, 0);
        expect(log).toHaveLength(i + 1);
        expect(log.every((e) => e.data === id)).toBe(true);
        expect((await store.loadTable(id))?.snapshot.game).toBe(id);
      }
      expect((await store.listOpenTables()).sort()).toEqual(
        ids.filter((id) => id !== 'open').sort(),
      );
    });

    it('leaves the client usable after close()', async () => {
      const { prefix, store } = fresh();
      await store.appendLog('t', [entry(0)]);
      await store.close();
      expect(client.status).toBe('ready');
      expect(await client.ping()).toBe('PONG');
      // A new store over the same client and prefix picks up where the old one stopped.
      const again = redisStore({ client, prefix });
      await again.appendLog('t', [entry(1)]);
      expect((await again.readLog('t', 0)).map((e) => e.seq)).toEqual([0, 1]);
    });

    it('reports the expected and actual seq of the first bad entry', async () => {
      const { store } = fresh();
      await store.appendLog('t', [entry(0)]);
      const conflict = (entries: StoredEntry[]) =>
        store.appendLog('t', entries).then(
          () => null,
          (error: unknown) => error,
        );
      const gapInside = await conflict([entry(1), entry(2), entry(4)]);
      expect(gapInside).toBeInstanceOf(StoreConflictError);
      expect(gapInside).toMatchObject({ tableId: 't', expected: 3, got: 4 });
      expect(await conflict([entry(5), entry(6)])).toMatchObject({ expected: 1, got: 5 });
      expect(await conflict([entry(0.5)])).toMatchObject({ expected: 1, got: 0.5 });
      expect(await store.readLog('t', 0)).toHaveLength(1);
    });

    it('appends a batch larger than one RPUSH chunk atomically', async () => {
      const { store } = fresh();
      const batch = Array.from({ length: 2500 }, (_, seq) => entry(seq));
      await store.appendLog('t', batch);
      expect(await store.readLog('t', 0)).toEqual(batch);
      const bad = [...Array.from({ length: 2400 }, (_, i) => entry(2500 + i)), entry(9999)];
      expect(await store.appendLog('t', bad).catch((e: unknown) => e)).toBeInstanceOf(
        StoreConflictError,
      );
      expect(await store.readLog('t', 0)).toHaveLength(2500);
    });

    it('accepts a retried batch only if every entry is stored with identical data', async () => {
      const { prefix, store } = fresh();
      const batch = Array.from({ length: 2500 }, (_, seq) => entry(seq));
      await store.appendLog('t', batch);
      await store.appendLog('t', batch); // the whole batch re-sent after a lost reply
      await store.appendLog('t', batch.slice(1200, 1300));
      expect(await client.llen(`${prefix}log:t`)).toBe(2500);
      const conflict = (entries: StoredEntry[]) =>
        store.appendLog('t', entries).then(
          () => null,
          (error: unknown) => error,
        );
      const changed = batch.map((e) => (e.seq === 1700 ? entry(1700, '{"other":1}') : e));
      expect(await conflict(changed)).toMatchObject({ expected: 2500, got: 0 });
      expect(await conflict([entry(2499), entry(2500)])).toMatchObject({
        expected: 2500,
        got: 2499,
      });
      expect(await conflict([entry(-1)])).toMatchObject({ expected: 2500, got: -1 });
      expect(await store.readLog('t', 0)).toEqual(batch);
    });

    it('reads log ranges exactly like the memory store', async () => {
      const redis = fresh().store;
      const memory = memoryStore();
      const entries = Array.from({ length: 6 }, (_, seq) => entry(seq));
      await redis.appendLog('t', entries);
      await memory.appendLog('t', entries);
      const ranges: [number, number?][] = [
        [0],
        [3],
        [-5],
        [2, 4],
        [4, 2],
        [0, -1],
        [1.5, 3.5],
        [0, Number.MAX_VALUE],
        [Number.NaN],
        [99],
      ];
      for (const [from, to] of ranges) {
        expect(await redis.readLog('t', from, to)).toEqual(await memory.readLog('t', from, to));
      }
    });

    it('falls back to EVAL when the server has not cached a script', async () => {
      let refused = 0;
      // A client whose EVALSHA always answers NOSCRIPT, as after a Redis restart.
      const forgetful = new Proxy(client, {
        get(target, key, receiver) {
          if (key === 'evalsha')
            return () => {
              refused += 1;
              return Promise.reject(new Error('NOSCRIPT No matching script.'));
            };
          const value: unknown = Reflect.get(target, key, receiver);
          return typeof value === 'function'
            ? (value as (...args: unknown[]) => unknown).bind(target)
            : value;
        },
      });
      const prefix = fresh().prefix;
      const store = redisStore({ client: forgetful, prefix });
      await store.appendLog('t', [entry(0)]);
      await store.saveSnapshot('t', snapshot(0));
      expect(refused).toBe(2);
      expect(await store.listOpenTables()).toEqual(['t']);
      await store.appendLog('t', [entry(0)]); // a retry, through EVAL too
      expect(
        await store.appendLog('t', [entry(0, '{"other":1}')]).catch((e: unknown) => e),
      ).toBeInstanceOf(StoreConflictError);
      expect(refused).toBe(4);
    });
  });
}
