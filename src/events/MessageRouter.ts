import { Player } from "../core/Player";
import { EventBus } from "./EventBus";
import { CLIENT_MESSAGE_TYPES } from "../core/commands/index";

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
  }

  /**
   * Register a command handler for a specific action. For example, if you
   * want a user to be able to make a choice, you could register `game:choice:make`
   * and then handle it in your game logic.
   * @param action - The action to register the handler for
   * @param handler - The handler function to be called when the action is received
   */
  public registerCommandHandler(
    action: string,
    handler: (player: Player, data: any) => void
  ): void {
    this.commandHandlers.set(action, handler);
  }

  /**
   * Process a message from the client.
   * @param player - The player object
   * @param messageStr - The message string to process
   */
  public processMessage(player: Player, messageStr: string): void {
    try {
      const message = JSON.parse(messageStr) as Message;
      
      // Validate message format
      if (!message.action || typeof message.action !== "string") {
        player.sendMessage({
          type: CLIENT_MESSAGE_TYPES.ERROR,
          message: "Invalid message format: missing or invalid action"
        });
        return;
      }

      // First check if we have a registered command handler for this action
      const handler = this.commandHandlers.get(message.action);
      if (handler) {
        handler(player, message);
        return;
      }

      // Otherwise, treat it as an event
      this.eventBus.emit(message.action, player, message);
      
    } catch (error) {
      console.error("Error processing message:", error);
      player.sendMessage({
        type: CLIENT_MESSAGE_TYPES.ERROR,
        message: "Failed to process message"
      });
    }
  }
} 