import * as WebSocket from "ws";
import * as http from "http";
import { EventBus } from "../events/EventBus";
import { MessageRouter } from "../events/MessageRouter";
import { Player } from "./Player";
import { GameManager } from "./GameManager";
import { AuthModule } from "../transport/AuthModule";

export class WebSocketManager {
  private wss: WebSocket.Server;
  private eventBus: EventBus;
  private messageRouter: MessageRouter;
  private gameManager: GameManager;
  private players: Map<string, Player> = new Map();
  private authModule?: AuthModule;

  constructor(
    server: http.Server,
    eventBus: EventBus,
    messageRouter: MessageRouter,
    gameManager: GameManager,
    authModule?: AuthModule
  ) {
    this.wss = new WebSocket.Server({ server });
    this.eventBus = eventBus;
    this.messageRouter = messageRouter;
    this.gameManager = gameManager;
    this.authModule = authModule;
    
    this.setupConnectionHandler();
    this.setupEventListeners();
  }

  private setupConnectionHandler(): void {
    this.wss.on("connection", async (socket: WebSocket.WebSocket, request: http.IncomingMessage) => {
      try {
        // Authenticate the connection if an auth provider is available
        let playerId: string | null = null;
        
        if (this.authModule) {
          playerId = await this.authModule.authenticatePlayer(request);
          
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
        
        // Send initial state to the player
        this.sendInitialState(player);
        
        // Emit player connected event
        this.eventBus.emit("playerConnected", player);
        
      } catch (error) {
        console.error("Connection error:", error);
        socket.close(1011, "Internal server error");
      }
    });
  }

  private setupEventListeners(): void {
    this.eventBus.on("lobbyUpdated", (lobbyState) => {
      const message = {
        type: "lobbyUpdate",
        data: lobbyState
      };
      
      // Send to all players
      this.players.forEach(player => {
        player.sendMessage(message);
      });
    });

    this.eventBus.on("playerJoinedTable", (player, table) => {
      player.sendMessage({
        type: "tableJoined",
        tableId: table.id,
        gameId: table.getAttribute("gameId")
      });
    });

    // Add listener for playerSeated event
    this.eventBus.on("playerSeated", (player, table, seatIndex) => {
      // Notify the player they have been seated
      player.sendMessage({
        type: "seated",
        tableId: table.id,
        seatIndex: seatIndex
      });
      
      // Update lobby for all players to see seat changes
      this.gameManager.updateLobbyState();
    });

    // Add listener for playerUnseated event
    this.eventBus.on("playerUnseated", (player, table, seatIndex) => {
      // Notify the player they have stood up
      player.sendMessage({
        type: "unseated",
        tableId: table.id,
        seatIndex: seatIndex
      });
      
      // Update lobby for all players to see seat changes
      this.gameManager.updateLobbyState();
    });
  }

  private sendInitialState(player: Player): void {
    // Send player details
    player.sendMessage({
      type: "playerInfo",
      id: player.id
    });

    // Send available games and tables
    player.sendMessage({
      type: "lobbyUpdate",
      data: {
        games: this.gameManager.getAvailableGames(),
        tables: this.gameManager.getAllTables().map(table => ({
          id: table.id,
          gameId: table.getAttribute("gameId"),
          playerCount: table.getPlayerCount(),
          seats: table.getSeatMap().map(player => player?.id || null),
          state: table.getState()
        }))
      }
    });
  }

  private createOrReconnectPlayer(socket: WebSocket.WebSocket, playerId: string | null): Player {
    if (playerId && this.players.has(playerId)) {
      // Handle reconnection
      const existingPlayer = this.players.get(playerId)!;
      // Disconnect existing socket if any
      existingPlayer.disconnect();
      
      // Create new player with the existing ID
      const player = new Player(socket, this.eventBus, playerId);
      this.players.set(playerId, player);
      
      // If the player was in a table, reconnect them
      const previousTable = existingPlayer.getTable();
      if (previousTable) {
        player.setTable(previousTable);
      }
      
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