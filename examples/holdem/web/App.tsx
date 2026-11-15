import { useState, useSyncExternalStore, type SyntheticEvent, type ReactNode } from 'react';
import { cardName, rankOf, suitOf, type Card } from 'shoehive/cards';
import { isShoehiveError } from 'shoehive/client';
import {
  useClient,
  useConnection,
  useLobby,
  useServerTime,
  useTable,
  useTableEvent,
} from 'shoehive/react';
// Type-only: the browser bundle gets the game's types, never its server code.
import type { holdem } from '../src/game';

type Holdem = typeof holdem;
const GAME_ID = 'holdem';
const LOBBY_FILTER = { games: [GAME_ID] };

const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;

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
  CANNOT_CHECK: 'You cannot check: there is a bet to call.',
  NOTHING_TO_CALL: 'There is nothing to call.',
  RAISE_NOT_ALLOWED: 'You cannot raise now. You can call or fold.',
  RAISE_TOO_SMALL: 'That raise is too small.',
  NOT_ENOUGH_CHIPS: 'You do not have that many chips.',
  IN_HAND: 'You cannot rebuy while you are in a hand.',
  HAS_CHIPS: 'You still have chips.',
  INSUFFICIENT_FUNDS: 'Your wallet cannot cover the buy-in.',
  NOT_SEATED: 'Take a seat to play.',
  TABLE_FULL: 'All seats are taken.',
};

function describeError(error: unknown): string {
  if (isShoehiveError(error)) return FRIENDLY_ERRORS[error.code] ?? error.message;
  return error instanceof Error ? error.message : String(error);
}

function secondsUntil(deadline: number | null | undefined, now: number): number | null {
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
}

// ---------------------------------------------------------------------------------

export function App(): ReactNode {
  const tableId = useTableRoute();
  const { status, player } = useConnection();
  return (
    <div className="app">
      <header className="bar">
        <a className="brand" href="#/">
          Texas Hold&apos;em
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

function NameForm(): ReactNode {
  const client = useClient<[Holdem]>();
  const { player } = useConnection();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = draft ?? player?.name ?? '';

  const save = async (event: SyntheticEvent): Promise<void> => {
    event.preventDefault();
    const next = name.trim();
    if (!next) return;
    try {
      await client.rename(next);
      setDraft(null);
      setError(null);
    } catch (err) {
      setError(describeError(err));
    }
  };

  return (
    <form
      className="row name-form"
      onSubmit={(event) => {
        void save(event);
      }}
    >
      <label>
        Your name{' '}
        <input
          value={name}
          maxLength={32}
          disabled={!player}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
      </label>
      <button type="submit" disabled={!player || !name.trim() || name.trim() === player.name}>
        Save name
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

function Lobby(): ReactNode {
  const lobby = useLobby({ filter: LOBBY_FILTER });
  const client = useClient<[Holdem]>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tables = (lobby?.tables ?? []).filter((t) => t.game === GAME_ID && t.status !== 'ended');

  const create = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    try {
      // Options are optional: the schema's defaults fill them in (blinds 5/10, buy-in 200).
      const id = await client.createTable(GAME_ID);
      window.location.hash = tableHref(id);
    } catch (err) {
      setError(describeError(err));
      setCreating(false);
    }
  };

  return (
    <main>
      <NameForm />
      <div className="row">
        <h1>Hold&apos;em tables</h1>
        <button type="button" disabled={creating} onClick={() => void create()}>
          New table
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {lobby === null ? (
        <p className="muted">Loading...</p>
      ) : tables.length === 0 ? (
        <p className="muted">No open tables. Start one!</p>
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

// ---------------------------------------------------------------------------------
// Cards

function PlayingCard({ card, testId }: { card: Card | null; testId?: string }): ReactNode {
  if (card === null) {
    return (
      <span
        role="img"
        aria-label="Face-down card"
        className="card card-back"
        data-testid={testId ?? 'card-back'}
      />
    );
  }
  const suit = suitOf(card);
  const rank = rankOf(card);
  return (
    <span
      role="img"
      aria-label={cardName(card)}
      className={suit === 'H' || suit === 'D' ? 'card card-red' : 'card'}
      data-testid={testId ?? 'card-face'}
    >
      {rank === 'T' ? '10' : rank}
      {SUIT_SYMBOLS[suit]}
    </span>
  );
}

// ---------------------------------------------------------------------------------

interface ActionEvent {
  seat: number;
  action: string;
  to?: number;
  amount?: number;
  timeout?: boolean;
  left?: boolean;
}

function describeAction(event: ActionEvent, name: string): string {
  const suffix = event.timeout ? ' (timed out)' : event.left ? ' (left the table)' : '';
  switch (event.action) {
    case 'fold':
      return `${name} folded${suffix}`;
    case 'check':
      return `${name} checked${suffix}`;
    case 'call':
      return `${name} called ${String(event.amount ?? '')}`;
    case 'raise':
      return `${name} raised to ${String(event.to ?? '')}`;
    case 'allIn':
      return `${name} is all-in${event.to ? ` to ${String(event.to)}` : ''}`;
    default:
      return `${name}: ${event.action}`;
  }
}

function TableScreen({ tableId }: { tableId: string }): ReactNode {
  const { status, error, table, view, meta, seats, mySeat, pending, actionError, act, sit } =
    useTable<Holdem>(tableId);
  const now = useServerTime(250);
  const [lastAction, setLastAction] = useState<{ hand: number; text: string } | null>(null);
  const [raiseDraft, setRaiseDraft] = useState<string | null>(null);
  const handNumber = view?.hand ?? 0;
  useTableEvent(table, 'action', (event) => {
    const payload = event.payload as unknown as ActionEvent;
    const name = seats[payload.seat]?.player?.name ?? `Seat ${String(payload.seat + 1)}`;
    setLastAction({ hand: handNumber, text: describeAction(payload, name) });
  });

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

  const { smallBlind, bigBlind, buyIn } = meta.options; // typed by the game's options schema
  const phase = meta.phase;
  const betting = phase === 'preflop' || phase === 'flop' || phase === 'turn' || phase === 'river';
  const turn = meta.turn?.seat ?? null;
  const canSit = mySeat === null && seats.some((s) => s.status === 'empty');
  const nameOf = (seat: number): string => seats[seat]?.player?.name ?? `Seat ${String(seat + 1)}`;
  const me = mySeat === null ? null : (view.seats[mySeat] ?? null);
  const myTurn = betting && mySeat !== null && turn === mySeat;
  const toCall = me ? Math.min(view.currentBet - me.bet, me.stack) : 0;
  const maxTo = me ? me.stack + me.bet : 0;
  const minTo = Math.min(view.minRaiseTo, maxTo);
  // Someone else must still be able to act, else a raise has nobody to answer it.
  const canRaise =
    myTurn &&
    maxTo > view.currentBet &&
    view.seats.some((s, i) => i !== mySeat && s.inHand && !s.folded && s.stack > 0);
  const raiseText = raiseDraft ?? String(minTo);
  const raiseAmount = Number(raiseText);
  const raiseValid =
    Number.isInteger(raiseAmount) && raiseAmount >= minTo && raiseAmount <= maxTo && pending === 0;
  const raiseVerb = view.currentBet === 0 ? 'Bet' : 'Raise';
  const needsRebuy =
    me !== null && me.stack === 0 && !(betting && me.inHand && !me.folded) && mySeat !== null;

  const handOver = phase === 'showdown' && view.last !== null;
  const nextHandSeconds = secondsUntil(meta.timers['nextHand'], now);
  const turnSeconds = betting ? secondsUntil(meta.turn?.deadline, now) : null;

  let headline: string;
  if (phase === 'waiting' || phase === null) headline = 'Waiting for players';
  else if (phase === 'showdown') headline = 'Hand over';
  else headline = myTurn ? 'Your turn' : turn === null ? 'Dealing' : `Waiting for ${nameOf(turn)}`;

  // The hook's sit() and act() never reject: failures show up in actionError.
  const submitRaise = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (!raiseValid) return;
    setRaiseDraft(null);
    void act(view.currentBet === 0 ? 'bet' : 'raise', { amount: raiseAmount });
  };
  const alert = actionError ? describeError(actionError) : null;
  const result = view.last;

  return (
    <main>
      <p className="muted small">
        Hand {view.hand} / blinds {smallBlind}/{bigBlind} / buy-in {buyIn}
      </p>

      <section className="felt" aria-label="Board">
        <div className="cards" data-testid="board">
          {view.board.map((card, i) => (
            <PlayingCard key={i} card={card} testId="board-card" />
          ))}
        </div>
        <span className="pot">
          Pot <strong data-testid="pot">{view.pot}</strong>
        </span>
      </section>

      <p role="status" className="headline">
        {headline}
      </p>
      {turnSeconds !== null ? (
        <p className="countdown muted" data-testid="countdown">
          {turnSeconds} s left
        </p>
      ) : handOver && nextHandSeconds !== null ? (
        <p className="countdown muted" data-testid="countdown">
          Next hand in {nextHandSeconds} s
        </p>
      ) : null}
      {lastAction?.hand === view.hand && betting ? (
        <p className="muted small center" data-testid="last-action">
          {lastAction.text}
        </p>
      ) : null}
      {handOver && result ? (
        <div className="result" data-testid="result">
          {result.pots.map((pot, i) => (
            <p key={i}>
              {pot.winners.map(nameOf).join(' and ')} won {pot.amount}
              {pot.winners.length > 1 ? ' (split)' : ''}
              {result.uncontested ? ' (everyone else folded)' : ''}
            </p>
          ))}
          {result.hands.map((description, i) =>
            description ? (
              <p key={i} className="muted small">
                {nameOf(i)} showed {description}
              </p>
            ) : null,
          )}
        </div>
      ) : null}

      <ul className="seats">
        {seats.map((seat, i) => {
          const s = view.seats[i];
          if (!seat.player || !s) {
            return (
              <li key={i} data-testid={`seat-${String(i)}`} className="seat seat-empty">
                <span className="muted">Seat {i + 1}: empty</span>
              </li>
            );
          }
          const markers: string[] = [];
          if (s.inHand && view.button === i) markers.push('D');
          if (s.inHand && view.smallBlind === i) markers.push('SB');
          if (s.inHand && view.bigBlind === i) markers.push('BB');
          const showCards = s.hole.length > 0 && (i === mySeat || !s.folded);
          return (
            <li
              key={i}
              data-testid={`seat-${String(i)}`}
              className={`seat${betting && turn === i ? ' seat-turn' : ''}${s.folded ? ' seat-folded' : ''}`}
            >
              <div className="seat-head">
                <span className="seat-name">
                  {seat.player.name}
                  {i === mySeat ? ' (you)' : ''}
                </span>
                {markers.length > 0 ? (
                  <span className="markers" data-testid={`markers-${String(i)}`}>
                    {markers.map((m) => (
                      <span key={m} className="marker">
                        {m}
                      </span>
                    ))}
                  </span>
                ) : null}
                {s.folded && s.inHand ? <span className="badge">Folded</span> : null}
                {s.allIn ? <span className="badge badge-allin">All-in</span> : null}
                <span className={seat.connected ? 'presence online' : 'presence offline'}>
                  {seat.connected ? 'online' : 'offline'}
                </span>
              </div>
              <div className="chips">
                Stack <strong data-testid={`stack-${String(i)}`}>{s.stack}</strong> / Bet{' '}
                <strong data-testid={`bet-${String(i)}`}>{s.bet}</strong>
                {result && handOver && result.won[i] ? (
                  <span className="won"> +{result.won[i]}</span>
                ) : null}
              </div>
              <div
                className={`cards${showCards ? '' : ' cards-empty'}`}
                data-testid={`hole-${String(i)}`}
              >
                {showCards ? s.hole.map((card, c) => <PlayingCard key={c} card={card} />) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {canSit ? (
        <button
          type="button"
          className="primary"
          onClick={() => {
            void sit();
          }}
        >
          Take a seat
        </button>
      ) : null}

      {needsRebuy ? (
        <div className="controls">
          <span>You are out of chips.</span>
          <button
            type="button"
            className="primary"
            disabled={pending > 0}
            onClick={() => {
              void act('rebuy');
            }}
          >
            Rebuy {buyIn}
          </button>
        </div>
      ) : null}

      {myTurn ? (
        <div className="controls" role="group" aria-label="Your move">
          <button
            type="button"
            disabled={pending > 0}
            onClick={() => {
              void act('fold');
            }}
          >
            Fold
          </button>
          {toCall > 0 ? (
            <button
              type="button"
              disabled={pending > 0}
              onClick={() => {
                void act('call');
              }}
            >
              Call {toCall}
            </button>
          ) : (
            <button
              type="button"
              disabled={pending > 0}
              onClick={() => {
                void act('check');
              }}
            >
              Check
            </button>
          )}
          {canRaise ? (
            <form className="inline-form" onSubmit={submitRaise}>
              <label>
                {raiseVerb} to{' '}
                <input
                  type="number"
                  inputMode="numeric"
                  min={minTo}
                  max={maxTo}
                  step={1}
                  value={raiseText}
                  onChange={(event) => {
                    setRaiseDraft(event.target.value);
                  }}
                />
              </label>
              <button type="submit" disabled={!raiseValid}>
                {raiseVerb}
              </button>
            </form>
          ) : null}
          <button
            type="button"
            disabled={pending > 0 || maxTo === 0}
            onClick={() => {
              void act('allIn');
            }}
          >
            All-in {maxTo}
          </button>
        </div>
      ) : null}

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
