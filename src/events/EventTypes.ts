import { 
  LOBBY_EVENTS, 
  DefaultLobbyEventPayloadMap 
} from "./LobbyEvents";
import { 
  PLAYER_EVENTS, 
  DefaultPlayerEventPayloadMap 
} from "./PlayerEvents";
import { 
  TABLE_EVENTS, 
  DefaultTableEventPayloadMap 
} from "./TableEvents";

// Re-export the event constants so they can be imported from EventTypes.ts
export { LOBBY_EVENTS, PLAYER_EVENTS, TABLE_EVENTS };

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

// Create union types of all event string literals
export type PlayerEventType = typeof PLAYER_EVENTS[keyof typeof PLAYER_EVENTS];
export type TableEventType = typeof TABLE_EVENTS[keyof typeof TABLE_EVENTS];
export type LobbyEventType = typeof LOBBY_EVENTS[keyof typeof LOBBY_EVENTS];

// Create a union type of all built-in possible event names
export type BuiltInEventType = PlayerEventType | TableEventType | LobbyEventType;

// Combined event type including built-in and custom events
export type EventType = BuiltInEventType | (CustomEventMap extends Record<string, infer E> ? E : never);

// Helper type to extract the payload type for a specific event
export type EventPayloadMap<TMap extends Record<string, any>> = {
  [K in keyof TMap]: any;
};

/**
 * Combined default event payload map for all built-in events
 * 
 * This is a combined type that includes all the payload types for all the built-in events.
 * 
 * You can use this type to listen for changes in the state, or to trigger actions based on events.
 */
export type DefaultEventPayloadMap = 
  DefaultPlayerEventPayloadMap & 
  DefaultTableEventPayloadMap & 
  DefaultLobbyEventPayloadMap;

// Export all event constants in a single object for convenience
export const EVENTS = {
  PLAYER: PLAYER_EVENTS,
  TABLE: TABLE_EVENTS,
  LOBBY: LOBBY_EVENTS,
} as const;