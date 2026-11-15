// Blackjack hand totals.

import { assertCard, rankOf, type Card } from './card';

/** The value of a blackjack hand, from {@link blackjackValue}. */
export interface BlackjackValue {
  /** The best total: aces count 11 unless that would bust, then 1. */
  readonly total: number;
  /** True when an ace is counted as 11 (the hand can take a card without busting). */
  readonly soft: boolean;
  /** True for a natural: exactly two cards totalling 21. */
  readonly blackjack: boolean;
  /** True when the total is over 21. */
  readonly bust: boolean;
}

/**
 * Scores a blackjack hand. Pips count face value, T J Q K count 10, and aces count 11
 * when that does not bust the hand, else 1 (at most one ace can ever count 11).
 *
 * ```ts
 * blackjackValue(['AS', '6H']); // { total: 17, soft: true, blackjack: false, bust: false }
 * blackjackValue(['AS', 'KD']); // { total: 21, soft: true, blackjack: true, bust: false }
 * ```
 */
export function blackjackValue(cards: readonly Card[]): BlackjackValue {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    assertCard(card, 'blackjackValue()');
    const rank = rankOf(card);
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
  if (soft) total += 10;
  return { total, soft, blackjack: cards.length === 2 && total === 21, bust: total > 21 };
}
