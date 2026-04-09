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
  private attributes: Map<string, unknown> = new Map();

  constructor(id = 'main') {
    this.id = id;
  }

  /**
   * Adds a card to the hand.
   *
   * @param card The card to add.
   */
  public addCard({ card }: { card: Card }): void {
    this.cards.push(card);
  }

  /**
   * Removes a card from the hand.
   *
   * @param index The index of the card to remove.
   * @returns The removed card or null if the index is out of bounds.
   */
  public removeCard({ index }: { index: number }): Card | null {
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
    return this.cards.filter((card) => card.isVisible);
  }

  /**
   * Gets all hidden cards in the hand.
   *
   * @returns A copy of the hidden cards in the hand.
   */
  public getHiddenCards(): Card[] {
    return this.cards.filter((card) => !card.isVisible);
  }

  /**
   * Clears the hand.
   *
   * @param deck Optional deck to discard cards to when clearing the hand
   */
  public clear({ deck }: { deck?: Deck } = {}): void {
    if (deck) {
      // Add all cards to the discard pile
      for (const card of this.cards) {
        deck.addToDiscard({ card });
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
  public setAttribute({ key, value }: { key: string; value: unknown }): void {
    this.attributes.set(key, value);
  }

  /**
   * Gets an attribute from the hand.
   *
   * @param key The key of the attribute to get.
   * @returns The value of the attribute or null if the attribute does not exist.
   */
  public getAttribute({ key }: { key: string }): unknown {
    return this.attributes.get(key);
  }

  /**
   * Checks if the hand has an attribute.
   *
   * @param key The key of the attribute to check.
   * @returns True if the attribute exists, false otherwise.
   */
  public hasAttribute({ key }: { key: string }): boolean {
    return this.attributes.has(key);
  }

  /**
   * Returns a representation of the hand that is safe to send to clients.
   * Only includes visible cards and attributes.
   *
   * @returns A representation of the hand that is safe to send to clients.
   */
  public getVisibleState(): unknown {
    return {
      id: this.id,
      cards: this.getVisibleCards(),
      hiddenCardCount: this.getHiddenCards().length,
      attributes: Object.fromEntries(this.attributes.entries()),
    };
  }

  /**
   * Returns a complete representation of the hand, including hidden cards.
   * This should ONLY be sent to the player who owns this hand.
   *
   * @returns A complete representation of the hand.
   */
  public getFullState(): unknown {
    return {
      id: this.id,
      cards: this.getCards(),
      hiddenCardCount: this.getHiddenCards().length,
      attributes: Object.fromEntries(this.attributes.entries()),
    };
  }
}
