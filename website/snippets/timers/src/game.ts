import { defineGame, reject } from 'shoehive';
import { z } from 'zod';

// Pass the bomb: take your turn before your clock runs out. The whole game also has a
// fuse, and whoever holds the bomb when it burns out loses.
export const FUSE_MS = 60_000;

export const bomb = defineGame({
  id: 'bomb',
  seats: { min: 2, max: 4 },
  options: z.object({ turnMs: z.number().int().positive().default(10_000) }),
  setup: ({ seats }) => ({ passes: 0, timeouts: Array<number>(seats).fill(0) }),

  // #region turns
  turns: {
    order: 'round-robin',
    // A number, or a function of the table options.
    timeoutMs: ({ options }) => options.turnMs,
    // Runs as an internal action when the clock runs out, with `{ seat }` as its input.
    onTimeout: 'timeout',
  },
  // #endregion turns

  // #region fuse
  onStart: ({ ctx }) => {
    // `visible: true` publishes the deadline to clients as `meta.timers.fuse`.
    ctx.timers.after('fuse', FUSE_MS, 'explode', null, { visible: true });
  },
  // #endregion fuse

  actions: {
    pass: {
      run({ state, seat, ctx }) {
        if (ctx.turn.seat !== seat) reject('NOT_YOUR_TURN');
        state.passes += 1;
        ctx.turn.next(); // re-arms the turn clock for the next seat
      },
    },

    // #region internal
    timeout: {
      internal: true, // clients get ACTION_NOT_ALLOWED if they try to call it
      input: z.object({ seat: z.number().int() }),
      run({ state, input, ctx }) {
        state.timeouts[input.seat]! += 1;
        ctx.turn.next();
      },
    },
    explode: {
      internal: true,
      run({ ctx }) {
        ctx.end({ loser: ctx.turn.seat });
      },
    },
    // #endregion internal
  },
});
