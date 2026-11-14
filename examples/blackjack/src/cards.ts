// Minimal card helpers for the rules-only blackjack example. Phase 4 replaces these
// with shoehive/cards.

export type Card =
  `${'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K'}${'S' | 'H' | 'D' | 'C'}`;

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'] as const;
const SUITS = ['S', 'H', 'D', 'C'] as const;

export function freshShoe(decks: number): Card[] {
  const shoe: Card[] = [];
  for (let d = 0; d < decks; d++)
    for (const s of SUITS) for (const r of RANKS) shoe.push(`${r}${s}`);
  return shoe;
}

/** Best blackjack total: aces count 11 unless that busts. */
export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    const rank = card[0];
    if (rank === 'A') {
      aces += 1;
      total += 1;
    } else if (rank === 'T' || rank === 'J' || rank === 'Q' || rank === 'K') {
      total += 10;
    } else {
      total += Number(rank);
    }
  }
  const soft = aces > 0 && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}

export const isBlackjack = (cards: readonly Card[]): boolean =>
  cards.length === 2 && handValue(cards).total === 21;
