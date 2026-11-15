# Shoehive wire protocol, version 1

|            |                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| Status     | **Implemented** by `shoehive/server` (Phase 2). Frozen for v1 once Phase 2 merges: additive changes only.  |
| Applies to | `shoehive/server` and `shoehive/client` 1.x                                                                |
| Related    | RFC 0001 section 6, ADR 0003 (views and sync), ADR 0008 (turns and rounds), ADR 0010 (identity and resume) |

This document is normative. "Must", "should" and "may" mean what they mean in RFC 2119. The
TypeScript types in `packages/shoehive/src/protocol` are generated from, or checked against, this
document. If they disagree, this document wins and the code is a bug.

Most developers never see this protocol: `shoehive/client` speaks it for them. It exists so that
clients in other languages are possible, and so that the server and client can be tested against
one spec.

---

## 1. Design rules

1. **One request, one reply.** Every client request carries an `id`. The server answers it with
   exactly one `ack` (the only exception is `ping`, answered by `pong`).
2. **State travels only in snapshots and patches.** Acks carry outcomes and small results (such as
   a new table id), never game state. A client renders from snapshots and patches only.
3. **Clients only ever see views.** The server never sends raw game state. Everything under
   `view` is the output of the game's `view()` function for that viewer.
4. **Revisions make gaps detectable.** Each table has a revision counter. Every patch says which
   revision it starts `from`, so a client can always tell when it missed something and must resync.
5. **Be liberal in what you accept.** Receivers ignore unknown fields. Clients ignore unknown
   server message types. This lets the protocol grow without a version bump.

---

## 2. Transport

- WebSocket (RFC 6455), text frames only, UTF-8 JSON, one message per frame.
- Default path `/shoehive` (configurable). Clients should offer the subprotocol `shoehive.v1` in
  `Sec-WebSocket-Protocol`; the server selects it when present.
- **Authentication happens on the HTTP upgrade.** The server's `auth(req)` hook sees headers,
  cookies and the query string. If it returns `null`, the server answers the upgrade with HTTP 401
  and no socket is opened. Browsers cannot set custom headers on WebSocket upgrades, so cookie or
  query-string tokens are the usual choice.
- If an origin allowlist is configured and the `Origin` header is not on it, the upgrade is
  answered with HTTP 403.

---

## 3. Message envelope

Every message is a JSON object with a string field `t` (type).

```ts
// Client to server
interface Request {
  t: string; // request type, for example "act"
  id: string; // 1 to 64 chars, unique among this connection's in-flight requests
  // ...type-specific fields
}

// Server to client
interface Ack {
  t: 'ack';
  id: string; // the request's id
  ok: true;
  result?: unknown;
}
interface NackAck {
  t: 'ack';
  id: string;
  ok: false;
  error: ShoehiveError;
}
```

A request with an unknown `t`, a missing `id` or a malformed body gets
`ack { ok: false, error: { code: "BAD_REQUEST" } }` when an `id` can be read, and is otherwise
dropped. Three protocol violations within 60 seconds close the connection with code `4002`.

---

## 4. Connection lifecycle

```
client                                   server
  | -- HTTP upgrade (cookies, query) ----> |  auth(req): identity or 401
  | <------------------------- 101 ------- |
  | -- hello { v: 1, resume? } ----------> |  within 10 s, or close 4000
  | <-- ack { result: Welcome } ---------- |
  | <-- lobby.snapshot / table.snapshot -- |  only when resuming a session
  |            ... requests, acks, patches, events ...
  | <-- bye { code, reason } ------------- |  before any server-initiated close
```

### 4.1 `hello`

```ts
{ t: 'hello', id, v: 1, resume?: string, name?: string, client?: { name: string; version: string } }
```

- `v` is the protocol version. If the server does not support it, it acks with
  `UNSUPPORTED_PROTOCOL` (`details.supported: number[]`) and closes with `4001`.
- `resume` is the token from a previous `Welcome`. It is opaque to the client (ADR 0010).
  - **Guest mode** (no `auth` hook): a valid token restores the same guest identity. A missing,
    expired or invalid token creates a new guest. An invalid token is not an error.
  - **Custom auth**: identity always comes from `auth(req)`. A valid token for _the same player_
    restores their session (joined tables, held seats, lobby subscription). A token for a different
    player is ignored.
- `name` is the display name for a new guest (1 to 32 characters after trimming, no control
  characters). It is ignored under custom auth and when a guest session is resumed. Without it the
  server picks `Guest ` plus 4 random characters (ADR 0010).
- Any other request sent before `hello` is acked with `BAD_REQUEST`.

Result:

```ts
interface Welcome {
  player: { id: string; name: string; guest: boolean };
  resumeToken: string; // store it; send it in the next hello
  resumeExpiresAt: number; // epoch ms
  resumed: boolean; // true if an existing session was restored
  server: {
    protocol: 1;
    now: number; // server epoch ms, for clock offset
    heartbeatMs: number;
    maxMessageBytes: number;
  };
}
```

When `resumed` is `true`, the server then sends a `lobby.snapshot` if the session was subscribed to
the lobby, and a `table.snapshot` for every table the session had joined.

### 4.2 Liveness

- The server sends WebSocket ping frames every `heartbeatMs` (default 15 000). A connection that
  misses two consecutive pongs is terminated. Browsers answer pings automatically.
- Browsers cannot observe ping frames, so clients may send the application-level `ping` to measure
  round-trip time and the server clock offset (needed to render countdowns from `deadline` values):

```ts
{ t: 'ping', id? }                          // client
{ t: 'pong', id?, now: number }             // server, echoes id
```

### 4.3 Disconnects and seats

When a player's last connection drops, their seats become `reserved` for the reconnect grace
period (default 60 s). Other viewers see `connected: false` on those seats. If the player
reconnects in time (any connection, with a valid resume), the seats return to `occupied`. If not,
the game's `onStand` hook runs and the seats become `empty`. A player may hold several connections
(tabs) at once; each receives the same pushes.

---

## 5. Requests

| `t`            | Fields                                                        | `result` on success               | Typical errors                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hello`        | `v`, `resume?`, `client?`                                     | `Welcome`                         | `UNSUPPORTED_PROTOCOL`                                                                                                                                                                                                        |
| `lobby.sub`    |                                                               | none (a `lobby.snapshot` follows) |                                                                                                                                                                                                                               |
| `lobby.unsub`  |                                                               | none                              |                                                                                                                                                                                                                               |
| `table.create` | `game`, `options?`                                            | `{ table: string }`               | `NOT_FOUND`, `INVALID_OPTIONS`, `FORBIDDEN`                                                                                                                                                                                   |
| `table.join`   | `table`, `as?: 'player' \| 'spectator'` (default `'player'`)  | none (a `table.snapshot` follows) | `NOT_FOUND`, `TABLE_ENDED`, `FORBIDDEN`                                                                                                                                                                                       |
| `table.leave`  | `table`                                                       | none                              | `NOT_JOINED`                                                                                                                                                                                                                  |
| `table.sync`   | `table`                                                       | none (a `table.snapshot` follows) | `NOT_JOINED`                                                                                                                                                                                                                  |
| `seat.take`    | `table`, `seat?: number` (omit for the first free seat)       | `{ seat: number }`                | `NOT_JOINED`, `SEAT_TAKEN`, `TABLE_FULL`, `ALREADY_SEATED`, game codes from `canSit`                                                                                                                                          |
| `seat.leave`   | `table`, `seat?: number` (omit for all of the player's seats) | none                              | `NOT_SEATED`                                                                                                                                                                                                                  |
| `act`          | `table`, `name`, `input?`, `seat?`, `rev?`                    | `{ rev: number, value?: Json }`   | `NOT_SEATED`, `NOT_STARTED`, `ACTION_NOT_ALLOWED`, `INVALID_INPUT`, `ALREADY_SUBMITTED`, `NOT_PARTICIPANT`, `ROUND_CLOSED`, `STALE_REVISION`, `TABLE_ENDED`, `TABLE_UNAVAILABLE`, `WALLET_UNAVAILABLE`, `TIMEOUT`, game codes |
| `ping`         | `id?`                                                         | answered by `pong`, not `ack`     |                                                                                                                                                                                                                               |

Notes:

- `table.create` does not join. `shoehive/client` offers `createAndJoin()` that sends both.
- `act.seat` is required only when the player holds more than one seat at that table.
- The `act` result's `value` is the JSON the action's `run` returned, when it returned one.
- `act.rev`, when present, must equal the table's current revision or the action is rejected with
  `STALE_REVISION`. Use it for "only apply this if the board is what I am looking at".
- The `act` ack is sent **after** the action's log entry is durably stored (ADR 0009) and
  **after** the patch for that commit, so when a client sees
  `ack { ok: true, result: { rev } }` its document is already at `rev` or later.
- Actions for one table are processed one at a time, in arrival order (the per-table serial queue).

---

## 6. Synced documents

### 6.1 Table document

For every viewer of a table, the server maintains one JSON document:

```ts
interface TableDocument {
  view: unknown; // game's view() output for this viewer
  meta: {
    game: string; // game id
    status: 'waiting' | 'active' | 'ended';
    phase: string | null;
    turn: { seat: number; deadline: number | null } | null; // turn-based phases
    round: {
      // round-based phases
      number: number;
      deadline: number | null; // epoch ms
      submitted: number[]; // seats that have acted this round
    } | null;
    options: unknown; // table options as validated by the game
    result: unknown; // ctx.end() payload once status is 'ended', else null
  };
  seats: Array<{
    status: 'empty' | 'occupied' | 'reserved';
    player: { id: string; name: string } | null;
    connected: boolean;
  }>;
  spectators: number;
  you: { player: string; seats: number[]; role: 'player' | 'spectator' };
}
```

`round.submitted` lists _which_ seats acted, never _what_ they submitted. Contents of submissions
are part of game state and reach clients only through `view()`.

### 6.2 `table.snapshot`

```ts
{ t: 'table.snapshot', table: string, rev: number, doc: TableDocument }
```

Sent after `table.join`, after `table.sync`, after a resume, and whenever the server decides a
patch would be larger than a snapshot. It replaces the client's document entirely.

### 6.3 `table.patch`

```ts
{ t: 'table.patch', table: string, from: number, rev: number, ops: JsonPatchOp[] }
```

- `ops` is an RFC 6902 JSON Patch against `TableDocument`, using only `add`, `remove` and
  `replace`.
- A patch may also carry `rev === from` when only connection-level fields changed (`spectators`,
  `you`): the document changed but the table did not.
- `rev` is the table revision after the commit. Revisions increase by one per committed change to
  table state, so a viewer whose document did not change receives nothing and later sees a gap
  between its own revisions. That is why every patch carries `from`: **the revision of the last
  document the server sent to this viewer.**
- A client must apply a patch only if `from` equals its local revision. Otherwise it must discard
  the patch and send `table.sync`.
- Applying all received patches in order must yield exactly the document the server holds for that
  viewer (an engine invariant, property-tested).
- **Backpressure.** If a connection's send buffer passes 1 MiB, the server stops sending it patches.
  When the buffer drains it receives one `table.snapshot` (ADR 0003).

### 6.4 `table.event`

```ts
{ t: 'table.event', table: string, rev: number, name: string, payload: unknown }
```

Ephemeral events from `ctx.emit()` (for example "card dealt" for an animation). They are not part
of the document and are not replayed on resync. An event emitted while committing revision `N` is
delivered after that commit's patch, with `rev: N`. Events have their own audience (`to`), and are
never sent to viewers outside it.

### 6.5 `table.closed`

```ts
{ t: 'table.closed', table: string, reason: 'ended' | 'closed' | 'game-removed' | 'expired' }
```

The table is gone. The client drops its document. `ended` tables stay joinable (read-only) until
they are closed, so players can see the final result.

### 6.6 Lobby

Lobby subscribers hold one document, synced the same way:

```ts
interface LobbyDocument {
  games: Array<{ id: string; name: string; description: string | null; seats: { min: number; max: number } }>;
  tables: Array<{
    id: string;
    game: string;
    status: 'waiting' | 'active' | 'ended';
    seats: { taken: number; total: number };
    spectators: number;
    createdAt: number;
    listed: unknown;           // game-chosen public summary (lobby() hook), or null
  }>;
}

{ t: 'lobby.snapshot', rev: number, doc: LobbyDocument }
{ t: 'lobby.patch', from: number, rev: number, ops: JsonPatchOp[] }
```

Game definitions never leak server-only configuration into the lobby: only the fields above.

---

## 7. Errors

```ts
interface ShoehiveError {
  code: string; // see below
  source: 'shoehive' | 'game'; // 'game' for codes raised with reject() in game code
  message: string; // human-readable, English, safe to show in dev tools
  details?: unknown; // structured, documented per code
}
```

Game code passes its own codes to `reject(code, details?)`. They must match `^[A-Z][A-Z0-9_]*$`
and must not reuse a built-in code (a type error at `defineGame`). Built-in codes:

| Code                   | When                                                                                                                          | `details`                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `BAD_REQUEST`          | Malformed message, unknown request type, request before `hello`                                                               |                                     |
| `UNSUPPORTED_PROTOCOL` | `hello.v` not supported                                                                                                       | `{ supported: number[] }`           |
| `UNAUTHORIZED`         | Session no longer valid (for example token revoked)                                                                           |                                     |
| `FORBIDDEN`            | A hook such as `canCreate` or `canJoin` refused                                                                               |                                     |
| `NOT_FOUND`            | Unknown game or table                                                                                                         | `{ kind: 'game' \| 'table' }`       |
| `INVALID_OPTIONS`      | Table options failed the game's options schema                                                                                | `{ issues: StandardSchemaIssue[] }` |
| `INVALID_INPUT`        | Action input failed its schema                                                                                                | `{ issues: StandardSchemaIssue[] }` |
| `NOT_JOINED`           | Request needs the table to be joined first                                                                                    |                                     |
| `TABLE_FULL`           | No free seat                                                                                                                  |                                     |
| `SEAT_TAKEN`           | Requested seat is occupied or reserved                                                                                        |                                     |
| `ALREADY_SEATED`       | Player is at the game's per-player seat limit                                                                                 |                                     |
| `NOT_SEATED`           | Action or `seat.leave` from a player without a seat                                                                           |                                     |
| `NOT_STARTED`          | Action before the table started (only `preStart` actions allowed)                                                             |                                     |
| `ACTION_NOT_ALLOWED`   | Unknown action, or not allowed in the current phase                                                                           | `{ phase: string \| null }`         |
| `ALREADY_SUBMITTED`    | A `once` action was already submitted this round                                                                              |                                     |
| `NOT_PARTICIPANT`      | Round action from a seat that is not part of the current round (for example it sat down mid-round)                            |                                     |
| `ROUND_CLOSED`         | Round action after the round closed                                                                                           |                                     |
| `STALE_REVISION`       | `act.rev` did not match                                                                                                       | `{ rev: number }` (current)         |
| `TABLE_ENDED`          | Action on an ended table                                                                                                      |                                     |
| `RATE_LIMITED`         | Connection exceeded its rate limit                                                                                            | `{ retryAfterMs: number }`          |
| `TIMEOUT`              | An async action (for example a wallet call) exceeded its time budget and was rolled back                                      |                                     |
| `WALLET_UNAVAILABLE`   | The wallet backend failed and game code did not handle it; the action was rolled back                                         |                                     |
| `TABLE_UNAVAILABLE`    | The table is faulted (for example a store write failed, or recovery hit a game version mismatch) until an operator reloads it |                                     |
| `INTERNAL`             | Game code threw something other than `reject()`. The action was rolled back. In production the message is generic             |                                     |

---

### 7.1 Codes raised by the client

`shoehive/client` raises three more codes locally. Servers never send them.

| Code              | When                                                        |
| ----------------- | ----------------------------------------------------------- |
| `CONNECTION_LOST` | The socket closed while the request was waiting for its ack |
| `REQUEST_TIMEOUT` | No ack within `requestTimeoutMs` (default 15 000)           |
| `CLIENT_CLOSED`   | `client.close()` was called while the request was waiting   |

A request that failed with `CONNECTION_LOST` may or may not have been applied: read the table
document after the reconnect instead of retrying blindly.

## 8. Close codes

The server sends `bye { code, reason }` immediately before closing, when it can.

| Code | Meaning                               | Client should                                    |
| ---- | ------------------------------------- | ------------------------------------------------ |
| 1000 | Normal close                          | Not reconnect                                    |
| 1001 | Server shutting down or restarting    | Reconnect with backoff and `resume`              |
| 1009 | Message larger than `maxMessageBytes` | Fix the client; not reconnect in a loop          |
| 4000 | No `hello` within 10 s                | Reconnect                                        |
| 4001 | Unsupported protocol version          | Not reconnect; upgrade the client                |
| 4002 | Repeated protocol violations          | Not reconnect in a loop                          |
| 4401 | Session revoked or unauthorized       | Re-authenticate, then reconnect without `resume` |
| 4409 | Kicked by an operator                 | Not reconnect automatically                      |
| 4429 | Severe rate-limit abuse               | Back off for at least 30 s                       |

---

## 9. Limits (defaults, all configurable)

| Limit                                | Default                                        |
| ------------------------------------ | ---------------------------------------------- |
| `maxMessageBytes`                    | 65 536                                         |
| Rate limit per connection            | token bucket, 20 messages per second, burst 40 |
| `hello` timeout                      | 10 s                                           |
| `heartbeatMs`                        | 15 000                                         |
| Reconnect grace (`reconnectGraceMs`) | 60 000                                         |
| In-flight requests per connection    | 32 (more are acked with `RATE_LIMITED`)        |

---

## 10. Versioning

- The protocol version is an integer, negotiated in `hello`. This document is version 1.
- **Not breaking** (no bump): new optional request fields, new result or document fields, new
  server message types, new error codes, new close codes in the 4000 range.
- **Breaking** (bump): removing or renaming anything, changing a field's meaning or type, changing
  ordering guarantees.
- A server may support several versions at once. `shoehive/server` 1.x supports version 1.

---

## 11. Example session

```jsonc
// client -> server
{ "t": "hello", "id": "1", "v": 1 }
// server -> client
{ "t": "ack", "id": "1", "ok": true, "result": {
  "player": { "id": "g_7f3k", "name": "Guest 7f3k", "guest": true },
  "resumeToken": "v1.eyJwIjoiZ183ZjNr...", "resumeExpiresAt": 1763164800000, "resumed": false,
  "server": { "protocol": 1, "now": 1763143200000, "heartbeatMs": 15000, "maxMessageBytes": 65536 } } }

{ "t": "table.create", "id": "2", "game": "tic-tac-toe" }
{ "t": "ack", "id": "2", "ok": true, "result": { "table": "t_q81" } }

{ "t": "table.join", "id": "3", "table": "t_q81" }
{ "t": "ack", "id": "3", "ok": true }
{ "t": "table.snapshot", "table": "t_q81", "rev": 0, "doc": {
  "view": { "board": [null, null, null, null, null, null, null, null, null], "winner": null },
  "meta": { "game": "tic-tac-toe", "status": "waiting", "phase": null, "turn": null, "round": null, "options": {}, "result": null },
  "seats": [ { "status": "empty", "player": null, "connected": false },
             { "status": "empty", "player": null, "connected": false } ],
  "spectators": 0,
  "you": { "player": "g_7f3k", "seats": [], "role": "player" } } }

{ "t": "seat.take", "id": "4", "table": "t_q81" }
{ "t": "table.patch", "table": "t_q81", "from": 0, "rev": 1, "ops": [
  { "op": "replace", "path": "/seats/0", "value": { "status": "occupied", "player": { "id": "g_7f3k", "name": "Guest 7f3k" }, "connected": true } },
  { "op": "replace", "path": "/you/seats", "value": [0] } ] }
{ "t": "ack", "id": "4", "ok": true, "result": { "seat": 0 } }

// ... a second player sits, the game starts ...

{ "t": "act", "id": "9", "table": "t_q81", "name": "place", "input": { "cell": 4 } }
{ "t": "table.patch", "table": "t_q81", "from": 3, "rev": 4, "ops": [
  { "op": "replace", "path": "/view/board/4", "value": "X" },
  { "op": "replace", "path": "/meta/turn/seat", "value": 1 } ] }
{ "t": "ack", "id": "9", "ok": true, "result": { "rev": 4 } }

{ "t": "act", "id": "10", "table": "t_q81", "name": "place", "input": { "cell": 4 } }
{ "t": "ack", "id": "10", "ok": false, "error": {
  "code": "NOT_YOUR_TURN", "source": "game", "message": "Rejected by game: NOT_YOUR_TURN" } }
```

---

## 12. Open questions

1. **Binary codec.** JSON only in v1. MessagePack would negotiate through the subprotocol
   (`shoehive.v1+msgpack`). Deferred until after 1.0.
2. **Patch size threshold.** The rule for sending a snapshot instead of a large patch (for example
   "patch bytes greater than half the snapshot bytes") is decided by benchmark in Phase 2.
3. **Spectator view sharing.** All spectators share one computed view (ADR 0003). If a game wants
   per-spectator views (for example a coach who sees one seat's hand), that needs a
   `viewer.kind = 'observer'` extension, which is not in v1.
