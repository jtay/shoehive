import { defineGame, reject } from 'shoehive';
import { z } from 'zod';

// #region game
export const sealedBids = defineGame({
  id: 'sealed-bids',
  seats: { min: 2, max: 8 },
  setup: ({ seats }) => ({
    bids: {} as Record<string, number>,
    wins: Array<number>(seats).fill(0),
  }),

  rounds: {
    durationMs: 20_000, // the round also closes by itself after 20 seconds
    closeWhen: 'all-submitted', // ...or as soon as every participant has submitted
    onOpen: ({ state }) => {
      state.bids = {};
    },
    onClose: ({ state, ctx }) => {
      // Runs once per round, in its own entry, after the last submission has synced.
      const entries = Object.entries(state.bids).sort((a, b) => b[1] - a[1]);
      if (entries[0]) state.wins[Number(entries[0][0])]! += 1;
      if (ctx.round.number >= 3) ctx.end({ wins: state.wins });
      else ctx.round.next(); // rounds do not reopen by themselves
    },
  },

  actions: {
    bid: {
      once: true, // the seat's one submission this round
      input: z.object({ amount: z.number().int().min(1).max(100) }),
      run({ state, seat, input }) {
        if (input.amount % 5 !== 0) reject('BID_NOT_A_MULTIPLE_OF_FIVE');
        state.bids[String(seat)] = input.amount;
      },
    },
  },
});
// #endregion game
