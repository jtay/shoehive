# RFC 0001: Shoehive v1, a ground-up rebuild

|          |                                                                                          |
| -------- | ---------------------------------------------------------------------------------------- |
| Status   | Accepted direction; stakeholder decisions recorded in section 11 (interview, 2026-11-14) |
| Replaces | shoehive 0.10.0 and shoehive-react-client 0.2.1                                          |
| Target   | shoehive 1.0.0                                                                           |
| Date     | 2026-11-14                                                                               |

Nobody depends on 0.x, so v1 is a clean break. We keep no code and no wire compatibility. We keep the name, the table-and-seat vocabulary, and the lessons below.

**Who v1 is for:** open-source developers adopting Shoehive for their own games. Docs, DX and API stability outrank any single product's needs.

---

## 1. Summary

Shoehive 0.x is a set of mutable objects (Player, Table, Seat, Hand, Lobby) talking over one global, stringly-typed event bus. Game authors write their game as loose bus listeners and command handlers. They have to re-implement turns, validation, hidden information and state syncing by hand, and sync is decided by hard-coded attribute lists. The docs describe three different API generations. The React client cannot build, and if it did it would send empty messages.

Shoehive v1 flips the model:

> **A game is a typed, deterministic state machine. Shoehive hosts it: lobby, tables, seats, sessions, sync, hidden information, timers and testing.**

The author writes `defineGame({ setup, actions, view })`. Shoehive does the rest, with end-to-end types from the game definition to the React hook.

---

## 2. Audit of 0.x

Severity: **C** = correctness or security bug, **D** = design flaw, **X** = DX or presentation problem.

### 2.1 Core concept

| #   | Sev | Finding                                                                                                                                                                                                                                                                                                                                                                       | Where                                                                |
| --- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | D   | **There is no game abstraction.** `GameDefinition` is lobby metadata. The only lifecycle hook (`setupTable`) is hidden inside `options`, and `options` is also sent to every client in the lobby state. All real game logic lives in global bus listeners that filter by `tableId` by hand. The tic-tac-toe guide needs 882 lines for command handlers, which shows the cost. | `src/core/GameManager.ts:6`, `src/core/Lobby.ts:122-130`             |
| 2   | D   | **State is untyped attribute bags.** Player, Table, Seat, Hand and Lobby each hold a `Map<string, unknown>`. The author's own state has no types, no schema and no invariants.                                                                                                                                                                                                | `Table.ts`, `Player.ts`, `Seat.ts`, `Lobby.ts`                       |
| 3   | C   | **Sync is implicit and lossy.** Broadcasts only fire when a changed key appears in a hard-coded default list (`status`, `turn`, `pot`, `board`, `phase`, `winner` / `name`, `chips`, `isReady`...). Change any other key and clients silently go stale.                                                                                                                       | `WebSocketManager.ts:442`, `:553`, `:608`                            |
| 4   | C   | **Hidden information is limited to card `isVisible`.** All player attributes go to everyone at the table. Seat attributes never sync at all. There is no per-viewer projection, so a poker game cannot keep a private balance, role or note secret.                                                                                                                           | `Table.ts` `getTableState`                                           |
| 5   | D   | **One global EventBus is the integration surface.** Payload types exist but `on<T>` ignores them. Documented payloads differ from emitted ones (`LOBBY_EVENTS.UPDATED` documents `{ lobby }`, emits `{ lobbyState }`). Every table adds 2 listeners to global sit/stand events, and `setMaxListeners(100)` starts leak warnings at about 50 tables.                           | `EventBus.ts:46`, `LobbyEvents.ts`, `Table.ts` `setupEventListeners` |
| 6   | C   | **Two command pipelines overwrite each other.** `createGameServer` registers handlers for actions `MessageRouter` already registered. The later `Map.set` wins silently, and the two versions behave differently: one reports errors to the client, the other logs to the console and returns.                                                                                | `src/index.ts:112-210`, `MessageRouter.ts:19-23`                     |
| 7   | D   | **Casino concerns are baked into core.** Cards and decks sit in `core/`. The only "transport" module is a betting API (`createBet`, `markBetWon`) with no idempotency or reservation semantics.                                                                                                                                                                               | `core/card/*`, `transport/ServerTransportModule.ts`                  |
| 8   | C   | **Shuffling uses `Math.random`.** It is not seedable (so no replay or test) and not cryptographically strong (unacceptable for anything with stakes).                                                                                                                                                                                                                         | `core/card/Deck.ts:54`                                               |

### 2.2 Connections, protocol and security

| #   | Sev | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Where                                                     |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| 9   | C   | **Reconnection is broken.** Without an `AuthModule` every socket gets a random id, so nobody can ever reconnect. With one, `existingPlayer.disconnect()` closes the old socket _after_ rebinding. Its `close` event then re-runs the disconnect callbacks and schedules permanent removal of the player who just reconnected. Callbacks also pile up on each reconnect. `RECONNECTED` emits `{ existingPlayer }`, not `{ player }`. `getDisconnectedPlayers` reads `disconnectedAt`, which nothing ever sets. | `WebSocketManager.ts:640-700`, `:780-810`                 |
| 10  | C   | **There is no wire protocol.** No version, no request ids or acks, free-text error strings, no schemas for inputs. Unknown actions are re-emitted on the server bus as `client:*` events carrying the raw message.                                                                                                                                                                                                                                                                                            | `MessageRouter.ts:262-297`                                |
| 11  | C   | **No basic hardening.** No payload size cap, no rate limit, no heartbeat, no origin check, no input validation (`seatIndex as number`).                                                                                                                                                                                                                                                                                                                                                                       | `WebSocketManager.ts`, `MessageRouter.ts`                 |
| 12  | D   | **Every change sends the full table state** to every player and the full lobby to every connected player. There is no diffing, batching or subscription.                                                                                                                                                                                                                                                                                                                                                      | `Table.broadcastTableState`, `Lobby.broadcastLobbyUpdate` |
| 13  | X   | **Logging is `console.*` in library code**, with no logger injection (`TableFactory.ts:41`, `Lobby.ts:129`).                                                                                                                                                                                                                                                                                                                                                                                                  |                                                           |

### 2.3 Client

| #   | Sev | Finding                                                                                                                                                                                          |
| --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 14  | C   | The React client uses flat constants (`CLIENT_COMMAND_TYPES.TABLE_JOIN`) while the server's are nested (`.TABLE.JOIN`). Every command sends `{"action": undefined}` and no state is ever cached. |
| 15  | C   | It imports the whole server package (with `ws` and `crypto`) into the browser, so `webpack` fails. It pins `shoehive ^0.6.0` (0.x caret means 0.6.x only) against a 0.10.0 server.               |
| 16  | X   | It is plain JS with no types, no tests (the `jest` script has no jest), React in both `dependencies` and `peerDependencies`, and no `exports`, `module` or `types`.                              |

### 2.4 Docs, tests, tooling

| #   | Sev | Finding                                                                                                                                                                                                                                                                                                        |
| --- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17  | X   | The README's first example calls `createGameServer(server)` and `registerGameModule`, and neither exists. The quick-start imports a `GAME_EVENTS` that is never exported. The tic-tac-toe guide is written for the old positional-argument API throughout. Three different listener signatures are documented. |
| 18  | X   | There is no concepts page and no runnable example repo. Guide pages are very long and repeat whole files twice. The docs run on Jekyll, which needs Ruby for a TypeScript project. There are filename typos (`3_recieving_messages.md`).                                                                       |
| 19  | X   | 233 tests pass, but all of them mock `ws`. The "integration" test never opens a socket. The protocol and reconnect code has the weakest coverage (MessageRouter 43%). Some test files are named after coverage gaps (`TableUncovered.test.ts`).                                                                |
| 20  | C   | Release publishes to npm even when tests fail (`                                                                                                                                                                                                                                                               |     | true`). Lint is `continue-on-error`, and lint is red locally. Version detection diffs `HEAD~1`, which breaks on merge or multi-commit pushes. Every CI run posts a PR comment. |
| 21  | X   | The manifest has an invalid SPDX license (`UNLICENSE`), an empty author, ESLint 8 and typescript-eslint 5 (end of life), no `exports` map, a `start` script that runs a library, and `engines >=18` (Node 18 is end of life).                                                                                  |

**What is worth keeping:** the vocabulary of lobby, table, seat and spectator. The idea of pluggable auth and a pluggable money backend. Hidden-card awareness. The ambition to be the easy option for card and table games.

---

## 3. Positioning

|                  | boardgame.io  | Colyseus                | **Shoehive v1**                                              |
| ---------------- | ------------- | ----------------------- | ------------------------------------------------------------ |
| Model            | moves, phases | rooms with schema state | **tables with seats, actions, views, turns and rounds**      |
| Hidden info      | `playerView`  | filters                 | **per-seat and spectator `view()` plus a `secret` helper**   |
| Money            | none          | none                    | **optional Wallet module with ledger semantics**             |
| Cards            | none          | none                    | **`shoehive/cards`: seeded decks, shoes, hands, visibility** |
| Types end-to-end | partial       | codegen                 | **inferred from `defineGame`, no codegen**                   |

**One-line pitch:** _Build a multiplayer card, casino, board or party game in an afternoon: write the rules, Shoehive handles seats, sync, secrets, reconnects and persistence._

**v1 must handle all four families well:**

| Family                  | Example (ships in `examples/`) | Engine features it exercises                                       |
| ----------------------- | ------------------------------ | ------------------------------------------------------------------ |
| Casino table games      | Blackjack                      | dealer seat, phases, turn timers, wallet, hidden hole card         |
| Player-vs-player cards  | Texas Hold'em                  | private hands, betting rounds, side pots, showdown reveal          |
| Board / turn-based      | Tic-tac-toe                    | turns, validation, win detection (first tutorial)                  |
| Round-based party games | Quiz / trivia                  | simultaneous submissions, round timer, hidden answers until reveal |

**Real-time scope:** turn-based _and_ round-based. Everyone can act at once inside a round, with server timers. There is **no fixed tick loop** in v1, so physics or continuous-movement games, MMO scale and skill matchmaking are non-goals.

---

## 4. Core concepts (v1 mental model)

There are exactly six nouns. The docs teach them in this order.

1. **Game**: a definition object made by `defineGame`. It is pure data plus functions, with no I/O.
2. **Table**: one running instance of a Game. It owns its state, its seats, its action log, its RNG and its timers.
3. **Seat**: a numbered slot at a Table. Players act _as a seat_. A seat can be empty, occupied, or reserved during a reconnect grace period.
4. **Player**: an authenticated identity (id, display name, metadata). A Player is not a socket. A Player may have several connections (tabs) and may spectate many tables.
5. **Action**: a named, schema-validated input from a seat. It is the _only_ way game state changes from outside.
6. **View**: what one viewer (a seat or a spectator) is allowed to see. It is computed by the game's `view()` function. Clients only ever receive views.

Everything else is plumbing: Lobby, Session, Transport, Store, Wallet, Clock.

### Invariants the engine guarantees (and tests with property-based tests)

- State only changes inside an action, a lifecycle hook or a timer, one at a time per table (a serial queue).
- A failed action rolls back completely. Either all of its changes apply or none do.
- Clients receive only `view()` output, never raw state.
- Every view a client holds is `revision`-numbered. Applying the patches in order reproduces the server's view exactly.
- Given the same seed and the same action log, a table replays to identical state.

---

## 5. API design

### 5.1 Defining a game

```ts
// games/tic-tac-toe.ts
import { defineGame, reject } from 'shoehive';
import { z } from 'zod'; // any Standard Schema library: zod, valibot, arktype

type Mark = 'X' | 'O';

export const ticTacToe = defineGame({
  id: 'tic-tac-toe',
  name: 'Tic Tac Toe',
  seats: { min: 2, max: 2 },

  setup: () => ({
    board: Array<Mark | null>(9).fill(null),
    winner: null as Mark | 'draw' | null,
  }),

  turns: { order: 'round-robin' }, // the engine tracks ctx.turn.seat

  actions: {
    place: {
      input: z.object({ cell: z.number().int().min(0).max(8) }),
      run({ state, seat, input, ctx }) {
        if (ctx.turn.seat !== seat) reject('NOT_YOUR_TURN');
        if (state.board[input.cell]) reject('CELL_TAKEN');
        state.board[input.cell] = seat === 0 ? 'X' : 'O'; // a draft, mutate freely
        state.winner = winnerOf(state.board);
        if (state.winner) ctx.end({ winner: state.winner });
        else ctx.turn.next();
      },
    },
  },

  // Optional. If omitted, everyone sees everything.
  view: ({ state }) => state,
});
```

- **Drafts:** `run` mutates a draft (via Mutative, the faster successor pattern to Immer). The engine commits it atomically or discards it if the action throws.
- **`reject(code, details?)`:** a typed rejection that becomes a structured error on the client.
- **Lifecycle hooks:** `onSit`, `onStand`, `onDisconnect`, `onReconnect`, `onStart`, `onEnd`. Each is optional and runs with the same draft and context.
- **`rounds`:** the round-based model for simultaneous play (see 5.1a).
- **`phases`:** optional named phases with their own `actions` whitelist and `onEnter` / `onExit` hooks (for betting, dealing, play, settle).
- **`ctx.random`:** seeded per table. It uses a CSPRNG in production and a fixed seed in tests. The seed and every draw are recorded, so replays are exact.
- **`ctx.timers`:** `ctx.timers.after('turn', 30_000, 'autoFold')` schedules an internal action. It is driven by an injectable Clock, so tests jump time.
- **`ctx.emit(event, payload, { to })`:** an ephemeral event for animations and sounds (for example "card dealt"). It is not part of state.

### 5.1a Round-based play (simultaneous actions)

`turns` and `rounds` are two optional models a game picks per phase. The engine never forces a turn order.

```ts
export const quiz = defineGame({
  id: 'quiz',
  seats: { min: 2, max: 12 },
  setup: ({ options }) => ({ q: 0, answers: {} as Record<number, number>, scores: [] as number[] }),
  phases: {
    question: {
      rounds: {
        durationMs: 15_000, // the round closes on timeout...
        closeWhen: 'all-submitted', // ...or as soon as every seat has answered
        onClose: ({ state, ctx }) => {
          score(state);
          ctx.phase.go('reveal');
        },
      },
      actions: {
        answer: {
          input: z.object({ choice: z.number().int().min(0).max(3) }),
          once: true, // one submission per seat per round
          run: ({ state, seat, input }) => {
            state.answers[seat] = input.choice;
          },
        },
      },
    },
    reveal: { onEnter: ({ ctx }) => ctx.timers.after('next', 5_000, 'nextQuestion') },
  },
  // Answers stay hidden until the reveal phase.
  view: ({ state, viewer, ctx }) =>
    ctx.phase.name === 'reveal'
      ? state
      : { ...state, answers: { [viewer.seat!]: state.answers[viewer.seat!] } },
});
```

Actions from different seats still run through the table's serial queue, so "simultaneous" never means "racy".

### 5.2 Hidden information

```ts
view: ({ state, viewer }) => ({
  ...state,
  hands: state.hands.map((hand, seat) =>
    viewer.seat === seat ? hand : hand.map(hideCard)),
  deck: { remaining: state.deck.length }, // never send the deck itself
}),
```

`shoehive/cards` ships `hideCard`, `faceDown` and `ownedBy` helpers. A dev-mode check warns when a view is identical for all viewers even though the game declares secret fields.

### 5.3 Running a server

```ts
// server.ts
import { createServer } from 'shoehive/server';
import { ticTacToe } from './games/tic-tac-toe';

const shoehive = createServer({
  games: [ticTacToe],
  auth: async (req) => ({ id: userIdFrom(req), name: 'Ada' }), // optional, see below
  store: sqliteStore({ file: './shoehive.db' }), // optional, in-memory by default
  devtools: process.env.NODE_ENV !== 'production', // inspector at /__shoehive
  reconnectGraceMs: 60_000,
  logger: pino(), // optional, anything with info/warn/error
});

await shoehive.listen({ port: 3000 }); // or shoehive.attach(httpServer)
```

**Auth out of the box: guest plus a custom hook.** With no `auth`, each new connection gets a guest identity and a signed, expiring resume token (HMAC with a server secret), so reconnects work from minute one. Supplying `auth(req)` replaces guest mode with the integrator's own login. Returning `null` rejects the connection.

Server-side admin API (typed): `shoehive.tables.create(gameId, options)`, `.get(id)`, `.list()`, `.close(id)`, plus `shoehive.on('table:ended', ...)`. That is a small, typed event surface for _operators_, not for game logic.

### 5.4 Client and React

```ts
import { createClient } from 'shoehive/client';
import type { ticTacToe } from './games/tic-tac-toe'; // type-only import, no server code bundled

const client = createClient<[typeof ticTacToe]>({ url: 'ws://localhost:3000' });
const table = await client.join('table_123');
await table.act('place', { cell: 4 }); // typed input; resolves on ack or throws a typed ShoehiveError
table.view; // typed as ReturnType<typeof ticTacToe.view>
```

```tsx
import { ShoehiveProvider, useTable, useLobby, useConnection } from 'shoehive/react';

function Board({ tableId }: { tableId: string }) {
  const { view, mySeat, act, pending } = useTable<typeof ticTacToe>(tableId);
  return view.board.map((cell, i) => (
    <button key={i} disabled={!!cell || pending} onClick={() => act('place', { cell: i })}>
      {cell}
    </button>
  ));
}
```

The client handles reconnects on its own: it stores a resume token, backs off with jitter, re-subscribes to tables and resyncs from its last revision.

### 5.5 Testing a game (no sockets)

```ts
import { createTestTable } from 'shoehive/testing';

test('X wins on the diagonal', async () => {
  const t = await createTestTable(ticTacToe, { players: 2, seed: 'fixed' });
  await t.act(0, 'place', { cell: 0 });
  await t.act(1, 'place', { cell: 1 });
  await t.act(0, 'place', { cell: 4 });
  await t.act(1, 'place', { cell: 2 });
  await t.act(0, 'place', { cell: 8 });
  expect(t.state.winner).toBe('X');
  await expect(t.act(1, 'place', { cell: 3 })).rejects.toMatchObject({ code: 'TABLE_ENDED' });
  expect(t.viewOf(1)).toMatchSnapshot();
  t.clock.advance(30_000); // fake time for timers
});
```

---

## 6. Wire protocol v1

**The normative spec is [`docs/reference/protocol.md`](../reference/protocol.md)**; this section is the summary. Where they differ, the spec wins. It is enforced by shared schemas in `src/protocol`. JSON in v1. The codec is pluggable so MessagePack can come later.

**Client to server** (each message carries `id` for correlation):

| `t`                         | Fields                                 | Purpose                                                                               |
| --------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| `hello`                     | `v`, `resume?`                         | Handshake. The server acks with a `Welcome` result `{ player, resumeToken, server }`. |
| `lobby.sub` / `lobby.unsub` |                                        | Subscribe to lobby updates.                                                           |
| `table.create`              | `game`, `options`                      | Create a table.                                                                       |
| `table.join`                | `table`, `as: 'player' \| 'spectator'` | Join and subscribe.                                                                   |
| `table.leave`               | `table`                                |                                                                                       |
| `seat.take` / `seat.leave`  | `table`, `seat?`                       | Sit down or stand up.                                                                 |
| `act`                       | `table`, `name`, `input`, `rev?`       | Game action.                                                                          |
| `ping`                      |                                        | Heartbeat.                                                                            |

**Server to client:**

| `t`                              | Fields                                                                      | Purpose                                                    |
| -------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `ack`                            | `id`, `ok: true, result?` or `ok: false, error { code, message, details? }` | Every request gets exactly one ack.                        |
| `table.snapshot`                 | `table`, `rev`, `doc { view, meta, seats, spectators, you }`                | Sent on join and on resync.                                |
| `table.patch`                    | `table`, `from`, `rev`, `ops` (RFC 6902 JSON Patch)                         | Sent after each commit, per viewer whose document changed. |
| `table.event`                    | `table`, `name`, `payload`                                                  | Ephemeral events from `ctx.emit`.                          |
| `lobby.snapshot` / `lobby.patch` |                                                                             | Only sent to lobby subscribers.                            |
| `pong`, `bye { code, reason }`   |                                                                             |                                                            |

Error codes are a closed, documented enum plus game-defined codes from `reject()`. Examples: `BAD_REQUEST`, `UNAUTHORIZED`, `NOT_FOUND`, `SEAT_TAKEN`, `NOT_SEATED`, `RATE_LIMITED`, `TABLE_ENDED`, `STALE_REVISION`.

Built in: max message size, per-connection token-bucket rate limit, heartbeat timeout, an optional origin allowlist, and schema validation before any game code runs.

---

## 7. Architecture

```
            ┌──────────────────────── shoehive (core, isomorphic, zero deps besides mutative) ┐
            │ defineGame · engine (queue, draft/commit, phases, turns) · views · diff · rng    │
            │ protocol schemas & types · errors                                                │
            └──────────────────────────────────────────────────────────────────────────────────┘
                 ▲                         ▲                          ▲
 shoehive/server │  shoehive/client        │   shoehive/testing       │  shoehive/cards
 sessions, lobby,│  connection, resume,    │   createTestTable,       │  deck/shoe/hand,
 transport (ws), │  table handles, patch   │   fake clock, replay,    │  visibility helpers
 store, wallet,  │  apply, typed act()     │   protocol conformance   │
 rate limits     │        ▲                │                          │
                 │  shoehive/react (hooks) │                          │
```

- **Engine** (pure): one `TableRuntime` per table. It runs a serial action queue: validate input, check the phase, run on a draft, commit, compute each viewer's view, diff against the last sent view, then emit patches. No globals, so many runtimes can share one process.
- **Server**: `Session` (identity, connections, resume token, grace timer), `Lobby` (index of tables, subscriptions), `Transport` interface (`ws` for Node in v1, plus an in-memory transport for tests; Bun and Durable Objects later). v1 targets a **single Node process**.
- **Persistence (v1 scope):** a `Store` interface holding per-table _snapshot plus action log_ and session records. Adapters ship as subpaths with optional peer dependencies:
  - `shoehive/store/memory` (default)
  - `shoehive/store/sqlite`
  - `shoehive/store/postgres`
  - `shoehive/store/redis`

  On restart the server loads each open table's latest snapshot, replays the log tail (exact, because RNG and clock are recorded), and re-arms pending timers from their recorded deadlines. Players reconnect with their resume tokens and land back in their seats. A shared **store conformance suite** in `shoehive/testing` gives integrators a way to check their own adapters.

- **Devtools (full, v1 scope):** `shoehive/devtools` serves an inspector at `/__shoehive`. It is off by default in production and protected by a token when enabled. It shows live tables, raw state, the view per seat and spectator side by side, the action log with timings and rejections, and session and connection status. **Replay and time travel**: scrub through any table's action log, step forward and back, fork a dev table from any point, and export a log as a test fixture for `createTestTable`. Time travel works on a copy; it never touches a live table.
- **Wallet** (optional, server): `reserve(playerId, amount, key)`, `commit(key)`, `release(key)`, `credit(playerId, amount, key)` for payouts, and `balance(playerId)` (ADR 0007). It is idempotent by key and called from game hooks through `ctx.wallet` with the engine's commit or rollback semantics. It replaces `ServerTransportModule`. An in-memory ledger ships for development.
- **Dependencies:** core needs `mutative` only. The server adds `ws`. Validation accepts any Standard Schema implementation, so no validator is forced on users.

---

## 8. Repository, packaging and tooling

**Packaging (decided):** one npm package `shoehive@1.x` with subpath exports, plus `create-shoehive`.

```
shoehive            → defineGame, reject, types (isomorphic)
shoehive/server     → createServer, auth/wallet/store interfaces
shoehive/client     → createClient (browser + Node)
shoehive/react      → hooks (react is an optional peer dependency)
shoehive/cards      → card toolkit
shoehive/testing    → test harness, store conformance suite
shoehive/devtools   → inspector with replay and time travel
shoehive/store/*    → memory, sqlite, postgres, redis adapters (optional peers)
```

One install, one version, no version skew between client and server, and no npm org needed. `shoehive-client-react` is archived with a pointer to `shoehive/react`. Officially supported clients in v1: **plain TypeScript and React.** Vue and Svelte adapters come after 1.0.

**Monorepo layout (pnpm workspaces):**

```
shoehive/
  packages/shoehive/          src/{core,protocol,server,client,react,cards,testing}
  packages/create-shoehive/   `npm create shoehive@latest`
  examples/tic-tac-toe/       smallest complete game (server + React UI + tests)
  examples/blackjack/         hidden cards, phases, timers, wallet
  examples/holdem/            private hands, betting rounds, side pots
  examples/quiz/              round-based simultaneous play
  examples/lobby-react/       lobby, spectating, reconnect demo
  docs/                       Starlight site; snippets imported from examples/
  docs/adr/                   architecture decision records
  docs/rfc/                   this document and its successors
```

**Tooling:**

- TypeScript 6.0 `strict` plus `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. (TypeScript 7, the native compiler, is adopted once typescript-eslint and the declaration bundler support it.) No `any` in public types.
- tsup builds dual ESM and CJS with `exports` and `types` conditions. `publint` and `@arethetypeswrong/cli` run in CI.
- Vitest for tests, including type tests via `expectTypeOf` for the inferred client types.
- ESLint 9 flat config with typescript-eslint 8, and Prettier. All are blocking in CI.
- API Extractor keeps a committed public API report, so any API change shows up in review.
- Changesets drive versioning, changelog and npm publish with `--provenance`. No more `HEAD~1` diffing.
- CI (GitHub Actions): Node 22, 24 and 26 matrix running lint, typecheck, test, build, package checks, a docs build with snippet type-check, and Playwright end-to-end on the examples. No PR-comment bots.
- CI services: SQLite runs in-process; Postgres and Redis run as GitHub Actions service containers for the store conformance suite.
- License: **MIT** (SPDX `MIT`), replacing the Unlicense.

---

## 9. Documentation plan (Diátaxis)

The site is Astro Starlight: pure Node, fast, with search and versioning. It deploys to GitHub Pages on the existing domain, **shoehive.jtay.co.uk** (CNAME kept). Every code block is imported from `examples/` or type-checked through twoslash, **so the docs cannot drift from the code again.** That is the root cause of finding 17.

| Section          | Pages (v1.0)                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Start**        | Why Shoehive · 5-minute quick start (`npm create shoehive`) · The six concepts                                                                                                                                                                                                                                                                                                   |
| **Tutorials**    | 1. Tic-tac-toe in 20 minutes (game, tests, UI) · 2. Quiz: round-based play · 3. Blackjack: hidden cards, phases, turn timers, chips · 4. Texas Hold'em: private hands and side pots                                                                                                                                                                                              |
| **How-to**       | Authentication (guest and custom) · Reconnects and sessions · Hidden information · Timers and turn clocks · Turns vs rounds · Phases · Persistence and restart recovery · Writing a store adapter · Wallets and real-money safety · Spectators · Testing games · Debugging with devtools and time travel · Deploying (single node, Docker, behind a proxy) · Logging and metrics |
| **Concepts**     | Tables and seats · Actions, drafts and atomicity · Turns and rounds · Views and sync (revisions, patches) · Determinism, replay and persistence · Security model                                                                                                                                                                                                                 |
| **Reference**    | Generated API (TypeDoc) · Wire protocol spec · Error codes · Config options · Changelog                                                                                                                                                                                                                                                                                          |
| **Contributing** | Architecture tour · ADR index · Release process                                                                                                                                                                                                                                                                                                                                  |

House style: short pages (target under 200 lines), a "what you'll build" box at the top, one concept per page, no emoji headings, and plain language.

---

## 10. Methodology

1. **Spec first.** The protocol spec and ADRs are written and reviewed before the code that implements them. Initial ADRs: (1) state-machine game model, (2) single package with subpath exports, (3) per-viewer views and JSON Patch sync, (4) Standard Schema validation, (5) Mutative drafts, (6) seeded RNG and replay, (7) Wallet ledger semantics, (8) turns and rounds, (9) Store interface, snapshot plus log, and restart recovery, (10) guest identity and resume tokens, (11) devtools security model.
2. **Engine before network.** Phase 1 ships a complete, tested engine with zero I/O. Tic-tac-toe must be fully playable in `shoehive/testing` before any socket code exists.
3. **Test pyramid with teeth:**
   - Unit tests for engine pieces.
   - Property-based tests (fast-check) for the section 4 invariants: views never contain fields marked secret, patch application equals a full view, replay equals state, rollback leaves no trace.
   - A protocol conformance suite run against the real server over the in-memory transport _and_ over real `ws`.
   - Playwright end-to-end tests on the examples, including a kill-the-socket reconnect test.
   - Type tests for inference.
   - No mocking of `ws` in integration tests.
4. **Dogfooding.** Each feature is "done" only when it has code, tests, a docs page and use in at least one example.
5. **Public API discipline.** Everything not exported is internal. The API Extractor report changes only with a changeset.
6. **Small, reviewable PRs** with conventional commits, one workstream per branch, and CI green before review.

---

## 11. Stakeholder decisions (interview, 2026-11-14)

| Topic         | Decision                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------- |
| Audience      | Open source for other developers. DX, docs and API stability come first.                     |
| Game families | All four: casino table, player-vs-player cards, board / turn-based, round-based party.       |
| Real-time     | Turn-based and round-based (simultaneous actions within timed rounds). No tick loop.         |
| Money         | Optional wallet hook with ledger semantics; an in-memory ledger for development.             |
| Runtime       | Single Node process, **with persistence**: tables survive a restart.                         |
| Storage       | `Store` interface plus memory, SQLite, Postgres and Redis adapters, and a conformance suite. |
| Packaging     | One `shoehive` package with subpath exports. Archive `shoehive-client-react`.                |
| Clients       | Plain TypeScript client and React. Vue and Svelte after 1.0.                                 |
| Auth          | Guest identity with signed resume tokens by default, plus a custom `auth(req)` hook.         |
| Devtools      | Full inspector in v1, including replay and time travel.                                      |
| Examples      | Tic-tac-toe, quiz, blackjack and Texas Hold'em.                                              |
| Docs          | Astro Starlight, deployed to GitHub Pages on shoehive.jtay.co.uk.                            |
| License       | MIT.                                                                                         |
| Version       | `1.0.0`, with `1.0.0-next.x` prereleases during the build.                                   |
| Working mode  | One PR per phase; the stakeholder reviews before the next phase starts.                      |

---

## 12. Roadmap

Each phase ends with one PR, a demo and a green CI. The stakeholder reviews and merges before the next phase starts. Phases are scoped by deliverable, not by date.

| Phase                               | Deliverable                                                                                                                                                                                                                                                                   | Exit criteria                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **0. Foundations**                  | Tag `v0.10.0-legacy`, delete the old `src/`, set up the monorepo, tooling, CI, MIT license, ADRs 1-11 and the protocol spec draft. (Postgres and Redis CI services arrive with the adapters in Phase 5; the API Extractor report arrives with the first real API in Phase 1.) | CI green on an empty package. ADRs merged.                                                                                                     |
| **1. Engine**                       | `defineGame`, TableRuntime, drafts, `reject`, turns, rounds, phases, views, diffing, RNG, timers, recorded clock, `shoehive/testing`                                                                                                                                          | Tic-tac-toe, a quiz and a blackjack rules-only game pass tests in the harness. Property tests pass.                                            |
| **2. Server**                       | Sessions, guest identity and resume tokens, ws and in-memory transports, lobby, seats, spectators, protocol, limits, logger, Wallet interface, `Store` interface with the memory adapter and restart recovery                                                                 | Conformance suite passes over both transports. Reconnect test passes. A kill-and-restart test restores tables from the memory-backed snapshot. |
| **3. Client + React**               | `shoehive/client` (typed `act`, patch apply, resume), `shoehive/react` hooks                                                                                                                                                                                                  | Type tests pass. Tic-tac-toe and quiz are playable in two browsers. Playwright end-to-end passes.                                              |
| **4. Cards, Wallet and card games** | `shoehive/cards`, the wallet flow in hooks, full blackjack and Texas Hold'em examples                                                                                                                                                                                         | Both are playable with hidden cards, turn timers and chips. Side-pot rules are tested against reference hands. A leak property test passes.    |
| **5. Store adapters**               | SQLite, Postgres and Redis adapters, store conformance suite                                                                                                                                                                                                                  | All adapters pass the conformance suite in CI. The restart-recovery end-to-end test passes on each adapter.                                    |
| **6. Devtools**                     | `shoehive/devtools`: live tables, per-viewer views, action log, replay, time travel, fork and export-as-fixture                                                                                                                                                               | Inspector works against every example. An exported log replays as a passing test. It is off and unreachable in production mode.                |
| **7. Docs + scaffolder**            | Starlight site on shoehive.jtay.co.uk, four tutorials, how-tos, reference, `create-shoehive`                                                                                                                                                                                  | A new developer goes from `npm create shoehive` to a playable game using only the docs. Snippets type-check in CI.                             |
| **8. Hardening + release**          | Load test (target: 1,000 tables and 5,000 sockets on one node, p95 action-to-patch under 20 ms locally), security review, `1.0.0-rc.1` then `1.0.0`                                                                                                                           | No open C-severity issues. API report frozen.                                                                                                  |

**Execution model.** I orchestrate and you review each phase's PR.

- Phases 0 and 1 are run by me with at most one helper, because they fix the public API.
- Later phases use subagents inside the phase, each in its own git worktree, within your subagent limits: up to 3 Opus or up to 10 Sonnet. For example, in Phase 4 one agent builds blackjack while another builds Hold'em, and in Phase 5 one agent per store adapter.
- I review every workstream against this RFC and merge them into the phase branch before the phase PR reaches you.

---

## 13. Risks

| Risk                                                         | Mitigation                                                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| End-to-end type inference gets complex                       | Type tests from day 1. Keep generics shallow (one `Game` type parameter).                                                                              |
| Per-viewer diffing costs CPU on large tables                 | Table-game state is small. Benchmark in Phase 1. Cache views for identical viewers (all spectators share one).                                         |
| Scope is now large (four games, three stores, full devtools) | Strict phase gates, and every feature built on the same snapshot-plus-log core. Replay, persistence and time travel are one mechanism used three ways. |
| Restart recovery diverges from the live run                  | Recovery is the same code path as replay, so the property test "replay equals state" also covers restarts.                                             |
| Three store adapters to maintain                             | One conformance suite; adapters stay thin (store blobs and append logs, no game-aware queries).                                                        |
| Devtools exposed in production                               | Off by default when `NODE_ENV=production`, token required when on, never mounted on the game socket path. ADR 11.                                      |
| Wallet misuse in real-money settings                         | Idempotency keys, commit tied to engine commit, a "not a licensed gaming system" note, and a how-to on audit logs.                                     |

**After 1.0:** multi-node table routing, Bun and Cloudflare Durable Objects transports, a MessagePack codec, matchmaking queues, Vue and Svelte adapters, a fixed-tick loop for continuous real-time games, and a built-in JWT verifier.
