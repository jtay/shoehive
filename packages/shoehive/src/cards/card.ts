// The card model: cards are two-character strings so game state stays plain JSON.

/** A card rank. `'T'` is the ten. */
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K';

/** A card suit: spades, hearts, diamonds, clubs. */
export type Suit = 'S' | 'H' | 'D' | 'C';

/** A card as a two-character string, rank then suit, for example `'AS'` or `'TD'`. */
export type Card = `${Rank}${Suit}`;

/** Every rank, ace first: `A 2 3 4 5 6 7 8 9 T J Q K`. */
export const RANKS: readonly Rank[] = Object.freeze([
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'T',
  'J',
  'Q',
  'K',
]);

/** Every suit, in deck order: spades, hearts, diamonds, clubs. */
export const SUITS: readonly Suit[] = Object.freeze(['S', 'H', 'D', 'C']);

const DECK: readonly Card[] = Object.freeze(
  SUITS.flatMap((suit) => RANKS.map((rank): Card => `${rank}${suit}`)),
);
const CARD_SET: ReadonlySet<string> = new Set(DECK);

const RANK_NAMES: Readonly<Record<Rank, string>> = {
  A: 'Ace',
  '2': 'Two',
  '3': 'Three',
  '4': 'Four',
  '5': 'Five',
  '6': 'Six',
  '7': 'Seven',
  '8': 'Eight',
  '9': 'Nine',
  T: 'Ten',
  J: 'Jack',
  Q: 'Queen',
  K: 'King',
};
const SUIT_NAMES: Readonly<Record<Suit, string>> = {
  S: 'Spades',
  H: 'Hearts',
  D: 'Diamonds',
  C: 'Clubs',
};
const RANK_VALUES: Readonly<Record<Rank, number>> = {
  A: 14,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
};

/** True when `x` is a valid card string such as `'QH'`. */
export function isCard(x: unknown): x is Card {
  return typeof x === 'string' && CARD_SET.has(x);
}

/** @internal Throws a TypeError unless `x` is a card. */
export function assertCard(x: unknown, where: string): asserts x is Card {
  if (!isCard(x)) {
    const shown = typeof x === 'string' ? JSON.stringify(x) : String(x);
    throw new TypeError(`${where}: not a card: ${shown}`);
  }
}

/** The rank of a card: `rankOf('TD') === 'T'`. */
export function rankOf(card: Card): Rank {
  return card[0] as Rank;
}

/** The suit of a card: `suitOf('TD') === 'D'`. */
export function suitOf(card: Card): Suit {
  return card[1] as Suit;
}

/**
 * The numeric value of a rank: 2 to 10 for pips, J 11, Q 12, K 13, and the ace 14
 * (default) or 1 with `{ aceHigh: false }`.
 */
export function rankValue(rank: Rank, options: { aceHigh?: boolean } = {}): number {
  if (rank === 'A' && options.aceHigh === false) return 1;
  return RANK_VALUES[rank];
}

/** The English name of a card: `cardName('AS') === 'Ace of Spades'`. */
export function cardName(card: Card): string {
  return `${RANK_NAMES[rankOf(card)]} of ${SUIT_NAMES[suitOf(card)]}`;
}

/**
 * A new, unshuffled 52-card deck in a fixed order: suits `S H D C`, and within each suit
 * ranks `A 2 ... K`. So it starts `AS, 2S, ..., KS, AH` and ends `KC`.
 *
 * Shuffle it with the table's seeded RNG: `ctx.random.shuffle(standardDeck())`.
 */
export function standardDeck(): Card[] {
  return DECK.slice();
}

/**
 * A new, unshuffled shoe of `decks` standard decks concatenated (each in
 * {@link standardDeck} order). Shuffle it with `ctx.random.shuffle(shoe(6))`.
 */
export function shoe(decks: number): Card[] {
  if (!Number.isSafeInteger(decks) || decks < 1) {
    throw new RangeError(`shoe(): decks must be a positive integer, got ${String(decks)}`);
  }
  const out: Card[] = [];
  for (let d = 0; d < decks; d++) out.push(...DECK);
  return out;
}

/**
 * Removes `n` cards from the end of `pile` (the top of the deck) and returns them in the
 * order drawn, so `draw(['2S', '3S', '4S'], 2)` returns `['4S', '3S']` and leaves
 * `['2S']`. Mutates `pile` in place, so it works on the Mutative draft in an action:
 *
 * ```ts
 * state.hands[seat].push(...draw(state.deck, 2));
 * ```
 *
 * Throws a RangeError when the pile has fewer than `n` cards.
 */
export function draw<T = Card>(pile: T[], n = 1): T[] {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`draw(): n must be a non-negative integer, got ${String(n)}`);
  }
  if (n > pile.length) {
    throw new RangeError(`draw(): cannot draw ${n} from a pile of ${pile.length}`);
  }
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(pile.pop() as T);
  return out;
}
