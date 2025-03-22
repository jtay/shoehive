---
layout: default
title: Designing Game Events
permalink: /guides/building-games/tic-tac-toe/game-events
parent: Tic Tac Toe
grand_parent: Building Games
nav_order: 3
---

# Designing Game Events

In this section, we'll define the event system for our Tic-Tac-Toe game. Events form the foundation of our event-driven architecture, allowing different components to communicate without tight coupling.

## Event Types

For our Tic-Tac-Toe game, we'll create event constants using a consistent naming convention. Each event follows the pattern `domain:action` to make them clear and organized.

Let's create our `src/events.ts` file:

```typescript
// src/events.ts
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
```

By using the `as const` assertion, we ensure that TypeScript treats these string literals as exact values, giving us better type checking.

## Event Payloads

Next, we'll define TypeScript interfaces for our event payloads. These interfaces describe the data that will be sent along with each event:

```typescript
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
```

## Game States

Finally, we'll define an enum for our game states. This will help us maintain and transition between the different states of our game:

```typescript
export enum GameState {
  WAITING_FOR_PLAYERS = 'waitingForPlayers',
  READY_TO_START = 'readyToStart',
  IN_PROGRESS = 'inProgress',
  GAME_OVER = 'gameOver'
}
```

## Benefits of This Approach

Using TypeScript with these constants and interfaces provides several benefits:

1. **Type Safety**: TypeScript will catch errors if we use event names or payloads incorrectly
2. **Autocompletion**: IDEs can suggest event names and payload properties
3. **Refactoring Support**: If we rename an event, TypeScript will find all places it's used
4. **Documentation**: The code itself documents the event structure

## Final events.ts File

The complete `src/events.ts` file looks like this:

```typescript
// src/events.ts
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

## Next Steps

With our event system in place, we're ready to implement the core game logic that will handle these events and maintain the game state.

Next: [Creating the Game Definition](/guides/building-games/tic-tac-toe/game-definition) 