---
layout: default
title: Quick Start
permalink: /quick-start
nav_order: 2
---

# 🐝 Shoehive Quick Start Guide

Welcome to Shoehive, the flexible WebSocket-based multiplayer game framework. This quick start guide will help you set up your first Shoehive game server and understand the core concepts.

## Table of Contents

1. [Installation](#installation)
2. [Basic Server Setup](#basic-server-setup)
3. [Core Concepts Overview](#core-concepts-overview)
4. [Event System](#event-system)
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

This creates a WebSocket server that will handle connections from game clients. The `createGameServer` function returns several important objects:

```typescript
const {
  eventBus,          // Central event system
  messageRouter,     // Handles incoming client messages
  tableFactory,      // Creates tables with specific configurations
  gameManager,       // Manages game definitions and tables
  wsManager,         // Manages WebSocket connections and players
  transport          // Handles authentication and financial operations
} = gameServer;
```

## Core Concepts Overview

Shoehive is built around several core concepts:

### Players

Players represent connected clients. Each player:
- Has a unique ID
- Can join tables
- Can sit at seats within tables
- Can have custom attributes

```typescript
// Get a player
const player = gameServer.wsManager.getPlayer('player-id');

// Set custom attributes
player.setAttribute('score', 100);
player.setAttribute('avatar', 'https://example.com/avatar.png');

// Send messages to players
player.sendMessage({
  type: 'gameUpdate',
  data: { message: 'Your turn!' }
});

// Get player attributes
const score = player.getAttribute('score'); // 100
```

### Tables

Tables group players together and represent a specific game instance:

```typescript
// Create a table
const table = gameManager.createTable('game-id', { 
  config: { 
    totalSeats: 4,          // Number of seats at the table
    maxSeatsPerPlayer: 1    // Maximum seats a single player can occupy 
  } 
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
```

### Message Router

The MessageRouter processes incoming messages from clients:

```typescript
// Register a command handler for "makeMove" messages
messageRouter.registerCommandHandler('makeMove', (player, data) => {
  const { row, col } = data;
  const table = player.getTable();
  
  // Handle the command
  console.log(`Player ${player.id} made move at ${row},${col}`);
  
  // Update game state
  // ...
  
  // Notify players of the move
  table.broadcastMessage({
    type: 'moveUpdate',
    playerId: player.id,
    row,
    col
  });
});
```

## Event System

Shoehive uses an event-driven architecture with predefined event constants for type safety and consistency.

### Using Event Constants

Import and use the event constants when working with the event system:

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

### Core Event Types

Shoehive provides several event categories:

#### Player Events
- `PLAYER_EVENTS.CONNECTED` - When a player connects
- `PLAYER_EVENTS.DISCONNECTED` - When a player disconnects
- `PLAYER_EVENTS.RECONNECTED` - When a player reconnects

#### Table Events
- `TABLE_EVENTS.CREATED` - When a table is created
- `TABLE_EVENTS.PLAYER_JOINED` - When a player joins a table
- `TABLE_EVENTS.PLAYER_LEFT` - When a player leaves a table
- `TABLE_EVENTS.PLAYER_SAT` - When a player sits at a seat
- `TABLE_EVENTS.PLAYER_STOOD` - When a player stands up
- `TABLE_EVENTS.STATE_CHANGED` - When the table state changes

#### Game Events
- `GAME_EVENTS.STARTED` - When a game starts
- `GAME_EVENTS.ENDED` - When a game ends
- `GAME_EVENTS.ROUND_STARTED` - When a game round starts
- `GAME_EVENTS.ROUND_ENDED` - When a game round ends
- `GAME_EVENTS.TURN_STARTED` - When a player's turn starts
- `GAME_EVENTS.TURN_ENDED` - When a player's turn ends

## Creating a Simple Game

Let's create a simple number guessing game:

```typescript
import { 
  createGameServer, 
  Player, 
  Table, 
  TableState, 
  GAME_EVENTS 
} from 'shoehive';

// Define number guessing game-specific events
const NUMBER_GUESS_EVENTS = {
  GUESS_MADE: "numberguess:guess:made",
  GAME_WON: "numberguess:game:won",
  GAME_LOST: "numberguess:game:lost"
} as const;

// Setup the game server
const server = http.createServer();
const gameServer = createGameServer(server);
const { messageRouter, gameManager, eventBus } = gameServer;

// Register the game definition
gameManager.registerGame({
  id: 'number-guessing',
  name: 'Number Guessing Game',
  description: 'Guess a number between 1-100',
  minPlayers: 1,
  maxPlayers: 1,
  defaultSeats: 1,
  maxSeatsPerPlayer: 1,
  options: {
    setupTable: (table: Table) => {
      // Initialize game state
      table.setAttribute('targetNumber', Math.floor(Math.random() * 100) + 1);
      table.setAttribute('attempts', 0);
      table.setAttribute('maxAttempts', 10);
    }
  }
});

// Register command handlers
messageRouter.registerCommandHandler('createGame', (player, data) => {
  // Create a new table
  const table = gameManager.createTable('number-guessing');
  
  if (!table) {
    player.sendMessage({
      type: 'error',
      message: 'Failed to create game'
    });
    return;
  }
  
  // Add player to table
  table.addPlayer(player);
  
  // Notify player
  player.sendMessage({
    type: 'gameCreated',
    tableId: table.id,
    maxAttempts: table.getAttribute('maxAttempts')
  });
  
  // Start the game
  table.setState(TableState.ACTIVE);
  eventBus.emit(GAME_EVENTS.STARTED, table);
});

messageRouter.registerCommandHandler('makeGuess', (player, data) => {
  if (!data.guess || typeof data.guess !== 'number') return;
  
  const table = player.getTable();
  if (!table) return;
  
  const targetNumber = table.getAttribute('targetNumber');
  const attempts = table.getAttribute('attempts');
  const maxAttempts = table.getAttribute('maxAttempts');
  
  // Increment attempts
  table.setAttribute('attempts', attempts + 1);
  
  // Emit a guess event
  eventBus.emit(NUMBER_GUESS_EVENTS.GUESS_MADE, table, player, {
    guess: data.guess,
    attempt: attempts + 1,
    maxAttempts: maxAttempts
  });
  
  // Check guess
  if (data.guess === targetNumber) {
    // Player won
    player.sendMessage({
      type: 'guessResult',
      correct: true,
      message: `Correct! The number was ${targetNumber}`,
      attempts: attempts + 1
    });
    
    // Emit game won event
    eventBus.emit(NUMBER_GUESS_EVENTS.GAME_WON, table, player, {
      targetNumber,
      attempts: attempts + 1
    });
    
    // End game
    table.setState(TableState.ENDED);
    eventBus.emit(GAME_EVENTS.ENDED, table, player);
  } else {
    // Incorrect guess
    const hint = data.guess < targetNumber ? 'higher' : 'lower';
    
    player.sendMessage({
      type: 'guessResult',
      correct: false,
      message: `Wrong! Try something ${hint}`,
      attempts: attempts + 1,
      attemptsLeft: maxAttempts - (attempts + 1)
    });
    
    // Check if max attempts reached
    if (attempts + 1 >= maxAttempts) {
      player.sendMessage({
        type: 'gameOver',
        message: `Game over! The number was ${targetNumber}`
      });
      
      // Emit game lost event
      eventBus.emit(NUMBER_GUESS_EVENTS.GAME_LOST, table, player, {
        targetNumber,
        attempts: maxAttempts
      });
      
      // End game
      table.setState(TableState.ENDED);
      eventBus.emit(GAME_EVENTS.ENDED, table, null);
    }
  }
});

// Start the server
server.listen(3000, () => {
  console.log('Number guessing game server running on port 3000');
});
```

## Card Game Functionality

Shoehive includes built-in support for card games:

### Creating and Managing a Deck

```typescript
// Create a single 52-card deck
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
  table.createDeck(6);
  table.shuffleDeck();
  
  // Get all active seats
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

The `ServerTransportModule` handles financial operations:

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

## Advanced Patterns

### Game State Management

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
  eventBus.emit(POKER_EVENTS.STATE_CHANGED, table, {
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
    // ...
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

Shoehive provides built-in debugging tools for event monitoring:

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

// Disable debug monitoring
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