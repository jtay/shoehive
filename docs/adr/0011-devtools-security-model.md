# ADR 0011: Devtools security model

|         |                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------- |
| Status  | Accepted, 2026-11-14                                                                              |
| Related | RFC 0001 sections 5.3, 7 (Devtools), 11 (Devtools), 12 (Phase 6), 13; ADRs 0006, 0007, 0009, 0010 |

## Context

`shoehive/devtools` is a full inspector: live tables, raw state, every seat's view side
by side, the action log with timings and rejections, sessions and connections, and
replay, time travel, fork and export-as-fixture. That is exactly the information a
cheater wants: raw state contains every hole card, and the `create` entry contains the
RNG seed, which predicts every future card (ADR 0006). RFC 0001 section 13 lists "devtools exposed in
production" as a risk. Phase 6 exits only if devtools are "off and unreachable in
production mode".

## Decision

### Enabling

```ts
type DevtoolsOption =
  | boolean
  | {
      enabled: boolean;
      token?: string; // required in production; generated in dev if omitted
      path?: string; // default '/__shoehive'
      allowRemote?: boolean; // default false: loopback clients only
      allowInProduction?: boolean; // default false
    };
```

1. Default is off. `devtools: true` enables it only when `NODE_ENV !== 'production'`.
2. In production, `devtools: true` is ignored with a warning. Enabling there needs
   `{ enabled: true, allowInProduction: true, token }` with a token of at least 32
   characters; otherwise `createServer` throws. Production use is meant for a short,
   deliberate debugging session, and the startup log says devtools is live.
3. **A token is required whenever devtools is enabled.** In dev, if none is given, the
   server generates 32 random bytes and logs the full inspector URL once at startup,
   for example `http://localhost:3000/__shoehive/#token=...`.
4. In dev, requests from non-loopback addresses get 404 unless `allowRemote: true`.
   This keeps devtools off the LAN at hackathons and in shared Docker networks.

### Mounting and authentication

5. Devtools is served on its own HTTP path (`/__shoehive`, static UI) and its own
   WebSocket path (`/__shoehive/ws`). It is **never on the game socket path**. The game
   protocol (RFC 0001 section 6) has no devtools messages, and a game connection cannot be upgraded
   into a devtools connection.
6. The UI reads the token from the URL fragment (never sent to the server in a request
   line, so it does not land in access logs), then sends it as the first message on the
   devtools socket. HTTP endpoints take `Authorization: Bearer`. Comparison is constant
   time. Five failed attempts from one address in a minute lock that address out for a
   minute.
7. When devtools is disabled, nothing is mounted: its paths return the server's normal
   404 and the devtools module is not even imported (dynamic import on enable).
8. Responses carry `Cache-Control: no-store`, a strict `Content-Security-Policy`
   (`default-src 'self'`), `X-Frame-Options: DENY` and `Referrer-Policy: no-referrer`.
9. Every authenticated devtools session and every export is logged at `warn` with the
   remote address.

### Live tables are read-only

10. Against live tables, devtools can only read: state, engine state, per-viewer views,
    log entries, the rejection ring buffer (ADR 0006), sessions and connection stats.
    There is no endpoint to act, edit state, move seats, fire timers or kick players.
    Operator actions stay in the typed server admin API.
11. The view-as-viewer panel calls `view()` on the committed state, exactly as sync
    does (ADR 0003), so what devtools shows per seat is what that seat receives.

### Replay, time travel and fork work on copies

12. **Time travel** builds a new `TableRuntime` by `replay()` from the stored log up to
    the chosen `seq` (ADR 0006), reading entries through `Store.readLog` (ADR 0009). It
    runs in an isolated sandbox: no transport, a fake clock, no store writes, and a
    fresh `MemoryWallet` seeded from recorded balances (ADR 0007). The live table is
    never paused or touched.
13. **Fork** turns such a copy into a dev table: id prefixed `dev_`, flagged `dev: true`,
    hidden from the lobby, not persisted, always using a `MemoryWallet`. A developer can
    join it from the normal client and play on from that point. Forks are refused in
    production even when devtools is enabled there.
14. **Export as fixture** downloads JSON that `shoehive/testing` replays:

```ts
interface Fixture {
  shoehiveFixture: 1;
  game: string;
  version: number;
  entries: LogEntry[]; // includes the 'create' entry and its seed
  expect?: { rev: number; stateHash: string };
}
// shoehive/testing
const t = replayFixture(blackjack, fixture); // a test table at the last entry
```

    Export replaces player ids with `p0`, `p1`, ... and drops names and metadata. The
    seed is kept, because without it the fixture cannot replay. The download dialog
    states that a fixture from a production table reveals that table's cards.

## Consequences

### Positive

- Developers get the full inspector with zero setup in dev, behind a token they never
  have to type (the logged URL).
- Production is safe by default: devtools is not mounted, not imported, unreachable.
- Read-only live access plus copy-based time travel means debugging can never corrupt a
  running game or move money.
- Exported fixtures turn bug reports into regression tests directly.

### Negative

- A loopback-only default surprises people running the server in a container or on a
  remote dev box. The 404 is logged with a hint to set `allowRemote: true`.
- Fixtures from production contain the seed and are secrets. We warn; we cannot enforce.
- No live editing means "what if" questions need a fork first. That is deliberate.

## Alternatives considered

### Devtools messages on the game socket

One connection for the UI. Rejected: it puts privileged messages on the most exposed
endpoint, and one protocol bug would leak raw state to players.

### No token in dev

Less friction. Rejected: browsers let any website open a WebSocket to localhost, so an
unauthenticated local inspector is readable by any page the developer visits.

### Live state editing and action injection

Handy for debugging. Rejected: it breaks "state only changes through actions, hooks or
timers" and makes the log no longer the source of truth. Forks cover the use case.
