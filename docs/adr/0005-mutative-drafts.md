# ADR 0005: Mutative drafts with atomic commit

|         |                                                                     |
| ------- | ------------------------------------------------------------------- |
| Status  | Accepted, 2026-11-14                                                |
| Related | RFC 0001 sections 4 (invariants), 5.1, 7, 13; ADRs 0001, 0003, 0006 |

## Context

RFC 0001 requires that "a failed action rolls back completely". Game rules are full of
early exits (`reject('CELL_TAKEN')` after half the bookkeeping is done), and authors
write them most naturally as plain mutation: `state.board[cell] = 'X'`. We need
mutation ergonomics with transactional semantics, plus cheap structural sharing so the
view diff (ADR 0003) can skip unchanged subtrees with `===`.

RFC 0001 section 7 allows exactly one core dependency, and names Mutative.

## Decision

Every queue entry (action, hook, timer firing, system event) runs against a Mutative
draft of the committed state.

```ts
// Engine internals, simplified. Uses Mutative's manual mode so the draft can live
// across awaits in an async action.
const [draft, finalize] = create(committed, { enableAutoFreeze: isDev });
const tx = beginTx(engineState); // phase, turn, round, timers, rng cursor, emits, wallet ops
try {
  const result = await def.run({ state: draft, seat, input, ctx: tx.ctx });
  committed = finalize(); // new immutable state, structurally shared
  engineState = tx.commit();
  return result;
} catch (err) {
  tx.discard(); // draft is dropped unfinalized; nothing applied
  throw err;
}
```

1. **One draft per entry.** Hooks triggered inside an entry (for example `onExit` and
   `onEnter` from `ctx.phase.go()`, or `onEnd` from `ctx.end()`) run on the same draft
   in the same transaction, in a fixed order: the action body, then `onExit` of the old
   phase, then `onEnter` of the new one. If any of them throws, the whole entry rolls back.
2. **Engine state rides the same transaction.** `ctx` changes are buffered in `tx` and
   applied only on commit (ADR 0001 rule 2). The RNG cursor is part of it, so a rolled
   back action also "un-draws" its random numbers (ADR 0006).
3. **Frozen committed state in dev.** When `NODE_ENV !== 'production'`, Mutative's auto
   freeze is on. Mutating committed state (in `view`, in a test, or by keeping a
   reference to the draft after `run` returns) throws a `TypeError` immediately. In
   production, freezing is off for speed.
4. **Plain data only.** State must be JSON-compatible: plain objects, arrays, strings,
   finite numbers, booleans, `null`. No `Map`, `Set`, `Date`, class instances or
   `undefined` values in arrays. Snapshots are stored as JSON (ADR 0009) and views must be
   JSON (ADR 0003), so allowing richer types in state only moves the failure later. In
   dev the engine validates the committed state after each commit and names the
   offending path. In production the check is skipped.
5. **Draft escape is an error.** Returning the draft from `run`, or stashing it in a
   closure that runs later, is detected in dev (Mutative throws on access to a revoked
   draft) and documented.
6. **No `return newState`.** `run` returns `void` or an ack result (ADR 0001 rule 7),
   never a replacement state. Replacing the root is done by assigning its fields.
   `setup` is the one place that returns a fresh state object.
7. **Benchmark gate.** Phase 1 includes a benchmark of a Hold'em betting action
   (draft, commit, nine views, nine diffs). If Mutative is not the bottleneck under the
   RFC 0001 section 12 Phase 8 target (p95 action-to-patch under 20 ms), no further tuning is done.

## Consequences

### Positive

- Authors write obvious mutation code and get rollback for free.
- Structural sharing makes view diffs cheap (ADR 0003) and keeps per-commit memory low.
- Dev freezing turns a whole class of "who mutated my state?" bugs into immediate,
  located errors.
- Plain-data state makes snapshots, fixtures and devtools display trivial.

### Negative

- Drafts are proxies. Debuggers show proxy objects, and `console.log(draft)` is noisy.
  We ship a `current(draft)` re-export for logging.
- Behaviour differs between dev (frozen, validated) and production (neither). Bugs that
  only the checks catch must be caught in dev and tests. `shoehive/testing` always runs
  with checks on.
- Authors cannot use `Map` or `Set` in state, which some will find unnatural. Records
  keyed by string work for our four examples.
- We depend on one external library at the heart of the engine. Mutative is small, MIT
  licensed and actively maintained; we pin a minor range and cover it with property tests.

## Alternatives considered

### Immer

The well-known option with the same draft model. Rejected on performance: Mutative's
published benchmarks show it substantially faster than Immer for typical object and array
updates, especially with freezing enabled, and its API is close enough that the
mental model is identical. The per-commit cost matters because we run it for every
action on every table on one node.

### Return new state (reducer style)

`run` returns `{ ...state, board: newBoard }`. No dependency, and rollback is trivial
(ignore the return value). Rejected on ergonomics: nested updates in card games
(`hands[seat][i].faceUp`) become deep spread chains that are easy to get wrong, and
early-exit validation interleaved with partial updates is awkward. It also gives no
place to buffer `ctx` side effects as cleanly as a transaction around a draft.

### Deep clone, mutate, swap

Clone committed state, let `run` mutate the clone, swap on success. Rejected: cloning
the full state every action is wasteful, and it destroys structural sharing, so every
view diff would walk the whole tree.

### Mutable state with an undo log

Record each write and undo on failure. Rejected: it requires proxies anyway, which is
what Mutative already is, without the safety of immutable committed snapshots.
