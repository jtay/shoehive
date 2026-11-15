// The Wallet interface, the game-side `ctx.wallet` types and an in-memory ledger for
// development (ADR 0007). Isomorphic: used by the engine, the server and shoehive/testing.

/** A non-negative safe integer in the smallest unit (chips, cents). No floats. */
export type Amount = number;

export type ReserveResult =
  { ok: true } | { ok: false; reason: 'INSUFFICIENT_FUNDS' | 'UNKNOWN_PLAYER' | 'RELEASED' };

/**
 * A money backend. Every method must be idempotent by `key`: a key is reserved, then
 * exactly one of committed or released. Repeating a call with the same arguments returns
 * the original result; a conflicting call (commit after release, a different amount)
 * throws. `release` of an unknown key leaves a tombstone so a late `reserve` fails.
 */
export interface Wallet {
  reserve(playerId: string, amount: Amount, key: string): Promise<ReserveResult>;
  /** The reservation becomes a final debit. */
  commit(key: string): Promise<void>;
  /** The reservation is cancelled and the funds returned. */
  release(key: string): Promise<void>;
  /** Available funds, excluding reservations. */
  balance(playerId: string): Promise<Amount>;
  /** Payouts. Idempotent by key. */
  credit(playerId: string, amount: Amount, key: string): Promise<void>;
}

/** What game code sees as `ctx.wallet` (ADR 0007). Keys are unique within the table. */
export interface CtxWallet {
  /** Holds `amount` from the seat's player. Runs now; resolves `false` if refused. */
  reserve(seat: number, amount: Amount, key: string): Promise<boolean>;
  /** The seat's player's available funds. Runs now. */
  balance(seat: number): Promise<Amount>;
  /** Turns a reservation into a debit, after this entry commits. */
  commit(key: string): void;
  /** Cancels a reservation, after this entry commits. */
  release(key: string): void;
  /** Pays the seat's player, after this entry commits. */
  credit(seat: number, amount: Amount, key: string): void;
}

/** A deferred wallet operation, recorded in the log entry that produced it. */
export type WalletOp =
  | { op: 'commit'; key: string }
  | { op: 'release'; key: string }
  | { op: 'credit'; key: string; player: string; amount: Amount };

function checkAmount(amount: Amount): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(
      `Wallet amounts must be non-negative safe integers, got ${String(amount)}`,
    );
  }
}

/** A reservation as `MemoryWallet.reservation()` reports it. */
export interface WalletReservation {
  playerId: string;
  amount: Amount;
  state: 'held' | 'committed' | 'released';
}

/**
 * An in-memory ledger implementing the full Wallet contract, for development and tests.
 * Not for real money: balances live in process memory only.
 */
export class MemoryWallet implements Wallet {
  private readonly balances = new Map<string, Amount>();
  private readonly reservations = new Map<string, WalletReservation>();
  private readonly credits = new Map<string, { playerId: string; amount: Amount }>();
  private readonly startingBalance: Amount;

  constructor(options: { startingBalance?: Amount; balances?: Record<string, Amount> } = {}) {
    this.startingBalance = options.startingBalance ?? 0;
    checkAmount(this.startingBalance);
    for (const [player, amount] of Object.entries(options.balances ?? {})) this.set(player, amount);
  }

  /** Sets a player's available balance. */
  set(playerId: string, amount: Amount): void {
    checkAmount(amount);
    this.balances.set(playerId, amount);
  }

  /** The state of a reservation key, for tests. */
  reservation(key: string): WalletReservation | undefined {
    const r = this.reservations.get(key);
    return r ? { ...r } : undefined;
  }

  private available(playerId: string): Amount {
    return this.balances.get(playerId) ?? this.startingBalance;
  }

  reserve(playerId: string, amount: Amount, key: string): Promise<ReserveResult> {
    checkAmount(amount);
    const existing = this.reservations.get(key);
    if (existing) {
      if (existing.state === 'released') return Promise.resolve({ ok: false, reason: 'RELEASED' });
      if (existing.playerId !== playerId || existing.amount !== amount) {
        return Promise.reject(
          new Error(`Wallet conflict: key "${key}" was reserved with different arguments`),
        );
      }
      return Promise.resolve({ ok: true });
    }
    if (this.available(playerId) < amount)
      return Promise.resolve({ ok: false, reason: 'INSUFFICIENT_FUNDS' });
    this.balances.set(playerId, this.available(playerId) - amount);
    this.reservations.set(key, { playerId, amount, state: 'held' });
    return Promise.resolve({ ok: true });
  }

  commit(key: string): Promise<void> {
    const r = this.reservations.get(key);
    if (!r) return Promise.reject(new Error(`Wallet conflict: commit of unknown key "${key}"`));
    if (r.state === 'released')
      return Promise.reject(new Error(`Wallet conflict: commit after release of "${key}"`));
    r.state = 'committed';
    return Promise.resolve();
  }

  release(key: string): Promise<void> {
    const r = this.reservations.get(key);
    if (!r) {
      // Tombstone: a later reserve with this key must not succeed (ADR 0007).
      this.reservations.set(key, { playerId: '', amount: 0, state: 'released' });
      return Promise.resolve();
    }
    if (r.state === 'committed')
      return Promise.reject(new Error(`Wallet conflict: release after commit of "${key}"`));
    if (r.state === 'held') {
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
    const existing = this.credits.get(key);
    if (existing) {
      if (existing.playerId !== playerId || existing.amount !== amount) {
        return Promise.reject(
          new Error(`Wallet conflict: key "${key}" was credited with different arguments`),
        );
      }
      return Promise.resolve();
    }
    this.credits.set(key, { playerId, amount });
    this.balances.set(playerId, this.available(playerId) + amount);
    return Promise.resolve();
  }
}
