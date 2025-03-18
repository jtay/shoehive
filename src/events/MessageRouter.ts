import { Player } from "../core/Player";
import { EventBus } from "./EventBus";

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

  public registerCommandHandler(
    action: string,
    handler: (player: Player, data: any) => void
  ): void {
    this.commandHandlers.set(action, handler);
  }

  public processMessage(player: Player, messageStr: string): void {
    try {
      const message = JSON.parse(messageStr) as Message;
      
      // Validate message format
      if (!message.action || typeof message.action !== "string") {
        player.sendMessage({
          type: "error",
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
        type: "error",
        message: "Failed to process message"
      });
    }
  }
} 