// Fixtures exported from devtools (ADR 0011 rule 14) replayed as test tables, so a bug
// seen in the inspector becomes a regression test:
//
//   import fixture from './fixtures/split-pot.json';
//   const t = await replayFixture(holdem, fixture as Fixture);
//   expect(t.state.pot).toBe(0);

import type { AnyGame } from '../core/define';
import { TableRuntime } from '../core/runtime';
import { bytesToHex, sha256 } from '../core/sha256';
import { MemoryWallet, type Wallet, type WalletOp } from '../core/wallet';
import type { Fixture } from '../devtools/protocol';
import { FakeClock } from './fake-clock';
import { TestTable } from './test-table';

export type { Fixture } from '../devtools/protocol';

/** The `stateHash` a fixture's `expect` holds: SHA-256 (hex) of the state's JSON. */
export function fixtureStateHash(state: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(state))));
}

/**
 * Replays a fixture into a live test table at its last entry: checks the game and its
 * version, replays every entry exactly (ADR 0006), then checks `expect` if present.
 * Throws if anything differs. The table keeps running: act on it, advance its clock
 * (it starts at the last entry's time) and assert, like any `createTestTable` table.
 */
export async function replayFixture<G extends AnyGame>(
  game: G,
  fixture: Fixture,
  options: { wallet?: Wallet } = {},
): Promise<TestTable<G>> {
  if ((fixture as { shoehiveFixture?: unknown }).shoehiveFixture !== 1) {
    throw new TypeError('replayFixture(): not a Shoehive fixture (shoehiveFixture must be 1)');
  }
  if (fixture.game !== game.id) {
    throw new TypeError(
      `replayFixture(): the fixture is for game "${fixture.game}", not "${game.id}"`,
    );
  }
  const version = game.version ?? 1;
  if (fixture.version !== version) {
    throw new TypeError(
      `replayFixture(): the fixture is for version ${String(fixture.version)} of "${game.id}", ` +
        `the game is version ${String(version)}`,
    );
  }
  const first = fixture.entries[0];
  if (first?.kind !== 'create') {
    throw new TypeError('replayFixture(): a fixture must start with the create entry');
  }
  const clock = new FakeClock(fixture.entries.at(-1)!.at);
  const wallet = options.wallet ?? new MemoryWallet({ startingBalance: 1000 });
  const walletErrors: { op: WalletOp; error: unknown }[] = [];
  const runtime = await TableRuntime.replay(game, fixture.entries, {
    live: true,
    dev: true,
    clock,
    wallet,
    // A fresh wallet never saw the recorded reservations: do not re-send history.
    resendWalletOps: false,
    onWalletError: (info) => {
      walletErrors.push(info);
    },
  });
  const table = TestTable.fromRuntime<G>(runtime, clock, wallet, walletErrors);
  if (fixture.expect) {
    if (runtime.rev !== fixture.expect.rev) {
      throw new Error(
        `replayFixture(): replay reached rev ${String(runtime.rev)}, the fixture expects ${String(fixture.expect.rev)}`,
      );
    }
    const hash = fixtureStateHash(runtime.state);
    if (hash !== fixture.expect.stateHash) {
      throw new Error(
        'replayFixture(): the replayed state differs from the exported one (did the game change?)',
      );
    }
  }
  await runtime.idle();
  return table;
}
