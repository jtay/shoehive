/**
 * InboundClientCommandTypes.ts
 * 
 * This file contains the types of commands that can be sent from the client to the game server.
 */

export const LOBBY_COMMAND_TYPES = {
    GET_STATE: "lobby:state:get",
    JOIN_TABLE: "lobby:table:join",
    CREATE_TABLE: "lobby:table:create"
}

export const TABLE_COMMAND_TYPES = {
    GET_STATE: "table:state:get",
    JOIN: "table:join",
    LEAVE: "table:leave",
    CREATE: "table:create",
    SEAT_SIT: "table:seat:sit",
    SEAT_STAND: "table:seat:stand"
}

export const PLAYER_COMMAND_TYPES = {
    GET_STATE: "player:state:get"
}

export const CLIENT_COMMAND_TYPES = {
    LOBBY: LOBBY_COMMAND_TYPES,
    TABLE: TABLE_COMMAND_TYPES,
    PLAYER: PLAYER_COMMAND_TYPES
}

export type BuiltInClientCommandType = typeof CLIENT_COMMAND_TYPES[keyof typeof CLIENT_COMMAND_TYPES];

