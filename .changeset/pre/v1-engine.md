---
'shoehive': major
---

Shoehive v1 engine (Phase 1 of RFC 0001): `defineGame` with typed actions, phases, turns, rounds, timers and per-viewer views; `TableRuntime` with transactional entries, seeded ChaCha20 randomness, a recorded clock, exact replay and snapshots; and `shoehive/testing` with `createTestTable` and a fake clock. Replaces the 0.x API entirely.
