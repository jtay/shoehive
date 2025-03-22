import { Lobby } from "../core/Lobby";

/**
 * Lobby events.
 * 
 * You can use these events to listen for changes in the lobby state, or to trigger actions based on lobby events.
 * Most events are emitted by the Shoehive lobby, but some are emitted from bubbling up from the table, player, or game.
 */
export const LOBBY_EVENTS = {
    UPDATED: "lobby:updated",
    ATTRIBUTE_CHANGED: "lobby:attribute:changed",
    ATTRIBUTES_CHANGED: "lobby:attributes:changed"
} as const;

/**
 * These are the payload structures for native Lobby events.
 * 
 * You can use these payloads to listen for changes in the lobby state, or to trigger actions based on lobby events.
 */
export interface DefaultLobbyEventPayloadMap {
    [LOBBY_EVENTS.UPDATED]: [lobby: Lobby];
    [LOBBY_EVENTS.ATTRIBUTE_CHANGED]: [lobby: Lobby, key: string, value: any];
    [LOBBY_EVENTS.ATTRIBUTES_CHANGED]: [lobby: Lobby, changedKeys: string[], attributes: Record<string, any>];
}