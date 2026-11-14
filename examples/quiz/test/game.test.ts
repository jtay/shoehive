import { createTestTable } from 'shoehive/testing';
import { describe, expect, it } from 'vitest';
import { quiz, QUESTION_MS, REVEAL_MS } from '../src/game';
import { QUESTIONS } from '../src/questions';

async function table() {
  const t = await createTestTable(quiz, { players: 3, options: { questions: 2 } });
  const correct = () => QUESTIONS[t.state.order[t.state.current]!]!.answer;
  return { t, correct };
}

describe('quiz', () => {
  it('opens the first question as a round', async () => {
    const { t } = await table();
    expect(t.meta.phase).toBe('question');
    expect(t.meta.round).toMatchObject({
      number: 1,
      deadline: t.clock.now() + QUESTION_MS,
      submitted: [],
    });
  });

  it('hides answers until the reveal, then shows everything', async () => {
    const { t, correct } = await table();
    await t.act(0, 'answer', { choice: correct() });
    expect(t.viewOf(0).answers).toEqual({ '0': correct() });
    expect(t.viewOf(1).answers).toEqual({});
    expect(t.viewOf('spectator').correct).toBeNull();
    expect(t.meta.round?.submitted).toEqual([0]);

    await t.act(1, 'answer', { choice: (correct() + 1) % 4 });
    await t.act(2, 'answer', { choice: correct() });
    expect(t.meta.phase).toBe('reveal');
    expect(t.viewOf(1).correct).toBe(correct());
    expect(Object.keys(t.viewOf(1).answers)).toHaveLength(3);
  });

  it('scores faster correct answers higher, using the recorded clock', async () => {
    const { t, correct } = await table();
    await t.act(0, 'answer', { choice: correct() });
    await t.advance(QUESTION_MS / 2);
    await t.act(1, 'answer', { choice: correct() });
    await t.advance(QUESTION_MS / 2); // seat 2 never answers; the round times out
    expect(t.state.scores.slice(0, 3)).toEqual([1000, 750, 0]);
  });

  it('one answer per player per question', async () => {
    const { t } = await table();
    await t.act(0, 'answer', { choice: 0 });
    await expect(t.act(0, 'answer', { choice: 1 })).rejects.toMatchObject({
      code: 'ALREADY_SUBMITTED',
    });
  });

  it('plays through every question and ends with the winners', async () => {
    const { t, correct } = await table();
    for (let q = 0; q < 2; q++) {
      await t.act(0, 'answer', { choice: correct() });
      await t.act(1, 'answer', { choice: (correct() + 1) % 4 });
      await t.act(2, 'answer', { choice: (correct() + 2) % 4 });
      await t.advance(REVEAL_MS);
    }
    expect(t.meta.status).toBe('ended');
    expect(t.meta.result).toMatchObject({ winners: [0] });
    expect(t.state.scores.slice(0, 3)).toEqual([2000, 0, 0]);
    await t.verifyReplay();
  });
});
