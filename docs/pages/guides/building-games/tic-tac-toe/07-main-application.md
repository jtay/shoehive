---
layout: default
title: Main Application
permalink: /guides/building-games/tic-tac-toe/main-application
parent: Tic Tac Toe
grand_parent: Building Games
nav_order: 7
---

# Main Application

In this section, we'll tie everything together in our main application file. This file will:
1. Create an HTTP server
2. Set up the Shoehive game server
3. Register our Tic-Tac-Toe game definition
4. Register our command handlers
5. Start the server

## Creating the Main File

Let's create our main application in `src/index.ts`:

```typescript
// src/index.ts
import * as http from 'http';
import { createGameServer, TableState } from 'shoehive';
import { TIC_TAC_TOE_EVENTS, GameState } from './events';
import { setupTicTacToeTable } from './game-logic';
import { registerTicTacToeCommandHandlers } from './command-handlers';
```

## Setting Up the Server

First, let's create an HTTP server and initialize the Shoehive game server:

```typescript
// Create HTTP server
const server = http.createServer();

// Create game server
const gameServer = createGameServer(server);
const { eventBus, messageRouter, gameManager } = gameServer;
```

The `createGameServer` function initializes Shoehive and returns important objects:
- `eventBus`: For emitting and listening to events
- `messageRouter`: For registering command handlers
- `gameManager`: For creating and managing games

## Registering the Game Definition

Next, let's register our Tic-Tac-Toe game definition:

```typescript
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
```

This registration provides Shoehive with information about our game, including:
- Unique identifier and display information
- Player limits
- The setup function that initializes tables for this game

## Registering Command Handlers

Now, let's register our command handlers:

```typescript
// Register command handlers
registerTicTacToeCommandHandlers(messageRouter, gameManager, eventBus);
```

This calls our function from `command-handlers.ts` that registers all the command handlers for our game.

## Setting Up Debug Monitoring

For development purposes, let's add some debug monitoring:

```typescript
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
```

This adds logging for all Tic-Tac-Toe events when running in development mode, which helps with debugging.

## Adding Additional Event Listeners

We can also add more event listeners for additional game logic:

```typescript
// Set up event listeners for additional game logic
eventBus.on(TIC_TAC_TOE_EVENTS.PLAYER_JOINED, (table, player) => {
  console.log(`Player ${player.id} joined Tic-Tac-Toe table ${table.id}`);
  
  // If this is the second player, the game is ready to start
  if (table.getPlayerCount() === 2) {
    table.setAttribute('gameState', GameState.READY_TO_START);
  }
});
```

This listener logs player joins and updates the game state when the second player joins.

## Starting the Server

Finally, let's start the server:

```typescript
// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Tic-Tac-Toe game server running on port ${PORT}`);
});
```

This starts the HTTP server on the specified port, making our game available to clients.

## Complete Main Application File

The complete `src/index.ts` file looks like this:

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

## Running the Application

To run the application, we can use the scripts we defined in `package.json`:

```bash
# Run in development mode (with debug monitoring)
npm run dev

# Run in production mode
npm start
```

## Architecture Overview

Our completed application follows a clean, modular architecture:

1. **Main Application (`index.ts`)**: Sets up the server and ties everything together
2. **Events (`events.ts`)**: Defines event constants and payload types
3. **Game Logic (`game-logic.ts`)**: Implements the core game mechanics
4. **Command Handlers (`command-handlers.ts`)**: Processes player actions
5. **Utilities (`utils.ts`)**: Provides helper functions for state management

This organization makes the code:
- **Maintainable**: Each component has a clear responsibility
- **Testable**: Components can be tested in isolation
- **Extensible**: New features can be added without major refactoring

## Next Steps

Now that we have implemented our main application file, we're ready to learn about debugging and testing the game.

Next: [Debugging and Testing](/guides/building-games/tic-tac-toe/debugging-testing) 