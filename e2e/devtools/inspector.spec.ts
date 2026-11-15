// The devtools inspector against every example server (RFC 0001 Phase 6 exit criteria):
// it shows live tables and each seat's view, time travel replays without touching the
// live table, and an exported fixture replays as a passing test.

import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { blackjack } from '../../examples/blackjack/src/game';
import { holdem } from '../../examples/holdem/src/game';
import { quiz } from '../../examples/quiz/src/game';
import { ticTacToe } from '../../examples/tic-tac-toe/src/game';
import { createClient, type ShoehiveClient } from '../../packages/shoehive/src/client/index';
import type { AnyGame } from '../../packages/shoehive/src/core/define';
import { replayFixture, type Fixture } from '../../packages/shoehive/src/testing/index';
import { DEVTOOLS_TOKEN, EXAMPLES } from './config';

const GAMES: Record<string, AnyGame> = {
  'tic-tac-toe': ticTacToe,
  quiz,
  blackjack,
  holdem,
};

const clients: ShoehiveClient[] = [];
test.afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

/** Two guests create a table of `game`, join it and sit, through the real client. */
async function liveTable(port: number, game: string): Promise<string> {
  const make = (name: string) => {
    const client = createClient({
      url: `ws://localhost:${String(port)}/shoehive`,
      name,
      storage: false,
    });
    clients.push(client);
    return client;
  };
  const ada = make('Ada');
  const bob = make('Bob');
  const table = await ada.createAndJoin(game);
  const bobTable = await bob.join(table.id);
  await bobTable.sit();
  return table.id;
}

async function openInspector(page: Page, port: number): Promise<void> {
  await page.goto(`http://localhost:${String(port)}/__shoehive/#token=${DEVTOOLS_TOKEN}`);
  await expect(page.getByText('Connected')).toBeVisible();
  // The token is read from the fragment and removed from the address bar.
  expect(new URL(page.url()).hash).toBe('');
}

for (const { name, port } of EXAMPLES) {
  test(`inspects a live ${name} table, time travels and exports a replayable fixture`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const tableId = await liveTable(port, name);
    await openInspector(page, port);

    await page.getByText(tableId, { exact: true }).first().click();
    await page.getByRole('tab', { name: /^Views/ }).click();
    await expect(page.getByText('Ada (seat 0)')).toBeVisible();
    await expect(page.getByText('Bob (seat 1)')).toBeVisible();
    await expect(page.getByText('Spectator', { exact: false }).first()).toBeVisible();

    // Time travel: one step back is a replayed copy, clearly marked; back to live after.
    await page.getByRole('button', { name: 'Step back one entry' }).click();
    await expect(page.getByText('Replay, not live.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Back to live' }).click();
    await expect(page.getByText('Replay, not live.', { exact: false })).toBeHidden();

    // Export, confirm the warning, download, and replay the fixture as a test would.
    await page.getByRole('button', { name: /^Export fixture/ }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .json' }).click();
    const path = await (await download).path();
    const fixture = JSON.parse(await readFile(path, 'utf8')) as Fixture;
    expect(fixture.game).toBe(name);
    expect(JSON.stringify(fixture)).not.toContain('"Ada"'); // names are anonymized
    const replayed = await replayFixture(GAMES[name]!, fixture);
    expect(replayed.runtime.rev).toBe(fixture.expect!.rev);
    replayed.runtime.dispose();

    expect(errors).toEqual([]);
  });
}

test('rejects a wrong token without showing any table', async ({ page }) => {
  const { port } = EXAMPLES[0];
  const tableId = await liveTable(port, 'tic-tac-toe');
  await page.goto(`http://localhost:${String(port)}/__shoehive/#token=wrong-token`);
  await expect(page.getByText(/inspector URL the server logged at startup/)).toBeVisible();
  await expect(page.getByText(tableId)).toHaveCount(0);
});
