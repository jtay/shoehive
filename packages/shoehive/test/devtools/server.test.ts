// The devtools backend (ADR 0011): mounting and the production rules, token auth and
// lockout, loopback and Origin checks, security headers, attach mode, every request
// type against the example games, time travel, fork, export and pushes.

import { createServer as createHttpServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { blackjack } from '../../../../examples/blackjack/src/game';
import { quiz } from '../../../../examples/quiz/src/game';
import { ticTacToe } from '../../../../examples/tic-tac-toe/src/game';
import { defineGame } from '../../src/core/define';
import { reject } from '../../src/core/errors';
import { TableRuntime, type LogEntry } from '../../src/core/runtime';
import { MemoryWallet } from '../../src/core/wallet';
import {
  DEVTOOLS_CLOSE,
  type DevRequestType,
  type DevResults,
  type DevServerMessage,
  type DevTableDetail,
  type DevWelcome,
} from '../../src/devtools/index';
import {
  createServer,
  memoryStore,
  type Logger,
  type ServerOptions,
  type ShoehiveServer,
  type Store,
} from '../../src/server/index';
import { FakeClock, fixtureStateHash, replayFixture } from '../../src/testing/index';
import { SECRET, TestClient } from '../server/client';
import { z } from 'zod';

const TOKEN = 'devtools-test-token-that-is-long-enough-0123';

/** Stores each seat's player id in state, and takes player ids as action input. */
const roster = defineGame({
  id: 'roster',
  seats: { min: 2, max: 3 },
  setup: () => ({ players: [] as (string | null)[], picked: null as string | null }),
  onSit: ({ state, seat, player }) => {
    state.players[seat!] = player;
  },
  actions: {
    pick: {
      input: z.object({ player: z.string() }),
      run({ state, input }) {
        if (!state.players.includes(input.player)) reject('UNKNOWN_PLAYER');
        state.picked = input.player;
      },
    },
  },
});

// ---------------------------------------------------------------------------------
// Helpers

interface LogLine {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  data: Record<string, unknown> | undefined;
}

function capture(): { lines: LogLine[]; logger: Logger } {
  const lines: LogLine[] = [];
  const at =
    (level: LogLine['level']) =>
    (message: string, data?: Record<string, unknown>): void => {
      lines.push({ level, message, data });
    };
  return {
    lines,
    logger: { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') },
  };
}

/** A memory store that records which tables were written to. */
function spyStore(): { store: Store; written: Set<string> } {
  const inner = memoryStore();
  const written = new Set<string>();
  return {
    written,
    store: {
      ...inner,
      appendLog: (table, entries) => {
        written.add(table);
        return inner.appendLog(table, entries);
      },
      saveSnapshot: (table, snapshot) => {
        written.add(table);
        return inner.saveSnapshot(table, snapshot);
      },
      closeTable: (table, reason) => {
        written.add(table);
        return inner.closeTable(table, reason);
      },
    },
  };
}

let servers: ShoehiveServer[] = [];
let sockets: WebSocket[] = [];
afterEach(async () => {
  for (const ws of sockets) ws.terminate();
  sockets = [];
  await Promise.all(servers.map((s) => s.close({ graceful: false })));
  servers = [];
  vi.unstubAllEnvs();
});

async function start(extra: Partial<ServerOptions> = {}) {
  const log = capture();
  const spy = spyStore();
  const wallet = new MemoryWallet({ startingBalance: 1000 });
  const clock = new FakeClock();
  const server = createServer({
    games: [ticTacToe, quiz, blackjack, roster],
    secret: SECRET,
    logger: log.logger,
    clock,
    store: spy.store,
    wallet,
    devtools: { enabled: true, token: TOKEN },
    ...extra,
  });
  servers.push(server);
  const { port } = await server.listen();
  return {
    server,
    port,
    log,
    clock,
    wallet,
    store: extra.store ?? spy.store,
    written: spy.written,
    gameUrl: `ws://127.0.0.1:${String(port)}/shoehive`,
    devUrl: `ws://127.0.0.1:${String(port)}/__shoehive/ws`,
    http: `http://127.0.0.1:${String(port)}`,
  };
}

class DevError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

/** A devtools client over `ws`. */
class Dev {
  readonly pushes: DevServerMessage[] = [];
  welcome: DevWelcome | null = null;
  closed: { code: number; reason: string } | null = null;
  private nextId = 1;
  private readonly waiting = new Map<string, (m: DevServerMessage) => void>();
  private readonly opened: Promise<void>;

  constructor(
    url: string,
    readonly ws = new WebSocket(url),
  ) {
    sockets.push(ws);
    this.opened = new Promise((resolve, rejectOpen) => {
      ws.on('open', () => {
        resolve();
      });
      ws.on('unexpected-response', (_req, res) => {
        this.closed = { code: res.statusCode ?? 0, reason: `HTTP ${String(res.statusCode)}` };
        rejectOpen(new Error(`HTTP ${String(res.statusCode)}`));
      });
      ws.on('error', rejectOpen);
    });
    this.opened.catch(() => undefined);
    ws.on('message', (data: Buffer) => {
      const message = JSON.parse(data.toString('utf8')) as DevServerMessage;
      if (message.t === 'result') {
        this.waiting.get(message.id)?.(message);
        this.waiting.delete(message.id);
      } else if (message.t === 'auth.ok') {
        this.welcome = message.welcome;
      } else {
        this.pushes.push(message);
      }
    });
    ws.on('close', (code: number, reason: Buffer) => {
      this.closed = { code, reason: reason.toString('utf8') };
    });
  }

  static async connect(url: string, token = TOKEN): Promise<Dev> {
    const dev = new Dev(url);
    await dev.open();
    dev.send({ t: 'auth', token });
    await dev.until(() => dev.welcome !== null || dev.closed !== null, 'auth');
    if (!dev.welcome) throw new Error(`closed ${String(dev.closed?.code)}`);
    return dev;
  }

  open(): Promise<void> {
    return this.opened;
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  async raw(t: string, fields: Record<string, unknown> = {}): Promise<DevServerMessage> {
    const id = String(this.nextId++);
    const result = new Promise<DevServerMessage>((resolve) => this.waiting.set(id, resolve));
    this.send({ t, id, ...fields });
    return result;
  }

  async request<T extends DevRequestType>(
    t: T,
    fields: Record<string, unknown> = {},
  ): Promise<DevResults[T]> {
    const message = await this.raw(t, fields);
    if (message.t !== 'result') throw new Error('not a result');
    if (!message.ok) throw new DevError(message.error.code, message.error.message);
    return message.result as DevResults[T];
  }

  async failure(t: DevRequestType, fields: Record<string, unknown> = {}): Promise<string> {
    const message = await this.raw(t, fields);
    if (message.t !== 'result' || message.ok) throw new Error(`${t} did not fail`);
    return message.error.code;
  }

  async until(predicate: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
    const startAt = Date.now();
    while (!predicate()) {
      if (Date.now() - startAt > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }

  async closedWith(): Promise<number> {
    await this.until(() => this.closed !== null, 'close');
    return this.closed!.code;
  }
}

async function player(url: string, name: string): Promise<TestClient> {
  const client = TestClient.ws(url);
  await client.hello({ name });
  return client;
}

/** Waits until `client` holds the table document at the runtime's current rev. */
async function synced(client: TestClient, server: ShoehiveServer, table: string): Promise<void> {
  const runtime = server.tables.runtime(table)!;
  await runtime.idle();
  await client.until(() => client.tables.get(table)?.rev === runtime.rev, `sync of ${table}`);
}

/** Creates a table of `game` with players seated in order; every client joins it. */
async function seated(url: string, game: string, names: string[], options?: unknown) {
  const clients: TestClient[] = [];
  for (const name of names) clients.push(await player(url, name));
  const { table } = (await clients[0]!.ok('table.create', {
    game,
    ...(options === undefined ? {} : { options }),
  })) as { table: string };
  for (const client of clients) {
    await client.ok('table.join', { table });
    await client.ok('seat.take', { table });
  }
  return { table, clients };
}

function viewOf(detail: DevTableDetail, viewer: string) {
  const found = detail.views.find((v) => v.viewer === viewer);
  if (!found) throw new Error(`no view for ${viewer}`);
  return found.view;
}

async function get(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { redirect: 'manual', ...init });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

function fakeRequest(url: string, remoteAddress: string): IncomingMessage {
  return {
    url,
    method: 'GET',
    headers: { host: 'localhost' },
    socket: { remoteAddress },
  } as unknown as IncomingMessage;
}

function fakeResponse() {
  const out = { status: 0, body: '' };
  const res = {
    writeHead(status: number) {
      out.status = status;
      return res;
    },
    end(body?: Buffer | string) {
      out.body = body === undefined ? '' : body.toString();
      return res;
    },
  };
  return { out, res: res as never };
}

// ---------------------------------------------------------------------------------

describe('mounting', () => {
  it('disabled: devtools paths get the normal response and the module is never imported', async () => {
    let imported = 0;
    vi.resetModules();
    vi.doMock('../../src/devtools/server', async (importOriginal) => {
      imported += 1;
      return importOriginal();
    });
    try {
      const fresh = await import('../../src/server/server');
      const log = capture();
      const off = fresh.createServer({ games: [ticTacToe], secret: SECRET, logger: log.logger });
      servers.push(off);
      expect(off.devtools).toBeUndefined();
      const { port } = await off.listen();
      const res = await get(`http://127.0.0.1:${String(port)}/__shoehive/`);
      expect(res.status).toBe(426);
      expect(res.headers.get('content-security-policy')).toBeNull();
      expect(imported).toBe(0);

      const on = fresh.createServer({
        games: [ticTacToe],
        secret: SECRET,
        logger: log.logger,
        devtools: true,
      });
      servers.push(on);
      await on.listen();
      expect(imported).toBe(1);
    } finally {
      vi.doUnmock('../../src/devtools/server');
      vi.resetModules();
    }
  });

  it('devtools: true in dev generates a token and logs the inspector URL once', async () => {
    const { log, port, devUrl } = await start({ devtools: true });
    const lines = log.lines.filter((l) => l.message.startsWith('Devtools inspector:'));
    expect(lines).toHaveLength(1);
    const url = new URL(lines[0]!.message.slice('Devtools inspector: '.length));
    expect(url.origin).toBe(`http://127.0.0.1:${String(port)}`);
    expect(url.pathname).toBe('/__shoehive/');
    const token = new URLSearchParams(url.hash.slice(1)).get('token')!;
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(url.search).toBe('');
    const dev = await Dev.connect(devUrl, token);
    expect(dev.welcome?.production).toBe(false);
  });

  it('rejects a devtools path that would swallow the game socket path', () => {
    expect(() =>
      createServer({
        games: [ticTacToe],
        secret: SECRET,
        path: '/dev/socket',
        devtools: { enabled: true, path: '/dev' },
      }),
    ).toThrow(/inside the devtools path/);
    expect(() =>
      createServer({ games: [ticTacToe], secret: SECRET, devtools: { enabled: true, path: 'x/' } }),
    ).toThrow(TypeError);
  });

  it('serves a custom path', async () => {
    const { http, port } = await start({
      devtools: { enabled: true, token: TOKEN, path: '/inspect' },
    });
    expect((await get(`${http}/inspect/`)).status).toBe(200);
    expect((await get(`${http}/__shoehive/`)).status).toBe(426);
    await Dev.connect(`ws://127.0.0.1:${String(port)}/inspect/ws`);
  });
});

describe('production rules (ADR 0011 rules 1 to 4)', () => {
  const base = { games: [ticTacToe], secret: SECRET };

  it('ignores devtools: true with a warning', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const log = capture();
    const server = createServer({ ...base, logger: log.logger, devtools: true });
    servers.push(server);
    expect(server.devtools).toBeUndefined();
    expect(
      log.lines.some((l) => l.level === 'warn' && l.message.includes('ignored in production')),
    ).toBe(true);
    const { port } = await server.listen();
    expect((await get(`http://127.0.0.1:${String(port)}/__shoehive/`)).status).toBe(426);
  });

  it('throws without allowInProduction, without a token, or with a short token', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => createServer({ ...base, devtools: { enabled: true, token: TOKEN } })).toThrow(
      /allowInProduction/,
    );
    expect(() =>
      createServer({ ...base, devtools: { enabled: true, allowInProduction: true } }),
    ).toThrow(/32 characters/);
    expect(() =>
      createServer({
        ...base,
        devtools: { enabled: true, allowInProduction: true, token: 'short-token' },
      }),
    ).toThrow(/32 characters/);
    // Explicitly disabled is fine.
    servers.push(createServer({ ...base, devtools: { enabled: false } }));
  });

  it('runs when deliberate, says so in the log, and refuses forks', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { log, devUrl, gameUrl } = await start({
      devtools: { enabled: true, allowInProduction: true, token: TOKEN },
    });
    const live = log.lines.find((l) => l.message.includes('LIVE in production'));
    expect(live?.level).toBe('warn');
    expect(live?.message).not.toContain(TOKEN);
    const dev = await Dev.connect(devUrl);
    expect(dev.welcome?.production).toBe(true);
    const { table } = await seated(gameUrl, 'tic-tac-toe', ['Alice', 'Bob']);
    expect(await dev.failure('table.fork', { table })).toBe('FORBIDDEN');
    // Reading still works.
    expect((await dev.request('table.at', { table, seq: 0 })).seq).toBe(0);
  });
});

describe('authentication (ADR 0011 rule 6)', () => {
  it('accepts the token, logs the session at warn with the remote address', async () => {
    const { devUrl, log } = await start();
    const dev = await Dev.connect(devUrl);
    expect(dev.welcome?.protocol).toBe(1);
    expect(dev.welcome?.games.map((g) => g.id)).toEqual([
      'tic-tac-toe',
      'quiz',
      'blackjack',
      'roster',
    ]);
    expect(dev.welcome?.games[1]).toEqual({
      id: 'quiz',
      name: 'Quiz',
      version: 1,
      seats: { min: 2, max: 12 },
    });
    const line = log.lines.find((l) => l.message === 'Devtools session authenticated');
    expect(line?.level).toBe('warn');
    expect(line?.data).toEqual({ remote: '127.0.0.1' });
  });

  it('closes with UNAUTHORIZED on a wrong token, a missing token or a request before auth', async () => {
    const { devUrl } = await start();
    const wrong = new Dev(devUrl);
    await wrong.open();
    wrong.send({ t: 'auth', token: `${TOKEN}x` });
    expect(await wrong.closedWith()).toBe(DEVTOOLS_CLOSE.UNAUTHORIZED);

    const missing = new Dev(devUrl);
    await missing.open();
    missing.send({ t: 'auth' });
    expect(await missing.closedWith()).toBe(DEVTOOLS_CLOSE.UNAUTHORIZED);

    const early = new Dev(devUrl);
    await early.open();
    early.send({ t: 'tables.list', id: '1' });
    expect(await early.closedWith()).toBe(DEVTOOLS_CLOSE.UNAUTHORIZED);
  });

  it('locks an address out for a minute after 5 failures, even for the right token', async () => {
    const { devUrl, log } = await start();
    for (let i = 0; i < 4; i++) {
      const dev = new Dev(devUrl);
      await dev.open();
      dev.send({ t: 'auth', token: 'nope' });
      expect(await dev.closedWith()).toBe(DEVTOOLS_CLOSE.UNAUTHORIZED);
    }
    const fifth = new Dev(devUrl);
    await fifth.open();
    fifth.send({ t: 'auth', token: 'nope' });
    expect(await fifth.closedWith()).toBe(DEVTOOLS_CLOSE.LOCKED_OUT);
    expect(log.lines.some((l) => l.message.includes('locked out'))).toBe(true);

    const right = new Dev(devUrl);
    await right.open();
    right.send({ t: 'auth', token: TOKEN });
    expect(await right.closedWith()).toBe(DEVTOOLS_CLOSE.LOCKED_OUT);

    // A minute later the address may try again.
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now + 61_000);
    try {
      const after = await Dev.connect(devUrl);
      expect(after.welcome).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('HTTP', () => {
  it('serves the UI with the security headers (ADR 0011 rule 8)', async () => {
    const { http } = await start();
    const index = await get(`${http}/__shoehive/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(index.body).toContain('<div id="app">');
    for (const res of [
      index,
      await get(`${http}/__shoehive/app.js`),
      await get(`${http}/__shoehive/nope`),
    ]) {
      expect(res.headers.get('cache-control')).toBe('no-store');
      const csp = res.headers.get('content-security-policy')!;
      expect(csp).toMatch(/^default-src 'self'/);
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain('unsafe');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    }
    const js = await get(`${http}/__shoehive/app.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
  });

  it('redirects the bare path, 404s unknown paths, 405s other methods', async () => {
    const { http } = await start();
    const bare = await get(`${http}/__shoehive`);
    expect(bare.status).toBe(308);
    expect(bare.headers.get('location')).toBe('/__shoehive/');
    expect((await get(`${http}/__shoehive/nope.js`)).status).toBe(404);
    expect((await get(`${http}/__shoehive/constructor`)).status).toBe(404);
    expect((await get(`${http}/__shoehive/ws`)).status).toBe(404);
    expect((await get(`${http}/__shoehive/`, { method: 'POST' })).status).toBe(405);
    expect((await get(`${http}/__shoehivex`)).status).toBe(426);
    const head = await get(`${http}/__shoehive/`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
  });

  it('answers 404 to non-loopback clients unless allowRemote, and logs the hint once', async () => {
    const { server, log } = await start();
    const devtools = server.devtools!;
    for (const remote of ['10.1.2.3', '192.168.0.9', '::ffff:10.0.0.1', '2001:db8::1']) {
      const { out, res } = fakeResponse();
      expect(devtools.handleRequest(fakeRequest('/__shoehive/', remote), res)).toBe(true);
      expect(out.status).toBe(404);
    }
    expect(log.lines.filter((l) => l.message.includes('allowRemote'))).toHaveLength(1);
    for (const remote of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.8.9.10']) {
      const { out, res } = fakeResponse();
      devtools.handleRequest(fakeRequest('/__shoehive/', remote), res);
      expect(out.status).toBe(200);
    }
    // Not a devtools path: untouched.
    const { out, res } = fakeResponse();
    expect(devtools.handleRequest(fakeRequest('/other', '10.1.2.3'), res)).toBe(false);
    expect(out.status).toBe(0);

    const remote = await start({ devtools: { enabled: true, token: TOKEN, allowRemote: true } });
    const allowed = fakeResponse();
    remote.server.devtools!.handleRequest(fakeRequest('/__shoehive/', '10.1.2.3'), allowed.res);
    expect(allowed.out.status).toBe(200);
  });

  it('refuses cross-site Origins on the socket, allows same-host and listed ones', async () => {
    const { devUrl, port } = await start();
    const evil = new Dev(
      devUrl,
      new WebSocket(devUrl, { headers: { origin: 'https://evil.example' } }),
    );
    await expect(evil.open()).rejects.toThrow('HTTP 403');
    const same = new Dev(
      devUrl,
      new WebSocket(devUrl, { headers: { origin: `http://127.0.0.1:${String(port)}` } }),
    );
    await same.open();

    const listed = await start({ origins: ['https://app.example'] });
    const fromApp = new Dev(
      listed.devUrl,
      new WebSocket(listed.devUrl, { headers: { origin: 'https://app.example' } }),
    );
    await fromApp.open();
    const none = new Dev(listed.devUrl);
    await expect(none.open()).rejects.toThrow('HTTP 403');
  });
});

describe('attach mode', () => {
  it('answers devtools paths, leaves the app routes alone, and restores them on close', async () => {
    const log = capture();
    const http = createHttpServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end(`app:${req.url ?? ''}`);
    });
    const shoehive = createServer({
      games: [ticTacToe],
      secret: SECRET,
      logger: log.logger,
      devtools: { enabled: true, token: TOKEN },
    });
    await shoehive.attach(http);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = http.address() as AddressInfo;
      const base = `http://127.0.0.1:${String(port)}`;
      expect((await get(`${base}/hello`)).body).toBe('app:/hello');
      expect((await get(`${base}/`)).body).toBe('app:/');
      const ui = await get(`${base}/__shoehive/`);
      expect(ui.status).toBe(200);
      expect(ui.headers.get('x-frame-options')).toBe('DENY');
      expect(
        log.lines.some((l) =>
          l.message.includes(`http://127.0.0.1:${String(port)}/__shoehive/#token=${TOKEN}`),
        ),
      ).toBe(true);
      await Dev.connect(`ws://127.0.0.1:${String(port)}/__shoehive/ws`);
      const game = TestClient.ws(`ws://127.0.0.1:${String(port)}/shoehive`);
      await game.hello();
      game.close();

      await shoehive.close();
      expect(http.listeners('request')).toHaveLength(1);
      expect((await get(`${base}/__shoehive/`)).body).toBe('app:/__shoehive/');
      expect((await get(`${base}/hello`)).body).toBe('app:/hello');
    } finally {
      await new Promise<void>((resolve) => {
        http.close(() => {
          resolve();
        });
        http.closeAllConnections();
      });
    }
  });
});

describe('requests', () => {
  it('tables.list and sessions.list', async () => {
    const { devUrl, gameUrl, server } = await start();
    const dev = await Dev.connect(devUrl);
    const { table, clients } = await seated(gameUrl, 'tic-tac-toe', ['Alice', 'Bob']);
    await server.tables.runtime(table)!.idle();
    const { tables } = await dev.request('tables.list');
    expect(tables).toEqual([
      {
        id: table,
        game: 'tic-tac-toe',
        status: 'active',
        rev: server.tables.runtime(table)!.rev,
        seats: { taken: 2, total: 2 },
        connections: 2,
        createdAt: expect.any(Number) as number,
        dev: false,
        faulted: false,
      },
    ]);
    const { sessions, connections } = await dev.request('sessions.list');
    const alice = clients[0]!.welcome!.player.id;
    expect(sessions).toContainEqual({
      player: alice,
      name: 'Alice',
      guest: true,
      connections: 1,
      tables: [table],
    });
    expect(connections).toHaveLength(2);
    expect(connections).toContainEqual({
      player: alice,
      remote: null,
      connectedAt: expect.any(Number) as number,
      tables: [table],
    });
  });

  it('validates requests', async () => {
    const { devUrl, gameUrl } = await start();
    const dev = await Dev.connect(devUrl);
    const { table } = await seated(gameUrl, 'tic-tac-toe', ['Alice', 'Bob']);
    expect(await dev.failure('table.watch', { table: 'missing' })).toBe('NOT_FOUND');
    expect(await dev.failure('table.at', { table, seq: 99 })).toBe('BAD_REQUEST');
    expect(await dev.failure('table.at', { table, seq: -1 })).toBe('BAD_REQUEST');
    expect(await dev.failure('table.at', { table })).toBe('BAD_REQUEST');
    expect(await dev.failure('table.log', { table })).toBe('BAD_REQUEST');
    const unknown = await dev.raw('table.edit', { table });
    expect(unknown.t === 'result' && !unknown.ok && unknown.error.code).toBe('BAD_REQUEST');
  });

  it('tic-tac-toe: detail, views per seat as each client receives them, log, diagnostics', async () => {
    const { devUrl, gameUrl, server } = await start();
    const dev = await Dev.connect(devUrl);
    const { table, clients } = await seated(gameUrl, 'tic-tac-toe', ['Alice', 'Bob']);
    const [alice, bob] = clients as [TestClient, TestClient];
    await alice.ok('act', { table, name: 'place', input: { cell: 4 } });
    const rejected = await alice.request('act', { table, name: 'place', input: { cell: 0 } });
    expect(rejected.ok).toBe(false);
    await bob.ok('act', { table, name: 'place', input: { cell: 0 } });
    await synced(alice, server, table);
    await synced(bob, server, table);
    const runtime = server.tables.runtime(table)!;

    const detail = await dev.request('table.watch', { table });
    expect(detail).toMatchObject({ id: table, game: 'tic-tac-toe', replayed: false });
    expect(detail.rev).toBe(runtime.rev);
    expect(detail.seq).toBe(runtime.rev);
    expect(detail.state).toEqual(runtime.state);
    expect(detail.engine.seed).toBe(runtime.engine.seed);
    expect(detail.meta).toEqual(alice.doc(table).meta);
    expect(detail.seats).toEqual(alice.doc(table).seats);
    expect(detail.views.map((v) => v.viewer)).toEqual(['seat:0', 'seat:1', 'spectator']);
    expect(detail.views[0]!.label).toBe('Alice (seat 0)');
    expect(viewOf(detail, 'seat:0')).toEqual(alice.doc(table).view);
    expect(viewOf(detail, 'seat:1')).toEqual(bob.doc(table).view);
    expect(detail.diagnostics.map((d) => d.code)).toContain('NOT_YOUR_TURN');

    const log = await dev.request('table.log', { table, from: 0 });
    expect(log.last).toBe(runtime.rev);
    expect(log.entries).toEqual(JSON.parse(JSON.stringify(runtime.log)));
    const part = await dev.request('table.log', { table, from: 1, to: 2 });
    expect(part.entries.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('quiz: secrets in state, each seat sees only its own answer', async () => {
    const { devUrl, gameUrl, server } = await start();
    const dev = await Dev.connect(devUrl);
    const { table, clients } = await seated(gameUrl, 'quiz', ['Alice', 'Bob', 'Carol']);
    const [alice, bob, carol] = clients as [TestClient, TestClient, TestClient];
    // The round opened with Alice and Bob (the table started at two players). Only Alice
    // answers, so the round stays open.
    await alice.ok('act', { table, name: 'answer', input: { choice: 2 } });
    for (const c of clients) await synced(c, server, table);
    const spectator = await player(gameUrl, 'Watcher');
    await spectator.ok('table.join', { table, as: 'spectator' });
    await synced(spectator, server, table);

    const detail = await dev.request('table.watch', { table });
    const state = detail.state as { answers: Record<string, { choice: number }> };
    expect(detail.meta.phase).toBe('question');
    expect(state.answers['0']?.choice).toBe(2);
    expect(viewOf(detail, 'seat:0')).toEqual(alice.doc(table).view);
    expect(viewOf(detail, 'seat:1')).toEqual(bob.doc(table).view);
    expect(viewOf(detail, 'seat:2')).toEqual(carol.doc(table).view);
    expect(viewOf(detail, 'spectator')).toEqual(spectator.doc(table).view);
    expect((viewOf(detail, 'seat:0') as { answers: unknown }).answers).toEqual({ 0: 2 });
    expect((viewOf(detail, 'seat:1') as { answers: unknown }).answers).toEqual({});
    expect((viewOf(detail, 'seat:2') as { answers: unknown }).answers).toEqual({});
    expect((viewOf(detail, 'spectator') as { correct: unknown }).correct).toBeNull();
  });

  it('blackjack: the hole card and shoe are in state but in no view', async () => {
    const { devUrl, gameUrl, server } = await start();
    const dev = await Dev.connect(devUrl);
    // A natural blackjack skips straight to the dealer (who then shows the hole card):
    // deal until a hand is in play. The seed is random, so this takes a few tries at most.
    let found: { table: string; alice: TestClient; bob: TestClient } | null = null;
    for (let attempt = 0; attempt < 20 && !found; attempt++) {
      const { table, clients } = await seated(gameUrl, 'blackjack', ['Alice', 'Bob']);
      const [alice, bob] = clients as [TestClient, TestClient];
      await alice.ok('act', { table, name: 'bet', input: { amount: 50 } });
      await server.tables.runtime(table)!.idle();
      if (server.tables.runtime(table)!.engine.phase === 'play') found = { table, alice, bob };
    }
    const { table, alice, bob } = found!;
    await synced(alice, server, table);
    await synced(bob, server, table);
    const detail = await dev.request('table.watch', { table });
    expect(detail.meta.phase).toBe('play');
    const state = detail.state as { dealer: unknown[]; shoe: unknown[] };
    expect(state.dealer).toHaveLength(2);
    expect(state.shoe.length).toBeGreaterThan(0);
    for (const [viewer, client] of [
      ['seat:0', alice],
      ['seat:1', bob],
    ] as const) {
      const view = viewOf(detail, viewer) as { dealer: unknown[]; shoe: unknown };
      expect(view).toEqual(client.doc(table).view);
      expect(view.dealer[1]).not.toEqual(state.dealer[1]);
      expect(view.shoe).toEqual({ remaining: state.shoe.length });
    }
  });
});

describe('time travel (table.at)', () => {
  it('equals a fresh replay at several seqs and never touches the live table', async () => {
    const { devUrl, gameUrl, server } = await start();
    const dev = await Dev.connect(devUrl);
    const { table, clients } = await seated(gameUrl, 'blackjack', ['Alice', 'Bob']);
    const [alice] = clients as [TestClient, TestClient];
    await alice.ok('act', { table, name: 'bet', input: { amount: 20 } });
    await alice.ok('act', { table, name: 'stand' }).catch(() => undefined);
    const runtime = server.tables.runtime(table)!;
    await runtime.idle();
    const log = JSON.parse(JSON.stringify(runtime.log)) as LogEntry[];
    const rev = runtime.rev;
    for (const seq of [0, 1, Math.floor(rev / 2), rev]) {
      const detail = await dev.request('table.at', { table, seq });
      const fresh = await TableRuntime.replay(blackjack, log, { until: seq });
      expect(detail.replayed).toBe(true);
      expect(detail.seq).toBe(seq);
      expect(detail.rev).toBe(fresh.rev);
      expect(detail.state).toEqual(fresh.state);
      expect(detail.engine).toEqual(fresh.engine);
      expect(detail.meta).toEqual(fresh.meta());
      expect(detail.diagnostics).toEqual([]);
      for (const seat of fresh.seats()) {
        if (!seat.player) continue;
        const viewer = fresh.viewerFor(seat.player.id);
        expect(viewOf(detail, `seat:${String(viewer.seat)}`)).toEqual(fresh.view(viewer));
      }
      expect(viewOf(detail, 'spectator')).toEqual(fresh.view(fresh.viewerFor(null)));
      // Cached: the same answer again.
      expect(await dev.request('table.at', { table, seq })).toEqual(detail);
    }
    expect(runtime.rev).toBe(rev);
  });

  it('reads the full log from the store after a restart, when the runtime holds only the tail', async () => {
    const { store } = spyStore();
    const first = await start({ store, snapshotEvery: 2 });
    const { table, clients } = await seated(first.gameUrl, 'tic-tac-toe', ['Alice', 'Bob']);
    await clients[0]!.ok('act', { table, name: 'place', input: { cell: 0 } });
    await clients[1]!.ok('act', { table, name: 'place', input: { cell: 1 } });
    await clients[0]!.ok('act', { table, name: 'place', input: { cell: 2 } });
    const full = JSON.parse(JSON.stringify(first.server.tables.runtime(table)!.log)) as LogEntry[];
    for (const c of clients) c.close();
    await first.server.close();

    const second = await start({ store, snapshotEvery: 2 });
    await second.server.ready;
    const runtime = second.server.tables.runtime(table)!;
    expect(runtime.log[0]?.seq).not.toBe(0);
    const dev = await Dev.connect(second.devUrl);
    const detail = await dev.request('table.at', { table, seq: 3 });
    const fresh = await TableRuntime.replay(ticTacToe, full, { until: 3 });
    expect(detail.state).toEqual(fresh.state);
    const log = await dev.request('table.log', { table, from: 0 });
    expect(log.entries.slice(0, full.length)).toEqual(full);
  });
});

describe('fork (table.fork)', () => {
  it('creates a playable dev table, hidden from the lobby, never stored', async () => {
    const { devUrl, gameUrl, server, written, store } = await start();
    const dev = await Dev.connect(devUrl);
    const { table, clients } = await seated(gameUrl, 'tic-tac-toe', ['Alice', 'Bob']);
    const [alice, bob] = clients as [TestClient, TestClient];
    await alice.ok('act', { table, name: 'place', input: { cell: 0 } });
    await bob.ok('act', { table, name: 'place', input: { cell: 4 } });
    const live = server.tables.runtime(table)!;
    await live.idle();
    const liveRev = live.rev;
    await alice.ok('lobby.sub');
    await alice.until(() => alice.lobby !== null, 'lobby');

    const seq = liveRev - 1; // before Bob's move
    const { table: fork } = await dev.request('table.fork', { table, seq });
    expect(fork).toMatch(/^dev_[a-z0-9]+$/);
    const forked = server.tables.runtime(fork)!;
    await forked.idle();
    expect(forked.id).toBe(fork);
    expect(forked.log[0]).toMatchObject({ kind: 'create', table: fork });

    const { tables } = await dev.request('tables.list');
    expect(tables.find((t) => t.id === fork)?.dev).toBe(true);
    expect(tables.find((t) => t.id === table)?.dev).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(alice.lobby!.doc.tables.map((t) => t.id)).toEqual([table]);

    // The original players join the fork from their normal clients and play on.
    await alice.ok('table.join', { table: fork });
    await bob.ok('table.join', { table: fork });
    await bob.ok('act', { table: fork, name: 'place', input: { cell: 8 } });
    await synced(bob, server, fork);
    expect((bob.doc(fork).view as { board: unknown[] }).board[8]).toBe('O');
    expect((bob.doc(fork).view as { board: unknown[] }).board[4]).toBeNull();
    // The live table did not move.
    expect(live.rev).toBe(liveRev);
    expect((live.state as { board: unknown[] }).board[4]).toBe('O');

    // Nothing about the fork reached the store.
    expect(written.has(fork)).toBe(false);
    expect(await store.readLog(fork, 0)).toEqual([]);
    expect(await store.listOpenTables()).not.toContain(fork);
    // Its log is served from memory, and time travel works on it.
    const log = await dev.request('table.log', { table: fork, from: 0 });
    expect(log.entries).toHaveLength(forked.rev + 1);
    const at = await dev.request('table.at', { table: fork, seq });
    expect(at.state).toEqual((await dev.request('table.at', { table, seq })).state);

    await server.tables.close(fork);
    expect(written.has(fork)).toBe(false);
  });

  it('uses a fresh MemoryWallet, never the real one', async () => {
    const { devUrl, gameUrl, server, wallet } = await start();
    const dev = await Dev.connect(devUrl);
    const { table, clients } = await seated(gameUrl, 'blackjack', ['Alice']);
    const [alice] = clients as [TestClient];
    const id = alice.welcome!.player.id;
    await server.tables.runtime(table)!.idle();
    const { table: fork } = await dev.request('table.fork', { table });
    await alice.ok('table.join', { table: fork });
    await alice.ok('act', { table: fork, name: 'bet', input: { amount: 100 } });
    await server.tables.runtime(fork)!.idle();
    expect(await wallet.balance(id)).toBe(1000);
    const state = server.tables.runtime(fork)!.state as { hands: ({ bet: number } | null)[] };
    expect(state.hands[0]?.bet).toBe(100);
  });
});

describe('export (table.export)', () => {
  it('anonymizes ids and names, logs at warn, and the fixture replays to expect', async () => {
    const { devUrl, gameUrl, server, log } = await start();
    const dev = await Dev.connect(devUrl);
    const { table, clients } = await seated(gameUrl, 'blackjack', ['Alice', 'Bob']);
    const [alice, bob] = clients as [TestClient, TestClient];
    await alice.ok('player.rename', { name: 'Alicia' });
    await alice.ok('act', { table, name: 'bet', input: { amount: 30 } });
    await alice.ok('act', { table, name: 'stand' }).catch(() => undefined);
    const runtime = server.tables.runtime(table)!;
    await runtime.idle();

    const { fixture, warning } = await dev.request('table.export', { table });
    expect(warning).toMatch(/production table reveals that table's cards/);
    expect(fixture).toMatchObject({ shoehiveFixture: 1, game: 'blackjack', version: 1 });
    expect(fixture.entries).toHaveLength(runtime.rev + 1);
    expect(fixture.entries[0]).toMatchObject({ kind: 'create', seed: runtime.engine.seed });
    const text = JSON.stringify(fixture);
    for (const secret of [
      alice.welcome!.player.id,
      bob.welcome!.player.id,
      'Alice',
      'Alicia',
      'Bob',
    ])
      expect(text).not.toContain(secret);
    const sits = fixture.entries.filter((e) => e.kind === 'system' && e.event === 'sit');
    expect(sits.map((e) => (e as { player: unknown }).player)).toEqual([
      { id: 'p0', name: 'p0' },
      { id: 'p1', name: 'p1' },
    ]);
    const rename = fixture.entries.find((e) => e.kind === 'system' && e.event === 'rename');
    expect(rename).toMatchObject({ player: { id: 'p0', name: 'p0 (2)' } });
    expect(fixture.entries.filter((e) => e.kind === 'action').map((e) => e.player)).toContain('p0');

    // The fixture replays to expect, with TableRuntime directly and with replayFixture.
    const replayed = await TableRuntime.replay(blackjack, fixture.entries);
    expect(replayed.rev).toBe(fixture.expect!.rev);
    expect(fixtureStateHash(replayed.state)).toBe(fixture.expect!.stateHash);
    expect(fixture.expect!.rev).toBe(runtime.rev);
    const t = await replayFixture(blackjack, fixture);
    expect(t.state).toEqual(replayed.state);

    const line = log.lines.find((l) => l.message === 'Devtools exported a fixture');
    expect(line?.level).toBe('warn');
    expect(line?.data).toMatchObject({ remote: '127.0.0.1', table });

    // An earlier seq.
    const early = await dev.request('table.export', { table, seq: 2 });
    expect(early.fixture.entries).toHaveLength(3);
    expect(early.fixture.expect!.rev).toBe(2);
  });

  it('keeps a log replayable when the game stores player ids in state and inputs', async () => {
    const { devUrl, gameUrl, server } = await start();
    const dev = await Dev.connect(devUrl);
    const { table, clients } = await seated(gameUrl, 'roster', ['Alice', 'Bob']);
    const [alice, bob] = clients as [TestClient, TestClient];
    await alice.ok('act', { table, name: 'pick', input: { player: bob.welcome!.player.id } });
    await server.tables.runtime(table)!.idle();

    const { fixture } = await dev.request('table.export', { table });
    expect(JSON.stringify(fixture)).not.toContain(bob.welcome!.player.id);
    const replayed = await TableRuntime.replay(roster, fixture.entries);
    expect(replayed.state).toEqual({ players: ['p0', 'p1'], picked: 'p1' });
    expect(fixtureStateHash(replayed.state)).toBe(fixture.expect!.stateHash);
    await replayFixture(roster, fixture);
  });
});

describe('pushes', () => {
  it('table.watch pushes throttled updates that end at the latest state', async () => {
    const { devUrl, gameUrl, server } = await start();
    const dev = await Dev.connect(devUrl);
    const { table, clients } = await seated(gameUrl, 'tic-tac-toe', ['Alice', 'Bob']);
    const [alice, bob] = clients as [TestClient, TestClient];
    await server.tables.runtime(table)!.idle();
    await dev.request('table.watch', { table });
    const moves: [TestClient, number][] = [
      [alice, 0],
      [bob, 3],
      [alice, 1],
      [bob, 4],
    ];
    for (const [client, cell] of moves)
      await client.ok('act', { table, name: 'place', input: { cell } });
    const runtime = server.tables.runtime(table)!;
    await runtime.idle();
    const updates = () =>
      dev.pushes.filter(
        (m): m is Extract<DevServerMessage, { t: 'table.update' }> => m.t === 'table.update',
      );
    await dev.until(() => updates().at(-1)?.detail.rev === runtime.rev, 'latest update');
    expect(updates().length).toBeLessThan(moves.length);
    const last = updates().at(-1)!.detail;
    expect(last.state).toEqual(runtime.state);
    expect(viewOf(last, 'seat:0')).toEqual(
      (await synced(alice, server, table), alice.doc(table).view),
    );

    await dev.request('table.unwatch', { table });
    const count = updates().length;
    await alice.ok('act', { table, name: 'place', input: { cell: 2 } });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(updates()).toHaveLength(count);
  });

  it('tables.watch pushes on create, seat changes and close; table.closed for watched tables', async () => {
    const { devUrl, gameUrl, server } = await start();
    const dev = await Dev.connect(devUrl);
    const { tables } = await dev.request('tables.watch');
    expect(tables).toEqual([]);
    const lists = () => dev.pushes.flatMap((m) => (m.t === 'tables' ? [m.tables] : []));
    const alice = await player(gameUrl, 'Alice');
    const { table } = (await alice.ok('table.create', { game: 'tic-tac-toe' })) as {
      table: string;
    };
    await dev.until(() => lists().at(-1)?.[0]?.id === table, 'created');
    await alice.ok('table.join', { table });
    await alice.ok('seat.take', { table });
    await dev.until(() => lists().at(-1)?.[0]?.seats.taken === 1, 'seat taken');

    await dev.request('table.watch', { table });
    await server.tables.close(table);
    await dev.until(() => dev.pushes.some((m) => m.t === 'table.closed'), 'table.closed');
    expect(dev.pushes.find((m) => m.t === 'table.closed')).toEqual({
      t: 'table.closed',
      table,
      reason: 'closed',
    });
    await dev.until(() => lists().at(-1)?.length === 0, 'removed');

    await dev.request('tables.unwatch');
    const count = lists().length;
    await alice.ok('table.create', { game: 'tic-tac-toe' });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(lists()).toHaveLength(count);
  });
});
