import { defineGame, reject } from 'shoehive';
import { z } from 'zod';

// Each phase is a stage with its own rules: first everyone enters the duel at once,
// then the seats roll one at a time, then the game ends.
export const dice = defineGame({
  id: 'dice',
  seats: { min: 2, max: 4 },
  setup: ({ seats }) => ({
    in: Array<boolean>(seats).fill(false),
    dice: Array<number>(seats).fill(0),
    rolled: Array<number>(seats).fill(0),
  }),

  // The first phase declared is the initial one.
  phases: {
    // #region enter
    enter: {
      rounds: {
        closeWhen: 'all-submitted',
        onClose: ({ ctx }) => {
          ctx.phase.go('duel');
        },
      },
      actions: {
        // Only available in this phase. In any other phase it is ACTION_NOT_ALLOWED.
        join: {
          once: true,
          input: z.object({ stake: z.boolean() }),
          run({ state, seat, input }) {
            state.in[seat] = input.stake;
          },
        },
      },
    },
    // #endregion enter

    // #region duel
    duel: {
      turns: {
        // Seats that stayed out, or whose die is 1, never get a turn.
        skip: ({ seat, state }) => !state.in[seat] || state.dice[seat] === 1,
      },
      onEnter: ({ state, ctx }) => {
        // The first turn is chosen before this runs. If a die of 1 makes that seat
        // skippable, the engine moves on to the next seat afterwards (still turn 1).
        for (const seat of ctx.occupied) state.dice[seat] = 1 + ctx.random.int(6);
      },
      onExit: ({ ctx }) => {
        ctx.emit('duel-over');
      },
      actions: {
        roll: {
          run({ state, seat, ctx }) {
            if (ctx.turn.seat !== seat) reject('NOT_YOUR_TURN');
            state.rolled[seat] = state.dice[seat]!;
            ctx.turn.next();
            if (ctx.turn.seat === null) ctx.phase.go('done');
          },
        },
      },
    },
    // #endregion duel

    done: {
      onEnter: ({ state, ctx }) => {
        const best = Math.max(...state.rolled);
        ctx.end({ winners: ctx.occupied.filter((s) => state.rolled[s] === best) });
      },
    },
  },
});
