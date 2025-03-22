---
layout: default
title: Building Clients
permalink: /guides/building-clients/
parent: Guides
has_children: true
nav_order: 3
---

# 📱 Building Clients with Shoehive

This section provides documentation and guides for developers creating client applications that connect to Shoehive game servers. Whether you're building web, mobile, or desktop clients, these guides will help you understand how to properly implement client-side functionality to communicate with your Shoehive game servers.

## Overview

Shoehive uses WebSockets for real-time communication between clients and the game server. The client-server protocol is message-based, with standardized formats for different types of operations. This architecture allows for:

- Real-time updates and events
- Consistent state management
- Cross-platform compatibility
- Scalable multiplayer experiences

## Documentation Structure

The client-building documentation is organized into the following sections:

1. **[Connecting to a Game Server](/guides/building-clients/connecting)** - How to establish and maintain a WebSocket connection
2. **[Native Commands](/guides/building-clients/native-commands)** - Reference for built-in commands to control lobbies, tables, and players
3. **[Receiving Messages](/guides/building-clients/receiving-messages)** - How to process messages and updates from the server

## Getting Started

Before diving into client implementation, ensure you have:

1. A running Shoehive game server
2. Understanding of WebSocket communication
3. Familiarity with your chosen client platform (Web, Mobile, etc.)

The guides in this section are designed to be platform-agnostic, focusing on the communication protocol and patterns rather than specific client technologies. However, examples will be provided in common web technologies like JavaScript/TypeScript.

## Simple Client Example

Here's a minimal example of a client that connects to a Shoehive server:

```javascript
class ShoehiveClient {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    this.socket = null;
    this.connected = false;
    this.playerState = null;
    this.lobbyState = null;
    this.tableState = null;
    this.eventHandlers = {};
  }

  // Connect to the server
  connect() {
    this.socket = new WebSocket(this.serverUrl);
    
    this.socket.addEventListener('open', () => {
      console.log('Connected to Shoehive server');
      this.connected = true;
      this.triggerEvent('connected');
    });
    
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    });
    
    this.socket.addEventListener('close', () => {
      console.log('Disconnected from Shoehive server');
      this.connected = false;
      this.triggerEvent('disconnected');
    });
    
    this.socket.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      this.triggerEvent('error', error);
    });
  }
  
  // Send a command to the server
  sendCommand(action, data = {}) {
    if (!this.connected) {
      console.error('Cannot send command: Not connected to server');
      return false;
    }
    
    const command = {
      action,
      ...data
    };
    
    this.socket.send(JSON.stringify(command));
    return true;
  }
  
  // Handle incoming messages
  handleMessage(message) {
    console.log('Received message:', message);
    
    switch (message.type) {
      case 'player:state':
        this.playerState = message;
        this.triggerEvent('playerState', message);
        break;
        
      case 'lobby:state':
        this.lobbyState = message;
        this.triggerEvent('lobbyState', message);
        break;
        
      case 'table:state':
        this.tableState = message;
        this.triggerEvent('tableState', message);
        break;
        
      case 'error':
        console.error('Server error:', message.message);
        this.triggerEvent('serverError', message);
        break;
        
      default:
        this.triggerEvent(message.type, message);
    }
  }
  
  // Event handling
  on(event, callback) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(callback);
  }
  
  triggerEvent(event, data) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(callback => callback(data));
    }
  }
  
  // Convenience methods for common commands
  
  // Lobby commands
  getLobbyState() {
    return this.sendCommand('lobby:state:get');
  }
  
  joinTable(tableId) {
    return this.sendCommand('lobby:table:join', { tableId });
  }
  
  createTable(gameId, options = {}) {
    return this.sendCommand('lobby:table:create', { gameId, options });
  }
  
  // Table commands
  getTableState(tableId) {
    return this.sendCommand('table:state:get', { tableId });
  }
  
  leaveTable() {
    return this.sendCommand('table:leave');
  }
  
  sitAtSeat(seatIndex) {
    return this.sendCommand('table:seat:sit', { seatIndex });
  }
  
  standFromSeat(seatIndex) {
    return this.sendCommand('table:seat:stand', { seatIndex });
  }
  
  // Player commands
  getPlayerState() {
    return this.sendCommand('player:state:get');
  }
}

// Usage example:
const client = new ShoehiveClient('ws://localhost:3000');

client.on('connected', () => {
  console.log('Connected to server!');
  client.getLobbyState();
});

client.on('lobbyState', (state) => {
  console.log('Available games:', state.games);
  console.log('Available tables:', state.tables);
  
  // Example of creating a new table through the Lobby
  if (state.games.includes('tic-tac-toe')) {
    client.createTable('tic-tac-toe', { public: true });
  }
});

client.connect();