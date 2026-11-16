# Security review 1.0: network-facing surface

|           |                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| Phase     | 8 (pre-1.0 security review)                                                                                   |
| Date      | 2026-11-16                                                                                                    |
| Scope     | `shoehive/server` transport and protocol handling, `shoehive/client`, `shoehive/react`, patches               |
| Companion | The devtools, stores, wallet, engine, scaffolder and CI review (merged into one report later)                 |
| Result    | 3 High, 2 Medium and 7 Low findings fixed with regression tests; 4 accepted or deferred; 1 tracked separately |

## 1. Scope

- `packages/shoehive/src/server/`: `server.ts`, `transport.ts`, `tokens.ts`, `logger.ts`,
  `index.ts`.
- `packages/shoehive/src/protocol/`: message parsing and validation.
- `packages/shoehive/src/client/` and `src/react/`: token storage, handling of untrusted server
  data, reconnect behaviour.
- `packages/shoehive/src/core/diff.ts` (`applyPatch` on untrusted patches) and `src/core/json.ts`.
- The static file servers of `examples/*/src/server.ts` and
  `packages/create-shoehive/templates/*/src/server.ts`.

Out of scope here (covered by the companion review): devtools, stores, wallet, the engine
(`core/runtime.ts`), the scaffolder's rendering, CI.

## 2. Method

The model attacker has a WebSocket client and no account. Each area was read against the
protocol spec (`docs/reference/protocol.md`), ADR 0010 and ADR 0011, then probed with scratch
tests against a real server over both transports (in-memory and `ws`). The areas:

- message shape: malformed JSON, non-object frames, unknown types, oversized frames, deep
  nesting, numbers that parse to `Infinity`, `__proto__` keys;
- volume: floods, many requests in flight, slow readers and backpressure, connections per
  address, tables per player, lobby subscriptions;
- identity: `hello` abuse, resume token forgery, replay, fixation and expiry, session takeover
  across tabs, cross-site WebSocket hijacking;
- authorization: acting on tables or seats not held, spectators acting, information reaching a
  client other than through `view()` (snapshots, patches, events, acks, error details);
- robustness: one message crashing the process (unhandled rejections, throws in event
  handlers), error messages leaking internals, log injection;
- client: untrusted snapshots and patches, prototype pollution through `applyPatch`, reconnect
  behaviour after each close code;
- static serving: path traversal and response headers.

Every fix has a regression test that was run against the unfixed code (a detached worktree at
`HEAD`) and failed there, then passed with the fix.

Severity is CVSS-like judgement for a typical deployment: a public game server in guest mode,
or with cookie-based `auth`.

## 3. Findings

| ID   | Severity | Title                                                                         | Status                                                                                                                                |
| ---- | -------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| N-01 | High     | A `view()` that throws turns one request into a process crash                 | Fixed: `test/server/security.test.ts` "N-01: a view() that throws ... costs only that viewer its update"                              |
| N-02 | High     | Unbounded send buffer for a client that stops reading                         | Fixed: `test/server/security.test.ts` "N-02: a client that stops reading ... is dropped once its send buffer passes maxBufferedBytes" |
| N-03 | High     | Unbounded table creation by any client                                        | Fixed: `test/server/security.test.ts` "N-03: table creation limits" (2 tests)                                                         |
| N-04 | Medium   | Guest session records are never deleted                                       | Fixed: `test/server/security.test.ts` "N-04: guest session records ...", `test/client/security.test.ts` "N-04: player.rename ..."     |
| N-05 | Medium   | Cookie `auth` without `origins` allows cross-site WebSocket hijacking         | Partly fixed (startup warning, docs): `test/server/security.test.ts` "N-05"; secure default deferred to the owner                     |
| N-06 | Low      | Two concurrent `hello`s bind one connection to two players                    | Fixed: `test/server/security.test.ts` "N-06: a second hello on the same connection ..."                                               |
| N-07 | Low      | `Infinity` and deep nesting in `input` / `options` reach game code            | Fixed: `test/server/security.test.ts` "N-07: payload validation" (2 tests)                                                            |
| N-08 | Low      | Malformed server messages throw out of the client's socket handler            | Fixed: `test/client/security.test.ts` "N-08: hostile server messages" (2 tests)                                                       |
| N-09 | Low      | The client ignores the 30 s back-off of close code 4429                       | Fixed: `test/client/security.test.ts` "N-09: close code 4429 ..."                                                                     |
| N-10 | Low      | Display names may contain bidi overrides and line separators                  | Fixed: `test/server/dx.test.ts` "player.rename ... rejects empty or overlong names" (extended)                                        |
| N-11 | Low      | `applyPatch` guesses at operations and paths outside RFC 6902                 | Fixed (hardening): `test/client/security.test.ts` "N-11: applyPatch on untrusted patches" (2 tests)                                   |
| N-12 | Low      | Example servers: hard-coded dev secrets, no `nosniff` or anti-framing headers | Fixed, checked by hand (section 4, N-12); no automated test                                                                           |
| N-13 | Medium   | `attach()` leaves upgrades for unknown paths open                             | Tracked separately (owner's own session); not changed here                                                                            |
| N-14 | Info     | Guest resume tokens are bearer tokens: replayable until expiry, not revocable | Accepted risk (ADR 0010)                                                                                                              |
| N-15 | Low      | No limit on connections per address or per player                             | Accepted risk: belongs at the reverse proxy; documented in protocol section 9                                                         |
| N-16 | Low      | No limit on tables joined per connection                                      | Deferred: bounded by N-03; see details                                                                                                |
| N-17 | Info     | `dev` defaults from `NODE_ENV`: unset in production means verbose errors      | Accepted risk: documented (ADR 0010 status, deploying how-to)                                                                         |

Areas probed with no finding are listed in section 5.

## 4. Details

### N-01 (High): a `view()` that throws turns one request into a process crash

**What.** The server builds every viewer's document by calling the game's `view()`. When it
threw (a common game bug, such as `state.hands[viewer.seat]` for a spectator), the error
escaped in three places:

1. The `after` step of `table.join` and `table.sync` (send the snapshot) ran inside the
   request's promise chain after the ack, with no handler: an **unhandled rejection**, which
   stops a Node process by default (`--unhandled-rejections=throw`).
2. A socket close runs `leaveTable`, which syncs the table from the transport's `close`
   event: an **uncaught exception** from an event emitter, which also stops the process.
3. In the commit listener it aborted the sync for every remaining viewer, and the actor was
   acked `INTERNAL` although the action had been committed, inviting a retry (a double move).

**Reproduction.** A game whose `view()` throws for seat 0 after some action. Seat 0 sends that
action, then `table.sync`: probe output `unhandled 1 ShoehiveError: Game code threw: view bug`.

**Fix.** `server.ts`: `tryBuildDoc` wraps document building per connection, logs
`Could not build a table document (view() threw)` and marks that viewer stale, so it gets a
snapshot once `view()` works again. Other viewers and the actor's ack are unaffected. The
request chain also ends in a `catch` that logs, so no request can ever become an unhandled
rejection.

### N-02 (High): unbounded send buffer for a client that stops reading

**What.** Table patches pause at 1 MiB of buffered data (ADR 0003), but nothing else did:
acks, `pong`, events, lobby patches and the snapshots answering `table.sync` and `lobby.sub`
were queued without limit. A client that stops reading its socket and sends `table.sync` or
`lobby.sub` (each a small request answered by a full document) grows the server's memory until
the process dies. Lobby patches also ignored backpressure entirely.

**Reproduction.** Over `ws`, join a table with a 512 KiB view, pause the client socket and send
50 `table.sync` requests (25 MB). Before the fix the connection was never dropped (the test
timed out); server memory grew by the full amount.

**Fix.** `send()` drops a connection whose buffer passes `limits.maxBufferedBytes` (new,
default 8 MiB) with `Connection.terminate()` (new, optional; a close frame would only queue
behind the backlog). The close event then runs the normal disconnect path (grace period). Lobby
patches now follow the table rule: skipped while over 1 MiB, then one `lobby.snapshot`.

### N-03 (High): unbounded table creation by any client

**What.** Any guest could send `table.create` at the rate limit (20 per second per connection)
from any number of connections. Each table holds a runtime, a log and store rows; idle tables
only expire after 10 minutes, and never while some connection has joined them.

**Reproduction.** One guest connection created 200 tables in a loop with no refusal.

**Fix.** Two new limits, checked before the table is built, including requests still in flight:
`limits.maxTablesPerPlayer` (default 10 open, not ended, tables created by that player) and
`limits.maxTables` (default 10 000 tables on the server). Refusals are `FORBIDDEN` with
`details: { limit }` (additive: `FORBIDDEN` was already a documented `table.create` error). The
server API `tables.create()` is never refused. In guest mode a new connection is a new player,
so the per-player limit does not stop a determined attacker on its own; `maxTables` caps the
damage and protocol section 9 now says to limit connections per address at the proxy (N-15).

### N-04 (Medium): guest session records are never deleted

**What.** Every `hello` from a new guest wrote a `Store.sessions` record, and nothing ever
deleted one. A loop of connect, `hello` and close grows the store (memory, SQLite, Postgres or
Redis) without bound.

**Fix.** When a guest's in-memory session is cleaned up (no connection for twice the grace
period) and the guest holds no seat, its record is deleted. Resume still works because the
token carries the id and the name; the record only made `resumed` true. To keep a rename
across that deletion, `player.rename` now returns `resumeToken` and `resumeExpiresAt` (additive
result fields) and `shoehive/client` stores the new token. Authenticated players' records are
untouched. ADR 0010 and protocol section 5 updated.

### N-05 (Medium): cookie `auth` without `origins` allows cross-site WebSocket hijacking

**What.** Browsers send cookies with cross-site WebSocket upgrades and the same-origin policy
does not cover WebSockets. With an `auth` hook that reads a session cookie (a pattern the docs
show) and no `origins` allowlist (the default), any web page a logged-in player visits can open
a fully authenticated connection and act as them. Guest mode is not affected: its token travels
in `hello`, which another site cannot read.

**Fix (partial).** `createServer` logs a warning at startup when `auth` is set and `origins` is
empty, and protocol section 2 explains the risk. **Not done:** a secure default (for example
same-origin only when `auth` is set and `origins` is not), because it would refuse existing
cross-origin deployments (a Vite dev server on another port, a separate web host) and is a
product decision for the owner. Recommended before 1.0: either that default, or an explicit
`origins` requirement whenever `auth` is set in production.

### N-06 (Low): two concurrent `hello`s bind one connection to two players

**What.** Requests run concurrently. A `hello` with a resume token awaits the store before it
records the session, so a second `hello` sent right behind it also passed the "already sent"
check. The connection ended up in two sessions: the first session kept a closed connection
forever (it never expired, and its seats never entered the grace period). The attacker needs
both tokens, so there is no privilege gain; the impact is a leak and inconsistent state.

**Fix.** A `helloPending` flag: a second `hello` while one is in progress gets `BAD_REQUEST`.

### N-07 (Low): `Infinity` and deep nesting in `input` and `options` reach game code

**What.** `JSON.parse` turns `1e400` into `Infinity`, and a 64 KiB message can nest 30 000
levels. Both reached the game's schema. The engine's JSON check then answered `INTERNAL` with a
message describing the schema (even in production), and deep values overflowed recursive
validators (`INTERNAL`, logged as a server error).

**Fix.** `parseClientMessage` checks `act.input` and `table.create.options` iteratively: numbers
must be finite and nesting is at most 32 levels, otherwise `BAD_REQUEST` (a malformed body,
counted as a protocol violation). No JavaScript client can produce either, so no real client is
affected. Protocol sections 5 and 9 updated.

### N-08 (Low): malformed server messages throw out of the client's socket handler

**What.** `shoehive/client` read `message.t` from whatever `JSON.parse` returned (`null`
throws) and let `applyPatch` errors escape. In Node, an exception from a WebSocket listener stops
the process, so a buggy or hostile server (or anyone on a `ws://` path) could crash a Node
client or bot with one frame, and in browsers a bad patch left the table stuck out of sync.

**Fix.** Frames that are not objects with a string `t` are ignored; dispatch is wrapped; a patch
that does not apply (or whose `ops` is not an array) keeps the document and triggers a resync
(`table.sync` or `lobby.sub`); a failed ack's error is rebuilt field by field.

### N-09 (Low): the client ignores the 30 s back-off of close code 4429

**What.** Protocol section 8 says to back off at least 30 s after 4429 (severe rate-limit
abuse). The client used its normal backoff (from 0.25 s), so a misbehaving client looped
straight back into the server.

**Fix.** The reconnect delay after 4429 is at least 30 s.

### N-10 (Low): display names may contain bidi overrides and line separators

**What.** Names rejected only `\p{Cc}`. U+202E and friends let a guest show other players a name
that reads differently from what it is, and U+2028 and U+2029 break lines in some log viewers.

**Fix.** `hello.name` and `player.rename` also reject `\p{Zl}`, `\p{Zp}`, U+202A to U+202E and
U+2066 to U+2069. Other format characters (for example the zero-width joiner in emoji) are
still allowed.

### N-11 (Low): `applyPatch` guesses at operations and paths outside RFC 6902

**What.** Unknown operations (`move`, `test`...) were applied as `replace`; array indexes went
through `Number()`, so `""`, `" 1"`, `"1e0"` and `"01"` were accepted; a path without a leading
`/` was read as if it had one; `replace` and `remove` one past the end of an array were allowed.
**Prototype pollution was tested and is not possible**: object keys are written with
`defineProperty` and read only when own, so `/__proto__/x`, `/constructor/prototype/x` and
`/a/__proto__` throw, and an own `__proto__` key stays data.

**Fix.** Only `add`, `remove` and `replace`; RFC 6901 index syntax; `-` only for `add`; paths
must be empty or start with `/`. Everything `diff()` produces still applies (property tests
unchanged and passing).

### N-12 (Low): example servers

**What.** The four example servers signed resume tokens with a secret hard-coded in the repo
whenever `NODE_ENV` was not `production`: anyone could sign a token for any guest of an example
deployed without `NODE_ENV=production` (seat takeover, and in blackjack the guest's wallet
balance). Static responses also had no `X-Content-Type-Options` or anti-framing header.

**Fix.** The examples read `SHOEHIVE_SECRET` only; without it `createServer` uses a random
secret outside production and refuses to start in production. Static responses in the examples
and both templates now send `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` and
`Content-Security-Policy: frame-ancestors 'none'`. (The templates' hard-coded secret is the
companion review's P-01.)

**Checked by hand** (blackjack example on a local port): `/..%2f..%2fpackage.json` gives 404,
`/%2e%2e/%2e%2e/package.json`, `/..%5c..%5cpackage.json` and `/%00` fall back to `index.html`,
a bad escape gives 400, and the three headers are present. The traversal check
(`resolve` + prefix with separator) was already correct.

### N-13 (Medium): `attach()` leaves upgrades for unknown paths open

Tracked separately: the owner started a dedicated session for it, so this review does not
change that behaviour. Note for that session: the examples and templates use `attach()` with
the default `unknownUpgrades: 'ignore'` and no other upgrade handler, so on them an upgrade to a
random path holds a socket until the client closes it.

### N-14 (Info): guest resume tokens are bearer tokens

Anyone who copies a guest's token (from `localStorage`, for example through XSS in the game's
own page) becomes that guest until the token expires (7 days, sliding), and every token issued
stays valid until its own expiry, so replay works. Two tabs with one token share one player by
design. There is no per-token revocation; rotating the secret revokes all. **Accepted** per ADR
0010 (documented as unsuitable for money; the server warns when a wallet is used with guests in
production). Verified: HMAC-SHA256 over the exact payload text, constant-time comparison after a
length check, `exp` enforced, unknown `kid` rejected, and with custom `auth` the token never
changes identity (only `resumed` when `sub` matches). Fixation needs write access to the
victim's storage, which an attacker who has it does not need.

### N-15 (Low): no limit on connections per address or per player

Rate limits, in-flight limits and buffers are per connection, so N connections get N times the
budget, and there is no global connection cap. Shoehive cannot see real client addresses behind
a proxy, so per-address limits belong there. **Accepted**, documented in protocol section 9. A
connection that never sends `hello` is closed after 10 s.

### N-16 (Low): no limit on tables joined per connection

A connection may join every table (each join costs a document per commit, and joined tables never
idle-expire). Bounded in practice by `maxTables` (N-03) and the per-connection rate limit.
**Deferred**: a `maxJoinedTables` limit is cheap, but the right default depends on spectator use
cases (lobby previews) the owner should weigh. Recommended after 1.0.

### N-17 (Info): `dev` defaults from `NODE_ENV`

When `NODE_ENV` is unset in production, `dev` is true: `INTERNAL` errors carry game exception
messages, a random resume secret is allowed, and `devtools: true` would be honoured (devtools
still requires its token and loopback, ADR 0011). **Accepted**, documented; operators should set
`NODE_ENV=production` or `dev: false`.

## 5. Probed with no finding

- **Parsing.** `parseClientMessage` never throws (non-object JSON, wrong types, `__proto__`
  keys tested); unknown fields are dropped; ids, table ids, names and resume tokens are
  length-capped; `ws` enforces `maxMessageBytes` in bytes and rejects invalid UTF-8;
  permessage-deflate is off by default in `ws` 8 (no decompression bombs); binary frames are
  closed with 1003; three violations in 60 s close with 4002.
- **Authorization.** `act`, `seat.take` and `seat.leave` need a join; the engine checks that
  the acting player holds the seat (`NOT_SEATED`), so spectators and other players cannot act
  for a seat; `act.seat` for another player's seat is refused.
- **View leakage.** Snapshots and patches carry only `view()` output, `meta`, `seats`,
  `spectators` and `you`; events honour their audience; `act` results and rejection details
  go to the actor only; `meta.timers` lists visible timers only; dev forks are hidden from the
  lobby. In production `INTERNAL` errors from game code say `Internal error`.
- **Log injection.** The logger takes structured data; logged request types are from the
  closed set; guest names exclude control characters (and now separators, N-10).
- **Timers.** Clients cannot create timers; game timers are bounded by game code.
- **Lobby.** One subscription per connection, filter capped at 64 games; repeated `lobby.sub`
  is rate-limited and now bounded by N-02.

## 6. Protocol and API changes

All additive (protocol section 10):

- `player.rename` result: `resumeToken`, `resumeExpiresAt`.
- `table.create`: `FORBIDDEN` with `details: { limit }` for the table limits.
- New limits: `maxBufferedBytes`, `maxTablesPerPlayer`, `maxTables` (in `ServerLimits`), and
  a fixed nesting limit of 32 for `act.input` and `table.create.options`.
- Stricter validation: finite numbers in `input` and `options`, more characters refused in
  names, a second `hello` refused.
- `Connection.terminate?()` (optional) in `shoehive/server`'s transport interface.
- Startup warning for `auth` without `origins`.
