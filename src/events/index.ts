/**
 * events/index.ts
 * 
 * This file exports all event-related types, constants, and classes
 * to make them easily accessible by consumers of the library.
 */

export { 
  // Event constants
  PLAYER_EVENTS,
  TABLE_EVENTS,
  LOBBY_EVENTS,
  EVENTS,
  
  // Event types
  PlayerEventType,
  TableEventType,
  LobbyEventType,
  BuiltInEventType,
  CustomEventMap,
  EventType,
  
  // Payload types
  EventPayloadMap,
  DefaultEventPayloadMap
} from './EventTypes';

export { EventBus } from './EventBus';
export { MessageRouter } from './MessageRouter'; 