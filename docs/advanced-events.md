# Advanced Event Patterns in Shoehive

This guide explores advanced event patterns and techniques for building complex multiplayer games with Shoehive.

## Event-Driven Architecture

Shoehive's event system is built on an event-driven architecture that helps you decouple various components of your game. This approach offers several advantages:

- **Modularity**: Components can communicate without direct dependencies
- **Flexibility**: Easy to add or modify features with minimal changes to existing code
- **Testability**: Event handlers can be tested in isolation
- **Scalability**: Events can be distributed across multiple services in larger implementations

## Beyond Basic Events

### Using Predefined Event Constants

Shoehive provides a set of predefined event constants in the `EventTypes.ts` file. Using these constants instead of string literals gives you type safety and better IDE support:

```typescript
import { PLAYER_EVENTS, TABLE_EVENTS, GAME_EVENTS, EVENTS } from 'shoehive';

// Using predefined event constants
eventBus.on(PLAYER_EVENTS.CONNECTED, (player) => {
  console.log(`Player ${player.id} connected`);
});

eventBus.on(TABLE_EVENTS.PLAYER_JOINED, (player, table) => {
  console.log(`Player ${player.id} joined table ${table.id}`);
});

eventBus.on(GAME_EVENTS.STARTED, (table, options) => {
  console.log(`Game started at table ${table.id} with options:`, options);
});

// You can also access all event groups through the EVENTS object
eventBus.on(EVENTS.PLAYER.CONNECTED, playerConnectedHandler);
eventBus.on(EVENTS.TABLE.CREATED, tableCreatedHandler);
```

### Creating Custom Event Constants

For complex games, you should define your own event constants following the same pattern:

```typescript
// Define custom event constants in a separate file
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

// Create a type for your custom events
export type PokerEventType = typeof POKER_EVENTS[keyof typeof POKER_EVENTS];

// Use them with the EventBus
import { EventBus } from 'shoehive';
import { POKER_EVENTS } from './poker-events';

const eventBus = new EventBus();

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

### Event Namespacing

Shoehive follows a consistent event naming convention using namespaces with colon separators:

```
domain:action
```

or

```
domain:subdomain:action
```

For example:
- `player:connected`
- `table:player:joined`
- `table:state:changed`

When creating your own events, follow this same pattern with your game name as the domain:

```
poker:hand:dealt
chess:piece:moved
blackjack:card:dealt
```

### Using the Debug Monitor

Shoehive's EventBus includes a debug monitor to help you track and analyze events during development. This is especially useful for complex event-driven games:

```typescript
import { EventBus, EVENTS } from 'shoehive';

const eventBus = new EventBus();

// Enable debug monitoring for all events
eventBus.debugMonitor(true);

// Emitting any event will now log it to the console
eventBus.emit('game:started', { gameId: 'poker', players: 4 });
// [EVENT] game:started { gameId: 'poker', players: 4 }

// Filter events by name pattern
eventBus.debugMonitor(true, (eventName) => eventName.startsWith('poker:'));

// Now only poker: events will be logged
eventBus.emit('poker:hand:dealt', player, cards); // Will be logged
eventBus.emit('player:connected', player); // Won't be logged

// Use a custom logger
const myLogger = (event, ...args) => {
  console.log(`Event "${event}" fired at ${new Date().toISOString()} with data:`, ...args);
};

eventBus.debugMonitor(true, undefined, myLogger);

// Disable debug monitoring when done
eventBus.debugMonitor(false);
```

## Game-Specific Event Wrappers

For complex games, you might want to create a game-specific wrapper around the EventBus:

```typescript
import { EventBus } from 'shoehive';
import { POKER_EVENTS } from './poker-events';

class PokerEventBus {
  private eventBus: EventBus;
  
  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }
  
  // Typed event listeners
  public onHandDealt(listener: (player: Player, cards: Card[]) => void): void {
    this.eventBus.on(POKER_EVENTS.HAND_DEALT, listener);
  }
  
  public onBettingRoundStarted(listener: (table: Table, minBet: number) => void): void {
    this.eventBus.on(POKER_EVENTS.BETTING_ROUND_STARTED, listener);
  }
  
  // Typed event emitters
  public emitHandDealt(player: Player, cards: Card[]): void {
    this.eventBus.emit(POKER_EVENTS.HAND_DEALT, player, cards);
  }
  
  public emitBettingRoundStarted(table: Table, minBet: number): void {
    this.eventBus.emit(POKER_EVENTS.BETTING_ROUND_STARTED, table, minBet);
  }
}

// Usage
const pokerEvents = new PokerEventBus(eventBus);

pokerEvents.onHandDealt((player, cards) => {
  // Handle the event with proper typing
});

pokerEvents.emitHandDealt(player, cards);
```

## Combining Built-in and Custom Events

You can combine built-in and custom events for better organization:

```typescript
import { EVENTS } from 'shoehive';
import { POKER_EVENTS } from './poker-events';

// Create an event combination for monitoring
const combinedEvents = {
  ...EVENTS,
  POKER: POKER_EVENTS
};

// Use the combined events object
eventBus.on(combinedEvents.PLAYER.CONNECTED, playerConnectedHandler);
eventBus.on(combinedEvents.TABLE.CREATED, tableCreatedHandler);
eventBus.on(combinedEvents.POKER.SHOWDOWN, pokerShowdownHandler);

// Emit events using the combined object
eventBus.emit(combinedEvents.PLAYER.CONNECTED, player);
eventBus.emit(combinedEvents.POKER.SHOWDOWN, { players: [player] });
```

## Advanced Patterns

### State Machine Pattern

Complex games benefit from implementing a state machine to manage game flow:

```typescript
enum PokerGameState {
  WAITING_FOR_PLAYERS = 'waitingForPlayers',
  DEALING = 'dealing',
  BETTING_ROUND_1 = 'bettingRound1',
  FLOP = 'flop',
  BETTING_ROUND_2 = 'bettingRound2',
  TURN = 'turn',
  BETTING_ROUND_3 = 'bettingRound3',
  RIVER = 'river',
  BETTING_ROUND_4 = 'bettingRound4',
  SHOWDOWN = 'showdown',
  GAME_OVER = 'gameOver'
}

// State transition function
function transitionState(table: Table, newState: PokerGameState): void {
  const prevState = table.getAttribute('gameState');
  table.setAttribute('gameState', newState);
  
  // Emit state change event
  gameServer.eventBus.emit('poker:state:changed', table, {
    prevState,
    newState,
    timestamp: Date.now()
  });
  
  // Trigger state-specific events
  gameServer.eventBus.emit(`poker:state:${newState}`, table);
}

// State-specific event handlers
gameServer.eventBus.on('poker:state:dealing', (table) => {
  dealCards(table);
});

gameServer.eventBus.on('poker:state:bettingRound1', (table) => {
  startBettingRound(table);
});
```

### Event Bubbling and Delegation

For complex user interfaces or client interactions, implement event bubbling similar to DOM events:

```typescript
// Emit specific and general events
function handlePlayerAction(table: Table, player: Player, action: string, data: any) {
  // Emit specific event
  gameServer.eventBus.emit(`player:${action}`, table, player, data);
  
  // Emit general event (bubbling)
  gameServer.eventBus.emit('player:action', table, player, { action, data });
}

// Handle specific events
gameServer.eventBus.on('player:bet', (table, player, betData) => {
  processBet(table, player, betData.amount);
});

// Handle general events (delegation)
gameServer.eventBus.on('player:action', (table, player, actionData) => {
  logPlayerAction(table, player, actionData);
  updateGameTimers(table);
});
```

### Event Queuing

For actions that need to happen in sequence, implement an event queue:

```typescript
class EventQueue {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;
  
  public async add(fn: () => Promise<void>): Promise<void> {
    this.queue.push(fn);
    if (!this.processing) {
      await this.process();
    }
  }
  
  private async process(): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }
    
    this.processing = true;
    const nextFn = this.queue.shift();
    
    try {
      await nextFn!();
    } catch (error) {
      console.error('Error processing event:', error);
    }
    
    await this.process();
  }
}

// Using the event queue
const tableEventQueue = new Map<string, EventQueue>();

gameServer.eventBus.on('card:deal', async (table, player, cardData) => {
  let queue = tableEventQueue.get(table.id);
  if (!queue) {
    queue = new EventQueue();
    tableEventQueue.set(table.id, queue);
  }
  
  await queue.add(async () => {
    // Deal card animation takes 500ms to complete
    await dealCardToPlayer(table, player, cardData);
    await new Promise(resolve => setTimeout(resolve, 500));
  });
});
```

## Implementing Turn-Based Game Logic

Turn-based games require careful event handling to maintain order:

```typescript
// Manage turns with events
gameServer.eventBus.on('game:turnStart', (table, playerId) => {
  // Set current player
  table.setAttribute('currentPlayer', playerId);
  
  // Start turn timer
  const turnTimeMs = 30000; // 30 seconds
  const turnTimer = setTimeout(() => {
    gameServer.eventBus.emit('game:turnTimeout', table, playerId);
  }, turnTimeMs);
  
  // Store timer ID for cleanup
  table.setAttribute('turnTimerId', turnTimer);
  
  // Notify players
  table.broadcastToAll({
    type: 'turnStarted',
    playerId,
    timeLimit: turnTimeMs
  });
});

gameServer.eventBus.on('game:turnEnd', (table, playerId) => {
  // Clear existing timer
  const timerId = table.getAttribute('turnTimerId');
  if (timerId) {
    clearTimeout(timerId);
    table.setAttribute('turnTimerId', null);
  }
  
  // Find next player
  const nextPlayerId = getNextPlayer(table, playerId);
  
  // Start next turn
  gameServer.eventBus.emit('game:turnStart', table, nextPlayerId);
});

gameServer.eventBus.on('game:turnTimeout', (table, playerId) => {
  // Handle timeout (e.g., auto-play or skip turn)
  handleTimeoutAction(table, playerId);
  
  // End turn and move to next player
  gameServer.eventBus.emit('game:turnEnd', table, playerId);
});
```

## Event-Based Game Recovery

Use events to implement game recovery after crashes or disconnections:

```typescript
// Snapshot game state after significant events
gameServer.eventBus.on('game:stateChanged', (table, stateData) => {
  const gameState = {
    tableId: table.id,
    timestamp: Date.now(),
    state: stateData.newState,
    players: table.getPlayers().map(p => ({ id: p.id, attributes: getPlayerGameAttributes(p) })),
    board: table.getAttribute('board'),
    currentPlayer: table.getAttribute('currentPlayer'),
    // other game-specific state
  };
  
  // Save state (to database, redis, etc.)
  saveGameState(table.id, gameState);
});

// Restore game on player reconnection
gameServer.eventBus.on('playerReconnected', async (player) => {
  const tableId = findPlayerTableId(player.id);
  if (!tableId) return;
  
  // Restore table reference
  const table = gameServer.gameManager.getAllTables().find(t => t.id === tableId);
  if (table) {
    player.setTable(table);
    
    // Restore complete state to player
    const fullState = await loadGameState(tableId);
    player.sendMessage({
      type: 'gameStateSync',
      state: fullState
    });
    
    // Announce reconnection to table
    table.broadcastToPlayers(
      table.getPlayers().filter(p => p.id !== player.id).map(p => p.id),
      {
        type: 'playerReconnected',
        playerId: player.id
      }
    );
  }
});
```

## Asynchronous Game Actions

Manage asynchronous game actions with Promise-based events:

```typescript
// Register an async event handler
async function handlePlayerBet(table: Table, player: Player, betData: any) {
  try {
    // Verify player has sufficient balance
    const balance = await gameServer.transport.server?.getPlayerBalance(player);
    if (!balance || balance < betData.amount) {
      player.sendMessage({
        type: 'error',
        message: 'Insufficient balance for bet'
      });
      return;
    }
    
    // Create the bet
    const betId = await gameServer.transport.server?.createBet(
      player, 
      betData.amount,
      { gameId: table.getAttribute('gameId'), tableId: table.id }
    );
    
    // Update game state
    table.setAttribute('currentBet', betData.amount);
    table.setAttribute('lastBetId', betId);
    
    // Notify other players
    table.broadcastToPlayers(
      table.getPlayers().filter(p => p.id !== player.id).map(p => p.id),
      {
        type: 'playerBet',
        playerId: player.id,
        amount: betData.amount
      }
    );
    
    // End turn
    gameServer.eventBus.emit('game:turnEnd', table, player.id);
  } catch (error) {
    console.error('Bet processing error:', error);
    player.sendMessage({
      type: 'error',
      message: 'Failed to process bet'
    });
  }
}

// Register the handler
gameServer.eventBus.on('player:bet', handlePlayerBet);
```

## Best Practices

1. **Use predefined constants**: Always use the event constants from `EventTypes.ts` for built-in events
2. **Design your event system upfront**: Plan your event names and structures before implementation
3. **Follow the naming convention**: Use the `domain:action` pattern for all your custom events
4. **Document your events**: Create a data dictionary of all events and their payloads
5. **Keep events focused**: Each event should represent a single action or state change
6. **Avoid circular events**: Be careful not to create event loops that trigger each other
7. **Use debug monitoring**: Enable `eventBus.debugMonitor()` during development to track events
8. **Error handling**: Always handle errors in event listeners to avoid breaking the event chain
9. **Clean up listeners**: Remove listeners when components are destroyed
10. **Throttle high-frequency events**: For events that may fire rapidly, implement throttling

## Lifecycle Events

Shoehive emits standard lifecycle events that you can leverage:

```typescript
// Lifecycle events for managing game resources
gameServer.eventBus.on(TABLE_EVENTS.CREATED, (table) => {
  // Initialize game resources for this table
  initializeGameResources(table);
});

gameServer.eventBus.on(TABLE_EVENTS.EMPTY, (table) => {
  // Clean up resources when table is removed
  cleanupGameResources(table);
});

gameServer.eventBus.on(PLAYER_EVENTS.CONNECTED, (player) => {
  // Initialize player-specific resources
  initializePlayerResources(player);
});

gameServer.eventBus.on(PLAYER_EVENTS.DISCONNECTED, (player) => {
  // Clean up player resources
  cleanupPlayerResources(player);
});
``` 