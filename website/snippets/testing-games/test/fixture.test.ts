import { replayFixture, type Fixture } from 'shoehive/testing';
import { expect, it } from 'vitest';
import { ticTacToe } from '../../../../examples/tic-tac-toe/src/game';
import fixture from '../fixtures/centre-bug.json';

// #region fixture
it('plays on from an exported fixture', async () => {
  const t = await replayFixture(ticTacToe, fixture as Fixture);
  expect(t.state.board[4]).toBe('X'); // the table is at the last exported entry
  await t.act(1, 'place', { cell: 0 }); // and it keeps running
  await t.verifyReplay();
});
// #endregion fixture
