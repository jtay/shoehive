import { Player } from "./core/Player";
import { Table, TableState } from "./core/Table";
import { TableFactory } from "./core/TableFactory";
import { WebSocketManager, AuthProvider } from "./core/WebSocketManager";
import { EventBus } from "./events/EventBus";
import { MessageRouter } from "./events/MessageRouter";
import * as http from "http";

// Export all the classes
export {
  Player,
  Table,
  TableState,
  TableFactory,
  WebSocketManager,
  EventBus,
  MessageRouter
};

export function createGameServer(
  server: http.Server,
  authProvider?: AuthProvider
) {
  const eventBus = new EventBus();
  const messageRouter = new MessageRouter(eventBus);
  const tableFactory = new TableFactory(eventBus);
  const wsManager = new WebSocketManager(server, eventBus, messageRouter, authProvider);
  
  return {
    eventBus,
    messageRouter,
    tableFactory,
    wsManager
  };
} 