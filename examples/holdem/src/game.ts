// No-limit Texas Hold'em cash game, 2 to 9 seats.
//
// Money. The wallet only sees buy-ins and cash-outs; chips at the table live in state.
//   - Buy-in: when a player sits (or calls `rebuy` with an empty stack), the game reserves
//     `buyIn` from their wallet and commits it in the same entry, then adds it to the
//     seat's stack. If the reserve is refused the seat stays at 0 chips and sits out.
//   - Cash-out: when a player stands, `onStand` credits their whole remaining stack back
//     to the wallet. Chips they already put in the pot stay there (they fold).
//   - Every wallet key carries a table-wide counter from state (`ledger`), so keys never
//     repeat across seats or re-sits (credit keys must be unique for good; the engine
//     gives each reserve attempt its own backend key, so `rebuy` may simply reject).
//
// Turns. Each street phase declares `turns.first` from state (the hand is set up before
// the move to `preflop`, and bets are cleared before each later street), the engine's
// turn timer (`turns.timeoutMs` from the `turnMs` option) runs `timeout`, and after each
// action `ctx.turn.set` passes the turn to the next seat that still has to act.
//
// Rules decisions.
//   - `bet` and `raise` are aliases. `amount` is the total the seat's bet for this street
//     becomes ("raise to"), not the increment. Betting exactly your whole stack is all-in.
//   - Minimum bet is the big blind; a raise must add at least the last full raise on this
//     street (at least the big blind). A short all-in raise does not reopen the betting
//     for seats that already acted: they may only call or fold.
//   - Heads-up: the button posts the small blind and acts first preflop, last after.
//   - The button moves to the next seat with chips each hand. Blinds a player cannot
//     cover are posted all-in; the amount to call is still the full big blind.
//   - Uncalled chips (the part of the top bet nobody matched) go back at street end.
//   - Each turn lasts `turnMs` (the deadline is `meta.turn.deadline`); on expiry the seat
//     checks if it can, else folds. A seat that stands mid-hand folds.
//   - Hands that reach showdown are public: every viewer, spectators included, sees them.
//     Folded hands stay hidden from everyone but their owner. Odd chips go to the first
//     winner left of the button.

import {
  defineGame,
  reject,
  type ActionArgs,
  type ActionCtx,
  type Json,
  type TurnsConfig,
} from 'shoehive';
import {
  awardPots,
  draw,
  evaluateHand,
  revealTo,
  seatView,
  splitPots,
  standardDeck,
  type Card,
  type VisibleCard,
} from 'shoehive/cards';
import { z } from 'zod';

export const NEXT_HAND_MS = 5_000;

const optionsSchema = z
  .object({
    smallBlind: z.number().int().positive().default(5),
    bigBlind: z.number().int().positive().default(10),
    buyIn: z.number().int().positive().default(200),
    turnMs: z.number().int().positive().default(30_000),
  })
  .refine((o) => o.bigBlind >= o.smallBlind, {
    message: 'bigBlind must be at least smallBlind',
    path: ['bigBlind'],
  })
  .refine((o) => o.buyIn >= o.bigBlind, {
    message: 'buyIn must be at least bigBlind',
    path: ['buyIn'],
  });

export type HoldemOptions = z.output<typeof optionsSchema>;
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type HoldemPhase = 'waiting' | Street | 'showdown';

export interface SeatState {
  stack: number;
  hole: Card[];
  /** Dealt into the current hand. */
  inHand: boolean;
  folded: boolean;
  /** Chips put in on this street. */
  bet: number;
  /** Chips put in this hand (including `bet`); the pot is the sum over seats. */
  total: number;
  /** Acted since the last full raise on this street. */
  acted: boolean;
  /** Hole cards revealed at showdown. */
  shown: boolean;
}

export interface PotResult {
  amount: number;
  eligible: number[];
  winners: number[];
}

export interface HandResult {
  hand: number;
  /** Everyone else folded: no cards were shown. */
  uncontested: boolean;
  pots: PotResult[];
  /** Chips won per seat. */
  won: number[];
  /** Hand descriptions for seats that showed. */
  hands: (string | null)[];
}

export interface HoldemState {
  seats: SeatState[];
  hand: number;
  button: number;
  smallBlind: number;
  bigBlind: number;
  deck: Card[];
  board: Card[];
  /** The bet to match on this street. */
  currentBet: number;
  /** Size of the last full raise on this street (the minimum raise increment). */
  lastRaise: number;
  /** Counter for unique wallet keys. */
  ledger: number;
  last: HandResult | null;
}

type Ctx = ActionCtx<HoldemOptions, HoldemPhase>;
type Args<I = undefined> = ActionArgs<HoldemState, I, HoldemOptions, HoldemPhase>;

const STREETS: readonly string[] = ['preflop', 'flop', 'turn', 'river'];
const NEXT_STREET = { preflop: 'flop', flop: 'turn', turn: 'river', river: 'showdown' } as const;

const emptySeat = (): SeatState => ({
  stack: 0,
  hole: [],
  inHand: false,
  folded: false,
  bet: 0,
  total: 0,
  acted: false,
  shown: false,
});

// -------------------------------------------------------------------------------------
// Predicates

const live = (p: SeatState): boolean => p.inHand && !p.folded;
const canAct = (p: SeatState): boolean => live(p) && p.stack > 0;
const needsAction = (state: HoldemState, p: SeatState): boolean =>
  canAct(p) && (!p.acted || p.bet < state.currentBet);
const isBetting = (ctx: Ctx): boolean => STREETS.includes(ctx.phase.name ?? '');

/** True when no more betting can happen on this street. */
function bettingDone(state: HoldemState): boolean {
  const players = state.seats.filter(live);
  if (players.length <= 1) return true;
  const actors = players.filter((p) => p.stack > 0);
  if (actors.length === 0) return true;
  if (actors.length === 1) {
    // Alone with chips: done once they match every other live bet.
    const actor = actors[0]!;
    const facing = Math.max(...players.filter((p) => p !== actor).map((p) => p.bet));
    if (actor.bet >= facing) return true;
  }
  return !state.seats.some((p) => needsAction(state, p));
}

/** The next seat after `from` (clockwise, wrapping) that must act, or `null`. */
function nextToAct(state: HoldemState, from: number): number | null {
  const n = state.seats.length;
  for (let i = 1; i <= n; i++) {
    const seat = (from + i) % n;
    if (needsAction(state, state.seats[seat]!)) return seat;
  }
  return null;
}

/** Seats that can be dealt in: seated (or reserved) with chips. */
function dealable(state: HoldemState, ctx: Ctx): number[] {
  return ctx.occupied.filter((seat) => state.seats[seat]!.stack > 0);
}

// -------------------------------------------------------------------------------------
// Money

async function buyIn(state: HoldemState, seat: number, ctx: Ctx): Promise<boolean> {
  const { buyIn: amount } = ctx.options;
  state.ledger += 1;
  const key = `buyin:s${seat}:${state.ledger}`;
  const ok = await ctx.wallet.reserve(seat, amount, key);
  if (ok) {
    ctx.wallet.commit(key);
    state.seats[seat]!.stack += amount;
  }
  return ok;
}

/** Moves `amount` (capped at the stack) from the seat's stack into its bet. */
function put(p: SeatState, amount: number): number {
  const paid = Math.min(amount, p.stack);
  p.stack -= paid;
  p.bet += paid;
  p.total += paid;
  return paid;
}

// -------------------------------------------------------------------------------------
// Hand flow

/**
 * Sets up the next hand (button, blinds, hole cards) and moves to `preflop`, whose
 * `turns.first` reads this state. Returns false when fewer than two seats have chips.
 */
function startHand(state: HoldemState, ctx: Ctx): boolean {
  const dealt = dealable(state, ctx);
  if (dealt.length < 2) return false;
  const after = (seat: number): number => dealt.find((s) => s > seat) ?? dealt[0]!;
  state.hand += 1;
  state.seats.forEach((p, seat) => {
    Object.assign(p, { ...emptySeat(), stack: p.stack, inHand: dealt.includes(seat) });
  });
  state.board = [];
  state.last = null;
  state.button = after(state.button);
  // Heads-up, the button is the small blind.
  state.smallBlind = dealt.length === 2 ? state.button : after(state.button);
  state.bigBlind = after(state.smallBlind);
  const { smallBlind, bigBlind } = ctx.options;
  put(state.seats[state.smallBlind]!, smallBlind);
  put(state.seats[state.bigBlind]!, bigBlind);
  state.currentBet = bigBlind;
  state.lastRaise = bigBlind;

  state.deck = ctx.random.shuffle(standardDeck());
  const from = dealt.indexOf(state.smallBlind);
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < dealt.length; i++) {
      state.seats[dealt[(from + i) % dealt.length]!]!.hole.push(...draw(state.deck, 1));
    }
  }
  ctx.emit('handStart', {
    hand: state.hand,
    button: state.button,
    smallBlind: state.smallBlind,
    bigBlind: state.bigBlind,
  });
  ctx.phase.go('preflop');
  return true;
}

/** Deals the street's board cards (after a burn). Betting state was reset by `endStreet`. */
function dealStreet(state: HoldemState, cards: number): void {
  draw(state.deck, 1);
  state.board.push(...draw(state.deck, cards));
}

/** Returns uncalled chips, clears the street's bets and moves to the next phase. */
function endStreet(state: HoldemState, ctx: Ctx): void {
  // The part of the top bet that nobody else matched goes back (unless its owner folded).
  const bets = state.seats.map((p) => p.bet);
  const topSeat = bets.indexOf(Math.max(...bets));
  const top = state.seats[topSeat]!;
  const second = Math.max(...bets.filter((_, seat) => seat !== topSeat));
  if (live(top) && top.bet > second) {
    const refund = top.bet - second;
    top.stack += refund;
    top.total -= refund;
  }
  for (const p of state.seats) {
    p.bet = 0;
    p.acted = false;
  }
  state.currentBet = 0;
  state.lastRaise = ctx.options.bigBlind;
  const street = ctx.phase.name as Street;
  const players = state.seats.filter(live).length;
  ctx.phase.go(players <= 1 ? 'showdown' : NEXT_STREET[street]);
}

/** After `seat` acted: ends the street or passes the turn. */
function advance(state: HoldemState, ctx: Ctx, seat: number): void {
  if (bettingDone(state)) endStreet(state, ctx);
  else ctx.turn.set(nextToAct(state, seat)!);
}

function settle(state: HoldemState, ctx: Ctx): void {
  const contenders = state.seats.flatMap((p, seat) => (live(p) ? [seat] : []));
  const uncontested = contenders.length === 1;
  const scores = state.seats.map((p) => {
    if (!live(p)) return null;
    return uncontested ? 0 : evaluateHand([...p.hole, ...state.board]).rank;
  });
  if (!uncontested) for (const seat of contenders) state.seats[seat]!.shown = true;
  const pots = splitPots(
    state.seats.map((p) => p.total),
    state.seats.map((p) => !live(p)),
  );
  const firstSeat = (state.button + 1) % state.seats.length;
  const won = state.seats.map(() => 0);
  const results = pots.map((pot): PotResult => {
    const share = awardPots([pot], scores, { firstSeat });
    share.forEach((chips, seat) => (won[seat]! += chips));
    const winners = share.flatMap((chips, seat) => (chips > 0 ? [seat] : []));
    return { amount: pot.amount, eligible: pot.eligible, winners };
  });
  state.seats.forEach((p, seat) => {
    p.stack += won[seat]!;
    p.bet = 0;
    p.total = 0;
  });
  state.last = {
    hand: state.hand,
    uncontested,
    pots: results,
    won,
    hands: state.seats.map((p) =>
      p.shown ? evaluateHand([...p.hole, ...state.board]).description : null,
    ),
  };
  ctx.emit('handEnd', state.last as unknown as Json);
  ctx.timers.after('nextHand', NEXT_HAND_MS, 'nextHand', null, { visible: true });
}

// -------------------------------------------------------------------------------------
// Betting actions (shared by the four street phases)

function myTurn(state: HoldemState, seat: number, ctx: Ctx): SeatState {
  if (ctx.turn.seat !== seat) reject('NOT_YOUR_TURN');
  return state.seats[seat]!;
}

/** Whether `seat` may put in more than a call. */
function mayRaise(state: HoldemState, seat: number): boolean {
  const p = state.seats[seat]!;
  return !p.acted && state.seats.some((o, s) => s !== seat && canAct(o));
}

function raiseTo(state: HoldemState, seat: number, amount: number, ctx: Ctx): void {
  const p = myTurn(state, seat, ctx);
  const max = p.bet + p.stack;
  const min = state.currentBet + state.lastRaise;
  if (!mayRaise(state, seat)) reject('RAISE_NOT_ALLOWED');
  if (amount > max) reject('NOT_ENOUGH_CHIPS', { max });
  if (amount <= state.currentBet || (amount < min && amount < max)) {
    reject('RAISE_TOO_SMALL', { min: Math.min(min, max) });
  }
  const increment = amount - state.currentBet;
  put(p, amount - p.bet);
  if (increment >= state.lastRaise) {
    // A full raise reopens the betting for everyone else.
    state.lastRaise = increment;
    for (const o of state.seats) o.acted = false;
  }
  state.currentBet = amount;
  p.acted = true;
  ctx.emit('action', { seat, action: p.stack === 0 ? 'allIn' : 'raise', to: amount });
  advance(state, ctx, seat);
}

const amountInput = z.object({ amount: z.number().int().positive() });

const bettingActions = {
  fold: {
    run({ state, seat, ctx }: Args) {
      const p = myTurn(state, seat, ctx);
      p.folded = true;
      ctx.emit('action', { seat, action: 'fold' });
      advance(state, ctx, seat);
    },
  },
  check: {
    run({ state, seat, ctx }: Args) {
      const p = myTurn(state, seat, ctx);
      if (p.bet < state.currentBet) reject('CANNOT_CHECK', { toCall: state.currentBet - p.bet });
      p.acted = true;
      ctx.emit('action', { seat, action: 'check' });
      advance(state, ctx, seat);
    },
  },
  call: {
    run({ state, seat, ctx }: Args) {
      const p = myTurn(state, seat, ctx);
      if (p.bet >= state.currentBet) reject('NOTHING_TO_CALL');
      const paid = put(p, state.currentBet - p.bet);
      p.acted = true;
      ctx.emit('action', { seat, action: 'call', amount: paid });
      advance(state, ctx, seat);
    },
  },
  bet: {
    input: amountInput,
    run({ state, seat, input, ctx }: Args<{ amount: number }>) {
      raiseTo(state, seat, input.amount, ctx);
    },
  },
  raise: {
    input: amountInput,
    run({ state, seat, input, ctx }: Args<{ amount: number }>) {
      raiseTo(state, seat, input.amount, ctx);
    },
  },
  allIn: {
    run({ state, seat, ctx }: Args) {
      const p = myTurn(state, seat, ctx);
      const max = p.bet + p.stack;
      if (max > state.currentBet) {
        raiseTo(state, seat, max, ctx);
        return;
      }
      const paid = put(p, p.stack); // all-in for a call (or less)
      p.acted = true;
      ctx.emit('action', { seat, action: 'allIn', amount: paid });
      advance(state, ctx, seat);
    },
  },
  timeout: {
    internal: true,
    input: z.object({ seat: z.number().int() }),
    run({ state, input, ctx }: Args<{ seat: number }>) {
      const { seat } = input;
      const p = state.seats[seat]!;
      if (ctx.turn.seat !== seat || !needsAction(state, p)) return;
      if (p.bet >= state.currentBet) p.acted = true;
      else p.folded = true;
      ctx.emit('action', { seat, action: p.folded ? 'fold' : 'check', timeout: true });
      advance(state, ctx, seat);
    },
  },
};

/**
 * Turns for a betting street: the first seat after `from` that has to act starts. When
 * nobody has to act, `onEnter` ends the street at once, so the start does not matter.
 */
function streetTurns(
  from: (state: HoldemState) => number,
): TurnsConfig<HoldemState, HoldemOptions> {
  return {
    order: 'round-robin',
    first: ({ state }) => nextToAct(state, from(state)) ?? from(state),
    skip: ({ seat, state }) => !canAct(state.seats[seat]!),
    timeoutMs: ({ options }) => options.turnMs,
    onTimeout: 'timeout',
  };
}

/** `onEnter` of a betting street: deals its cards, or runs it out when nobody can bet. */
function enterStreet(state: HoldemState, ctx: Ctx, cards: number): void {
  if (cards > 0) dealStreet(state, cards);
  if (bettingDone(state)) endStreet(state, ctx);
}

// -------------------------------------------------------------------------------------
// The game

export const holdem = defineGame({
  id: 'holdem',
  name: "Texas Hold'em",
  description: "No-limit Texas Hold'em cash game.",
  seats: { min: 2, max: 9 },
  options: optionsSchema,

  setup: ({ seats }): HoldemState => ({
    seats: Array.from({ length: seats }, emptySeat),
    hand: 0,
    button: -1,
    smallBlind: -1,
    bigBlind: -1,
    deck: [],
    board: [],
    currentBet: 0,
    lastRaise: 0,
    ledger: 0,
    last: null,
  }),

  onSit: async ({ state, seat, ctx }) => {
    const p = state.seats[seat!]!;
    // Keep `bet` and `total`: they may be dead chips of a player who left mid-hand.
    Object.assign(p, { ...emptySeat(), bet: p.bet, total: p.total });
    await buyIn(state, seat!, ctx);
    if (ctx.phase.name === 'waiting') startHand(state, ctx);
  },

  onStand: ({ state, seat, ctx }) => {
    const p = state.seats[seat!]!;
    const wasLive = isBetting(ctx) && live(p);
    // Cash out what is left behind; chips already in the pot stay there.
    if (p.stack > 0) {
      state.ledger += 1;
      ctx.wallet.credit(seat!, p.stack, `cashout:s${seat!}:${state.ledger}`);
      p.stack = 0;
    }
    p.folded = true;
    p.hole = [];
    if (!wasLive) return;
    ctx.emit('action', { seat: seat!, action: 'fold', left: true });
    if (bettingDone(state)) {
      endStreet(state, ctx);
      return;
    }
    // The engine passed a turn held by the leaving seat to the next seat with chips,
    // which may not be the next one that has to act.
    const current = ctx.turn.seat;
    if (current === null || !needsAction(state, state.seats[current]!)) {
      ctx.turn.set(nextToAct(state, seat!)!);
    }
  },

  actions: {
    /** Buys in again with an empty stack (also after a refused buy-in at the seat). */
    rebuy: {
      preStart: true,
      async run({ state, seat, ctx }) {
        const p = state.seats[seat]!;
        if (isBetting(ctx) && live(p)) reject('IN_HAND');
        if (p.stack > 0) reject('HAS_CHIPS');
        if (!(await buyIn(state, seat, ctx))) {
          reject('INSUFFICIENT_FUNDS', { buyIn: ctx.options.buyIn });
        }
        if (ctx.phase.name === 'waiting') startHand(state, ctx);
        return { stack: p.stack };
      },
    },
  },

  phases: {
    waiting: {
      onEnter: ({ state, ctx }) => {
        startHand(state, ctx);
      },
    },
    preflop: {
      turns: streetTurns((state) => state.bigBlind),
      onEnter: ({ state, ctx }) => {
        enterStreet(state, ctx, 0); // blinds may already have put everyone all-in
      },
      actions: bettingActions,
    },
    flop: {
      turns: streetTurns((state) => state.button),
      onEnter: ({ state, ctx }) => {
        enterStreet(state, ctx, 3);
      },
      actions: bettingActions,
    },
    turn: {
      turns: streetTurns((state) => state.button),
      onEnter: ({ state, ctx }) => {
        enterStreet(state, ctx, 1);
      },
      actions: bettingActions,
    },
    river: {
      turns: streetTurns((state) => state.button),
      onEnter: ({ state, ctx }) => {
        enterStreet(state, ctx, 1);
      },
      actions: bettingActions,
    },
    showdown: {
      onEnter: ({ state, ctx }) => {
        settle(state, ctx);
      },
      actions: {
        nextHand: {
          internal: true,
          run({ state, ctx }) {
            if (!startHand(state, ctx)) ctx.phase.go('waiting');
          },
        },
      },
    },
  },

  view: ({ state, viewer }) => {
    // Own cards always; other hands only once shown at showdown (spectators hold no seat).
    const holes: VisibleCard[][] = seatView(
      state.seats.map((p) => p.hole),
      viewer,
      (hole, seat) => revealTo(hole, state.seats[seat]!.shown),
    );
    return {
      hand: state.hand,
      button: state.button,
      smallBlind: state.smallBlind,
      bigBlind: state.bigBlind,
      board: state.board,
      pot: state.seats.reduce((sum, p) => sum + p.total, 0),
      currentBet: state.currentBet,
      minRaiseTo: state.currentBet + state.lastRaise,
      seats: state.seats.map((p, seat) => ({
        stack: p.stack,
        bet: p.bet,
        inHand: p.inHand,
        folded: p.folded,
        allIn: live(p) && p.stack === 0,
        hole: holes[seat]!,
      })),
      last: state.last,
    };
  },
});
