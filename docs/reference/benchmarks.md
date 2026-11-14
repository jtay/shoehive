# Engine benchmarks

This is the benchmark gate from ADR 0005 (point 7). The RFC 0001 target for Phase 8 is a p95
action-to-patch latency under 20 ms on one node.

## What is measured

The table is a 9-seat Hold'em-style betting game (`packages/shoehive/bench/holdem.ts`). Each seat
has hidden hole cards, and the game has community cards, a pot, bets, a turns phase and a turn timer.
One unit of work is:

1. one committed betting action: queue, validation, Mutative draft, commit, log append and timer sync
2. 10 views: 9 seats plus the shared spectator view, each computed by the game's `view()`
3. 10 diffs: each new view against that viewer's previous one, giving the JSON Patch that would be sent

It does not include JSON serialisation or socket writes. Those arrive in Phase 2, and the Phase 8
load test covers them.

## Results

Node 22.23, Linux x64 cloud container, 5 000 iterations after 500 warm-up iterations, times in ms.

| Mode                      | p50   | p95   | p99   | act avg | views avg | diffs avg | patch ops per step |
| ------------------------- | ----- | ----- | ----- | ------- | --------- | --------- | ------------------ |
| production (`dev: false`) | 0.106 | 0.239 | 1.191 | 0.039   | 0.015     | 0.094     | 39.4               |
| dev (checks on)           | 0.224 | 0.456 | 1.155 | 0.063   | 0.127     | 0.090     | 39.4               |

**Verdict:** the production p95 is 0.24 ms, about 80 times under the 20 ms target. Mutative is not the
bottleneck, so per ADR 0005 no further tuning is done. The dev-mode overhead (frozen state, JSON
checks and the nondeterminism guard) is roughly 2 times, which is fine for development and tests.

## Running it

```sh
pnpm bench
```

This bundles `packages/shoehive/bench/latency.ts` with esbuild and runs it. It exits non-zero if the
production p95 reaches 20 ms.
