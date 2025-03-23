---
layout: default
title: "⚛️ React Client"
permalink: /guides/building-clients/react-client
parent: Building Clients
nav_order: 6
---

# Shoehive React Client
A React library for real-time communication with Shoehive game servers. It provides a simple, flexible WebSocket-based client with React integration for building multiplayer web games.

#### [**🐙 GitHub**](https://github.com/jtay/shoehive-client-react)

## 📦 Installation

```bash
npm install shoehive-react-client
```

or

```bash
yarn add shoehive-react-client
```

# 🚀 Basic Usage

```javascript
import React from 'react';
import { ShoehiveProvider, useShoehive } from 'shoehive-client';

// Wrap your app with the provider
function App() {
  return (
    <ShoehiveProvider serverUrl="wss://your-shoehive-server.com">
      <YourGame />
    </ShoehiveProvider>
  );
}

// Use the hook in your components
function YourGame() {
  const { 
    isConnected, 
    playerState, 
    lobbyState, 
    tableState,
    joinTable, 
    createTable,
    sitAtSeat 
  } = useShoehive();

  if (!isConnected) {
    return <div>Connecting to game server...</div>;
  }

  return (
    <div>
      <h1>Welcome to Shoehive Game</h1>
      {/* Your game UI */}
    </div>
  );
}
```

## 🧰 Core Components

### 🔌 ShoehiveProvider

The `ShoehiveProvider` component establishes and manages the WebSocket connection to your Shoehive server. It maintains the connection state and provides access to the client through React Context.

```javascript
<ShoehiveProvider 
  serverUrl="wss://your-shoehive-server.com" 
  autoConnect={true}
  authStrategy={() => ({ 
    url: "wss://your-shoehive-server.com?token=abc123" 
  })}
  maxReconnectAttempts={5}
  reconnectDelay={1000}
>
  {children}
</ShoehiveProvider>
```

#### 🔑 Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| serverUrl | string | *required* | WebSocket server URL |
| autoConnect | boolean | true | Automatically connect when component mounts |
| authStrategy | function | null | Function that returns authentication details |
| maxReconnectAttempts | number | 5 | Maximum reconnection attempts on disconnect |
| reconnectDelay | number | 1000 | Base delay between reconnect attempts (in ms) |

### 🪝 useShoehive Hook

The `useShoehive` hook provides access to the Shoehive client and state within React components.

```javascript
const {
  // Connection and state
  client,            // Direct access to the ShoehiveClient instance
  isConnected,       // Boolean connection status
  playerState,       // Player state from server
  lobbyState,        // Lobby state from server
  tableState,        // Current table state
  
  // Connection methods
  connect,           // Connect to the server
  disconnect,        // Disconnect from the server
  
  // Command methods
  sendCommand,       // Send a custom command
  on,                // Register event listener
  
  // Player methods
  getPlayerState,    // Request player state update
  
  // Lobby methods
  getLobbyState,     // Request lobby state update
  createTable,       // Create a new table
  joinTable,         // Join an existing table
  
  // Table methods
  getTableState,     // Request table state update
  leaveTable,        // Leave the current table
  sitAtSeat,         // Sit at a specific seat
  standFromSeat,     // Stand up from your seat
  
  // Game methods
  sendGameCommand,   // Send game-specific commands
} = useShoehive();
```

## 📄 ShoehiveClient Class

For advanced usage, you can use the `ShoehiveClient` class directly without the React integration. This is useful for non-React applications or for custom integration.

```javascript
import { ShoehiveClient } from 'shoehive-client';

// Create client instance
const client = new ShoehiveClient('wss://your-shoehive-server.com', {
  autoReconnect: true,
  maxReconnectAttempts: 5,
  reconnectDelay: 1000,
  authStrategy: () => ({
    url: 'wss://your-shoehive-server.com?token=abc123'
  })
});

// Connect to server
client.connect();

// Register event handlers
client.on('connected', () => console.log('Connected!'));
client.on('playerState', (state) => console.log('Player state:', state));

// Send commands
client.joinTable('table-123');
client.sitAtSeat(2);
client.sendGameCommand('play-card', { cardId: 'ace-spades' });

// Disconnect when done
client.disconnect();
```

## 📄 Constants

ShoehiveJS provides several constants for use with the client:

```javascript
import { 
  CLIENT_COMMAND_TYPES, 
  CLIENT_MESSAGE_TYPES,
  CLIENT_ERROR_TYPES,
  CONNECTION_STATES 
} from 'shoehive-client';

// Example: Send a command using constant
client.sendCommand(CLIENT_COMMAND_TYPES.TABLE_LEAVE);

// Example: Check message type
if (message.type === CLIENT_MESSAGE_TYPES.LOBBY_STATE) {
  // Handle lobby state update
}
```

## 📡 Events

You can listen for various events from the Shoehive server:

```javascript
// Using the hook
const { on } = useShoehive();

useEffect(() => {
  // Register event listener
  const removeListener = on('playerJoined', (data) => {
    console.log('A player joined:', data);
  });
  
  // Clean up listener on unmount
  return removeListener;
}, [on]);

// Or using the client directly
client.on('tableState', (state) => {
  console.log('Table state updated:', state);
});
```

## 🔑 Authentication

ShoehiveJS supports various authentication strategies:

```javascript
// Token in URL parameter
const authStrategy = () => ({
  url: `wss://your-shoehive-server.com?token=${yourAuthToken}`
});

// WebSocket protocols
const authStrategy = () => ({
  protocols: ['token', yourAuthToken]
});

// Headers
const authStrategy = () => ({
  headers: {
    'Authorization': `Bearer ${yourAuthToken}`
  }
});
```

## 📄 License

This project is licensed under the [The Unlicense](https://unlicense.org/). See the [LICENSE](LICENSE) file for details.