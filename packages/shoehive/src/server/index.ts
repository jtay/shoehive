/**
 * shoehive/server: sessions, lobby, seats, transports and the server runtime.
 *
 * ```ts
 * import { createServer } from 'shoehive/server';
 * const shoehive = createServer({ games: [ticTacToe] });
 * await shoehive.listen({ port: 3000 });
 * ```
 *
 * @packageDocumentation
 */
export {
  createServer,
  type AuthHook,
  type PlayerIdentity,
  type ServerEvents,
  type ServerLimits,
  type ServerOptions,
  type ShoehiveServer,
  type TableInfo,
} from './server';
export type { Connection, MemorySocket, UpgradeRequest } from './transport';
export type { DevtoolsHandle, DevtoolsOption } from '../devtools/server';
export { consoleLogger, silentLogger, type Logger } from './logger';
export {
  MemoryWallet,
  type Amount,
  type ReserveResult,
  type Wallet,
  type WalletOp,
  type WalletReservation,
} from '../core/wallet';
export {
  StoreConflictError,
  type SessionRecord,
  type Store,
  type StoredEntry,
  type StoredSnapshot,
} from '../store/types';
export { memoryStore } from '../store/memory';
