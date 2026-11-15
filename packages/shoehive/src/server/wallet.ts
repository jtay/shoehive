// The Wallet interface and an in-memory ledger for development (ADR 0007). Wiring
// `ctx.wallet` into game code (deferred commits tied to engine commits) lands in Phase 4.

/** A non-negative safe integer in the smallest unit (chips, cents). No floats. */
export type Amount = number;

export type ReserveResult =
  { ok: true } | { ok: false; reason: 'INSUFFICIENT_FUNDS' | 'UNKNOWN_PLAYER' | 'RELEASED' };

/** A money backend. Every method must be idempotent by `key`. */
export interface Wallet {
  reserve(playerId: string, amount: Amount, key: string): Promise<ReserveResult>;
  /** The reservation becomes a final debit. */
  commit(key: string): Promise<void>;
  /** The reservation is cancelled and the funds returned. */
  release(key: string): Promise<void>;
  /** Available funds, excluding reservations. */
  balance(playerId: string): Promise<Amount>;
  /** Payouts. */
  credit(playerId: string, amount: Amount, key: string): Promise<void>;
}

function checkAmount(amount: Amount): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(
      `Wallet amounts must be non-negative safe integers, got ${String(amount)}`,
    );
  }
}

/**
 * An in-memory ledger for development and tests. Not for real money: balances live in
 * process memory only.
 */
export class MemoryWallet implements Wallet {
  private readonly balances = new Map<string, Amount>();
  private readonly reservations = new Map<
    string,
    { playerId: string; amount: Amount; state: 'held' | 'committed' | 'released' }
  >();
  private readonly credits = new Set<string>();

  constructor(options: { startingBalance?: Amount; balances?: Record<string, Amount> } = {}) {
    this.startingBalance = options.startingBalance ?? 0;
    for (const [player, amount] of Object.entries(options.balances ?? {})) this.set(player, amount);
  }

  private readonly startingBalance: Amount;

  /** Sets a player's available balance. */
  set(playerId: string, amount: Amount): void {
    checkAmount(amount);
    this.balances.set(playerId, amount);
  }

  private available(playerId: string): Amount {
    return this.balances.get(playerId) ?? this.startingBalance;
  }

  reserve(playerId: string, amount: Amount, key: string): Promise<ReserveResult> {
    checkAmount(amount);
    const existing = this.reservations.get(key);
    if (existing)
      return Promise.resolve(
        existing.state === 'released' ? { ok: false, reason: 'RELEASED' } : { ok: true },
      );
    if (this.available(playerId) < amount)
      return Promise.resolve({ ok: false, reason: 'INSUFFICIENT_FUNDS' });
    this.balances.set(playerId, this.available(playerId) - amount);
    this.reservations.set(key, { playerId, amount, state: 'held' });
    return Promise.resolve({ ok: true });
  }

  commit(key: string): Promise<void> {
    const r = this.reservations.get(key);
    if (r?.state === 'held') r.state = 'committed';
    return Promise.resolve();
  }

  release(key: string): Promise<void> {
    const r = this.reservations.get(key);
    if (!r) {
      // Tombstone: a later reserve with this key must not succeed (ADR 0007).
      this.reservations.set(key, { playerId: '', amount: 0, state: 'released' });
    } else if (r.state === 'held') {
      r.state = 'released';
      this.balances.set(r.playerId, this.available(r.playerId) + r.amount);
    }
    return Promise.resolve();
  }

  balance(playerId: string): Promise<Amount> {
    return Promise.resolve(this.available(playerId));
  }

  credit(playerId: string, amount: Amount, key: string): Promise<void> {
    checkAmount(amount);
    if (this.credits.has(key)) return Promise.resolve();
    this.credits.add(key);
    this.balances.set(playerId, this.available(playerId) + amount);
    return Promise.resolve();
  }
}
