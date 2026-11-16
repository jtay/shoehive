// The per-table viewer index and the lobby shortcut added for the Phase 8 load test
// (docs/reference/benchmarks.md, "Load test"): patches, events and spectator counts reach
// exactly the connections joined to a table, and the lobby stays what a full rebuild
// would give while skipping the rebuild for commits that do not change it.

import { afterEach, describe, expect, it } from 'vitest';
import { ticTacToe } from '../../../../examples/tic-tac-toe/src/game';
import type { LobbyDocument } from '../../src/protocol/messages';
import { createServer, silentLogger, type ShoehiveServer } from '../../src/server/index';
import { SECRET, TestClient } from './client';

let servers: ShoehiveServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close({ graceful: false })));
  servers = [];
});

function start(): ShoehiveServer {
  const server = createServer({ games: [ticTacToe], secret: SECRET, logger: silentLogger });
  servers.push(server);
  return server;
}

async function client(server: ShoehiveServer): Promise<TestClient> {
  const c = TestClient.memory(server);
  await c.hello();
  return c;
}

const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const tableMessages = (c: TestClient, table: string) =>
  c.received.filter((m) => 'table' in m && m.table === table);

/** What a new lobby subscriber is sent: the server's full, current lobby. */
async function freshLobby(server: ShoehiveServer): Promise<LobbyDocument> {
  const c = await client(server);
  await c.ok('lobby.sub');
  await c.until(() => c.lobby !== null, 'lobby snapshot');
  const doc = c.lobby!.doc;
  c.close();
  return doc;
}

describe('per-table fan-out', () => {
  it('sends patches and events only to the connections joined to that table', async () => {
    const server = start();
    const [a, b, d, e, watcher] = await Promise.all(
      Array.from({ length: 5 }, () => client(server)),
    );
    const one = (await a!.ok('table.create', { game: 'tic-tac-toe' })) as { table: string };
    const two = (await d!.ok('table.create', { game: 'tic-tac-toe' })) as { table: string };
    for (const c of [a!, b!]) {
      await c.ok('table.join', { table: one.table });
      await c.ok('seat.take', { table: one.table });
    }
    for (const c of [d!, e!]) {
      await c.ok('table.join', { table: two.table });
      await c.ok('seat.take', { table: two.table });
    }
    await watcher!.ok('table.join', { table: one.table, as: 'spectator' });
    await a!.until(() => a!.doc(one.table).meta.status === 'active', 'table one started');
    await a!.until(() => a!.doc(one.table).spectators === 1, 'spectator counted');
    expect(d!.doc(two.table).spectators).toBe(0);

    const before = [d!, e!].map((c) => c.received.length);
    await a!.ok('act', { table: one.table, name: 'place', input: { cell: 4 } });
    await watcher!.until(() => watcher!.doc(one.table).view !== null, 'watcher');
    await b!.until(
      () => (b!.doc(one.table).view as { board: unknown[] }).board[4] === 'X',
      'patch reached the other seat',
    );
    expect((watcher!.doc(one.table).view as { board: unknown[] }).board[4]).toBe('X');
    await tick();
    // Nothing about table one reached the connections of table two.
    for (const [i, c] of [d!, e!].entries()) {
      expect(c.received.slice(before[i]).filter((m) => 'table' in m)).toEqual([]);
      expect(tableMessages(c, one.table)).toEqual([]);
    }
    expect(server.tables.get(one.table)!.connected.sort()).toEqual(
      [a!, b!, watcher!].map((c) => c.welcome!.player.id).sort(),
    );

    // A closed connection stops counting as a viewer and a spectator.
    watcher!.close();
    await a!.until(() => a!.doc(one.table).spectators === 0, 'spectator gone');
    expect(server.tables.get(one.table)!.connected).not.toContain(watcher!.welcome!.player.id);
  });

  it('forgets the viewers of a closed table', async () => {
    const server = start();
    const a = await client(server);
    const { table } = (await a.ok('table.create', { game: 'tic-tac-toe' })) as { table: string };
    await a.ok('table.join', { table, as: 'spectator' });
    await a.until(() => a.tables.has(table), 'snapshot');
    await server.tables.close(table);
    await a.until(() => a.received.some((m) => m.t === 'table.closed'), 'closed');
    expect(a.tables.has(table)).toBe(false);
    // The closed table's viewer stays usable elsewhere and is counted only there.
    const next = await server.tables.create('tic-tac-toe');
    const late = await client(server);
    for (const c of [a, late]) {
      await c.ok('table.join', { table: next.id, as: 'spectator' });
      await c.until(() => c.tables.has(next.id), 'snapshot');
    }
    await late.until(() => late.doc(next.id).spectators === 2, 'both counted');
    expect(server.tables.get(next.id)!.connected).toHaveLength(2);
    expect(await a.request('table.sync', { table })).toMatchObject({
      ok: false,
      error: { code: 'NOT_JOINED' },
    });
  });
});

describe('lobby sync', () => {
  it('stays equal to a full rebuild, and skips patches for commits that change nothing in it', async () => {
    const server = start();
    const lobby = await client(server);
    await lobby.ok('lobby.sub');
    await lobby.until(() => lobby.lobby !== null, 'lobby snapshot');
    const [a, b, watcher] = await Promise.all([client(server), client(server), client(server)]);
    const { table } = (await a.ok('table.create', { game: 'tic-tac-toe' })) as { table: string };
    for (const c of [a, b]) {
      await c.ok('table.join', { table });
      await c.ok('seat.take', { table });
    }
    await watcher.ok('table.join', { table, as: 'spectator' });
    await lobby.until(
      () =>
        lobby.lobby!.doc.tables[0]?.spectators === 1 &&
        lobby.lobby!.doc.tables[0].status === 'active',
      'lobby shows the started table and its spectator',
    );
    expect(lobby.lobby!.doc.tables[0]!.seats).toEqual({ taken: 2, total: 2 });
    expect(await freshLobby(server)).toEqual(lobby.lobby!.doc);

    // Moves change nothing the lobby lists: no lobby patches, until the game ends.
    const patches = () => lobby.received.filter((m) => m.t === 'lobby.patch').length;
    await tick();
    const quiet = patches();
    await a.ok('act', { table, name: 'place', input: { cell: 0 } });
    await b.ok('act', { table, name: 'place', input: { cell: 3 } });
    await a.ok('act', { table, name: 'place', input: { cell: 1 } });
    await b.ok('act', { table, name: 'place', input: { cell: 4 } });
    await tick();
    expect(patches()).toBe(quiet);
    await a.ok('act', { table, name: 'place', input: { cell: 2 } }); // X wins: status ended
    await lobby.until(() => lobby.lobby!.doc.tables[0]?.status === 'ended', 'lobby shows the end');
    expect(patches()).toBe(quiet + 1);
    expect(lobby.gaps).toBe(0);
    expect(await freshLobby(server)).toEqual(lobby.lobby!.doc);
  });
});
