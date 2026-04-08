import { EventBus } from '../../src/events/EventBus';
import { PLAYER_EVENTS, TABLE_EVENTS } from '../../src/events/EventTypes';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  test('should emit and receive events', () => {
    const mockListener = jest.fn();
    eventBus.on({ event: 'testEvent', listener: mockListener });
    
    eventBus.emit('testEvent', { arg0: 'arg1', arg1: 'arg2' });
    
    expect(mockListener).toHaveBeenCalledTimes(1);
    expect(mockListener).toHaveBeenCalledWith('arg1', 'arg2');
  });

  test('should handle multiple listeners for the same event', () => {
    const mockListener1 = jest.fn();
    const mockListener2 = jest.fn();
    
    eventBus.on({ event: 'multipleListeners', listener: mockListener1 });
    eventBus.on({ event: 'multipleListeners', listener: mockListener2 });
    
    eventBus.emit('multipleListeners', { arg0: 'data' });
    
    expect(mockListener1).toHaveBeenCalledTimes(1);
    expect(mockListener1).toHaveBeenCalledWith('data');
    expect(mockListener2).toHaveBeenCalledTimes(1);
    expect(mockListener2).toHaveBeenCalledWith('data');
  });

  test('should handle once listener', () => {
    const mockListener = jest.fn();
    
    eventBus.once({ event: 'onceEvent', listener: mockListener });
    
    eventBus.emit('onceEvent', { arg0: 'first' });
    eventBus.emit('onceEvent', { arg0: 'second' });
    
    expect(mockListener).toHaveBeenCalledTimes(1);
    expect(mockListener).toHaveBeenCalledWith('first');
  });

  test('should remove listener with off', () => {
    const mockListener = jest.fn();
    
    eventBus.on({ event: 'removeTest', listener: mockListener });
    eventBus.emit('removeTest');
    expect(mockListener).toHaveBeenCalledTimes(1);
    
    eventBus.off({ event: 'removeTest', listener: mockListener });
    eventBus.emit('removeTest');
    expect(mockListener).toHaveBeenCalledTimes(1); // Still 1, not called again
  });

  test('should correctly report listener count', () => {
    const mockListener1 = jest.fn();
    const mockListener2 = jest.fn();
    
    expect(eventBus.listenerCount({ event: 'countTest' })).toBe(0);
    
    eventBus.on({ event: 'countTest', listener: mockListener1 });
    expect(eventBus.listenerCount({ event: 'countTest' })).toBe(1);
    
    eventBus.on({ event: 'countTest', listener: mockListener2 });
    expect(eventBus.listenerCount({ event: 'countTest' })).toBe(2);
    
    eventBus.off({ event: 'countTest', listener: mockListener1 });
    expect(eventBus.listenerCount({ event: 'countTest' })).toBe(1);
  });

  // New tests for the debugMonitor and custom events

  test('should handle predefined event constants', () => {
    const playerConnectedListener = jest.fn();
    const tableCreatedListener = jest.fn();
    
    eventBus.on({ event: PLAYER_EVENTS.CONNECTED, listener: playerConnectedListener });
    eventBus.on({ event: TABLE_EVENTS.CREATED, listener: tableCreatedListener });
    
    const player = { id: 'player1' };
    const table = { id: 'table1' };
    
    eventBus.emit(PLAYER_EVENTS.CONNECTED, { player });
    eventBus.emit(TABLE_EVENTS.CREATED, { table });
    
    expect(playerConnectedListener).toHaveBeenCalledWith(player);
    expect(tableCreatedListener).toHaveBeenCalledWith(table);
  });
  
  test('should handle custom events', () => {
    // Define custom events
    const POKER_EVENTS = {
      HAND_DEALT: "poker:hand:dealt",
      BETTING_ROUND_STARTED: "poker:betting:started",
    } as const;
    
    const handDealtListener = jest.fn();
    const bettingStartedListener = jest.fn();
    
    eventBus.on({ event: POKER_EVENTS.HAND_DEALT, listener: handDealtListener });
    eventBus.on({ event: POKER_EVENTS.BETTING_ROUND_STARTED, listener: bettingStartedListener });
    
    const player = { id: 'player1' };
    const cards = [{ suit: 'hearts', value: 'A' }, { suit: 'spades', value: 'K' }];
    const table = { id: 'table1' };
    
    eventBus.emit(POKER_EVENTS.HAND_DEALT, { player, cards });
    eventBus.emit(POKER_EVENTS.BETTING_ROUND_STARTED, { table, arg1: 10 });
    
    expect(handDealtListener).toHaveBeenCalledWith(player, cards);
    expect(bettingStartedListener).toHaveBeenCalledWith(table, 10);
  });
  
  test('should enable debug monitoring with default logger', () => {
    // Mock console.log
    const originalConsoleLog = console.log;
    console.log = jest.fn();
    
    // Setup debug monitor
    eventBus.debugMonitor({ enabled: true });
    
    // The EventBus adds a listener for the special '*' event
    expect(eventBus.listenerCount({ event: '*' })).toBe(1);
    
    // Create a mock event handler to trigger with the wildcard
    const mockHandler = jest.fn();
    eventBus.on({ event: 'testDebugEvent', listener: mockHandler });
    
    // Emit an event that should be logged
    eventBus.emit('testDebugEvent', { arg0: 'arg1', arg1: 'arg2' });
    
    // Check the handler was called
    expect(mockHandler).toHaveBeenCalledWith('arg1', 'arg2');
    
    // Restore console.log
    console.log = originalConsoleLog;
  });
  
  test('should filter events in debug monitor', () => {
    const mockLogger = jest.fn();
    
    // Setup debug monitor with a filter for events starting with 'test:'
    eventBus.debugMonitor({ enabled: true, filter: (eventName) => eventName.startsWith('test:'), logger: mockLogger });
    
    // Emit events, some matching the filter, some not
    eventBus.emit('test:included', { arg0: 'data1' });
    eventBus.emit('other:excluded', { arg0: 'data2' });
    eventBus.emit('test:also:included', { arg0: 'data3' });
    
    // The logger should only be called for events matching the filter
    expect(mockLogger).toHaveBeenCalledTimes(2);
    expect(mockLogger).toHaveBeenCalledWith('[EVENT] test:included', 'data1');
    expect(mockLogger).toHaveBeenCalledWith('[EVENT] test:also:included', 'data3');
    expect(mockLogger).not.toHaveBeenCalledWith('[EVENT] other:excluded', 'data2');
  });
  
  test('should use custom logger in debug monitor', () => {
    const customLogger = jest.fn();
    
    // Setup debug monitor with custom logger
    eventBus.debugMonitor({ enabled: true, filter: undefined, logger: customLogger });
    
    // Emit events
    eventBus.emit('custom:event', { data: 'test' });
    
    // The custom logger should be called
    expect(customLogger).toHaveBeenCalledTimes(1);
    expect(customLogger).toHaveBeenCalledWith('[EVENT] custom:event', { data: 'test' });
  });
  
  test('should disable debug monitoring', () => {
    const mockLogger = jest.fn();
    
    // Set up debug monitor
    eventBus.debugMonitor({ enabled: true, filter: undefined, logger: mockLogger });
    
    // Emit an event to verify logging is enabled
    eventBus.emit('test:event', { arg0: 'data' });
    expect(mockLogger).toHaveBeenCalledTimes(1);
    
    // Clear the mock to start fresh
    mockLogger.mockClear();
    
    // Disable debug monitoring
    eventBus.debugMonitor({ enabled: false });
    
    // The wildcard listener should be removed 
    expect(eventBus.listenerCount({ event: '*' })).toBe(0);
    
    // Emit another event, should not be logged
    eventBus.emit('test:event2', { arg0: 'data2' });
    expect(mockLogger).not.toHaveBeenCalled();
  });
}); 