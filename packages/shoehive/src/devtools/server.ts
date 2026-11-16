// The devtools backend (ADR 0011): static inspector UI over HTTP and the devtools
// WebSocket (`<path>/ws`). Loaded with a dynamic import only when devtools is enabled
// (rule 7). It never reaches into server internals: the server hands it a small
// `DevtoolsHost`, and calls its notification methods on commits and table changes.
//
// Live tables are read-only here (rule 10). Time travel, fork and export work on copies
// replayed from the stored log with a fresh MemoryWallet (rules 12 to 14).

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Clock, TimerHandle } from '../core/clock';
import type { AnyGame } from '../core/define';
import type { Json } from '../core/json';
import { randomTableId, TableRuntime, type LogEntry, type WalletEffect } from '../core/runtime';
import { bytesToHex, sha256 } from '../core/sha256';
import { MemoryWallet, type WalletOp } from '../core/wallet';
import type { Logger } from '../server/logger';
import type { Store } from '../store/types';
import {
  DEVTOOLS_CLOSE,
  DEVTOOLS_PROTOCOL,
  type DevConnection,
  type DevRequest,
  type DevRequestType,
  type DevResults,
  type DevServerMessage,
  type DevSession,
  type DevTableDetail,
  type DevTableSummary,
  type DevView,
  type Fixture,
} from './protocol';
import { DEVTOOLS_UI } from './ui-assets.generated';

// ---------------------------------------------------------------------------------
// Public types

/**
 * The `devtools` server option (ADR 0011). Off by default.
 *
 * - `true` enables the inspector outside production (`NODE_ENV !== 'production'`) with a
 *   generated token; in production it is ignored with a warning.
 * - In production, enabling needs `{ enabled: true, allowInProduction: true, token }`
 *   with a token of at least 32 characters, otherwise `createServer` throws.
 */
export type DevtoolsOption =
  | boolean
  | {
      enabled: boolean;
      /** Required in production; generated (32 random bytes) in dev if omitted. */
      token?: string;
      /** HTTP path of the inspector. Default `'/__shoehive'`; the socket is `<path>/ws`. */
      path?: string;
      /** Serve non-loopback clients too. Default `false`: loopback clients only. */
      allowRemote?: boolean;
      /** Allow devtools when `NODE_ENV === 'production'`. Default `false`. */
      allowInProduction?: boolean;
    };

/** `shoehive.devtools`: present only when devtools is enabled. */
export interface DevtoolsHandle {
  /** The inspector's HTTP path, for example `'/__shoehive'`. */
  readonly path: string;
  /**
   * Answers a devtools HTTP request and returns `true`, or returns `false` (without
   * touching `res`) for any other path. `attach()` already routes devtools paths ahead
   * of the app's `request` listeners; call this from your own handler only when your
   * HTTP stack cannot be wrapped that way (listeners added after `attach()`, or a
   * framework that owns dispatch):
   *
   * ```ts
   * http.on('request', (req, res) => {
   *   if (shoehive.devtools?.handleRequest(req, res)) return;
   *   app(req, res);
   * });
   * ```
   */
  handleRequest(req: IncomingMessage, res: ServerResponse): boolean;
}

// ---------------------------------------------------------------------------------
// Internal contract with the server

/** Devtools settings after the server applied the production rules (ADR 0011 rules 1 to 4). */
export interface DevtoolsConfig {
  token: string;
  path: string;
  allowRemote: boolean;
  production: boolean;
}

/** One table as the server describes it to devtools. */
export interface DevtoolsHostTable {
  id: string;
  game: AnyGame;
  runtime: TableRuntime;
  createdAt: number;
  dev: boolean;
  /** Connections joined to the table. */
  connections: number;
}

/** What the server gives devtools. Nothing here can change a live table. */
export interface DevtoolsHost {
  production: boolean;
  /** Dev checks for replayed runtimes (the server's `dev` option). */
  dev: boolean;
  logger: Logger;
  clock: Clock;
  store: Store;
  /** The server's `origins` option (empty: any origin allowed on the game socket). */
  origins: readonly string[];
  games(): readonly AnyGame[];
  tables(): DevtoolsHostTable[];
  table(id: string): DevtoolsHostTable | undefined;
  sessions(): { sessions: DevSession[]; connections: DevConnection[] };
  /**
   * Registers a fork as a dev table: hidden from the lobby, never persisted, joinable by
   * normal clients. The runtime is live and uses its own MemoryWallet.
   */
  registerFork(fork: { id: string; game: AnyGame; runtime: TableRuntime }): Promise<void>;
}

/** What the server calls on devtools. */
export interface DevtoolsBackend {
  /** `true` if the request was a devtools request (answered), `false` otherwise. */
  handleRequest(req: IncomingMessage, res: ServerResponse): boolean;
  /** `true` if the upgrade was for the devtools socket (handled), `false` otherwise. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean;
  tableCommitted(table: string): void;
  tablesChanged(): void;
  tableClosed(table: string, reason: string): void;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------------
// Constants

const THROTTLE_MS = 100;
const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 15_000;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_IN_FLIGHT = 8;
const MAX_LOG_ENTRIES = 5000;
const AT_CACHE_SIZE = 32;
const FAILURE_WINDOW_MS = 60_000;
const LOCKOUT_MS = 60_000;
const MAX_FAILURES = 5;
const FORK_STARTING_BALANCE = 1000;

const EXPORT_WARNING =
  'This fixture contains the RNG seed and every action of the table. A fixture from a ' +
  "production table reveals that table's cards: treat it as a secret. Player ids and names " +
  'are replaced; free text in action inputs, timestamps and wallet balances read by the ' +
  'game are kept.';

const EXPORT_KEPT_IDS =
  ' Player ids inside action inputs and table options could not be replaced (the game did ' +
  'not replay with them replaced), so they are kept in this fixture.';

const REQUEST_TYPES = new Set<DevRequestType>([
  'tables.list',
  'tables.watch',
  'tables.unwatch',
  'table.watch',
  'table.unwatch',
  'table.log',
  'table.at',
  'table.fork',
  'table.export',
  'sessions.list',
]);

/** A strict CSP. `connect-src` names the socket's own host for browsers whose 'self' omits ws:. */
function contentSecurityPolicy(host: string | undefined): string {
  const ws = host !== undefined && /^[a-z0-9.\-:[\]]{1,255}$/i.test(host);
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    `connect-src 'self'${ws ? ` ws://${host} wss://${host}` : ''}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join('; ');
}

function securityHeaders(req: IncomingMessage): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': contentSecurityPolicy(req.headers.host),
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}

// ---------------------------------------------------------------------------------
// Helpers

class DevError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The remote address without the IPv4-mapped IPv6 prefix. */
function remoteOf(req: IncomingMessage): string {
  const address = req.socket.remoteAddress ?? '';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

/** Loopback clients: 127.0.0.0/8 and ::1. */
function isLoopback(address: string): boolean {
  return address === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address);
}

/** Headers a proxy adds when it relays a request (a same-host proxy connects from loopback). */
const FORWARDED_HEADERS = ['forwarded', 'x-forwarded-for', 'x-real-ip'] as const;

/**
 * Whether a `Host` header names this machine in a way a DNS rebinding page cannot use: an
 * IP literal, `localhost` or a `.localhost` name (RFC 6761: browsers resolve those to
 * loopback themselves). A page whose origin is an attacker's domain sends that domain.
 */
function isLocalHost(host: string): boolean {
  const value = host.toLowerCase();
  if (value.startsWith('[')) return /^\[[0-9a-f:.]+\](?::\d{1,5})?$/.test(value);
  const name = value.replace(/:\d{1,5}$/, '');
  return (
    name === 'localhost' ||
    name.endsWith('.localhost') ||
    /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name)
  );
}

function pathOf(url: string | undefined): string {
  const raw = url ?? '/';
  const end = raw.search(/[?#]/);
  return end < 0 ? raw : raw.slice(0, end);
}

/** Constant-time token comparison (hashing first makes the lengths equal). */
function tokenMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** The fixture `stateHash`: SHA-256 (hex) of the state's JSON (as `fixtureStateHash`). */
function stateHash(state: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(state))));
}

/** A clock frozen at `at` whose timers never fire: replayed copies are not live. */
function fixedClock(at: number): Clock {
  return {
    now: () => at,
    setTimer: (): TimerHandle => ({}),
    clearTimer: () => undefined,
  };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const isSeq = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Validates a client message. Returns the request, or a reason it is malformed. */
function parseRequest(
  raw: unknown,
): { ok: true; request: DevRequest } | { ok: false; id: string | null; reason: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { ok: false, id: null, reason: 'Messages are JSON objects' };
  const m = raw as Record<string, unknown>;
  const id = typeof m['id'] === 'string' && m['id'].length <= 64 ? m['id'] : null;
  if (id === null) return { ok: false, id: null, reason: 'Requests need a string id' };
  const t = m['t'];
  if (typeof t !== 'string' || !REQUEST_TYPES.has(t as DevRequestType))
    return {
      ok: false,
      id,
      reason: `Unknown request type ${typeof t === 'string' ? JSON.stringify(t) : typeof t}`,
    };
  const bad = (reason: string) => ({ ok: false as const, id, reason });
  if (t.startsWith('table.')) {
    const table = m['table'];
    if (typeof table !== 'string' || table.length === 0 || table.length > 128)
      return bad('`table` must be a table id');
  }
  for (const key of ['seq', 'from', 'to']) {
    if (m[key] !== undefined && !isSeq(m[key]))
      return bad(`\`${key}\` must be a non-negative integer`);
  }
  if (t === 'table.log' && m['from'] === undefined) return bad('`from` is required');
  if (t === 'table.at' && m['seq'] === undefined) return bad('`seq` is required');
  return { ok: true, request: m as unknown as DevRequest };
}

// ---------------------------------------------------------------------------------
// Export anonymization (ADR 0011 rule 14)

type Anonymized = { entries: LogEntry[] };

/**
 * Replaces player ids with p0, p1... (in order of first appearance) and names with
 * aliases of those ids, consistently across the log: action entries, `sit` / `rename`
 * and other system entries, wallet credit ops, and colon-separated segments of wallet
 * keys. With `deep`, strings (and object keys) equal to a player id inside action and
 * timer inputs and the table options are replaced too. Each player's distinct names map to distinct aliases,
 * so a rename stays a rename on replay. The seed is kept: the fixture needs it.
 */
function anonymize(entries: readonly LogEntry[], deep: boolean): Anonymized {
  const ids = new Map<string, string>();
  const alias = (id: string): string => {
    let a = ids.get(id);
    if (a === undefined) {
      a = `p${String(ids.size)}`;
      ids.set(id, a);
    }
    return a;
  };
  for (const entry of entries) {
    if (entry.kind === 'action') alias(entry.player);
    else if (entry.kind === 'system' && entry.player !== null)
      alias(typeof entry.player === 'string' ? entry.player : entry.player.id);
    for (const op of entry.wallet ?? []) if (op.op === 'credit') alias(op.player);
  }
  const names = new Map<string, Map<string, string>>();
  const nameOf = (id: string, name: string): string => {
    const a = alias(id);
    let known = names.get(a);
    if (!known) {
      known = new Map();
      names.set(a, known);
    }
    let n = known.get(name);
    if (n === undefined) {
      n = known.size === 0 ? a : `${a} (${String(known.size + 1)})`;
      known.set(name, n);
    }
    return n;
  };
  const id = (value: string): string => ids.get(value) ?? value;
  const key = (value: string): string => value.split(':').map(id).join(':');
  const replaceDeep = (value: Json): Json => {
    if (typeof value === 'string') return id(value);
    if (Array.isArray(value)) return value.map(replaceDeep);
    if (value !== null && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [id(k), replaceDeep(v)]));
    return value;
  };
  const input = (value: Json): Json => (deep ? replaceDeep(value) : value);
  const effect = (e: WalletEffect): WalletEffect =>
    e.op === 'reserve' ? { ...e, key: key(e.key) } : e;
  const walletOp = (op: WalletOp): WalletOp =>
    op.op === 'credit'
      ? { ...op, key: key(op.key), player: id(op.player) }
      : { ...op, key: key(op.key) };

  const out = entries.map((entry): LogEntry => {
    const base = {
      ...(entry.effects ? { effects: entry.effects.map(effect) } : {}),
      ...(entry.wallet ? { wallet: entry.wallet.map(walletOp) } : {}),
    };
    switch (entry.kind) {
      case 'create':
        return deep
          ? { ...entry, ...base, options: replaceDeep(entry.options) }
          : { ...entry, ...base };
      case 'action':
        return { ...entry, ...base, player: id(entry.player), input: input(entry.input) };
      case 'timer':
        return { ...entry, ...base, input: input(entry.input) };
      case 'system':
        if (entry.event === 'sit' || entry.event === 'rename')
          return {
            ...entry,
            ...base,
            player: { id: id(entry.player.id), name: nameOf(entry.player.id, entry.player.name) },
          };
        if (entry.player === null || typeof entry.player !== 'string') return { ...entry, ...base };
        return { ...entry, ...base, player: id(entry.player) };
    }
  });
  return { entries: out };
}

// ---------------------------------------------------------------------------------
// Detail and summaries

function detailOf(id: string, runtime: TableRuntime, replayed: boolean): DevTableDetail {
  return {
    id,
    game: runtime.game.id,
    rev: runtime.rev,
    seq: runtime.engine.seq,
    replayed,
    meta: runtime.meta(),
    seats: runtime.seats(),
    state: runtime.state as Json,
    engine: runtime.engine,
    views: viewsOf(runtime),
    diagnostics: replayed ? [] : [...runtime.diagnostics()],
  };
}

/**
 * Every seated player's view (one per player, labelled with their seats), then the
 * spectator view. Computed with `view(viewerFor(player))` on the committed state,
 * exactly as sync does (ADR 0011 rule 11). Empty seats have no viewer.
 */
function viewsOf(runtime: TableRuntime): DevView[] {
  const views: DevView[] = [];
  const seen = new Set<string>();
  const viewOf = (viewer: ReturnType<TableRuntime['viewerFor']>): { view: Json; error: string } => {
    try {
      return { view: runtime.view(viewer), error: '' };
    } catch (error) {
      return { view: null, error: ` (view() threw: ${message(error)})` };
    }
  };
  for (const seat of runtime.seats()) {
    const player = seat.player;
    if (!player || seen.has(player.id)) continue;
    seen.add(player.id);
    const viewer = runtime.viewerFor(player.id);
    const seats = viewer.seats.join(', ');
    const { view, error } = viewOf(viewer);
    views.push({
      viewer: `seat:${String(viewer.seat)}`,
      label: `${player.name} (seat${viewer.seats.length > 1 ? 's' : ''} ${seats})${error}`,
      view,
    });
  }
  const { view, error } = viewOf(runtime.viewerFor(null));
  views.push({ viewer: 'spectator', label: `Spectator${error}`, view });
  return views;
}

function summaryOf(table: DevtoolsHostTable): DevTableSummary {
  const { runtime } = table;
  return {
    id: table.id,
    game: table.game.id,
    status: runtime.status,
    rev: runtime.rev,
    seats: {
      taken: runtime.seats().filter((s) => s.status !== 'empty').length,
      total: table.game.seats.max,
    },
    connections: table.connections,
    createdAt: table.createdAt,
    dev: table.dev,
    faulted: runtime.faulted,
  };
}

// ---------------------------------------------------------------------------------
// Clients

interface Watch {
  timer: ReturnType<typeof setTimeout> | null;
  lastSent: number;
}

interface Client {
  ws: WebSocket;
  remote: string;
  authed: boolean;
  authTimer: ReturnType<typeof setTimeout> | null;
  inFlight: number;
  watchingTables: boolean;
  lastTables: string;
  tables: Map<string, Watch>;
  missed: number;
}

/** Creates the devtools backend. Called by the server after the dynamic import. */
export function createDevtools(host: DevtoolsHost, config: DevtoolsConfig): DevtoolsBackend {
  const { logger } = host;
  const prefix = config.path;
  const wsPath = `${prefix}/ws`;
  const clients = new Set<Client>();
  const failures = new Map<string, { times: number[]; lockedUntil: number }>();
  const atCache = new Map<string, DevTableDetail>();
  const hintsLogged = new Set<string>();
  /** Hosts from the server's `origins` option, also accepted as `Host` (named dev boxes). */
  const originHosts = new Set(
    host.origins.flatMap((origin) => {
      try {
        return [new URL(origin).host];
      } catch {
        return [];
      }
    }),
  );
  let tablesTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTablesPush = 0;
  let closed = false;

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  const send = (client: Client, msg: DevServerMessage): void => {
    if (client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(msg));
  };

  const hint = (kind: string, message: string, data: Record<string, unknown>): void => {
    if (hintsLogged.has(kind)) return;
    hintsLogged.add(kind);
    logger.warn(message, data);
  };

  /**
   * ADR 0011 rule 4: without `allowRemote`, only this machine is served. The TCP peer must
   * be loopback, the request must not have been relayed by a proxy (which connects from
   * loopback on behalf of anyone), and the `Host` must not be a DNS name, so a page that
   * rebinds its own domain to 127.0.0.1 cannot reach the inspector.
   */
  const refuseRemote = (req: IncomingMessage, remote: string): boolean => {
    if (config.allowRemote) return false;
    if (!isLoopback(remote)) {
      hint(
        'remote',
        `Devtools answered 404 to ${remote}: only loopback clients are allowed. Set devtools: { enabled: true, allowRemote: true } to serve other addresses.`,
        { remote },
      );
      return true;
    }
    if (FORWARDED_HEADERS.some((name) => req.headers[name] !== undefined)) {
      hint(
        'proxy',
        'Devtools answered 404 to a request relayed by a proxy: only direct loopback clients are allowed. Set devtools: { enabled: true, allowRemote: true } to serve it through a proxy.',
        { remote },
      );
      return true;
    }
    const name = req.headers.host;
    if (name !== undefined && !isLocalHost(name) && !originHosts.has(name)) {
      hint(
        'host',
        `Devtools answered 404 to a request for host "${name}" (DNS rebinding protection): open it at localhost or 127.0.0.1, list the origin in the server's \`origins\` option, or set allowRemote: true.`,
        { remote, host: name },
      );
      return true;
    }
    return false;
  };

  // -------------------------------------------------------------------------------
  // Lockout (ADR 0011 rule 6)

  const lockedOut = (remote: string, now: number): boolean => {
    const record = failures.get(remote);
    return record !== undefined && record.lockedUntil > now;
  };

  const recordFailure = (remote: string, now: number): void => {
    if (failures.size > 10_000) {
      for (const [address, record] of failures) {
        if (record.lockedUntil <= now && record.times.every((t) => now - t >= FAILURE_WINDOW_MS))
          failures.delete(address);
      }
    }
    const record = failures.get(remote) ?? { times: [], lockedUntil: 0 };
    record.times = record.times.filter((t) => now - t < FAILURE_WINDOW_MS);
    record.times.push(now);
    if (record.times.length >= MAX_FAILURES) {
      record.lockedUntil = now + LOCKOUT_MS;
      record.times = [];
      logger.warn('Devtools: too many failed authentications, address locked out for a minute', {
        remote,
      });
    }
    failures.set(remote, record);
  };

  // -------------------------------------------------------------------------------
  // HTTP

  const handleRequest = (req: IncomingMessage, res: ServerResponse): boolean => {
    const path = pathOf(req.url);
    if (path !== prefix && !path.startsWith(`${prefix}/`)) return false;
    const headers = securityHeaders(req);
    const plain = (status: number, body: string, extra: Record<string, string> = {}): void => {
      res
        .writeHead(status, {
          ...headers,
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Length': String(Buffer.byteLength(body)),
          ...extra,
        })
        .end(req.method === 'HEAD' ? undefined : body);
    };
    if (closed || refuseRemote(req, remoteOf(req))) {
      plain(404, 'Not found\n');
      return true;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      plain(405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
      return true;
    }
    if (path === prefix) {
      // Relative asset URLs need the trailing slash. Browsers keep the #token fragment.
      plain(308, 'Moved\n', { Location: `${prefix}/` });
      return true;
    }
    const name = path.slice(prefix.length + 1) || 'index.html';
    const asset = Object.hasOwn(DEVTOOLS_UI, name) ? DEVTOOLS_UI[name] : undefined;
    if (!asset) {
      plain(404, 'Not found\n');
      return true;
    }
    const body = Buffer.from(asset.body, 'utf8');
    res
      .writeHead(200, {
        ...headers,
        'Content-Type': asset.type,
        'Content-Length': String(body.length),
      })
      .end(req.method === 'HEAD' ? undefined : body);
    return true;
  };

  // -------------------------------------------------------------------------------
  // WebSocket

  const refuse = (socket: Duplex, status: number, text: string): void => {
    socket.end(
      `HTTP/1.1 ${String(status)} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  };

  /** Same policy as the game socket when `origins` is set; same-host origins always pass. */
  const originAllowed = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin;
    if (origin === undefined) return host.origins.length === 0; // not a browser
    if (host.origins.includes(origin)) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  };

  const handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): boolean => {
    if (pathOf(req.url) !== wsPath) return false;
    const remote = remoteOf(req);
    if (closed || refuseRemote(req, remote)) {
      refuse(socket, 404, 'Not Found');
      return true;
    }
    if (!originAllowed(req)) {
      refuse(socket, 403, 'Forbidden');
      return true;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      accept(ws, remote);
    });
    return true;
  };

  const accept = (ws: WebSocket, remote: string): void => {
    ws.on('error', () => undefined);
    const client: Client = {
      ws,
      remote,
      authed: false,
      authTimer: null,
      inFlight: 0,
      watchingTables: false,
      lastTables: '',
      tables: new Map(),
      missed: 0,
    };
    clients.add(client);
    ws.on('close', () => {
      drop(client);
    });
    ws.on('pong', () => {
      client.missed = 0;
    });
    if (lockedOut(remote, Date.now())) {
      ws.close(DEVTOOLS_CLOSE.LOCKED_OUT, 'Locked out');
      return;
    }
    client.authTimer = setTimeout(() => {
      if (!client.authed) ws.close(DEVTOOLS_CLOSE.UNAUTHORIZED, 'No auth');
    }, AUTH_TIMEOUT_MS);
    client.authTimer.unref();
    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        ws.close(1003, 'Binary frames are not supported');
        return;
      }
      const text = (
        Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
      ).toString('utf8');
      onMessage(client, text);
    });
  };

  const drop = (client: Client): void => {
    clients.delete(client);
    if (client.authTimer !== null) clearTimeout(client.authTimer);
    for (const watch of client.tables.values()) if (watch.timer !== null) clearTimeout(watch.timer);
    client.tables.clear();
  };

  const onMessage = (client: Client, text: string): void => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = undefined;
    }
    if (!client.authed) {
      const now = Date.now();
      if (lockedOut(client.remote, now)) {
        client.ws.close(DEVTOOLS_CLOSE.LOCKED_OUT, 'Locked out');
        return;
      }
      const m = raw as { t?: unknown; token?: unknown } | null | undefined;
      const ok =
        typeof m === 'object' &&
        m !== null &&
        m.t === 'auth' &&
        typeof m.token === 'string' &&
        tokenMatches(m.token, config.token);
      if (!ok) {
        recordFailure(client.remote, now);
        client.ws.close(
          lockedOut(client.remote, now) ? DEVTOOLS_CLOSE.LOCKED_OUT : DEVTOOLS_CLOSE.UNAUTHORIZED,
          'Unauthorized',
        );
        return;
      }
      client.authed = true;
      if (client.authTimer !== null) clearTimeout(client.authTimer);
      client.authTimer = null;
      logger.warn('Devtools session authenticated', { remote: client.remote });
      send(client, {
        t: 'auth.ok',
        welcome: {
          protocol: DEVTOOLS_PROTOCOL,
          production: host.production,
          games: host.games().map((g) => ({
            id: g.id,
            name: g.name ?? g.id,
            version: g.version ?? 1,
            seats: { min: g.seats.min, max: g.seats.max },
          })),
        },
      });
      return;
    }
    const parsed = parseRequest(raw);
    if (!parsed.ok) {
      if (parsed.id !== null)
        send(client, {
          t: 'result',
          id: parsed.id,
          ok: false,
          error: { code: 'BAD_REQUEST', message: parsed.reason },
        });
      return;
    }
    const request = parsed.request;
    if (client.inFlight >= MAX_IN_FLIGHT) {
      send(client, {
        t: 'result',
        id: request.id,
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests in flight' },
      });
      return;
    }
    client.inFlight += 1;
    handle(client, request)
      .then(
        (result) => {
          send(client, { t: 'result', id: request.id, ok: true, result });
          if (request.t === 'table.watch') {
            // Commits between computing the result and now: push the latest.
            const detail = result as DevTableDetail;
            const table = host.table(request.table);
            if (table && table.runtime.rev !== detail.rev) tableCommitted(request.table);
          }
        },
        (error: unknown) => {
          const code = error instanceof DevError ? error.code : 'INTERNAL';
          if (!(error instanceof DevError))
            logger.error('Devtools request failed', { type: request.t, error });
          send(client, {
            t: 'result',
            id: request.id,
            ok: false,
            error: { code, message: message(error) },
          });
        },
      )
      .finally(() => {
        client.inFlight -= 1;
      });
  };

  // -------------------------------------------------------------------------------
  // Requests

  const requireTable = (id: string): DevtoolsHostTable => {
    const table = host.table(id);
    if (!table) throw new DevError('NOT_FOUND', `Unknown table "${id}"`);
    return table;
  };

  const checkSeq = (table: DevtoolsHostTable, seq: number): void => {
    const last = table.runtime.engine.seq;
    if (seq > last)
      throw new DevError(
        'BAD_REQUEST',
        `seq ${String(seq)} is past the last entry (${String(last)})`,
      );
  };

  /** Entries `from..to` of a table: from the store, or from memory for a fork. */
  const readLog = async (
    table: DevtoolsHostTable,
    from: number,
    to: number,
  ): Promise<LogEntry[]> => {
    if (to < from) return [];
    if (table.dev) return table.runtime.log.filter((e) => e.seq >= from && e.seq <= to);
    const stored = await host.store.readLog(table.id, from, to);
    return stored.map((e) => JSON.parse(e.data) as LogEntry);
  };

  /** The full log from the create entry up to `seq` (ADR 0009: through `Store.readLog`). */
  const fullLog = async (table: DevtoolsHostTable, seq: number): Promise<LogEntry[]> => {
    const entries = await readLog(table, 0, seq);
    if (entries.length !== seq + 1 || entries.some((e, i) => e.seq !== i))
      throw new DevError('LOG_UNAVAILABLE', `The stored log of "${table.id}" is incomplete`);
    return entries;
  };

  /** A read-only copy at the last entry of `entries`: fixed clock, MemoryWallet, no store. */
  const sandbox = async (game: AnyGame, entries: readonly LogEntry[]): Promise<TableRuntime> => {
    try {
      return await TableRuntime.replay(game, entries, {
        clock: fixedClock(entries.at(-1)!.at),
        dev: host.dev,
        wallet: new MemoryWallet(),
      });
    } catch (error) {
      throw new DevError('REPLAY_FAILED', `Replay failed: ${message(error)}`);
    }
  };

  const tableAt = async (table: DevtoolsHostTable, seq: number): Promise<DevTableDetail> => {
    checkSeq(table, seq);
    const key = `${table.id}\u0000${String(table.createdAt)}\u0000${String(seq)}`;
    const cached = atCache.get(key);
    if (cached) {
      atCache.delete(key);
      atCache.set(key, cached);
      return cached;
    }
    const runtime = await sandbox(table.game, await fullLog(table, seq));
    const detail = detailOf(table.id, runtime, true);
    runtime.dispose();
    atCache.set(key, detail);
    while (atCache.size > AT_CACHE_SIZE) atCache.delete(atCache.keys().next().value!);
    return detail;
  };

  const fork = async (table: DevtoolsHostTable, seq: number): Promise<string> => {
    if (host.production)
      throw new DevError('FORBIDDEN', 'Forks are refused in production (ADR 0011 rule 13)');
    checkSeq(table, seq);
    const id = `dev_${randomTableId().slice(2)}`;
    const source = await fullLog(table, seq);
    const create = source[0]!;
    if (create.kind !== 'create') throw new DevError('LOG_UNAVAILABLE', 'No create entry');
    const entries: LogEntry[] = [{ ...create, table: id }, ...source.slice(1)];

    // A fresh MemoryWallet (ADR 0007): seeded with each player's last recorded balance,
    // and holding every reservation still open at `seq` (amount 0), so the fork can
    // commit or release it. Funds held by those reservations are not modelled.
    const seated = new Map<number, string>();
    const balances: Record<string, number> = {};
    const open = new Map<string, string>();
    for (const entry of entries) {
      if (entry.kind === 'system' && entry.event === 'sit') seated.set(entry.seat, entry.player.id);
      for (const effect of entry.effects ?? []) {
        if (effect.op === 'balance') {
          const player = seated.get(effect.seat);
          if (player !== undefined && !effect.error) balances[player] = effect.amount;
        } else if (effect.ok) {
          open.set(effect.key, entry.kind === 'action' ? entry.player : '');
        }
      }
      for (const op of entry.wallet ?? []) if (op.op !== 'credit') open.delete(op.key);
      if (entry.kind === 'system' && (entry.event === 'stand' || entry.event === 'grace-expired'))
        seated.delete(entry.seat);
    }
    const wallet = new MemoryWallet({ startingBalance: FORK_STARTING_BALANCE, balances });
    for (const [key, player] of open) await wallet.reserve(player, 0, key);

    let runtime: TableRuntime;
    try {
      runtime = await TableRuntime.replay(table.game, entries, {
        live: true,
        // The fresh wallet never saw the recorded ops: do not re-send history.
        resendWalletOps: false,
        clock: host.clock,
        dev: host.dev,
        wallet,
        onWalletError: ({ op, error }) => {
          logger.warn('A wallet operation failed on a dev fork (its MemoryWallet is fresh)', {
            table: id,
            op,
            error: message(error),
          });
        },
      });
    } catch (error) {
      throw new DevError('REPLAY_FAILED', `Replay failed: ${message(error)}`);
    }
    await host.registerFork({ id, game: table.game, runtime });
    logger.warn('Devtools forked a table', { table: table.id, seq, fork: id });
    return id;
  };

  const exportFixture = async (
    client: Client,
    table: DevtoolsHostTable,
    seq: number,
  ): Promise<DevResults['table.export']> => {
    checkSeq(table, seq);
    const source = await fullLog(table, seq);
    const create = source[0]!;
    if (create.kind !== 'create') throw new DevError('LOG_UNAVAILABLE', 'No create entry');
    // Replace ids inside inputs and options too when that still replays; otherwise only
    // in the engine's own fields (which always replays, since the engine compares ids
    // only with each other), and say so in the warning.
    let fixture: Fixture | null = null;
    let failure = '';
    let kept = false;
    for (const deep of [true, false]) {
      kept = !deep;
      const { entries } = anonymize(source, deep);
      let runtime: TableRuntime;
      try {
        runtime = await TableRuntime.replay(table.game, entries, {
          clock: fixedClock(entries.at(-1)!.at),
          dev: host.dev,
          wallet: new MemoryWallet(),
        });
      } catch (error) {
        failure = message(error);
        continue;
      }
      fixture = {
        shoehiveFixture: 1,
        game: create.game,
        version: create.version,
        entries,
        expect: { rev: runtime.rev, stateHash: stateHash(runtime.state) },
      };
      runtime.dispose();
      break;
    }
    if (!fixture)
      throw new DevError('REPLAY_FAILED', `The anonymized log does not replay: ${failure}`);
    logger.warn('Devtools exported a fixture', { remote: client.remote, table: table.id, seq });
    return { fixture, warning: kept ? EXPORT_WARNING + EXPORT_KEPT_IDS : EXPORT_WARNING };
  };

  const handle = async (
    client: Client,
    request: DevRequest,
  ): Promise<DevResults[DevRequestType]> => {
    switch (request.t) {
      case 'tables.list':
        return { tables: host.tables().map(summaryOf) };
      case 'tables.watch': {
        client.watchingTables = true;
        const tables = host.tables().map(summaryOf);
        client.lastTables = JSON.stringify(tables);
        return { tables };
      }
      case 'tables.unwatch':
        client.watchingTables = false;
        return {};
      case 'table.watch': {
        const table = requireTable(request.table);
        if (!client.tables.has(table.id))
          client.tables.set(table.id, { timer: null, lastSent: Date.now() });
        return detailOf(table.id, table.runtime, false);
      }
      case 'table.unwatch': {
        const watch = client.tables.get(request.table);
        if (watch?.timer != null) clearTimeout(watch.timer);
        client.tables.delete(request.table);
        return {};
      }
      case 'table.log': {
        const table = requireTable(request.table);
        const last = table.runtime.engine.seq;
        const to = Math.min(request.to ?? last, last, request.from + MAX_LOG_ENTRIES - 1);
        return { entries: await readLog(table, request.from, to), last };
      }
      case 'table.at':
        return tableAt(requireTable(request.table), request.seq);
      case 'table.fork': {
        const table = requireTable(request.table);
        return { table: await fork(table, request.seq ?? table.runtime.engine.seq) };
      }
      case 'table.export': {
        const table = requireTable(request.table);
        return exportFixture(client, table, request.seq ?? table.runtime.engine.seq);
      }
      case 'sessions.list':
        return host.sessions();
    }
  };

  // -------------------------------------------------------------------------------
  // Pushes

  const pushTable = (client: Client, id: string, watch: Watch): void => {
    watch.timer = null;
    const table = host.table(id);
    if (!table || !clients.has(client)) return;
    watch.lastSent = Date.now();
    let detail: DevTableDetail;
    try {
      detail = detailOf(id, table.runtime, false);
    } catch (error) {
      logger.error('Devtools could not build a table update', { table: id, error });
      return;
    }
    send(client, { t: 'table.update', table: id, detail });
  };

  /** Throttled per table and client: at most one update per 100 ms, always the latest. */
  const tableCommitted = (id: string): void => {
    for (const client of clients) {
      const watch = client.tables.get(id);
      if (watch?.timer !== null) continue;
      const wait = watch.lastSent + THROTTLE_MS - Date.now();
      if (wait <= 0) pushTable(client, id, watch);
      else {
        watch.timer = setTimeout(() => {
          pushTable(client, id, watch);
        }, wait);
        watch.timer.unref();
      }
    }
  };

  const pushTables = (): void => {
    tablesTimer = null;
    lastTablesPush = Date.now();
    let text: string | null = null;
    let tables: DevTableSummary[] = [];
    for (const client of clients) {
      if (!client.watchingTables) continue;
      if (text === null) {
        tables = host.tables().map(summaryOf);
        text = JSON.stringify(tables);
      }
      if (text === client.lastTables) continue;
      client.lastTables = text;
      send(client, { t: 'tables', tables });
    }
  };

  const tablesChanged = (): void => {
    if (tablesTimer !== null || closed) return;
    if (![...clients].some((c) => c.watchingTables)) return;
    const wait = lastTablesPush + THROTTLE_MS - Date.now();
    tablesTimer = setTimeout(pushTables, Math.max(0, wait));
    tablesTimer.unref();
  };

  const tableClosed = (id: string, reason: string): void => {
    for (const key of [...atCache.keys()]) if (key.startsWith(`${id}\u0000`)) atCache.delete(key);
    for (const client of clients) {
      const watch = client.tables.get(id);
      if (!watch) continue;
      if (watch.timer !== null) clearTimeout(watch.timer);
      client.tables.delete(id);
      send(client, { t: 'table.closed', table: id, reason });
    }
    tablesChanged();
  };

  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (client.missed >= 2) {
        client.ws.terminate();
        continue;
      }
      client.missed += 1;
      client.ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    handleRequest,
    handleUpgrade,
    tableCommitted,
    tablesChanged,
    tableClosed,
    close: () =>
      new Promise<void>((resolve) => {
        closed = true;
        clearInterval(heartbeat);
        if (tablesTimer !== null) clearTimeout(tablesTimer);
        for (const client of [...clients]) {
          client.ws.terminate();
          drop(client);
        }
        wss.close(() => {
          resolve();
        });
      }),
  };
}
