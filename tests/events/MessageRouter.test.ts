import { MessageRouter } from '../../src/events/MessageRouter';
import { EventBus } from '../../src/events/EventBus';
import { Player } from '../../src/core/Player';
import { CLIENT_MESSAGE_TYPES } from '../../src/core/commands/index';
import * as WebSocket from 'ws';

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

// Mock Player class
jest.mock('../../src/core/Player', () => {
  return {
    Player: jest.fn().mockImplementation(() => ({
      id: 'mock-player-id',
      sendMessage: jest.fn()
    }))
  };
});

describe('MessageRouter', () => {
  let messageRouter: MessageRouter;
  let eventBus: EventBus;
  let mockPlayer: jest.Mocked<Player>;
  let mockSocket: any;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create a new event bus
    eventBus = new EventBus();
    
    // Create a message router
    messageRouter = new MessageRouter(eventBus);
    
    // Create a mock socket
    mockSocket = new WebSocket.WebSocket(null);
    
    // Create a mock player with the required arguments
    mockPlayer = new Player(mockSocket, eventBus, 'mock-player-id') as unknown as jest.Mocked<Player>;
  });
  
  test('should register a command handler', () => {
    const handlerFn = jest.fn();
    messageRouter.registerCommandHandler('test:action', handlerFn);
    
    // Prepare test message
    const message = {
      action: 'test:action',
      data: { value: 123 }
    };
    
    // Process the message
    messageRouter.processMessage(mockPlayer, JSON.stringify(message));
    
    // Verify handler was called
    expect(handlerFn).toHaveBeenCalledWith(mockPlayer, message);
  });
  
  test('should emit an event if no handler is registered', () => {
    // Spy on eventBus.emit
    const emitSpy = jest.spyOn(eventBus, 'emit');
    
    // Prepare test message with no registered handler
    const message = {
      action: 'unhandled:action',
      data: { value: 123 }
    };
    
    // Process the message
    messageRouter.processMessage(mockPlayer, JSON.stringify(message));
    
    // Verify event was emitted
    expect(emitSpy).toHaveBeenCalledWith('unhandled:action', mockPlayer, message);
  });
  
  test('should handle invalid JSON message format', () => {
    // Process invalid JSON
    messageRouter.processMessage(mockPlayer, '{invalid-json');
    
    // Verify error message was sent
    expect(mockPlayer.sendMessage).toHaveBeenCalledWith({
      type: CLIENT_MESSAGE_TYPES.ERROR,
      message: 'Failed to process message'
    });
  });
  
  test('should handle message missing action property', () => {
    // Process message without action
    messageRouter.processMessage(mockPlayer, JSON.stringify({ data: 'test' }));
    
    // Verify error message was sent
    expect(mockPlayer.sendMessage).toHaveBeenCalledWith({
      type: CLIENT_MESSAGE_TYPES.ERROR,
      message: 'Invalid message format: missing or invalid action'
    });
  });
  
  test('should handle message with non-string action property', () => {
    // Process message with numeric action
    messageRouter.processMessage(mockPlayer, JSON.stringify({ action: 123 }));
    
    // Verify error message was sent
    expect(mockPlayer.sendMessage).toHaveBeenCalledWith({
      type: CLIENT_MESSAGE_TYPES.ERROR,
      message: 'Invalid message format: missing or invalid action'
    });
  });
  
  test('should handle multiple registered command handlers', () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();
    
    messageRouter.registerCommandHandler('action1', handler1);
    messageRouter.registerCommandHandler('action2', handler2);
    
    // Process message for action1
    messageRouter.processMessage(mockPlayer, JSON.stringify({ action: 'action1', data: 1 }));
    
    // Process message for action2
    messageRouter.processMessage(mockPlayer, JSON.stringify({ action: 'action2', data: 2 }));
    
    // Verify correct handlers were called with correct data
    expect(handler1).toHaveBeenCalledWith(mockPlayer, { action: 'action1', data: 1 });
    expect(handler2).toHaveBeenCalledWith(mockPlayer, { action: 'action2', data: 2 });
  });
  
  test('should allow overriding previously registered command handlers', () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();
    
    messageRouter.registerCommandHandler('action', handler1);
    messageRouter.registerCommandHandler('action', handler2); // Override previous handler
    
    // Process message
    messageRouter.processMessage(mockPlayer, JSON.stringify({ action: 'action' }));
    
    // Verify only the new handler was called
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  describe('Command handling', () => {
    test('should register and handle commands correctly', () => {
      const mockHandler = jest.fn();
      const mockPlayer = { 
        sendMessage: jest.fn()
      } as unknown as Player;
      
      messageRouter.registerCommandHandler('TEST_COMMAND', mockHandler);
      
      // Process the message
      messageRouter.processMessage(mockPlayer, JSON.stringify({
        action: 'TEST_COMMAND',
        data: { foo: 'bar' }
      }));
      
      // Verify the handler was called with the player and message data
      expect(mockHandler).toHaveBeenCalledWith(mockPlayer, expect.objectContaining({
        action: 'TEST_COMMAND',
        data: { foo: 'bar' }
      }));
    });

    test('should handle errors when no handler for action', () => {
      // Spy on console.error to suppress and verify error messages
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      const mockPlayer = { 
        sendMessage: jest.fn()
      } as unknown as Player;
      
      // Mock the eventBus.emit method
      const emitSpy = jest.spyOn(eventBus, 'emit');
      
      // Process message with no registered handler
      messageRouter.processMessage(mockPlayer, JSON.stringify({
        action: 'UNKNOWN_COMMAND',
        data: { foo: 'bar' }
      }));
      
      // Verify that the event bus was used since no handler was found
      expect(emitSpy).toHaveBeenCalledWith(
        'UNKNOWN_COMMAND',
        mockPlayer,
        expect.objectContaining({
          action: 'UNKNOWN_COMMAND',
          data: { foo: 'bar' }
        })
      );
      
      // Restore console.error
      consoleErrorSpy.mockRestore();
    });
  });
}); 