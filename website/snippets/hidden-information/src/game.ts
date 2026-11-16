import { defineGame, reject } from 'shoehive';
import { revealTo, seatView, standardDeck, type Card } from 'shoehive/cards';

// A tiny "high card" game: everyone is dealt two cards face down, then shows them.
export const highCard = defineGame({
  id: 'high-card',
  seats: { min: 2, max: 4 },

  setup: ({ random, seats }) => {
    const deck: Card[] = random.shuffle(standardDeck());
    return {
      deck,
      hands: Array.from({ length: seats }, () => [deck.pop()!, deck.pop()!]),
      shown: Array<boolean>(seats).fill(false),
    };
  },

  actions: {
    show: {
      run({ state, seat }) {
        if (state.shown[seat]) reject('ALREADY_SHOWN');
        state.shown[seat] = true;
      },
    },
  },

  // #region view
  view: ({ state, viewer }) => ({
    // Your own hand in full; every other hand as nulls, unless that seat has shown it.
    hands: seatView(state.hands, viewer, (hand, seat) => revealTo(hand, state.shown[seat]!)),
    shown: state.shown,
    // Never the deck itself, only how many cards are left.
    deckSize: state.deck.length,
  }),
  // #endregion view
});
