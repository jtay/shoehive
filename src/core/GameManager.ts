import { EventBus } from "../events/EventBus";
import { Table } from "./Table";
import { TableFactory } from "./TableFactory";
import { Player } from "./Player";
import { TABLE_EVENTS, PLAYER_EVENTS, LOBBY_EVENTS } from "../events/EventTypes";

export interface GameDefinition {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  defaultSeats: number;
  maxSeatsPerPlayer: number;
  options?: Record<string, any>;
  // Define which player attributes should trigger a table state update when changed
  tableRelevantPlayerAttributes?: string[];
  // Define which player attributes should trigger a lobby update when changed
  lobbyRelevantPlayerAttributes?: string[];
}

export class GameManager {
  private games: Map<string, GameDefinition> = new Map();
  private tables: Map<string, Table> = new Map();
  private tablesByGame: Map<string, Set<string>> = new Map();
  private eventBus: EventBus;
  private tableFactory: TableFactory;

  constructor(eventBus: EventBus, tableFactory: TableFactory) {
    this.eventBus = eventBus;
    this.tableFactory = tableFactory;
    this.setupEventListeners();
  }

  /**
   * Sets up event listeners for the game manager.
   * This listens for table creation, table emptying, and player attribute changes.
   */
  private setupEventListeners(): void {
    this.eventBus.on(TABLE_EVENTS.CREATED, (table: Table) => {
      this.tables.set(table.id, table);
      
      const gameId = table.getAttribute("gameId");
      if (gameId) {
        if (!this.tablesByGame.has(gameId)) {
          this.tablesByGame.set(gameId, new Set());
        }
        this.tablesByGame.get(gameId)?.add(table.id);
      }
      
      this.broadcastLobbyUpdate();
    });

    this.eventBus.on(TABLE_EVENTS.EMPTY, (table: Table) => {
      this.removeTable(table.id);
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
      const gameDefinition = this.games.get(gameId);
      if (!gameDefinition) return;
      
      // Use the game-specific lobby relevant attributes, or fall back to defaults
      const lobbyRelevantAttributes = gameDefinition.lobbyRelevantPlayerAttributes || 
        ["name", "avatar", "isReady", "status"];
      
      // Only update the lobby if the attribute is relevant to lobby display
      if (lobbyRelevantAttributes.includes(key)) {
        this.broadcastLobbyUpdate();
      }
    });
  }

  /**
   * Registers a game definition.
   * 
   * @param gameDefinition The game definition to register.
   */
  public registerGame(gameDefinition: GameDefinition): void {
    this.games.set(gameDefinition.id, gameDefinition);
    this.tablesByGame.set(gameDefinition.id, new Set());
    this.broadcastLobbyUpdate();
  }

  /**
   * Unregisters a game definition.
   * 
   * @param gameId The ID of the game to unregister.
   */
  public unregisterGame(gameId: string): void {
    this.games.delete(gameId);
    // Remove all tables for this game
    const tablesToRemove = this.tablesByGame.get(gameId) || new Set();
    tablesToRemove.forEach(tableId => this.removeTable(tableId));
    this.tablesByGame.delete(gameId);
    this.broadcastLobbyUpdate();
  }

  /**
   * Creates a new table for a game.
   * 
   * @param gameId The ID of the game.
   * @param options Optional options for the table.
   * @returns The newly created table, or null if the game definition is not found.
   */
  public createTable(gameId: string, options?: Record<string, any>): Table | null {
    const gameDefinition = this.games.get(gameId);
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

    return table;
  }

  /**
   * Removes a table from the game manager.
   * 
   * @param tableId The ID of the table to remove.
   */
  public removeTable(tableId: string): void {
    const table = this.tables.get(tableId);
    if (!table) return;

    const gameId = table.getAttribute("gameId");
    if (gameId) {
      this.tablesByGame.get(gameId)?.delete(tableId);
    }

    this.tables.delete(tableId);
    this.broadcastLobbyUpdate();
  }

  /**
   * Gets all available games.
   * 
   * @returns An array of all game definitions.
   */
  public getAvailableGames(): GameDefinition[] {
    return Array.from(this.games.values());
  }

  /**
   * Gets a game definition by its ID.
   * 
   * @param gameId The ID of the game
   * @returns The game definition, or undefined if not found
   */
  public getGameDefinition(gameId: string): GameDefinition | undefined {
    return this.games.get(gameId);
  }

  /**
   * Gets all tables for a game.
   * 
   * @param gameId The ID of the game.
   * @returns An array of tables for the game.
   */
  public getTablesForGame(gameId: string): Table[] {
    const tableIds = this.tablesByGame.get(gameId) || new Set();
    return Array.from(tableIds)
      .map(id => this.tables.get(id))
      .filter(table => table !== undefined) as Table[];
  }

  /**
   * Gets all tables in the game manager.
   * 
   * @returns An array of all tables.
   */
  public getAllTables(): Table[] {
    return Array.from(this.tables.values());
  }

  /**
   * Broadcasts a lobby update to all players.
   */
  private broadcastLobbyUpdate(): void {
    const lobbyState = {
      games: this.getAvailableGames(),
      tables: this.getAllTables().map(table => table.getTableMetadata())
    };

    this.eventBus.emit(LOBBY_EVENTS.STATE, lobbyState);
  }

  /**
   * Broadcasts a lobby update to all players.
   */
  public updateLobbyState(): void {
    this.broadcastLobbyUpdate();
  }
} 