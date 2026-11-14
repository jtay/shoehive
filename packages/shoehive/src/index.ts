/**
 * Shoehive core: game definitions, the table runtime and protocol types.
 *
 * This entry point is isomorphic. It must never import Node built-ins (ADR 0002).
 *
 * @packageDocumentation
 */
export { PROTOCOL_VERSION } from './protocol/version';
export {
  defineGame,
  type ActionArgs,
  type ActionCtx,
  type ActionDef,
  type AnyGame,
  type CtxRound,
  type CtxTimers,
  type CtxTurn,
  type EventAudience,
  type Game,
  type GameActions,
  type GameConfig,
  type GameOptions,
  type GamePhases,
  type GameTypes,
  type GameState,
  type GameView,
  type Hook,
  type HookArgs,
  type PhaseDef,
  type ReadCtx,
  type RoundInfo,
  type RoundsConfig,
  type SeatInfo,
  type TableStatus,
  type TurnInfo,
  type TurnsConfig,
  type Viewer,
  type ViewArgs,
} from './core/define';
export {
  BUILTIN_ERROR_CODES,
  isBuiltinErrorCode,
  isShoehiveError,
  reject,
  ShoehiveError,
  type BuiltinErrorCode,
  type GameErrorCode,
} from './core/errors';
export { TableRuntime, ReplayDivergenceError } from './core/runtime';
export type {
  Commit,
  Diagnostic,
  EmittedEvent,
  EngineSeat,
  EngineState,
  LogEntry,
  LogEntryBase,
  RuntimeOptions,
  Snapshot,
  TableMeta,
  TimerState,
} from './core/runtime';
export { systemClock, type Clock, type TimerHandle } from './core/clock';
export type { Random } from './core/random';
export { applyPatch, diff, type JsonPatchOp } from './core/diff';
export type { Json } from './core/json';
export type { StandardSchemaV1 } from './core/standard-schema';
/** Re-exported from Mutative: a plain snapshot of a draft, handy for logging (ADR 0005). */
// eslint-disable-next-line @typescript-eslint/no-deprecated -- only one overload is deprecated
export { current } from 'mutative';
