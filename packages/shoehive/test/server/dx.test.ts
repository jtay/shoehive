// Phase 4 additions to the protocol (all additive): lobby filters, guest rename, visible
// timers in meta, and result schemas.

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ticTacToe } from '../../../../examples/tic-tac-toe/src/game';
import { defineGame } from '../../src/core/define';
import {
  createServer,
  memoryStore,
  silentLogger,
  type ShoehiveServer,
} from '../../src/server/index';
import { createTestTable, FakeClock } from '../../src/testing/index';
import { SECRET, TestClient } from './client';

const timed = defineGame({
  id: 'timed',
  seats: { min: 1, max: 2 },
  result: z.object({ winner: z.number() }),
  setup: () => ({ rang: false }),
  actions: {
    arm: {
      run({ ctx }) {
        ctx.timers.after('bell', 5000, 'ring', null, { visible: true });
        ctx.timers.after('secret', 9000, 'ring');
      },
    },
    ring: {
      internal: true,
      run({ state }) {
        state.rang = true;
      },
    },
    win: {
      run({ ctx, seat }) {
        ctx.end({ winner: seat });
      },
    },
    badEnd: {
      run({ ctx }) {
        (ctx.end as (result: unknown) => void)({ winner: 'nobody' });
      },
    },
  },
});

let servers: ShoehiveServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close({ graceful: false })));
  servers = [];
});

function start() {
  const server = createServer({
    games: [ticTacToe, timed],
    secret: SECRET,
    logger: silentLogger,
    clock: new FakeClock(),
    store: memoryStore(),
  });
  servers.push(server);
  return server;
}

describe('lobby filters', () => {
  it('lists only the matching tables, and patches only when they change', async () => {
    const server = start();
    const all = TestClient.memory(server);
    const onlyTimed = TestClient.memory(server);
    await all.hello();
    await onlyTimed.hello();
    await all.ok('lobby.sub');
    await onlyTimed.ok('lobby.sub', { filter: { games: ['timed'], status: ['waiting'] } });
    await all.ok('table.create', { game: 'tic-tac-toe' });
    const { table } = (await all.ok('table.create', { game: 'timed' })) as { table: string };
    await all.until(() => all.lobby?.doc.tables.length === 2, 'both tables');
    await onlyTimed.until(() => onlyTimed.lobby?.doc.tables.length === 1, 'one table');
    expect(onlyTimed.lobby!.doc.tables[0]!.id).toBe(table);
    expect(onlyTimed.lobby!.doc.games.map((g) => g.id)).toEqual(['tic-tac-toe', 'timed']);
    // Starting the table makes it 'active', so it leaves the filtered lobby.
    await onlyTimed.ok('table.join', { table });
    await onlyTimed.ok('seat.take', { table });
    await onlyTimed.until(() => onlyTimed.lobby?.doc.tables.length === 0, 'table left');
  });

  it('rejects a malformed filter', async () => {
    const server = start();
    const c = TestClient.memory(server);
    await c.hello();
    const ack = await c.request('lobby.sub', { filter: { status: ['playing'] } });
    expect(ack).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
  });
});

describe('player.rename', () => {
  it('renames a guest everywhere they sit, and keeps it on resume', async () => {
    const server = start();
    const a = TestClient.memory(server);
    const b = TestClient.memory(server);
    const welcome = await a.hello({ name: 'Ada' });
    await b.hello({ name: 'Bob' });
    const { table } = (await a.ok('table.create', { game: 'tic-tac-toe' })) as { table: string };
    for (const c of [a, b]) {
      await c.ok('table.join', { table });
      await c.ok('seat.take', { table });
    }
    expect(await a.ok('player.rename', { name: '  Ada L.  ' })).toMatchObject({ name: 'Ada L.' });
    await b.until(() => b.doc(table).seats[0]?.player?.name === 'Ada L.', 'renamed seat');
    a.close();
    const again = TestClient.memory(server);
    const resumed = await again.hello({ resume: welcome.resumeToken });
    expect(resumed.player.name).toBe('Ada L.');
  });

  it('rejects empty or overlong names', async () => {
    const server = start();
    const c = TestClient.memory(server);
    await c.hello();
    // Control characters, line separators and bidirectional overrides (security review N-10).
    for (const name of [
      '   ',
      'x'.repeat(33),
      'bad\u0007name',
      'Ada\u202Egnp.exe',
      'two\u2028lines',
      'iso\u2066late',
    ]) {
      expect(await c.request('player.rename', { name })).toMatchObject({
        ok: false,
        error: { code: 'BAD_REQUEST' },
      });
    }
  });
});

describe('visible timers and result schemas', () => {
  it('lists visible timer deadlines in meta, and only those', async () => {
    const t = await createTestTable(timed, { players: 1 });
    await t.act(0, 'arm');
    expect(t.meta.timers).toEqual({ bell: t.clock.now() + 5000 });
    await t.advance(5000);
    expect(t.state.rang).toBe(true);
    expect(t.meta.timers).toEqual({});
    await t.verifyReplay();
  });

  it('stores a valid result and rolls back an invalid one', async () => {
    const t = await createTestTable(timed, { players: 1 });
    await expect(t.act(0, 'badEnd')).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(t.meta.status).toBe('active');
    await t.act(0, 'win');
    expect(t.meta).toMatchObject({ status: 'ended', result: { winner: 0 } });
  });
});
