# 🐝 Shoehive - Open Source Multiplayer Game Framework

Shoehive is an **extensible, WebSocket-based multiplayer game framework** designed for real-time, event-driven gameplay. It provides a powerful **player management system, message routing, and structured table handling**, allowing developers to build their own game logic while leveraging a robust core.

[![Run Tests](https://github.com/jtay/shoehive/actions/workflows/test.yml/badge.svg?branch=main)](https://github.com/jtay/shoehive/actions/workflows/test.yml) [![Publish to npm](https://github.com/jtay/shoehive/actions/workflows/publish.yml/badge.svg)](https://github.com/jtay/shoehive/actions/workflows/publish.yml)
#### [**🐙 GitHub**](https://github.com/jtay/shoehive) &nbsp; | &nbsp; [**📦 Releases**](https://github.com/jtay/shoehive/releases) &nbsp; | &nbsp; [**⚡️ Quick Start Guide**](https://github.com/jtay/shoehive/tree/main/docs/quick-start.md) &nbsp; | &nbsp; [**📖 Docs**](https://github.com/jtay/shoehive/tree/main/docs/README.md) &nbsp; | &nbsp; [**🔍 API Reference**](https://github.com/jtay/shoehive/tree/main/docs/api-reference.md) &nbsp; | &nbsp; [**🤝 Contributing**](https://github.com/jtay/shoehive/tree/main/CONTRIBUTING.md)

## 🚀 Features

✅ **WebSocket-Powered** – Real-time, low-latency communication.  
✅ **Modular Player System** – Extend and customize player behavior.  
✅ **Table & Seat Management** – Players can sit at one table and occupy multiple seats.  
✅ **Hybrid Message Routing** – Supports command-based actions and event-driven mechanics.  
✅ **Lightweight & Scalable** – Designed for high-performance multiplayer games.  
✅ **Open Source & Flexible** – Easily integrates with custom game logic.  
✅ **Transport Modules** – Authentication and server-side communication interfaces.

## 📦 Installation

```bash
npm i shoehive
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

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

