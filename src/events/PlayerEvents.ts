import { Player } from "../core/Player";

/**
 * Player events.
 * 
 * You can use these events to listen for changes in the player state, or to trigger actions based on player events.
 */
export const PLAYER_EVENTS = {
    // Player connection events
    CONNECTED: "player:connected",
    DISCONNECTED: "player:disconnected",
    RECONNECTED: "player:reconnected",
    REMOVED: "player:removed",
    // Player state events
    STATE_UPDATED: "player:state:updated",
    ATTRIBUTE_CHANGED: "player:attribute:changed",
    ATTRIBUTES_CHANGED: "player:attributes:changed",
    // Player authentication events
    AUTHENTICATION_FAILED: "player:authentication:failed",
    AUTHENTICATION_SUCCEEDED: "player:authentication:succeeded"
} as const;

/**
 * These are the payload structures for native Player events.
 * 
 * You can use these payloads to listen for changes in the player state, or to trigger actions based on player events.
 */
export interface DefaultPlayerEventPayloadMap {
  [PLAYER_EVENTS.CONNECTED]: [player: Player];
  [PLAYER_EVENTS.DISCONNECTED]: [player: Player];
  [PLAYER_EVENTS.RECONNECTED]: [player: Player];
  [PLAYER_EVENTS.REMOVED]: [player: Player];
  [PLAYER_EVENTS.STATE_UPDATED]: [player: Player];
  [PLAYER_EVENTS.ATTRIBUTE_CHANGED]: [player: Player, key: string, value: any];
  [PLAYER_EVENTS.ATTRIBUTES_CHANGED]: [player: Player, changedKeys: string[], attributes: Record<string, any>];
  [PLAYER_EVENTS.AUTHENTICATION_FAILED]: [player: Player, reason: string];
  [PLAYER_EVENTS.AUTHENTICATION_SUCCEEDED]: [player: Player];
}
