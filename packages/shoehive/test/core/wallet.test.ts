import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineGame, MemoryWallet, reject, TableRuntime, type Wallet } from '../../src/index';
import { createTestTable } from '../../src/testing/index';

// A tiny betting game: bet reserves, settle commits and pays, refund releases.
const bets = defineGame({
  id: 'bets',
  seats: { min: 1, max: 2 },
  setup: () => ({ bets: [] as { seat: number; key: string; amount: number }[], balance: -1 }),
  actions: {
    bet: {
      input: z.object({ amount: z.number().int(), key: z.string() }),
      async run({ state, input, seat, ctx }) {
        const ok = await ctx.wallet.reserve(seat, input.amount, input.key);
        if (!ok) reject('INSUFFICIENT_FUNDS');
        state.bets.push({ seat, key: input.key, amount: input.amount });
      },
    },
    betThenFail: {
      input: z.object({ amount: z.number().int(), key: z.string() }),
      async run({ seat, input, ctx }) {
        await ctx.wallet.reserve(seat, input.amount, input.key);
        reject('NOPE');
      },
    },
    settle: {
      run({ state, ctx }) {
        for (const bet of state.bets) {
          ctx.wallet.commit(bet.key);
          ctx.wallet.credit(bet.seat, bet.amount * 2, `win:${bet.key}`);
        }
        state.bets = [];
      },
    },
    payThenFail: {
      run({ seat, ctx }) {
        ctx.wallet.credit(seat, 500, 'never');
        reject('NOPE');
      },
    },
    refund: {
      run({ state, ctx }) {
        for (const bet of state.bets) ctx.wallet.release(bet.key);
        state.bets = [];
      },
    },
    peek: {
      async run({ state, seat, ctx }) {
        state.balance = await ctx.wallet.balance(seat);
      },
    },
  },
  view: ({ state }) => state,
});

/** The backend key the engine used for the game's reserve key `k` (from the log). */
function backendKey(t: { runtime: TableRuntime }, k: string): string {
  for (const entry of t.runtime.log) {
    for (const effect of entry.effects ?? []) {
      if (effect.op === 'reserve' && effect.key.startsWith(`test-table:${k}:`)) return effect.key;
    }
  }
  throw new Error(`no reserve recorded for "${k}"`);
}

describe('ctx.wallet (ADR 0007)', () => {
  it('reserves now and commits and credits after the entry commits', async () => {
    const t = await createTestTable(bets, { players: 1 });
    await t.act(0, 'bet', { amount: 300, key: 'b1' });
    expect(await t.wallet.balance('p0')).toBe(700);
    await t.act(0, 'peek');
    expect(t.state.balance).toBe(700);
    await t.act(0, 'settle');
    expect(await t.wallet.balance('p0')).toBe(1300);
    expect((t.wallet as MemoryWallet).reservation(backendKey(t, 'b1'))?.state).toBe('committed');
    expect(t.walletErrors).toEqual([]);
    await t.verifyReplay();
  });

  it('refuses a reservation beyond the balance', async () => {
    const t = await createTestTable(bets, { players: 1 });
    await expect(t.act(0, 'bet', { amount: 5000, key: 'big' })).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    expect(await t.wallet.balance('p0')).toBe(1000);
  });

  it('releases the reservation of a rolled-back entry', async () => {
    const t = await createTestTable(bets, { players: 1 });
    await expect(t.act(0, 'betThenFail', { amount: 400, key: 'x' })).rejects.toMatchObject({
      code: 'NOPE',
    });
    await t.runtime.idle();
    expect(await t.wallet.balance('p0')).toBe(1000);
    expect(t.runtime.log.some((e) => e.effects)).toBe(false); // the entry rolled back
    expect(await t.wallet.balance('p0')).toBe(1000);
  });

  it('lets a game reuse a key after its entry rolled back', async () => {
    const t = await createTestTable(bets, { players: 1 });
    await expect(t.act(0, 'betThenFail', { amount: 400, key: 'again' })).rejects.toMatchObject({
      code: 'NOPE',
    });
    await t.act(0, 'bet', { amount: 400, key: 'again' });
    expect(await t.wallet.balance('p0')).toBe(600);
    expect(t.state.bets).toEqual([{ seat: 0, key: 'again', amount: 400 }]);
  });

  it('refuses to reserve an open key twice, or settle an unknown one', async () => {
    const t = await createTestTable(bets, { players: 1 });
    await t.act(0, 'bet', { amount: 10, key: 'k' });
    await expect(t.act(0, 'bet', { amount: 10, key: 'k' })).rejects.toThrow(/already reserved/);
    await t.act(0, 'settle');
    await expect(t.act(0, 'settle')).resolves.toBeUndefined(); // no bets left: nothing to do
  });

  it('drops deferred ops of a rolled-back entry', async () => {
    const t = await createTestTable(bets, { players: 1 });
    await expect(t.act(0, 'payThenFail')).rejects.toMatchObject({ code: 'NOPE' });
    await t.runtime.idle();
    expect(await t.wallet.balance('p0')).toBe(1000);
  });

  it('records effects so replay needs no wallet and matches exactly', async () => {
    const t = await createTestTable(bets, { players: 2 });
    await t.act(0, 'bet', { amount: 100, key: 'a' });
    await t.act(1, 'bet', { amount: 200, key: 'b' });
    await t.act(1, 'peek');
    await t.act(0, 'refund');
    const entries = t.runtime.log.filter((e) => e.effects ?? e.wallet);
    const a = backendKey(t, 'a');
    const b = backendKey(t, 'b');
    expect(a).toMatch(/^test-table:a:[0-9a-f]{12}$/);
    expect(entries.map((e) => [e.effects, e.wallet])).toEqual([
      [[{ op: 'reserve', key: a, ok: true }], undefined],
      [[{ op: 'reserve', key: b, ok: true }], undefined],
      [[{ op: 'balance', seat: 1, amount: 800 }], undefined],
      [
        undefined,
        [
          { op: 'release', key: a },
          { op: 'release', key: b },
        ],
      ],
    ]);
    // A replay without any wallet still reproduces the state.
    const copy = await TableRuntime.replay(bets, t.runtime.log, { dev: true });
    expect(copy.state).toEqual(t.runtime.state);
  });

  it('detects divergence when replayed code makes different wallet calls', async () => {
    const t = await createTestTable(bets, { players: 1 });
    await t.act(0, 'bet', { amount: 100, key: 'a' });
    const tampered = t.runtime.log.map((e) => {
      const { effects: _effects, ...rest } = e;
      return rest;
    });
    await expect(TableRuntime.replay(bets, tampered, { dev: true })).rejects.toThrow(
      /recorded wallet reserve/,
    );
  });

  it('tracks open reservations in snapshots and re-sends pending ops on recovery', async () => {
    const wallet = new MemoryWallet({ startingBalance: 1000 });
    const t = await createTestTable(bets, { players: 1, wallet });
    await t.act(0, 'bet', { amount: 100, key: 'a' });
    const snap = t.runtime.snapshot();
    expect(snap.wallet).toEqual({ pending: [], open: [backendKey(t, 'a')] });
    expect(snap.root.engine.reservations).toEqual({ a: backendKey(t, 'a') });
    await t.act(0, 'settle');
    // Simulate a crash before the commit and credit were confirmed: a fresh wallet
    // replay re-sends them, and keys make the repeat harmless on the original wallet.
    const tail = t.runtime.log.filter((e) => e.seq > snap.seq);
    const recovered = await TableRuntime.replay(bets, tail, { from: snap, live: true, wallet });
    await recovered.idle();
    expect(await wallet.balance('p0')).toBe(1100);
    expect(recovered.snapshot().wallet?.open).toEqual([]);
    recovered.dispose();
  });

  it('releases open reservations when asked (table close)', async () => {
    const t = await createTestTable(bets, { players: 1 });
    await t.act(0, 'bet', { amount: 250, key: 'a' });
    t.runtime.releaseOpenReservations();
    await t.runtime.idle();
    expect(await t.wallet.balance('p0')).toBe(1000);
  });

  it('rolls back when the wallet does not answer in time', async () => {
    const hanging: Wallet = {
      reserve: () => new Promise(() => undefined),
      commit: () => Promise.resolve(),
      release: () => Promise.resolve(),
      balance: () => Promise.resolve(0),
      credit: () => Promise.resolve(),
    };
    const runtime = await TableRuntime.create(bets, { wallet: hanging, walletTimeoutMs: 20 });
    await runtime.sit({ seat: 0, player: { id: 'p', name: 'P' } });
    await expect(
      runtime.act({ player: 'p', seat: 0, name: 'bet', input: { amount: 1, key: 'k' } }),
    ).rejects.toMatchObject({ code: 'WALLET_UNAVAILABLE' });
    expect(runtime.state).toMatchObject({ bets: [] });
    runtime.dispose();
  });

  it('reports a deferred op that keeps failing after retries', { timeout: 10_000 }, async () => {
    const memory = new MemoryWallet({ startingBalance: 1000 });
    const wallet: Wallet = {
      reserve: (p, a, k) => memory.reserve(p, a, k),
      commit: () => Promise.reject(new Error('ledger down')),
      release: (k) => memory.release(k),
      balance: (p) => memory.balance(p),
      credit: (p, a, k) => memory.credit(p, a, k),
    };
    const t = await createTestTable(bets, { players: 1, wallet });
    await t.act(0, 'bet', { amount: 100, key: 'a' });
    await t.act(0, 'settle');
    await t.runtime.idle();
    expect(t.walletErrors).toHaveLength(1);
    expect(t.walletErrors[0]!.op).toEqual({ op: 'commit', key: backendKey(t, 'a') });
    // The credit after it still went through.
    expect(await memory.balance('p0')).toBe(1100);
  });
});

describe('MemoryWallet', () => {
  it('is idempotent by key and rejects conflicts', async () => {
    const w = new MemoryWallet({ balances: { a: 100 } });
    expect(await w.reserve('a', 60, 'k')).toEqual({ ok: true });
    expect(await w.reserve('a', 60, 'k')).toEqual({ ok: true });
    expect(await w.balance('a')).toBe(40);
    await expect(w.reserve('a', 61, 'k')).rejects.toThrow(/conflict/);
    expect(await w.reserve('a', 50, 'k2')).toEqual({ ok: false, reason: 'INSUFFICIENT_FUNDS' });
    await w.commit('k');
    await w.commit('k');
    await expect(w.release('k')).rejects.toThrow(/release after commit/);
    await w.release('late');
    expect(await w.reserve('a', 1, 'late')).toEqual({ ok: false, reason: 'RELEASED' });
    await w.credit('a', 10, 'c');
    await w.credit('a', 10, 'c');
    expect(await w.balance('a')).toBe(50);
    expect(() => {
      w.set('a', 1.5);
    }).toThrow(RangeError);
  });
});

describe('ctx.wallet in onStand', () => {
  it('can still pay the departing player (the seat is already empty)', async () => {
    const cashier = defineGame({
      id: 'cashier',
      seats: { min: 1, max: 2 },
      setup: () => ({ stacks: [250, 250] }),
      onStand: ({ state, seat, ctx }) => {
        ctx.wallet.credit(seat!, state.stacks[seat!]!, `cashout:${String(seat)}`);
        state.stacks[seat!] = 0;
      },
    });
    const t = await createTestTable(cashier, { players: 1 });
    await t.stand(0);
    await t.runtime.idle();
    expect(t.runtime.seats()[0]?.status).toBe('empty');
    expect(await t.wallet.balance('p0')).toBe(1250);
    await t.verifyReplay();
  });
});

// Phase 8 security review (docs/security/review-1.0-platform.md, findings P-04, P-05, P-09).
describe('wallet path hardening (security review)', () => {
  /** A backend that accepts anything and records every reserve it receives. */
  function recordingWallet(): { wallet: Wallet; reserves: [string, number, string][] } {
    const reserves: [string, number, string][] = [];
    return {
      reserves,
      wallet: {
        reserve: (player, amount, key) => {
          reserves.push([player, amount, key]);
          return Promise.resolve({ ok: true });
        },
        commit: () => Promise.resolve(),
        release: () => Promise.resolve(),
        balance: () => Promise.resolve(100),
        credit: () => Promise.resolve(),
      },
    };
  }

  const loose = defineGame({
    id: 'loose',
    seats: { min: 1, max: 2 },
    setup: () => ({ tried: [] as string[] }),
    actions: {
      // A game bug: the schema allows any number, so the client picks the amount.
      bet: {
        input: z.object({ amount: z.number() }),
        async run({ seat, input, ctx }) {
          await ctx.wallet.reserve(seat, input.amount, 'bet');
        },
      },
      // The documented pattern: catch WALLET_UNAVAILABLE and carry on (ADR 0007 rule 5).
      tryBet: {
        input: z.object({ seat: z.number().int(), key: z.string() }),
        async run({ state, input, ctx }) {
          try {
            state.tried.push((await ctx.wallet.reserve(input.seat, 10, input.key)) ? 'ok' : 'no');
          } catch (error) {
            state.tried.push(
              error instanceof Error && 'code' in error ? String(error.code) : 'error',
            );
          }
        },
      },
      tryPeek: {
        async run({ state, seat, ctx }) {
          try {
            state.tried.push(`balance ${String(await ctx.wallet.balance(seat))}`);
          } catch (error) {
            state.tried.push(
              error instanceof Error && 'code' in error ? String(error.code) : 'error',
            );
          }
        },
      },
    },
  });

  it('refuses reserve amounts that are not non-negative safe integers, before the backend', async () => {
    const { wallet, reserves } = recordingWallet();
    const t = await createTestTable(loose, { players: 1, wallet });
    for (const amount of [-500, 1.5, 2 ** 53]) {
      await expect(t.act(0, 'bet', { amount })).rejects.toMatchObject({ code: 'INTERNAL' });
    }
    expect(reserves).toEqual([]);
    await t.act(0, 'bet', { amount: 0 });
    expect(reserves.map(([, amount]) => amount)).toEqual([0]);
  });

  it('records a wallet failure the game caught, so the entry replays (restart recovery)', async () => {
    let down = true;
    const memory = new MemoryWallet({ startingBalance: 1000 });
    const flaky: Wallet = {
      reserve: (p, a, k) =>
        down ? Promise.reject(new Error('ledger down')) : memory.reserve(p, a, k),
      commit: (k) => memory.commit(k),
      release: (k) => memory.release(k),
      balance: (p) => (down ? Promise.reject(new Error('ledger down')) : memory.balance(p)),
      credit: (p, a, k) => memory.credit(p, a, k),
    };
    const t = await createTestTable(loose, { players: 1, wallet: flaky });
    await t.act(0, 'tryBet', { seat: 0, key: 'a' });
    await t.act(0, 'tryPeek');
    // A seat that is empty: ctx.wallet throws before any backend call.
    await t.act(0, 'tryBet', { seat: 1, key: 'b' });
    down = false;
    await t.act(0, 'tryBet', { seat: 0, key: 'c' });
    await t.act(0, 'tryPeek');
    expect(t.state.tried).toEqual([
      'WALLET_UNAVAILABLE',
      'WALLET_UNAVAILABLE',
      'error',
      'ok',
      'balance 990',
    ]);
    // The failed reserve's backend key is released after its entry committed.
    const failed = t.runtime.log.find((e) => e.kind === 'action')!;
    expect(failed.effects).toEqual([
      {
        op: 'reserve',
        key: expect.stringMatching(/^test-table:a:[0-9a-f]{12}$/) as string,
        ok: false,
        error: { code: 'WALLET_UNAVAILABLE', message: 'The wallet failed' },
      },
    ]);
    const [effect] = failed.effects!;
    expect(failed.wallet).toEqual([
      { op: 'release', key: effect?.op === 'reserve' ? effect.key : '' },
    ]);
    // Replay (recovery, devtools, fixtures) reproduces it without calling the wallet.
    const copy = await TableRuntime.replay(loose, t.runtime.log, { dev: true });
    expect(copy.state).toEqual(t.state);
    await t.verifyReplay();
  });
});

describe('table ids and wallet keys (security review P-09)', () => {
  it('refuses table ids that could make two tables share a wallet key', async () => {
    const t = { id: 't', seats: { min: 1, max: 1 }, setup: () => null };
    const game = defineGame(t);
    await expect(TableRuntime.create(game, { id: 'a:b' })).rejects.toThrow(TypeError);
    await expect(TableRuntime.create(game, { id: '' })).rejects.toThrow(TypeError);
    const ok = await TableRuntime.create(game, { id: 'a_b-1' });
    expect(ok.id).toBe('a_b-1');
    ok.dispose();
  });
});
