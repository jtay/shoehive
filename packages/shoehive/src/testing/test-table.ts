import type { AnyGame, GameActions, GameState, GameView, SeatInfo } from '../core/define';
import type { Json } from '../core/json';
import { TableRuntime, type EmittedEvent, type LogEntry, type TableMeta } from '../core/runtime';
import { jsonEqual } from '../core/json';
import { MemoryWallet, type Wallet, type WalletOp } from '../core/wallet';
import { FakeClock } from './fake-clock';

/** Default seed for test tables, so every run is reproducible (ADR 0006). */
export const TEST_SEED = 'shoehive-test';

export interface TestTableOptions {
  /** Seats to fill at creation: a count (players `p0`, `p1`...) or player ids. Default `seats.min`. */
  players?: number | readonly string[];
  /** RNG seed. Any string; default `'shoehive-test'`. */
  seed?: string;
  /** Table options, validated by the game's options schema. */
  options?: unknown;
  /** Clock start time (epoch ms). */
  startAt?: number;
  /** The wallet behind `ctx.wallet`. Default: a `MemoryWallet` giving every player 1000. */
  wallet?: Wallet;
}

type Inputs<G> = GameActions<G>;
type InputArgs<G, K extends keyof Inputs<G>> = undefined extends Inputs<G>[K]
  ? [input?: Inputs<G>[K]]
  : [input: Inputs<G>[K]];

export interface RecordedEvent extends EmittedEvent {
  rev: number;
}

/**
 * A table driven directly, without sockets, for testing game rules. Checks are always
 * on: frozen state, JSON validation and the nondeterminism guard.
 */
export class TestTable<G extends AnyGame> {
  readonly clock: FakeClock;
  /** The wallet behind `ctx.wallet` (a `MemoryWallet` unless you passed one). */
  readonly wallet: Wallet;
  /** Ephemeral events emitted by the game, in order. */
  readonly events: RecordedEvent[] = [];
  private readonly playerBySeat = new Map<number, string>();

  private constructor(
    readonly runtime: TableRuntime,
    clock: FakeClock,
    wallet: Wallet,
    /** Deferred wallet ops that failed after retries (a game bug, such as a reused key). */
    readonly walletErrors: { op: WalletOp; error: unknown }[],
  ) {
    this.clock = clock;
    this.wallet = wallet;
    runtime.onCommit((commit) => {
      for (const event of commit.events) this.events.push({ ...event, rev: commit.rev });
    });
  }

  /** @internal */
  static async create<G extends AnyGame>(
    game: G,
    opts: TestTableOptions = {},
  ): Promise<TestTable<G>> {
    const clock = new FakeClock(opts.startAt);
    const wallet = opts.wallet ?? new MemoryWallet({ startingBalance: 1000 });
    const walletErrors: { op: WalletOp; error: unknown }[] = [];
    const runtime = await TableRuntime.create(game, {
      clock,
      dev: true,
      seed: opts.seed ?? TEST_SEED,
      options: opts.options,
      id: 'test-table',
      wallet,
      onWalletError: (info) => {
        walletErrors.push(info);
      },
    });
    const table = new TestTable<G>(runtime, clock, wallet, walletErrors);
    const players = opts.players ?? game.seats.min;
    const ids =
      typeof players === 'number'
        ? Array.from({ length: players }, (_, i) => `p${String(i)}`)
        : players;
    // Queue every initial sit before waiting, so all initial players are seated before
    // auto-start runs and they all take part in the first turn or round.
    const sits = ids.map((id, seat) => {
      table.playerBySeat.set(seat, id);
      return runtime.sit({ seat, player: { id, name: `Player ${String(seat + 1)}` } });
    });
    await Promise.all(sits);
    await runtime.idle();
    return table;
  }

  /** The raw committed state (what the server holds, not what clients see). */
  get state(): GameState<G> {
    return this.runtime.state as GameState<G>;
  }
  get rev(): number {
    return this.runtime.rev;
  }
  get meta(): TableMeta {
    return this.runtime.meta();
  }
  get seats(): SeatInfo[] {
    return this.runtime.seats();
  }
  get log(): readonly LogEntry[] {
    return this.runtime.log;
  }

  /** The player id sitting at `seat` (set by `sit`). */
  playerAt(seat: number): string {
    const player = this.playerBySeat.get(seat) ?? this.runtime.seats()[seat]?.player?.id;
    if (player === undefined) throw new Error(`TestTable: seat ${String(seat)} is empty`);
    return player;
  }

  /** What `seat` (or a spectator) sees: the game's `view()` output. */
  viewOf(seat: number | 'spectator'): GameView<G> {
    const viewer = this.runtime.viewerFor(seat === 'spectator' ? null : this.playerAt(seat));
    return this.runtime.view(viewer) as GameView<G>;
  }

  /** Runs an action as `seat` and waits for follow-ups (round closes, auto-start). */
  async act<K extends keyof Inputs<G> & string>(
    seat: number,
    name: K,
    ...input: InputArgs<G, K>
  ): Promise<Json | undefined> {
    try {
      const { result } = await this.runtime.act({
        player: this.playerAt(seat),
        seat,
        name,
        input: input[0],
      });
      return result;
    } finally {
      await this.runtime.idle();
    }
  }

  async sit(
    seat: number,
    playerId = `p${String(seat)}`,
    name = `Player ${String(seat + 1)}`,
  ): Promise<void> {
    this.playerBySeat.set(seat, playerId);
    try {
      await this.runtime.sit({ seat, player: { id: playerId, name } });
    } finally {
      await this.runtime.idle();
    }
  }

  async stand(seat: number): Promise<void> {
    await this.runtime.stand({ seat });
    this.playerBySeat.delete(seat);
    await this.runtime.idle();
  }

  async disconnect(seat: number): Promise<void> {
    await this.runtime.disconnect({ player: this.playerAt(seat) });
    await this.runtime.idle();
  }

  async reconnect(seat: number): Promise<void> {
    await this.runtime.reconnect({ player: this.playerAt(seat) });
    await this.runtime.idle();
  }

  /** Starts a table whose game sets `autoStart: false`. */
  async start(): Promise<void> {
    await this.runtime.start();
    await this.runtime.idle();
  }

  /** Moves the fake clock forward, firing due timers (turn timeouts, rounds). */
  async advance(ms: number): Promise<void> {
    await this.clock.advance(ms, () => this.runtime.idle());
  }

  /**
   * Replays this table's log from scratch and asserts it reproduces the current state
   * exactly (ADR 0006). Call it at the end of any test.
   */
  async verifyReplay(): Promise<void> {
    const copy = await TableRuntime.replay(this.runtime.game, this.runtime.log, { dev: true });
    if (!jsonEqual(copy.state, this.runtime.state)) {
      throw new Error('verifyReplay(): replayed state differs from the live state');
    }
    if (!jsonEqual(copy.engine, this.runtime.engine)) {
      throw new Error('verifyReplay(): replayed engine state differs from the live engine state');
    }
  }
}

/**
 * Creates a table for testing game rules without a server or sockets.
 *
 * ```ts
 * const t = await createTestTable(ticTacToe, { players: 2 });
 * await t.act(0, 'place', { cell: 4 });
 * expect(t.state.board[4]).toBe('X');
 * ```
 */
export function createTestTable<G extends AnyGame>(
  game: G,
  options?: TestTableOptions,
): Promise<TestTable<G>> {
  return TestTable.create(game, options);
}
