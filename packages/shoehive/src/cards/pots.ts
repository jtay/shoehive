// Main and side pots for all-in situations, and splitting them between winners.

/** One pot from {@link splitPots}. */
export interface Pot {
  /** Chips in this pot. */
  readonly amount: number;
  /** Seats that can win it, ascending: not folded, and contributed up to its level. */
  readonly eligible: number[];
}

const checkChips = (value: number, where: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${where}: chip amounts must be non-negative integers, got ${value}`);
  }
};

/**
 * Splits the chips each seat put in this hand into a main pot and side pots.
 * `contributions[seat]` is that seat's total for the hand and `folded[seat]` whether it
 * folded. Pots come main pot first; each later pot has a higher contribution level and
 * fewer eligible seats.
 *
 * Rules: every seat's chips go into the pots up to its contribution, folded or not; a
 * pot's eligible seats are the unfolded seats that contributed at least its level;
 * neighbouring levels with the same eligible seats merge into one pot; chips above the
 * highest unfolded contribution (only possible when a folded seat put in more) go into
 * the last pot. The amounts always sum to the total contributed, and no chips means no
 * pots. If every contributing seat folded, the result is one pot with no eligible seats.
 *
 * ```ts
 * // Seat 0 all-in for 50, seats 1 and 2 put in 200, seat 3 folded after 20.
 * splitPots([50, 200, 200, 20], [false, false, false, true]);
 * // [{ amount: 170, eligible: [0, 1, 2] }, { amount: 300, eligible: [1, 2] }]
 * ```
 */
export function splitPots(contributions: readonly number[], folded: readonly boolean[]): Pot[] {
  if (folded.length !== contributions.length) {
    throw new RangeError(
      `splitPots(): ${contributions.length} contributions but ${folded.length} folded flags`,
    );
  }
  for (const c of contributions) checkChips(c, 'splitPots()');
  const levels = [...new Set(contributions.filter((c, s) => c > 0 && !folded[s]))].sort(
    (a, b) => a - b,
  );
  const pots: { amount: number; eligible: number[] }[] = [];
  let previous = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of contributions) amount += Math.max(0, Math.min(c, level) - previous);
    const eligible: number[] = [];
    contributions.forEach((c, s) => {
      if (!folded[s] && c >= level) eligible.push(s);
    });
    // Eligible sets only shrink as the level rises, so equal sizes mean equal sets.
    const last = pots.at(-1);
    if (last?.eligible.length === eligible.length) last.amount += amount;
    else pots.push({ amount, eligible });
    previous = level;
  }
  let rest = 0;
  for (const c of contributions) rest += Math.max(0, c - previous);
  if (rest > 0) {
    const last = pots.at(-1);
    if (last) last.amount += rest;
    else pots.push({ amount: rest, eligible: [] });
  }
  return pots;
}

/**
 * Pays out pots. `scores[seat]` is that seat's hand strength (for poker,
 * `evaluateHand(cards).rank`), higher wins, or `null` for a seat with no hand. Each pot
 * goes to its eligible seats with the highest score; returns the chips won per seat
 * (length `scores.length`). With one unfolded seat left, give it any score.
 *
 * Ties split a pot evenly. Chips that do not divide go one at a time to the tied
 * winners in seat order, starting from `firstSeat` (default 0) and wrapping, so with
 * the default the first winner by seat number gets the odd chip. For the usual
 * "left of the button" rule, pass `{ firstSeat: (button + 1) % seats }`.
 *
 * Throws a RangeError when a pot with chips has no eligible seat with a score.
 *
 * ```ts
 * const pots = splitPots(state.contributions, state.folded);
 * const scores = state.seats.map((s) => (s.folded ? null : evaluateHand([...s.hole, ...board]).rank));
 * const won = awardPots(pots, scores); // won[seat] chips for each seat
 * ```
 */
export function awardPots(
  pots: readonly Pot[],
  scores: readonly (number | null)[],
  options: { firstSeat?: number } = {},
): number[] {
  const seats = scores.length;
  const firstSeat = options.firstSeat ?? 0;
  if (!Number.isSafeInteger(firstSeat) || firstSeat < 0) {
    throw new RangeError(`awardPots(): firstSeat must be a non-negative integer`);
  }
  const won = new Array<number>(seats).fill(0);
  for (const pot of pots) {
    checkChips(pot.amount, 'awardPots()');
    if (pot.amount === 0) continue;
    let top = -Infinity;
    let best: number[] = [];
    for (const seat of pot.eligible) {
      const score = scores[seat] ?? null;
      if (score === null) continue;
      if (score > top) {
        top = score;
        best = [seat];
      } else if (score === top) {
        best.push(seat);
      }
    }
    if (best.length === 0) {
      throw new RangeError(`awardPots(): a pot of ${pot.amount} has no eligible seat with a score`);
    }
    const start = firstSeat % seats;
    best.sort((a, b) => ((a - start + seats) % seats) - ((b - start + seats) % seats));
    const share = Math.floor(pot.amount / best.length);
    const odd = pot.amount - share * best.length;
    best.forEach((seat, i) => {
      won[seat] = won[seat]! + share + (i < odd ? 1 : 0);
    });
  }
  return won;
}
