import { EventBus } from "../events/EventBus";
import { TABLE_EVENTS } from "../events/TableEvents";
import { Player } from "./Player";
import { Card, Deck, Hand } from "./card/index";
import { Seat } from "./Seat";
import crypto from "crypto";
import { CLIENT_MESSAGE_TYPES } from "./commands/index";

export enum TableState {
  WAITING = "waiting",
  ACTIVE = "active", 
  ENDED = "ended"
}

export interface TableOptions {
  seatCount?: number;
  [key: string]: unknown;
}

/**
 * Represents a game table with players, seats, and game state.
 * 
 * ✅ Attribute Support
 * 
 * The Table class manages a group of players and seats for a specific game.
 * It emits various events to notify other components about changes in the table state.
 * 
 * This class is responsible for:
 * - Managing player connections and disconnections
 * - Handling player messages and commands
 * - Distributing game events to all players
 * - Maintaining the game state and rules
 */
export class Table {
  public readonly id: string;
  private players: Map<string, Player> = new Map();
  private seats: Array<Seat>;
  private eventBus: EventBus;
  private state: TableState = TableState.WAITING;
  private readonly totalSeats: number;
  private readonly maxSeatsPerPlayer: number;
  private attributes: Map<string, unknown> = new Map();
  private deck: Deck | null = null;
  private gameId: string;
  private options: TableOptions;

  constructor(
    eventBus: EventBus,
    totalSeats: number,
    maxSeatsPerPlayer: number,
    id?: string,
    gameId?: string,
    options: TableOptions = {}
  ) {
    this.id = id || crypto.randomUUID();
    this.eventBus = eventBus;
    this.totalSeats = totalSeats;
    this.maxSeatsPerPlayer = maxSeatsPerPlayer;
    this.gameId = gameId || 'default';
    this.options = options;
    
    // Initialize seats with Seat objects
    this.seats = new Array(totalSeats).fill(null).map(() => new Seat());
    
    // Listen for player sit and stand request events
    this.setupEventListeners();
    
    // Set initial attributes without emitting events yet
    this.attributes.set("gameId", this.gameId);
    if (this.options && Object.keys(this.options).length > 0) {
      this.attributes.set("options", this.options);
    }
    
    // Emit table created event
    this.eventBus.emit(TABLE_EVENTS.CREATED, { table: this });
  }

  // Cached listener references for proper cleanup and memory leak prevention
  private handleSitRequest = ({ player, table, seatIndex }: { player: Player, table: Table, seatIndex: number }) => {
    if (table.id !== this.id) return;
    try {
      const success = this.sitPlayerAtSeat({ playerId: player.id, seatIndex });
      if (!success) {
        player.sendMessage({ message: { type: CLIENT_MESSAGE_TYPES.ERROR, message: "Failed to sit at seat" } });
      }
    } catch (error) {
      console.error("Error handling sit request:", error);
      player.sendMessage({
        message: {
          type: CLIENT_MESSAGE_TYPES.ERROR,
          message: "Failed to sit at seat: " + (error instanceof Error ? error.message : "unknown error")
        }
      });
    }
  };

  private handleStandRequest = ({ player, table }: { player: Player, table: Table }) => {
    if (table.id !== this.id) return;
    try {
      const success = this.standPlayerUp({ playerId: player.id });
      if (!success) {
        player.sendMessage({ message: { type: CLIENT_MESSAGE_TYPES.ERROR, message: "Failed to stand from seat" } });
      }
    } catch (error) {
      console.error("Error handling stand request:", error);
      player.sendMessage({
        message: {
          type: CLIENT_MESSAGE_TYPES.ERROR,
          message: "Failed to stand from seat: " + (error instanceof Error ? error.message : "unknown error")
        }
      });
    }
  };

  /**
   * Set up event listeners for this table
   */
  private setupEventListeners(): void {
    this.eventBus.on({ event: TABLE_EVENTS.PLAYER_SIT_REQUEST, listener: this.handleSitRequest });
    this.eventBus.on({ event: TABLE_EVENTS.PLAYER_STAND_REQUEST, listener: this.handleStandRequest });
  }

  /**
   * Destroys the table by safely unbinding all event listeners to prevent severe memory leaks.
   */
  public destroy(): void {
    this.eventBus.off({ event: TABLE_EVENTS.PLAYER_SIT_REQUEST, listener: this.handleSitRequest });
    this.eventBus.off({ event: TABLE_EVENTS.PLAYER_STAND_REQUEST, listener: this.handleStandRequest });
  }

  /*
   * Card and deck related methods
   */

  /**
   * Creates a new deck for the table. Emits TABLE_EVENTS.DECK_CREATED when the deck is created.
   * @param numberOfDecks - The number of decks to create.
   */
  public createDeck({ numberOfDecks = 1 }: { numberOfDecks?: number } = {}): void {
    this.deck = new Deck(numberOfDecks);
    this.eventBus.emit(TABLE_EVENTS.DECK_CREATED, { table: this, numberOfDecks });
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
    this.eventBus.emit(TABLE_EVENTS.DECK_SHUFFLED, { table: this });
    return true;
  }

  /**
   * Draws a card from the deck. Emits TABLE_EVENTS.DECK_CARD_DRAWN when a card is drawn.
   * @param isVisible - Whether the card should be visible to the player.
   * @returns The drawn card or null if no deck exists.
   */
  public drawCard({ isVisible = true }: { isVisible?: boolean } = {}): Card | null {
    if (!this.deck) return null;
    
    const card = this.deck.drawCard({ isVisible });
    if (card) {
      this.eventBus.emit(TABLE_EVENTS.DECK_CARD_DRAWN, { table: this, card });
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
  public dealCardToSeat({
    seatIndex, 
    isVisible = true, 
    handId = "main"
  }: {
    seatIndex: number,
    isVisible?: boolean,
    handId?: string
  }): boolean {
    if (!this.deck) return false;
    
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return false;
    }
    
    const card = this.deck.drawCard({ isVisible });
    if (!card) return false;
    
    const seat = this.getSeat({ seatIndex });
    if (!seat) return false;
    
    // Create the hand if it doesn't exist
    if (!seat.getHand({ handId })) {
      seat.addHand({ handId });
    }
    
    const hand = seat.getHand({ handId });
    if (!hand) return false;
    
    hand.addCard({ card });
    
    this.eventBus.emit(TABLE_EVENTS.CARD_DEALT, { table: this, seatIndex, card, handId });
    return true;
  }

  /**
   * Gets a hand at a specific seat.
   * @param seatIndex - The index of the seat to get the hand from.
   * @param handId - The ID of the hand to get.
   * @returns The hand object or null if no hand exists.
   */
  public getHandAtSeat({ seatIndex, handId = "main" }: { seatIndex: number, handId?: string }): Hand | null {    
    const seat = this.getSeat({ seatIndex });
    if (!seat) return null;

    return seat.getHand({ handId });
  }

  /**
   * Deals a card to a hand. Emits TABLE_EVENTS.CARD_DEALT when a card is dealt.
   * @param hand <Hand> - The hand to deal the card to.
   * @returns True if the card was dealt, false if no seat or hand exists.
   */
  public dealCardToHand({ hand }: { hand: Hand }): boolean {
    if (!this.deck) return false;

    const card = this.deck.drawCard({ isVisible: true });
    if (!card) return false;

    // Find the seat index for this hand
    let seatIndex = -1;
    for (let i = 0; i < this.seats.length; i++) {
        const seat = this.getSeat({ seatIndex: i });
        if (seat) {
            // Check all hands at this seat
            for (const [_, h] of seat.getAllHands()) {
                if (h === hand) {
                    seatIndex = i;
                    break;
                }
            }
        }
        if (seatIndex !== -1) break;
    }

    hand.addCard({ card });
    this.eventBus.emit(TABLE_EVENTS.CARD_DEALT, { table: this, seatIndex, card, handId: hand.getId() });
    return true;
  }

  /**
   * Gets all hands at a specific seat.
   * @param seatIndex - The index of the seat to get the hands from.
   * @returns A map of hand IDs to hand objects or null if no seat exists.
   */
  public getAllHandsAtSeat({ seatIndex }: { seatIndex: number }): Map<string, Hand> | null {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return null;
    }
    
    const seat = this.getSeat({ seatIndex });
    if (!seat) return null;

    return seat.getAllHands();
  }

  /**
   * Clears a hand at a specific seat. Emits TABLE_EVENTS.SEAT_HAND_CLEARED when a hand is cleared.
   * @param seatIndex - The index of the seat to clear the hand from.
   * @param handId - The ID of the hand to clear.
   * @returns True if the hand was cleared, false if no seat exists.
   */
  public clearHandAtSeat({ seatIndex, handId = "main" }: { seatIndex: number, handId?: string }): boolean {
    const seat = this.getSeat({ seatIndex });
    if (!seat) return false;
    
    const result = seat.clearHand({ handId });
    if (result) {
      this.eventBus.emit(TABLE_EVENTS.SEAT_HAND_CLEARED, { table: this, seatIndex, handId });
    }
    return result;
  }

  /**
   * Clears all hands at the table. Emits TABLE_EVENTS.SEATS_HANDS_CLEARED when all hands are cleared.
   */
  public clearAllHands(): void {
    for (let i = 0; i < this.totalSeats; i++) {
      const seat = this.getSeat({ seatIndex: i });
      if (seat) {
        seat.clearAllHands();
      }
    }
    this.eventBus.emit(TABLE_EVENTS.SEATS_HANDS_CLEARED, { table: this });
  }

  /**
   * Adds a hand to a seat. Emits TABLE_EVENTS.SEAT_HAND_ADDED when a hand is added to a seat.
   * @param seatIndex - The index of the seat to add the hand to.
   * @param handId - The ID of the hand to add.
   * @returns True if the hand was added, false if no seat exists.
   */
  public addHandToSeat({ seatIndex, handId }: { seatIndex: number, handId: string }): boolean {
    const seat = this.getSeat({ seatIndex });
    if (!seat) return false;
    
    const result = seat.addHand({ handId });
    if (result) {
      this.eventBus.emit(TABLE_EVENTS.SEAT_HAND_ADDED, { table: this, seatIndex, handId });
    }
    return result;
  }

  /**
   * Removes a hand from a seat. Emits TABLE_EVENTS.SEAT_HAND_REMOVED when a hand is removed from a seat.
   * @param seatIndex - The index of the seat to remove the hand from.
   * @param handId - The ID of the hand to remove.
   * @returns True if the hand was removed, false if no seat exists.
   */
  public removeHandFromSeat({ seatIndex, handId }: { seatIndex: number, handId: string }): boolean {
    const seat = this.getSeat({ seatIndex });
    if (!seat) return false;
    
    const result = seat.removeHand({ handId });
    if (result) {
      this.eventBus.emit(TABLE_EVENTS.SEAT_HAND_REMOVED, { table: this, seatIndex, handId });
    }
    return result;
  }

  /**
   * Adds a player to the table. Emits TABLE_EVENTS.PLAYER_JOINED when a player joins the table.
   * @param player - The player to add.
   * @returns True if the player was added, false if the player is already at a table.
   */
  public addPlayer({ player }: { player: Player }): boolean {
    // Check if player is already at a table
    if (player.getTable()) {
      return false;
    }

    this.players.set(player.id, player);
    player.setTable({ table: this });
    this.eventBus.emit(TABLE_EVENTS.PLAYER_JOINED, { player, table: this });
    return true;
  }

  /**
   * Removes a player from the table. Emits TABLE_EVENTS.PLAYER_LEFT when a player leaves the table.
   * @param playerId - The ID of the player to remove.
   * @returns True if the player was removed, false if the player is not at the table.
   */
  public removePlayer({ playerId }: { playerId: string }): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    // Remove player from all seats
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.getSeat({ seatIndex: i });
      if (seat?.getPlayer()?.id === playerId) {
        seat.setPlayer({ player: null });
      }
    }

    this.players.delete(playerId);
    player.setTable({ table: null });
    this.eventBus.emit(TABLE_EVENTS.PLAYER_LEFT, { player, table: this });

    // Check if table is empty
    if (this.players.size === 0) {
      this.eventBus.emit(TABLE_EVENTS.EMPTY, { table: this });
    }

    return true;
  }

  /**
   * Sits a player at a specific seat. Emits TABLE_EVENTS.PLAYER_SAT when a player sits at a seat.
   * @param playerId - The ID of the player to sit.
   * @param seatIndex - The index of the seat to sit the player at.
   * @returns True if the player was seated, false if the seat is invalid or already taken.
   */
  public sitPlayerAtSeat({ playerId, seatIndex }: { playerId: string, seatIndex: number }): boolean {
    const seat = this.getSeat({ seatIndex });
    if (!seat) return false;

    const player = this.players.get(playerId);
    if (!player) return false;

    if (player) {
        if(this.getPlayerAtSeat({ seatIndex })) return false;
    }

    // Check if player is already seated at too many seats
    const playerSeats = this.getPlayerSeatCount({ playerId });
    if (playerSeats >= this.maxSeatsPerPlayer) {
      return false;
    }

    seat.setPlayer({ player });
    this.eventBus.emit(TABLE_EVENTS.PLAYER_SAT, { player, table: this, seatIndex });
    return true;
  }

  /**
   * Removes a player from a seat. Emits TABLE_EVENTS.PLAYER_STOOD when a player stands up from a seat.
   * @param seatIndex - The index of the seat to remove the player from.
   * @returns True if the player was removed from the seat, false if the seat is invalid or no player is seated.
   */
  public removePlayerFromSeat({ seatIndex }: { seatIndex: number }): boolean {
    const seat = this.getSeat({ seatIndex });
    if (!seat) return false;

    const player = seat.getPlayer();
    if (!player) return false;

    seat.setPlayer({ player: null });
    this.eventBus.emit(TABLE_EVENTS.PLAYER_STOOD, { player, table: this, seatIndex });
    return true;
  }

  /**
   * Gets the number of seats a player is seated at.
   * @param playerId - The ID of the player to get the seat count for.
   * @returns The number of seats the player is seated at.
   */
  public getPlayerSeatCount({ playerId }: { playerId: string }): number {
    let count = 0;
    for (const seat of this.seats) {
      // Skip null or undefined seats
      if (!seat) continue;
      
      try {
        const player = seat.getPlayer();
        if (player && player.id === playerId) {
          count++;
        }
      } catch (error) {
        console.error(`Error checking player in seat: ${error}`);
        // Continue with the loop even if one seat has an error
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
  public setState({ state }: { state: TableState }): void {
    this.state = state;
    this.eventBus.emit(TABLE_EVENTS.STATE_UPDATED, { table: this, state });
    
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
  public getSeat({ seatIndex }: { seatIndex: number }): Seat | null {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return null;
    }

    // Ensure seat exists at this index
    if(!this.seats[seatIndex] || typeof this.seats[seatIndex] !== 'object') {
      this.seats[seatIndex] = new Seat();
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
  public getPlayerAtSeat({ seatIndex }: { seatIndex: number }): Player | null {
    const seat = this.getSeat({ seatIndex });
    if (!seat?.getPlayer()) return null;

    return seat.getPlayer();
  }

  /**
   * Broadcasts a message to all players at the table.
   * @param message - The message to broadcast.
   */
  public broadcastMessage({ message }: { message: unknown }): void {
    const players = Array.from(this.players.values());
    for (const player of players) {
      player.sendMessage({ message });
    }
  }

  /**
   * Broadcasts the current table state to all players at the table.
   * This includes all game-specific state and is only meant for players at this table.
   * Broadcasts a TABLE_EVENTS.STATE_UPDATED event that can be used by other components.
   */
  public broadcastTableState(): void {
    // Generate specialized payloads dynamically so players can view their own proprietary hands
    for (const player of this.players.values()) {
      const personalTableState = this.getTableState({ playerId: player.id });
      player.sendMessage({
        message: {
          type: CLIENT_MESSAGE_TYPES.TABLE.STATE,
          data: personalTableState
        }
      });
    }

    // Emit a generic visibility state that can be used by other non-player components
    const generalTableState = this.getTableState();
    this.eventBus.emit(TABLE_EVENTS.STATE_UPDATED, { table: this, state: generalTableState });
  }

  /**
   * Gets the complete table state including all attributes and game state.
   * Modifies output arrays to reveal hidden cards strictly to their seated owner.
   * 
   * @param playerId An optional playerId. If matched against a seat owner, returns proprietary hidden cards.
   * @returns The localized complete table state.
   */
  public getTableState({ playerId }: { playerId?: string } = {}): unknown {
    return {
      id: this.id,
      state: this.state,
      seats: this.seats.map(seat => ({
        player: seat.getPlayer() ? {
          id: seat.getPlayer()!.id,
          attributes: seat.getPlayer()!.getAttributes()
        } : null,
        hands: Array.from(seat.getAllHands() || new Map()).reduce((obj, [key, hand]) => {
          // If the requester owns the seat, map full visibility array
          if (playerId && seat.getPlayer()?.id === playerId) {
            obj[key] = hand.getFullState();
          } else {
            obj[key] = hand.getVisibleState();
          }
          return obj;
        }, {} as Record<string, unknown>)
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
  public getTableMetadata(): unknown {
    return {
      id: this.id,
      state: this.state,
      seats: this.seats.map(seat => seat.getPlayer()?.id || null),
      playerCount: this.players.size,
      gameId: this.getAttribute({ key: "gameId" }),
      gameName: this.getAttribute({ key: "gameName" }),
      options: this.getAttribute({ key: "options" })
    };
  }

  /**
   * Sets an attribute on the table. Emits TABLE_EVENTS.ATTRIBUTE_CHANGED when the attribute is updated.
   * @param key - The key of the attribute to set.
   * @param value - The value of the attribute to set.
   */
  public setAttribute({ key, value }: { key: string, value: unknown }): void {
    this.setAttributes({ attributes: { [key]: value } });
  }

  /**
   * Gets an attribute from the table.
   * @param key - The key of the attribute to get.
   * @returns The value of the attribute or null if the attribute does not exist.
   */
  public getAttribute({ key }: { key: string }): unknown {
    return this.attributes.get(key);
  }

  /**
   * Checks if the table has an attribute.
   * @param key - The key of the attribute to check.
   * @returns True if the attribute exists, false otherwise.
   */
  public hasAttribute({ key }: { key: string }): boolean {
    return this.attributes.has(key);
  }

  /**
   * Gets all attributes from the table.
   * @returns An object containing all attributes.
   */
  public getAttributes(): Record<string, unknown> {
    return Object.fromEntries(this.attributes.entries());
  }

  /**
   * Sets multiple attributes on the table. Emits TABLE_EVENTS.ATTRIBUTES_CHANGED when any attributes are updated.
   * @param attributes - An object containing key-value pairs of attributes to set.
   * @param broadcast - Whether to broadcast the table state after updating the attributes.
   * @returns True if any attributes were changed, false otherwise.
   */
  public setAttributes({ attributes, broadcast = false }: { attributes: Record<string, unknown>, broadcast?: boolean }): boolean {
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
      this.eventBus.emit(TABLE_EVENTS.ATTRIBUTE_CHANGED, { table: this, key, value });
    }
    
    // Emit a bulk event if any attributes were changed
    if (changedKeys.length > 0) {
      this.eventBus.emit(TABLE_EVENTS.ATTRIBUTES_CHANGED, { table: this, changedKeys, attributes });
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
  public updateAttributes({ attributes }: { attributes: Record<string, unknown> }): boolean {
    return this.setAttributes({ attributes, broadcast: true });
  }

  /**
   * Removes an attribute from the table. Emits TABLE_EVENTS.ATTRIBUTE_CHANGED when the attribute is removed.
   * @param key - The key of the attribute to remove.
   */
  public removeAttribute({ key }: { key: string }): void {
    this.attributes.delete(key);
    this.eventBus.emit(TABLE_EVENTS.ATTRIBUTE_CHANGED, { table: this, key, value: undefined });
  }

  /**
   * Makes a player stand up from all seats they occupy.
   * @param playerId - The ID of the player to stand up.
   * @returns True if the player was removed from at least one seat, false otherwise.
   */
  public standPlayerUp({ playerId }: { playerId: string }): boolean {
    let success = false;
    
    // Find all seats the player is sitting at
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.getSeat({ seatIndex: i });
      if (!seat) continue;

      const player = seat.getPlayer();
      
      if (player && player.id === playerId) {
        // Remove player from this seat
        if (this.removePlayerFromSeat({ seatIndex: i })) {
          success = true;
        }
      }
    }
    
    return success;
  }
} 