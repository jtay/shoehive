# 🐝 Shoehive - Open Source Multiplayer Game Framework

Shoehive is an **extensible, WebSocket-based multiplayer game framework** designed with the goal of providing a simple and easy to understand framework for building multiplayer card games. It boasts a modular design that allows you to extend the game server with a number of different game types.

Shoehive is built with TypeScript and is designed to be used with Node.js. **It is currently in active development and is not yet ready for production use.**

[![Tests](https://github.com/jtay/shoehive/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/jtay/shoehive/actions/workflows/test.yml) [![NPM Publish](https://github.com/jtay/shoehive/actions/workflows/publish.yml/badge.svg)](https://github.com/jtay/shoehive/actions/workflows/publish.yml) [![Docs](https://github.com/jtay/shoehive/actions/workflows/docs-deploy.yml/badge.svg?branch=main)](https://github.com/jtay/shoehive/actions/workflows/docs-deploy.yml)
#### [**🐙 GitHub**](https://github.com/jtay/shoehive) &nbsp; | &nbsp; [**📦 Releases**](https://github.com/jtay/shoehive/releases) &nbsp; | &nbsp; [**⚡️ Quick Start Guide**](https://shoehive.jtay.co.uk/quick-start) &nbsp; | &nbsp; [**📖 Docs**](https://shoehive.jtay.co.uk) &nbsp; | &nbsp; [**🔍 API Reference**](https://shoehive.jtay.co.uk/api/generated) &nbsp; | &nbsp; [**🤝 Contributing**](https://github.com/jtay/shoehive/tree/main/CONTRIBUTING.md)

## 🚀 Features

✅ **Powered by WebSockets** – Real-time, low-latency communication.  
✅ **Modular Backend Connectivity** – Implement your own authentication system and register any kind of backend transport protocol.    
✅ **Extensible Game Modules** – Build games like blackjack, baccarat and poker while focusing on just the game logic.  
✅ **Multi-Game Server** – When creating a new game, the player can choose from the registered game modules.    
✅ **Designed for Card Games** – Natively supports card games with a flexible card deck system.  
✅ **Built-In Command System** – Register namespaced commands to send data between the client and server.   
✅ **Event-Driven Architecture** – React to events in the game server with ease using the event bus.    
✅ **Free Forever** – Licensed under the Unlicense, you are free to use it as you please. Commercial or otherwise.  

## 🌟 Kickstart Your Game in Minutes

```typescript

import * as http from 'http';
import { createGameServer } from 'shoehive';
import { BlackjackGameModule } from "./modules/blackjack";

// Create an HTTP server
const server = http.createServer();

// Create the game server
const gameServer = createGameServer(server);

// Register the game module
gameServer.registerGameModule(BlackjackGameModule);

// Start the server
server.listen(3000, () => {
  console.log(`Shoehive server running on port 3000`);
});
```


## 🧪 Testing

The framework includes comprehensive test suites to ensure reliability and correctness.

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npx jest tests/events/EventBus.test.ts

# Generate test coverage report
npm test -- --coverage
```

### Test Structure

- `tests/core/` - Tests for core components (Player, Table, etc.)
- `tests/events/` - Tests for event handling and message routing
- `tests/transport/` - Tests for transport modules
- `tests/integration/` - Integration tests for component interactions

To add new tests, follow the existing patterns in the test directories.

## 📄 License

This project is licensed under the [The Unlicense](https://unlicense.org/). See the [LICENSE](LICENSE) file for details.
