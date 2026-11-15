// The devtools wire protocol (ADR 0011): JSON messages on the devtools WebSocket
// (`<path>/ws`, default `/__shoehive/ws`), never on the game socket. Shared by the
// server side (src/devtools/server.ts) and the inspector UI (src/devtools/ui/).
//
// The first client message must be `auth`. Every other client message is a request
// with an `id`, answered by exactly one `result` with the same `id`. The server also
// pushes `tables` and `table.update` messages for what the client watches.

import type { SeatInfo, TableStatus } from '../core/define';
import type { Json } from '../core/json';
import type { Diagnostic, EngineState, LogEntry, TableMeta } from '../core/runtime';

/** Bumped on any breaking change to these messages. */
export const DEVTOOLS_PROTOCOL = 1;

/** The fixture format written by export and read by `replayFixture` (ADR 0011 rule 14). */
export interface Fixture {
  shoehiveFixture: 1;
  game: string;
  version: number;
  /** From the `create` entry (which holds the seed) up to the exported seq. */
  entries: LogEntry[];
  /** What replaying must reproduce: the revision and a SHA-256 of the state JSON. */
  expect?: { rev: number; stateHash: string };
}

export interface DevGameInfo {
  id: string;
  name: string;
  version: number;
  seats: { min: number; max: number };
}

export interface DevTableSummary {
  id: string;
  game: string;
  status: TableStatus;
  rev: number;
  seats: { taken: number; total: number };
  /** Connections that have joined the table (players and spectators). */
  connections: number;
  createdAt: number;
  /** A fork made with `table.fork` (not persisted, not in the lobby). */
  dev: boolean;
  faulted: boolean;
}

/** One viewer's view, as that viewer receives it (ADR 0003). */
export interface DevView {
  /** `'seat:0'`, `'seat:1'`... or `'spectator'`. */
  viewer: string;
  /** For display: the player's name and seat, or "Spectator". */
  label: string;
  view: Json;
}

/** Everything the inspector shows for one table at one revision. */
export interface DevTableDetail {
  id: string;
  game: string;
  /** The revision shown: the live one, or the time-travel target. */
  rev: number;
  /** Number of the last log entry (equals `rev`). */
  seq: number;
  /** `true` when this detail comes from a replayed copy (`table.at`), not the live table. */
  replayed: boolean;
  meta: TableMeta;
  seats: SeatInfo[];
  /** Raw game state: every secret included. */
  state: Json;
  /** Engine state, including the RNG seed. */
  engine: EngineState;
  /** Every seat's view, then the spectator view. */
  views: DevView[];
  /** Recent rejected actions and other diagnostics (live table only; empty when replayed). */
  diagnostics: Diagnostic[];
}

export interface DevSession {
  player: string;
  name: string;
  guest: boolean;
  connections: number;
  /** Tables the player has joined or holds a seat at. */
  tables: string[];
}

export interface DevConnection {
  player: string | null;
  remote: string | null;
  connectedAt: number;
  tables: string[];
}

// ---------------------------------------------------------------------------------
// Client to server

export type DevClientMessage =
  | { t: 'auth'; token: string }
  | { t: 'tables.list'; id: string }
  /** Push `tables` whenever the table list changes, until `tables.unwatch`. */
  | { t: 'tables.watch'; id: string }
  | { t: 'tables.unwatch'; id: string }
  /** Result `DevTableDetail`; then push `table.update` after commits (throttled). */
  | { t: 'table.watch'; id: string; table: string }
  | { t: 'table.unwatch'; id: string; table: string }
  /** Log entries `from <= seq <= to` (default: to the end), from the store. */
  | { t: 'table.log'; id: string; table: string; from: number; to?: number }
  /** Time travel: a replayed copy at `seq`. Never touches the live table. */
  | { t: 'table.at'; id: string; table: string; seq: number }
  /** Fork a dev table from `seq` (default: the latest). Refused in production. */
  | { t: 'table.fork'; id: string; table: string; seq?: number }
  /** Export a fixture up to `seq` (default: the latest). Player ids become p0, p1... */
  | { t: 'table.export'; id: string; table: string; seq?: number }
  | { t: 'sessions.list'; id: string };

export type DevRequest = Exclude<DevClientMessage, { t: 'auth' }>;
export type DevRequestType = DevRequest['t'];

/** The `result` payload for each request type. */
export interface DevResults {
  'tables.list': { tables: DevTableSummary[] };
  'tables.watch': { tables: DevTableSummary[] };
  'tables.unwatch': Record<string, never>;
  'table.watch': DevTableDetail;
  'table.unwatch': Record<string, never>;
  'table.log': { entries: LogEntry[]; last: number };
  'table.at': DevTableDetail;
  'table.fork': { table: string };
  'table.export': { fixture: Fixture; warning: string };
  'sessions.list': { sessions: DevSession[]; connections: DevConnection[] };
}

// ---------------------------------------------------------------------------------
// Server to client

export interface DevWelcome {
  protocol: typeof DEVTOOLS_PROTOCOL;
  /** `true` when the server runs with NODE_ENV=production (forks are refused). */
  production: boolean;
  games: DevGameInfo[];
}

export type DevServerMessage =
  | { t: 'auth.ok'; welcome: DevWelcome }
  | { t: 'result'; id: string; ok: true; result: DevResults[DevRequestType] }
  | { t: 'result'; id: string; ok: false; error: { code: string; message: string } }
  | { t: 'tables'; tables: DevTableSummary[] }
  | { t: 'table.update'; table: string; detail: DevTableDetail }
  | { t: 'table.closed'; table: string; reason: string };

/** Close codes on the devtools socket. */
export const DEVTOOLS_CLOSE = {
  /** No `auth` first, or a wrong token. */
  UNAUTHORIZED: 4401,
  /** Too many failed attempts from this address (ADR 0011 rule 6). */
  LOCKED_OUT: 4429,
} as const;
