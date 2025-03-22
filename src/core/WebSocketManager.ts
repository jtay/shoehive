import * as WebSocket from "ws";
import * as http from "http";
import { EventBus } from "../events/EventBus";
import { MessageRouter } from "../events/MessageRouter";
import { Player } from "./Player";
import { GameManager } from "./GameManager";
import { AuthModule } from "../transport/AuthModule";
import { PLAYER_EVENTS, TABLE_EVENTS, LOBBY_EVENTS } from "../events/EventTypes";
import { CLIENT_COMMAND_TYPES, CLIENT_MESSAGE_TYPES } from "./commands/index";

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

  /**
   * Sets up the connection handler for the WebSocket server.
   * This handler authenticates the connection, creates a new player or reconnects an existing one,
   * and handles incoming messages.
   */
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
        this.eventBus.emit(PLAYER_EVENTS.CONNECTED, player);
        
      } catch (error) {
        console.error("Connection error:", error);
        socket.close(1011, "Internal server error");
      }
    });
  }

  /**
   * Sets up event listeners for the WebSocket manager.
   * This listens for lobby state updates and player joined events,
   * and sends the appropriate messages to all players.
   */
  private setupEventListeners(): void {
    this.eventBus.on(LOBBY_EVENTS.STATE, (lobbyState) => {
      const message = {
        type: LOBBY_EVENTS.STATE,
        data: lobbyState
      };
      
      // Send to all players
      this.players.forEach(player => {
        player.sendMessage(message);
      });
    });

    this.eventBus.on(TABLE_EVENTS.PLAYER_JOINED, (player, table) => {
      // Send the full table state to the joining player
      player.sendMessage({
        type: CLIENT_MESSAGE_TYPES.TABLE.STATE,
        data: table.getTableState()
      });
    });

    // Add listener for playerSeated event
    this.eventBus.on(TABLE_EVENTS.PLAYER_SAT, (player, table, seatIndex) => {
      // Notify all players at the table about the change
      table.broadcastTableState();
      
      // Update lobby for all players to see seat changes
      this.gameManager.updateLobbyState();
    });

    // Add listener for playerUnseated event
    this.eventBus.on(TABLE_EVENTS.PLAYER_STOOD, (player, table, seatIndex) => {
      // Notify all players at the table about the change
      table.broadcastTableState();
      
      // Update lobby for all players to see seat changes
      this.gameManager.updateLobbyState();
    });
    
    // Handle table state updates
    this.eventBus.on(TABLE_EVENTS.STATE_UPDATED, (table, tableState) => {
      // No need to broadcast again as the table has already done this
      // This event can be used by other components
    });
    
    // Handle player attribute changes
    this.eventBus.on(PLAYER_EVENTS.ATTRIBUTE_CHANGED, (player, key, value) => {
      // Use the new distribution method
      this.distributePlayerUpdate(player, key, value);
    });
    
    // Handle bulk player attribute changes
    this.eventBus.on(PLAYER_EVENTS.ATTRIBUTES_CHANGED, (player, changedKeys, attributes) => {
      // Use the new bulk distribution method
      this.distributePlayerUpdates(player, attributes);
    });
    
    // Handle table attribute changes
    this.eventBus.on(TABLE_EVENTS.ATTRIBUTE_CHANGED, (table, key, value) => {
      // Broadcast the updated table state to all players at the table
      table.broadcastTableState();
      
      // Update lobby if this is a metadata attribute that would affect the lobby display
      const metadataAttributes = ["gameId", "gameName", "options"];
      if (metadataAttributes.includes(key)) {
        this.gameManager.updateLobbyState();
      }
    });
    
    // Handle bulk table attribute changes
    this.eventBus.on(TABLE_EVENTS.ATTRIBUTES_CHANGED, (table, changedKeys, attributes) => {
      // Table will handle broadcasting to its players in most cases
      // but we need to check if we should update the lobby
      const metadataAttributes = ["gameId", "gameName", "options"];
      const shouldUpdateLobby = changedKeys.some((key: string) => metadataAttributes.includes(key));
      
      if (shouldUpdateLobby) {
        this.gameManager.updateLobbyState();
      }
    });
  }

  /**
   * Sends the initial state to a player.
   * This includes player details and lobby state.
   * 
   * @param player The player to send the initial state to.
   */
  private sendInitialState(player: Player): void {
    // Send player details
    player.sendMessage({
      type: CLIENT_MESSAGE_TYPES.PLAYER.STATE,
      id: player.id,
      attributes: player.getAttributes()
    });

    // Send available games and tables (lobby state)
    player.sendMessage({
      type: LOBBY_EVENTS.STATE,
      data: {
        games: this.gameManager.getAvailableGames(),
        tables: this.gameManager.getAllTables().map(table => table.getTableMetadata())
      }
    });
    
    // If the player is already at a table, send the full table state
    const table = player.getTable();
    if (table) {
      player.sendMessage({
        type: CLIENT_MESSAGE_TYPES.TABLE.STATE,
        data: table.getTableState()
      });
    }
  }

  /**
   * Distribute player updates to relevant players.
   * This notifies the player about their own changes and also updates
   * any tables they're part of.
   * 
   * @param player The player whose state changed
   * @param key The attribute that changed
   * @param value The new value
   * @param updateTableState Whether to update the table state
   */
  public distributePlayerUpdate(player: Player, key: string, value: any, updateTableState: boolean = true): void {
    // Notify the player about their own attribute changes
    player.sendMessage({
      type: CLIENT_MESSAGE_TYPES.PLAYER.STATE,
      data: {
        id: player.id,
        attributes: player.getAttributes()
      }
    });

    // If player is at a table and we should update table state
    const table = player.getTable();
    if (table && updateTableState) {
      // Get the game ID for this table
      const gameId = table.getAttribute("gameId");
      if (!gameId) return;
      
      // Get the game definition
      const gameDefinition = this.gameManager.getGameDefinition(gameId);
      
      // Use the game-specific table relevant attributes, or fall back to defaults
      const tableRelevantAttributes = gameDefinition?.tableRelevantPlayerAttributes || [
        "name", "avatar", "chips", "status", "isReady", "role", "team"
      ];
      
      // Only broadcast if this attribute affects the table display
      if (tableRelevantAttributes.includes(key)) {
        table.broadcastTableState();
      }
    }
  }

  /**
   * Distribute multiple player updates to relevant players.
   * 
   * @param player The player whose state changed
   * @param attributes The attributes that changed
   * @param updateTableState Whether to update the table state
   */
  public distributePlayerUpdates(player: Player, attributes: Record<string, any>, updateTableState: boolean = true): void {
    // Notify the player about their own attribute changes
    player.sendMessage({
      type: CLIENT_MESSAGE_TYPES.PLAYER.STATE,
      data: {
        id: player.id,
        attributes: player.getAttributes()
      }
    });
    
    // If player is at a table and we should update table state
    const table = player.getTable();
    if (table && updateTableState) {
      // Get the game ID for this table
      const gameId = table.getAttribute("gameId");
      if (!gameId) return;
      
      // Get the game definition
      const gameDefinition = this.gameManager.getGameDefinition(gameId);
      
      // Use the game-specific table relevant attributes, or fall back to defaults
      const tableRelevantAttributes = gameDefinition?.tableRelevantPlayerAttributes || [
        "name", "avatar", "chips", "status", "isReady", "role", "team"
      ];
      
      // Only broadcast if any of the changed attributes are relevant to the table
      const relevantChanges = Object.keys(attributes).some(key => 
        tableRelevantAttributes.includes(key)
      );
      
      if (relevantChanges) {
        table.broadcastTableState();
      }
    }
  }

  /**
   * Creates a new player or reconnects an existing one.
   * 
   * @param socket The WebSocket connection.
   * @param playerId The player ID.
   * @returns The player object.
   */
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
      
      this.eventBus.emit(PLAYER_EVENTS.RECONNECTED, player);
      return player;
    } else {
      // Create new player
      const player = new Player(socket, this.eventBus, playerId || undefined);
      this.players.set(player.id, player);
      return player;
    }
  }

  /**
   * Gets a player by their ID.
   * 
   * @param playerId The ID of the player to get.
   * @returns The player object or undefined if the player does not exist.
   */
  public getPlayer(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  /**
   * Disconnects a player by their ID.
   * 
   * @param playerId The ID of the player to disconnect.
   */
  public disconnectPlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (player) {
      player.disconnect();
      this.players.delete(playerId);
    }
  }
}