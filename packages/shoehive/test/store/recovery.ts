// The restart-recovery end-to-end test (RFC 0001 Phase 5 exit criterion), run against
// every store adapter. A real server writes to the store; the server "crashes" (no final
// snapshot) and the store is closed; a new store is opened over the same storage and a
// new server recovers from it, exactly as a process restart would.

import { afterEach, describe, expect, it } from 'vitest';
import { quiz, QUESTION_MS } from '../../../../examples/quiz/src/game';
import { ticTacToe } from '../../../../examples/tic-tac-toe/src/game';
import { createServer, silentLogger, type ShoehiveServer } from '../../src/server/index';
import type { Store } from '../../src/store/types';
import { FakeClock, type StoreBackend } from '../../src/testing/index';
import { SECRET, TestClient } from '../server/client';

/** Environment for the networked adapters. CI sets both; locally a missing one skips. */
export const POSTGRES_URL = process.env['SHOEHIVE_TEST_POSTGRES_URL'];
export const REDIS_URL = process.env['SHOEHIVE_TEST_REDIS_URL'];
if (process.env['CI'] && (!POSTGRES_URL || !REDIS_URL)) {
  throw new Error('CI must set SHOEHIVE_TEST_POSTGRES_URL and SHOEHIVE_TEST_REDIS_URL');
}

/** A short unique name for per-test storage (database schema, key prefix, file). */
export function uniqueName(label: string): string {
  return `${label}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function describeRecovery(name: string, createBackend: () => Promise<StoreBackend>): void {
  describe(`restart recovery on ${name} (ADR 0009)`, () => {
    const open: { servers: ShoehiveServer[]; stores: Store[]; backends: StoreBackend[] } = {
      servers: [],
      stores: [],
      backends: [],
    };
    afterEach(async () => {
      for (const server of open.servers.splice(0)) await server.close({ graceful: false });
      for (const store of open.stores.splice(0)) await store.close();
      for (const backend of open.backends.splice(0)) await backend.destroy?.();
    });

    async function boot(backend: StoreBackend, clock: FakeClock) {
      const store = await backend.open();
      open.stores.push(store);
      const server = createServer({
        games: [ticTacToe, quiz],
        secret: SECRET,
        logger: silentLogger,
        reconnectGraceMs: 30_000,
        store,
        clock,
      });
      open.servers.push(server);
      await server.ready;
      return { server, store };
    }

    /** Crash: no final snapshot, then the store connection goes away. */
    async function crash(run: { server: ShoehiveServer; store: Store }) {
      await run.server.close({ graceful: false });
      open.servers.splice(open.servers.indexOf(run.server), 1);
      await run.store.close();
      open.stores.splice(open.stores.indexOf(run.store), 1);
    }

    async function seatedPair(server: ShoehiveServer, game: string, options?: unknown) {
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

    it('recovers a table after a crash and lets players resume into their seats', async () => {
      const backend = await createBackend();
      open.backends.push(backend);
      const clock = new FakeClock();
      const first = await boot(backend, clock);
      const { a, b, table } = await seatedPair(first.server, 'tic-tac-toe');
      await a.ok('act', { table, name: 'place', input: { cell: 0 } });
      await b.ok('act', { table, name: 'place', input: { cell: 4 } });
      const before = first.server.tables.runtime(table)!.state;
      await crash(first);

      const second = await boot(backend, clock);
      const runtime = second.server.tables.runtime(table)!;
      expect(runtime.state).toEqual(before);
      expect(runtime.seats().map((s) => s.status)).toEqual(['reserved', 'reserved']);

      const ada = TestClient.memory(second.server);
      const bob = TestClient.memory(second.server);
      const welcome = await ada.hello({ resume: a.welcome!.resumeToken });
      expect(welcome.resumed).toBe(true);
      expect(welcome.player.name).toBe('Ada'); // the session came back from the store
      await bob.hello({ resume: b.welcome!.resumeToken });
      await bob.until(
        () => bob.tables.has(table) && bob.doc(table).seats.every((s) => s.status === 'occupied'),
        'both back',
      );
      // Play on to a win: the recovered log keeps accepting entries in order.
      await ada.ok('act', { table, name: 'place', input: { cell: 1 } });
      await bob.ok('act', { table, name: 'place', input: { cell: 5 } });
      await ada.ok('act', { table, name: 'place', input: { cell: 2 } });
      await bob.until(() => bob.doc(table).meta.status === 'ended', 'win seen');
      expect(bob.doc(table).meta.result).toEqual({ winner: 'X' });
    });

    it('re-arms timers from their recorded deadlines', async () => {
      const backend = await createBackend();
      open.backends.push(backend);
      const clock = new FakeClock();
      const first = await boot(backend, clock);
      const { a, table } = await seatedPair(first.server, 'quiz', { questions: 1 });
      await a.ok('act', { table, name: 'answer', input: { choice: 1 } });
      await crash(first);

      const second = await boot(backend, clock);
      const runtime = second.server.tables.runtime(table)!;
      expect(runtime.meta().phase).toBe('question');
      await clock.advance(QUESTION_MS);
      await runtime.idle();
      expect(runtime.meta().phase).toBe('reveal');
    });

    it('after a graceful shutdown the stored tail is empty and recovery still works', async () => {
      const backend = await createBackend();
      open.backends.push(backend);
      const clock = new FakeClock();
      const first = await boot(backend, clock);
      const { a, table } = await seatedPair(first.server, 'tic-tac-toe');
      await a.ok('act', { table, name: 'place', input: { cell: 0 } });
      const before = first.server.tables.runtime(table)!.state;
      await first.server.close();
      open.servers.splice(open.servers.indexOf(first.server), 1);
      const loaded = await first.store.loadTable(table);
      expect(loaded?.tail).toEqual([]);
      expect(loaded?.snapshot.seq).toBeGreaterThan(0);
      await first.store.close();
      open.stores.splice(open.stores.indexOf(first.store), 1);

      const second = await boot(backend, clock);
      expect(second.server.tables.runtime(table)!.state).toEqual(before);
    });

    it('does not recover closed tables', async () => {
      const backend = await createBackend();
      open.backends.push(backend);
      const clock = new FakeClock();
      const first = await boot(backend, clock);
      const { table } = await seatedPair(first.server, 'tic-tac-toe');
      const kept = await seatedPair(first.server, 'tic-tac-toe');
      await first.server.tables.close(table);
      await crash(first);

      const second = await boot(backend, clock);
      expect(second.server.tables.get(table)).toBeUndefined();
      expect(second.server.tables.get(kept.table)).toBeDefined();
    });
  });
}
