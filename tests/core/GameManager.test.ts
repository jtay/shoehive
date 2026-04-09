import { GameManager, GameDefinition } from '../../src/core/GameManager';
import { EventBus } from '../../src/events/EventBus';
import { TableFactory } from '../../src/core/TableFactory';
import { Table } from '../../src/core/Table';
import { PLAYER_EVENTS, TABLE_EVENTS } from '../../src/events/EventTypes';
import { Lobby } from '../../src/core/Lobby';
import * as WebSocket from 'ws';

// Mock ws
jest.mock('ws');

describe('GameManager', () => {
  let gameManager: GameManager;
  let eventBus: EventBus;
  let tableFactory: TableFactory;
  let lobby: Lobby;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create a new event bus
    eventBus = new EventBus();
    
    // Create actual TableFactory
    tableFactory = new TableFactory(eventBus);
    
    // Create a new game manager and lobby
    gameManager = new GameManager(eventBus, tableFactory);
    lobby = new Lobby(eventBus, gameManager, tableFactory);
  });
  
  test('should register a game definition', () => {
    const gameDefinition: GameDefinition = {
      id: 'test-game',
      name: 'Test Game',
      description: 'A test game',
      minPlayers: 2,
      maxPlayers: 4,
      defaultSeats: 4,
      maxSeatsPerPlayer: 1
    };
    
    gameManager.registerGame({ gameDefinition: gameDefinition });
    
    // Verify game is registered by getting it back
    expect(gameManager.getGameDefinition({ gameId: 'test-game' })).toEqual(gameDefinition);
  });
  
  test('should unregister a game definition', () => {
    const gameDefinition: GameDefinition = {
      id: 'test-game',
      name: 'Test Game',
      description: 'A test game',
      minPlayers: 2,
      maxPlayers: 4,
      defaultSeats: 4,
      maxSeatsPerPlayer: 1
    };
    
    gameManager.registerGame({ gameDefinition: gameDefinition });
    expect(gameManager.getGameDefinition({ gameId: 'test-game' })).toEqual(gameDefinition);
    
    gameManager.unregisterGame({ gameId: 'test-game' });
    
    // Verify game is unregistered
    expect(gameManager.getGameDefinition({ gameId: 'test-game' })).toBeUndefined();
  });
  
  test('should handle TABLE_CREATED event', () => {
    const table = new Table(eventBus, 4, 1, 'mock-table-id');
    eventBus.emit(TABLE_EVENTS.CREATED, { table });
    
    // Check that the table was added to the game manager
    expect(gameManager.getAllTables()).toContain(table);
  });
  
  test('should handle TABLE_EMPTY event', () => {
    const table = new Table(eventBus, 4, 1, 'mock-table-id');
    
    // Add a table to the game manager through the event
    eventBus.emit(TABLE_EVENTS.CREATED, { table });
    
    // Check that it's in tables
    expect(gameManager.getAllTables()).toContain(table);
    
    // Trigger the TABLE_EMPTY event
    eventBus.emit(TABLE_EVENTS.EMPTY, { table });
    
    // Check that the table was removed
    expect(gameManager.getAllTables()).not.toContain(table);
  });
  
  test('should get available games', () => {
    const gameDefinition1: GameDefinition = {
      id: 'test-game-1',
      name: 'Test Game 1',
      description: 'A test game',
      minPlayers: 2,
      maxPlayers: 4,
      defaultSeats: 4,
      maxSeatsPerPlayer: 1
    };
    
    const gameDefinition2: GameDefinition = {
      id: 'test-game-2',
      name: 'Test Game 2',
      description: 'Another test game',
      minPlayers: 2,
      maxPlayers: 6,
      defaultSeats: 6,
      maxSeatsPerPlayer: 1
    };
    
    gameManager.registerGame({ gameDefinition: gameDefinition1 });
    gameManager.registerGame({ gameDefinition: gameDefinition2 });
    
    const availableGames = gameManager.getAvailableGames();
    
    expect(availableGames).toHaveLength(2);
    expect(availableGames).toEqual(expect.arrayContaining([gameDefinition1, gameDefinition2]));
  });
});