// Upgrade requests for paths Shoehive does not serve (docs/reference/protocol.md
// section 2): refused in listen() mode, left to other handlers in attach() mode.

import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { ticTacToe } from '../../../../examples/tic-tac-toe/src/game';
import {
  createServer,
  silentLogger,
  type ServerOptions,
  type ShoehiveServer,
} from '../../src/server/index';
import { SECRET, TestClient } from './client';

let cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups = [];
});

function shoehive(options: Partial<ServerOptions> = {}): ShoehiveServer {
  const server = createServer({
    games: [ticTacToe],
    secret: SECRET,
    logger: silentLogger,
    ...options,
  });
  cleanups.push(() => server.close({ graceful: false }));
  return server;
}

interface RawUpgrade {
  /** Everything the server has sent so far. */
  readonly response: () => string;
  /** Resolves when the server closes the connection. */
  readonly closed: Promise<void>;
  isClosed(): boolean;
  destroy(): void;
}

/** Opens a raw TCP connection and sends a WebSocket upgrade request for `path`. */
function rawUpgrade(port: number, path: string): RawUpgrade {
  const socket = connect(port, '127.0.0.1');
  let data = '';
  let closed = false;
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    data += chunk;
  });
  socket.on('error', () => undefined);
  const closedPromise = new Promise<void>((resolve) => {
    socket.on('close', () => {
      closed = true;
      resolve();
    });
  });
  socket.write(
    [
      `GET ${path} HTTP/1.1`,
      `Host: 127.0.0.1:${String(port)}`,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Protocol: shoehive.v1',
      '',
      '',
    ].join('\r\n'),
  );
  cleanups.push(() => {
    socket.destroy();
  });
  return {
    response: () => data,
    closed: closedPromise,
    isClosed: () => closed,
    destroy: () => socket.destroy(),
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function httpServer(): Promise<{ server: HttpServer; port: number }> {
  const server = createHttpServer((_req, res) => res.writeHead(404).end());
  // closeAllConnections() skips sockets handed to `upgrade` listeners, so track them all.
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => {
          resolve();
        });
      }),
  );
  return { server, port: (server.address() as AddressInfo).port };
}

/** A second WebSocket server on `/chat`, wired the way the ws README shares a server. */
function chatServer(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => {
    ws.on('message', (data: Buffer) => {
      ws.send(`echo:${data.toString('utf8')}`);
    });
  });
  server.on('upgrade', (request, socket, head) => {
    if ((request.url ?? '').split('?')[0] !== '/chat') return;
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        for (const ws of wss.clients) ws.terminate();
        wss.close(() => {
          resolve();
        });
      }),
  );
}

async function chatEcho(port: number): Promise<string> {
  const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/chat`);
  cleanups.push(() => {
    ws.terminate();
  });
  await new Promise<void>((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  const reply = new Promise<string>((resolve) => {
    ws.once('message', (data: Buffer) => {
      resolve(data.toString('utf8'));
    });
  });
  ws.send('hi');
  return reply;
}

async function gameClientConnects(url: string): Promise<void> {
  const client = TestClient.ws(url);
  cleanups.push(() => {
    client.close();
  });
  await client.hello();
  expect(client.welcome?.player.id).toBeTruthy();
}

describe('listen() mode', () => {
  it('refuses an upgrade to an unknown path with 404 and closes the socket', async () => {
    const server = shoehive();
    const { port, url } = await server.listen();
    for (const path of ['/__shoehive/ws', '/nope', '/shoehive/extra']) {
      const raw = rawUpgrade(port, path);
      await raw.closed;
      expect(raw.response()).toMatch(/^HTTP\/1\.1 404 Not Found\r\n/);
    }
    await gameClientConnects(url);
  });

  it('closes refused sockets even when the client keeps its side open', async () => {
    const server = shoehive({ origins: ['https://example.com'] });
    const { port } = await server.listen();
    const raw = rawUpgrade(port, '/shoehive'); // no Origin header: 403
    await raw.closed;
    expect(raw.response()).toMatch(/^HTTP\/1\.1 403 Forbidden\r\n/);
  });
});

describe('attach() mode', () => {
  it('leaves unknown paths to other upgrade handlers by default', async () => {
    const { server, port } = await httpServer();
    chatServer(server);
    await shoehive().attach(server);

    expect(await chatEcho(port)).toBe('echo:hi');
    await gameClientConnects(`ws://127.0.0.1:${String(port)}/shoehive`);

    // Nothing owns this path, and Shoehive does not touch it either.
    const raw = rawUpgrade(port, '/nope');
    await delay(100);
    expect(raw.isClosed()).toBe(false);
    expect(raw.response()).toBe('');
  });

  it("refuses unknown paths at once with unknownUpgrades: 'refuse'", async () => {
    const { server, port } = await httpServer();
    await shoehive({ unknownUpgrades: 'refuse' }).attach(server);

    const raw = rawUpgrade(port, '/nope');
    await raw.closed;
    expect(raw.response()).toMatch(/^HTTP\/1\.1 404 Not Found\r\n/);
    await gameClientConnects(`ws://127.0.0.1:${String(port)}/shoehive`);
  });

  it('refuses only unclaimed sockets with unknownUpgrades: { refuseAfterMs }', async () => {
    const { server, port } = await httpServer();
    chatServer(server);
    await shoehive({ unknownUpgrades: { refuseAfterMs: 50 } }).attach(server);

    const raw = rawUpgrade(port, '/nope');
    expect(await chatEcho(port)).toBe('echo:hi');
    await raw.closed;
    expect(raw.response()).toMatch(/^HTTP\/1\.1 404 Not Found\r\n/);

    // The chat socket was upgraded by its own handler, so it outlives the timeout.
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/chat`);
    cleanups.push(() => {
      ws.terminate();
    });
    await new Promise<void>((resolve) => ws.on('open', resolve));
    await delay(120);
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('rejects an invalid refuseAfterMs', () => {
    expect(() =>
      createServer({
        games: [ticTacToe],
        secret: SECRET,
        logger: silentLogger,
        unknownUpgrades: { refuseAfterMs: 0 },
      }),
    ).toThrow(/refuseAfterMs/);
  });
});
