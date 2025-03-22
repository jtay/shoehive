import { EventBus } from "../events/EventBus";
import { LOBBY_EVENTS, PLAYER_EVENTS, TABLE_EVENTS } from "../events/EventTypes";
import { GameManager } from "./GameManager";
import { Player } from "./Player";
import { Table } from "./Table";
import { TableFactory } from "./TableFactory";

/**
 * ✅ Attribute Support
 * 
 * The Lobby class manages the lobby state and broadcasts updates to connected players.
 * It is responsible for tracking available games and tables, and notifying players
 * when these change.
 */
export class Lobby {
  private eventBus: EventBus;
  private gameManager: GameManager;
  private tableFactory: TableFactory;
  private attributes: Map<string, any>;

  constructor(eventBus: EventBus, gameManager: GameManager, tableFactory: TableFactory) {
    this.eventBus = eventBus;
    this.gameManager = gameManager;
    this.tableFactory = tableFactory;
    this.setupEventListeners();
    this.attributes = new Map();
  }

  /**
   * Sets up event listeners for lobby-related events.
   * This listens for table creation, table emptying, and player attribute changes
   * that would affect lobby display.
   */
  private setupEventListeners(): void {
    this.eventBus.on(TABLE_EVENTS.CREATED, () => {
      this.broadcastLobbyUpdate();
    });

    this.eventBus.on(TABLE_EVENTS.EMPTY, () => {
      this.broadcastLobbyUpdate();
    });
    
    // Listen for player attribute changes that might affect lobby data
    this.eventBus.on(PLAYER_EVENTS.ATTRIBUTE_CHANGED, (player: Player, key: string, value: any) => {
      // If the player is at a table and the attribute might affect lobby display
      const table = player.getTable();
      if (!table) return;
      
      // Get the game ID for this table
      const gameId = table.getAttribute("gameId");
      if (!gameId) return;
      
      // Get the game definition
      const gameDefinition = this.gameManager.getGameDefinition(gameId);
      if (!gameDefinition) return;
      
      // Use the game-specific lobby relevant attributes, or fall back to defaults
      const lobbyRelevantAttributes = gameDefinition.lobbyRelevantPlayerAttributes || 
        ["name", "avatar", "isReady", "status"];
      
      // Only update the lobby if the attribute is relevant to lobby display
      if (lobbyRelevantAttributes.includes(key)) {
        this.broadcastLobbyUpdate();
      }
    });

    // Listen for table attribute changes that might affect lobby display
    this.eventBus.on(TABLE_EVENTS.ATTRIBUTE_CHANGED, () => {
      this.broadcastLobbyUpdate();
    });
  }

  /**
   * Creates a new table for a game.
   * 
   * @param gameId The ID of the game.
   * @param options Optional options for the table.
   * @returns The newly created table, or null if the game definition is not found.
   */
  public createTable(gameId: string, options?: Record<string, any>): Table | null {
    const gameDefinition = this.gameManager.getGameDefinition(gameId);
    if (!gameDefinition) return null;

    const table = this.tableFactory.createTable(
      gameDefinition.defaultSeats,
      gameDefinition.maxSeatsPerPlayer
    );
    
    table.setAttribute("gameId", gameId);
    table.setAttribute("gameName", gameDefinition.name);
    if (options) {
      table.setAttribute("options", options);
    }

    // Call the setupTable function if provided in game definition options
    if (gameDefinition.options?.setupTable && typeof gameDefinition.options.setupTable === 'function') {
      gameDefinition.options.setupTable(table);
    }

    return table;
  }

  /**
   * Broadcasts a lobby update to all players.
   */
  private broadcastLobbyUpdate(): void {
    const lobbyState = {
      games: this.gameManager.getAvailableGames(),
      tables: this.gameManager.getAllTables().map(table => table.getTableMetadata())
    };

    this.eventBus.emit(LOBBY_EVENTS.UPDATED, lobbyState);
  }

  /**
   * Broadcasts a lobby update to all players.
   * This method can be called externally to force a lobby update.
   */
  public updateLobbyState(): void {
    this.broadcastLobbyUpdate();
  }

  /**
   * Set a single attribute on the lobby and emit an event for the change.
   * 
   * @param key The attribute name
   * @param value The attribute value
   * @param notify Whether to emit an event (defaults to true)
   */
  public setAttribute(key: string, value: any, notify: boolean = true): void {
    this.attributes.set(key, value);
    
    if (notify) {
      this.eventBus.emit(LOBBY_EVENTS.ATTRIBUTE_CHANGED, this, key, value);
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
      this.eventBus.emit(LOBBY_EVENTS.ATTRIBUTES_CHANGED, this, changedKeys, attributes);
      
      // Also emit individual events for backward compatibility
      for (const key of changedKeys) {
        this.eventBus.emit(LOBBY_EVENTS.ATTRIBUTE_CHANGED, this, key, attributes[key]);
      }
    }
  }

  /**
   * Get a single attribute from the lobby.
   * @param key - The key of the attribute to get
   * @returns The value of the attribute, or undefined if it doesn't exist
   */
  public getAttribute(key: string): any {
    return this.attributes.get(key);
  }

  /**
   * Get all attributes from the lobby.
   * @returns An object containing all lobby attributes
   */
  public getAttributes(): Record<string, any> {
    return Object.fromEntries(this.attributes.entries());
  }

  /**
   * Check if the lobby has an attribute.
   * @param key - The key of the attribute to check
   * @returns True if the attribute exists, false otherwise
   */
  public hasAttribute(key: string): boolean {
    return this.attributes.has(key);
  }

} 