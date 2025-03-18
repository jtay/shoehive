import { Player } from "./core/Player";
import { Table, TableState } from "./core/Table";
import { TableFactory } from "./core/TableFactory";
import { WebSocketManager, AuthProvider } from "./core/WebSocketManager";
import { EventBus } from "./events/EventBus";
import { MessageRouter } from "./events/MessageRouter";
import { GameManager, GameDefinition } from "./core/GameManager";
import * as http from "http";

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
  GameDefinition
};

export function createGameServer(
  server: http.Server,
  authProvider?: AuthProvider
) {
  const eventBus = new EventBus();
  const messageRouter = new MessageRouter(eventBus);
  const tableFactory = new TableFactory(eventBus);
  const gameManager = new GameManager(eventBus, tableFactory);
  const wsManager = new WebSocketManager(server, eventBus, messageRouter, gameManager, authProvider);
  
  // Register default message handlers
  messageRouter.registerCommandHandler("joinTable", (player, data) => {
    if (!data.tableId) return;
    
    const table = gameManager.getAllTables().find(t => t.id === data.tableId);
    if (table) {
      table.addPlayer(player);
    }
  });
  
  messageRouter.registerCommandHandler("createTable", (player, data) => {
    if (!data.gameId) return;
    
    const table = gameManager.createTable(data.gameId, data.options);
    if (table) {
      table.addPlayer(player);
    }
  });
  
  messageRouter.registerCommandHandler("leaveTable", (player, data) => {
    const table = player.getTable();
    if (table) {
      table.removePlayer(player.id);
    }
  });
  
  messageRouter.registerCommandHandler("sitDown", (player, data) => {
    if (typeof data.seatIndex !== 'number') return;
    
    const table = player.getTable();
    if (table) {
      table.sitPlayerAtSeat(player.id, data.seatIndex);
    }
  });
  
  messageRouter.registerCommandHandler("standUp", (player, data) => {
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
    wsManager
  };
} 