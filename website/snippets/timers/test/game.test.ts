import { createTestTable } from 'shoehive/testing';
import { describe, expect, it } from 'vitest';
import { bomb, FUSE_MS } from '../src/game';

describe('bomb', () => {
  // #region clock
  it('passes the turn on when a clock runs out', async () => {
    const t = await createTestTable(bomb, { players: 2, options: { turnMs: 5_000 } });
    expect(t.meta.turn?.seat).toBe(0);
    expect(t.meta.turn?.deadline).toBe(t.clock.now() + 5_000);

    await t.advance(5_000); // the fake clock moves, due timers fire
    expect(t.state.timeouts[0]).toBe(1);
    expect(t.meta.turn?.seat).toBe(1);
  });

  it('ends the game when the fuse burns out', async () => {
    const t = await createTestTable(bomb, { players: 2 });
    expect(t.meta.timers.fuse).toBe(t.clock.now() + FUSE_MS);

    await t.advance(FUSE_MS);
    expect(t.meta.status).toBe('ended');
  });
  // #endregion clock
});
