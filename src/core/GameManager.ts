import { EventBus } from "../events/EventBus";
import { Table } from "./Table";
import { TableFactory } from "./TableFactory";
import { TABLE_EVENTS } from "../events/EventTypes";

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
   * This listens for table creation and table emptying.
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
    });

    this.eventBus.on(TABLE_EVENTS.EMPTY, (table: Table) => {
      this.removeTable(table.id);
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
   * Gets a table by its ID.
   * 
   * @param tableId The ID of the table.
   * @returns The table, or undefined if not found.
   */
  public getTableById(tableId: string): Table | undefined {
    return this.tables.get(tableId);
  }

  /**
   * Gets all tables in the game manager.
   * 
   * @returns An array of all tables.
   */
  public getAllTables(): Table[] {
    return Array.from(this.tables.values());
  }
} 