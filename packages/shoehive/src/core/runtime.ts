// TableRuntime: one running table (ADRs 0001, 0003, 0005, 0006, 0008).
//
// Every change to a table is an *entry* (action, timer firing or system event) run
// through a serial queue. An entry runs against a Mutative draft of { state, engine }
// and either commits completely or is discarded. Committed entries are appended to the
// log; the state is a pure function of that log, which powers tests, replay, restart
// recovery and devtools time travel.

import { create } from 'mutative';
import { systemClock, type Clock, type TimerHandle } from './clock';
import type {
  ActionCtx,
  ActionDef,
  AnyGame,
  CtxRound,
  CtxTurn,
  EventAudience,
  Hook,
  PhaseDef,
  ReadCtx,
  RoundInfo,
  RoundsConfig,
  SeatInfo,
  TableStatus,
  TurnInfo,
  TurnsConfig,
  Viewer,
} from './define';
import { isShoehiveError, shoehiveError, ShoehiveError } from './errors';
import { guarded } from './guard';
import { findNonJson, jsonEqual, type Json } from './json';
import { createRandom, normalizeSeed, randomSeed, WordStream, type Random } from './random';
import type { StandardSchemaV1 } from './standard-schema';

// ---------------------------------------------------------------------------------
// Log and engine state

export interface LogEntryBase {
  /** Position in the log. The create entry is 0. Equals the table rev after commit. */
  seq: number;
  /** Entry time (epoch ms), read once from the clock (ADR 0006). */
  at: number;
  /** Every 32-bit random word the entry consumed. */
  draws: number[];
}

export type LogEntry = LogEntryBase &
  (
    | { kind: 'create'; table: string; game: string; version: number; seed: string; options: Json }
    | { kind: 'action'; name: string; seat: number; player: string; input: Json }
    | { kind: 'timer'; name: string; action: string; input: Json }
    | { kind: 'system'; event: 'sit'; seat: number; player: { id: string; name: string } }
    | {
        kind: 'system';
        event: 'stand' | 'disconnect' | 'reconnect' | 'grace-expired';
        seat: number;
        player: string | null;
      }
    | { kind: 'system'; event: 'start' | 'round-close'; seat: null; player: null }
  );

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EntryInput = DistributiveOmit<LogEntry, keyof LogEntryBase>;

export interface TimerState {
  deadline: number;
  action: string;
  input: Json;
}

export interface EngineSeat {
  status: 'empty' | 'occupied' | 'reserved';
  player: { id: string; name: string } | null;
  connected: boolean;
}

/** Engine bookkeeping. Part of every transaction and every snapshot. */
export interface EngineState {
  rev: number;
  seq: number;
  table: string;
  game: { id: string; version: number };
  /** The RNG seed. Secret: never sent to clients (ADR 0006). */
  seed: string;
  /** Number of random words consumed so far. */
  rng: number;
  status: TableStatus;
  phase: string | null;
  turn: { order: number[]; seat: number | null; number: number } | null;
  round: {
    number: number;
    open: boolean;
    participants: number[];
    submitted: number[];
    deadline: number | null;
  } | null;
  timers: Record<string, TimerState>;
  seats: EngineSeat[];
  options: Json;
  result: Json;
}

interface Root {
  state: unknown;
  engine: EngineState;
}

/** A point-in-time copy of a table, enough to resume from (ADR 0009). */
export interface Snapshot {
  format: 1;
  seq: number;
  root: { state: Json; engine: EngineState };
}

export interface EmittedEvent {
  name: string;
  payload: Json;
  to: EventAudience;
}

export interface Commit {
  rev: number;
  entry: LogEntry;
  events: EmittedEvent[];
}

/** Table metadata sent to clients (protocol section 6.1). */
export interface TableMeta {
  game: string;
  status: TableStatus;
  phase: string | null;
  turn: { seat: number | null; deadline: number | null } | null;
  round: { number: number; deadline: number | null; submitted: number[] } | null;
  options: Json;
  result: Json;
}

export interface Diagnostic {
  at: number;
  name: string;
  seat: number | null;
  player: string | null;
  code: string;
  message: string;
}

/** Thrown when replaying a log does not reproduce it exactly (ADR 0006). */
export class ReplayDivergenceError extends Error {
  override readonly name = 'ReplayDivergenceError';
  constructor(
    readonly seq: number,
    reason: string,
  ) {
    super(`Replay diverged at entry ${String(seq)}: ${reason}`);
  }
}

export interface RuntimeOptions {
  /** Defaults to `globalThis.process?.env.NODE_ENV !== 'production'`. */
  dev?: boolean;
  clock?: Clock;
}

/** Thrown (and returned) when an entry turns out to have nothing to do. */
class NoopSignal extends Error {}
const NOOP = new NoopSignal('noop');
const MAX_CHAINED = 1000;
const MAX_FOLLOW_UPS = 1000;
const VALIDATE_TIMEOUT_MS = 1000;
const DIAGNOSTICS = 500;

function defaultDev(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.['NODE_ENV'] !== 'production';
}

// ---------------------------------------------------------------------------------
// Validation helpers (ADR 0004)

type Issue = { path: (string | number)[]; message: string };

function normalizeIssues(issues: readonly StandardSchemaV1.Issue[]): Issue[] {
  return issues.slice(0, 20).map((issue) => ({
    message: issue.message,
    path: (issue.path ?? []).map((segment) => {
      const key = typeof segment === 'object' ? segment.key : segment;
      return typeof key === 'number' ? key : String(key);
    }),
  }));
}

async function runSchema(
  schema: StandardSchemaV1,
  value: unknown,
  code: 'INVALID_INPUT' | 'INVALID_OPTIONS',
  what: string,
): Promise<Json> {
  let result = schema['~standard'].validate(value);
  if (result instanceof Promise) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rejectTimeout) => {
      timer = setTimeout(() => {
        rejectTimeout(
          shoehiveError('BAD_REQUEST', `Validation of ${what} timed out`, { reason: 'timeout' }),
        );
      }, VALIDATE_TIMEOUT_MS);
    });
    try {
      result = await Promise.race([result, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
  if (result.issues) {
    throw shoehiveError(code, `Invalid ${what}`, { issues: normalizeIssues(result.issues) });
  }
  const bad = findNonJson(result.value);
  if (bad) {
    throw shoehiveError(
      'INTERNAL',
      `The schema for ${what} produced a non-JSON value at ${bad.path}: ${bad.reason}`,
    );
  }
  return (result.value ?? null) as Json;
}

type LooseAction = ActionDef<unknown, unknown, unknown, string>;
type LoosePhase = PhaseDef<unknown, unknown, string, string, unknown>;
type LooseRounds = RoundsConfig<unknown, unknown, string>;
type LooseHook = Hook<unknown, unknown, string>;
type LooseCtx = ActionCtx<unknown, string>;

interface Tx {
  draft: Root;
  at: number;
  draws: number[];
  events: EmittedEvent[];
  after: (() => Promise<void>)[];
}

// ---------------------------------------------------------------------------------

/**
 * One running table. The server creates one per table; `shoehive/testing` drives it
 * directly. All mutating methods are queued and run one at a time.
 */
export class TableRuntime {
  readonly game: AnyGame;
  private root: Root;
  private readonly entries: LogEntry[] = [];
  private readonly stream: WordStream;
  private readonly clock: Clock;
  readonly dev: boolean;
  private live: boolean;
  private disposed = false;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private readonly armed = new Map<string, { deadline: number; handle: TimerHandle }>();
  private readonly listeners = new Set<(commit: Commit) => void>();
  private readonly viewCache = new Map<string, Json>();
  private viewCacheRev = -1;
  private readonly diag: Diagnostic[] = [];

  private constructor(game: AnyGame, root: Root, options: RuntimeOptions, live: boolean) {
    this.game = game;
    this.root = root;
    this.clock = options.clock ?? systemClock;
    this.dev = options.dev ?? defaultDev();
    this.live = live;
    this.stream = new WordStream(root.engine.seed);
  }

  // -------------------------------------------------------------------------------
  // Creation, replay and snapshots

  /** Creates a new table: validates options, seeds the RNG and runs `setup`. */
  static async create(
    game: AnyGame,
    args: RuntimeOptions & { id?: string; options?: unknown; seed?: string } = {},
  ): Promise<TableRuntime> {
    const options =
      game.options === undefined
        ? rejectUnexpectedOptions(args.options)
        : await runSchema(game.options, args.options, 'INVALID_OPTIONS', 'table options');
    const seed = normalizeSeed(args.seed ?? randomSeed());
    const clock = args.clock ?? systemClock;
    const table = args.id ?? `t_${seed.slice(0, 12)}`;
    const entry: LogEntry = {
      seq: 0,
      at: clock.now(),
      draws: [],
      kind: 'create',
      table,
      game: game.id,
      version: game.version ?? 1,
      seed,
      options,
    };
    return TableRuntime.fromCreate(game, entry, args, true);
  }

  private static fromCreate(
    game: AnyGame,
    entry: Extract<LogEntry, { kind: 'create' }>,
    options: RuntimeOptions,
    live: boolean,
  ): TableRuntime {
    const engine: EngineState = {
      rev: 0,
      seq: 0,
      table: entry.table,
      game: { id: entry.game, version: entry.version },
      seed: entry.seed,
      rng: 0,
      status: 'waiting',
      phase: null,
      turn: null,
      round: null,
      timers: {},
      seats: Array.from({ length: game.seats.max }, () => ({
        status: 'empty',
        player: null,
        connected: false,
      })),
      options: entry.options,
      result: null,
    };
    const runtime = new TableRuntime(game, { state: null, engine }, options, live);
    const draws: number[] = [];
    let cursor = 0;
    const random = createRandom({
      stream: runtime.stream,
      cursor: () => cursor,
      advance: () => {
        cursor += 1;
      },
      record: (w) => draws.push(w),
    });
    let state: unknown;
    try {
      state = guarded(runtime.dev, (): unknown =>
        game.setup({ options: entry.options as never, random, seats: game.seats.max }),
      );
    } catch (error) {
      throw runtime.normalize(error);
    }
    runtime.checkJson(state, 'setup() returned state that is not JSON');
    engine.rng = cursor;
    runtime.root = runtime.freeze({ state, engine });
    runtime.entries.push({ ...entry, draws });
    return runtime;
  }

  /**
   * Rebuilds a table from its log, optionally starting from a snapshot. With
   * `live: true` the result arms its timers and accepts new entries (restart
   * recovery); otherwise it is a read-only copy (tests, devtools).
   */
  static async replay(
    game: AnyGame,
    log: readonly LogEntry[],
    args: RuntimeOptions & { from?: Snapshot; until?: number; live?: boolean } = {},
  ): Promise<TableRuntime> {
    let runtime: TableRuntime;
    let rest: readonly LogEntry[];
    if (args.from) {
      const root = structuredClone(args.from.root) as Root;
      runtime = new TableRuntime(game, root, args, false);
      runtime.root = runtime.freeze(root);
      rest = log.filter((e) => e.seq > args.from!.seq);
    } else {
      const first = log[0];
      if (first?.kind !== 'create')
        throw new ReplayDivergenceError(0, 'log must start with a create entry');
      runtime = TableRuntime.fromCreate(game, first, args, false);
      const got = runtime.entries[0]!.draws;
      if (!jsonEqual(got, first.draws))
        throw new ReplayDivergenceError(0, 'setup() drew different random numbers');
      runtime.entries[0] = first;
      rest = log.slice(1);
    }
    for (const entry of rest) {
      if (args.until !== undefined && entry.seq > args.until) break;
      if (entry.seq !== runtime.root.engine.seq + 1) {
        throw new ReplayDivergenceError(
          entry.seq,
          `expected seq ${String(runtime.root.engine.seq + 1)}`,
        );
      }
      const { seq: _seq, at: _at, draws: _draws, ...input } = entry;
      let outcome: unknown;
      try {
        outcome = await runtime.run(input, { replay: entry });
      } catch (error) {
        if (error instanceof ReplayDivergenceError) throw error;
        throw new ReplayDivergenceError(
          entry.seq,
          `entry was rejected on replay: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (outcome === NOOP)
        throw new ReplayDivergenceError(entry.seq, 'entry had no effect on replay');
    }
    if (args.live) {
      runtime.live = true;
      runtime.syncTimers();
      runtime.scheduleFollowUps();
    }
    return runtime;
  }

  /** A copy of the table's current state and engine bookkeeping. */
  snapshot(): Snapshot {
    return {
      format: 1,
      seq: this.root.engine.seq,
      root: structuredClone(this.root) as { state: Json; engine: EngineState },
    };
  }

  /** Stops timers and refuses further entries. */
  dispose(): void {
    this.disposed = true;
    for (const { handle } of this.armed.values()) this.clock.clearTimer(handle);
    this.armed.clear();
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------------
  // Read API

  get id(): string {
    return this.root.engine.table;
  }
  get rev(): number {
    return this.root.engine.rev;
  }
  get status(): TableStatus {
    return this.root.engine.status;
  }
  /** The committed raw state. Server-side only: never send it to clients. */
  get state(): unknown {
    return this.root.state;
  }
  /** The committed engine bookkeeping. Treat as read-only. */
  get engine(): Readonly<EngineState> {
    return this.root.engine;
  }
  /** The log of committed entries, oldest first. */
  get log(): readonly LogEntry[] {
    return this.entries;
  }
  /** Recently rejected actions (not part of the log). */
  diagnostics(): readonly Diagnostic[] {
    return this.diag;
  }

  seats(): SeatInfo[] {
    return this.root.engine.seats.map(copySeat);
  }

  meta(): TableMeta {
    const e = this.root.engine;
    return {
      game: e.game.id,
      status: e.status,
      phase: e.phase,
      turn: e.turn ? { seat: e.turn.seat, deadline: e.timers['turn']?.deadline ?? null } : null,
      round: e.round
        ? { number: e.round.number, deadline: e.round.deadline, submitted: [...e.round.submitted] }
        : null,
      options: e.options,
      result: e.result,
    };
  }

  /** The viewer for a player: their seats if they hold any, otherwise a spectator. */
  viewerFor(playerId: string | null): Viewer {
    if (playerId !== null) {
      const seats = this.seatsOf(this.root.engine, playerId);
      if (seats.length > 0) return { kind: 'seat', seat: seats[0]!, seats, playerId };
    }
    return { kind: 'spectator', seat: null, seats: [], playerId: null };
  }

  /** The game's `view()` for `viewer` at the current revision (cached per rev). */
  view(viewer: Viewer): Json {
    if (this.viewCacheRev !== this.root.engine.rev) {
      this.viewCache.clear();
      this.viewCacheRev = this.root.engine.rev;
    }
    const key = viewer.kind === 'spectator' ? 'spectator' : `p:${viewer.playerId}`;
    const cached = this.viewCache.get(key);
    if (cached !== undefined) return cached;
    let result: unknown;
    if (this.game.view) {
      try {
        result = guarded(this.dev, (): unknown =>
          this.game.view!({
            state: this.root.state as never,
            viewer,
            ctx: this.readCtx(this.root.engine),
          }),
        );
      } catch (error) {
        throw this.normalize(error);
      }
      this.checkJson(result, 'view() returned a value that is not JSON');
    } else {
      result = this.root.state;
    }
    this.viewCache.set(key, result as Json);
    return result as Json;
  }

  /** Subscribes to commits. Returns an unsubscribe function. */
  onCommit(listener: (commit: Commit) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves once the queue is empty, including follow-up entries such as auto-start. */
  async idle(): Promise<void> {
    while (this.pending > 0) await this.tail.catch(() => undefined);
  }

  // -------------------------------------------------------------------------------
  // Mutating API (all queued)

  /** Runs a client action. Rejects with a `ShoehiveError`. */
  async act(args: {
    player: string;
    name: string;
    input?: unknown;
    seat?: number;
    rev?: number;
  }): Promise<{ rev: number; result: Json | undefined }> {
    if (this.root.engine.status === 'ended') {
      const ended = shoehiveError('TABLE_ENDED', 'The table has ended');
      this.recordRejection(args, ended);
      throw ended;
    }
    const preDef = this.lookupAction(this.root.engine.phase, args.name);
    if (!preDef || preDef.internal) {
      this.recordRejection(args, shoehiveError('ACTION_NOT_ALLOWED'));
      throw notAllowed(args.name, this.root.engine.phase);
    }
    let input: Json;
    try {
      input = await this.validateInput(preDef, args.name, args.input);
    } catch (error) {
      this.recordRejection(args, error);
      throw error;
    }
    return this.enqueueExternal(async () => {
      const engine = this.root.engine;
      let seat = args.seat;
      if (seat === undefined) {
        const held = this.seatsOf(engine, args.player);
        if (held.length === 0)
          throw shoehiveError('NOT_SEATED', 'You do not hold a seat at this table');
        if (held.length > 1)
          throw shoehiveError('BAD_REQUEST', 'You hold several seats: say which one acts');
        seat = held[0]!;
      }
      if (args.rev !== undefined && args.rev !== engine.rev) {
        throw shoehiveError('STALE_REVISION', 'The table changed since that revision', {
          rev: engine.rev,
        });
      }
      // The phase may have changed while queued; revalidate if the action differs.
      const def = this.lookupAction(engine.phase, args.name);
      if (def && def !== preDef && !def.internal)
        input = await this.validateInput(def, args.name, args.input);
      const result = await this.run({
        kind: 'action',
        name: args.name,
        seat,
        player: args.player,
        input,
      });
      return {
        rev: this.root.engine.rev,
        result: result === NOOP ? undefined : (result as Json | undefined),
      };
    }).catch((error: unknown) => {
      this.recordRejection(args, error);
      throw error;
    });
  }

  /** Seats a player. Without `seat`, takes the lowest free seat. */
  async sit(args: {
    player: { id: string; name: string };
    seat?: number;
  }): Promise<{ seat: number; rev: number }> {
    return this.enqueueExternal(async () => {
      let seat = args.seat;
      if (seat === undefined) {
        seat = this.root.engine.seats.findIndex((s) => s.status === 'empty');
        if (seat < 0) throw shoehiveError('TABLE_FULL', 'No free seat');
      }
      await this.run({
        kind: 'system',
        event: 'sit',
        seat,
        player: { id: args.player.id, name: args.player.name },
      });
      return { seat, rev: this.root.engine.rev };
    });
  }

  /** Frees a seat (the player stood up, or their reconnect grace expired). */
  async stand(args: {
    seat: number;
    reason?: 'stand' | 'grace-expired';
  }): Promise<{ rev: number }> {
    return this.enqueueExternal(async () => {
      const player = this.root.engine.seats[args.seat]?.player?.id ?? null;
      await this.run({ kind: 'system', event: args.reason ?? 'stand', seat: args.seat, player });
      return { rev: this.root.engine.rev };
    });
  }

  /** Marks every seat of `player` as reserved and disconnected. */
  async disconnect(args: { player: string }): Promise<void> {
    await this.seatEvent('disconnect', args.player);
  }

  /** Marks every seat of `player` as occupied and connected again. */
  async reconnect(args: { player: string }): Promise<void> {
    await this.seatEvent('reconnect', args.player);
  }

  /** Starts a table that is waiting (operator API, or `autoStart: false`). */
  async start(): Promise<void> {
    await this.enqueueExternal(() =>
      this.run({ kind: 'system', event: 'start', seat: null, player: null }),
    );
  }

  private async seatEvent(event: 'disconnect' | 'reconnect', player: string): Promise<void> {
    await this.enqueueExternal(async () => {
      for (const seat of this.seatsOf(this.root.engine, player)) {
        const s = this.root.engine.seats[seat]!;
        if (event === 'disconnect' ? s.connected : !s.connected) {
          await this.run({ kind: 'system', event, seat, player });
        }
      }
    });
  }

  // -------------------------------------------------------------------------------
  // Queue

  /** Queues an entry caused by input from outside (clients, operators, timers). */
  private enqueueExternal<T>(task: () => Promise<T>): Promise<T> {
    return this.enqueue(() => {
      this.chain = 0;
      return task();
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (this.disposed)
      return Promise.reject(shoehiveError('TABLE_UNAVAILABLE', 'Table is disposed'));
    this.pending += 1;
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => {
        this.pending -= 1;
      },
      () => {
        this.pending -= 1;
      },
    );
    return result;
  }

  // -------------------------------------------------------------------------------
  // Entry execution

  /**
   * Runs one entry as a transaction. Returns the action result, or `NOOP` when the
   * entry turned out to have nothing to do (for example a cancelled timer).
   */
  private async run(input: EntryInput, opts: { replay?: LogEntry } = {}): Promise<unknown> {
    const at = opts.replay ? opts.replay.at : this.clock.now();
    // Mutative's types recurse too deeply on Root; the draft has the same shape.
    const [draft, finalize] = create(this.root as object, {
      enableAutoFreeze: this.dev,
    }) as unknown as [Root, () => Root];
    const tx: Tx = { draft, at, draws: [], events: [], after: [] };
    const ctx = this.makeCtx(tx);
    let result: unknown;
    let logged: EntryInput;
    try {
      [result, logged] = await this.dispatch(input, tx, ctx);
      let chained = 0;
      while (tx.after.length > 0) {
        if (++chained > MAX_CHAINED)
          throw shoehiveError('INTERNAL', 'Too many chained phase changes or hooks in one entry');
        await tx.after.shift()!();
      }
    } catch (error) {
      if (error === NOOP) return NOOP;
      throw this.normalize(error);
    }
    if (result !== undefined) {
      this.checkJson(result, 'run() returned a value that is not JSON');
      result = plain(result as Json); // may reference the draft, which is revoked on commit
    }
    tx.draft.engine.rev += 1;
    tx.draft.engine.seq += 1;
    const next = finalize();
    this.checkJson(next.state, 'state is not JSON after this entry');
    const entry = { ...logged, seq: next.engine.seq, at, draws: tx.draws };
    if (opts.replay) {
      if (!jsonEqual(entry.draws, opts.replay.draws)) {
        throw new ReplayDivergenceError(
          entry.seq,
          'different random numbers were drawn (nondeterministic game code?)',
        );
      }
      this.entries.push(opts.replay);
    } else {
      this.entries.push(entry);
    }
    this.root = next;
    if (this.live) {
      this.syncTimers();
      const commit: Commit = { rev: next.engine.rev, entry, events: tx.events };
      for (const listener of this.listeners) listener(commit);
      this.scheduleFollowUps();
    }
    return result;
  }

  private async dispatch(input: EntryInput, tx: Tx, ctx: LooseCtx): Promise<[unknown, EntryInput]> {
    const e = tx.draft.engine;
    switch (input.kind) {
      case 'action': {
        if (e.status === 'ended') throw shoehiveError('TABLE_ENDED', 'The table has ended');
        const def = this.lookupAction(e.phase, input.name);
        if (!def || def.internal) throw notAllowed(input.name, e.phase);
        if (e.status === 'waiting' && !def.preStart)
          throw shoehiveError('NOT_STARTED', 'The table has not started');
        if (e.seats[input.seat]?.player?.id !== input.player) {
          throw shoehiveError('NOT_SEATED', `You do not hold seat ${String(input.seat)}`);
        }
        const rounds = this.roundsConfig(e.phase);
        if (def.once && rounds) {
          const round = e.round;
          if (!round?.open) throw shoehiveError('ROUND_CLOSED', 'The round is closed');
          if (!round.participants.includes(input.seat)) {
            throw shoehiveError('NOT_PARTICIPANT', 'Your seat is not part of this round');
          }
          if (round.submitted.includes(input.seat)) {
            throw shoehiveError('ALREADY_SUBMITTED', 'You already submitted this round');
          }
        }
        const result = await this.callAction(def, tx, ctx, input.seat, input.player, input.input);
        if (def.once && rounds && e.round?.open) e.round.submitted.push(input.seat);
        return [result, input];
      }
      case 'timer': {
        const timer = e.timers[input.name];
        if (!timer) throw NOOP;
        delete e.timers[input.name];
        const logged: EntryInput = {
          kind: 'timer',
          name: input.name,
          action: timer.action,
          input: plain(timer.input),
        };
        if (timer.action === '__round-close') {
          if (!this.closeRound(tx, ctx)) throw NOOP;
          return [undefined, logged];
        }
        if (e.status === 'ended') throw NOOP;
        const def = this.lookupAction(e.phase, timer.action);
        if (!def) throw NOOP; // the phase changed and the action no longer applies
        await this.callAction(def, tx, ctx, -1, null, plain(timer.input));
        return [undefined, logged];
      }
      case 'system':
        await this.system(input, tx, ctx);
        return [undefined, input];
      case 'create':
        throw new TypeError('create entries are not dispatched');
    }
  }

  private async system(
    input: Extract<EntryInput, { kind: 'system' }>,
    tx: Tx,
    ctx: LooseCtx,
  ): Promise<void> {
    const e = tx.draft.engine;
    switch (input.event) {
      case 'sit': {
        const { seat, player } = input;
        if (!Number.isInteger(seat) || seat < 0 || seat >= e.seats.length) {
          throw shoehiveError('BAD_REQUEST', `Seat ${String(seat)} does not exist`);
        }
        if (e.status === 'ended') throw shoehiveError('TABLE_ENDED', 'The table has ended');
        if (e.seats[seat]!.status !== 'empty')
          throw shoehiveError('SEAT_TAKEN', `Seat ${String(seat)} is taken`);
        if (this.seatsOf(e, player.id).length >= (this.game.seats.perPlayer ?? 1)) {
          throw shoehiveError(
            'ALREADY_SEATED',
            'You already hold as many seats as this game allows',
          );
        }
        e.seats[seat] = {
          status: 'occupied',
          player: { id: player.id, name: player.name },
          connected: true,
        };
        if (e.turn && !e.turn.order.includes(seat)) {
          e.turn.order.push(seat);
          e.turn.order.sort((a, b) => a - b);
          if (e.turn.seat === null) this.advanceTurn(tx, seat);
        }
        await this.callHook(this.game.onSit, tx, ctx, seat, player.id);
        return;
      }
      case 'stand':
      case 'grace-expired': {
        const { seat } = input;
        const s = e.seats[seat];
        if (!s || s.status === 'empty')
          throw shoehiveError('NOT_SEATED', `Seat ${String(seat)} is empty`);
        const playerId = s.player?.id ?? null;
        e.seats[seat] = { status: 'empty', player: null, connected: false };
        if (e.turn) {
          const wasCurrent = e.turn.seat === seat;
          const index = e.turn.order.indexOf(seat);
          if (index >= 0) e.turn.order.splice(index, 1);
          if (wasCurrent) {
            // The next seat in order after the one that left (same index after removal).
            const order = e.turn.order;
            e.turn.seat = null;
            if (order.length > 0) this.advanceTurn(tx, order[index % order.length]!);
            else this.armTurnTimer(tx);
          }
        }
        if (e.round?.open) {
          e.round.participants = e.round.participants.filter((p) => p !== seat);
          e.round.submitted = e.round.submitted.filter((p) => p !== seat);
        }
        await this.callHook(this.game.onStand, tx, ctx, seat, playerId);
        return;
      }
      case 'disconnect':
      case 'reconnect': {
        const s = e.seats[input.seat];
        if (!s || s.status === 'empty') throw NOOP;
        const disconnecting = input.event === 'disconnect';
        s.status = disconnecting ? 'reserved' : 'occupied';
        s.connected = !disconnecting;
        await this.callHook(
          disconnecting ? this.game.onDisconnect : this.game.onReconnect,
          tx,
          ctx,
          input.seat,
          input.player,
        );
        return;
      }
      case 'start':
        if (e.status !== 'waiting') throw NOOP;
        await this.startTable(tx, ctx);
        return;
      case 'round-close':
        if (!this.closeRound(tx, ctx)) throw NOOP;
        return;
    }
  }

  // -------------------------------------------------------------------------------
  // Lifecycle: start, phases, end

  private async startTable(tx: Tx, ctx: LooseCtx): Promise<void> {
    const e = tx.draft.engine;
    e.status = 'active';
    await this.callHook(this.game.onStart, tx, ctx, null, null);
    const phases = this.game.phases ? Object.keys(this.game.phases) : [];
    if (phases.length > 0) {
      await this.enterPhase(tx, ctx, phases[0]!);
    } else {
      if (this.game.turns) this.initTurns(tx, this.game.turns);
      if (this.game.rounds) this.openRound(tx, ctx, this.game.rounds as LooseRounds, 1);
    }
  }

  private async enterPhase(tx: Tx, ctx: LooseCtx, name: string): Promise<void> {
    const e = tx.draft.engine;
    const def = this.phaseDef(name)!;
    e.phase = name;
    e.turn = null;
    e.round = null;
    if (def.turns) this.initTurns(tx, def.turns);
    if (def.rounds) this.openRound(tx, ctx, def.rounds, 1);
    await this.callHook(def.onEnter, tx, ctx, null, null);
  }

  private async goPhase(tx: Tx, ctx: LooseCtx, name: string): Promise<void> {
    const e = tx.draft.engine;
    if (e.status === 'ended') return;
    const current = e.phase === null ? undefined : this.phaseDef(e.phase);
    await this.callHook(current?.onExit, tx, ctx, null, null);
    delete e.timers['turn'];
    delete e.timers['__round'];
    await this.enterPhase(tx, ctx, name);
  }

  private async endTable(tx: Tx, ctx: LooseCtx, result: Json): Promise<void> {
    const e = tx.draft.engine;
    if (e.status === 'ended') return;
    e.status = 'ended';
    e.result = result;
    e.timers = {};
    if (e.round) {
      e.round.open = false;
      e.round.deadline = null;
    }
    await this.callHook(this.game.onEnd, tx, ctx, null, null);
  }

  // -------------------------------------------------------------------------------
  // Turns (ADR 0008)

  private turnsConfig(phase: string | null): TurnsConfig | undefined {
    return phase === null ? this.game.turns : this.phaseDef(phase)?.turns;
  }

  private initTurns(tx: Tx, config: TurnsConfig): void {
    const e = tx.draft.engine;
    const seats = this.occupiedOf(e);
    const order = typeof config.order === 'function' ? [...config.order({ seats })] : seats;
    e.turn = { order, seat: null, number: 0 };
    if (order.length === 0) return;
    const first = typeof config.first === 'function' ? config.first({ seats }) : order[0]!;
    this.advanceTurn(tx, first);
  }

  /** Makes `from` (or the next eligible seat after it, wrapping) the current turn. */
  private advanceTurn(tx: Tx, from: number): void {
    const e = tx.draft.engine;
    const turn = e.turn!;
    const config = this.turnsConfig(e.phase);
    const start = turn.order.indexOf(from);
    turn.seat = null;
    for (let i = 0; i < turn.order.length; i++) {
      const candidate = turn.order[(Math.max(start, 0) + i) % turn.order.length]!;
      if (!config?.skip?.({ seat: candidate, state: tx.draft.state })) {
        turn.seat = candidate;
        break;
      }
    }
    turn.number += 1;
    this.armTurnTimer(tx);
  }

  private armTurnTimer(tx: Tx): void {
    const e = tx.draft.engine;
    const config = this.turnsConfig(e.phase);
    if (config?.timeoutMs && config.onTimeout && e.turn?.seat != null && e.status === 'active') {
      e.timers['turn'] = {
        deadline: tx.at + config.timeoutMs,
        action: config.onTimeout,
        input: { seat: e.turn.seat },
      };
    } else {
      delete e.timers['turn'];
    }
  }

  // -------------------------------------------------------------------------------
  // Rounds (ADR 0008)

  private roundsConfig(phase: string | null): LooseRounds | undefined {
    return phase === null ? this.game.rounds : this.phaseDef(phase)?.rounds;
  }

  private openRound(tx: Tx, ctx: LooseCtx, config: LooseRounds, number: number): void {
    const e = tx.draft.engine;
    const deadline = config.durationMs !== undefined ? tx.at + config.durationMs : null;
    e.round = { number, open: true, participants: this.occupiedOf(e), submitted: [], deadline };
    if (deadline !== null) e.timers['__round'] = { deadline, action: '__round-close', input: null };
    else delete e.timers['__round'];
    const onOpen = config.onOpen;
    if (onOpen) tx.after.push(() => this.callHook(onOpen, tx, ctx, null, null));
  }

  /** Closes the open round. Returns false when there was none. */
  private closeRound(tx: Tx, ctx: LooseCtx): boolean {
    const e = tx.draft.engine;
    if (!e.round?.open) return false;
    e.round.open = false;
    e.round.deadline = null;
    delete e.timers['__round'];
    const config = this.roundsConfig(e.phase);
    if (config) tx.after.push(() => this.callHook(config.onClose, tx, ctx, null, null));
    return true;
  }

  // -------------------------------------------------------------------------------
  // Follow-ups and timers (live tables only)

  private scheduleFollowUps(): void {
    const e = this.root.engine;
    const occupied = e.seats.filter((s) => s.status !== 'empty').length;
    if (
      e.status === 'waiting' &&
      this.game.autoStart !== false &&
      occupied >= this.game.seats.min
    ) {
      this.enqueueFollowUp({ kind: 'system', event: 'start', seat: null, player: null });
    }
    const rounds = this.roundsConfig(e.phase);
    if (
      e.status === 'active' &&
      e.round?.open &&
      rounds?.closeWhen === 'all-submitted' &&
      // An empty round has nobody to wait for, but closing it at once would let a game
      // that reopens rounds in onClose loop forever. It waits for its timeout instead.
      e.round.participants.length > 0 &&
      e.round.participants.every((p) => e.round!.submitted.includes(p))
    ) {
      this.enqueueFollowUp({ kind: 'system', event: 'round-close', seat: null, player: null });
    }
  }

  /**
   * Follow-up entries (auto-start, round closes) scheduled since the last external
   * entry. A game that keeps triggering them without any input is a bug; past the
   * limit the runtime stops scheduling them instead of spinning forever.
   */
  private chain = 0;

  private enqueueFollowUp(entry: EntryInput): void {
    if (++this.chain > MAX_FOLLOW_UPS) {
      if (this.chain === MAX_FOLLOW_UPS + 1) {
        this.diag.push({
          at: this.clock.now(),
          name: `system:${entry.kind === 'system' ? entry.event : entry.kind}`,
          seat: null,
          player: null,
          code: 'INTERNAL',
          message: `More than ${String(MAX_FOLLOW_UPS)} follow-up entries without input: stopped scheduling them`,
        });
      }
      return;
    }
    void this.enqueue(() => this.run(entry)).catch(() => undefined);
  }

  private syncTimers(): void {
    const timers = this.root.engine.timers;
    for (const [name, armed] of this.armed) {
      if (timers[name]?.deadline !== armed.deadline) {
        this.clock.clearTimer(armed.handle);
        this.armed.delete(name);
      }
    }
    for (const [name, timer] of Object.entries(timers)) {
      if (this.armed.has(name)) continue;
      const handle = this.clock.setTimer(timer.deadline, () => {
        if (this.armed.get(name)?.handle !== handle) return;
        this.armed.delete(name);
        void this.enqueueExternal(() =>
          this.run({ kind: 'timer', name, action: '', input: null }),
        ).catch(() => undefined);
      });
      this.armed.set(name, { deadline: timer.deadline, handle });
    }
  }

  // -------------------------------------------------------------------------------
  // Game code invocation

  private async callAction(
    def: LooseAction,
    tx: Tx,
    ctx: LooseCtx,
    seat: number,
    player: string | null,
    input: Json,
  ): Promise<unknown> {
    const value = input === null && !def.input ? undefined : input;
    return await guarded(this.dev, () =>
      def.run({ state: tx.draft.state, seat, player, input: value, ctx }),
    );
  }

  private async callHook(
    hook: LooseHook | undefined,
    tx: Tx,
    ctx: LooseCtx,
    seat: number | null,
    player: string | null,
  ): Promise<void> {
    if (!hook) return;
    await guarded(this.dev, () => hook({ state: tx.draft.state, ctx, seat, player }));
  }

  private makeCtx(tx: Tx): LooseCtx {
    const e = (): EngineState => tx.draft.engine;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- getters below need it
    const runtime = this;
    const random: Random = createRandom({
      stream: this.stream,
      cursor: () => e().rng,
      advance: () => {
        e().rng += 1;
      },
      record: (w) => tx.draws.push(w),
    });
    // eslint-disable-next-line prefer-const -- assigned below, referenced by closures above
    let ctxRef: LooseCtx;
    const turn: CtxTurn = {
      get seat() {
        return requireTurn().seat;
      },
      get number() {
        return requireTurn().number;
      },
      get order() {
        return [...requireTurn().order];
      },
      next() {
        const t = requireTurn();
        if (t.order.length === 0) return;
        const index = t.seat === null ? -1 : t.order.indexOf(t.seat);
        runtime.advanceTurn(tx, t.order[(index + 1) % t.order.length]!);
      },
      set(seat: number) {
        const t = requireTurn();
        if (!t.order.includes(seat))
          throw new TypeError(`ctx.turn.set(${String(seat)}): seat is not in the turn order`);
        t.seat = seat;
        t.number += 1;
        runtime.armTurnTimer(tx);
      },
    };
    const requireTurn = () => {
      const t = e().turn;
      if (!t) throw new TypeError('ctx.turn is only available in a phase (or game) with turns');
      return t;
    };
    const requireRound = () => {
      const r = e().round;
      if (!r || !runtime.roundsConfig(e().phase)) {
        throw new TypeError('ctx.round is only available in a phase (or game) with rounds');
      }
      return r;
    };
    const round: CtxRound = {
      get number() {
        return requireRound().number;
      },
      get open() {
        return requireRound().open;
      },
      get participants() {
        return [...requireRound().participants];
      },
      get submitted() {
        return [...requireRound().submitted];
      },
      get pending() {
        const r = requireRound();
        return r.participants.filter((p) => !r.submitted.includes(p));
      },
      get deadline() {
        return requireRound().deadline;
      },
      close() {
        requireRound();
        runtime.closeRound(tx, ctxRef);
      },
      next() {
        const r = requireRound();
        if (r.open) throw new TypeError('ctx.round.next(): close the current round first');
        runtime.openRound(tx, ctxRef, runtime.roundsConfig(e().phase)!, r.number + 1);
      },
    };
    ctxRef = {
      get status() {
        return e().status;
      },
      get seats() {
        return e().seats.map(copySeat);
      },
      get occupied() {
        return runtime.occupiedOf(e());
      },
      get options() {
        return runtime.root.engine.options;
      },
      now: () => tx.at,
      random,
      phase: {
        get name() {
          return e().phase;
        },
        go(name: string) {
          if (!runtime.phaseDef(name))
            throw new TypeError(`ctx.phase.go(): unknown phase "${name}"`);
          tx.after.push(() => runtime.goPhase(tx, ctxRef, name));
        },
      },
      turn,
      round,
      timers: {
        after(name: string, ms: number, action: string, input: Json = null) {
          if (name === '__round') throw new TypeError('ctx.timers.after(): "__round" is reserved');
          if (!(ms >= 0) || !Number.isFinite(ms))
            throw new RangeError('ctx.timers.after(): ms must be a finite number >= 0');
          const def = runtime.lookupAnyAction(action);
          if (!def) throw new TypeError(`ctx.timers.after(): unknown action "${action}"`);
          runtime.checkJson(input, 'ctx.timers.after(): input is not JSON');
          let value = plain(input);
          if (def.input) {
            // Validate now, so a bad timer input rolls back the entry that scheduled it (ADR 0004).
            const result = def.input['~standard'].validate(value);
            if (result instanceof Promise) {
              throw new TypeError(
                `ctx.timers.after(): "${action}" has an async input schema; timers need a synchronous one`,
              );
            }
            if (result.issues) {
              const issues = normalizeIssues(result.issues).map(
                (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
              );
              throw new TypeError(
                `ctx.timers.after(): invalid input for "${action}": ${issues.join('; ')}`,
              );
            }
            value = plain((result.value ?? null) as Json);
          }
          e().timers[name] = { deadline: tx.at + ms, action, input: value };
        },
        cancel(name: string) {
          delete e().timers[name];
        },
        has(name: string) {
          return name in e().timers;
        },
        deadline(name: string) {
          return e().timers[name]?.deadline ?? null;
        },
      },
      emit(name: string, payload: Json = null, options: { to?: EventAudience } = {}) {
        runtime.checkJson(payload, `ctx.emit("${name}"): payload is not JSON`);
        tx.events.push({
          name,
          payload: plain(payload),
          to: typeof options.to === 'object' ? [...options.to] : (options.to ?? 'all'),
        });
      },
      start() {
        tx.after.push(async () => {
          if (e().status === 'waiting') await runtime.startTable(tx, ctxRef);
        });
      },
      end(result: Json = null) {
        runtime.checkJson(result, 'ctx.end(): result is not JSON');
        const value = plain(result);
        tx.after.push(() => runtime.endTable(tx, ctxRef, value));
      },
    };
    return ctxRef;
  }

  private readCtx(engine: EngineState): ReadCtx<unknown> {
    const turn: TurnInfo | null = engine.turn
      ? { seat: engine.turn.seat, number: engine.turn.number, order: [...engine.turn.order] }
      : null;
    const r = engine.round;
    const round: RoundInfo | null = r
      ? {
          number: r.number,
          open: r.open,
          participants: [...r.participants],
          submitted: [...r.submitted],
          pending: r.participants.filter((p) => !r.submitted.includes(p)),
          deadline: r.deadline,
        }
      : null;
    return {
      status: engine.status,
      phase: engine.phase,
      turn,
      round,
      seats: engine.seats.map(copySeat),
      occupied: this.occupiedOf(engine),
      options: engine.options,
    };
  }

  // -------------------------------------------------------------------------------
  // Helpers

  private phaseDef(name: string): LoosePhase | undefined {
    return (this.game.phases as Record<string, LoosePhase> | undefined)?.[name];
  }

  private lookupAction(phase: string | null, name: string): LooseAction | undefined {
    const inPhase = phase === null ? undefined : this.phaseDef(phase)?.actions?.[name];
    return inPhase ?? (this.game.actions as Record<string, LooseAction> | undefined)?.[name];
  }

  private lookupAnyAction(name: string): LooseAction | undefined {
    const top = (this.game.actions as Record<string, LooseAction> | undefined)?.[name];
    if (top) return top;
    for (const phase of Object.values((this.game.phases ?? {}) as Record<string, LoosePhase>)) {
      const def = phase.actions?.[name] as LooseAction | undefined;
      if (def) return def;
    }
    return undefined;
  }

  private async validateInput(def: LooseAction, name: string, input: unknown): Promise<Json> {
    if (!def.input) {
      if (input !== undefined && input !== null) {
        throw shoehiveError('INVALID_INPUT', `Action "${name}" takes no input`, { issues: [] });
      }
      return null;
    }
    return runSchema(def.input, input, 'INVALID_INPUT', `input for "${name}"`);
  }

  private seatsOf(engine: EngineState, playerId: string): number[] {
    const seats: number[] = [];
    engine.seats.forEach((s, i) => {
      if (s.player?.id === playerId) seats.push(i);
    });
    return seats;
  }

  private occupiedOf(engine: EngineState): number[] {
    const seats: number[] = [];
    engine.seats.forEach((s, i) => {
      if (s.status !== 'empty') seats.push(i);
    });
    return seats;
  }

  private checkJson(value: unknown, message: string): void {
    if (!this.dev) return;
    const bad = findNonJson(value);
    if (bad) throw shoehiveError('INTERNAL', `${message}: ${bad.reason} at ${bad.path}`);
  }

  private freeze(root: Root): Root {
    // Committed state is frozen in dev so accidental mutation throws (ADR 0005).
    return this.dev ? deepFreeze(root) : root;
  }

  private normalize(error: unknown): Error {
    if (isShoehiveError(error) || error instanceof ReplayDivergenceError) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new ShoehiveError({
      code: 'INTERNAL',
      message: this.dev ? `Game code threw: ${message}` : 'Internal error',
      cause: error,
    });
  }

  private recordRejection(
    args: { name: string; seat?: number; player: string },
    error: unknown,
  ): void {
    const err = isShoehiveError(error) ? error : this.normalize(error);
    this.diag.push({
      at: this.clock.now(),
      name: args.name,
      seat: args.seat ?? null,
      player: args.player,
      code: isShoehiveError(err) ? err.code : 'INTERNAL',
      message: err.message,
    });
    if (this.diag.length > DIAGNOSTICS) this.diag.shift();
  }
}

/**
 * A deep plain copy of a JSON value. Values read from a draft must be copied before the
 * entry commits, because Mutative revokes draft proxies on finalize.
 */
function plain<T extends Json>(value: T): T {
  return value === null || typeof value !== 'object'
    ? value
    : (JSON.parse(JSON.stringify(value)) as T);
}

function copySeat(s: EngineSeat): SeatInfo {
  return {
    status: s.status,
    player: s.player ? { id: s.player.id, name: s.player.name } : null,
    connected: s.connected,
  };
}

function notAllowed(name: string, phase: string | null): ShoehiveError {
  return shoehiveError(
    'ACTION_NOT_ALLOWED',
    phase === null
      ? `Action "${name}" is not available`
      : `Action "${name}" is not available in phase "${phase}"`,
    { phase },
  );
}

function rejectUnexpectedOptions(options: unknown): Json {
  if (
    options !== undefined &&
    options !== null &&
    !(typeof options === 'object' && Object.keys(options).length === 0)
  ) {
    throw shoehiveError('INVALID_OPTIONS', 'This game takes no options', { issues: [] });
  }
  return null;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
