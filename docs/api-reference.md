# 📘 Shoehive API Reference

This document provides a comprehensive reference of the main classes and methods available in the Shoehive framework.

## Core Classes

### 🎮 GameManager

The GameManager handles game definition registration and table management.

```typescript
class GameManager {
  // Register a new game definition
  registerGame(gameId: string, definition: GameDefinition): void;
  
  // Get all registered game definitions
  getAvailableGames(): Array<{ id: string, name: string }>;
  
  // Create a new table for a specific game
  createTable(gameId: string, options?: TableOptions): Table | null;
  
  // Get all tables
  getAllTables(): Table[];
  
  // Update the lobby state (broadcasts to all players)
  updateLobbyState(): void;
}
```

### 🧍 Player

The Player class represents a connected client.

```typescript
class Player {
  // Player's unique identifier
  readonly id: string;
  
  // Send a message to the player
  sendMessage(message: any): void;
  
  // Set a table for the player
  setTable(table: Table | null): void;
  
  // Get the player's current table
  getTable(): Table | null;
  
  // Set a custom attribute
  setAttribute(key: string, value: any): void;
  
  // Get a custom attribute
  getAttribute(key: string): any;
  
  // Check if an attribute exists
  hasAttribute(key: string): boolean;
  
  // Disconnect the player
  disconnect(): void;
}
```

### 🔄 EventBus

The EventBus handles communication between components through events.

```typescript
class EventBus {
  // Register an event listener
  on(event: string, listener: (...args: any[]) => void): void;
  
  // Register a one-time event listener
  once(event: string, listener: (...args: any[]) => void): void;
  
  // Remove an event listener
  off(event: string, listener: (...args: any[]) => void): void;
  
  // Emit an event
  emit(event: string, ...args: any[]): boolean;
  
  // Get the number of listeners for an event
  listenerCount(event: string): number;
}
```

### 📨 MessageRouter

The MessageRouter handles incoming messages from clients.

```typescript
class MessageRouter {
  // Register a command handler
  registerCommandHandler(
    action: string,
    handler: (player: Player, data: any) => void
  ): void;
  
  // Process an incoming message
  processMessage(player: Player, messageStr: string): void;
}
```

### 🎲 Table

The Table class manages a group of players and seats for a specific game.

```typescript
class Table {
  // Table's unique identifier
  readonly id: string;
  
  // Add a player to the table
  addPlayer(player: Player): boolean;
  
  // Remove a player from the table
  removePlayer(playerId: string): boolean;
  
  // Get all players at the table
  getPlayers(): Player[];
  
  // Get the number of players at the table
  getPlayerCount(): number;
  
  // Sit a player at a specific seat
  sitPlayerAtSeat(playerId: string, seatIndex: number): boolean;
  
  // Remove a player from a seat
  removePlayerFromSeat(seatIndex: number): boolean;
  
  // Get the current seat map
  getSeatMap(): (Player | null)[];
  
  // Get the table state
  getState(): TableState;
  
  // Set the table state
  setState(state: TableState): void;
  
  // Set a custom attribute
  setAttribute(key: string, value: any): void;
  
  // Get a custom attribute
  getAttribute(key: string): any;
  
  // Send a message to all players at the table
  broadcastToAll(message: any): void;
  
  // Send a message to specific players at the table
  broadcastToPlayers(playerIds: string[], message: any): void;
}
```

### 📡 WebSocketManager

The WebSocketManager handles WebSocket connections and player tracking.

```typescript
class WebSocketManager {
  // Get a player by ID
  getPlayer(playerId: string): Player | undefined;
  
  // Disconnect a player
  disconnectPlayer(playerId: string): void;
}
```

## Transport Modules

### 🔐 AuthModule

The AuthModule handles player authentication during connection.

```typescript
interface AuthModule {
  // Authenticate a player from the HTTP request
  authenticatePlayer(request: http.IncomingMessage): Promise<string | null>;
}
```

### 💰 ServerTransportModule

The ServerTransportModule handles server-side operations like balance management.

```typescript
interface ServerTransportModule {
  // Get the balance for a player
  getPlayerBalance(player: Player): Promise<number>;
  
  // Create a bet for a player
  createBet(
    player: Player, 
    amount: number, 
    metadata?: Record<string, any>
  ): Promise<string>;
  
  // Mark a bet as won
  markBetWon(
    betId: string, 
    winAmount: number, 
    metadata?: Record<string, any>
  ): Promise<boolean>;
  
  // Mark a bet as lost
  markBetLost(
    betId: string, 
    metadata?: Record<string, any>
  ): Promise<boolean>;
}
```

## Main Types

### GameDefinition

```typescript
interface GameDefinition {
  // Display name of the game
  name: string;
  
  // Default configuration
  defaultConfig?: GameConfig;
  
  // Factory function to create specialized tables (optional)
  createTable?: (eventBus: EventBus, options?: TableOptions) => Table;
  
  // Setup function called when a table is created
  setupTable?: (table: Table) => void;
}
```

### TableOptions

```typescript
interface TableOptions {
  // Optional table ID (generated if not provided)
  id?: string;
  
  // Game configuration
  config?: GameConfig;
}
```

### GameConfig

```typescript
interface GameConfig {
  // Total number of seats at the table
  totalSeats: number;
  
  // Maximum number of seats a single player can occupy
  maxSeatsPerPlayer: number;
}
```

### TableState

```typescript
enum TableState {
  WAITING = "waiting",
  ACTIVE = "active",
  ENDED = "ended"
}
```

## Standard Events

Shoehive emits the following standard events:

| Event Name | Parameters | Description |
|------------|------------|-------------|
| `playerConnected` | `(player: Player)` | Fired when a player connects |
| `playerDisconnected` | `(player: Player)` | Fired when a player disconnects |
| `playerReconnected` | `(player: Player)` | Fired when a player reconnects |
| `playerJoinedTable` | `(player: Player, table: Table)` | Fired when a player joins a table |
| `playerLeftTable` | `(player: Player, table: Table)` | Fired when a player leaves a table |
| `playerSeated` | `(player: Player, table: Table, seatIndex: number)` | Fired when a player sits at a seat |
| `playerUnseated` | `(player: Player, table: Table, seatIndex: number)` | Fired when a player stands up from a seat |
| `tableCreated` | `(table: Table)` | Fired when a table is created |
| `tableStateChanged` | `(table: Table, oldState: TableState, newState: TableState)` | Fired when a table's state changes |
| `tableEmpty` | `(table: Table)` | Fired when the last player leaves a table |
| `lobbyUpdated` | `(lobbyState: any)` | Fired when the lobby state is updated |

## Helper Functions

### createGameServer

```typescript
function createGameServer(
  server: http.Server,
  authModule?: AuthModule,
  serverTransportModule?: ServerTransportModule
): {
  eventBus: EventBus;
  messageRouter: MessageRouter;
  tableFactory: TableFactory;
  gameManager: GameManager;
  wsManager: WebSocketManager;
  transport: {
    auth: AuthModule | undefined;
    server: ServerTransportModule | undefined;
  }
}
```

This is the main function to initialize a Shoehive game server. It creates all necessary components and wires them together.

## Default Command Handlers

Shoehive registers the following command handlers by default:

| Command | Parameters | Description |
|---------|------------|-------------|
| `joinTable` | `{ tableId: string }` | Join an existing table |
| `createTable` | `{ gameId: string, options?: any }` | Create a new table |
| `leaveTable` | - | Leave the current table |
| `sitDown` | `{ seatIndex: number }` | Sit at a specific seat |
| `standUp` | `{ seatIndex: number }` | Stand up from a specific seat |

You can register additional commands for your specific game logic.

## Implementation Examples

For implementation examples, please refer to:

- [Transport Modules Implementation](./transport-modules.md)
- [Creating Custom Game Logic](./creating-games.md) 