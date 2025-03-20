---
layout: default
title: Creating Custom Games with Shoehive
permalink: /guides/creating-games
parent: Guides
nav_order: 1
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
  // Setup function should be included in the options object
  options: {
    // This function will be called when a new table is created
    setupTable: (table: Table) => {
      // Initialize game-specific state
      table.setAttribute('board', [
        [null, null, null],
        [null, null, null],
        [null, null, null]
      ]);
      table.setAttribute('currentPlayer', null);
      table.setAttribute('winner', null);
      table.setAttribute('gameOver', false);
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
const gameServer = createGameServer(server);

// Register your game
gameServer.gameManager.registerGame(ticTacToeGame);

// Start the server
server.listen(3000, () => {
  console.log('Game server running on port 3000');
});
```

## Step 3: Handle Player Actions

Set up command handlers for game-specific actions:

```typescript
// Handle the "makeMove" command
gameServer.messageRouter.registerCommandHandler('makeMove', (player, data) => {
  // Validate input
  if (!data.row || !data.col || 
      typeof data.row !== 'number' || 
      typeof data.col !== 'number') {
    return;
  }
  
  const table = player.getTable();
  if (!table) return;
  
  // Make sure it's a valid move and the player's turn
  if (!isValidMove(table, player, data.row, data.col)) {
    player.sendMessage({
      type: 'error',
      message: 'Invalid move'
    });
    return;
  }
  
  // Update the game state
  makeMove(table, player, data.row, data.col);
  
  // Check for game over conditions
  checkGameState(table);
});

// Helper functions
function isValidMove(table: Table, player: Player, row: number, col: number): boolean {
  const board = table.getAttribute('board');
  const currentPlayerId = table.getAttribute('currentPlayer');
  const gameOver = table.getAttribute('gameOver');
  
  // Check if the game is already over
  if (gameOver) return false;
  
  // Check if it's the player's turn
  if (currentPlayerId !== player.id) return false;
  
  // Check if the move is within bounds
  if (row < 0 || row > 2 || col < 0 || col > 2) return false;
  
  // Check if the cell is empty
  if (board[row][col] !== null) return false;
  
  return true;
}

function makeMove(table: Table, player: Player, row: number, col: number): void {
  const board = table.getAttribute('board');
  const players = table.getSeatMap();
  
  // Determine player symbol (X for player 0, O for player 1)
  const playerIndex = players.findIndex(p => p && p.id === player.id);
  const symbol = playerIndex === 0 ? 'X' : 'O';
  
  // Update the board
  board[row][col] = symbol;
  table.setAttribute('board', board);
  
  // Update the current player (switch turns)
  const nextPlayerIndex = (playerIndex + 1) % 2;
  const nextPlayer = players[nextPlayerIndex];
  table.setAttribute('currentPlayer', nextPlayer ? nextPlayer.id : null);
  
  // Broadcast the updated board to all players
  table.broadcastToAll({
    type: 'boardUpdate',
    board: board,
    lastMove: { row, col, symbol, playerId: player.id },
    currentPlayer: nextPlayer ? nextPlayer.id : null
  });
}

function checkGameState(table: Table): void {
  const board = table.getAttribute('board');
  
  // Check rows, columns, and diagonals for a win
  const winner = checkWinner(board);
  
  if (winner) {
    // We have a winner
    table.setAttribute('winner', winner);
    table.setAttribute('gameOver', true);
    table.setState('ENDED');
    
    // Broadcast game over
    table.broadcastToAll({
      type: 'gameOver',
      winner: winner,
      board: board
    });
    
    // Emit event for game end
    gameServer.eventBus.emit(GAME_EVENTS.ENDED, table, winner);
  } else if (isBoardFull(board)) {
    // It's a draw
    table.setAttribute('gameOver', true);
    table.setState('ENDED');
    
    // Broadcast game over
    table.broadcastToAll({
      type: 'gameOver',
      winner: null,
      isDraw: true,
      board: board
    });
    
    // Emit event for game end
    gameServer.eventBus.emit(GAME_EVENTS.ENDED, table, null);
  }
}

function checkWinner(board): string | null {
  // Check rows
  for (let i = 0; i < 3; i++) {
    if (board[i][0] && board[i][0] === board[i][1] && board[i][0] === board[i][2]) {
      return board[i][0];
    }
  }
  
  // Check columns
  for (let i = 0; i < 3; i++) {
    if (board[0][i] && board[0][i] === board[1][i] && board[0][i] === board[2][i]) {
      return board[0][i];
    }
  }
  
  // Check diagonals
  if (board[0][0] && board[0][0] === board[1][1] && board[0][0] === board[2][2]) {
    return board[0][0];
  }
  if (board[0][2] && board[0][2] === board[1][1] && board[0][2] === board[2][0]) {
    return board[0][2];
  }
  
  return null;
}

function isBoardFull(board): boolean {
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (board[i][j] === null) {
        return false;
      }
    }
  }
  return true;
}
```

## Step 4: Create Game-Specific Event Constants

For a cleaner, more maintainable codebase, create game-specific event constants:

```typescript
import { EventType } from 'shoehive';

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

// Now you can use them with the EventBus
function makeMove(table: Table, player: Player, row: number, col: number): void {
  // ... existing code ...
  
  // Emit a custom event when a move is made
  gameServer.eventBus.emit(TIC_TAC_TOE_EVENTS.MOVE_MADE, table, player, { 
    row, 
    col, 
    symbol 
  });
}
```

## Step 5: Handle Game Events

Set up event listeners for game-specific events:

```typescript
import { PLAYER_EVENTS, TABLE_EVENTS, GAME_EVENTS } from 'shoehive';
import { TIC_TAC_TOE_EVENTS } from './tic-tac-toe-events';

// Handle when players join the table
gameServer.eventBus.on(TABLE_EVENTS.PLAYER_JOINED, (player, table) => {
  // Only interested in Tic-Tac-Toe tables
  if (table.getAttribute('gameId') !== 'tic-tac-toe') return;
  
  // Get the current seat map
  const players = table.getSeatMap().filter(p => p !== null);
  
  // If we have exactly 2 players and the game hasn't started yet
  if (players.length === 2 && table.getState() === 'WAITING') {
    // Set the first player as the current player
    table.setAttribute('currentPlayer', players[0].id);
    
    // Set the table state to active
    table.setState('ACTIVE');
    
    // Broadcast game start
    table.broadcastToAll({
      type: 'gameStart',
      board: table.getAttribute('board'),
      currentPlayer: players[0].id,
      players: players.map(p => ({ id: p.id, symbol: players.indexOf(p) === 0 ? 'X' : 'O' }))
    });
    
    // Emit event for game start
    gameServer.eventBus.emit(TIC_TAC_TOE_EVENTS.GAME_STARTED, table, {
      startTime: Date.now(),
      players: players.map(p => ({ id: p.id }))
    });
  }
});

// Handle when players leave the table
gameServer.eventBus.on(TABLE_EVENTS.PLAYER_LEFT, (player, table) => {
  // Only interested in Tic-Tac-Toe tables
  if (table.getAttribute('gameId') !== 'tic-tac-toe') return;
  
  // If the game is active, consider it a forfeit
  if (table.getState() === 'ACTIVE') {
    // Get the other player
    const players = table.getPlayers();
    const otherPlayer = players.find(p => p.id !== player.id);
    
    if (otherPlayer) {
      // Set the other player as the winner
      table.setAttribute('winner', otherPlayer.id);
      table.setAttribute('gameOver', true);
      table.setState('ENDED');
      
      // Broadcast game over
      table.broadcastToAll({
        type: 'gameOver',
        winner: otherPlayer.id,
        reason: 'forfeit',
        board: table.getAttribute('board')
      });
      
      // Emit event for player forfeit and game end
      gameServer.eventBus.emit(TIC_TAC_TOE_EVENTS.PLAYER_FORFEITED, table, player, otherPlayer);
      gameServer.eventBus.emit(TIC_TAC_TOE_EVENTS.GAME_ENDED, table, otherPlayer.id);
    }
  }
});

// Listen for move made events
gameServer.eventBus.on(TIC_TAC_TOE_EVENTS.MOVE_MADE, (table, player, moveData) => {
  // This is a good place to log moves or update statistics
  console.log(`Player ${player.id} made a move: ${moveData.symbol} at [${moveData.row}, ${moveData.col}]`);
});

// Listen for table empty event to clean up resources
gameServer.eventBus.on(TABLE_EVENTS.EMPTY, (table) => {
  // Only interested in Tic-Tac-Toe tables
  if (table.getAttribute('gameId') !== 'tic-tac-toe') return;
  
  // Clean up any timers or other resources
  console.log(`Tic-Tac-Toe table ${table.id} was removed`);
});
```

## Step 6: Use Debug Monitoring During Development

Shoehive's EventBus includes a debug monitor to help you track and analyze events during development:

```typescript
// Enable debug monitoring at the start of your game server
if (process.env.NODE_ENV === 'development') {
  // Monitor all events
  gameServer.eventBus.debugMonitor(true);
  
  // Or monitor only TicTacToe events
  gameServer.eventBus.debugMonitor(
    true, 
    (eventName) => eventName.startsWith('tictactoe:'),
    (event, ...args) => {
      console.log(`[TicTacToe Event] ${event}`, JSON.stringify(args, null, 2));
    }
  );
}
```

## Step 7: Reset and Restart Games

Add functionality to reset or restart games:

```typescript
// Handle the "resetGame" command
gameServer.messageRouter.registerCommandHandler('resetGame', (player, data) => {
  const table = player.getTable();
  if (!table) return;
  
  // Only allow reset if the game is over
  if (!table.getAttribute('gameOver')) {
    player.sendMessage({
      type: 'error',
      message: 'Cannot reset an active game'
    });
    return;
  }
  
  // Reset the game state
  resetGame(table);
  
  // Broadcast the reset
  table.broadcastToAll({
    type: 'gameReset',
    board: table.getAttribute('board')
  });
  
  // Emit game reset event
  gameServer.eventBus.emit(TIC_TAC_TOE_EVENTS.GAME_RESET, table);
});

function resetGame(table: Table): void {
  // Reset the board
  table.setAttribute('board', [
    [null, null, null],
    [null, null, null],
    [null, null, null]
  ]);
  
  // Reset game state
  table.setAttribute('winner', null);
  table.setAttribute('gameOver', false);
  
  // Get the players and set the starting player
  const players = table.getSeatMap().filter(p => p !== null);
  
  if (players.length === 2) {
    // Alternate who goes first
    const lastStarterId = table.getAttribute('lastStarter');
    const newStarterIndex = lastStarterId === players[0].id ? 1 : 0;
    
    table.setAttribute('currentPlayer', players[newStarterIndex].id);
    table.setAttribute('lastStarter', players[newStarterIndex].id);
    
    // Set table state to active
    table.setState('ACTIVE');
  } else {
    // Not enough players, wait
    table.setAttribute('currentPlayer', null);
    table.setState('WAITING');
  }
}
```

## Best Practices

When creating games with Shoehive, keep these best practices in mind:

1. **Use event constants**: Always use event constants from `EventTypes.ts` for built-in events and define your own constants for game-specific events
2. **Follow naming conventions**: Use the `domain:action` pattern for your custom events (e.g., `tictactoe:move:made`)
3. **Use debug monitoring**: Enable `eventBus.debugMonitor()` during development to track and debug events
4. **Separate concerns**: Keep game logic, state management, and UI separate
5. **Validate inputs**: Always validate player inputs on the server side
6. **Prevent cheating**: Don't trust client data for game state
7. **Handle disconnections**: Have a strategy for when players disconnect
8. **Implement reconnection**: Allow players to reconnect and continue playing
9. **Document events**: Create clear documentation of your custom events and their payloads
10. **Error handling**: Provide meaningful error messages to players

## Next Steps
- Learn about [using Transport Modules](https://github.com/jtay/shoehive/tree/main/docs/transport-modules.md) for authentication and transactions
- Explore [Advanced Event Patterns](https://github.com/jtay/shoehive/tree/main/docs/advanced-events.md) for complex games 
