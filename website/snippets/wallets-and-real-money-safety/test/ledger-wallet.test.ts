import { runWalletConformance } from 'shoehive/testing';
import { describe, expect, it } from 'vitest';
import { ledgerWallet, type Hold, type Ledger } from '../src/ledger-wallet';

/** An in-memory Ledger for the test. Yours is a database transaction. */
function memoryLedger(funds: Record<string, number>): Ledger {
  const balances = new Map(Object.entries(funds));
  const holds = new Map<string, Hold>();
  const credits = new Map<string, { playerId: string; amount: number }>();
  let queue: Promise<unknown> = Promise.resolve();
  return {
    transaction(work) {
      const run = queue.then(() =>
        work({
          available: (id) => Promise.resolve(balances.get(id)),
          adjust: (id, delta) => {
            balances.set(id, (balances.get(id) ?? 0) + delta);
            return Promise.resolve();
          },
          hold: (key) => Promise.resolve(holds.get(key)),
          putHold: (key, hold) => {
            holds.set(key, hold);
            return Promise.resolve();
          },
          credited: (key) => Promise.resolve(credits.get(key)),
          putCredit: (key, credit) => {
            credits.set(key, credit);
            return Promise.resolve();
          },
        }),
      );
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

// #region conformance
runWalletConformance((funds) => ledgerWallet(memoryLedger(funds)), { describe, it, expect });
// #endregion conformance
