export enum CardSuit {
  HEARTS = "hearts",
  DIAMONDS = "diamonds",
  CLUBS = "clubs",
  SPADES = "spades"
}

export enum CardRank {
  ACE = "ace",
  TWO = "2",
  THREE = "3",
  FOUR = "4",
  FIVE = "5",
  SIX = "6",
  SEVEN = "7",
  EIGHT = "8",
  NINE = "9",
  TEN = "10",
  JACK = "jack",
  QUEEN = "queen",
  KING = "king"
}

export interface Card {
  suit: CardSuit;
  rank: CardRank;
  value?: number;
  isVisible: boolean;
}

/**
 * A hand of cards.
 */
export class Hand {
  private cards: Card[] = [];
  private id: string;
  private attributes: Map<string, any> = new Map();

  constructor(id: string = "main") {
    this.id = id;
  }

  /**
   * Adds a card to the hand.
   * 
   * @param card The card to add.
   */
  public addCard(card: Card): void {
    this.cards.push(card);
  }

  /**
   * Removes a card from the hand.
   * 
   * @param index The index of the card to remove.
   * @returns The removed card or null if the index is out of bounds.
   */
  public removeCard(index: number): Card | null {
    if (index < 0 || index >= this.cards.length) {
      return null;
    }
    return this.cards.splice(index, 1)[0];
  }

  /**
   * Gets all cards in the hand.
   * 
   * @returns A copy of the cards in the hand.
   */
  public getCards(): Card[] {
    return [...this.cards];
  }

  /**
   * Gets all visible cards in the hand.
   * 
   * @returns A copy of the visible cards in the hand.
   */
  public getVisibleCards(): Card[] {
    return this.cards.filter(card => card.isVisible);
  }

  /**
   * Gets all hidden cards in the hand.
   * 
   * @returns A copy of the hidden cards in the hand.
   */
  public getHiddenCards(): Card[] {
    return this.cards.filter(card => !card.isVisible);
  }

  /**
   * Clears the hand.
   */
  public clear(): void {
    this.cards = [];
  }

  /**
   * Gets the ID of the hand.
   * 
   * @returns The ID of the hand.
   */
  public getId(): string {
    return this.id;
  }

  /**
   * Sets an attribute on the hand.
   * 
   * @param key The key of the attribute to set.
   * @param value The value of the attribute to set.
   */
  public setAttribute(key: string, value: any): void {
    this.attributes.set(key, value);
  }

  /**
   * Gets an attribute from the hand.
   * 
   * @param key The key of the attribute to get.
   * @returns The value of the attribute or null if the attribute does not exist.
   */
  public getAttribute(key: string): any {
    return this.attributes.get(key);
  }

  /**
   * Checks if the hand has an attribute.
   * 
   * @param key The key of the attribute to check.
   * @returns True if the attribute exists, false otherwise.
   */
  public hasAttribute(key: string): boolean {
    return this.attributes.has(key);
  }

  /**
   * Returns a representation of the hand that is safe to send to clients.
   * Only includes visible cards and attributes.
   * 
   * @returns A representation of the hand that is safe to send to clients.
   */
  public getVisibleState(): any {
    return {
      id: this.id,
      cards: this.getVisibleCards(),
      hiddenCardCount: this.getHiddenCards().length,
      attributes: Object.fromEntries(this.attributes.entries())
    };
  }
}

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