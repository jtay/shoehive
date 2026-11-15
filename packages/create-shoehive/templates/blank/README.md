# {{name}}

A starting point for a [Shoehive](https://shoehive.jtay.co.uk) game: one shared counter and one
action, `press`. Whoever makes the tenth press wins. Replace it with your own rules.

## Play it

```sh
{{run}} dev
```

Open http://localhost:5173, create a game, take a seat and press. To add a second player, open
the same page in a private window (each window without shared storage is a different guest).

`{{run}} dev` runs two things in one terminal: the Vite dev server for the web app (with hot
reload) and the game server, `src/server.ts`, which restarts when you change the game. The
game server also prints a devtools link: open it to inspect tables, views and the action log.

## Make it yours

| File                | What it is                                                  |
| ------------------- | ----------------------------------------------------------- |
| `src/game.ts`       | The rules: state, actions and when the game ends            |
| `test/game.test.ts` | Tests for the rules, run without a server or a browser      |
| `src/server.ts`     | The game server: the WebSocket endpoint and the built app   |
| `web/App.tsx`       | The React app: lobby, seats and the table, `shoehive/react` |
| `web/style.css`     | Styles                                                      |
| `vite.config.ts`    | Vite (dev server, proxy, build) and Vitest settings         |

The game id (`my-game`) appears in `src/game.ts` and `web/App.tsx`: change both together.

## Scripts

| Command             | What it does                                                   |
| ------------------- | -------------------------------------------------------------- |
| `{{run}} dev`       | Dev server with hot reload, plus the game server in watch mode |
| `{{run}} test`      | Runs the tests with Vitest                                     |
| `{{run}} typecheck` | Type-checks everything with TypeScript                         |
| `{{run}} build`     | Builds the web app into `dist-web/`                            |
| `{{run}} start`     | Serves the built app and the game on http://localhost:3000     |

## Deploy

Build the app, then run the server with `NODE_ENV=production` and a secret of your own (at
least 32 characters):

```sh
{{run}} build
NODE_ENV=production SHOEHIVE_SECRET=change-me-to-a-long-random-string {{run}} start
```

Devtools is off in production. `PORT` sets the port (default 3000).

## Learn more

- Tutorial, tic-tac-toe in 20 minutes (turns, input validation, a React board):
  https://shoehive.jtay.co.uk/tutorials/tic-tac-toe/
- All tutorials and how-to guides: https://shoehive.jtay.co.uk
