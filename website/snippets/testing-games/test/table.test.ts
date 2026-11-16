import { MemoryWallet } from 'shoehive';
import { createTestTable } from 'shoehive/testing';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { blackjack } from '../../../../examples/blackjack/src/game';
import { ticTacToe } from '../../../../examples/tic-tac-toe/src/game';

describe('createTestTable', () => {
  // #region options
  it('seats players by count or by id, with a seed and a wallet', async () => {
    const wallet = new MemoryWallet({ startingBalance: 1000, balances: { ada: 30 } });
    const t = await createTestTable(blackjack, {
      players: ['ada', 'bo'], // or a number: p0, p1, ...
      seed: 'my-seed', // default: 'shoehive-test'
      options: { minBet: 25 }, // checked against the game's options schema
      wallet, // default: a MemoryWallet giving everyone 1000
    });
    expect(t.playerAt(0)).toBe('ada');
    expect(await t.wallet.balance('ada')).toBe(30);
  });
  // #endregion options

  // #region seats
  it('sits, disconnects and reconnects players', async () => {
    const t = await createTestTable(ticTacToe, { players: 1 });
    expect(t.meta.status).toBe('waiting');

    await t.sit(1); // seat 1 as player p1; the table starts
    expect(t.meta.status).toBe('active');

    await t.disconnect(1); // the seat is kept, but marked offline
    expect(t.seats[1]?.connected).toBe(false);
    await t.reconnect(1);
    expect(t.seats[1]?.connected).toBe(true);

    await t.stand(1); // the seat is empty again
    expect(t.seats[1]?.player).toBeNull();
  });
  // #endregion seats

  // #region seed
  it('finds a seed that gives the deal you want to test', async () => {
    for (let i = 0; ; i++) {
      const t = await createTestTable(blackjack, { players: 1, seed: `deal-${String(i)}` });
      await t.act(0, 'bet', { amount: 100 });
      if (t.meta.turn?.seat === 0) {
        // No natural blackjack with this seed: the player has a turn.
        await t.act(0, 'stand');
        expect(t.meta.phase).toBe('dealer');
        break;
      }
    }
  });
  // #endregion seed

  // #region types
  it('checks action names and inputs at compile time', async () => {
    const t = await createTestTable(ticTacToe, { players: 2 });
    // This function is never called: the point is that tsc accepts the three errors below.
    const misuse = async () => {
      // @ts-expect-error there is no action called "play"
      await t.act(0, 'play', { cell: 0 });
      // @ts-expect-error cell must be a number
      await t.act(0, 'place', { cell: 'centre' });
      // @ts-expect-error this action needs an input
      await t.act(0, 'place');
    };
    expect(misuse).toBeTypeOf('function');
    expectTypeOf(t.viewOf(0)).toHaveProperty('board');
  });
  // #endregion types
});
