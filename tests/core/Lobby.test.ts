import { Lobby } from '../../src/core/Lobby';
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

describe('Lobby', () => {
  let gameManager: GameManager;
  let lobby: Lobby;
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
    
    // Create a new game manager and lobby
    gameManager = new GameManager(eventBus, tableFactory);
    lobby = new Lobby(eventBus, gameManager, tableFactory);
  });

  describe('Attribute Management', () => {
    test('should manage single attributes correctly', () => {
      expect(lobby.hasAttribute('theme')).toBe(false);
      
      lobby.setAttribute('theme', 'dark');
      expect(lobby.hasAttribute('theme')).toBe(true);
      expect(lobby.getAttribute('theme')).toBe('dark');
      
      lobby.setAttribute('theme', 'light');
      expect(lobby.getAttribute('theme')).toBe('light');
      
      expect(lobby.getAttribute('nonexistent')).toBeUndefined();
    });

    test('should emit ATTRIBUTE_CHANGED event when attribute is set', () => {
      const emitSpy = jest.spyOn(eventBus, 'emit');
      
      lobby.setAttribute('status', 'open');
      
      expect(emitSpy).toHaveBeenCalledWith(
        LOBBY_EVENTS.ATTRIBUTE_CHANGED,
        lobby,
        'status',
        'open'
      );
    });

    test('should not emit ATTRIBUTE_CHANGED event if notify is false', () => {
      const emitSpy = jest.spyOn(eventBus, 'emit');
      
      lobby.setAttribute('status', 'open', false);
      
      expect(emitSpy).not.toHaveBeenCalled();
    });

    test('should manage multiple attributes at once', () => {
      const attributes = {
        theme: 'dark',
        status: 'open',
        maxPlayers: 100
      };
      
      lobby.setAttributes(attributes);
      
      expect(lobby.getAttribute('theme')).toBe('dark');
      expect(lobby.getAttribute('status')).toBe('open');
      expect(lobby.getAttribute('maxPlayers')).toBe(100);
    });

    test('should emit ATTRIBUTES_CHANGED event when multiple attributes are set', () => {
      const emitSpy = jest.spyOn(eventBus, 'emit');
      
      const attributes = {
        theme: 'dark',
        status: 'open'
      };
      
      lobby.setAttributes(attributes);
      
      expect(emitSpy).toHaveBeenCalledWith(
        LOBBY_EVENTS.ATTRIBUTES_CHANGED,
        lobby,
        ['theme', 'status'],
        attributes
      );
    });

    test('should get all attributes', () => {
      lobby.setAttribute('theme', 'dark');
      lobby.setAttribute('status', 'open');
      lobby.setAttribute('maxPlayers', 100);
      
      const allAttributes = lobby.getAttributes();
      expect(allAttributes).toEqual({
        theme: 'dark',
        status: 'open',
        maxPlayers: 100
      });
    });
  });
  
  test('should broadcast lobby state on table created event', () => {
    const emitSpy = jest.spyOn(eventBus, 'emit');
    
    // Define test game
    const gameDefinition: GameDefinition = {
      id: 'test-game',
      name: 'Test Game',
      description: 'A test game',
      minPlayers: 2,
      maxPlayers: 4,
      defaultSeats: 4,
      maxSeatsPerPlayer: 1
    };
    
    // Register game
    gameManager.registerGame(gameDefinition);
    
    // Clear emit history
    emitSpy.mockClear();
    
    // Emit table created event
    eventBus.emit(TABLE_EVENTS.CREATED, mockTable);
    
    // Expect lobby state event was emitted
    expect(emitSpy).toHaveBeenCalledWith(
      LOBBY_EVENTS.UPDATED, 
      expect.objectContaining({
        games: expect.arrayContaining([gameDefinition]),
        tables: expect.arrayContaining([
          expect.objectContaining({
            id: 'mock-table-id',
            gameId: 'test-game'
          })
        ])
      })
    );
  });
  
  test('should broadcast lobby state on updateLobbyState call', () => {
    const emitSpy = jest.spyOn(eventBus, 'emit');
    
    // Call updateLobbyState
    lobby.updateLobbyState();
    
    // Expect lobby state event was emitted
    expect(emitSpy).toHaveBeenCalledWith(
      LOBBY_EVENTS.UPDATED, 
      expect.objectContaining({
        games: expect.any(Array),
        tables: expect.any(Array)
      })
    );
  });
  
  test('should broadcast lobby state on player attribute change', () => {
    // Set up test conditions
    const gameDefinition: GameDefinition = {
      id: 'test-game',
      name: 'Test Game',
      description: 'A test game',
      minPlayers: 2,
      maxPlayers: 4,
      defaultSeats: 4,
      maxSeatsPerPlayer: 1,
      lobbyRelevantPlayerAttributes: ['status']
    };
    
    gameManager.registerGame(gameDefinition);
    
    const emitSpy = jest.spyOn(eventBus, 'emit');
    emitSpy.mockClear();
    
    // Emit player attribute changed event for a relevant attribute
    eventBus.emit(PLAYER_EVENTS.ATTRIBUTE_CHANGED, mockPlayer, 'status', 'ready');
    
    // Expect lobby state event was emitted
    expect(emitSpy).toHaveBeenCalledWith(
      LOBBY_EVENTS.UPDATED, 
      expect.any(Object)
    );
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
    
    const table = lobby.createTable('test-game');
    
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
    lobby.createTable('test-game', options);
    
    expect(mockTable.setAttribute).toHaveBeenCalledWith('options', options);
  });
  
  test('should return null when creating a table for a non-existent game', () => {
    const table = lobby.createTable('non-existent-game');
    
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
    lobby.createTable('test-game');
    
    expect(setupTableMock).toHaveBeenCalledWith(mockTable);
  });
}); 