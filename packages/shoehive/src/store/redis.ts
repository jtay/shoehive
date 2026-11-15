/**
 * shoehive/store/redis: the Redis Store adapter (ADR 0009), on an `ioredis` client
 * that you create and own (`ioredis` is an optional peer dependency, ADR 0002).
 *
 * ```ts
 * import { Redis } from 'ioredis';
 * import { createServer } from 'shoehive/server';
 * import { redisStore } from 'shoehive/store/redis';
 *
 * const redis = new Redis(process.env.REDIS_URL);
 * const server = createServer({ games, secret, store: redisStore({ client: redis }) });
 * // On shutdown: await server.close(); then redis.quit() (the store never quits it).
 * ```
 *
 * **Redis must run with AOF enabled** (`appendonly yes`). The engine acks an action
 * only after `appendLog` resolves ("an ack means durable", ADR 0009), and without AOF
 * Redis keeps writes in memory until the next RDB snapshot, so a crash loses every
 * acked action since then. The `appendfsync` setting decides how durable an ack is:
 *
 * - `always`: fsync before every reply. An ack survives a crash of Redis or of the
 *   machine. Slowest: each append waits for the disk.
 * - `everysec` (the Redis default, recommended): fsync once a second. An ack survives a
 *   Redis crash; a power loss or kernel crash can lose up to about one second of acked
 *   actions. Throughput close to no fsync at all.
 * - `no`: the OS decides when to flush (often every 30 seconds). Not recommended.
 *
 * Replication does not replace AOF: replicas receive writes asynchronously, so a
 * failover can drop acked entries unless you also use `WAIT`/`min-replicas-to-write`.
 *
 * Key layout, for a prefix `P` (default `shoehive:`):
 *
 * | Key           | Type   | Holds                                                     |
 * | ------------- | ------ | --------------------------------------------------------- |
 * | `P log:<id>`  | list   | the table's log: entry `data`, element index == `seq`     |
 * | `P snap:<id>` | string | JSON of the table's latest `StoredSnapshot`               |
 * | `P open`      | set    | ids of tables that have a snapshot and are not closed     |
 * | `P closed`    | hash   | closed table id to close reason                           |
 * | `P sessions`  | hash   | player id to JSON of the `SessionRecord`                  |
 *
 * Table and player ids are stored as-is, with no escaping (Redis keys and members are
 * binary safe). An id is always the last part of a key, after a fixed kind (`log:`,
 * `snap:`), so no id can collide with another id or with the fixed keys, whatever it
 * contains (`:`, spaces, quotes, non-ASCII). Prefixes must not nest: give each store
 * its own prefix, and never one that starts with another store's prefix (`app:` and
 * `app:log:` would overlap).
 *
 * Appends, snapshot saves and closes run as Lua scripts, so each one is atomic and the
 * invariant "open = has a snapshot and is not closed" holds between any two commands.
 * A retried append (identical entries already stored) succeeds without writing.
 *
 * Redis Cluster is not supported in v1: pass a standalone (or Sentinel) client.
 *
 * @packageDocumentation
 */
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import {
  StoreConflictError,
  type SessionRecord,
  type Store,
  type StoredEntry,
  type StoredSnapshot,
} from './types';

export { StoreConflictError } from './types';
export type { SessionRecord, Store, StoredEntry, StoredSnapshot } from './types';

/** Options for {@link redisStore}. */
export interface RedisStoreOptions {
  /**
   * A connected (or connecting) `ioredis` client. The store issues commands on it but
   * never quits or reconfigures it: `store.close()` leaves it usable, and you quit it.
   */
  client: Redis;
  /**
   * Prepended to every key the store writes, so several stores (or apps) can share one
   * Redis database. Default `'shoehive:'`.
   */
  prefix?: string;
}

/** A Lua script, run by SHA (EVALSHA) with a fallback to EVAL when Redis lacks it. */
interface Script {
  source: string;
  sha: string;
}

const script = (source: string): Script => ({
  source,
  sha: createHash('sha1').update(source).digest('hex'),
});

/**
 * Appends a batch to a table log, all or nothing.
 *
 * KEYS[1] is the log list. ARGV is `n` seqs followed by `n` entry data strings. Because
 * every log starts at seq 0 and each append continues exactly from the last seq, the
 * element at index `seq` is the entry with that seq, and the next seq is the list length.
 *
 * 1. Retry: if every entry is already stored at its seq with identical data, the batch
 *    is a re-send after a lost reply (ioredis re-sends unanswered commands on
 *    reconnect). Write nothing and succeed.
 * 2. Otherwise check every seq against the length before writing anything, then push
 *    the data in chunks (Lua's `unpack` has a stack limit).
 *
 * Returns the list length on success, or `{expected, index}` for the first entry
 * (0-based `index` into the batch) whose seq is wrong, in which case nothing was written.
 */
const APPEND = script(`
local len = redis.call('LLEN', KEYS[1])
local n = #ARGV / 2
local stored = true
for i = 1, n do
  local seq = tonumber(ARGV[i])
  if not (seq and seq >= 0 and seq < len and seq == math.floor(seq)
      and redis.call('LINDEX', KEYS[1], seq) == ARGV[n + i]) then
    stored = false
    break
  end
end
if stored then return len end
for i = 1, n do
  if tonumber(ARGV[i]) ~= len + i - 1 then return {len + i - 1, i - 1} end
end
for i = n + 1, #ARGV, 1000 do
  redis.call('RPUSH', KEYS[1], unpack(ARGV, i, math.min(i + 999, #ARGV)))
end
return len + n
`);

/** KEYS: snapshot, open set, closed hash. ARGV: table id, snapshot JSON. */
const SAVE_SNAPSHOT = script(`
redis.call('SET', KEYS[1], ARGV[2])
if redis.call('HEXISTS', KEYS[3], ARGV[1]) == 0 then redis.call('SADD', KEYS[2], ARGV[1]) end
return 1
`);

/** KEYS: open set, closed hash. ARGV: table id, reason. */
const CLOSE_TABLE = script(`
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
redis.call('SREM', KEYS[1], ARGV[1])
return 1
`);

/**
 * Creates a Store over a caller-owned `ioredis` client. It keeps no state of its own,
 * so a new store over the same client and prefix sees everything an earlier one wrote
 * (what restart recovery needs). See the package documentation for the key layout and
 * the AOF requirement.
 */
export function redisStore(options: RedisStoreOptions): Store {
  const { client, prefix = 'shoehive:' } = options;
  const logKey = (id: string) => `${prefix}log:${id}`;
  const snapshotKey = (id: string) => `${prefix}snap:${id}`;
  const openKey = `${prefix}open`;
  const closedKey = `${prefix}closed`;
  const sessionsKey = `${prefix}sessions`;

  async function run(s: Script, keys: string[], args: (string | number)[]): Promise<unknown> {
    try {
      return await client.evalsha(s.sha, keys.length, ...keys, ...args);
    } catch (error) {
      // Not cached on this server yet (first use, restart, SCRIPT FLUSH): send the source.
      if (!(error instanceof Error && error.message.startsWith('NOSCRIPT'))) throw error;
      return client.eval(s.source, keys.length, ...keys, ...args);
    }
  }

  /** Seq equals list index, so a seq range is an index range: one LRANGE. */
  async function readLog(tableId: string, fromSeq: number, toSeq = Number.POSITIVE_INFINITY) {
    const start = Math.max(0, Math.ceil(fromSeq));
    const end = Math.floor(toSeq);
    if (!Number.isSafeInteger(start) || !(end >= start)) return [];
    const data = await client.lrange(logKey(tableId), start, Number.isSafeInteger(end) ? end : -1);
    return data.map((d, i): StoredEntry => ({ seq: start + i, data: d }));
  }

  return {
    async appendLog(tableId, entries) {
      if (entries.length === 0) return;
      const result = await run(
        APPEND,
        [logKey(tableId)],
        [...entries.map((e) => e.seq), ...entries.map((e) => e.data)],
      );
      if (Array.isArray(result)) {
        const [expected, index] = result as [number, number];
        throw new StoreConflictError(tableId, expected, entries[index]!.seq);
      }
    },
    async saveSnapshot(tableId, { seq, rev, game, version, data }) {
      const json = JSON.stringify({ seq, rev, game, version, data });
      await run(SAVE_SNAPSHOT, [snapshotKey(tableId), openKey, closedKey], [tableId, json]);
    },
    async loadTable(tableId) {
      const raw = await client.get(snapshotKey(tableId));
      if (raw === null) return null;
      const { seq, rev, game, version, data } = JSON.parse(raw) as StoredSnapshot;
      // The log is append-only, so entries written between the two reads only lengthen
      // the tail: the result is still a snapshot plus every entry after it.
      return { snapshot: { seq, rev, game, version, data }, tail: await readLog(tableId, seq + 1) };
    },
    readLog,
    listOpenTables: () => client.smembers(openKey),
    async closeTable(tableId, reason) {
      await run(CLOSE_TABLE, [openKey, closedKey], [tableId, reason]);
    },
    sessions: {
      async get(playerId) {
        const raw = await client.hget(sessionsKey, playerId);
        if (raw === null) return null;
        const { name, metadata, updatedAt } = JSON.parse(raw) as SessionRecord;
        return { playerId, name, metadata, updatedAt };
      },
      async put({ playerId, name, metadata, updatedAt }) {
        await client.hset(sessionsKey, playerId, JSON.stringify({ name, metadata, updatedAt }));
      },
      async delete(playerId) {
        await client.hdel(sessionsKey, playerId);
      },
    },
    /** A no-op: the client belongs to the caller, who quits it. */
    close: () => Promise.resolve(),
  };
}
