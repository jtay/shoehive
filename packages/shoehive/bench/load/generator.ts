// A load-generator process: opens real `ws` sockets that speak protocol v1 through
// `shoehive/client`, sets up its share of the Hold'em tables, then plays them at the
// configured rate and measures action-to-patch latency on the client side.
//
// Every seat of a table lives in the same generator, so the acting client and the
// other seats share one clock and fan-out latency needs no cross-process clock sync.

import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import {
  createClient,
  type ShoehiveClient,
  type TableHandle,
  type WebSocketLike,
} from '../../src/client/index';
import { isShoehiveError } from '../../src/index';
import type { holdem } from '../../../../examples/holdem/src/game';
import {
  emptyCounters,
  loopStats,
  round,
  type Counters,
  type FromGenerator,
  type Samples,
  type SetupReport,
  type ToGenerator,
} from './shared';

type Holdem = typeof holdem;
type Client = ShoehiveClient<readonly [Holdem]>;
type Handle = TableHandle<Holdem>;

const STREETS = new Set(['preflop', 'flop', 'turn', 'river']);

interface Seat {
  client: Client;
  handle: Handle;
  seat: number;
}

interface Pending {
  t0: number;
  /** The acting client's revision when the action was sent. */
  baseRev: number;
  actor: number;
  got: boolean[];
  count: number;
  /** Acting client: time to its first document past `baseRev`, and that rev. */
  actorMs: number | null;
  actorRev: number;
  measured: boolean;
}

interface Table {
  id: string;
  seats: Seat[];
  /** Earliest time (performance.now()) the next action may be sent. */
  nextAt: number;
  timer: NodeJS.Timeout | null;
  inFlight: boolean;
  pending: Pending | null;
  /** After a game rejection: play the passive option next. */
  passive: boolean;
}

function send(message: FromGenerator): void {
  process.send!(message);
}

export async function runGenerator(): Promise<void> {
  const init = await new Promise<Extract<ToGenerator, { type: 'init' }>>((resolve) => {
    const onInit = (message: ToGenerator): void => {
      if (message.type !== 'init') return;
      process.off('message', onInit);
      resolve(message);
    };
    process.on('message', onInit);
  });
  const { config, url } = init;
  const counters = emptyCounters();
  let progress = emptyCounters();
  const samples: Samples = { actToPatch: [], actToAck: [], fanout: [], fanoutAll: [] };
  let running = false; // set up: no actions; true while playing
  let measuring = false;
  let settingUp = true;
  const interval = 1000 / config.rate;

  const count = (key: Exclude<keyof Counters, 'nacks'>, n = 1): void => {
    counters[key] += n;
    progress[key] += n;
  };
  const nack = (code: string): void => {
    counters.nacks[code] = (counters.nacks[code] ?? 0) + 1;
    progress.nacks[code] = (progress.nacks[code] ?? 0) + 1;
  };

  /** A `ws` socket in the shape the client expects, with message and close accounting. */
  const connect = (target: string): WebSocketLike => {
    const ws = new WebSocket(target, 'shoehive.v1', { perMessageDeflate: false });
    const like: WebSocketLike = {
      get readyState() {
        return ws.readyState;
      },
      send: (data) => {
        ws.send(data);
      },
      close: (code, reason) => {
        ws.close(code, reason);
      },
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    ws.on('open', () => like.onopen?.({}));
    ws.on('message', (data: Buffer) => {
      const text = data.toString();
      if (!settingUp) {
        count('messages');
        count('bytes', text.length);
        if (text.startsWith('{"t":"table.snapshot"')) count('snapshots');
      }
      like.onmessage?.({ data: text });
    });
    ws.on('close', (code, reason) => {
      if (!settingUp) count('closes');
      like.onclose?.({ code, reason: reason.toString() });
    });
    ws.on('error', () => {
      count('socketErrors');
    });
    return like;
  };

  // -------------------------------------------------------------------------------
  // Setup

  const setup: SetupReport = { connectMs: [], tableMs: [], errors: [] };
  const tables: Table[] = [];
  const options = { smallBlind: 5, bigBlind: 10, buyIn: 1_000_000, turnMs: config.turnMs };

  const setUpTable = async (index: number): Promise<void> => {
    const clients: Client[] = [];
    await Promise.all(
      Array.from({ length: config.players }, async (_, i) => {
        const client = createClient<readonly [Holdem]>({
          url,
          name: `t${String(index)}s${String(i)}`,
          storage: false,
          reconnect: false,
          autoConnect: false,
          requestTimeoutMs: 60_000,
          connect,
        });
        clients[i] = client;
        const t = performance.now();
        await client.connect();
        setup.connectMs.push(performance.now() - t);
      }),
    );
    const t = performance.now();
    const id = await clients[0]!.createTable('holdem', options);
    const handles = await Promise.all(clients.map((c) => c.join<Holdem>(id)));
    for (let i = 0; i < handles.length; i++) await handles[i]!.sit(i);
    setup.tableMs.push(performance.now() - t);
    const table: Table = {
      id,
      seats: handles.map((handle, i) => ({ client: clients[i]!, handle, seat: i })),
      nextAt: 0,
      timer: null,
      inFlight: false,
      pending: null,
      passive: false,
    };
    tables.push(table);
    table.seats.forEach((s, i) => {
      s.handle.subscribe(() => {
        onDocument(table, i);
      });
    });
    table.seats[0]!.handle.on('action', ({ payload }) => {
      // Hands start while later tables are still being set up, and nobody acts before
      // 'start': only count turns that time out during play.
      if (!settingUp && (payload as { timeout?: boolean }).timeout) count('turnTimeouts');
    });
    table.seats[0]!.handle.on('handStart', () => {
      if (!settingUp) count('hands');
    });
  };

  // -------------------------------------------------------------------------------
  // Play

  const onDocument = (table: Table, index: number): void => {
    const now = performance.now();
    const p = table.pending;
    const handle = table.seats[index]!.handle;
    if (p && !p.got[index] && handle.rev > p.baseRev) {
      p.got[index] = true;
      p.count += 1;
      const ms = now - p.t0;
      if (index === p.actor) {
        p.actorMs = ms;
        p.actorRev = handle.rev;
      } else if (p.measured) {
        samples.fanout.push(ms);
      }
      if (p.count === table.seats.length && p.measured) samples.fanoutAll.push(ms);
    }
    schedule(table);
  };

  /** The seat whose turn it is, judged by that seat's own document. */
  const actorOf = (table: Table): number | null => {
    for (let i = 0; i < table.seats.length; i++) {
      const doc = table.seats[i]!.handle.doc;
      if (
        doc?.meta.status === 'active' &&
        doc.meta.turn?.seat === i &&
        STREETS.has(doc.meta.phase ?? '')
      ) {
        return i;
      }
    }
    return null;
  };

  const schedule = (table: Table): void => {
    if (!running || table.inFlight || table.timer !== null) return;
    if (actorOf(table) === null) return;
    const delay = Math.max(0, table.nextAt - performance.now());
    table.timer = setTimeout(() => {
      table.timer = null;
      act(table);
    }, delay);
  };

  /** A plausible betting policy: mostly check and call, some bets, raises and folds. */
  const decide = (table: Table, actor: number): { name: string; input?: { amount: number } } => {
    const view = table.seats[actor]!.handle.view;
    const me = view.seats[actor]!;
    const toCall = view.currentBet - me.bet;
    const canRaise = me.bet + me.stack > view.minRaiseTo;
    const r = table.passive ? 1 : Math.random();
    table.passive = false;
    if (toCall <= 0) {
      return r < 0.15 && canRaise
        ? { name: 'bet', input: { amount: view.minRaiseTo } }
        : { name: 'check' };
    }
    if (r < 0.1) return { name: 'fold' };
    if (r < 0.18 && canRaise) return { name: 'raise', input: { amount: view.minRaiseTo } };
    return { name: 'call' };
  };

  const act = (table: Table): void => {
    if (!running || table.inFlight) return;
    const actor = actorOf(table);
    if (actor === null) return;
    const { name, input } = decide(table, actor);
    const seat = table.seats[actor]!;
    if (table.pending && table.pending.count < table.seats.length) count('fanoutIncomplete');
    const t0 = performance.now();
    const pending: Pending = {
      t0,
      baseRev: seat.handle.rev,
      actor,
      got: table.seats.map(() => false),
      count: 0,
      actorMs: null,
      actorRev: -1,
      measured: measuring,
    };
    table.pending = pending;
    table.inFlight = true;
    table.nextAt = t0 + interval;
    count('acts');
    const request =
      input === undefined
        ? seat.handle.act(name as 'check')
        : seat.handle.act(name as 'bet', input);
    request.then(
      ({ rev }) => {
        const ms = performance.now() - t0;
        count('acked');
        if (pending.actorMs === null || pending.actorRev < rev) count('ackBeforePatch');
        else if (pending.measured) samples.actToPatch.push(pending.actorMs);
        if (pending.measured) samples.actToAck.push(ms);
        table.inFlight = false;
        schedule(table);
      },
      (error: unknown) => {
        nack(isShoehiveError(error) ? error.code : 'UNKNOWN');
        table.passive = true;
        table.inFlight = false;
        schedule(table);
      },
    );
  };

  // -------------------------------------------------------------------------------
  // Run

  const loop = monitorEventLoopDelay({ resolution: 1 });
  let cpuStart = process.cpuUsage();
  let measureStart = 0;
  let stopped: (() => void) | null = null;
  const stoppedPromise = new Promise<void>((resolve) => {
    stopped = resolve;
  });

  process.on('message', (message: ToGenerator) => {
    switch (message.type) {
      case 'start': {
        settingUp = false;
        running = true;
        const now = performance.now();
        // Spread the tables' first actions over one interval so they do not move in step.
        for (const table of tables) {
          table.nextAt = now + Math.random() * interval;
          schedule(table);
        }
        break;
      }
      case 'measure':
        measuring = true;
        measureStart = performance.now();
        loop.reset();
        loop.enable();
        cpuStart = process.cpuUsage();
        break;
      case 'stop':
        stopped?.();
        break;
      default:
        break;
    }
  });

  const progressTimer = setInterval(() => {
    send({ type: 'progress', counters: progress });
    progress = emptyCounters();
  }, 1000);

  // Set up `concurrency` tables at a time.
  const queue = [...init.tables];
  await Promise.all(
    Array.from({ length: Math.min(config.concurrency, queue.length) }, async () => {
      for (let index = queue.shift(); index !== undefined; index = queue.shift()) {
        try {
          await setUpTable(index);
        } catch (error) {
          setup.errors.push(
            `table ${String(index)}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }),
  );
  send({ type: 'ready', setup });

  await stoppedPromise;
  measuring = false;
  const measuredMs = performance.now() - measureStart;
  loop.disable();
  const cpu = process.cpuUsage(cpuStart);
  const stats = {
    cpuPercent: round(((cpu.user + cpu.system) / 1000 / measuredMs) * 100, 1),
    rssMb: round(process.memoryUsage.rss() / 2 ** 20, 1),
    loop: loopStats(loop, 1),
  };
  running = false;
  for (const table of tables) if (table.timer !== null) clearTimeout(table.timer);
  // Let in-flight actions settle so their samples are complete.
  await new Promise((resolve) => setTimeout(resolve, 500));
  clearInterval(progressTimer);
  send({ type: 'result', samples, counters, stats, measuredMs });
}
