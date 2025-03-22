import { GameManager, GameDefinition } from '../../src/core/GameManager';
import { EventBus } from '../../src/events/EventBus';
import { TableFactory } from '../../src/core/TableFactory';
import { Table } from '../../src/core/Table';
import { Player } from '../../src/core/Player';
import { TABLE_EVENTS } from '../../src/events/EventTypes';
import { Lobby } from '../../src/core/Lobby';

// Mock the Table class
jest.mock('../../src/core/Table', () => {
  return {
    Table: jest.fn().mockImplementation(() => ({
      id: 'mock-table-id',
      setAttribute: jest.fn(),
      getAttribute: jest.fn().mockImplementation((key) => {
        if (key === 'gameId') return 'test-game';
        return null;
      }),
      getTableMetadata: jest.fn().mockReturnValue({
        id: 'mock-table-id',
        gameId: 'test-game'
      })
    }))
  };
});

describe('GameManager', () => {
  let gameManager: GameManager;
  let eventBus: EventBus;
  let tableFactory: TableFactory;
  let mockTable: jest.Mocked<Table>;
  let mockPlayer: jest.Mocked<Player>;
  let lobby: Lobby;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create a new event bus
    eventBus = new EventBus();
    
    // Create a mocked table factory
    tableFactory = {
      createTable: jest.fn().mockImplementation(() => {
        return mockTable;
      })
    } as unknown as TableFactory;
    
    // Create a mock table
    mockTable = new Table(eventBus, 4, 1, 'mock-table-id') as unknown as jest.Mocked<Table>;
    
    // Create a mock player
    mockPlayer = {
      id: 'mock-player-id',
      getTable: jest.fn().mockReturnValue(mockTable)
    } as unknown as jest.Mocked<Player>;
    
    // Create a new game manager
    gameManager = new GameManager(eventBus, tableFactory);
    
    // Create a new lobby instance for the tests that need it
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
    
    gameManager.registerGame(gameDefinition);
    
    // Verify game is registered by getting it back
    expect(gameManager.getGameDefinition('test-game')).toEqual(gameDefinition);
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
    
    gameManager.registerGame(gameDefinition);
    expect(gameManager.getGameDefinition('test-game')).toEqual(gameDefinition);
    
    gameManager.unregisterGame('test-game');
    
    // Verify game is unregistered
    expect(gameManager.getGameDefinition('test-game')).toBeUndefined();
  });
  
  test('should handle TABLE_CREATED event', () => {
    eventBus.emit(TABLE_EVENTS.CREATED, mockTable);
    
    // Check that the table was added to the game manager
    expect(gameManager.getAllTables()).toContain(mockTable);
  });
  
  test('should handle TABLE_EMPTY event', () => {
    // Add a table to the game manager through the event
    eventBus.emit(TABLE_EVENTS.CREATED, mockTable);
    
    // Check that it's in tables
    expect(gameManager.getAllTables()).toContain(mockTable);
    
    // Trigger the TABLE_EMPTY event
    eventBus.emit(TABLE_EVENTS.EMPTY, mockTable);
    
    // Check that the table was removed
    expect(gameManager.getAllTables()).not.toContain(mockTable);
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
    
    gameManager.registerGame(gameDefinition1);
    gameManager.registerGame(gameDefinition2);
    
    const availableGames = gameManager.getAvailableGames();
    
    expect(availableGames).toHaveLength(2);
    expect(availableGames).toEqual(expect.arrayContaining([gameDefinition1, gameDefinition2]));
  });
}); 