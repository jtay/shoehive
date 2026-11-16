// A Wallet over a real ledger (/how-to/wallets-and-real-money-safety/). `Ledger` stands for
// your database: the only thing it must give you is a transaction that applies all of its
// reads and writes, or none, and serializes callers that touch the same rows.
import type { Amount, Wallet } from 'shoehive';

export interface Hold {
  playerId: string;
  amount: Amount;
  state: 'held' | 'committed' | 'released';
}

export interface LedgerTx {
  /** The player's available funds, or `undefined` for a player the ledger does not know. */
  available(playerId: string): Promise<Amount | undefined>;
  /** Adds `delta` (may be negative) to the player's available funds. */
  adjust(playerId: string, delta: number): Promise<void>;
  /** A row per key, with a unique constraint on the key. */
  hold(key: string): Promise<Hold | undefined>;
  putHold(key: string, hold: Hold): Promise<void>;
  credited(key: string): Promise<{ playerId: string; amount: Amount } | undefined>;
  putCredit(key: string, credit: { playerId: string; amount: Amount }): Promise<void>;
}

export interface Ledger {
  transaction<T>(work: (tx: LedgerTx) => Promise<T>): Promise<T>;
}

// #region wallet
export function ledgerWallet(ledger: Ledger): Wallet {
  return {
    reserve: (playerId, amount, key) =>
      ledger.transaction(async (tx) => {
        const held = await tx.hold(key);
        if (held) {
          if (held.state === 'released') return { ok: false, reason: 'RELEASED' };
          if (held.playerId !== playerId || held.amount !== amount) {
            throw new Error(`reserve ${key}: same key, different arguments`);
          }
          return { ok: true }; // a retry: report the original result
        }
        const available = await tx.available(playerId);
        if (available === undefined) return { ok: false, reason: 'UNKNOWN_PLAYER' };
        if (available < amount) return { ok: false, reason: 'INSUFFICIENT_FUNDS' };
        await tx.adjust(playerId, -amount);
        await tx.putHold(key, { playerId, amount, state: 'held' });
        return { ok: true };
      }),

    commit: (key) =>
      ledger.transaction(async (tx) => {
        const held = await tx.hold(key);
        if (!held || held.state === 'released') throw new Error(`commit ${key}: not reserved`);
        if (held.state === 'held') await tx.putHold(key, { ...held, state: 'committed' });
      }),

    release: (key) =>
      ledger.transaction(async (tx) => {
        const held = await tx.hold(key);
        if (!held) {
          // Unknown key: leave a tombstone so a late reserve with this key is refused.
          await tx.putHold(key, { playerId: '', amount: 0, state: 'released' });
        } else if (held.state === 'committed') {
          throw new Error(`release ${key}: already committed`);
        } else if (held.state === 'held') {
          await tx.adjust(held.playerId, held.amount);
          await tx.putHold(key, { ...held, state: 'released' });
        }
      }),

    balance: (playerId) => ledger.transaction(async (tx) => (await tx.available(playerId)) ?? 0),

    credit: (playerId, amount, key) =>
      ledger.transaction(async (tx) => {
        const done = await tx.credited(key);
        if (done) {
          if (done.playerId !== playerId || done.amount !== amount) {
            throw new Error(`credit ${key}: same key, different arguments`);
          }
          return; // already paid
        }
        await tx.adjust(playerId, amount);
        await tx.putCredit(key, { playerId, amount });
      }),
  };
}
// #endregion wallet
