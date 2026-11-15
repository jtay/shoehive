import { useState, useSyncExternalStore, type SyntheticEvent, type ReactNode } from 'react';
import { blackjackValue, cardName, rankOf, suitOf, type Card } from 'shoehive/cards';
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
import type { blackjack } from '../src/game';

type Blackjack = typeof blackjack;
const GAME_ID = 'blackjack';
const LOBBY_FILTER = { games: [GAME_ID] };

const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;
const OUTCOME_LABELS = {
  blackjack: 'Blackjack',
  win: 'Win',
  push: 'Push',
  lose: 'Lose',
  bust: 'Bust',
} as const;

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
  NOT_PARTICIPANT: 'You sat down mid-round. You can bet in the next hand.',
  ROUND_CLOSED: 'Betting is closed for this hand.',
  ALREADY_SUBMITTED: 'You already placed your bet.',
  NO_ACTIVE_HAND: 'You have no active hand.',
  BET_OUT_OF_RANGE: 'That bet is outside the table limits.',
  INSUFFICIENT_FUNDS: 'You do not have enough chips for that.',
  CANNOT_DOUBLE: 'You can only double on your first two cards.',
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
          Blackjack
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
  const client = useClient<[Blackjack]>();
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
  const client = useClient<[Blackjack]>();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tables = (lobby?.tables ?? []).filter((t) => t.game === GAME_ID && t.status !== 'ended');

  const create = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    try {
      // Options are optional: the schema's defaults fill them in (6 decks, bets 10 to 500).
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
        <h1>Blackjack tables</h1>
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

function totalLabel(cards: readonly Card[]): string {
  if (cards.length === 0) return '';
  const value = blackjackValue(cards);
  if (value.blackjack) return 'Blackjack';
  if (value.bust) return `${String(value.total)} (bust)`;
  return `${String(value.total)}${value.soft ? ' (soft)' : ''}`;
}

// ---------------------------------------------------------------------------------

function TableScreen({ tableId }: { tableId: string }): ReactNode {
  const { status, error, table, view, meta, seats, mySeat, pending, actionError, act, sit } =
    useTable<Blackjack>(tableId);
  const now = useServerTime(250);
  const [dealt, setDealt] = useState<number | null>(null);
  const [betDraft, setBetDraft] = useState<string | null>(null);
  useTableEvent(table, 'dealt', (event) => {
    const payload = event.payload as { hand?: number } | null;
    setDealt(payload?.hand ?? null);
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

  const { minBet, maxBet } = meta.options; // typed by the game's options schema
  const phase = meta.phase;
  const turn = meta.turn?.seat ?? null;
  const canSit = mySeat === null && seats.some((s) => s.status === 'empty');
  const nameOf = (seat: number): string => seats[seat]?.player?.name ?? `Seat ${String(seat + 1)}`;
  const submitted = new Set(meta.round?.submitted ?? []);
  // A player who sat after betting opened is not in this round: they bet next hand.
  const inRound = mySeat !== null && (meta.round?.participants.includes(mySeat) ?? false);
  const canBet = phase === 'betting' && inRound && !submitted.has(mySeat);
  const myHand = mySeat === null ? null : (view.hands[mySeat] ?? null);
  const myTurn = phase === 'play' && mySeat !== null && turn === mySeat && myHand?.done === false;
  const canDouble = myTurn && myHand.cards.length === 2;

  const seconds =
    phase === 'betting'
      ? secondsUntil(meta.round?.deadline, now)
      : phase === 'play'
        ? secondsUntil(meta.turn?.deadline, now)
        : null;

  let headline: string;
  if (phase === null || meta.status === 'waiting') headline = 'Waiting for players';
  else if (phase === 'betting')
    headline = canBet
      ? 'Place your bet'
      : mySeat === null
        ? 'Betting is open'
        : inRound
          ? 'Bet placed, waiting for the others'
          : 'You can bet from the next hand';
  else if (phase === 'play')
    headline = myTurn ? 'Your turn' : turn === null ? 'Dealing' : `Waiting for ${nameOf(turn)}`;
  else headline = 'Hand settled';

  const betText = betDraft ?? String(minBet);
  const betAmount = Number(betText);
  const betValid =
    Number.isInteger(betAmount) && betAmount >= minBet && betAmount <= maxBet && pending === 0;

  // The hook's sit() and act() never reject: failures show up in actionError.
  const placeBet = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (betValid) void act('bet', { amount: betAmount });
  };
  const alert = actionError ? describeError(actionError) : null;

  const dealerCards = view.dealer;
  const dealerTotal = view.dealerTotal;

  return (
    <main>
      <p className="muted small">
        Hand {view.handNumber}
        {dealt === view.handNumber ? ', dealt' : ''} / {view.shoe.remaining} cards in the shoe /
        bets {minBet} to {maxBet}
      </p>

      <section className="dealer" aria-label="Dealer" data-testid="dealer">
        <h2>Dealer</h2>
        <div className="cards">
          {dealerCards.map((card, i) => (
            <PlayingCard key={i} card={card} testId={`dealer-card-${String(i)}`} />
          ))}
        </div>
        <span className="total" data-testid="dealer-total">
          {dealerTotal ?? ''}
        </span>
      </section>

      <p role="status" className="headline">
        {headline}
      </p>
      {seconds !== null ? (
        <p className="countdown muted" data-testid="countdown">
          {seconds} s left
        </p>
      ) : null}

      <ul className="seats">
        {seats.map((seat, i) => {
          const hand = view.hands[i] ?? null;
          const outcome = hand?.outcome ?? null;
          return (
            <li
              key={i}
              data-testid={`seat-${String(i)}`}
              className={phase === 'play' && turn === i ? 'seat seat-turn' : 'seat'}
            >
              <div className="seat-head">
                <span className="seat-name">
                  {seat.player ? seat.player.name : 'Empty seat'}
                  {i === mySeat ? ' (you)' : ''}
                </span>
                {seat.player ? (
                  <span className={seat.connected ? 'presence online' : 'presence offline'}>
                    {seat.connected ? 'online' : 'offline'}
                  </span>
                ) : null}
              </div>
              {seat.player ? (
                <>
                  <div className="chips">
                    Bankroll{' '}
                    <strong data-testid={`bankroll-${String(i)}`}>{view.bankroll[i]}</strong>
                    {hand ? (
                      <>
                        {' '}
                        / Bet <strong data-testid={`bet-${String(i)}`}>{hand.bet}</strong>
                        {hand.doubled ? ' (doubled)' : ''}
                      </>
                    ) : null}
                  </div>
                  {hand ? (
                    <div className="hand">
                      <div className="cards">
                        {hand.cards.map((card, c) => (
                          <PlayingCard key={c} card={card} />
                        ))}
                      </div>
                      <span className="total" data-testid={`total-${String(i)}`}>
                        {totalLabel(hand.cards)}
                      </span>
                      {outcome ? (
                        <span
                          className={`badge badge-${outcome}`}
                          data-testid={`outcome-${String(i)}`}
                        >
                          {OUTCOME_LABELS[outcome]}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
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

      {canBet ? (
        <form className="controls" onSubmit={placeBet}>
          <label>
            Bet amount{' '}
            <input
              type="number"
              inputMode="numeric"
              min={minBet}
              max={maxBet}
              step={1}
              value={betText}
              onChange={(event) => {
                setBetDraft(event.target.value);
              }}
            />
          </label>
          <button type="submit" className="primary" disabled={!betValid}>
            Bet
          </button>
        </form>
      ) : null}

      {myTurn ? (
        <div className="controls" role="group" aria-label="Your move">
          <button
            type="button"
            disabled={pending > 0}
            onClick={() => {
              void act('hit');
            }}
          >
            Hit
          </button>
          <button
            type="button"
            disabled={pending > 0}
            onClick={() => {
              void act('stand');
            }}
          >
            Stand
          </button>
          <button
            type="button"
            disabled={pending > 0 || !canDouble}
            onClick={() => {
              void act('double');
            }}
          >
            Double
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
