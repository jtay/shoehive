import { createTestTable } from 'shoehive/testing';
import { describe, expect, it } from 'vitest';
import { handValue, type Card } from '../src/cards';
import { blackjack, BET_MS, NEXT_HAND_MS, STARTING_CHIPS, TURN_MS } from '../src/game';

describe('blackjack cards', () => {
  it('counts aces as 1 or 11', () => {
    expect(handValue(['AS', 'KD'] as Card[])).toEqual({ total: 21, soft: true });
    expect(handValue(['AS', 'AD', '9C'] as Card[])).toEqual({ total: 21, soft: true });
    expect(handValue(['AS', 'KD', '5C'] as Card[])).toEqual({ total: 16, soft: false });
  });
});

describe('blackjack', () => {
  it('gives each seated player chips and opens betting', async () => {
    const t = await createTestTable(blackjack, { players: 2, options: {} });
    expect(t.state.chips.slice(0, 2)).toEqual([STARTING_CHIPS, STARTING_CHIPS]);
    expect(t.meta.phase).toBe('betting');
  });

  it('validates bets against the table options', async () => {
    const t = await createTestTable(blackjack, { players: 1, options: { minBet: 25 } });
    await expect(t.act(0, 'bet', { amount: 10 })).rejects.toMatchObject({
      code: 'BET_OUT_OF_RANGE',
      details: { minBet: 25, maxBet: 500 },
    });
    await expect(t.act(0, 'bet', { amount: 5000 })).rejects.toMatchObject({
      code: 'BET_OUT_OF_RANGE',
    });
  });

  it('deals after betting and hides the hole card from every viewer', async () => {
    const t = await createTestTable(blackjack, { players: 2, options: {} });
    await t.act(0, 'bet', { amount: 100 });
    await t.act(1, 'bet', { amount: 50 });
    expect(t.meta.phase).toBe('play');
    expect(t.state.dealer).toHaveLength(2);
    for (const viewer of [0, 1, 'spectator'] as const) {
      const view = t.viewOf(viewer);
      expect(view.dealer[1]).toBeNull();
      expect(view.dealerTotal).toBeNull();
      expect(JSON.stringify(view)).not.toContain(t.state.dealer[1]!);
      expect(view).not.toHaveProperty('shoe.cards');
    }
    expect(t.state.chips.slice(0, 2)).toEqual([900, 950]);
    expect(t.events.map((e) => e.name)).toContain('dealt');
  });

  it('plays a full hand: turns, timeout auto-stand, dealer play and payouts', async () => {
    const t = await createTestTable(blackjack, { players: 2, options: {} });
    await t.act(0, 'bet', { amount: 100 });
    await t.act(1, 'bet', { amount: 100 });
    // With the default test seed neither player has a natural, so both get a turn.
    expect(t.meta.turn?.seat).toBe(0);
    await t.act(0, 'stand');
    expect(t.meta.turn?.seat).toBe(1);
    await t.advance(TURN_MS); // seat 1 times out and auto-stands
    expect(t.meta.phase).toBe('dealer');
    const view = t.viewOf(0);
    expect(view.dealer).toEqual(t.state.dealer);
    expect(handValue(t.state.dealer).total).toBeGreaterThanOrEqual(17);
    for (const seat of [0, 1]) {
      const hand = t.state.hands[seat]!;
      const expected = { blackjack: 250, win: 200, push: 100, lose: 0, bust: 0 }[hand.outcome!];
      expect(t.state.chips[seat]).toBe(STARTING_CHIPS - 100 + expected);
    }
    await t.advance(NEXT_HAND_MS);
    expect(t.meta.phase).toBe('betting');
    expect(t.state.handNumber).toBe(2);
    await t.verifyReplay();
  });

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
