import { createTestTable } from 'shoehive/testing';
import { describe, expect, it } from 'vitest';
import { dice } from '../src/game';

describe('dice phases', () => {
  // #region test
  it('moves from enter to duel, and phase actions stay in their phase', async () => {
    const t = await createTestTable(dice, { players: 2 });
    expect(t.meta.phase).toBe('enter');
    await expect(t.act(0, 'roll')).rejects.toMatchObject({ code: 'ACTION_NOT_ALLOWED' });

    await t.act(0, 'join', { stake: true });
    await t.act(1, 'join', { stake: true }); // the round closes, onClose calls go('duel')
    expect(t.meta.phase).toBe('duel');
    await expect(t.act(0, 'join', { stake: true })).rejects.toMatchObject({
      code: 'ACTION_NOT_ALLOWED',
    });
  });

  it('never gives the first turn to a seat that onEnter made skippable', async () => {
    const t = await createTestTable(dice, { players: 3, seed: 'other' });
    for (const seat of [0, 1, 2]) await t.act(seat, 'join', { stake: true });
    const seat = t.meta.turn?.seat;
    if (seat !== null && seat !== undefined) expect(t.state.dice[seat]).toBeGreaterThan(1);
  });
  // #endregion test
});
