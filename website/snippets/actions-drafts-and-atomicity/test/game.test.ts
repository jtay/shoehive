import { expect, it } from 'vitest';
import { demo } from '../src/game';

// The page says demo() returns 2 coins and ['apple'].
it('a rejected action leaves no trace', async () => {
  expect(await demo()).toEqual({ coins: 2, items: ['apple'] });
});
