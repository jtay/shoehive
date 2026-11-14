# ADR 0003: Per-viewer views and JSON Patch sync

|         |                                                                          |
| ------- | ------------------------------------------------------------------------ |
| Status  | Accepted, 2026-11-14                                                     |
| Related | RFC 0001 sections 4 (invariants), 5.2, 6, 7, 13; audit findings 3, 4, 12 |

## Context

0.x syncs by broadcasting the full table state whenever a key from a hard-coded list
changes (findings 3, 12). Keys outside the list never sync. Hidden information is only
card `isVisible`; all player attributes reach everyone (finding 4). A poker game cannot
keep a hole card or a balance private.

RFC 0001 makes two invariants: clients receive only `view()` output, and applying a
viewer's patches in revision order reproduces the server's view exactly.

## Decision

**Views are the only thing sent.** After every commit, the engine computes the view
for each distinct viewer at the table and sends that viewer a diff against the view it
last sent. Raw state never leaves the server, not even to the seat that "owns" it.

```ts
type Viewer =
  | { kind: 'seat'; seat: number; seats: readonly number[]; playerId: string } // seat = first held seat
  | { kind: 'spectator'; seat: null; seats: readonly []; playerId: null }; // no player id, by design

interface TablePatch {
  t: 'table.patch';
  table: string;
  from: number;
  rev: number;
  ops: JsonPatchOp[];
}
interface TableSnapshot {
  t: 'table.snapshot';
  table: string;
  rev: number;
  doc: TableDocument; // { view, meta, seats, spectators, you }: see the protocol spec
}
```

1. **Viewer keys.** Each seated player is one viewer (keyed by player id, so a player
   holding several seats gets one view that knows all of them). All spectators share one
   viewer (`spectator`), so `view()` runs once for all of them, and they all receive the
   same serialized patch bytes. Spectators deliberately get no `playerId`, which
   guarantees the sharing. A player who is seated sees the seat view, never the
   spectator one. If `view` is omitted, every viewer shares one key and sees the state.
2. **Revisions.** Each table has one `rev`, an integer that starts at 0 on creation and
   increases by 1 on every commit. It never resets, including across restarts (it is in
   the snapshot, ADR 0009).
3. **Patches.** `ops` is RFC 6902 JSON Patch using only `add`, `remove` and `replace`.
   The diff is structural: objects by key, arrays by index (no `move` detection), with a
   `===` short-circuit so subtrees shared through Mutative's structural sharing cost
   nothing. A viewer whose view did not change gets no message for that commit.
4. **`from` field.** Because unchanged viewers are skipped, `table.patch` carries
   `from` (the rev of the last document sent to this viewer, which the patch applies on
   top of) as well as `rev`. The protocol spec records it. The client applies a patch
   only if its current rev equals `from`.
5. **Snapshots.** The server sends `table.snapshot` on `table.join`, after a client
   reports a gap, and when it skipped patches for a slow connection. A client that sees
   `from` not equal to its rev resyncs by sending `table.sync`, which answers with a
   fresh snapshot. (`table.join` is also idempotent, but `table.sync` makes the intent
   explicit in logs and devtools and never changes the viewer's role.)
6. **Backpressure.** If a connection's send buffer passes 1 MiB, the server stops
   sending it patches and marks it stale. When the buffer drains, it gets one snapshot.
   Other viewers are unaffected.
7. **Ordering per commit**: patches for the commit, then that commit's `table.event`
   messages, then the `ack` for the action that caused it. A client that receives its
   ack can rely on its view already reflecting the action.
8. **`act.rev`** (optional) lets a client say "only if the table is still at rev N".
   If the table rev differs, the action rejects with `STALE_REVISION` without running.
9. **JSON only.** Views must be JSON values: no `undefined` in arrays, no `Map`, `Set`,
   `Date`, class instances, functions or non-finite numbers. In dev the engine checks
   every view and throws a descriptive error naming the path. In production the check
   is skipped.
10. **Leak checks.** Games may mark fields with the `secret` helper. In dev the engine
    warns when all viewer views are identical although secrets are declared (RFC 0001 section 5.2),
    and `shoehive/testing` ships a property test helper asserting no secret value
    appears in any other seat's or the spectator view.

Multiple connections for one player (tabs) share the viewer for that seat. Each
connection tracks its own last acknowledged rev, so a lagging tab resyncs alone.
Lobby sync (`lobby.snapshot` / `lobby.patch`) uses the same diff and `from` / `rev`
scheme with one lobby-wide rev.

## Consequences

### Positive

- Hidden information is a pure function the author can unit test, not a filter list.
- Bandwidth is proportional to what changed for that viewer.
- Spectator count costs one `view()` call and one serialization per commit, not one per
  spectator.
- Patch apply is about 50 lines in the client and can be property-tested against a full
  view (RFC 0001 section 10 test pyramid).

### Negative

- CPU per commit grows with seats: one `view()` and one diff per seat. Twelve seats is
  our largest example; the Phase 1 benchmark (RFC 0001 section 13) checks it against the
  RFC 0001 section 12 Phase 8 target of p95 action-to-patch under 20 ms.
- Index-based array diffs are verbose when a game removes from the front of a long
  array. Authors can key such data by id. We accept this over move detection's cost and
  ambiguity.
- The server holds the last sent view per viewer per table in memory.

## Alternatives considered

### Full-state broadcast (0.x)

Simple, but it sends raw state (leaks secrets by construction) and costs bandwidth
proportional to state size times connections. Rejected; it caused findings 3, 4 and 12.

### Colyseus schema binary deltas

Very compact, but it requires decorated schema classes or codegen, couples the wire
format to the state shape, and hides fields with per-field filters instead of a view
function. JSON Patch is debuggable in the browser and in devtools. A MessagePack codec
can shrink JSON later (RFC 0001 section 13 roadmap) without changing this model.

### Immer or Mutative patches of raw state

The drafting library can emit patches for free. Rejected because those patches
describe raw state: a patch saying `hands/1/0` changed leaks that seat 1 drew a card and
its value. Patches must describe each viewer's view, so we diff views, not state.

### Send full views every commit, per viewer

No leaks, but still bandwidth heavy and no cheaper to compute than a diff once views
are cached. Rejected.
