---
layout: default
title: Game State Management
permalink: /guides/building-games/tic-tac-toe/state-management
parent: Tic Tac Toe
grand_parent: Building Games
nav_order: 6
---

# Game State Management

In this section, we'll create utility functions to help manage the game state. These functions will make it easier to transition between game states and serialize game information for players.

## Creating the Utils File

Let's create our utility functions in `src/utils.ts`:

```typescript
// src/utils.ts
import { Player, Table } from 'shoehive';
import { GameState } from './events';
```

## Game State Transitions

First, let's create a function to handle game state transitions. This function will update the game state and notify all players:

```typescript
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
```

This function:
1. Gets the current game state
2. Updates the game state attribute
3. Broadcasts a message to all players notifying them of the state change

## Board Representation

Let's create a function to get a representation of the board suitable for sending to clients:

```typescript
/**
 * Get a board representation suitable for sending to clients
 */
export function getBoardForClient(table: Table): any[][] {
  return table.getAttribute('board');
}
```

This simple function just returns the board data. In a more complex game, you might transform the board data into a different format for the client.

## Player-Specific Game State

Different players might need to see different information about the game. Let's create a function to serialize the game state for a specific player:

```typescript
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

This function:
1. Gets all players in the game
2. Finds the index of the specified player
3. Returns a structured object containing:
   - General game information (board, state, etc.)
   - Player-specific information (isYourTurn, yourSymbol, etc.)

## Complete Utils File

The complete `src/utils.ts` file looks like this:

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

## Using the Utility Functions

These utility functions can be used in our command handlers to simplify state transitions and player notifications. For example, in our command handlers, we could use:

```typescript
// In tictactoe:start command handler
transitionGameState(table, GameState.IN_PROGRESS);

// When sending game state to a player
const gameState = getGameStateForPlayer(table, player);
player.sendMessage({
  type: 'gameState',
  ...gameState
});
```

## Benefits of Separate Utility Functions

By creating these utility functions, we gain several benefits:

1. **Code Reuse**: The same functions can be used across different command handlers
2. **Consistency**: Game state transitions and player notifications are handled consistently
3. **Maintainability**: If we need to change how states are transitioned or data is formatted, we only need to change it in one place
4. **Readability**: Command handlers are more concise and easier to understand

## Next Steps

Now that we have implemented our utility functions for game state management, we're ready to tie everything together in our main application file.

Next: [Main Application](/guides/building-games/tic-tac-toe/main-application) 