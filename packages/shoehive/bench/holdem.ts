// A 9-seat Hold'em-like betting game and a harness that measures one unit of work:
// one committed betting action, then all 9 seat views plus the spectator view, each
// diffed against that viewer's previous view (ADR 0005 point 7, ADR 0003).
//
// Shared by holdem-betting.bench.ts (Vitest bench) and latency.ts (percentiles).

import { z } from 'zod';
import {
  defineGame,
  diff,
  reject,
  TableRuntime,
  type ActionCtx,
  type Json,
  type Viewer,
} from '../src/index';
import { FakeClock } from '../src/testing/index';

export const SEATS = 9;
const STARTING_CHIPS = 10_000;
const BIG_BLIND = 20;
const TURN_MS = 30_000;

const RANKS = '23456789TJQKA';
const SUITS = 'cdhs';
const DECK: readonly string[] = Array.from(RANKS).flatMap((r) =>
  Array.from(SUITS).map((s) => r + s),
);

interface SeatState {
  chips: number;
  /** Chips put in on the current street. */
  bet: number;
  folded: boolean;
  /** Hidden from everyone but the seat's owner. */
  hole: string[];
}

interface HoldemState {
  hand: number;
  deck: string[];
  community: string[];
  pot: number;
  /** The highest `bet` on the current street. */
  toCall: number;
  /** Actions taken on the current street. */
  streetActions: number;
  seats: SeatState[];
  log: string[];
}

type Ctx = ActionCtx<undefined, 'betting'>;

function live(state: HoldemState): number[] {
  const seats: number[] = [];
  state.seats.forEach((s, i) => {
    if (!s.folded) seats.push(i);
  });
  return seats;
}

function deal(state: HoldemState, ctx: Ctx): void {
  state.hand += 1;
  state.deck = ctx.random.shuffle(DECK);
  state.community = [];
  state.pot = 0;
  state.toCall = 0;
  state.streetActions = 0;
  for (const seat of state.seats) {
    if (seat.chips < BIG_BLIND * 10) seat.chips = STARTING_CHIPS; // rebuy, so the table never runs dry
    seat.bet = 0;
    seat.folded = false;
    seat.hole = [state.deck.pop()!, state.deck.pop()!];
  }
  state.log.push(`hand ${state.hand}`);
  if (state.log.length > 20) state.log.shift();
}

function collect(state: HoldemState): void {
  for (const seat of state.seats) {
    state.pot += seat.bet;
    seat.bet = 0;
  }
  state.toCall = 0;
  state.streetActions = 0;
}

/** Awards the pot to the first live seat and deals the next hand. */
function showdown(state: HoldemState, ctx: Ctx): void {
  collect(state);
  const winner = live(state)[0]!;
  state.seats[winner]!.chips += state.pot;
  state.log.push(`seat ${winner} wins ${state.pot}`);
  deal(state, ctx);
}

/** Moves the turn on, closing streets and hands as they finish. */
function advance(state: HoldemState, ctx: Ctx): void {
  state.streetActions += 1;
  const players = live(state);
  if (players.length === 1) {
    showdown(state, ctx);
  } else if (
    state.streetActions >= players.length &&
    players.every((i) => state.seats[i]!.bet === state.toCall)
  ) {
    collect(state);
    if (state.community.length === 5) showdown(state, ctx);
    else state.community.push(...state.deck.splice(-(state.community.length === 0 ? 3 : 1)));
  }
  ctx.turn.next();
}

export const holdem = defineGame({
  id: 'bench-holdem',
  seats: { min: SEATS, max: SEATS },
  setup: ({ seats }): HoldemState => ({
    hand: 0,
    deck: [],
    community: [],
    pot: 0,
    toCall: 0,
    streetActions: 0,
    seats: Array.from({ length: seats }, () => ({
      chips: STARTING_CHIPS,
      bet: 0,
      folded: false,
      hole: [],
    })),
    log: [],
  }),
  onStart: ({ state, ctx }) => {
    deal(state, ctx);
  },
  phases: {
    betting: {
      turns: {
        order: 'round-robin',
        skip: ({ seat, state }) => (state as HoldemState).seats[seat]!.folded,
        timeoutMs: TURN_MS,
        onTimeout: 'timeout',
      },
      actions: {
        bet: {
          input: z.object({ amount: z.number().int().positive() }),
          run({ state, seat, input, ctx }) {
            if (ctx.turn.seat !== seat) reject('NOT_YOUR_TURN');
            const s = state.seats[seat]!;
            const total = state.toCall + input.amount - s.bet;
            if (total > s.chips) reject('NOT_ENOUGH_CHIPS');
            s.chips -= total;
            s.bet += total;
            state.toCall = s.bet;
            advance(state, ctx);
          },
        },
        call: {
          run({ state, seat, ctx }) {
            if (ctx.turn.seat !== seat) reject('NOT_YOUR_TURN');
            const s = state.seats[seat]!;
            const owed = Math.min(state.toCall - s.bet, s.chips);
            s.chips -= owed;
            s.bet += owed;
            advance(state, ctx);
          },
        },
        fold: {
          run({ state, seat, ctx }) {
            if (ctx.turn.seat !== seat) reject('NOT_YOUR_TURN');
            state.seats[seat]!.folded = true;
            advance(state, ctx);
          },
        },
        timeout: {
          internal: true,
          input: z.object({ seat: z.number().int() }),
          run({ state, input, ctx }) {
            const { seat } = input;
            state.seats[seat]!.folded = true;
            advance(state, ctx);
          },
        },
      },
    },
  },
  view: ({ state, viewer }) => ({
    hand: state.hand,
    community: state.community,
    pot: state.pot,
    toCall: state.toCall,
    log: state.log,
    seats: state.seats.map((s, i) => ({
      chips: s.chips,
      bet: s.bet,
      folded: s.folded,
      hole: viewer.seats.includes(i) ? s.hole : s.hole.map(() => null),
    })),
  }),
});

/** The actions the driver cycles through: mostly calls, some raises, an occasional fold. */
const SCRIPT = [
  'call',
  'bet',
  'call',
  'call',
  'fold',
  'call',
  'call',
  'bet',
  'call',
  'call',
  'call',
] as const;

export interface Harness {
  runtime: TableRuntime;
  /** One committed action, then 10 views and 10 diffs. Returns the patch op count. */
  step(): Promise<number>;
  /** Times the three parts of one step separately (ms). */
  stepTimed(): Promise<{ act: number; views: number; diffs: number; ops: number }>;
}

export async function createHarness(options: { dev: boolean }): Promise<Harness> {
  const clock = new FakeClock();
  const runtime = await TableRuntime.create(holdem, {
    dev: options.dev,
    clock,
    seed: 'bench',
    id: 'bench',
  });
  const players = Array.from({ length: SEATS }, (_, i) => `p${String(i)}`);
  for (const id of players) await runtime.sit({ player: { id, name: id } });
  await runtime.idle();
  if (runtime.status !== 'active')
    throw new Error(`bench table did not start (status ${runtime.status})`);

  const viewers: Viewer[] = [
    ...players.map((id) => runtime.viewerFor(id)),
    runtime.viewerFor(null),
  ];
  const previous: Json[] = viewers.map((v) => runtime.view(v));
  let cursor = 0;

  const act = async (): Promise<void> => {
    const seat = runtime.engine.turn?.seat;
    if (seat == null) throw new Error('no seat to act');
    const name = SCRIPT[cursor++ % SCRIPT.length]!;
    const input = name === 'bet' ? { amount: BIG_BLIND } : undefined;
    await runtime.act({ player: players[seat]!, name, input });
  };

  const viewsAndDiffs = (): number => {
    let ops = 0;
    for (let i = 0; i < viewers.length; i++) {
      const next = runtime.view(viewers[i]!);
      ops += diff(previous[i]!, next).length;
      previous[i] = next;
    }
    return ops;
  };

  return {
    runtime,
    async step() {
      await act();
      return viewsAndDiffs();
    },
    async stepTimed() {
      const t0 = performance.now();
      await act();
      const t1 = performance.now();
      const next = viewers.map((v) => runtime.view(v));
      const t2 = performance.now();
      let ops = 0;
      for (let i = 0; i < next.length; i++) ops += diff(previous[i]!, next[i]!).length;
      const t3 = performance.now();
      next.forEach((view, i) => (previous[i] = view));
      return { act: t1 - t0, views: t2 - t1, diffs: t3 - t2, ops };
    },
  };
}
