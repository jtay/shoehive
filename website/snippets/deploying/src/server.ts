import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'shoehive/server';
import { sqliteStore } from 'shoehive/store/sqlite';
import { ticTacToe } from '../../../../examples/tic-tac-toe/src/game';

// #region server
const port = Number(process.env.PORT ?? 3000);
const store = sqliteStore({ file: process.env.DB_FILE ?? './shoehive.db' });

// SHOEHIVE_SECRET is read from the environment. With NODE_ENV=production the server
// refuses to start without it (or without an `auth` hook).
const shoehive = createServer({
  games: [ticTacToe],
  store,
  // Only pages served from these origins may open a WebSocket. Empty means any origin.
  origins: process.env.ORIGINS?.split(',') ?? [],
});

let ready = false;
void shoehive.ready.then(() => {
  ready = true;
});

// Your own HTTP server: the health check lives here, next to the WebSocket endpoint.
const http = createHttpServer((req, res) => {
  if (req.url === '/healthz') {
    res
      .writeHead(ready ? 200 : 503, { 'content-type': 'text/plain' })
      .end(ready ? 'ok' : 'starting');
    return;
  }
  res.writeHead(404).end();
});
await shoehive.attach(http);
http.listen(port, '0.0.0.0');
// #endregion server

// #region shutdown
async function shutdown(): Promise<void> {
  await shoehive.close(); // snapshots every table, then closes sockets with code 1001
  await new Promise((resolve) => http.close(resolve));
  await store.close(); // the server does not close a store you created
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
// #endregion shutdown
