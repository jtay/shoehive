import { EventBus } from "../events/EventBus";
import { Player } from "./Player";
import { Card, Deck, Hand } from "./Card";
import crypto from "crypto";

export enum TableState {
  WAITING = "waiting",
  ACTIVE = "active",
  ENDED = "ended"
}

export interface SeatData {
  player: Player | null;
  hands: Map<string, Hand>;
}

export class Table {
  public readonly id: string;
  private players: Map<string, Player> = new Map();
  private seats: Array<SeatData>;
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
    
    // Initialize seats with empty SeatData objects
    this.seats = new Array(totalSeats).fill(null).map(() => ({
      player: null,
      hands: new Map<string, Hand>([["main", new Hand("main")]])
    }));
  }

  // Card and deck related methods
  public createDeck(numberOfDecks: number = 1): void {
    this.deck = new Deck(numberOfDecks);
    this.eventBus.emit("deckCreated", this, numberOfDecks);
  }

  public getDeck(): Deck | null {
    return this.deck;
  }

  public shuffleDeck(): boolean {
    if (!this.deck) return false;
    
    this.deck.shuffle();
    this.eventBus.emit("deckShuffled", this);
    return true;
  }

  public drawCard(isVisible: boolean = true): Card | null {
    if (!this.deck) return null;
    
    const card = this.deck.drawCard(isVisible);
    if (card) {
      this.eventBus.emit("cardDrawn", this, card);
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
    if (!seat.hands.has(handId)) {
      seat.hands.set(handId, new Hand(handId));
    }
    
    seat.hands.get(handId)!.addCard(card);
    
    this.eventBus.emit("cardDealt", this, seatIndex, card, handId);
    return true;
  }

  public getHandAtSeat(seatIndex: number, handId: string = "main"): Hand | null {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return null;
    }
    
    return this.seats[seatIndex].hands.get(handId) || null;
  }

  public getAllHandsAtSeat(seatIndex: number): Map<string, Hand> | null {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return null;
    }
    
    return new Map(this.seats[seatIndex].hands);
  }

  public clearHandAtSeat(seatIndex: number, handId: string = "main"): boolean {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return false;
    }
    
    const hand = this.seats[seatIndex].hands.get(handId);
    if (!hand) return false;
    
    hand.clear();
    this.eventBus.emit("handCleared", this, seatIndex, handId);
    return true;
  }

  public clearAllHands(): void {
    for (let i = 0; i < this.totalSeats; i++) {
      const hands = this.seats[i].hands;
      for (const [handId, hand] of hands) {
        hand.clear();
      }
    }
    this.eventBus.emit("allHandsCleared", this);
  }

  public addHandToSeat(seatIndex: number, handId: string): boolean {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return false;
    }
    
    if (this.seats[seatIndex].hands.has(handId)) {
      return false;
    }
    
    this.seats[seatIndex].hands.set(handId, new Hand(handId));
    this.eventBus.emit("handAdded", this, seatIndex, handId);
    return true;
  }

  public removeHandFromSeat(seatIndex: number, handId: string): boolean {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return false;
    }
    
    if (handId === "main") {
      return false; // Cannot remove the main hand
    }
    
    const result = this.seats[seatIndex].hands.delete(handId);
    if (result) {
      this.eventBus.emit("handRemoved", this, seatIndex, handId);
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
    this.eventBus.emit("playerJoinedTable", player, this);
    return true;
  }

  public removePlayer(playerId: string): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    // Remove player from all seats
    for (let i = 0; i < this.seats.length; i++) {
      if (this.seats[i].player === player) {
        this.seats[i].player = null;
      }
    }

    this.players.delete(playerId);
    player.setTable(null);
    this.eventBus.emit("playerLeftTable", player, this);

    // Check if table is empty
    if (this.players.size === 0) {
      this.eventBus.emit("tableEmpty", this);
    }

    return true;
  }

  public sitPlayerAtSeat(playerId: string, seatIndex: number): boolean {
    // Check if seat index is valid
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return false;
    }

    // Check if seat is already taken
    if (this.seats[seatIndex].player !== null) {
      return false;
    }

    const player = this.players.get(playerId);
    if (!player) return false;

    // Check if player is already seated at too many seats
    const playerSeats = this.getPlayerSeatCount(playerId);
    if (playerSeats >= this.maxSeatsPerPlayer) {
      return false;
    }

    this.seats[seatIndex].player = player;
    this.eventBus.emit("playerSeated", player, this, seatIndex);
    return true;
  }

  public removePlayerFromSeat(seatIndex: number): boolean {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return false;
    }

    const player = this.seats[seatIndex].player;
    if (!player) return false;

    this.seats[seatIndex].player = null;
    this.eventBus.emit("playerUnseated", player, this, seatIndex);
    return true;
  }

  public getPlayerSeatCount(playerId: string): number {
    let count = 0;
    for (const seat of this.seats) {
      if (seat.player && seat.player.id === playerId) {
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
    this.eventBus.emit("tableStateChanged", this, state);
  }

  public getPlayerCount(): number {
    return this.players.size;
  }

  public getPlayers(): Player[] {
    return Array.from(this.players.values());
  }

  public getSeatMap(): SeatData[] {
    return [...this.seats];
  }

  public getPlayerAtSeat(seatIndex: number): Player | null {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return null;
    }
    return this.seats[seatIndex].player;
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