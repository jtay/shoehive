---
layout: default
title: Default Events
permalink: /api/default-events
parent: Components
nav_order: 2
---

# 📘 Default Events

The shoehive package natively exposes a number of events related to the game server lifecycle.

## Event Naming Convention

Events follow a namespaced pattern with colon separators: `domain:action` or `domain:subject:action`

For example: `player:connected`, `table:player:joined`, etc.

## Player Events

Events related to player connections and state changes.

| Event | Description | Payload |
|-------|-------------|---------|
| `player:connected` | Emitted when a player connects to the server | Player object |
| `player:reconnected` | Emitted when a player reconnects after a disconnection | Player object |
| `player:disconnected` | Emitted when a player disconnects from the server | Player object |

## Lobby Events

Events related to the game lobby.

| Event | Description | Payload |
|-------|-------------|---------|
| `lobby:state` | Emitted when the lobby state changes or updates | Object containing available games and tables |

## Table Events

Events related to table management and state changes.

| Event | Description | Payload |
|-------|-------------|---------|
| `table:created` | Emitted when a new table is created | Table object |
| `table:empty` | Emitted when a table has no players left | Table object |
| `table:state:updated` | Emitted when a table's state changes or is updated | Table object, table state |

### Table Player Events

Events related to players at tables.

| Event | Description | Payload |
|-------|-------------|---------|
| `table:player:joined` / `player:joined:table` | Emitted when a player joins a table | Player object, Table object |
| `table:player:left` | Emitted when a player leaves a table | Player object, Table object |
| `table:player:sat` / `player:seated` | Emitted when a player sits at a seat | Player object, Table object, seat index |
| `table:player:stood` / `player:unseated` | Emitted when a player stands up from a seat | Player object, Table object, seat index |

## Card and Deck Events

Events related to card and deck operations.

| Event | Description | Payload |
|-------|-------------|---------|
| `table:deck:created` | Emitted when a deck is created for a table | Table object, number of decks |
| `table:deck:shuffled` | Emitted when a deck is shuffled | Table object |
| `table:card:drawn` | Emitted when a card is drawn from the deck | Table object, Card object |
| `table:card:dealt` | Emitted when a card is dealt to a seat | Table object, seat index, Card object, hand ID |

## Hand Management Events

Events related to hand management at table seats.

| Event | Description | Payload |
|-------|-------------|---------|
| `table:seat:hand:cleared` | Emitted when a hand at a seat is cleared | Table object, seat index, hand ID |
| `table:seats:hands:cleared` | Emitted when all hands at all seats are cleared | Table object |
| `table:seat:hand:added` | Emitted when a new hand is added to a seat | Table object, seat index, hand ID |
| `table:seat:hand:removed` | Emitted when a hand is removed from a seat | Table object, seat index, hand ID |

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
eventBus.on('table:state:updated', (table, tableState) => {
  console.log(`Table ${table.id} state updated to:`, tableState);
});

// Listen for card deals
eventBus.on('table:card:dealt', (table, seatIndex, card, handId) => {
  console.log(`Dealt ${card.toString()} to seat ${seatIndex}, hand ${handId}`);
});

// Event pattern usage examples
eventBus.on('player:connected', (player) => {
  console.log(`Player ${player.id} connected`);
});

eventBus.on('table:state:updated', (table, tableState) => {
  console.log(`Table ${table.id} state updated to:`, tableState);
});

// Using constant references
import { TABLE_EVENTS } from 'shoehive';

eventBus.on(TABLE_EVENTS.STATE_UPDATED, (table, tableState) => {
  console.log(`Table ${table.id} state updated to:`, tableState);
});
```

## Debugging Events

The EventBus provides a debug monitoring feature that can help during development:

```typescript
// Enable debug monitoring for all events
eventBus.debugMonitor(true);

// Enable debug monitoring with a filter for specific events
eventBus.debugMonitor(true, (event) => event.startsWith('table:'));

// Disable debug monitoring
eventBus.debugMonitor(false);
```



