import { blackjackValue } from 'shoehive/cards';
import { MemoryWallet } from 'shoehive';
import { createTestTable } from 'shoehive/testing';
import { describe, expect, it } from 'vitest';
import { blackjack, BET_MS, NEXT_HAND_MS, TURN_MS } from '../src/game';

const START = 1000; // MemoryWallet balance createTestTable gives every player

describe('blackjack', () => {
  it('shows each seated player their wallet balance and opens betting', async () => {
    const t = await createTestTable(blackjack, { players: 2, options: {} });
    expect(t.state.bankroll.slice(0, 2)).toEqual([START, START]);
    expect(t.meta.phase).toBe('betting');
  });

  it('validates bets against the table options and the wallet', async () => {
    const wallet = new MemoryWallet({ startingBalance: 30 });
    const t = await createTestTable(blackjack, { players: 1, options: { minBet: 25 }, wallet });
    await expect(t.act(0, 'bet', { amount: 10 })).rejects.toMatchObject({
      code: 'BET_OUT_OF_RANGE',
      details: { minBet: 25, maxBet: 500 },
    });
    await expect(t.act(0, 'bet', { amount: 50 })).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    expect(await wallet.balance('p0')).toBe(30);
  });

  // #region hidden-test
  it('reserves bets, deals, and hides the hole card from every viewer', async () => {
    const t = await createTestTable(blackjack, { players: 2, options: {} });
    await t.act(0, 'bet', { amount: 100 });
    await t.act(1, 'bet', { amount: 50 });
    expect(await t.wallet.balance('p0')).toBe(900);
    expect(await t.wallet.balance('p1')).toBe(950);
    expect(t.meta.phase).toBe('play');
    expect(t.state.dealer).toHaveLength(2);
    for (const viewer of [0, 1, 'spectator'] as const) {
      const view = t.viewOf(viewer);
      expect(view.dealer[1]).toBeNull();
      expect(view.dealerTotal).toBeNull();
      expect(JSON.stringify(view)).not.toContain(t.state.dealer[1]!);
      expect(view).not.toHaveProperty('shoe.cards');
    }
    expect(t.state.bankroll.slice(0, 2)).toEqual([900, 950]);
    expect(t.events.map((e) => e.name)).toContain('dealt');
  });
  // #endregion hidden-test

  // #region play-test
  it('plays a full hand: turns, timeout auto-stand, dealer play and wallet payouts', async () => {
    const t = await createTestTable(blackjack, { players: 2, options: {} });
    await t.act(0, 'bet', { amount: 100 });
    await t.act(1, 'bet', { amount: 100 });
    // With the default test seed neither player has a natural, so both get a turn.
    expect(t.meta.turn?.seat).toBe(0);
    await t.act(0, 'stand');
    expect(t.meta.turn?.seat).toBe(1);
    await t.advance(TURN_MS); // seat 1 times out and auto-stands
    expect(t.meta.phase).toBe('dealer');
    expect(t.viewOf(0).dealer).toEqual(t.state.dealer);
    expect(blackjackValue(t.state.dealer).total).toBeGreaterThanOrEqual(17);
    await t.runtime.idle();
    for (const seat of [0, 1]) {
      const hand = t.state.hands[seat]!;
      const expected = { blackjack: 250, win: 200, push: 100, lose: 0, bust: 0 }[hand.outcome!];
      expect(await t.wallet.balance(`p${String(seat)}`)).toBe(START - 100 + expected);
      expect(t.state.bankroll[seat]).toBe(START - 100 + expected);
    }
    expect(t.walletErrors).toEqual([]);
    await t.advance(NEXT_HAND_MS);
    expect(t.meta.phase).toBe('betting');
    expect(t.state.handNumber).toBe(2);
    await t.verifyReplay();
  });
  // #endregion play-test

  it('doubles by reserving a second stake', async () => {
    // Find a seed where the player gets a turn (no natural), so there is something to double.
    const findTurn = async () => {
      for (let i = 0; ; i++) {
        const table = await createTestTable(blackjack, {
          players: 1,
          options: {},
          seed: `double-${String(i)}`,
        });
        await table.act(0, 'bet', { amount: 100 });
        if (table.meta.turn?.seat === 0) return table;
      }
    };
    const t = await findTurn();
    await t.act(0, 'double');
    expect(t.state.hands[0]).toMatchObject({ bet: 200, doubled: true, done: true });
    await t.runtime.idle();
    const outcome = t.state.hands[0]!.outcome!;
    const expected = { blackjack: 500, win: 400, push: 200, lose: 0, bust: 0 }[outcome];
    expect(await t.wallet.balance('p0')).toBe(START - 200 + expected);
    await t.verifyReplay();
  });

  // #region leave-test
  it('returns the bet to a player who leaves before the deal', async () => {
    const t = await createTestTable(blackjack, { players: 2, options: {} });
    await t.act(0, 'bet', { amount: 100 });
    expect(await t.wallet.balance('p0')).toBe(900);
    await t.stand(0);
    await t.runtime.idle();
    expect(await t.wallet.balance('p0')).toBe(START);
  });
  // #endregion leave-test

  it('rejects actions out of turn', async () => {
    const t = await createTestTable(blackjack, { players: 2, options: {}, seed: 'no-naturals' });
    await t.act(0, 'bet', { amount: 100 });
    await t.act(1, 'bet', { amount: 100 });
    const turn = t.meta.turn?.seat;
    if (turn === null || turn === undefined) return; // both had blackjack with this seed
    const other = turn === 0 ? 1 : 0;
    await expect(t.act(other, 'hit')).rejects.toThrow(/NOT_YOUR_TURN|NO_ACTIVE_HAND/);
  });

  it('reopens betting when nobody bets', async () => {
    const t = await createTestTable(blackjack, { players: 1, options: {} });
    await t.advance(BET_MS);
    expect(t.meta.phase).toBe('betting');
    expect(t.meta.round?.number).toBe(2);
  });
});
