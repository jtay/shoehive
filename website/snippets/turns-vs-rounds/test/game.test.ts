import { createTestTable } from 'shoehive/testing';
import { describe, expect, it } from 'vitest';
import { sealedBids } from '../src/rounds';
import { lastOneIn } from '../src/turns';

describe('turns', () => {
  it('goes from the highest seat down and skips folded seats', async () => {
    const t = await createTestTable(lastOneIn, { players: 3 });
    expect(t.meta.turn?.seat).toBe(0); // first: state.start
    await t.act(0, 'pass');
    expect(t.meta.turn?.seat).toBe(2);
    await expect(t.act(1, 'pass')).rejects.toMatchObject({ code: 'NOT_YOUR_TURN' });
    await t.act(2, 'fold');
    expect(t.meta.turn?.seat).toBe(1);
    await t.act(1, 'pass');
    expect(t.meta.turn?.seat).toBe(0); // seat 2 is skipped from now on
  });
});

describe('rounds', () => {
  // #region round
  it('closes when everyone has bid and rejects a second bid', async () => {
    const t = await createTestTable(sealedBids, { players: 2 });
    await t.act(0, 'bid', { amount: 30 });
    await expect(t.act(0, 'bid', { amount: 40 })).rejects.toMatchObject({
      code: 'ALREADY_SUBMITTED',
    });
    await t.act(1, 'bid', { amount: 50 }); // last submission: the round closes
    expect(t.state.wins.slice(0, 2)).toEqual([0, 1]);
    expect(t.meta.round?.number).toBe(2); // onClose opened the next round
  });

  it('closes on the timer when someone is too slow', async () => {
    const t = await createTestTable(sealedBids, { players: 2 });
    await t.act(0, 'bid', { amount: 30 });
    await t.advance(20_000);
    expect(t.state.wins.slice(0, 2)).toEqual([1, 0]);
  });
  // #endregion round
});
