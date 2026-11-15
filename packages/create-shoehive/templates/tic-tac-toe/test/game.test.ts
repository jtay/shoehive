import { createTestTable } from 'shoehive/testing';
import { describe, expect, it } from 'vitest';
import { ticTacToe } from '../src/game';

describe('tic-tac-toe', () => {
  it('rejects a move out of turn', async () => {
    const t = await createTestTable(ticTacToe, { players: 2 });
    await expect(t.act(1, 'place', { cell: 0 })).rejects.toMatchObject({
      code: 'NOT_YOUR_TURN',
      source: 'game',
    });
    expect(t.state.board[0]).toBeNull();
  });

  it('X wins on the diagonal and the table ends', async () => {
    const t = await createTestTable(ticTacToe, { players: 2 });
    for (const [seat, cell] of [
      [0, 0],
      [1, 1],
      [0, 4],
      [1, 2],
      [0, 8],
    ] as const) {
      await t.act(seat, 'place', { cell });
    }
    expect(t.state.winner).toBe('X');
    expect(t.meta.status).toBe('ended');
    expect(t.meta.result).toEqual({ winner: 'X' });
    await expect(t.act(1, 'place', { cell: 3 })).rejects.toMatchObject({ code: 'TABLE_ENDED' });
    await t.verifyReplay();
  });

  it('validates input with the schema', async () => {
    const t = await createTestTable(ticTacToe, { players: 2 });
    // @ts-expect-error cell must be a number
    await expect(t.act(0, 'place', { cell: 'centre' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(t.act(0, 'place', { cell: 9 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('rejects a taken cell without changing anything', async () => {
    const t = await createTestTable(ticTacToe, { players: 2 });
    await t.act(0, 'place', { cell: 4 });
    const rev = t.rev;
    await expect(t.act(1, 'place', { cell: 4 })).rejects.toMatchObject({ code: 'CELL_TAKEN' });
    expect(t.rev).toBe(rev);
    expect(t.meta.turn?.seat).toBe(1);
  });

  it('does not start until both seats are taken', async () => {
    const t = await createTestTable(ticTacToe, { players: 1 });
    expect(t.meta.status).toBe('waiting');
    await expect(t.act(0, 'place', { cell: 0 })).rejects.toMatchObject({ code: 'NOT_STARTED' });
    await t.sit(1);
    expect(t.meta.status).toBe('active');
    expect(t.meta.turn?.seat).toBe(0);
  });
});
