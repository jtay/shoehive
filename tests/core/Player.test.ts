import { Player } from '../../src/core/Player';
import { EventBus } from '../../src/events/EventBus';
import * as WebSocket from 'ws';
import { Table } from '../../src/core/Table';
import { PLAYER_EVENTS } from '../../src/events/EventTypes';

// Mock WebSocket constructor and methods
jest.mock('ws', () => {
  return {
    WebSocket: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      send: jest.fn(),
      close: jest.fn(),
      readyState: 1, // WebSocket.OPEN
      WebSocket: { OPEN: 1 }
    }))
  };
});

describe('Player', () => {
  let player: Player;
  let mockSocket: any;
  let eventBus: EventBus;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create a fresh mock socket
    mockSocket = new WebSocket.WebSocket(null);
    
    // Set socket.readyState to OPEN
    mockSocket.readyState = 1;
    
    // Create a new event bus
    eventBus = new EventBus();
    
    // Create a player with the mock socket
    player = new Player(mockSocket, eventBus, 'test-player-id');
  });
  
  test('should initialize with correct ID', () => {
    expect(player.id).toBe('test-player-id');
  });
  
  test('should generate a random ID if none provided', () => {
    const randomIdPlayer = new Player(mockSocket, eventBus);
    expect(randomIdPlayer.id).toBeTruthy();
    expect(typeof randomIdPlayer.id).toBe('string');
  });
  
  test('should set up socket listeners on creation', () => {
    expect(mockSocket.on).toHaveBeenCalledWith('close', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
  });
  
  test('should send messages correctly', () => {
    // Mock implementation of WebSocket.WebSocket.OPEN
    Object.defineProperty(WebSocket.WebSocket, 'OPEN', { value: 1 });
    
    const message = { type: 'test', data: 'message' };
    player.sendMessage(message);
    
    expect(mockSocket.send).toHaveBeenCalledWith(JSON.stringify(message));
  });
  
  test('should not send message if socket is not open', () => {
    // Mock readyState to not be open
    mockSocket.readyState = 0;
    
    // Object.defineProperty(WebSocket.WebSocket, 'OPEN', { value: 1 });
    const message = { type: 'test' };
    player.sendMessage(message);
    
    expect(mockSocket.send).not.toHaveBeenCalled();
  });
  
  test('should get and set table correctly', () => {
    expect(player.getTable()).toBeNull();
    
    const mockTable = {} as Table;
    player.setTable(mockTable);
    expect(player.getTable()).toBe(mockTable);
    
    player.setTable(null);
    expect(player.getTable()).toBeNull();
  });
  
  test('should manage attributes correctly', () => {
    expect(player.hasAttribute('score')).toBe(false);
    
    player.setAttribute('score', 100);
    expect(player.hasAttribute('score')).toBe(true);
    expect(player.getAttribute('score')).toBe(100);
    
    player.setAttribute('score', 200);
    expect(player.getAttribute('score')).toBe(200);
    
    expect(player.getAttribute('nonexistent')).toBeUndefined();
  });
  
  test('should disconnect by closing socket', () => {
    // Mock WebSocket.WebSocket.OPEN
    Object.defineProperty(WebSocket.WebSocket, 'OPEN', { value: 1 });
    
    player.disconnect();
    expect(mockSocket.close).toHaveBeenCalled();
  });
  
  test('should not attempt to close already closed socket', () => {
    // Mock WebSocket.WebSocket.OPEN
    Object.defineProperty(WebSocket.WebSocket, 'OPEN', { value: 1 });
    
    // Mock readyState to be closed
    mockSocket.readyState = 3;
    
    player.disconnect();
    expect(mockSocket.close).not.toHaveBeenCalled();
  });
  
  test('should emit event when player disconnects', () => {
    const spy = jest.spyOn(eventBus, 'emit');
    
    // Find and call the 'close' event handler
    const closeHandler = mockSocket.on.mock.calls.find((call: any[]) => call[0] === 'close')[1];
    closeHandler();
    
    expect(spy).toHaveBeenCalledWith(PLAYER_EVENTS.DISCONNECTED, player);
  });
}); 