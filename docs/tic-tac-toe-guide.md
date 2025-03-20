# 🎮 Building a Tic-Tac-Toe Game with Shoehive

This guide walks you through creating a complete multiplayer Tic-Tac-Toe game using the Shoehive framework. Follow these steps to build a well-structured, event-driven game backend that can support two players.

## 📋 Table of Contents

1. [Overview and Planning](#-overview-and-planning)
2. [Setting Up Your Project](#-setting-up-your-project)
3. [Designing Game Events](#-designing-game-events)
4. [Creating the Game Definition](#-creating-the-game-definition)
5. [Implementing Command Handlers](#-implementing-command-handlers)
6. [Game State Management](#-game-state-management)
7. [Handling Player Moves](#-handling-player-moves)
8. [Win Condition Detection](#-win-condition-detection)
9. [Game Lifecycle Management](#-game-lifecycle-management)
10. [Debugging and Testing](#-debugging-and-testing)
11. [Complete Implementation](#-complete-implementation)

## 🗺️ Overview and Planning

Before diving into code, let's plan our Tic-Tac-Toe game:

### Game Requirements

- Two players taking turns
- 3x3 grid for placing X and O marks
- Turn-based gameplay
- Win detection (row, column, diagonal)
- Draw detection
- Game reset functionality
- Player forfeit option

### Design Patterns

We'll use several design patterns:

1. **Event-Driven Architecture**: Using the Shoehive event system to communicate between components
2. **State Machine Pattern**: For tracking and transitioning between game states
3. **Command Pattern**: For handling player actions
4. **Observer Pattern**: For notifying players of game changes
5. **Factory Pattern**: For creating new game instances

## 🛠️ Setting Up Your Project

First, let's set up a new project:

```bash
# Create a new directory
mkdir tic-tac-toe-shoehive
cd tic-tac-toe-shoehive

# Initialize a new npm project
npm init -y

# Install Shoehive and other dependencies
npm install shoehive typescript ts-node @types/node

# Initialize TypeScript
npx tsc --init
```

Create the following directory structure:

```
tic-tac-toe-shoehive/
├── src/
│   ├── index.ts           # Entry point
│   ├── events.ts          # Game-specific events
│   ├── game-logic.ts      # Game logic implementation
│   ├── command-handlers.ts # Command handlers
│   └── utils.ts           # Utility functions
├── tsconfig.json
├── package.json
└── README.md
```

## 🔄 Designing Game Events

Let's create our game-specific event constants in `src/events.ts`:

```typescript
// src/events.ts
import { GAME_EVENTS } from 'shoehive';

/**
 * Tic-Tac-Toe specific event constants
 * Following the naming convention: "domain:action"
 */
export const TIC_TAC_TOE_EVENTS = {
  // Game lifecycle events
  GAME_CREATED: "tictactoe:game:created",
  GAME_STARTED: "tictactoe:game:started",
  GAME_ENDED: "tictactoe:game:ended",
  GAME_RESET: "tictactoe:game:reset",
  
  // Player actions
  MOVE_MADE: "tictactoe:move:made",
  PLAYER_JOINED: "tictactoe:player:joined",
  PLAYER_FORFEITED: "tictactoe:player:forfeited",
  
  // Game state changes
  TURN_CHANGED: "tictactoe:turn:changed",
  BOARD_UPDATED: "tictactoe:board:updated",
  WINNER_DETERMINED: "tictactoe:winner:determined",
  DRAW_DETERMINED: "tictactoe:draw:determined"
} as const;

// Create a type for our custom events
export type TicTacToeEventType = typeof TIC_TAC_TOE_EVENTS[keyof typeof TIC_TAC_TOE_EVENTS];

/**
 * Type definitions for event payloads
 */
export interface MovePayload {
  row: number;
  col: number;
  symbol: 'X' | 'O';
  playerId: string;
}

export interface GameEndedPayload {
  winnerId: string | null;
  reason: 'win' | 'draw' | 'forfeit';
  winningCells?: [number, number][];
}

export enum GameState {
  WAITING_FOR_PLAYERS = 'waitingForPlayers',
  READY_TO_START = 'readyToStart',
  IN_PROGRESS = 'inProgress',
  GAME_OVER = 'gameOver'
}
```

## 🎲 Creating the Game Definition

Now, let's implement the game definition in `src/game-logic.ts`:

```typescript
// src/game-logic.ts
import { Table, Player } from 'shoehive';
import { GameState } from './events';

/**
 * Initialize the table with Tic-Tac-Toe game attributes
 */
export function setupTicTacToeTable(table: Table): void {
  // Initial game state
  table.setAttribute('gameState', GameState.WAITING_FOR_PLAYERS);
  
  // Game board: 3x3 grid, null means empty cell
  table.setAttribute('board', [
    [null, null, null],
    [null, null, null],
    [null, null, null]
  ]);
  
  // Game metadata
  table.setAttribute('currentPlayerIndex', 0);
  table.setAttribute('moveCount', 0);
  table.setAttribute('symbols', ['X', 'O']);
  table.setAttribute('winner', null);
  table.setAttribute('winningCells', null);
  table.setAttribute('isGameOver', false);
}

/**
 * Check if a move is valid
 */
export function isValidMove(table: Table, row: number, col: number): boolean {
  // Game must be in progress
  if (table.getAttribute('gameState') !== GameState.IN_PROGRESS) {
    return false;
  }
  
  // Check if coordinates are valid
  if (row < 0 || row > 2 || col < 0 || col > 2) {
    return false;
  }
  
  // Check if the cell is empty
  const board = table.getAttribute('board');
  return board[row][col] === null;
}

/**
 * Make a move on the board
 */
export function makeMove(table: Table, playerId: string, row: number, col: number): void {
  // Get the current board state
  const board = table.getAttribute('board');
  const currentPlayerIndex = table.getAttribute('currentPlayerIndex');
  const symbols = table.getAttribute('symbols');
  
  // Place the symbol
  board[row][col] = symbols[currentPlayerIndex];
  
  // Update the board
  table.setAttribute('board', board);
  
  // Increment move count
  const moveCount = table.getAttribute('moveCount') + 1;
  table.setAttribute('moveCount', moveCount);
  
  // Switch to the next player
  table.setAttribute('currentPlayerIndex', (currentPlayerIndex + 1) % 2);
}

/**
 * Check for a win or draw
 * @returns Object with game over status and winner info
 */
export function checkGameStatus(table: Table): {
  isGameOver: boolean;
  winnerId: string | null;
  winningCells: [number, number][] | null;
  isDraw: boolean;
} {
  const board = table.getAttribute('board');
  const players = table.getPlayers();
  const symbols = table.getAttribute('symbols');
  const moveCount = table.getAttribute('moveCount');
  
  // Check for win - rows, columns, and diagonals
  const winPatterns = [
    // Rows
    [[0, 0], [0, 1], [0, 2]],
    [[1, 0], [1, 1], [1, 2]],
    [[2, 0], [2, 1], [2, 2]],
    // Columns
    [[0, 0], [1, 0], [2, 0]],
    [[0, 1], [1, 1], [2, 1]],
    [[0, 2], [1, 2], [2, 2]],
    // Diagonals
    [[0, 0], [1, 1], [2, 2]],
    [[0, 2], [1, 1], [2, 0]]
  ];
  
  for (const pattern of winPatterns) {
    const [a, b, c] = pattern;
    if (
      board[a[0]][a[1]] !== null &&
      board[a[0]][a[1]] === board[b[0]][b[1]] &&
      board[a[0]][a[1]] === board[c[0]][c[1]]
    ) {
      // We have a winner!
      const winningSymbol = board[a[0]][a[1]];
      const winnerIndex = symbols.indexOf(winningSymbol);
      
      if (winnerIndex !== -1 && players.length > winnerIndex) {
        return {
          isGameOver: true,
          winnerId: players[winnerIndex].id,
          winningCells: [a, b, c] as [number, number][],
          isDraw: false
        };
      }
    }
  }
  
  // Check for draw - all cells filled
  if (moveCount >= 9) {
    return {
      isGameOver: true,
      winnerId: null,
      winningCells: null,
      isDraw: true
    };
  }
  
  // Game is still in progress
  return {
    isGameOver: false,
    winnerId: null,
    winningCells: null,
    isDraw: false
  };
}

/**
 * Get the current player
 */
export function getCurrentPlayer(table: Table): Player | null {
  const currentPlayerIndex = table.getAttribute('currentPlayerIndex');
  const players = table.getPlayers();
  
  if (players.length <= currentPlayerIndex) {
    return null;
  }
  
  return players[currentPlayerIndex];
}

/**
 * Reset the game
 */
export function resetGame(table: Table): void {
  // Reset the board
  table.setAttribute('board', [
    [null, null, null],
    [null, null, null],
    [null, null, null]
  ]);
  
  // Reset game state
  table.setAttribute('moveCount', 0);
  table.setAttribute('winner', null);
  table.setAttribute('winningCells', null);
  table.setAttribute('isGameOver', false);
  table.setAttribute('gameState', GameState.READY_TO_START);
  
  // Randomize the starting player
  table.setAttribute('currentPlayerIndex', Math.floor(Math.random() * 2));
}
```

## 📝 Implementing Command Handlers

Next, let's create command handlers for player actions in `src/command-handlers.ts`:

```typescript
// src/command-handlers.ts
import { Player, Table, TableState, EventBus, MessageRouter, GameManager } from 'shoehive';
import { TIC_TAC_TOE_EVENTS, GameState, MovePayload, GameEndedPayload } from './events';
import { 
  setupTicTacToeTable, 
  isValidMove, 
  makeMove, 
  checkGameStatus, 
  getCurrentPlayer,
  resetGame
} from './game-logic';

/**
 * Register all command handlers for Tic-Tac-Toe
 */
export function registerTicTacToeCommandHandlers(
  messageRouter: MessageRouter,
  gameManager: GameManager,
  eventBus: EventBus
): void {
  // Create a new Tic-Tac-Toe game
  messageRouter.registerCommandHandler('tictactoe:create', (player, data) => {
    // Create a new table
    const table = gameManager.createTable('tic-tac-toe', {
      config: { totalSeats: 2, maxSeatsPerPlayer: 1 }
    });
    
    if (!table) {
      player.sendMessage({
        type: 'error',
        message: 'Failed to create game'
      });
      return;
    }
    
    // Add the player to the table
    table.addPlayer(player);
    
    // Notify the player
    player.sendMessage({
      type: 'gameCreated',
      tableId: table.id
    });
    
    // Emit game created event
    eventBus.emit(TIC_TAC_TOE_EVENTS.GAME_CREATED, table, player);
  });
  
  // Join an existing Tic-Tac-Toe game
  messageRouter.registerCommandHandler('tictactoe:join', (player, data) => {
    if (!data.tableId) {
      player.sendMessage({
        type: 'error',
        message: 'Table ID is required'
      });
      return;
    }
    
    const table = gameManager.getAllTables().find(t => t.id === data.tableId);
    
    if (!table) {
      player.sendMessage({
        type: 'error',
        message: 'Table not found'
      });
      return;
    }
    
    // Check if the game already has two players
    if (table.getPlayerCount() >= 2) {
      player.sendMessage({
        type: 'error',
        message: 'Game is full'
      });
      return;
    }
    
    // Add the player to the table
    table.addPlayer(player);
    
    // Position players in seats
    const players = table.getPlayers();
    if (players[0]?.id === player.id) {
      table.sitPlayerAtSeat(player.id, 0);
    } else {
      table.sitPlayerAtSeat(player.id, 1);
    }
    
    // Emit player joined event
    eventBus.emit(TIC_TAC_TOE_EVENTS.PLAYER_JOINED, table, player);
    
    // If we now have two players, start the game
    if (table.getPlayerCount() === 2) {
      table.setAttribute('gameState', GameState.READY_TO_START);
      
      // Notify all players
      table.broadcastMessage({
        type: 'gameReady',
        message: 'Both players have joined. Game is ready to start.',
        players: table.getPlayers().map(p => ({
          id: p.id,
          symbol: table.getAttribute('symbols')[table.getPlayers().indexOf(p)]
        }))
      });
    }
  });
  
  // Start the game
  messageRouter.registerCommandHandler('tictactoe:start', (player, data) => {
    const table = player.getTable();
    
    if (!table) {
      player.sendMessage({
        type: 'error',
        message: 'You are not in a game'
      });
      return;
    }
    
    if (table.getAttribute('gameState') !== GameState.READY_TO_START) {
      player.sendMessage({
        type: 'error',
        message: 'Game is not ready to start'
      });
      return;
    }
    
    // Update game state
    table.setAttribute('gameState', GameState.IN_PROGRESS);
    
    // Set table state
    table.setState(TableState.ACTIVE);
    
    // Randomize first player
    const currentPlayerIndex = Math.floor(Math.random() * 2);
    table.setAttribute('currentPlayerIndex', currentPlayerIndex);
    
    // Get current player
    const currentPlayer = table.getPlayers()[currentPlayerIndex];
    
    // Emit game started event
    eventBus.emit(TIC_TAC_TOE_EVENTS.GAME_STARTED, table);
    
    // Notify all players
    table.broadcastMessage({
      type: 'gameStarted',
      currentPlayerId: currentPlayer.id,
      currentPlayerSymbol: table.getAttribute('symbols')[currentPlayerIndex],
      board: table.getAttribute('board')
    });
  });
  
  // Make a move
  messageRouter.registerCommandHandler('tictactoe:makeMove', (player, data) => {
    if (typeof data.row !== 'number' || typeof data.col !== 'number') {
      player.sendMessage({
        type: 'error',
        message: 'Invalid move coordinates'
      });
      return;
    }
    
    const table = player.getTable();
    
    if (!table) {
      player.sendMessage({
        type: 'error',
        message: 'You are not in a game'
      });
      return;
    }
    
    // Check if it's the player's turn
    const currentPlayer = getCurrentPlayer(table);
    
    if (currentPlayer?.id !== player.id) {
      player.sendMessage({
        type: 'error',
        message: "It's not your turn"
      });
      return;
    }
    
    // Check if the move is valid
    const { row, col } = data;
    
    if (!isValidMove(table, row, col)) {
      player.sendMessage({
        type: 'error',
        message: 'Invalid move'
      });
      return;
    }
    
    // Get player symbol
    const currentPlayerIndex = table.getAttribute('currentPlayerIndex');
    const symbol = table.getAttribute('symbols')[currentPlayerIndex];
    
    // Make the move
    makeMove(table, player.id, row, col);
    
    // Create move payload
    const movePayload: MovePayload = {
      row,
      col,
      symbol,
      playerId: player.id
    };
    
    // Emit move made event
    eventBus.emit(TIC_TAC_TOE_EVENTS.MOVE_MADE, table, player, movePayload);
    
    // Check game status
    const gameStatus = checkGameStatus(table);
    
    if (gameStatus.isGameOver) {
      // Update game state
      table.setAttribute('isGameOver', true);
      table.setAttribute('gameState', GameState.GAME_OVER);
      table.setState(TableState.ENDED);
      
      if (gameStatus.winnerId) {
        // We have a winner
        table.setAttribute('winner', gameStatus.winnerId);
        table.setAttribute('winningCells', gameStatus.winningCells);
        
        // Create game ended payload
        const gameEndedPayload: GameEndedPayload = {
          winnerId: gameStatus.winnerId,
          reason: 'win',
          winningCells: gameStatus.winningCells || undefined
        };
        
        // Emit winner determined event
        eventBus.emit(TIC_TAC_TOE_EVENTS.WINNER_DETERMINED, table, gameStatus.winnerId, gameStatus.winningCells);
        
        // Emit game ended event
        eventBus.emit(TIC_TAC_TOE_EVENTS.GAME_ENDED, table, gameEndedPayload);
        
        // Notify all players
        table.broadcastMessage({
          type: 'gameOver',
          winner: gameStatus.winnerId,
          winningCells: gameStatus.winningCells,
          board: table.getAttribute('board')
        });
      } else {
        // It's a draw
        const gameEndedPayload: GameEndedPayload = {
          winnerId: null,
          reason: 'draw'
        };
        
        // Emit draw determined event
        eventBus.emit(TIC_TAC_TOE_EVENTS.DRAW_DETERMINED, table);
        
        // Emit game ended event
        eventBus.emit(TIC_TAC_TOE_EVENTS.GAME_ENDED, table, gameEndedPayload);
        
        // Notify all players
        table.broadcastMessage({
          type: 'gameOver',
          draw: true,
          board: table.getAttribute('board')
        });
      }
    } else {
      // Game continues - notify about the next turn
      const nextPlayerIndex = table.getAttribute('currentPlayerIndex');
      const nextPlayer = table.getPlayers()[nextPlayerIndex];
      
      // Emit turn changed event
      eventBus.emit(TIC_TAC_TOE_EVENTS.TURN_CHANGED, table, nextPlayer);
      
      // Notify all players about the move and whose turn is next
      table.broadcastMessage({
        type: 'moveMade',
        row,
        col,
        symbol,
        playerId: player.id,
        nextPlayerId: nextPlayer.id,
        nextPlayerSymbol: table.getAttribute('symbols')[nextPlayerIndex],
        board: table.getAttribute('board')
      });
    }
  });
  
  // Forfeit the game
  messageRouter.registerCommandHandler('tictactoe:forfeit', (player, data) => {
    const table = player.getTable();
    
    if (!table) {
      player.sendMessage({
        type: 'error',
        message: 'You are not in a game'
      });
      return;
    }
    
    if (table.getAttribute('gameState') !== GameState.IN_PROGRESS) {
      player.sendMessage({
        type: 'error',
        message: 'Game is not in progress'
      });
      return;
    }
    
    // Find the other player (the winner)
    const winner = table.getPlayers().find(p => p.id !== player.id);
    
    if (!winner) {
      // Should not happen, but handle it anyway
      player.sendMessage({
        type: 'error',
        message: 'Cannot forfeit: opponent not found'
      });
      return;
    }
    
    // Update game state
    table.setAttribute('isGameOver', true);
    table.setAttribute('gameState', GameState.GAME_OVER);
    table.setAttribute('winner', winner.id);
    table.setState(TableState.ENDED);
    
    // Create game ended payload
    const gameEndedPayload: GameEndedPayload = {
      winnerId: winner.id,
      reason: 'forfeit'
    };
    
    // Emit player forfeited event
    eventBus.emit(TIC_TAC_TOE_EVENTS.PLAYER_FORFEITED, table, player);
    
    // Emit game ended event
    eventBus.emit(TIC_TAC_TOE_EVENTS.GAME_ENDED, table, gameEndedPayload);
    
    // Notify all players
    table.broadcastMessage({
      type: 'gameOver',
      winner: winner.id,
      forfeited: true,
      forfeitedBy: player.id,
      board: table.getAttribute('board')
    });
  });
  
  // Reset the game
  messageRouter.registerCommandHandler('tictactoe:reset', (player, data) => {
    const table = player.getTable();
    
    if (!table) {
      player.sendMessage({
        type: 'error',
        message: 'You are not in a game'
      });
      return;
    }
    
    if (table.getAttribute('gameState') !== GameState.GAME_OVER) {
      player.sendMessage({
        type: 'error',
        message: 'Cannot reset: game is not over'
      });
      return;
    }
    
    // Reset the game
    resetGame(table);
    
    // Emit game reset event
    eventBus.emit(TIC_TAC_TOE_EVENTS.GAME_RESET, table);
    
    // Notify all players
    table.broadcastMessage({
      type: 'gameReset',
      board: table.getAttribute('board')
    });
  });
}
```

## 🚀 Game State Management

Let's create a utility file for game state transitions in `src/utils.ts`:

```typescript
// src/utils.ts
import { Player, Table } from 'shoehive';
import { GameState } from './events';

/**
 * Transition the game state and notify players
 */
export function transitionGameState(
  table: Table, 
  newState: GameState, 
  additionalData: Record<string, any> = {}
): void {
  const oldState = table.getAttribute('gameState');
  table.setAttribute('gameState', newState);
  
  // Notify all players about the state change
  table.broadcastMessage({
    type: 'gameStateChanged',
    previousState: oldState,
    newState,
    ...additionalData
  });
}

/**
 * Get a board representation suitable for sending to clients
 */
export function getBoardForClient(table: Table): any[][] {
  return table.getAttribute('board');
}

/**
 * Serialize the game state for a specific player
 * This includes public information + player-specific private information
 */
export function getGameStateForPlayer(table: Table, player: Player): Record<string, any> {
  const players = table.getPlayers();
  const playerIndex = players.findIndex(p => p.id === player.id);
  
  return {
    tableId: table.id,
    gameState: table.getAttribute('gameState'),
    board: table.getAttribute('board'),
    players: players.map(p => ({
      id: p.id,
      symbol: table.getAttribute('symbols')[players.indexOf(p)]
    })),
    currentPlayerIndex: table.getAttribute('currentPlayerIndex'),
    isYourTurn: playerIndex === table.getAttribute('currentPlayerIndex'),
    moveCount: table.getAttribute('moveCount'),
    winner: table.getAttribute('winner'),
    winningCells: table.getAttribute('winningCells'),
    isGameOver: table.getAttribute('isGameOver'),
    yourSymbol: playerIndex !== -1 ? table.getAttribute('symbols')[playerIndex] : null
  };
}
```

## 🎯 Main Application

Now, let's tie everything together in our main `src/index.ts` file:

```typescript
// src/index.ts
import * as http from 'http';
import { createGameServer, TableState } from 'shoehive';
import { TIC_TAC_TOE_EVENTS, GameState } from './events';
import { setupTicTacToeTable } from './game-logic';
import { registerTicTacToeCommandHandlers } from './command-handlers';

// Create HTTP server
const server = http.createServer();

// Create game server
const gameServer = createGameServer(server);
const { eventBus, messageRouter, gameManager } = gameServer;

// Register the Tic-Tac-Toe game definition
gameManager.registerGame({
  id: 'tic-tac-toe',
  name: 'Tic-Tac-Toe',
  description: 'Classic two-player game of X and O',
  minPlayers: 2,
  maxPlayers: 2,
  defaultSeats: 2,
  maxSeatsPerPlayer: 1,
  options: {
    setupTable: setupTicTacToeTable
  }
});

// Register command handlers
registerTicTacToeCommandHandlers(messageRouter, gameManager, eventBus);

// Enable debug monitoring for development
if (process.env.NODE_ENV !== 'production') {
  eventBus.debugMonitor(
    true,
    (eventName) => eventName.startsWith('tictactoe:'),
    (event, ...args) => {
      console.log(`[TicTacToe Event] ${event}`, JSON.stringify(args, null, 2));
    }
  );
}

// Set up event listeners for additional game logic
eventBus.on(TIC_TAC_TOE_EVENTS.PLAYER_JOINED, (table, player) => {
  console.log(`Player ${player.id} joined Tic-Tac-Toe table ${table.id}`);
  
  // If this is the second player, the game is ready to start
  if (table.getPlayerCount() === 2) {
    table.setAttribute('gameState', GameState.READY_TO_START);
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Tic-Tac-Toe game server running on port ${PORT}`);
});
```

## 🧪 Debugging and Testing

To make development easier, add a script to `package.json`:

```json
{
  "scripts": {
    "start": "ts-node src/index.ts",
    "dev": "NODE_ENV=development ts-node src/index.ts",
    "build": "tsc",
    "serve": "node dist/index.js"
  }
}
```

You can now run your server in development mode with:

```bash
npm run dev
```

## 📊 Complete Implementation

The final code structure follows a modular design with clear separation of concerns:

1. **Events**: Centralizes all event constants and types
2. **Game Logic**: Contains core game mechanics 
3. **Command Handlers**: Handles player actions
4. **Utils**: Provides helper functions
5. **Main App**: Ties everything together

### Testing Your Game

To test your Tic-Tac-Toe game:

1. **Create a simple client**: Implement a basic WebSocket client that connects to your server
2. **Register two players**: Connect with two clients
3. **Create a game**: Send a `tictactoe:create` command from one client
4. **Join the game**: Send a `tictactoe:join` command from the second client
5. **Start the game**: Send a `tictactoe:start` command
6. **Make moves**: Alternate sending `tictactoe:makeMove` commands

### Example Client Code

Here's a simple Node.js client to test with:

```javascript
const WebSocket = require('ws');
const readline = require('readline');

const ws = new WebSocket('ws://localhost:3000');
let tableId = null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

ws.on('open', () => {
  console.log('Connected to server');
  
  rl.question('Enter your player ID: ', (playerId) => {
    console.log('Available commands:');
    console.log('1. create - Create a new game');
    console.log('2. join [tableId] - Join a game');
    console.log('3. start - Start the game');
    console.log('4. move [row] [col] - Make a move');
    console.log('5. forfeit - Forfeit the game');
    console.log('6. reset - Reset the game');
    
    rl.on('line', (input) => {
      const args = input.split(' ');
      const command = args[0];
      
      if (command === 'create') {
        ws.send(JSON.stringify({
          type: 'tictactoe:create'
        }));
      } else if (command === 'join') {
        const joinTableId = args[1] || tableId;
        ws.send(JSON.stringify({
          type: 'tictactoe:join',
          tableId: joinTableId
        }));
      } else if (command === 'start') {
        ws.send(JSON.stringify({
          type: 'tictactoe:start'
        }));
      } else if (command === 'move') {
        const row = parseInt(args[1], 10);
        const col = parseInt(args[2], 10);
        ws.send(JSON.stringify({
          type: 'tictactoe:makeMove',
          row,
          col
        }));
      } else if (command === 'forfeit') {
        ws.send(JSON.stringify({
          type: 'tictactoe:forfeit'
        }));
      } else if (command === 'reset') {
        ws.send(JSON.stringify({
          type: 'tictactoe:reset'
        }));
      } else {
        console.log('Unknown command');
      }
    });
  });
});

ws.on('message', (data) => {
  const message = JSON.parse(data);
  console.log('Received:', message);
  
  if (message.type === 'gameCreated') {
    tableId = message.tableId;
    console.log(`Game created with ID: ${tableId}`);
  }
});

ws.on('close', () => {
  console.log('Disconnected from server');
  rl.close();
});
```

## 📝 Best Practices Recap

Let's recap the design patterns and best practices we've used:

1. **Event Constants**: Using typed constants instead of string literals for event names
2. **State Management**: Clearly defined game states with explicit transitions
3. **Command Pattern**: Handling player actions through command handlers
4. **Separation of Concerns**: Game logic separate from event handling and command processing
5. **Type Safety**: Using TypeScript interfaces for event payloads and game state
6. **Error Handling**: Robust validation and error responses
7. **Debugging**: Using the debugMonitor feature for development
8. **Modular Design**: Breaking the implementation into logical modules
9. **Player Notification**: Consistent messaging to keep players informed
10. **Immutable Data**: Careful state handling to avoid unexpected mutations

## 🔗 Next Steps

To enhance your Tic-Tac-Toe game, consider:

1. **Adding a frontend**: Implement a web-based UI
2. **Game history**: Store completed games for replay
3. **Leaderboards**: Track player wins and losses
4. **Game variations**: Support different board sizes or win conditions

By following this guide, you've built a solid, event-driven Tic-Tac-Toe game backend using Shoehive's powerful features. The architecture is extensible and follows best practices for multiplayer game development.
