# ADR 0002: One `shoehive` package with subpath exports

|         |                                                                   |
| ------- | ----------------------------------------------------------------- |
| Status  | Accepted, 2026-11-14                                              |
| Related | RFC 0001 sections 7, 8, 11 (Packaging); audit findings 15, 16, 21 |

## Context

0.x shipped two packages from two repos. The React client pinned `shoehive ^0.6.0`
against a 0.10.0 server, imported the whole server (with `ws` and `crypto`) into the
browser so webpack failed, had React in both `dependencies` and `peerDependencies`, and
had no `exports`, `module` or `types` (findings 15, 16, 21). Version skew between client
and server is a protocol bug waiting to happen.

The stakeholder decided on one package with subpath exports (RFC 0001 section 11). This ADR fixes
the subpath list, the dependency rules and the isomorphism rule.

## Decision

Publish a single npm package, `shoehive@1.x`, from `packages/shoehive/`, plus the
scaffolder `create-shoehive`. The `exports` map has exactly these entries:

| Subpath                   | Contents                                                                                             | Runs in       |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | ------------- |
| `shoehive`                | `defineGame`, `reject`, engine, protocol types, errors                                               | anywhere      |
| `shoehive/server`         | `createServer`, Session, Lobby, transports, `Wallet` / `Store` / `Auth` interfaces, in-memory ledger | Node          |
| `shoehive/client`         | `createClient`                                                                                       | browser, Node |
| `shoehive/react`          | `ShoehiveProvider`, `useTable`, `useLobby`, `useConnection`                                          | browser       |
| `shoehive/cards`          | decks, shoes, hands, `hideCard`, `faceDown`, `ownedBy`                                               | anywhere      |
| `shoehive/testing`        | `createTestTable`, fake clock, replay, fixtures, protocol and store conformance suites               | anywhere      |
| `shoehive/devtools`       | inspector server and UI                                                                              | Node          |
| `shoehive/store/memory`   | default store                                                                                        | anywhere      |
| `shoehive/store/sqlite`   | SQLite adapter                                                                                       | Node          |
| `shoehive/store/postgres` | Postgres adapter                                                                                     | Node          |
| `shoehive/store/redis`    | Redis adapter                                                                                        | Node          |

Dependencies:

- `dependencies`: `mutative` (core) and `ws` (server). Nothing else.
- `peerDependencies`, all marked optional in `peerDependenciesMeta`:
  `react` (`>=18`), `better-sqlite3`, `pg`, `ioredis`. Version ranges are set in Phase 0
  to the current majors.
- No validator (ADR 0004), no logger, no HTTP framework.
- Each store adapter accepts either connection options or an existing client instance
  (for example `postgresStore({ pool })`), so integrators control pooling and TLS.

The isomorphism rule: **`shoehive`, `shoehive/client`, `shoehive/react`,
`shoehive/cards`, `shoehive/testing` and `shoehive/store/memory` must never import a
Node builtin, `ws`, or any server-only module.** They use Web platform APIs only
(`globalThis.crypto.getRandomValues`, `TextEncoder`, `queueMicrotask`). The protocol and
store conformance suites in `shoehive/testing` take the transport or store under test as
a parameter, so the suites themselves never import `ws` or a driver. It is enforced
three ways, all blocking in CI:

1. ESLint `no-restricted-imports` in those source folders bans `node:*`, bare builtin
   names, `ws`, and relative imports into `src/server`, `src/devtools` and `src/store/*`
   (except `memory`).
2. A CI step bundles each isomorphic entry with esbuild `platform: 'browser'` and fails
   if any Node builtin is resolved.
3. `publint` and `@arethetypeswrong/cli` check the `exports` map, the `types`
   conditions and dual ESM and CJS output from tsup.

Client code imports game definitions with `import type` only (RFC 0001 section 5.4), so no server
or game code reaches a browser bundle. `sideEffects: false` is set so unused subpaths
tree-shake. `engines.node` is `>=20`.

The 0.x React client repository (`shoehive-react-client`, called
`shoehive-client-react` in RFC section 8) is archived on GitHub with a README pointer to
`shoehive/react`, and its npm package is marked deprecated with the same pointer. The
0.x core is tagged `v0.10.0-legacy` before deletion (RFC 0001 section 12, Phase 0).

## Consequences

### Positive

- One install, one version: client and server can never disagree on the protocol.
- No npm org to manage, and one changeset per release.
- Optional peers mean a pure server user never installs React, and a React user never
  installs `pg`.
- The isomorphism checks make finding 15 structurally impossible.

### Negative

- The tarball contains code a given user never loads (adapters, devtools UI). We accept
  the download size; it does not affect bundles.
- A missing optional peer fails at import time of that subpath with Node's
  module-not-found error. The docs for each adapter say which peer to install.
- Breaking changes in one area (say the Redis adapter) force a major of the whole
  package. API Extractor and changesets make that visible; we keep adapters thin so
  this is rare.
- Devtools UI assets ship inside the package and must be built in the same pipeline.

## Alternatives considered

### Scoped packages (`@shoehive/core`, `@shoehive/server`, `@shoehive/react`, ...)

The common monorepo pattern. Rejected: it needs an npm org, brings back version skew
between client and server (the exact 0.x failure), multiplies release and provenance
setup, and makes "which packages do I need?" a docs page instead of a non-question.

### Separate repositories (the 0.x setup)

Rejected outright. It produced findings 14 to 16: the client drifted from the server
constants, pinned an old version, and could not build. Shared protocol schemas in
`src/protocol` only work if client and server are built together.

### One package without subpaths (everything from `shoehive`)

Rejected. Bundlers would have to tree-shake `ws` and Node builtins out of browser
builds, which is fragile, and React would become a hard dependency for server users.
