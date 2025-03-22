import { Player } from "./core/Player";
import { Table, TableState } from "./core/Table";
import { Card, CardSuit, CardRank, Deck, Hand } from "./core/card/index";
import { TableFactory } from "./core/TableFactory";
import { WebSocketManager } from "./core/WebSocketManager";
import { EventBus } from "./events/EventBus";
import { MessageRouter } from "./events/MessageRouter";
import { GameManager, GameDefinition } from "./core/GameManager";
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
  DefaultEventPayloadMap
} from "./events";

// Export all the classes
export {
  Player,
  Table,
  TableState,
  TableFactory,
  WebSocketManager,
  EventBus,
  MessageRouter,
  GameManager,
  GameDefinition,
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
  DefaultEventPayloadMap,
  // Deck of cards
  Card,
  CardSuit,
  CardRank,
  Deck,
  Hand
};

export function createGameServer(
  server: http.Server,
  authModule?: AuthModule,
  serverTransportModule?: ServerTransportModule
) {
  const eventBus = new EventBus();
  const messageRouter = new MessageRouter(eventBus);
  const tableFactory = new TableFactory(eventBus);
  const gameManager = new GameManager(eventBus, tableFactory);
  const wsManager = new WebSocketManager(server, eventBus, messageRouter, gameManager, authModule);
  
  // Register default Lobby message handlers

  /**
   * Table commands
   */

  messageRouter.registerCommandHandler(CLIENT_COMMAND_TYPES.TABLE.GET_STATE, (player, data) => {
    if (!data.tableId) return;
    
    const table = gameManager.getAllTables().find(t => t.id === data.tableId);
    if (table) {
      player.sendMessage({
        type: CLIENT_MESSAGE_TYPES.TABLE.STATE,
        state: table.getState()
      });
    }
  });

  messageRouter.registerCommandHandler(CLIENT_COMMAND_TYPES.TABLE.JOIN, (player, data) => {
    if (!data.tableId) return;
    
    const table = gameManager.getAllTables().find(t => t.id === data.tableId);
    if (table) {
      table.addPlayer(player);
    }
  });
  
  messageRouter.registerCommandHandler(CLIENT_COMMAND_TYPES.TABLE.CREATE, (player, data) => {
    if (!data.gameId) return;
    
    const table = gameManager.createTable(data.gameId, data.options);
    if (table) {
      table.addPlayer(player);
    }
  });
  
  messageRouter.registerCommandHandler(CLIENT_COMMAND_TYPES.TABLE.LEAVE, (player, data) => {
    const table = player.getTable();
    if (table) {
      table.removePlayer(player.id);
    }
  });

  /**
   * Seat commands
   */
  
  messageRouter.registerCommandHandler(CLIENT_COMMAND_TYPES.TABLE.SEAT_SIT, (player, data) => {
    if (typeof data.seatIndex !== 'number') return;
    
    const table = player.getTable();
    if (table) {
      table.sitPlayerAtSeat(player.id, data.seatIndex);
    }
  });
  
  messageRouter.registerCommandHandler(CLIENT_COMMAND_TYPES.TABLE.SEAT_STAND, (player, data) => {
    if (typeof data.seatIndex !== 'number') return;
    
    const table = player.getTable();
    if (table) {
      table.removePlayerFromSeat(data.seatIndex);
    }
  });
  
  return {
    eventBus,
    messageRouter,
    tableFactory,
    gameManager,
    wsManager,
    // Add transport modules to the returned object
    transport: {
      auth: authModule,
      server: serverTransportModule
    }
  };
} 