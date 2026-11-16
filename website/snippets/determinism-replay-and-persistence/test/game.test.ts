import { expect, it } from 'vitest';
import { demo } from '../src/game';

// The page says the same seed and actions give the same state, and replay matches.
it('same seed, same state, exact replay', async () => {
  expect(await demo()).toBe(true);
});
