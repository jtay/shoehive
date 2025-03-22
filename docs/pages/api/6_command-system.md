---
layout: default
title: Command System
permalink: /api/command-system
parent: Components
nav_order: 6
---

# 📨 Command System

The command system in Shoehive provides a structured way to send messages between clients and the server, enabling bidirectional communication for game actions and state updates.

## Introduction

The command system consists of:
- **Message Router**: Routes incoming client messages to appropriate handlers
- **Command Handlers**: Functions that process specific types of commands
- **Message Types**: Standard formats for outbound messages from server to client

## Message Flow

1. **Client to Server**: Clients send commands as JSON messages with an `action` property
2. **Server Processing**: The MessageRouter processes these commands using registered handlers
3. **Server to Client**: The server sends structured responses using standard message types

## Sending Commands (Client)

Clients send commands to the server as JSON messages with this structure:

```javascript
{
  "action": "domain:action",
  "tableId": "table-123",  // Optional, depends on the action
  // Other action-specific properties
}
```

Example of sending a command from the client:

```javascript
// Example client-side code
const sendCommand = (action, data = {}) => {
  const message = JSON.stringify({
    action,
    ...data
  });
  socket.send(message);
};

// Join a table
sendCommand('table:join', { tableId: 'table-123' });

// Make a game move
sendCommand('game:poker:bet', { tableId: 'table-123', amount: 50 });
```

## Command Naming Convention

Commands follow the same namespaced pattern as events:

```
domain:action
```

or

```
domain:subject:action
```

For example:
- `table:join`
- `game:choice:make`
- `player:ready`

## Handling Commands (Server)

On the server side, the MessageRouter processes incoming commands:

```typescript
import { MessageRouter } from 'shoehive';
import { Player, Lobby } from 'shoehive';

// Create a message router connected to the event bus
const messageRouter = new MessageRouter(eventBus);

// Register a command handler for table creation 
messageRouter.registerCommandHandler(
  'lobby:table:create',
  (player: Player, data: any) => {
    const { gameId, options } = data;
    const table = gameServer.lobby.createTable(gameId, options);
    
    if (table) {
      // Add the player to the new table
      table.addPlayer(player);
      
      // Notify the player
      player.sendMessage({
        type: 'table:created',
        tableId: table.id
      });
      
      // Send current table state
      table.sendState(player);
    } else {
      player.sendMessage({
        type: 'error',
        message: 'Failed to create table'
      });
    }
  }
);

// Register a game-specific command handler
messageRouter.registerCommandHandler(
  'game:choice:make',
  (player: Player, data: any) => {
    const { tableId, choice } = data;
    // Process the player's choice
    console.log(`Player ${player.id} chose ${choice} at table ${tableId}`);
    
    // Update game state based on choice
    // ...
    
    // Respond to the player
    player.sendMessage({
      type: 'game:choice:result',
      success: true,
      result: 'Your choice was processed'
    });
  }
);
```

## Outbound Messages (Server to Client)

The server sends structured messages to clients. There are several standard message types:

### Standard Message Types

| Category | Message Type | Description |
|----------|--------------|-------------|
| Lobby | `lobby:state` | Provides current lobby state with available games and tables |
| Table | `table:state` | Provides the current state of a specific table |
| Player | `player:state` | Provides the current state of a player |
| Error | `error` | Indicates an error occurred processing a command |

### Example Outbound Messages

**Player State Message:**
```javascript
{
  "type": "player:state",
  "id": "player-123",
  "name": "PlayerName",
  "tableId": "table-456", 
  "connected": true,
  "attributes": {
    "chips": 1000,
    "avatar": "avatar1"
  }
}
```

**Error Message:**
```javascript
{
  "type": "error",
  "message": "Invalid message format: missing or invalid action"
}
```

## Extending with Custom Commands

You can extend the command system with your own game-specific commands:

```typescript
// Register a custom command for a poker game
messageRouter.registerCommandHandler(
  'poker:bet',
  (player: Player, data: any) => {
    const { tableId, amount } = data;
    const table = player.getTable();
    
    if (!table || table.id !== tableId) {
      player.sendMessage({
        type: 'error',
        message: 'You are not at this table'
      });
      return;
    }
    
    // Process the bet
    // ...
    
    // Broadcast the action to all players at the table
    table.broadcastToAll({
      type: 'poker:action',
      playerId: player.id,
      action: 'bet',
      amount: amount
    });
  }
);
```

## Best Practices

1. **Consistent Naming**: Follow the `domain:action` pattern for all your commands
2. **Validation**: Always validate incoming command data before processing
3. **Error Handling**: Send clear error messages when commands fail
4. **Security**: Never trust client input; validate permissions before processing commands
5. **Idempotency**: Design commands to be idempotent when possible (can be safely retried)
6. **Command Documentation**: Document all available commands and their expected parameters
7. **Response Consistency**: Maintain consistent response formats across all commands

## Debugging Commands

For debugging purposes, you can log incoming commands:

```typescript
// Simple command logging middleware
messageRouter.registerCommandHandler('*', (player, data) => {
  console.log(`[Command] ${player.id} -> ${data.action}`, data);
  // Note: This doesn't handle the command, just logs it
  return false; // Continue processing with other handlers
});
```

## Complete Example

```typescript
import { createGameServer } from 'shoehive';
import * as http from 'http';

// Create HTTP server
const server = http.createServer();

// Create game server
const gameServer = createGameServer(server);
const { messageRouter, lobby } = gameServer;

// Register command handler for table creation
messageRouter.registerCommandHandler('lobby:table:create', (player, data) => {
  const { gameId, options } = data;
  
  // Create the table using the lobby
  const table = lobby.createTable(gameId, options);
  
  if (table) {
    // Notify player of success
    player.sendMessage({
      type: 'table:created',
      tableId: table.id
    });
  } else {
    player.sendMessage({
      type: 'error',
      message: 'Failed to create table'
    });
  }
});

// Register command handlers for table joining
messageRouter.registerCommandHandler('table:join', (player, data) => {
  const { tableId } = data;
  const table = gameServer.tableManager.getTable(tableId);
  
  if (!table) {
    player.sendMessage({
      type: 'error',
      message: 'Table not found'
    });
    return;
  }
  
  // Add player to table
  const success = table.addPlayer(player);
  
  if (success) {
    // Notify player of success
    player.sendMessage({
      type: 'table:joined',
      tableId: table.id
    });
    
    // Send the current table state
    table.sendState(player);
  } else {
    player.sendMessage({
      type: 'error',
      message: 'Failed to join table'
    });
  }
});

// Start the server
server.listen(3000, () => {
  console.log('Game server running on port 3000');
});
```


