import { EventBus } from '../../src/events/EventBus';
import { EVENTS, PLAYER_EVENTS, TABLE_EVENTS } from '../../src/events/EventTypes';

// Example of how a game developer would define custom event constants
const POKER_EVENTS = {
  HAND_DEALT: "poker:hand:dealt",
  BETTING_ROUND_STARTED: "poker:betting:started",
  BETTING_ROUND_ENDED: "poker:betting:ended",
  PLAYER_FOLDED: "poker:player:folded",
  PLAYER_CALLED: "poker:player:called",
  PLAYER_RAISED: "poker:player:raised",
  SHOWDOWN: "poker:showdown",
  WINNER_DETERMINED: "poker:winner:determined"
} as const;

// Type for poker events
type PokerEventType = typeof POKER_EVENTS[keyof typeof POKER_EVENTS];

describe('Custom Events Integration', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  test('should register and emit custom events alongside built-in events', () => {
    const playerConnectedHandler = jest.fn();
    const pokerHandDealtHandler = jest.fn();
    const tablePlayerJoinedHandler = jest.fn();
    
    // Register handlers for built-in and custom events
    eventBus.on(PLAYER_EVENTS.CONNECTED, playerConnectedHandler);
    eventBus.on(POKER_EVENTS.HAND_DEALT, pokerHandDealtHandler);
    eventBus.on(TABLE_EVENTS.PLAYER_JOINED, tablePlayerJoinedHandler);
    
    // Test data
    const player = { id: 'player1' };
    const table = { id: 'table1' };
    const cards = [{ suit: 'hearts', value: 'A' }, { suit: 'spades', value: 'K' }];
    
    // Emit events
    eventBus.emit(PLAYER_EVENTS.CONNECTED, player);
    eventBus.emit(POKER_EVENTS.HAND_DEALT, player, cards);
    eventBus.emit(TABLE_EVENTS.PLAYER_JOINED, player, table);
    
    // Verify all handlers were called with correct arguments
    expect(playerConnectedHandler).toHaveBeenCalledWith(player);
    expect(pokerHandDealtHandler).toHaveBeenCalledWith(player, cards);
    expect(tablePlayerJoinedHandler).toHaveBeenCalledWith(player, table);
  });

  test('should support one-time listeners for custom events', () => {
    const foldHandler = jest.fn();
    
    // Register a one-time handler
    eventBus.once(POKER_EVENTS.PLAYER_FOLDED, foldHandler);
    
    const player = { id: 'player1' };
    
    // Emit the event twice
    eventBus.emit(POKER_EVENTS.PLAYER_FOLDED, player);
    eventBus.emit(POKER_EVENTS.PLAYER_FOLDED, player);
    
    // Handler should only be called once
    expect(foldHandler).toHaveBeenCalledTimes(1);
    expect(foldHandler).toHaveBeenCalledWith(player);
  });

  test('should remove listeners for custom events', () => {
    const showdownHandler = jest.fn();
    
    // Register and then remove the handler
    eventBus.on(POKER_EVENTS.SHOWDOWN, showdownHandler);
    eventBus.off(POKER_EVENTS.SHOWDOWN, showdownHandler);
    
    // Emit the event
    eventBus.emit(POKER_EVENTS.SHOWDOWN, { players: [{ id: 'player1' }, { id: 'player2' }] });
    
    // Handler should not be called
    expect(showdownHandler).not.toHaveBeenCalled();
  });

  test('should debug monitor custom events with filtering', () => {
    const mockLogger = jest.fn();
    
    // Only monitor poker events
    eventBus.debugMonitor(true, (eventName) => eventName.startsWith('poker:'), mockLogger);
    
    // Emit both built-in and custom events
    eventBus.emit(PLAYER_EVENTS.CONNECTED, { id: 'player1' });
    eventBus.emit(POKER_EVENTS.BETTING_ROUND_STARTED, { id: 'table1' }, 10);
    eventBus.emit(TABLE_EVENTS.CREATED, { id: 'table2' });
    eventBus.emit(POKER_EVENTS.PLAYER_RAISED, { id: 'player2' }, 20);
    
    // Only poker events should be logged
    expect(mockLogger).toHaveBeenCalledTimes(2);
    expect(mockLogger).toHaveBeenCalledWith('[EVENT] poker:betting:started', { id: 'table1' }, 10);
    expect(mockLogger).toHaveBeenCalledWith('[EVENT] poker:player:raised', { id: 'player2' }, 20);
    expect(mockLogger).not.toHaveBeenCalledWith('[EVENT] player:connected', { id: 'player1' });
    expect(mockLogger).not.toHaveBeenCalledWith('[EVENT] table:created', { id: 'table2' });
  });

  test('should allow creation of game-specific event wrappers', () => {
    // Example of a game-specific event wrapper class
    class PokerEventBus {
      private eventBus: EventBus;
      
      constructor(eventBus: EventBus) {
        this.eventBus = eventBus;
      }
      
      public onHandDealt(listener: (player: any, cards: any[]) => void): void {
        this.eventBus.on(POKER_EVENTS.HAND_DEALT, listener);
      }
      
      public onBettingRoundStarted(listener: (table: any, minBet: number) => void): void {
        this.eventBus.on(POKER_EVENTS.BETTING_ROUND_STARTED, listener);
      }
      
      public emitHandDealt(player: any, cards: any[]): void {
        this.eventBus.emit(POKER_EVENTS.HAND_DEALT, player, cards);
      }
      
      public emitBettingRoundStarted(table: any, minBet: number): void {
        this.eventBus.emit(POKER_EVENTS.BETTING_ROUND_STARTED, table, minBet);
      }
    }
    
    // Create the wrapper
    const pokerEvents = new PokerEventBus(eventBus);
    
    // Test data
    const player = { id: 'player1' };
    const cards = [{ suit: 'hearts', value: 'A' }, { suit: 'spades', value: 'K' }];
    const table = { id: 'table1' };
    
    // Set up listeners
    const handDealtListener = jest.fn();
    const bettingStartedListener = jest.fn();
    
    pokerEvents.onHandDealt(handDealtListener);
    pokerEvents.onBettingRoundStarted(bettingStartedListener);
    
    // Emit events through the wrapper
    pokerEvents.emitHandDealt(player, cards);
    pokerEvents.emitBettingRoundStarted(table, 25);
    
    // Verify listeners were called with correct arguments
    expect(handDealtListener).toHaveBeenCalledWith(player, cards);
    expect(bettingStartedListener).toHaveBeenCalledWith(table, 25);
  });

  test('should combine built-in and custom events in monitoring', () => {
    // Create an event combination for monitoring
    const combinedEvents = {
      ...EVENTS,
      POKER: POKER_EVENTS
    };
    
    // Test data
    const player = { id: 'player1' };
    const table = { id: 'table1' };
    
    // Handle some specific events to ensure events are properly published
    const playerConnectedHandler = jest.fn();
    const tableCreatedHandler = jest.fn();
    const pokerShowdownHandler = jest.fn();
    
    eventBus.on(combinedEvents.PLAYER.CONNECTED, playerConnectedHandler);
    eventBus.on(combinedEvents.TABLE.CREATED, tableCreatedHandler);
    eventBus.on(combinedEvents.POKER.SHOWDOWN, pokerShowdownHandler);
    
    // Emit events
    eventBus.emit(combinedEvents.PLAYER.CONNECTED, player);
    eventBus.emit(combinedEvents.TABLE.CREATED, table);
    eventBus.emit(combinedEvents.POKER.SHOWDOWN, { players: [player] });
    
    // Verify all handlers were called
    expect(playerConnectedHandler).toHaveBeenCalledWith(player);
    expect(tableCreatedHandler).toHaveBeenCalledWith(table);
    expect(pokerShowdownHandler).toHaveBeenCalledWith({ players: [player] });
  });
}); 