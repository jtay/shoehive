// Wire protocol v1 message types (docs/reference/protocol.md) and a validating parser
// for client messages. Isomorphic: used by the server now and by shoehive/client later.

import type { SeatInfo, TableStatus } from '../core/define';
import type { JsonPatchOp } from '../core/diff';
import type { Json } from '../core/json';
import type { TableMeta } from '../core/runtime';

// ---------------------------------------------------------------------------------
// Client to server

export type ClientRequest =
  | {
      t: 'hello';
      id: string;
      v: number;
      resume?: string;
      name?: string;
      client?: { name: string; version: string };
    }
  | { t: 'lobby.sub'; id: string }
  | { t: 'lobby.unsub'; id: string }
  | { t: 'table.create'; id: string; game: string; options?: Json }
  | { t: 'table.join'; id: string; table: string; as?: 'player' | 'spectator' }
  | { t: 'table.leave'; id: string; table: string }
  | { t: 'table.sync'; id: string; table: string }
  | { t: 'seat.take'; id: string; table: string; seat?: number }
  | { t: 'seat.leave'; id: string; table: string; seat?: number }
  | {
      t: 'act';
      id: string;
      table: string;
      name: string;
      input?: Json;
      seat?: number;
      rev?: number;
    };

export type ClientPing = { t: 'ping'; id?: string };
export type ClientMessage = ClientRequest | ClientPing;
export type RequestType = ClientRequest['t'];

// ---------------------------------------------------------------------------------
// Server to client

export interface WireError {
  code: string;
  source: 'shoehive' | 'game';
  message: string;
  details?: Json;
}

export type Ack =
  | { t: 'ack'; id: string; ok: true; result?: Json }
  | { t: 'ack'; id: string; ok: false; error: WireError };

export interface Welcome {
  player: { id: string; name: string; guest: boolean };
  resumeToken: string;
  resumeExpiresAt: number;
  resumed: boolean;
  server: { protocol: 1; now: number; heartbeatMs: number; maxMessageBytes: number };
}

/** One viewer's synced copy of a table (protocol section 6.1). */
export interface TableDocument {
  view: Json;
  meta: TableMeta;
  seats: SeatInfo[];
  spectators: number;
  you: { player: string; seats: number[]; role: 'player' | 'spectator' };
}

export interface LobbyTable {
  id: string;
  game: string;
  status: TableStatus;
  seats: { taken: number; total: number };
  spectators: number;
  createdAt: number;
  listed: Json;
}

export interface LobbyDocument {
  games: {
    id: string;
    name: string;
    description: string | null;
    seats: { min: number; max: number };
  }[];
  tables: LobbyTable[];
}

export type ServerMessage =
  | Ack
  | { t: 'pong'; id?: string; now: number }
  | { t: 'table.snapshot'; table: string; rev: number; doc: TableDocument }
  | { t: 'table.patch'; table: string; from: number; rev: number; ops: JsonPatchOp[] }
  | { t: 'table.event'; table: string; rev: number; name: string; payload: Json }
  | { t: 'table.closed'; table: string; reason: 'ended' | 'closed' | 'game-removed' | 'expired' }
  | { t: 'lobby.snapshot'; rev: number; doc: LobbyDocument }
  | { t: 'lobby.patch'; from: number; rev: number; ops: JsonPatchOp[] }
  | { t: 'bye'; code: number; reason: string };

/** Close codes (protocol section 8). */
export const CLOSE = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  TOO_BIG: 1009,
  HELLO_TIMEOUT: 4000,
  UNSUPPORTED_PROTOCOL: 4001,
  PROTOCOL_VIOLATION: 4002,
  UNAUTHORIZED: 4401,
  KICKED: 4409,
  RATE_LIMIT_ABUSE: 4429,
} as const;

// ---------------------------------------------------------------------------------
// Parsing

export type ParseResult =
  { ok: true; message: ClientMessage } | { ok: false; id: string | null; message: string };

const MAX_ID = 64;
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown, max = 256): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const isSeat = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) < 64;

/**
 * Parses and validates one client message. Never throws. Unknown fields are ignored
 * (protocol section 1, rule 5); the returned message contains only known fields.
 */
export function parseClientMessage(raw: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, id: null, message: 'Message is not valid JSON' };
  }
  if (!isObject(data) || typeof data['t'] !== 'string') {
    return { ok: false, id: null, message: 'Message must be an object with a string "t"' };
  }
  const t = data['t'];
  const rawId = data['id'];
  const id = typeof rawId === 'string' && rawId.length > 0 && rawId.length <= MAX_ID ? rawId : null;
  const bad = (message: string): ParseResult => ({ ok: false, id, message });

  if (t === 'ping') return { ok: true, message: id === null ? { t } : { t, id } };
  if (id === null) return bad(`"id" must be a string of 1 to ${String(MAX_ID)} characters`);

  const table = data['table'];
  const needTable = (): string | null => (isString(table, 128) ? table : null);
  switch (t) {
    case 'hello': {
      if (typeof data['v'] !== 'number') return bad('"v" must be a number');
      const out: Extract<ClientRequest, { t: 'hello' }> = { t, id, v: data['v'] };
      if (data['resume'] !== undefined) {
        if (!isString(data['resume'], 2048)) return bad('"resume" must be a string');
        out.resume = data['resume'];
      }
      if (data['name'] !== undefined) {
        if (typeof data['name'] !== 'string') return bad('"name" must be a string');
        out.name = data['name'];
      }
      const client = data['client'];
      if (isObject(client) && isString(client['name']) && isString(client['version'])) {
        out.client = { name: client['name'], version: client['version'] };
      }
      return { ok: true, message: out };
    }
    case 'lobby.sub':
    case 'lobby.unsub':
      return { ok: true, message: { t, id } };
    case 'table.create': {
      if (!isString(data['game'], 128)) return bad('"game" must be a string');
      const out: Extract<ClientRequest, { t: 'table.create' }> = { t, id, game: data['game'] };
      if (data['options'] !== undefined) out.options = data['options'] as Json;
      return { ok: true, message: out };
    }
    case 'table.join': {
      const tid = needTable();
      if (tid === null) return bad('"table" must be a string');
      const as = data['as'];
      if (as !== undefined && as !== 'player' && as !== 'spectator')
        return bad('"as" must be "player" or "spectator"');
      return {
        ok: true,
        message: as === undefined ? { t, id, table: tid } : { t, id, table: tid, as },
      };
    }
    case 'table.leave':
    case 'table.sync': {
      const tid = needTable();
      if (tid === null) return bad('"table" must be a string');
      return { ok: true, message: { t, id, table: tid } };
    }
    case 'seat.take':
    case 'seat.leave': {
      const tid = needTable();
      if (tid === null) return bad('"table" must be a string');
      const seat = data['seat'];
      if (seat !== undefined && !isSeat(seat)) return bad('"seat" must be a seat number');
      return {
        ok: true,
        message: seat === undefined ? { t, id, table: tid } : { t, id, table: tid, seat },
      };
    }
    case 'act': {
      const tid = needTable();
      if (tid === null) return bad('"table" must be a string');
      if (!isString(data['name'], 128)) return bad('"name" must be a string');
      const out: Extract<ClientRequest, { t: 'act' }> = { t, id, table: tid, name: data['name'] };
      if (data['input'] !== undefined) out.input = data['input'] as Json;
      if (data['seat'] !== undefined) {
        if (!isSeat(data['seat'])) return bad('"seat" must be a seat number');
        out.seat = data['seat'];
      }
      if (data['rev'] !== undefined) {
        if (!Number.isInteger(data['rev'])) return bad('"rev" must be an integer');
        out.rev = data['rev'] as number;
      }
      return { ok: true, message: out };
    }
    default:
      return bad(`Unknown message type "${t}"`);
  }
}
