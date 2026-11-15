import { expect, test, type Browser, type Page } from '@playwright/test';

// Each player gets their own browser context: separate localStorage, so a separate guest.
async function newPlayer(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

async function startGame(browser: Browser): Promise<{ x: Page; o: Page }> {
  const x = await newPlayer(browser);
  await x.goto('/');
  await x.getByRole('button', { name: 'New game' }).click();
  await expect(x).toHaveURL(/#\/table\/.+/);
  await x.getByRole('button', { name: 'Take a seat' }).click();
  await expect(x.getByTestId('seat-0')).toContainText('(you)');
  await expect(x.getByRole('status')).toHaveText('Waiting for another player');

  const o = await newPlayer(browser);
  await o.goto(x.url());
  await o.getByRole('button', { name: 'Take a seat' }).click();
  await expect(o.getByTestId('seat-1')).toContainText('(you)');

  await expect(x.getByRole('status')).toHaveText('Your turn');
  await expect(o.getByRole('status')).toHaveText('Waiting for X');
  return { x, o };
}

/** Plays a move and waits until both pages show it. */
async function place(player: Page, other: Page, cell: number, mark: 'X' | 'O'): Promise<void> {
  await player.getByRole('button', { name: `cell ${String(cell)}` }).click();
  for (const page of [player, other]) {
    await expect(page.getByRole('button', { name: `cell ${String(cell)}` })).toHaveText(mark);
  }
}

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

test('two players alternate until X wins', async ({ browser }) => {
  const { x, o } = await startGame(browser);

  await place(x, o, 0, 'X');
  await expect(o.getByRole('status')).toHaveText('Your turn');
  await expect(x.getByRole('status')).toHaveText('Waiting for O');
  await place(o, x, 1, 'O');
  await place(x, o, 4, 'X');
  await place(o, x, 2, 'O');
  await place(x, o, 8, 'X');

  for (const page of [x, o]) {
    await expect(page.getByRole('status')).toHaveText('X wins');
    await expect(page.getByRole('button', { name: 'cell 3' })).toBeDisabled();
  }
  await expect(x.getByRole('alert')).toHaveCount(0);
});

test('a player who reloads mid-game keeps their seat and the game goes on', async ({ browser }) => {
  const { x, o } = await startGame(browser);
  await place(x, o, 0, 'X');
  await place(o, x, 1, 'O');

  // The resume token in localStorage brings X back as the same player.
  await x.reload();
  await expect(x.getByTestId('seat-0')).toContainText('(you)');
  for (const page of [x, o]) {
    await expect(page.getByTestId('seat-0')).toContainText('online');
    await expect(page.getByRole('button', { name: 'cell 0' })).toHaveText('X');
    await expect(page.getByRole('button', { name: 'cell 1' })).toHaveText('O');
  }
  await expect(x.getByRole('status')).toHaveText('Your turn');

  await place(x, o, 4, 'X');
  await place(o, x, 2, 'O');
  await place(x, o, 8, 'X');
  for (const page of [x, o]) await expect(page.getByRole('status')).toHaveText('X wins');
});

test('a player who closes the tab shows as offline until they come back', async ({ browser }) => {
  const { x, o } = await startGame(browser);
  await place(x, o, 0, 'X');
  const url = x.url();
  const context = x.context();

  await x.close();
  await expect(o.getByTestId('seat-0')).toContainText('offline');

  // Same context, so the same localStorage and resume token: the seat was held.
  const back = await context.newPage();
  await back.goto(url);
  await expect(back.getByTestId('seat-0')).toContainText('(you)');
  await expect(o.getByTestId('seat-0')).toContainText('online');
  await expect(back.getByRole('status')).toHaveText('Waiting for O');
  await place(o, back, 3, 'O');
  await expect(back.getByRole('status')).toHaveText('Your turn');
});
