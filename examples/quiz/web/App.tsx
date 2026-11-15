import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { isShoehiveError } from 'shoehive/client';
import { useClient, useConnection, useLobby, useServerTime, useTable } from 'shoehive/react';
// Type-only: the browser bundle gets the game's types, never its server code (or answers).
import type { quiz } from '../src/game';

type Quiz = typeof quiz;
const GAME_ID = 'quiz';
const QUESTION_COUNTS = [1, 2, 3, 5] as const;
const LETTERS = ['A', 'B', 'C', 'D'] as const;

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
  ALREADY_SUBMITTED: 'You already answered this question.',
  ROUND_CLOSED: 'Too late: the question has closed.',
  NOT_PARTICIPANT: 'You joined after this question opened. Wait for the next one.',
  NOT_SEATED: 'Take a seat to play.',
  NOT_STARTED: 'The quiz starts when two players are seated.',
  TABLE_FULL: 'Every seat is taken.',
  TABLE_ENDED: 'This quiz is over.',
};

function describeError(error: unknown): string {
  if (isShoehiveError(error)) return FRIENDLY_ERRORS[error.code] ?? error.message;
  return error instanceof Error ? error.message : String(error);
}

/** `meta.result` is untyped JSON: pick out the winning seats the game ends with. */
function winnersOf(result: unknown): number[] {
  if (typeof result !== 'object' || result === null || !('winners' in result)) return [];
  const { winners } = result;
  return Array.isArray(winners) ? winners.filter((w): w is number => typeof w === 'number') : [];
}

// ---------------------------------------------------------------------------------

export function App(): ReactNode {
  const tableId = useTableRoute();
  const { status, player } = useConnection();
  return (
    <div className="app">
      <header className="bar">
        <a className="brand" href="#/">
          Quiz
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
  const client = useClient<[Quiz]>();
  const [questions, setQuestions] = useState(3);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tables = (lobby?.tables ?? []).filter((t) => t.game === GAME_ID && t.status !== 'ended');

  const create = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    try {
      const id = await client.createTable(GAME_ID, { questions });
      window.location.hash = tableHref(id);
    } catch (err) {
      setError(describeError(err));
      setCreating(false);
    }
  };

  return (
    <main>
      <h1>Open quizzes</h1>
      <div className="row">
        <label>
          Questions{' '}
          <select
            value={questions}
            onChange={(event) => {
              setQuestions(Number(event.target.value));
            }}
          >
            {QUESTION_COUNTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={creating} onClick={() => void create()}>
          New game
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {lobby === null ? (
        <p className="muted">Loading...</p>
      ) : tables.length === 0 ? (
        <p className="muted">No open quizzes. Start one!</p>
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
  const { status, error, view, meta, seats, mySeat, pending, actionError, act, sit } =
    useTable<Quiz>(tableId);
  // #region server-time
  const now = useServerTime(250);
  // #endregion server-time

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

  const over = meta.status === 'ended';
  const asking = meta.status === 'active' && meta.phase === 'question';
  const revealing = meta.phase === 'reveal' || over;
  const answers: Partial<Record<string, number>> = view.answers;
  const submitted = new Set(meta.round?.submitted ?? []);
  const myAnswer = mySeat === null ? undefined : answers[String(mySeat)];
  // #region countdown
  const secondsLeft =
    asking && meta.round?.deadline
      ? Math.max(0, Math.ceil((meta.round.deadline - now) / 1000))
      : null;
  // #endregion countdown
  const occupied = seats.flatMap((seat, i) =>
    seat.player ? [{ seat: i, player: seat.player, connected: seat.connected }] : [],
  );
  const nameOf = (seat: number): string => seats[seat]?.player?.name ?? `Seat ${String(seat + 1)}`;
  const winners = over ? winnersOf(meta.result) : [];
  const canSit = mySeat === null && !over && seats.some((s) => s.status === 'empty');
  const correct =
    view.correct === null
      ? null
      : `${LETTERS[view.correct]}. ${view.question.choices[view.correct]}`;

  let headline: string;
  if (over) {
    headline =
      winners.length === 1
        ? `Winner: ${nameOf(winners[0]!)}`
        : `Winners: ${winners.map(nameOf).join(', ')}`;
  } else if (meta.status === 'waiting') headline = 'Waiting for players';
  else if (revealing) headline = `Correct answer: ${correct ?? ''}`;
  else if (mySeat === null) headline = 'Players are answering';
  else if (myAnswer !== undefined) headline = 'Answer locked in';
  else headline = 'Pick an answer';

  const badge = (seat: number): string => {
    if (meta.status === 'waiting') return '';
    if (asking) return submitted.has(seat) ? 'answered' : 'thinking';
    const choice = answers[String(seat)];
    if (choice === undefined) return 'no answer';
    return choice === view.correct ? 'correct' : 'wrong';
  };

  // The hook's sit() never rejects: failures show up in actionError like act() errors.
  const takeSeat = async (): Promise<void> => {
    await sit();
  };
  const alert = actionError ? describeError(actionError) : null;

  return (
    <main>
      <ul className="seats" aria-label="Players">
        {occupied.map(({ seat, player, connected }) => (
          <li key={seat} data-testid={`seat-${String(seat)}`} className="seat">
            <span className="seat-name">
              {player.name}
              {seat === mySeat ? ' (you)' : ''}
            </span>
            <span className={connected ? 'presence online' : 'presence offline'}>
              {connected ? 'online' : 'offline'}
            </span>
            <span className={`badge badge-${badge(seat).replace(' ', '-')}`}>{badge(seat)}</span>
            <span className="score" data-testid={`score-${String(seat)}`}>
              {view.scores[seat] ?? 0} pts
            </span>
          </li>
        ))}
        {occupied.length === 0 ? <li className="seat muted">Nobody is seated yet.</li> : null}
      </ul>

      {canSit ? (
        <button type="button" className="primary" onClick={() => void takeSeat()}>
          Take a seat
        </button>
      ) : null}

      <p role="status" className="headline">
        {headline}
      </p>

      {meta.status === 'waiting' ? (
        <p className="muted center">
          The quiz starts as soon as two players are seated ({occupied.length} so far).
        </p>
      ) : over ? (
        <p className="muted center">Game over. Final scores are above.</p>
      ) : (
        <section className="question">
          <div className="question-meta">
            <span>
              Question {view.number} of {view.of}
            </span>
            {secondsLeft !== null ? (
              <span className="countdown" data-testid="countdown">
                {secondsLeft} s left
              </span>
            ) : (
              <span className="muted">Next question soon</span>
            )}
          </div>
          <h2>{view.question.text}</h2>
          <div className="choices" role="group" aria-label="Answers">
            {view.question.choices.map((choice, i) => {
              const classes = ['choice'];
              if (myAnswer === i) classes.push('choice-mine');
              if (revealing && view.correct === i) classes.push('choice-correct');
              else if (revealing && myAnswer === i) classes.push('choice-wrong');
              return (
                <button
                  key={i}
                  type="button"
                  className={classes.join(' ')}
                  aria-pressed={myAnswer === i}
                  disabled={!asking || mySeat === null || myAnswer !== undefined || pending > 0}
                  onClick={() => {
                    // Errors show up in actionError; the hook's act() never rejects.
                    void act('answer', { choice: i });
                  }}
                >
                  <span className="letter">{LETTERS[i]}</span> {choice}
                </button>
              );
            })}
          </div>
          {asking ? (
            <p className="muted small">
              Answered:{' '}
              {occupied
                .filter((p) => submitted.has(p.seat))
                .map((p) => p.player.name)
                .join(', ') || 'nobody yet'}
            </p>
          ) : null}
        </section>
      )}

      {alert ? (
        <p role="alert" className="error">
          {alert}
        </p>
      ) : null}

      <p className="muted small">
        Share this page&apos;s address to invite people. <a href="#/">Lobby</a>
      </p>
    </main>
  );
}
