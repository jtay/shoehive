import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  blackjackValue,
  cardName,
  draw,
  faceDown,
  hideCard,
  isCard,
  RANKS,
  rankOf,
  rankValue,
  revealTo,
  seatView,
  shoe,
  standardDeck,
  SUITS,
  suitOf,
  type Card,
} from '../../src/cards/index';
import type { Viewer } from '../../src/index';

describe('card model', () => {
  it('lists ranks and suits in a fixed order', () => {
    expect(RANKS.join('')).toBe('A23456789TJQK');
    expect(SUITS.join('')).toBe('SHDC');
    expect(Object.isFrozen(RANKS)).toBe(true);
  });

  it('recognises cards', () => {
    expect(isCard('AS')).toBe(true);
    expect(isCard('TD')).toBe(true);
    for (const bad of ['', 'A', '1S', '10S', 'as', 'AX', 'ASX', 'XS', 42, null, undefined, ['A']]) {
      expect(isCard(bad)).toBe(false);
    }
  });

  it('splits cards into rank and suit', () => {
    expect(rankOf('TD')).toBe('T');
    expect(suitOf('TD')).toBe('D');
    expect(cardName('AS')).toBe('Ace of Spades');
    expect(cardName('TH')).toBe('Ten of Hearts');
    expect(cardName('2C')).toBe('Two of Clubs');
    expect(cardName('QD')).toBe('Queen of Diamonds');
  });

  it('values ranks with the ace high by default', () => {
    expect(RANKS.map((r) => rankValue(r))).toEqual([14, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(RANKS.map((r) => rankValue(r, { aceHigh: false }))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });

  it('builds a standard deck in documented order', () => {
    const deck = standardDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck).size).toBe(52);
    expect(deck.every(isCard)).toBe(true);
    expect(deck.slice(0, 3)).toEqual(['AS', '2S', '3S']);
    expect(deck[13]).toBe('AH');
    expect(deck.at(-1)).toBe('KC');
    // A fresh copy each time.
    deck.pop();
    expect(standardDeck()).toHaveLength(52);
  });

  it('builds shoes of n decks', () => {
    const six = shoe(6);
    expect(six).toHaveLength(312);
    expect(six.slice(52, 104)).toEqual(standardDeck());
    expect(six.filter((c) => c === 'AS')).toHaveLength(6);
    expect(() => shoe(0)).toThrow(RangeError);
    expect(() => shoe(1.5)).toThrow(RangeError);
  });
});

describe('draw', () => {
  it('removes cards from the end and returns them in draw order', () => {
    const pile: Card[] = ['2S', '3S', '4S'];
    expect(draw(pile)).toEqual(['4S']);
    expect(pile).toEqual(['2S', '3S']);
    const pile2: Card[] = ['2S', '3S', '4S'];
    expect(draw(pile2, 2)).toEqual(['4S', '3S']);
    expect(pile2).toEqual(['2S']);
    expect(draw(pile2, 0)).toEqual([]);
    expect(pile2).toEqual(['2S']);
  });

  it('refuses to overdraw or take a bad count', () => {
    const pile: Card[] = ['2S'];
    expect(() => draw(pile, 2)).toThrow(RangeError);
    expect(() => draw(pile, -1)).toThrow(RangeError);
    expect(() => draw(pile, 0.5)).toThrow(RangeError);
    expect(pile).toEqual(['2S']);
  });

  it('keeps every card exactly once (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 52 }), (n) => {
        const pile = standardDeck();
        const drawn = draw(pile, n);
        expect(drawn).toHaveLength(n);
        expect([...pile, ...drawn.slice().reverse()]).toEqual(standardDeck());
      }),
    );
  });
});

describe('visibility', () => {
  const hands: Card[][] = [
    ['AS', 'KD'],
    ['2C', '3C', '4C'],
    ['TH', 'TD'],
  ];
  const seat = (s: number): Viewer => ({ kind: 'seat', seat: s, seats: [s], playerId: `p${s}` });
  const spectator: Viewer = { kind: 'spectator', seat: null, seats: [], playerId: null };

  it('faceDown keeps the count and hides every face', () => {
    expect(faceDown(['AS', 'KD', '2C'])).toEqual([null, null, null]);
    expect(faceDown([])).toEqual([]);
    expect(hideCard('AS')).toBeNull();
  });

  it('revealTo shows or hides', () => {
    const cards: Card[] = ['AS', 'KD'];
    const shown = revealTo(cards, true);
    expect(shown).toEqual(cards);
    expect(shown).not.toBe(cards);
    expect(revealTo(cards, false)).toEqual([null, null]);
  });

  it('seatView shows a viewer only their own seats', () => {
    expect(seatView(hands, seat(1), faceDown)).toEqual([
      [null, null],
      ['2C', '3C', '4C'],
      [null, null],
    ]);
    expect(seatView(hands, spectator, faceDown)).toEqual([
      [null, null],
      [null, null, null],
      [null, null],
    ]);
    const twoSeats: Viewer = { kind: 'seat', seat: 0, seats: [0, 2], playerId: 'p0' };
    expect(seatView(hands, twoSeats, faceDown)).toEqual([hands[0], [null, null, null], hands[2]]);
  });

  it('seatView passes the seat to the hidden form', () => {
    const shown = [false, false, true];
    expect(seatView(hands, seat(0), (hand, s) => revealTo(hand, shown[s] === true))).toEqual([
      hands[0],
      [null, null, null],
      hands[2],
    ]);
    expect(seatView([5, 6, 7], seat(2), () => 'hidden')).toEqual(['hidden', 'hidden', 7]);
  });

  it('seatView never leaks another seat (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.shuffledSubarray(standardDeck(), { minLength: 0, maxLength: 5 }), {
          maxLength: 9,
        }),
        fc.integer({ min: 0, max: 9 }),
        (perSeat, viewerSeat) => {
          const view = seatView(perSeat, seat(viewerSeat), faceDown);
          expect(view).toHaveLength(perSeat.length);
          view.forEach((v, s) => {
            if (s === viewerSeat) expect(v).toEqual(perSeat[s]);
            else expect(v.every((c) => c === null)).toBe(true);
            expect(v).toHaveLength(perSeat[s]!.length);
          });
        },
      ),
    );
  });
});

describe('blackjackValue', () => {
  const cases: [Card[], number, boolean, boolean, boolean][] = [
    // cards, total, soft, blackjack, bust
    [[], 0, false, false, false],
    [['AS', 'KD'], 21, true, true, false],
    [['TS', 'AD'], 21, true, true, false],
    [['AS', '6H'], 17, true, false, false],
    [['AS', '6H', 'TD'], 17, false, false, false],
    [['AS', 'AH'], 12, true, false, false],
    [['AS', 'AH', 'AD', 'AC'], 14, true, false, false],
    [['AS', 'AH', '9D'], 21, true, false, false],
    [['7S', '7H', '7D'], 21, false, false, false],
    [['KS', 'QH'], 20, false, false, false],
    [['KS', 'QH', '2D'], 22, false, false, true],
    [['5S', '6H', 'AD', 'KC'], 22, false, false, true],
    [['2S', '3H', '4D', '5C', '6S'], 20, false, false, false],
    [['AS', '5H', '5D'], 21, true, false, false],
  ];
  it.each(cases)('%j totals %i', (cards, total, soft, blackjack, bust) => {
    expect(blackjackValue(cards)).toEqual({ total, soft, blackjack, bust });
  });

  it('rejects bad cards', () => {
    expect(() => blackjackValue(['AS', 'ZZ' as Card])).toThrow(TypeError);
  });
});
