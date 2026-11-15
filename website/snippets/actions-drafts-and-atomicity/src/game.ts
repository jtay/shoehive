// Shown on /concepts/actions-drafts-and-atomicity/. A rejected action leaves no trace.
import { defineGame, reject } from 'shoehive';
import { createTestTable } from 'shoehive/testing';
import { z } from 'zod';

// #region game
export const shop = defineGame({
  id: 'shop',
  seats: { min: 1, max: 1 },
  setup: () => ({ coins: 3, items: [] as string[] }),
  actions: {
    buy: {
      input: z.object({ item: z.string(), price: z.number().int().min(1) }),
      run({ state, input }) {
        state.items.push(input.item); // 1. a draft: mutate freely
        state.coins -= input.price; // 2.
        if (state.coins < 0) reject('NOT_ENOUGH_COINS'); // 3. everything above is undone
      },
    },
  },
});
// #endregion game

// #region demo
export async function demo() {
  const table = await createTestTable(shop, { players: 1 });

  await table.act(0, 'buy', { item: 'apple', price: 1 }); // commits: 2 coins left
  await table.act(0, 'buy', { item: 'castle', price: 99 }).catch(() => undefined); // rejected

  // The castle never reached the state, and the revision did not move for it.
  return { coins: table.state.coins, items: table.state.items };
}
// #endregion demo
