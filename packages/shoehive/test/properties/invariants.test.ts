// Property tests for the engine invariants in RFC 0001 section 4, run against the real
// example games with random command sequences:
//   1. a rejected action or seat change leaves no trace (state, engine, log unchanged)
//   2. game code never crashes (no INTERNAL) whatever clients send
//   3. the same commands produce the same log (determinism)
//   4. replaying the log reproduces the state exactly (verifyReplay)
//   5. applying each viewer's patches in order reproduces that viewer's view
//   6. no viewer sees a secret (per game: blackjack's shoe and hole card)

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { blackjack } from '../../../../examples/blackjack/src/game';
import { quiz } from '../../../../examples/quiz/src/game';
import { ticTacToe } from '../../../../examples/tic-tac-toe/src/game';
import { applyPatch, diff } from '../../src/core/diff';
import { isShoehiveError } from '../../src/core/errors';
import { jsonEqual, type Json } from '../../src/core/json';
import type { AnyGame } from '../../src/core/define';
import { createTestTable, type TestTable } from '../../src/testing/index';

type Cmd =
  | { t: 'act'; seat: number; name: string; input?: unknown }
  | { t: 'advance'; ms: number }
  | { t: 'sit' | 'stand' | 'disconnect' | 'reconnect'; seat: number };

async function exec(table: TestTable<AnyGame>, cmd: Cmd): Promise<void> {
  const runtime = table.runtime;
  switch (cmd.t) {
    case 'act': {
      const player = runtime.seats()[cmd.seat]?.player?.id ?? `p${String(cmd.seat)}`;
      try {
        await runtime.act({ player, seat: cmd.seat, name: cmd.name, input: cmd.input });
      } finally {
        await runtime.idle();
      }
      return;
    }
    case 'advance':
      await table.advance(cmd.ms);
      return;
    case 'sit':
      await table.sit(cmd.seat);
      return;
    case 'stand':
      await runtime.stand({ seat: cmd.seat });
      await runtime.idle();
      return;
    case 'disconnect':
    case 'reconnect': {
      const player = runtime.seats()[cmd.seat]?.player?.id;
      if (player) await runtime[cmd.t]({ player });
      await runtime.idle();
      return;
    }
  }
}

/** A per-game secrecy check, run on every viewer's view after every command. */
type SecretCheck = (table: TestTable<AnyGame>, view: Json, viewer: string) => void;

async function play(
  game: AnyGame,
  options: unknown,
  players: number,
  cmds: Cmd[],
  check?: SecretCheck,
) {
  const table: TestTable<AnyGame> = await createTestTable<AnyGame>(game, { players, options });
  const docs = new Map<string, Json>();
  const syncViews = () => {
    const viewers = [
      'spectator',
      ...table.seats.flatMap((s, seat) => (s.player ? [String(seat)] : [])),
    ];
    for (const key of [...docs.keys()]) if (!viewers.includes(key)) docs.delete(key);
    for (const key of viewers) {
      const viewer = table.runtime.viewerFor(
        key === 'spectator' ? null : table.playerAt(Number(key)),
      );
      const view = table.runtime.view(viewer);
      const previous = docs.get(key);
      const next = previous === undefined ? view : applyPatch(previous, diff(previous, view));
      expect(jsonEqual(next, view)).toBe(true); // invariant 5
      check?.(table, view, key); // invariant 6
      docs.set(key, next);
    }
  };
  syncViews();
  for (const cmd of cmds) {
    const before = {
      state: table.runtime.state,
      engine: table.runtime.engine,
      log: table.log.length,
    };
    try {
      await exec(table, cmd);
    } catch (error) {
      expect(isShoehiveError(error)).toBe(true);
      if (isShoehiveError(error)) expect(error.code, error.message).not.toBe('INTERNAL'); // invariant 2
      expect(table.runtime.state).toBe(before.state); // invariant 1
      expect(table.runtime.engine).toBe(before.engine);
      expect(table.log.length).toBe(before.log);
    }
    syncViews();
  }
  await table.verifyReplay(); // invariant 4
  return table.log;
}

function property(
  game: AnyGame,
  options: unknown,
  players: number,
  cmd: fc.Arbitrary<Cmd>,
  { numRuns = 150, check }: { numRuns?: number; check?: SecretCheck } = {},
) {
  return fc.assert(
    fc.asyncProperty(fc.array(cmd, { maxLength: 40 }), async (cmds) => {
      const a = await play(game, options, players, cmds, check);
      const b = await play(game, options, players, cmds);
      expect(jsonEqual(a, b)).toBe(true); // invariant 3
    }),
    { numRuns },
  );
}

/** Every card string in a JSON value (`'KS'`, `'TD'`...), in document order. */
function cardsIn(value: Json): string[] {
  if (typeof value === 'string') return /^[2-9TJQKA][SHDC]$/.test(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(cardsIn);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(cardsIn);
  return [];
}

// Blackjack: hands are public, the shoe never leaves the server, and the dealer's
// second card stays hidden until the dealer plays. So a view holds exactly the cards of
// every hand plus the dealer's visible cards, and nothing else.
const blackjackSecrets: SecretCheck = (table, view) => {
  const state = table.state as {
    dealer: string[];
    hands: ({ cards: string[] } | null)[];
  };
  const revealed = table.meta.phase === 'dealer';
  const dealer = revealed ? state.dealer : state.dealer.filter((_, i) => i !== 1);
  const expected = [...state.hands.flatMap((h) => h?.cards ?? []), ...dealer].sort();
  expect(cardsIn(view).sort()).toEqual(expected);
};

const seatCmd = (maxSeat: number) =>
  fc.record({
    t: fc.constantFrom(
      'sit' as const,
      'stand' as const,
      'disconnect' as const,
      'reconnect' as const,
    ),
    seat: fc.integer({ min: 0, max: maxSeat }),
  });
const advance = (max: number) =>
  fc.record({ t: fc.constant('advance' as const), ms: fc.integer({ min: 0, max: max }) });

describe('engine invariants (property tests)', () => {
  it('tic-tac-toe', async () => {
    const cmd: fc.Arbitrary<Cmd> = fc.oneof(
      fc.record({
        t: fc.constant('act' as const),
        seat: fc.integer({ min: 0, max: 1 }),
        name: fc.constant('place'),
        input: fc.record({ cell: fc.integer({ min: -1, max: 9 }) }),
      }),
      seatCmd(1),
    );
    await property(ticTacToe, undefined, 2, cmd);
  });

  it('quiz', async () => {
    const cmd: fc.Arbitrary<Cmd> = fc.oneof(
      fc.record({
        t: fc.constant('act' as const),
        seat: fc.integer({ min: 0, max: 3 }),
        name: fc.constantFrom('answer', 'nextQuestion'),
        input: fc.record({ choice: fc.integer({ min: 0, max: 4 }) }),
      }),
      advance(20_000),
      seatCmd(3),
    );
    await property(quiz, { questions: 2 }, 3, cmd);
  });

  it('blackjack', async () => {
    const cmd: fc.Arbitrary<Cmd> = fc.oneof(
      fc.record({
        t: fc.constant('act' as const),
        seat: fc.integer({ min: 0, max: 3 }),
        name: fc.constant('bet'),
        input: fc.record({ amount: fc.constantFrom(0, 10, 100, 600, 5000) }),
      }),
      fc.record({
        t: fc.constant('act' as const),
        seat: fc.integer({ min: 0, max: 3 }),
        name: fc.constantFrom('hit', 'stand', 'double', 'autoStand'),
      }),
      advance(35_000),
      seatCmd(4),
    );
    await property(blackjack, {}, 3, cmd, { check: blackjackSecrets });
  });
});
