---
layout: default
title: Connecting to Shoehive
permalink: /guides/building-clients/connecting
parent: Building Clients
has_children: true
nav_order: 1
---

# Connecting to a Shoehive Game Server

This guide will walk you through the process of connecting to a Shoehive game server.

## Overview
Once you have implemented the Shoehive game server, you can connect to it using a Websocket connection. Depending on how you configured your `TransportModule.auth<AuthModule>` option, you will need to provide the appropriate credentials to connect to the game server. 

To enable fast development, you don't need to implement an `AuthModule` to get started. Shoehive will automatically enable a mock `AuthModule` that will allow you to connect to the game server without any authentication. Each websocket client will be assigned a unique user ID and name.

## Connecting to the Game Server
After connecting to the game server for the first time, the websocket client will have two (or three) messages sent to it:
1. `player:state` - A JSON object containing the player's ID, name, and any other attributes you defined in the `Player` class.
2. `lobby:state` - A JSON object containing the current state of the lobby, including available games and tables.
3. `table:state` - A JSON object containing the current state of the table, including the players at the table and the game state. (if the player is already at a table)

### Example: Connecting to a Shoehive Game Server

Here's a simple example of connecting to a Shoehive server using JavaScript:

```javascript
// Creating a WebSocket connection to the Shoehive game server
const socket = new WebSocket('ws://localhost:3000');

// Connection opened
socket.addEventListener('open', (event) => {
  console.log('Connected to Shoehive game server');
});

// Listen for messages
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  
  // Handle different message types
  switch (message.type) {
    case 'player:state':
      console.log('Player state received:', message);
      // Store player ID and other attributes
      break;
    
    case 'lobby:state':
      console.log('Lobby state received:', message);
      // Process available games and tables
      break;
      
    case 'table:state':
      console.log('Table state received:', message);
      // Update UI with table information
      break;
      
    default:
      console.log('Received message:', message);
  }
});

// Connection closed
socket.addEventListener('close', (event) => {
  console.log('Disconnected from Shoehive game server', event.code, event.reason);
});

// Connection error
socket.addEventListener('error', (error) => {
  console.error('WebSocket error:', error);
});
```








