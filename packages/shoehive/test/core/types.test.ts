// Type-level tests. `expectTypeOf` is checked by `tsc` (pnpm typecheck); at runtime
// these are no-ops. They pin the inference the client and React layers will rely on.

import * as v from 'valibot';
import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  defineGame,
  reject,
  type GameActions,
  type GameOptions,
  type GamePhases,
  type GameState,
  type GameView,
} from '../../src/index';
import { createTestTable } from '../../src/testing/index';

const game = defineGame({
  id: 'types',
  seats: { min: 1, max: 2 },
  options: z.object({ target: z.number().default(10) }),
  setup: ({ options }) => ({ n: 0, target: options.target, names: [] as string[] }),
  actions: {
    add: {
      input: z.object({ by: z.number() }),
      run({ state, input }) {
        expectTypeOf(input).toEqualTypeOf<{ by: number }>();
        expectTypeOf(state.n).toEqualTypeOf<number>();
        state.n += input.by;
      },
    },
    name: {
      input: v.object({ name: v.string() }), // valibot works too
      run({ state, input }) {
        state.names.push(input.name);
      },
    },
    reset: {
      run({ state, input, ctx }) {
        expectTypeOf(input).toEqualTypeOf<undefined>();
        state.n = 0;
        ctx.phase.go('second');
        // @ts-expect-error unknown phase name
        ctx.phase.go('nope');
      },
    },
  },
  phases: {
    first: {},
    second: {
      actions: {
        finish: {
          input: z.object({ score: z.number() }),
          run({ input, ctx }) {
            ctx.end({ score: input.score });
          },
        },
      },
    },
  },
  view: ({ state, viewer }) => ({ n: state.n, me: viewer.seat }),
});

describe('type inference', () => {
  it('infers state, options and view', () => {
    expectTypeOf<GameState<typeof game>>().toEqualTypeOf<{
      n: number;
      target: number;
      names: string[];
    }>();
    expectTypeOf<GameOptions<typeof game>>().toEqualTypeOf<{ target: number }>();
    expectTypeOf<GameView<typeof game>>().toEqualTypeOf<{ n: number; me: number | null }>();
  });

  it('collects every action, top-level and per phase, with its input', () => {
    type Actions = GameActions<typeof game>;
    expectTypeOf<Actions['add']>().toEqualTypeOf<{ by: number }>();
    expectTypeOf<Actions['name']>().toEqualTypeOf<{ name: string }>();
    expectTypeOf<Actions['finish']>().toEqualTypeOf<{ score: number }>();
    expectTypeOf<keyof Actions>().toEqualTypeOf<'add' | 'name' | 'reset' | 'finish'>();
  });

  it('types the test table', async () => {
    const t = await createTestTable(game, { options: {} });
    expectTypeOf(t.state.n).toEqualTypeOf<number>();
    expectTypeOf(t.viewOf(0)).toEqualTypeOf<{ n: number; me: number | null }>();
    const typeOnly = () => {
      void t.act(0, 'add', { by: 1 });
      void t.act(0, 'reset');
      // @ts-expect-error wrong input type
      void t.act(0, 'add', { by: '1' });
      // @ts-expect-error unknown action
      void t.act(0, 'nope');
      // @ts-expect-error input is required
      void t.act(0, 'finish');
    };
    expectTypeOf(typeOnly).toBeFunction();
  });

  it('reject() refuses built-in codes and returns never', () => {
    const typeOnly = () => {
      // @ts-expect-error built-in codes are reserved
      reject('NOT_FOUND');
      expectTypeOf(reject('MY_CODE')).toBeNever();
    };
    expectTypeOf(typeOnly).toBeFunction();
  });
});

// Regression: when every action is an input-less `run({ state })`, TypeScript excludes
// the actions object from its first inference pass. Names must still be inferred.
const _inputless = defineGame({
  id: 'inputless',
  seats: { min: 1, max: 1 },
  setup: () => ({ n: 0 }),
  actions: {
    bump: {
      run({ state }) {
        state.n++;
      },
    },
  },
});
const _inputlessPhases = defineGame({
  id: 'inputless-phases',
  seats: { min: 1, max: 1 },
  setup: () => ({ n: 0 }),
  phases: {
    a: {
      actions: {
        step: {
          run({ state, ctx }) {
            state.n++;
            ctx.phase.go('b');
          },
        },
      },
    },
    b: {
      actions: {
        back: {
          run({ ctx }) {
            ctx.phase.go('a');
          },
        },
      },
    },
  },
});

describe('type inference without any input schemas', () => {
  it('still infers action and phase names', () => {
    expectTypeOf<GameActions<typeof _inputless>>().toEqualTypeOf<{ bump: undefined }>();
    expectTypeOf<GameActions<typeof _inputlessPhases>>().toEqualTypeOf<{
      step: undefined;
      back: undefined;
    }>();
    expectTypeOf<GamePhases<typeof _inputlessPhases>>().toEqualTypeOf<'a' | 'b'>();
  });
});
