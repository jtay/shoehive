import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { quiz } from '../../../../examples/quiz/src/game';
import { ticTacToe } from '../../../../examples/tic-tac-toe/src/game';
import {
  createClient,
  ShoehiveError,
  type ShoehiveClient,
  type TokenStorage,
  type WebSocketLike,
} from '../../src/client/index';
import { createServer, silentLogger, type ShoehiveServer } from '../../src/server/index';
import { SECRET } from '../server/client';

type Games = [typeof ticTacToe, typeof quiz];

let servers: ShoehiveServer[] = [];
let clients: ShoehiveClient<Games>[] = [];
afterEach(async () => {
  for (const c of clients) c.close();
  await Promise.all(servers.map((s) => s.close({ graceful: false })));
  servers = [];
  clients = [];
});

const until = async (predicate: () => boolean, what: string, timeoutMs = 3000): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const memoryStorage = (): TokenStorage => {
  let token: string | null = null;
  return { get: () => token, set: (t) => (token = t) };
};

async function setup(transport: 'memory' | 'ws') {
  const server = createServer({
    games: [ticTacToe, quiz],
    secret: SECRET,
    logger: silentLogger,
    reconnectGraceMs: 30_000,
  });
  servers.push(server);
  const url = transport === 'ws' ? (await server.listen()).url : 'memory://';
  const sockets: WebSocketLike[] = [];
  const client = (options: { storage?: TokenStorage; name?: string } = {}) => {
    const c = createClient<Games>({
      url,
      storage: options.storage ?? memoryStorage(),
      ...(options.name ? { name: options.name } : {}),
      reconnect: { initialDelayMs: 10, maxDelayMs: 50 },
      ...(transport === 'memory'
        ? {
            connect: () => {
              const socket = server.connect() as unknown as WebSocketLike;
              sockets.push(socket);
              return socket;
            },
          }
        : {}),
    });
    clients.push(c);
    return c;
  };
  return { server, client, sockets };
}

describe.each(['memory', 'ws'] as const)('shoehive/client over %s', (transport) => {
  it('connects as a guest and plays a typed game with another client', async () => {
    const { client } = await setup(transport);
    const ada = client({ name: 'Ada' });
    const bob = client({ name: 'Bob' });
    expect((await ada.connect()).player.name).toBe('Ada');
    expect(ada.status).toBe('open');

    const table = await ada.createAndJoin('tic-tac-toe');
    expect(table.mySeat).toBe(0);
    const bobTable = await bob.join<typeof ticTacToe>(table.id);
    expect(await bobTable.sit()).toBe(1);
    await until(() => table.meta.status === 'active', 'start');

    const result = await table.act('place', { cell: 4 });
    // The ack arrives after the patch, so the document already shows the move.
    expect(table.rev).toBe(result.rev);
    expect(table.view.board[4]).toBe('X');
    await until(() => bobTable.rev === result.rev, 'bob patch');
    expect(bobTable.view).toEqual(table.view);

    await expect(table.act('place', { cell: 0 })).rejects.toMatchObject({
      code: 'NOT_YOUR_TURN',
      source: 'game',
    });
    const error = await table.act('place', { cell: 0 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ShoehiveError);
  });

  it('notifies subscribers and event listeners', async () => {
    const { client } = await setup(transport);
    const ada = client();
    const table = await ada.createAndJoin('tic-tac-toe');
    const revs: number[] = [];
    const unsubscribe = table.subscribe(() => revs.push(table.rev));
    const bob = client();
    await (await bob.join(table.id)).sit();
    await until(() => table.meta.status === 'active', 'start');
    expect(revs.length).toBeGreaterThan(0);
    unsubscribe();
  });

  it('keeps a lobby document in sync', async () => {
    const { client } = await setup(transport);
    const ada = client();
    const lobby = await ada.lobby();
    await until(() => lobby.doc !== null, 'lobby snapshot');
    expect(lobby.doc!.games.map((g) => g.id)).toEqual(['tic-tac-toe', 'quiz']);
    const id = await ada.createTable('quiz', { questions: 1 });
    await until(() => lobby.doc!.tables.some((t) => t.id === id), 'lobby patch');
  });

  it('reconnects on its own and keeps the seat', async () => {
    const { client, sockets, server } = await setup(transport);
    const storage = memoryStorage();
    const ada = client({ storage });
    const bob = client();
    const table = await ada.createAndJoin('tic-tac-toe');
    const playerId = ada.player!.id;
    await (await bob.join(table.id)).sit();
    await until(() => table.meta.status === 'active', 'start');

    const statuses: string[] = [];
    ada.onStatus((s) => statuses.push(s));
    if (transport === 'memory') sockets[0]!.close(1006, 'network drop');
    else {
      // Drop Ada's real socket from the server side.
      const runtime = server.tables.runtime(table.id)!;
      expect(runtime.seatsHeldBy(playerId)).toEqual([0]);
      (ada as unknown as { socket: WebSocketLike }).socket.close(4000, 'drop');
    }
    await until(() => statuses.includes('reconnecting'), 'reconnecting');
    await until(() => ada.status === 'open', 'reopened');
    expect(ada.player!.id).toBe(playerId);
    await until(() => table.doc!.seats[0]!.status === 'occupied', 'seat back');
    await table.act('place', { cell: 0 });
    expect(table.view.board[0]).toBe('X');
  });

  it('a new client with the same stored token resumes the same player', async () => {
    const { client } = await setup(transport);
    const storage = memoryStorage();
    const first = client({ storage });
    const id = (await first.connect()).player.id;
    first.close();
    const second = client({ storage });
    const welcome = await second.connect();
    expect(welcome.player.id).toBe(id);
  });
});

describe('client types', () => {
  it('types views and actions from the games', () => {
    const typeOnly = async (c: ShoehiveClient<Games>) => {
      const table = await c.join<typeof ticTacToe>('t');
      expectTypeOf(table.view.board).toEqualTypeOf<('X' | 'O' | null)[]>();
      await table.act('place', { cell: 1 });
      // @ts-expect-error wrong input
      await table.act('place', { cell: 'one' });
      // @ts-expect-error unknown action
      await table.act('nope');
      const q = await c.join<typeof quiz>('q');
      await q.act('answer', { choice: 2 });
      expectTypeOf(q.view.question.text).toEqualTypeOf<string>();
    };
    expectTypeOf(typeOnly).toBeFunction();
  });
});

describe('client regressions (found while building the example UIs)', () => {
  it('a failed join() does not break a second join() of the same table', async () => {
    const { client } = await setup('memory');
    const ada = client();
    const tableId = await ada.createTable('tic-tac-toe');
    const first = ada.join(tableId);
    ada.close(); // the first join fails with CLIENT_CLOSED...
    const second = ada.join(tableId); // ...while a second join reuses its handle
    await expect(first).rejects.toMatchObject({ code: 'CLIENT_CLOSED' });
    const table = await second;
    expect(table.doc).not.toBeNull();
  });

  it('a failed lobby() can be retried', async () => {
    const { client } = await setup('memory');
    const ada = client();
    const failed = ada.lobby();
    ada.close();
    await expect(failed).rejects.toMatchObject({ code: 'CLIENT_CLOSED' });
    const lobby = await ada.lobby();
    await until(() => lobby.doc !== null, 'lobby snapshot after retry');
  });
});
