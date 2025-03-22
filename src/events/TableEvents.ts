import { Table } from "../core/Table";
import { Player } from "../core/Player";

/**
 * Table events
 * 
 * This is a comprehensive list of all events that can be emitted by the Table class.
 * 
 * You can use these events to listen for changes in the table state, or to trigger actions based on table events.
 */
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

/**
 * These are the payload structures for native Table events.
 * 
 * You can use these payloads to listen for changes in the table state, or to trigger actions based on table events.
 */
export interface DefaultTableEventPayloadMap {
    [TABLE_EVENTS.CREATED]: [table: Table];
    [TABLE_EVENTS.EMPTY]: [table: Table];
    [TABLE_EVENTS.STATE_UPDATED]: [table: Table];
    [TABLE_EVENTS.ATTRIBUTE_CHANGED]: [table: Table, key: string, value: any];
    [TABLE_EVENTS.ATTRIBUTES_CHANGED]: [table: Table, changedKeys: string[], attributes: Record<string, any>];
    [TABLE_EVENTS.PLAYER_JOINED]: [table: Table, player: Player];
    [TABLE_EVENTS.PLAYER_LEFT]: [table: Table, player: Player];
    [TABLE_EVENTS.PLAYER_SAT]: [table: Table, player: Player, seatIndex: number];
    [TABLE_EVENTS.PLAYER_STOOD]: [table: Table, player: Player, seatIndex: number];
    [TABLE_EVENTS.DECK_CREATED]: [table: Table, deckId: string];
    [TABLE_EVENTS.DECK_SHUFFLED]: [table: Table, deckId: string];
    [TABLE_EVENTS.DECK_CARD_DRAWN]: [table: Table, deckId: string, card: any];
    [TABLE_EVENTS.CARD_DEALT]: [table: Table, player: Player, card: any];
    [TABLE_EVENTS.SEAT_HAND_ADDED]: [table: Table, seatIndex: number, handId: string];
    [TABLE_EVENTS.SEAT_HAND_REMOVED]: [table: Table, seatIndex: number, handId: string];
    [TABLE_EVENTS.SEAT_HAND_CLEARED]: [table: Table, seatIndex: number];
    [TABLE_EVENTS.SEATS_HANDS_CLEARED]: [table: Table];
}