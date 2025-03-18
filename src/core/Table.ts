import { EventBus } from "../events/EventBus";
import { Player } from "./Player";
import { v4 as uuidv4 } from "uuid";

export enum TableState {
  WAITING = "waiting",
  ACTIVE = "active",
  ENDED = "ended"
}

export class Table {
  public readonly id: string;
  private players: Map<string, Player> = new Map();
  private seats: Array<Player | null>;
  private eventBus: EventBus;
  private state: TableState = TableState.WAITING;
  private readonly totalSeats: number;
  private readonly maxSeatsPerPlayer: number;
  private attributes: Map<string, any> = new Map();

  constructor(
    eventBus: EventBus,
    totalSeats: number,
    maxSeatsPerPlayer: number,
    id?: string
  ) {
    this.id = id || uuidv4();
    this.eventBus = eventBus;
    this.totalSeats = totalSeats;
    this.maxSeatsPerPlayer = maxSeatsPerPlayer;
    this.seats = new Array(totalSeats).fill(null);
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
      if (this.seats[i] === player) {
        this.seats[i] = null;
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
    if (this.seats[seatIndex] !== null) {
      return false;
    }

    const player = this.players.get(playerId);
    if (!player) return false;

    // Check if player is already seated at too many seats
    const playerSeats = this.getPlayerSeatCount(playerId);
    if (playerSeats >= this.maxSeatsPerPlayer) {
      return false;
    }

    this.seats[seatIndex] = player;
    this.eventBus.emit("playerSeated", player, this, seatIndex);
    return true;
  }

  public removePlayerFromSeat(seatIndex: number): boolean {
    if (seatIndex < 0 || seatIndex >= this.totalSeats) {
      return false;
    }

    const player = this.seats[seatIndex];
    if (!player) return false;

    this.seats[seatIndex] = null;
    this.eventBus.emit("playerUnseated", player, this, seatIndex);
    return true;
  }

  public getPlayerSeatCount(playerId: string): number {
    let count = 0;
    for (const player of this.seats) {
      if (player && player.id === playerId) {
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

  public getSeatMap(): (Player | null)[] {
    return [...this.seats];
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