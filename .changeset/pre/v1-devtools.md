---
'shoehive': minor
---

`shoehive/devtools` (Phase 6 of RFC 0001): an inspector served by the server when `createServer({ devtools: true })` in development (off and not even imported in production unless explicitly allowed with a strong token). It shows live tables read-only, raw and engine state, every seat's view beside the spectator's, the log and rejections, sessions, and offers time travel on replayed copies, forks into dev tables, and fixture export with anonymized players. `shoehive/testing` adds `replayFixture` and `fixtureStateHash`, and `TableRuntime.replay` takes `resendWalletOps`.
