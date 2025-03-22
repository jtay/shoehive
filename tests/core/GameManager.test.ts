import { GameManager, GameDefinition } from '../../src/core/GameManager';
import { EventBus } from '../../src/events/EventBus';
import { TableFactory } from '../../src/core/TableFactory';
import { Table } from '../../src/core/Table';
import { Player } from '../../src/core/Player';
import { PLAYER_EVENTS, TABLE_EVENTS, LOBBY_EVENTS } from '../../src/events/EventTypes';

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
    
    const emitSpy = jest.spyOn(eventBus, 'emit');
    
    gameManager.registerGame(gameDefinition);
    
    expect(emitSpy).toHaveBeenCalledWith(
      LOBBY_EVENTS.STATE, 
      expect.objectContaining({
        games: expect.arrayContaining([gameDefinition])
      })
    );
    
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
    
    const emitSpy = jest.spyOn(eventBus, 'emit');
    
    gameManager.unregisterGame('test-game');
    
    expect(emitSpy).toHaveBeenCalledWith(
      LOBBY_EVENTS.STATE, 
      expect.objectContaining({
        games: expect.not.arrayContaining([gameDefinition])
      })
    );
    
    // Verify game is unregistered
    expect(gameManager.getGameDefinition('test-game')).toBeUndefined();
  });
  
  test('should create a table for a game', () => {
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
    
    const table = gameManager.createTable('test-game');
    
    expect(tableFactory.createTable).toHaveBeenCalledWith(
      gameDefinition.defaultSeats,
      gameDefinition.maxSeatsPerPlayer
    );
    
    expect(table).not.toBeNull();
    expect(mockTable.setAttribute).toHaveBeenCalledWith('gameId', 'test-game');
    expect(mockTable.setAttribute).toHaveBeenCalledWith('gameName', 'Test Game');
  });
  
  test('should create a table with options', () => {
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
    
    const options = { startingChips: 1000 };
    gameManager.createTable('test-game', options);
    
    expect(mockTable.setAttribute).toHaveBeenCalledWith('options', options);
  });
  
  test('should return null when creating a table for a non-existent game', () => {
    const table = gameManager.createTable('non-existent-game');
    
    expect(table).toBeNull();
    expect(tableFactory.createTable).not.toHaveBeenCalled();
  });
  
  test('should call setupTable function if provided in game definition', () => {
    const setupTableMock = jest.fn();
    
    const gameDefinition: GameDefinition = {
      id: 'test-game',
      name: 'Test Game',
      description: 'A test game',
      minPlayers: 2,
      maxPlayers: 4,
      defaultSeats: 4,
      maxSeatsPerPlayer: 1,
      options: {
        setupTable: setupTableMock
      }
    };
    
    gameManager.registerGame(gameDefinition);
    gameManager.createTable('test-game');
    
    expect(setupTableMock).toHaveBeenCalledWith(mockTable);
  });
  
  test('should handle TABLE_CREATED event', () => {
    const emitSpy = jest.spyOn(eventBus, 'emit');
    
    eventBus.emit(TABLE_EVENTS.CREATED, mockTable);
    
    // Verify lobby update was broadcast
    expect(emitSpy).toHaveBeenCalledWith(
      LOBBY_EVENTS.STATE, 
      expect.objectContaining({
        tables: expect.arrayContaining([mockTable.getTableMetadata()])
      })
    );
  });
  
  test('should handle TABLE_EMPTY event', () => {
    // Add a table to the game manager through the event
    eventBus.emit(TABLE_EVENTS.CREATED, mockTable);
    
    // Clear the emit spy history
    jest.clearAllMocks();
    const emitSpy = jest.spyOn(eventBus, 'emit');
    
    // Trigger the TABLE_EMPTY event
    eventBus.emit(TABLE_EVENTS.EMPTY, mockTable);
    
    // Verify lobby update was broadcast
    expect(emitSpy).toHaveBeenCalledWith(
      LOBBY_EVENTS.STATE, 
      expect.objectContaining({
        tables: expect.not.arrayContaining([mockTable.getTableMetadata()])
      })
    );
  });
  
  test('should handle PLAYER_ATTRIBUTE_CHANGED event for lobby relevant attributes', () => {
    const gameDefinition: GameDefinition = {
      id: 'test-game',
      name: 'Test Game',
      description: 'A test game',
      minPlayers: 2,
      maxPlayers: 4,
      defaultSeats: 4,
      maxSeatsPerPlayer: 1,
      lobbyRelevantPlayerAttributes: ['name', 'status']
    };
    
    gameManager.registerGame(gameDefinition);
    
    // Clear the emit spy history
    jest.clearAllMocks();
    const emitSpy = jest.spyOn(eventBus, 'emit');
    
    // Trigger the PLAYER_ATTRIBUTE_CHANGED event with a relevant attribute
    eventBus.emit(PLAYER_EVENTS.ATTRIBUTE_CHANGED, mockPlayer, 'name', 'New Name');
    
    // Verify lobby update was broadcast
    expect(emitSpy).toHaveBeenCalledWith(
      LOBBY_EVENTS.STATE, 
      expect.any(Object)
    );
  });
  
  test('should not update lobby for non-lobby relevant attributes', () => {
    const gameDefinition: GameDefinition = {
      id: 'test-game',
      name: 'Test Game',
      description: 'A test game',
      minPlayers: 2,
      maxPlayers: 4,
      defaultSeats: 4,
      maxSeatsPerPlayer: 1,
      lobbyRelevantPlayerAttributes: ['name', 'status']
    };
    
    gameManager.registerGame(gameDefinition);
    
    // Clear the emit spy history
    jest.clearAllMocks();
    const emitSpy = jest.spyOn(eventBus, 'emit');
    
    // Trigger the PLAYER_ATTRIBUTE_CHANGED event with a non-relevant attribute
    eventBus.emit(PLAYER_EVENTS.ATTRIBUTE_CHANGED, mockPlayer, 'chips', 1000);
    
    // Verify lobby update was not broadcast
    expect(emitSpy).not.toHaveBeenCalledWith(
      LOBBY_EVENTS.STATE, 
      expect.any(Object)
    );
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
  
  test('should manually update lobby state', () => {
    const emitSpy = jest.spyOn(eventBus, 'emit');
    
    gameManager.updateLobbyState();
    
    expect(emitSpy).toHaveBeenCalledWith(
      LOBBY_EVENTS.STATE, 
      expect.any(Object)
    );
  });
}); 