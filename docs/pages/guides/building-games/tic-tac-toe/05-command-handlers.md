---
layout: default
title: Implementing Command Handlers
permalink: /guides/building-games/tic-tac-toe/command-handlers
parent: Tic Tac Toe
grand_parent: Building Games
nav_order: 5
---

# Implementing Command Handlers

In this section, we'll implement the command handlers for our Tic-Tac-Toe game. Command handlers process player actions like creating a game, joining a game, making a move, and more.

## What Are Command Handlers?

Command handlers act as intermediaries between player actions and game state changes. They:
1. Validate incoming commands
2. Update the game state
3. Emit appropriate events
4. Send responses back to players

## Creating the Command Handlers File

Let's create our command handlers in `src/command-handlers.ts`:

```typescript
// src/command-handlers.ts
import { Player, Table, TableState, EventBus, MessageRouter, GameManager, Lobby } from 'shoehive';
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
  eventBus: EventBus,
  lobby: Lobby
): void {
  // Command handlers will be added here
}
```

## Creating a New Game

First, let's implement the handler for creating a new game:

```typescript
// Add inside the registerTicTacToeCommandHandlers function
// Create a new Tic-Tac-Toe game
messageRouter.registerCommandHandler('tictactoe:create', (player, data) => {
  // Create a new table
  const table = lobby.createTable('tic-tac-toe', {
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
```

This handler:
1. Creates a new game table
2. Adds the player to the table
3. Notifies the player
4. Emits a `GAME_CREATED` event

## Joining an Existing Game

Next, let's implement the handler for joining an existing game:

```typescript
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
  
  // If we now have two players, the game is ready to start
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
```

This handler:
1. Validates the table ID
2. Checks if the game is full
3. Adds the player to the table
4. Positions the player in a seat
5. Updates the game state if both players have joined

## Starting the Game

Next, let's implement the handler for starting the game:

```typescript
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
```

This handler:
1. Checks if the player is in a game
2. Validates that the game is ready to start
3. Updates the game state
4. Randomly selects the first player
5. Notifies all players

## Making a Move

Now, let's implement the most important handler for making a move:

```typescript
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
```

This handler is the most complex because it:
1. Validates the move coordinates
2. Checks if it's the player's turn
3. Makes the move on the board
4. Checks if the game has ended (win or draw)
5. Updates the game state accordingly
6. Notifies all players

## Forfeiting the Game

Let's implement the handler for a player forfeiting the game:

```typescript
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
```

This handler:
1. Checks if the player is in a game
2. Finds the opponent (who becomes the winner)
3. Updates the game state
4. Notifies all players about the forfeit

## Resetting the Game

Finally, let's implement the handler for resetting the game:

```typescript
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
```

This handler:
1. Checks if the player is in a game
2. Validates that the game is over
3. Resets the game state
4. Notifies all players

## Complete Command Handlers File

The complete `src/command-handlers.ts` file looks like this:

```typescript
// src/command-handlers.ts
import { Player, Table, TableState, EventBus, MessageRouter, GameManager, Lobby } from 'shoehive';
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
  eventBus: EventBus,
  lobby: Lobby
): void {
  // Create a new Tic-Tac-Toe game
  messageRouter.registerCommandHandler('tictactoe:create', (player, data) => {
    // Create a new table
    const table = lobby.createTable('tic-tac-toe', {
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
    
    // If we now have two players, the game is ready to start
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

## Next Steps

Now that we have implemented our command handlers, we're ready to create utility functions for game state management.

Next: [Game State Management](/guides/building-games/tic-tac-toe/state-management) 