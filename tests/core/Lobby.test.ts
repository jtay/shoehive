import { Lobby } from '../../src/core/Lobby';
import { GameManager, GameDefinition } from '../../src/core/GameManager';
import { EventBus } from '../../src/events/EventBus';
import { TableFactory } from '../../src/core/TableFactory';
import { Table } from '../../src/core/Table';
import { Player } from '../../src/core/Player';
import { PLAYER_EVENTS, TABLE_EVENTS, LOBBY_EVENTS } from '../../src/events/EventTypes';
import * as WebSocket from 'ws';

// Mock ws
jest.mock('ws');

describe('Lobby', () => {
  let gameManager: GameManager;
  let lobby: Lobby;
  let eventBus: EventBus;
  let tableFactory: TableFactory;
  
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

  // Test helper to create real players
  const createTestPlayer = (id: string) => {
    const mockSocket = {
      readyState: WebSocket.WebSocket.OPEN,
      send: jest.fn(),
      on: jest.fn(),
      close: jest.fn()
    } as unknown as WebSocket.WebSocket;
    
    return new Player(mockSocket, eventBus, id);
  };

  describe('Attribute Management', () => {
    test('should manage single attributes correctly', () => {
      expect(lobby.hasAttribute({ key: 'theme' })).toBe(false);
      
      lobby.setAttribute({ key: 'theme', value: 'dark' });
      expect(lobby.hasAttribute({ key: 'theme' })).toBe(true);
      expect(lobby.getAttribute({ key: 'theme' })).toBe('dark');
      
      lobby.setAttribute({ key: 'theme', value: 'light' });
      expect(lobby.getAttribute({ key: 'theme' })).toBe('light');
      
      expect(lobby.getAttribute({ key: 'nonexistent' })).toBeUndefined();
    });

    test('should emit ATTRIBUTE_CHANGED event when attribute is set', () => {
      const emitSpy = jest.spyOn(eventBus, 'emit');
      
      lobby.setAttribute({ key: 'status', value: 'open' });
      
      expect(emitSpy).toHaveBeenCalledWith(LOBBY_EVENTS.ATTRIBUTE_CHANGED, {
        table: lobby,
        key: 'status',
        value: 'open'
      });
    });

    test('should not emit ATTRIBUTE_CHANGED event if notify is false', () => {
      const emitSpy = jest.spyOn(eventBus, 'emit');
      
      lobby.setAttribute({ key: 'status', value: 'open', notify: false });
      
      expect(emitSpy).not.toHaveBeenCalled();
    });

    test('should manage multiple attributes at once', () => {
      const attributes = {
        theme: 'dark',
        status: 'open',
        maxPlayers: 100
      };
      
      lobby.setAttributes({ attributes: attributes });
      
      expect(lobby.getAttribute({ key: 'theme' })).toBe('dark');
      expect(lobby.getAttribute({ key: 'status' })).toBe('open');
      expect(lobby.getAttribute({ key: 'maxPlayers' })).toBe(100);
    });

    test('should emit ATTRIBUTES_CHANGED event when multiple attributes are set', () => {
      const emitSpy = jest.spyOn(eventBus, 'emit');
      
      const attributes = {
        theme: 'dark',
        status: 'open'
      };
      
      lobby.setAttributes({ attributes: attributes });
      
      expect(emitSpy).toHaveBeenCalledWith(LOBBY_EVENTS.ATTRIBUTES_CHANGED, {
        table: lobby,
        changedKeys: ['theme', 'status'],
        attributes
      });
    });

    test('should get all attributes', () => {
      lobby.setAttribute({ key: 'theme', value: 'dark' });
      lobby.setAttribute({ key: 'status', value: 'open' });
      lobby.setAttribute({ key: 'maxPlayers', value: 100 });
      
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
    gameManager.registerGame({ gameDefinition: gameDefinition });
    
    // Create a table
    const table = lobby.createTable({ gameId: 'test-game' })!;
    
    // Clear emit history
    emitSpy.mockClear();
    
    // Emit table created event
    eventBus.emit(TABLE_EVENTS.CREATED, { table });
    
    // Expect lobby state event was emitted
    expect(emitSpy).toHaveBeenCalledWith(
      LOBBY_EVENTS.UPDATED, 
      {
        lobbyState: expect.objectContaining({
          games: expect.arrayContaining([gameDefinition]),
          tables: expect.arrayContaining([
            expect.objectContaining({
              id: table.id,
              gameId: 'test-game'
            })
          ])
        })
      }
    );
  });
  
  test('should broadcast lobby state on updateLobbyState call', () => {
    const emitSpy = jest.spyOn(eventBus, 'emit');
    
    // Call updateLobbyState
    lobby.updateLobbyState();
    
    // Expect lobby state event was emitted
    expect(emitSpy).toHaveBeenCalledWith(
      LOBBY_EVENTS.UPDATED, 
      {
        lobbyState: expect.objectContaining({
          games: expect.any(Array),
          tables: expect.any(Array)
        })
      }
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
    
    gameManager.registerGame({ gameDefinition: gameDefinition });
    
    // Create a table and add a player to it
    const table = lobby.createTable({ gameId: 'test-game' })!;
    const player = createTestPlayer('test-player');
    table.addPlayer({ player });
    
    const emitSpy = jest.spyOn(eventBus, 'emit');
    emitSpy.mockClear();
    
    // Emit player attribute changed event
    eventBus.emit(PLAYER_EVENTS.ATTRIBUTE_CHANGED, { player, key: 'status', value: 'ready' });
    
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
    
    gameManager.registerGame({ gameDefinition: gameDefinition });
    
    const tableFactorySpy = jest.spyOn(tableFactory, 'createTable');
    const table = lobby.createTable({ gameId: 'test-game' });
    
    expect(tableFactorySpy).toHaveBeenCalledWith({
      totalSeats: gameDefinition.defaultSeats,
      maxSeatsPerPlayer: gameDefinition.maxSeatsPerPlayer,
      id: undefined,
      gameId: 'test-game',
      options: undefined
    });
    
    expect(table).not.toBeNull();
    expect(table!.getAttribute({ key: 'gameName' })).toBe('Test Game');
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
    
    gameManager.registerGame({ gameDefinition: gameDefinition });
    
    const options = { startingChips: 1000 };
    const table = lobby.createTable({ gameId: 'test-game', options: options });
    expect(table).not.toBeNull();
  });
  
  test('should return null when creating a table for a non-existent game', () => {
    const table = lobby.createTable({ gameId: 'non-existent-game' });
    
    expect(table).toBeNull();
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
    
    gameManager.registerGame({ gameDefinition: gameDefinition });
    const table = lobby.createTable({ gameId: 'test-game' });
    
    expect(setupTableMock).toHaveBeenCalledWith({ table: table });
  });
});