# Security review 1.0: platform (devtools, stores, wallet, engine, scaffolder, CI)

|           |                                                                                                                                           |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Phase     | 8 (pre-1.0 security review)                                                                                                               |
| Date      | 2026-11-16                                                                                                                                |
| Scope     | `shoehive/devtools`, the four stores, the wallet path, the engine, `shoehive/cards`, `shoehive/testing`, the scaffolder, CI and packaging |
| Companion | [review-1.0-network.md](review-1.0-network.md): server, protocol, transports, tokens, client                                              |
| Result    | 1 High, 6 Medium and 6 Low findings fixed (10 with regression tests, 3 in CI configuration and docs); 11 accepted                         |

## 1. Scope

- `packages/shoehive/src/devtools/`: `server.ts`, `protocol.ts`, the inspector UI in `ui/`, and
  how `src/server/server.ts` mounts it (read only here), against ADR 0011 rule by rule.
- `packages/shoehive/src/store/`: memory, SQLite, Postgres and Redis adapters.
- `packages/shoehive/src/core/wallet.ts` and the wallet path in `src/core/runtime.ts`.
- `packages/shoehive/src/core/runtime.ts`, `define.ts`, `random.ts`, `errors.ts`, `guard.ts`:
  determinism, RNG secrecy, what errors and diagnostics reveal.
- `packages/shoehive/src/cards/` and `src/testing/`.
- `packages/create-shoehive`: CLI, rendering, both templates.
- `.github/workflows/*.yml`, lifecycle scripts, `pnpm-workspace.yaml`, and what
  `npm pack --dry-run` ships for `shoehive` and `create-shoehive`.

Out of scope (companion review): `src/server/*`, `src/protocol/*`, `src/client/*`,
`src/react/*`, `src/core/diff.ts`, `src/core/json.ts` and the example servers.

## 2. Method

Three attackers were modelled:

- **A web page** the developer visits while a dev server runs on their machine (cross-site
  requests, WebSockets to localhost, DNS rebinding, top-level navigation).
- **A game client** with no account, who controls action input, names and timing, and
  tries to learn hidden state or move money.
- **The supply chain**: a compromised dependency or third-party action running in CI.

Each area was read against its ADR (0006, 0007, 0009, 0011) and RFC 0001 sections 7 and 13,
then probed with scratch scripts: a real Postgres 16 and Redis 7 for the adapters, a real
server and `ws` clients for devtools, and `git ls-remote` for every action reference in the
workflows. Every fix has a regression test that was written first and seen to fail against
the unfixed code, then pass with the fix (the Postgres one by stashing the fix).

Severity is judged for a typical deployment: a public game server, devtools only in
development, optionally a wallet backed by the integrator's ledger.

All tests named below are in `packages/shoehive/test/` unless the path says otherwise.

## 3. Findings

| ID   | Severity | Title                                                                                 | Status                                                                                                                                                                  |
| ---- | -------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-01 | High     | Every scaffolded project shares one hard-coded resume-token secret                    | Fixed: `packages/create-shoehive/test/template.test.ts` "ships no fixed resume-token secret (security review P-01)" (both templates)                                    |
| P-02 | Medium   | DNS rebinding reaches the loopback-only devtools socket                               | Fixed: `devtools/server.test.ts` "refuses DNS-rebound host names on HTTP and on the socket, even from loopback"                                                         |
| P-03 | Medium   | A reverse proxy on the same host makes loopback-only devtools public                  | Fixed for proxies that add forwarding headers: `devtools/server.test.ts` "treats a request relayed by a same-host proxy as remote"                                      |
| P-04 | Medium   | `ctx.wallet.reserve` passes any amount to the backend                                 | Fixed: `core/wallet.test.ts` "refuses reserve amounts that are not non-negative safe integers, before the backend"                                                      |
| P-05 | Medium   | A wallet failure the game catches breaks replay: lost tables or a different state     | Fixed: `core/wallet.test.ts` "records a wallet failure the game caught, so the entry replays (restart recovery)"                                                        |
| P-06 | Medium   | Fixture export keeps real player ids in options, and silently in inputs               | Fixed: `devtools/server.test.ts` "replaces player ids inside table options", "says so when ids inside inputs and options had to be kept for the fixture to replay"      |
| P-07 | Medium   | The release job runs the whole test suite with publish rights; actions not pinned     | Fixed in `.github/workflows/*.yml` (no automated test; every pin checked with `git ls-remote`)                                                                          |
| P-08 | Low      | ChaCha20 block counter wraps after 2^36 words                                         | Fixed: `core/primitives.test.ts` "refuses to wrap the 32-bit ChaCha20 block counter (keystream reuse)"                                                                  |
| P-09 | Low      | Table ids with `:` let two tables share a wallet key                                  | Fixed: `core/wallet.test.ts` "refuses table ids that could make two tables share a wallet key"                                                                          |
| P-10 | Low      | Postgres truncates long schema or table names, so two tables become one               | Fixed: `store/postgres.test.ts` "refuses schema and table names Postgres would truncate or cannot hold"                                                                 |
| P-11 | Low      | `--shoehive` is rendered unescaped into the generated `package.json`                  | Fixed: `packages/create-shoehive/test/template.test.ts` "keeps a --shoehive spec inside its JSON string", "escapes values for HTML and JSON, and leaves Markdown as is" |
| P-12 | Low      | Docs: the Postgres `tablePrefix` default is wrong                                     | Fixed in `docs/reference/stores.md`                                                                                                                                     |
| P-13 | Low      | Docs: nothing says table options and metadata reach every client                      | Fixed in the hidden-information how-to                                                                                                                                  |
| A-01 | Low      | Lockout is per address: a shared proxy address locks everyone out                     | Accepted: the 256-bit token, not the lockout, is the protection                                                                                                         |
| A-02 | Low      | Unauthenticated devtools sockets are not counted                                      | Accepted: loopback only by default, each closes after 10 s                                                                                                              |
| A-03 | Low      | Whoever can write the store controls state, the seed and re-sent wallet ops           | Accepted: the store is trusted like the server secret (ADR 0006, 0009)                                                                                                  |
| A-04 | Low      | A reservation made by an entry that never reached the store stays held                | Accepted: ADR 0007's documented window; backends should expire holds                                                                                                    |
| A-05 | Low      | A web page can lock the developer out of devtools for a minute                        | Accepted: denial of service only, needs five navigations                                                                                                                |
| A-06 | Low      | With `allowRemote: true`, DNS rebinding and plain-HTTP token sniffing remain possible | Accepted and documented: there the token (and TLS) is the protection                                                                                                    |
| A-07 | Low      | `npm start` in a generated project runs in development mode without `NODE_ENV`        | Accepted: documented in the template README; P-01 removed the shared secret                                                                                             |
| A-08 | Info     | The devtools token is logged at startup in development                                | Accepted: ADR 0011 rule 3                                                                                                                                               |
| A-09 | Info     | `randomTableId` has a small modulo bias                                               | Accepted: table ids are public                                                                                                                                          |
| A-10 | Info     | A stray `.env` under `templates/` would be published and copied into projects         | Accepted: templates are reviewed file by file; `check-package.mjs` lists them                                                                                           |
| A-11 | Info     | The devtools fork log line has no remote address                                      | Accepted: rule 9 covers sessions and exports                                                                                                                            |

Areas checked with no finding are listed in section 5.

## 4. Details

### P-01 (High): every scaffolded project shares one hard-coded resume-token secret

**What.** Both templates' `src/server.ts` passed
`secret: process.env.SHOEHIVE_SECRET ?? (dev ? 'dev-only-secret-not-for-production-use' : undefined)`,
with `dev = NODE_ENV !== 'production'`. The template's `start` script is
`tsx src/server.ts` and does not set `NODE_ENV`, so `npm run build && npm start` (the
documented way to serve the built app) used that literal, which is the same in every project
`create-shoehive` has ever generated and is public on npm.

**Reproduction.** Scaffold a project, `npm run build && npm start`, without `NODE_ENV`. Sign
`v1.<payload>` with HMAC-SHA256 keyed by `dev-only-secret-not-for-production-use` (see
`src/server/tokens.ts`) for any guest id seen in the lobby or a table, and resume as that guest:
their seat, their session, and with a wallet their money.

**Fix.** The templates read `secret: process.env.SHOEHIVE_SECRET` only. `vite.config.ts` hands
the game server a random `SHOEHIVE_SECRET` per `npm run dev` session (as it already did for the
devtools token), so resume across `tsx watch` restarts still works. Without it, a development
server generates a random secret and warns; a production one refuses to start. The tutorial
text now says never to write a secret into code.

### P-02 (Medium): DNS rebinding reaches the loopback-only devtools socket

**What.** Rule 4 serves only loopback clients, and the Origin check refuses cross-site pages.
The Origin check accepted any `Origin` whose host equals the request's `Host`. A page on
`rebind.example` whose DNS answer switches to 127.0.0.1 makes the browser connect from
loopback with `Host: rebind.example:3000` and `Origin: http://rebind.example:3000`: both checks
passed. ADR 0011 says a web page can neither guess the token nor trigger the lockout; this page
could do both. With the generated 256-bit token guessing is hopeless, but a developer's own
short `token` (development only warns below 32 characters) could be brute forced at 5 tries a
minute, and the page could keep the developer locked out.

**Reproduction.** In the test: a `ws` client sending those two headers to `/__shoehive/ws` on
a server bound to 127.0.0.1 got a socket and could send `auth` (before the fix).

**Fix.** Without `allowRemote`, the `Host` must be an IP literal, `localhost`, a `.localhost`
name (RFC 6761: browsers resolve those to loopback themselves, so a rebinding page cannot use
them) or the host of an entry in the server's `origins` option. Anything else gets the 404 and
a one-time hint in the log. An IP literal is safe: a page can only have that origin if it is
served from this machine. HTTP and the socket share the check.

### P-03 (Medium): a reverse proxy on the same host makes loopback-only devtools public

**What.** A proxy on the same machine (nginx, Caddy, a platform router sidecar) connects to the
server from 127.0.0.1, so "loopback only" served the inspector to anyone the proxy serves.
The token still guarded it, but rule 4's promise ("keeps devtools off the LAN") did not hold.

**Reproduction.** `GET /__shoehive/` from 127.0.0.1 with `X-Forwarded-For: 203.0.113.9`
returned the UI (before the fix).

**Fix.** Without `allowRemote`, a request carrying `Forwarded`, `X-Forwarded-For` or
`X-Real-IP` is treated as remote. This covers proxies that add those headers (Caddy and
Traefik by default, most nginx configurations). A bare `proxy_pass` that adds none and
rewrites `Host` to `127.0.0.1` is indistinguishable from a local client: keep devtools off in
production (the default) and the token is the remaining protection.

### P-04 (Medium): `ctx.wallet.reserve` passes any amount to the backend

**What.** `credit` checked for a non-negative safe integer; `reserve` did not. A game whose
input schema is `z.number()` instead of `z.number().int().nonnegative()` (an easy mistake)
passed a client's `-500` or `1.5` straight to the integrator's ledger. A backend that trusts
the engine (`balance -= amount`) turns a negative bet into a deposit. `MemoryWallet` checks, so
tests did not show it.

**Reproduction.** The test's `bet` action with a recording wallet: `act('bet', { amount: -500 })`
reached `wallet.reserve('p0', -500, ...)` (before the fix).

**Fix.** `reserve` throws a `RangeError` (an `INTERNAL` rejection, so the entry rolls back)
before calling the backend, exactly like `credit`. ADR 0007 already defined `Amount` this way.

### P-05 (Medium): a wallet failure the game catches breaks replay

**What.** ADR 0007 rule 5 lets a game catch `WALLET_UNAVAILABLE` and carry on. Such a failed
call recorded no effect. On replay (restart recovery, devtools time travel, fixtures) the same
call consumed the next recorded effect, or found none and threw a `ReplayDivergenceError`
inside the game's own `try`. Depending on the game, recovery then failed with `REPLAY_DIVERGED`
(the table is lost until an operator intervenes) or, worse, succeeded into a different state
than players saw (a bet that was refused live is accepted after the restart). The same applied
to an empty-seat `TypeError` the game caught, because the seat was checked after the replay
lookup.

**Reproduction.** A game that reserves `a` inside `try`, catches `WALLET_UNAVAILABLE`, then
reserves `b`: live state `['a unavailable', 'b ok']`; replay gave `a` the result of `b` and
then diverged.

**Fix.** A failed live `reserve` or `balance` records an effect with
`error: { code, message }` (new optional field on `WalletEffect`, new exported type
`WalletFailure`); replay throws the same `ShoehiveError` at the same call. The seat and the
amount are checked before the recorded effect is looked up, so those errors replay too. The
failed reserve's backend key is still released after commit, live and in replayed bookkeeping.
Devtools forks ignore failed balance effects when seeding their wallet. ADR 0007 has an
implementation note.

### P-06 (Medium): fixture export keeps real player ids in options, and silently in inputs

**What.** ADR 0011 rule 14 says export replaces player ids. It did so in the engine's fields
and, if that still replayed, in action and timer inputs. It never touched the `create`
entry's table options (a game option such as `{ host: '<player id>' }` leaked), and when the
anonymized inputs did not replay it fell back to keeping the real ids in inputs without saying
so. With `auth`, player ids are the integrator's (often an email or account number).

**Reproduction.** In the tests: a table created with `{ options: { host: aliceId } }` exported
a fixture containing `aliceId`; a game that checks `input.text.startsWith('g_')` exported its
guest ids with the usual warning.

**Fix.** The deep pass also anonymizes table options. If that pass does not replay, the
fixture keeps ids in inputs and options and the warning (shown in the export dialog) says so.
The warning and the docs now list what every fixture keeps besides the seed: free text in
inputs such as chat, the table id, timestamps and wallet balances the game read. An id
embedded in a longer string is not recognised; that is documented rather than guessed at.

### P-07 (Medium): the release job runs the whole test suite with publish rights

**What.** `release.yml` granted `contents: write`, `pull-requests: write` and `id-token: write`
to its only job, which also ran `pnpm check`: every test, the docs snippet compiler, the
build, and so all their dependencies. `actions/checkout` persisted the write token in
`.git/config`, and `id-token: write` lets any step mint the OIDC token npm trusted publishing
accepts. Any compromised dev dependency loaded by a test could push to `main` or publish
`shoehive` with valid provenance. All actions were referenced by mutable tags, two of them
third-party (`pnpm/action-setup`, `changesets/action`) in that privileged job. Also,
`changesets/action@v2` does not exist (the project tags only full versions such as `v2.1.2`),
so the job could not have started.

**Fix.** `release.yml` now has a `check` job with `contents: read` that runs `pnpm check`,
and a `release` job (needs `check`) that only installs, builds and publishes with the write
permissions, without a dependency cache. Every action in the three workflows is pinned to a
commit SHA with the release in a comment (`actions/checkout` v7.0.1, `pnpm/action-setup`
v6.1.1, `actions/setup-node` v7.1.0, `actions/upload-pages-artifact` v5.0.0,
`actions/deploy-pages` v5.0.1, `changesets/action` v2.1.2). Checkouts no longer persist
credentials (`changesets/action` v2.1.2 pushes with its own `github-token` input). Recommended
follow-up for the owner: let Dependabot (`github-actions` ecosystem) keep the pins current.

Checked and fine: `ci.yml` and `docs.yml` use `pull_request`, never `pull_request_target`; their
token is read only; the Pages deploy job is the only one with `pages: write` and runs only on
`main`; secrets are used only by the release job.

### P-08 (Low): ChaCha20 block counter wraps after 2^36 words

**What.** `WordStream.word()` put `floor(index / 16)` into the 32-bit counter with `>>> 0`, so
word 2^36 equalled word 0: the keystream would repeat and past draws would predict future
ones. Unreachable in practice (68 billion draws on one table).

**Fix.** `word()` throws a `RangeError` for an index outside `[0, 2^36)`. Noted in ADR 0006.

### P-09 (Low): table ids with `:` let two tables share a wallet key

**What.** Backend keys are `<table>:<game key>`. Table `a:b` with key `c` and table `a` with key
`b:c` both produce `a:b:c`, so one table's credit could be deduplicated against the other's,
or conflict. Generated ids never contain `:`; only ids passed to
`shoehive.tables.create(game, { id })` could.

**Fix.** `TableRuntime.create` refuses an empty id or one containing `:` with a `TypeError`.

### P-10 (Low): Postgres truncates long schema or table names

**What.** Identifiers are quoted correctly (no injection), but Postgres silently truncates them
to 63 bytes. With a 62-byte `tablePrefix`, `snapshots` and `sessions` both became `<prefix>s`:
on a real Postgres 16, session writes then failed with `column "player_id" ... does not exist`.
Two apps whose long prefixes share 63 bytes would share tables.

**Fix.** `postgresStore` and `migratePostgres` throw a `TypeError` for an empty schema, a NUL,
or a schema or `<prefix><table>` longer than 63 bytes (so the prefix is at most 52 bytes).

### P-11 (Low): `--shoehive` is rendered unescaped into `package.json`

**What.** `{{shoehiveVersion}}` was substituted raw into `"shoehive": "{{shoehiveVersion}}"`, so
`--shoehive '1.0.0", "postinstall": "..."'` added keys. It is the user's own argument, but a
copied command line from a malicious tutorial would install a script.

**Fix.** Values are JSON-escaped in `.json` files and HTML-escaped in `.html` files. Package
names were already restricted to a safe alphabet.

### P-12 and P-13 (Low, docs)

`docs/reference/stores.md` said the Postgres `tablePrefix` defaults to `'shoehive_'`; it is
empty (only SQLite defaults to `shoehive_`). Fixed, with the new length limits. The
hidden-information how-to now says that table options, the result, seat names and visible
timer deadlines reach every client whatever `view()` returns, so a private table's password or
an answer key must live in state.

### Accepted risks

- **A-01.** Five failures a minute per address. Behind a proxy with `allowRemote`, everyone
  shares the proxy's address, so one client can lock out the rest; IPv6 clients can rotate
  addresses. The generated token has 256 bits, so the lockout only slows a hopeless search.
- **A-02.** Unauthenticated devtools sockets are not counted; each is closed after 10 s without
  `auth`. Only loopback clients can open them by default.
- **A-03.** The store is trusted. A snapshot or log written by an attacker sets any state and
  seed, and recovery re-sends the snapshot's pending wallet ops, credits included, to the real
  wallet. Protect the store like `SHOEHIVE_SECRET` (ADR 0006 already calls the seed a secret),
  and let the wallet backend reconcile credits against its own records.
- **A-04.** If the process dies after a successful `reserve` but before the entry reaches the
  store, the entry is not in the log and nobody releases the hold. ADR 0007 documents the
  window; backends should expire holds that were never committed.
- **A-05.** A page can navigate the developer's browser to `/__shoehive/#token=wrong` five times:
  that tab connects from loopback with a same-host Origin and locks the developer out for a
  minute. No data is exposed.
- **A-06.** With `allowRemote: true` the `Host` and forwarding checks are off, so DNS rebinding
  works again and the token travels in the first socket message. The devtools reference now
  says to keep the token secret and use TLS there.
- **A-07.** The generated `npm start` runs in development mode unless `NODE_ENV=production` is
  set: devtools on (loopback, random token), detailed error messages. The template README's
  deploy section and the deploying how-to set `NODE_ENV=production`, and the scaffolder's
  end-to-end test relies on the development behaviour. After P-01 nothing secret is shared.
- **A-08.** In development the inspector URL with its token is logged once at `warn` (ADR 0011
  rule 3); log collectors on a shared dev box see it.
- **A-09.** `randomTableId` maps bytes with `% 36` (a small bias over 9 characters). Table ids
  are public and never derived from the seed.
- **A-10.** npm does not exclude `.env` files, and `copyTemplate` copies everything except
  `node_modules`, `dist`, `dist-web` and `.DS_Store`. A `.env` left under `templates/` would be
  published and copied into every project. Templates are reviewed file by file and
  `scripts/check-package.mjs` lists what is packed.
- **A-11.** "Devtools forked a table" is logged without the remote address. Forks are refused
  in production; rule 9 names sessions and exports.

## 5. Checked with no finding

**Devtools, ADR 0011 rule by rule.**

- Rules 1 to 3: `resolveDevtools` ignores `devtools: true` in production, throws without
  `allowInProduction` or with a token under 32 characters, and generates 32 random bytes
  otherwise.
- Rule 5: the game socket has no devtools messages, and devtools refuses a game socket path
  inside its own.
- Rule 6: the token is compared in constant time (SHA-256 both sides, then `timingSafeEqual`).
  The lockout check comes before the comparison, so a locked address cannot test the right
  token. The UI reads the token from the fragment, removes it with `history.replaceState` and
  keeps it only in `history.state`.
- Rule 7: when disabled, the module is never imported (existing test).
- Rule 8: CSP `default-src 'self'` with no `unsafe-*`, `frame-ancestors 'none'`, `nosniff`,
  COOP, CORP, `no-store`, `X-Frame-Options`, `Referrer-Policy`. The `Host` value interpolated
  into `connect-src` is validated against a strict pattern.
- Rule 9: sessions and exports are logged at `warn` with the remote address.
- Rules 10 and 11: there is no request type that acts, edits, seats or fires timers. Requests
  are validated (ids, seq ranges, at most 5,000 log entries and 8 requests in flight).
- Rules 12 and 13: copies replay with a frozen clock, no `persist` and a fresh `MemoryWallet`.
  Forks get no `persist`, are skipped by snapshots and `closeTable` (`entry.dev`), and their
  wallet is a `MemoryWallet` seeded from recorded balances; existing tests prove the real
  wallet and store are untouched.
- **UI.** Every untrusted string (player names and ids, state, views, diagnostics, error
  messages) is a Preact text child; there is no `innerHTML` or `dangerouslySetInnerHTML`, no
  untrusted `href`, and the download uses a Blob URL with a sanitized file name. Preact refuses
  JSON-shaped objects as vnodes. New tests in `devtools/ui.test.ts`
  ("untrusted strings in the inspector") render script and `onerror` payloads through the seats
  card, the diagnostics card and the JSON tree, and a vnode-shaped state object, and find no
  element created. The real-browser Playwright devtools suite passes with the new checks.

**Stores.**

- SQLite: every value is a bound parameter; `tablePrefix` must match `^[A-Za-z_][A-Za-z0-9_]*$`.
- Postgres: every value is a parameter; identifiers are double-quoted with `"` doubled; the
  advisory lock key is a parameter.
- Redis: keys are `<prefix><kind>:<id>` with the id last, so ids cannot collide with each other
  or with the fixed keys; the Lua scripts take every id and value as `KEYS` or `ARGV`, never as
  script text; seqs are checked to be integers.
- Stored JSON is parsed into plain objects, and spreading a parsed `__proto__` key defines an
  own property, so a stored record cannot pollute prototypes. Malformed records throw, and
  recovery reports that table and goes on with the others.

**Wallet and engine.**

- Keys are prefixed with the table id, and each reserve attempt gets a random suffix. A
  rolled-back entry releases every key it tried, including timed-out ones (tombstones make a
  late success safe). Deferred ops are sent only after the store has the entry, in order, with
  retries. `MemoryWallet` implements the conflict and tombstone rules. No path was found that
  spends the same reservation twice or moves money for an entry that was not committed.
- The seed comes from `crypto.getRandomValues`, lives only in engine state, the `create` entry
  and snapshots, and never reaches `view()`, `meta`, events or acks. Game code gets
  `ctx.random`, not the seed. Recorded `draws` are in the log only, which only devtools and the
  store hold.
- ChaCha20 matches the RFC 8439 vector (existing test). `int` is unbiased (rejection
  sampling), `shuffle` is Fisher-Yates and `float` has 53 bits.
- In production a non-`ShoehiveError` from game code reaches clients as
  `INTERNAL: Internal error`; only `reject(code, details)` chooses what a client sees.
  Diagnostics and `view() threw` messages appear only in devtools.

**Cards and testing.** `evaluateHand`, `splitPots` and `awardPots` were read against the rules
they document; no correctness problem found. Shuffling goes through `ctx.random`.
`replayFixture` replays with a fresh `MemoryWallet` unless given one, and never re-sends
history.

**Scaffolder.** Commands run with `spawnSync` and constant arguments; the target directory is
only a `cwd`, never part of a command line (also on Windows, where `shell: true` is used for the
`.cmd` shims). Package names derived from directory names are restricted to
`[a-z0-9-~._]`. The target must be empty except for `.git`.

**Packaging.** `shoehive` ships `dist/` and `LICENSE` (source maps contain no local paths);
`create-shoehive` ships `dist/index.js`, the templates, `README.md` and `LICENSE`. No workspace
package has an install-time lifecycle script, and `onlyBuiltDependencies` allows only
`better-sqlite3` and `esbuild` to run build scripts.

## 6. Public API changes

All additive or a tightening of what was already documented:

- `WalletEffect` variants gain an optional `error?: WalletFailure`; `WalletFailure`
  (`{ code, message }`) is exported from `shoehive`.
- `ctx.wallet.reserve` throws `RangeError` for amounts that are not non-negative safe integers.
- `TableRuntime.create` (and so `shoehive.tables.create`) throws `TypeError` for an empty id or
  one containing `:`.
- `postgresStore` and `migratePostgres` throw `TypeError` for names Postgres would truncate.
- Devtools without `allowRemote` refuses relayed requests and DNS host names other than
  `localhost` and `origins` entries. The export warning text is longer.

ADRs 0006, 0007 and 0011, `docs/reference/devtools.md` and `docs/reference/stores.md` are
updated to match.
