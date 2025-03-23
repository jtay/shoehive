---
layout: default
title: Default Events
permalink: /api/default-events
parent: Components
nav_order: 2
---

# 📘 Default Events

The shoehive package natively exposes a number of events related to the game server lifecycle.

Events are broadcasted via the [EventBus](/api/classes/eventbus/) component. 

They are not to be confused with the [Command System](/api/command-system) which is used to manage messages between players and the server.

## Event Naming Convention

Events follow a namespaced pattern with colon separators: `domain:action` or `domain:subject:action`

For example: `player:connected`, `table:player:joined`, etc.

## Player Events

Events related to player connections and state changes.

| Event | Description | Payload |
|-------|-------------|---------|
| `player:connected` | Emitted when a player connects to the server | Player object |
| `player:disconnected` | Emitted when a player disconnects from the server | Player object |
| `player:reconnected` | Emitted when a player reconnects after a disconnection | Player object |
| `player:removed` | Emitted when a player is removed from the server | Player object |
| `player:state:updated` | Emitted when a player's state changes or updates | Player object |
| `player:attribute:changed` | Emitted when a single player attribute changes | Player object, key, value |
| `player:attributes:changed` | Emitted when multiple player attributes change | Player object, changedKeys, attributes |
| `player:authentication:failed` | Emitted when player authentication fails | Player object, reason |
| `player:authentication:succeeded` | Emitted when player authentication succeeds | Player object |

## Lobby Events

Events related to the game lobby. These events are primarily managed by the `Lobby` class.

| Event | Description | Payload |
|-------|-------------|---------|
| `lobby:updated` | Emitted when the lobby state changes or updates | Lobby object |
| `lobby:attribute:changed` | Emitted when a single lobby attribute changes | Lobby object, key, value |
| `lobby:attributes:changed` | Emitted when multiple lobby attributes change | Lobby object, changedKeys, attributes |

## Table Events

Events related to table management and state changes.

| Event | Description | Payload |
|-------|-------------|---------|
| `table:created` | Emitted when a new table is created | Table object |
| `table:empty` | Emitted when a table has no players left | Table object |
| `table:state:updated` | Emitted when a table's state changes or is updated | Table object |
| `table:attribute:changed` | Emitted when a single table attribute changes | Table object, key, value |
| `table:attributes:changed` | Emitted when multiple table attributes change | Table object, changedKeys, attributes |

### Table Player Events

Events related to players at tables.

| Event | Description | Payload |
|-------|-------------|---------|
| `table:player:joined` | Emitted when a player joins a table | Table object, Player object |
| `table:player:left` | Emitted when a player leaves a table | Table object, Player object |
| `table:player:sat` | Emitted when a player sits at a seat | Table object, Player object, seat index |
| `table:player:stood` | Emitted when a player stands up from a seat | Table object, Player object, seat index |

## Card and Deck Events

Events related to card and deck operations.

| Event | Description | Payload |
|-------|-------------|---------|
| `table:deck:created` | Emitted when a deck is created for a table | Table object, deck ID |
| `table:deck:shuffled` | Emitted when a deck is shuffled | Table object, deck ID |
| `table:deck:card:drawn` | Emitted when a card is drawn from the deck | Table object, deck ID, Card object |
| `table:card:dealt` | Emitted when a card is dealt to a player | Table object, Player object, Card object |

## Hand Management Events

Events related to hand management at table seats.

| Event | Description | Payload |
|-------|-------------|---------|
| `table:seat:hand:added` | Emitted when a new hand is added to a seat | Table object, seat index, hand ID |
| `table:seat:hand:removed` | Emitted when a hand is removed from a seat | Table object, seat index, hand ID |
| `table:seat:hand:cleared` | Emitted when a hand at a seat is cleared | Table object, seat index |
| `table:seats:hands:cleared` | Emitted when all hands at all seats are cleared | Table object |

## Using Events

You can listen for these events using the EventBus:

```typescript
import { EventBus } from 'shoehive';

const eventBus = new EventBus();

// Listen for player connections
eventBus.on('player:connected', (player) => {
  console.log(`Player ${player.id} connected`);
});

// Listen for table state changes
eventBus.on('table:state:updated', (table) => {
  console.log(`Table ${table.id} state updated`);
});

// Using constant references (recommended approach)
import { PLAYER_EVENTS, TABLE_EVENTS, LOBBY_EVENTS } from 'shoehive';

eventBus.on(PLAYER_EVENTS.CONNECTED, (player) => {
  console.log(`Player ${player.id} connected`);
});

eventBus.on(TABLE_EVENTS.STATE_UPDATED, (table) => {
  console.log(`Table ${table.id} state updated`);
});

// Combined event constants access
import { EVENTS } from 'shoehive';

eventBus.on(EVENTS.PLAYER.CONNECTED, (player) => {
  console.log(`Player ${player.id} connected`);
});

eventBus.on(EVENTS.TABLE.STATE_UPDATED, (table) => {
  console.log(`Table ${table.id} state updated`);
});
```

## Debugging Events

The EventBus provides a debug monitoring feature that can help during development:

```typescript
// Enable debug monitoring for all events
eventBus.debugMonitor(true);

// Enable debug monitoring with a filter for specific events
eventBus.debugMonitor(true, (event) => event.startsWith('table:'));

// Enable with custom logger
eventBus.debugMonitor(true, undefined, (event, ...args) => {
  console.log(`DEBUG: ${event}`, ...args);
});

// Disable debug monitoring
eventBus.debugMonitor(false);
```



