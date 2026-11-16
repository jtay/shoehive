---
'shoehive': minor
---

Store adapters (Phase 5 of RFC 0001): `shoehive/store/sqlite` (`better-sqlite3`), `shoehive/store/postgres` (`pg`, with `migratePostgres`) and `shoehive/store/redis` (`ioredis`), each taking a client you construct, with the drivers as optional peers. `runStoreConformance` accepts a reopenable backend and checks durability, atomic batches, concurrent writers and exact round-trips. `appendLog` now treats an exact retry of stored entries as success, so a driver re-sending after a lost reply does not fault the table.
