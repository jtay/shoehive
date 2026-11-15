/**
 * shoehive/devtools: the inspector with replay and time travel (ADR 0011).
 *
 * Enable it on the server; the inspector URL (with its token) is logged once at startup:
 *
 * ```ts
 * import { createServer } from 'shoehive/server';
 * const shoehive = createServer({ games: [ticTacToe], devtools: true });
 * await shoehive.listen({ port: 3000 });
 * // Devtools inspector: http://localhost:3000/__shoehive/#token=...
 * ```
 *
 * This entry point holds the option type, the wire protocol shared with the inspector
 * UI, and the fixture format that `replayFixture` in `shoehive/testing` reads. The
 * backend itself is loaded by the server only when devtools is enabled.
 *
 * @packageDocumentation
 */
export type { DevtoolsHandle, DevtoolsOption } from './server';
export {
  DEVTOOLS_CLOSE,
  DEVTOOLS_PROTOCOL,
  type DevClientMessage,
  type DevConnection,
  type DevGameInfo,
  type DevRequest,
  type DevRequestType,
  type DevResults,
  type DevServerMessage,
  type DevSession,
  type DevTableDetail,
  type DevTableSummary,
  type DevView,
  type DevWelcome,
  type Fixture,
} from './protocol';
