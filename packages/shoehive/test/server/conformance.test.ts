// Protocol conformance (docs/reference/protocol.md), run over both transports: the
// in-memory one and real WebSockets. No mocked sockets.

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ticTacToe } from '../../../../examples/tic-tac-toe/src/game';
import { defineGame } from '../../src/core/define';
import { reject } from '../../src/core/errors';
import {
  createServer,
  silentLogger,
  type ServerOptions,
  type ShoehiveServer,
} from '../../src/server/index';
import { FakeClock } from '../../src/testing/index';
import { SECRET, TestClient } from './client';

const secretive = defineGame({
  id: 'secretive',
  seats: { min: 2, max: 2 },
  setup: ({ random }) => ({ cards: [random.int(1000), random.int(1000)] }),
  actions: {
    peek: {
      run({ seat, ctx }) {
        ctx.emit('peeked', { seat }, { to: [seat] });
        ctx.emit('public', { seat });
      },
    },
    fail: {
      run() {
        reject('NOPE', { why: 'testing' });
      },
    },
    count: {
      input: z.object({ by: z.number().int() }),
      run({ input }) {
        return { doubled: input.by * 2 };
      },
    },
  },
  view: ({ state, viewer }) => ({
    mine: viewer.seat === null ? null : state.cards[viewer.seat]!,
    count: state.cards.length,
  }),
});

const transports = ['memory', 'ws'] as const;
type Transport = (typeof transports)[number];

let servers: ShoehiveServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close({ graceful: false })));
  servers = [];
});

async function setup(transport: Transport, options: Partial<ServerOptions> = {}) {
  const clock = options.clock ?? new FakeClock();
  const server = createServer({
    games: [ticTacToe, secretive],
    secret: SECRET,
    logger: silentLogger,
    clock,
    ...options,
  });
  servers.push(server);
  let url = '';
  if (transport === 'ws') url = (await server.listen()).url;
  const client = (headers: Record<string, string> = {}): TestClient =>
    transport === 'ws' ? TestClient.ws(url, { headers }) : TestClient.memory(server, headers);
  return { server, client, clock, url };
}

async function twoPlayers(transport: Transport, game = 'tic-tac-toe') {
  const ctx = await setup(transport);
  const a = ctx.client();
  const b = ctx.client();
  await a.hello({ name: 'Ada' });
  await b.hello({ name: 'Bob' });
  const { table } = (await a.ok('table.create', { game })) as { table: string };
  for (const c of [a, b]) {
    await c.ok('table.join', { table });
    await c.ok('seat.take', { table });
  }
  await a.until(() => a.doc(table).meta.status === 'active', 'table start');
  await b.until(() => b.doc(table).meta.status === 'active', 'table start');
  return { ...ctx, a, b, table };
}

describe.each(transports)('protocol conformance over %s', (transport) => {
  it('handshake: welcome for a guest, resume token, protocol checks', async () => {
    const { client } = await setup(transport);
    const c = client();
    const before = await c.request('lobby.sub');
    expect(before).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
    const welcome = await c.hello({ name: 'Ada' });
    expect(welcome.player).toMatchObject({ name: 'Ada', guest: true });
    expect(welcome.player.id).toMatch(/^g_/);
    expect(welcome.resumeToken).toMatch(/^v1\./);
    expect(welcome).toMatchObject({ resumed: false, server: { protocol: 1 } });
    expect(await c.request('hello', { v: 1 })).toMatchObject({
      ok: false,
      error: { code: 'BAD_REQUEST' },
    });

    const old = client();
    expect(await old.request('hello', { v: 2 })).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_PROTOCOL', details: { supported: [1] } },
    });
    await old.until(() => old.closed !== null, 'close');
    expect(old.closed?.code).toBe(4001);
  });

  it('lobby: snapshot, then a patch when a table is created', async () => {
    const { client } = await setup(transport);
    const c = client();
    await c.hello();
    await c.ok('lobby.sub');
    await c.until(() => c.lobby !== null, 'lobby snapshot');
    expect(c.lobby!.doc.games.map((g) => g.id)).toEqual(['tic-tac-toe', 'secretive']);
    expect(c.lobby!.doc.tables).toEqual([]);
    const { table } = (await c.ok('table.create', { game: 'tic-tac-toe' })) as { table: string };
    await c.until(() => c.lobby!.doc.tables.length === 1, 'lobby patch');
    expect(c.lobby!.doc.tables[0]).toMatchObject({
      id: table,
      game: 'tic-tac-toe',
      status: 'waiting',
      seats: { taken: 0, total: 2 },
    });
    expect(c.gaps).toBe(0);
  });

  it('plays a game: patches keep every document equal to the server view, acks come after patches', async () => {
    const { a, b, table, server } = await twoPlayers(transport);
    const runtime = server.tables.runtime(table)!;
    expect(a.doc(table).you).toEqual({ player: a.welcome!.player.id, seats: [0], role: 'player' });
    expect(a.doc(table).meta.turn?.seat).toBe(0);

    const ack = await a.request('act', { table, name: 'place', input: { cell: 4 } });
    expect(ack).toMatchObject({ ok: true, result: { rev: runtime.rev } });
    // The patch for this action arrived before its ack.
    expect(a.tables.get(table)!.rev).toBe(runtime.rev);
    expect(a.doc(table).view).toEqual(runtime.view(runtime.viewerFor(a.welcome!.player.id)));
    await b.until(() => b.tables.get(table)!.rev === runtime.rev, 'patch on b');
    expect(b.doc(table).view).toEqual(a.doc(table).view);
    expect(b.doc(table).meta.turn?.seat).toBe(1);
    expect(a.gaps + b.gaps).toBe(0);
  });

  it('reports errors with codes and sources', async () => {
    const { a, b, table } = await twoPlayers(transport, 'secretive');
    expect(await a.request('act', { table, name: 'fail' })).toMatchObject({
      ok: false,
      error: { code: 'NOPE', source: 'game', details: { why: 'testing' } },
    });
    expect(await a.request('act', { table, name: 'count', input: { by: 'x' } })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT', source: 'shoehive' },
    });
    expect(await a.request('act', { table, name: 'count', input: { by: 2 } })).toMatchObject({
      ok: true,
      result: { value: { doubled: 4 } },
    });
    expect(await a.request('act', { table: 'nope', name: 'peek' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', details: { kind: 'table' } },
    });
    expect(await a.request('table.create', { game: 'nope' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', details: { kind: 'game' } },
    });
    expect(await a.request('seat.take', { table })).toMatchObject({
      ok: false,
      error: { code: 'ALREADY_SEATED' },
    });
    await b.ok('table.leave', { table });
    expect(await b.request('act', { table, name: 'peek' })).toMatchObject({
      ok: false,
      error: { code: 'NOT_JOINED' },
    });
    expect(await a.request('nonsense', {})).toMatchObject({
      ok: false,
      error: { code: 'BAD_REQUEST' },
    });
  });

  it('sends each viewer only their view, and events only to their audience', async () => {
    const { a, b, table, client, server } = await twoPlayers(transport, 'secretive');
    const state = server.tables.runtime(table)!.state as { cards: number[] };
    expect(a.doc(table).view).toEqual({ mine: state.cards[0], count: 2 });
    expect(b.doc(table).view).toEqual({ mine: state.cards[1], count: 2 });
    const watcher = client();
    await watcher.hello();
    await watcher.ok('table.join', { table, as: 'spectator' });
    await watcher.until(() => watcher.tables.has(table), 'spectator snapshot');
    expect(watcher.doc(table).view).toEqual({ mine: null, count: 2 });
    expect(watcher.doc(table).you.role).toBe('spectator');
    await a.until(() => a.doc(table).spectators === 1, 'spectator count');
    for (const c of [a, b, watcher]) expect(JSON.stringify(c.received)).not.toContain('"cards"');

    await a.ok('act', { table, name: 'peek' });
    await watcher.until(
      () => watcher.received.some((m) => m.t === 'table.event' && m.name === 'public'),
      'public event',
    );
    const names = (c: TestClient) =>
      c.received.flatMap((m) => (m.t === 'table.event' ? [m.name] : []));
    expect(names(a)).toEqual(['peeked', 'public']);
    expect(names(b)).toEqual(['public']);
    expect(names(watcher)).toEqual(['public']);
  });

  it('rejects STALE_REVISION and lets a client resync with table.sync', async () => {
    const { a, table } = await twoPlayers(transport);
    const rev = a.tables.get(table)!.rev;
    expect(
      await a.request('act', { table, name: 'place', input: { cell: 0 }, rev: rev - 1 }),
    ).toMatchObject({
      ok: false,
      error: { code: 'STALE_REVISION', details: { rev } },
    });
    a.tables.delete(table);
    await a.ok('table.sync', { table });
    await a.until(() => a.tables.has(table), 'resync snapshot');
    expect(a.tables.get(table)!.rev).toBe(rev);
  });

  it('rate limits bursts with RATE_LIMITED', async () => {
    const { client } = await setup(transport, { limits: { burst: 5, messagesPerSecond: 1 } });
    const c = client();
    await c.hello();
    const acks = await Promise.all(Array.from({ length: 8 }, () => c.request('lobby.unsub')));
    const limited = acks.filter((ack) => !ack.ok);
    expect(limited.length).toBeGreaterThan(0);
    expect(limited[0]).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });

  it('closes on repeated protocol violations (4002), no hello (4000) and oversized messages (1009)', async () => {
    const { client, clock } = await setup(transport, { limits: { maxMessageBytes: 1024 } });
    const noisy = client();
    await noisy.open();
    for (let i = 0; i < 3; i++) noisy.sendRaw('not json');
    await noisy.until(() => noisy.closed !== null, 'violation close');
    expect(noisy.closed?.code).toBe(4002);

    const silent = client();
    await silent.open();
    await (clock as FakeClock).advance(10_000);
    await silent.until(() => silent.closed !== null, 'hello timeout');
    expect(silent.closed?.code).toBe(4000);

    const big = client();
    await big.hello();
    big.sendRaw(JSON.stringify({ t: 'lobby.sub', id: 'x', pad: 'x'.repeat(2000) }));
    await big.until(() => big.closed !== null, 'too big close');
    expect(big.closed?.code).toBe(1009);
  });

  it('answers ping with pong and the server time', async () => {
    const { client, clock } = await setup(transport);
    const c = client();
    await c.hello();
    c.sendRaw(JSON.stringify({ t: 'ping', id: 'p1' }));
    await c.until(() => c.received.some((m) => m.t === 'pong'), 'pong');
    expect(c.received.find((m) => m.t === 'pong')).toEqual({
      t: 'pong',
      id: 'p1',
      now: clock.now(),
    });
  });

  it('uses custom auth for identity and refuses unauthenticated upgrades', async () => {
    const { client } = await setup(transport, {
      auth: (req) =>
        req.headers['x-user'] === 'ada' ? { id: 'user-ada', name: 'Ada Lovelace' } : null,
    });
    const ada = client({ 'x-user': 'ada' });
    expect((await ada.hello()).player).toEqual({
      id: 'user-ada',
      name: 'Ada Lovelace',
      guest: false,
    });
    const stranger = client();
    await stranger.open().catch(() => undefined);
    await stranger.until(() => stranger.closed !== null, 'refusal');
    expect(transport === 'ws' ? stranger.closed?.code : stranger.closed?.reason).toBe(
      transport === 'ws' ? 401 : 'HTTP 401',
    );
  });
});

describe('WebSocket transport specifics', () => {
  it('refuses origins outside the allowlist with HTTP 403', async () => {
    const { url } = await setup('ws', { origins: ['https://game.example'] });
    const good = TestClient.ws(url, { headers: { origin: 'https://game.example' } });
    await good.hello();
    const bad = TestClient.ws(url, { headers: { origin: 'https://evil.example' } });
    await expect(bad.open()).rejects.toThrow('HTTP 403');
  });
});
