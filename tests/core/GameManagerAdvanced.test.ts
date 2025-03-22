import { GameManager, GameDefinition } from '../../src/core/GameManager';
import { EventBus } from '../../src/events/EventBus';
import { TableFactory } from '../../src/core/TableFactory';
import { Table, TableState } from '../../src/core/Table';
import { Player } from '../../src/core/Player';
import { PLAYER_EVENTS, TABLE_EVENTS } from '../../src/events/EventTypes';
import * as WebSocket from 'ws';
import { Lobby } from '../../src/core/Lobby';

jest.mock('ws');

describe('Advanced GameManager Tests', () => {
  let gameManager: GameManager;
  let eventBus: EventBus;
  let tableFactory: TableFactory;
  let lobby: Lobby;
  let tables: Table[] = [];
  
  beforeEach(() => {
    // Create a new event bus
    eventBus = new EventBus();
    
    // Create actual TableFactory and tables to test more complex interactions
    tableFactory = new TableFactory(eventBus);
    
    // Create a new game manager and lobby
    gameManager = new GameManager(eventBus, tableFactory);
    lobby = new Lobby(eventBus, gameManager, tableFactory);
    
    tables = []; // Reset tables array
  });
  
  // Test helper to create mock players
  const createMockPlayer = (id: string) => {
    const mockSocket = {
      readyState: WebSocket.WebSocket.OPEN,
      send: jest.fn(),
      on: jest.fn(),
      close: jest.fn()
    } as unknown as WebSocket.WebSocket;
    
    return new Player(mockSocket, eventBus, id);
  };
  
  // Test helper to register a game
  const registerTestGame = (
    id: string = 'test-game',
    name: string = 'Test Game',
    customAttributes: string[] = []
  ): GameDefinition => {
    const gameDefinition: GameDefinition = {
      id,
      name,
      description: 'A test game',
      minPlayers: 2,
      maxPlayers: 4,
      defaultSeats: 4,
      maxSeatsPerPlayer: 1,
      tableRelevantPlayerAttributes: ['status', 'ready', ...customAttributes],
      lobbyRelevantPlayerAttributes: ['name', 'avatar', ...customAttributes]
    };
    
    gameManager.registerGame(gameDefinition);
    return gameDefinition;
  };
  
  test('should create multiple tables for the same game', () => {
    const gameDefinition = registerTestGame();
    
    // Create multiple tables for the same game
    const table1 = lobby.createTable('test-game');
    const table2 = lobby.createTable('test-game');
    const table3 = lobby.createTable('test-game');
    
    expect(table1).not.toBeNull();
    expect(table2).not.toBeNull();
    expect(table3).not.toBeNull();
    
    // Manually trigger TABLE_CREATED event since our test isn't emitting it
    eventBus.emit(TABLE_EVENTS.CREATED, table1!);
    eventBus.emit(TABLE_EVENTS.CREATED, table2!);
    eventBus.emit(TABLE_EVENTS.CREATED, table3!);
    
    // Check that we can get all tables for the game
    const tablesForGame = gameManager.getTablesForGame('test-game');
    expect(tablesForGame.length).toBe(3);
    
    // Check that we can get all tables in general
    const allTables = gameManager.getAllTables();
    expect(allTables.length).toBe(3);
  });
  
  test('should remove tables when they become empty', () => {
    const gameDefinition = registerTestGame();
    
    // Create a table
    const table = lobby.createTable('test-game')!;
    expect(table).not.toBeNull();
    
    // Manually trigger TABLE_CREATED event
    eventBus.emit(TABLE_EVENTS.CREATED, table);
    
    // Check that it's in the list of tables
    let tablesForGame = gameManager.getTablesForGame('test-game');
    expect(tablesForGame.length).toBe(1);
    
    // Trigger the TABLE_EMPTY event
    eventBus.emit(TABLE_EVENTS.EMPTY, table);
    
    // Check that the table was removed
    tablesForGame = gameManager.getTablesForGame('test-game');
    expect(tablesForGame.length).toBe(0);
  });
  
  test('should handle non-existent game when getting tables', () => {
    const tablesForNonExistentGame = gameManager.getTablesForGame('non-existent-game');
    expect(tablesForNonExistentGame).toEqual([]);
  });
  
  test('should explicitly remove a table', () => {
    const gameDefinition = registerTestGame();
    
    // Create a table
    const table = lobby.createTable('test-game')!;
    expect(table).not.toBeNull();
    
    // Manually trigger TABLE_CREATED event
    eventBus.emit(TABLE_EVENTS.CREATED, table);
    
    // Check that it's in the list of tables
    let tablesForGame = gameManager.getTablesForGame('test-game');
    expect(tablesForGame.length).toBe(1);
    
    // Remove the table explicitly
    gameManager.removeTable(table.id);
    
    // Check that the table was removed
    tablesForGame = gameManager.getTablesForGame('test-game');
    expect(tablesForGame.length).toBe(0);
  });
  
  test('should track tables correctly when games are unregistered', () => {
    const game1 = registerTestGame('game-1', 'Game 1');
    const game2 = registerTestGame('game-2', 'Game 2');
    
    // Create tables for both games
    const table1 = lobby.createTable('game-1')!;
    const table2 = lobby.createTable('game-1')!;
    const table3 = lobby.createTable('game-2')!;
    
    // Manually trigger TABLE_CREATED events
    eventBus.emit(TABLE_EVENTS.CREATED, table1);
    eventBus.emit(TABLE_EVENTS.CREATED, table2);
    eventBus.emit(TABLE_EVENTS.CREATED, table3);
    
    // Verify tables are tracked properly
    expect(gameManager.getTablesForGame('game-1').length).toBe(2);
    expect(gameManager.getTablesForGame('game-2').length).toBe(1);
    
    // Unregister game-1
    gameManager.unregisterGame('game-1');
    
    // Verify game-1 is no longer tracked
    expect(gameManager.getGameDefinition('game-1')).toBeUndefined();
    
    // Tables for game-1 should be removed
    expect(gameManager.getTablesForGame('game-1').length).toBe(0);
    
    // Tables for game-2 should be unaffected
    expect(gameManager.getTablesForGame('game-2').length).toBe(1);
    
    // Only game-2 tables should remain in getAllTables
    const allTables = gameManager.getAllTables();
    expect(allTables.length).toBe(1);
  });
}); 