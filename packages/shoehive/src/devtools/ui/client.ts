// The devtools socket client: authenticates, matches requests to results, forwards
// pushes, and reconnects with backoff. It knows nothing about the UI.

import {
  DEVTOOLS_CLOSE,
  DEVTOOLS_PROTOCOL,
  type DevRequest,
  type DevResults,
  type DevServerMessage,
  type DevWelcome,
} from '../protocol';

export type ConnStatus =
  | { kind: 'no-token' }
  | { kind: 'connecting'; attempt: number }
  | { kind: 'open' }
  /** Lost the connection; the next attempt starts at `retryAt` (epoch ms). */
  | { kind: 'waiting'; attempt: number; retryAt: number; code: number }
  /** Close code 4401: the token was rejected. No automatic retry. */
  | { kind: 'unauthorized' }
  /** Close code 4429: too many failed attempts from this address. No automatic retry. */
  | { kind: 'locked-out'; since: number }
  /** The server speaks a different devtools protocol version. */
  | { kind: 'mismatch'; server: number };

export type DevPush = Extract<DevServerMessage, { t: 'tables' | 'table.update' | 'table.closed' }>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A request as callers write it: the client adds the `id`. */
export type DevRequestBody = DistributiveOmit<DevRequest, 'id'>;

export class DevRequestError extends Error {
  override readonly name = 'DevRequestError';
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Reconnect delay for a 0-based attempt: 0.5 s doubling to a 10 s cap, with +/-25% jitter. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(10_000, 500 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.75 + 0.5 * random()));
}

/** The subset of the browser WebSocket the client uses (tests pass a fake). */
export interface SocketLike {
  readonly readyState: number;
  onopen: ((ev: Event) => unknown) | null;
  onmessage: ((ev: MessageEvent) => unknown) | null;
  onclose: ((ev: CloseEvent) => unknown) | null;
  onerror: ((ev: Event) => unknown) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface DevClientOptions {
  url: string;
  token: string;
  onStatus: (status: ConnStatus) => void;
  onWelcome: (welcome: DevWelcome) => void;
  onPush: (push: DevPush) => void;
  createSocket?: (url: string) => SocketLike;
  random?: () => number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

const OPEN = 1;

export class DevClient {
  private socket: SocketLike | null = null;
  private authed = false;
  private attempt = 0;
  private nextId = 1;
  private timer: unknown = null;
  private stopped = false;
  private readonly pending = new Map<string, Pending>();
  private readonly createSocket: (url: string) => SocketLike;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly options: DevClientOptions) {
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      options.clearTimer ??
      ((handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      });
  }

  /** `true` once `auth.ok` arrived on the current socket. */
  get connected(): boolean {
    return this.authed;
  }

  /** Opens the socket (or reconnects right away when waiting). */
  connect(): void {
    this.stopped = false;
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.socket !== null) return;
    this.options.onStatus({ kind: 'connecting', attempt: this.attempt });
    const socket = this.createSocket(this.options.url);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ t: 'auth', token: this.options.token }));
    };
    socket.onmessage = (ev) => {
      if (this.socket === socket && typeof ev.data === 'string') this.receive(ev.data);
    };
    socket.onerror = () => {
      // A close event always follows; reconnecting is handled there.
    };
    socket.onclose = (ev) => {
      if (this.socket === socket) this.closed(ev.code);
    };
  }

  /** Closes the socket for good. */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    this.authed = false;
    this.failPending('Inspector closed.');
    socket?.close(1000, 'bye');
  }

  /** Sends a request and resolves with its result, or rejects with `DevRequestError`. */
  request<M extends DevRequestBody>(message: M): Promise<DevResults[M['t']]> {
    const socket = this.socket;
    if (!this.authed || socket?.readyState !== OPEN) {
      return Promise.reject(new DevRequestError('DISCONNECTED', 'Not connected to the server.'));
    }
    const id = String(this.nextId++);
    return new Promise<DevResults[M['t']]>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      socket.send(JSON.stringify({ ...message, id }));
    });
  }

  private receive(data: string): void {
    let message: DevServerMessage;
    try {
      message = JSON.parse(data) as DevServerMessage;
    } catch {
      return;
    }
    switch (message.t) {
      case 'auth.ok': {
        // Typed as the literal 1, but an older or newer server may send anything.
        const protocol: number = message.welcome.protocol;
        if (protocol !== DEVTOOLS_PROTOCOL) {
          this.stopped = true;
          this.options.onStatus({ kind: 'mismatch', server: protocol });
          this.socket?.close(1000, 'protocol mismatch');
          return;
        }
        this.authed = true;
        this.attempt = 0;
        this.options.onStatus({ kind: 'open' });
        this.options.onWelcome(message.welcome);
        return;
      }
      case 'result': {
        const pending = this.pending.get(message.id);
        if (pending === undefined) return;
        this.pending.delete(message.id);
        if (message.ok) pending.resolve(message.result);
        else pending.reject(new DevRequestError(message.error.code, message.error.message));
        return;
      }
      case 'tables':
      case 'table.update':
      case 'table.closed':
        this.options.onPush(message);
        return;
    }
  }

  private closed(code: number): void {
    this.socket = null;
    this.authed = false;
    this.failPending('The connection to the server was lost.');
    if (this.stopped) return;
    if (code === DEVTOOLS_CLOSE.UNAUTHORIZED) {
      this.options.onStatus({ kind: 'unauthorized' });
      return;
    }
    if (code === DEVTOOLS_CLOSE.LOCKED_OUT) {
      this.options.onStatus({ kind: 'locked-out', since: this.now() });
      return;
    }
    const delay = backoffDelay(this.attempt, this.options.random);
    this.attempt += 1;
    this.options.onStatus({
      kind: 'waiting',
      attempt: this.attempt,
      retryAt: this.now() + delay,
      code,
    });
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.connect();
    }, delay);
  }

  private failPending(message: string): void {
    const error = new DevRequestError('DISCONNECTED', message);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
