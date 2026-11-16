// Regression tests for the client side of the 1.0 network security review
// (docs/security/review-1.0-network.md): server data is untrusted.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient, type TokenStorage, type WebSocketLike } from '../../src/client/index';
import { applyPatch } from '../../src/core/diff';
import type { Json } from '../../src/core/json';

/** A socket whose server side the test scripts by hand. */
class FakeSocket implements WebSocketLike {
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.readyState = 3;
  }
  /** Delivers a server frame. */
  deliver(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  last(t: string): Record<string, unknown> | undefined {
    return this.sent.filter((m) => m['t'] === t).at(-1);
  }
}

const memoryStorage = (): TokenStorage => {
  let token: string | null = null;
  return { get: () => token, set: (t) => (token = t) };
};

const welcome = {
  player: { id: 'g_1', name: 'Ada', guest: true },
  resumeToken: 'v1.old.sig',
  resumeExpiresAt: 0,
  resumed: false,
  server: { protocol: 1, now: Date.now(), heartbeatMs: 15_000, maxMessageBytes: 65_536 },
};

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function connected(storage: TokenStorage = memoryStorage()) {
  const sockets: FakeSocket[] = [];
  const client = createClient({
    url: 'ws://test/shoehive',
    storage,
    reconnect: { initialDelayMs: 10, maxDelayMs: 50 },
    connect: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      queueMicrotask(() => socket.onopen?.({}));
      return socket;
    },
  });
  await flush();
  const socket = sockets[0]!;
  socket.deliver({ t: 'ack', id: socket.last('hello')!['id'], ok: true, result: welcome });
  await client.connect();
  return { client, socket, sockets };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('N-08: hostile server messages', () => {
  it('ignores frames that are not message objects instead of throwing', async () => {
    const { client, socket } = await connected();
    for (const frame of ['null', '5', '"x"', '[]', '{"t":5}', '{}', 'not json']) {
      expect(() => {
        socket.deliver(frame);
      }).not.toThrow();
    }
    // A failed ack with no usable error still rejects cleanly.
    const pending = client.request('lobby.unsub');
    socket.deliver({ t: 'ack', id: socket.last('lobby.unsub')!['id'], ok: false, error: null });
    await expect(pending).rejects.toMatchObject({ code: 'INTERNAL' });
    client.close();
  });

  it('resyncs on a patch that does not apply, keeping the document', async () => {
    const { client, socket } = await connected();
    const joining = client.join('t1');
    await flush();
    socket.deliver({ t: 'ack', id: socket.last('table.join')!['id'], ok: true });
    const doc = {
      view: { n: 1 },
      meta: {},
      seats: [],
      spectators: 0,
      you: { player: 'g_1', seats: [], role: 'player' },
    };
    socket.deliver({ t: 'table.snapshot', table: 't1', rev: 3, doc });
    const table = await joining;
    for (const ops of [
      [{ op: 'replace', path: '/view/missing/deep', value: 1 }],
      [{ op: 'move', from: '/view', path: '/x' }],
      'not an array',
    ]) {
      const syncs = socket.sent.filter((m) => m['t'] === 'table.sync').length;
      expect(() => {
        socket.deliver({ t: 'table.patch', table: 't1', from: 3, rev: 4, ops });
      }).not.toThrow();
      expect(table.rev).toBe(3);
      expect(table.doc).toEqual(doc);
      expect(socket.sent.filter((m) => m['t'] === 'table.sync').length).toBe(syncs + 1);
    }
    client.close();
  });
});

describe('N-09: close code 4429', () => {
  it('waits at least 30 s before reconnecting', async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const client = createClient({
      url: 'ws://test/shoehive',
      storage: memoryStorage(),
      reconnect: { initialDelayMs: 10, maxDelayMs: 50 },
      connect: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    client.connect().catch(() => undefined);
    sockets[0]!.onclose?.({ code: 4429, reason: 'Rate limit abuse' });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(sockets).toHaveLength(2);
    client.close();
  });
});

describe('N-04: player.rename', () => {
  it('stores the fresh resume token the server returns', async () => {
    const storage = memoryStorage();
    const { client, socket } = await connected(storage);
    expect(storage.get()).toBe('v1.old.sig');
    const renaming = client.rename('Ada L.');
    await flush();
    socket.deliver({
      t: 'ack',
      id: socket.last('player.rename')!['id'],
      ok: true,
      result: { name: 'Ada L.', resumeToken: 'v1.new.sig', resumeExpiresAt: 1 },
    });
    expect(await renaming).toBe('Ada L.');
    expect(storage.get()).toBe('v1.new.sig');
    client.close();
  });
});

describe('N-11: applyPatch on untrusted patches', () => {
  const doc = { a: [1, 2], o: { k: 1 } } as Json;
  const bad: unknown[] = [
    { op: 'move', from: '/a', path: '/b' },
    { op: 'copy', from: '/a', path: '/b' },
    { op: 'test', path: '/a', value: [1, 2] },
    { op: 'add', path: 'a/0', value: 0 },
    { op: 'replace', path: '/a/', value: 0 },
    { op: 'replace', path: '/a/01', value: 0 },
    { op: 'replace', path: '/a/1e0', value: 0 },
    { op: 'replace', path: '/a/ 1', value: 0 },
    { op: 'replace', path: '/a/2', value: 0 },
    { op: 'remove', path: '/a/2' },
    { op: 'replace', path: '/a/-', value: 0 },
    { op: 'add', path: '/__proto__/polluted', value: 1 },
    { op: 'add', path: '/constructor/prototype/polluted', value: 1 },
    { op: 'add', path: '/a/__proto__', value: 1 },
  ];

  it('throws on anything outside what diff() produces', () => {
    for (const op of bad) {
      expect(() => applyPatch(doc, [op] as never), JSON.stringify(op)).toThrow();
    }
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('still applies every valid form', () => {
    expect(
      applyPatch(doc, [
        { op: 'add', path: '/a/2', value: 3 },
        { op: 'add', path: '/a/-', value: 4 },
        { op: 'replace', path: '/a/0', value: 0 },
        { op: 'remove', path: '/a/1' },
        { op: 'add', path: '/o/__proto__', value: { x: 1 } },
      ]),
    ).toEqual(JSON.parse('{"a":[0,3,4],"o":{"k":1,"__proto__":{"x":1}}}'));
    // An own "__proto__" key stays data: the prototype is untouched.
    const out = applyPatch(doc, [{ op: 'add', path: '/__proto__', value: { polluted: 1 } }]);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect((out as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});
