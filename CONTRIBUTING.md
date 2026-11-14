# Contributing to Shoehive

Thanks for helping. Shoehive v1 is mid-rebuild, so please read
[RFC 0001](docs/rfc/0001-shoehive-v1-rebuild.md) before proposing larger changes.

## Setup

You need Node 22 or newer and pnpm (the exact version is pinned in `package.json`; `corepack enable`
picks it up).

```sh
git clone https://github.com/jtay/shoehive.git
cd shoehive
corepack enable
pnpm install
pnpm check   # format, lint, typecheck, test, build, package checks: the same as CI
```

Useful scripts:

| Command                         | What it does                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm test` / `pnpm test:watch` | Run Vitest                                                                      |
| `pnpm lint` / `pnpm lint:fix`   | ESLint (type-aware)                                                             |
| `pnpm format`                   | Prettier                                                                        |
| `pnpm typecheck`                | `tsc` with strict settings                                                      |
| `pnpm build`                    | Build the package with tsup                                                     |
| `pnpm check:package`            | publint, Are The Types Wrong, and an import/require smoke test of every subpath |

## How we work

- **Spec first.** Changes to the public API, the wire protocol or the engine's guarantees start as
  an ADR in `docs/adr` (copy `template.md`) or an RFC in `docs/rfc`, reviewed before the code.
- **Small PRs** with [Conventional Commits](https://www.conventionalcommits.org/) titles, for example
  `feat(server): add resume tokens`.
- **Tests with teeth.** Unit tests for pure logic, property tests for engine invariants, and real
  sockets (never a mocked `ws`) in integration tests.
- **Done means** code, tests, docs and use in at least one example.
- **Changesets.** If your PR changes the published package, run `pnpm changeset` and commit the file.
  Releases are cut by the Release workflow; never bump versions by hand.
- **Isomorphic code stays isomorphic.** `shoehive`, `shoehive/client`, `shoehive/react` and
  `shoehive/cards` must not import Node built-ins. Lint enforces this.

## Writing style for docs and comments

Plain, direct English. Short pages, one idea each. Every code sample must compile.
