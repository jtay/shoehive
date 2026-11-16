// Phase 8 load test (RFC 0001 section 12): 1,000 Hold'em tables and 5,000 sockets on one
// node, p95 action-to-patch under 20 ms. See docs/reference/benchmarks.md, "Load test".
//
// This process runs the server (real `createServer` over WebSockets, production settings)
// and orchestrates; load-generator child processes (bench/load/generator.ts) open the
// sockets with `shoehive/client` and the `ws` package and measure on the client side.
//
//   pnpm --filter shoehive bench:load -- --tables 100 --duration 30
//
// Flags: --tables --players --rate --warmup --duration --store --generators --concurrency
// --turn-ms --out --profile (`--help` lists them with defaults).

import { fork, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { cpus, release, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { runGenerator } from './load/generator';
import { startServer } from './load/server';
import {
  addCounters,
  emptyCounters,
  parseArgs,
  round,
  summarize,
  type Counters,
  type FromGenerator,
  type LoadConfig,
  type ProcessStats,
  type Samples,
  type SetupReport,
  type Summary,
  type ToGenerator,
} from './load/shared';

const TARGET_P95_MS = 20;

/** Soft and hard limits on open files, from /proc (Linux), or null elsewhere. */
function fileLimits(): { soft: number; hard: number } | null {
  try {
    const line = readFileSync('/proc/self/limits', 'utf8')
      .split('\n')
      .find((l) => l.startsWith('Max open files'));
    const [soft, hard] = (line?.match(/(\d+|unlimited)/g) ?? []).map((v) =>
      v === 'unlimited' ? Infinity : Number(v),
    );
    return soft !== undefined && hard !== undefined ? { soft, hard } : null;
  } catch {
    return null;
  }
}

/**
 * Every socket is one file descriptor in the server and one in a generator. Node cannot
 * call setrlimit, so when the soft limit is too low but the hard limit allows it, the
 * test runs itself again under `ulimit -n <hard>`.
 */
function ensureFileLimit(config: LoadConfig): void {
  const sockets = config.tables * config.players;
  const need = sockets + 256;
  const limits = fileLimits();
  if (!limits || limits.soft >= need) return;
  if (limits.hard < need || process.env['SHOEHIVE_LOAD_REEXEC'] === '1') {
    throw new Error(
      `${String(sockets)} sockets need about ${String(need)} open files per process, but the limit is ${String(limits.soft)} (hard ${String(limits.hard)}). Raise it, for example with \`ulimit -n ${String(need)}\` (as root if the hard limit is lower).`,
    );
  }
  const target = Number.isFinite(limits.hard) ? String(limits.hard) : String(need);
  console.log(`Raising the open-file limit from ${String(limits.soft)} to ${target}`);
  const result = spawnSync(
    'sh',
    [
      '-c',
      `ulimit -n ${target} && exec "$0" "$@"`,
      process.execPath,
      ...process.execArgv,
      ...process.argv.slice(1),
    ],
    { stdio: 'inherit', env: { ...process.env, SHOEHIVE_LOAD_REEXEC: '1' } },
  );
  process.exit(result.status ?? 1);
}

/** Busy and total CPU time of the whole machine (all cores), from /proc/stat (Linux). */
function machineCpu(): { busy: number; total: number } | null {
  try {
    const fields = readFileSync('/proc/stat', 'utf8').split('\n')[0]!.trim().split(/\s+/).slice(1);
    const [user, nice, system, idle, iowait, irq, softirq, steal] = fields.map(Number);
    const busy = user! + nice! + system! + irq! + softirq!;
    return { busy, total: busy + idle! + iowait! + steal! };
  } catch {
    return null;
  }
}

function nextMessage<T extends FromGenerator['type']>(
  child: ChildProcess,
  type: T,
): Promise<Extract<FromGenerator, { type: T }>> {
  return new Promise((resolvePromise, reject) => {
    const onMessage = (message: FromGenerator): void => {
      if (message.type !== type) return;
      child.off('message', onMessage);
      child.off('exit', onExit);
      resolvePromise(message as Extract<FromGenerator, { type: T }>);
    };
    const onExit = (code: number | null): void => {
      reject(new Error(`A load generator exited (code ${String(code)}) before "${type}"`));
    };
    child.on('message', onMessage);
    child.once('exit', onExit);
  });
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function row(name: string, s: Summary): Record<string, string | number> {
  const f = (n: number): string => (Number.isNaN(n) ? '-' : n.toFixed(2));
  return {
    metric: name,
    count: s.count,
    p50: f(s.p50),
    p95: f(s.p95),
    p99: f(s.p99),
    max: f(s.max),
    mean: f(s.mean),
  };
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  ensureFileLimit(config);
  config.out = resolve(config.out);
  mkdirSync(config.out, { recursive: true });
  const sockets = config.tables * config.players;
  const machine = {
    cpus: cpus().length,
    model: cpus()[0]?.model ?? 'unknown',
    memoryGb: round(totalmem() / 2 ** 30, 1),
    node: process.version,
    platform: `${process.platform} ${release()}`,
    openFiles: fileLimits()?.soft ?? null,
  };
  console.log(
    `Shoehive load test: ${String(config.tables)} Hold'em tables x ${String(config.players)} players = ${String(sockets)} sockets, ` +
      `${String(config.rate)} action/s per table, ${config.store} store, ${String(config.generators)} generators`,
  );
  console.log(
    `Node ${machine.node}, ${String(machine.cpus)} x ${machine.model}, ${String(machine.memoryGb)} GB, ${machine.platform}`,
  );

  const server = await startServer(config);
  console.log(`Server listening at ${server.url}`);

  // Generators: table k goes to generator k % G, all of its seats together.
  const execArgv = process.execArgv.filter((a) => !a.startsWith('--cpu-prof'));
  const children = Array.from({ length: config.generators }, () =>
    fork(process.argv[1]!, [], {
      env: { ...process.env, SHOEHIVE_LOAD_ROLE: 'generator' },
      execArgv,
      serialization: 'advanced',
    }),
  );
  const broadcast = (message: ToGenerator): void => {
    for (const child of children) child.send(message);
  };
  let interval = emptyCounters();
  for (const child of children) {
    child.on('message', (message: FromGenerator) => {
      if (message.type === 'progress') addCounters(interval, message.counters);
    });
  }

  // ---- Setup
  const setupStarted = performance.now();
  const ready = children.map((child) => nextMessage(child, 'ready'));
  children.forEach((child, index) => {
    const tables = Array.from({ length: config.tables }, (_, k) => k).filter(
      (k) => k % config.generators === index,
    );
    child.send({ type: 'init', config, url: server.url, index, tables } satisfies ToGenerator);
  });
  const setupTicker = setInterval(() => {
    const info = server.shoehive.tables.list().length;
    console.log(`  setup: ${String(info)} tables created`);
  }, 5000);
  const setups: SetupReport[] = (await Promise.all(ready)).map((m) => m.setup);
  clearInterval(setupTicker);
  const setupSeconds = (performance.now() - setupStarted) / 1000;
  const setup = {
    seconds: round(setupSeconds, 1),
    connect: summarize(setups.flatMap((s) => s.connectMs)),
    table: summarize(setups.flatMap((s) => s.tableMs)),
    errors: setups.flatMap((s) => s.errors),
  };
  console.log(
    `Setup done in ${setup.seconds.toFixed(1)} s: ${String(setup.connect.count)} sockets, ${String(setup.table.count)} tables, ${String(setup.errors.length)} errors`,
  );
  for (const error of setup.errors.slice(0, 5)) console.log(`  ${error}`);

  // ---- Play: warm-up, then the measured window
  interval = emptyCounters();
  broadcast({ type: 'start' });
  const progress = setInterval(() => {
    const loop = server.loopSinceLast();
    const nacks = Object.values(interval.nacks).reduce((a, b) => a + b, 0);
    console.log(
      `  ${String(interval.acts)} acts/s, ${String(interval.acked)} acked, ${String(nacks)} nacks, ` +
        `${String(interval.closes)} closes, server loop p99 ${loop.p99.toFixed(1)} ms (max ${loop.max.toFixed(1)})`,
    );
    interval = emptyCounters();
  }, 1000);
  console.log(`Warm-up ${String(config.warmup)} s`);
  await sleep(config.warmup * 1000);
  console.log(`Measuring ${String(config.duration)} s`);
  broadcast({ type: 'measure' });
  server.startMeasuring();
  const machineStart = machineCpu();
  const profiler = config.profile ? new Session() : null;
  if (profiler) {
    profiler.connect();
    await profiler.post('Profiler.enable');
    await profiler.post('Profiler.start');
  }
  await sleep(config.duration * 1000);
  const serverStats = server.stopMeasuring();
  const machineEnd = machineCpu();
  if (profiler) {
    const { profile } = await profiler.post('Profiler.stop');
    const path = join(config.out, `server-${String(config.tables)}t-${config.store}.cpuprofile`);
    writeFileSync(path, JSON.stringify(profile));
    profiler.disconnect();
    console.log(`Server CPU profile of the measured window written to ${path}`);
  }
  const results = children.map((child) => nextMessage(child, 'result'));
  broadcast({ type: 'stop' });
  const done = await Promise.all(results);
  clearInterval(progress);

  // ---- Report
  const merged: Samples = { actToPatch: [], actToAck: [], fanout: [], fanoutAll: [] };
  const counters: Counters = emptyCounters();
  const generators: (ProcessStats & { measuredMs: number })[] = [];
  for (const r of done) {
    for (const key of Object.keys(merged) as (keyof Samples)[]) {
      for (const v of r.samples[key]) merged[key].push(v);
    }
    addCounters(counters, r.counters);
    generators.push({ ...r.stats, measuredMs: r.measuredMs });
  }
  const latency = {
    actToPatch: summarize(merged.actToPatch),
    actToAck: summarize(merged.actToAck),
    fanout: summarize(merged.fanout),
    fanoutAll: summarize(merged.fanoutAll),
  };
  const seconds = serverStats.ms / 1000;
  const throughput = {
    actionsPerSecond: round(latency.actToAck.count / seconds, 1),
    patchesPerSecond: round((latency.actToPatch.count + latency.fanout.count) / seconds, 1),
    handsPerSecond: round(counters.hands / (seconds + config.warmup), 2),
    messagesPerSecond: round(counters.messages / (seconds + config.warmup), 0),
    mbPerSecond: round(counters.bytes / 2 ** 20 / (seconds + config.warmup), 2),
  };
  // Whole-machine CPU over the window, in % of one core, and how much of it was not this
  // test: other work on the machine skews latency, so it is reported with the results.
  const machineBusy =
    machineStart && machineEnd
      ? round(
          ((machineEnd.busy - machineStart.busy) / (machineEnd.total - machineStart.total)) *
            100 *
            cpus().length,
          1,
        )
      : null;
  const ownCpu = serverStats.cpuPercent + generators.reduce((sum, g) => sum + g.cpuPercent, 0);
  const machineLoad = {
    busyPercent: machineBusy,
    testPercent: round(ownCpu, 1),
    otherPercent: machineBusy === null ? null : round(Math.max(0, machineBusy - ownCpu), 1),
  };
  const verdict = latency.actToPatch.p95 < TARGET_P95_MS ? 'PASS' : 'FAIL';

  console.log('');
  console.log(
    `Latency (ms), measured window ${seconds.toFixed(1)} s, client side, ${String(sockets)} sockets`,
  );
  console.table([
    row('act -> own patch', latency.actToPatch),
    row('act -> ack', latency.actToAck),
    row('act -> other seat patch', latency.fanout),
    row('act -> last seat patch', latency.fanoutAll),
  ]);
  console.log('Throughput (measured window; messages and MB/s over warm-up plus window)');
  console.table([throughput]);
  console.log('Processes (measured window; CPU is % of one core, loop delay in ms)');
  console.table([
    {
      process: 'server',
      'cpu %': serverStats.cpuPercent,
      'rss MB': serverStats.rssMb,
      'rss max MB': serverStats.rssMaxMb,
      'loop p50': serverStats.loop.p50,
      'loop p99': serverStats.loop.p99,
      'loop max': serverStats.loop.max,
    },
    ...generators.map((g, i) => ({
      process: `generator ${String(i)}`,
      'cpu %': g.cpuPercent,
      'rss MB': g.rssMb,
      'rss max MB': '-',
      'loop p50': g.loop.p50,
      'loop p99': g.loop.p99,
      'loop max': g.loop.max,
    })),
  ]);
  if (machineLoad.busyPercent !== null) {
    console.log(
      `Machine CPU in the window: ${machineLoad.busyPercent.toFixed(0)}% of one core busy (${String(cpus().length)} cores), this test ${machineLoad.testPercent.toFixed(0)}%, other work ${String(machineLoad.otherPercent)}%`,
    );
  }
  const { gc } = serverStats;
  console.log(
    `Server GC in the window: ${String(gc.count)} pauses, ${gc.totalMs.toFixed(0)} ms in total, longest ${gc.maxMs.toFixed(1)} ms; ${String(gc.major)} major (longest ${gc.majorMaxMs.toFixed(1)} ms)`,
  );
  console.log('Setup (ms)');
  console.table([
    row('socket connect + hello', setup.connect),
    row('table create + join + sit', setup.table),
  ]);
  console.log('Errors and anomalies (whole run after setup)');
  console.table([
    {
      nacks: JSON.stringify(counters.nacks),
      closes: counters.closes,
      'socket errors': counters.socketErrors,
      'turn timeouts': counters.turnTimeouts,
      'resync snapshots': counters.snapshots,
      'ack before patch': counters.ackBeforePatch,
      'fan-out incomplete': counters.fanoutIncomplete,
      'setup errors': setup.errors.length,
    },
  ]);
  console.log(
    `${verdict}: p95 act -> own patch ${latency.actToPatch.p95.toFixed(2)} ms (target < ${String(TARGET_P95_MS)} ms)`,
  );

  const file = join(
    config.out,
    `load-${String(config.tables)}t-${String(config.players)}p-${config.store}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  writeFileSync(
    file,
    JSON.stringify(
      {
        config,
        machine,
        setup,
        latency,
        throughput,
        server: serverStats,
        generators,
        machineLoad,
        counters,
        verdict,
        targetP95Ms: TARGET_P95_MS,
      },
      null,
      2,
    ),
  );
  console.log(`Results written to ${file}`);

  for (const child of children) child.kill();
  // Exit without a graceful close: closing 5,000 sockets one by one is not under test.
  process.exit(verdict === 'PASS' && setup.errors.length === 0 ? 0 : 1);
}

if (process.env['SHOEHIVE_LOAD_ROLE'] === 'generator') {
  process.on('disconnect', () => process.exit(0));
  await runGenerator();
} else {
  await main();
}
