import { defineGame } from 'shoehive';
import { z } from 'zod';
import { QUESTIONS } from './questions';

export const QUESTION_MS = 15_000;
export const REVEAL_MS = 5_000;
const MAX_POINTS = 1000;

interface Answer {
  choice: number;
  /** Milliseconds after the question opened. */
  after: number;
}

export const quiz = defineGame({
  id: 'quiz',
  name: 'Quiz',
  seats: { min: 2, max: 12 },
  // #region options
  options: z.object({ questions: z.number().int().min(1).max(QUESTIONS.length).default(3) }),
  // #endregion options

  setup: ({ options, random, seats }) => {
    const answers: Record<string, Answer> = {};
    return {
      order: random.shuffle(QUESTIONS.map((_, i) => i)).slice(0, options.questions),
      current: 0,
      openedAt: 0,
      answers,
      scores: Array<number>(seats).fill(0),
    };
  },

  phases: {
    // #region question
    question: {
      rounds: {
        durationMs: QUESTION_MS,
        closeWhen: 'all-submitted',
        onOpen: ({ state, ctx }) => {
          state.answers = {};
          state.openedAt = ctx.now();
        },
        onClose: ({ state, ctx }) => {
          const question = QUESTIONS[state.order[state.current]!]!;
          for (const [seat, answer] of Object.entries(state.answers)) {
            if (answer.choice !== question.answer) continue;
            // Faster correct answers score more: from 1000 down to 500 at the deadline.
            const points = Math.round(MAX_POINTS - (MAX_POINTS / 2) * (answer.after / QUESTION_MS));
            state.scores[Number(seat)] = (state.scores[Number(seat)] ?? 0) + points;
          }
          ctx.phase.go('reveal');
        },
      },
      actions: {
        answer: {
          once: true,
          input: z.object({ choice: z.number().int().min(0).max(3) }),
          run({ state, seat, input, ctx }) {
            state.answers[String(seat)] = {
              choice: input.choice,
              after: ctx.now() - state.openedAt,
            };
          },
        },
      },
    },
    // #endregion question
    // #region reveal
    reveal: {
      onEnter: ({ ctx }) => {
        ctx.timers.after('next', REVEAL_MS, 'nextQuestion');
      },
      actions: {
        nextQuestion: {
          internal: true,
          run({ state, ctx }) {
            if (state.current + 1 >= state.order.length) {
              const best = Math.max(...state.scores);
              ctx.end({
                scores: state.scores,
                winners: ctx.occupied.filter((s) => state.scores[s] === best),
              });
              return;
            }
            state.current += 1;
            ctx.phase.go('question');
          },
        },
      },
    },
    // #endregion reveal
  },

  // #region view
  // Until the reveal, a player sees only their own answer, and nobody sees the correct one.
  view: ({ state, viewer, ctx }) => {
    const question = QUESTIONS[state.order[state.current]!]!;
    const revealing = ctx.phase === 'reveal' || ctx.status === 'ended';
    const mine = viewer.seat === null ? undefined : state.answers[String(viewer.seat)];
    return {
      number: state.current + 1,
      of: state.order.length,
      question: { text: question.text, choices: question.choices },
      correct: revealing ? question.answer : null,
      answers: revealing
        ? Object.fromEntries(Object.entries(state.answers).map(([seat, a]) => [seat, a.choice]))
        : mine
          ? { [String(viewer.seat)]: mine.choice }
          : {},
      scores: state.scores,
    };
  },
  // #endregion view
});
