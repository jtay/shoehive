// @vitest-environment happy-dom
// Unit tests for the devtools inspector UI logic (src/devtools/ui/): JSON diffing,
// formatting, token handling, the reducer, the socket client, and one rendered tree.

import { h, render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '../../src/core/runtime';
import type { DevTableDetail, DevTableSummary } from '../../src/devtools/protocol';
import { DEVTOOLS_CLOSE } from '../../src/devtools/protocol';
import {
  backoffDelay,
  DevClient,
  DevRequestError,
  type ConnStatus,
  type DevPush,
  type SocketLike,
} from '../../src/devtools/ui/client';
import { JsonTree } from '../../src/devtools/ui/components/json-tree';
import { mergeEntries } from '../../src/devtools/ui/components/log';
import { DiagnosticsCard, SeatsCard } from '../../src/devtools/ui/components/overview';
import { filterTables, sortTables } from '../../src/devtools/ui/components/tables';
import { statusText } from '../../src/devtools/ui/components/connection';
import {
  entryName,
  entrySeat,
  entrySummary,
  fixtureFileName,
  formatClock,
  formatCountdown,
  formatDelta,
  formatDuration,
  previewJson,
  truncate,
} from '../../src/devtools/ui/format';
import { childPath, diffJson, EMPTY_DIFF, escapeToken } from '../../src/devtools/ui/json-diff';
import {
  basePath,
  hashForPage,
  hashWithoutToken,
  pageFromHash,
  socketUrl,
  takeToken,
  TOKEN_STATE_KEY,
  tokenFromHash,
} from '../../src/devtools/ui/location';
import {
  baseDetail,
  initialState,
  reducer,
  shownDetail,
  type AppAction,
  type AppState,
} from '../../src/devtools/ui/state';

// ---------------------------------------------------------------------------------
// Fixtures

function detail(rev: number, overrides: Partial<DevTableDetail> = {}): DevTableDetail {
  return {
    id: 't1',
    game: 'demo',
    rev,
    seq: rev,
    replayed: false,
    meta: {
      game: 'demo',
      status: 'active',
      phase: 'play',
      turn: null,
      round: null,
      options: {},
      result: null,
      timers: {},
    },
    seats: [],
    state: { rev },
    engine: {
      rev,
      seq: rev,
      table: 't1',
      game: { id: 'demo', version: 1 },
      seed: 'seed',
      rng: 0,
      status: 'active',
      phase: 'play',
      turn: null,
      round: null,
      timers: {},
      seats: [],
      options: {},
      result: null,
      reservations: {},
    },
    views: [],
    diagnostics: [],
    ...overrides,
  };
}

function summary(id: string, overrides: Partial<DevTableSummary> = {}): DevTableSummary {
  return {
    id,
    game: 'demo',
    status: 'active',
    rev: 0,
    seats: { taken: 0, total: 2 },
    connections: 0,
    createdAt: 0,
    dev: false,
    faulted: false,
    ...overrides,
  };
}

const base = { draws: [] as number[] };

/** En and em dashes, written as escapes so this file stays free of them. */
const DASHES = new RegExp('[\\u2013\\u2014]');

function run(state: AppState, ...actions: AppAction[]): AppState {
  return actions.reduce(reducer, state);
}

const openState = (): AppState =>
  run(initialState({ kind: 'open' }), { type: 'navigate', page: { kind: 'table', id: 't1' } });

// ---------------------------------------------------------------------------------

describe('diffJson', () => {
  it('reports nothing without a baseline or when equal', () => {
    expect(diffJson(undefined, { a: 1 })).toBe(EMPTY_DIFF);
    const diff = diffJson({ a: [1, { b: null }] }, { a: [1, { b: null }] });
    expect(diff.changes.size).toBe(0);
    expect(diff.touched.size).toBe(0);
  });

  it('finds changed, added and removed paths and marks every ancestor', () => {
    const diff = diffJson(
      { players: [{ name: 'Ada', chips: 10 }], phase: 'bet', gone: true },
      {
        players: [
          { name: 'Ada', chips: 15 },
          { name: 'Bob', chips: 5 },
        ],
        phase: 'bet',
        extra: 1,
      },
    );
    expect(Object.fromEntries(diff.changes)).toEqual({
      '/players/0/chips': 'changed',
      '/players/1': 'added',
      '/gone': 'removed',
      '/extra': 'added',
    });
    expect([...diff.touched].sort()).toEqual([
      '',
      '/extra',
      '/players',
      '/players/0',
      '/players/0/chips',
      '/players/1',
    ]);
    expect(diff.removed.get('')).toEqual([{ key: 'gone', value: true }]);
  });

  it('treats a type change as a change of the whole subtree', () => {
    const diff = diffJson({ a: [1] }, { a: { 0: 1 } });
    expect(Object.fromEntries(diff.changes)).toEqual({ '/a': 'changed' });
    expect(diffJson({ a: null }, { a: 0 }).changes.get('/a')).toBe('changed');
  });

  it('records shrinking arrays as removed indexes', () => {
    const diff = diffJson([1, 2, 3], [1]);
    expect(Object.fromEntries(diff.changes)).toEqual({ '/1': 'removed', '/2': 'removed' });
    expect(diff.removed.get('')).toEqual([
      { key: '1', value: 2 },
      { key: '2', value: 3 },
    ]);
  });

  it('escapes JSON pointer tokens', () => {
    expect(escapeToken('a/b~c')).toBe('a~1b~0c');
    expect(childPath('/x', 'a/b')).toBe('/x/a~1b');
    expect(childPath('', 3)).toBe('/3');
    expect(diffJson({ 'a/b': 1 }, { 'a/b': 2 }).changes.has('/a~1b')).toBe(true);
  });
});

describe('format', () => {
  it('formats clocks, durations, deltas and countdowns', () => {
    expect(formatClock(new Date(2026, 0, 2, 3, 4, 5, 6).getTime())).toBe('03:04:05.006');
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(1234)).toBe('1.2 s');
    expect(formatDuration(185_000)).toBe('3 m 05 s');
    expect(formatDuration(7_620_000)).toBe('2 h 07 m');
    expect(formatDelta(120)).toBe('+120 ms');
    expect(formatDelta(-5)).toBe('+0 ms');
    expect(formatCountdown(10_000, 5_800)).toBe('4.2 s left');
    expect(formatCountdown(1_000, 2_000)).toBe('due 1.0 s ago');
  });

  it('truncates and previews JSON', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
    expect(previewJson({ a: 1 })).toBe('{"a":1}');
    expect(previewJson(undefined)).toBe('undefined');
    expect(previewJson({ long: 'x'.repeat(100) }, 10)).toHaveLength(10);
  });

  it('names and summarises every kind of log entry', () => {
    const entries: LogEntry[] = [
      {
        ...base,
        seq: 0,
        at: 0,
        kind: 'create',
        table: 't',
        game: 'g',
        version: 2,
        seed: 's',
        options: { a: 1 },
      },
      {
        ...base,
        seq: 1,
        at: 1,
        kind: 'action',
        name: 'bet',
        seat: 1,
        player: 'p1',
        input: { amount: 5 },
      },
      {
        ...base,
        seq: 2,
        at: 2,
        kind: 'timer',
        name: 'turn',
        action: 'autoStand',
        input: { seat: 0 },
      },
      { ...base, seq: 3, at: 3, kind: 'timer', name: 'tick', action: 'tick', input: null },
      {
        ...base,
        seq: 4,
        at: 4,
        kind: 'system',
        event: 'sit',
        seat: 0,
        player: { id: 'p0', name: 'Ada' },
      },
      { ...base, seq: 5, at: 5, kind: 'system', event: 'disconnect', seat: 0, player: 'p0' },
      { ...base, seq: 6, at: 6, kind: 'system', event: 'start', seat: null, player: null },
    ];
    expect(entries.map(entryName)).toEqual([
      'create',
      'bet',
      'turn (autoStand)',
      'tick',
      'sit',
      'disconnect',
      'start',
    ]);
    expect(entries.map(entrySeat)).toEqual([null, 1, null, null, 0, 0, null]);
    expect(entries.map((e) => entrySummary(e))).toEqual([
      'g v2, options {"a":1}',
      'p1: {"amount":5}',
      '{"seat":0}',
      'null',
      'Ada (p0)',
      'p0',
      '',
    ]);
  });

  it('makes safe fixture file names', () => {
    expect(fixtureFileName('dev_ab/c d', 12)).toBe('dev_ab_c_d-seq12.fixture.json');
  });

  it('never uses an em-dash in UI text', () => {
    expect(formatCountdown(0, 1)).not.toMatch(DASHES);
  });
});

describe('location', () => {
  it('reads the token from the fragment', () => {
    expect(tokenFromHash('#token=abc')).toBe('abc');
    expect(tokenFromHash('#table=t1&token=a%2Bb')).toBe('a+b');
    expect(tokenFromHash('')).toBeNull();
    expect(tokenFromHash('#token=')).toBeNull();
    expect(hashWithoutToken('#token=abc&table=t1')).toBe('#table=t1');
    expect(hashWithoutToken('#token=abc')).toBe('');
  });

  it('clears the token from the address bar and keeps it in history state only', () => {
    const replaceState = vi.fn();
    const history = { state: { other: 1 } as unknown, replaceState };
    const token = takeToken(
      {
        protocol: 'http:',
        host: 'h:1',
        pathname: '/__shoehive/',
        search: '',
        hash: '#token=xyz&table=t9',
      },
      history,
    );
    expect(token).toBe('xyz');
    expect(replaceState).toHaveBeenCalledWith(
      { other: 1, [TOKEN_STATE_KEY]: 'xyz' },
      '',
      '/__shoehive/#table=t9',
    );
    const url = replaceState.mock.calls[0]![2] as string;
    expect(url).not.toContain('xyz');

    // After a reload the fragment is gone; the history entry still has it.
    const again = takeToken(
      { protocol: 'http:', host: 'h:1', pathname: '/__shoehive/', search: '', hash: '' },
      { state: { [TOKEN_STATE_KEY]: 'xyz' }, replaceState },
    );
    expect(again).toBe('xyz');
    expect(
      takeToken(
        { protocol: 'http:', host: 'h', pathname: '/', search: '', hash: '' },
        { state: null, replaceState },
      ),
    ).toBeNull();
  });

  it('derives the socket URL from the page location', () => {
    expect(basePath('/__shoehive/')).toBe('/__shoehive');
    expect(basePath('/__shoehive/index.html')).toBe('/__shoehive');
    expect(basePath('/tools/inspect')).toBe('/tools/inspect');
    expect(socketUrl({ protocol: 'http:', host: 'localhost:3000', pathname: '/__shoehive/' })).toBe(
      'ws://localhost:3000/__shoehive/ws',
    );
    expect(socketUrl({ protocol: 'https:', host: 'example.com', pathname: '/x/' })).toBe(
      'wss://example.com/x/ws',
    );
  });

  it('round-trips pages through the fragment', () => {
    for (const page of [
      { kind: 'home' } as const,
      { kind: 'sessions' } as const,
      { kind: 'table', id: 'dev_a&b' } as const,
    ]) {
      expect(pageFromHash(hashForPage(page))).toEqual(page);
    }
  });
});

describe('reducer', () => {
  it('keeps the previous live revision as the highlight baseline', () => {
    let state = run(openState(), { type: 'detail', detail: detail(1) });
    expect(state.liveBase).toBeNull();
    state = run(state, { type: 'detail', detail: detail(2) });
    expect(state.liveBase?.rev).toBe(1);
    // Same rev (a connection change): the baseline stays.
    state = run(state, { type: 'detail', detail: detail(2, { seats: [] }) });
    expect(state.liveBase?.rev).toBe(1);
    // Details of other tables and replayed details are ignored.
    expect(run(state, { type: 'detail', detail: detail(9, { id: 'other' }) })).toBe(state);
    expect(run(state, { type: 'detail', detail: detail(9, { replayed: true }) })).toBe(state);
  });

  it('resets table state on navigation', () => {
    const state = run(
      openState(),
      { type: 'detail', detail: detail(3) },
      { type: 'seek', seq: 1 },
      { type: 'navigate', page: { kind: 'sessions' } },
    );
    expect(state.live).toBeNull();
    expect(state.replay).toBeNull();
    expect(state.page).toEqual({ kind: 'sessions' });
  });

  it('time travels: clamps, ignores stale results and diffs against what was shown', () => {
    let state = run(openState(), { type: 'detail', detail: detail(5) });
    state = run(state, { type: 'seek', seq: 99 });
    expect(state.replay?.seq).toBe(5);
    state = run(state, { type: 'seek', seq: -3 }, { type: 'seek', seq: 3 });
    expect(state.replay).toMatchObject({ seq: 3, loading: true, shown: null });
    // While loading, the live detail stays on screen.
    expect(shownDetail(state)?.rev).toBe(5);

    // A late result for an older seek is dropped.
    expect(run(state, { type: 'replayed', seq: 0, detail: detail(0, { replayed: true }) })).toBe(
      state,
    );

    state = run(state, { type: 'replayed', seq: 3, detail: detail(3, { replayed: true }) });
    expect(shownDetail(state)?.rev).toBe(3);
    expect(baseDetail(state)?.rev).toBe(5);

    state = run(
      state,
      { type: 'seek', seq: 2 },
      { type: 'replayed', seq: 2, detail: detail(2, { replayed: true }) },
    );
    expect(shownDetail(state)?.rev).toBe(2);
    expect(baseDetail(state)?.rev).toBe(3);

    // Live updates keep arriving while replaying; the replay stays on screen.
    state = run(state, { type: 'detail', detail: detail(6) });
    expect(shownDetail(state)?.rev).toBe(2);
    expect(state.live?.rev).toBe(6);

    state = run(state, { type: 'replay-error', seq: 2, message: 'boom' });
    expect(state.replay?.error).toBe('boom');

    state = run(state, { type: 'live' });
    expect(state.replay).toBeNull();
    expect(shownDetail(state)?.rev).toBe(6);
    expect(baseDetail(state)?.rev).toBe(5);
  });

  it('records closed tables and watch errors for the open table only', () => {
    let state = run(openState(), { type: 'closed', table: 'x', reason: 'r' });
    expect(state.closed).toBeNull();
    state = run(
      state,
      { type: 'closed', table: 't1', reason: 'idle' },
      { type: 'watch-error', table: 't1', message: 'm' },
    );
    expect(state.closed).toBe('idle');
    expect(state.watchError).toBe('m');
  });
});

describe('tables list', () => {
  it('filters and sorts', () => {
    const tables = [
      summary('a', { createdAt: 1, game: 'holdem' }),
      summary('dev_b', { createdAt: 3, dev: true }),
      summary('c', { createdAt: 2, faulted: true, status: 'ended' }),
    ];
    expect(sortTables(tables).map((t) => t.id)).toEqual(['dev_b', 'c', 'a']);
    expect(filterTables(tables, 'HOLD').map((t) => t.id)).toEqual(['a']);
    expect(filterTables(tables, 'dev').map((t) => t.id)).toEqual(['dev_b']);
    expect(filterTables(tables, 'faulted').map((t) => t.id)).toEqual(['c']);
    expect(filterTables(tables, 'ended').map((t) => t.id)).toEqual(['c']);
    expect(filterTables(tables, '  ')).toHaveLength(3);
  });

  it('merges log pages by seq', () => {
    const e = (seq: number): LogEntry => ({
      ...base,
      seq,
      at: seq,
      kind: 'system',
      event: 'start',
      seat: null,
      player: null,
    });
    expect(mergeEntries([e(3), e(4)], [e(4), e(1), e(5)]).map((x) => x.seq)).toEqual([1, 3, 4, 5]);
  });
});

// ---------------------------------------------------------------------------------
// Socket client

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  onopen: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  onclose: ((ev: CloseEvent) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000): void {
    this.serverClose(code);
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
  serverClose(code: number): void {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const statuses: ConnStatus[] = [];
  const pushes: DevPush[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const welcomes: unknown[] = [];
  const client = new DevClient({
    url: 'ws://h/__shoehive/ws',
    token: 'secret',
    onStatus: (s) => statuses.push(s),
    onWelcome: (w) => welcomes.push(w),
    onPush: (p) => pushes.push(p),
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    random: () => 0.5,
    now: () => 1000,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  return { client, sockets, statuses, pushes, timers, welcomes };
}

const welcome = { t: 'auth.ok', welcome: { protocol: 1, production: false, games: [] } };

describe('DevClient', () => {
  it('computes capped exponential backoff with jitter', () => {
    expect(backoffDelay(0, () => 0.5)).toBe(500);
    expect(backoffDelay(1, () => 0.5)).toBe(1000);
    expect(backoffDelay(10, () => 0.5)).toBe(10_000);
    expect(backoffDelay(0, () => 0)).toBe(375);
    expect(backoffDelay(0, () => 1)).toBe(625);
  });

  it('authenticates first, then matches results to requests and forwards pushes', async () => {
    const { client, sockets, statuses, pushes, welcomes } = harness();
    client.connect();
    const socket = sockets[0]!;
    socket.open();
    expect(socket.sent[0]).toEqual({ t: 'auth', token: 'secret' });
    await expect(client.request({ t: 'tables.list' })).rejects.toMatchObject({
      code: 'DISCONNECTED',
    });

    socket.receive(welcome);
    expect(statuses.at(-1)).toEqual({ kind: 'open' });
    expect(welcomes).toHaveLength(1);

    const fork = client.request({ t: 'table.fork', table: 't1', seq: 3 });
    const at = client.request({ t: 'table.at', table: 't1', seq: 1 });
    const [, forkReq, atReq] = socket.sent as { id: string }[];
    expect(forkReq).toMatchObject({ t: 'table.fork', table: 't1', seq: 3 });
    socket.receive({
      t: 'result',
      id: atReq!.id,
      ok: false,
      error: { code: 'NOT_FOUND', message: 'gone' },
    });
    socket.receive({ t: 'result', id: forkReq!.id, ok: true, result: { table: 'dev_x' } });
    await expect(fork).resolves.toEqual({ table: 'dev_x' });
    const error = await at.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DevRequestError);
    expect(error).toMatchObject({ code: 'NOT_FOUND', message: 'gone' });

    socket.receive({ t: 'tables', tables: [] });
    socket.receive({ t: 'table.closed', table: 't1', reason: 'idle' });
    socket.onmessage?.({ data: 'not json' } as MessageEvent);
    expect(pushes.map((p) => p.t)).toEqual(['tables', 'table.closed']);
  });

  it('reconnects with backoff and fails pending requests on a drop', async () => {
    const { client, sockets, statuses, timers } = harness();
    client.connect();
    sockets[0]!.open();
    sockets[0]!.receive(welcome);
    const pending = client.request({ t: 'sessions.list' });
    sockets[0]!.serverClose(1006);
    await expect(pending).rejects.toMatchObject({ code: 'DISCONNECTED' });
    expect(statuses.at(-1)).toEqual({ kind: 'waiting', attempt: 1, retryAt: 1500, code: 1006 });
    expect(timers[0]!.ms).toBe(500);
    timers[0]!.fn();
    expect(sockets).toHaveLength(2);
    sockets[1]!.serverClose(1006);
    expect(timers[1]!.ms).toBe(1000);
  });

  it('stops on UNAUTHORIZED and LOCKED_OUT, and on a protocol mismatch', () => {
    const a = harness();
    a.client.connect();
    a.sockets[0]!.open();
    a.sockets[0]!.serverClose(DEVTOOLS_CLOSE.UNAUTHORIZED);
    expect(a.statuses.at(-1)).toEqual({ kind: 'unauthorized' });
    expect(a.timers).toHaveLength(0);

    const b = harness();
    b.client.connect();
    b.sockets[0]!.serverClose(DEVTOOLS_CLOSE.LOCKED_OUT);
    expect(b.statuses.at(-1)).toEqual({ kind: 'locked-out', since: 1000 });
    expect(b.timers).toHaveLength(0);
    // A manual retry opens a new socket.
    b.client.connect();
    expect(b.sockets).toHaveLength(2);

    const c = harness();
    c.client.connect();
    c.sockets[0]!.open();
    c.sockets[0]!.receive({ t: 'auth.ok', welcome: { protocol: 2, production: false, games: [] } });
    expect(c.statuses.at(-1)).toEqual({ kind: 'mismatch', server: 2 });
    expect(c.timers).toHaveLength(0);
  });

  it('describes every status without em-dashes', () => {
    const all: ConnStatus[] = [
      { kind: 'no-token' },
      { kind: 'connecting', attempt: 0 },
      { kind: 'connecting', attempt: 2 },
      { kind: 'open' },
      { kind: 'waiting', attempt: 1, retryAt: 3000, code: 1006 },
      { kind: 'unauthorized' },
      { kind: 'locked-out', since: 0 },
      { kind: 'mismatch', server: 2 },
    ];
    const texts = all.map((s) => statusText(s, 1000).text);
    expect(texts[4]).toBe('Disconnected, retrying in 2.0 s');
    for (const text of texts) expect(text).not.toMatch(DASHES);
  });
});

// ---------------------------------------------------------------------------------
// Rendering

describe('JsonTree', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders values, highlights changes and lists removed keys', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const before = { a: 1, b: { c: 'x' }, d: true };
    const after = { a: 2, b: { c: 'x' }, e: null };
    render(
      h(JsonTree, {
        value: after,
        diff: diffJson(before, after),
        label: 'State',
        baseLabel: 'since rev 1',
      }),
      root,
    );
    expect(root.querySelector('.change-count')?.textContent).toBe('3 changes since rev 1');
    const changed = [...root.querySelectorAll('.ch-changed')].map((el) => el.textContent);
    expect(changed).toEqual(['a: 2 (changed)']);
    expect(root.querySelector('.ch-added')?.textContent).toBe('e: null (added)');
    expect(root.querySelector('.ch-removed')?.textContent).toContain('d');
    // Containers are buttons with aria-expanded, so they work from the keyboard.
    const toggle = [...root.querySelectorAll('button.twisty')].find((b) =>
      b.textContent.startsWith('▾b'),
    );
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    // Text is escaped, never parsed as markup.
    render(
      h(JsonTree, {
        value: { name: '<img src=x onerror=alert(1)>' },
        diff: EMPTY_DIFF,
        label: 'x',
      }),
      root,
    );
    expect(root.querySelector('img')).toBeNull();
  });
});

// Phase 8 security review (docs/security/review-1.0-platform.md): player names, game
// state and error messages come from clients and game code, so they must stay text.
describe('untrusted strings in the inspector', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });
  const evil = '<img src=x onerror="globalThis.pwned=1"><script>globalThis.pwned=1</script>';

  it('renders player names and diagnostic messages as text', () => {
    const root = document.createElement('div');
    document.body.append(root);
    render(
      h('div', null, [
        h(SeatsCard, {
          key: 'seats',
          seats: [{ status: 'occupied', player: { id: evil, name: evil }, connected: true }],
        }),
        h(DiagnosticsCard, {
          key: 'diag',
          replaying: false,
          diagnostics: [{ at: 0, name: evil, seat: 0, player: evil, code: 'X', message: evil }],
        }),
      ]),
      root,
    );
    expect(root.querySelector('img, script')).toBeNull();
    expect(root.textContent).toContain(evil);
  });

  it('never renders a JSON value shaped like a Preact vnode as an element', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const state = JSON.parse(
      '{"type":"img","props":{"src":"x","onerror":"globalThis.pwned=1"},"__k":null,"__":null,"constructor":null}',
    ) as Record<string, unknown>;
    render(
      h(JsonTree, { value: { state, list: [state] }, diff: EMPTY_DIFF, label: 'State' }),
      root,
    );
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('onerror');
  });
});
