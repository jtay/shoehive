import * as WebSocket from "ws";
import * as http from "http";
import { EventBus } from "../events/EventBus";
import { MessageRouter } from "../events/MessageRouter";
import { Player } from "./Player";

export interface AuthProvider {
  authenticatePlayer(request: http.IncomingMessage): Promise<string | null>;
}

export class WebSocketManager {
  private wss: WebSocket.Server;
  private eventBus: EventBus;
  private messageRouter: MessageRouter;
  private players: Map<string, Player> = new Map();
  private authProvider?: AuthProvider;

  constructor(
    server: http.Server,
    eventBus: EventBus,
    messageRouter: MessageRouter,
    authProvider?: AuthProvider
  ) {
    this.wss = new WebSocket.Server({ server });
    this.eventBus = eventBus;
    this.messageRouter = messageRouter;
    this.authProvider = authProvider;
    
    this.setupConnectionHandler();
  }

  private setupConnectionHandler(): void {
    this.wss.on("connection", async (socket: WebSocket.WebSocket, request: http.IncomingMessage) => {
      try {
        // Authenticate the connection if an auth provider is available
        let playerId: string | null = null;
        
        if (this.authProvider) {
          playerId = await this.authProvider.authenticatePlayer(request);
          
          if (!playerId) {
            socket.close(1008, "Authentication failed");
            return;
          }
        }
        
        // Create a new player or reconnect an existing one
        const player = this.createOrReconnectPlayer(socket, playerId);
        
        // Handle messages
        socket.on("message", (data: WebSocket.Data) => {
          const message = data.toString();
          this.messageRouter.processMessage(player, message);
        });
        
        // Emit player connected event
        this.eventBus.emit("playerConnected", player);
        
      } catch (error) {
        console.error("Connection error:", error);
        socket.close(1011, "Internal server error");
      }
    });
  }

  private createOrReconnectPlayer(socket: WebSocket.WebSocket, playerId: string | null): Player {
    if (playerId && this.players.has(playerId)) {
      // Handle reconnection
      const existingPlayer = this.players.get(playerId)!;
      // TODO: Handle the existing player's socket gracefully
      
      // Create new player with the existing ID
      const player = new Player(socket, this.eventBus, playerId);
      this.players.set(playerId, player);
      
      this.eventBus.emit("playerReconnected", player);
      return player;
    } else {
      // Create new player
      const player = new Player(socket, this.eventBus, playerId || undefined);
      this.players.set(player.id, player);
      return player;
    }
  }

  public getPlayer(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  public disconnectPlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (player) {
      player.disconnect();
      this.players.delete(playerId);
    }
  }
} 