# Custom Player Attributes in Shoehive

Shoehive's Player class provides a flexible attribute system that allows you to store and retrieve custom data for each player. This guide explains how to effectively use player attributes in your games.

## Basic Usage

### Setting and Getting Attributes

The Player class provides methods to work with attributes:

```typescript
// Setting an attribute
player.setAttribute('score', 100);
player.setAttribute('inventory', { gold: 50, items: ['potion', 'sword'] });

// Getting an attribute
const score = player.getAttribute('score'); // 100
const inventory = player.getAttribute('inventory'); // { gold: 50, items: ['potion', 'sword'] }

// Checking if an attribute exists
if (player.hasAttribute('experience')) {
  // Do something with the experience attribute
}
```

## Common Use Cases

### Player Profiles

Store player profile information:

```typescript
// Set player profile data
player.setAttribute('profile', {
  username: 'GamerX',
  avatar: 'https://example.com/avatars/gamerx.png',
  level: 42,
  created: Date.now()
});

// Update specific profile fields
function updatePlayerLevel(player: Player, newLevel: number) {
  const profile = player.getAttribute('profile') || {};
  player.setAttribute('profile', {
    ...profile,
    level: newLevel
  });
}
```

### Game-Specific Data

Store game-specific data for each player:

```typescript
// For a card game
player.setAttribute('hand', ['♠A', '♥K', '♦Q', '♣J', '♠10']);
player.setAttribute('chips', 1000);

// For an RPG game
player.setAttribute('character', {
  class: 'warrior',
  health: 100,
  mana: 50,
  abilities: ['strike', 'block', 'charge']
});
```

### Session Management

Track session information:

```typescript
// Track connection information
player.setAttribute('connectionInfo', {
  ip: request.socket.remoteAddress,
  userAgent: request.headers['user-agent'],
  connectedAt: Date.now(),
  lastActive: Date.now()
});

// Update last active timestamp
function updateLastActive(player: Player) {
  const connectionInfo = player.getAttribute('connectionInfo') || {};
  player.setAttribute('connectionInfo', {
    ...connectionInfo,
    lastActive: Date.now()
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

interface CardGameAttributes {
  hand: string[];
  chips: number;
  bet?: number;
  folded?: boolean;
}

// Create type-safe getter and setter functions
function getProfile(player: Player): PlayerProfile | null {
  return player.getAttribute('profile') as PlayerProfile;
}

function setProfile(player: Player, profile: PlayerProfile): void {
  player.setAttribute('profile', profile);
}

function getCardAttributes(player: Player): CardGameAttributes | null {
  return player.getAttribute('cardGame') as CardGameAttributes;
}

function setCardAttributes(player: Player, attrs: Partial<CardGameAttributes>): void {
  const current = player.getAttribute('cardGame') || { hand: [], chips: 0 };
  player.setAttribute('cardGame', { ...current, ...attrs });
}

// Usage
const profile = getProfile(player);
if (profile) {
  console.log(`${profile.username} is level ${profile.level}`);
}

setCardAttributes(player, { bet: 50, folded: false });
```

### Serializable Attributes

Ensure your attributes are serializable (can be converted to JSON):

```typescript
// Good - all of these are serializable
player.setAttribute('lastActive', Date.now()); // Use timestamps instead of Date objects
player.setAttribute('position', { x: 10, y: 20 }); // Simple objects work well
player.setAttribute('inventory', ['sword', 'shield', 'potion']); // Arrays are fine

// Bad - these will cause issues with serialization
player.setAttribute('timer', setTimeout(() => {}, 1000)); // Functions and timers aren't serializable
player.setAttribute('dateObject', new Date()); // Date objects should be converted to timestamps
player.setAttribute('circularRef', { self: player }); // Circular references will cause errors
```

### Namespaced Attributes

For complex games, use namespacing to organize attributes:

```typescript
// Set namespaced attributes
player.setAttribute('game:poker:hand', ['♠A', '♥K', '♦Q', '♣J', '♠10']);
player.setAttribute('game:poker:chips', 1000);
player.setAttribute('game:poker:position', 3);

player.setAttribute('profile:username', 'GamerX');
player.setAttribute('profile:settings:theme', 'dark');
player.setAttribute('profile:settings:notifications', true);

// Helper function to work with namespaced attributes
function getNamespacedAttribute(player: Player, namespace: string, key: string): any {
  return player.getAttribute(`${namespace}:${key}`);
}

function setNamespacedAttribute(player: Player, namespace: string, key: string, value: any): void {
  player.setAttribute(`${namespace}:${key}`, value);
}

// Usage
const chips = getNamespacedAttribute(player, 'game:poker', 'chips');
setNamespacedAttribute(player, 'profile:settings', 'theme', 'light');
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
  for (const key of player.getAllAttributeKeys()) {
    if (key.startsWith('persistent:')) {
      const actualKey = key.substring('persistent:'.length);
      persistentAttrs[actualKey] = player.getAttribute(key);
    }
  }
  
  // Save to database
  await database.savePlayerAttributes(player.id, persistentAttrs);
}
```

## Integration with Transport Modules

### Loading Attributes from Auth Module

Load player attributes during authentication:

```typescript
class DatabaseAuthModule implements AuthModule {
  private db: DatabaseService;
  
  constructor(db: DatabaseService) {
    this.db = db;
  }
  
  async authenticatePlayer(request: http.IncomingMessage): Promise<string | null> {
    try {
      // Extract token from Authorization header
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
      }
      
      const token = authHeader.substring(7);
      
      // Verify token
      const decoded = jwt.verify(token, this.jwtSecret) as { userId: string };
      
      // Return the user ID
      return decoded.userId;
    } catch (error) {
      console.error('Authentication error:', error);
      return null;
    }
  }
  
  // Load player attributes after authentication
  async loadPlayerAttributes(player: Player): Promise<void> {
    try {
      // Load player data from database
      const userData = await this.db.query(
        'SELECT username, avatar, level, settings FROM users WHERE id = ?',
        [player.id]
      );
      
      if (userData) {
        // Set player attributes
        player.setAttribute('profile', {
          username: userData.username,
          avatar: userData.avatar,
          level: userData.level
        });
        
        player.setAttribute('settings', JSON.parse(userData.settings || '{}'));
        
        // Load player stats
        const stats = await this.db.query(
          'SELECT games_played, games_won, total_score FROM user_stats WHERE user_id = ?',
          [player.id]
        );
        
        if (stats) {
          player.setAttribute('stats', {
            gamesPlayed: stats.games_played,
            gamesWon: stats.games_won,
            totalScore: stats.total_score
          });
        }
      }
    } catch (error) {
      console.error('Error loading player attributes:', error);
    }
  }
}

// When creating the game server
gameServer.eventBus.on('playerConnected', async (player) => {
  if (gameServer.transport.auth instanceof DatabaseAuthModule) {
    await gameServer.transport.auth.loadPlayerAttributes(player);
  }
});
```

### Using Attributes with Server Transport

Use player attributes with the server transport module:

```typescript
class MyServerTransportModule implements ServerTransportModule {
  // ... other methods ...
  
  async createBet(player: Player, amount: number, metadata?: Record<string, any>): Promise<string> {
    // Use player attributes to enhance bet data
    const profile = player.getAttribute('profile') || {};
    const stats = player.getAttribute('stats') || {};
    
    // Add additional metadata
    const enhancedMetadata = {
      ...metadata,
      playerLevel: profile.level,
      playerGamesPlayed: stats.gamesPlayed,
      playerUsername: profile.username
    };
    
    // Create bet with enhanced metadata
    const betId = await this.createBetInDatabase(player.id, amount, enhancedMetadata);
    
    // Update player attribute to track active bets
    const activeBets = player.getAttribute('activeBets') || [];
    player.setAttribute('activeBets', [...activeBets, betId]);
    
    return betId;
  }
}
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

## Example: Complete Player Attribute Schema

Here's an example of a complete attribute schema for a poker game:

```typescript
interface PokerPlayer {
  // Profile information
  profile: {
    username: string;
    avatar: string;
    displayName: string;
    created: number; // timestamp
    lastLogin: number; // timestamp
  };
  
  // Game statistics
  stats: {
    handsPlayed: number;
    handsWon: number;
    biggestPot: number;
    totalWinnings: number;
  };
  
  // Current game state
  poker: {
    hand: string[];
    chips: number;
    currentBet: number;
    hasFolded: boolean;
    position: number; // seat position
    isDealer: boolean;
    lastAction?: 'fold' | 'check' | 'call' | 'raise' | 'all-in';
  };
  
  // Settings
  settings: {
    autoFold: boolean;
    autoBuyIn: boolean;
    notifications: boolean;
    theme: 'light' | 'dark' | 'classic';
  };
  
  // Session information
  session: {
    connectionTime: number;
    lastActive: number;
    deviceInfo: string;
    ipAddress: string;
  };
}

// Helper functions for working with this schema
function getPokerPlayerAttr<K extends keyof PokerPlayer>(
  player: Player, 
  category: K
): PokerPlayer[K] | null {
  return player.getAttribute(category) as PokerPlayer[K];
}

function setPokerPlayerAttr<K extends keyof PokerPlayer>(
  player: Player, 
  category: K, 
  value: PokerPlayer[K]
): void {
  player.setAttribute(category, value);
}

function updatePokerPlayerAttr<K extends keyof PokerPlayer>(
  player: Player, 
  category: K, 
  updates: Partial<PokerPlayer[K]>
): void {
  const current = getPokerPlayerAttr(player, category) || {};
  setPokerPlayerAttr(player, category, { ...current, ...updates });
}

// Usage example
updatePokerPlayerAttr(player, 'poker', { 
  chips: 1500, 
  lastAction: 'raise' 
});

const pokerState = getPokerPlayerAttr(player, 'poker');
if (pokerState && !pokerState.hasFolded) {
  // Player is still in the game
}
```

## Related Topics

- [Transport Modules](./transport-modules.md)
- [Creating Custom Games](./creating-games.md)
- [API Reference](./api-reference.md) 