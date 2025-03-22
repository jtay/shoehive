import { EventBus } from '../../src/events/EventBus';
import { PLAYER_EVENTS, TABLE_EVENTS } from '../../src/events/EventTypes';

describe('Advanced EventBus Tests', () => {
  let eventBus: EventBus;
  let originalConsoleLog: any;
  let mockLogger: jest.Mock;
  
  beforeEach(() => {
    // Backup the original console.log
    originalConsoleLog = console.log;
    // Create a mock logger
    mockLogger = jest.fn();
    // Replace console.log with the mock
    console.log = mockLogger;
    
    // Create a new EventBus for each test
    eventBus = new EventBus();
  });
  
  afterEach(() => {
    // Restore the original console.log
    console.log = originalConsoleLog;
  });
  
  test('should enable and disable debug monitoring', () => {
    // Enable debug monitoring
    eventBus.debugMonitor(true);
    
    // Emit an event
    eventBus.emit('test:event', { data: 'test data' });
    
    // Verify the event was logged
    expect(mockLogger).toHaveBeenCalledWith('[EVENT] test:event', { data: 'test data' });
    
    // Clear mock calls
    mockLogger.mockClear();
    
    // Disable debug monitoring
    eventBus.debugMonitor(false);
    
    // Emit another event
    eventBus.emit('another:event', { data: 'more data' });
    
    // Verify the event was NOT logged
    expect(mockLogger).not.toHaveBeenCalled();
  });
  
  test('should filter events with custom filter function', () => {
    // Create a filter that only logs PLAYER events
    const filter = (event: string) => event.startsWith('player:');
    
    // Enable debug monitoring with the filter
    eventBus.debugMonitor(true, filter);
    
    // Emit a PLAYER event (should be logged)
    eventBus.emit(PLAYER_EVENTS.CONNECTED, { id: 'player1' });
    
    // Verify the PLAYER event was logged
    expect(mockLogger).toHaveBeenCalledWith('[EVENT] ' + PLAYER_EVENTS.CONNECTED, { id: 'player1' });
    
    // Clear mock calls
    mockLogger.mockClear();
    
    // Emit a TABLE event (should NOT be logged)
    eventBus.emit(TABLE_EVENTS.CREATED, { id: 'table1' });
    
    // Verify the TABLE event was NOT logged
    expect(mockLogger).not.toHaveBeenCalled();
  });
  
  test('should use custom logger function', () => {
    // Create a custom logger
    const customLogger = jest.fn();
    
    // Enable debug monitoring with the custom logger
    eventBus.debugMonitor(true, undefined, customLogger);
    
    // Emit an event
    eventBus.emit('test:event', { data: 'test data' });
    
    // Verify the custom logger was used
    expect(customLogger).toHaveBeenCalledWith('[EVENT] test:event', { data: 'test data' });
    expect(mockLogger).not.toHaveBeenCalled();
  });
  
  test('should handle all parameter combinations for debugMonitor', () => {
    // Test with default parameters
    eventBus.debugMonitor();
    eventBus.emit('test:event', 1, 2, 3);
    expect(mockLogger).toHaveBeenCalledWith('[EVENT] test:event', 1, 2, 3);
    mockLogger.mockClear();
    
    // Test with only enabled parameter
    eventBus.debugMonitor(true);
    eventBus.emit('test:event', 1, 2, 3);
    expect(mockLogger).toHaveBeenCalledWith('[EVENT] test:event', 1, 2, 3);
    mockLogger.mockClear();
    
    // Test with enabled and filter parameters
    const filter = jest.fn().mockReturnValue(true);
    eventBus.debugMonitor(true, filter);
    eventBus.emit('test:event', 1, 2, 3);
    expect(filter).toHaveBeenCalledWith('test:event');
    expect(mockLogger).toHaveBeenCalledWith('[EVENT] test:event', 1, 2, 3);
    mockLogger.mockClear();
    
    // Test with all parameters
    const customLogger = jest.fn();
    eventBus.debugMonitor(true, filter, customLogger);
    eventBus.emit('test:event', 1, 2, 3);
    expect(filter).toHaveBeenCalledWith('test:event');
    expect(customLogger).toHaveBeenCalledWith('[EVENT] test:event', 1, 2, 3);
    expect(mockLogger).not.toHaveBeenCalled();
  });
  
  test('should count listeners correctly when debug monitoring is enabled/disabled', () => {
    // Check initial listener count (should be 0)
    expect(eventBus.listenerCount('test:event')).toBe(0);
    
    // Add a listener
    const listener = jest.fn();
    eventBus.on('test:event', listener);
    
    // Check listener count (should be 1)
    expect(eventBus.listenerCount('test:event')).toBe(1);
    
    // Enable debug monitoring (this adds a listener to '*' for testing)
    eventBus.debugMonitor(true);
    
    // Check listener count for the special '*' event (should be 1)
    expect(eventBus.listenerCount('*')).toBe(1);
    
    // Disable debug monitoring (this removes all listeners for '*')
    eventBus.debugMonitor(false);
    
    // Check listener count for the special '*' event (should be 0)
    expect(eventBus.listenerCount('*')).toBe(0);
    
    // Check that the original listener is still there
    expect(eventBus.listenerCount('test:event')).toBe(1);
  });
}); 