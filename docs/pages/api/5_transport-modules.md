---
layout: default
title: Transport Modules
permalink: /api/transport-modules
parent: API
nav_order: 5
---

# Transport Modules in Shoehive

Transport Modules provide interfaces for external communication in your Shoehive games. This document provides a detailed explanation of Transport Modules and how to implement them.

## Overview

Shoehive Transport Modules are divided into two main components:

1. **Authentication Module** - Handles player authentication during connection
2. **Server Transport Module** - Manages server-side operations like player balances and bets

These modules are intentionally separated from the core game logic to allow for flexible integrations with various backends and services.

## Authentication Module

The `AuthModule` interface provides authentication for WebSocket connections:

```typescript
interface AuthModule {
  authenticatePlayer(request: http.IncomingMessage): Promise<string | null>;
}
```

### How Authentication Works

When a WebSocket connection is established:

1. The connection request is passed to the `authenticatePlayer` method
2. Your implementation can examine headers, cookies, query parameters, etc.
3. Return a player ID if authentication succeeds, or `null` if it fails
4. If `null` is returned, the connection is closed with code 1008 (Policy Violation)

### Implementation Example

Here's an example implementation that authenticates players using a JWT token:

```typescript
import * as http from 'http';
import * as jwt from 'jsonwebtoken';
import { AuthModule } from 'shoehive';

class JwtAuthModule implements AuthModule {
  private jwtSecret: string;
  
  constructor(jwtSecret: string) {
    this.jwtSecret = jwtSecret;
  }
  
  async authenticatePlayer(request: http.IncomingMessage): Promise<string | null> {
    try {
      // Extract token from Authorization header
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
      }
      
      const token = authHeader.substring(7); // Remove 'Bearer ' prefix
      
      // Verify token
      const decoded = jwt.verify(token, this.jwtSecret) as { userId: string };
      
      // Return the user ID from the token
      return decoded.userId;
    } catch (error) {
      console.error('Authentication error:', error);
      return null;
    }
  }
}
```

## Server Transport Module

The `ServerTransportModule` interface handles operations related to player finances:

```typescript
interface ServerTransportModule {
  getPlayerBalance(player: Player): Promise<number>;
  createBet(player: Player, amount: number, metadata?: Record<string, any>): Promise<string>;
  markBetWon(betId: string, winAmount: number, metadata?: Record<string, any>): Promise<boolean>;
  markBetLost(betId: string, metadata?: Record<string, any>): Promise<boolean>;
}
```

### Built-in Implementation

Shoehive provides a basic in-memory implementation called `BasicServerTransportModule` which you can use for testing:

```typescript
import { BasicServerTransportModule } from 'shoehive';

const transport = new BasicServerTransportModule();

// Set initial balances
transport.setPlayerBalance('player1', 1000);
```

### Custom Implementation

For production environments, you'll likely want to implement a custom module that connects to your actual payment or balance system:

```typescript
import { Player, ServerTransportModule } from 'shoehive';
import { DatabaseService } from './your-database-service';

class DatabaseServerTransportModule implements ServerTransportModule {
  private db: DatabaseService;
  
  constructor(db: DatabaseService) {
    this.db = db;
  }
  
  async getPlayerBalance(player: Player): Promise<number> {
    const result = await this.db.query('SELECT balance FROM users WHERE id = ?', [player.id]);
    return result.balance;
  }
  
  async createBet(player: Player, amount: number, metadata?: Record<string, any>): Promise<string> {
    // Check balance
    const balance = await this.getPlayerBalance(player);
    if (balance < amount) {
      throw new Error('Insufficient balance');
    }
    
    // Begin transaction
    const transaction = await this.db.beginTransaction();
    
    try {
      // Deduct from balance
      await transaction.query(
        'UPDATE users SET balance = balance - ? WHERE id = ?',
        [amount, player.id]
      );
      
      // Create bet record
      const betResult = await transaction.query(
        'INSERT INTO bets (player_id, amount, status, metadata) VALUES (?, ?, ?, ?)',
        [player.id, amount, 'pending', JSON.stringify(metadata || {})]
      );
      
      // Commit transaction
      await transaction.commit();
      
      return betResult.insertId.toString();
    } catch (error) {
      // Rollback on error
      await transaction.rollback();
      throw error;
    }
  }
  
  async markBetWon(betId: string, winAmount: number, metadata?: Record<string, any>): Promise<boolean> {
    const transaction = await this.db.beginTransaction();
    
    try {
      // Get bet info
      const betInfo = await transaction.query(
        'SELECT player_id, status FROM bets WHERE id = ?',
        [betId]
      );
      
      if (!betInfo || betInfo.status !== 'pending') {
        throw new Error('Invalid bet or already settled');
      }
      
      // Update bet status
      await transaction.query(
        'UPDATE bets SET status = ?, win_amount = ?, metadata = JSON_MERGE_PATCH(metadata, ?) WHERE id = ?',
        ['won', winAmount, JSON.stringify(metadata || {}), betId]
      );
      
      // Add winnings to player balance
      await transaction.query(
        'UPDATE users SET balance = balance + ? WHERE id = ?',
        [winAmount, betInfo.player_id]
      );
      
      await transaction.commit();
      return true;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  
  async markBetLost(betId: string, metadata?: Record<string, any>): Promise<boolean> {
    // Update bet status to lost
    await this.db.query(
      'UPDATE bets SET status = ?, metadata = JSON_MERGE_PATCH(metadata, ?) WHERE id = ? AND status = ?',
      ['lost', JSON.stringify(metadata || {}), betId, 'pending']
    );
    
    return true;
  }
}
```

## Using Both Modules Together

You can combine both modules when initializing your game server:

```typescript
import * as http from 'http';
import { createGameServer } from 'shoehive';
import { JwtAuthModule } from './JwtAuthModule';
import { DatabaseServerTransportModule } from './DatabaseServerTransportModule';
import { DatabaseService } from './your-database-service';

// Create an HTTP server
const server = http.createServer();

// Initialize your services
const db = new DatabaseService({
  host: 'localhost',
  user: 'gameserver',
  password: 'password',
  database: 'game_db'
});

// Create the transport modules
const authModule = new JwtAuthModule(process.env.JWT_SECRET || 'your-secret-key');
const serverTransport = new DatabaseServerTransportModule(db);

// Create the game server with both modules
const gameServer = createGameServer(server, authModule, serverTransport);

// Start the server
server.listen(3000, () => {
  console.log('Game server running on port 3000');
});
```

## Best Practices

- **Error Handling**: Always include proper error handling in your Transport Module implementations
- **Idempotency**: Make sure your bet operations are idempotent to prevent double-processing
- **Logging**: Log authentication attempts and financial operations for auditing
- **Security**: Store sensitive credentials securely, never hardcode them
- **Testing**: Create mock implementations for testing your game logic without real transactions
- **Performance**: Consider caching player balances to reduce database load

## Next Steps

- Explore the [API Documentation](/api/reference) for detailed method descriptions
- Learn about [Object Attributes](/api/object-attributes) to store additional player data 