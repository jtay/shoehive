---
layout: default
title: Complete Implementation
permalink: /guides/building-games/tic-tac-toe/complete-implementation
parent: Tic Tac Toe
grand_parent: Building Games
nav_order: 9
---

# Complete Implementation

In this section, we'll review the complete implementation of our Tic-Tac-Toe game. This gives us a chance to see how all the pieces fit together and understand the overall architecture.

## Project Structure

Our Tic-Tac-Toe game is organized in a clean, modular structure:

```
tic-tac-toe-shoehive/
├── src/
│   ├── index.ts           # Entry point and server setup
│   ├── events.ts          # Game-specific events
│   ├── game-logic.ts      # Game logic implementation
│   ├── command-handlers.ts # Command handlers
│   └── utils.ts           # Utility functions
├── client.js              # Test client
├── tsconfig.json          # TypeScript configuration
├── package.json           # Project dependencies
└── README.md              # Project documentation
```

## Code Overview

Let's review each file and its purpose:

### 1. src/events.ts

This file defines all the event constants and types used in our game:

- **TIC_TAC_TOE_EVENTS**: Constants for all game events
- **MovePayload**: Interface for move event data
- **GameEndedPayload**: Interface for game end event data
- **GameState**: Enum of possible game states

### 2. src/game-logic.ts

This file contains the core game mechanics:

- **setupTicTacToeTable**: Initializes a new table
- **isValidMove**: Validates player moves
- **makeMove**: Updates the board with a move
- **checkGameStatus**: Checks for win or draw conditions
- **getCurrentPlayer**: Gets the current player
- **resetGame**: Resets the game state

### 3. src/command-handlers.ts

This file handles all player actions:

- **tictactoe:create**: Creates a new game
- **tictactoe:join**: Joins an existing game
- **tictactoe:start**: Starts the game
- **tictactoe:makeMove**: Makes a move
- **tictactoe:forfeit**: Forfeits the game
- **tictactoe:reset**: Resets the game

### 4. src/utils.ts

This file provides helper functions:

- **transitionGameState**: Handles state transitions
- **getBoardForClient**: Gets board data for clients
- **getGameStateForPlayer**: Gets game state for a specific player

### 5. src/index.ts

This file ties everything together:

- Creates an HTTP server
- Sets up the Shoehive game server
- Registers the game definition
- Registers command handlers
- Sets up event listeners
- Starts the server

## Event Flow

Our game follows a clear event flow:

1. **Game Creation**:
   - Player sends `tictactoe:create` command
   - Server creates a table and emits `GAME_CREATED` event
   - Player receives confirmation

2. **Player Joining**:
   - Player sends `tictactoe:join` command
   - Server adds player to table and emits `PLAYER_JOINED` event
   - All players receive notification

3. **Game Starting**:
   - Player sends `tictactoe:start` command
   - Server updates game state and emits `GAME_STARTED` event
   - All players receive notification

4. **Making Moves**:
   - Player sends `tictactoe:makeMove` command
   - Server validates move, updates board, and emits `MOVE_MADE` event
   - Server checks for win/draw and emits appropriate events
   - All players receive notification

5. **Game Ending**:
   - Server detects win/draw or player forfeits
   - Server emits `WINNER_DETERMINED`, `DRAW_DETERMINED`, or `PLAYER_FORFEITED` event
   - Server emits `GAME_ENDED` event
   - All players receive notification

6. **Game Resetting**:
   - Player sends `tictactoe:reset` command
   - Server resets game state and emits `GAME_RESET` event
   - All players receive notification

## Key Design Patterns

Our implementation uses several important design patterns:

1. **Event-Driven Architecture**
   - Events are used for communication between components
   - Components are decoupled and can be modified independently

2. **State Machine Pattern**
   - Game has well-defined states (waiting, ready, in-progress, over)
   - State transitions are explicit and controlled

3. **Command Pattern**
   - Player actions are encapsulated as commands
   - Commands are validated before execution

4. **Observer Pattern**
   - Players observe the game state
   - Changes are broadcast to all observers

5. **Factory Pattern**
   - Tables are created through a factory method
   - Creation logic is encapsulated

## Code Quality Features

Our implementation includes several features to ensure code quality:

1. **TypeScript Type Safety**
   - Strong typing for events, payloads, and functions
   - Interfaces define expected data structures

2. **Error Handling**
   - Comprehensive validation of all inputs
   - Meaningful error messages for players

3. **Logging**
   - Debug monitoring in development mode
   - Event logging for tracing game flow

4. **Modularity**
   - Each file has a single responsibility
   - Components can be tested and modified independently

5. **Pure Functions**
   - Game logic functions are mostly pure
   - Makes testing and reasoning about code easier

## Example Game Flow

Let's walk through a typical game flow:

1. **Player 1** creates a game:
   ```javascript
   {type: 'tictactoe:create'}
   ```

2. **Player 2** joins the game:
   ```javascript
   {type: 'tictactoe:join', tableId: 'table-123'}
   ```

3. **Player 1** starts the game:
   ```javascript
   {type: 'tictactoe:start'}
   ```

4. **Player 1** makes the first move:
   ```javascript
   {type: 'tictactoe:makeMove', row: 0, col: 0}
   ```

5. **Player 2** makes the second move:
   ```javascript
   {type: 'tictactoe:makeMove', row: 1, col: 1}
   ```

6. **Player 1** makes the third move:
   ```javascript
   {type: 'tictactoe:makeMove', row: 0, col: 1}
   ```

7. **Player 2** makes the fourth move:
   ```javascript
   {type: 'tictactoe:makeMove', row: 2, col: 0}
   ```

8. **Player 1** makes the fifth move and wins:
   ```javascript
   {type: 'tictactoe:makeMove', row: 0, col: 2}
   ```

9. **Player 2** resets the game:
   ```javascript
   {type: 'tictactoe:reset'}
   ```

## Next Steps

Now that we've reviewed the complete implementation, let's look at best practices and potential enhancements for our Tic-Tac-Toe game.

Next: [Best Practices and Next Steps](/guides/building-games/tic-tac-toe/best-practices) 