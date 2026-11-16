---
'shoehive': minor
'create-shoehive': minor
---

Platform security review fixes (docs/security/review-1.0-platform.md). Devtools without `allowRemote` now also refuses requests relayed by a proxy (`Forwarded`, `X-Forwarded-For`, `X-Real-IP`) and requests whose `Host` is a DNS name other than `localhost` or an `origins` entry, which stops DNS rebinding pages. Fixture export replaces player ids inside table options too, and its warning says when ids inside inputs had to be kept. `ctx.wallet.reserve` rejects amounts that are not non-negative safe integers before calling the wallet, and a `reserve` or `balance` failure that the game catches is recorded in the entry (`WalletEffect.error`, new `WalletFailure` type) so it replays. `TableRuntime.create` refuses empty table ids and ids containing `:`. `postgresStore` throws for schema or table names Postgres would truncate. The random stream throws instead of wrapping past 2^36 words. Generated projects no longer contain a fixed resume-token secret (`npm run dev` sets a random `SHOEHIVE_SECRET` per session), and `--shoehive` values are escaped in `package.json`.
