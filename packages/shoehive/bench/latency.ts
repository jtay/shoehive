// Latency percentiles for one unit of work: a committed Hold'em betting action, then
// 9 seat views plus the spectator view, each diffed against its previous view.
// RFC 0001 Phase 8 target: p95 action-to-patch under 20 ms. Run with `pnpm bench`.

import { createHarness } from './holdem';

const WARMUP = 500;
const ITERATIONS = 5000;

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

async function measure(dev: boolean) {
  const harness = await createHarness({ dev });
  for (let i = 0; i < WARMUP; i++) await harness.step();
  const total: number[] = [];
  const parts = { act: 0, views: 0, diffs: 0, ops: 0 };
  for (let i = 0; i < ITERATIONS; i++) {
    const t = await harness.stepTimed();
    total.push(t.act + t.views + t.diffs);
    parts.act += t.act;
    parts.views += t.views;
    parts.diffs += t.diffs;
    parts.ops += t.ops;
  }
  total.sort((a, b) => a - b);
  const fmt = (n: number) => n.toFixed(3);
  return {
    mode: dev ? 'dev (checks on)' : 'production',
    p50: fmt(percentile(total, 50)),
    p95: fmt(percentile(total, 95)),
    p99: fmt(percentile(total, 99)),
    'act avg': fmt(parts.act / ITERATIONS),
    'views avg': fmt(parts.views / ITERATIONS),
    'diffs avg': fmt(parts.diffs / ITERATIONS),
    'ops/step': (parts.ops / ITERATIONS).toFixed(1),
  };
}

const rows = [await measure(false), await measure(true)];
console.log(
  `Node ${process.version}, ${String(ITERATIONS)} iterations after ${String(WARMUP)} warm-up (ms)`,
);
console.table(rows);
const p95 = Number(rows[0]!.p95);
console.log(
  p95 < 20
    ? `PASS: production p95 ${String(p95)} ms < 20 ms`
    : `FAIL: production p95 ${String(p95)} ms >= 20 ms`,
);
if (p95 >= 20) process.exitCode = 1;
