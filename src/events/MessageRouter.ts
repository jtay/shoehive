import { Player } from "../core/Player";
import { EventBus } from "./EventBus";
import { CLIENT_MESSAGE_TYPES, CLIENT_COMMAND_TYPES } from "../core/commands/index";

interface Message {
  action: string;
  tableId?: string;
  [key: string]: any;
}

export class MessageRouter {
  private eventBus: EventBus;
  private commandHandlers: Map<string, (player: Player, data: any) => void>;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.commandHandlers = new Map();
    
    // Register built-in command handlers
    this.registerStateCommandHandlers();
    this.registerLobbyCommandHandlers();
    this.registerTableCommandHandlers();
  }

  /**
   * Register a command handler for a specific action. For example, if you
   * want a user to be able to make a choice, you could register `game:choice:make`
   * and then handle it in your game logic.
   * @param action - The action to register the handler for
   * @param handler - The handler function to be called when the action is received
   */
  public registerCommandHandler({ action, handler }: { action: string, handler: (player: Player, data: any) => void }): void {
    this.commandHandlers.set(action, handler);
  }

  /**
   * Register handlers for state request commands
   */
  private registerStateCommandHandlers(): void {
    // Player state
    this.registerCommandHandler({ action: CLIENT_COMMAND_TYPES.PLAYER.GET_STATE, handler: (player, data) => {
                player.sendMessage({ message: {
                              type: CLIENT_MESSAGE_TYPES.PLAYER.STATE,
                              data: {
                                id: player.id,
                                attributes: player.getAttributes()
                              }
                            } });
              } });
    
    // Table state
    this.registerCommandHandler({ action: CLIENT_COMMAND_TYPES.TABLE.GET_STATE, handler: (player, data) => {
                const table = player.getTable();
                if (table) {
                  player.sendMessage({ message: {
                                  type: CLIENT_MESSAGE_TYPES.TABLE.STATE,
                                  data: table.getTableState({})
                                } });
                } else {
                  player.sendMessage({ message: {
                                  type: CLIENT_MESSAGE_TYPES.ERROR,
                                  message: "You are not at a table"
                                } });
                }
              } });
    
    // Lobby state
    this.registerCommandHandler({ action: CLIENT_COMMAND_TYPES.LOBBY.GET_STATE, handler: (player, data) => {
                this.eventBus.emit('request:lobby:state', { player });
              } });
  }

  /**
   * Register handlers for lobby commands
   */
  private registerLobbyCommandHandlers(): void {
    // Join table
    this.registerCommandHandler({ action: CLIENT_COMMAND_TYPES.LOBBY.JOIN_TABLE, handler: (player, data) => {
                if (!data.tableId) {
                  player.sendMessage({ message: {
                                  type: CLIENT_MESSAGE_TYPES.ERROR,
                                  message: "Missing tableId parameter"
                                } });
                  return;
                }

                this.eventBus.emit('request:table:join', { player, tableId: data.tableId });
              } });

    // Create table
    this.registerCommandHandler({ action: CLIENT_COMMAND_TYPES.LOBBY.CREATE_TABLE, handler: (player, data) => {
                if (!data.gameId) {
                  player.sendMessage({ message: {
                                  type: CLIENT_MESSAGE_TYPES.ERROR,
                                  message: "Missing gameId parameter"
                                } });
                  return;
                }

                this.eventBus.emit('request:table:create', { player, gameId: data.gameId, options: data.options });
              } });
  }

  /**
   * Register handlers for table commands
   */
  private registerTableCommandHandlers(): void {
    // Join table
    this.registerCommandHandler({ action: CLIENT_COMMAND_TYPES.TABLE.JOIN, handler: (player, data) => {
                if (!data.tableId) {
                  player.sendMessage({ message: {
                                  type: CLIENT_MESSAGE_TYPES.ERROR,
                                  message: "Missing tableId parameter"
                                } });
                  return;
                }

                this.eventBus.emit('request:table:join', { player, tableId: data.tableId });
              } });

    // Leave table
    this.registerCommandHandler({ action: CLIENT_COMMAND_TYPES.TABLE.LEAVE, handler: (player, data) => {
                const table = player.getTable();
                if (!table) {
                  player.sendMessage({ message: {
                                  type: CLIENT_MESSAGE_TYPES.ERROR,
                                  message: "You are not at a table"
                                } });
                  return;
                }

                this.eventBus.emit('request:table:leave', { player, tableId: table.id });
              } });

    // Create table
    this.registerCommandHandler({ action: CLIENT_COMMAND_TYPES.TABLE.CREATE, handler: (player, data) => {
                if (!data.gameId) {
                  player.sendMessage({ message: {
                                  type: CLIENT_MESSAGE_TYPES.ERROR,
                                  message: "Missing gameId parameter"
                                } });
                  return;
                }

                this.eventBus.emit('request:table:create', { player, gameId: data.gameId, options: data.options });
              } });

    // Sit at seat
    this.registerCommandHandler({ action: CLIENT_COMMAND_TYPES.TABLE.SEAT_SIT, handler: (player, data) => {
                const table = player.getTable();
                if (!table) {
                  player.sendMessage({ message: {
                                  type: CLIENT_MESSAGE_TYPES.ERROR,
                                  message: "You are not at a table"
                                } });
                  return;
                }

                if (data.seatIndex === undefined || data.seatIndex === null) {
                  player.sendMessage({ message: {
                                  type: CLIENT_MESSAGE_TYPES.ERROR,
                                  message: "Missing seatIndex parameter"
                                } });
                  return;
                }

                this.eventBus.emit('request:table:seat:sit', { player, tableId: table.id, seatIndex: data.seatIndex });
              } });

    // Stand from seat
    this.registerCommandHandler({ action: CLIENT_COMMAND_TYPES.TABLE.SEAT_STAND, handler: (player, data) => {
                const table = player.getTable();
                if (!table) {
                  player.sendMessage({ message: {
                                  type: CLIENT_MESSAGE_TYPES.ERROR,
                                  message: "You are not at a table"
                                } });
                  return;
                }

                this.eventBus.emit('request:table:seat:stand', { player, tableId: table.id });
              } });
  }

  /**
   * Process a message from the client.
   * @param player - The player object
   * @param messageStr - The message string to process
   */
  public processMessage({ player, messageStr }: { player: Player, messageStr: string }): void {
    try {
      const message = JSON.parse(messageStr) as Message;
      
      // Validate message format
      if (!message.action || typeof message.action !== "string") {
        player.sendMessage({ message: {
                        type: CLIENT_MESSAGE_TYPES.ERROR,
                        message: "Invalid message format: missing or invalid action"
                      } });
        return;
      }

      // First check if we have a registered command handler for this action
      const handler = this.commandHandlers.get(message.action);
      if (handler) {
        handler(player, message);
        return;
      }

      // Otherwise, treat it as an event from the client
      // We prefix with 'client:' to prevent spoofing of internal server events
      const clientAction = message.action.startsWith("client:") 
        ? message.action 
        : `client:${message.action}`;
      this.eventBus.emit(clientAction, { player, message });
      
    } catch (error) {
      console.error("Error processing message:", error);
      player.sendMessage({ message: {
                    type: CLIENT_MESSAGE_TYPES.ERROR,
                    message: "Failed to process message"
                  } });
    }
  }
} 