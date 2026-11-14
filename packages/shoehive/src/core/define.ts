// Game definitions (ADR 0001). A game is a plain object of data and pure functions.
// One call to defineGame infers everything: state from `setup`, each action's input
// from its schema, phase names, and the view type.

import type { Json } from './json';
import type { Random } from './random';
import type { StandardSchemaV1 } from './standard-schema';

/** Public information about one seat (protocol section 6.1). */
export interface SeatInfo {
  readonly status: 'empty' | 'occupied' | 'reserved';
  readonly player: { readonly id: string; readonly name: string } | null;
  readonly connected: boolean;
}

/** Who a view is being computed for (ADR 0003). All spectators share one viewer. */
export type Viewer =
  | {
      readonly kind: 'seat';
      /** The viewer's first (usually only) seat. */
      readonly seat: number;
      /** Every seat this player holds at the table. */
      readonly seats: readonly number[];
      readonly playerId: string;
    }
  | {
      readonly kind: 'spectator';
      readonly seat: null;
      readonly seats: readonly number[];
      readonly playerId: null;
    };

export type TableStatus = 'waiting' | 'active' | 'ended';

/** Turn bookkeeping visible to game code (ADR 0008). */
export interface TurnInfo {
  /** The seat whose turn it is, or `null` when no seat is eligible. */
  readonly seat: number | null;
  /** 1-based count of turns in this phase. */
  readonly number: number;
  readonly order: readonly number[];
}

/** Round bookkeeping visible to game code (ADR 0008). */
export interface RoundInfo {
  /** 1-based count of rounds in this phase. */
  readonly number: number;
  readonly open: boolean;
  /** Seats that were occupied when the round opened. */
  readonly participants: readonly number[];
  readonly submitted: readonly number[];
  readonly pending: readonly number[];
  /** Epoch ms when the round closes on its own, or `null`. */
  readonly deadline: number | null;
}

/** Read-only engine information, available everywhere including `view`. */
export interface ReadCtx<O> {
  readonly status: TableStatus;
  readonly phase: string | null;
  readonly turn: TurnInfo | null;
  readonly round: RoundInfo | null;
  readonly seats: readonly SeatInfo[];
  /** Occupied or reserved seat numbers, ascending. */
  readonly occupied: readonly number[];
  readonly options: O;
}

export interface CtxTurn extends TurnInfo {
  /** Advances to the next eligible seat in `order`. */
  next(): void;
  /** Jumps to `seat`. Throws if the seat is not in the order. */
  set(seat: number): void;
}

export interface CtxRound extends RoundInfo {
  /** Closes the round now. `onClose` runs at the end of this entry. */
  close(): void;
  /** Opens the next round. Only valid after the current one closed. */
  next(): void;
}

export interface CtxTimers {
  /**
   * Schedules the action `action` (normally `internal: true`) to run `ms` after the
   * current entry's time. Reusing `name` replaces the timer.
   */
  after(name: string, ms: number, action: string, input?: Json): void;
  cancel(name: string): void;
  has(name: string): boolean;
  /** The deadline (epoch ms) of timer `name`, or `null`. */
  deadline(name: string): number | null;
}

export type EventAudience = 'all' | 'spectators' | readonly number[];

/** The engine handle available to actions and hooks (ADR 0001). */
export interface ActionCtx<O, PN extends string> extends Omit<
  ReadCtx<O>,
  'turn' | 'round' | 'phase'
> {
  /** The entry's time, epoch ms. Constant for the whole entry (ADR 0006). */
  now(): number;
  readonly random: Random;
  readonly phase: { readonly name: PN | null; go(name: PN): void };
  /** Turn controls. Only available in a phase (or game) with `turns`. */
  readonly turn: CtxTurn;
  /** Round controls. Only available in a phase (or game) with `rounds`. */
  readonly round: CtxRound;
  readonly timers: CtxTimers;
  /** Sends an ephemeral event (not state) after this entry commits. */
  emit(name: string, payload?: Json, options?: { to?: EventAudience }): void;
  /** Starts a table created with `autoStart: false`. */
  start(): void;
  /** Ends the table. `onEnd` runs at the end of this entry. */
  end(result?: Json): void;
}

export interface HookArgs<S, O, PN extends string> {
  state: S;
  ctx: ActionCtx<O, PN>;
  /** The seat concerned, for seat hooks (`onSit`, `onStand`...). Otherwise `null`. */
  seat: number | null;
  /** The player concerned, for seat hooks. Otherwise `null`. */
  player: string | null;
}

export type Hook<S, O, PN extends string> = (args: HookArgs<S, O, PN>) => void | Promise<void>;

export interface ActionArgs<S, I, O, PN extends string> {
  /** A draft of the state: mutate it freely (ADR 0005). */
  state: S;
  /**
   * The acting seat. For `internal` actions run by a timer, this is `-1`; read any
   * seat you need from `input`.
   */
  seat: number;
  /** The acting player's id, or `null` for internal actions. */
  player: string | null;
  /** The validated input (the schema's output). `undefined` without a schema. */
  input: I;
  ctx: ActionCtx<O, PN>;
}

export interface ActionDef<S, I, O, PN extends string> {
  /** Validates the action's input (any Standard Schema library). Omit for no input. */
  input?: StandardSchemaV1<unknown, I>;
  /** Only timers and the engine may run it; clients get `ACTION_NOT_ALLOWED`. */
  internal?: boolean;
  /** In a rounds phase: counts as the seat's one submission for the round. */
  once?: boolean;
  /** May run before the table has started (for example `ready`). */
  preStart?: boolean;
  /** Returns nothing, or a JSON value sent back as the action's result. */
  run(args: ActionArgs<S, I, O, PN>): void | Json | Promise<void | Json>;
}

export interface TurnsConfig {
  /** `'round-robin'` (ascending seats) or a function returning the order. */
  order?: 'round-robin' | ((args: { seats: readonly number[] }) => number[]);
  /** Seats to skip when advancing (for example folded players). */
  skip?: (args: { seat: number; state: unknown }) => boolean;
  /** Who starts: the lowest seat in the order (default) or a function. */
  first?: 'lowest' | ((args: { seats: readonly number[] }) => number);
  /** Arms a `turn` timer on every turn change. Requires `onTimeout`. */
  timeoutMs?: number;
  /** Internal action run when the turn timer fires. Receives `{ seat }` as input. */
  onTimeout?: string;
}

export interface RoundsConfig<S, O, PN extends string> {
  /** Required when `closeWhen` is `'timeout'`. */
  durationMs?: number;
  /** `'all-submitted'` closes early once every participant submitted. */
  closeWhen: 'all-submitted' | 'timeout';
  onOpen?: Hook<S, O, PN>;
  onClose: Hook<S, O, PN>;
}

// Inference design. TypeScript leaves an object literal out of its first inference pass
// when every member is a context-sensitive function (for example input-less actions
// written as `run({ state }) {...}`). Inferring the action input map by reverse-mapping
// the whole actions object therefore loses every action in that case. Instead we infer:
//   - action and phase *names* from object keys (`{ [K in N]: ... }`), which always works;
//   - action *input types* separately, from the non-context-sensitive `input` schemas.

/** The input type of action `K` given an inferred input map `A`. `undefined` without a schema. */
type InputOf<A, K> = K extends keyof A ? (unknown extends A[K] ? undefined : A[K]) : undefined;

/** Action definitions keyed by name, with each `run` typed from its own schema. */
export type ActionDefs<S, O, PN extends string, N extends string, A> = {
  [K in N]: ActionDef<S, InputOf<A, K>, O, PN>;
};

/** The inference site for action input types: just the `input` schemas. */
type InputSchemas<A> = { [K in keyof A]: { input?: StandardSchemaV1<unknown, A[K]> } };

export interface PhaseDef<S, O, PN extends string, N extends string, A> {
  /** Actions available only in this phase (in addition to top-level actions). */
  actions?: Partial<ActionDefs<S, O, PN, N, A>>;
  turns?: TurnsConfig;
  rounds?: RoundsConfig<S, O, PN>;
  onEnter?: Hook<S, O, PN>;
  onExit?: Hook<S, O, PN>;
}

export interface ViewArgs<S, O> {
  state: Readonly<S>;
  viewer: Viewer;
  ctx: ReadCtx<O>;
}

/**
 * A game definition.
 *
 * Type parameters, all inferred by `defineGame`: `S` state, `O` options, `PN` phase names,
 * `AN` top-level action names, `A` their inputs, `PAN` phase action names, `P` their
 * inputs per phase, `V` the view.
 */
export interface GameConfig<
  S,
  O,
  PN extends string,
  AN extends string,
  A,
  PAN extends string,
  P,
  V,
> {
  /** Stable id used in the protocol, lobby and store. Lowercase, digits, `-`, `_`, `.`. */
  id: string;
  name?: string;
  description?: string;
  /** Bump when state shape changes incompatibly (ADR 0009). Default 1. */
  version?: number;
  seats: {
    min: number;
    max: number;
    /** Seats one player may hold at once. Default 1. */
    perPlayer?: number;
  };
  /** Start automatically once `seats.min` seats are occupied. Default `true`. */
  autoStart?: boolean;
  /** Validates table options (any Standard Schema library). */
  options?: StandardSchemaV1<unknown, O>;
  /** Builds the initial state. Runs once per table. */
  setup(args: { options: O; random: Random; seats: number }): S;
  /** Actions available in every phase. */
  actions?: ActionDefs<S, O, PN, AN, A> & InputSchemas<A>;
  /** Named phases. The first one declared is the initial phase. */
  phases?: { [K in PN]: PhaseDef<S, O, PN, PAN, K extends keyof P ? P[K] : undefined> } & {
    [K in keyof P]: { actions?: InputSchemas<P[K]> };
  };
  /** Turns for games without phases. */
  turns?: TurnsConfig;
  /** Rounds for games without phases. */
  rounds?: RoundsConfig<S, O, PN>;
  /** What each viewer may see. Defaults to the full state for everyone. */
  view?(args: ViewArgs<S, O>): V;
  onSit?: Hook<S, O, PN>;
  onStand?: Hook<S, O, PN>;
  onDisconnect?: Hook<S, O, PN>;
  onReconnect?: Hook<S, O, PN>;
  onStart?: Hook<S, O, PN>;
  onEnd?: Hook<S, O, PN>;
}

declare const gameBrand: unique symbol;

type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (
  x: infer I,
) => void
  ? I
  : never;

/** All phase action inputs merged into one map. */
type PhaseInputs<P> = UnionToIntersection<
  // eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- a phase without actions
  { [K in keyof P]: P[K] extends Record<string, unknown> ? P[K] : Record<never, never> }[keyof P]
>;

/** The type information a game carries for clients and tests. */
export interface GameTypes<S, O, PN extends string, Actions, V> {
  state: S;
  options: O;
  phases: PN;
  /** Every action name (top-level and in any phase) mapped to its input type. */
  actions: Actions;
  view: V;
}

/** A game returned by `defineGame`. Its brand carries the inferred types. */
export type Game<
  S = unknown,
  O = unknown,
  PN extends string = string,
  AN extends string = string,
  A = unknown,
  PAN extends string = string,
  P = unknown,
  V = unknown,
> = GameConfig<S, O, PN, AN, A, PAN, P, V> & {
  readonly [gameBrand]: GameTypes<
    S,
    O,
    PN,
    { [K in AN | PAN]: K extends AN ? InputOf<A, K> : InputOf<PhaseInputs<P>, K> },
    V
  >;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- `any` is required to match games of every type */
/** Any game, for APIs that accept games of any type. */
export type AnyGame = GameConfig<any, any, any, any, any, any, any, any> & {
  readonly [gameBrand]: GameTypes<any, any, any, any, any>;
};
type TypesOf<G> = G extends { readonly [gameBrand]: infer T } ? T : never;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The state type of a game. */
export type GameState<G> =
  TypesOf<G> extends GameTypes<infer S, unknown, string, unknown, unknown> ? S : never;
/** The options type of a game. */
export type GameOptions<G> = TypesOf<G> extends { options: infer O } ? O : never;
/** The view type a client receives. */
export type GameView<G> = TypesOf<G> extends { view: infer V } ? V : never;
/** Map of every action name (top-level and in any phase) to its input type. */
export type GameActions<G> = TypesOf<G> extends { actions: infer A } ? A : never;
/** The phase names of a game. */
export type GamePhases<G> = TypesOf<G> extends { phases: infer PN } ? PN : never;

const GAME_ID = /^[a-z0-9][a-z0-9._-]*$/;
const RESERVED_TIMERS = new Set(['__round']);

/**
 * Defines a game. Checks the definition eagerly so mistakes surface at startup, not
 * at the first action.
 *
 * ```ts
 * export const ticTacToe = defineGame({
 *   id: 'tic-tac-toe',
 *   seats: { min: 2, max: 2 },
 *   setup: () => ({ board: Array<'X' | 'O' | null>(9).fill(null) }),
 *   turns: { order: 'round-robin' },
 *   actions: { place: { input: z.object({ cell: z.number() }), run({ state, input }) {} } },
 * });
 * ```
 */
export function defineGame<
  S,
  O = undefined,
  // Defaults: no phases means any phase name type-checks (`ctx.phase.go` checks at runtime);
  // it must not be `never`, or the game would not be assignable to `AnyGame`.
  PN extends string = string,
  AN extends string = never,
  A = unknown,
  PAN extends string = never,
  P = unknown,
  V = S,
>(config: GameConfig<S, O, PN, AN, A, PAN, P, V>): Game<S, O, PN, AN, A, PAN, P, V> {
  validateConfig(config as unknown as LooseConfig);
  return Object.freeze(config) as Game<S, O, PN, AN, A, PAN, P, V>;
}

type LooseConfig = GameConfig<unknown, unknown, string, string, unknown, string, unknown, unknown>;

function validateConfig(config: LooseConfig): void {
  const fail = (message: string): never => {
    throw new TypeError(`defineGame(${JSON.stringify(config.id)}): ${message}`);
  };
  if (typeof config.id !== 'string' || !GAME_ID.test(config.id)) {
    fail('id must be lowercase letters, digits, ".", "_" or "-", starting with a letter or digit');
  }
  const { min, max, perPlayer = 1 } = config.seats;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 64) {
    fail('seats must satisfy 1 <= min <= max <= 64 (integers)');
  }
  if (!Number.isInteger(perPlayer) || perPlayer < 1 || perPlayer > max) {
    fail('seats.perPlayer must be an integer between 1 and seats.max');
  }
  if (config.version !== undefined && (!Number.isInteger(config.version) || config.version < 1)) {
    fail('version must be a positive integer');
  }
  if (typeof config.setup !== 'function') fail('setup must be a function');

  const phases = config.phases ? Object.entries(config.phases) : [];
  if (config.phases && phases.length === 0)
    fail('phases, when given, must declare at least one phase');
  if (phases.length > 0 && (config.turns || config.rounds)) {
    fail('with phases, declare turns or rounds per phase, not at the top level');
  }

  const allActions = new Map<string, ActionDef<unknown, unknown, unknown, string>>();
  const checkActions = (actions: Record<string, unknown> | undefined, where: string): void => {
    for (const [name, def] of Object.entries(actions ?? {})) {
      if (name.startsWith('__'))
        fail(`action names starting with "__" are reserved (${where}.${name})`);
      const d = def as ActionDef<unknown, unknown, unknown, string>;
      if (typeof d.run !== 'function') fail(`${where}.${name}.run must be a function`);
      allActions.set(name, d);
    }
  };
  checkActions(config.actions, 'actions');
  for (const [phaseName, phase] of phases) {
    checkActions(phase.actions, `phases.${phaseName}.actions`);
  }

  const checkModels = (
    turns: TurnsConfig | undefined,
    rounds: RoundsConfig<unknown, unknown, string> | undefined,
    where: string,
  ): void => {
    if (turns && rounds) fail(`${where}: declare turns or rounds, not both`);
    if (turns?.timeoutMs !== undefined) {
      if (!(turns.timeoutMs > 0)) fail(`${where}.turns.timeoutMs must be positive`);
      if (!turns.onTimeout) fail(`${where}.turns.timeoutMs needs turns.onTimeout`);
    }
    if (turns?.onTimeout && !allActions.has(turns.onTimeout)) {
      fail(`${where}.turns.onTimeout names unknown action "${turns.onTimeout}"`);
    }
    if (rounds) {
      if (typeof rounds.onClose !== 'function') fail(`${where}.rounds.onClose must be a function`);
      if (rounds.closeWhen === 'timeout' && rounds.durationMs === undefined) {
        fail(`${where}.rounds: closeWhen "timeout" requires durationMs`);
      }
      if (rounds.durationMs !== undefined && !(rounds.durationMs > 0)) {
        fail(`${where}.rounds.durationMs must be positive`);
      }
    }
  };
  checkModels(config.turns, config.rounds, 'game');
  for (const [phaseName, phase] of phases) {
    checkModels(phase.turns, phase.rounds, `phases.${phaseName}`);
  }
}

/** Timer names used by the engine itself. */
export function isReservedTimerName(name: string): boolean {
  return RESERVED_TIMERS.has(name);
}
