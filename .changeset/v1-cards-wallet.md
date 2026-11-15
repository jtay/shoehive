---
'shoehive': minor
---

Phase 4 of RFC 0001: `shoehive/cards` (cards and shoes, hidden-card view helpers, blackjack totals, a 7-card poker evaluator, side pots and payouts) and `ctx.wallet` (reserve and balance during an action, commit, release and credit after it commits, recorded for replay, with `runWalletConformance` in `shoehive/testing`). Also: game ids stay literal so `createTable` and `createAndJoin` are typed by id; an optional `result` schema types `ctx.end` and `meta.result`; `lobby.sub` takes a filter; guests can rename (`player.rename`, `client.rename`); and timers can be made visible in `meta.timers`.
