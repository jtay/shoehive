---
'shoehive': minor
---

`shoehive/server` (Phase 2 of RFC 0001): `createServer` with guest sessions and HMAC resume tokens or a custom `auth` hook, WebSocket and in-memory transports, the v1 wire protocol (lobby, tables, seats, spectators, per-viewer patches, events), reconnect grace, rate and size limits, a `Store` interface with an in-memory adapter and restart recovery, and the `Wallet` interface with `MemoryWallet`. `shoehive/testing` adds `runStoreConformance`.
