import { EventBus } from "../events/EventBus";
import { TABLE_EVENTS } from "../events/EventTypes";
import { Player } from "./Player";
import { Card, Deck, Hand } from "./Card";
import { Seat } from "./Seat";
import crypto from "crypto";

export enum TableState {
  WAITING = "waiting",
  ACTIVE = "active", 
  ENDED = "ended"
}

/**
 * Represents a game table with players, seats, and game state.
 * 
 * The Table class manages a group of players and seats for a specific game.
 * It emits various events to notify other components about changes in the table state.
 */
export class Table {
  public readonly id: string;
  private players: Map<string, Player> = new Map();
  private seats: Array<Seat>;
  private eventBus: EventBus;
  private state: TableState = TableState.WAITING;
  private readonly totalSeats: number;
  private readonly maxSeatsPerPlayer: number;
  private attributes: Map<string, any> = new Map();
  private deck: Deck | null = null;

  constructor(
    eventBus: EventBus,
    totalSeats: number,
    maxSeatsPerPlayer: number,
    id?: string
  ) {
    this.id = id || crypto.randomUUID();
    this.eventBus = eventBus;
    this.totalSeats = totalSeats;
    this.maxSeatsPerPlayer = maxSeatsPerPlayer;
    
    // Initialize seats with Seat objects
    this.seats = new Array(totalSeats).fill(null).map(() => new Seat());
  }

  /*
   * Card and deck related methods
   */

  /**
   * Creates a new deck for the table. Emits TABLE_EVENTS.DECK_CREATED when the deck is created.
   * @param numberOfDecks - The number of decks to create.
   */
  public createDeck(numberOfDecks: number = 1): void {
    this.deck = new Deck(numberOfDecks);
    this.eventBus.emit(TABLE_EVENTS.DECK_CREATED, this, numberOfDecks);
  }

  /**
   * Gets the current deck.
   * @returns The deck object or null if no deck has been created.
   */
  public getDeck(): Deck | null {
    return this.deck;
  }

  /**
   * Shuffles the current deck. Emits TABLE_EVENTS.DECK_SHUFFLED when the deck is shuffled.
   * @returns True if the deck was shuffled, false if no deck exists.
   */
  public shuffleDeck(): boolean {
    if (!this.deck) return false;
    
    this.deck.shuffle();
    this.eventBus.emit(TABLE_EVENTS.DECK_SHUFFLED, this);
    return true;
  }

  /**
   * Draws a card from the deck. Emits TABLE_EVENTS.DECK_CARD_DRAWN when a card is drawn.
   * @param isVisible - Whether the card should be visible to the player.
   * @returns The drawn card or null if no deck exists.
   */
  public drawCard(isVisible: boolean = true): Card | null {
    if (!this.deck) return null;
    
    const card = this.deck.drawCard(isVisible);
    if (card) {
      this.eventBus.emit(TABLE_EVENTS.DECK_CARD_DRAWN, this, card);
    }
    return card;
  }

  /**
   * Deals a card to a seat. Emits TABLE_EVENTS.CARD_DEALT when a card is dealt.
   * @param seatIndex - The index of the seat to deal the card to.
   * @param isVisible - Whether the card should be visible to the player.
   * @param handId - The ID of the hand to deal the card to.
   * @returns True if the card was dealt, false if no deck exists.
   */
  public dealCardToSeat(
    seatIndex: number, 
    isVisible: boolean = true, 
    handId: string = "main"
  ): boolean {
    if (!this.deck) return false;
    
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return false;
    }
    
    const card = this.deck.drawCard(isVisible);
    if (!card) return false;
    
    const seat = this.seats[seatIndex];
    
    // Create the hand if it doesn't exist
    if (!seat.getHand(handId)) {
      seat.addHand(handId);
    }
    
    const hand = seat.getHand(handId);
    if (!hand) return false;
    
    hand.addCard(card);
    
    this.eventBus.emit(TABLE_EVENTS.CARD_DEALT, this, seatIndex, card, handId);
    return true;
  }

  /**
   * Gets a hand at a specific seat.
   * @param seatIndex - The index of the seat to get the hand from.
   * @param handId - The ID of the hand to get.
   * @returns The hand object or null if no hand exists.
   */
  public getHandAtSeat(seatIndex: number, handId: string = "main"): Hand | null {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return null;
    }
    
    return this.seats[seatIndex].getHand(handId);
  }

  /**
   * Deals a card to a hand. Emits TABLE_EVENTS.CARD_DEALT when a card is dealt.
   * @param hand <Hand> - The hand to deal the card to.
   * @returns True if the card was dealt, false if no seat or hand exists.
   */
  public dealCardToHand(hand: Hand): boolean {
    if (!this.deck) return false;

    const card = this.deck.drawCard(true);
    if (!card) return false;

    hand.addCard(card);
    this.eventBus.emit(TABLE_EVENTS.CARD_DEALT, this, card, hand.getId());
    return true;
  }

  /**
   * Gets all hands at a specific seat.
   * @param seatIndex - The index of the seat to get the hands from.
   * @returns A map of hand IDs to hand objects or null if no seat exists.
   */
  public getAllHandsAtSeat(seatIndex: number): Map<string, Hand> | null {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return null;
    }
    
    return this.seats[seatIndex].getAllHands();
  }

  /**
   * Clears a hand at a specific seat. Emits TABLE_EVENTS.SEAT_HAND_CLEARED when a hand is cleared.
   * @param seatIndex - The index of the seat to clear the hand from.
   * @param handId - The ID of the hand to clear.
   * @returns True if the hand was cleared, false if no seat exists.
   */
  public clearHandAtSeat(seatIndex: number, handId: string = "main"): boolean {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return false;
    }
    
    const result = this.seats[seatIndex].clearHand(handId);
    if (result) {
      this.eventBus.emit(TABLE_EVENTS.SEAT_HAND_CLEARED, this, seatIndex, handId);
    }
    return result;
  }

  /**
   * Clears all hands at the table. Emits TABLE_EVENTS.SEATS_HANDS_CLEARED when all hands are cleared.
   */
  public clearAllHands(): void {
    for (let i = 0; i < this.totalSeats; i++) {
      this.seats[i].clearAllHands();
    }
    this.eventBus.emit(TABLE_EVENTS.SEATS_HANDS_CLEARED, this);
  }

  /**
   * Adds a hand to a seat. Emits TABLE_EVENTS.SEAT_HAND_ADDED when a hand is added to a seat.
   * @param seatIndex - The index of the seat to add the hand to.
   * @param handId - The ID of the hand to add.
   * @returns True if the hand was added, false if no seat exists.
   */
  public addHandToSeat(seatIndex: number, handId: string): boolean {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return false;
    }
    
    const result = this.seats[seatIndex].addHand(handId);
    if (result) {
      this.eventBus.emit(TABLE_EVENTS.SEAT_HAND_ADDED, this, seatIndex, handId);
    }
    return result;
  }

  /**
   * Removes a hand from a seat. Emits TABLE_EVENTS.SEAT_HAND_REMOVED when a hand is removed from a seat.
   * @param seatIndex - The index of the seat to remove the hand from.
   * @param handId - The ID of the hand to remove.
   * @returns True if the hand was removed, false if no seat exists.
   */
  public removeHandFromSeat(seatIndex: number, handId: string): boolean {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return false;
    }
    
    const result = this.seats[seatIndex].removeHand(handId);
    if (result) {
      this.eventBus.emit(TABLE_EVENTS.SEAT_HAND_REMOVED, this, seatIndex, handId);
    }
    return result;
  }

  /**
   * Adds a player to the table. Emits TABLE_EVENTS.PLAYER_JOINED when a player joins the table.
   * @param player - The player to add.
   * @returns True if the player was added, false if the player is already at a table.
   */
  public addPlayer(player: Player): boolean {
    // Check if player is already at a table
    if (player.getTable()) {
      return false;
    }

    this.players.set(player.id, player);
    player.setTable(this);
    this.eventBus.emit(TABLE_EVENTS.PLAYER_JOINED, player, this);
    return true;
  }

  /**
   * Removes a player from the table. Emits TABLE_EVENTS.PLAYER_LEFT when a player leaves the table.
   * @param playerId - The ID of the player to remove.
   * @returns True if the player was removed, false if the player is not at the table.
   */
  public removePlayer(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    // Remove player from all seats
    for (let i = 0; i < this.seats.length; i++) {
      if (this.seats[i].getPlayer()?.id === playerId) {
        this.seats[i].setPlayer(null);
      }
    }

    this.players.delete(playerId);
    player.setTable(null);
    this.eventBus.emit(TABLE_EVENTS.PLAYER_LEFT, player, this);

    // Check if table is empty
    if (this.players.size === 0) {
      this.eventBus.emit(TABLE_EVENTS.EMPTY, this);
    }

    return true;
  }

  /**
   * Sits a player at a specific seat. Emits TABLE_EVENTS.PLAYER_SAT when a player sits at a seat.
   * @param playerId - The ID of the player to sit.
   * @param seatIndex - The index of the seat to sit the player at.
   * @returns True if the player was seated, false if the seat is invalid or already taken.
   */
  public sitPlayerAtSeat(playerId: string, seatIndex: number): boolean {
    // Check if seat index is valid
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return false;
    }

    // Check if seat is already taken
    if (this.seats[seatIndex].getPlayer() !== null) {
      return false;
    }

    const player = this.players.get(playerId);
    if (!player) return false;

    // Check if player is already seated at too many seats
    const playerSeats = this.getPlayerSeatCount(playerId);
    if (playerSeats >= this.maxSeatsPerPlayer) {
      return false;
    }

    this.seats[seatIndex].setPlayer(player);
    this.eventBus.emit(TABLE_EVENTS.PLAYER_SAT, player, this, seatIndex);
    return true;
  }

  /**
   * Removes a player from a seat. Emits TABLE_EVENTS.PLAYER_STOOD when a player stands up from a seat.
   * @param seatIndex - The index of the seat to remove the player from.
   * @returns True if the player was removed from the seat, false if the seat is invalid or no player is seated.
   */
  public removePlayerFromSeat(seatIndex: number): boolean {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return false;
    }

    const player = this.seats[seatIndex].getPlayer();
    if (!player) return false;

    this.seats[seatIndex].setPlayer(null);
    this.eventBus.emit(TABLE_EVENTS.PLAYER_STOOD, player, this, seatIndex);
    return true;
  }

  /**
   * Gets the number of seats a player is seated at.
   * @param playerId - The ID of the player to get the seat count for.
   * @returns The number of seats the player is seated at.
   */
  public getPlayerSeatCount(playerId: string): number {
    let count = 0;
    for (const seat of this.seats) {
      if (seat.getPlayer()?.id === playerId) {
        count++;
      }
    }
    return count;
  }

  /**
   * Gets the current state of the table.
   * @returns The current state of the table.
   */
  public getState(): TableState {
    return this.state;
  }

  /**
   * Sets the state of the table. Emits TABLE_EVENTS.STATE_UPDATED when the state is updated.
   * @param state - The new state of the table.
   */
  public setState(state: TableState): void {
    this.state = state;
    this.eventBus.emit(TABLE_EVENTS.STATE_UPDATED, this, state);
    
    // Also broadcast the full table state to all players when state enum changes
    this.broadcastTableState();
  }

  /**
   * Gets the number of players at the table.
   * @returns The number of players at the table.
   */
  public getPlayerCount(): number {
    return this.players.size;
  }

  /**
   * Gets all players at the table.
   * @returns An array of all players at the table.
   */
  public getPlayers(): Player[] {
    return Array.from(this.players.values());
  }

  /**
   * Gets a seat at a specific index.
   * @param seatIndex - The index of the seat to get.
   * @returns The seat object or null if the index is invalid.
   */
  public getSeat(seatIndex: number): Seat | null {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return null;
    }
    return this.seats[seatIndex];
  }

  /**
   * Gets all seats at the table.
   * @returns An array of all seats at the table.
   */
  public getSeats(): Seat[] {
    return [...this.seats];
  }

  /**
   * Gets the player at a specific seat.
   * @param seatIndex - The index of the seat to get the player from.
   * @returns The player object or null if the seat is invalid.
   */
  public getPlayerAtSeat(seatIndex: number): Player | null {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return null;
    }
    return this.seats[seatIndex].getPlayer();
  }

  /**
   * Broadcasts a message to all players at the table.
   * @param message - The message to broadcast.
   */
  public broadcastMessage(message: any): void {
    const players = Array.from(this.players.values());
    for (const player of players) {
      player.sendMessage(message);
    }
  }

  /**
   * Broadcasts the current table state to all players at the table.
   * This includes all game-specific state and is only meant for players at this table.
   * Broadcasts a TABLE_EVENTS.STATE_UPDATED event that can be used by other components.
   */
  public broadcastTableState(): void {
    const tableState = this.getTableState();
    this.broadcastMessage({
      type: "table:state",
      data: tableState
    });
    
    // Also emit an event that can be used by other components
    this.eventBus.emit(TABLE_EVENTS.STATE_UPDATED, this, tableState);
  }

  /**
   * Gets the complete table state including all attributes and game state.
   * This is used for players who are at the table and need full information.
   * Emits a TABLE_EVENTS.STATE_UPDATED event that can be used by other components.
   * 
   * @returns The complete table state.
   */
  public getTableState(): any {
    return {
      id: this.id,
      state: this.state,
      seats: this.seats.map(seat => ({
        player: seat.getPlayer() ? {
          id: seat.getPlayer()!.id,
          attributes: seat.getPlayer()!.getAttributes()
        } : null,
        hands: Array.from(seat.getAllHands() || new Map()).reduce((obj, [key, hand]) => {
          obj[key] = hand.getVisibleState();
          return obj;
        }, {} as Record<string, any>)
      })),
      attributes: Object.fromEntries(this.attributes.entries()),
      playerCount: this.players.size
    };
  }

  /**
   * Gets the table metadata for lobby display.
   * This includes only the essential information needed to display in the lobby.
   * 
   * @returns The table metadata.
   */
  public getTableMetadata(): any {
    return {
      id: this.id,
      state: this.state,
      seats: this.seats.map(seat => seat.getPlayer()?.id || null),
      playerCount: this.players.size,
      gameId: this.getAttribute("gameId"),
      gameName: this.getAttribute("gameName"),
      options: this.getAttribute("options")
    };
  }

  /**
   * Sets an attribute on the table. Emits TABLE_EVENTS.ATTRIBUTE_CHANGED when the attribute is updated.
   * @param key - The key of the attribute to set.
   * @param value - The value of the attribute to set.
   */
  public setAttribute(key: string, value: any): void {
    this.attributes.set(key, value);
    this.eventBus.emit(TABLE_EVENTS.ATTRIBUTE_CHANGED, this, key, value);
  }

  /**
   * Gets an attribute from the table.
   * @param key - The key of the attribute to get.
   * @returns The value of the attribute or null if the attribute does not exist.
   */
  public getAttribute(key: string): any {
    return this.attributes.get(key);
  }

  /**
   * Checks if the table has an attribute.
   * @param key - The key of the attribute to check.
   * @returns True if the attribute exists, false otherwise.
   */
  public hasAttribute(key: string): boolean {
    return this.attributes.has(key);
  }

  /**
   * Gets all attributes from the table.
   * @returns An object containing all attributes.
   */
  public getAttributes(): Record<string, any> {
    return Object.fromEntries(this.attributes.entries());
  }

  /**
   * Sets multiple attributes on the table. Emits TABLE_EVENTS.ATTRIBUTES_CHANGED when any attributes are updated.
   * @param attributes - An object containing key-value pairs of attributes to set.
   * @param broadcast - Whether to broadcast the table state after updating the attributes.
   * @returns True if any attributes were changed, false otherwise.
   */
  public setAttributes(attributes: Record<string, any>, broadcast: boolean = false): boolean {
    let shouldUpdateLobby = false;
    const metadataAttributes = ["gameId", "gameName", "options"];
    const changedKeys: string[] = [];
    
    // Set all attributes
    for (const [key, value] of Object.entries(attributes)) {
      this.attributes.set(key, value);
      changedKeys.push(key);
      
      // Check if any metadata attributes were changed
      if (metadataAttributes.includes(key)) {
        shouldUpdateLobby = true;
      }
      
      // Emit individual events for backwards compatibility
      this.eventBus.emit(TABLE_EVENTS.ATTRIBUTE_CHANGED, this, key, value);
    }
    
    // Emit a bulk event if any attributes were changed
    if (changedKeys.length > 0) {
      this.eventBus.emit(TABLE_EVENTS.ATTRIBUTES_CHANGED, this, changedKeys, attributes);
    }
    
    // Broadcast the table state if requested
    if (broadcast && changedKeys.length > 0) {
      this.broadcastTableState();
    }
    
    return shouldUpdateLobby;
  }

  /**
   * Updates the attributes of the table. Emits TABLE_EVENTS.ATTRIBUTES_CHANGED when any attributes are updated.
   * @param attributes - An object containing key-value pairs of attributes to set.
   * @returns True if any attributes were changed, false otherwise.
   */ 
  public updateAttributes(attributes: Record<string, any>): boolean {
    return this.setAttributes(attributes, true);
  }

  /**
   * Removes an attribute from the table. Emits TABLE_EVENTS.ATTRIBUTE_CHANGED when the attribute is removed.
   * @param key - The key of the attribute to remove.
   */
  public removeAttribute(key: string): void {
    this.attributes.delete(key);
    this.eventBus.emit(TABLE_EVENTS.ATTRIBUTE_CHANGED, this, key, undefined);
  }
} 