---
layout: default
title: Building Games
permalink: /guides/building-games/
parent: Guides
has_children: true
nav_order: 3
---

# Creating Custom Games with Shoehive

This guide will walk you through the process of building a custom game using the Shoehive framework.

## Overview

Creating a game with Shoehive involves:

1. Defining your game state and rules
2. Registering your game with the GameManager
3. Handling player actions via command handlers
4. Creating game-specific event constants
5. Handling game events
6. Resetting and restarting games

## Step 1: Define Your Game

First, you need to define your game by creating a `GameDefinition`:
```typescript
import { GameDefinition, Table, EventBus } from 'shoehive';

// Create game definition
const ticTacToeGame: GameDefinition = {
  id: "tic-tac-toe",
  name: "Tic-Tac-Toe",
  description: "Classic two-player game of X and O",
  minPlayers: 2,
  maxPlayers: 2,
  defaultSeats: 2,
  maxSeatsPerPlayer: 1,
  options: {
    // This function will be called when a new table is created
    setupTable: (table: Table) => {
      // Initialize game-specific state
      table.setAttribute({ key: 'board', value: [
        [null, null, null],
        [null, null, null],
        [null, null, null]
      ] });
      table.setAttribute({ key: 'currentPlayer', value: null });
      table.setAttribute({ key: 'winner', value: null });
      table.setAttribute({ key: 'gameOver', value: false });
    }
  }
};
```

## Step 2: Register Your Game

Register your game with the GameManager:

```typescript
import { createGameServer } from 'shoehive';
import * as http from 'http';

// Create server
const server = http.createServer();
const gameServer = createGameServer({ server });

// Register your game
gameServer.gameManager.registerGame({ gameDefinition: ticTacToeGame });

// Start the server
server.listen(3000, () => {
  console.log('Game server running on port 3000');
});
```

## Step 3: Handle Player Actions

Set up command handlers for game-specific actions:

```typescript
// Handle the "makeMove" command
gameServer.messageRouter.registerCommandHandler({
  action: 'makeMove', 
  handler: (player, data) => {
    // Validate input
    if (!data.row || !data.col || 
        typeof data.row !== 'number' || 
        typeof data.col !== 'number') {
      return;
    }
    
    const table = player.getTable();
    if (!table) return;
    
    // Make sure it's a valid move and the player's turn
    if (!isValidMove({ table, player, row: data.row, col: data.col })) {
      player.sendMessage({
        message: {
          type: 'error',
          message: 'Invalid move'
        }
      });
      return;
    }
    
    // Update the game state
    makeMove({ table, player, row: data.row, col: data.col });
    
    // Check for game over conditions
    checkGameState({ table });
  }
});

// Helper functions (using options pattern)
function isValidMove({ table, player, row, col }: any): boolean {
  const board = table.getAttribute({ key: 'board' });
  const currentPlayerId = table.getAttribute({ key: 'currentPlayer' });
  const gameOver = table.getAttribute({ key: 'gameOver' });
  
  if (gameOver) return false;
  if (currentPlayerId !== player.id) return false;
  if (row < 0 || row > 2 || col < 0 || col > 2) return false;
  if (board[row][col] !== null) return false;
  
  return true;
}

function makeMove({ table, player, row, col }: any): void {
  const board = table.getAttribute({ key: 'board' });
  const players = table.getSeatMap();
  
  // Determine player symbol
  const playerIndex = players.findIndex(p => p && p.id === player.id);
  const symbol = playerIndex === 0 ? 'X' : 'O';
  
  board[row][col] = symbol;
  table.setAttribute({ key: 'board', value: board });
  
  const nextPlayerIndex = (playerIndex + 1) % 2;
  const nextPlayer = players[nextPlayerIndex];
  table.setAttribute({ key: 'currentPlayer', value: nextPlayer ? nextPlayer.id : null });
  
  // Broadcast the updated board
  table.broadcastMessage({
    message: {
      type: 'boardUpdate',
      board: board,
      lastMove: { row, col, symbol, playerId: player.id },
      currentPlayer: nextPlayer ? nextPlayer.id : null
    }
  });
}
```

## Step 4: Create Game-Specific Event Constants

```typescript
// Emit a custom event when a move is made
gameServer.eventBus.emit(TIC_TAC_TOE_EVENTS.MOVE_MADE, { 
  table, 
  player, 
  row, 
  col, 
  symbol 
});
```

## Step 5: Handle Game Events

```typescript
// Handle when players join the table
gameServer.eventBus.on({ 
  event: TABLE_EVENTS.PLAYER_JOINED, 
  listener: ({ player, table }) => {
    if (table.getAttribute({ key: 'gameId' }) !== 'tic-tac-toe') return;
    
    const players = table.getSeatMap().filter(p => p !== null);
    
    if (players.length === 2 && table.getState() === 'WAITING') {
      table.setAttribute({ key: 'currentPlayer', value: players[0].id });
      table.setState({ state: 'ACTIVE' });
      
      table.broadcastMessage({
        message: {
          type: 'gameStart',
          board: table.getAttribute({ key: 'board' }),
          currentPlayer: players[0].id
        }
      });
    }
  }
});
```

## Step 6: Use Debug Monitoring

```typescript
gameServer.eventBus.debugMonitor({
  enabled: true, 
  filter: (eventName) => eventName.startsWith('tictactoe:'),
  logger: (event, payload) => {
    console.log(`[TicTacToe Event] ${event}`, payload);
  }
});
```
