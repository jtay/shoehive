// Transports carry protocol text between clients and the server (RFC 0001 section 7).
// v1 ships a WebSocket transport (`ws`, Node) and an in-memory one for tests.

import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';

/** The parts of the HTTP upgrade request that auth hooks see. */
export interface UpgradeRequest {
  headers: Record<string, string | string[] | undefined>;
  url?: string | undefined;
}

/** One client connection, as the server sees it. */
export interface Connection {
  send(text: string): void;
  close(code: number, reason: string): void;
  /** Bytes queued but not yet sent (for backpressure). */
  bufferedAmount(): number;
  onMessage(listener: (text: string) => void): void;
  onClose(listener: () => void): void;
}

/** What a transport needs from the server. */
export interface ConnectionHandler {
  /**
   * Decides whether an upgrade may proceed: `'ok'` (with an identity under custom
   * auth, or `null` for guest mode), or an HTTP status to refuse with.
   */
  authorize(
    request: UpgradeRequest,
  ): Promise<{ status: 'ok'; identity: unknown } | { status: 401 | 403 | 500 }>;
  accept(connection: Connection, identity: unknown): void;
}

// ---------------------------------------------------------------------------------
// In-memory transport

/** The client end of an in-memory connection. Mirrors the browser WebSocket API. */
export interface MemorySocket {
  readonly readyState: 0 | 1 | 2 | 3;
  send(text: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
}

/**
 * Opens an in-memory connection to `handler`. Messages are delivered asynchronously
 * (one microtask later), like a network would.
 */
export function connectMemory(
  handler: ConnectionHandler,
  request: UpgradeRequest = { headers: {} },
  maxMessageBytes = Number.POSITIVE_INFINITY,
): MemorySocket {
  let state: 0 | 1 | 2 | 3 = 0;
  const serverListeners: ((text: string) => void)[] = [];
  const closeListeners: (() => void)[] = [];
  const deliver = (fn: () => void): void => {
    queueMicrotask(fn);
  };

  const finish = (code: number, reason: string): void => {
    if (state === 3) return;
    state = 3;
    deliver(() => {
      for (const l of closeListeners) l();
      client.onclose?.({ code, reason });
    });
  };

  const connection: Connection = {
    send: (text) => {
      if (state !== 1) return;
      deliver(() => client.onmessage?.({ data: text }));
    },
    close: (code, reason) => {
      finish(code, reason);
    },
    bufferedAmount: () => 0,
    onMessage: (l) => serverListeners.push(l),
    onClose: (l) => closeListeners.push(l),
  };

  const client: MemorySocket = {
    get readyState() {
      return state;
    },
    send: (text) => {
      if (state !== 1) throw new Error('MemorySocket is not open');
      if (text.length > maxMessageBytes) {
        finish(1009, 'Message too big');
        return;
      }
      deliver(() => {
        for (const l of serverListeners) l(text);
      });
    },
    close: (code = 1000, reason = '') => {
      finish(code, reason);
    },
    onopen: null,
    onmessage: null,
    onclose: null,
  };

  void handler.authorize(request).then((result) => {
    if (result.status !== 'ok') {
      finish(1008, `HTTP ${String(result.status)}`);
      return;
    }
    state = 1;
    handler.accept(connection, result.identity);
    client.onopen?.();
  });
  return client;
}

// ---------------------------------------------------------------------------------
// WebSocket transport

export interface WsTransportOptions {
  path: string;
  maxMessageBytes: number;
  heartbeatMs: number;
  /** Allowed `Origin` values. Empty means any origin. */
  origins: readonly string[];
}

const STATUS_TEXT: Record<number, string> = {
  401: 'Unauthorized',
  403: 'Forbidden',
  500: 'Internal Server Error',
};

function refuse(socket: Duplex, status: number): void {
  socket.end(
    `HTTP/1.1 ${String(status)} ${STATUS_TEXT[status] ?? ''}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

/** Attaches a WebSocket endpoint to `server`. Returns a function that detaches it. */
export function attachWebSocket(
  server: HttpServer,
  handler: ConnectionHandler,
  options: WsTransportOptions,
): () => Promise<void> {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: options.maxMessageBytes,
    handleProtocols: (protocols) => (protocols.has('shoehive.v1') ? 'shoehive.v1' : false),
  });
  const alive = new WeakMap<WebSocket, number>(); // missed heartbeats

  const onUpgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const path = (request.url ?? '/').split('?')[0];
    if (path !== options.path) return; // another handler may own this path
    const origin = request.headers.origin;
    if (options.origins.length > 0 && (origin === undefined || !options.origins.includes(origin))) {
      refuse(socket, 403);
      return;
    }
    void handler.authorize(request).then(
      (result) => {
        if (result.status !== 'ok') {
          refuse(socket, result.status);
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          alive.set(ws, 0);
          ws.on('pong', () => alive.set(ws, 0));
          handler.accept(wrap(ws), result.identity);
        });
      },
      () => {
        refuse(socket, 500);
      },
    );
  };
  server.on('upgrade', onUpgrade);

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const missed = alive.get(ws) ?? 0;
      if (missed >= 2) {
        ws.terminate();
        continue;
      }
      alive.set(ws, missed + 1);
      ws.ping();
    }
  }, options.heartbeatMs);
  heartbeat.unref();

  return () =>
    new Promise<void>((resolve) => {
      clearInterval(heartbeat);
      server.off('upgrade', onUpgrade);
      for (const ws of wss.clients) ws.terminate();
      wss.close(() => {
        resolve();
      });
    });
}

function wrap(ws: WebSocket): Connection {
  // ws reports protocol errors (for example an oversized frame) here, then closes.
  ws.on('error', () => undefined);
  return {
    send: (text) => {
      if (ws.readyState === ws.OPEN) ws.send(text);
    },
    close: (code, reason) => {
      ws.close(code, reason);
    },
    bufferedAmount: () => ws.bufferedAmount,
    onMessage: (listener) => {
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          ws.close(1003, 'Binary frames are not supported');
          return;
        }
        const buffer = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data);
        listener(buffer.toString('utf8'));
      });
    },
    onClose: (listener) => {
      ws.on('close', listener);
    },
  };
}
