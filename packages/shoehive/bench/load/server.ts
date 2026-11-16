// The server under test: a real `createServer` over WebSockets with production settings,
// the Hold'em example game and a wallet with room for every buy-in.

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { constants, monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks';
import { holdem } from '../../../../examples/holdem/src/game';
import {
  createServer,
  memoryStore,
  MemoryWallet,
  silentLogger,
  type ShoehiveServer,
  type Store,
} from '../../src/server/index';
import { loopStats, round, type LoadConfig, type ProcessStats } from './shared';

export interface ServerUnderTest {
  shoehive: ShoehiveServer;
  url: string;
  /** Starts the measured window: CPU, event-loop delay and RSS sampling. */
  startMeasuring(): void;
  /** Ends the window and returns the server process figures for it. */
  stopMeasuring(): ProcessStats & {
    rssMaxMb: number;
    heapUsedMb: number;
    ms: number;
    gc: GcStats;
  };
  /** Event-loop delay since the last call (ms), for progress lines. */
  loopSinceLast(): { p99: number; max: number };
}

/** Garbage-collection pauses in the measured window (ms). */
export interface GcStats {
  count: number;
  totalMs: number;
  maxMs: number;
  /** Mark-compact (major) collections. */
  major: number;
  majorMaxMs: number;
}

async function openStore(config: LoadConfig): Promise<{ store: Store; file: string | null }> {
  if (config.store === 'memory') return { store: memoryStore(), file: null };
  // Loaded only for this scenario: better-sqlite3 is an optional native dependency.
  const { sqliteStore } = await import('../../src/store/sqlite');
  const file = join(config.out, 'load.sqlite');
  for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });
  if (config.store === 'sqlite') {
    // `file` mode: WAL with synchronous = FULL, so every acked action is durable (ADR 0009).
    return { store: sqliteStore({ file }), file };
  }
  const { default: Database } = await import('better-sqlite3');
  const database = new Database(file);
  database.pragma('journal_mode = WAL');
  database.pragma('synchronous = NORMAL');
  return { store: sqliteStore({ database }), file };
}

export async function startServer(config: LoadConfig): Promise<ServerUnderTest> {
  const { store } = await openStore(config);
  const shoehive = createServer({
    games: [holdem],
    // Every seat buys in for 1,000,000 chips, so nobody busts during the run.
    wallet: new MemoryWallet({ startingBalance: 1_000_000_000 }),
    store,
    dev: false,
    secret: 'shoehive-load-test-secret-0123456789abcdef',
    logger: silentLogger,
    // Default limits (20 messages/s, burst 40, 32 in flight per connection) are left as
    // they are: one player sends far less than that. See docs/reference/benchmarks.md.
  });
  const { url } = await shoehive.listen({ port: 0 });

  const loop = monitorEventLoopDelay({ resolution: 1 });
  const progressLoop = monitorEventLoopDelay({ resolution: 5 });
  progressLoop.enable();
  let cpuStart = process.cpuUsage();
  let startedAt = 0;
  let rssMax = 0;
  let sampler: NodeJS.Timeout | null = null;
  let gc: GcStats = { count: 0, totalMs: 0, maxMs: 0, major: 0, majorMaxMs: 0 };
  let gcOn = false;
  const gcObserver = new PerformanceObserver((list) => {
    if (!gcOn) return;
    for (const entry of list.getEntries()) {
      const kind = (entry as PerformanceEntry & { detail?: { kind?: number } }).detail?.kind;
      gc.count += 1;
      gc.totalMs += entry.duration;
      gc.maxMs = Math.max(gc.maxMs, entry.duration);
      if (kind === constants.NODE_PERFORMANCE_GC_MAJOR) {
        gc.major += 1;
        gc.majorMaxMs = Math.max(gc.majorMaxMs, entry.duration);
      }
    }
  });
  gcObserver.observe({ entryTypes: ['gc'] });

  return {
    shoehive,
    url,
    startMeasuring() {
      loop.reset();
      loop.enable();
      cpuStart = process.cpuUsage();
      startedAt = performance.now();
      rssMax = process.memoryUsage.rss();
      gc = { count: 0, totalMs: 0, maxMs: 0, major: 0, majorMaxMs: 0 };
      gcOn = true;
      sampler = setInterval(() => {
        rssMax = Math.max(rssMax, process.memoryUsage.rss());
      }, 1000);
    },
    stopMeasuring() {
      const ms = performance.now() - startedAt;
      gcOn = false;
      gcObserver.disconnect();
      loop.disable();
      if (sampler !== null) clearInterval(sampler);
      const cpu = process.cpuUsage(cpuStart);
      const memory = process.memoryUsage();
      rssMax = Math.max(rssMax, memory.rss);
      return {
        cpuPercent: round(((cpu.user + cpu.system) / 1000 / ms) * 100, 1),
        rssMb: round(memory.rss / 2 ** 20, 1),
        rssMaxMb: round(rssMax / 2 ** 20, 1),
        heapUsedMb: round(memory.heapUsed / 2 ** 20, 1),
        loop: loopStats(loop, 1),
        ms,
        gc: {
          count: gc.count,
          totalMs: round(gc.totalMs, 1),
          maxMs: round(gc.maxMs, 1),
          major: gc.major,
          majorMaxMs: round(gc.majorMaxMs, 1),
        },
      };
    },
    loopSinceLast() {
      const stats = loopStats(progressLoop, 5);
      progressLoop.reset();
      return { p99: stats.p99, max: stats.max };
    },
  };
}
