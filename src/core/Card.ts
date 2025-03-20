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

export class Hand {
  private cards: Card[] = [];
  private id: string;
  private attributes: Map<string, any> = new Map();

  constructor(id: string = "main") {
    this.id = id;
  }

  public addCard(card: Card): void {
    this.cards.push(card);
  }

  public removeCard(index: number): Card | null {
    if (index < 0 || index >= this.cards.length) {
      return null;
    }
    return this.cards.splice(index, 1)[0];
  }

  public getCards(): Card[] {
    return [...this.cards];
  }

  public getVisibleCards(): Card[] {
    return this.cards.filter(card => card.isVisible);
  }

  public getHiddenCards(): Card[] {
    return this.cards.filter(card => !card.isVisible);
  }

  public clear(): void {
    this.cards = [];
  }

  public getId(): string {
    return this.id;
  }

  public setAttribute(key: string, value: any): void {
    this.attributes.set(key, value);
  }

  public getAttribute(key: string): any {
    return this.attributes.get(key);
  }

  public hasAttribute(key: string): boolean {
    return this.attributes.has(key);
  }
}

export class Deck {
  private cards: Card[] = [];
  private discardPile: Card[] = [];

  constructor(numberOfDecks: number = 1) {
    this.initialize(numberOfDecks);
  }

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

  public shuffle(): void {
    // Fisher-Yates shuffle algorithm
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  public drawCard(isVisible: boolean = true): Card | null {
    if (this.cards.length === 0) {
      return null;
    }
    const card = this.cards.pop()!;
    card.isVisible = isVisible;
    return card;
  }

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

  public addToDiscard(card: Card): void {
    this.discardPile.push(card);
  }

  public resetFromDiscard(): void {
    this.cards = [...this.cards, ...this.discardPile];
    this.discardPile = [];
    this.shuffle();
  }

  public getRemainingCards(): number {
    return this.cards.length;
  }

  public getDiscardedCards(): number {
    return this.discardPile.length;
  }
} 