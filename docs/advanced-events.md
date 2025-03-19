# Advanced Event Patterns in Shoehive

This guide explores advanced event patterns and techniques for building complex multiplayer games with Shoehive.

## Event-Driven Architecture

Shoehive's event system is built on an event-driven architecture that helps you decouple various components of your game. This approach offers several advantages:

- **Modularity**: Components can communicate without direct dependencies
- **Flexibility**: Easy to add or modify features with minimal changes to existing code
- **Testability**: Event handlers can be tested in isolation
- **Scalability**: Events can be distributed across multiple services in larger implementations

## Beyond Basic Events

### Custom Game Events

While Shoehive provides standard events like `playerJoinedTable` and `tableStateChanged`, complex games often require custom events:

```typescript
// Creating custom events
gameServer.eventBus.emit('roundStarted', table, {
  roundNumber: currentRound,
  startTime: Date.now(),
  turnOrder: playerIds
});

// Handling custom events
gameServer.eventBus.on('roundStarted', (table, roundData) => {
  // Start countdown timer for first player's turn
  startTurnTimer(table, roundData.turnOrder[0], 30);
});
```

### Event Namespacing

For complex games, consider using namespaced events to avoid collisions and improve organization:

```typescript
// Emit namespaced events
gameServer.eventBus.emit('poker:hand:dealt', table, handData);
gameServer.eventBus.emit('poker:betting:started', table, betData);

// Listen for namespaced events
gameServer.eventBus.on('poker:hand:dealt', handleDealtHand);
gameServer.eventBus.on('poker:betting:started', handleBettingStart);
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
  gameServer.eventBus.emit('poker:stateChanged', table, {
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

## Debugging Events

Implement an event listener for debugging:

```typescript
if (process.env.NODE_ENV === 'development') {
  gameServer.eventBus.on('*', (eventName, ...args) => {
    console.log(`[EVENT] ${eventName}`, JSON.stringify(args, (key, value) => {
      // Avoid circular references
      if (key === 'table' && value && typeof value === 'object') {
        return { id: value.id, playerCount: value.getPlayerCount() };
      }
      if (key === 'player' && value && typeof value === 'object') {
        return { id: value.id };
      }
      return value;
    }, 2));
  });
}
```

## Best Practices

1. **Design your event system upfront**: Plan your event names and structures before implementation
2. **Document your events**: Create a data dictionary of all events and their payloads
3. **Keep events focused**: Each event should represent a single action or state change
4. **Avoid circular events**: Be careful not to create event loops that trigger each other
5. **Use meaningful event names**: Choose descriptive names with proper namespacing
6. **Error handling**: Always handle errors in event listeners to avoid breaking the event chain
7. **Clean up listeners**: Remove listeners when components are destroyed
8. **Throttle high-frequency events**: For events that may fire rapidly, implement throttling
9. **Separate UI events from game logic**: Keep a clear distinction between game state and UI events
10. **Log important events**: Implement logging for critical events for debugging and auditing

## Further Reading

- [Event-Driven Architecture Patterns](https://martinfowler.com/articles/201701-event-driven.html)
- [State Machine Design Pattern](https://refactoring.guru/design-patterns/state)
- [Command Pattern in Game Development](https://gameprogrammingpatterns.com/command.html) 