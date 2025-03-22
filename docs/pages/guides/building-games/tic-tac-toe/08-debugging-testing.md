---
layout: default
title: Debugging and Testing
permalink: /guides/building-games/tic-tac-toe/debugging-testing
parent: Tic Tac Toe
grand_parent: Building Games
nav_order: 8
---

# Debugging and Testing

In this section, we'll learn how to debug and test our Tic-Tac-Toe game. Proper testing ensures that our game works correctly and provides a good user experience.

## Setting Up for Development

First, let's update our `package.json` to include convenient scripts for development:

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

Use `npm run dev` to run the game in development mode, which enables our debug monitoring.

## Debug Monitoring

In our main application, we've set up debug monitoring for development mode:

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

This logs all Tic-Tac-Toe events to the console, which helps us understand the flow of events during gameplay.

## Creating a Test Client

To test our game, let's create a simple WebSocket client. Create a file called `client.js` in the project root:

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

To use this client, first install the WebSocket library:

```bash
npm install ws
```

Then run the client:

```bash
node client.js
```

## Testing the Game

To test the game, you need to run two instances of the client to simulate two players.

### Test Case 1: Creating and Joining a Game

1. In the first client:
   - Run `create` to create a new game
   - Note the table ID that is returned

2. In the second client:
   - Run `join [tableId]` using the table ID from the first client
   - Both clients should receive a "gameReady" message

### Test Case 2: Starting the Game

1. In either client:
   - Run `start` to start the game
   - Both clients should receive a "gameStarted" message

### Test Case 3: Making Moves

1. The player whose turn it is:
   - Run `move 0 0` to place their symbol in the top-left corner
   - Both clients should receive a "moveMade" message

2. The other player:
   - Run `move 1 1` to place their symbol in the center
   - Continue alternating moves

### Test Case 4: Winning the Game

1. Try to get three symbols in a row:
   - If player 1 has X, they could play moves at (0,0), (0,1), and (0,2)
   - Both clients should receive a "gameOver" message with the winner information

### Test Case 5: Drawing the Game

1. Fill the board without a winner:
   - Make moves until all cells are filled but no player has three in a row
   - Both clients should receive a "gameOver" message with draw=true

### Test Case 6: Resetting the Game

1. After the game is over:
   - Run `reset` to reset the game
   - Both clients should receive a "gameReset" message

### Test Case 7: Forfeiting the Game

1. During an active game:
   - Run `forfeit` to forfeit the game
   - Both clients should receive a "gameOver" message with the forfeit information

## Common Issues and Debugging Tips

### Issue: Player can't join a game

Debugging steps:
1. Check that the table ID is correct
2. Verify that the table isn't already full (2 players)
3. Look for error messages in the server logs

### Issue: Moves aren't being accepted

Debugging steps:
1. Check if it's the player's turn
2. Verify that the cell coordinates are valid (0-2)
3. Ensure the cell isn't already occupied
4. Check that the game is in the IN_PROGRESS state

### Issue: Game state isn't updating correctly

Debugging steps:
1. Look at the event logs to see what events are being fired
2. Check the table attributes using console.log statements
3. Verify that the appropriate handler is being called

## Advanced Testing Techniques

For more robust testing, consider implementing:

1. **Unit Tests**: Test individual functions in isolation
2. **Integration Tests**: Test the interaction between components
3. **End-to-End Tests**: Test the entire game flow from start to finish
4. **Stress Tests**: Test the game with many concurrent players

## Next Steps

Now that we've learned how to debug and test our game, let's review the complete implementation and discuss best practices.

Next: [Complete Implementation](/guides/building-games/tic-tac-toe/complete-implementation) 