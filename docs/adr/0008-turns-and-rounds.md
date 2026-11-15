# ADR 0008: Turns and rounds

|         |                                                                                   |
| ------- | --------------------------------------------------------------------------------- |
| Status  | Accepted, 2026-11-14                                                              |
| Related | RFC 0001 sections 3 (Real-time scope), 5.1, 5.1a, 11 (Real-time); ADRs 0001, 0006 |

## Context

v1 must serve turn-based games (tic-tac-toe, blackjack play, Hold'em betting) and
round-based party games (quiz), where everyone acts at once inside a timed round. 0.x
had neither; authors tracked whose turn it was in attribute bags. boardgame.io forces a
turn model on every game and layers "stages" on top for simultaneous play. RFC 0001
makes `turns` and `rounds` two optional models chosen per phase, and rules out a fixed
tick loop.

## Decision

Each phase picks **turns**, **rounds** or **neither**. A game without `phases` may set
top-level `turns` or `rounds`; a game with `phases` must declare them per phase (a
top-level one is a type error). Declaring both in one phase is a type error.

```ts
// TurnArgs = { seats: number[]; state: S; options: O }  (seats: occupied, ascending)
interface TurnsConfig<S, O> {
  order?: 'round-robin' | ((args: TurnArgs) => number[]);
  skip?: (args: { seat: number; state: S }) => boolean; // e.g. folded players
  first?: 'lowest' | ((args: TurnArgs) => number); // default 'lowest'
  timeoutMs?: number | ((args: TurnArgs) => number); // arms a 'turn' timer on every turn change
  onTimeout?: string; // internal action to run, receives { seat }
}

interface CtxTurn {
  readonly seat: number | null; // null when no eligible seat
  readonly number: number; // 1-based, counts turns in this phase
  readonly order: readonly number[];
  next(): void; // advance to the next eligible seat
  set(seat: number): void; // jump; throws if seat is not eligible
}

interface RoundsConfig {
  durationMs?: number; // required when closeWhen is 'timeout'
  closeWhen: 'all-submitted' | 'timeout';
  onOpen?: Hook<unknown>;
  onClose: Hook<unknown>;
}

interface CtxRound {
  readonly number: number; // 1-based within the phase
  readonly open: boolean;
  readonly participants: readonly number[]; // seats when the round opened
  readonly submitted: readonly number[];
  readonly pending: readonly number[];
  readonly deadline: number | null;
  close(): void; // close early from game code
  next(): void; // open the next round (after close)
}
```

### Turns

1. On entering a turns phase, the engine computes `order` from occupied seats (ascending
   for `round-robin`) and sets `seat` from `first`, then runs `onEnter`. If `onEnter` made
   that seat skippable (a blackjack natural), the turn moves to the next eligible seat,
   still as turn 1. `skip` is evaluated at each `next()`. Because `first` runs before
   `onEnter`, state it depends on (the button, blinds) is set up in the entry that changes
   phase, before `ctx.phase.go()`.
2. Seats that stand up are removed from the order. A seat that sits down mid-phase joins
   the order at its seat number position but is not given the current turn.
3. The engine does **not** reject off-turn actions on its own. Games check
   `ctx.turn.seat !== seat` and `reject('NOT_YOUR_TURN')`, as in RFC 0001 section 5.1 (see ADR 0001
   Open questions).
4. `timeoutMs` is sugar over `ctx.timers.after('turn', timeoutMs, onTimeout, { seat })`,
   re-armed on every turn change and cancelled when the phase exits. As a function it can
   read the table options (`({ options }) => options.turnMs`). Clients see its deadline as
   `meta.turn.deadline` (it is not listed in `meta.timers`, which holds only timers the
   game marked `{ visible: true }`). Authors can use the
   timer API directly for anything more complex (time banks).

### Rounds

5. A round opens automatically on entering a rounds phase, and again whenever game
   code calls `ctx.round.next()`. `participants` is fixed at open time: the occupied seats
   then. Seats that sit down mid-round wait for the next round. Seats that stand up
   leave `pending`.
6. **Submissions.** In a rounds phase, an action with `once: true` counts as a
   submission. A second call from the same seat in the same round rejects with
   `ALREADY_SUBMITTED` before `run` executes. Actions without `once` may be called freely
   and never count toward `all-submitted`. Calls from non-participants reject with
   `NOT_PARTICIPANT`. Calls after close reject with `ROUND_CLOSED`.
7. **Closing.** With `closeWhen: 'all-submitted'`, the round closes when `pending` becomes
   empty or when `durationMs` (if given) expires, whichever is first. With
   `closeWhen: 'timeout'`, it closes only when `durationMs` expires, even if everyone has
   submitted (for games that reveal on a fixed beat).
8. **Close is its own entry.** When the last submission commits, the engine enqueues a
   `system` entry `round-close` (ADR 0006) instead of running `onClose` inside the
   submission. So the last submitter's action commits and syncs first, and a bug in
   `onClose` rolls back only the close. Timeout closes are timer entries. `onClose` runs
   exactly once per round.
9. Rounds do not reopen by themselves after `onClose`. The game either calls
   `ctx.round.next()` or moves phase (the quiz goes to `reveal`).

### Common rules

10. Everything runs through the table's serial queue. "Simultaneous" means submissions
    can arrive in any order, never that two run at once.
11. `ctx.turn` is `undefined` outside a turns phase and `ctx.round` is `undefined`
    outside a rounds phase. Accessing the wrong one is a type error where the phase is
    known statically and a dev error otherwise.
12. Turn and round bookkeeping lives in engine state, is part of the transaction
    (ADR 0005) and the snapshot (ADR 0009), and is visible to `view()` through `ctx`.
13. **No tick loop in v1.** There is no fixed-rate update callback. Time only enters
    through timers and `ctx.now()`. A fixed-tick loop for continuous real-time games is
    listed in RFC 0001 as after 1.0.

## Consequences

### Positive

- Tic-tac-toe, blackjack, Hold'em and the quiz each fit one of the models without
  workarounds; blackjack mixes them (betting as a round, play as turns).
- Simultaneous play is race-free by construction.
- Separate round-close entries make "everyone answered" visible to clients before the
  reveal, which party games want.

### Negative

- Two models plus "neither" is more to teach than one. The docs have a dedicated
  "Turns vs rounds" how-to.
- No enforced turn check means a forgotten check is a cheating bug. The tic-tac-toe
  tutorial's first test is an out-of-turn `t.act` that must reject.
- No tick loop rules out action games. That is a stated non-goal.

## Alternatives considered

### A mandatory turn model with stages (boardgame.io)

Rejected: party games would fight a turn order they do not have.

### `onClose` inside the last submission

Fewer entries. Rejected: an error in scoring would bounce the last player's answer,
and clients would never see the "all submitted" state.

### A fixed tick loop for rounds

Rejected for v1: costly per table, nondeterministic unless recorded, and unnecessary
when timers cover every v1 game.
