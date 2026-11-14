/** An opaque handle returned by `Clock.setTimer` (a Node `Timeout`, a browser id, a fake id). */
export type TimerHandle = object | number;

/**
 * Time source for a table (ADR 0006). The runtime reads `now()` once per entry and
 * arms real timers through `setTimer`. Tests use `FakeClock` from `shoehive/testing`.
 */
export interface Clock {
  /** Current time, epoch milliseconds. */
  now(): number;
  /** Calls `fn` at (or soon after) the absolute time `atMs`. */
  setTimer(atMs: number, fn: () => void): TimerHandle;
  clearTimer(handle: TimerHandle): void;
}

/** The real clock, backed by `Date.now` and `setTimeout`. */
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimer: (atMs, fn) => {
    const handle = setTimeout(fn, Math.max(0, atMs - Date.now()));
    // Do not keep a Node process alive just for game timers.
    (handle as { unref?: () => void }).unref?.();
    return handle;
  },
  clearTimer: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};
