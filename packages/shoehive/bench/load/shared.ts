// Configuration, IPC message types and statistics shared by the load test's orchestrator
// (bench/load.ts, which also runs the server) and its load-generator processes.

import { availableParallelism } from 'node:os';

export interface LoadConfig {
  /** Tables to create (all Hold'em). */
  tables: number;
  /** Seated players (one socket each) per table, 2 to 9. */
  players: number;
  /** Actions per second per table while a hand is being bet. */
  rate: number;
  /** Seconds of play before measuring starts. */
  warmup: number;
  /** Seconds of measured play. */
  duration: number;
  /**
   * `sqlite`: the adapter's own file mode (WAL, synchronous = FULL: every ack is durable).
   * `sqlite-normal`: WAL with synchronous = NORMAL, the documented trade-off (safe across
   * a process crash, may lose the last transactions on a power loss).
   */
  store: 'memory' | 'sqlite' | 'sqlite-normal';
  /** Load-generator child processes. */
  generators: number;
  /** Tables each generator sets up at the same time (5 sockets each). */
  concurrency: number;
  /** Hold'em turn timer. A seat that misses it is folded by the server (counted). */
  turnMs: number;
  /** Directory for the JSON results (and the SQLite file). */
  out: string;
  /** Write a CPU profile of the server for the measured window only. */
  profile: boolean;
}

const DEFAULTS: LoadConfig = {
  tables: 1000,
  players: 5,
  rate: 1,
  warmup: 10,
  duration: 60,
  store: 'memory',
  generators: Math.max(1, availableParallelism() - 1),
  concurrency: 20,
  turnMs: 30_000,
  out: 'bench/.out/load',
  profile: false,
};

const USAGE = `Usage: pnpm --filter shoehive bench:load [options]

  --tables <n>        tables, all Texas Hold'em (default ${String(DEFAULTS.tables)})
  --players <n>       seated players (sockets) per table, 2 to 9 (default ${String(DEFAULTS.players)})
  --rate <n>          actions per second per table (default ${String(DEFAULTS.rate)})
  --warmup <s>        seconds of play before measuring (default ${String(DEFAULTS.warmup)})
  --duration <s>      seconds of measured play (default ${String(DEFAULTS.duration)})
  --store <name>      memory, sqlite (synchronous FULL) or sqlite-normal (default ${DEFAULTS.store})
  --generators <n>    load-generator processes (default CPUs - 1 = ${String(DEFAULTS.generators)})
  --concurrency <n>   tables each generator sets up at once (default ${String(DEFAULTS.concurrency)})
  --turn-ms <ms>      Hold'em turn timer (default ${String(DEFAULTS.turnMs)})
  --out <dir>         where results are written (default ${DEFAULTS.out})
  --profile           also write a .cpuprofile of the server for the measured window
`;

export function parseArgs(argv: readonly string[]): LoadConfig {
  const config: LoadConfig = { ...DEFAULTS };
  const args = argv.filter((a) => a !== '--');
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (flag === '--help' || flag === '-h') {
      console.log(USAGE);
      process.exit(0);
    }
    if (flag === '--profile') {
      config.profile = true;
      continue;
    }
    const value = args[++i];
    if (value === undefined) throw new Error(`${flag} needs a value\n\n${USAGE}`);
    const num = (min: number, max = Infinity): number => {
      const n = Number(value);
      if (!Number.isFinite(n) || n < min || n > max) {
        throw new Error(`${flag} must be a number from ${String(min)} to ${String(max)}`);
      }
      return n;
    };
    switch (flag) {
      case '--tables':
        config.tables = Math.floor(num(1));
        break;
      case '--players':
        config.players = Math.floor(num(2, 9));
        break;
      case '--rate':
        config.rate = num(0.01, 1000);
        break;
      case '--warmup':
        config.warmup = num(0);
        break;
      case '--duration':
        config.duration = num(1);
        break;
      case '--store':
        if (value !== 'memory' && value !== 'sqlite' && value !== 'sqlite-normal') {
          throw new Error('--store is memory, sqlite or sqlite-normal');
        }
        config.store = value;
        break;
      case '--generators':
        config.generators = Math.floor(num(1, 64));
        break;
      case '--concurrency':
        config.concurrency = Math.floor(num(1, 1000));
        break;
      case '--turn-ms':
        config.turnMs = Math.floor(num(1000));
        break;
      case '--out':
        config.out = value;
        break;
      default:
        throw new Error(`Unknown option ${flag}\n\n${USAGE}`);
    }
  }
  config.generators = Math.min(config.generators, config.tables);
  return config;
}

// ---------------------------------------------------------------------------------
// IPC between the orchestrator and the generators

export interface Counters {
  /** `act` requests sent. */
  acts: number;
  /** `act` requests acked ok. */
  acked: number;
  /** Nacks by error code (game codes and Shoehive codes). */
  nacks: Record<string, number>;
  /** Acks that arrived before the acting client had a document at that rev (must be 0). */
  ackBeforePatch: number;
  /** Fan-outs still incomplete when the table's next action was sent. */
  fanoutIncomplete: number;
  /** Turns the server timed out (the seat was checked or folded for it). */
  turnTimeouts: number;
  /** `table.snapshot` messages after setup (resyncs after a gap, or backpressure). */
  snapshots: number;
  /** Sockets that closed while the test was running. */
  closes: number;
  socketErrors: number;
  /** Server messages received and their total size. */
  messages: number;
  bytes: number;
  hands: number;
}

export function emptyCounters(): Counters {
  return {
    acts: 0,
    acked: 0,
    nacks: {},
    ackBeforePatch: 0,
    fanoutIncomplete: 0,
    turnTimeouts: 0,
    snapshots: 0,
    closes: 0,
    socketErrors: 0,
    messages: 0,
    bytes: 0,
    hands: 0,
  };
}

export function addCounters(into: Counters, from: Counters): void {
  for (const key of Object.keys(from) as (keyof Counters)[]) {
    if (key === 'nacks') {
      for (const [code, n] of Object.entries(from.nacks))
        into.nacks[code] = (into.nacks[code] ?? 0) + n;
    } else {
      into[key] += from[key];
    }
  }
}

export interface SetupReport {
  /** Socket open plus `hello` ack, per socket (ms). */
  connectMs: number[];
  /** Create, 5 joins and 5 seats, per table (ms, after its sockets connected). */
  tableMs: number[];
  errors: string[];
}

export interface Samples {
  /** Acting client: `act` sent to the `table.patch` at that action's rev applied. */
  actToPatch: number[];
  /** Acting client: `act` sent to its ack. */
  actToAck: number[];
  /** Each other seat at the table: `act` sent to its patch at that rev. */
  fanout: number[];
  /** Per action: `act` sent to the last seat of the table having its patch. */
  fanoutAll: number[];
}

export interface ProcessStats {
  /** CPU time over the measured window, as a percentage of one core. */
  cpuPercent: number;
  rssMb: number;
  loop: LoopStats;
}

export interface LoopStats {
  p50: number;
  p99: number;
  max: number;
  mean: number;
}

export type ToGenerator =
  | { type: 'init'; config: LoadConfig; url: string; index: number; tables: number[] }
  | { type: 'start' }
  | { type: 'measure' }
  | { type: 'stop' };

export type FromGenerator =
  | { type: 'ready'; setup: SetupReport }
  | { type: 'progress'; counters: Counters }
  | {
      type: 'result';
      samples: Samples;
      counters: Counters;
      stats: ProcessStats;
      measuredMs: number;
    };

// ---------------------------------------------------------------------------------
// Statistics

export interface Summary {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export function percentile(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

export function summarize(samples: readonly number[]): Summary {
  const sorted = Float64Array.from(samples).sort();
  let sum = 0;
  for (const s of sorted) sum += s;
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length > 0 ? sorted[sorted.length - 1]! : NaN,
    mean: sorted.length > 0 ? sum / sorted.length : NaN,
  };
}

/**
 * Reads an `IntervalHistogram` (nanoseconds) as milliseconds of delay. The histogram
 * records the whole sampling interval, so `resolutionMs` is subtracted.
 */
export function loopStats(
  h: { percentile(p: number): number; max: number; mean: number },
  resolutionMs: number,
): LoopStats {
  const ms = (ns: number): number => round(Math.max(0, ns / 1e6 - resolutionMs));
  return { p50: ms(h.percentile(50)), p99: ms(h.percentile(99)), max: ms(h.max), mean: ms(h.mean) };
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
