import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { isShoehiveError } from 'shoehive/client';
import { useClient, useConnection, useLobby, useTable } from 'shoehive/react';
// Type-only: the browser bundle gets the game's types, never its server code.
import type { ticTacToe } from '../src/game';

type TicTacToe = typeof ticTacToe;
const GAME_ID = 'tic-tac-toe';
const MARKS = ['X', 'O'] as const;

// ---------------------------------------------------------------------------------
// Routing: `#/` is the lobby, `#/table/<id>` a table.

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
  };
}

function useTableRoute(): string | null {
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash);
  const match = /^#\/table\/([^/]+)$/.exec(hash);
  return match ? decodeURIComponent(match[1]!) : null;
}

const tableHref = (id: string): string => `#/table/${encodeURIComponent(id)}`;

const FRIENDLY_ERRORS: Record<string, string> = {
  NOT_YOUR_TURN: 'It is not your turn.',
  CELL_TAKEN: 'That cell is already taken.',
  NOT_SEATED: 'Take a seat to play.',
  NOT_STARTED: 'The game starts when both seats are taken.',
  TABLE_FULL: 'Both seats are taken.',
  TABLE_ENDED: 'This game is over.',
};

function describeError(error: unknown): string {
  if (isShoehiveError(error)) return FRIENDLY_ERRORS[error.code] ?? error.message;
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------------

export function App(): ReactNode {
  const tableId = useTableRoute();
  // #region connection
  const { status, player } = useConnection();
  // #endregion connection
  return (
    <div className="app">
      <header className="bar">
        <a className="brand" href="#/">
          Tic Tac Toe
        </a>
        <span className={`connection connection-${status}`}>
          {player ? `${player.name}, ` : ''}
          {status}
        </span>
      </header>
      {tableId ? <TableScreen key={tableId} tableId={tableId} /> : <Lobby />}
    </div>
  );
}

function Lobby(): ReactNode {
  // #region lobby
  const lobby = useLobby();
  const client = useClient<[TicTacToe]>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tables = (lobby?.tables ?? []).filter((t) => t.game === GAME_ID && t.status !== 'ended');

  const create = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    try {
      const id = await client.createTable(GAME_ID);
      window.location.hash = tableHref(id);
    } catch (err) {
      setError(describeError(err));
      setCreating(false);
    }
  };

  // #endregion lobby
  return (
    <main>
      <div className="row">
        <h1>Open games</h1>
        <button type="button" disabled={creating} onClick={() => void create()}>
          New game
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {lobby === null ? (
        <p className="muted">Loading...</p>
      ) : tables.length === 0 ? (
        <p className="muted">No open games. Start one!</p>
      ) : (
        <ul className="list">
          {tables.map((t) => (
            <li key={t.id}>
              <a href={tableHref(t.id)}>Table {t.id}</a>
              <span className="muted">
                {t.seats.taken}/{t.seats.total} seated, {t.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function TableScreen({ tableId }: { tableId: string }): ReactNode {
  // #region use-table
  const { status, error, view, meta, seats, mySeat, pending, actionError, act, sit } =
    useTable<TicTacToe>(tableId);
  // #endregion use-table

  if (status === 'error') {
    return (
      <main>
        <p role="alert">Could not join this table: {describeError(error)}</p>
        <a href="#/">Back to the lobby</a>
      </main>
    );
  }
  if (status === 'closed') {
    return (
      <main>
        <p>This table was closed.</p>
        <a href="#/">Back to the lobby</a>
      </main>
    );
  }
  if (!view || !meta) return <p className="muted">Joining...</p>;

  // #region derived
  const turn = meta.turn?.seat ?? null;
  const over = meta.status === 'ended';
  const myTurn = !over && turn !== null && turn === mySeat;
  const canSit = mySeat === null && !over && seats.some((s) => s.status === 'empty');
  // #endregion derived

  let headline: string;
  if (view.winner === 'draw') headline = 'Draw';
  else if (view.winner) headline = `${view.winner} wins`;
  else if (meta.status === 'waiting') headline = 'Waiting for another player';
  else if (turn === null) headline = '';
  else if (myTurn) headline = 'Your turn';
  else headline = mySeat === null ? `${MARKS[turn]!} to move` : `Waiting for ${MARKS[turn]!}`;

  // The hook's sit() never rejects: failures show up in actionError like act() errors.
  const takeSeat = async (): Promise<void> => {
    await sit();
  };
  const alert = actionError ? describeError(actionError) : null;

  return (
    <main>
      <ul className="seats">
        {seats.map((seat, i) => (
          <li
            key={i}
            data-testid={`seat-${String(i)}`}
            className={!over && turn === i ? 'seat seat-turn' : 'seat'}
          >
            <span className="seat-label">{MARKS[i]}</span>
            <span className="seat-name">
              {seat.player ? seat.player.name : 'Empty seat'}
              {i === mySeat ? ' (you)' : ''}
            </span>
            {seat.player ? (
              <span className={seat.connected ? 'presence online' : 'presence offline'}>
                {seat.connected ? 'online' : 'offline'}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {canSit ? (
        <button type="button" className="primary" onClick={() => void takeSeat()}>
          Take a seat
        </button>
      ) : null}

      <p role="status" className="headline">
        {headline}
      </p>

      {/* #region board */}
      <div className="board">
        {view.board.map((cell, i) => (
          <button
            key={i}
            type="button"
            className="cell"
            aria-label={`cell ${String(i)}`}
            disabled={!myTurn || cell !== null || pending > 0}
            onClick={() => {
              // Errors show up in actionError; the hook's act() never rejects.
              void act('place', { cell: i });
            }}
          >
            {cell ?? ''}
          </button>
        ))}
      </div>
      {/* #endregion board */}

      {alert ? (
        <p role="alert" className="error">
          {alert}
        </p>
      ) : null}

      <p className="muted small">
        Share this page&apos;s address to invite someone. <a href="#/">Lobby</a>
      </p>
    </main>
  );
}
