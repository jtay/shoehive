/**
 * OutboundClientMessageTypes.ts
 * 
 * This file contains the types of messages that can be sent from the game server to the client.
 * 
 */

export const LOBBY_MESSAGE_TYPES = {
    STATE: "lobby:state",
}

export const TABLE_MESSAGE_TYPES = {
    STATE: "table:state",
}

export const PLAYER_MESSAGE_TYPES = {
    STATE: "player:state",
}

export const CLIENT_MESSAGE_TYPES = {
    LOBBY: LOBBY_MESSAGE_TYPES,
    TABLE: TABLE_MESSAGE_TYPES,
    PLAYER: PLAYER_MESSAGE_TYPES,
    ERROR: "error",
}

export type BuiltInClientMessageType = typeof CLIENT_MESSAGE_TYPES[keyof typeof CLIENT_MESSAGE_TYPES];
