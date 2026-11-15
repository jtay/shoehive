import { createTestTable } from 'shoehive/testing';
import { describe, expect, it } from 'vitest';
import { game, TARGET } from '../src/game';

describe('my game', () => {
  it('starts with one player and counts presses', async () => {
    const t = await createTestTable(game, { players: 1 });
    expect(t.meta.status).toBe('active');
    await t.act(0, 'press');
    await t.act(0, 'press');
    expect(t.state.count).toBe(2);
  });

  it('lets another player join and press', async () => {
    const t = await createTestTable(game, { players: 1 });
    await t.act(0, 'press');
    await t.sit(1);
    await t.act(1, 'press');
    expect(t.state.count).toBe(2);
  });

  it('ends when the count reaches the target, and the last presser wins', async () => {
    const t = await createTestTable(game, { players: 2 });
    for (let i = 1; i < TARGET; i++) await t.act(i % 2, 'press');
    expect(t.meta.status).toBe('active');
    await t.act(1, 'press');
    expect(t.state.winner).toBe(1);
    expect(t.meta.status).toBe('ended');
    expect(t.meta.result).toEqual({ winner: 1 });
    await expect(t.act(0, 'press')).rejects.toMatchObject({ code: 'TABLE_ENDED' });
    await t.verifyReplay();
  });
});
