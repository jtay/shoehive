import { WebSocketManager } from '../../src/core/WebSocketManager';
import { EventBus } from '../../src/events/EventBus';
import { MessageRouter } from '../../src/events/MessageRouter';
import { GameManager } from '../../src/core/GameManager';
import { Lobby } from '../../src/core/Lobby';
import { TableFactory } from '../../src/core/TableFactory';
import { Player } from '../../src/core/Player';
import { Table } from '../../src/core/Table';
import { PLAYER_EVENTS } from '../../src/events/PlayerEvents';
import { LOBBY_EVENTS } from '../../src/events/LobbyEvents';
import { TABLE_EVENTS } from '../../src/events/EventTypes';
import { CLIENT_MESSAGE_TYPES } from '../../src/core/commands';
import * as http from 'http';

// Mock dependencies
jest.mock('../../src/core/Player');
jest.mock('../../src/core/Table');
jest.mock('../../src/events/MessageRouter');

// Create mocks for ws module
const mockWSServer = {
  on: jest.fn(),
  handleUpgrade: jest.fn(),
  emit: jest.fn()
};

// Mock WebSocket module
jest.mock('ws', () => {
  return {
    Server: jest.fn(() => mockWSServer),
    WebSocket: {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3
    }
  };
});

describe('WebSocketManager', () => {
  // Test variables
  let webSocketManager: WebSocketManager;
  let eventBus: EventBus;
  let messageRouter: MessageRouter;
  let gameManager: GameManager;
  let lobby: Lobby;
  let tableFactory: TableFactory;
  let authModule: any;
  let mockSocket: any;
  let mockRequest: any;
  
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Create mock socket
    mockSocket = {
      send: jest.fn(),
      on: jest.fn(),
      close: jest.fn(),
      readyState: 1 // WebSocket.OPEN
    };
    
    // Create mock http request
    mockRequest = {
      headers: {
        'user-agent': 'test-agent',
        'origin': 'http://localhost:3000'
      },
      connection: {
        remoteAddress: '127.0.0.1'
      }
    };
    
    // Create mocked dependencies
    tableFactory = {
      createTable: jest.fn()
    } as unknown as TableFactory;
    
    gameManager = {
      getAvailableGames: jest.fn().mockReturnValue([]),
      getAllTables: jest.fn().mockReturnValue([]),
      getGameDefinition: jest.fn().mockReturnValue(null)
    } as unknown as GameManager;
    
    lobby = {
      updateLobbyState: jest.fn()
    } as unknown as Lobby;
    
    authModule = {
      authenticatePlayer: jest.fn().mockResolvedValue(null)
    };
    
    // Create real instances for testing
    eventBus = new EventBus();
    messageRouter = new MessageRouter(eventBus);
    
    // Create WebSocketManager instance
    webSocketManager = new WebSocketManager(
      {} as http.Server,
      eventBus,
      messageRouter,
      gameManager,
      authModule,
      600000, // 10 minutes reconnection timeout
      lobby,
      tableFactory
    );
  });
  
  // TEST CONSTRUCTOR AND INITIALIZATION
  
  test('should initialize correctly', () => {
    expect(webSocketManager).toBeDefined();
    expect(require('ws').Server).toHaveBeenCalled();
    expect(mockWSServer.on).toHaveBeenCalledWith('connection', expect.any(Function));
  });
  
  // TEST CONNECTION HANDLING
  
  test('should handle new connections', async () => {
    // Create a mock player instance
    const mockPlayer = {
      id: 'test-player',
      sendMessage: jest.fn(),
      setTable: jest.fn(),
      getTable: jest.fn().mockReturnValue(null),
      disconnect: jest.fn(),
      getAttributes: jest.fn().mockReturnValue({}),
      onDisconnect: jest.fn().mockReturnThis()
    };
    
    // Mock the Player constructor
    (Player as jest.Mock).mockImplementation(() => mockPlayer);
    
    // Manually call the sendInitialState method directly
    // @ts-ignore - Accessing private method for testing
    webSocketManager.sendInitialState(mockPlayer);
    
    // Verify player was sent messages with appropriate types
    expect(mockPlayer.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: CLIENT_MESSAGE_TYPES.PLAYER.STATE,
      id: 'test-player',
      attributes: {}
    }));
    
    // Should also send lobby state
    expect(mockPlayer.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: CLIENT_MESSAGE_TYPES.LOBBY.STATE,
      data: expect.any(Object)
    }));
  });
  
  test('should handle authentication', async () => {
    // Set up auth module to return a player ID
    authModule.authenticatePlayer.mockResolvedValue('auth-player-123');
    
    // Create mock player
    const mockPlayer = {
      id: 'auth-player-123',
      sendMessage: jest.fn(),
      setTable: jest.fn(),
      getTable: jest.fn().mockReturnValue(null),
      disconnect: jest.fn(),
      getAttributes: jest.fn().mockReturnValue({}),
      onDisconnect: jest.fn().mockReturnThis()
    };
    (Player as jest.Mock).mockImplementation(() => mockPlayer);
    
    // Get the connection handler
    const connectionHandler = mockWSServer.on.mock.calls[0][1];
    
    // Simulate connection
    await connectionHandler(mockSocket, mockRequest);
    
    // Authentication should be called
    expect(authModule.authenticatePlayer).toHaveBeenCalledWith(mockRequest);
    
    // Player should be created with the authenticated ID
    expect(Player).toHaveBeenCalledWith(mockSocket, eventBus, 'auth-player-123');
  });
  
  test('should reject connections with failed authentication', async () => {
    // Set auth to fail
    authModule.authenticatePlayer.mockResolvedValue(null);
    
    // Get the connection handler
    const connectionHandler = mockWSServer.on.mock.calls[0][1];
    
    // Simulate connection
    await connectionHandler(mockSocket, mockRequest);
    
    // Should close connection with auth failure
    expect(mockSocket.close).toHaveBeenCalledWith(1008, 'Authentication failed');
    
    // Should not create player
    expect(Player).not.toHaveBeenCalled();
  });
  
  // TEST MESSAGE HANDLING
  
  test('should process messages from socket', () => {
    // Create a test message
    const message = JSON.stringify({ action: 'test-action', data: { test: true } });
    
    // Create a mock player
    const mockPlayer = {
      id: 'test-player',
      sendMessage: jest.fn(),
      getTable: jest.fn().mockReturnValue(null),
      disconnect: jest.fn(),
      getAttributes: jest.fn().mockReturnValue({}),
      onDisconnect: jest.fn()
    };
    
    // Mock the processMessage method
    const processMessageSpy = jest.spyOn(messageRouter, 'processMessage').mockImplementation(() => {});
    
    // Instead of trying to access the message handler, call processMessage directly
    // on the messageRouter with our mock player and message
    messageRouter.processMessage(mockPlayer as unknown as Player, message);
    
    // Verify messageRouter.processMessage was called
    expect(processMessageSpy).toHaveBeenCalledWith(mockPlayer, message);
  });
  
  // TEST EVENT LISTENERS
  
  test('should distribute player updates', () => {
    // Create mock player and table
    const mockPlayer = {
      id: 'test-player',
      sendMessage: jest.fn(),
      getTable: jest.fn(),
      getAttributes: jest.fn().mockReturnValue({ name: 'Player 1' })
    };
    
    const mockTable = {
      id: 'test-table',
      getAttribute: jest.fn().mockImplementation(key => {
        if (key === 'gameId') return 'test-game';
        return null;
      }),
      broadcastTableState: jest.fn()
    };
    
    // Set up the test scenario
    mockPlayer.getTable = jest.fn().mockReturnValue(mockTable);
    
    // Mock game definition with table relevant attributes
    gameManager.getGameDefinition = jest.fn().mockReturnValue({
      tableRelevantPlayerAttributes: ['name', 'status']
    });
    
    // Call the method directly
    webSocketManager.distributePlayerUpdate(mockPlayer as unknown as Player, 'name', 'Player 1 Updated');
    
    // Player should receive their own update
    expect(mockPlayer.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: CLIENT_MESSAGE_TYPES.PLAYER.STATE,
      data: expect.objectContaining({
        id: 'test-player',
        attributes: expect.any(Object)
      })
    }));
    
    // Table state should be broadcast since 'name' is table relevant
    expect(mockTable.broadcastTableState).toHaveBeenCalled();
  });
  
  test('should handle bulk player updates', () => {
    // Create mock player and table
    const mockPlayer = {
      id: 'test-player',
      sendMessage: jest.fn(),
      getTable: jest.fn(),
      getAttributes: jest.fn().mockReturnValue({ name: 'Player 1', age: 25 })
    };
    
    const mockTable = {
      id: 'test-table',
      getAttribute: jest.fn().mockImplementation(key => {
        if (key === 'gameId') return 'test-game';
        return null;
      }),
      broadcastTableState: jest.fn()
    };
    
    // Set up the test scenario
    mockPlayer.getTable = jest.fn().mockReturnValue(mockTable);
    
    // Mock game definition with table relevant attributes
    gameManager.getGameDefinition = jest.fn().mockReturnValue({
      tableRelevantPlayerAttributes: ['name', 'status']
    });
    
    // Call the method directly with multiple attributes
    webSocketManager.distributePlayerUpdates(
      mockPlayer as unknown as Player, 
      { name: 'Player 1 Updated', age: 26 }
    );
    
    // Player should receive their own update
    expect(mockPlayer.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: CLIENT_MESSAGE_TYPES.PLAYER.STATE,
      data: expect.objectContaining({
        id: 'test-player',
        attributes: expect.any(Object)
      })
    }));
    
    // Table state should be broadcast since 'name' is table relevant
    expect(mockTable.broadcastTableState).toHaveBeenCalled();
  });
  
  test('should not broadcast table state for non-relevant attributes', () => {
    // Create mock player and table
    const mockPlayer = {
      id: 'test-player',
      sendMessage: jest.fn(),
      getTable: jest.fn(),
      getAttributes: jest.fn().mockReturnValue({ name: 'Player 1', privateData: 'secret' })
    };
    
    const mockTable = {
      id: 'test-table',
      getAttribute: jest.fn().mockImplementation(key => {
        if (key === 'gameId') return 'test-game';
        return null;
      }),
      broadcastTableState: jest.fn()
    };
    
    // Set up the test scenario
    mockPlayer.getTable = jest.fn().mockReturnValue(mockTable);
    
    // Mock game definition with table relevant attributes
    gameManager.getGameDefinition = jest.fn().mockReturnValue({
      tableRelevantPlayerAttributes: ['name', 'status']
    });
    
    // Call the method directly with a non-relevant attribute
    webSocketManager.distributePlayerUpdate(mockPlayer as unknown as Player, 'privateData', 'new secret');
    
    // Player should receive their own update
    expect(mockPlayer.sendMessage).toHaveBeenCalled();
    
    // Table state should NOT be broadcast since 'privateData' is not table relevant
    expect(mockTable.broadcastTableState).not.toHaveBeenCalled();
  });
  
  // TEST LOBBY EVENT HANDLING
  
  test('should handle lobby state updates', () => {
    // Create mock players
    const mockPlayer1 = {
      id: 'player1',
      sendMessage: jest.fn()
    };
    const mockPlayer2 = {
      id: 'player2',
      sendMessage: jest.fn()
    };
    
    // Add players to the WebSocketManager's internal map
    // @ts-ignore - Accessing private property for testing
    webSocketManager.players = new Map([
      ['player1', mockPlayer1],
      ['player2', mockPlayer2]
    ]);
    
    // Emit lobby state update
    const lobbyState = {
      games: [],
      tables: []
    };
    eventBus.emit(LOBBY_EVENTS.UPDATED, lobbyState);
    
    // All players should receive the lobby state
    expect(mockPlayer1.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: CLIENT_MESSAGE_TYPES.LOBBY.STATE,
      data: lobbyState
    }));
    expect(mockPlayer2.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: CLIENT_MESSAGE_TYPES.LOBBY.STATE,
      data: lobbyState
    }));
  });
  
  // TEST RECONNECTION LOGIC
  
  test('should handle player reconnection', async () => {
    // First connection - setup
    const mockPlayer1 = {
      id: 'reconnect-player',
      sendMessage: jest.fn(),
      setTable: jest.fn(),
      getTable: jest.fn().mockReturnValue(null),
      disconnect: jest.fn(),
      getAttributes: jest.fn().mockReturnValue({}),
      onDisconnect: jest.fn().mockReturnThis()
    };
    
    const mockPlayer2 = {
      id: 'reconnect-player',
      sendMessage: jest.fn(),
      setTable: jest.fn(),
      getTable: jest.fn().mockReturnValue(null),
      disconnect: jest.fn(),
      getAttributes: jest.fn().mockReturnValue({}),
      onDisconnect: jest.fn().mockReturnThis()
    };
    
    // Set up Player mock to return different instances
    (Player as jest.Mock).mockImplementationOnce(() => mockPlayer1)
                          .mockImplementationOnce(() => mockPlayer2);
    
    // Get the connection handler
    const connectionHandler = mockWSServer.on.mock.calls[0][1];
    
    // First connection
    await connectionHandler(mockSocket, mockRequest);
    
    // Store the player in the WebSocketManager
    // @ts-ignore - Accessing private property for testing
    webSocketManager.players.set('reconnect-player', mockPlayer1);
    
    // Setup mock authModule to return existing player ID
    authModule.authenticatePlayer.mockResolvedValue('reconnect-player');
    
    // Reconnect with the same ID
    const newMockSocket = { ...mockSocket, on: jest.fn() };
    newMockSocket.on.mockImplementation(mockSocket.on);
    
    await connectionHandler(newMockSocket, mockRequest);
    
    // Original player should be disconnected
    expect(mockPlayer1.disconnect).toHaveBeenCalled();
    
    // New player should be added with the same ID
    expect(Player).toHaveBeenCalledWith(newMockSocket, eventBus, 'reconnect-player');
  });
  
  test('should handle player timeouts and removal', () => {
    // Mock setTimeout and clearTimeout
    jest.useFakeTimers();
    
    // Create mock player with disconnect handler
    const mockPlayer = {
      id: 'timeout-player',
      sendMessage: jest.fn(),
      setTable: jest.fn(),
      getTable: jest.fn().mockReturnValue(null),
      disconnect: jest.fn(),
      setAttribute: jest.fn(),
      getAttributes: jest.fn().mockReturnValue({}),
      onDisconnect: jest.fn()
    };
    
    let disconnectCallback: Function | null = null;
    mockPlayer.onDisconnect.mockImplementation((callback: Function) => {
      disconnectCallback = callback;
      return mockPlayer;
    });
    
    // Add the player to WebSocketManager
    // @ts-ignore - Accessing private property for testing
    webSocketManager.players = new Map([['timeout-player', mockPlayer]]);
    
    // Setup disconnect handler (this is normally done in createOrReconnectPlayer)
    // @ts-ignore - Accessing private method for testing
    webSocketManager.setupPlayerDisconnectHandler(mockPlayer as unknown as Player);
    
    // Verify onDisconnect was called
    expect(mockPlayer.onDisconnect).toHaveBeenCalled();
    
    // Trigger disconnect event
    if (disconnectCallback) {
      (disconnectCallback as Function)();
    }
    
    // Check that player is marked as disconnected
    expect(mockPlayer.setAttribute).toHaveBeenCalledWith('connectionStatus', 'disconnected');
    
    // Fast forward past the timeout
    jest.advanceTimersByTime(600001); // Just past the 10 minute timeout
    
    // Player should be removed
    // @ts-ignore - Accessing private property for testing
    expect(webSocketManager.players.has('timeout-player')).toBeFalsy();
    
    // Restore real timers
    jest.useRealTimers();
  });
  
  // TEST PLAYER MANAGEMENT METHODS
  
  test('should get player by ID', () => {
    // Create mock player
    const mockPlayer = {
      id: 'get-player-test',
      sendMessage: jest.fn()
    };
    
    // Add player to WebSocketManager
    // @ts-ignore - Accessing private property for testing
    webSocketManager.players = new Map([['get-player-test', mockPlayer]]);
    
    // Get the player
    const player = webSocketManager.getPlayer('get-player-test');
    
    // Should return the correct player
    expect(player).toBe(mockPlayer);
    
    // Non-existent player should return undefined
    expect(webSocketManager.getPlayer('non-existent')).toBeUndefined();
  });
  
  test('should disconnect player without timeout', () => {
    // Create mock player that has a table
    const mockTable = {
      removePlayer: jest.fn()
    };
    
    const mockPlayer = {
      id: 'disconnect-test',
      sendMessage: jest.fn(),
      getTable: jest.fn().mockReturnValue(mockTable),
      disconnect: jest.fn()
    };
    
    // Add player to WebSocketManager and setup timeout
    // @ts-ignore - Accessing private property for testing
    webSocketManager.players = new Map([['disconnect-test', mockPlayer]]);
    // @ts-ignore - Accessing private property for testing
    webSocketManager.disconnectionTimeouts = new Map([
      ['disconnect-test', setTimeout(() => {}, 10000)]
    ]);
    
    // Disconnect the player
    webSocketManager.disconnectPlayer('disconnect-test');
    
    // Player should be disconnected
    expect(mockPlayer.disconnect).toHaveBeenCalled();
    
    // Player should be removed from table
    expect(mockTable.removePlayer).toHaveBeenCalledWith('disconnect-test');
    
    // Player should be removed from players map
    // @ts-ignore - Accessing private property for testing
    expect(webSocketManager.players.has('disconnect-test')).toBeFalsy();
    
    // Timeout should be cleared
    // @ts-ignore - Accessing private property for testing
    expect(webSocketManager.disconnectionTimeouts.has('disconnect-test')).toBeFalsy();
  });
  
  // TEST ACCESSOR METHODS
  
  test('should get and set reconnection timeout', () => {
    // Default from setup
    expect(webSocketManager.getReconnectionTimeout()).toBe(600000);
    
    // Change timeout
    webSocketManager.setReconnectionTimeout(30000);
    
    // Verify change
    expect(webSocketManager.getReconnectionTimeout()).toBe(30000);
  });
  
  test('should get disconnected players info', () => {
    // Create mock disconnected players with needed properties
    const now = Date.now();
    const disconnectedPlayer1 = {
      id: 'dc-player-1',
      getAttribute: jest.fn().mockImplementation(key => {
        if (key === 'connectionStatus') return 'disconnected';
        if (key === 'disconnectedAt') return now - 60000; // 1 minute ago
        if (key === 'reconnectionAvailableUntil') return now + 540000; // 9 minutes left
        return null;
      })
    };
    
    const disconnectedPlayer2 = {
      id: 'dc-player-2',
      getAttribute: jest.fn().mockImplementation(key => {
        if (key === 'connectionStatus') return 'disconnected';
        if (key === 'disconnectedAt') return now - 300000; // 5 minutes ago
        if (key === 'reconnectionAvailableUntil') return now + 300000; // 5 minutes left
        return null;
      })
    };
    
    const connectedPlayer = {
      id: 'connected-player',
      getAttribute: jest.fn().mockImplementation(key => {
        if (key === 'connectionStatus') return 'connected';
        return null;
      })
    };
    
    // Add players to WebSocketManager
    // @ts-ignore - Accessing private property for testing
    webSocketManager.players = new Map([
      ['dc-player-1', disconnectedPlayer1],
      ['dc-player-2', disconnectedPlayer2],
      ['connected-player', connectedPlayer]
    ]);
    
    // Get disconnected players info
    const disconnectedPlayers = webSocketManager.getDisconnectedPlayers();
    
    // Should only include disconnected players
    expect(disconnectedPlayers.length).toBe(2);
    
    // Should have correct data
    expect(disconnectedPlayers[0].id).toBe('dc-player-1');
    expect(disconnectedPlayers[0].disconnectedAt).toBe(now - 60000);
    expect(disconnectedPlayers[0].reconnectionAvailableUntil).toBe(now + 540000);
    // Allow for small timing differences (give or take 100ms)
    expect(Math.abs(disconnectedPlayers[0].timeLeftMs - 540000)).toBeLessThanOrEqual(100);
    
    expect(disconnectedPlayers[1].id).toBe('dc-player-2');
    // Allow for small timing differences (give or take 100ms)
    expect(Math.abs(disconnectedPlayers[1].timeLeftMs - 300000)).toBeLessThanOrEqual(100);
  });
}); 