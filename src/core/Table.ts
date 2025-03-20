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

  // Card and deck related methods
  public createDeck(numberOfDecks: number = 1): void {
    this.deck = new Deck(numberOfDecks);
    this.eventBus.emit(TABLE_EVENTS.DECK_CREATED, this, numberOfDecks);
  }

  public getDeck(): Deck | null {
    return this.deck;
  }

  public shuffleDeck(): boolean {
    if (!this.deck) return false;
    
    this.deck.shuffle();
    this.eventBus.emit(TABLE_EVENTS.DECK_SHUFFLED, this);
    return true;
  }

  public drawCard(isVisible: boolean = true): Card | null {
    if (!this.deck) return null;
    
    const card = this.deck.drawCard(isVisible);
    if (card) {
      this.eventBus.emit(TABLE_EVENTS.DECK_CARD_DRAWN, this, card);
    }
    return card;
  }

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

  public getHandAtSeat(seatIndex: number, handId: string = "main"): Hand | null {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return null;
    }
    
    return this.seats[seatIndex].getHand(handId);
  }

  public getAllHandsAtSeat(seatIndex: number): Map<string, Hand> | null {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return null;
    }
    
    return this.seats[seatIndex].getAllHands();
  }

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

  public clearAllHands(): void {
    for (let i = 0; i < this.totalSeats; i++) {
      this.seats[i].clearAllHands();
    }
    this.eventBus.emit(TABLE_EVENTS.SEATS_HANDS_CLEARED, this);
  }

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

  public getPlayerSeatCount(playerId: string): number {
    let count = 0;
    for (const seat of this.seats) {
      if (seat.getPlayer()?.id === playerId) {
        count++;
      }
    }
    return count;
  }

  public getState(): TableState {
    return this.state;
  }

  public setState(state: TableState): void {
    this.state = state;
    this.eventBus.emit(TABLE_EVENTS.STATE_CHANGED, this, state);
  }

  public getPlayerCount(): number {
    return this.players.size;
  }

  public getPlayers(): Player[] {
    return Array.from(this.players.values());
  }

  public getSeat(seatIndex: number): Seat | null {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return null;
    }
    return this.seats[seatIndex];
  }
  
  public getSeats(): Seat[] {
    return [...this.seats];
  }

  public getPlayerAtSeat(seatIndex: number): Player | null {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return null;
    }
    return this.seats[seatIndex].getPlayer();
  }

  public broadcastMessage(message: any): void {
    const players = Array.from(this.players.values());
    for (const player of players) {
      player.sendMessage(message);
    }
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