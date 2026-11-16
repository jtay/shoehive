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
  type GameId,
  type GameOptions,
  type GameOptionsInput,
  type GamePhases,
  type GameResult,
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
  type TurnArgs,
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
  WalletEffect,
  WalletFailure,
} from './core/runtime';
export { systemClock, type Clock, type TimerHandle } from './core/clock';
export {
  MemoryWallet,
  type Amount,
  type CtxWallet,
  type ReserveResult,
  type Wallet,
  type WalletOp,
  type WalletReservation,
} from './core/wallet';
export type { Random } from './core/random';
export { applyPatch, diff, type JsonPatchOp } from './core/diff';
export type { Json } from './core/json';
export type { StandardSchemaV1 } from './core/standard-schema';
/** Re-exported from Mutative: a plain snapshot of a draft, handy for logging (ADR 0005). */
// eslint-disable-next-line @typescript-eslint/no-deprecated -- only one overload is deprecated
export { current } from 'mutative';
export {
  CLOSE,
  parseClientMessage,
  type Ack,
  type ClientMessage,
  type ClientPing,
  type ParseResult,
  type RequestType,
  type ClientRequest,
  type LobbyDocument,
  type LobbyFilter,
  type LobbyTable,
  type ServerMessage,
  type TableDocument,
  type Welcome,
  type WireError,
} from './protocol/messages';
