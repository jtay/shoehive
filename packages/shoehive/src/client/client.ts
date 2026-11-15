// shoehive/client: the framework-agnostic TypeScript client (RFC 0001 section 5.4).
// Speaks protocol v1 (docs/reference/protocol.md). Isomorphic: browsers and Node 22+.

import type { AnyGame, GameActions, GameView, SeatInfo } from '../core/define';
import { applyPatch } from '../core/diff';
import { ShoehiveError } from '../core/errors';
import type { Json } from '../core/json';
import type { TableMeta } from '../core/runtime';
import type {
  Ack,
  LobbyDocument,
  ServerMessage,
  TableDocument,
  Welcome,
} from '../protocol/messages';
import { PROTOCOL_VERSION } from '../protocol/version';

// ---------------------------------------------------------------------------------
// Types

/** The subset of the browser WebSocket API the client uses. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror?: ((event: unknown) => void) | null;
}

/** Where the resume token is kept between page loads. */
export interface TokenStorage {
  get(): string | null;
  set(token: string | null): void;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface ClientOptions {
  /** Server URL, for example `ws://localhost:3000/shoehive`. */
  url: string;
  /** Display name for a new guest. */
  name?: string;
  /**
   * Resume token storage. Default: `localStorage` in browsers, memory elsewhere.
   * `false` disables it (every connection is a new guest).
   */
  storage?: TokenStorage | false;
  /** Opens the socket. Default: `new WebSocket(url, 'shoehive.v1')`. */
  connect?: (url: string) => WebSocketLike;
  /** Reconnect with exponential backoff and jitter. Default on; `false` disables it. */
  reconnect?: { initialDelayMs?: number; maxDelayMs?: number } | false;
  /** How long a request waits for its ack. Default 15 000 ms. */
  requestTimeoutMs?: number;
  /** Connect immediately. Default `true`. */
  autoConnect?: boolean;
}

/** Input arguments of action `K`: optional when the action takes no input. */
export type ActArgs<G, K extends keyof GameActions<G>> = undefined extends GameActions<G>[K]
  ? [input?: GameActions<G>[K]]
  : [input: GameActions<G>[K]];

/** Codes the client itself raises (not sent by servers). */
export const CLIENT_ERROR_CODES = ['CONNECTION_LOST', 'REQUEST_TIMEOUT', 'CLIENT_CLOSED'] as const;

/** Close codes after which the client must not reconnect (protocol section 8). */
const FINAL_CLOSE_CODES = new Set([1000, 1009, 4001, 4002, 4409]);

type Listener<T> = (value: T) => void;

function emitAll<T>(listeners: Set<Listener<T>>, value: T): void {
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch (error) {
      console.error('[shoehive] listener threw', error);
    }
  }
}

function defaultStorage(url: string): TokenStorage {
  const key = `shoehive:resume:${url}`;
  const local = (globalThis as { localStorage?: Storage }).localStorage;
  let memory: string | null = null;
  return {
    get: () => {
      try {
        return local ? local.getItem(key) : memory;
      } catch {
        return memory;
      }
    },
    set: (token) => {
      memory = token;
      try {
        if (local) {
          if (token === null) local.removeItem(key);
          else local.setItem(key, token);
        }
      } catch {
        // storage blocked (private mode): memory only
      }
    },
  };
}

function clientError(code: (typeof CLIENT_ERROR_CODES)[number], message: string): ShoehiveError {
  return new ShoehiveError({ code, source: 'shoehive', message });
}

// ---------------------------------------------------------------------------------
// Table handle

export interface ActResult {
  rev: number;
  value?: Json;
}

/** A joined table. Its document stays in sync with the server. */
export class TableHandle<G extends AnyGame = AnyGame> {
  /** The latest document, or `null` until the first snapshot arrives. */
  doc: TableDocument | null = null;
  rev = -1;
  private readonly listeners = new Set<Listener<TableDocument>>();
  private readonly eventListeners = new Map<
    string,
    Set<Listener<{ payload: Json; rev: number }>>
  >();
  private firstSnapshot: Promise<void>;
  private resolveFirst!: () => void;
  /** Set when the server closed the table. */
  closedReason: string | null = null;
  /** The role this handle joined with, restored on reconnect. */
  role: 'player' | 'spectator';

  /** @internal */
  constructor(
    readonly id: string,
    private readonly client: ShoehiveClient,
    role: 'player' | 'spectator',
  ) {
    this.role = role;
    this.firstSnapshot = new Promise((resolve) => {
      this.resolveFirst = resolve;
    });
  }

  /** Resolves once the first snapshot has arrived. */
  ready(): Promise<void> {
    return this.firstSnapshot;
  }

  /** What this viewer may see: the game's `view()` output. */
  get view(): GameView<G> {
    return this.requireDoc().view as GameView<G>;
  }
  get meta(): TableMeta {
    return this.requireDoc().meta;
  }
  get seats(): SeatInfo[] {
    return this.requireDoc().seats;
  }
  get you(): TableDocument['you'] {
    return this.requireDoc().you;
  }
  /** This player's first seat, or `null`. */
  get mySeat(): number | null {
    return this.doc?.you.seats[0] ?? null;
  }

  /** Calls `listener` with the new document after every change. */
  subscribe(listener: Listener<TableDocument>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Listens for ephemeral events sent with `ctx.emit()`. */
  on(name: string, listener: Listener<{ payload: Json; rev: number }>): () => void {
    let set = this.eventListeners.get(name);
    if (!set) {
      set = new Set();
      this.eventListeners.set(name, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  /** Runs an action. Resolves after the server applied it (your document already shows it). */
  async act<K extends keyof GameActions<G> & string>(
    name: K,
    ...input: ActArgs<G, K>
  ): Promise<ActResult> {
    const fields: Record<string, unknown> = { table: this.id, name };
    if (input[0] !== undefined) fields['input'] = input[0];
    return (await this.client.request('act', fields)) as unknown as ActResult;
  }

  /** Takes a seat (the lowest free one by default). Resolves with the seat number. */
  async sit(seat?: number): Promise<number> {
    const result = (await this.client.request(
      'seat.take',
      seat === undefined ? { table: this.id } : { table: this.id, seat },
    )) as {
      seat: number;
    };
    return result.seat;
  }

  /** Gives up a seat (all of yours by default). */
  async stand(seat?: number): Promise<void> {
    await this.client.request(
      'seat.leave',
      seat === undefined ? { table: this.id } : { table: this.id, seat },
    );
  }

  /** Leaves the table. Seated players stand up. */
  async leave(): Promise<void> {
    this.client.forget(this.id);
    await this.client.request('table.leave', { table: this.id });
  }

  /** Asks for a fresh snapshot. */
  async sync(): Promise<void> {
    await this.client.request('table.sync', { table: this.id });
  }

  private requireDoc(): TableDocument {
    if (!this.doc) throw new Error(`Table ${this.id} has no document yet: await table.ready()`);
    return this.doc;
  }

  /** @internal */
  receive(message: ServerMessage): void {
    switch (message.t) {
      case 'table.snapshot':
        this.doc = message.doc;
        this.rev = message.rev;
        this.resolveFirst();
        emitAll(this.listeners, this.doc);
        return;
      case 'table.patch':
        if (!this.doc || message.from !== this.rev) {
          // A gap (missed patch): ask for a fresh snapshot (protocol section 6.3).
          void this.sync().catch(() => undefined);
          return;
        }
        this.doc = applyPatch(this.doc as unknown as Json, message.ops) as unknown as TableDocument;
        this.rev = message.rev;
        emitAll(this.listeners, this.doc);
        return;
      case 'table.event': {
        const set = this.eventListeners.get(message.name);
        if (set) emitAll(set, { payload: message.payload, rev: message.rev });
        return;
      }
      case 'table.closed':
        this.closedReason = message.reason;
        if (this.doc) emitAll(this.listeners, this.doc);
        return;
      default:
        return;
    }
  }
}

// ---------------------------------------------------------------------------------
// Lobby handle

export class LobbyHandle {
  doc: LobbyDocument | null = null;
  rev = -1;
  private readonly listeners = new Set<Listener<LobbyDocument>>();

  /** @internal */
  constructor(private readonly client: ShoehiveClient) {}

  subscribe(listener: Listener<LobbyDocument>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Stops lobby updates. */
  async close(): Promise<void> {
    this.client.dropLobby();
    await this.client.request('lobby.unsub');
  }

  /** @internal */
  receive(message: ServerMessage): void {
    if (message.t === 'lobby.snapshot') {
      this.doc = message.doc;
      this.rev = message.rev;
    } else if (message.t === 'lobby.patch') {
      if (!this.doc || message.from !== this.rev) {
        void this.client.request('lobby.sub').catch(() => undefined);
        return;
      }
      this.doc = applyPatch(this.doc as unknown as Json, message.ops) as unknown as LobbyDocument;
      this.rev = message.rev;
    } else {
      return;
    }
    emitAll(this.listeners, this.doc);
  }
}

// ---------------------------------------------------------------------------------
// Client

interface Pending {
  resolve: (value: Json | undefined) => void;
  reject: (error: ShoehiveError) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** A connection to a Shoehive server. `Games` types `join()` and `act()`. */
export class ShoehiveClient<Games extends readonly AnyGame[] = readonly AnyGame[]> {
  status: ConnectionStatus = 'idle';
  /** The current player, after the first successful `hello`. */
  player: Welcome['player'] | null = null;
  /** Milliseconds to add to `Date.now()` to get server time (for countdowns). */
  clockOffset = 0;

  private socket: WebSocketLike | null = null;
  private nextId = 1;
  private readonly pending = new Map<string, Pending>();
  private readonly queue: (() => void)[] = [];
  private readonly tables = new Map<string, TableHandle>();
  private lobbyHandle: LobbyHandle | null = null;
  private readonly statusListeners = new Set<Listener<ConnectionStatus>>();
  private readonly storage: TokenStorage | null;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUser = false;
  private welcomed: Promise<Welcome> | null = null;
  private readonly options: ClientOptions;

  constructor(options: ClientOptions) {
    this.options = options;
    this.storage =
      options.storage === false ? null : (options.storage ?? defaultStorage(options.url));
    if (options.autoConnect !== false) void this.connect().catch(() => undefined);
  }

  /** Server time now, corrected by the measured clock offset. */
  serverNow(): number {
    return Date.now() + this.clockOffset;
  }

  /** Calls `listener` on every connection status change. */
  onStatus(listener: Listener<ConnectionStatus>): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Opens the connection (done automatically unless `autoConnect: false`). */
  connect(): Promise<Welcome> {
    if (this.welcomed && this.status !== 'closed') return this.welcomed;
    this.closedByUser = false;
    this.welcomed = this.open();
    return this.welcomed;
  }

  /** Closes the connection for good. Pending requests reject with `CLIENT_CLOSED`. */
  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.socket?.close(1000, 'client closed');
    this.socket = null;
    this.failPending(clientError('CLIENT_CLOSED', 'The client was closed'));
    this.setStatus('closed');
  }

  /** Subscribes to the lobby. */
  async lobby(): Promise<LobbyHandle> {
    if (!this.lobbyHandle) {
      this.lobbyHandle = new LobbyHandle(this);
      await this.request('lobby.sub');
    }
    return this.lobbyHandle;
  }

  /** Creates a table and returns its id. Does not join it. */
  async createTable(game: Games[number]['id'], options?: Json): Promise<string> {
    const result = (await this.request(
      'table.create',
      options === undefined ? { game } : { game, options },
    )) as {
      table: string;
    };
    return result.table;
  }

  /** Joins a table and waits for its first snapshot. */
  async join<G extends AnyGame = Games[number]>(
    tableId: string,
    options: { as?: 'player' | 'spectator' } = {},
  ): Promise<TableHandle<G>> {
    let handle = this.tables.get(tableId) as TableHandle<G> | undefined;
    if (!handle) {
      handle = new TableHandle<G>(tableId, this, options.as ?? 'player');
      this.tables.set(tableId, handle);
    }
    try {
      await this.request('table.join', { table: tableId, as: options.as ?? 'player' });
    } catch (error) {
      this.tables.delete(tableId);
      throw error;
    }
    await handle.ready();
    return handle;
  }

  /** Creates a table, joins it and takes a seat. */
  async createAndJoin<G extends AnyGame = Games[number]>(
    game: Games[number]['id'],
    options?: Json,
    { sit = true }: { sit?: boolean } = {},
  ): Promise<TableHandle<G>> {
    const id = await this.createTable(game, options);
    const table = await this.join<G>(id);
    if (sit) await table.sit();
    return table;
  }

  /** A table this client has joined, if any. */
  table<G extends AnyGame = Games[number]>(tableId: string): TableHandle<G> | undefined {
    return this.tables.get(tableId) as TableHandle<G> | undefined;
  }

  /** Round-trip time in ms; also refreshes the server clock offset. */
  async ping(): Promise<number> {
    await this.connect();
    const id = `p${String(this.nextId++)}`;
    const sent = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(clientError('REQUEST_TIMEOUT', 'ping timed out'));
      }, this.options.requestTimeoutMs ?? 15_000);
      this.pending.set(id, {
        resolve: (now) => {
          const rtt = Date.now() - sent;
          this.clockOffset = (now as number) + rtt / 2 - Date.now();
          resolve(rtt);
        },
        reject,
        timer,
      });
      this.sendRaw({ t: 'ping', id });
    });
  }

  /**
   * Sends a protocol request and resolves with its result. Rejects with a
   * `ShoehiveError` carrying the server's code. Low level: prefer the typed methods.
   */
  request(t: string, fields: Record<string, unknown> = {}): Promise<Json | undefined> {
    return new Promise((resolve, reject) => {
      const id = String(this.nextId++);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(clientError('REQUEST_TIMEOUT', `"${t}" got no reply in time`));
      }, this.options.requestTimeoutMs ?? 15_000);
      this.pending.set(id, { resolve, reject, timer });
      const send = (): void => {
        this.sendRaw({ t, id, ...fields });
      };
      if (t === 'hello') send();
      else if (this.status === 'open') send();
      else {
        this.queue.push(send);
        if (this.status === 'idle' || this.status === 'closed')
          void this.connect().catch(() => undefined);
      }
    });
  }

  /** @internal */
  forget(tableId: string): void {
    this.tables.delete(tableId);
  }

  /** @internal */
  dropLobby(): void {
    this.lobbyHandle = null;
  }

  // -------------------------------------------------------------------------------

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    emitAll(this.statusListeners, status);
  }

  private sendRaw(message: Record<string, unknown>): void {
    this.socket?.send(JSON.stringify(message));
  }

  private failPending(error: ShoehiveError): void {
    // Requests queued for this connection are failed too, so they are not sent later.
    this.queue.length = 0;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(error);
      this.pending.delete(id);
    }
  }

  private open(): Promise<Welcome> {
    this.setStatus(this.attempts > 0 ? 'reconnecting' : 'connecting');
    return new Promise<Welcome>((resolve, reject) => {
      const connect =
        this.options.connect ??
        ((url: string) =>
          new (
            globalThis as unknown as { WebSocket: new (u: string, p: string) => WebSocketLike }
          ).WebSocket(url, 'shoehive.v1'));
      let socket: WebSocketLike;
      try {
        socket = connect(this.options.url);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        this.scheduleReconnect();
        return;
      }
      this.socket = socket;
      let welcomed = false;
      socket.onopen = () => {
        const fields: Record<string, unknown> = { v: PROTOCOL_VERSION };
        const token = this.storage?.get();
        if (token) fields['resume'] = token;
        if (this.options.name) fields['name'] = this.options.name;
        this.request('hello', fields).then(
          (result) => {
            const welcome = result as unknown as Welcome;
            welcomed = true;
            this.attempts = 0;
            this.player = welcome.player;
            this.clockOffset = welcome.server.now - Date.now();
            this.storage?.set(welcome.resumeToken);
            this.setStatus('open');
            this.restore(welcome.resumed);
            for (const send of this.queue.splice(0)) send();
            resolve(welcome);
          },
          (error: unknown) => {
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      };
      socket.onmessage = (event) => {
        this.onMessage(typeof event.data === 'string' ? event.data : String(event.data));
      };
      socket.onclose = (event) => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.failPending(
          clientError('CONNECTION_LOST', `Connection closed (${String(event.code)})`),
        );
        if (!welcomed)
          reject(clientError('CONNECTION_LOST', `Could not connect (${String(event.code)})`));
        if (
          this.closedByUser ||
          FINAL_CLOSE_CODES.has(event.code) ||
          this.options.reconnect === false
        ) {
          this.setStatus('closed');
          return;
        }
        if (event.code === 4401) this.storage?.set(null);
        this.scheduleReconnect();
      };
    });
  }

  /** After a reconnect: if the server did not restore the session, rejoin ourselves. */
  private restore(resumed: boolean): void {
    if (resumed) return;
    for (const [tableId, handle] of this.tables) {
      void this.request('table.join', { table: tableId, as: handle.role }).catch(() => undefined);
    }
    if (this.lobbyHandle) void this.request('lobby.sub').catch(() => undefined);
  }

  private scheduleReconnect(): void {
    if (this.options.reconnect === false || this.closedByUser) {
      this.setStatus('closed');
      return;
    }
    this.setStatus('reconnecting');
    const settings = this.options.reconnect ?? {}; // false was handled above
    const initial = settings.initialDelayMs ?? 500;
    const max = settings.maxDelayMs ?? 10_000;
    const delay = Math.min(max, initial * 2 ** this.attempts) * (0.5 + Math.random() / 2);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.welcomed = this.open();
      this.welcomed.catch(() => undefined);
    }, delay);
  }

  private onMessage(text: string): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(text) as ServerMessage;
    } catch {
      return;
    }
    switch (message.t) {
      case 'ack':
        this.settle(message);
        return;
      case 'pong': {
        const p = message.id === undefined ? undefined : this.pending.get(message.id);
        if (p && message.id !== undefined) {
          clearTimeout(p.timer);
          this.pending.delete(message.id);
          p.resolve(message.now);
        }
        return;
      }
      case 'table.snapshot':
      case 'table.patch':
      case 'table.event':
      case 'table.closed':
        this.tables.get(message.table)?.receive(message);
        if (message.t === 'table.closed') this.tables.delete(message.table);
        return;
      case 'lobby.snapshot':
      case 'lobby.patch':
        this.lobbyHandle?.receive(message);
        return;
      case 'bye':
        return;
      default:
        return; // unknown server messages are ignored (protocol section 1, rule 5)
    }
  }

  private settle(ack: Ack): void {
    const p = this.pending.get(ack.id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(ack.id);
    if (ack.ok) p.resolve(ack.result);
    else p.reject(new ShoehiveError({ ...ack.error }));
  }
}

/**
 * Creates a client. Pass your games as a type argument for typed views and actions:
 *
 * ```ts
 * const client = createClient<[typeof ticTacToe]>({ url: 'ws://localhost:3000/shoehive' });
 * const table = await client.join(tableId);
 * await table.act('place', { cell: 4 });
 * ```
 */
export function createClient<Games extends readonly AnyGame[] = readonly AnyGame[]>(
  options: ClientOptions,
): ShoehiveClient<Games> {
  return new ShoehiveClient<Games>(options);
}
