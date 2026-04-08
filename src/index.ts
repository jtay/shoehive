import { Player } from "./core/Player";
import { Table, TableState } from "./core/Table";
import { Card, CardSuit, CardRank, Deck, Hand } from "./core/card/index";
import { Seat } from "./core/Seat";
import { TableFactory } from "./core/TableFactory";
import { WebSocketManager } from "./core/WebSocketManager";
import { EventBus } from "./events/EventBus";
import { MessageRouter } from "./events/MessageRouter";
import { GameManager, GameDefinition } from "./core/GameManager";
import { Lobby } from "./core/Lobby";
import { AuthModule, ServerTransportModule, TransportModule } from "./transport";
import { CLIENT_COMMAND_TYPES, CLIENT_MESSAGE_TYPES } from "./core/commands/index";
import * as http from "http";

// Import all events-related exports
import { 
  PLAYER_EVENTS,
  TABLE_EVENTS,
  LOBBY_EVENTS,
  EVENTS,
  PlayerEventType,
  TableEventType,
  LobbyEventType,
  BuiltInEventType,
  CustomEventMap,
  EventType,
  EventPayloadMap,
} from "./events";

// Export all the classes
export {
  Player,
  Table,
  Seat,
  TableState,
  TableFactory,
  WebSocketManager,
  EventBus,
  MessageRouter,
  GameManager,
  GameDefinition,
  Lobby,
  // Export new transport modules
  AuthModule,
  ServerTransportModule,
  TransportModule,
  CLIENT_COMMAND_TYPES,
  CLIENT_MESSAGE_TYPES,
  // Export events
  PLAYER_EVENTS,
  TABLE_EVENTS,
  LOBBY_EVENTS,
  EVENTS,
  // Export event types
  PlayerEventType,
  TableEventType,
  LobbyEventType,
  BuiltInEventType,
  CustomEventMap,
  EventType,
  EventPayloadMap,
  // Deck of cards
  Card,
  CardSuit,
  CardRank,
  Deck,
  Hand
};

export function createGameServer({ server, authModule, serverTransportModule, options }: { server: http.Server, authModule?: AuthModule, serverTransportModule?: ServerTransportModule, options?: {
        /**
         * Optional timeout in milliseconds for player reconnection.
         * When a player disconnects, their game state is preserved for this duration.
         * If they reconnect within this time, they continue from where they left off.
         * If they don't reconnect within this time, they are removed from the game.
         * Default is 600000 (10 minutes). Set to 0 to disable reconnection.
         */
        reconnectionTimeoutMs?: number;
      } }) {
  const eventBus = new EventBus();
  const messageRouter = new MessageRouter(eventBus);
  const tableFactory = new TableFactory(eventBus);
  const gameManager = new GameManager(eventBus, tableFactory);
  const lobby = new Lobby(eventBus, gameManager, tableFactory);
  const wsManager = new WebSocketManager(
    server, 
    eventBus, 
    messageRouter, 
    gameManager, 
    authModule, 
    options?.reconnectionTimeoutMs || 600000,
    lobby,
    tableFactory
  );
  
  // Register default Lobby message handlers

  /**
   * Table commands
   */

  messageRouter.registerCommandHandler({ action: CLIENT_COMMAND_TYPES.TABLE.GET_STATE, handler: (player, data) => {
            if (!data.tableId) return;
            
            const table = gameManager.getTableById({ tableId: data.tableId });
            if (table) {
              player.sendMessage({ message: {
                            type: CLIENT_MESSAGE_TYPES.TABLE.STATE,
                            data: table.getState()
                          } });
            } else {
              console.error(`Failed to get table state: ${data.tableId}`);
            }
          } });

  messageRouter.registerCommandHandler({ action: CLIENT_COMMAND_TYPES.TABLE.JOIN, handler: (player, data) => {
            if (!data.tableId) return;
            
            const table = gameManager.getTableById({ tableId: data.tableId });
            if (table) {
              table.addPlayer({ player: player });
            } else {
              console.error(`Failed to join table: ${data.tableId}`);
            }
          } });
  
  messageRouter.registerCommandHandler({ action: CLIENT_COMMAND_TYPES.TABLE.CREATE, handler: (player, data) => {
            if (!data.gameId) {
              console.error(`Failed to create table: ${data.gameId} (no gameId provided)`);
              return;
            }
            
            const table = lobby.createTable({ gameId: data.gameId, options: data.options });
            if (table) {
              table.addPlayer({ player: player });
            } else {
              console.error(`Failed to create table: ${data.gameId}`);
            }
          } });
  
  messageRouter.registerCommandHandler({ action: CLIENT_COMMAND_TYPES.TABLE.LEAVE, handler: (player, data) => {
            const table = player.getTable();
            if (table) {
              table.removePlayer({ playerId: player.id });
            } else {
              console.error(`Failed to leave table`);
            }
          } });

  /**
   * Seat commands
   */
  
  messageRouter.registerCommandHandler({ action: CLIENT_COMMAND_TYPES.TABLE.SEAT_SIT, handler: (player, data) => {
            if (typeof data.seatIndex !== 'number') return;
            
            const table = player.getTable();
            if (table) {
              table.sitPlayerAtSeat({ playerId: player.id, seatIndex: data.seatIndex });
            } else {
              console.error(`Failed to sit player at seat: ${data.seatIndex}`);
            }
          } });
  
  messageRouter.registerCommandHandler({ action: CLIENT_COMMAND_TYPES.TABLE.SEAT_STAND, handler: (player, data) => {
            if (typeof data.seatIndex !== 'number') return;
            
            const table = player.getTable();
            if (table) {
              table.removePlayerFromSeat({ seatIndex: data.seatIndex });
            } else {
              console.error(`Failed to stand up from seat: ${data.seatIndex}`);
            }
          } });
  
  return {
    eventBus,
    messageRouter,
    tableFactory,
    gameManager,
    lobby,
    wsManager,
    // Add transport modules to the returned object
    transport: {
      auth: authModule,
      server: serverTransportModule
    }
  };
} 