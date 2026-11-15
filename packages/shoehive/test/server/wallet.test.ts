// The server side of ADR 0007: the wallet reaches ctx.wallet, survives a restart, and a
// closed table gives back what it still holds.

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineGame } from '../../src/core/define';
import { MemoryWallet } from '../../src/core/wallet';
import {
  createServer,
  memoryStore,
  silentLogger,
  type ShoehiveServer,
  type Store,
} from '../../src/server/index';
import { FakeClock } from '../../src/testing/index';
import { SECRET, TestClient } from './client';

const pot = defineGame({
  id: 'pot',
  seats: { min: 1, max: 2 },
  setup: () => ({ bets: [] as string[] }),
  actions: {
    bet: {
      input: z.object({ amount: z.number().int(), key: z.string() }),
      async run({ state, seat, input, ctx }) {
        if (await ctx.wallet.reserve(seat, input.amount, input.key)) state.bets.push(input.key);
      },
    },
    settle: {
      run({ state, ctx }) {
        for (const key of state.bets) ctx.wallet.commit(key);
        state.bets = [];
      },
    },
  },
  view: ({ state }) => state,
});

let servers: ShoehiveServer[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => s.close({ graceful: false })));
  servers = [];
});

function start(store: Store, wallet: MemoryWallet, clock = new FakeClock()) {
  const server = createServer({
    games: [pot],
    secret: SECRET,
    logger: silentLogger,
    clock,
    store,
    wallet,
    dev: true,
  });
  servers.push(server);
  return server;
}

async function seated(server: ShoehiveServer) {
  const c = TestClient.memory(server);
  const welcome = await c.hello({ name: 'Ada' });
  const { table } = (await c.ok('table.create', { game: 'pot' })) as { table: string };
  await c.ok('table.join', { table });
  await c.ok('seat.take', { table });
  return { c, table, player: welcome.player.id };
}

describe('server wallet (ADR 0007)', () => {
  it('releases open reservations when a table closes', async () => {
    const wallet = new MemoryWallet({ startingBalance: 1000 });
    const server = start(memoryStore(), wallet);
    const { c, table, player } = await seated(server);
    await c.ok('act', { table, name: 'bet', input: { amount: 400, key: 'b' } });
    expect(await wallet.balance(player)).toBe(600);
    await server.tables.close(table);
    expect(await wallet.balance(player)).toBe(1000);
    expect(wallet.reservation(`${table}:b`)?.state).toBe('released');
  });

  it('keeps reservations across a restart and settles them after', async () => {
    const wallet = new MemoryWallet({ startingBalance: 1000 });
    const store = memoryStore();
    const first = start(store, wallet);
    const { c, table, player } = await seated(first);
    await c.ok('act', { table, name: 'bet', input: { amount: 300, key: 'b' } });
    await first.close({ graceful: false });
    servers = servers.filter((s) => s !== first);

    const second = start(store, wallet);
    await second.ready;
    await second.tables.runtime(table)!.act({ player, name: 'settle' });
    await second.tables.runtime(table)!.idle();
    expect(await wallet.balance(player)).toBe(700);
    expect(wallet.reservation(`${table}:b`)?.state).toBe('committed');
    // Nothing is left to release on close.
    await second.tables.close(table);
    expect(await wallet.balance(player)).toBe(700);
  });
});
