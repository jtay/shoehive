// The Shoehive server: sessions, lobby, tables, seats and the wire protocol
// (docs/reference/protocol.md; ADRs 0003, 0009, 0010).

import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { systemClock, type Clock, type TimerHandle } from '../core/clock';
import type { AnyGame } from '../core/define';
import { diff } from '../core/diff';
import { isShoehiveError, shoehiveError, ShoehiveError } from '../core/errors';
import type { Json } from '../core/json';
import {
  randomTableId,
  TableRuntime,
  type Commit,
  type LogEntry,
  type RuntimeOptions,
  type Snapshot,
} from '../core/runtime';
import {
  CLOSE,
  parseClientMessage,
  type ClientRequest,
  type LobbyDocument,
  type LobbyFilter,
  type ServerMessage,
  type TableDocument,
  type Welcome,
  type WireError,
} from '../protocol/messages';
import { PROTOCOL_VERSION } from '../protocol/version';
import { memoryStore } from '../store/memory';
import type { Store } from '../store/types';
import { consoleLogger, type Logger } from './logger';
import { generateSecret, guestId, guestName, TokenSigner } from './tokens';
import {
  attachWebSocket,
  connectMemory,
  type Connection,
  type ConnectionHandler,
  type MemorySocket,
  type UpgradeRequest,
} from './transport';
import type { Wallet, WalletOp } from '../core/wallet';

// ---------------------------------------------------------------------------------
// Options and public types

export interface PlayerIdentity {
  id: string;
  name: string;
  metadata?: Json;
}

/** Authenticates a WebSocket upgrade. Return `null` to refuse it with HTTP 401. */
export type AuthHook = (
  request: UpgradeRequest,
) => Promise<PlayerIdentity | null> | PlayerIdentity | null;

export interface ServerLimits {
  /** Largest accepted message, in bytes. Default 65 536. */
  maxMessageBytes?: number;
  /** Sustained messages per second per connection. Default 20. */
  messagesPerSecond?: number;
  /** Burst size of the per-connection token bucket. Default 40. */
  burst?: number;
  /** Requests awaiting their ack per connection. Default 32. */
  maxInFlight?: number;
  /** Time a new connection has to send `hello`. Default 10 000 ms. */
  helloTimeoutMs?: number;
  /** WebSocket ping interval. Default 15 000 ms. */
  heartbeatMs?: number;
}

export interface ServerOptions {
  games: readonly AnyGame[];
  /** Custom auth. Without it every connection is a guest with a resume token (ADR 0010). */
  auth?: AuthHook;
  /** HMAC secrets for resume tokens: the first signs, all verify. Defaults to `SHOEHIVE_SECRET`. */
  secret?: string | readonly string[];
  /** Where tables are persisted. Defaults to an in-memory store. */
  store?: Store;
  /** Money backend (ADR 0007). Exposed to game code from Phase 4. */
  wallet?: Wallet;
  logger?: Logger;
  /** WebSocket path. Default `/shoehive`. */
  path?: string;
  /** Allowed `Origin` headers. Default: any. */
  origins?: readonly string[];
  /** How long a seat is held after its player disconnects. Default 60 000 ms. */
  reconnectGraceMs?: number;
  /** Resume token lifetime, renewed on every connect. Default 7 days. */
  resumeTokenTtlMs?: number;
  /** Close tables nobody has joined and nobody is seated at after this long. Default 10 minutes. */
  idleTableMs?: number;
  /** Write a snapshot every N log entries (also on phase change and end). Default 100. */
  snapshotEvery?: number;
  limits?: ServerLimits;
  clock?: Clock;
  /** Dev checks in table runtimes. Default: `NODE_ENV !== 'production'`. */
  dev?: boolean;
}

export interface TableInfo {
  id: string;
  game: string;
  status: TableRuntime['status'];
  rev: number;
  createdAt: number;
  /** Players with a connection joined to the table. */
  connected: string[];
}

export interface ServerEvents {
  'table:created': { table: string; game: string };
  'table:ended': { table: string; result: Json };
  'table:closed': { table: string; reason: string };
  'table:recovered': { table: string };
  'table:recovery-failed': { table: string; reason: string };
  'player:connected': { player: string };
  'player:disconnected': { player: string };
  /** A deferred wallet op still failed after retries (ADR 0007): reconcile it by hand. */
  'wallet:error': { table: string; op: WalletOp; error: unknown };
}

export interface ShoehiveServer {
  /** Resolves once stored tables are recovered (connections wait for it automatically). */
  readonly ready: Promise<void>;
  /** Starts an HTTP server with the WebSocket endpoint. */
  listen(options?: { port?: number; host?: string }): Promise<{ port: number; url: string }>;
  /** Adds the WebSocket endpoint to an existing HTTP server. */
  attach(server: HttpServer): Promise<void>;
  /** Opens an in-memory connection (tests, same-process clients). */
  connect(request?: UpgradeRequest): MemorySocket;
  readonly tables: {
    create(game: string, options?: { options?: unknown; id?: string }): Promise<TableInfo>;
    get(id: string): TableInfo | undefined;
    list(): TableInfo[];
    close(id: string): Promise<void>;
    start(id: string): Promise<void>;
    /** Reloads a table from the store, for example after it faulted. */
    reload(id: string): Promise<void>;
    /** The table's runtime: server-side only, never exposed to clients. */
    runtime(id: string): TableRuntime | undefined;
  };
  on<E extends keyof ServerEvents>(
    event: E,
    listener: (payload: ServerEvents[E]) => void,
  ): () => void;
  /**
   * Stops the server. Graceful by default: drains table queues, writes a snapshot of
   * every table, then closes connections with code 1001. `graceful: false` drops
   * everything immediately, like a crash (useful to test recovery).
   */
  close(options?: { graceful?: boolean }): Promise<void>;
}

// ---------------------------------------------------------------------------------
// Internal state

interface Session {
  player: { id: string; name: string; guest: boolean; metadata: Json };
  conns: Set<Conn>;
  /** Tables this session had joined (to restore on resume). */
  joined: Set<string>;
  /** The lobby subscription's filter, or `null` when not subscribed. */
  lobby: LobbyFilter | null;
  /** Reconnect grace timers per table. */
  grace: Map<string, TimerHandle>;
  cleanup: TimerHandle | null;
}

interface Joined {
  role: 'player' | 'spectator';
  rev: number;
  doc: TableDocument;
  stale: boolean;
  /** False until the first snapshot is sent (after the join ack). */
  active: boolean;
}

interface Conn {
  transport: Connection;
  identity: PlayerIdentity | null;
  session: Session | null;
  tables: Map<string, Joined>;
  lobby: { rev: number; doc: LobbyDocument; filter: LobbyFilter } | null;
  tokens: number;
  refilledAt: number;
  rejected: number[];
  violations: number[];
  inFlight: number;
  helloTimer: TimerHandle | null;
  closed: boolean;
}

interface TableEntry {
  runtime: TableRuntime;
  game: AnyGame;
  createdAt: number;
  idleTimer: TimerHandle | null;
  lastSnapshotSeq: number;
  lastPhase: string | null;
  lastStatus: TableRuntime['status'];
}

const DAY = 24 * 60 * 60 * 1000;
const BACKPRESSURE_BYTES = 1024 * 1024;

function defaultDev(): boolean {
  return process.env['NODE_ENV'] !== 'production';
}

function toWire(error: unknown, dev: boolean): WireError {
  if (isShoehiveError(error)) return error.toJSON();
  return {
    code: 'INTERNAL',
    source: 'shoehive',
    message: dev && error instanceof Error ? error.message : 'Internal error',
  };
}

// ---------------------------------------------------------------------------------

/** A trimmed display name of 1 to 32 characters without control characters, or `null`. */
function cleanName(raw: string): string | null {
  const name = raw.trim();
  return name.length > 0 && name.length <= 32 && !/\p{Cc}/u.test(name) ? name : null;
}

/** The lobby as one subscriber sees it: every game, only the matching tables. */
function filterLobby(doc: LobbyDocument, filter: LobbyFilter): LobbyDocument {
  if (!filter.games && !filter.status) return doc;
  return {
    games: doc.games,
    tables: doc.tables.filter(
      (t) =>
        (!filter.games || filter.games.includes(t.game)) &&
        (!filter.status || filter.status.includes(t.status)),
    ),
  };
}

/**
 * Creates a Shoehive server.
 *
 * ```ts
 * const shoehive = createServer({ games: [ticTacToe] });
 * await shoehive.listen({ port: 3000 });
 * ```
 */
export function createServer(options: ServerOptions): ShoehiveServer {
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? consoleLogger;
  const dev = options.dev ?? defaultDev();
  const store = options.store ?? memoryStore();
  const path = options.path ?? '/shoehive';
  const graceMs = options.reconnectGraceMs ?? 60_000;
  const tokenTtlMs = options.resumeTokenTtlMs ?? 7 * DAY;
  const idleTableMs = options.idleTableMs ?? 10 * 60_000;
  const snapshotEvery = options.snapshotEvery ?? 100;
  const limits = {
    maxMessageBytes: options.limits?.maxMessageBytes ?? 65_536,
    messagesPerSecond: options.limits?.messagesPerSecond ?? 20,
    burst: options.limits?.burst ?? 40,
    maxInFlight: options.limits?.maxInFlight ?? 32,
    helloTimeoutMs: options.limits?.helloTimeoutMs ?? 10_000,
    heartbeatMs: options.limits?.heartbeatMs ?? 15_000,
  };

  const games = new Map<string, AnyGame>();
  for (const game of options.games) {
    if (games.has(game.id))
      throw new TypeError(`createServer(): two games share the id "${game.id}"`);
    games.set(game.id, game);
  }

  // Resume token secret (ADR 0010).
  const configured = options.secret ?? process.env['SHOEHIVE_SECRET'];
  let secrets: string[];
  if (configured === undefined || (Array.isArray(configured) && configured.length === 0)) {
    if (!dev && !options.auth) {
      throw new Error(
        'createServer(): set `secret` or SHOEHIVE_SECRET in production (resume tokens need it)',
      );
    }
    if (!options.auth) {
      logger.warn(
        'No secret set: using a random one. Resume tokens will not survive a restart (set SHOEHIVE_SECRET).',
      );
    }
    secrets = [generateSecret()];
  } else {
    secrets = typeof configured === 'string' ? [configured] : Array.from<string>(configured);
  }
  const signer = new TokenSigner(secrets);
  if (options.wallet && !options.auth && !dev) {
    logger.warn(
      'A wallet is configured with guest identities. Guest resume tokens are bearer tokens: unsuitable for money.',
    );
  }

  const sessions = new Map<string, Session>();
  const conns = new Set<Conn>();
  const tables = new Map<string, TableEntry>();
  const listeners = new Map<keyof ServerEvents, Set<(payload: never) => void>>();
  let lobbyRev = 0;
  let lobbyDoc: LobbyDocument = { games: [], tables: [] };
  let closing = false;
  const detachers: (() => Promise<void>)[] = [];
  const httpServers: HttpServer[] = [];

  const emit = <E extends keyof ServerEvents>(event: E, payload: ServerEvents[E]): void => {
    for (const listener of listeners.get(event) ?? []) {
      try {
        (listener as (p: ServerEvents[E]) => void)(payload);
      } catch (error) {
        logger.error(`Listener for ${event} threw`, { error });
      }
    }
  };

  const send = (conn: Conn, message: ServerMessage): void => {
    if (conn.closed) return;
    conn.transport.send(JSON.stringify(message));
  };

  const closeConn = (conn: Conn, code: number, reason: string): void => {
    if (conn.closed) return;
    send(conn, { t: 'bye', code, reason });
    conn.transport.close(code, reason);
  };

  // -------------------------------------------------------------------------------
  // Documents

  const spectatorCount = (tableId: string, runtime: TableRuntime): number => {
    const players = new Set<string>();
    for (const conn of conns) {
      const player = conn.session?.player.id;
      if (player && conn.tables.has(tableId) && runtime.seatsHeldBy(player).length === 0)
        players.add(player);
    }
    return players.size;
  };

  const buildDoc = (
    entry: TableEntry,
    tableId: string,
    conn: Conn,
    role: 'player' | 'spectator',
  ): TableDocument => {
    const runtime = entry.runtime;
    const player = conn.session!.player.id;
    const seats = runtime.seatsHeldBy(player);
    return {
      view: runtime.view(runtime.viewerFor(player)),
      meta: runtime.meta(),
      seats: runtime.seats(),
      spectators: spectatorCount(tableId, runtime),
      you: { player, seats, role: seats.length > 0 ? 'player' : role },
    };
  };

  const sendSnapshot = (conn: Conn, tableId: string): void => {
    const entry = tables.get(tableId);
    const joined = conn.tables.get(tableId);
    if (!entry || !joined) return;
    joined.doc = buildDoc(entry, tableId, conn, joined.role);
    joined.rev = entry.runtime.rev;
    joined.stale = false;
    joined.active = true;
    send(conn, { t: 'table.snapshot', table: tableId, rev: joined.rev, doc: joined.doc });
  };

  /** Sends each joined connection the patch from its last document to the current one. */
  const syncTable = (tableId: string): void => {
    const entry = tables.get(tableId);
    if (!entry) return;
    for (const conn of conns) {
      const joined = conn.tables.get(tableId);
      if (!joined?.active || conn.closed) continue;
      if (joined.stale || conn.transport.bufferedAmount() > BACKPRESSURE_BYTES) {
        // Backpressure (ADR 0003): skip patches, send one snapshot when the buffer drains.
        joined.stale = true;
        if (conn.transport.bufferedAmount() <= BACKPRESSURE_BYTES) sendSnapshot(conn, tableId);
        continue;
      }
      const doc = buildDoc(entry, tableId, conn, joined.role);
      const ops = diff(joined.doc as unknown as Json, doc as unknown as Json);
      if (ops.length === 0) continue;
      send(conn, {
        t: 'table.patch',
        table: tableId,
        from: joined.rev,
        rev: entry.runtime.rev,
        ops,
      });
      joined.doc = doc;
      joined.rev = entry.runtime.rev;
    }
  };

  const buildLobby = (): LobbyDocument => ({
    games: [...games.values()].map((g) => ({
      id: g.id,
      name: g.name ?? g.id,
      description: g.description ?? null,
      seats: { min: g.seats.min, max: g.seats.max },
    })),
    tables: [...tables].map(([id, entry]) => ({
      id,
      game: entry.game.id,
      status: entry.runtime.status,
      seats: {
        taken: entry.runtime.seats().filter((s) => s.status !== 'empty').length,
        total: entry.game.seats.max,
      },
      spectators: spectatorCount(id, entry.runtime),
      createdAt: entry.createdAt,
      listed: null,
    })),
  });

  const syncLobby = (): void => {
    const next = buildLobby();
    const ops = diff(lobbyDoc as unknown as Json, next as unknown as Json);
    if (ops.length === 0) return;
    lobbyRev += 1;
    lobbyDoc = next;
    for (const conn of conns) {
      if (!conn.lobby || conn.closed) continue;
      const doc = filterLobby(next, conn.lobby.filter);
      const ops = diff(conn.lobby.doc as unknown as Json, doc as unknown as Json);
      if (ops.length === 0) continue;
      send(conn, { t: 'lobby.patch', from: conn.lobby.rev, rev: lobbyRev, ops });
      conn.lobby = { rev: lobbyRev, doc, filter: conn.lobby.filter };
    }
  };

  const subscribeLobby = (conn: Conn, filter: LobbyFilter): void => {
    const doc = filterLobby(lobbyDoc, filter);
    conn.lobby = { rev: lobbyRev, doc, filter };
    send(conn, { t: 'lobby.snapshot', rev: lobbyRev, doc });
  };

  // -------------------------------------------------------------------------------
  // Tables

  const persistEntry = (tableId: string) => (entry: LogEntry) =>
    store.appendLog(tableId, [{ seq: entry.seq, data: JSON.stringify(entry) }]);

  const saveSnapshot = async (tableId: string, entry: TableEntry): Promise<void> => {
    const snapshot: Snapshot = entry.runtime.snapshot();
    entry.lastSnapshotSeq = snapshot.seq;
    await store.saveSnapshot(tableId, {
      seq: snapshot.seq,
      rev: snapshot.root.engine.rev,
      game: entry.game.id,
      version: entry.game.version ?? 1,
      data: JSON.stringify(snapshot),
    });
  };

  const onCommit = (tableId: string, entry: TableEntry) => (commit: Commit) => {
    syncTable(tableId);
    for (const event of commit.events) {
      for (const conn of conns) {
        if (!conn.tables.has(tableId) || conn.closed) continue;
        const held = entry.runtime.seatsHeldBy(conn.session!.player.id);
        const to = event.to;
        const included =
          to === 'all'
            ? true
            : to === 'spectators'
              ? held.length === 0
              : held.some((s) => to.includes(s));
        if (included) {
          send(conn, {
            t: 'table.event',
            table: tableId,
            rev: commit.rev,
            name: event.name,
            payload: event.payload,
          });
        }
      }
    }
    const { runtime } = entry;
    const phaseChanged = runtime.engine.phase !== entry.lastPhase;
    const ended = runtime.status === 'ended' && entry.lastStatus !== 'ended';
    entry.lastPhase = runtime.engine.phase;
    entry.lastStatus = runtime.status;
    if (phaseChanged || ended || runtime.engine.seq - entry.lastSnapshotSeq >= snapshotEvery) {
      saveSnapshot(tableId, entry).catch((error: unknown) => {
        logger.error('Could not write a snapshot', { table: tableId, error });
      });
    }
    if (ended) emit('table:ended', { table: tableId, result: runtime.engine.result });
    syncLobby();
    scheduleIdleCheck(tableId);
  };

  const register = (
    tableId: string,
    game: AnyGame,
    runtime: TableRuntime,
    createdAt: number,
  ): TableEntry => {
    const entry: TableEntry = {
      runtime,
      game,
      createdAt,
      idleTimer: null,
      lastSnapshotSeq: runtime.engine.seq,
      lastPhase: runtime.engine.phase,
      lastStatus: runtime.status,
    };
    tables.set(tableId, entry);
    runtime.onCommit(onCommit(tableId, entry));
    return entry;
  };

  const tableInfo = (id: string, entry: TableEntry): TableInfo => ({
    id,
    game: entry.game.id,
    status: entry.runtime.status,
    rev: entry.runtime.rev,
    createdAt: entry.createdAt,
    connected: [
      ...new Set([...conns].filter((c) => c.tables.has(id)).map((c) => c.session!.player.id)),
    ],
  });

  const walletOptions = (tableId: string): Pick<RuntimeOptions, 'wallet' | 'onWalletError'> =>
    options.wallet
      ? {
          wallet: options.wallet,
          onWalletError: ({ op, error }) => {
            logger.error('A wallet operation failed after retries', { table: tableId, op, error });
            emit('wallet:error', { table: tableId, op, error });
          },
        }
      : {};

  const createTable = async (
    gameId: string,
    args: { options?: unknown; id?: string } = {},
  ): Promise<TableInfo> => {
    const game = games.get(gameId);
    if (!game) throw shoehiveError('NOT_FOUND', `Unknown game "${gameId}"`, { kind: 'game' });
    const id = args.id ?? randomTableId();
    if (tables.has(id)) throw shoehiveError('BAD_REQUEST', `Table "${id}" already exists`);
    const runtime = await TableRuntime.create(game, {
      id,
      options: args.options,
      clock,
      dev,
      ...walletOptions(id),
    });
    const createEntry = runtime.log[0]!;
    await store.appendLog(id, [{ seq: 0, data: JSON.stringify(createEntry) }]);
    const entry = register(id, game, runtime, createEntry.at);
    await saveSnapshot(id, entry);
    runtime.setPersist(persistEntry(id));
    emit('table:created', { table: id, game: gameId });
    syncLobby();
    scheduleIdleCheck(id);
    return tableInfo(id, entry);
  };

  const isIdle = (tableId: string, entry: TableEntry): boolean =>
    ![...conns].some((c) => c.tables.has(tableId)) &&
    entry.runtime.seats().every((s) => s.status === 'empty');

  const scheduleIdleCheck = (tableId: string): void => {
    const entry = tables.get(tableId);
    if (!entry || closing) return;
    if (!isIdle(tableId, entry)) {
      if (entry.idleTimer !== null) {
        clock.clearTimer(entry.idleTimer);
        entry.idleTimer = null;
      }
      return;
    }
    if (entry.idleTimer !== null) return;
    entry.idleTimer = clock.setTimer(clock.now() + idleTableMs, () => {
      entry.idleTimer = null;
      if (tables.get(tableId) === entry && isIdle(tableId, entry)) {
        closeTable(tableId, 'expired').catch((error: unknown) => {
          logger.error('Could not close an idle table', { table: tableId, error });
        });
      }
    });
  };

  const closeTable = async (
    tableId: string,
    reason: 'ended' | 'closed' | 'expired' | 'game-removed',
  ): Promise<void> => {
    const entry = tables.get(tableId);
    if (!entry) throw shoehiveError('NOT_FOUND', `Unknown table "${tableId}"`, { kind: 'table' });
    tables.delete(tableId);
    if (entry.idleTimer !== null) clock.clearTimer(entry.idleTimer);
    await entry.runtime.idle();
    // ADR 0007 rule 4: a closed table gives back every reservation it still holds.
    entry.runtime.releaseOpenReservations();
    await entry.runtime.idle();
    entry.runtime.dispose();
    for (const conn of conns) {
      if (conn.tables.delete(tableId)) send(conn, { t: 'table.closed', table: tableId, reason });
    }
    for (const session of sessions.values()) {
      session.joined.delete(tableId);
      const timer = session.grace.get(tableId);
      if (timer !== undefined) clock.clearTimer(timer);
      session.grace.delete(tableId);
    }
    await store.closeTable(tableId, reason);
    emit('table:closed', { table: tableId, reason });
    syncLobby();
  };

  const requireTable = (tableId: string): TableEntry => {
    const entry = tables.get(tableId);
    if (!entry) throw shoehiveError('NOT_FOUND', `Unknown table "${tableId}"`, { kind: 'table' });
    return entry;
  };

  // -------------------------------------------------------------------------------
  // Seats and grace (ADR 0010)

  const otherConnJoined = (session: Session, tableId: string, except: Conn | null): boolean =>
    [...session.conns].some((c) => c !== except && c.tables.has(tableId));

  const startGrace = (session: Session, tableId: string): Promise<void> => {
    const entry = tables.get(tableId);
    // While shutting down, record nothing: after a restart every seated player gets a
    // fresh grace period anyway (ADR 0009 step 5), and a crash could not record it.
    if (closing || !entry || entry.runtime.seatsHeldBy(session.player.id).length === 0)
      return Promise.resolve();
    const playerId = session.player.id;
    const existing = session.grace.get(tableId);
    if (existing !== undefined) clock.clearTimer(existing);
    const recorded = entry.runtime.disconnect({ player: playerId }).catch((error: unknown) => {
      logger.warn('Could not record a disconnect', { table: tableId, error });
    });
    session.grace.set(
      tableId,
      clock.setTimer(clock.now() + graceMs, () => {
        session.grace.delete(tableId);
        const current = tables.get(tableId);
        if (!current) return;
        for (const seat of current.runtime.seatsHeldBy(playerId)) {
          void current.runtime.stand({ seat, reason: 'grace-expired' }).catch(() => undefined);
        }
      }),
    );
    return recorded;
  };

  const endGrace = async (session: Session, tableId: string): Promise<void> => {
    const timer = session.grace.get(tableId);
    if (timer !== undefined) {
      clock.clearTimer(timer);
      session.grace.delete(tableId);
    }
    const entry = tables.get(tableId);
    if (entry && entry.runtime.seatsHeldBy(session.player.id).length > 0) {
      await entry.runtime.reconnect({ player: session.player.id });
    }
  };

  const leaveTable = (conn: Conn, tableId: string, explicit: boolean): Promise<void> | void => {
    if (!conn.tables.delete(tableId)) return;
    const session = conn.session!;
    const entry = tables.get(tableId);
    if (!entry) return;
    const stillHere = otherConnJoined(session, tableId, conn);
    syncTable(tableId);
    syncLobby();
    if (stillHere) return;
    if (explicit) {
      session.joined.delete(tableId);
      const seats = entry.runtime.seatsHeldBy(session.player.id);
      const done = (async () => {
        for (const seat of seats) await entry.runtime.stand({ seat });
        scheduleIdleCheck(tableId);
      })();
      return done;
    }
    void startGrace(session, tableId);
    scheduleIdleCheck(tableId);
  };

  const joinTable = async (
    conn: Conn,
    tableId: string,
    role: 'player' | 'spectator',
  ): Promise<void> => {
    requireTable(tableId);
    const session = conn.session!;
    const alreadyHere = otherConnJoined(session, tableId, conn);
    conn.tables.set(tableId, {
      role,
      rev: 0,
      doc: null as unknown as TableDocument,
      stale: true,
      active: false,
    });
    session.joined.add(tableId);
    scheduleIdleCheck(tableId);
    if (!alreadyHere) await endGrace(session, tableId);
  };

  // -------------------------------------------------------------------------------
  // Sessions

  const getSession = (player: Session['player']): Session => {
    let session = sessions.get(player.id);
    if (!session) {
      session = {
        player,
        conns: new Set(),
        joined: new Set(),
        lobby: null,
        grace: new Map(),
        cleanup: null,
      };
      sessions.set(player.id, session);
    } else {
      session.player = player;
    }
    if (session.cleanup !== null) {
      clock.clearTimer(session.cleanup);
      session.cleanup = null;
    }
    return session;
  };

  const scheduleSessionCleanup = (session: Session): void => {
    if (session.conns.size > 0 || session.cleanup !== null) return;
    // Keep the session through the grace period so a quick resume restores it.
    session.cleanup = clock.setTimer(clock.now() + graceMs * 2, () => {
      session.cleanup = null;
      if (session.conns.size === 0 && session.grace.size === 0) sessions.delete(session.player.id);
    });
  };

  const seatedTables = (playerId: string): string[] =>
    [...tables].filter(([, e]) => e.runtime.seatsHeldBy(playerId).length > 0).map(([id]) => id);

  // -------------------------------------------------------------------------------
  // Requests

  const handleHello = async (
    conn: Conn,
    message: Extract<ClientRequest, { t: 'hello' }>,
  ): Promise<Json> => {
    if (conn.session) throw shoehiveError('BAD_REQUEST', 'hello was already sent');
    if (message.v !== PROTOCOL_VERSION) {
      const error = shoehiveError(
        'UNSUPPORTED_PROTOCOL',
        `Protocol ${String(message.v)} is not supported`,
        {
          supported: [PROTOCOL_VERSION],
        },
      );
      setTimeout(() => {
        closeConn(conn, CLOSE.UNSUPPORTED_PROTOCOL, 'Unsupported protocol');
      }, 0);
      throw error;
    }
    if (conn.helloTimer !== null) {
      clock.clearTimer(conn.helloTimer);
      conn.helloTimer = null;
    }
    const now = clock.now();
    const token = message.resume ? signer.verify(message.resume, now) : null;
    let player: Session['player'];
    let resumed = false;
    if (conn.identity) {
      player = {
        id: conn.identity.id,
        name: conn.identity.name,
        guest: false,
        metadata: conn.identity.metadata ?? null,
      };
      resumed =
        token?.sub === player.id && (sessions.has(player.id) || seatedTables(player.id).length > 0);
    } else if (token) {
      const record = await store.sessions.get(token.sub);
      player = {
        id: token.sub,
        name: record?.name ?? token.name,
        guest: true,
        metadata: record?.metadata ?? null,
      };
      resumed = sessions.has(player.id) || seatedTables(player.id).length > 0 || record !== null;
    } else {
      const name = (message.name === undefined ? null : cleanName(message.name)) ?? guestName();
      player = { id: guestId(), name, guest: true, metadata: null };
    }
    const session = getSession(player);
    session.conns.add(conn);
    conn.session = session;
    await store.sessions.put({
      playerId: player.id,
      name: player.name,
      metadata: player.metadata,
      updatedAt: now,
    });
    emit('player:connected', { player: player.id });

    const exp = now + tokenTtlMs;
    const welcome: Welcome = {
      player: { id: player.id, name: player.name, guest: player.guest },
      resumeToken: signer.sign({ sub: player.id, name: player.name, iat: now, exp }),
      resumeExpiresAt: exp,
      resumed,
      server: {
        protocol: 1,
        now,
        heartbeatMs: limits.heartbeatMs,
        maxMessageBytes: limits.maxMessageBytes,
      },
    };
    if (resumed) {
      // After the ack: restore the lobby subscription and every joined or seated table.
      queueMicrotask(() => {
        void (async () => {
          if (session.lobby) subscribeLobby(conn, session.lobby);
          for (const tableId of new Set([...session.joined, ...seatedTables(player.id)])) {
            if (!tables.has(tableId) || conn.tables.has(tableId)) continue;
            await joinTable(conn, tableId, 'player');
            sendSnapshot(conn, tableId);
            syncTable(tableId);
          }
          syncLobby();
        })().catch((error: unknown) => {
          logger.warn('Could not restore a resumed session', { player: player.id, error });
        });
      });
    }
    return welcome as unknown as Json;
  };

  type After = (() => void) | undefined;

  const handleRequest = async (
    conn: Conn,
    message: ClientRequest,
  ): Promise<{ result?: Json; after?: After }> => {
    if (message.t === 'hello') return { result: await handleHello(conn, message) };
    if (!conn.session) throw shoehiveError('BAD_REQUEST', 'Send hello first');
    const session = conn.session;
    const player = session.player;
    switch (message.t) {
      case 'lobby.sub': {
        const filter = message.filter ?? {};
        session.lobby = filter;
        return {
          after: () => {
            subscribeLobby(conn, filter);
          },
        };
      }
      case 'lobby.unsub':
        session.lobby = null;
        conn.lobby = null;
        return {};
      case 'player.rename': {
        if (!player.guest) {
          throw shoehiveError(
            'FORBIDDEN',
            'Names of authenticated players come from the auth hook',
          );
        }
        const name = cleanName(message.name);
        if (name === null)
          throw shoehiveError(
            'BAD_REQUEST',
            'Names are 1 to 32 characters, with no control characters',
          );
        player.name = name;
        await store.sessions.put({
          playerId: player.id,
          name,
          metadata: player.metadata,
          updatedAt: clock.now(),
        });
        for (const tableId of seatedTables(player.id)) {
          await tables.get(tableId)?.runtime.rename({ player: player.id, name });
        }
        return { result: { name } };
      }
      case 'table.create': {
        const info = await createTable(message.game, { options: message.options });
        return { result: { table: info.id } };
      }
      case 'table.join': {
        requireTable(message.table);
        if (!conn.tables.has(message.table))
          await joinTable(conn, message.table, message.as ?? 'player');
        else conn.tables.get(message.table)!.role = message.as ?? 'player';
        return {
          after: () => {
            sendSnapshot(conn, message.table);
            syncTable(message.table);
            syncLobby();
          },
        };
      }
      case 'table.leave':
        if (!conn.tables.has(message.table))
          throw shoehiveError('NOT_JOINED', 'You have not joined this table');
        await leaveTable(conn, message.table, true);
        return {};
      case 'table.sync':
        if (!conn.tables.has(message.table))
          throw shoehiveError('NOT_JOINED', 'You have not joined this table');
        return {
          after: () => {
            sendSnapshot(conn, message.table);
          },
        };
      case 'seat.take': {
        const entry = requireTable(message.table);
        if (!conn.tables.has(message.table))
          throw shoehiveError('NOT_JOINED', 'Join the table first');
        const { seat } = await entry.runtime.sit({
          player: { id: player.id, name: player.name },
          ...(message.seat === undefined ? {} : { seat: message.seat }),
        });
        return { result: { seat } };
      }
      case 'seat.leave': {
        const entry = requireTable(message.table);
        if (!conn.tables.has(message.table))
          throw shoehiveError('NOT_JOINED', 'Join the table first');
        const held = entry.runtime.seatsHeldBy(player.id);
        const seats = message.seat === undefined ? held : held.filter((s) => s === message.seat);
        if (seats.length === 0) throw shoehiveError('NOT_SEATED', 'You do not hold that seat');
        for (const seat of seats) await entry.runtime.stand({ seat });
        return {};
      }
      case 'act': {
        const entry = requireTable(message.table);
        if (!conn.tables.has(message.table))
          throw shoehiveError('NOT_JOINED', 'Join the table first');
        const { rev, result } = await entry.runtime.act({
          player: player.id,
          name: message.name,
          input: message.input,
          ...(message.seat === undefined ? {} : { seat: message.seat }),
          ...(message.rev === undefined ? {} : { rev: message.rev }),
        });
        return { result: result === undefined ? { rev } : { rev, value: result } };
      }
    }
  };

  // -------------------------------------------------------------------------------
  // Connections

  const recordViolation = (conn: Conn): void => {
    const now = clock.now();
    conn.violations = conn.violations.filter((t) => now - t < 60_000);
    conn.violations.push(now);
    if (conn.violations.length >= 3)
      closeConn(conn, CLOSE.PROTOCOL_VIOLATION, 'Repeated protocol violations');
  };

  const takeToken = (conn: Conn): boolean => {
    const now = clock.now();
    const elapsed = Math.max(0, now - conn.refilledAt) / 1000;
    conn.tokens = Math.min(limits.burst, conn.tokens + elapsed * limits.messagesPerSecond);
    conn.refilledAt = now;
    if (conn.tokens < 1) return false;
    conn.tokens -= 1;
    return true;
  };

  const onMessage = (conn: Conn, text: string): void => {
    if (conn.closed) return;
    if (text.length > limits.maxMessageBytes) {
      closeConn(conn, CLOSE.TOO_BIG, 'Message too big');
      return;
    }
    const parsed = parseClientMessage(text);
    if (!parsed.ok) {
      if (parsed.id !== null) {
        send(conn, {
          t: 'ack',
          id: parsed.id,
          ok: false,
          error: toWire(shoehiveError('BAD_REQUEST', parsed.message), dev),
        });
      }
      recordViolation(conn);
      return;
    }
    const message = parsed.message;
    if (!takeToken(conn)) {
      const now = clock.now();
      conn.rejected = conn.rejected.filter((t) => now - t < 10_000);
      conn.rejected.push(now);
      if (conn.rejected.length > 200) {
        closeConn(conn, CLOSE.RATE_LIMIT_ABUSE, 'Rate limit abuse');
        return;
      }
      if (message.t !== 'ping' || message.id !== undefined) {
        const retryAfterMs = Math.ceil(((1 - conn.tokens) / limits.messagesPerSecond) * 1000);
        if (message.id !== undefined) {
          send(conn, {
            t: 'ack',
            id: message.id,
            ok: false,
            error: toWire(shoehiveError('RATE_LIMITED', 'Slow down', { retryAfterMs }), dev),
          });
        }
      }
      return;
    }
    if (message.t === 'ping') {
      send(
        conn,
        message.id === undefined
          ? { t: 'pong', now: clock.now() }
          : { t: 'pong', id: message.id, now: clock.now() },
      );
      return;
    }
    if (conn.inFlight >= limits.maxInFlight) {
      send(conn, {
        t: 'ack',
        id: message.id,
        ok: false,
        error: toWire(
          shoehiveError('RATE_LIMITED', 'Too many requests in flight', { retryAfterMs: 100 }),
          dev,
        ),
      });
      return;
    }
    conn.inFlight += 1;
    void ready
      .then(() => handleRequest(conn, message))
      .then(
        ({ result, after }) => {
          send(
            conn,
            result === undefined
              ? { t: 'ack', id: message.id, ok: true }
              : { t: 'ack', id: message.id, ok: true, result },
          );
          after?.();
        },
        (error: unknown) => {
          if (!isShoehiveError(error)) logger.error('Request failed', { type: message.t, error });
          send(conn, { t: 'ack', id: message.id, ok: false, error: toWire(error, dev) });
        },
      )
      .finally(() => {
        conn.inFlight -= 1;
      });
  };

  const onClose = (conn: Conn): void => {
    if (conn.closed) return;
    conn.closed = true;
    conns.delete(conn);
    if (conn.helloTimer !== null) clock.clearTimer(conn.helloTimer);
    const session = conn.session;
    if (!session) return;
    session.conns.delete(conn);
    for (const tableId of [...conn.tables.keys()]) void leaveTable(conn, tableId, false);
    if (session.conns.size === 0) {
      emit('player:disconnected', { player: session.player.id });
      scheduleSessionCleanup(session);
    }
    syncLobby();
  };

  const handler: ConnectionHandler = {
    authorize: async (request) => {
      if (closing) return { status: 403 };
      if (!options.auth) return { status: 'ok', identity: null };
      try {
        const identity = await options.auth(request);
        return identity ? { status: 'ok', identity } : { status: 401 };
      } catch (error) {
        logger.error('auth() threw', { error });
        return { status: 500 };
      }
    },
    accept: (transport, identity) => {
      const conn: Conn = {
        transport,
        identity: identity as PlayerIdentity | null,
        session: null,
        tables: new Map(),
        lobby: null,
        tokens: limits.burst,
        refilledAt: clock.now(),
        rejected: [],
        violations: [],
        inFlight: 0,
        helloTimer: null,
        closed: false,
      };
      conns.add(conn);
      conn.helloTimer = clock.setTimer(clock.now() + limits.helloTimeoutMs, () => {
        conn.helloTimer = null;
        if (!conn.session) closeConn(conn, CLOSE.HELLO_TIMEOUT, 'No hello');
      });
      transport.onMessage((text) => {
        onMessage(conn, text);
      });
      transport.onClose(() => {
        onClose(conn);
      });
    },
  };

  // -------------------------------------------------------------------------------
  // Recovery (ADR 0009)

  const recoverTable = async (tableId: string): Promise<void> => {
    const loaded = await store.loadTable(tableId);
    if (!loaded) throw new Error('not found in store');
    const game = games.get(loaded.snapshot.game);
    if (!game) throw new Error(`UNKNOWN_GAME: game "${loaded.snapshot.game}" is not registered`);
    if ((game.version ?? 1) !== loaded.snapshot.version) {
      throw new Error(
        `VERSION_MISMATCH: stored version ${String(loaded.snapshot.version)}, game version ${String(game.version ?? 1)}`,
      );
    }
    const snapshot = JSON.parse(loaded.snapshot.data) as Snapshot;
    const tail = loaded.tail.map((e) => JSON.parse(e.data) as LogEntry);
    const first = await store.readLog(tableId, 0, 0);
    const createdAt = first[0] ? (JSON.parse(first[0].data) as LogEntry).at : clock.now();
    let runtime: TableRuntime;
    try {
      runtime = await TableRuntime.replay(game, tail, {
        from: snapshot,
        live: true,
        clock,
        dev,
        persist: persistEntry(tableId),
        ...walletOptions(tableId),
      });
    } catch (error) {
      throw new Error(
        `REPLAY_DIVERGED: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    register(tableId, game, runtime, createdAt);
    // Every seated player starts disconnected with a fresh grace period.
    const seated = new Set(runtime.seats().flatMap((s) => (s.player ? [s.player.id] : [])));
    for (const playerId of seated) {
      const record = await store.sessions.get(playerId);
      const session = getSession({
        id: playerId,
        name: record?.name ?? playerId,
        guest: !options.auth,
        metadata: record?.metadata ?? null,
      });
      session.joined.add(tableId);
      await startGrace(session, tableId);
      scheduleSessionCleanup(session);
    }
    emit('table:recovered', { table: tableId });
  };

  const ready = (async () => {
    for (const tableId of await store.listOpenTables()) {
      try {
        await recoverTable(tableId);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        logger.error('Could not recover a table', { table: tableId, reason });
        emit('table:recovery-failed', { table: tableId, reason });
      }
    }
    lobbyDoc = buildLobby();
  })();

  // -------------------------------------------------------------------------------
  // Public API

  const attach = async (server: HttpServer): Promise<void> => {
    await ready;
    detachers.push(
      attachWebSocket(server, handler, {
        path,
        maxMessageBytes: limits.maxMessageBytes,
        heartbeatMs: limits.heartbeatMs,
        origins: options.origins ?? [],
      }),
    );
  };

  return {
    ready,
    attach,
    async listen({ port = 0, host = '127.0.0.1' } = {}) {
      const server = createHttpServer((_req, res) => {
        res
          .writeHead(426, { 'Content-Type': 'text/plain' })
          .end('Shoehive: connect with a WebSocket\n');
      });
      httpServers.push(server);
      await attach(server);
      await new Promise<void>((resolve) => server.listen(port, host, resolve));
      const address = server.address() as AddressInfo;
      return { port: address.port, url: `ws://${host}:${String(address.port)}${path}` };
    },
    connect(request) {
      return connectMemory(handler, request, limits.maxMessageBytes);
    },
    tables: {
      create: createTable,
      get: (id) => {
        const entry = tables.get(id);
        return entry ? tableInfo(id, entry) : undefined;
      },
      list: () => [...tables].map(([id, entry]) => tableInfo(id, entry)),
      close: (id) => closeTable(id, 'closed'),
      start: async (id) => {
        await requireTable(id).runtime.start();
      },
      reload: async (id) => {
        const entry = requireTable(id);
        entry.runtime.dispose();
        tables.delete(id);
        await recoverTable(id);
        for (const conn of conns) if (conn.tables.has(id)) sendSnapshot(conn, id);
      },
      runtime: (id) => tables.get(id)?.runtime,
    },
    on(event, listener) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return () => set.delete(listener);
    },
    async close({ graceful = true } = {}) {
      closing = true;
      await ready.catch(() => undefined);
      if (graceful) {
        for (const [id, entry] of tables) {
          await entry.runtime.idle();
          await saveSnapshot(id, entry).catch((error: unknown) => {
            logger.error('Could not write the final snapshot', { table: id, error });
          });
        }
      }
      for (const conn of [...conns]) {
        if (graceful) closeConn(conn, CLOSE.GOING_AWAY, 'Server shutting down');
        else conn.transport.close(CLOSE.GOING_AWAY, '');
        onClose(conn);
      }
      for (const entry of tables.values()) {
        if (entry.idleTimer !== null) clock.clearTimer(entry.idleTimer);
        entry.runtime.dispose();
      }
      tables.clear();
      for (const session of sessions.values()) {
        for (const timer of session.grace.values()) clock.clearTimer(timer);
        if (session.cleanup !== null) clock.clearTimer(session.cleanup);
      }
      sessions.clear();
      await Promise.all(detachers.map((detach) => detach()));
      await Promise.all(
        httpServers.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.close(() => {
                resolve();
              });
            }),
        ),
      );
    },
  };
}

export { ShoehiveError };
