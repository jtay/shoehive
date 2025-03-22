---
layout: default
title: Receiving Messages
permalink: /guides/building-clients/receiving-messages
parent: Building Clients
has_children: true
nav_order: 3
---

# Receiving Messages

This guide will walk you through the process of receiving messages from the game server. Messages are responses to commands that you send to the server, as well as state updates that the server sends proactively.

## Message Types

The game server sends messages in response to commands and state changes:

### Command Responses
When you send a command to the server, you'll receive a response message indicating success or failure. For example:

- Lobby state message type: `lobby:state`
- Table state message type: `table:state`
- Player state message type: `player:state`

### State Updates
The server also proactively sends state update messages when important changes occur:

- Lobby state updates when:
  - Games are registered/unregistered
  - Tables are created/removed
  - Player attributes relevant to the lobby change

- Table state updates when:
  - Players join/leave
  - Game state changes
  - Player attributes relevant to the table change

- Player state updates when:
  - Attributes change
  - Connection status changes

## Example Message Payloads

### Player State Message

```javascript
// Example player:state message
{
  "type": "player:state",
  "id": "player-123",
  "name": "PlayerName",
  "tableId": "table-456",  // If the player is at a table
  "connected": true,
  "attributes": {
    // Custom player attributes
    "chips": 1000,
    "avatar": "avatar1"
  }
}
```

### Lobby State Message

```javascript
// Example lobby:state message
{
  "type": "lobby:state",
  "games": [
    {
      "id": "poker",
      "name": "Texas Hold'em Poker",
      "description": "Classic poker game"
    },
    {
      "id": "blackjack",
      "name": "Blackjack",
      "description": "Casino card game"
    }
  ],
  "tables": [
    {
      "id": "table-123",
      "gameId": "poker",
      "name": "Poker Table 1",
      "playerCount": 3,
      "maxPlayers": 6,
      "status": "active"
    },
    {
      "id": "table-456",
      "gameId": "blackjack",
      "name": "Blackjack Table 1",
      "playerCount": 2,
      "maxPlayers": 5,
      "status": "waiting"
    }
  ]
}
```

### Table State Message

```javascript
// Example table:state message
{
  "type": "table:state",
  "id": "table-123",
  "gameId": "poker",
  "name": "Poker Table 1",
  "status": "active",
  "players": [
    {
      "id": "player-123",
      "name": "Player1",
      "attributes": {
        "chips": 1000
      }
    },
    {
      "id": "player-456",
      "name": "Player2",
      "attributes": {
        "chips": 1500
      }
    }
  ],
  "seats": [
    {
      "index": 0,
      "playerId": "player-123",
      "state": "active"
    },
    {
      "index": 1,
      "playerId": "player-456",
      "state": "active"
    },
    {
      "index": 2,
      "playerId": null,
      "state": "empty"
    }
  ],
  "state": {
    // Game-specific state
    "round": "flop",
    "pot": 150,
    "communityCards": ["10H", "JS", "QD"],
    "currentTurn": 0
  }
}
```