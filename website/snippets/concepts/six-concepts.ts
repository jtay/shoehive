// Shown on /start/six-concepts/. A two-player guessing game small enough to show all six
// concepts: Game, Table, Seat, Player, Action and View.
import { defineGame, reject } from 'shoehive';
import { createTestTable } from 'shoehive/testing';
import { z } from 'zod';

// #region game
export const guessTheNumber = defineGame({
  id: 'guess-the-number',
  name: 'Guess the number',
  seats: { min: 2, max: 2 },

  setup: ({ random }) => ({
    secret: random.int(100) + 1,
    guesses: [] as { seat: number; value: number }[],
  }),

  turns: { order: 'round-robin' },

  // #region action
  actions: {
    guess: {
      input: z.object({ value: z.number().int().min(1).max(100) }),
      run({ state, seat, input, ctx }) {
        if (ctx.turn.seat !== seat) reject('NOT_YOUR_TURN');
        state.guesses.push({ seat, value: input.value });
        if (input.value === state.secret) ctx.end({ winner: seat });
        else ctx.turn.next();
      },
    },
  },
  // #endregion action

  // #region view
  view: ({ state, ctx }) => ({
    guesses: state.guesses.map(({ seat, value }) => ({
      seat,
      value,
      hint: value < state.secret ? 'higher' : value > state.secret ? 'lower' : 'correct',
    })),
    // Nobody sees the secret until the game is over.
    secret: ctx.status === 'ended' ? state.secret : null,
  }),
  // #endregion view
});
// #endregion game

// #region table
export async function playOneTurn() {
  // A Table is one running instance of the Game, here with two players seated.
  const table = await createTestTable(guessTheNumber, { players: 2 });

  // Seat 0 acts. Only an Action can change the state.
  await table.act(0, 'guess', { value: 50 });

  // Each seat receives its View, never the raw state.
  const view = table.viewOf(1);
  return view.guesses[0]?.hint; // 'higher', 'lower' or 'correct'
}
// #endregion table
