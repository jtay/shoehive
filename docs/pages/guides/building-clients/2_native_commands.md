---
layout: default
title: Native Commands
permalink: /guides/building-clients/native-commands
parent: Building Clients
has_children: true
nav_order: 2
---

# Native Commands

Native commands are commands that are built into the Shoehive game server. They are used to interact with the game server and are not game-specific.

## Lobby Commands

The following commands are available for interacting with the lobby:

- `lobby:state:get` - Get the current state of the lobby
- `lobby:table:join` - Join an existing table
- `lobby:table:create` - Create a new table

### Examples

```javascript
// Request the current lobby state
socket.send(JSON.stringify({
  action: 'lobby:state:get'
}));

// Join an existing table
socket.send(JSON.stringify({
  action: 'lobby:table:join',
  tableId: 'table-123'
}));

// Create a new table
socket.send(JSON.stringify({
  action: 'lobby:table:create',
  gameId: 'poker',
  options: {
    // Game-specific options
    maxPlayers: 6,
    blinds: { small: 1, big: 2 }
  }
}));
```

## Table Commands

The following commands are available for interacting with tables:

- `table:state:get` - Get the current state of a table
- `table:join` - Join a table as a spectator
- `table:leave` - Leave a table
- `table:seat:sit` - Sit at a seat at the table
- `table:seat:stand` - Stand up from a seat at the table

### Examples

```javascript
// Get the current state of a table
socket.send(JSON.stringify({
  action: 'table:state:get',
  tableId: 'table-123'
}));

// Join a table as a spectator
socket.send(JSON.stringify({
  action: 'table:join',
  tableId: 'table-123'
}));

// Leave a table
socket.send(JSON.stringify({
  action: 'table:leave'
}));

// Sit at a seat at the table
socket.send(JSON.stringify({
  action: 'table:seat:sit',
  seatIndex: 2
}));

// Stand up from a seat at the table
socket.send(JSON.stringify({
  action: 'table:seat:stand',
  seatIndex: 2
}));
```

## Player Commands

The following commands are available for interacting with player state:

- `player:state:get` - Get the current state of the player

### Example

```javascript
// Get the current player state
socket.send(JSON.stringify({
  action: 'player:state:get'
}));
```

## Shoehive Responds to Commands with Messages

When you send a command to the game server, the server will respond with a message. The message will be in the format of the command you sent.

For example, if you send a `lobby:state:get` command, the server will respond with a `lobby:state` message.

### Command and Response Flow

```
Client                    Server
  |                         |
  |--- lobby:state:get ---->|
  |                         |
  |<---- lobby:state -------|
  |                         |
  |--- table:join --------->|
  |                         |
  |<---- table:state -------|
  |                         |
```


