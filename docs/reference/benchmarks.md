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

## Load test

This is the Phase 8 load test from RFC 0001 section 12: 1,000 tables and 5,000 sockets on one
node, with a p95 action-to-patch latency under 20 ms locally. Unlike the engine benchmark above, it
runs the whole stack: JSON, WebSocket frames, the per-table queue, the store, fan-out to every seat
and the client applying the patch.

### Setup

- **Server:** one process running a real `createServer` over WebSockets (`listen()`) with
  production settings: `dev: false`, a fixed secret, `silentLogger`, a `MemoryWallet`, devtools
  off, and the memory store (or SQLite, see below). Default limits are kept: one player sends about
  0.2 messages per second, far below 20 per second with a burst of 40, and no connection came near
  `maxBufferedBytes`.
- **Game:** the Texas Hold'em example (`examples/holdem`), 5 seated players per table, so 5,000
  sockets. It has hidden information (every seat gets its own view with its own hole cards), turns,
  a turn timer, side pots and wallet buy-ins. Buy-ins are 1,000,000 chips from a wallet with room
  for all of them, so nobody busts, and the 30 s turn timer is never reached by a seat that plays.
- **Load generators:** 3 child processes (CPUs minus one). Each opens real `ws` sockets that speak
  protocol v1 through `shoehive/client` (`createClient` with the `ws` WebSocket), creates its
  tables, joins and sits. All seats of a table live in the same generator, so the acting client and
  the other seats share one clock.
- **Play:** when it is a seat's turn, it acts, pacing each table to at most one action per second
  (`--rate`). The policy mostly checks and calls, with some bets, raises and folds. Folds, and the
  game's fixed 5 s pause after each hand, mean that 1 action per second per table gives about 845
  actions per second in total.
- **Measured:** after a 10 s warm-up, for 60 s. On the acting client, from sending `act` to applying
  the `table.patch` whose `rev` includes that action, and to its ack (the ack must never arrive
  before the patch; it never did). For the 4 other seats, from the same `act` to their patch
  (fan-out), and to the last seat's patch. Also server CPU, RSS, event-loop delay
  (`monitorEventLoopDelay`, 1 ms resolution, the resolution subtracted) and GC pauses, generator
  CPU and loop delay, whole-machine CPU (to spot other work on the machine), socket connect time,
  and every nack, close, resync snapshot and turn timeout.

### Machine

4 vCPU Intel Xeon @ 2.10 GHz in a shared cloud VM (Firecracker), 15.7 GB RAM, Linux 6.18, Node
22.23.4, open-file limit 20,000. The test needs about one file descriptor per socket in the server
and one in a generator (5,256 per process at full scale). Node cannot call `setrlimit`, so when the
soft limit is too low but the hard limit allows it, the test runs itself again under `ulimit -n`;
otherwise it stops and says which limit to raise.

### Running it

```sh
pnpm --filter shoehive bench:load                          # 1,000 tables, 5 players, memory store
pnpm --filter shoehive bench:load -- --tables 100          # small run
pnpm --filter shoehive bench:load -- --store sqlite        # also: sqlite-normal
pnpm --filter shoehive bench:load -- --help                # all flags and defaults
```

Flags: `--tables`, `--players` (2 to 9), `--rate` (actions per second per table), `--warmup` and
`--duration` (seconds), `--store` (`memory`, `sqlite`, `sqlite-normal`), `--generators`,
`--concurrency` (tables each generator sets up at once), `--turn-ms`, `--out` (default
`packages/shoehive/bench/.out/load`) and `--profile` (writes a `.cpuprofile` of the server for the
measured window only). The script bundles `packages/shoehive/bench/load.ts` with esbuild, prints the
tables below, writes all figures as JSON to the `--out` directory, and exits non-zero if the p95
reaches 20 ms or a table could not be set up.

### Results

Latency is measured on the client, in ms. Fan-out is the act to the last seat's patch. CPU is a
percentage of one core. Loop is the server's event-loop delay p99.

| Scenario                      | Actions/s | p50  | p95  | p99   | max   | Fan-out p95 | Server CPU | Server RSS | Loop p99 | Verdict |
| ----------------------------- | --------- | ---- | ---- | ----- | ----- | ----------- | ---------- | ---------- | -------- | ------- |
| 100 tables, memory            | 84        | 0.88 | 2.03 | 4.19  | 14.7  | 2.24        | 11%        | 148 MB     | 1.4      | pass    |
| 1,000 tables, memory          | 846       | 1.11 | 5.92 | 13.9  | 70.6  | 6.06        | 67%        | 554 MB     | 4.2      | pass    |
| 1,000 tables, `sqlite-normal` | 843       | 1.54 | 9.61 | 21.7  | 121   | 9.72        | 70%        | 446 MB     | 5.1      | pass    |
| 1,000 tables, `sqlite` (FULL) | 845       | 2.58 | 9.16 | 25.1  | 101   | 9.27        | 71%        | 457 MB     | 6.1      | pass    |
| Same, before group commit     | 798       | 662  | 992  | 1,174 | 1,967 | 992         | 78%        | 447 MB     | 2,549    | fail    |
| 1,000 tables, memory, rate 2  | 1,422     | 7.06 | 98.5 | 159   | 199   | 98.6        | 101%       | 615 MB     | 31.3     | fail    |

In every scenario: 0 closes, 0 socket errors, 0 resync snapshots, 0 acks before their patch, 0
setup errors, and at most 4 `ACTION_NOT_ALLOWED` nacks (an action racing a phase change). The 7 to
16 turn timeouts per run come from setup: hands start as soon as two seats are filled, and a hand
whose turn began while later tables were still being set up can time out in the first second of
play.

At full scale, 5,000 sockets connect in about 40 s (`--concurrency 20` per generator). A socket's
connect plus `hello` takes p50 2.1 s and p95 4.4 s, because connections queue behind the table
setups running at the same time. One table's create, 5 joins and 5 seats take p50 81 ms. The server
had about 1,030 GC pauses in the 60 s window (2.9 s in total, the longest 11 ms, 5 major ones).
Each generator used about 15% of a core with a loop p99 near 1 ms, so the generators were not the
bottleneck.

**Run-to-run variance.** Seven full-scale memory runs at rate 1 gave a p95 of 5.9, 6.0, 6.1, 6.5
(whole-process `--cpu-prof`), 17.3, 17.9 (window `--profile`) and 25.6 ms. The VM is shared with
other sessions: between two runs, with nothing of this test running, it was 46 to 52% busy. The
whole-machine CPU figure was added after the slow runs; in the two runs that have it (5.9 and
6.0 ms), other work used 3% and 0% of a core. The table above shows the last of them.

### Verdict

**Pass on a quiet machine:** 1,000 tables and 5,000 sockets on one node, p95 action-to-patch
5.9 ms, about 3.4 times under the 20 ms target, with fan-out to every seat within 0.2 ms of the
acting client. Three runs that did not record whole-machine CPU reached 17 to 26 ms, one of them
over the target. Outside load on the shared VM is the likely cause, but those runs cannot show it,
so the margin should be checked again on dedicated hardware. The SQLite adapter also meets it in its
fully durable mode, p95 9.2 ms, since it commits each event-loop turn's writes together (below).

### Bottleneck found and fixed

The first full-scale run never got past setup: after 7 minutes only 468 of the 1,000 tables
existed. At 300 tables (1,500 sockets) the server was saturated, at 45 actions per second with a p95
of 8.7 s. The server CPU profile showed why (share of server CPU time):

| Function (`src/server/server.ts`) | Inclusive | Self  |
| --------------------------------- | --------- | ----- |
| `syncLobby`                       | 82.0%     | 44.8% |
| `buildLobby`                      | 33.3%     | 0.1%  |
| `spectatorCount`                  | 33.1%     | 30.6% |
| `syncTable`                       | 5.2%      | 1.8%  |

Every commit called `syncLobby`, which rebuilt the whole lobby. That counted the spectators of
every table by scanning every connection, so each commit cost tables times connections (5 million
steps at full scale). `syncTable`, the event fan-out and `isIdle` also scanned every connection on
every commit.

The fix is in `src/server/server.ts`:

1. A per-table index of joined connections (`viewers`), kept in step with each connection's
   `tables` map in `joinTable`, `leaveTable` and `closeTable`. Patches, events, spectator counts,
   idle checks, `tables.get().connected`, devtools and `tables.reload` use it instead of scanning
   every connection.
2. `syncLobby(committed)`: a commit can only change its own table's lobby entry, so when that entry
   is unchanged (almost every game action) the full rebuild is skipped. Joins, leaves, creates and
   closes still rebuild in full, so the lobby is always what a full rebuild would give.

`packages/shoehive/test/server/fanout.test.ts` covers both: patches and events reach only a table's
own connections, spectator counts and `connected` follow joins and closes, and the lobby matches a
fresh subscriber's snapshot while game moves send no lobby patches. At 100 tables the same load
went from 28% to 11% of a core.

What is left during play at full scale, with the server 35% idle: socket writes (`writev`, about
15%, one syscall per message), JSON Patch diffs (14%), action processing in the engine (about 7%)
and GC (7%). None stands out. The ceiling is the single server thread: at 2 actions per second per
table (1,422 actions/s) it ran at 101% of a core and the p95 rose to 98 ms. One node of this
size handles about 1,000 to 1,200 Hold'em actions per second within the target.

### SQLite

With `--store sqlite` the adapter opens the file itself in WAL mode with `synchronous = FULL`, so
every acknowledged action is on disk (ADR 0009). better-sqlite3 is synchronous, so each fsync blocks
the event loop.

**Before group commit**, every write was its own transaction and its own fsync: about 800 log
appends and up to about 190 snapshots (one per phase change) per second. The loop waited on the
disk more than it ran: the server used only 78% of a core, but its loop p50 was 672 ms and the p95
was 992 ms. At 300 tables FULL mode passed (p95 4.3 ms), and `synchronous = NORMAL` passed at 1,000
tables with a p95 of 15.9 ms.

**With group commit** (`src/store/sqlite.ts`), writes made in the same turn of the event loop are
queued and committed in one transaction, so one fsync covers every table that acted in that turn.
The fsync still blocks the loop, but the messages that arrive while it does are read in the next
turn and committed together, so the number of commits per second falls as the load rises instead
of growing with it. Each write still resolves only after the commit that holds it, so an ack still
means durable. At 1,000 tables FULL mode now passes with a p95 of 9.16 ms and a loop p50 of
0.45 ms (other work on the machine: 9% of a core), and `sqlite-normal` (safe across a process
crash, but a power loss may lose the last transactions) gives 9.61 ms, the same within run-to-run
variance. Each appended table still runs in its own savepoint, so one table's `StoreConflictError`
does not fail the others in its group (`test/store/sqlite.test.ts`, "group commit").

### Limits

- One node, one Node.js process: the server's game logic, JSON and socket writes share one thread.
  Multi-node table routing comes after 1.0 (RFC 0001 section 13).
- The load generators run on the same 4-vCPU VM as the server (about 45% of a core in total), and
  loopback networking has no real latency, loss or TLS. Real players add their network round trip.
- Only one game (Hold'em, 5 seats) and no lobby subscribers or spectators were measured. A lobby
  subscriber still gets a full lobby rebuild on every join, leave, create and close, which is linear
  in the number of tables.
- Results on a shared cloud VM vary with other load on the host (see "Run-to-run variance").
