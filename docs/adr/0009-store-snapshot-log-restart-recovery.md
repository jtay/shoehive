# ADR 0009: Store interface, snapshot plus log, and restart recovery

|         |                                                                                              |
| ------- | -------------------------------------------------------------------------------------------- |
| Status  | Accepted, 2026-11-14                                                                         |
| Related | RFC 0001 sections 7 (Persistence), 8, 11 (Runtime, Storage), 13; ADRs 0005, 0006, 0007, 0010 |

## Context

The stakeholder requires that tables survive a restart of the single Node process
(RFC 0001 section 11). RFC 0001 fixes the approach: per-table snapshot plus action log, four adapters
(memory, SQLite, Postgres, Redis), and a conformance suite. Because replay is exact
(ADR 0006), recovery can be "load snapshot, replay tail". This ADR fixes the interface,
the write path, the snapshot cadence and what happens when game code changes between
snapshot and restart.

## Decision

### Interface

Stores are thin and game-agnostic: they store opaque JSON strings and append-only logs.
They never parse game state and never run game-aware queries.

```ts
interface Store {
  appendLog(tableId: string, entries: StoredEntry[]): Promise<void>; // in seq order
  saveSnapshot(tableId: string, snapshot: StoredSnapshot): Promise<void>; // replaces previous
  loadTable(tableId: string): Promise<{ snapshot: StoredSnapshot; tail: StoredEntry[] } | null>;
  readLog(tableId: string, fromSeq: number, toSeq?: number): Promise<StoredEntry[]>; // devtools
  listOpenTables(): Promise<string[]>;
  closeTable(tableId: string, reason: string): Promise<void>; // no longer "open"
  sessions: {
    get(playerId: string): Promise<SessionRecord | null>;
    put(record: SessionRecord): Promise<void>;
    delete(playerId: string): Promise<void>;
  };
  close(): Promise<void>;
}

interface StoredEntry {
  seq: number;
  data: string;
} // JSON of a LogEntry (ADR 0006)
interface StoredSnapshot {
  seq: number;
  rev: number;
  game: string;
  version: number;
  data: string;
}
interface SessionRecord {
  playerId: string;
  name: string;
  metadata: Json;
  updatedAt: number;
}
```

The snapshot `data` holds committed state, engine state (phase, turn, round, timers
with absolute deadlines, RNG cursor, outstanding wallet ops), seats with their
player ids, and `rev`. It never holds views; those are recomputed. Table creation
writes the `create` entry and an initial snapshot at `seq: 0`.

`appendLog` must reject an entry whose `seq` is not exactly one more than the last
stored `seq` for that table (`StoreConflictError`). This catches double writers.

### Write path

1. The engine commits the entry in memory.
2. It awaits `store.appendLog` for that entry.
3. Only then does it send patches, events and the ack (ADR 0003 ordering), and the
   deferred wallet ops (ADR 0007). **An ack means durable.**

If `appendLog` fails, the table is put in a `faulted` state: the in-memory commit is
discarded, the action acks `INTERNAL`, and further actions reject with
`TABLE_UNAVAILABLE` until the operator calls `shoehive.tables.reload(id)`, which reloads
from the store. The memory store is synchronous in practice, so the default costs
nothing. Postgres and SQLite add one insert per action, which we expect to fit the 20 ms
budget; the Phase 8 load test checks it.

### Snapshot cadence

A snapshot is written after the entry that triggers it, asynchronously (it does not
delay the ack):

- every 100 log entries (`snapshotEvery`, configurable),
- on every phase change,
- when the table ends,
- on graceful shutdown (`shoehive.close()` drains queues, then snapshots every table).

The full log is kept for open tables by default (`retainLog: 'full'`), because devtools
replay needs it. `retainLog: 'since-snapshot'` lets adapters prune entries at or before
the latest snapshot. Closed tables are kept; retention of closed tables is left to the
integrator in v1.

### Recovery

On `listen()` or `attach()`, before accepting connections:

1. `listOpenTables()`, then `loadTable()` for each.
2. Check the game id is registered and the version matches (below).
3. Restore from the snapshot and replay the tail through the same `replay()` used by
   tests (ADR 0006). Wallets, validators and transports are not called.
4. Re-arm timers from recorded deadlines. Deadlines already past fire immediately, in
   deadline order, as normal `timer` entries.
5. Mark every seated player disconnected and start a fresh reconnect grace period
   from now (ADR 0010). Players resuming within it land back in their seats.
6. Re-send unconfirmed deferred wallet ops (ADR 0007).

A table that fails any step is not opened. It is reported through the operator event
`table:recovery-failed { tableId, reason }` and logged; other tables continue.

### Game definition versions

`defineGame({ version })` is a positive integer, default 1. Authors bump it whenever a
change could make an old log replay differently. Snapshots and the `create` entry
record it.

- **Same version**: replay normally. If replay diverges anyway (draw mismatch, or an
  entry that committed live now rejects), recovery fails with reason `REPLAY_DIVERGED`.
- **Different version, empty tail**: call `migrate({ from, state, engine })`, which
  returns the new state (and may adjust phase). No `migrate` means `VERSION_MISMATCH`.
- **Different version, non-empty tail**: refuse with `VERSION_MISMATCH`. Old entries
  cannot be replayed exactly under new code, and we will not guess.

Because graceful shutdown always writes a final snapshot, a normal deploy produces an
empty tail and only needs `migrate`. Only a crash followed by a version bump loses
tables, and it does so loudly.

### Adapters and conformance

| Adapter    | Storage                    | Notes                                                                         |
| ---------- | -------------------------- | ----------------------------------------------------------------------------- |
| `memory`   | `Map`                      | default; lost on exit, used by the Phase 2 kill-and-restart test in-process   |
| `sqlite`   | `better-sqlite3`, WAL mode | tables `entries`, `snapshots`, `sessions`, `open_tables`                      |
| `postgres` | `pg`                       | same schema, `migrate()` helper creates it                                    |
| `redis`    | `ioredis`                  | list per table log, string per snapshot, set of open tables; docs require AOF |

`shoehive/testing` exports `runStoreConformance(createStore, { describe, it, expect })`.
It takes the test functions as arguments so it has no test-runner dependency. It covers
ordering, `seq` conflicts, snapshot replacement, tail loading, open-table listing,
sessions, large payloads (1 MiB) and concurrent tables. CI runs it on all four adapters.

## Consequences

### Positive

- Restart recovery is the replay path, so property tests on replay cover it (RFC 0001 section 13).
- Adapters are small (about 150 lines each) and easy for integrators to write.
- "Ack means durable" gives players a simple guarantee.

### Negative

- One store write per action adds latency, and a store outage halts affected tables.
- Full log retention grows storage for long-running tables.
- Crash plus version bump loses those tables. We accept it over silently wrong replays.

## Alternatives considered

### Snapshot only (no log)

Simpler. Rejected: it loses every action since the last snapshot and gives devtools
nothing to replay.

### Log only (no snapshots)

Rejected: recovery time grows without bound for long tables.

### Game-aware schemas (columns per state field)

Rejected: every game would need migrations, and adapters would stop being thin.

### Replay old logs with old code bundles

Load the previous game version side by side. Rejected for v1: it needs a module
registry of past versions. Revisit after 1.0 if `VERSION_MISMATCH` hurts in practice.
