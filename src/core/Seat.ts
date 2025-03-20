import { Player } from "./Player";
import { Hand } from "./Card";

export class Seat {
  private player: Player | null = null;
  private hands: Map<string, Hand> = new Map();
  private attributes: Map<string, any> = new Map();

  /**
   * Creates a new seat with a main hand by default.
   */
  constructor() {
    // Initialize with a main hand by default
    this.hands.set("main", new Hand("main"));
  }

  /**
   * Sets the player for the seat.
   * 
   * @param player The player to set for the seat.
   */
  public setPlayer(player: Player | null): void {
    this.player = player;
  }

  /**
   * Gets the player for the seat.
   * 
   * @returns The player for the seat or null if no player is set.
   */
  public getPlayer(): Player | null {
    return this.player;
  }

  /**
   * Adds a hand to the seat.
   * 
   * @param handId The ID of the hand to add.
   * @returns True if the hand was added, false if it already exists.
   */
  public addHand(handId: string): boolean {
    if (this.hands.has(handId)) {
      return false;
    }
    
    this.hands.set(handId, new Hand(handId));
    return true;
  }

  /**
   * Removes a hand from the seat.
   * 
   * @param handId The ID of the hand to remove.
   * @returns True if the hand was removed, false if it does not exist.
   */
  public removeHand(handId: string): boolean {
    if (handId === "main") {
      return false; // Cannot remove the main hand
    }
    
    return this.hands.delete(handId);
  }

  /**
   * Gets a hand from the seat.
   * 
   * @param handId The ID of the hand to get.
   * @returns The hand or null if it does not exist.
   */
  public getHand(handId: string = "main"): Hand | null {
    return this.hands.get(handId) || null;
  }

  /**
   * Gets all hands from the seat.
   * 
   * @returns A map of all hands.
   */
  public getAllHands(): Map<string, Hand> {
    return new Map(this.hands);
  }

  /**
   * Clears a hand from the seat.
   * 
   * @param handId The ID of the hand to clear.
   * @returns True if the hand was cleared, false if it does not exist.
   */
  public clearHand(handId: string = "main"): boolean {
    const hand = this.hands.get(handId);
    if (!hand) return false;
    
    hand.clear();
    return true;
  }

  /**
   * Clears all hands from the seat.
   */
  public clearAllHands(): void {
    for (const [_, hand] of this.hands) {
      hand.clear();
    }
  }

  /**
   * Sets an attribute on the seat.
   * 
   * @param key The key of the attribute to set.
   * @param value The value of the attribute to set.
   */
  public setAttribute(key: string, value: any): void {
    this.attributes.set(key, value);
  }

  /**
   * Gets an attribute from the seat.
   * 
   * @param key The key of the attribute to get.
   * @returns The value of the attribute or null if it does not exist.
   */
  public getAttribute(key: string): any {
    return this.attributes.get(key);
  }

  /**
   * Checks if the seat has an attribute.
   * 
   * @param key The key of the attribute to check.
   * @returns True if the attribute exists, false otherwise.
   */
  public hasAttribute(key: string): boolean {
    return this.attributes.has(key);
  }

  /**
   * Gets all attributes from the seat.
   * 
   * @returns A record of all attributes.
   */
  public getAttributes(): Record<string, any> {
    return Object.fromEntries(this.attributes.entries());
  }

  /**
   * Sets multiple attributes on the seat.
   * 
   * @param attributes A record of attributes to set.
   */
  public setAttributes(attributes: Record<string, any>): void {
    for (const [key, value] of Object.entries(attributes)) {
      this.attributes.set(key, value);
    }
  }

  /**
   * Removes an attribute from the seat.
   * 
   * @param key The key of the attribute to remove.
   */
  public removeAttribute(key: string): void {
    this.attributes.delete(key);
  }

  /**
   * Checks if a player can modify a seat. This enforces
   * that only the player who owns the seat can modify it.
   * 
   * @param playerId The ID of the player to check.
   * @returns True if the player can modify the seat, false otherwise.
   */
  public canPlayerModify(playerId: string): boolean {
    // Only the player who owns the seat can modify their hand
    return this.player !== null && this.player.id === playerId;
  }
} 