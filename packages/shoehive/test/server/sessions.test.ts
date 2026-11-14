// Reconnects (ADR 0010) and restart recovery (ADR 0009), over the in-memory transport
// with a fake clock. Phase 2 exit criteria: reconnect test and kill-and-restart test.

import { afterEach, describe, expect, it } from 'vitest';
import { quiz, QUESTION_MS } from '../../../../examples/quiz/src/game';
import { ticTacToe } from '../../../../examples/tic-tac-toe/src/game';
import { defineGame } from '../../src/core/define';
import {
  createServer,
  memoryStore,
  silentLogger,
  type ServerOptions,
  type ShoehiveServer,
  type Store,
} from '../../src/server/index';
import { FakeClock } from '../../src/testing/index';
import { SECRET, TestClient } from './client';

let servers: ShoehiveServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close({ graceful: false })));
  servers = [];
});

function start(options: Partial<ServerOptions> & { store: Store; clock: FakeClock }) {
  const server = createServer({
    games: [ticTacToe, quiz],
    secret: SECRET,
    logger: silentLogger,
    reconnectGraceMs: 30_000,
    ...options,
  });
  servers.push(server);
  return server;
}

async function seatedPair(server: ShoehiveServer, game = 'tic-tac-toe', options?: unknown) {
  const a = TestClient.memory(server);
  const b = TestClient.memory(server);
  await a.hello({ name: 'Ada' });
  await b.hello({ name: 'Bob' });
  const { table } = (await a.ok('table.create', {
    game,
    ...(options === undefined ? {} : { options }),
  })) as { table: string };
  for (const c of [a, b]) {
    await c.ok('table.join', { table });
    await c.ok('seat.take', { table });
  }
  await a.until(() => a.doc(table).meta.status === 'active', 'start');
  return { a, b, table };
}

describe('reconnects (ADR 0010)', () => {
  it('holds the seat through a dropped socket and restores it on resume', async () => {
    const clock = new FakeClock();
    const server = start({ store: memoryStore(), clock });
    const { a, b, table } = await seatedPair(server);
    await a.ok('act', { table, name: 'place', input: { cell: 0 } });

    a.close();
    await b.until(() => b.doc(table).seats[0]?.status === 'reserved', 'seat reserved');
    expect(b.doc(table).seats[0]).toMatchObject({ connected: false, player: { name: 'Ada' } });

    await clock.advance(20_000); // inside the 30 s grace period
    const again = TestClient.memory(server);
    const welcome = await again.hello({ resume: a.welcome!.resumeToken });
    expect(welcome.resumed).toBe(true);
    expect(welcome.player.id).toBe(a.welcome!.player.id);
    expect(welcome.resumeToken).not.toBe(a.welcome!.resumeToken); // sliding renewal
    await again.until(() => again.tables.has(table), 'restored snapshot');
    expect(again.doc(table).you.seats).toEqual([0]);
    await b.until(() => b.doc(table).seats[0]?.status === 'occupied', 'seat occupied again');

    await b.ok('act', { table, name: 'place', input: { cell: 4 } });
    await again.ok('act', { table, name: 'place', input: { cell: 1 } });
    expect(again.gaps + b.gaps).toBe(0);
  });

  it('frees the seat when the grace period expires', async () => {
    const clock = new FakeClock();
    const server = start({ store: memoryStore(), clock });
    const { a, b, table } = await seatedPair(server);
    a.close();
    await b.until(() => b.doc(table).seats[0]?.status === 'reserved', 'seat reserved');
    await clock.advance(30_000);
    await b.until(() => b.doc(table).seats[0]?.status === 'empty', 'seat freed');
  });

  it('a second tab keeps the seat connected; closing the old socket changes nothing (finding 9)', async () => {
    const clock = new FakeClock();
    const server = start({ store: memoryStore(), clock });
    const { a, b, table } = await seatedPair(server);
    const tab = TestClient.memory(server);
    await tab.hello({ resume: a.welcome!.resumeToken });
    await tab.until(() => tab.tables.has(table), 'second tab snapshot');
    const runtime = server.tables.runtime(table)!;
    const logLength = runtime.log.length;
    a.close();
    await clock.advance(60_000);
    await tab.ok('act', { table, name: 'place', input: { cell: 0 } });
    expect(runtime.log.slice(logLength).map((e) => e.kind)).toEqual(['action']); // no disconnect entries
    expect(b.doc(table).seats[0]?.status).toBe('occupied');
  });

  it('table.leave stands the player up straight away', async () => {
    const server = start({ store: memoryStore(), clock: new FakeClock() });
    const { a, b, table } = await seatedPair(server);
    await a.ok('table.leave', { table });
    await b.until(() => b.doc(table).seats[0]?.status === 'empty', 'seat freed');
  });

  it('an invalid or expired token simply makes a new guest', async () => {
    const clock = new FakeClock();
    const server = start({ store: memoryStore(), clock, resumeTokenTtlMs: 1000 });
    const first = TestClient.memory(server);
    const welcome = await first.hello();
    const forged = TestClient.memory(server);
    expect((await forged.hello({ resume: `${welcome.resumeToken}x` })).player.id).not.toBe(
      welcome.player.id,
    );
    await clock.advance(1000);
    const late = TestClient.memory(server);
    expect((await late.hello({ resume: welcome.resumeToken })).player.id).not.toBe(
      welcome.player.id,
    );
  });
});

describe('restart recovery (ADR 0009)', () => {
  it('recovers tables after a crash and lets players resume into their seats', async () => {
    const store = memoryStore();
    const clock = new FakeClock();
    const first = start({ store, clock });
    const { a, b, table } = await seatedPair(first);
    await a.ok('act', { table, name: 'place', input: { cell: 0 } });
    await b.ok('act', { table, name: 'place', input: { cell: 4 } });
    const before = first.tables.runtime(table)!.state;
    await first.close({ graceful: false }); // crash: no final snapshot

    const second = start({ store, clock });
    await second.ready;
    const runtime = second.tables.runtime(table)!;
    expect(runtime.state).toEqual(before);
    expect(runtime.seats().map((s) => s.status)).toEqual(['reserved', 'reserved']);

    const ada = TestClient.memory(second);
    const bob = TestClient.memory(second);
    expect((await ada.hello({ resume: a.welcome!.resumeToken })).resumed).toBe(true);
    await bob.hello({ resume: b.welcome!.resumeToken });
    await ada.until(() => ada.tables.has(table), 'ada snapshot');
    await bob.until(
      () => bob.tables.has(table) && bob.doc(table).seats.every((s) => s.status === 'occupied'),
      'both back',
    );
    await ada.ok('act', { table, name: 'place', input: { cell: 8 } });
    await bob.until(
      () =>
        bob.doc(table).view !== null &&
        (bob.doc(table).view as { board: unknown[] }).board[8] === 'X',
      'move seen',
    );
  });

  it('re-arms timers from their recorded deadlines', async () => {
    const store = memoryStore();
    const clock = new FakeClock();
    const first = start({ store, clock });
    const { a, table } = await seatedPair(first, 'quiz', { questions: 1 });
    await a.ok('act', { table, name: 'answer', input: { choice: 1 } });
    await first.close({ graceful: false });

    const second = start({ store, clock });
    await second.ready;
    const runtime = second.tables.runtime(table)!;
    expect(runtime.meta().phase).toBe('question');
    await clock.advance(QUESTION_MS);
    await runtime.idle();
    expect(runtime.meta().phase).toBe('reveal');
  });

  it('a graceful shutdown writes a final snapshot, so the tail is empty', async () => {
    const store = memoryStore();
    const clock = new FakeClock();
    const first = start({ store, clock });
    const { a, table } = await seatedPair(first);
    await a.ok('act', { table, name: 'place', input: { cell: 0 } });
    await first.close();
    const loaded = await store.loadTable(table);
    expect(loaded?.tail).toEqual([]);
    expect(loaded?.snapshot.seq).toBeGreaterThan(0);
  });

  it('reports a table it cannot recover and keeps going', async () => {
    const store = memoryStore();
    const clock = new FakeClock();
    const first = start({ store, clock });
    const { table } = await seatedPair(first);
    await first.close({ graceful: false });

    const bumped = defineGame({ ...ticTacToe, version: 2 });
    const failures: { table: string; reason: string }[] = [];
    const second = createServer({
      games: [bumped],
      secret: SECRET,
      logger: silentLogger,
      store,
      clock,
    });
    servers.push(second);
    second.on('table:recovery-failed', (e) => failures.push(e));
    await second.ready;
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      table,
      reason: expect.stringMatching(/^VERSION_MISMATCH/) as unknown,
    });
    expect(second.tables.get(table)).toBeUndefined();
  });

  it('faults a table whose store write fails, until it is reloaded', async () => {
    const store = memoryStore();
    const clock = new FakeClock();
    const server = start({ store, clock });
    const { a, table } = await seatedPair(server);
    const append = store.appendLog.bind(store);
    store.appendLog = () => Promise.reject(new Error('disk full'));
    expect(await a.request('act', { table, name: 'place', input: { cell: 0 } })).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL' },
    });
    expect(server.tables.runtime(table)!.faulted).toBe(true);
    expect(await a.request('act', { table, name: 'place', input: { cell: 0 } })).toMatchObject({
      ok: false,
      error: { code: 'TABLE_UNAVAILABLE' },
    });
    store.appendLog = append;
    await server.tables.reload(table);
    expect(server.tables.runtime(table)!.faulted).toBe(false);
    expect((server.tables.runtime(table)!.state as { board: unknown[] }).board[0]).toBeNull(); // the failed move never happened
  });
});
