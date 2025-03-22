---
layout: default
title: Best Practices and Next Steps
permalink: /guides/building-games/tic-tac-toe/best-practices
parent: Tic Tac Toe
grand_parent: Building Games
nav_order: 10
---

# Best Practices and Next Steps

In this final section, we'll recap the best practices we've followed in our Tic-Tac-Toe implementation and explore potential enhancements and next steps.

## Best Practices Recap

Throughout our Tic-Tac-Toe implementation, we've followed several best practices that make our code more maintainable, readable, and extensible:

### 1. Event Constants

We used typed constants for event names instead of string literals:

```typescript
export const TIC_TAC_TOE_EVENTS = {
  GAME_CREATED: "tictactoe:game:created",
  GAME_STARTED: "tictactoe:game:started",
  // ...
} as const;
```

**Benefits**:
- Prevents typos and inconsistencies
- Provides autocompletion in IDEs
- Makes refactoring easier

### 2. State Management

We defined clear game states with explicit transitions:

```typescript
export enum GameState {
  WAITING_FOR_PLAYERS = 'waitingForPlayers',
  READY_TO_START = 'readyToStart',
  IN_PROGRESS = 'inProgress',
  GAME_OVER = 'gameOver'
}
```

**Benefits**:
- Predictable application flow
- Easier to reason about game state
- Prevents invalid state transitions

### 3. Command Pattern

We implemented player actions as commands with validation:

```typescript
messageRouter.registerCommandHandler('tictactoe:makeMove', (player, data) => {
  // Validate command
  if (typeof data.row !== 'number' || typeof data.col !== 'number') {
    player.sendMessage({
      type: 'error',
      message: 'Invalid move coordinates'
    });
    return;
  }
  
  // Execute command
  // ...
});
```

**Benefits**:
- Centralized validation logic
- Clean separation of command handling
- Easy to add new commands

### 4. Separation of Concerns

We separated game logic from event handling and command processing:

- `game-logic.ts`: Core game mechanics
- `command-handlers.ts`: Player action handling
- `utils.ts`: Helper functions
- `index.ts`: Server setup

**Benefits**:
- Easier to maintain and test
- Components can be modified independently
- Clear responsibilities for each module

### 5. Type Safety

We used TypeScript interfaces for event payloads and game state:

```typescript
export interface MovePayload {
  row: number;
  col: number;
  symbol: 'X' | 'O';
  playerId: string;
}
```

**Benefits**:
- Catches errors at compile time
- Self-documenting code
- Improved developer experience

### 6. Error Handling

We implemented robust validation and error responses:

```typescript
if (!isValidMove(table, row, col)) {
  player.sendMessage({
    type: 'error',
    message: 'Invalid move'
  });
  return;
}
```

**Benefits**:
- Prevents invalid game states
- Provides helpful feedback to players
- Makes debugging easier

### 7. Debug Monitoring

We used event monitoring for development:

```typescript
eventBus.debugMonitor(
  true,
  (eventName) => eventName.startsWith('tictactoe:'),
  (event, ...args) => {
    console.log(`[TicTacToe Event] ${event}`, JSON.stringify(args, null, 2));
  }
);
```

**Benefits**:
- Easier to trace event flow
- Helps identify issues
- Simplifies debugging

### 8. Immutable Data

We handled state carefully to avoid unexpected mutations:

```typescript
// Clone the board before modifying
const board = table.getAttribute('board');
board[row][col] = symbols[currentPlayerIndex];
table.setAttribute('board', board);
```

**Benefits**:
- Prevents side effects
- Makes state changes explicit
- Easier to reason about code

## Enhancing Your Tic-Tac-Toe Game

Here are some ideas to enhance your Tic-Tac-Toe game:

### 1. Adding a Frontend

Create a web-based UI using a framework like React, Vue, or Angular:

- Display the game board visually
- Add animations for moves and wins
- Implement a lobby for finding games
- Show player statistics

### 2. Implementing Game History

Store completed games for replay and analysis:

- Save game moves in a database
- Add a replay feature
- Show statistics about past games
- Implement a "watch live" feature

### 3. Adding Leaderboards

Track player performance:

- Count wins, losses, and draws
- Calculate ELO or other rating systems
- Display top players
- Add achievements and badges

### 4. Supporting Game Variations

Extend the game with different rules:

- Different board sizes (4x4, 5x5)
- Connect Four style gameplay
- 3D Tic-Tac-Toe (4x4x4)
- Ultimate Tic-Tac-Toe (9 boards)

### 5. Implementing AI Opponents

Add computer players with different difficulty levels:

- Random move AI (easy)
- Minimax algorithm (medium)
- Alpha-beta pruning (hard)
- Machine learning-based AI (expert)

## Scaling Your Game

As your game grows, consider these scaling strategies:

### 1. Horizontal Scaling

Run multiple instances of your game server:

- Use a load balancer to distribute traffic
- Implement sticky sessions for consistent player connections
- Consider containerization with Docker and Kubernetes

### 2. Database Integration

Store game data in a database:

- Use MongoDB for flexible schema
- Implement Redis for caching and real-time data
- Consider PostgreSQL for relational data

### 3. Authentication and Accounts

Add user accounts:

- Implement JWT authentication
- Support OAuth providers (Google, Facebook, etc.)
- Add profile management

### 4. Monitoring and Analytics

Track performance and usage:

- Add application monitoring
- Implement error tracking
- Collect usage analytics
- Set up alerting

## Learning from Tic-Tac-Toe

Building a Tic-Tac-Toe game teaches many important concepts:

1. **Event-Driven Architecture**: Understanding how events facilitate communication between components
2. **State Management**: Learning to track and transition between different application states
3. **Real-Time Communication**: Using WebSockets for instant updates
4. **Multiplayer Coordination**: Managing turn-based gameplay between multiple players
5. **Game Design Patterns**: Applying software design patterns to game development

## Conclusion

Congratulations on completing this Tic-Tac-Toe tutorial! You've built a complete, event-driven multiplayer game using the Shoehive framework. The concepts and patterns you've learned can be applied to more complex games and real-time applications.

Remember that game development is an iterative process. Start with a minimal viable product, test it thoroughly, and then expand with new features based on player feedback.

Happy coding, and enjoy building your next game with Shoehive! 