---
'shoehive': minor
---

`sqliteStore` commits writes made in the same turn of the event loop together (group commit): one transaction and one fsync cover many tables' log appends and snapshots, so `synchronous = FULL` keeps every acknowledged action durable at far more tables per server. The Store contract is unchanged: each write still resolves only after the commit that holds it, each table's batch is all or nothing, one table's `StoreConflictError` does not fail another table's append, and reads see every write called before them. A failed transaction (for example a busy lock past the timeout) rejects every write in that group.
