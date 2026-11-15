import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

const BUY_IN = 200; // the game's default buy-in
const SMALL_BLIND = 5;
const BIG_BLIND = 10;

interface Player {
  page: Page;
  seat: number;
  name: string;
}

// Each player gets their own browser context: separate localStorage, so a separate guest.
async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

async function rename(page: Page, name: string): Promise<void> {
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByText(`${name}, open`)).toBeVisible();
}

/** Alice opens a table and sits, Bob joins and sits: the second sitter starts hand 1. */
async function seatTwo(browser: Browser): Promise<[Player, Player]> {
  const a = await newPage(browser);
  await a.goto('/');
  await rename(a, 'Alice');
  await a.getByRole('button', { name: 'New table' }).click();
  await expect(a).toHaveURL(/#\/table\/.+/);
  await a.getByRole('button', { name: 'Take a seat' }).click();
  await expect(a.getByTestId('seat-0')).toContainText('(you)');
  await expect(a.getByRole('status')).toHaveText('Waiting for players');

  const b = await newPage(browser);
  await b.goto('/');
  await rename(b, 'Bob');
  // The server is shared by every test, so Bob opens Alice's table by its address.
  await b.goto(a.url());
  await b.getByRole('button', { name: 'Take a seat' }).click();
  await expect(b.getByTestId('seat-1')).toContainText('(you)');
  return [
    { page: a, seat: 0, name: 'Alice' },
    { page: b, seat: 1, name: 'Bob' },
  ];
}

const seatOf = (page: Page, seat: number): Locator => page.getByTestId(`seat-${String(seat)}`);
const num = async (locator: Locator): Promise<number> => Number(await locator.textContent());
const stack = (page: Page, seat: number): Locator => page.getByTestId(`stack-${String(seat)}`);
const turnGroup = (page: Page): Locator => page.getByRole('group', { name: 'Your move' });

/** Waits for hand `n` to be dealt on every page: blinds posted, two cards each. */
async function expectDealt(players: Player[], n: number): Promise<void> {
  for (const { page } of players) {
    await expect(page.getByText(`Hand ${String(n)} /`)).toBeVisible();
    await expect(page.getByTestId('pot')).toHaveText(String(SMALL_BLIND + BIG_BLIND));
  }
}

/** The seat with the small blind (the button heads-up) and the big blind, from the markers. */
async function blinds(page: Page): Promise<{ sb: number; bb: number }> {
  const sb = (await page.getByTestId('markers-0').textContent())?.includes('SB') ? 0 : 1;
  return { sb, bb: 1 - sb };
}

/** Whose turn it is, or null once the hand is over. */
async function whoseTurn(players: Player[]): Promise<Player | null> {
  let turn: Player | null = null;
  await expect
    .poll(
      async () => {
        for (const p of players) {
          if (await turnGroup(p.page).isVisible()) {
            turn = p;
            return 'turn';
          }
        }
        turn = null;
        return (await players[0]!.page.getByTestId('result').isVisible()) ? 'over' : 'wait';
      },
      { message: 'waiting for a turn or the end of the hand' },
    )
    .not.toBe('wait');
  return turn;
}

/** Every card face on the page, by accessible name. */
async function faces(page: Page): Promise<string[]> {
  return page.getByTestId('card-face').evaluateAll((els) => els.map((e) => e.ariaLabel ?? ''));
}

test('each player sees only their own hole cards while the hand is on', async ({ browser }) => {
  const players = await seatTwo(browser);
  await expectDealt(players, 1);
  const [a, b] = players;

  const cards: Record<string, string[]> = {};
  for (const me of players) {
    const other = me === a ? b : a;
    // Two own cards face up, the opponent's two as backs, nothing on the board yet.
    await expect(
      me.page.getByTestId(`hole-${String(me.seat)}`).getByTestId('card-face'),
    ).toHaveCount(2);
    await expect(
      me.page.getByTestId(`hole-${String(other.seat)}`).getByTestId('card-back'),
    ).toHaveCount(2);
    await expect(
      me.page.getByTestId(`hole-${String(other.seat)}`).getByTestId('card-face'),
    ).toHaveCount(0);
    await expect(me.page.getByTestId('card-face')).toHaveCount(2);
    await expect(me.page.getByTestId('card-back')).toHaveCount(2);
    await expect(me.page.getByTestId('board-card')).toHaveCount(0);
    cards[me.name] = await faces(me.page);
  }

  // Neither page holds a face of the other player's hand, in any form.
  for (const me of players) {
    const other = me === a ? b : a;
    expect(new Set(cards[me.name]).size).toBe(2);
    for (const card of cards[other.name]!) {
      await expect(me.page.getByRole('img', { name: card, exact: true })).toHaveCount(0);
      expect(await me.page.content()).not.toContain(card);
    }
  }

  // Blinds are posted: the small blind (the button heads-up) and the big blind.
  const { sb, bb } = await blinds(a.page);
  for (const { page } of players) {
    await expect(stack(page, sb)).toHaveText(String(BUY_IN - SMALL_BLIND));
    await expect(page.getByTestId(`bet-${String(sb)}`)).toHaveText(String(SMALL_BLIND));
    await expect(stack(page, bb)).toHaveText(String(BUY_IN - BIG_BLIND));
    await expect(page.getByTestId(`bet-${String(bb)}`)).toHaveText(String(BIG_BLIND));
    await expect(page.getByTestId(`markers-${String(sb)}`)).toContainText('D');
    await expect(page.getByTestId('countdown')).toHaveText(/^\d+ s left$/);
  }
  // Preflop, the small blind acts first and sees the amount to call.
  const first = players[sb]!;
  await expect(turnGroup(first.page)).toBeVisible();
  await expect(
    first.page.getByRole('button', { name: `Call ${String(SMALL_BLIND)}` }),
  ).toBeVisible();
  await expect(first.page.getByRole('button', { name: 'Fold' })).toBeVisible();
  await expect(first.page.getByRole('button', { name: `All-in ${String(BUY_IN)}` })).toBeVisible();
  const second = players[bb]!;
  await expect(turnGroup(second.page)).toBeHidden();
  await expect(second.page.getByRole('status')).toHaveText(`Waiting for ${first.name}`);
});

test('a fold hands the pot to the other player', async ({ browser }) => {
  const players = await seatTwo(browser);
  await expectDealt(players, 1);
  const { sb, bb } = await blinds(players[0].page);
  const folder = players[sb]!;
  const winner = players[bb]!;

  await expect(turnGroup(folder.page)).toBeVisible();
  await folder.page.getByRole('button', { name: 'Fold' }).click();

  for (const { page } of players) {
    // The big blind wins the small blind: +5 for them, -5 for the folder.
    await expect(page.getByTestId('result')).toContainText(
      `${winner.name} won ${String(BIG_BLIND)}`,
    );
    await expect(page.getByTestId('result')).toContainText('everyone else folded');
    await expect(stack(page, winner.seat)).toHaveText(String(BUY_IN + SMALL_BLIND));
    await expect(stack(page, folder.seat)).toHaveText(String(BUY_IN - SMALL_BLIND));
    await expect(page.getByTestId('pot')).toHaveText('0');
    await expect(seatOf(page, folder.seat)).toContainText('Folded');
    // Nobody showed: no opponent card face, and the folded hand stays hidden from the winner.
    await expect(page.getByTestId('card-face')).toHaveCount(2);
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  // The winner never saw the folder's cards.
  await expect(
    winner.page.getByTestId(`hole-${String(folder.seat)}`).getByTestId('card-face'),
  ).toHaveCount(0);
  await expect(
    winner.page.getByTestId(`hole-${String(folder.seat)}`).getByTestId('card-back'),
  ).toHaveCount(0);

  // The next hand starts by itself, with the button moved.
  for (const { page } of players) {
    await expect(page.getByText('Hand 2 /')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('result')).toHaveCount(0);
    await expect(page.getByTestId(`markers-${String(winner.seat)}`)).toContainText('D');
  }
});

test('a raise is called and the hand is checked down to showdown', async ({ browser }) => {
  const players = await seatTwo(browser);
  await expectDealt(players, 1);
  const { sb } = await blinds(players[0].page);
  const raiser = players[sb]!;
  const caller = players[1 - sb]!;
  const RAISE_TO = 30;

  // Preflop: the small blind raises to 30 with the UI's amount box, the big blind calls 20.
  await expect(turnGroup(raiser.page)).toBeVisible();
  const amount = raiser.page.getByLabel('Raise to');
  await expect(amount).toHaveValue('20'); // the minimum: the big blind plus the last raise
  await amount.fill(String(RAISE_TO));
  await raiser.page.getByRole('button', { name: 'Raise', exact: true }).click();
  await expect(turnGroup(caller.page)).toBeVisible();
  await expect(
    caller.page.getByRole('button', { name: `Call ${String(RAISE_TO - BIG_BLIND)}` }),
  ).toBeVisible();
  await expect(caller.page.getByTestId('last-action')).toHaveText(
    `${raiser.name} raised to ${String(RAISE_TO)}`,
  );
  await expect(caller.page.getByTestId('pot')).toHaveText(String(RAISE_TO + BIG_BLIND));
  await caller.page.getByRole('button', { name: `Call ${String(RAISE_TO - BIG_BLIND)}` }).click();

  // Flop, turn and river: both check. The board grows 3, 4, 5 cards and the pot stays at 60.
  const boardSizes = [3, 4, 5];
  for (const size of boardSizes) {
    for (const { page } of players) {
      await expect(page.getByTestId('board-card')).toHaveCount(size);
      await expect(page.getByTestId('pot')).toHaveText(String(RAISE_TO * 2));
    }
    // Postflop the big blind acts first, then the button.
    for (let i = 0; i < 2; i++) {
      const actor = (await whoseTurn(players))!;
      expect(actor).not.toBeNull();
      await expect(actor.page.getByRole('button', { name: 'Check' })).toBeVisible();
      await actor.page.getByRole('button', { name: 'Check' }).click();
      await expect(turnGroup(actor.page)).toBeHidden();
    }
  }

  // Showdown: the result is on both pages, both hands are face up, the chips are conserved.
  for (const { page } of players) {
    await expect(page.getByTestId('result')).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Hand over');
    await expect(page.getByTestId('board-card')).toHaveCount(5);
    for (const { seat } of players) {
      await expect(page.getByTestId(`hole-${String(seat)}`).getByTestId('card-face')).toHaveCount(
        2,
      );
    }
    await expect(page.getByTestId('card-back')).toHaveCount(0);
    await expect(page.getByTestId('result')).toContainText(`${raiser.name} showed`);
    await expect(page.getByTestId('result')).toContainText(`${caller.name} showed`);
    await expect(page.getByTestId('pot')).toHaveText('0');
    await expect(page.getByTestId('countdown')).toHaveText(/^Next hand in \d+ s$/);
  }
  // Each page shows the same four distinct hole faces.
  const [fa, fb] = [await faces(players[0].page), await faces(players[1].page)];
  expect(fa).toHaveLength(4);
  expect(new Set(fa).size).toBe(4);
  expect(fb.sort()).toEqual(fa.sort());

  // The winner gets 60, a tie splits it: the loser's stack is down 30 or even.
  await expect
    .poll(async () => {
      const [x, y] = [await num(stack(players[0].page, 0)), await num(stack(players[0].page, 1))];
      return x + y;
    })
    .toBe(BUY_IN * 2);
  for (const { page } of players) {
    const stacks = [await num(stack(page, 0)), await num(stack(page, 1))];
    expect(stacks[0]! + stacks[1]!).toBe(BUY_IN * 2);
    expect([BUY_IN - RAISE_TO, BUY_IN, BUY_IN + RAISE_TO]).toContain(stacks[0]);
  }
  await expect(players[0].page.getByRole('alert')).toHaveCount(0);
});
