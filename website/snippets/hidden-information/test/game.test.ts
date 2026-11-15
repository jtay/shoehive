import { createTestTable } from 'shoehive/testing';
import { describe, expect, it } from 'vitest';
import { highCard } from '../src/game';

// #region leak
describe('high card views', () => {
  it('never shows a hidden card to another viewer', async () => {
    const t = await createTestTable(highCard, { players: 3 });
    const secrets = t.state.hands[0]!;

    expect(t.viewOf(0).hands[0]).toEqual(secrets); // my own hand
    expect(t.viewOf(1).hands[0]).toEqual([null, null]); // count visible, faces hidden
    expect(JSON.stringify(t.viewOf('spectator'))).not.toContain(secrets[0]!);

    await t.act(0, 'show');
    expect(t.viewOf(1).hands[0]).toEqual(secrets); // now public
  });

  it('never sends the deck to anyone', async () => {
    const t = await createTestTable(highCard, { players: 2 });
    for (const viewer of [0, 1, 'spectator'] as const) {
      const json = JSON.stringify(t.viewOf(viewer));
      for (const card of t.state.deck) expect(json).not.toContain(`"${card}"`);
    }
  });
});
// #endregion leak
