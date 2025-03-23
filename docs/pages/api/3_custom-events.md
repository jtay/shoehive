---
layout: default
title: Custom Events
permalink: /api/custom-events
parent: Components
nav_order: 3
---

# Extending the Shoehive Event System

This guide explains how to extend the Shoehive event system with your own custom events for your specific game implementations.

## Introduction

Shoehive follows an event-driven architecture where components communicate through events. While the framework provides a set of standard events for common functionality (see [Default Events](/api/default-events)), your specific game logic will likely require custom events.

Custom events are not to be confused with the [Command System](/api/command-system) which is used to manage messages between players and the server.

## Naming Convention

All events in Shoehive follow a namespaced pattern with colon separators:

```
domain:action
```

or

```
domain:subject:action
```

For example:
- `player:connected`
- `table:player:joined`
- `table:state:updated`

When creating your own events, it's recommended to follow this same pattern with your game name as the domain:

```
poker:hand:dealt
chess:piece:moved
blackjack:card:dealt
```

## Creating Custom Event Constants

The easiest way to extend the event system is to create your own event constants object. Here's an example for a poker game:

```typescript
// poker-events.ts
export const POKER_EVENTS = {
  HAND_DEALT: "poker:hand:dealt",
  BETTING_ROUND_STARTED: "poker:betting:started",
  BETTING_ROUND_ENDED: "poker:betting:ended",
  PLAYER_FOLDED: "poker:player:folded",
  PLAYER_CALLED: "poker:player:called",
  PLAYER_RAISED: "poker:player:raised",
  SHOWDOWN: "poker:showdown",
  WINNER_DETERMINED: "poker:winner:determined"
} as const;

// Create a type from the event constants
export type PokerEventType = typeof POKER_EVENTS[keyof typeof POKER_EVENTS];

// Define the payload structures for your custom events
export interface PokerEventPayloadMap {
  [POKER_EVENTS.HAND_DEALT]: [player: Player, cards: Card[]];
  [POKER_EVENTS.BETTING_ROUND_STARTED]: [table: Table, minBet: number];
  [POKER_EVENTS.BETTING_ROUND_ENDED]: [table: Table, pot: number];
  [POKER_EVENTS.PLAYER_FOLDED]: [table: Table, player: Player];
  [POKER_EVENTS.PLAYER_CALLED]: [table: Table, player: Player, amount: number];
  [POKER_EVENTS.PLAYER_RAISED]: [table: Table, player: Player, amount: number];
  [POKER_EVENTS.SHOWDOWN]: [table: Table, players: Player[]];
  [POKER_EVENTS.WINNER_DETERMINED]: [table: Table, player: Player, pot: number];
}
```

## Integrating with TypeScript Type System

Shoehive provides a way to integrate your custom events with its type system. This provides type checking and autocompletion for your custom events:

```typescript
// Extend the Shoehive type system with your custom events
declare module "shoehive" {
  interface CustomEventMap {
    pokerEvents: PokerEventType;
  }
}
```

With this declaration, your custom events will be included in the `EventType` union type, allowing for type checking when using the EventBus.

## Using Custom Events

Once you've defined your custom events, you can use them with the EventBus just like the built-in events:

```typescript
import { EventBus } from 'shoehive';
import { POKER_EVENTS } from './poker-events';

// Create an instance of EventBus (or use the one from createGameServer)
const eventBus = new EventBus();

// Register event handlers for your custom events
eventBus.on(POKER_EVENTS.HAND_DEALT, (player, cards) => {
  console.log(`Dealt ${cards.length} cards to player ${player.id}`);
});

eventBus.on(POKER_EVENTS.BETTING_ROUND_STARTED, (table, minBet) => {
  console.log(`Betting round started at table ${table.id} with minimum bet ${minBet}`);
});

// Emit custom events
eventBus.emit(POKER_EVENTS.HAND_DEALT, player, cards);
eventBus.emit(POKER_EVENTS.BETTING_ROUND_STARTED, table, 10);
```

## Creating a Specialized Game Module

For more complex games, you might want to create a specialized module that encapsulates your game's events and logic:

```typescript
// poker-module.ts
import { EventBus, Table, Player, TABLE_EVENTS, PLAYER_EVENTS } from 'shoehive';
import { POKER_EVENTS } from './poker-events';

export class PokerModule {
  private eventBus: EventBus;
  
  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.registerEventHandlers();
  }
  
  private registerEventHandlers() {
    // Listen for core game events and translate to poker-specific events
    this.eventBus.on(TABLE_EVENTS.PLAYER_JOINED, (table, player) => {
      // Initialize player's poker state when they join
      this.initializePlayerState(player, table);
    });
    
    this.eventBus.on(TABLE_EVENTS.STATE_UPDATED, (table) => {
      if (table.getAttribute('state') === 'ACTIVE') {
        // Start a new poker hand when the table becomes active
        this.startNewHand(table);
      }
    });
  }
  
  private initializePlayerState(player: Player, table: Table) {
    player.setAttribute('chips', 1000); // Initial chip count
    player.setAttribute('currentBet', 0);
    player.setAttribute('folded', false);
  }
  
  public startNewHand(table: Table) {
    // Deal cards to players
    const players = table.getPlayers();
    for (const player of players) {
      const cards = this.dealCards(2); // Deal 2 cards for Texas Hold'em
      player.setAttribute('hand', cards);
      
      // Emit custom event for the hand being dealt
      this.eventBus.emit(POKER_EVENTS.HAND_DEALT, player, cards);
    }
    
    // Start first betting round
    this.startBettingRound(table, 5); // Small blind 5
  }
  
  public startBettingRound(table: Table, minBet: number) {
    table.setAttribute('currentMinBet', minBet);
    
    // Emit custom event
    this.eventBus.emit(POKER_EVENTS.BETTING_ROUND_STARTED, table, minBet);
  }
  
  // Add more poker-specific methods...
  private dealCards(count: number) {
    // Implementation of card dealing...
    return [];
  }
}
```

## Debugging Custom Events

Shoehive provides a debug monitor for events, which can be very helpful when implementing custom events:

```typescript
// Enable debug monitoring for all events
eventBus.debugMonitor(true);

// Only monitor poker events
eventBus.debugMonitor(true, (eventName) => eventName.startsWith('poker:'));

// Custom logger
eventBus.debugMonitor(true, undefined, (event, ...args) => {
  console.log(`[POKER EVENT] ${event} occurred with data:`, args);
});
```

## Best Practices

1. **Consistent Naming**: Follow the `domain:action` pattern for all your events
2. **Use Constants**: Define all your events as constants to avoid typos and get better IDE support
3. **Define Payload Types**: Create interfaces for your event payloads to ensure type safety
4. **Document Payloads**: Clearly document what data is included with each event
5. **Event Segregation**: Keep events specific to their domain (e.g., poker events start with "poker:")
6. **Clean Up Listeners**: Remove event listeners when components are destroyed to prevent memory leaks
7. **Module Pattern**: For complex games, encapsulate related events and logic in a module

## Complete Example

Here's a complete example of implementing custom events for a poker game:

```typescript
// poker-events.ts
import { Player, Table } from 'shoehive';

export const POKER_EVENTS = {
  HAND_DEALT: "poker:hand:dealt",
  BETTING_ROUND_STARTED: "poker:betting:started",
  PLAYER_ACTION: "poker:player:action"
} as const;

export type PokerEventType = typeof POKER_EVENTS[keyof typeof POKER_EVENTS];

export interface PokerEventPayloadMap {
  [POKER_EVENTS.HAND_DEALT]: [player: Player, cards: any[]];
  [POKER_EVENTS.BETTING_ROUND_STARTED]: [table: Table, minBet: number];
  [POKER_EVENTS.PLAYER_ACTION]: [table: Table, player: Player, action: string, amount?: number];
}

// Extend Shoehive's type system
declare module "shoehive" {
  interface CustomEventMap {
    pokerEvents: PokerEventType;
  }
}

// poker-game.ts
import { createGameServer, Player, Table } from 'shoehive';
import { POKER_EVENTS } from './poker-events';
import * as http from 'http';

// Create HTTP server
const server = http.createServer();

// Create game server
const gameServer = createGameServer(server);
const { eventBus, gameManager } = gameServer;

// Register poker game definition
gameManager.registerGame({
  id: 'poker',
  name: 'Texas Hold\'em Poker',
  description: 'The classic poker variant',
  minPlayers: 2,
  maxPlayers: 9,
  defaultSeats: 9,
  maxSeatsPerPlayer: 1,
  options: {
    setupTable: (table: Table) => {
      table.setAttribute('gameId', 'poker');
      table.setAttribute('deck', []);
      table.setAttribute('communityCards', []);
      table.setAttribute('pot', 0);
      table.setAttribute('currentBet', 0);
      table.setAttribute('currentPlayer', null);
      table.setAttribute('dealerPosition', 0);
    }
  }
});

// Register event handlers for custom poker events
eventBus.on(POKER_EVENTS.HAND_DEALT, (player: Player, cards: any[]) => {
  console.log(`Dealt cards to player ${player.id}`);
  // Handle the event...
});

eventBus.on(POKER_EVENTS.BETTING_ROUND_STARTED, (table: Table, minBet: number) => {
  console.log(`Betting round started at table ${table.id}`);
  // Handle the event...
});

// Register command handlers for poker-specific actions
gameServer.messageRouter.registerCommandHandler('poker:bet', (player, data) => {
  if (!data.amount) return;
  const table = player.getTable();
  if (!table) return;
  
  // Process the bet
  const currentBet = table.getAttribute('currentBet') || 0;
  table.setAttribute('currentBet', data.amount);
  
  // Emit a custom event for the player action
  eventBus.emit(POKER_EVENTS.PLAYER_ACTION, table, player, 'bet', data.amount);
  
  // Notify all players about the bet
  table.broadcastToAll({
    type: 'playerBet',
    playerId: player.id,
    amount: data.amount
  });
});

// Enable debug monitoring for development
eventBus.debugMonitor(true, (event) => event.startsWith('poker:'));

// Start the server
server.listen(3000, () => {
  console.log('Poker server running on port 3000');
});
```