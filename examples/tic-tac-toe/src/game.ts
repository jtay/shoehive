import { defineGame, reject } from 'shoehive';
import { z } from 'zod';

export type Mark = 'X' | 'O';

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

export function winnerOf(board: readonly (Mark | null)[]): Mark | 'draw' | null {
  for (const [a, b, c] of LINES) {
    const mark = board[a];
    if (mark && mark === board[b] && mark === board[c]) return mark;
  }
  return board.every((cell) => cell !== null) ? 'draw' : null;
}

// #region game
export const ticTacToe = defineGame({
  id: 'tic-tac-toe',
  name: 'Tic Tac Toe',
  seats: { min: 2, max: 2 },

  setup: () => ({
    board: Array<Mark | null>(9).fill(null),
    winner: null as Mark | 'draw' | null,
  }),

  turns: { order: 'round-robin' },

  actions: {
    place: {
      input: z.object({ cell: z.number().int().min(0).max(8) }),
      run({ state, seat, input, ctx }) {
        if (ctx.turn.seat !== seat) reject('NOT_YOUR_TURN');
        if (state.board[input.cell]) reject('CELL_TAKEN');
        state.board[input.cell] = seat === 0 ? 'X' : 'O';
        state.winner = winnerOf(state.board);
        if (state.winner) ctx.end({ winner: state.winner });
        else ctx.turn.next();
      },
    },
  },
});
// #endregion game
