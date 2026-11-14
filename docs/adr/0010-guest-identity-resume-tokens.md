# ADR 0010: Guest identity and resume tokens

|         |                                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------- |
| Status  | Accepted, 2026-11-14                                                                                              |
| Related | RFC 0001 sections 4 (Seat, Player), 5.3, 5.4, 6 (`hello`, `welcome`), 11 (Auth); audit finding 9; ADRs 0006, 0009 |

## Context

Reconnection in 0.x is broken (finding 9). Without an `AuthModule` every socket gets a
random id, so nobody can reconnect. With one, the old socket's `close` handler removes
the player who just reconnected. RFC 0001 decides: guest identity with signed,
expiring resume tokens by default, a custom `auth(req)` hook that replaces guest mode,
a Player that is an identity and not a socket, and a grace period that holds the seat.

## Decision

### Identity model

```ts
interface PlayerIdentity {
  id: string;
  name: string;
  metadata?: Json;
}

type AuthHook = (req: IncomingMessage) => Promise<PlayerIdentity | null> | PlayerIdentity | null;

interface ServerIdentityOptions {
  auth?: AuthHook; // replaces guest mode entirely
  secret?: string | string[]; // HMAC keys; first signs, all verify
  resumeTokenTtlMs?: number; // default 7 days, sliding
  reconnectGraceMs?: number; // default 60_000; a game may override it
}
```

A **Session** is the server's record of one player: identity, the set of open
connections, which tables each connection has joined, and seats held. Sessions are keyed
by player id. Sessions survive their connections; connections never own state.

### Guest mode (no `auth`)

1. On `hello` without a valid `resume`, the server creates a guest: id `g_` plus 128
   random bits in base64url, name `Guest ` plus 4 random base32 characters.
   `hello` may carry an optional `name` (1 to 32 characters after trimming, control
   characters rejected); this is an addition to the RFC section 6 `hello` fields.
2. `welcome` returns the player and a resume token. Every successful `hello`, fresh or
   resumed, issues a new token with a new expiry (sliding window).
3. Token format, compact and URL-safe:

```
v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(key, "v1." + payloadPart))>
payload: { sub: playerId, name: string, iat: number, exp: number, kid: string }
```

Verification uses a constant-time comparison, checks `exp`, and picks the key by
`kid` (a short hash of the key, so rotation works by listing old and new secrets). 4. An invalid, expired or unverifiable token is not an error. The server creates a new
guest and the client sees a different player id in `welcome`. 5. **Secret.** Read from `secret` or, if absent, `SHOEHIVE_SECRET`. Keys must be at
least 32 bytes. When `NODE_ENV=production` and no secret is set, `createServer`
throws. Outside production, the server generates a random secret and logs a warning
that tokens will not survive a restart (set `SHOEHIVE_SECRET` to test restart
recovery locally). 6. The client stores the token (localStorage in browsers by default, memory in Node,
replaceable with a `storage` option) and sends it in `hello.resume`. Tokens never go
in URLs.

### Custom auth

7. `auth(req)` runs once per WebSocket upgrade with the HTTP request (cookies, headers,
   query). Returning a `PlayerIdentity` authenticates; returning `null` rejects the
   upgrade with HTTP 401; throwing rejects with 500 and logs. Browsers cannot set
   headers on WebSocket upgrades, so the docs show cookie and short-lived query ticket
   patterns.
8. With custom auth, identity always comes from `auth(req)`. Resume tokens are still
   issued in `welcome` (the protocol stays uniform) but are ignored on `hello`; the
   session is found by the returned `id`.
9. If a wallet is configured with guest mode under `NODE_ENV=production`, the server
   logs a warning at startup: guest identities are bearer tokens and unsuitable for money.

### Connections, seats and grace

10. A player may have any number of connections (tabs) and may spectate any number of
    tables, but holds at most one seat per table. Any connection that has joined the
    table may act for that seat.
11. A seated player is **disconnected from a table** when none of their open
    connections has joined it. Then the engine records a `disconnect` system entry
    (ADR 0006), runs `onDisconnect`, and marks the seat `reserved` with
    `graceDeadline = now + reconnectGraceMs`, stored in engine state.
12. If a connection of that player joins the table before the deadline, a `reconnect`
    entry runs `onReconnect` and the seat is `occupied` again. Joining from a second tab
    while one is still open produces no entries at all.
13. If the deadline passes, a `grace-expired` entry stands the player up: `onStand` runs
    with `reason: 'grace-expired'` and the seat becomes `empty`.
14. Closing an old socket after a new one exists has no effect on the session beyond
    removing that connection. This is the fix for finding 9, and the Playwright
    kill-the-socket test covers it.
15. Heartbeat: a connection that misses pings for 30 seconds is closed by the server
    and treated like any other close.
16. After a restart, all seated players start disconnected with a fresh grace period
    (ADR 0009 step 5). Session records (name, metadata) persist through
    `Store.sessions`.

## Consequences

### Positive

- Reconnect works from minute one with zero configuration.
- Tokens are stateless to verify: no store lookup on every `hello`.
- Integrators keep their own login; Shoehive never sees passwords.
- Tabs, flaky mobile networks and server restarts all use the same grace path.

### Negative

- Guest tokens are bearer credentials. Anyone who copies one from localStorage becomes
  that guest until expiry. Acceptable for guests; documented as unsuitable for money.
- No per-token revocation in v1. Rotating the secret revokes all tokens at once.
- The dev-generated secret makes restart recovery look broken locally until
  `SHOEHIVE_SECRET` is set. The warning says so.

## Alternatives considered

### JWT

Standard format and tooling. Rejected for the default: algorithm confusion pitfalls,
a larger dependency or a hand-rolled verifier, and nothing gained for a token only we
issue and verify. A built-in JWT verifier for custom auth is on the RFC's after-1.0 list.

### Server-side opaque session ids

Revocable, but every `hello` needs a store lookup and guests would need session rows
before they do anything. Rejected for v1.

### Socket-bound players (0.x)

Rejected: it is the cause of finding 9.

## Open questions

- Should a player be allowed to rename themselves after `hello` (a `player.rename`
  message)? v1 only supports a name at `hello` time.
