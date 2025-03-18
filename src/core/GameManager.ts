import { EventBus } from "../events/EventBus";
import { Table } from "./Table";
import { TableFactory } from "./TableFactory";

export interface GameDefinition {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  defaultSeats: number;
  maxSeatsPerPlayer: number;
  options?: Record<string, any>;
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

  private setupEventListeners(): void {
    this.eventBus.on("tableCreated", (table: Table) => {
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

    this.eventBus.on("tableEmpty", (table: Table) => {
      this.removeTable(table.id);
    });
  }

  public registerGame(gameDefinition: GameDefinition): void {
    this.games.set(gameDefinition.id, gameDefinition);
    this.tablesByGame.set(gameDefinition.id, new Set());
    this.broadcastLobbyUpdate();
  }

  public unregisterGame(gameId: string): void {
    this.games.delete(gameId);
    // Remove all tables for this game
    const tablesToRemove = this.tablesByGame.get(gameId) || new Set();
    tablesToRemove.forEach(tableId => this.removeTable(tableId));
    this.tablesByGame.delete(gameId);
    this.broadcastLobbyUpdate();
  }

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

  public getAvailableGames(): GameDefinition[] {
    return Array.from(this.games.values());
  }

  public getTablesForGame(gameId: string): Table[] {
    const tableIds = this.tablesByGame.get(gameId) || new Set();
    return Array.from(tableIds)
      .map(id => this.tables.get(id))
      .filter(table => table !== undefined) as Table[];
  }

  public getAllTables(): Table[] {
    return Array.from(this.tables.values());
  }

  private broadcastLobbyUpdate(): void {
    const lobbyState = {
      games: this.getAvailableGames(),
      tables: this.getAllTables().map(table => ({
        id: table.id,
        gameId: table.getAttribute("gameId"),
        playerCount: table.getPlayerCount(),
        seats: table.getSeatMap().map(player => player?.id || null),
        state: table.getState()
      }))
    };

    this.eventBus.emit("lobbyUpdated", lobbyState);
  }
} 