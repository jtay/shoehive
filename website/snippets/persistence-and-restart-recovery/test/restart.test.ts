// Testing recovery (/how-to/persistence-and-restart-recovery/): crash a server, start a new
// one over the same store.
import { createServer } from 'shoehive/server';
import { memoryStore } from 'shoehive/store/memory';
import { describe, expect, it } from 'vitest';
import { ticTacToe } from '../../quick-start/src/game';

describe('restart recovery', () => {
  // #region crash
  it('brings a table back after a crash', async () => {
    const store = memoryStore(); // a durable store works the same way
    const first = createServer({ games: [ticTacToe], store });
    const { id } = await first.tables.create('tic-tac-toe');
    await first.close({ graceful: false }); // like kill -9: no final snapshot

    const second = createServer({ games: [ticTacToe], store });
    await second.ready; // recovery finishes before this resolves
    expect(second.tables.get(id)?.game).toBe('tic-tac-toe');
    await second.close();
  });
  // #endregion crash
});
