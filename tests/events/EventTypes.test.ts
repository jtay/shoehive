import { 
  PLAYER_EVENTS, 
  TABLE_EVENTS, 
  LOBBY_EVENTS, 
  EVENTS, 
  EventType,
  PlayerEventType,
  TableEventType,
  LobbyEventType,
} from '../../src/events/EventTypes';

describe('EventTypes', () => {
  test('PLAYER_EVENTS should have all expected event names', () => {
    expect(PLAYER_EVENTS).toEqual({
      CONNECTED: "player:connected",
      DISCONNECTED: "player:disconnected",
      RECONNECTED: "player:reconnected",
      STATE_UPDATED: "player:state:updated",
      ATTRIBUTE_CHANGED: "player:attribute:changed",
      ATTRIBUTES_CHANGED: "player:attributes:changed",
      AUTHENTICATION_FAILED: "player:authentication:failed",
      AUTHENTICATION_SUCCEEDED: "player:authentication:succeeded"
    });
  });

  test('TABLE_EVENTS should have all expected event names', () => {
    expect(TABLE_EVENTS).toHaveProperty('CREATED', 'table:created');
    expect(TABLE_EVENTS).toHaveProperty('EMPTY', 'table:empty');
    expect(TABLE_EVENTS).toHaveProperty('STATE_UPDATED', 'table:state:updated');
    expect(TABLE_EVENTS).toHaveProperty('ATTRIBUTE_CHANGED', 'table:attribute:changed');
    expect(TABLE_EVENTS).toHaveProperty('ATTRIBUTES_CHANGED', 'table:attributes:changed');
    expect(TABLE_EVENTS).toHaveProperty('PLAYER_JOINED', 'table:player:joined');
    expect(TABLE_EVENTS).toHaveProperty('PLAYER_LEFT', 'table:player:left');
    expect(TABLE_EVENTS).toHaveProperty('PLAYER_SAT', 'table:player:sat');
    expect(TABLE_EVENTS).toHaveProperty('PLAYER_STOOD', 'table:player:stood');
    expect(TABLE_EVENTS).toHaveProperty('DECK_CREATED', 'table:deck:created');
    expect(TABLE_EVENTS).toHaveProperty('DECK_SHUFFLED', 'table:deck:shuffled');
    expect(TABLE_EVENTS).toHaveProperty('DECK_CARD_DRAWN', 'table:deck:card:drawn');
    expect(TABLE_EVENTS).toHaveProperty('CARD_DEALT', 'table:card:dealt');
    expect(TABLE_EVENTS).toHaveProperty('SEAT_HAND_ADDED', 'table:seat:hand:added');
    expect(TABLE_EVENTS).toHaveProperty('SEAT_HAND_REMOVED', 'table:seat:hand:removed');
    expect(TABLE_EVENTS).toHaveProperty('SEAT_HAND_CLEARED', 'table:seat:hand:cleared');
    expect(TABLE_EVENTS).toHaveProperty('SEATS_HANDS_CLEARED', 'table:seats:hands:cleared');
  });

  test('LOBBY_EVENTS should have all expected event names', () => {
    expect(LOBBY_EVENTS).toEqual({
      UPDATED: "lobby:updated",
      STATE: "lobby:state"
    });
  });

  test('EVENTS should expose all event groups', () => {
    expect(EVENTS).toHaveProperty('PLAYER', PLAYER_EVENTS);
    expect(EVENTS).toHaveProperty('TABLE', TABLE_EVENTS);
    expect(EVENTS).toHaveProperty('LOBBY', LOBBY_EVENTS);
  });

  test('should allow use of specific event types', () => {
    // These tests verify our type definitions work correctly at runtime
    // The TypeScript compiler would catch type errors, but we're making sure
    // that the expected values are actually assigned to each type
    
    // Test using the PlayerEventType
    const playerConnected: PlayerEventType = PLAYER_EVENTS.CONNECTED;
    expect(playerConnected).toBe('player:connected');
    
    // Test using the TableEventType
    const tableCreated: TableEventType = TABLE_EVENTS.CREATED;
    expect(tableCreated).toBe('table:created');
    
    // Test using the LobbyEventType
    const lobbyUpdated: LobbyEventType = LOBBY_EVENTS.UPDATED;
    expect(lobbyUpdated).toBe('lobby:updated');
    
    // Test using the combined EventType
    const eventTypes: EventType[] = [
      PLAYER_EVENTS.CONNECTED,
      TABLE_EVENTS.CREATED,
      LOBBY_EVENTS.UPDATED
    ];
    
    expect(eventTypes).toEqual([
      'player:connected',
      'table:created',
      'lobby:updated',
    ]);
  });
  
  test('should allow extending with custom events', () => {
    // Example of custom event constants that a game developer might create
    const CUSTOM_EVENTS = {
      GAME_SPECIFIC: "custom:game:specific",
      ANOTHER_EVENT: "custom:another:event"
    } as const;
    
    type CustomEventType = typeof CUSTOM_EVENTS[keyof typeof CUSTOM_EVENTS];
    
    // These assertions verify that we can use both built-in and custom event types together
    const combinedEvents: (EventType | CustomEventType)[] = [
      PLAYER_EVENTS.CONNECTED,
      CUSTOM_EVENTS.GAME_SPECIFIC,
      TABLE_EVENTS.CREATED,
      CUSTOM_EVENTS.ANOTHER_EVENT
    ];
    
    expect(combinedEvents).toEqual([
      'player:connected',
      'custom:game:specific',
      'table:created',
      'custom:another:event'
    ]);
  });
}); 