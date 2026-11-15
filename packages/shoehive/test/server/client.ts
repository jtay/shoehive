// A minimal protocol client for server tests. It speaks the wire protocol directly
// (docs/reference/protocol.md), applies patches and detects gaps. Phase 3 replaces it
// with shoehive/client for application code.

import WebSocket from 'ws';
import { applyPatch } from '../../src/core/diff';
import type { Json } from '../../src/core/json';
import type {
  Ack,
  LobbyDocument,
  ServerMessage,
  TableDocument,
  Welcome,
} from '../../src/protocol/messages';
import type { ShoehiveServer } from '../../src/server/index';

interface SocketLike {
  send(text: string): void;
  close(code?: number, reason?: string): void;
}

/** A resume-token secret for tests (at least 32 bytes). */
export const SECRET = 'test-secret-that-is-at-least-32-bytes-long';

export class TestClient {
  readonly received: ServerMessage[] = [];
  readonly tables = new Map<string, { rev: number; doc: TableDocument }>();
  lobby: { rev: number; doc: LobbyDocument } | null = null;
  welcome: Welcome | null = null;
  closed: { code: number; reason: string } | null = null;
  gaps = 0;
  private nextId = 1;
  private readonly waiting = new Map<string, (ack: Ack) => void>();
  private opened!: Promise<void>;
  private socket!: SocketLike;

  static memory(server: ShoehiveServer, headers: Record<string, string> = {}): TestClient {
    const client = new TestClient();
    const socket = server.connect({ headers });
    client.socket = socket;
    let opened = false;
    client.opened = new Promise((resolve, reject) => {
      socket.onopen = () => {
        opened = true;
        resolve();
      };
      socket.onclose = (e) => {
        client.closed = { code: e.code, reason: e.reason };
        if (!opened) reject(new Error(e.reason));
      };
    });
    client.opened.catch(() => undefined);
    socket.onmessage = (e) => {
      client.onMessage(e.data);
    };
    return client;
  }

  static ws(url: string, options: { headers?: Record<string, string> } = {}): TestClient {
    const client = new TestClient();
    const socket = new WebSocket(url, 'shoehive.v1', { headers: options.headers });
    client.socket = socket;
    client.opened = new Promise((resolve, reject) => {
      socket.on('open', () => {
        resolve();
      });
      socket.on('unexpected-response', (_req, res) => {
        client.closed = { code: res.statusCode ?? 0, reason: `HTTP ${String(res.statusCode)}` };
        reject(new Error(`HTTP ${String(res.statusCode)}`));
      });
      socket.on('error', reject);
    });
    socket.on('message', (data: Buffer) => {
      client.onMessage(data.toString('utf8'));
    });
    socket.on('close', (code: number, reason: Buffer) => {
      client.closed = { code, reason: reason.toString('utf8') };
    });
    return client;
  }

  /** Resolves once the socket is open (rejects if the upgrade was refused). */
  open(): Promise<void> {
    return this.opened;
  }

  sendRaw(text: string): void {
    this.socket.send(text);
  }

  close(code = 1000): void {
    this.socket.close(code);
  }

  /** Sends a request and resolves with its ack (ok or not). */
  async request(t: string, fields: Record<string, unknown> = {}): Promise<Ack> {
    await this.opened;
    const id = String(this.nextId++);
    const ack = new Promise<Ack>((resolve) => this.waiting.set(id, resolve));
    this.socket.send(JSON.stringify({ t, id, ...fields }));
    return ack;
  }

  /** Sends a request and returns its result, throwing the wire error if it failed. */
  async ok(t: string, fields: Record<string, unknown> = {}): Promise<Json | undefined> {
    const ack = await this.request(t, fields);
    if (!ack.ok)
      throw Object.assign(new Error(`${ack.error.code}: ${ack.error.message}`), ack.error);
    return ack.result;
  }

  async hello(fields: Record<string, unknown> = {}): Promise<Welcome> {
    const result = await this.ok('hello', { v: 1, ...fields });
    this.welcome = result as unknown as Welcome;
    return this.welcome;
  }

  doc(table: string): TableDocument {
    const entry = this.tables.get(table);
    if (!entry) throw new Error(`No document for table ${table}`);
    return entry.doc;
  }

  /** Waits until `predicate` holds, polling on the macrotask queue. */
  async until(predicate: () => boolean, what = 'condition', timeoutMs = 2000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }

  private onMessage(text: string): void {
    const message = JSON.parse(text) as ServerMessage;
    this.received.push(message);
    switch (message.t) {
      case 'ack':
        this.waiting.get(message.id)?.(message);
        this.waiting.delete(message.id);
        return;
      case 'table.snapshot':
        this.tables.set(message.table, { rev: message.rev, doc: message.doc });
        return;
      case 'table.patch': {
        const local = this.tables.get(message.table);
        if (local?.rev !== message.from) {
          this.gaps += 1;
          void this.request('table.sync', { table: message.table });
          return;
        }
        local.doc = applyPatch(
          local.doc as unknown as Json,
          message.ops,
        ) as unknown as TableDocument;
        local.rev = message.rev;
        return;
      }
      case 'table.closed':
        this.tables.delete(message.table);
        return;
      case 'lobby.snapshot':
        this.lobby = { rev: message.rev, doc: message.doc };
        return;
      case 'lobby.patch':
        if (this.lobby?.rev !== message.from) {
          this.gaps += 1;
          return;
        }
        this.lobby = {
          rev: message.rev,
          doc: applyPatch(
            this.lobby.doc as unknown as Json,
            message.ops,
          ) as unknown as LobbyDocument,
        };
        return;
      default:
        return;
    }
  }
}
