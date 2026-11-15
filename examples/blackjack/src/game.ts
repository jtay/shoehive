// Blackjack against the house. Money goes through ctx.wallet (ADR 0007):
//   - a bet reserves its amount (`bet:<hand>:<seat>`); a double reserves the same again
//     (`double:<hand>:<seat>`), so a player cannot bet money they do not have;
//   - at settlement every reservation is committed (the stake is taken) and winnings,
//     including the returned stake on a win or push, are credited (`pay:<hand>:<seat>`);
//   - a player who leaves before the deal gets the bet back (release); after the deal
//     the bet is forfeit (commit).
// `bankroll` is a display copy: the wallet balance when the player sat, adjusted by
// this table's bets and payouts. The wallet is the source of truth.

import { defineGame, reject } from 'shoehive';
import { blackjackValue, hideCard, shoe, type Card } from 'shoehive/cards';
import { z } from 'zod';

export const BET_MS = 20_000;
export const TURN_MS = 30_000;
export const NEXT_HAND_MS = 5_000;

type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

interface Hand {
  bet: number;
  doubled: boolean;
  cards: Card[];
  done: boolean;
  outcome: Outcome | null;
}

const betKey = (hand: number, seat: number) => `bet:${String(hand)}:${String(seat)}`;
const doubleKey = (hand: number, seat: number) => `double:${String(hand)}:${String(seat)}`;
const payKey = (hand: number, seat: number) => `pay:${String(hand)}:${String(seat)}`;

const PAYOUT: Record<Outcome, number> = { blackjack: 2.5, win: 2, push: 1, lose: 0, bust: 0 };

export const blackjack = defineGame({
  id: 'blackjack',
  name: 'Blackjack',
  seats: { min: 1, max: 5 },
  options: z.object({
    decks: z.number().int().min(1).max(8).default(6),
    minBet: z.number().int().min(1).default(10),
    maxBet: z.number().int().min(1).default(500),
  }),

  setup: ({ seats }) => ({
    shoe: [] as Card[],
    dealer: [] as Card[],
    bankroll: Array<number>(seats).fill(0),
    hands: Array<Hand | null>(seats).fill(null),
    handNumber: 0,
  }),

  onSit: async ({ state, seat, ctx }) => {
    state.bankroll[seat!] = await ctx.wallet.balance(seat!);
  },
  onStand: ({ state, seat, ctx }) => {
    const hand = state.hands[seat!];
    if (hand?.outcome === null) {
      // Before the deal the bet comes back; once cards are out it is forfeit.
      const keys = [betKey(state.handNumber, seat!)];
      if (hand.doubled) keys.push(doubleKey(state.handNumber, seat!));
      for (const key of keys) {
        if (hand.cards.length === 0) ctx.wallet.release(key);
        else ctx.wallet.commit(key);
      }
    }
    state.bankroll[seat!] = 0;
    state.hands[seat!] = null;
  },

  phases: {
    betting: {
      rounds: {
        durationMs: BET_MS,
        closeWhen: 'all-submitted',
        onOpen: ({ state }) => {
          state.handNumber += 1;
          state.dealer = [];
          state.hands = state.hands.map(() => null);
        },
        onClose: ({ state, ctx }) => {
          if (state.hands.some((h) => h !== null)) ctx.phase.go('play');
          else ctx.round.next(); // nobody bet: open betting again
        },
      },
      actions: {
        bet: {
          once: true,
          input: z.object({ amount: z.number().int().positive() }),
          async run({ state, seat, input, ctx }) {
            const { minBet, maxBet } = ctx.options;
            if (input.amount < minBet || input.amount > maxBet)
              reject('BET_OUT_OF_RANGE', { minBet, maxBet });
            if (!(await ctx.wallet.reserve(seat, input.amount, betKey(state.handNumber, seat))))
              reject('INSUFFICIENT_FUNDS');
            state.bankroll[seat]! -= input.amount;
            state.hands[seat] = {
              bet: input.amount,
              doubled: false,
              cards: [],
              done: false,
              outcome: null,
            };
          },
        },
      },
    },

    play: {
      turns: {
        skip: ({ seat, state }) => {
          const hand = state.hands[seat];
          return !hand || hand.done;
        },
        timeoutMs: TURN_MS,
        onTimeout: 'autoStand',
      },
      onEnter: ({ state, ctx }) => {
        // Reshuffle when the shoe runs low.
        if (state.shoe.length < 52) state.shoe = ctx.random.shuffle(shoe(ctx.options.decks));
        const draw = () => state.shoe.pop()!;
        for (let i = 0; i < 2; i++) {
          for (const hand of state.hands) hand?.cards.push(draw());
          state.dealer.push(draw());
        }
        for (const hand of state.hands) {
          if (hand && blackjackValue(hand.cards).blackjack) hand.done = true;
        }
        ctx.emit('dealt', { hand: state.handNumber });
        // The engine moves the first turn past naturals after onEnter; with every hand
        // done (all naturals) there is no turn to play.
        if (state.hands.every((h) => !h || h.done)) ctx.phase.go('dealer');
      },
      actions: {
        hit: {
          run({ state, seat, ctx }) {
            const hand = myTurn(state.hands, seat, ctx.turn.seat);
            hand.cards.push(state.shoe.pop()!);
            if (blackjackValue(hand.cards).total >= 21) finishHand(hand, ctx);
          },
        },
        stand: {
          run({ state, seat, ctx }) {
            finishHand(myTurn(state.hands, seat, ctx.turn.seat), ctx);
          },
        },
        double: {
          async run({ state, seat, ctx }) {
            const hand = myTurn(state.hands, seat, ctx.turn.seat);
            if (hand.cards.length !== 2) reject('CANNOT_DOUBLE');
            if (!(await ctx.wallet.reserve(seat, hand.bet, doubleKey(state.handNumber, seat))))
              reject('INSUFFICIENT_FUNDS');
            state.bankroll[seat]! -= hand.bet;
            hand.doubled = true;
            hand.bet *= 2;
            hand.cards.push(state.shoe.pop()!);
            finishHand(hand, ctx);
          },
        },
        autoStand: {
          internal: true,
          input: z.object({ seat: z.number().int() }),
          run({ state, input, ctx }) {
            const hand = state.hands[input.seat];
            if (hand && !hand.done) finishHand(hand, ctx);
          },
        },
      },
    },

    dealer: {
      onEnter: ({ state, ctx }) => {
        const anyLive = state.hands.some((h) => {
          const value = h && blackjackValue(h.cards);
          return value && !value.bust && !value.blackjack;
        });
        // Dealer draws to 17 and stands on all 17s.
        while (anyLive && blackjackValue(state.dealer).total < 17)
          state.dealer.push(state.shoe.pop()!);
        const dealer = blackjackValue(state.dealer);
        state.hands.forEach((hand, seat) => {
          if (!hand) return;
          const value = blackjackValue(hand.cards);
          let outcome: Outcome;
          if (value.bust) outcome = 'bust';
          else if (value.blackjack) outcome = dealer.blackjack ? 'push' : 'blackjack';
          else if (dealer.blackjack) outcome = 'lose';
          else if (dealer.bust || value.total > dealer.total) outcome = 'win';
          else if (value.total === dealer.total) outcome = 'push';
          else outcome = 'lose';
          hand.outcome = outcome;
          ctx.wallet.commit(betKey(state.handNumber, seat));
          if (hand.doubled) ctx.wallet.commit(doubleKey(state.handNumber, seat));
          const payout = Math.floor(hand.bet * PAYOUT[outcome]);
          if (payout > 0) ctx.wallet.credit(seat, payout, payKey(state.handNumber, seat));
          state.bankroll[seat]! += payout;
        });
        ctx.timers.after('nextHand', NEXT_HAND_MS, 'nextHand');
      },
      actions: {
        nextHand: {
          internal: true,
          run({ ctx }) {
            ctx.phase.go('betting');
          },
        },
      },
    },
  },

  view: ({ state, ctx }) => {
    const revealDealer = ctx.phase === 'dealer';
    return {
      handNumber: state.handNumber,
      bankroll: state.bankroll,
      hands: state.hands,
      // The hole card (the dealer's second card) stays face down until the dealer plays.
      dealer: revealDealer
        ? state.dealer
        : state.dealer.map((card, i) => (i === 1 ? hideCard(card) : card)),
      dealerTotal: revealDealer ? blackjackValue(state.dealer).total : null,
      shoe: { remaining: state.shoe.length },
    };
  },
});

function myTurn(hands: (Hand | null)[], seat: number, turn: number | null): Hand {
  if (turn !== seat) reject('NOT_YOUR_TURN');
  const hand = hands[seat];
  if (!hand || hand.done) reject('NO_ACTIVE_HAND');
  return hand;
}

function finishHand(
  hand: Hand,
  ctx: { turn: { next(): void; readonly seat: number | null }; phase: { go(p: 'dealer'): void } },
): void {
  hand.done = true;
  ctx.turn.next();
  if (ctx.turn.seat === null) ctx.phase.go('dealer');
}
