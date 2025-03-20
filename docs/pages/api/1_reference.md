---
layout: default
title: API Reference
parent: API
permalink: /api/reference
nav_order: 1
---

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

#### GameDefinition Interface

The `GameDefinition` interface defines the properties of a game that can be registered with the GameManager.

```typescript
interface GameDefinition {
  // Unique identifier for the game
  id: string;
  
  // Display name for the game
  name: string;
  
  // Game description
  description: string;
  
  // Minimum number of players required
  minPlayers: number;
  
  // Maximum number of players allowed
  maxPlayers: number;
  
  // Default number of seats at a table
  defaultSeats: number;
  
  // Maximum number of seats a player can occupy
  maxSeatsPerPlayer: number;
  
  // Additional game-specific options
  options?: Record<string, any>;
  
  // Define which player attributes should trigger a table state update when changed
  // If not specified, defaults to ["name", "avatar", "chips", "status", "isReady", "role", "team"]
  tableRelevantPlayerAttributes?: string[];
  
  // Define which player attributes should trigger a lobby update when changed
  // If not specified, defaults to ["name", "avatar", "isReady", "status"]
  lobbyRelevantPlayerAttributes?: string[];
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
  
  // Enable/disable debug monitoring for events
  debugMonitor(
    enabled: boolean = true, 
    filter?: (event: string) => boolean,
    logger?: (event: string, ...args: any[]) => void
  ): void;
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

| Event Name | Constant | Parameters | Description |
|------------|----------|------------|-------------|
| `player:connected` | `PLAYER_EVENTS.CONNECTED` | `(player: Player)` | Fired when a player connects |
| `player:disconnected` | `PLAYER_EVENTS.DISCONNECTED` | `(player: Player)` | Fired when a player disconnects |
| `player:reconnected` | `PLAYER_EVENTS.RECONNECTED` | `(player: Player)` | Fired when a player reconnects |
| `table:player:joined` | `TABLE_EVENTS.PLAYER_JOINED` | `(player: Player, table: Table)` | Fired when a player joins a table |
| `table:player:left` | `TABLE_EVENTS.PLAYER_LEFT` | `(player: Player, table: Table)` | Fired when a player leaves a table |
| `table:player:sat` | `TABLE_EVENTS.PLAYER_SAT` | `(player: Player, table: Table, seatIndex: number)` | Fired when a player sits at a seat |
| `table:player:stood` | `TABLE_EVENTS.PLAYER_STOOD` | `(player: Player, table: Table, seatIndex: number)` | Fired when a player stands up from a seat |
| `table:created` | `TABLE_EVENTS.CREATED` | `(table: Table)` | Fired when a table is created |
| `table:state:updated` | `TABLE_EVENTS.STATE_UPDATED` | `(table: Table, tableState: any)` | Fired when a table's state changes or is updated |
| `table:empty` | `TABLE_EVENTS.EMPTY` | `(table: Table)` | Fired when the last player leaves a table |
| `lobby:updated` | `LOBBY_EVENTS.UPDATED` | `(lobbyState: any)` | Fired when the lobby state is updated |
| `lobby:state` | `LOBBY_EVENTS.STATE` | `(lobbyState: any)` | Fired when the lobby state changes or updates |
| `game:started` | `GAME_EVENTS.STARTED` | `(table: Table)` | Fired when a game starts |
| `game:ended` | `GAME_EVENTS.ENDED` | `(table: Table, winner: Player | null)` | Fired when a game ends |

## Event Constants

Shoehive provides a set of predefined event constants in `EventTypes.ts` to ensure consistent event naming across the application.

```typescript
// Player events
const PLAYER_EVENTS = {
  CONNECTED: "player:connected",
  DISCONNECTED: "player:disconnected",
  RECONNECTED: "player:reconnected",
  AUTHENTICATION_FAILED: "player:authentication:failed",
  AUTHENTICATION_SUCCEEDED: "player:authentication:succeeded"
} as const;

// Table events
const TABLE_EVENTS = {
  CREATED: "table:created",
  EMPTY: "table:empty",
  STATE_UPDATED: "table:state:updated",
  PLAYER_JOINED: "table:player:joined",
  PLAYER_LEFT: "table:player:left",
  PLAYER_SAT: "table:player:sat",
  PLAYER_STOOD: "table:player:stood",
  // ...and more
} as const;

// Game events
const GAME_EVENTS = {
  STARTED: "game:started",
  ENDED: "game:ended",
  PAUSED: "game:paused",
  RESUMED: "game:resumed",
  ROUND_STARTED: "game:round:started",
  ROUND_ENDED: "game:round:ended",
  TURN_STARTED: "game:turn:started",
  TURN_ENDED: "game:turn:ended"
} as const;

// Lobby events
const LOBBY_EVENTS = {
  UPDATED: "lobby:updated",
  STATE: "lobby:state"
} as const;
```

### Using Event Constants

Always use event constants instead of string literals for better type safety and maintainability:

```typescript
// Good: Using event constants
eventBus.on(TABLE_EVENTS.PLAYER_JOINED, (player, table) => {
  console.log(`Player ${player.id} joined table ${table.id}`);
});

// Bad: Using string literals
eventBus.on("table:player:joined", (player, table) => {
  console.log(`Player ${player.id} joined table ${table.id}`);
});
```

### Creating Game-Specific Event Constants

For a cleaner, more maintainable codebase, create game-specific event constants:

```typescript
// Define your game-specific events
export const TIC_TAC_TOE_EVENTS = {
  MOVE_MADE: "tictactoe:move:made",
  GAME_STARTED: "tictactoe:game:started",
  GAME_ENDED: "tictactoe:game:ended",
  PLAYER_FORFEITED: "tictactoe:player:forfeited",
  GAME_RESET: "tictactoe:game:reset"
} as const;

// Create a type for your events
export type TicTacToeEventType = typeof TIC_TAC_TOE_EVENTS[keyof typeof TIC_TAC_TOE_EVENTS];

// Then use them with the EventBus
eventBus.emit(TIC_TAC_TOE_EVENTS.MOVE_MADE, table, player, { row, col, symbol });
```

### Using Debug Monitoring

The `debugMonitor` method is a powerful tool for event debugging during development:

```typescript
// Enable debug monitoring for all events
eventBus.debugMonitor(true);

// Enable debug monitoring only for specific events
eventBus.debugMonitor(
  true,
  (eventName) => eventName.startsWith('tictactoe:'),
  (event, ...args) => {
    console.log(`[DEBUG] ${event}`, JSON.stringify(args, null, 2));
  }
);
```

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

- [Transport Modules Implementation](https://github.com/jtay/shoehive/tree/main/docs/transport-modules.md)
- [Creating Custom Game Logic](https://github.com/jtay/shoehive/tree/main/docs/creating-games.md)

### Common Events

Shoehive emits various events that you can listen for:

```typescript
// Player events
eventBus.on(PLAYER_EVENTS.CONNECTED, (player: Player) => { /* ... */ });
eventBus.on(PLAYER_EVENTS.DISCONNECTED, (player: Player) => { /* ... */ });
eventBus.on(PLAYER_EVENTS.RECONNECTED, (player: Player) => { /* ... */ });

// Table events
eventBus.on(TABLE_EVENTS.CREATED, (table: Table) => { /* ... */ });
eventBus.on(TABLE_EVENTS.PLAYER_JOINED, (player: Player, table: Table) => { /* ... */ });
eventBus.on(TABLE_EVENTS.PLAYER_LEFT, (player: Player, table: Table) => { /* ... */ });
eventBus.on(TABLE_EVENTS.PLAYER_SAT, (player: Player, table: Table, seatIndex: number) => { /* ... */ });
eventBus.on(TABLE_EVENTS.PLAYER_STOOD, (player: Player, table: Table, seatIndex: number) => { /* ... */ });
eventBus.on(TABLE_EVENTS.STATE_UPDATED, (table: Table, tableState: any) => { /* ... */ });
eventBus.on(TABLE_EVENTS.EMPTY, (table: Table) => { /* ... */ });

// Card/deck events
eventBus.on(TABLE_EVENTS.DECK_CREATED, (table: Table, numberOfDecks: number) => { /* ... */ });
eventBus.on(TABLE_EVENTS.DECK_SHUFFLED, (table: Table) => { /* ... */ });
eventBus.on(TABLE_EVENTS.DECK_CARD_DRAWN, (table: Table, card: Card) => { /* ... */ });
eventBus.on(TABLE_EVENTS.CARD_DEALT, (table: Table, seatIndex: number, card: Card, handId: string) => { /* ... */ });
eventBus.on(TABLE_EVENTS.SEAT_HAND_CLEARED, (table: Table, seatIndex: number, handId: string) => { /* ... */ });
eventBus.on(TABLE_EVENTS.SEATS_HANDS_CLEARED, (table: Table) => { /* ... */ });

// Game events
eventBus.on(GAME_EVENTS.STARTED, (table: Table) => { /* ... */ });
eventBus.on(GAME_EVENTS.ENDED, (table: Table, winner: Player | null) => { /* ... */ });
eventBus.on(GAME_EVENTS.ROUND_STARTED, (table: Table, roundNumber: number) => { /* ... */ });
eventBus.on(GAME_EVENTS.ROUND_ENDED, (table: Table, roundNumber: number) => { /* ... */ });

// Lobby events
eventBus.on(LOBBY_EVENTS.UPDATED, (lobbyState: LobbyState) => { /* ... */ });
eventBus.on(LOBBY_EVENTS.STATE, (lobbyState: LobbyState) => { /* ... */ });

// Game-specific events (example for Tic-Tac-Toe)
eventBus.on(TIC_TAC_TOE_EVENTS.MOVE_MADE, (table: Table, player: Player, moveData: any) => { /* ... */ });
eventBus.on(TIC_TAC_TOE_EVENTS.GAME_ENDED, (table: Table, winnerId: string | null) => { /* ... */ });
``` 
