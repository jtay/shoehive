# ADR 0006: Seeded RNG, recorded clock and exact replay

|         |                                                                                                 |
| ------- | ----------------------------------------------------------------------------------------------- |
| Status  | Accepted, 2026-11-14                                                                            |
| Related | RFC 0001 sections 4 (invariants), 5.1, 5.5, 7, 13; audit finding 8; ADRs 0005, 0007, 0009, 0011 |

## Context

0.x shuffles with `Math.random` (finding 8): not seedable, so no replay and no
deterministic tests, and not cryptographically strong, which is unacceptable once
stakes are involved. RFC 0001 requires that the same seed and the same action log
replay to identical state, and builds three features on that one property: testing,
restart recovery and devtools time travel (RFC 0001 section 13).

## Decision

A table's state is a pure function of its **log**. Everything that can influence state
is either in the log or derived from something in it.

```ts
type LogEntry = { seq: number; at: number; draws: number[]; effects?: WalletResult[] } & (
  | { kind: 'create'; table: string; game: string; version: number; seed: string; options: Json }
  | { kind: 'action'; name: string; seat: number; player: string; input: Json }
  | { kind: 'timer'; name: string; action: string; input: Json }
  | {
      kind: 'system';
      event:
        'sit' | 'stand' | 'disconnect' | 'reconnect' | 'grace-expired' | 'start' | 'round-close';
      seat: number;
      player: string | null;
    }
);

interface Random {
  int(maxExclusive: number): number; // unbiased (rejection sampling)
  float(): number; // [0, 1), 53 bits
  shuffle<T>(items: readonly T[]): T[]; // Fisher-Yates
  pick<T>(items: readonly T[]): T;
}

interface Clock {
  now(): number; // epoch ms
  setTimer(atMs: number, fn: () => void): TimerHandle; // absolute deadline
  clearTimer(handle: TimerHandle): void;
}
```

1. **Generator.** `ctx.random` is a ChaCha20 keystream (RFC 8439 block function, 20
   rounds) keyed by a 256-bit seed, implemented in pure TypeScript in core (no Node
   `crypto`, per ADR 0002). It is cryptographically strong and deterministic given the
   seed. Output is consumed as 32-bit words.
2. **Seeds.** In production the seed is 32 bytes from `globalThis.crypto.getRandomValues`
   at table creation, stored hex encoded in the `create` entry. `createTestTable` takes
   `seed: string`; non-hex strings such as `'fixed'` are hashed with SHA-256 (pure TS) to
   256 bits. Every test gets a fixed seed by default (`'shoehive-test'`).
3. **Draws are recorded.** Each entry records the 32-bit words it consumed in `draws`.
   Replay regenerates the stream from the seed and compares word by word; the first
   mismatch is a `ReplayDivergenceError` naming the entry `seq`. The RNG cursor is part
   of the transaction (ADR 0005), so a rolled back action consumes nothing.
4. **Clock reads are recorded.** Each entry has `at`, taken from the injected `Clock`
   once when the entry starts. `ctx.now()` returns that `at` for the whole entry, so time
   cannot move inside an action. Replay feeds `at` back from the log.
5. **Timers.** `ctx.timers.after(name, ms, action, input?)` stores
   `{ name, deadline: at + ms, action, input }` in engine state (it is part of the
   snapshot). Reusing a name replaces the timer; `ctx.timers.cancel(name)` removes it.
   The runtime arms the real timer through `Clock.setTimer` after commit. A firing
   becomes a `timer` entry whose `at` is the actual processing time. Timer targets must
   be actions, normally `internal: true`.
6. **Other inputs.** Validated action input (output of the schema, ADR 0004), seat
   changes, connection events that game hooks observe, round closes and wallet results
   (ADR 0007, in `effects`) are all entries or fields of entries. Rejected actions are
   not in the log; they change nothing. They go to a per-table diagnostics ring buffer
   (last 500) for devtools.
7. **Replay** is one function used by three callers:

```ts
function replay(
  game: Game,
  entries: LogEntry[],
  opts?: { from?: Snapshot; until?: number },
): TableRuntime;
```

- `shoehive/testing`: `t.verifyReplay()` replays the test table's log and asserts
  state equality, and the property test suite does it for random action sequences.
- Recovery (ADR 0009): snapshot plus log tail.
- Devtools (ADR 0011): replay to any `seq` on a copy.

During replay, validators, the wallet, transports and real timers are not called.

8. **Banning ambient nondeterminism.** `Math.random`, `Date.now`, `new Date()`,
   `performance.now` and `crypto.getRandomValues` are banned inside game code, enforced
   in three layers:

- **Lint**: `create-shoehive` scaffolds an ESLint flat config block for `games/**`
  using built-in `no-restricted-properties` and `no-restricted-syntax`. No ESLint
  plugin and no new subpath is needed.
- **Dev guard**: outside production, and always in `shoehive/testing`, the engine
  swaps those globals for throwing stubs while it runs the synchronous part of game
  code (`setup`, `view`, hooks, sync actions, and an async action up to its first
  `await`), then restores them. The error says which function to use instead.
- **Replay check**: draw comparison catches code that bypassed both.

## Consequences

### Positive

- Tests are deterministic, including shuffles, timers and time-dependent rules.
- Restart recovery and time travel are the same code path as test replay, so the
  "replay equals state" property test covers all three (RFC 0001 section 13).
- A dispute about a hand can be answered by replaying its log.
- ChaCha20 is fast enough in JS (a 52-card shuffle is about 52 words) and strong.

### Negative

- **The seed is a secret.** Anyone who reads the store or the `create` entry can predict
  every future card at that table. The store must be protected like the server secret,
  and the seed is never in any view, event or ack. Devtools show it only behind the
  token (ADR 0011), and fixture export keeps it, so fixtures from production are secrets.
- Recorded draws grow the log by about 10 bytes of JSON per 32-bit word. For card
  games this is a few hundred bytes per hand.
- The dev guard cannot cover code after an `await` without patching globals across
  other tables' work, so that part relies on lint and the replay check.
- `ctx.now()` is constant within an entry, which surprises authors who expect it to tick.

## Alternatives considered

### Record only the seed, not draws

Smaller logs. Rejected: divergence would surface as "different state" far from the
cause. Recorded draws pinpoint the first divergent entry, which devtools and recovery
both need for a clear error.

### Use Node `crypto` directly for each draw

Strong, but not replayable and not isomorphic. Rejected.

### Fast non-crypto PRNG (xoshiro, mulberry32) everywhere

Rejected: with a non-crypto PRNG, observed outputs (visible cards) can reveal the
internal state and therefore future draws. Casino and poker examples need unpredictability.

### Global fake timers in tests

`vi.useFakeTimers()` instead of an injected `Clock`. Rejected: it fakes the whole
process, interacts badly with the test runner, and does not help recovery or devtools.
