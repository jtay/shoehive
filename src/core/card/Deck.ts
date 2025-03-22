import { Card, CardSuit, CardRank } from './types';

/**
 * A deck of cards.
 */
export class Deck {
  private cards: Card[] = [];
  private discardPile: Card[] = [];

  constructor(numberOfDecks: number = 1) {
    this.initialize(numberOfDecks);
  }

  /**
   * Initializes the deck.
   * 
   * @param numberOfDecks The number of decks to initialize.
   */
  private initialize(numberOfDecks: number): void {
    this.cards = [];
    for (let d = 0; d < numberOfDecks; d++) {
      for (const suit of Object.values(CardSuit)) {
        for (const rank of Object.values(CardRank)) {
          let value: number | undefined;
          
          // Assign default card values (can be customized by game-specific logic)
          if (rank === CardRank.ACE) {
            value = 11; // Default Ace value, games can handle it differently
          } else if (
            rank === CardRank.JACK || 
            rank === CardRank.QUEEN || 
            rank === CardRank.KING
          ) {
            value = 10;
          } else {
            value = parseInt(rank, 10) || undefined;
          }
          
          this.cards.push({
            suit,
            rank,
            value,
            isVisible: true, // Cards in deck are visible by default
          });
        }
      }
    }
  }

  /**
   * Shuffles the deck.
   */
  public shuffle(): void {
    // Fisher-Yates shuffle algorithm
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  /**
   * Draws a card from the deck.
   * 
   * @param isVisible Whether the card should be visible.
   * @returns The drawn card or null if the deck is empty.
   */
  public drawCard(isVisible: boolean = true): Card | null {
    if (this.cards.length === 0) {
      return null;
    }
    const card = this.cards.pop()!;
    card.isVisible = isVisible;
    return card;
  }

  /**
   * Draws multiple cards from the deck.
   * 
   * @param count The number of cards to draw.
   * @param isVisible Whether the cards should be visible.
   * @returns An array of drawn cards or an empty array if the deck is empty.
   */
  public drawCards(count: number, isVisible: boolean = true): Card[] {
    const cards: Card[] = [];
    for (let i = 0; i < count; i++) {
      const card = this.drawCard(isVisible);
      if (card) {
        cards.push(card);
      } else {
        break;
      }
    }
    return cards;
  }

  /**
   * Adds a card to the discard pile.
   * 
   * @param card The card to add to the discard pile.
   */
  public addToDiscard(card: Card): void {
    this.discardPile.push(card);
  }

  /**
   * Resets the deck from the discard pile.
   */
  public resetFromDiscard(): void {
    this.cards = [...this.cards, ...this.discardPile];
    this.discardPile = [];
    this.shuffle();
  }

  /**
   * Gets the number of remaining cards in the deck.
   * 
   * @returns The number of remaining cards in the deck.
   */
  public getRemainingCards(): number {
    return this.cards.length;
  }

  /**
   * Gets the number of discarded cards.
   * 
   * @returns The number of discarded cards.
   */
  public getDiscardedCards(): number {
    return this.discardPile.length;
  }
} 