# ADR 0001: Games as typed deterministic state machines

|         |                                                                         |
| ------- | ----------------------------------------------------------------------- |
| Status  | Accepted, 2026-11-14                                                    |
| Related | RFC 0001 sections 1, 4, 5.1, 5.1a, 7; ADRs 0003, 0004, 0005, 0006, 0008 |

## Context

In 0.x there is no game abstraction (audit finding 1). Game logic lives in global
event bus listeners that filter by `tableId` by hand, state is untyped attribute bags
(finding 2), and sync and hidden information are bolted on afterwards (findings 3, 4).
Every author re-implements turns, validation and rollback. The tic-tac-toe guide needs
882 lines of command handlers.

RFC 0001 fixes the mental model: a game is a typed, deterministic state machine, and
Shoehive hosts it. This ADR fixes the shape of that machine.

## Decision

A game is a plain object returned by `defineGame`. It contains data and pure functions
and performs no I/O. One generic parameter (the definition itself) drives all inference,
from `run` input types to the client's `table.view` type.

```ts
interface GameDefinition<S, O, V> {
  id: string; // stable, used in protocol and store
  name?: string;
  version?: number; // integer, default 1 (see ADR 0009)
  seats: { min: number; max: number; perPlayer?: number }; // perPlayer defaults to 1
  autoStart?: boolean; // default true: start when `min` seats are occupied
  options?: StandardSchemaV1<unknown, O>; // ADR 0004
  setup(args: { options: O; random: Random }): S; // runs once at table creation
  actions?: Record<string, ActionDef<S, any>>; // available in every phase
  phases?: Record<string, PhaseDef<S>>; // first declared phase is initial
  turns?: TurnsConfig;
  rounds?: RoundsConfig; // ADR 0008, only when no phases
  view?(args: { state: Readonly<S>; viewer: Viewer; ctx: ViewCtx }): V;
  onSit?: Hook<S>;
  onStand?: Hook<S>;
  onDisconnect?: Hook<S>;
  onReconnect?: Hook<S>;
  onStart?: Hook<S>;
  onEnd?: Hook<S>;
  migrate?: Migrate<S>; // ADR 0009
}

interface ActionDef<S, I> {
  input?: StandardSchemaV1<unknown, I>; // omitted means "no input"
  internal?: boolean; // only timers and the engine may call it; clients get ACTION_NOT_ALLOWED
  once?: boolean; // rounds only, ADR 0008
  preStart?: boolean; // may run before the table has started (e.g. 'ready')
  run(args: {
    state: S;
    seat: number; // -1 for internal actions run by a timer
    player: string | null; // null for internal actions
    input: I; // the schema output; `unknown` (and undefined at runtime) without a schema
    ctx: ActionCtx;
  }): void | Json | Promise<void | Json>;
}

interface PhaseDef<S> {
  actions?: Record<string, ActionDef<S, any>>; // whitelist for this phase
  turns?: TurnsConfig;
  rounds?: RoundsConfig; // at most one of the two
  onEnter?: Hook<S>;
  onExit?: Hook<S>;
}
```

Rules the engine enforces:

1. **Only three things change state**: actions, lifecycle hooks and timer firings. All
   of them run one at a time through the table's serial queue (`TableRuntime`).
2. **An entry is a transaction.** Each queue entry runs against a draft (ADR 0005). It
   either commits completely or is discarded. Engine bookkeeping (phase, turn, round,
   timers, RNG cursor, pending `ctx.emit` events and wallet operations) lives in the
   same transaction, so `ctx.phase.go()` in a failed action never happens.
3. **Action lookup order**: the current phase's `actions`, then top-level `actions`. A
   name found in neither, or a phase-scoped name used in the wrong phase, is
   `ACTION_NOT_ALLOWED` with `details.phase` set to the current phase. The current phase
   is already public in `meta.phase`, so this leaks nothing.
4. **Before start**, only `preStart` actions and `onSit` / `onStand` run. Other actions
   reject with `NOT_STARTED`. With `autoStart: false`, the table starts when a
   `preStart` action calls `ctx.start()` or an operator calls `shoehive.tables.start(id)`.
5. **After `ctx.end(result)`**, `onEnd` runs in the same entry, and every later action
   rejects with `TABLE_ENDED`.
6. **`reject(code, details?)`** throws a typed rejection. Any other thrown error becomes
   `INTERNAL` on the client (details are logged, never sent). Both roll back.
7. **Return values**: a JSON value returned from `run` is sent as `ack.result`.
8. **Ephemeral events** from `ctx.emit(name, payload, { to })` are queued in the
   transaction and sent only after commit, after that commit's patches. `to` is
   `'all'`, `'spectators'` or an array of seats. They are not state and are not replayed.
9. **Async**: `run` may be async so it can await `ctx.wallet` (ADR 0007). The queue
   awaits it; no other entry for that table runs meanwhile. Awaiting anything other than
   `ctx` methods breaks determinism and is documented as unsupported.
10. **Determinism**: game code reads time only from `ctx.now()` and randomness only from
    `ctx.random` (ADR 0006).

`ctx` is the only engine handle inside game code:
`ctx.turn`, `ctx.round`, `ctx.phase`, `ctx.timers`, `ctx.random`, `ctx.now()`,
`ctx.emit`, `ctx.wallet`, `ctx.seats` (read-only occupancy), `ctx.start()`, `ctx.end()`.

## Consequences

### Positive

- Tic-tac-toe fits in about 40 lines (RFC 0001 section 5.1), with types inferred end to end.
- Rollback, replay, persistence and time travel all fall out of "entries are
  transactions over plain data". One mechanism, used four ways.
- Games are testable without sockets: `shoehive/testing` drives the same `TableRuntime`.
- No global bus, so many tables share a process with no listener leaks (finding 5).

### Negative

- Authors must learn the rules above, especially "no I/O, no `Math.random`, no
  `Date.now`". We mitigate with lint config, dev guards (ADR 0006) and docs.
- Async actions hold the table's queue. A slow wallet slows that table (ADR 0007 sets
  a timeout).
- A serial queue per table caps throughput per table. Table games are small, so we
  accept this; the RFC 0001 section 13 benchmark checks it.

## Alternatives considered

### Keep the 0.x global event bus with attribute bags

Rejected. It is the root cause of findings 1 to 6: no types, no atomicity, implicit
and lossy sync, and listener leaks. Nothing in it is worth keeping beyond vocabulary.

### boardgame.io-style moves

`moves: { place: (G, ctx, cell) => ... }` with a mandatory turn model and `playerView`.
We borrow phases and the view idea. We rejected adopting its model because move
arguments are positional and unvalidated (no schemas), simultaneous play needs
"stages" layered on a turn model that is always present, and it has no seats, wallet,
lobby or reconnect story of the shape we need. Named actions with schemas give better
errors and better client types.

### Colyseus-style mutable room classes

A `Room` subclass with `onMessage` handlers mutating a schema-decorated state. Rejected:
mutations apply immediately with no rollback, there is no recorded RNG or clock so no
exact replay, hidden information is per-field filtering on the schema rather than a
function of state, and client types need codegen. Class inheritance also hides control
flow that a plain definition object keeps visible.

## Open questions

- Should actions get an engine-enforced `whenTurn: true` flag (rejecting with
  `NOT_YOUR_TURN`) instead of the explicit check in RFC 0001 section 5.1? v1 keeps the explicit
  check; we revisit after the four examples are written.
