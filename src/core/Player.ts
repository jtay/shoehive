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

  /**
   * Set a single attribute on the player and emit an event for the change.
   * 
   * @param key The attribute name
   * @param value The attribute value
   * @param notify Whether to emit an event (defaults to true)
   */
  public setAttribute(key: string, value: any, notify: boolean = true): void {
    this.attributes.set(key, value);
    
    if (notify) {
      this.eventBus.emit(PLAYER_EVENTS.ATTRIBUTE_CHANGED, this, key, value);
    }
  }

  /**
   * Set multiple attributes at once and emit a single event.
   * This is more efficient than calling setAttribute multiple times.
   * 
   * @param attributes Object containing attribute key-value pairs
   */
  public setAttributes(attributes: Record<string, any>): void {
    const changedKeys: string[] = [];
    
    // Set all attributes first
    for (const [key, value] of Object.entries(attributes)) {
      this.attributes.set(key, value);
      changedKeys.push(key);
    }
    
    // Then emit a single event for all changes
    if (changedKeys.length > 0) {
      this.eventBus.emit(PLAYER_EVENTS.ATTRIBUTES_CHANGED, this, changedKeys, attributes);
      
      // Also emit individual events for backward compatibility
      for (const key of changedKeys) {
        this.eventBus.emit(PLAYER_EVENTS.ATTRIBUTE_CHANGED, this, key, attributes[key]);
      }
    }
  }

  /**
   * Get a single attribute from the player.
   * @param key - The key of the attribute to get
   * @returns The value of the attribute, or undefined if it doesn't exist
   */
  public getAttribute(key: string): any {
    return this.attributes.get(key);
  }

  /**
   * Get all attributes from the player.
   * @returns An object containing all player attributes
   */
  public getAttributes(): Record<string, any> {
    return Object.fromEntries(this.attributes.entries());
  }

  /**
   * Check if the player has an attribute.
   * @param key - The key of the attribute to check
   * @returns True if the attribute exists, false otherwise
   */
  public hasAttribute(key: string): boolean {
    return this.attributes.has(key);
  }

  /**
   * Disconnect the player from the server.
   */
  public disconnect(): void {
    if (this.socket.readyState === WebSocket.WebSocket.OPEN) {
      this.socket.close();
    }
  }
}