# Stores

A store keeps each table's action log, its latest snapshot and guest sessions, so tables
survive a restart of the server process (ADR 0009). On startup the server lists the open
tables, loads each snapshot and replays the log after it. Players who resume within the
reconnect grace period land back in their seats.

Pass one to `createServer({ store })`. Without one, the server uses `memoryStore()`, which
keeps everything in process memory and loses it on exit.

| Adapter                  | Import                    | Driver (optional peer) | Good for                                           |
| ------------------------ | ------------------------- | ---------------------- | -------------------------------------------------- |
| `memoryStore()`          | `shoehive/store/memory`   | none                   | development and tests                              |
| `sqliteStore(options)`   | `shoehive/store/sqlite`   | `better-sqlite3`       | a single server with a local disk                  |
| `postgresStore(options)` | `shoehive/store/postgres` | `pg`                   | managed databases, backups, several apps on one DB |
| `redisStore(options)`    | `shoehive/store/redis`    | `ioredis`              | an existing Redis with AOF persistence             |

Install the driver next to `shoehive`, for example `npm install shoehive better-sqlite3`.
Each adapter only loads its driver when you import its subpath.

**An ack means durable.** The server acknowledges an action only after the store has
written its log entry. How durable that write is depends on the adapter's settings, below.

## SQLite

```ts
import type { AnyGame } from 'shoehive';
declare const games: AnyGame[];
// ---cut---
import { createServer } from 'shoehive/server';
import { sqliteStore } from 'shoehive/store/sqlite';

const shoehive = createServer({ games, store: sqliteStore({ file: './shoehive.db' }) });
```

- With `{ file }`, the store opens the file in WAL mode with `synchronous = FULL`: every
  acknowledged action survives a process crash and a power loss. `close()` closes the file.
- With `{ database }`, pass a `better-sqlite3` connection you own. Its pragmas are left as
  you set them (WAL is recommended; `synchronous = NORMAL` with WAL can lose the last
  transactions on a power loss, not on a process crash), and `close()` leaves it open.
- `tablePrefix` (default `'shoehive_'`) lets several apps share one file.
- Tables: `<prefix>entries`, `<prefix>snapshots`, `<prefix>sessions`,
  `<prefix>open_tables` and `<prefix>meta` (schema version).

## Postgres

```ts
import type { AnyGame } from 'shoehive';
declare const games: AnyGame[];
// ---cut---
import pg from 'pg';
import { createServer } from 'shoehive/server';
import { migratePostgres, postgresStore } from 'shoehive/store/postgres';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await migratePostgres(pool); // optional: otherwise the store creates its tables on first use
const shoehive = createServer({ games, store: postgresStore({ pool }) });
```

- You construct the pool, so you control pooling, TLS and credentials. `close()` never ends
  it; end it yourself on shutdown.
- `schema` (default `public`) and `tablePrefix` (default `'shoehive_'`) isolate apps or tenants.
- Without `migratePostgres`, the store creates its schema lazily and idempotently before the
  first operation (concurrent setups are serialized with an advisory lock). Run
  `migratePostgres` from a deploy step if the app's role has no DDL rights.
- JSON is stored as `text`, not `jsonb`, so it round-trips byte for byte. Ids must not
  contain a NUL character (Postgres `text` cannot hold one).

## Redis

```ts
import type { AnyGame } from 'shoehive';
declare const games: AnyGame[];
// ---cut---
import { Redis } from 'ioredis';
import { createServer } from 'shoehive/server';
import { redisStore } from 'shoehive/store/redis';

const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const shoehive = createServer({ games, store: redisStore({ client }) });
```

- **Run Redis with AOF** (`appendonly yes`). With `appendfsync always` every acknowledged
  action is on disk; with `everysec` (the usual choice) a crash of the Redis host can lose
  up to a second of actions; with `no` or without AOF, a Redis restart loses tables.
  Replication is asynchronous and does not replace AOF.
- `prefix` (default `'shoehive:'`) namespaces the keys. Do not nest prefixes (`app:` and
  `app:log:` overlap). Ids are stored as given.
- Redis Cluster is not supported (snapshot and close touch several keys).
- `close()` leaves the client connected; quit it yourself on shutdown.

## Retries and conflicts

`appendLog` is all or nothing. A table's log starts at seq 0 and every entry must follow the
last stored one. If another writer got there first (for example two server processes on one
database), the append rejects with `StoreConflictError` and the server faults that table
until `shoehive.tables.reload(id)`. Run one server process per store namespace.

A batch whose entries are all already stored with identical data succeeds without writing,
so a driver that re-sends a command after a lost reply (ioredis does by default) does not
fault the table.

## Writing your own adapter

Implement the `Store` interface (exported from `shoehive/server` and every adapter) and run
the conformance suite from `shoehive/testing` with your test runner. Pass a backend that can
reopen the same storage so the suite also checks durability across a restart:

```ts nocheck
import { describe, expect, it } from 'vitest';
import { runStoreConformance } from 'shoehive/testing';
import { myStore } from './my-store';

runStoreConformance(
  async () => {
    const namespace = await createEmptyNamespace();
    return {
      open: () => myStore({ namespace }), // called again after close(): must see old data
      destroy: () => dropNamespace(namespace),
    };
  },
  { describe, it, expect },
);
```

The suite checks ordering, conflicts and their fields, atomic batches, concurrent writers,
idempotent retries, snapshots and tails, open and closed tables (a snapshot saved after
`closeTable` does not reopen a table), sessions, 1 MiB payloads, exact round-trips of
unusual JSON and ids, and data surviving close and reopen.
