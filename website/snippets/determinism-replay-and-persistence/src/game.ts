// Shown on /concepts/determinism-replay-and-persistence/. Same seed, same game.
import { defineGame } from 'shoehive';
import { createTestTable } from 'shoehive/testing';

// #region game
export const dealer = defineGame({
  id: 'dealer',
  seats: { min: 1, max: 1 },
  // ctx.random is seeded per table and every draw is recorded in the log.
  setup: ({ random }) => ({
    deck: random.shuffle([1, 2, 3, 4, 5, 6]),
    hand: [] as number[],
  }),
  actions: {
    draw: {
      run({ state }) {
        state.hand.push(state.deck.pop()!);
      },
    },
  },
});
// #endregion game

// #region demo
export async function demo() {
  const a = await createTestTable(dealer, { seed: 'table-7' });
  const b = await createTestTable(dealer, { seed: 'table-7' });
  await a.act(0, 'draw');
  await b.act(0, 'draw');

  // Same seed, same actions: the same cards.
  const same = JSON.stringify(a.state) === JSON.stringify(b.state);

  // Rebuild the table from its log alone. It throws if the state is not identical.
  await a.verifyReplay();
  return same;
}
// #endregion demo
