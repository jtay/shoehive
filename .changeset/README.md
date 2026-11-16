# Changesets

Every PR that changes the published `shoehive` package adds a changeset:

```sh
pnpm changeset
```

Pick the bump (we are in `next` prerelease mode until 1.0.0, see `pre.json`) and write one or two
sentences for the changelog. Docs-only, CI-only and example-only PRs do not need one.

`shoehive` and `create-shoehive` are a fixed group (`config.json`): they always release
together, with the same version. `create-shoehive` reads that version at build time, so a
project it generates depends on `shoehive@^<the same version>`.
