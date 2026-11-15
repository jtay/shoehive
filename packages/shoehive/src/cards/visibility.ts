// Helpers for view(): hide card faces and other per-seat secrets (RFC 0001 section 5.2).

import type { Card } from './card';

/** A card as a viewer sees it: the card, or `null` when it is face down. */
export type VisibleCard = Card | null;

/** Hides one card. Handy as a map callback: `hand.map((c, i) => (i === 0 ? c : hideCard(c)))`. */
export function hideCard(_card: Card): null {
  return null;
}

/**
 * Every card face down: the same number of entries, each `null`. The count stays
 * visible, the faces do not.
 */
export function faceDown(cards: readonly Card[]): VisibleCard[] {
  return cards.map(() => null);
}

/** `cards` unchanged (copied) when `visible` is true, otherwise {@link faceDown}. */
export function revealTo(cards: readonly Card[], visible: boolean): VisibleCard[] {
  return visible ? cards.slice() : faceDown(cards);
}

/**
 * Shows a viewer the values for the seats they hold and a hidden form of every other
 * seat's value. `perSeat` is indexed by seat; `viewer` is the `Viewer` passed to `view()`
 * (spectators hold no seats, so they see only hidden forms).
 *
 * ```ts
 * view: ({ state, viewer }) => ({
 *   ...state,
 *   hands: seatView(state.hands, viewer, faceDown), // own hand, others as nulls
 *   bets: state.bets,                                // public, left as is
 *   deck: state.deck.length,                         // never send the deck itself
 * }),
 * ```
 *
 * `hidden` also receives the seat, for example to reveal hands at showdown:
 * `seatView(state.hands, viewer, (hand, seat) => revealTo(hand, state.shown[seat]))`.
 */
export function seatView<T, H>(
  perSeat: readonly T[],
  viewer: { readonly seats: readonly number[] },
  hidden: (value: T, seat: number) => H,
): (T | H)[] {
  return perSeat.map((value, seat) => (viewer.seats.includes(seat) ? value : hidden(value, seat)));
}
