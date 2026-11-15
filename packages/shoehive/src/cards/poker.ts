// Poker hand evaluation for 5 to 7 cards: the best five-card hand by standard rankings.
//
// The evaluator sorts the cards by rank once, then scores each five-card combination
// (21 for seven cards) with integer comparisons only. A score packs the category and
// up to five tiebreak ranks, four bits each: category * 16^5 + r1 * 16^4 + ... + r5.

import { assertCard, RANKS, rankValue, SUITS, type Card } from './card';

/** Poker hand categories, weakest first. A royal flush is an ace-high straight flush. */
export type HandCategory =
  | 'high-card'
  | 'pair'
  | 'two-pair'
  | 'three-of-a-kind'
  | 'straight'
  | 'flush'
  | 'full-house'
  | 'four-of-a-kind'
  | 'straight-flush';

/** Every {@link HandCategory}, weakest first (the index is the category's strength). */
export const HAND_CATEGORIES: readonly HandCategory[] = Object.freeze([
  'high-card',
  'pair',
  'two-pair',
  'three-of-a-kind',
  'straight',
  'flush',
  'full-house',
  'four-of-a-kind',
  'straight-flush',
]);

/** The result of {@link evaluateHand}. */
export interface PokerHand {
  /** The hand's category. */
  readonly category: HandCategory;
  /**
   * The hand's strength as one integer: a higher rank always wins and equal ranks tie.
   * It orders first by category, then by the tiebreak ranks. Compare ranks from this
   * library version only; the encoding is not a stable format.
   */
  readonly rank: number;
  /**
   * The five cards that make the hand, most significant first: the group cards before
   * the kickers (`KKK77`, `QQ J 9 4`), straights from the top card down, and the wheel
   * as `5 4 3 2 A`.
   */
  readonly best: Card[];
  /** An English description such as `"Full house, Kings over Sevens"`. */
  readonly description: string;
}

const B4 = 0x10000;
const B5 = 0x100000;
const HIGH_CARD = 0;
const PAIR = 1;
const TWO_PAIR = 2;
const TRIPS = 3;
const STRAIGHT = 4;
const FLUSH = 5;
const FULL_HOUSE = 6;
const QUADS = 7;
const STRAIGHT_FLUSH = 8;

/** Card string to code: rank value (2..14) * 4 + suit index. */
const CODES = new Map<string, number>();
for (const rank of RANKS) {
  for (let s = 0; s < SUITS.length; s++) CODES.set(`${rank}${SUITS[s]!}`, rankValue(rank) * 4 + s);
}

const SINGULAR: readonly string[] = [
  '',
  '',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Jack',
  'Queen',
  'King',
  'Ace',
];
const plural = (v: number): string => (v === 6 ? 'Sixes' : `${SINGULAR[v]!}s`);

/** Index combinations choose(n, 5), flattened, for n = 5, 6, 7. */
const COMBOS: readonly Int8Array[] = (() => {
  const tables: Int8Array[] = [];
  for (let n = 0; n <= 7; n++) {
    const out: number[] = [];
    if (n >= 5) {
      for (let a = 0; a < n; a++)
        for (let b = a + 1; b < n; b++)
          for (let c = b + 1; c < n; c++)
            for (let d = c + 1; d < n; d++) for (let e = d + 1; e < n; e++) out.push(a, b, c, d, e);
    }
    tables.push(Int8Array.from(out));
  }
  return tables;
})();

const pack = (a: number, b: number, c: number, d: number, e: number): number =>
  (((a * 16 + b) * 16 + c) * 16 + d) * 16 + e;

/** Scores five ranks sorted high to low (no duplicate cards, so pairs rule out a flush). */
function score5(
  r0: number,
  r1: number,
  r2: number,
  r3: number,
  r4: number,
  flush: boolean,
): number {
  const e01 = r0 === r1;
  const e12 = r1 === r2;
  const e23 = r2 === r3;
  const e34 = r3 === r4;
  if (!e01 && !e12 && !e23 && !e34) {
    const high = r0 - r4 === 4 ? r0 : r0 === 14 && r1 === 5 ? 5 : 0;
    if (high !== 0) return (flush ? STRAIGHT_FLUSH : STRAIGHT) * B5 + high * B4;
    return (flush ? FLUSH : HIGH_CARD) * B5 + pack(r0, r1, r2, r3, r4);
  }
  if (e12 && e23) {
    if (e01) return QUADS * B5 + pack(r0, r0, r0, r0, r4);
    if (e34) return QUADS * B5 + pack(r1, r1, r1, r1, r0);
  }
  if (e01 && e12 && e34) return FULL_HOUSE * B5 + pack(r0, r0, r0, r3, r3);
  if (e01 && e23 && e34) return FULL_HOUSE * B5 + pack(r2, r2, r2, r0, r0);
  if (e01 && e12) return TRIPS * B5 + pack(r0, r0, r0, r3, r4);
  if (e12 && e23) return TRIPS * B5 + pack(r1, r1, r1, r0, r4);
  if (e23 && e34) return TRIPS * B5 + pack(r2, r2, r2, r0, r1);
  if (e01 && e23) return TWO_PAIR * B5 + pack(r0, r0, r2, r2, r4);
  if (e01 && e34) return TWO_PAIR * B5 + pack(r0, r0, r3, r3, r2);
  if (e12 && e34) return TWO_PAIR * B5 + pack(r1, r1, r3, r3, r0);
  if (e01) return PAIR * B5 + pack(r0, r0, r2, r3, r4);
  if (e12) return PAIR * B5 + pack(r1, r1, r0, r3, r4);
  if (e23) return PAIR * B5 + pack(r2, r2, r0, r1, r4);
  return PAIR * B5 + pack(r3, r3, r0, r1, r2);
}

/** Orders five cards most significant first to match the score's tiebreak ranks. */
function orderBest(cards: Card[], ranks: number[], category: number): Card[] {
  const count = (v: number): number => ranks.filter((r) => r === v).length;
  const idx = [0, 1, 2, 3, 4].sort((a, b) => {
    const ra = ranks[a]!;
    const rb = ranks[b]!;
    return count(rb) - count(ra) || rb - ra;
  });
  // The wheel (A 5 4 3 2) plays the ace low: 5 4 3 2 A.
  if ((category === STRAIGHT || category === STRAIGHT_FLUSH) && ranks.includes(14)) {
    if (ranks.includes(2)) idx.push(idx.shift()!);
  }
  return idx.map((i) => cards[i]!);
}

function describe(category: number, rank: number): string {
  const v = (i: number): number => Math.floor(rank / 16 ** (4 - i)) % 16;
  switch (category) {
    case STRAIGHT_FLUSH:
      return v(0) === 14 ? 'Royal flush' : `Straight flush, ${SINGULAR[v(0)]!} high`;
    case QUADS:
      return `Four of a kind, ${plural(v(0))}`;
    case FULL_HOUSE:
      return `Full house, ${plural(v(0))} over ${plural(v(3))}`;
    case FLUSH:
      return `Flush, ${SINGULAR[v(0)]!} high`;
    case STRAIGHT:
      return `Straight, ${SINGULAR[v(0)]!} high`;
    case TRIPS:
      return `Three of a kind, ${plural(v(0))}`;
    case TWO_PAIR:
      return `Two pair, ${plural(v(0))} and ${plural(v(2))}`;
    case PAIR:
      return `Pair of ${plural(v(0))}`;
    default:
      return `High card, ${SINGULAR[v(0)]!}`;
  }
}

/** Parses and validates 5 to 7 cards; returns their codes sorted by rank, high first. */
function parse(cards: readonly Card[], where: string): { codes: number[]; sorted: Card[] } {
  const input: unknown = cards;
  const isList = Array.isArray(input);
  if (!isList || cards.length < 5 || cards.length > 7) {
    const got = isList ? `${cards.length} cards` : typeof cards;
    throw new RangeError(`${where}: expected 5 to 7 cards, got ${got}`);
  }
  const codes: number[] = [];
  for (const card of cards) {
    assertCard(card, where);
    const code = CODES.get(card)!;
    if (codes.includes(code)) throw new RangeError(`${where}: duplicate card ${card}`);
    codes.push(code);
  }
  const order = codes.map((_, i) => i).sort((a, b) => codes[b]! - codes[a]!);
  return { codes: order.map((i) => codes[i]!), sorted: order.map((i) => cards[i]!) };
}

/**
 * Finds the best five-card poker hand in 5 to 7 cards (for Hold'em, two hole cards plus
 * the board). Aces play high, or low in the wheel `A 2 3 4 5`, the lowest straight.
 * Suits never break ties.
 *
 * ```ts
 * const hand = evaluateHand(['AS', 'KS', 'QS', 'JS', 'TS', '2D', '3C']);
 * hand.category;    // 'straight-flush'
 * hand.description; // 'Royal flush'
 * ```
 *
 * Throws a RangeError for fewer than 5 or more than 7 cards or a duplicate card, and a
 * TypeError for a string that is not a card.
 */
export function evaluateHand(cards: readonly Card[]): PokerHand {
  const { codes, sorted } = parse(cards, 'evaluateHand()');
  const n = codes.length;
  const ranks = codes.map((c) => c >> 2);
  const suits = codes.map((c) => c & 3);
  const combos = COMBOS[n]!;
  let bestScore = -1;
  let bestAt = 0;
  for (let k = 0; k < combos.length; k += 5) {
    const a = combos[k]!;
    const b = combos[k + 1]!;
    const c = combos[k + 2]!;
    const d = combos[k + 3]!;
    const e = combos[k + 4]!;
    const s = suits[a]!;
    const flush = suits[b] === s && suits[c] === s && suits[d] === s && suits[e] === s;
    const score = score5(ranks[a]!, ranks[b]!, ranks[c]!, ranks[d]!, ranks[e]!, flush);
    if (score > bestScore) {
      bestScore = score;
      bestAt = k;
    }
  }
  const picked = Array.from(combos.subarray(bestAt, bestAt + 5));
  const category = Math.floor(bestScore / B5);
  const best = orderBest(
    picked.map((i) => sorted[i]!),
    picked.map((i) => ranks[i]!),
    category,
  );
  return {
    category: HAND_CATEGORIES[category]!,
    rank: bestScore,
    best,
    description: describe(category, bestScore),
  };
}

/** Compares two hands of 5 to 7 cards: 1 when `a` wins, -1 when `b` wins, 0 for a tie. */
export function compareHands(a: readonly Card[], b: readonly Card[]): -1 | 0 | 1 {
  const ra = evaluateHand(a).rank;
  const rb = evaluateHand(b).rank;
  return ra > rb ? 1 : ra < rb ? -1 : 0;
}

/**
 * The indices of the winning hands, in ascending order; tied hands all win. Returns `[]`
 * for no hands.
 *
 * ```ts
 * winners([[...hole0, ...board], [...hole1, ...board]]); // [1], or [0, 1] for a split
 * ```
 */
export function winners(hands: readonly (readonly Card[])[]): number[] {
  const ranks = hands.map((hand) => evaluateHand(hand).rank);
  const top = Math.max(...ranks);
  const out: number[] = [];
  ranks.forEach((r, i) => {
    if (r === top) out.push(i);
  });
  return out;
}
