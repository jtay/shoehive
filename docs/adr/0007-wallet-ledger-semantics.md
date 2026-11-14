# ADR 0007: Wallet ledger semantics

|         |                                                                                               |
| ------- | --------------------------------------------------------------------------------------------- |
| Status  | Accepted, 2026-11-14 (stakeholder accepted `credit` for payouts)                              |
| Related | RFC 0001 sections 3, 7 (Wallet), 11 (Money), 13; audit finding 7; ADRs 0001, 0005, 0006, 0009 |

## Context

0.x has a betting API (`createBet`, `markBetWon`) with no idempotency and no
reservation semantics (finding 7). A crash or a retry can double-charge or lose a bet.
RFC 0001 replaces it with an optional `Wallet` interface: `reserve`, `commit`, `release`,
`balance`, idempotent by key, called through `ctx.wallet` with the engine's commit or
rollback semantics. Integrators bring their own backend (their database, a payments
service); Shoehive ships an in-memory ledger for development.

Wallet backends are remote and slow compared with the engine, so this ADR also decides
how async calls fit a serial per-table queue.

**Shoehive is not a licensed gaming system.** It provides bookkeeping primitives. It
does not provide regulatory compliance, certified RNG, KYC, responsible gambling
controls or audited payouts. Operators running real-money games are responsible for
all of that. This sentence appears verbatim in the Wallet API docs and the how-to.

## Decision

```ts
type Amount = number; // non-negative safe integer in the smallest unit (chips, cents). No floats.

interface Wallet {
  reserve(
    playerId: string,
    amount: Amount,
    key: string,
  ): Promise<
    { ok: true } | { ok: false; reason: 'INSUFFICIENT_FUNDS' | 'UNKNOWN_PLAYER' | 'RELEASED' }
  >;
  commit(key: string): Promise<void>; // reservation becomes a final debit
  release(key: string): Promise<void>; // reservation is cancelled, funds returned
  balance(playerId: string): Promise<Amount>; // available funds, excluding reservations
  credit(playerId: string, amount: Amount, key: string): Promise<void>; // payouts
}

interface CtxWallet {
  // what game code sees
  reserve(seat: number, amount: Amount, key: string): Promise<boolean>; // runs now, awaited
  balance(seat: number): Promise<Amount>; // runs now, awaited
  commit(key: string): void; // deferred to after commit
  release(key: string): void; // deferred to after commit
  credit(seat: number, amount: Amount, key: string): void; // deferred to after commit
}
```

1. **Keys.** Game code passes a key unique within the table (`bet:h12:s3`). The engine
   prefixes it with the table id (`tbl_abc:bet:h12:s3`) before calling the backend, so
   keys are unique per server. Backends must treat each key as a small state machine:
   `reserved`, then exactly one of `committed` or `released`. Repeating the same call
   with the same arguments is a no-op that returns the original result. A conflicting
   call (`commit` after `release`, or `reserve` with a different amount) throws.
   `release` of an unknown key records a tombstone, so a late `reserve` with that key
   returns `{ ok: false, reason: 'RELEASED' }`.
2. **Reserve is immediate, the rest is deferred.** `reserve` and `balance` call the
   backend during the action, because the game needs the answer. `commit`, `release` and
   `credit` are buffered in the transaction (ADR 0005) and sent only after the engine
   commits the entry and the store has appended it (ADR 0009). Money never moves for a
   state change that did not happen.
3. **Rollback releases.** If an entry rolls back for any reason (`reject`, a throw, a
   timeout), the engine calls `release` for every key that entry tried to reserve,
   whether the reserve succeeded, failed or timed out. Tombstones make this safe.
4. **A reservation kept by a committed action stays reserved** until a later entry
   commits or releases it (for example, a blackjack bet reserved in `betting`, settled in
   `settle`). Reservations still open when a table closes are released by the engine.
5. **Async actions and the queue.** Actions may be async; the queue awaits them and runs
   nothing else for that table meanwhile. Limits:
   - Each `ctx.wallet` call times out after `walletTimeoutMs` (default 5,000). It then
     throws a `ShoehiveError` with code `WALLET_UNAVAILABLE`. If the game does not catch
     it, the action rolls back and the client gets `WALLET_UNAVAILABLE`.
   - The whole entry times out after `entryTimeoutMs` (default 10,000). The engine
     discards the draft, releases its reservations, acks `TIMEOUT`, and closes the
     transaction; later `ctx` calls from the abandoned function throw and are logged.
6. **Deferred op failures.** After commit, deferred ops are sent in order, retried with
   exponential backoff (5 attempts, up to 30 s total). Persistent failure emits the
   operator event `wallet:error` with the key and op, and is logged at `error`. Table
   state is not rolled back: it is already committed and broadcast.
7. **Replay.** Results of `reserve` and `balance` are recorded in the entry's `effects`
   (ADR 0006). Replay uses the recorded results and never calls the backend.
8. **Recovery.** Deferred ops whose completion was not confirmed are kept in engine
   state and in snapshots. After restart, the server re-sends them and the deferred ops
   of every entry in the replayed tail. Idempotency makes duplicates harmless.
9. **No wallet configured.** Any `ctx.wallet` call throws `WALLET_NOT_CONFIGURED`
   (an `INTERNAL` error to clients, a clear message in logs).
10. **Dev ledger.** `memoryWallet({ initialBalance?: Amount })` implements the full
    contract, including tombstones and conflicts. Its source is isomorphic, so it is
    exported from `shoehive/server` and used by default in `shoehive/testing`. Devtools
    forks (ADR 0011) always use a fresh memory wallet, never the real one.
11. **Conformance.** `shoehive/testing` ships `runWalletConformance(createWallet)`
    covering idempotency, conflicts, tombstones and concurrent keys.

## Consequences

### Positive

- No double charge on retry, crash or reconnect: every money movement has a key.
- Money moves only for committed, persisted state.
- Games stay testable: the memory wallet and recorded effects make wallet games replay.

### Negative

- A slow backend stalls that table for up to `walletTimeoutMs`. Other tables are not
  affected.
- Backends must implement tombstones and conflict detection, which is more than a
  naive balance table. The conformance suite makes this checkable.
- There is a window after state commits where a deferred op can fail. We surface it to
  operators; reconciling it is the integrator's job (the how-to covers audit logs).

## Alternatives considered

### Keep the 0.x bet API

`createBet` / `markBetWon`. Rejected: no idempotency, no reservations, game-shaped
(betting only), and not tied to engine commit.

### Synchronous wallet only (preload balances into state)

No async in the queue. Rejected: the integrator's database is the source of truth for
money, and a stale copy in table state allows overspending across tables.

### Two-phase commit across store and wallet

Strong consistency. Rejected as out of scope for a single-node framework; idempotent
keys plus retries give at-least-once delivery with exactly-once effect.

## Open questions

- ~~**Payouts.**~~ Resolved 2026-11-14: the stakeholder accepted `credit` as a fifth
  required method, so games can pay out winnings (blackjack, Hold'em pots) themselves.
- Should `Amount` be `bigint` for very large ledgers? v1 proposes safe integers.
