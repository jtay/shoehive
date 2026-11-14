import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineGame, reject, TableRuntime } from '../../src/index';
import { createTestTable } from '../../src/testing/index';

const counter = defineGame({
  id: 'counter',
  seats: { min: 1, max: 3 },
  setup: () => ({ n: 0, rolls: [] as number[], log: [] as string[] }),
  actions: {
    add: {
      input: z.object({ by: z.number().int() }),
      run({ state, input }) {
        state.n += input.by;
        return { n: state.n };
      },
    },
    roll: {
      run({ state, ctx }) {
        state.rolls.push(ctx.random.int(6) + 1);
      },
    },
    rollThenFail: {
      run({ state, ctx }) {
        state.rolls.push(ctx.random.int(6));
        ctx.emit('should-not-arrive');
        reject('NOPE', { why: 'testing' });
      },
    },
    crash: {
      run() {
        throw new Error('boom');
      },
    },
    cheat: {
      run({ state }) {
        state.n = Math.floor(Math.random() * 10);
      },
    },
    clock: {
      run({ state }) {
        state.n = Date.now();
      },
    },
    badState: {
      run({ state }) {
        (state as { n: unknown }).n = new Map();
      },
    },
    shout: {
      run({ ctx }) {
        ctx.emit('hello', { from: 'counter' }, { to: [0] });
      },
    },
    noInput: {
      run({ state }) {
        state.log.push('noInput');
      },
    },
  },
});

describe('TableRuntime: transactions', () => {
  it('commits, bumps rev and returns the action result', async () => {
    const t = await createTestTable(counter, { players: 1 });
    const rev = t.rev;
    expect(await t.act(0, 'add', { by: 2 })).toEqual({ n: 2 });
    expect(t.state.n).toBe(2);
    expect(t.rev).toBe(rev + 1);
  });

  it('rolls back state, random draws and events when the game rejects', async () => {
    const t = await createTestTable(counter, { players: 1 });
    const before = { state: t.state, engine: t.runtime.engine, log: t.log.length };
    await expect(t.act(0, 'rollThenFail')).rejects.toMatchObject({
      code: 'NOPE',
      source: 'game',
      details: { why: 'testing' },
    });
    expect(t.state).toBe(before.state);
    expect(t.runtime.engine).toBe(before.engine);
    expect(t.log.length).toBe(before.log);
    expect(t.events).toEqual([]);
    expect(t.runtime.diagnostics().at(-1)).toMatchObject({ name: 'rollThenFail', code: 'NOPE' });
  });

  it('a rejected action does not consume randomness', async () => {
    const a = await createTestTable(counter, { players: 1 });
    await expect(a.act(0, 'rollThenFail')).rejects.toBeDefined();
    await a.act(0, 'roll');
    const b = await createTestTable(counter, { players: 1 });
    await b.act(0, 'roll');
    expect(a.state.rolls).toEqual(b.state.rolls);
  });

  it('turns unexpected errors into INTERNAL and rolls back', async () => {
    const t = await createTestTable(counter, { players: 1 });
    await expect(t.act(0, 'crash')).rejects.toMatchObject({ code: 'INTERNAL', source: 'shoehive' });
    expect(t.state.n).toBe(0);
  });

  it('blocks Math.random and Date.now inside game code (dev guard)', async () => {
    const t = await createTestTable(counter, { players: 1 });
    await expect(t.act(0, 'cheat')).rejects.toThrow(/Math\.random\(\) is not allowed.*ctx\.random/);
    await expect(t.act(0, 'clock')).rejects.toThrow(/Date\.now\(\) is not allowed.*ctx\.now/);
    expect(typeof Math.random()).toBe('number');
  });

  it('rejects non-JSON state and names the path', async () => {
    const t = await createTestTable(counter, { players: 1 });
    await expect(t.act(0, 'badState')).rejects.toThrow(/instance of Map.*\/n/);
    expect(t.state.n).toBe(0);
  });

  it('freezes committed state in dev', async () => {
    const t = await createTestTable(counter, { players: 1 });
    expect(() => {
      (t.state as { n: number }).n = 5;
    }).toThrow(TypeError);
  });

  it('delivers events after commit, to their audience', async () => {
    const t = await createTestTable(counter, { players: 1 });
    await t.act(0, 'shout');
    expect(t.events).toEqual([
      { name: 'hello', payload: { from: 'counter' }, to: [0], rev: t.rev },
    ]);
  });

  it('rejects unknown actions, bad input, input for no-input actions, and stale revisions', async () => {
    const t = await createTestTable(counter, { players: 1 });
    await expect(t.runtime.act({ player: 'p0', name: 'nope' })).rejects.toMatchObject({
      code: 'ACTION_NOT_ALLOWED',
    });
    await expect(t.act(0, 'add', { by: 1.5 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      details: { issues: [{ path: ['by'] }] },
    });
    await expect(
      t.runtime.act({ player: 'p0', name: 'noInput', input: { x: 1 } }),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(
      t.runtime.act({ player: 'p0', name: 'add', input: { by: 1 }, rev: t.rev - 1 }),
    ).rejects.toMatchObject({ code: 'STALE_REVISION', details: { rev: t.rev } });
    await expect(
      t.runtime.act({ player: 'stranger', name: 'add', input: { by: 1 } }),
    ).rejects.toMatchObject({
      code: 'NOT_SEATED',
    });
  });

  it('validates table options', async () => {
    const withOptions = defineGame({
      id: 'opts',
      seats: { min: 1, max: 1 },
      options: z.object({ rounds: z.number().int().min(1).default(3) }),
      setup: ({ options }) => ({ rounds: options.rounds }),
    });
    const t = await createTestTable(withOptions, { options: {} });
    expect(t.state.rounds).toBe(3);
    await expect(createTestTable(withOptions, { options: { rounds: 0 } })).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
    await expect(createTestTable(counter, { options: { x: 1 } })).rejects.toMatchObject({
      code: 'INVALID_OPTIONS',
    });
  });
});

describe('TableRuntime: seats and lifecycle', () => {
  const lobbyGame = defineGame({
    id: 'lobby-game',
    seats: { min: 2, max: 4 },
    autoStart: false,
    setup: () => ({ ready: [] as number[], events: [] as string[] }),
    actions: {
      ready: {
        preStart: true,
        run({ state, seat, ctx }) {
          if (!state.ready.includes(seat)) state.ready.push(seat);
          if (state.ready.length === ctx.occupied.length && state.ready.length >= 2) ctx.start();
        },
      },
      poke: {
        run() {
          // no-op: only used to test NOT_STARTED
        },
      },
    },
    onSit: ({ state, seat }) => {
      state.events.push(`sit:${String(seat)}`);
    },
    onStand: ({ state, seat }) => {
      state.events.push(`stand:${String(seat)}`);
    },
    onDisconnect: ({ state, seat }) => {
      state.events.push(`disconnect:${String(seat)}`);
    },
    onReconnect: ({ state, seat }) => {
      state.events.push(`reconnect:${String(seat)}`);
    },
    onStart: ({ state }) => {
      state.events.push('start');
    },
  });

  it('waits for preStart actions when autoStart is false', async () => {
    const t = await createTestTable(lobbyGame, { players: 2 });
    expect(t.meta.status).toBe('waiting');
    await expect(t.act(0, 'poke')).rejects.toMatchObject({ code: 'NOT_STARTED' });
    await t.act(0, 'ready');
    await t.act(1, 'ready');
    expect(t.meta.status).toBe('active');
    expect(t.state.events).toEqual(['sit:0', 'sit:1', 'start']);
  });

  it('tracks seats through disconnects, reconnects and standing up', async () => {
    const t = await createTestTable(lobbyGame, { players: 2 });
    await t.disconnect(1);
    expect(t.seats[1]).toEqual({
      status: 'reserved',
      player: { id: 'p1', name: 'Player 2' },
      connected: false,
    });
    await t.reconnect(1);
    expect(t.seats[1]?.status).toBe('occupied');
    await t.stand(1);
    expect(t.seats[1]).toEqual({ status: 'empty', player: null, connected: false });
    expect(t.state.events).toEqual(['sit:0', 'sit:1', 'disconnect:1', 'reconnect:1', 'stand:1']);
  });

  it('enforces seat rules', async () => {
    const t = await createTestTable(lobbyGame, { players: 1 });
    await expect(t.runtime.sit({ seat: 0, player: { id: 'x', name: 'X' } })).rejects.toMatchObject({
      code: 'SEAT_TAKEN',
    });
    await expect(
      t.runtime.sit({ seat: 1, player: { id: 'p0', name: 'again' } }),
    ).rejects.toMatchObject({
      code: 'ALREADY_SEATED',
    });
    await expect(t.runtime.stand({ seat: 3 })).rejects.toMatchObject({ code: 'NOT_SEATED' });
    for (const id of ['a', 'b', 'c']) await t.runtime.sit({ player: { id, name: id } });
    await expect(t.runtime.sit({ player: { id: 'd', name: 'd' } })).rejects.toMatchObject({
      code: 'TABLE_FULL',
    });
  });
});

describe('TableRuntime: phases, turns and timers', () => {
  const phased = defineGame({
    id: 'phased',
    seats: { min: 3, max: 3 },
    setup: () => ({ trace: [] as string[], folded: [] as number[] }),
    actions: {
      fold: {
        run({ state, seat, ctx }) {
          state.folded.push(seat);
          ctx.turn.next();
        },
      },
    },
    phases: {
      deal: {
        onEnter: ({ state, ctx }) => {
          state.trace.push('enter:deal');
          ctx.phase.go('play');
          state.trace.push('after-go');
        },
        onExit: ({ state }) => {
          state.trace.push('exit:deal');
        },
      },
      play: {
        turns: {
          skip: ({ seat, state }) => (state as { folded: number[] }).folded.includes(seat),
          timeoutMs: 10_000,
          onTimeout: 'autoFold',
        },
        actions: {
          act: {
            run({ state, seat, ctx }) {
              if (ctx.turn.seat !== seat) reject('NOT_YOUR_TURN');
              state.trace.push(`act:${String(seat)}`);
              ctx.turn.next();
            },
          },
          autoFold: {
            internal: true,
            input: z.object({ seat: z.number() }),
            run({ state, input, ctx }) {
              state.trace.push(`timeout:${String(input.seat)}`);
              state.folded.push(input.seat);
              ctx.turn.next();
            },
          },
          finish: {
            run({ ctx }) {
              ctx.phase.go('done');
            },
          },
        },
        onEnter: ({ state }) => {
          state.trace.push('enter:play');
        },
      },
      done: {
        onEnter: ({ ctx }) => {
          ctx.end({ ok: true });
        },
      },
    },
  });

  it('runs phase hooks after the body, in order', async () => {
    const t = await createTestTable(phased, { players: 3 });
    expect(t.state.trace).toEqual(['enter:deal', 'after-go', 'exit:deal', 'enter:play']);
    expect(t.meta.phase).toBe('play');
    expect(t.meta.turn?.seat).toBe(0);
  });

  it('advances turns, skips folded seats and keeps phase actions in their phase', async () => {
    const t = await createTestTable(phased, { players: 3 });
    await t.act(0, 'act');
    await t.act(1, 'fold');
    expect(t.meta.turn?.seat).toBe(2);
    await t.act(2, 'act');
    expect(t.meta.turn?.seat).toBe(0); // 1 folded
    await expect(
      t.runtime.act({ player: 'p0', name: 'autoFold', input: { seat: 0 } }),
    ).rejects.toMatchObject({
      code: 'ACTION_NOT_ALLOWED',
    });
  });

  it('fires the turn timer and runs the internal action', async () => {
    const t = await createTestTable(phased, { players: 3 });
    expect(t.meta.turn?.deadline).toBe(t.clock.now() + 10_000);
    await t.advance(9_999);
    expect(t.state.trace).not.toContain('timeout:0');
    await t.advance(1);
    expect(t.state.trace).toContain('timeout:0');
    expect(t.meta.turn?.seat).toBe(1);
    await t.advance(20_000);
    expect(t.state.folded).toEqual([0, 1, 2]);
    expect(t.log.filter((e) => e.kind === 'timer')).toHaveLength(3);
    await t.verifyReplay();
  });

  it('a seat leaving on its turn passes the turn on', async () => {
    const t = await createTestTable(phased, { players: 3 });
    await t.stand(0);
    expect(t.meta.turn?.seat).toBe(1);
  });

  it('ends the table and cancels timers', async () => {
    const t = await createTestTable(phased, { players: 3 });
    await t.act(0, 'finish');
    expect(t.meta.status).toBe('ended');
    expect(t.meta.result).toEqual({ ok: true });
    expect(t.runtime.engine.timers).toEqual({});
    await expect(t.act(1, 'act')).rejects.toMatchObject({ code: 'TABLE_ENDED' });
  });
});

describe('TableRuntime: rounds', () => {
  const buzz = defineGame({
    id: 'buzz',
    seats: { min: 2, max: 3 },
    setup: () => {
      const answers: Record<string, number> = {};
      return { answers, closes: 0 };
    },
    rounds: {
      durationMs: 5_000,
      closeWhen: 'all-submitted',
      onClose: ({ state, ctx }) => {
        state.closes += 1;
        if (state.closes < 2) ctx.round.next();
      },
    },
    actions: {
      answer: {
        once: true,
        input: z.object({ choice: z.number() }),
        run({ state, seat, input }) {
          state.answers[String(seat)] = input.choice;
        },
      },
    },
  });

  it('closes in its own entry once everyone submitted, then opens the next round', async () => {
    const t = await createTestTable(buzz, { players: 2 });
    expect(t.meta.round).toMatchObject({ number: 1, submitted: [] });
    await t.act(0, 'answer', { choice: 1 });
    await expect(t.act(0, 'answer', { choice: 2 })).rejects.toMatchObject({
      code: 'ALREADY_SUBMITTED',
    });
    await t.act(1, 'answer', { choice: 3 });
    const kinds = t.log.slice(-2).map((e) => (e.kind === 'system' ? e.event : e.kind));
    expect(kinds).toEqual(['action', 'round-close']);
    expect(t.state.closes).toBe(1);
    expect(t.meta.round).toMatchObject({ number: 2, submitted: [] });
  });

  it('closes on timeout and rejects late submissions', async () => {
    const t = await createTestTable(buzz, { players: 2 });
    await t.act(0, 'answer', { choice: 1 });
    await t.advance(5_000);
    expect(t.state.closes).toBe(1);
    expect(t.meta.round?.number).toBe(2);
    await t.advance(5_000);
    expect(t.state.closes).toBe(2);
    await expect(t.act(1, 'answer', { choice: 1 })).rejects.toMatchObject({ code: 'ROUND_CLOSED' });
    await t.verifyReplay();
  });

  it('seats that sit down mid-round wait for the next round', async () => {
    const t = await createTestTable(buzz, { players: 2 });
    await t.sit(2);
    await expect(t.act(2, 'answer', { choice: 1 })).rejects.toMatchObject({
      code: 'NOT_PARTICIPANT',
    });
    await t.act(0, 'answer', { choice: 1 });
    await t.act(1, 'answer', { choice: 1 });
    expect(t.meta.round?.number).toBe(2);
    await t.act(2, 'answer', { choice: 1 });
  });
});

describe('TableRuntime: views', () => {
  const secretive = defineGame({
    id: 'secretive',
    seats: { min: 2, max: 2 },
    setup: ({ random }) => ({ hands: [[random.int(100)], [random.int(100)]] }),
    view: ({ state, viewer }) => ({
      mine: viewer.seat === null ? null : (state.hands[viewer.seat] ?? null),
      others: state.hands.map((h, seat) => (seat === viewer.seat ? null : h.length)),
    }),
  });

  it('computes a view per seat and one for spectators', async () => {
    const t = await createTestTable(secretive, { players: 2 });
    expect(t.viewOf(0)).toEqual({ mine: t.state.hands[0], others: [null, 1] });
    expect(t.viewOf(1)).toEqual({ mine: t.state.hands[1], others: [1, null] });
    expect(t.viewOf('spectator')).toEqual({ mine: null, others: [1, 1] });
    expect(t.viewOf(0)).toBe(t.viewOf(0)); // cached per revision
  });
});

describe('TableRuntime: replay and snapshots', () => {
  it('replays from a snapshot plus the log tail', async () => {
    const t = await createTestTable(counter, { players: 1 });
    await t.act(0, 'roll');
    const snap = t.runtime.snapshot();
    await t.act(0, 'roll');
    await t.act(0, 'add', { by: 5 });
    const copy = await TableRuntime.replay(counter, t.log, { from: snap, dev: true });
    expect(copy.state).toEqual(t.state);
    expect(copy.rev).toBe(t.rev);
  });

  it('replays up to a point (time travel)', async () => {
    const t = await createTestTable(counter, { players: 1 });
    await t.act(0, 'add', { by: 1 });
    const at = t.rev;
    await t.act(0, 'add', { by: 10 });
    const copy = await TableRuntime.replay(counter, t.log, { until: at, dev: true });
    expect((copy.state as { n: number }).n).toBe(1);
  });

  it('detects divergence when game code changed', async () => {
    const t = await createTestTable(counter, { players: 1 });
    await t.act(0, 'roll');
    const changed = defineGame({
      ...counter,
      actions: {
        ...counter.actions!,
        roll: {
          run({ state, ctx }) {
            state.rolls.push(ctx.random.int(6), ctx.random.int(6));
          },
        },
      },
    });
    await expect(TableRuntime.replay(changed, t.log, { dev: true })).rejects.toThrow(
      /Replay diverged at entry/,
    );
  });
});

describe('TableRuntime: values that came from the draft', () => {
  const leaky = defineGame({
    id: 'leaky',
    seats: { min: 1, max: 1 },
    setup: () => ({ hand: { cards: ['AS', 'KD'] }, fired: [] as string[][] }),
    actions: {
      go: {
        run({ state, ctx }) {
          ctx.emit('hand', state.hand);
          ctx.timers.after('later', 1000, 'later', state.hand);
          return state.hand;
        },
      },
      later: {
        internal: true,
        input: z.object({ cards: z.array(z.string()) }),
        run({ state, input, ctx }) {
          state.fired.push(input.cards);
          ctx.end({ hand: state.hand });
        },
      },
    },
  });

  it('copies results, event payloads, timer inputs and end results out of the draft', async () => {
    const t = await createTestTable(leaky, { players: 1 });
    expect(await t.act(0, 'go')).toEqual({ cards: ['AS', 'KD'] });
    expect(t.events[0]?.payload).toEqual({ cards: ['AS', 'KD'] });
    await t.advance(1000);
    expect(t.state.fired).toEqual([['AS', 'KD']]);
    expect(t.meta.result).toEqual({ hand: { cards: ['AS', 'KD'] } });
    expect(JSON.parse(JSON.stringify(t.log))).toEqual(t.log);
    await t.verifyReplay();
  });
});
