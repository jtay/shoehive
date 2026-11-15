// @vitest-environment happy-dom
import {
  act as reactAct,
  render,
  screen,
  waitFor,
  fireEvent,
  cleanup,
} from '@testing-library/react';
import { createElement as h, StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ticTacToe } from '../../../../examples/tic-tac-toe/src/game';
import { createClient, type ShoehiveClient, type WebSocketLike } from '../../src/client/index';
import { ShoehiveProvider, useConnection, useLobby, useTable } from '../../src/react/index';
import { createServer, silentLogger, type ShoehiveServer } from '../../src/server/index';
import { SECRET } from '../server/client';

let server: ShoehiveServer | null = null;
const clients: ShoehiveClient[] = [];
afterEach(async () => {
  cleanup();
  for (const c of clients.splice(0)) c.close();
  await server?.close({ graceful: false });
  server = null;
});

function makeClient(): ShoehiveClient {
  server ??= createServer({ games: [ticTacToe], secret: SECRET, logger: silentLogger });
  const s = server;
  const client = createClient({
    url: 'memory://',
    storage: false,
    connect: () => s.connect() as unknown as WebSocketLike,
  });
  clients.push(client);
  return client;
}

function Board({ tableId }: { tableId: string }) {
  const { status, view, mySeat, meta, act, pending, actionError } =
    useTable<typeof ticTacToe>(tableId);
  if (status !== 'ready' || !view) return h('p', null, `status: ${status}`);
  return h(
    'div',
    null,
    h(
      'p',
      { 'data-testid': 'info' },
      `seat ${String(mySeat)} turn ${String(meta?.turn?.seat)} pending ${String(pending)}`,
    ),
    actionError ? h('p', { role: 'alert' }, actionError.message) : null,
    ...view.board.map((cell, i) =>
      h(
        'button',
        {
          key: i,
          'aria-label': `cell ${String(i)}`,
          onClick: () => void act('place', { cell: i }).catch(() => undefined),
        },
        cell ?? '.',
      ),
    ),
  );
}

function Status() {
  const { status, player } = useConnection();
  return h('p', { 'data-testid': 'status' }, `${status} ${player?.name ?? ''}`);
}

function Lobby() {
  const lobby = useLobby();
  return h(
    'p',
    { 'data-testid': 'lobby' },
    lobby ? `${String(lobby.tables.length)} tables` : 'loading',
  );
}

describe('shoehive/react', () => {
  it('useConnection and useLobby follow the server', async () => {
    const client = makeClient();
    render(h(StrictMode, null, h(ShoehiveProvider, { client }, h(Status), h(Lobby))));
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toMatch(/^open Guest/);
    });
    await waitFor(() => {
      expect(screen.getByTestId('lobby').textContent).toBe('0 tables');
    });
    await reactAct(async () => {
      await client.createTable('tic-tac-toe');
    });
    await waitFor(() => {
      expect(screen.getByTestId('lobby').textContent).toBe('1 tables');
    });
  });

  it('useTable renders the live view and binds typed actions', async () => {
    const ada = makeClient();
    const bob = makeClient();
    const tableId = await ada.createTable('tic-tac-toe');
    await (await ada.join(tableId)).sit();
    await (await bob.join(tableId)).sit();

    render(h(StrictMode, null, h(ShoehiveProvider, { client: ada }, h(Board, { tableId }))));
    await waitFor(() => {
      expect(screen.getByTestId('info').textContent).toBe('seat 0 turn 0 pending 0');
    });
    fireEvent.click(screen.getByRole('button', { name: 'cell 4' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'cell 4' }).textContent).toBe('X');
    });
    expect(screen.getByTestId('info').textContent).toBe('seat 0 turn 1 pending 0');

    // Out of turn: the error surfaces through actionError.
    fireEvent.click(screen.getByRole('button', { name: 'cell 0' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/NOT_YOUR_TURN/);
    });

    // Bob's move arrives as a patch and re-renders Ada's board.
    await reactAct(async () => {
      await bob.table<typeof ticTacToe>(tableId)!.act('place', { cell: 0 });
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'cell 0' }).textContent).toBe('O');
    });
  });

  it('a provider with options creates and closes its own client', async () => {
    server = createServer({ games: [ticTacToe], secret: SECRET, logger: silentLogger });
    const s = server;
    const view = render(
      h(
        ShoehiveProvider,
        {
          url: 'memory://',
          storage: false,
          name: 'Cleo',
          connect: () => s.connect() as unknown as WebSocketLike,
        },
        h(Status),
      ),
    );
    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('open Cleo');
    });
    view.unmount();
  });
});
