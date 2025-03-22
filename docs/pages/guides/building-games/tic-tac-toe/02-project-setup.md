---
layout: default
title: Setting Up Your Project
permalink: /guides/building-games/tic-tac-toe/project-setup
parent: Tic Tac Toe
grand_parent: Building Games
nav_order: 2
---

# Setting Up Your Project

In this section, we'll set up a new TypeScript project for our Tic-Tac-Toe game. Following a clean directory structure will help keep our code organized and maintainable.

## Creating the Project Directory

First, let's create a new directory and initialize our project:

```bash
# Create a new directory
mkdir tic-tac-toe-shoehive
cd tic-tac-toe-shoehive

# Initialize a new npm project
npm init -y
```

## Installing Dependencies

Next, we'll install the required dependencies:

```bash
# Install Shoehive and other dependencies
npm install shoehive typescript ts-node @types/node

# Initialize TypeScript
npx tsc --init
```

The `shoehive` package provides our game framework, while `typescript` and `ts-node` allow us to write and run TypeScript code without a separate build step during development.

## Setting Up the Directory Structure

Let's create a clean directory structure for our project:

```
tic-tac-toe-shoehive/
├── src/
│   ├── index.ts           # Entry point
│   ├── events.ts          # Game-specific events
│   ├── game-logic.ts      # Game logic implementation
│   ├── command-handlers.ts # Command handlers
│   └── utils.ts           # Utility functions
├── tsconfig.json
├── package.json
└── README.md
```

Create the source directory and empty files:

```bash
# Create directories
mkdir -p src

# Create empty files
touch src/index.ts src/events.ts src/game-logic.ts src/command-handlers.ts src/utils.ts
```

## Configuring TypeScript

Update your `tsconfig.json` file with appropriate settings for our project:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## Setting Up npm Scripts

Update the `package.json` file to include useful scripts for development:

```json
{
  "scripts": {
    "start": "ts-node src/index.ts",
    "dev": "NODE_ENV=development ts-node src/index.ts",
    "build": "tsc",
    "serve": "node dist/index.js"
  }
}
```

These scripts will allow you to:
- `npm start`: Run the application using ts-node
- `npm run dev`: Run in development mode with additional logging
- `npm run build`: Compile TypeScript to JavaScript
- `npm run serve`: Run the compiled JavaScript

## Next Steps

With our project structure set up, we can move on to defining the game-specific events that will form the foundation of our game's communication system.

Next: [Designing Game Events](/guides/building-games/tic-tac-toe/game-events) 