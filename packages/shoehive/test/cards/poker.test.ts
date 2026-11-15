import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compareHands,
  evaluateHand,
  HAND_CATEGORIES,
  rankOf,
  rankValue,
  standardDeck,
  suitOf,
  winners,
  type Card,
  type HandCategory,
} from '../../src/cards/index';

const h = (s: string): Card[] => s.split(' ') as Card[];
const catIndex = (c: HandCategory): number => HAND_CATEGORIES.indexOf(c);

/**
 * A slow, independent reference evaluator: groups ranks generically and compares
 * [category, ...tiebreaks] lexicographically over every five-card subset.
 */
function reference5(cards: readonly Card[]): number[] {
  const values = cards.map((c) => rankValue(rankOf(c))).sort((a, b) => b - a);
  const flush = new Set(cards.map(suitOf)).size === 1;
  const distinct = [...new Set(values)];
  let straightHigh = 0;
  if (distinct.length === 5) {
    const [top = 0, , , , bottom = 0] = values;
    if (top - bottom === 4) straightHigh = top;
    else if (values.join(',') === '14,5,4,3,2') straightHigh = 5;
  }
  const groups = distinct
    .map((v) => [values.filter((x) => x === v).length, v] as const)
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const shape = groups.map((g) => g[0]).join('');
  const tie = groups.map((g) => g[1]);
  if (straightHigh && flush) return [8, straightHigh];
  if (shape === '41') return [7, ...tie];
  if (shape === '32') return [6, ...tie];
  if (flush) return [5, ...tie];
  if (straightHigh) return [4, straightHigh];
  if (shape === '311') return [3, ...tie];
  if (shape === '221') return [2, ...tie];
  if (shape === '2111') return [1, ...tie];
  return [0, ...tie];
}
const lex = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
};
function reference(cards: readonly Card[]): number[] {
  let best: number[] = [-1];
  const n = cards.length;
  for (let skip = 0; skip < 1 << n; skip++) {
    let bits = 0;
    for (let i = 0; i < n; i++) if (skip & (1 << i)) bits++;
    if (bits !== 5) continue;
    const five = cards.filter((_, i) => skip & (1 << i));
    const score = reference5(five);
    if (lex(score, best) > 0) best = score;
  }
  return best;
}

const handOf = (min: number, max: number) =>
  fc.shuffledSubarray(standardDeck(), { minLength: min, maxLength: max });

describe('evaluateHand: categories', () => {
  const cases: [string, HandCategory, string, string][] = [
    ['AS KS QS JS TS', 'straight-flush', 'Royal flush', 'AS KS QS JS TS'],
    ['9H 8H 7H 6H 5H', 'straight-flush', 'Straight flush, Nine high', '9H 8H 7H 6H 5H'],
    ['5D 4D 3D 2D AD', 'straight-flush', 'Straight flush, Five high', '5D 4D 3D 2D AD'],
    ['9C 9D 9H 9S KD', 'four-of-a-kind', 'Four of a kind, Nines', '9C 9D 9H 9S KD'],
    ['KS KH KD 7C 7S', 'full-house', 'Full house, Kings over Sevens', 'KS KH KD 7C 7S'],
    ['6S 6H 6D AC AS', 'full-house', 'Full house, Sixes over Aces', '6S 6H 6D AC AS'],
    ['AH JH 8H 4H 2H', 'flush', 'Flush, Ace high', 'AH JH 8H 4H 2H'],
    ['AS KH QD JC TS', 'straight', 'Straight, Ace high', 'AS KH QD JC TS'],
    ['TS 9H 8D 7C 6S', 'straight', 'Straight, Ten high', 'TS 9H 8D 7C 6S'],
    ['AS 2H 3D 4C 5S', 'straight', 'Straight, Five high', '5S 4C 3D 2H AS'],
    ['QS QH QD 9C 4S', 'three-of-a-kind', 'Three of a kind, Queens', 'QS QH QD 9C 4S'],
    ['JS JH 4D 4C AS', 'two-pair', 'Two pair, Jacks and Fours', 'JS JH 4D 4C AS'],
    ['2S 2H 8D 5C 3S', 'pair', 'Pair of Twos', '2S 2H 8D 5C 3S'],
    ['AS JH 8D 5C 3S', 'high-card', 'High card, Ace', 'AS JH 8D 5C 3S'],
    ['7S 5H 4D 3C 2S', 'high-card', 'High card, Seven', '7S 5H 4D 3C 2S'],
  ];
  it.each(cases)('%s is %s', (cards, category, description, best) => {
    const hand = evaluateHand(h(cards));
    expect(hand.category).toBe(category);
    expect(hand.description).toBe(description);
    // Same cards in the documented significance order (suit order within a group may vary).
    expect(hand.best.map(rankOf).join('')).toBe(h(best).map(rankOf).join(''));
    expect(new Set(hand.best)).toEqual(new Set(h(best)));
  });

  it('orders the categories', () => {
    const ranks = cases.map(([cards]) => evaluateHand(h(cards)).rank);
    for (let i = 1; i < ranks.length; i++) expect(ranks[i - 1]).toBeGreaterThanOrEqual(ranks[i]!);
  });
});

describe('evaluateHand: tiebreaks', () => {
  const wins = (a: string, b: string) => {
    expect(compareHands(h(a), h(b))).toBe(1);
    expect(compareHands(h(b), h(a))).toBe(-1);
  };
  const ties = (a: string, b: string) => {
    expect(compareHands(h(a), h(b))).toBe(0);
  };

  it('compares high cards down to the last kicker', () => {
    wins('AS JH 8D 5C 3S', 'AH JD 8C 5S 2D');
    wins('KS JH 8D 5C 3S', 'QH JD 8C 5S 4D');
    ties('AS JH 8D 5C 3S', 'AH JD 8C 5S 3D');
  });

  it('compares pairs, then kickers', () => {
    wins('9S 9H AD 5C 3S', '9D 9C KD QC JS');
    wins('9S 9H AD 5C 4S', '9D 9C AH 5S 3S');
    wins('TS TH 2D 3C 4S', '9D 9C AS KC QS');
  });

  it('compares two pair: high pair, low pair, kicker', () => {
    wins('KS KH 2D 2C 3S', 'QD QC JS JH AS');
    wins('KS KH 5D 5C 3S', 'KD KC 4S 4H AS');
    wins('KS KH 5D 5C 4S', 'KD KC 5S 5H 3S');
    ties('KS KH 5D 5C 4S', 'KD KC 5S 5H 4H');
  });

  it('picks the best kicker when a third pair is on the board', () => {
    // Three pairs in seven cards: the third pair's rank can lose to a single higher kicker.
    const hand = evaluateHand(h('AS AH KD KC 7S 7H QD'));
    expect(hand.category).toBe('two-pair');
    expect(hand.best.map(rankOf).join('')).toBe('AAKKQ');
    wins('AS AH KD KC 7S 7H QD', 'AD AC KS KH 7D 7C 6S');
  });

  it('compares three of a kind and its kickers', () => {
    wins('8S 8H 8D 2C 3S', '7S 7H 7D AC KS');
    wins('8S 8H 8D AC 3S', '8C 8H 8D KC QS');
  });

  it('compares straights by the top card, with the wheel lowest', () => {
    wins('6S 5H 4D 3C 2S', 'AS 2H 3D 4C 5S');
    wins('AS KH QD JC TS', 'KS QH JD TC 9S');
    ties('AS 2H 3D 4C 5S', 'AD 2C 3H 4S 5D');
    // A K Q J T and 5 4 3 2 A are straights; K A 2 3 4 does not wrap.
    expect(evaluateHand(h('KS AH 2D 3C 4S')).category).toBe('high-card');
  });

  it('ranks the steel wheel below every other straight flush', () => {
    wins('6H 5H 4H 3H 2H', 'AD 2D 3D 4D 5D');
    wins('AD 2D 3D 4D 5D', '9S 9H 9D 9C AS');
    expect(evaluateHand(h('AD 2D 3D 4D 5D KD QD')).description).toBe('Straight flush, Five high');
  });

  it('ranks a flush above a straight', () => {
    wins('7H 5H 4H 3H 2H', 'AS KH QD JC TS');
    // With both available in seven cards, the flush is chosen.
    const hand = evaluateHand(h('9H 8D 7H 6C 5H 2H KH'));
    expect(hand.category).toBe('flush');
    expect(hand.best.map(rankOf).join('')).toBe('K9752');
  });

  it('compares flushes card by card', () => {
    wins('AH JH 8H 4H 3H', 'AS JS 8S 4S 2S');
    ties('AH JH 8H 4H 3H', 'AS JS 8S 4S 3S');
  });

  it('compares full houses by trips, then pair', () => {
    wins('3S 3H 3D 2C 2S', '2D 2H 2C AC AS');
    wins('KS KH KD 8C 8S', 'KD KH KC 7C 7S');
    // Two sets in seven cards: the higher set is the trips.
    const hand = evaluateHand(h('5S 5H 5D 9C 9S 9H 2D'));
    expect(hand.description).toBe('Full house, Nines over Fives');
    wins('5S 5H 5D 9C 9S 9H 2D', '9D 9C 9S 4C 4S 2H 3D');
  });

  it('compares four of a kind by quads, then kicker', () => {
    wins('4S 4H 4D 4C 2S', '3S 3H 3D 3C AS');
    wins('4S 4H 4D 4C AS', '4S 4H 4D 4C KS');
    // Quads with a full house in seven cards takes the best kicker.
    expect(evaluateHand(h('4S 4H 4D 4C KS KH AD')).best.map(rankOf).join('')).toBe('4444A');
  });
});

describe('evaluateHand: best five of seven', () => {
  it('chooses the strongest five', () => {
    const board = h('AS KS QS 2D 3C');
    expect(evaluateHand([...board, 'JS', 'TS']).description).toBe('Royal flush');
    expect(evaluateHand([...board, 'AH', 'AD']).description).toBe('Three of a kind, Aces');
    expect(evaluateHand([...board, '4H', '5D']).description).toBe('Straight, Five high');
    expect(evaluateHand([...board, '7H', '8D']).best).toEqual(h('AS KS QS 8D 7H'));
  });

  it('works for six cards', () => {
    expect(evaluateHand(h('AS KS QS JS TS 9S')).description).toBe('Royal flush');
    expect(evaluateHand(h('2S 2H 3D 3C 4S 4H')).best.map(rankOf).join('')).toBe('44332');
  });
});

describe('evaluateHand: invalid input', () => {
  it('needs 5 to 7 cards', () => {
    expect(() => evaluateHand(h('AS KS QS JS'))).toThrow(RangeError);
    expect(() => evaluateHand([])).toThrow(/expected 5 to 7 cards, got 0 cards/);
    expect(() => evaluateHand(h('AS KS QS JS TS 9S 8S 7S'))).toThrow(RangeError);
    expect(() => evaluateHand('AS KS QS JS TS' as unknown as Card[])).toThrow(RangeError);
  });

  it('rejects duplicates', () => {
    expect(() => evaluateHand(h('AS AS QS JS TS'))).toThrow(/duplicate card AS/);
  });

  it('rejects strings that are not cards', () => {
    for (const bad of ['10S', 'as', 'AX', '', '1S']) {
      expect(() => evaluateHand([...h('AS KS QS JS'), bad as Card])).toThrow(TypeError);
    }
    expect(() => evaluateHand([...h('AS KS QS JS'), 7 as unknown as Card])).toThrow(TypeError);
  });

  it('compareHands and winners validate too', () => {
    expect(() => compareHands(h('AS KS QS JS'), h('AH KH QH JH TH'))).toThrow(RangeError);
    expect(() => winners([h('AS KS QS JS TS'), h('AS')])).toThrow(RangeError);
  });
});

describe('winners', () => {
  const board = h('2S 7D 9C JH KD');
  it('returns the single best hand', () => {
    expect(
      winners([
        [...board, 'AS', '3C'],
        [...board, 'KS', '4C'],
        [...board, 'QS', '3D'],
      ]),
    ).toEqual([1]);
  });
  it('shares ties', () => {
    expect(
      winners([
        [...board, 'AS', '3C'],
        [...board, '4S', '3D'],
        [...board, 'AH', '4C'],
      ]),
    ).toEqual([0, 2]);
    // Playing the board: everyone ties.
    const royal = h('AS KS QS JS TS');
    expect(
      winners([
        [...royal, '2D', '3D'],
        [...royal, '4H', '5H'],
      ]),
    ).toEqual([0, 1]);
  });
  it('returns nothing for no hands', () => {
    expect(winners([])).toEqual([]);
  });
});

describe('evaluateHand: properties', () => {
  it('agrees with an independent reference evaluator', () => {
    fc.assert(
      fc.property(handOf(5, 7), handOf(5, 7), (a, b) => {
        expect(compareHands(a, b)).toBe(lex(reference(a), reference(b)));
        expect(catIndex(evaluateHand(a).category)).toBe(reference(a)[0]);
      }),
      { numRuns: 2000 },
    );
  });

  it('agrees with the reference on a dense deck (many straights, flushes, wheels)', () => {
    const dense = standardDeck().filter(
      (c) => 'SH'.includes(suitOf(c)) && 'A23456TJQK'.includes(rankOf(c)),
    );
    fc.assert(
      fc.property(
        fc.shuffledSubarray(dense, { minLength: 5, maxLength: 7 }),
        fc.shuffledSubarray(dense, { minLength: 5, maxLength: 7 }),
        (a, b) => {
          expect(compareHands(a, b)).toBe(lex(reference(a), reference(b)));
          expect(catIndex(evaluateHand(a).category)).toBe(reference(a)[0]);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('is invariant under permutation of the cards', () => {
    fc.assert(
      fc.property(
        handOf(7, 7).chain((hand) =>
          fc.tuple(fc.constant(hand), fc.shuffledSubarray(hand, { minLength: 7, maxLength: 7 })),
        ),
        ([hand, permuted]) => {
          const a = evaluateHand(hand);
          const b = evaluateHand(permuted);
          expect(b.rank).toBe(a.rank);
          expect(b.category).toBe(a.category);
          expect(b.description).toBe(a.description);
        },
      ),
    );
  });

  it('orders rank by category first', () => {
    fc.assert(
      fc.property(handOf(5, 7), handOf(5, 7), (a, b) => {
        const ea = evaluateHand(a);
        const eb = evaluateHand(b);
        const ca = catIndex(ea.category);
        const cb = catIndex(eb.category);
        if (ca > cb) expect(ea.rank).toBeGreaterThan(eb.rank);
        if (ca < cb) expect(ea.rank).toBeLessThan(eb.rank);
      }),
    );
  });

  it('best is five of the input cards and re-evaluates to the same rank', () => {
    fc.assert(
      fc.property(handOf(5, 7), (hand) => {
        const e = evaluateHand(hand);
        expect(e.best).toHaveLength(5);
        expect(new Set(e.best).size).toBe(5);
        for (const card of e.best) expect(hand).toContain(card);
        const again = evaluateHand(e.best);
        expect(again.rank).toBe(e.rank);
        expect(again.best).toEqual(e.best);
      }),
    );
  });

  it('compareHands is antisymmetric and winners matches it', () => {
    fc.assert(
      fc.property(fc.array(handOf(7, 7), { minLength: 1, maxLength: 9 }), (hands) => {
        const w = winners(hands);
        expect(w.length).toBeGreaterThan(0);
        hands.forEach((hand, i) => {
          const beatsOrTies = hands.every((other) => compareHands(hand, other) >= 0);
          expect(w.includes(i)).toBe(beatsOrTies);
          expect(compareHands(hand, hands[0]!) + compareHands(hands[0]!, hand)).toBe(0);
        });
      }),
    );
  });
});

describe('evaluateHand: performance', () => {
  it('evaluates a 7-card hand well under 50 microseconds', () => {
    const hands = fc.sample(handOf(7, 7), { numRuns: 2000, seed: 1 });
    for (const hand of hands) evaluateHand(hand);
    const runs = 20_000;
    const start = performance.now();
    for (let i = 0; i < runs; i++) evaluateHand(hands[i % hands.length]!);
    const micros = ((performance.now() - start) * 1000) / runs;
    expect(micros).toBeLessThan(50);
  });
});
