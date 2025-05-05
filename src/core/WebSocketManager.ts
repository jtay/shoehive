import * as WebSocket from "ws";
import * as http from "http";
import { EventBus } from "../events/EventBus";
import { MessageRouter } from "../events/MessageRouter";
import { Player } from "./Player";
import { GameManager } from "./GameManager";
import { Lobby } from "./Lobby";
import { AuthModule } from "../transport/AuthModule";
import { PLAYER_EVENTS, TABLE_EVENTS, LOBBY_EVENTS } from "../events/EventTypes";
import { CLIENT_MESSAGE_TYPES } from "./commands/index";
import { TableFactory } from "./TableFactory";

export class WebSocketManager {
  private wss: WebSocket.Server;
  private eventBus: EventBus;
  private messageRouter: MessageRouter;
  private gameManager: GameManager;
  private lobby: Lobby;
  private players: Map<string, Player> = new Map();
  private authModule?: AuthModule;
  private disconnectionTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private reconnectionTimeoutMs: number;

  constructor(
    server: http.Server,
    eventBus: EventBus,
    messageRouter: MessageRouter,
    gameManager: GameManager,
    authModule?: AuthModule,
    reconnectionTimeoutMs: number = 0,
    lobby?: Lobby,
    tableFactory?: TableFactory
  ) {
    this.wss = new WebSocket.Server({ server });
    this.eventBus = eventBus;
    this.messageRouter = messageRouter;
    this.gameManager = gameManager;
    this.authModule = authModule;
    this.reconnectionTimeoutMs = reconnectionTimeoutMs;
    
    // Create a new Lobby if not provided
    this.lobby = lobby || new Lobby(eventBus, gameManager, tableFactory!);
    
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
    this.eventBus.on(LOBBY_EVENTS.UPDATED, (lobbyState) => {
      const message = {
        type: CLIENT_MESSAGE_TYPES.LOBBY.STATE,
        data: lobbyState
      };
      
      // Send to all players
      this.players.forEach(player => {
        player.sendMessage(message);
      });
    });

    // Add listener for lobby state requests
    this.eventBus.on('request:lobby:state', (player) => {
      player.sendMessage({
        type: CLIENT_MESSAGE_TYPES.LOBBY.STATE,
        data: {
          games: this.gameManager.getAvailableGames(),
          tables: this.gameManager.getAllTables().map(table => table.getTableMetadata())
        }
      });
    });

    // Add listeners for table actions
    this.eventBus.on('request:table:join', (player, tableId) => {
      const table = this.gameManager.getTableById(tableId);
      if (!table) {
        player.sendMessage({
          type: CLIENT_MESSAGE_TYPES.ERROR,
          message: "Table not found"
        });
        return;
      }
      
      // Add player to table
      const success = table.addPlayer(player);
      if (success) {
        player.setTable(table);
        // The table:player:joined event will trigger sending the table state
      } else {
        player.sendMessage({
          type: CLIENT_MESSAGE_TYPES.ERROR,
          message: "Failed to join table"
        });
      }
    });

    this.eventBus.on('request:table:leave', (player, tableId) => {
      const table = this.gameManager.getTableById(tableId);
      if (!table) {
        player.sendMessage({
          type: CLIENT_MESSAGE_TYPES.ERROR,
          message: "Table not found"
        });
        return;
      }
      
      // Remove player from table
      table.removePlayer(player.id);
      player.setTable(null);
      
      // Confirm to the player
      player.sendMessage({
        type: CLIENT_MESSAGE_TYPES.PLAYER.STATE,
        data: {
          id: player.id,
          attributes: player.getAttributes()
        }
      });
      
      // Update lobby state for all players
      this.lobby.updateLobbyState();
    });

    this.eventBus.on('request:table:create', (player, gameId, options = {}) => {
      try {
        // Create a new table
        const table = this.lobby.createTable(gameId, options);
        if (!table) {
          player.sendMessage({
            type: CLIENT_MESSAGE_TYPES.ERROR,
            message: "Failed to create table"
          });
          return;
        }
        
        // Automatically join the player to their new table
        table.addPlayer(player);
        player.setTable(table);
        
        // Notify everyone about the new table (via lobby update)
        this.lobby.updateLobbyState();
      } catch (error) {
        console.error("Error creating table:", error);
        player.sendMessage({
          type: CLIENT_MESSAGE_TYPES.ERROR,
          message: "Failed to create table: " + (error instanceof Error ? error.message : "unknown error")
        });
      }
    });

    this.eventBus.on('request:table:seat:sit', (player, tableId, seatIndex) => {
      const table = player.getTable();
      if (!table) {
        player.sendMessage({
          type: CLIENT_MESSAGE_TYPES.ERROR,
          message: "Table not found"
        });
        return;
      }
      
      // Validate seatIndex to ensure it's a valid number
      if (seatIndex === undefined || seatIndex === null || typeof seatIndex !== 'number') {
        player.sendMessage({
          type: CLIENT_MESSAGE_TYPES.ERROR,
          message: "Invalid seat index"
        });
        return;
      }
      
      try {
        // Emit a table event for seating the player and let the table handle it internally
        this.eventBus.emit(TABLE_EVENTS.PLAYER_SIT_REQUEST, player, table, seatIndex);
        
        // The response will be handled by the TABLE_EVENTS.PLAYER_SAT event listener
      } catch (error) {
        console.error("Error seating player:", error);
        player.sendMessage({
          type: CLIENT_MESSAGE_TYPES.ERROR,
          message: "Failed to sit at seat: " + (error instanceof Error ? error.message : "unknown error")
        });
      }
    });

    this.eventBus.on('request:table:seat:stand', (player, tableId) => {
      const table = this.gameManager.getTableById(tableId);
      if (!table) {
        player.sendMessage({
          type: CLIENT_MESSAGE_TYPES.ERROR,
          message: "Table not found"
        });
        return;
      }
      
      try {
        // Emit a table event for unseating the player and let the table handle it internally
        this.eventBus.emit(TABLE_EVENTS.PLAYER_STAND_REQUEST, player, table);
        
        // The response will be handled by the TABLE_EVENTS.PLAYER_STOOD event listener
      } catch (error) {
        console.error("Error unseating player:", error);
        player.sendMessage({
          type: CLIENT_MESSAGE_TYPES.ERROR,
          message: "Failed to stand from seat: " + (error instanceof Error ? error.message : "unknown error")
        });
      }
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
      this.lobby.updateLobbyState();
    });

    // Add listener for playerUnseated event
    this.eventBus.on(TABLE_EVENTS.PLAYER_STOOD, (player, table, seatIndex) => {
      // Notify all players at the table about the change
      table.broadcastTableState();
      
      // Update lobby for all players to see seat changes
      this.lobby.updateLobbyState();
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
        this.lobby.updateLobbyState();
      }
    });
    
    // Handle bulk table attribute changes
    this.eventBus.on(TABLE_EVENTS.ATTRIBUTES_CHANGED, (table, changedKeys, attributes) => {
      // Table will handle broadcasting to its players in most cases
      // but we need to check if we should update the lobby
      const metadataAttributes = ["gameId", "gameName", "options"];
      const shouldUpdateLobby = changedKeys.some((key: string) => metadataAttributes.includes(key));
      
      if (shouldUpdateLobby) {
        this.lobby.updateLobbyState();
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
      type: CLIENT_MESSAGE_TYPES.LOBBY.STATE,
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
      
      // Clear any existing disconnect timeout for this player
      if (this.disconnectionTimeouts.has(playerId)) {
        clearTimeout(this.disconnectionTimeouts.get(playerId)!);
        this.disconnectionTimeouts.delete(playerId);
      }
      
      this.eventBus.emit(PLAYER_EVENTS.RECONNECTED, player);
      return player;
    } else {
      // Create new player
      const player = new Player(socket, this.eventBus, playerId || undefined);
      this.players.set(player.id, player);
      
      // Setup disconnect handler for the new player
      this.setupPlayerDisconnectHandler(player);
      
      return player;
    }
  }

  /**
   * Setup disconnect handler for a player to manage reconnection timeout
   * 
   * @param player The player to set up disconnect handler for
   */
  private setupPlayerDisconnectHandler(player: Player): void {
    player.onDisconnect(() => {
      // Only set timeout if reconnection timeout is enabled
      if (this.reconnectionTimeoutMs > 0) {
        // Mark player as temporarily disconnected
        player.setAttribute('connectionStatus', 'disconnected');
        
        // Set timeout to remove player if they don't reconnect
        const timeout = setTimeout(() => {
          this.removePlayerPermanently(player.id);
        }, this.reconnectionTimeoutMs);
        
        this.disconnectionTimeouts.set(player.id, timeout);
      } else {
        // If timeout is disabled, remove player immediately
        this.removePlayerPermanently(player.id);
      }
    });
  }

  /**
   * Permanently remove a player from the game server
   * 
   * @param playerId The ID of the player to remove
   */
  private removePlayerPermanently(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;
    
    // If player is at a table, remove them
    const table = player.getTable();
    if (table) {
      table.removePlayer(playerId);
    }
    
    // Remove player from the game server
    this.players.delete(playerId);
    
    // Clean up any stored timeout
    if (this.disconnectionTimeouts.has(playerId)) {
      clearTimeout(this.disconnectionTimeouts.get(playerId)!);
      this.disconnectionTimeouts.delete(playerId);
    }
    
    // Emit a player removed event
    this.eventBus.emit(PLAYER_EVENTS.REMOVED, player);
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
   * Disconnects a player by their ID without waiting for timeout.
   * This bypasses the reconnection timeout and immediately removes the player.
   * 
   * @param playerId The ID of the player to disconnect.
   */
  public disconnectPlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (player) {
      // Close the socket connection
      player.disconnect();
      
      // Remove any timeout and immediately remove the player
      if (this.disconnectionTimeouts.has(playerId)) {
        clearTimeout(this.disconnectionTimeouts.get(playerId)!);
        this.disconnectionTimeouts.delete(playerId);
      }
      
      this.removePlayerPermanently(playerId);
    }
  }
  
  /**
   * Gets the current reconnection timeout in milliseconds
   */
  public getReconnectionTimeout(): number {
    return this.reconnectionTimeoutMs;
  }
  
  /**
   * Sets the reconnection timeout in milliseconds
   * 
   * @param timeoutMs The timeout in milliseconds (0 to disable reconnection)
   */
  public setReconnectionTimeout(timeoutMs: number): void {
    this.reconnectionTimeoutMs = timeoutMs;
  }

  /**
   * Gets information about temporarily disconnected players.
   * This is useful for monitoring and debugging connection issues.
   * 
   * @returns Array of objects containing information about disconnected players
   */
  public getDisconnectedPlayers(): Array<{
    id: string;
    disconnectedAt: number;
    reconnectionAvailableUntil: number;
    timeLeftMs: number;
  }> {
    const now = Date.now();
    const result: Array<{
      id: string;
      disconnectedAt: number;
      reconnectionAvailableUntil: number;
      timeLeftMs: number;
    }> = [];
    
    this.players.forEach(player => {
      if (player.getAttribute('connectionStatus') === 'disconnected') {
        const disconnectedAt = player.getAttribute('disconnectedAt');
        const reconnectionAvailableUntil = player.getAttribute('reconnectionAvailableUntil');
        
        if (disconnectedAt && reconnectionAvailableUntil) {
          result.push({
            id: player.id,
            disconnectedAt,
            reconnectionAvailableUntil,
            timeLeftMs: Math.max(0, reconnectionAvailableUntil - now)
          });
        }
      }
    });
    
    return result;
  }

  /**
   * Gets the current number of connected players.
   * 
   * @returns The number of connected players
   */
  public getConnectedPlayerCount(): number {
    return this.players.size;
  }
}