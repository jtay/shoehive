import { MemoryWallet } from 'shoehive';
import { evaluateHand, winners, type Card } from 'shoehive/cards';
import { createTestTable, type TestTable } from 'shoehive/testing';
import { describe, expect, it } from 'vitest';
import { holdem, NEXT_HAND_MS, type HoldemState } from '../src/game';

type Table = TestTable<typeof holdem>;

const STARTING_BALANCE = 1000; // what MemoryWallet gives every player in tests
const STREETS = ['preflop', 'flop', 'turn', 'river'];

/** Chips at the table: stacks plus chips in the pot. */
function tableChips(state: HoldemState): number {
  let sum = 0;
  for (const p of state.seats) sum += p.stack + p.total;
  return sum;
}

async function walletTotal(t: Table, players: Iterable<string>): Promise<number> {
  let sum = 0;
  for (const player of players) sum += await t.wallet.balance(player);
  return sum;
}

const stacks = (t: Table, seats: number[]): number[] => seats.map((s) => t.state.seats[s]!.stack);

/** Checks every remaining street down, in turn order, until the hand reaches showdown. */
async function checkDown(t: Table): Promise<void> {
  while (STREETS.includes(t.meta.phase ?? '')) {
    const seat = t.meta.turn!.seat!;
    const view = t.viewOf(seat);
    await t.act(seat, view.seats[seat]!.bet < view.currentBet ? 'call' : 'check');
  }
}

/** The board as it will be dealt: burn, flop, burn, turn, burn, river (drawn from the end). */
function upcomingBoard(deck: readonly Card[]): Card[] {
  const top = deck.slice(-8).reverse();
  return [top[1]!, top[2]!, top[3]!, top[5]!, top[7]!];
}

describe('holdem options', () => {
  it('applies defaults and validates the blinds', async () => {
    const t = await createTestTable(holdem, { players: 2 });
    expect(t.meta.options).toEqual({ smallBlind: 5, bigBlind: 10, buyIn: 200, turnMs: 30_000 });
    await expect(
      createTestTable(holdem, { options: { smallBlind: 10, bigBlind: 5 } }),
    ).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    await expect(createTestTable(holdem, { options: { smallBlind: 0 } })).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
    await expect(
      createTestTable(holdem, { options: { bigBlind: 50, buyIn: 40 } }),
    ).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
  });
});

describe('holdem blinds and action order', () => {
  it('posts blinds and orders the action three-handed', async () => {
    const t = await createTestTable(holdem, { players: 3 });
    expect(t.meta.phase).toBe('preflop');
    expect(t.state).toMatchObject({ hand: 1, button: 0, smallBlind: 1, bigBlind: 2 });
    expect(stacks(t, [0, 1, 2])).toEqual([200, 195, 190]);
    expect(t.viewOf(0)).toMatchObject({ pot: 15, currentBet: 10, minRaiseTo: 20 });
    // Under the gun (left of the big blind) acts first preflop.
    expect(t.meta.turn?.seat).toBe(0);
    await t.act(0, 'call');
    expect(t.meta.turn?.seat).toBe(1);
    await t.act(1, 'call');
    // The big blind has the option.
    expect(t.meta.turn?.seat).toBe(2);
    await expect(t.act(2, 'call')).rejects.toMatchObject({ code: 'NOTHING_TO_CALL' });
    await t.act(2, 'check');
    expect(t.meta.phase).toBe('flop');
    expect(t.state.board).toHaveLength(3);
    // Postflop the first seat left of the button acts first.
    expect(t.meta.turn?.seat).toBe(1);
    await t.act(1, 'check');
    await t.act(2, 'check');
    await t.act(0, 'check');
    expect(t.meta.phase).toBe('turn');
    expect(t.state.board).toHaveLength(4);
    expect(t.meta.turn?.seat).toBe(1);
    await checkDown(t);
    expect(t.meta.phase).toBe('showdown');
    await t.advance(NEXT_HAND_MS);
    // The button moves one seat; so do the blinds.
    expect(t.state).toMatchObject({ hand: 2, button: 1, smallBlind: 2, bigBlind: 0 });
    expect(t.meta.turn?.seat).toBe(1);
    await t.verifyReplay();
  });

  it('heads-up: the button posts the small blind, acts first preflop and last after', async () => {
    const t = await createTestTable(holdem, { players: 2 });
    expect(t.state).toMatchObject({ button: 0, smallBlind: 0, bigBlind: 1 });
    expect(stacks(t, [0, 1])).toEqual([195, 190]);
    expect(t.meta.turn?.seat).toBe(0);
    await t.act(0, 'call');
    expect(t.meta.turn?.seat).toBe(1);
    await t.act(1, 'check');
    expect(t.meta.phase).toBe('flop');
    expect(t.meta.turn?.seat).toBe(1);
    await t.act(1, 'check');
    expect(t.meta.turn?.seat).toBe(0);
    await t.act(0, 'check');
    expect(t.meta.phase).toBe('turn');
    expect(t.meta.turn?.seat).toBe(1);
    await checkDown(t);
    await t.advance(NEXT_HAND_MS);
    expect(t.state).toMatchObject({ hand: 2, button: 1, smallBlind: 1, bigBlind: 0 });
    expect(t.meta.turn?.seat).toBe(1);
    await t.verifyReplay();
  });

  it('skips a seat with no chips and deals it in after a rebuy', async () => {
    const wallet = new MemoryWallet({ startingBalance: 1000, balances: { p1: 50 } });
    const t = await createTestTable(holdem, { players: 3, wallet });
    // p1 could not cover the buy-in: the seat sits out and the hand is heads-up.
    expect(stacks(t, [0, 1, 2])).toEqual([195, 0, 190]);
    expect(t.state.seats[1]!.inHand).toBe(false);
    expect(t.state).toMatchObject({ button: 0, smallBlind: 0, bigBlind: 2 });
    await expect(t.act(1, 'rebuy')).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
      details: { buyIn: 200 },
    });
    await expect(t.act(1, 'call')).rejects.toMatchObject({ code: 'NOT_YOUR_TURN' });
    // The refused rebuy rolled back, key counter included, so the retry reuses its game
    // key (`buyin:s1:4`); the engine gives each attempt its own backend key.
    expect(t.state.ledger).toBe(3);
    wallet.set('p1', 500);
    await t.act(1, 'rebuy');
    expect(t.state.ledger).toBe(4);
    expect(await t.wallet.balance('p1')).toBe(300);
    expect(t.state.seats[1]!.stack).toBe(200);
    await t.act(0, 'fold');
    await t.advance(NEXT_HAND_MS);
    expect(t.state.seats[1]!.inHand).toBe(true);
    expect(t.state).toMatchObject({ hand: 2, button: 1, smallBlind: 2, bigBlind: 0 });
    expect(t.walletErrors).toEqual([]);
    await t.verifyReplay();
  });
});

describe('holdem betting rules', () => {
  it('enforces the minimum raise, stack limits and turn order', async () => {
    const t = await createTestTable(holdem, { players: 3 });
    await expect(t.act(1, 'call')).rejects.toMatchObject({ code: 'NOT_YOUR_TURN' });
    await expect(t.act(0, 'check')).rejects.toMatchObject({
      code: 'CANNOT_CHECK',
      details: { toCall: 10 },
    });
    await expect(t.act(0, 'raise', { amount: 15 })).rejects.toMatchObject({
      code: 'RAISE_TOO_SMALL',
      details: { min: 20 },
    });
    await expect(t.act(0, 'raise', { amount: 10 })).rejects.toMatchObject({
      code: 'RAISE_TOO_SMALL',
    });
    await expect(t.act(0, 'raise', { amount: 201 })).rejects.toMatchObject({
      code: 'NOT_ENOUGH_CHIPS',
      details: { max: 200 },
    });
    await expect(t.act(0, 'raise', { amount: -5 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await t.act(0, 'raise', { amount: 20 }); // raise by 10
    // The next raise must add at least 10 again.
    await expect(t.act(1, 'raise', { amount: 25 })).rejects.toMatchObject({
      code: 'RAISE_TOO_SMALL',
      details: { min: 30 },
    });
    await t.act(1, 'raise', { amount: 45 }); // raise by 25
    expect(t.viewOf(2).minRaiseTo).toBe(70);
    await expect(t.act(2, 'raise', { amount: 60 })).rejects.toMatchObject({
      code: 'RAISE_TOO_SMALL',
      details: { min: 70 },
    });
    await t.act(2, 'call');
    await t.act(0, 'call');
    expect(t.meta.phase).toBe('flop');
    // Postflop the minimum bet is the big blind; `bet` and `raise` are the same action.
    await expect(t.act(1, 'bet', { amount: 5 })).rejects.toMatchObject({
      code: 'RAISE_TOO_SMALL',
      details: { min: 10 },
    });
    await t.act(1, 'bet', { amount: 10 });
    expect(stacks(t, [0, 1, 2])).toEqual([155, 145, 155]);
    // Betting actions only exist on the betting streets.
    await t.act(2, 'fold');
    await t.act(0, 'fold');
    expect(t.meta.phase).toBe('showdown');
    await expect(t.act(1, 'check')).rejects.toMatchObject({ code: 'ACTION_NOT_ALLOWED' });
    await expect(t.act(1, 'timeout', { seat: 1 })).rejects.toMatchObject({
      code: 'ACTION_NOT_ALLOWED',
    });
    await t.verifyReplay();
  });

  it('lets a short stack go all-in for less, without reopening the betting', async () => {
    const t = await createTestTable(holdem, { players: 3, options: { buyIn: 100 } });
    // Hand 1 shapes the stacks: seat 0 raises and takes the blinds.
    await t.act(0, 'raise', { amount: 30 });
    await t.act(1, 'fold');
    await t.act(2, 'fold');
    expect(stacks(t, [0, 1, 2])).toEqual([115, 95, 90]);
    await t.advance(NEXT_HAND_MS);
    // Hand 2: button 1, small blind 2, big blind 0; seat 1 acts first.
    expect(t.state).toMatchObject({ button: 1, smallBlind: 2, bigBlind: 0 });
    await t.act(1, 'raise', { amount: 60 }); // a full raise of 50
    await t.act(2, 'allIn'); // to 90: a raise of only 30
    expect(t.state.seats[2]!.stack).toBe(0);
    expect(t.viewOf(0)).toMatchObject({ currentBet: 90, minRaiseTo: 140 });
    await t.act(0, 'call');
    // Seat 1 already acted and faces only a short raise: call or fold, no raise.
    expect(t.meta.turn?.seat).toBe(1);
    await expect(t.act(1, 'raise', { amount: 95 })).rejects.toMatchObject({
      code: 'RAISE_NOT_ALLOWED',
    });
    await expect(t.act(1, 'allIn')).rejects.toMatchObject({ code: 'RAISE_NOT_ALLOWED' });
    await t.act(1, 'call');
    expect(t.meta.phase).toBe('flop');
    expect(stacks(t, [0, 1, 2])).toEqual([25, 5, 0]);
    expect(t.viewOf(0).pot).toBe(270);
    await checkDown(t);
    expect(t.meta.phase).toBe('showdown');
    expect(tableChips(t.state)).toBe(300);
    await t.verifyReplay();
  });

  it('ends the hand without a showdown when everyone folds', async () => {
    const t = await createTestTable(holdem, { players: 3 });
    await t.act(0, 'raise', { amount: 40 });
    await t.act(1, 'fold');
    await t.act(2, 'fold');
    expect(t.meta.phase).toBe('showdown');
    // The uncalled 30 goes back to seat 0, which wins its own 10 and the blinds.
    expect(stacks(t, [0, 1, 2])).toEqual([215, 195, 190]);
    const last = t.state.last!;
    expect(last).toMatchObject({ hand: 1, uncontested: true, won: [25, 0, 0, 0, 0, 0, 0, 0, 0] });
    expect(last.pots).toEqual([{ amount: 25, eligible: [0], winners: [0] }]);
    expect(last.hands.every((h) => h === null)).toBe(true);
    // Nobody's cards are shown.
    for (const viewer of [1, 2] as const) {
      expect(t.viewOf(viewer).seats[0]!.hole).toEqual([null, null]);
    }
    const end = t.events.find((e) => e.name === 'handEnd');
    expect(end?.payload).toMatchObject({ uncontested: true });
    expect(t.meta.timers['nextHand']).toBe(t.clock.now() + NEXT_HAND_MS);
    await t.advance(NEXT_HAND_MS);
    expect(t.meta.phase).toBe('preflop');
    expect(t.state.hand).toBe(2);
    await t.verifyReplay();
  });
});

describe('holdem showdown', () => {
  it("plays a hand to showdown and pays the evaluator's winner", async () => {
    const t = await createTestTable(holdem, { players: 3 });
    const holes = [0, 1, 2].map((s) => t.state.seats[s]!.hole);
    const board = upcomingBoard(t.state.deck);
    // With the default seed: seat 2 makes two pair, aces and sevens, and wins alone.
    const best = winners(holes.map((hole) => [...hole, ...board]));
    expect(best).toEqual([2]);
    expect(evaluateHand([...holes[2]!, ...board]).description).toBe('Two pair, Aces and Sevens');

    await t.act(0, 'call');
    await t.act(1, 'call');
    await t.act(2, 'check');
    await t.act(1, 'bet', { amount: 20 }); // the flop
    await t.act(2, 'call');
    await t.act(0, 'call');
    await checkDown(t);
    expect(t.meta.phase).toBe('showdown');
    expect(t.state.board).toEqual(board);
    expect(stacks(t, [0, 1, 2])).toEqual([170, 170, 260]);
    expect(t.state.last).toMatchObject({
      uncontested: false,
      pots: [{ amount: 90, eligible: [0, 1, 2], winners: [2] }],
    });
    expect(t.state.last!.hands.slice(0, 3)).toEqual([
      'Pair of Sevens',
      'Two pair, Kings and Sevens',
      'Two pair, Aces and Sevens',
    ]);
    // Hands that reached showdown are public: every viewer sees them, spectators too.
    for (const viewer of [0, 1, 2, 'spectator'] as const) {
      expect(
        t
          .viewOf(viewer)
          .seats.slice(0, 3)
          .map((s) => s.hole),
      ).toEqual(holes);
    }
    await t.verifyReplay();
  });

  it('keeps a folded hand hidden at showdown from everyone but its owner', async () => {
    const t = await createTestTable(holdem, { players: 3 });
    const holes = [0, 1, 2].map((s) => t.state.seats[s]!.hole);
    await t.act(0, 'fold');
    await t.act(1, 'call');
    await t.act(2, 'check');
    await checkDown(t);
    expect(t.meta.phase).toBe('showdown');
    expect(t.state.last!.hands.slice(0, 3)).toEqual([null, expect.any(String), expect.any(String)]);
    expect(t.viewOf(0).seats[0]!.hole).toEqual(holes[0]);
    for (const viewer of [1, 2, 'spectator'] as const) {
      const view = t.viewOf(viewer);
      expect(view.seats[0]!.hole).toEqual([null, null]);
      expect(view.seats[1]!.hole).toEqual(holes[1]);
      expect(view.seats[2]!.hole).toEqual(holes[2]);
      for (const card of holes[0]!) expect(JSON.stringify(view)).not.toContain(`"${card}"`);
    }
    await t.verifyReplay();
  });

  it('pays side pots in a three-way all-in, with the odd chip left of the button', async () => {
    // Seed chosen so that seats 0 and 2 tie for the (odd) main pot.
    const t = await createTestTable(holdem, {
      players: 3,
      seed: 'side-pots-30',
      options: { smallBlind: 1, bigBlind: 2, buyIn: 100 },
    });
    // Hand 1 shapes the stacks to 108, 99 and 93.
    await t.act(0, 'raise', { amount: 7 });
    await t.act(1, 'fold');
    await t.act(2, 'call');
    await t.act(2, 'check');
    await t.act(0, 'bet', { amount: 10 });
    await t.act(2, 'fold');
    expect(stacks(t, [0, 1, 2])).toEqual([108, 99, 93]);
    await t.advance(NEXT_HAND_MS);

    // Hand 2: button 1. Seat 1 shoves 99, seat 2 is all-in for 93, seat 0 calls.
    expect(t.state).toMatchObject({ button: 1, smallBlind: 2, bigBlind: 0 });
    const holes = [0, 1, 2].map((s) => t.state.seats[s]!.hole);
    const board = upcomingBoard(t.state.deck);
    const rank = holes.map((hole) => evaluateHand([...hole, ...board]).rank);
    expect(winners(holes.map((hole) => [...hole, ...board]))).toEqual([0, 2]);
    expect(rank[0]).toBeGreaterThan(rank[1]!);

    await t.act(1, 'allIn');
    await t.act(2, 'allIn');
    await t.act(0, 'call');
    // Nobody can bet any more: the board runs out to showdown.
    expect(t.meta.phase).toBe('showdown');
    expect(t.state.board).toEqual(board);
    expect(t.state.last!.pots).toEqual([
      { amount: 279, eligible: [0, 1, 2], winners: [0, 2] },
      { amount: 12, eligible: [0, 1], winners: [0] },
    ]);
    // 279 splits 140 / 139: the odd chip goes to seat 2, the first winner left of the
    // button (seat 1). Seat 0 also wins the side pot and keeps its 9 behind.
    expect(t.state.last!.won.slice(0, 3)).toEqual([151, 0, 140]);
    expect(stacks(t, [0, 1, 2])).toEqual([160, 0, 140]);
    expect(tableChips(t.state)).toBe(300);

    // Seat 1 is busted: it sits out the next hand, which is heads-up.
    await t.advance(NEXT_HAND_MS);
    expect(t.state.seats[1]!.inHand).toBe(false);
    expect(t.state).toMatchObject({ hand: 3, button: 2, smallBlind: 2, bigBlind: 0 });
    await t.verifyReplay();
  });
});

describe('holdem turn timer', () => {
  it('checks when it can and folds when it cannot', async () => {
    const t = await createTestTable(holdem, { players: 3, options: { turnMs: 5_000 } });
    // The engine's turn timer, from the `turnMs` option.
    expect(t.meta.turn).toEqual({ seat: 0, deadline: t.clock.now() + 5_000 });
    await t.advance(4_999);
    expect(t.meta.turn?.seat).toBe(0);
    await t.advance(1); // seat 0 faces the big blind: folds
    expect(t.state.seats[0]!.folded).toBe(true);
    expect(t.meta.turn).toEqual({ seat: 1, deadline: t.clock.now() + 5_000 });
    await t.act(1, 'call');
    await t.advance(5_000); // the big blind can check: checks
    expect(t.state.seats[2]!.folded).toBe(false);
    expect(t.meta.phase).toBe('flop');
    expect(
      t.events.filter((e) => e.payload !== null && (e.payload as { timeout?: true }).timeout),
    ).toHaveLength(2);
    // A timer that fires after the action moved on does nothing.
    await t.act(1, 'check');
    await t.act(2, 'check');
    expect(t.meta.phase).toBe('turn');
    await t.verifyReplay();
  });
});

describe('holdem money', () => {
  it('buys in from the wallet on sit and cashes out the whole stack on stand', async () => {
    const t = await createTestTable(holdem, { players: 2 });
    expect(await t.wallet.balance('p0')).toBe(800);
    expect(await t.wallet.balance('p1')).toBe(800);
    expect(stacks(t, [0, 1])).toEqual([195, 190]);
    await t.act(0, 'fold'); // heads-up: seat 0 is the small blind
    expect(stacks(t, [0, 1])).toEqual([195, 205]);
    await t.advance(NEXT_HAND_MS);
    // Hand 2: seat 1 posts the small blind (5), then leaves. It folds, the 5 stays in the
    // pot and the 200 behind goes back to the wallet.
    await t.stand(1);
    expect(await t.wallet.balance('p1')).toBe(1000);
    expect(t.meta.phase).toBe('showdown');
    expect(t.state.seats[0]!.stack).toBe(200);

    // Re-sits buy in again and cash out again, each with a fresh key: if a key repeated,
    // the wallet would treat the second credit as a duplicate and the balance would lag.
    await t.sit(1, 'p1');
    expect(await t.wallet.balance('p1')).toBe(800);
    expect(t.state.seats[1]!.stack).toBe(200);
    await t.stand(1);
    expect(await t.wallet.balance('p1')).toBe(1000);
    await t.stand(0);
    expect(await t.wallet.balance('p0')).toBe(1000);
    expect(t.state.ledger).toBe(6); // 3 buy-ins and 3 cash-outs
    expect(t.walletErrors).toEqual([]);
    await t.verifyReplay();
  });

  it('folds a player who stands mid-hand and cashes out what they had behind', async () => {
    const t = await createTestTable(holdem, { players: 3 });
    await t.act(0, 'raise', { amount: 30 });
    // Seat 1 (to act) leaves: it folds, and the turn passes to seat 2.
    await t.stand(1);
    expect(t.state.seats[1]).toMatchObject({ folded: true, stack: 0, total: 5, hole: [] });
    expect(await t.wallet.balance('p1')).toBe(995);
    expect(t.meta.turn).toEqual({ seat: 2, deadline: t.clock.now() + 30_000 });
    // Someone else sits in the empty seat mid-hand: the dead blind stays in the pot.
    await t.sit(1, 'p9');
    expect(t.state.seats[1]).toMatchObject({ stack: 200, inHand: false, total: 5 });
    await t.act(2, 'call');
    expect(t.meta.phase).toBe('flop');
    expect(t.viewOf(0).pot).toBe(65);
    // The last opponent leaves: the hand ends uncontested.
    await t.stand(2);
    expect(t.meta.phase).toBe('showdown');
    expect(t.state.seats[0]!.stack).toBe(235);
    expect(await t.wallet.balance('p2')).toBe(970);
    const players = ['p0', 'p1', 'p2', 'p9'];
    expect((await walletTotal(t, players)) + tableChips(t.state)).toBe(4 * STARTING_BALANCE);
    expect(t.walletErrors).toEqual([]);
    await t.verifyReplay();
  });
});

// -------------------------------------------------------------------------------------
// Property: random legal play conserves chips and never leaks hole cards.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Asserts chips are conserved and no view leaks a hidden card. */
async function checkInvariants(t: Table, players: Set<string>): Promise<void> {
  const state = t.state;
  expect(t.walletErrors).toEqual([]);
  expect((await walletTotal(t, players)) + tableChips(state)).toBe(players.size * STARTING_BALANCE);
  for (const p of state.seats) expect(p.stack).toBeGreaterThanOrEqual(0);

  const deck = new Set<string>(state.deck);
  const viewers: (number | 'spectator')[] = ['spectator'];
  t.seats.forEach((s, seat) => {
    if (s.status !== 'empty') viewers.push(seat);
  });
  for (const viewer of viewers) {
    const view = t.viewOf(viewer);
    const json = JSON.stringify(view);
    for (const card of deck) expect(json).not.toContain(`"${card}"`);
    view.seats.forEach((seen, seat) => {
      const own = viewer === seat;
      const revealed = state.seats[seat]!.shown;
      if (own || revealed) expect(seen.hole).toEqual(state.seats[seat]!.hole);
      else expect(seen.hole.every((c) => c === null)).toBe(true);
      // Hidden cards must not show up anywhere else in the view either.
      if (!own && !revealed) {
        for (const card of state.seats[seat]!.hole) expect(json).not.toContain(`"${card}"`);
      }
    });
  }
}

async function randomSession(
  seed: string,
  seats: number,
  maxHands: number,
): Promise<{ hands: number; showdowns: number }> {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  const rand = mulberry32(hash);
  const t = await createTestTable(holdem, {
    players: seats,
    seed,
    options: { smallBlind: 1, bigBlind: 2, buyIn: 60, turnMs: 1_000 },
  });
  const players = new Set(Array.from({ length: seats }, (_, i) => `p${i}`));
  const away = new Map<number, string>(); // seat -> player who stood up from it
  let showdowns = 0;
  await checkInvariants(t, players);

  for (let step = 0; step < 5_000 && t.state.hand <= maxHands; step++) {
    const phase = t.meta.phase ?? '';
    if (STREETS.includes(phase)) {
      const seat = t.meta.turn!.seat!;
      const roll = rand();
      if (roll < 0.03) {
        await t.advance(1_000); // time out
      } else if (roll < 0.05) {
        // Someone (maybe the seat to act) leaves mid-hand.
        const occupied = t.seats.flatMap((s, i) => (s.status === 'empty' ? [] : [i]));
        const leaver = occupied[Math.floor(rand() * occupied.length)]!;
        away.set(leaver, t.playerAt(leaver));
        await t.stand(leaver);
      } else {
        const view = t.viewOf(seat);
        const me = view.seats[seat]!;
        const toCall = view.currentBet - me.bet;
        const max = me.bet + me.stack;
        const pick = rand();
        const raiseTo = Math.min(
          max,
          view.minRaiseTo + Math.floor(rand() * Math.max(1, max - view.minRaiseTo)),
        );
        try {
          if (pick < 0.15 && toCall > 0) await t.act(seat, 'fold');
          else if (pick < 0.65 || max <= view.currentBet) {
            await t.act(seat, toCall > 0 ? 'call' : 'check');
          } else if (pick < 0.92) await t.act(seat, 'raise', { amount: raiseTo });
          else await t.act(seat, 'allIn');
        } catch (error) {
          // The only legal-looking moves that may be refused: raising when the betting
          // is closed to this seat.
          expect(error).toMatchObject({ code: 'RAISE_NOT_ALLOWED' });
          await t.act(seat, toCall > 0 ? 'call' : 'check');
        }
      }
    } else {
      if (phase === 'showdown') showdowns += t.state.last!.uncontested ? 0 : 1;
      // Between hands: leavers come back, busted players rebuy, and now and then a
      // player cashes out by standing up (to come back later).
      for (const [seat, player] of away) {
        if (t.seats[seat]!.status === 'empty' && rand() < 0.5) {
          await t.sit(seat, player);
          away.delete(seat);
        }
      }
      for (let seat = 0; seat < seats; seat++) {
        if (t.seats[seat]!.status === 'empty') continue;
        const p = t.state.seats[seat]!;
        const player = t.playerAt(seat);
        if (p.stack === 0 && (await t.wallet.balance(player)) >= 60) {
          await t.act(seat, 'rebuy');
        } else if (p.stack > 0 && rand() < 0.03) {
          away.set(seat, player);
          await t.stand(seat);
        }
      }
      if (phase === 'waiting' && away.size === 0 && t.meta.phase === 'waiting') break;
      await t.advance(NEXT_HAND_MS);
    }
    await checkInvariants(t, players);
  }
  await t.verifyReplay();
  return { hands: t.state.hand, showdowns };
}

describe('holdem random play', () => {
  it('conserves chips and never leaks hole cards over 200+ hands', async () => {
    let hands = 0;
    let showdowns = 0;
    for (let i = 0; hands < 200; i++) {
      const result = await randomSession(`random-${i}`, 2 + (i % 8), 40);
      hands += result.hands;
      showdowns += result.showdowns;
    }
    expect(hands).toBeGreaterThanOrEqual(200);
    expect(showdowns).toBeGreaterThan(20);
  }, 60_000);
});
