/**
 * EventTypes.ts
 * 
 * This file contains centralized event name constants and types for the Shoehive framework.
 * Using these constants instead of string literals provides several benefits:
 * - Type safety with TypeScript's literal types
 * - Autocomplete support in IDEs
 * - Consistent event naming across the codebase
 * - Easier refactoring if event names need to change
 * 
 * Event Naming Convention:
 * Events follow a namespaced pattern with colon separators: "domain:action" or "domain:subdomain:action"
 * Examples: "player:connected", "table:player:joined", "table:state:changed"
 * 
 * This hierarchical naming helps with:
 * 1. Organization - Events are grouped by domain
 * 2. Clarity - Event names clearly describe what happened
 * 3. Avoiding collisions - Reduces the chance of duplicate event names
 * 
 * External Usage:
 * Developers using this library can extend the event system by:
 * 1. Creating their own event constants following the same pattern
 * 2. Using the CustomEventMap type to register their event types
 * 3. Using eventBus.registerCustomEvents<MyCustomEvents>() to extend the type system
 */

import { Player } from "../core/Player";
import { Table } from "../core/Table";

// Player events
export const PLAYER_EVENTS = {
  // Player connection events
  CONNECTED: "player:connected",
  DISCONNECTED: "player:disconnected",
  RECONNECTED: "player:reconnected",
  // Player state events
  STATE_UPDATED: "player:state:updated",
  ATTRIBUTE_CHANGED: "player:attribute:changed",
  ATTRIBUTES_CHANGED: "player:attributes:changed",
  // Player authentication events
  AUTHENTICATION_FAILED: "player:authentication:failed",
  AUTHENTICATION_SUCCEEDED: "player:authentication:succeeded"
} as const;

// Table events
export const TABLE_EVENTS = {
  // Table creation events
  CREATED: "table:created",
  EMPTY: "table:empty",
  // Table state events
  STATE_UPDATED: "table:state:updated",
  ATTRIBUTE_CHANGED: "table:attribute:changed",
  ATTRIBUTES_CHANGED: "table:attributes:changed",
  // Player-related table events
  PLAYER_JOINED: "table:player:joined",
  PLAYER_LEFT: "table:player:left",
  PLAYER_SAT: "table:player:sat",
  PLAYER_STOOD: "table:player:stood",
  // Deck-related table events
  DECK_CREATED: "table:deck:created",
  DECK_SHUFFLED: "table:deck:shuffled",
  DECK_CARD_DRAWN: "table:deck:card:drawn",
  
  // Card-related table events
  CARD_DEALT: "table:card:dealt",
  
  // Hand-related table events
  SEAT_HAND_ADDED: "table:seat:hand:added",
  SEAT_HAND_REMOVED: "table:seat:hand:removed",
  SEAT_HAND_CLEARED: "table:seat:hand:cleared",
  SEATS_HANDS_CLEARED: "table:seats:hands:cleared"
} as const;

// Lobby events
export const LOBBY_EVENTS = {
  UPDATED: "lobby:updated",
  STATE: "lobby:state"
} as const;

// Create union types of all event string literals
export type PlayerEventType = typeof PLAYER_EVENTS[keyof typeof PLAYER_EVENTS];
export type TableEventType = typeof TABLE_EVENTS[keyof typeof TABLE_EVENTS];
export type LobbyEventType = typeof LOBBY_EVENTS[keyof typeof LOBBY_EVENTS];

// Create a union type of all built-in possible event names
export type BuiltInEventType = PlayerEventType | TableEventType | LobbyEventType;

/**
 * Interface for custom event maps that consumers of the library can extend
 * 
 * Example usage:
 * ```
 * // Define your game event constants
 * const GAME_EVENTS = {
 *   STARTED: "game:started",
 *   ENDED: "game:ended",
 *   PAUSED: "game:paused",
 *   RESUMED: "game:resumed",
 *   ROUND_STARTED: "game:round:started",
 *   ROUND_ENDED: "game:round:ended",
 *   TURN_STARTED: "game:turn:started",
 *   TURN_ENDED: "game:turn:ended"
 * } as const;
 * 
 * // Define your game-specific event constants
 * const POKER_EVENTS = {
 *   HAND_DEALT: "poker:hand:dealt",
 *   BETTING_ROUND_STARTED: "poker:betting:started",
 *   PLAYER_CALLED: "poker:player:called",
 *   PLAYER_RAISED: "poker:player:raised",
 *   PLAYER_FOLDED: "poker:player:folded"
 * } as const;
 * 
 * // Create types for your custom events
 * type GameEventType = typeof GAME_EVENTS[keyof typeof GAME_EVENTS];
 * type PokerEventType = typeof POKER_EVENTS[keyof typeof POKER_EVENTS];
 * 
 * // Extend the event system
 * declare module "shoehive" {
 *   interface CustomEventMap {
 *     gameEvents: GameEventType;
 *     pokerEvents: PokerEventType;
 *   }
 * }
 * ```
 */
export interface CustomEventMap {}

// Combined event type including built-in and custom events
export type EventType = BuiltInEventType | (CustomEventMap extends Record<string, infer E> ? E : never);

// Helper type to extract the payload type for a specific event
export type EventPayloadMap<TMap extends Record<string, any>> = {
  [K in keyof TMap]: any;
};

/**
 * Default payload map for built-in events
 * This can be extended by consumers of the library to add type information for event payloads
 */
export interface DefaultEventPayloadMap {
  [PLAYER_EVENTS.CONNECTED]: [player: Player];
  [PLAYER_EVENTS.DISCONNECTED]: [player: Player];
  [TABLE_EVENTS.PLAYER_JOINED]: [player: Player, table: Table];
  [TABLE_EVENTS.PLAYER_LEFT]: [player: Player, table: Table];
  // Add more event payload types as needed
}

// Export all event constants in a single object for convenience
export const EVENTS = {
  PLAYER: PLAYER_EVENTS,
  TABLE: TABLE_EVENTS,
  LOBBY: LOBBY_EVENTS,
} as const; 