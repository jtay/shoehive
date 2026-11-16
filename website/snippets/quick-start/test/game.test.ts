// The quick start's new test (/start/quick-start/), next to the template's own tests.
import { createTestTable } from 'shoehive/testing';
import { describe, expect, it } from 'vitest';
import { ticTacToe } from '../src/game';

describe('tic-tac-toe', () => {
  // #region centre
  it('does not allow the centre on the first move', async () => {
    const t = await createTestTable(ticTacToe, { players: 2 });
    await expect(t.act(0, 'place', { cell: 4 })).rejects.toMatchObject({
      code: 'CENTRE_ON_FIRST_MOVE',
    });
    await t.act(0, 'place', { cell: 0 });
    await t.act(1, 'place', { cell: 4 }); // fine after the first move
    expect(t.state.board[4]).toBe('O');
  });
  // #endregion centre
});
