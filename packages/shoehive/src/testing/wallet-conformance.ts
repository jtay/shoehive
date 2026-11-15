// The wallet conformance suite (ADR 0007 rule 11). Like the store suite, it takes the test
// runner's functions, so shoehive/testing has no test-runner dependency:
//
//   import { describe, it, expect } from 'vitest';
//   runWalletConformance((funds) => myWallet(funds), { describe, it, expect });

import type { Amount, Wallet } from '../core/wallet';
import type { ConformanceRunner } from './store-conformance';

/** Players and their starting available balances, for the wallet under test. */
export type WalletFunds = Record<string, Amount>;

async function throws(work: () => Promise<unknown>): Promise<boolean> {
  try {
    await work();
    return false;
  } catch {
    return true;
  }
}

/**
 * Registers the conformance tests for wallets returned by `createWallet`. Each test calls
 * it with fresh funds; give every listed player exactly that available balance, and use
 * fresh keys (the suite uses random key prefixes so a shared ledger also works).
 */
export function runWalletConformance(
  createWallet: (funds: WalletFunds) => Wallet | Promise<Wallet>,
  { describe, it, expect }: ConformanceRunner,
): void {
  let run = 0;
  const setup = async (funds: WalletFunds) => {
    const prefix = `conf${String(++run)}-${Math.random().toString(36).slice(2, 8)}`;
    const wallet = await createWallet(funds);
    return { wallet, key: (k: string) => `${prefix}:${k}` };
  };

  describe('Wallet conformance (ADR 0007)', () => {
    it('reserve holds funds; commit keeps them; release returns them', async () => {
      const { wallet, key } = await setup({ a: 100 });
      expect(await wallet.reserve('a', 30, key('r1'))).toEqual({ ok: true });
      expect(await wallet.balance('a')).toBe(70);
      await wallet.commit(key('r1'));
      expect(await wallet.balance('a')).toBe(70);
      expect(await wallet.reserve('a', 20, key('r2'))).toEqual({ ok: true });
      await wallet.release(key('r2'));
      expect(await wallet.balance('a')).toBe(70);
    });

    it('refuses a reservation beyond the available balance', async () => {
      const { wallet, key } = await setup({ a: 50 });
      const result = await wallet.reserve('a', 51, key('big'));
      expect(result.ok).toBe(false);
      expect(await wallet.balance('a')).toBe(50);
    });

    it('repeated calls with the same key are no-ops', async () => {
      const { wallet, key } = await setup({ a: 100 });
      expect(await wallet.reserve('a', 40, key('k'))).toEqual({ ok: true });
      expect(await wallet.reserve('a', 40, key('k'))).toEqual({ ok: true });
      expect(await wallet.balance('a')).toBe(60);
      await wallet.commit(key('k'));
      await wallet.commit(key('k'));
      expect(await wallet.balance('a')).toBe(60);
      await wallet.reserve('a', 10, key('j'));
      await wallet.release(key('j'));
      await wallet.release(key('j'));
      expect(await wallet.balance('a')).toBe(60);
      await wallet.credit('a', 5, key('c'));
      await wallet.credit('a', 5, key('c'));
      expect(await wallet.balance('a')).toBe(65);
    });

    it('conflicting calls throw', async () => {
      const { wallet, key } = await setup({ a: 100 });
      await wallet.reserve('a', 10, key('k'));
      expect(await throws(() => wallet.reserve('a', 11, key('k')))).toBe(true);
      await wallet.commit(key('k'));
      expect(await throws(() => wallet.release(key('k')))).toBe(true);
      await wallet.reserve('a', 10, key('r'));
      await wallet.release(key('r'));
      expect(await throws(() => wallet.commit(key('r')))).toBe(true);
      await wallet.credit('a', 1, key('c'));
      expect(await throws(() => wallet.credit('a', 2, key('c')))).toBe(true);
    });

    it('release of an unknown key leaves a tombstone', async () => {
      const { wallet, key } = await setup({ a: 100 });
      await wallet.release(key('late'));
      expect(await wallet.reserve('a', 10, key('late'))).toEqual({
        ok: false,
        reason: 'RELEASED',
      });
      expect(await wallet.balance('a')).toBe(100);
    });

    it('credit pays out', async () => {
      const { wallet, key } = await setup({ a: 0 });
      await wallet.credit('a', 250, key('win'));
      expect(await wallet.balance('a')).toBe(250);
    });

    it('concurrent reservations never overdraw', async () => {
      const { wallet, key } = await setup({ a: 100 });
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => wallet.reserve('a', 30, key(`c${String(i)}`))),
      );
      expect(results.filter((r) => r.ok)).toHaveLength(3);
      expect(await wallet.balance('a')).toBe(10);
    });

    it('players are independent', async () => {
      const { wallet, key } = await setup({ a: 100, b: 100 });
      await wallet.reserve('a', 100, key('a'));
      expect(await wallet.balance('b')).toBe(100);
      expect(await wallet.reserve('b', 100, key('b'))).toEqual({ ok: true });
    });
  });
}
