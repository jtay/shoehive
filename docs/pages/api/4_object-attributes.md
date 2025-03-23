---
layout: default
title: Object Attributes
permalink: /api/object-attributes
parent: Components
nav_order: 4
---

# Attributes System in Shoehive

Shoehive provides a flexible attribute system that allows you to store and retrieve custom data on various game components. This guide explains how to effectively use attributes across the framework.

## Overview

Attributes are key-value pairs that can be attached to various game components such as Players, Tables, and Hands. They provide a flexible way to associate custom data with these objects without extending their base classes.

The following components support attributes:

- `Player`: Store player-specific data
- `Table`: Store game state as well as table metadata
- `Hand`: Store hand-specific data

## Common Attribute Methods

All supported components implement the following methods:

```typescript
// Setting an attribute
component.setAttribute(key: string, value: any): void;

// Getting an attribute
component.getAttribute(key: string): any;

// Checking if an attribute exists
component.hasAttribute(key: string): boolean;

// Removing an attribute
component.removeAttribute(key: string): void;

// Setting multiple attributes at once
component.setAttributes(attributes: Record<string, any>): void;

// Getting all attributes as a Record object
component.getAttributes(): Record<string, any>;
```

## Configurable Player Attribute Relevance

When a player's attributes change, the game server needs to decide whether to broadcast these changes to other components. The Shoehive framework allows game developers to configure which player attributes are relevant for table state updates and which are relevant for lobby updates.

### Configuring Relevant Attributes

When registering a game definition, you can specify which player attributes should trigger updates:

```typescript
gameManager.registerGame({
  id: 'your-game',
  name: 'Your Game',
  // ... other game properties ...
  
  // Define which player attributes should trigger a table state update when changed
  tableRelevantPlayerAttributes: ['name', 'chips', 'isReady', 'score'],
  
  // Define which player attributes should trigger a lobby update when changed
  lobbyRelevantPlayerAttributes: ['name', 'status', 'isOnline']
});
```

### How It Works

1. **Table Relevance**: When a player's attribute changes and that player is seated at a table, the system checks if the attribute is in the `tableRelevantPlayerAttributes` list. If it is, the table state is broadcast to all players at the table.

2. **Lobby Relevance**: When a player's attribute changes and that attribute is in the `lobbyRelevantPlayerAttributes` list, the Lobby class updates the lobby state and broadcasts it to all connected players.

### Default Values

If you don't specify these attributes, the system uses sensible defaults:

- **Default Table-Relevant Attributes**: `["name", "avatar", "chips", "status", "isReady", "role", "team"]`
- **Default Lobby-Relevant Attributes**: `["name", "avatar", "isReady", "status"]`

### Performance Benefits

This configuration allows you to optimize the server's performance by reducing unnecessary broadcasts. For example, if a player's internal game state changes but doesn't need to be displayed to other players, you can exclude those attributes from the relevant lists.

### Practical Example

Consider a card game where players have the following attributes:

- `name`: Player's display name
- `avatar`: Player's profile image
- `cards`: Player's cards in their hand (private)
- `points`: Player's score (visible to all)
- `strategy`: Player's internal strategy tracking (private)
- `isReady`: Player's ready status

#### Optimized Configuration:

```typescript
gameManager.registerGame({
  id: 'card-game',
  name: 'Strategic Card Game',
  // ... other properties ...
  
  // Only broadcast attributes that affect the visual state of the table
  tableRelevantPlayerAttributes: ['name', 'avatar', 'points', 'isReady'],
  
  // Only show essential player info in the lobby
  lobbyRelevantPlayerAttributes: ['name', 'isReady']
});

// Later in your game logic:

// This will trigger a table state update because 'points' is table-relevant
player.setAttribute('points', 100);

// This will NOT trigger a table state update because 'strategy' is not table-relevant
player.setAttribute('strategy', 'defensive');

// This will NOT trigger a table state update because 'secretNumber' is not table-relevant
player.setAttribute('secretNumber', 42);

// This will trigger both table and lobby updates because 'isReady' is in both lists
player.setAttribute('isReady', true);
```

This configuration ensures that:
1. Private information like cards and strategy never leak to other players
2. Network traffic is minimized by only broadcasting necessary changes
3. The server avoids unnecessary state calculations and broadcasts

## Basic Usage

### Setting and Getting Attributes

```typescript
// Players
player.setAttribute('score', 100);
const score = player.getAttribute('score'); // 100

// Tables
table.setAttribute('gameMode', 'tournament');
const mode = table.getAttribute('gameMode'); // 'tournament'

// Hands
const hand = table.getHandAtSeat(0);
hand?.setAttribute('bet', 50);
const bet = hand?.getAttribute('bet'); // 50
```

## Common Use Cases

### Player Attributes

Player attributes are useful for storing user profiles, game progress, and session data:

```typescript
// Player profile
player.setAttribute('profile', {
  username: 'GamerX',
  avatar: 'https://example.com/avatars/gamerx.png',
  level: 42,
  created: Date.now()
});

// Session tracking
player.setAttribute('session', {
  connectedAt: Date.now(),
  lastActive: Date.now(),
  deviceInfo: request.headers['user-agent']
});

// Game progress
player.setAttribute('progress', {
  level: 5,
  score: 3200,
  unlockedItems: ['sword', 'shield', 'potion']
});
```

### Table Attributes

Table attributes are excellent for managing game state and configuration:

```typescript
// Game configuration
table.setAttribute('gameConfig', {
  rounds: 10,
  timeLimit: 60,
  difficulty: 'hard'
});

// Round state
table.setAttribute('roundState', {
  currentRound: 3,
  timeRemaining: 45,
  activePlayerIndex: 2
});

// Table metadata
table.setAttribute('metadata', {
  name: 'High Rollers Table',
  creator: 'admin',
  createdAt: Date.now(),
  isPrivate: true
});
```

### Hand Attributes

Hand attributes are useful for card game specific data:

```typescript
const hand = table.getHandAtSeat(0);
if (hand) {
  // Track bet information
  hand.setAttribute('bet', 100);
  hand.setAttribute('sideBets', { insurance: 50 });
  
  // Track hand status
  hand.setAttribute('status', 'standing');
  
  // Track hand evaluation
  hand.setAttribute('evaluation', {
    score: 21,
    isBlackjack: true
  });
}
```

## Advanced Patterns

### Type Safety with TypeScript

For type safety, define interfaces for your attributes:

```typescript
// Define interfaces for your attributes
interface PlayerProfile {
  username: string;
  avatar: string;
  level: number;
  created: number;
}

interface TableConfig {
  rounds: number;
  timeLimit: number;
  difficulty: string;
}

// Create type-safe getter and setter functions
function getProfile(player: Player): PlayerProfile | null {
  return player.getAttribute('profile') as PlayerProfile;
}

function setProfile(player: Player, profile: PlayerProfile): void {
  player.setAttribute('profile', profile);
}

function getTableConfig(table: Table): TableConfig | null {
  return table.getAttribute('gameConfig') as TableConfig;
}

function setTableConfig(table: Table, config: TableConfig): void {
  table.setAttribute('gameConfig', config);
}

// Usage
const profile = getProfile(player);
if (profile) {
  console.log(`${profile.username} is level ${profile.level}`);
}

setTableConfig(table, { rounds: 5, timeLimit: 30, difficulty: 'easy' });
```

### Namespaced Attributes

For complex games, use namespacing to organize attributes:

```typescript
// Set namespaced attributes
player.setAttribute('poker:hand', ['♠A', '♥K', '♦Q', '♣J', '♠10']);
player.setAttribute('poker:chips', 1000);
player.setAttribute('poker:position', 3);

table.setAttribute('poker:pot', 500);
table.setAttribute('poker:dealer', 2);
table.setAttribute('poker:round', 'flop');

// Helper function to work with namespaced attributes
function getNamespacedAttribute(component: Player | Table | Hand, namespace: string, key: string): any {
  return component.getAttribute(`${namespace}:${key}`);
}

function setNamespacedAttribute(component: Player | Table | Hand, namespace: string, key: string, value: any): void {
  component.setAttribute(`${namespace}:${key}`, value);
}

// Usage
const chips = getNamespacedAttribute(player, 'poker', 'chips');
setNamespacedAttribute(table, 'poker', 'pot', 750);
```

### Ephemeral vs. Persistent Attributes

Differentiate between ephemeral (session-only) and persistent attributes:

```typescript
// Ephemeral (in-memory only) attributes
player.setAttribute('currentGame', tableId);
player.setAttribute('isReady', true);
player.setAttribute('latency', 45); // ms

// Persistent attributes (should be saved to database)
player.setAttribute('persistent:profile', {
  username: 'GamerX',
  avatar: 'avatar1.png',
  level: 42
});
player.setAttribute('persistent:stats', {
  gamesPlayed: 157,
  gamesWon: 83,
  totalScore: 12450
});

// Helper function to save persistent attributes to database
async function savePersistentAttributes(player: Player) {
  const persistentAttrs = {};
  
  // Find all attributes with 'persistent:' prefix
  for (const key of Object.keys(player.getAttributes())) {
    if (key.startsWith('persistent:')) {
      const actualKey = key.substring('persistent:'.length);
      persistentAttrs[actualKey] = player.getAttribute(key);
    }
  }
  
  // Save to database
  await database.savePlayerAttributes(player.id, persistentAttrs);
}
```

## Integration with Shoehive Events

### Using Attributes with Events

Attributes can be combined with Shoehive's event system for powerful functionality:

```typescript
// Listen for player connection and load attributes
gameServer.eventBus.on('player:connected', async (player) => {
  // Load player data from database
  const userData = await database.getPlayerData(player.id);
  
  if (userData) {
    // Set player attributes
    player.setAttribute('profile', userData.profile);
    player.setAttribute('stats', userData.stats);
    player.setAttribute('preferences', userData.preferences);
  }
  
  // Track connection info
  player.setAttribute('session', {
    connectedAt: Date.now(),
    ipAddress: getUserIp(player),
    lastActive: Date.now()
  });
});

// Update last active timestamp
gameServer.eventBus.on('player:action', (player) => {
  const session = player.getAttribute('session') || {};
  player.setAttribute('session', {
    ...session,
    lastActive: Date.now()
  });
});

// Store attributes on disconnect
gameServer.eventBus.on('player:disconnected', (player) => {
  const session = player.getAttribute('session');
  if (session) {
    // Calculate session duration
    const sessionDuration = Date.now() - session.connectedAt;
    
    // Store in database for analytics
    database.recordPlayerSession(player.id, {
      duration: sessionDuration,
      connectedAt: session.connectedAt,
      disconnectedAt: Date.now()
    });
  }
  
  // Save persistent attributes
  savePersistentAttributes(player);
});
```

## Best Practices

1. **Be consistent**: Use a consistent naming convention for attributes
2. **Keep it clean**: Don't store unnecessary data in attributes
3. **Type safety**: Use TypeScript interfaces to define attribute structure
4. **Namespaces**: Use namespaced keys for complex games
5. **Validation**: Validate attribute values before setting them
6. **Keep serializable**: Ensure attributes can be serialized to JSON
7. **Avoid circular references**: Don't create circular references in attributes
8. **Documentation**: Document your attribute schema for team members
9. **Privacy**: Don't store sensitive information in attributes
10. **Performance**: Be mindful of attribute size for frequently accessed data

## Example: Complete Attribute Schema for a Card Game

Here's an example of a complete attribute schema for a poker game:

```typescript
// Player Attributes
interface PokerPlayerAttributes {
  // Profile information
  'profile': {
    username: string;
    avatar: string;
    displayName: string;
    created: number; // timestamp
    lastLogin: number; // timestamp
  };
  
  // Game statistics
  'stats': {
    handsPlayed: number;
    handsWon: number;
    biggestPot: number;
    totalWinnings: number;
  };
  
  // Current game state
  'poker:state': {
    chips: number;
    currentBet: number;
    hasFolded: boolean;
    position: number; // seat position
    isDealer: boolean;
    lastAction?: 'fold' | 'check' | 'call' | 'raise' | 'all-in';
  };
  
  // Settings
  'settings': {
    autoFold: boolean;
    autoBuyIn: boolean;
    notifications: boolean;
    theme: 'light' | 'dark' | 'classic';
  };
  
  // Session information
  'session': {
    connectionTime: number;
    lastActive: number;
    deviceInfo: string;
    ipAddress: string;
  };
}

// Table Attributes
interface PokerTableAttributes {
  // Game configuration
  'config': {
    blinds: [number, number]; // [small, big]
    buyIn: [number, number]; // [min, max]
    timeBank: number; // seconds
    isPrivate: boolean;
  };
  
  // Current game state
  'poker:state': {
    pot: number;
    sidePots: Array<{amount: number, eligiblePlayers: string[]}>;
    dealer: number; // seat index
    currentPlayer: number; // seat index
    round: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
    communityCards: string[];
    lastRaise: number;
  };
  
  // Table metadata
  'metadata': {
    name: string;
    creator: string;
    createdAt: number;
    gameCount: number;
  };
}

// Hand Attributes
interface PokerHandAttributes {
  // Bet information
  'bet': number;
  
  // Hand evaluation
  'evaluation': {
    handType: 'high-card' | 'pair' | 'two-pair' | 'three-of-a-kind' | 'straight' | 'flush' | 'full-house' | 'four-of-a-kind' | 'straight-flush' | 'royal-flush';
    score: number;
    description: string;
  };
}
```