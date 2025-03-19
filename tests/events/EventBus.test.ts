import { EventBus } from '../../src/events/EventBus';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  test('should emit and receive events', () => {
    const mockListener = jest.fn();
    eventBus.on('testEvent', mockListener);
    
    eventBus.emit('testEvent', 'arg1', 'arg2');
    
    expect(mockListener).toHaveBeenCalledTimes(1);
    expect(mockListener).toHaveBeenCalledWith('arg1', 'arg2');
  });

  test('should handle multiple listeners for the same event', () => {
    const mockListener1 = jest.fn();
    const mockListener2 = jest.fn();
    
    eventBus.on('multipleListeners', mockListener1);
    eventBus.on('multipleListeners', mockListener2);
    
    eventBus.emit('multipleListeners', 'data');
    
    expect(mockListener1).toHaveBeenCalledTimes(1);
    expect(mockListener1).toHaveBeenCalledWith('data');
    expect(mockListener2).toHaveBeenCalledTimes(1);
    expect(mockListener2).toHaveBeenCalledWith('data');
  });

  test('should handle once listener', () => {
    const mockListener = jest.fn();
    
    eventBus.once('onceEvent', mockListener);
    
    eventBus.emit('onceEvent', 'first');
    eventBus.emit('onceEvent', 'second');
    
    expect(mockListener).toHaveBeenCalledTimes(1);
    expect(mockListener).toHaveBeenCalledWith('first');
  });

  test('should remove listener with off', () => {
    const mockListener = jest.fn();
    
    eventBus.on('removeTest', mockListener);
    eventBus.emit('removeTest');
    expect(mockListener).toHaveBeenCalledTimes(1);
    
    eventBus.off('removeTest', mockListener);
    eventBus.emit('removeTest');
    expect(mockListener).toHaveBeenCalledTimes(1); // Still 1, not called again
  });

  test('should correctly report listener count', () => {
    const mockListener1 = jest.fn();
    const mockListener2 = jest.fn();
    
    expect(eventBus.listenerCount('countTest')).toBe(0);
    
    eventBus.on('countTest', mockListener1);
    expect(eventBus.listenerCount('countTest')).toBe(1);
    
    eventBus.on('countTest', mockListener2);
    expect(eventBus.listenerCount('countTest')).toBe(2);
    
    eventBus.off('countTest', mockListener1);
    expect(eventBus.listenerCount('countTest')).toBe(1);
  });
}); 