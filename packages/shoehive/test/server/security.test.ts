// Regression tests for the 1.0 network security review (docs/security/review-1.0-network.md).
// Each test names the finding it covers.

import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { ticTacToe } from '../../../../examples/tic-tac-toe/src/game';
import { defineGame } from '../../src/core/define';
import { parseClientMessage } from '../../src/protocol/messages';
import {
  createServer,
  memoryStore,
  silentLogger,
  type Logger,
  type ServerOptions,
  type ShoehiveServer,
} from '../../src/server/index';
import { FakeClock } from '../../src/testing/index';
import { SECRET, TestClient } from './client';

let servers: ShoehiveServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close({ graceful: false })));
  servers = [];
});

function start(options: Partial<ServerOptions> = {}): ShoehiveServer {
  const server = createServer({
    games: [ticTacToe, fragile, bulky],
    secret: SECRET,
    logger: silentLogger,
    ...options,
  });
  servers.push(server);
  return server;
}

const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A game whose view() throws for seat 0 once `break` ran: a common kind of game bug. */
const fragile = defineGame({
  id: 'fragile',
  seats: { min: 1, max: 2 },
  setup: () => ({ broken: false, moves: 0 }),
  actions: {
    break: {
      run({ state }) {
        state.broken = true;
      },
    },
    move: {
      run({ state }) {
        state.moves += 1;
      },
    },
  },
  view: ({ state, viewer }) => {
    if (state.broken && viewer.seat === 0) throw new Error('view bug');
    return { moves: state.moves };
  },
});

/** A game with a large view, to fill a send buffer quickly. */
const bulky = defineGame({
  id: 'bulky',
  seats: { min: 1, max: 1 },
  setup: () => ({ blob: 'x'.repeat(512 * 1024) }),
  actions: { noop: { run: () => undefined } },
});

/** Collects unhandled rejections and uncaught exceptions while `run` executes. */
async function crashes(run: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const record = (error: unknown): void => {
    seen.push(error);
  };
  process.on('unhandledRejection', record);
  process.on('uncaughtException', record);
  try {
    await run();
    await tick(50);
  } finally {
    process.off('unhandledRejection', record);
    process.off('uncaughtException', record);
  }
  return seen;
}

describe('N-01: a view() that throws', () => {
  it('costs only that viewer its update: no crash, and the action still succeeds', async () => {
    const errors: string[] = [];
    const logger: Logger = { ...silentLogger, error: (message) => errors.push(message) };
    const server = start({ logger });
    const a = TestClient.memory(server);
    const b = TestClient.memory(server);
    await a.hello();
    await b.hello();
    const { table } = (await a.ok('table.create', { game: 'fragile' })) as { table: string };
    for (const c of [a, b]) {
      await c.ok('table.join', { table });
      await c.ok('seat.take', { table });
    }
    const seen = await crashes(async () => {
      // The commit happened, so the actor must not be told INTERNAL (it would retry).
      expect(await a.request('act', { table, name: 'break' })).toMatchObject({ ok: true });
      // A snapshot after the ack used to reject outside any handler.
      expect(await a.request('table.sync', { table })).toMatchObject({ ok: true });
      expect(await b.request('table.join', { table })).toMatchObject({ ok: true });
      await b.ok('act', { table, name: 'move' });
      await b.until(() => (b.doc(table).view as { moves: number }).moves === 1, 'b updated');
      // Closing the socket syncs the table from the transport's close handler.
      a.close();
      await tick();
    });
    expect(seen).toEqual([]);
    expect(errors).toContain('Could not build a table document (view() threw)');
  });
});

describe('N-02: a client that stops reading', () => {
  it('is dropped once its send buffer passes maxBufferedBytes', async () => {
    const server = start({
      limits: { maxBufferedBytes: 2 * 1024 * 1024, burst: 60, messagesPerSecond: 60 },
    });
    const { url } = await server.listen();
    const disconnected = new Promise<void>((resolve) => {
      server.on('player:disconnected', () => {
        resolve();
      });
    });
    const ws = new WebSocket(url, 'shoehive.v1');
    const replies = new Map<string, (data: Record<string, unknown>) => void>();
    ws.on('message', (data: Buffer) => {
      const message = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
      if (message['t'] === 'ack') replies.get(message['id'] as string)?.(message);
    });
    await new Promise((resolve) => ws.once('open', resolve));
    const request = (id: string, fields: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((resolve) => {
        replies.set(id, resolve);
        ws.send(JSON.stringify({ id, ...fields }));
      });
    await request('1', { t: 'hello', v: 1 });
    const created = await request('2', { t: 'table.create', game: 'bulky' });
    const table = (created['result'] as { table: string }).table;
    await request('3', { t: 'table.join', table });
    // Stop reading, then ask for 50 snapshots of half a megabyte each (25 MB).
    (ws as unknown as { _socket: { pause(): void } })._socket.pause();
    for (let i = 0; i < 50; i++)
      ws.send(JSON.stringify({ t: 'table.sync', id: `s${String(i)}`, table }));
    await Promise.race([
      disconnected,
      tick(5000).then(() => {
        throw new Error('the connection was not dropped');
      }),
    ]);
    expect(server.tables.get(table)?.connected).toEqual([]);
    ws.terminate();
  }, 10_000);
});

describe('N-03: table creation limits', () => {
  it('refuses table.create past maxTablesPerPlayer, counting open tables only', async () => {
    const server = start({ limits: { maxTablesPerPlayer: 3 } });
    const a = TestClient.memory(server);
    await a.hello();
    const made: string[] = [];
    for (let i = 0; i < 3; i++) {
      made.push(((await a.ok('table.create', { game: 'tic-tac-toe' })) as { table: string }).table);
    }
    expect(await a.request('table.create', { game: 'tic-tac-toe' })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', details: { limit: 3 } },
    });
    // Concurrent requests cannot slip past the limit either.
    const b = TestClient.memory(server);
    await b.hello();
    const acks = await Promise.all(
      Array.from({ length: 6 }, () => b.request('table.create', { game: 'tic-tac-toe' })),
    );
    expect(acks.filter((ack) => ack.ok)).toHaveLength(3);
    // Another player is not affected, nor is the server API; closing frees a slot.
    await server.tables.create('tic-tac-toe');
    await server.tables.close(made[0]!);
    expect(await a.request('table.create', { game: 'tic-tac-toe' })).toMatchObject({ ok: true });
  });

  it('refuses table.create from clients once the server holds maxTables', async () => {
    const server = start({ limits: { maxTables: 2 } });
    await server.tables.create('tic-tac-toe');
    const a = TestClient.memory(server);
    await a.hello();
    expect(await a.request('table.create', { game: 'tic-tac-toe' })).toMatchObject({ ok: true });
    expect(await a.request('table.create', { game: 'tic-tac-toe' })).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN', details: { limit: 2 } },
    });
  });
});

describe('N-04: guest session records', () => {
  it('are deleted when the session expires, and a resume still restores the guest', async () => {
    const clock = new FakeClock();
    const store = memoryStore();
    const server = start({ clock, store, reconnectGraceMs: 1000 });
    const a = TestClient.memory(server);
    const welcome = await a.hello({ name: 'Ada' });
    const renamed = (await a.ok('player.rename', { name: 'Ada L.' })) as {
      name: string;
      resumeToken: string;
    };
    expect(typeof renamed.resumeToken).toBe('string');
    a.close();
    await tick();
    expect(await store.sessions.get(welcome.player.id)).not.toBeNull();
    await clock.advance(2001); // past the 2 x grace session cleanup
    await tick();
    expect(await store.sessions.get(welcome.player.id)).toBeNull();
    // The renamed name survives in the token issued by the rename.
    const again = TestClient.memory(server);
    const resumed = await again.hello({ resume: renamed.resumeToken });
    expect(resumed.player).toMatchObject({ id: welcome.player.id, name: 'Ada L.' });
  });
});

describe('N-05: cross-site WebSocket hijacking', () => {
  it('warns when an auth hook is set without an origin allowlist', () => {
    const warnings: string[] = [];
    const logger: Logger = { ...silentLogger, warn: (message) => warnings.push(message) };
    const auth = () => ({ id: 'u1', name: 'User' });
    start({ logger, auth });
    expect(warnings.some((w) => w.includes('`origins` is empty'))).toBe(true);
    warnings.length = 0;
    start({ logger, auth, origins: ['https://game.example'] });
    expect(warnings.some((w) => w.includes('`origins` is empty'))).toBe(false);
  });
});

describe('N-06: a second hello on the same connection', () => {
  it('is refused even while the first is still being handled', async () => {
    const server = start();
    const first = TestClient.memory(server);
    const { resumeToken } = await first.hello();
    first.close();
    const c = TestClient.memory(server);
    // The first hello awaits the store (resume), so both used to pass the "already
    // sent" check and bind the connection to two players.
    const [x, y] = await Promise.all([
      c.request('hello', { v: 1, resume: resumeToken }),
      c.request('hello', { v: 1 }),
    ]);
    expect([x.ok, y.ok].sort()).toEqual([false, true]);
    expect(x.ok ? y : x).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });
});

describe('N-07: payload validation', () => {
  const act = (input: string): string =>
    `{"t":"act","id":"1","table":"t","name":"place","input":${input}}`;

  it('refuses non-finite numbers and deep nesting in input and options', () => {
    expect(parseClientMessage(act('{"cell":1e400}'))).toMatchObject({ ok: false, id: '1' });
    expect(parseClientMessage(act('[-1e999]'))).toMatchObject({ ok: false });
    expect(parseClientMessage(act(`${'['.repeat(33)}${']'.repeat(33)}`))).toMatchObject({
      ok: false,
    });
    expect(parseClientMessage(act(`${'['.repeat(32)}${']'.repeat(32)}`))).toMatchObject({
      ok: true,
    });
    expect(
      parseClientMessage(`{"t":"table.create","id":"2","game":"g","options":{"n":1e400}}`),
    ).toMatchObject({ ok: false, id: '2' });
    const deep = `${'{"a":'.repeat(30_000)}1${'}'.repeat(30_000)}`;
    expect(parseClientMessage(act(deep))).toMatchObject({ ok: false });
  });

  it('answers BAD_REQUEST, not INTERNAL, over the wire', async () => {
    const server = start({ dev: false });
    const a = TestClient.memory(server);
    await a.hello();
    a.sendRaw(act('{"cell":1e400}').replace('"id":"1"', '"id":"raw"'));
    await a.until(() => a.received.some((m) => m.t === 'ack' && m.id === 'raw'), 'ack');
    expect(a.received.find((m) => m.t === 'ack' && m.id === 'raw')).toMatchObject({
      ok: false,
      error: { code: 'BAD_REQUEST' },
    });
  });
});

describe('the parsers reject input without throwing', () => {
  it('handles hostile shapes', () => {
    for (const raw of [
      'null',
      '1',
      '"x"',
      '[]',
      '{"t":1}',
      '{"t":"act","id":{}}',
      '{"__proto__":{"t":"hello"}}',
    ]) {
      expect(() => parseClientMessage(raw)).not.toThrow();
      expect(parseClientMessage(raw).ok).toBe(false);
    }
    expect(({} as Record<string, unknown>)['t']).toBeUndefined();
  });

  it('keeps an input schema in charge of what reaches game code', async () => {
    const server = start();
    const a = TestClient.memory(server);
    const b = TestClient.memory(server);
    await a.hello();
    await b.hello();
    const { table } = (await a.ok('table.create', { game: 'tic-tac-toe' })) as { table: string };
    for (const c of [a, b]) {
      await c.ok('table.join', { table });
      await c.ok('seat.take', { table });
    }
    await a.until(() => a.doc(table).meta.status === 'active', 'start');
    const ack = await a.request('act', {
      table,
      name: 'place',
      input: JSON.parse('{"cell":0,"__proto__":{"admin":true}}') as unknown,
    });
    expect(ack.ok).toBe(true);
    expect(({} as Record<string, unknown>)['admin']).toBeUndefined();
  });
});
