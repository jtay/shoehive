import type { Clock, TimerHandle } from '../core/clock';

/** 2026-01-01T00:00:00Z, the default start time of a `FakeClock`. */
export const FAKE_EPOCH = Date.UTC(2026, 0, 1);

/**
 * A manual clock for tests (ADR 0006). Time only moves when you call `advance()`, and
 * timers fire in deadline order.
 */
export class FakeClock implements Clock {
  private time: number;
  private readonly timers = new Map<number, { at: number; fn: () => void }>();
  private nextId = 1;

  constructor(start: number = FAKE_EPOCH) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  setTimer(atMs: number, fn: () => void): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { at: atMs, fn });
    return id;
  }

  clearTimer(handle: TimerHandle): void {
    this.timers.delete(handle as number);
  }

  /** Number of timers waiting to fire. */
  get pendingTimers(): number {
    return this.timers.size;
  }

  /**
   * Moves time forward by `ms`, firing every timer that falls due on the way, in
   * deadline order. `settle` runs after each firing (the test table passes its
   * queue's `idle()`), so timers scheduled by fired timers are honoured too.
   */
  async advance(ms: number, settle: () => Promise<void> = () => Promise.resolve()): Promise<void> {
    if (!(ms >= 0)) throw new RangeError('advance(): ms must be >= 0');
    const target = this.time + ms;
    for (;;) {
      let nextId: number | undefined;
      let next: { at: number; fn: () => void } | undefined;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && (!next || timer.at < next.at)) {
          next = timer;
          nextId = id;
        }
      }
      if (!next || nextId === undefined) break;
      this.timers.delete(nextId);
      this.time = Math.max(this.time, next.at);
      next.fn();
      await settle();
    }
    this.time = target;
    await settle();
  }
}
