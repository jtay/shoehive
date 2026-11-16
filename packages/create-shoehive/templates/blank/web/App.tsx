import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { isShoehiveError } from 'shoehive/client';
import { useClient, useConnection, useLobby, useTable } from 'shoehive/react';
// Type-only: the browser bundle gets the game's types, never its server code.
import type { game } from '../src/game';

type Game = typeof game;
const GAME_ID = 'my-game';
const TARGET = 10;

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

function describeError(error: unknown): string {
  if (isShoehiveError(error)) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

export function App(): ReactNode {
  const tableId = useTableRoute();
  const { status, player } = useConnection();
  return (
    <div className="app">
      <header className="bar">
        <a className="brand" href="#/">
          My Game
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
  const lobby = useLobby();
  const client = useClient<[Game]>();
  const [error, setError] = useState<string | null>(null);
  const tables = (lobby?.tables ?? []).filter((t) => t.game === GAME_ID && t.status !== 'ended');

  const create = async (): Promise<void> => {
    setError(null);
    try {
      window.location.hash = tableHref(await client.createTable(GAME_ID));
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <main>
      <div className="row">
        <h1>Open games</h1>
        <button type="button" onClick={() => void create()}>
          New game
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {tables.length === 0 ? (
        <p className="muted">No open games yet.</p>
      ) : (
        <ul className="list">
          {tables.map((t) => (
            <li key={t.id}>
              <a href={tableHref(t.id)}>Table {t.id}</a>
              <span className="muted">
                {t.seats.taken}/{t.seats.total} seated
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function TableScreen({ tableId }: { tableId: string }): ReactNode {
  const { status, error, view, meta, seats, mySeat, pending, actionError, act, sit } =
    useTable<Game>(tableId);

  if (status === 'error') {
    return (
      <main>
        <p role="alert">Could not join this table: {describeError(error)}</p>
        <a href="#/">Back to the lobby</a>
      </main>
    );
  }
  if (!view || !meta) return <p className="muted">Joining...</p>;

  const over = meta.status === 'ended';
  const canSit = mySeat === null && !over && seats.some((s) => s.status === 'empty');
  const headline =
    view.winner === null
      ? `${String(view.count)} of ${String(TARGET)}`
      : `Player ${String(view.winner + 1)} wins`;

  return (
    <main>
      <ul className="seats">
        {seats.map((seat, i) => (
          <li key={i} data-testid={`seat-${String(i)}`} className="seat">
            <span className="seat-label">{i + 1}</span>
            <span className="seat-name">
              {seat.player ? seat.player.name : 'Empty seat'}
              {i === mySeat ? ' (you)' : ''}
            </span>
          </li>
        ))}
      </ul>

      {canSit ? (
        <button type="button" className="primary" onClick={() => void sit()}>
          Take a seat
        </button>
      ) : null}

      <p role="status" className="headline">
        {headline}
      </p>

      <button
        type="button"
        className="primary"
        disabled={mySeat === null || over || pending > 0}
        onClick={() => {
          // Errors show up in actionError; the hook's act() never rejects.
          void act('press');
        }}
      >
        Press
      </button>

      {actionError ? (
        <p role="alert" className="error">
          {describeError(actionError)}
        </p>
      ) : null}
    </main>
  );
}
