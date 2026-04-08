---
layout: default
title: Quick Start
permalink: /quick-start
nav_order: 2
---

# 🐝 Shoehive Quick Start Guide

Welcome to Shoehive, the flexible WebSocket-based multiplayer game framework. This guide will help you set up a basic game server and understand the core concepts of Shoehive.

> [!IMPORTANT]
> **Architectural Rule**: All Shoehive functions and methods use **typed option arguments** instead of positional arguments. This ensures future-proof extensibility and improved readability.

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

## Basic Server Setup

Here's a minimal example to set up a Shoehive game server:

```typescript
import * as http from 'http';
import { createGameServer } from 'shoehive';

// Create an HTTP server
const server = http.createServer();

// Create the game server
const gameServer = createGameServer({ server });

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
  lobby,             // Manages table creation and lobby state broadcasts
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
const player = gameServer.wsManager.getPlayer({ playerId: 'player-id' });

// Set custom attributes
player.setAttribute({ key: 'score', value: 100 });
player.setAttribute({ key: 'avatar', value: 'https://example.com/avatar.png' });

// Send messages to a specific player
player.sendMessage({
  message: {
    type: 'gameUpdate',
    data: { message: 'Your turn!' }
  }
});

// Get player attributes
const score = player.getAttribute({ key: 'score' }); // 100
```

### Tables

Tables group players together and represent a single game instance:

```typescript
// Create a table for a specific game
const table = lobby.createTable({ 
  gameId: 'tic-tac-toe',
  options: { /* Optional table configuration */ }
});

// Add a player to the table
table.addPlayer({ player });

// Seat a player at a specific position
table.sitPlayerAtSeat({ playerId: player.id, seatIndex: 0 });

// Set the table state 
table.setState({ state: TableState.ACTIVE }); // States: WAITING, ACTIVE, ENDED

// Use table attributes for game-specific data
table.setAttribute({ key: 'roundNumber', value: 1 });
table.setAttribute({ key: 'currentPlayerIndex', value: 0 });
table.setAttribute({ key: 'pot', value: 100 });

// Broadcast a message to all players at the table
table.broadcastMessage({
  message: {
    type: 'gameUpdate',
    message: 'Round 1 started'
  }
});
```

### Lobby

The Lobby manages available games and tables, handling the creation of new tables and broadcasting lobby updates:

```typescript
// Create a table for a game
const table = lobby.createTable({ gameId: 'tic-tac-toe' });

// Force a lobby state update broadcast
lobby.updateLobbyState();
```

### Message Router

The MessageRouter processes incoming messages from clients and routes them to appropriate handlers:

```typescript
// Register a command handler for "makeMove" messages
messageRouter.registerCommandHandler({
  action: 'makeMove', 
  handler: (player, data) => {
    const { row, col } = data;
    const table = player.getTable();
    
    if (!table) {
      player.sendMessage({
        message: {
          type: 'error',
          message: 'You are not at a table'
        }
      });
      return;
    }
    
    // Notify all players of the move
    table.broadcastMessage({
      message: {
        type: 'moveUpdate',
        playerId: player.id,
        row,
        col
      }
    });
  }
});
```

## Event System

Shoehive uses an event-driven architecture. **Important**: Event listeners receive a single options object as their only argument.

### Using Event Constants

```typescript
import { PLAYER_EVENTS, TABLE_EVENTS, GAME_EVENTS } from 'shoehive';

// Listen for a player joining a table
eventBus.on({ 
  event: TABLE_EVENTS.PLAYER_JOINED, 
  listener: ({ player, table }) => {
    console.log(`Player ${player.id} joined table ${table.id}`);
  }
});

// Listen for game events
eventBus.on({ 
  event: GAME_EVENTS.STARTED, 
  listener: ({ table }) => {
    console.log(`Game started on table ${table.id}`);
  }
});

// Emit an event (EventBus.emit takes event as first arg, and a payload object as second)
eventBus.emit(GAME_EVENTS.ROUND_STARTED, { table, roundIndex: 1 });
```

### Creating Game-Specific Events

```typescript
// Define chess-specific events
export const CHESS_EVENTS = {
  PIECE_MOVED: "chess:piece:moved",
  CHECK: "chess:check"
} as const;

// Use these constants
eventBus.on({ 
  event: CHESS_EVENTS.PIECE_MOVED, 
  listener: ({ table, player, move }) => {
    console.log(`Player ${player.id} moved ${move.piece}`);
  }
});

eventBus.emit(CHESS_EVENTS.PIECE_MOVED, {
  table, 
  player, 
  move: { piece: 'pawn', from: 'e2', to: 'e4' }
});
```

## Card Game Functionality

```typescript
// Draw a card (visible by default)
const card = table.drawCard();

// Draw a hidden card
const hiddenCard = table.drawCard({ isVisible: false });

// Deal a card to a player's main hand
table.dealCardToSeat({ seatIndex });

// Deal a hidden card
table.dealCardToSeat({ seatIndex, isVisible: false });

// Add a new hand to a seat
table.addHandToSeat({ seatIndex, handId: 'split' });
```

## Player Authentication

```typescript
class JwtAuthModule implements AuthModule {
  async authenticatePlayer({ request }: { request: http.IncomingMessage }): Promise<string | null> {
    // Implementation details...
  }
}
```

## Financial Operations

```typescript
class DatabaseServerTransportModule implements ServerTransportModule {
  async getPlayerBalance({ player }: { player: Player }): Promise<number> {
    // ...
  }
  
  async createBet({ player, amount, metadata }: { player: Player, amount: number, metadata?: any }): Promise<string> {
    // ...
  }
}
```

## Debugging and Monitoring

```typescript
gameServer.eventBus.debugMonitor({
  enabled: true,
  filter: (eventName) => eventName.startsWith('poker:'),
  logger: (event, payload) => {
    console.log(`[POKER EVENT] ${event}`, payload);
  }
});
```