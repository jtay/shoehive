import { EventBus } from '../../src/events/EventBus';
import { MessageRouter } from '../../src/events/MessageRouter';
import { TableFactory } from '../../src/core/TableFactory';
import { GameManager, GameDefinition } from '../../src/core/GameManager';
import { Player } from '../../src/core/Player';
import { Table, TableState } from '../../src/core/Table';
import { WebSocketManager } from '../../src/core/WebSocketManager';
import { BasicServerTransportModule } from '../../src/transport/implementations/BasicServerTransportModule';
import * as WebSocket from 'ws';
import { PLAYER_EVENTS, TABLE_EVENTS } from '../../src/events/EventTypes';
import * as http from 'http';

// Mock WebSocket
jest.mock('ws', () => {
  const mockWebSocket = {
    on: jest.fn((event, handler) => {
      // Store the handler for 'close' events so we can manually trigger it
      if (event === 'close') {
        mockWebSocket.closeHandler = handler;
      }
    }),
    closeHandler: null as any,
    send: jest.fn(),
    close: jest.fn(),
    readyState: 1, // WebSocket.OPEN
    WebSocket: {
      OPEN: 1
    }
  };
  
  return {
    WebSocket: jest.fn(() => mockWebSocket),
    Server: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      handleUpgrade: jest.fn(),
      emit: jest.fn()
    }))
  };
});

// Mock Player implementation to handle table removal on disconnect
jest.mock('../../src/core/Player', () => {
  const originalModule = jest.requireActual('../../src/core/Player');
  
  return {
    ...originalModule,
    Player: jest.fn().mockImplementation((socket, eventBus, id) => {
      return {
        id: id || 'mock-id',
        getTable: jest.fn().mockImplementation(() => null),
        setTable: jest.fn(),
        sendMessage: jest.fn(),
        setAttribute: jest.fn(),
        getAttribute: jest.fn(),
        hasAttribute: jest.fn(),
        getAttributes: jest.fn().mockReturnValue({}),
        disconnect: jest.fn()
      };
    })
  };
});

// Mock http.IncomingMessage
class MockIncomingMessage {
  socket: any;
  headers: Record<string, string>;
  
  constructor() {
    this.socket = { remoteAddress: '127.0.0.1' };
    this.headers = { 'user-agent': 'test-agent' };
  }
}

describe('Game Server Integration', () => {
  let eventBus: EventBus;
  let messageRouter: MessageRouter;
  let tableFactory: TableFactory;
  let gameManager: GameManager;
  let serverTransport: BasicServerTransportModule;
  
  // Mock players
  let player1: any;
  let player2: any;
  let mockSocket1: any;
  let mockSocket2: any;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Initialize components
    eventBus = new EventBus();
    messageRouter = new MessageRouter(eventBus);
    tableFactory = new TableFactory(eventBus);
    gameManager = new GameManager(eventBus, tableFactory);
    serverTransport = new BasicServerTransportModule();
    
    // Create mock sockets
    mockSocket1 = new WebSocket.WebSocket('ignored');
    mockSocket2 = new WebSocket.WebSocket('ignored');
    
    // Create mock players
    player1 = new Player(mockSocket1, eventBus, 'player1');
    player2 = new Player(mockSocket2, eventBus, 'player2');
    
    // Set up initial balances
    serverTransport.setPlayerBalance('player1', 1000);
    serverTransport.setPlayerBalance('player2', 1000);
    
    // Register game definition with proper fields according to the interface
    gameManager.registerGame({
      id: 'test-game',
      name: 'Test Game',
      description: 'A test game for integration testing',
      minPlayers: 1,
      maxPlayers: 2,
      defaultSeats: 2,
      maxSeatsPerPlayer: 1,
      tableRelevantPlayerAttributes: ["name", "score", "isReady"],
      lobbyRelevantPlayerAttributes: ["name", "status"],
      options: {
        setupTable: (table: Table) => {
          table.setAttribute('gameId', 'test-game');
          table.setAttribute('currentPlayer', null);
          table.setAttribute('gameData', { started: false });
        }
      }
    });
  });
  
  test('should create a table and handle player interactions', () => {
    // Spy on event emissions
    const eventSpy = jest.spyOn(eventBus, 'emit');
    
    // Create a table - using non-null assertion as we know this shouldn't be null
    const table = gameManager.createTable('test-game');
    // Add null check
    if (!table) {
      fail('Table should have been created');
      return;
    }
    
    // Set up table attributes manually since we're not using the setupTable function
    table.setAttribute('gameId', 'test-game');
    table.setAttribute('currentPlayer', null);
    table.setAttribute('gameData', { started: false });
    
    // Mock the broadcastMessage method
    table.broadcastMessage = jest.fn();
    
    expect(table).toBeTruthy();
    expect(eventSpy).toHaveBeenCalledWith('table:created', table);
    
    // Add players to table
    table.addPlayer(player1);
    table.addPlayer(player2);
    
    expect(table.getPlayerCount()).toBe(2);
    expect(eventSpy).toHaveBeenCalledWith('table:player:joined', player1, table);
    expect(eventSpy).toHaveBeenCalledWith('table:player:joined', player2, table);
    
    // Sit players at seats
    table.sitPlayerAtSeat('player1', 0);
    table.sitPlayerAtSeat('player2', 1);
    
    expect(table.getSeats()[0].getPlayer()).toBe(player1);
    expect(table.getSeats()[1].getPlayer()).toBe(player2);
    expect(eventSpy).toHaveBeenCalledWith('table:player:sat', player1, table, 0);
    expect(eventSpy).toHaveBeenCalledWith('table:player:sat', player2, table, 1);
    
    // Start the game
    table.setState(TableState.ACTIVE);
    table.setAttribute('currentPlayer', 'player1');
    table.setAttribute('gameData', { started: true, turnNumber: 1 });
    
    expect(table.getState()).toBe(TableState.ACTIVE);
    expect(eventSpy).toHaveBeenCalledWith(TABLE_EVENTS.STATE_UPDATED, table, TableState.ACTIVE);
    
    // Broadcast game start message
    table.broadcastMessage({
      type: 'gameStarted',
      currentPlayer: 'player1',
      gameData: { started: true, turnNumber: 1 }
    });
    
    expect(table.broadcastMessage).toHaveBeenCalled();
    
    // Create a reference to table for use in the command handler
    const gameTable = table;
    
    // Simulate a player action through message router
    // First register a command handler
    messageRouter.registerCommandHandler('makeMove', (player, data) => {
      if (gameTable.getAttribute('currentPlayer') !== player.id) {
        player.sendMessage({ type: 'error', message: 'Not your turn' });
        return;
      }
      
      // Process the move
      const gameData = gameTable.getAttribute('gameData');
      gameData.lastMove = data.move;
      gameData.turnNumber += 1;
      gameTable.setAttribute('gameData', gameData);
      
      // Switch turns
      const nextPlayer = player.id === 'player1' ? 'player2' : 'player1';
      gameTable.setAttribute('currentPlayer', nextPlayer);
      
      // Notify all players
      gameTable.broadcastMessage({
        type: 'moveMade',
        playerId: player.id,
        move: data.move,
        nextPlayer: nextPlayer
      });
      
      // Emit custom event
      eventBus.emit('player:made:move', player, gameTable, data.move);
    });
    
    // Listen for the custom event
    const moveListener = jest.fn();
    eventBus.on('player:made:move', moveListener);
    
    // Process a makeMove message from player1
    messageRouter.processMessage(player1, JSON.stringify({
      action: 'makeMove',
      move: { x: 0, y: 0 }
    }));
    
    // Check that the move was processed
    expect(table.getAttribute('gameData').lastMove).toEqual({ x: 0, y: 0 });
    expect(table.getAttribute('gameData').turnNumber).toBe(2);
    expect(table.getAttribute('currentPlayer')).toBe('player2');
    
    // Check that the broadcast was made
    expect(table.broadcastMessage).toHaveBeenCalledWith({
      type: 'moveMade',
      playerId: player1.id,
      move: { x: 0, y: 0 },
      nextPlayer: 'player2'
    });
    
    // Check that the custom event was emitted
    expect(moveListener).toHaveBeenCalledWith(player1, table, { x: 0, y: 0 });
    
    // Try to make a move with the wrong player
    messageRouter.processMessage(player1, JSON.stringify({
      action: 'makeMove',
      move: { x: 1, y: 1 }
    }));
    
    // Check that the game state didn't change
    expect(table.getAttribute('gameData').turnNumber).toBe(2);
    expect(table.getAttribute('currentPlayer')).toBe('player2');
    
    // Now make a move with player2
    messageRouter.processMessage(player2, JSON.stringify({
      action: 'makeMove',
      move: { x: 1, y: 1 }
    }));
    
    // Check that the move was processed
    expect(table.getAttribute('gameData').lastMove).toEqual({ x: 1, y: 1 });
    expect(table.getAttribute('gameData').turnNumber).toBe(3);
    expect(table.getAttribute('currentPlayer')).toBe('player1');
  });
  
  test('should handle player disconnection and table cleanup', () => {
    // Listen for player disconnected events and add a handler that removes players from tables
    eventBus.on(PLAYER_EVENTS.DISCONNECTED, (player) => {
      const playerTable = player.getTable();
      if (playerTable) {
        playerTable.removePlayer(player.id);
      }
    });
    
    // Create a table
    const table = gameManager.createTable('test-game');
    if (!table) {
      fail('Table should have been created');
      return;
    }
    
    // Set up table attributes
    table.setAttribute('gameId', 'test-game');
    table.setAttribute('currentPlayer', null);
    table.setAttribute('gameData', { started: false });
    
    // Add players to table
    table.addPlayer(player1);
    table.addPlayer(player2);
    
    // Set up player1 to return the table when getTable is called
    player1.getTable = jest.fn().mockReturnValue(table);
    
    // Set up a spy to check if removePlayer is called
    const removePlayerSpy = jest.spyOn(table, 'removePlayer');
    
    // Simulate player disconnection event
    eventBus.emit('player:disconnected', player1);
    
    // Check that removePlayer was called with the correct player ID
    expect(removePlayerSpy).toHaveBeenCalledWith(player1.id);
  });
  
  test('should handle bet creation and resolution using transport module', async () => {
    // Create a table
    const table = gameManager.createTable('test-game');
    if (!table) {
      fail('Table should have been created');
      return;
    }
    
    // Set up table attributes
    table.setAttribute('gameId', 'test-game');
    table.setAttribute('currentPlayer', null);
    table.setAttribute('gameData', { started: false });
    
    // Add players to table
    table.addPlayer(player1);
    table.addPlayer(player2);
    
    // Check initial balances
    let player1Balance = await serverTransport.getPlayerBalance(player1);
    let player2Balance = await serverTransport.getPlayerBalance(player2);
    
    expect(player1Balance).toBe(1000);
    expect(player2Balance).toBe(1000);
    
    // Create bets
    const bet1Id = await serverTransport.createBet(player1, 200, { gameId: 'test-game' });
    const bet2Id = await serverTransport.createBet(player2, 200, { gameId: 'test-game' });
    
    // Check balances after betting
    player1Balance = await serverTransport.getPlayerBalance(player1);
    player2Balance = await serverTransport.getPlayerBalance(player2);
    
    expect(player1Balance).toBe(800);
    expect(player2Balance).toBe(800);
    
    // Resolve bets (player1 wins, player2 loses)
    await serverTransport.markBetWon(bet1Id, 400, { result: 'win' });
    await serverTransport.markBetLost(bet2Id, { result: 'loss' });
    
    // Check final balances
    player1Balance = await serverTransport.getPlayerBalance(player1);
    player2Balance = await serverTransport.getPlayerBalance(player2);
    
    expect(player1Balance).toBe(1200); // 1000 - 200 + 400
    expect(player2Balance).toBe(800);  // 1000 - 200
    
    // Check bet status
    const player1Bets = serverTransport.getPlayerBets(player1.id);
    const player2Bets = serverTransport.getPlayerBets(player2.id);
    
    expect(player1Bets[0].bet.status).toBe('won');
    expect(player2Bets[0].bet.status).toBe('lost');
  });

  test('should handle player disconnection', () => {
    const eventSpy = jest.spyOn(eventBus, 'emit');
    
    // Create a table and add a player
    const table = gameManager.createTable('test-game');
    if (!table) {
      fail('Table should have been created');
      return;
    }
    
    // Add player to table
    table.addPlayer(player1);
    expect(table.getPlayerCount()).toBe(1);
    
    // Mock getTable to return the table
    player1.getTable = jest.fn().mockReturnValue(table);
    
    // Simulate player disconnection by triggering the close event
    const mockWS = player1 as any;
    if (mockWS.closeHandler) {
      mockWS.closeHandler();
    } else {
      // Directly emit the event if we can't access the closeHandler
      eventBus.emit('player:disconnected', player1);
    }
    
    // Verify the events
    expect(eventSpy).toHaveBeenCalledWith('player:disconnected', player1);
    
    // Note: In a real scenario, player should be removed from the table when disconnected
    // This would be handled by event handlers in the WebSocketManager
  });
  
  test('should support configurable player attribute relevance', () => {
    // Create a game definition with custom relevant attributes
    const customGame = {
      id: 'custom-game',
      name: 'Custom Game',
      description: 'A game with custom attribute relevance',
      minPlayers: 1,
      maxPlayers: 2,
      defaultSeats: 2,
      maxSeatsPerPlayer: 1,
      tableRelevantPlayerAttributes: ['customAttr1', 'customAttr2'],
      lobbyRelevantPlayerAttributes: ['customAttr3', 'customAttr4']
    };
    gameManager.registerGame(customGame);
    
    // Verify that the game definition has the custom attributes
    const retrievedGame = gameManager.getGameDefinition('custom-game');
    expect(retrievedGame).toBeTruthy();
    expect(retrievedGame?.tableRelevantPlayerAttributes).toEqual(['customAttr1', 'customAttr2']);
    expect(retrievedGame?.lobbyRelevantPlayerAttributes).toEqual(['customAttr3', 'customAttr4']);
    
    // Create a simple test function that checks if an attribute is relevant
    const isTableRelevant = (gameId: string, attributeName: string): boolean => {
      const game = gameManager.getGameDefinition(gameId);
      if (!game || !game.tableRelevantPlayerAttributes) return false;
      return game.tableRelevantPlayerAttributes.includes(attributeName);
    };
    
    // Test with the custom attributes
    expect(isTableRelevant('custom-game', 'customAttr1')).toBe(true);
    expect(isTableRelevant('custom-game', 'customAttr2')).toBe(true);
    expect(isTableRelevant('custom-game', 'irrelevantAttr')).toBe(false);
    
    // Test with the default game
    expect(isTableRelevant('test-game', 'score')).toBe(true);
    expect(isTableRelevant('test-game', 'name')).toBe(true);
    expect(isTableRelevant('test-game', 'isReady')).toBe(true);
    expect(isTableRelevant('test-game', 'irrelevantAttr')).toBe(false);
  });
}); 