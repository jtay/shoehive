import { defineGame } from 'shoehive';

/** Presses needed to win. */
export const TARGET = 10;

// A starting point: one shared counter and one action. Whoever makes the last press wins.
// Rename it, then grow it: add state in setup(), actions with input schemas, turns, phases.
export const game = defineGame({
  id: 'my-game',
  name: 'My Game',
  // The table starts as soon as one seat is taken; up to four players can join.
  seats: { min: 1, max: 4 },

  setup: () => ({
    count: 0,
    winner: null as number | null,
  }),

  actions: {
    press: {
      run({ state, seat, ctx }) {
        state.count += 1;
        if (state.count === TARGET) {
          state.winner = seat;
          ctx.end({ winner: seat });
        }
      },
    },
  },
});
