import { Card } from './types';
import { Deck } from './Deck';

/**
 * A hand of [Card](/api/interfaces/card/)s.
 * 
 * ✅ Attribute Support
 * 
 * This class manages a player's hand of cards, including their cards and attributes.
 * It provides methods for adding and removing cards, clearing the hand, and managing hand attributes.
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
   * 
   * @param deck Optional deck to discard cards to when clearing the hand
   */
  public clear(deck?: Deck): void {
    if (deck) {
      // Add all cards to the discard pile
      for (const card of this.cards) {
        deck.addToDiscard(card);
      }
    }
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