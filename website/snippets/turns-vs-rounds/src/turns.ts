import { defineGame, reject } from 'shoehive';

// #region game
export const lastOneIn = defineGame({
  id: 'last-one-in',
  seats: { min: 2, max: 5 },
  setup: ({ seats }) => ({ start: 0, folded: Array<boolean>(seats).fill(false) }),

  turns: {
    // Play runs from the highest seat down. The function returns every seat once.
    order: ({ seats }) => [...seats].reverse(),
    // Who starts. It must be a seat in the order.
    first: ({ state, seats }) => (seats.includes(state.start) ? state.start : seats[0]!),
    // Seats to pass over when the turn advances.
    skip: ({ seat, state }) => state.folded[seat]!,
  },

  actions: {
    fold: {
      run({ state, seat, ctx }) {
        // The engine does not check whose turn it is. Every turn action should.
        if (ctx.turn.seat !== seat) reject('NOT_YOUR_TURN');
        state.folded[seat] = true;
        const left = ctx.occupied.filter((s) => !state.folded[s]);
        if (left.length === 1) ctx.end({ winner: left[0]! });
        else ctx.turn.next();
      },
    },
    pass: {
      run({ seat, ctx }) {
        if (ctx.turn.seat !== seat) reject('NOT_YOUR_TURN');
        ctx.turn.next();
      },
    },
  },
});
// #endregion game
