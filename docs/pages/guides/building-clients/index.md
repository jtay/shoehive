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

## 📚 Documentation Structure

The client-building documentation is organized into the following sections:

1. **[Connecting to a Game Server](/guides/building-clients/connecting)** - How to establish and maintain a WebSocket connection
2. **[Native Commands](/guides/building-clients/native-commands)** - Reference for built-in commands to control lobbies, tables, and players
3. **[Receiving Messages](/guides/building-clients/receiving-messages)** - How to process messages and updates from the server
4. **[React Client](/guides/building-clients/react-client)** - A React library that provides an extensible base client hook for real-time communication with Shoehive game servers.

## 🚀 Getting Started

Before diving into client implementation, ensure you have:

1. A running Shoehive game server
2. Understanding of WebSocket communication
3. Familiarity with your chosen client platform (Web, Mobile, etc.)

## ⚛ React Client
Shoehive provides a [React client library](/guides/building-clients/react-client) that simplifies the process of building a client application. It is built on top of the WebSocket protocol and provides a simple, flexible WebSocket-based client with React integration for building multiplayer web games. and supports the following features:

- Connection management
- Lobby state management
- Table state management
- Player state management
- Command sending
- Event handling