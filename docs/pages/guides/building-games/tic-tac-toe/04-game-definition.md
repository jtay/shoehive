---
layout: default
title: Creating the Game Definition
permalink: /guides/building-games/tic-tac-toe/game-definition
parent: Tic Tac Toe
grand_parent: Building Games
nav_order: 4
---

# Creating the Game Definition

In this section, we'll implement the core game logic for our Tic-Tac-Toe game. This includes setting up the game state, validating moves, making moves, and checking for win or draw conditions.

## Game Logic Overview

Our game logic will be contained in the `src/game-logic.ts` file and will include the following key functions:

1. **setupTicTacToeTable**: Initialize a new game table with default attributes
2. **isValidMove**: Check if a move is valid given the current game state
3. **makeMove**: Update the game state when a player makes a move
4. **checkGameStatus**: Determine if the game has ended with a win or draw
5. **getCurrentPlayer**: Get the current player whose turn it is
6. **resetGame**: Reset the game to start a new round

## Creating the Table Setup Function

First, let's create the setup function that initializes a new Tic-Tac-Toe table:

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
```

This function sets up all the initial attributes we need to track for our game. The `Table` object from Shoehive provides a convenient way to store and access game state.

## Validating Moves

Next, let's create a function to validate player moves:

```typescript
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
```

This function performs three checks:
1. Ensures the game is in progress
2. Validates that the coordinates are within the 3x3 grid
3. Verifies that the selected cell is empty

## Making Moves

Now, let's implement the function to make a move:

```typescript
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
```

This function:
1. Gets the current board state and player information
2. Places the player's symbol on the board
3. Updates the move count
4. Switches to the next player's turn

## Checking Game Status

One of the most important functions checks if the game has ended in a win or draw:

```typescript
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
```

This function checks all possible win patterns (rows, columns, and diagonals) to determine if someone has won. It also checks for a draw when all cells are filled.

## Helper Functions

Let's add a few more helper functions to complete our game logic:

```typescript
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

These functions help us manage the current player and reset the game for a new round.

## Complete Game Logic File

The complete `src/game-logic.ts` file looks like this:

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

## Next Steps

Now that we have implemented the core game logic, we need to create handlers for player commands such as making moves, joining games, and forfeiting.

Next: [Implementing Command Handlers](/guides/building-games/tic-tac-toe/command-handlers) 