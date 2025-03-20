---
layout: default
title: Quick Start
permalink: /quick-start
nav_order: 2
---

# 🐝 Shoehive Quick Start Guide

Welcome to Shoehive, the flexible WebSocket-based multiplayer game framework. This guide will help you set up a basic game server and understand the core concepts of Shoehive.

## Table of Contents

1. [Installation](#installation)
2. [Basic Server Setup](#basic-server-setup)
3. [Core Concepts Overview](#core-concepts-overview)
   - [Players](#players)
   - [Tables](#tables)
   - [Message Router](#message-router)
4. [Event System](#event-system)
   - [Using Event Constants](#using-event-constants)
   - [Creating Game-Specific Events](#creating-game-specific-events)
   - [Core Event Types](#core-event-types)
5. [Creating a Simple Game](#creating-a-simple-game)
6. [Card Game Functionality](#card-game-functionality)
7. [Player Authentication](#player-authentication)
8. [Financial Operations](#financial-operations)
9. [Advanced Patterns](#advanced-patterns)
10. [Debugging and Monitoring](#debugging-and-monitoring)
11. [Additional Resources](#additional-resources)

## Installation

Install Shoehive using npm:

```bash
npm install shoehive
```

Or using yarn:

```bash
yarn add shoehive
```

## Basic Server Setup

Here's a minimal example to set up a Shoehive game server:

```typescript
import * as http from 'http';
import { createGameServer } from 'shoehive';

// Create an HTTP server
const server = http.createServer();

// Create the game server
const gameServer = createGameServer(server);

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
});
```

The `createGameServer` function returns several important objects that you'll use to build your game:

```typescript
const {
  eventBus,          // Central event system for communication between components
  messageRouter,     // Handles incoming client messages and routes them to handlers
  tableFactory,      // Creates tables with specific configurations
  gameManager,       // Manages game definitions and tables
  wsManager,         // Manages WebSocket connections and players
  transport          // Handles authentication and financial operations
} = gameServer;
```

## Core Concepts Overview

### Players

Players represent connected clients in your game. Each player:
- Has a unique ID
- Can join tables
- Can sit at seats within tables
- Can have custom attributes for game-specific data

```typescript
// Get a player
const player = gameServer.wsManager.getPlayer('player-id');

// Set custom attributes
player.setAttribute('score', 100);
player.setAttribute('avatar', 'https://example.com/avatar.png');

// Send messages to a specific player
player.sendMessage({
  type: 'gameUpdate',
  data: { message: 'Your turn!' }
});

// Get player attributes
const score = player.getAttribute('score'); // 100
```

### Tables

Tables group players together and represent a single game instance:

```typescript
// Create a table for a specific game
const table = gameManager.createTable('tic-tac-toe', { 
  // Optional table configuration
});

// Add a player to the table
table.addPlayer(player);

// Seat a player at a specific position
table.sitPlayerAtSeat(player.id, 0);

// Set the table state 
table.setState(TableState.ACTIVE); // States: WAITING, ACTIVE, ENDED

// Use table attributes for game-specific data
table.setAttribute('roundNumber', 1);
table.setAttribute('currentPlayerIndex', 0);
table.setAttribute('pot', 100);

// Broadcast a message to all players at the table
table.broadcastMessage({
  type: 'gameUpdate',
  message: 'Round 1 started'
});
```

### Message Router

The MessageRouter processes incoming messages from clients and routes them to appropriate handlers:

```typescript
// Register a command handler for "makeMove" messages
messageRouter.registerCommandHandler('makeMove', (player, data) => {
  const { row, col } = data;
  const table = player.getTable();
  
  if (!table) {
    player.sendMessage({
      type: 'error',
      message: 'You are not at a table'
    });
    return;
  }
  
  // Handle the command
  console.log(`Player ${player.id} made move at ${row},${col}`);
  
  // Update game state
  // ...
  
  // Notify all players of the move
  table.broadcastMessage({
    type: 'moveUpdate',
    playerId: player.id,
    row,
    col
  });
});
```

## Event System

Shoehive uses an event-driven architecture for communication between components. This provides a flexible and decoupled way to handle game logic.

### Using Event Constants

Import and use the predefined event constants for type safety and consistency:

```typescript
import { PLAYER_EVENTS, TABLE_EVENTS, GAME_EVENTS } from 'shoehive';

// Listen for a player joining a table
eventBus.on(TABLE_EVENTS.PLAYER_JOINED, (player, table) => {
  console.log(`Player ${player.id} joined table ${table.id}`);
});

// Listen for game events
eventBus.on(GAME_EVENTS.STARTED, (table) => {
  console.log(`Game started on table ${table.id}`);
});

// Emit an event
eventBus.emit(GAME_EVENTS.ROUND_STARTED, table, 1);
```

### Creating Game-Specific Events

For your specific game, create custom event constants:

```typescript
// Define chess-specific events
export const CHESS_EVENTS = {
  PIECE_MOVED: "chess:piece:moved",
  CHECK: "chess:check",
  CHECKMATE: "chess:checkmate",
  PROMOTION: "chess:promotion"
} as const;

// Then use these constants in your code
eventBus.on(CHESS_EVENTS.PIECE_MOVED, (table, player, move) => {
  console.log(`Player ${player.id} moved ${move.piece} from ${move.from} to ${move.to}`);
});

eventBus.emit(CHESS_EVENTS.PIECE_MOVED, table, player, {
  piece: 'pawn',
  from: 'e2',
  to: 'e4'
});
```

## Card Game Functionality

Shoehive includes built-in support for card games with a straightforward API:

### Creating and Managing a Deck

```typescript
// Create a standard 52-card deck
table.createDeck();

// Create multiple decks (e.g., 6 decks for Blackjack)
table.createDeck(6);

// Shuffle the deck
table.shuffleDeck();

// Draw a card (visible by default)
const card = table.drawCard();

// Draw a hidden card
const hiddenCard = table.drawCard(false);
```

### Managing Hands and Dealing Cards

```typescript
// Deal a card to a player's main hand
table.dealCardToSeat(seatIndex);

// Deal a hidden card
table.dealCardToSeat(seatIndex, false);

// Add a new hand to a seat (e.g., for splitting in Blackjack)
table.addHandToSeat(seatIndex, 'split');

// Deal to a specific hand
table.dealCardToSeat(seatIndex, true, 'split');

// Get a hand
const hand = table.getHandAtSeat(seatIndex, 'main');

// Get all hands for a seat
const allHands = table.getAllHandsAtSeat(seatIndex);

// Clear hands
table.clearHandAtSeat(seatIndex, 'main');
table.clearAllHands();
```

### Example: Blackjack Deal Function

```typescript
function dealInitialCards(table) {
  // Reset all hands
  table.clearAllHands();
  
  // Create a new shuffled deck
  table.createDeck(6); // Using 6 decks
  table.shuffleDeck();
  
  // Get all active seats (seats with players)
  const activeSeatIndexes = [];
  for (let i = 0; i < table.getSeats().length; i++) {
    if (table.getPlayerAtSeat(i)) {
      activeSeatIndexes.push(i);
    }
  }
  
  // Add dealer seat
  const dealerSeatIndex = table.getSeats().length - 1;
  
  // First round of cards (all visible)
  for (const seatIndex of activeSeatIndexes) {
    table.dealCardToSeat(seatIndex, true);
  }
  table.dealCardToSeat(dealerSeatIndex, true);
  
  // Second round of cards (player visible, dealer hidden)
  for (const seatIndex of activeSeatIndexes) {
    table.dealCardToSeat(seatIndex, true);
  }
  table.dealCardToSeat(dealerSeatIndex, false);
  
  // Calculate initial hand values
  for (const seatIndex of [...activeSeatIndexes, dealerSeatIndex]) {
    calculateHandValue(table, seatIndex);
  }
  
  // Check for blackjacks
  checkForBlackjacks(table, activeSeatIndexes, dealerSeatIndex);
}
```

## Player Authentication

Shoehive provides a flexible authentication system through the `AuthModule` interface:

```typescript
import * as http from 'http';
import { createGameServer, AuthModule } from 'shoehive';

// Create a custom auth module
class JwtAuthModule implements AuthModule {
  private jwtSecret: string;
  
  constructor(jwtSecret: string) {
    this.jwtSecret = jwtSecret;
  }
  
  async authenticatePlayer(request: http.IncomingMessage): Promise<string | null> {
    try {
      // Extract token from authorization header
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
      }
      
      const token = authHeader.substring(7); // Remove 'Bearer ' prefix
      
      // Verify token (using a JWT library)
      const decoded = jwt.verify(token, this.jwtSecret) as { userId: string };
      
      // Return the user ID
      return decoded.userId;
    } catch (error) {
      console.error('Authentication error:', error);
      return null;
    }
  }
}

// Create the auth module
const authModule = new JwtAuthModule(process.env.JWT_SECRET || 'your-secret-key');

// Create the game server with auth
const gameServer = createGameServer(server, authModule);

// Listen for authentication events
gameServer.eventBus.on(PLAYER_EVENTS.AUTHENTICATION_FAILED, (requestData, reason) => {
  console.warn(`Authentication failed: ${reason}`, requestData);
});

gameServer.eventBus.on(PLAYER_EVENTS.AUTHENTICATION_SUCCEEDED, (playerId, requestData) => {
  console.log(`Player ${playerId} authenticated successfully`);
});
```

## Financial Operations

The `ServerTransportModule` interface allows you to implement bet handling and financial operations:

```typescript
import { createGameServer, ServerTransportModule, Player } from 'shoehive';

// Custom implementation connecting to your database
class DatabaseServerTransportModule implements ServerTransportModule {
  private db: any; // Your database service
  
  constructor(db: any) {
    this.db = db;
  }
  
  async getPlayerBalance(player: Player): Promise<number> {
    const result = await this.db.query(
      'SELECT balance FROM users WHERE id = ?', 
      [player.id]
    );
    return result[0]?.balance || 0;
  }
  
  async createBet(player: Player, amount: number, metadata?: Record<string, any>): Promise<string> {
    // Check balance
    const balance = await this.getPlayerBalance(player);
    if (balance < amount) {
      throw new Error('Insufficient balance');
    }
    
    // Create transaction and deduct balance
    const betId = await this.db.transaction(async (tx: any) => {
      // Deduct from balance
      await tx.query(
        'UPDATE users SET balance = balance - ? WHERE id = ?',
        [amount, player.id]
      );
      
      // Create bet record
      const result = await tx.query(
        'INSERT INTO bets (player_id, amount, status, metadata) VALUES (?, ?, ?, ?)',
        [player.id, amount, 'pending', JSON.stringify(metadata || {})]
      );
      
      return result.insertId.toString();
    });
    
    return betId;
  }
  
  async markBetWon(betId: string, winAmount: number, metadata?: Record<string, any>): Promise<boolean> {
    await this.db.transaction(async (tx: any) => {
      // Get bet details
      const bet = await tx.query('SELECT player_id FROM bets WHERE id = ?', [betId]);
      if (!bet[0]) throw new Error('Bet not found');
      
      // Update bet status
      await tx.query(
        'UPDATE bets SET status = ?, win_amount = ?, metadata = JSON_MERGE_PATCH(metadata, ?) WHERE id = ?',
        ['won', winAmount, JSON.stringify(metadata || {}), betId]
      );
      
      // Add winnings to player balance
      await tx.query(
        'UPDATE users SET balance = balance + ? WHERE id = ?', 
        [winAmount, bet[0].player_id]
      );
    });
    
    return true;
  }
  
  async markBetLost(betId: string, metadata?: Record<string, any>): Promise<boolean> {
    await this.db.query(
      'UPDATE bets SET status = ?, metadata = JSON_MERGE_PATCH(metadata, ?) WHERE id = ?',
      ['lost', JSON.stringify(metadata || {}), betId]
    );
    
    return true;
  }
}

// Create server transport module
const db = createDatabaseConnection(); // Your database connection
const serverTransport = new DatabaseServerTransportModule(db);

// Create the game server with auth and transport
const gameServer = createGameServer(server, authModule, serverTransport);

// Example of using the transport in a game
async function placeBet(player: Player, betAmount: number) {
  try {
    // Create the bet
    const betId = await gameServer.transport.server?.createBet(player, betAmount, {
      gameType: 'poker',
      hand: 'texas-holdem'
    });
    
    // Store bet ID in player attributes
    player.setAttribute('currentBetId', betId);
    
    return betId;
  } catch (error) {
    console.error('Error placing bet:', error);
    
    // Send error to player
    player.sendMessage({
      type: 'error',
      message: 'Failed to place bet. Insufficient balance.'
    });
    
    return null;
  }
}
```

## Creating a Simple Game

Take a look at our [Tic Tac Toe Example](/guides/tic-tac-toe) to see a simple game implementation using Shoehive.

## Advanced Patterns

### Game State Management

Managing game state transitions in a clear, organized way:

```typescript
// Define game states
enum PokerGameState {
  WAITING_FOR_PLAYERS = 'waitingForPlayers',
  DEALING_CARDS = 'dealingCards',
  BETTING_ROUND = 'bettingRound',
  SHOWDOWN = 'showdown',
  GAME_OVER = 'gameOver'
}

// Function to transition states
function transitionState(table: Table, newState: PokerGameState, data = {}) {
  const previousState = table.getAttribute('gameState');
  table.setAttribute('gameState', newState);
  
  // Emit state change event using game-specific constant
  eventBus.emit(POKER_EVENTS.STATE_UPDATED, table, {
    previousState,
    newState,
    ...data
  });
  
  // Broadcast to all players
  table.broadcastMessage({
    type: 'stateChanged',
    state: newState,
    data
  });
}
```

### Player Reconnection Handling

Handling player reconnections with game state synchronization:

```typescript
// Handle player reconnections
eventBus.on(PLAYER_EVENTS.RECONNECTED, (player) => {
  const table = player.getTable();
  if (!table) return;
  
  // Send the current game state
  const gameState = table.getAttribute('gameState');
  const gameData = getGameDataForPlayer(table, player);
  
  player.sendMessage({
    type: 'gameState',
    state: gameState,
    data: gameData
  });
});

function getGameDataForPlayer(table: Table, player: Player) {
  // Get generic table data
  const data = {
    tableId: table.id,
    players: table.getPlayers().map(p => ({
      id: p.id,
      seatIndex: getPlayerSeatIndex(table, p),
      // Only include public attributes
      avatar: p.getAttribute('avatar'),
      username: p.getAttribute('username')
    })),
    // Add game-specific data
    gameState: table.getAttribute('gameState'),
    roundNumber: table.getAttribute('roundNumber')
  };
  
  // Add player-specific private data
  if (table.getAttribute('gameType') === 'poker') {
    // For poker, add the player's cards (but not other players' cards)
    const seatIndex = getPlayerSeatIndex(table, player);
    if (seatIndex !== -1) {
      const hand = table.getHandAtSeat(seatIndex);
      data.hand = hand ? hand.getCards() : [];
    }
  }
  
  return data;
}

function getPlayerSeatIndex(table: Table, player: Player): number {
  for (let i = 0; i < table.getSeats().length; i++) {
    if (table.getPlayerAtSeat(i)?.id === player.id) {
      return i;
    }
  }
  return -1;
}
```

## Debugging and Monitoring

Shoehive provides built-in debugging tools to help during development:

```typescript
// Enable debug monitoring for all events
gameServer.eventBus.debugMonitor(true);

// Monitor only events with a specific prefix (e.g., poker events)
gameServer.eventBus.debugMonitor(
  true,
  (eventName) => eventName.startsWith('poker:'),
  (event, ...args) => {
    console.log(`[POKER EVENT] ${event}`, JSON.stringify(args, null, 2));
  }
);

// Custom formatting for different event types
gameServer.eventBus.debugMonitor(
  true,
  undefined,
  (event, ...args) => {
    // Different formatting for different event types
    if (event.startsWith('player:')) {
      console.log(`👤 [PLAYER] ${event}`, args[0]?.id || 'unknown');
    } else if (event.startsWith('table:')) {
      console.log(`🎲 [TABLE] ${event}`, args[0]?.id || 'unknown');
    } else if (event.startsWith('game:')) {
      console.log(`🎮 [GAME] ${event}`, args[0]?.id || 'unknown');
    } else {
      console.log(`🔄 [EVENT] ${event}`, ...args);
    }
  }
);

// Disable debug monitoring when no longer needed
gameServer.eventBus.debugMonitor(false);
```

### Structured Logging

Create more detailed logs with structured data:

```typescript
// Create a structured logger
function createLogger(prefix: string) {
  return {
    info: (message: string, data?: any) => {
      console.log(`[${prefix}] [INFO] ${message}`, data ? JSON.stringify(data) : '');
    },
    warn: (message: string, data?: any) => {
      console.warn(`[${prefix}] [WARN] ${message}`, data ? JSON.stringify(data) : '');
    },
    error: (message: string, error?: any) => {
      console.error(`[${prefix}] [ERROR] ${message}`, error);
    },
    debug: (message: string, data?: any) => {
      if (process.env.DEBUG) {
        console.debug(`[${prefix}] [DEBUG] ${message}`, data ? JSON.stringify(data) : '');
      }
    }
  };
}

const logger = createLogger('POKER');

// Use the logger with events
eventBus.on(GAME_EVENTS.STARTED, (table) => {
  logger.info('Game started', { 
    tableId: table.id,
    players: table.getPlayers().map(p => p.id)
  });
});
```

## Additional Resources

- [API Reference](/api/reference)
- [Creating Games Guide](/guides/creating-games)
- [Custom Events](/api/custom-events)
- [Transport Modules](/api/transport-modules)
- [Object Attributes](/api/object-attributes)
- [Build a Tic Tac Toe Game](/guides/tic-tac-toe)