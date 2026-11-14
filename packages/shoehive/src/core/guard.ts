// Dev guard against ambient nondeterminism inside game code (ADR 0006, layer 2).
// While the synchronous part of game code runs, Math.random, Date.now and
// performance.now throw with a message pointing at the deterministic alternative.

const banned = (what: string, instead: string) => (): never => {
  throw new Error(`${what} is not allowed in game code (ADR 0006): use ${instead} instead.`);
};

const randomStub = banned('Math.random()', 'ctx.random');
const nowStub = banned('Date.now()', 'ctx.now()');
const perfStub = banned('performance.now()', 'ctx.now()');

let depth = 0;

/**
 * Runs `fn` with ambient randomness and time disabled. Only the synchronous part of
 * `fn` is covered: an async function is guarded up to its first `await`.
 */
export function guarded<T>(enabled: boolean, fn: () => T): T {
  if (!enabled || depth > 0) return fn();
  const savedRandom = Math.random;
  const savedNow = Date.now;
  const perf = globalThis.performance as { now: () => number } | undefined;
  const perfHadOwn = perf !== undefined && Object.prototype.hasOwnProperty.call(perf, 'now');
  const savedPerfNow = perf?.now;
  depth += 1;
  Math.random = randomStub;
  Date.now = nowStub;
  if (perf) perf.now = perfStub;
  try {
    return fn();
  } finally {
    depth -= 1;
    Math.random = savedRandom;
    Date.now = savedNow;
    if (perf) {
      if (perfHadOwn && savedPerfNow) perf.now = savedPerfNow;
      else delete (perf as { now?: () => number }).now;
    }
  }
}
