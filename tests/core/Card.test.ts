import { Card, CardRank, CardSuit, Deck, Hand } from '../../src/core/Card';

describe('Card Types', () => {
  test('CardSuit should have correct values', () => {
    expect(CardSuit.HEARTS).toBe('hearts');
    expect(CardSuit.DIAMONDS).toBe('diamonds');
    expect(CardSuit.CLUBS).toBe('clubs');
    expect(CardSuit.SPADES).toBe('spades');
  });

  test('CardRank should have correct values', () => {
    expect(CardRank.ACE).toBe('ace');
    expect(CardRank.TWO).toBe('2');
    expect(CardRank.THREE).toBe('3');
    expect(CardRank.KING).toBe('king');
  });
});

describe('Hand', () => {
  let hand: Hand;

  beforeEach(() => {
    hand = new Hand();
  });

  test('should initialize with default id', () => {
    expect(hand.getId()).toBe('main');
  });

  test('should initialize with custom id', () => {
    const customHand = new Hand('split');
    expect(customHand.getId()).toBe('split');
  });

  test('should add and retrieve cards', () => {
    const card1: Card = { suit: CardSuit.HEARTS, rank: CardRank.ACE, isVisible: true };
    const card2: Card = { suit: CardSuit.SPADES, rank: CardRank.KING, isVisible: false };
    
    hand.addCard(card1);
    hand.addCard(card2);
    
    const cards = hand.getCards();
    expect(cards.length).toBe(2);
    expect(cards[0]).toEqual(card1);
    expect(cards[1]).toEqual(card2);
  });

  test('should get only visible cards', () => {
    const visibleCard: Card = { suit: CardSuit.HEARTS, rank: CardRank.ACE, isVisible: true };
    const hiddenCard: Card = { suit: CardSuit.SPADES, rank: CardRank.KING, isVisible: false };
    
    hand.addCard(visibleCard);
    hand.addCard(hiddenCard);
    
    const visibleCards = hand.getVisibleCards();
    expect(visibleCards.length).toBe(1);
    expect(visibleCards[0]).toEqual(visibleCard);
  });

  test('should get only hidden cards', () => {
    const visibleCard: Card = { suit: CardSuit.HEARTS, rank: CardRank.ACE, isVisible: true };
    const hiddenCard: Card = { suit: CardSuit.SPADES, rank: CardRank.KING, isVisible: false };
    
    hand.addCard(visibleCard);
    hand.addCard(hiddenCard);
    
    const hiddenCards = hand.getHiddenCards();
    expect(hiddenCards.length).toBe(1);
    expect(hiddenCards[0]).toEqual(hiddenCard);
  });

  test('should remove card by index', () => {
    const card1: Card = { suit: CardSuit.HEARTS, rank: CardRank.ACE, isVisible: true };
    const card2: Card = { suit: CardSuit.SPADES, rank: CardRank.KING, isVisible: true };
    
    hand.addCard(card1);
    hand.addCard(card2);
    
    const removedCard = hand.removeCard(0);
    expect(removedCard).toEqual(card1);
    expect(hand.getCards().length).toBe(1);
    expect(hand.getCards()[0]).toEqual(card2);
  });

  test('should return null when removing invalid index', () => {
    const card: Card = { suit: CardSuit.HEARTS, rank: CardRank.ACE, isVisible: true };
    hand.addCard(card);
    
    expect(hand.removeCard(-1)).toBeNull();
    expect(hand.removeCard(1)).toBeNull();
    expect(hand.getCards().length).toBe(1);
  });

  test('should clear all cards', () => {
    const card1: Card = { suit: CardSuit.HEARTS, rank: CardRank.ACE, isVisible: true };
    const card2: Card = { suit: CardSuit.SPADES, rank: CardRank.KING, isVisible: true };
    
    hand.addCard(card1);
    hand.addCard(card2);
    
    hand.clear();
    expect(hand.getCards().length).toBe(0);
  });

  test('should manage attributes correctly', () => {
    expect(hand.hasAttribute('value')).toBe(false);
    
    hand.setAttribute('value', 21);
    expect(hand.hasAttribute('value')).toBe(true);
    expect(hand.getAttribute('value')).toBe(21);
    
    hand.setAttribute('value', 19);
    expect(hand.getAttribute('value')).toBe(19);
    
    expect(hand.getAttribute('nonexistent')).toBeUndefined();
  });
});

describe('Deck', () => {
  test('should initialize with single deck of 52 cards', () => {
    const deck = new Deck();
    expect(deck.getRemainingCards()).toBe(52);
  });

  test('should initialize with multiple decks', () => {
    const deck = new Deck(2);
    expect(deck.getRemainingCards()).toBe(104);
    
    const deck6 = new Deck(6);
    expect(deck6.getRemainingCards()).toBe(312);
  });

  test('should draw a card', () => {
    const deck = new Deck();
    const initialCount = deck.getRemainingCards();
    
    const card = deck.drawCard();
    
    expect(card).not.toBeNull();
    expect(card?.isVisible).toBe(true);
    expect(deck.getRemainingCards()).toBe(initialCount - 1);
  });

  test('should draw a hidden card', () => {
    const deck = new Deck();
    
    const card = deck.drawCard(false);
    
    expect(card).not.toBeNull();
    expect(card?.isVisible).toBe(false);
  });

  test('should draw multiple cards', () => {
    const deck = new Deck();
    const initialCount = deck.getRemainingCards();
    
    const cards = deck.drawCards(5);
    
    expect(cards.length).toBe(5);
    expect(deck.getRemainingCards()).toBe(initialCount - 5);
  });

  test('should handle drawing more cards than available', () => {
    const deck = new Deck();
    const initialCount = deck.getRemainingCards();
    
    const cards = deck.drawCards(60);
    
    expect(cards.length).toBe(initialCount);
    expect(deck.getRemainingCards()).toBe(0);
  });

  test('should return null when drawing from empty deck', () => {
    const deck = new Deck();
    // Draw all cards
    deck.drawCards(52);
    
    const card = deck.drawCard();
    expect(card).toBeNull();
  });

  test('should add cards to discard pile', () => {
    const deck = new Deck();
    const card = deck.drawCard()!;
    
    deck.addToDiscard(card);
    
    expect(deck.getDiscardedCards()).toBe(1);
  });

  test('should reset deck from discard pile', () => {
    const deck = new Deck();
    const cards = deck.drawCards(10);
    
    cards.forEach(card => deck.addToDiscard(card));
    
    expect(deck.getRemainingCards()).toBe(42);
    expect(deck.getDiscardedCards()).toBe(10);
    
    deck.resetFromDiscard();
    
    expect(deck.getRemainingCards()).toBe(52);
    expect(deck.getDiscardedCards()).toBe(0);
  });

  test('should shuffle the deck', () => {
    jest.spyOn(global.Math, 'random').mockImplementation(() => 0.5);
    
    const deck1 = new Deck();
    const deck2 = new Deck();
    
    // Draw some cards from both decks to get reference cards before shuffling
    const preShuffleCard1 = deck1.drawCard();
    const preShuffleCard2 = deck2.drawCard();
    
    // Verify both decks produce the same card (they're ordered the same)
    expect(preShuffleCard1?.suit).toBe(preShuffleCard2?.suit);
    expect(preShuffleCard1?.rank).toBe(preShuffleCard2?.rank);
    
    // Shuffle only the second deck
    deck2.shuffle();
    
    // Draw another card from each deck
    const postShuffleCard1 = deck1.drawCard();
    const postShuffleCard2 = deck2.drawCard();
    
    // After shuffling, the cards should be different
    expect(
      postShuffleCard1?.suit !== postShuffleCard2?.suit || 
      postShuffleCard1?.rank !== postShuffleCard2?.rank
    ).toBeTruthy();
    
    jest.spyOn(global.Math, 'random').mockRestore();
  });
}); 