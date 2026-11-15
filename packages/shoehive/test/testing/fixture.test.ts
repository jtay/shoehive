import { describe, expect, it } from 'vitest';
import { blackjack } from '../../../../examples/blackjack/src/game';
import { holdem } from '../../../../examples/holdem/src/game';
import { quiz } from '../../../../examples/quiz/src/game';
import { ticTacToe } from '../../../../examples/tic-tac-toe/src/game';
import type { AnyGame } from '../../src/core/define';
import {
  createTestTable,
  fixtureStateHash,
  replayFixture,
  type Fixture,
  type TestTable,
} from '../../src/testing/index';

function fixtureOf(t: TestTable<AnyGame>): Fixture {
  return {
    shoehiveFixture: 1,
    game: t.runtime.game.id,
    version: t.runtime.game.version ?? 1,
    entries: [...t.runtime.log],
    expect: { rev: t.runtime.rev, stateHash: fixtureStateHash(t.runtime.state) },
  };
}

describe('replayFixture', () => {
  it('replays tic-tac-toe and the table keeps playing', async () => {
    const t = await createTestTable(ticTacToe, { players: 2 });
    await t.act(0, 'place', { cell: 0 });
    await t.act(1, 'place', { cell: 4 });
    const replayed = await replayFixture(ticTacToe, fixtureOf(t));
    expect(replayed.state).toEqual(t.state);
    await replayed.act(0, 'place', { cell: 1 });
    await replayed.act(1, 'place', { cell: 5 });
    await replayed.act(0, 'place', { cell: 2 });
    expect(replayed.meta.result).toEqual({ winner: 'X' });
    await replayed.verifyReplay();
  });

  it('replays quiz with its round timer re-armed', async () => {
    const t = await createTestTable(quiz, { players: 2, options: { questions: 2 } });
    await t.act(0, 'answer', { choice: 1 });
    const replayed = await replayFixture(quiz, fixtureOf(t));
    expect(replayed.meta).toEqual(t.meta);
    await replayed.advance(60_000);
    expect(replayed.meta.phase).not.toBe(t.meta.phase);
  });

  it('replays blackjack, including recorded wallet effects', async () => {
    const t = await createTestTable(blackjack, { players: 2 });
    await t.act(0, 'bet', { amount: 100 });
    await t.act(1, 'bet', { amount: 50 });
    const replayed = await replayFixture(blackjack, fixtureOf(t));
    expect(replayed.state).toEqual(t.state);
    expect(replayed.walletErrors).toEqual([]);
  });

  it('replays a Hold’em hand in progress', async () => {
    const t = await createTestTable(holdem, { players: 3 });
    const replayed = await replayFixture(holdem, fixtureOf(t));
    expect(replayed.state).toEqual(t.state);
    expect(replayed.viewOf(0)).toEqual(t.viewOf(0));
  });

  it('rejects a fixture for another game, version or a changed state', async () => {
    const t = await createTestTable(ticTacToe, { players: 2 });
    await t.act(0, 'place', { cell: 0 });
    const fixture = fixtureOf(t);
    await expect(replayFixture(quiz, fixture)).rejects.toThrow(/for game "tic-tac-toe"/);
    await expect(replayFixture(ticTacToe, { ...fixture, version: 2 })).rejects.toThrow(/version 2/);
    await expect(
      replayFixture(ticTacToe, {
        ...fixture,
        expect: { rev: fixture.expect!.rev, stateHash: 'x' },
      }),
    ).rejects.toThrow(/differs/);
    await expect(
      replayFixture(ticTacToe, { ...fixture, entries: fixture.entries.slice(1) }),
    ).rejects.toThrow(/create entry/);
  });
});
