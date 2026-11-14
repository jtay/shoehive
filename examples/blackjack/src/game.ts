import { defineGame, reject } from 'shoehive';
import { z } from 'zod';
import { freshShoe, handValue, isBlackjack, type Card } from './cards';

export const BET_MS = 20_000;
export const TURN_MS = 30_000;
export const NEXT_HAND_MS = 5_000;
export const STARTING_CHIPS = 1000;

type Outcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust';

interface Hand {
  bet: number;
  cards: Card[];
  done: boolean;
  outcome: Outcome | null;
}

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
    chips: Array<number>(seats).fill(0),
    hands: Array<Hand | null>(seats).fill(null),
    handNumber: 0,
  }),

  onSit: ({ state, seat }) => {
    state.chips[seat!] = STARTING_CHIPS;
  },
  onStand: ({ state, seat }) => {
    state.chips[seat!] = 0;
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
          run({ state, seat, input, ctx }) {
            const { minBet, maxBet } = ctx.options;
            if (input.amount < minBet || input.amount > maxBet)
              reject('BET_OUT_OF_RANGE', { minBet, maxBet });
            if (input.amount > state.chips[seat]!) reject('NOT_ENOUGH_CHIPS');
            state.chips[seat]! -= input.amount;
            state.hands[seat] = { bet: input.amount, cards: [], done: false, outcome: null };
          },
        },
      },
    },

    play: {
      turns: {
        skip: ({ seat, state }) => {
          const hand = (state as { hands: (Hand | null)[] }).hands[seat];
          return !hand || hand.done;
        },
        timeoutMs: TURN_MS,
        onTimeout: 'autoStand',
      },
      onEnter: ({ state, ctx }) => {
        // Reshuffle when the shoe runs low.
        if (state.shoe.length < 52) state.shoe = ctx.random.shuffle(freshShoe(ctx.options.decks));
        const draw = () => state.shoe.pop()!;
        for (let i = 0; i < 2; i++) {
          for (const hand of state.hands) hand?.cards.push(draw());
          state.dealer.push(draw());
        }
        for (const hand of state.hands) {
          if (hand && isBlackjack(hand.cards)) hand.done = true;
        }
        ctx.emit('dealt', { hand: state.handNumber });
        if (ctx.turn.seat === null) ctx.phase.go('dealer'); // everyone has blackjack
      },
      actions: {
        hit: {
          run({ state, seat, ctx }) {
            const hand = myTurn(state.hands, seat, ctx.turn.seat);
            hand.cards.push(state.shoe.pop()!);
            if (handValue(hand.cards).total >= 21) finishHand(hand, ctx);
          },
        },
        stand: {
          run({ state, seat, ctx }) {
            finishHand(myTurn(state.hands, seat, ctx.turn.seat), ctx);
          },
        },
        double: {
          run({ state, seat, ctx }) {
            const hand = myTurn(state.hands, seat, ctx.turn.seat);
            if (hand.cards.length !== 2) reject('CANNOT_DOUBLE');
            if (state.chips[seat]! < hand.bet) reject('NOT_ENOUGH_CHIPS');
            state.chips[seat]! -= hand.bet;
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
        const anyLive = state.hands.some(
          (h) => h && handValue(h.cards).total <= 21 && !isBlackjack(h.cards),
        );
        // Dealer draws to 17 and stands on all 17s.
        while (anyLive && handValue(state.dealer).total < 17) state.dealer.push(state.shoe.pop()!);
        const dealer = handValue(state.dealer).total;
        const dealerBlackjack = isBlackjack(state.dealer);
        state.hands.forEach((hand, seat) => {
          if (!hand) return;
          const total = handValue(hand.cards).total;
          let outcome: Outcome;
          if (total > 21) outcome = 'bust';
          else if (isBlackjack(hand.cards)) outcome = dealerBlackjack ? 'push' : 'blackjack';
          else if (dealerBlackjack) outcome = 'lose';
          else if (dealer > 21 || total > dealer) outcome = 'win';
          else if (total === dealer) outcome = 'push';
          else outcome = 'lose';
          hand.outcome = outcome;
          state.chips[seat]! += Math.floor(hand.bet * PAYOUT[outcome]);
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
      chips: state.chips,
      hands: state.hands,
      // The hole card (the dealer's second card) stays face down until the dealer plays.
      dealer: revealDealer ? state.dealer : state.dealer.map((card, i) => (i === 1 ? null : card)),
      dealerTotal: revealDealer ? handValue(state.dealer).total : null,
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
