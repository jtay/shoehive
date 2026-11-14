# Changesets

Every PR that changes the published `shoehive` package adds a changeset:

```sh
pnpm changeset
```

Pick the bump (we are in `next` prerelease mode until 1.0.0, see `pre.json`) and write one or two
sentences for the changelog. Docs-only, CI-only and example-only PRs do not need one.
