# Creating Custom Games with Shoehive

This guide will walk you through the process of building a custom game using the Shoehive framework.

## Overview

Creating a game with Shoehive involves:

1. Defining your game state and rules
2. Registering your game with the GameManager
3. Handling player actions via command handlers
4. Managing game state changes through events
5. Implementing game-specific logic

## Step 1: Define Your Game

First, you need to define your game by creating a `GameDefinition`:

```typescript
import { GameDefinition, Table, EventBus, TableOptions, GameConfig } from 'shoehive';

// Define default configuration
const ticTacToeConfig: GameConfig = {
  totalSeats: 2,     // Two players for Tic-Tac-Toe
  maxSeatsPerPlayer: 1  // One seat per player
};

// Create game definition
const ticTacToeGame: GameDefinition = {
  name: "Tic-Tac-Toe",
  defaultConfig: ticTacToeConfig,
  
  // Setup function is called when a table is created
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
gameServer.gameManager.registerGame('tic-tac-toe', ticTacToeGame);

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
    gameServer.eventBus.emit('gameEnded', table, winner);
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
    gameServer.eventBus.emit('gameEnded', table, null);
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

## Step 4: Handle Game Events

Set up event listeners for game-specific events:

```typescript
// Handle when players join the table
gameServer.eventBus.on('playerJoinedTable', (player, table) => {
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
    gameServer.eventBus.emit('gameStarted', table);
  }
});

// Handle when players leave the table
gameServer.eventBus.on('playerLeftTable', (player, table) => {
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
      
      // Emit event for game end
      gameServer.eventBus.emit('gameEnded', table, otherPlayer.id);
    }
  }
});
```

## Step 5: Reset and Restart Games

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

## Complete Game Example

Here's a complete example bringing everything together:

```typescript
import { createGameServer, GameDefinition, Table, Player, TableState } from 'shoehive';
import * as http from 'http';

// Create server
const server = http.createServer();
const gameServer = createGameServer(server);

// Define Tic-Tac-Toe game
const ticTacToeGame: GameDefinition = {
  name: "Tic-Tac-Toe",
  defaultConfig: {
    totalSeats: 2,
    maxSeatsPerPlayer: 1
  },
  setupTable: (table: Table) => {
    table.setAttribute('board', [
      [null, null, null],
      [null, null, null],
      [null, null, null]
    ]);
    table.setAttribute('currentPlayer', null);
    table.setAttribute('winner', null);
    table.setAttribute('gameOver', false);
    table.setAttribute('lastStarter', null);
  }
};

// Register the game
gameServer.gameManager.registerGame('tic-tac-toe', ticTacToeGame);

// Register command handlers
gameServer.messageRouter.registerCommandHandler('makeMove', (player, data) => {
  if (!data.row || !data.col || 
      typeof data.row !== 'number' || 
      typeof data.col !== 'number') {
    return;
  }
  
  const table = player.getTable();
  if (!table) return;
  
  if (!isValidMove(table, player, data.row, data.col)) {
    player.sendMessage({
      type: 'error',
      message: 'Invalid move'
    });
    return;
  }
  
  makeMove(table, player, data.row, data.col);
  checkGameState(table);
});

gameServer.messageRouter.registerCommandHandler('resetGame', (player, data) => {
  const table = player.getTable();
  if (!table) return;
  
  if (!table.getAttribute('gameOver')) {
    player.sendMessage({
      type: 'error',
      message: 'Cannot reset an active game'
    });
    return;
  }
  
  resetGame(table);
  
  table.broadcastToAll({
    type: 'gameReset',
    board: table.getAttribute('board'),
    currentPlayer: table.getAttribute('currentPlayer')
  });
});

// Set up event listeners
gameServer.eventBus.on('playerJoinedTable', (player, table) => {
  if (table.getAttribute('gameId') !== 'tic-tac-toe') return;
  
  const players = table.getSeatMap().filter(p => p !== null);
  
  if (players.length === 2 && table.getState() === 'WAITING') {
    // Decide who goes first
    const starterIndex = Math.round(Math.random()); // Random first player
    const starter = players[starterIndex];
    
    table.setAttribute('currentPlayer', starter.id);
    table.setAttribute('lastStarter', starter.id);
    table.setState('ACTIVE');
    
    table.broadcastToAll({
      type: 'gameStart',
      board: table.getAttribute('board'),
      currentPlayer: starter.id,
      players: players.map(p => ({ 
        id: p.id, 
        symbol: players.indexOf(p) === 0 ? 'X' : 'O' 
      }))
    });
  }
});

gameServer.eventBus.on('playerLeftTable', (player, table) => {
  if (table.getAttribute('gameId') !== 'tic-tac-toe') return;
  
  if (table.getState() === 'ACTIVE') {
    const players = table.getPlayers();
    const otherPlayer = players.find(p => p.id !== player.id);
    
    if (otherPlayer) {
      table.setAttribute('winner', otherPlayer.id);
      table.setAttribute('gameOver', true);
      table.setState('ENDED');
      
      table.broadcastToAll({
        type: 'gameOver',
        winner: otherPlayer.id,
        reason: 'forfeit',
        board: table.getAttribute('board')
      });
    }
  }
});

// Helper functions
function isValidMove(table: Table, player: Player, row: number, col: number): boolean {
  const board = table.getAttribute('board');
  const currentPlayerId = table.getAttribute('currentPlayer');
  const gameOver = table.getAttribute('gameOver');
  
  if (gameOver) return false;
  if (currentPlayerId !== player.id) return false;
  if (row < 0 || row > 2 || col < 0 || col > 2) return false;
  if (board[row][col] !== null) return false;
  
  return true;
}

function makeMove(table: Table, player: Player, row: number, col: number): void {
  const board = table.getAttribute('board');
  const players = table.getSeatMap().filter(p => p !== null);
  
  const playerIndex = players.findIndex(p => p && p.id === player.id);
  const symbol = playerIndex === 0 ? 'X' : 'O';
  
  board[row][col] = symbol;
  table.setAttribute('board', board);
  
  const nextPlayerIndex = (playerIndex + 1) % players.length;
  const nextPlayer = players[nextPlayerIndex];
  table.setAttribute('currentPlayer', nextPlayer ? nextPlayer.id : null);
  
  table.broadcastToAll({
    type: 'boardUpdate',
    board: board,
    lastMove: { row, col, symbol, playerId: player.id },
    currentPlayer: nextPlayer ? nextPlayer.id : null
  });
}

function checkGameState(table: Table): void {
  const board = table.getAttribute('board');
  
  const winner = checkWinner(board);
  
  if (winner) {
    // Find winning player
    const players = table.getSeatMap().filter(p => p !== null);
    const winningPlayerIndex = winner === 'X' ? 0 : 1;
    const winningPlayer = players[winningPlayerIndex];
    
    table.setAttribute('winner', winningPlayer ? winningPlayer.id : null);
    table.setAttribute('gameOver', true);
    table.setState('ENDED');
    
    table.broadcastToAll({
      type: 'gameOver',
      winner: winningPlayer ? winningPlayer.id : null,
      symbol: winner,
      board: board
    });
  } else if (isBoardFull(board)) {
    table.setAttribute('gameOver', true);
    table.setState('ENDED');
    
    table.broadcastToAll({
      type: 'gameOver',
      winner: null,
      isDraw: true,
      board: board
    });
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

function resetGame(table: Table): void {
  table.setAttribute('board', [
    [null, null, null],
    [null, null, null],
    [null, null, null]
  ]);
  
  table.setAttribute('winner', null);
  table.setAttribute('gameOver', false);
  
  const players = table.getSeatMap().filter(p => p !== null);
  
  if (players.length === 2) {
    const lastStarterId = table.getAttribute('lastStarter');
    const newStarterIndex = lastStarterId === players[0].id ? 1 : 0;
    
    table.setAttribute('currentPlayer', players[newStarterIndex].id);
    table.setAttribute('lastStarter', players[newStarterIndex].id);
    
    table.setState('ACTIVE');
  } else {
    table.setAttribute('currentPlayer', null);
    table.setState('WAITING');
  }
}

// Start the server
server.listen(3000, () => {
  console.log('Game server running on port 3000');
});
```

## Building a Client

The client side would typically be a web application that connects to your Shoehive server via WebSocket:

```javascript
// Example client-side code (using browser WebSocket)
const socket = new WebSocket('ws://localhost:3000?userId=player123');

socket.onopen = function() {
  console.log('Connected to game server');
  
  // Join or create a Tic-Tac-Toe table
  socket.send(JSON.stringify({
    action: 'createTable',
    gameId: 'tic-tac-toe'
  }));
};

socket.onmessage = function(event) {
  const message = JSON.parse(event.data);
  
  // Handle different message types
  switch (message.type) {
    case 'gameCreated':
      console.log('Game created with table ID:', message.tableId);
      break;
      
    case 'gameStart':
      console.log('Game started!');
      renderBoard(message.board);
      highlightCurrentPlayer(message.currentPlayer);
      break;
      
    case 'boardUpdate':
      renderBoard(message.board);
      highlightCurrentPlayer(message.currentPlayer);
      break;
      
    case 'gameOver':
      renderBoard(message.board);
      if (message.isDraw) {
        showGameResult("It's a draw!");
      } else {
        showGameResult(`Player ${message.winner} wins!`);
      }
      showResetButton();
      break;
      
    case 'gameReset':
      renderBoard(message.board);
      highlightCurrentPlayer(message.currentPlayer);
      hideGameResult();
      hideResetButton();
      break;
      
    case 'error':
      showError(message.message);
      break;
  }
};

// Make a move
function makeMove(row, col) {
  socket.send(JSON.stringify({
    action: 'makeMove',
    row: row,
    col: col
  }));
}

// Reset the game
function resetGame() {
  socket.send(JSON.stringify({
    action: 'resetGame'
  }));
}

// UI helper functions
function renderBoard(board) {
  // Update UI to show the current board state
}

function highlightCurrentPlayer(playerId) {
  // Highlight the current player's turn
}

function showGameResult(message) {
  // Display game result message
}

function hideGameResult() {
  // Hide game result message
}

function showResetButton() {
  // Show the reset game button
}

function hideResetButton() {
  // Hide the reset game button
}

function showError(message) {
  // Show error message
}
```

## Best Practices

When creating games with Shoehive, keep these best practices in mind:

1. **Separate concerns**: Keep game logic, state management, and UI separate
2. **Validate inputs**: Always validate player inputs on the server side
3. **Prevent cheating**: Don't trust client data for game state
4. **Handle disconnections**: Have a strategy for when players disconnect
5. **Implement reconnection**: Allow players to reconnect and continue playing
6. **Use events**: Leverage the event system for game state changes
7. **Document messages**: Create clear documentation of message formats
8. **Error handling**: Provide meaningful error messages to players
9. **Testing**: Test your game with multiple players and scenarios
10. **Performance**: Be mindful of message sizes and frequency

## Next Steps
- Learn about [using Transport Modules](./transport-modules.md) for authentication and transactions
- Explore [Advanced Event Patterns](./advanced-events.md) for complex games 