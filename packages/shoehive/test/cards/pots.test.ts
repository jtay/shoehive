import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { awardPots, evaluateHand, splitPots, type Card, type Pot } from '../../src/cards/index';

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const none = (n: number): boolean[] => new Array<boolean>(n).fill(false);

describe('splitPots', () => {
  it('makes one pot when nobody is all-in for less', () => {
    expect(splitPots([100, 100, 100], none(3))).toEqual([{ amount: 300, eligible: [0, 1, 2] }]);
  });

  it('makes a side pot for a short all-in', () => {
    expect(splitPots([50, 200, 200, 20], [false, false, false, true])).toEqual([
      { amount: 170, eligible: [0, 1, 2] },
      { amount: 300, eligible: [1, 2] },
    ]);
  });

  it('makes several side pots for several all-ins', () => {
    // Seat 0 all-in 25, seat 1 all-in 100, seat 2 all-in 250, seat 3 covers with 400.
    expect(splitPots([25, 100, 250, 400], none(4))).toEqual([
      { amount: 100, eligible: [0, 1, 2, 3] },
      { amount: 225, eligible: [1, 2, 3] },
      { amount: 300, eligible: [2, 3] },
      { amount: 150, eligible: [3] },
    ]);
  });

  it('counts folded chips but never makes a folded seat eligible', () => {
    // The folder put in more than the short all-in: its chips feed both pots.
    expect(splitPots([30, 80, 100, 100], [false, true, false, false])).toEqual([
      { amount: 120, eligible: [0, 2, 3] },
      { amount: 190, eligible: [2, 3] },
    ]);
  });

  it('merges levels with the same eligible seats', () => {
    expect(splitPots([100, 100, 50], [false, false, true])).toEqual([
      { amount: 250, eligible: [0, 1] },
    ]);
  });

  it('puts chips above every unfolded seat into the last pot', () => {
    expect(splitPots([100, 300], [false, true])).toEqual([{ amount: 400, eligible: [0] }]);
  });

  it('handles empty and degenerate tables', () => {
    expect(splitPots([], [])).toEqual([]);
    expect(splitPots([0, 0], none(2))).toEqual([]);
    expect(splitPots([0, 100], none(2))).toEqual([{ amount: 100, eligible: [1] }]);
    expect(splitPots([10, 20], [true, true])).toEqual([{ amount: 30, eligible: [] }]);
  });

  it('validates its input', () => {
    expect(() => splitPots([10, 20], [false])).toThrow(RangeError);
    expect(() => splitPots([-1, 20], none(2))).toThrow(RangeError);
    expect(() => splitPots([1.5, 20], none(2))).toThrow(RangeError);
    expect(() => splitPots([Number.NaN], none(1))).toThrow(RangeError);
  });
});

describe('awardPots', () => {
  it('gives each pot to its best eligible seat', () => {
    const pots = splitPots([50, 200, 200, 20], [false, false, false, true]);
    // Seat 0 has the best hand but only wins the main pot.
    expect(awardPots(pots, [9, 5, 3, null])).toEqual([170, 300, 0, 0]);
    // Seat 1 is best: wins both.
    expect(awardPots(pots, [3, 9, 5, null])).toEqual([0, 470, 0, 0]);
  });

  it('splits ties, odd chips to the first winner in seat order', () => {
    expect(awardPots([{ amount: 101, eligible: [0, 1, 2] }], [7, 7, 1])).toEqual([51, 50, 0]);
    expect(awardPots([{ amount: 100, eligible: [0, 1, 2] }], [7, 7, 7])).toEqual([34, 33, 33]);
    expect(awardPots([{ amount: 101, eligible: [0, 1, 2] }], [7, 7, 7])).toEqual([34, 34, 33]);
  });

  it('starts the odd-chip order at firstSeat and wraps', () => {
    const pot: Pot[] = [{ amount: 101, eligible: [0, 1, 2, 3] }];
    expect(awardPots(pot, [7, 1, 7, 1], { firstSeat: 1 })).toEqual([50, 0, 51, 0]);
    expect(awardPots(pot, [7, 1, 7, 1], { firstSeat: 3 })).toEqual([51, 0, 50, 0]);
    expect(() => awardPots(pot, [7, 1, 7, 1], { firstSeat: -1 })).toThrow(RangeError);
  });

  it('pays the last seat standing with any score', () => {
    const pots = splitPots([20, 40, 40], [true, false, true]);
    expect(awardPots(pots, [null, 0, null])).toEqual([0, 100, 0]);
  });

  it('works with poker ranks end to end', () => {
    const board: Card[] = ['2S', '7D', '9C', 'JH', 'KD'];
    const holes: Card[][] = [
      ['AS', 'AH'], // pair of aces, all-in short
      ['KS', 'KH'], // set of kings
      ['QS', 'TS'], // straight
    ];
    const pots = splitPots([100, 300, 300], none(3));
    const scores = holes.map((hole) => evaluateHand([...hole, ...board]).rank);
    expect(awardPots(pots, scores)).toEqual([0, 0, 700]);
  });

  it('refuses a pot nobody can win', () => {
    expect(() => awardPots([{ amount: 10, eligible: [0] }], [null, 5])).toThrow(RangeError);
    expect(() => awardPots([{ amount: 10, eligible: [] }], [5])).toThrow(RangeError);
    expect(awardPots([{ amount: 0, eligible: [] }], [5])).toEqual([0]);
  });
});

describe('pots: properties', () => {
  const table = fc.integer({ min: 1, max: 9 }).chain((n) =>
    fc.tuple(
      fc.array(fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 1000 })), {
        minLength: n,
        maxLength: n,
      }),
      fc.array(fc.boolean(), { minLength: n, maxLength: n }),
      fc.array(fc.option(fc.integer({ min: 0, max: 5 }), { nil: null }), {
        minLength: n,
        maxLength: n,
      }),
    ),
  );

  it('splitPots preserves the total and only lists seats that covered each level', () => {
    fc.assert(
      fc.property(table, ([contributions, folded]) => {
        const pots = splitPots(contributions, folded);
        expect(sum(pots.map((p) => p.amount))).toBe(sum(contributions));
        let level = 0;
        let previous: number[] | null = null;
        for (const pot of pots) {
          expect(pot.amount).toBeGreaterThan(0);
          expect([...pot.eligible].sort((a, b) => a - b)).toEqual(pot.eligible);
          const contributed = pot.eligible.map((s) => contributions[s]!);
          for (const s of pot.eligible) expect(folded[s]).toBe(false);
          // Every eligible seat covers this pot's level, which rises pot by pot.
          const potLevel = Math.min(...contributed);
          if (pot.eligible.length > 0) expect(potLevel).toBeGreaterThan(level);
          level = potLevel;
          // Unfolded seats left out of a pot put in less than its level.
          contributions.forEach((c, s) => {
            if (!folded[s] && c > 0 && !pot.eligible.includes(s)) expect(c).toBeLessThan(level);
          });
          if (previous) {
            expect(pot.eligible.every((s) => previous!.includes(s))).toBe(true);
            expect(pot.eligible.length).toBeLessThan(previous.length);
          }
          previous = pot.eligible;
        }
      }),
    );
  });

  it('awardPots distributes exactly the pot total to eligible seats', () => {
    fc.assert(
      fc.property(table, fc.nat(8), ([contributions, folded, rawScores], firstSeat) => {
        const pots = splitPots(contributions, folded);
        // Unfolded seats always have a hand; folded seats never do.
        const scores = rawScores.map((s, seat) => (folded[seat] ? null : (s ?? 0)));
        if (pots.some((p) => p.eligible.length === 0)) {
          expect(() => awardPots(pots, scores, { firstSeat })).toThrow(RangeError);
          return;
        }
        const won = awardPots(pots, scores, { firstSeat });
        expect(won).toHaveLength(contributions.length);
        expect(sum(won)).toBe(sum(contributions));
        won.forEach((w, seat) => {
          expect(Number.isInteger(w)).toBe(true);
          if (folded[seat]) expect(w).toBe(0);
        });
        // Each pot's winners differ by at most one chip from that pot.
        for (const pot of pots) {
          const solo = awardPots([pot], scores, { firstSeat });
          const shares = solo.filter((w) => w > 0);
          expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
        }
      }),
    );
  });
});
