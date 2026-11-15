/**
 * shoehive/client: the framework-agnostic TypeScript client. Isomorphic: no Node built-ins.
 *
 * ```ts
 * import { createClient } from 'shoehive/client';
 * import type { ticTacToe } from './games/tic-tac-toe'; // type-only: no server code bundled
 *
 * const client = createClient<[typeof ticTacToe]>({ url: 'ws://localhost:3000/shoehive' });
 * const table = await client.createAndJoin('tic-tac-toe');
 * await table.act('place', { cell: 4 });
 * ```
 *
 * @packageDocumentation
 */
export {
  CLIENT_ERROR_CODES,
  createClient,
  LobbyHandle,
  ShoehiveClient,
  TableHandle,
  type ActArgs,
  type ActResult,
  type ClientOptions,
  type ConnectionStatus,
  type GameById,
  type TokenStorage,
  type TypedTableMeta,
  type WebSocketLike,
} from './client';
export { ShoehiveError, isShoehiveError } from '../core/errors';
export type { LobbyDocument, LobbyFilter, TableDocument, Welcome } from '../protocol/messages';
