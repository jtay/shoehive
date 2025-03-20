import { EventBus } from "../events/EventBus";
import { PLAYER_EVENTS } from "../events/EventTypes";
import { Table } from "./Table";
import * as WebSocket from "ws";
import crypto from "crypto";

/**
 * Represents a connected client in the game.
 * 
 * The Player class handles communication with the client and keeps track
 * of the player's current table and custom attributes.
 */
export class Player {
  public readonly id: string;
  private socket: WebSocket.WebSocket;
  private table: Table | null = null;
  private eventBus: EventBus;
  private attributes: Map<string, any> = new Map();

  constructor(socket: WebSocket.WebSocket, eventBus: EventBus, id?: string) {
    this.id = id || crypto.randomUUID();
    this.socket = socket;
    this.eventBus = eventBus;
    this.setupSocketListeners();
  }

  private setupSocketListeners(): void {
    this.socket.on("close", () => {
      this.eventBus.emit(PLAYER_EVENTS.DISCONNECTED, this);
    });

    this.socket.on("error", (error) => {
      console.error(`Socket error for player ${this.id}:`, error);
    });
  }

  public sendMessage(message: any): void {
    if (this.socket.readyState === WebSocket.WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  public setTable(table: Table | null): void {
    this.table = table;
  }

  public getTable(): Table | null {
    return this.table;
  }

  public setAttribute(key: string, value: any): void {
    this.attributes.set(key, value);
  }

  public getAttribute(key: string): any {
    return this.attributes.get(key);
  }

  public getAttributes(): Record<string, any> {
    return Object.fromEntries(this.attributes.entries());
  }

  public hasAttribute(key: string): boolean {
    return this.attributes.has(key);
  }

  public disconnect(): void {
    if (this.socket.readyState === WebSocket.WebSocket.OPEN) {
      this.socket.close();
    }
  }
}