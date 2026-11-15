import { expect, test, type Browser, type Page } from '@playwright/test';

const LETTERS = ['A', 'B', 'C', 'D'];

// Each player gets their own browser context: separate localStorage, so a separate guest.
async function newPlayer(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

async function nameOf(page: Page, seat: number): Promise<string> {
  const text = await page
    .getByTestId(`seat-${String(seat)}`)
    .locator('.seat-name')
    .textContent();
  return (text ?? '').replace(' (you)', '').trim();
}

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

test('two players answer a one-question quiz, see the reveal and the winners', async ({
  browser,
}) => {
  const a = await newPlayer(browser);
  await a.goto('/');
  await a.getByLabel('Questions').selectOption('1');
  await a.getByRole('button', { name: 'New game' }).click();
  await expect(a).toHaveURL(/#\/table\/.+/);
  await a.getByRole('button', { name: 'Take a seat' }).click();
  await expect(a.getByRole('status')).toHaveText('Waiting for players');

  const b = await newPlayer(browser);
  await b.goto(a.url());
  await b.getByRole('button', { name: 'Take a seat' }).click();

  // Two seated players start the quiz.
  for (const page of [a, b]) {
    await expect(page.getByRole('status')).toHaveText('Pick an answer');
    await expect(page.getByText('Question 1 of 1')).toBeVisible();
    await expect(page.getByTestId('countdown')).toHaveText(/^\d+ s left$/);
  }
  const names = [await nameOf(a, 0), await nameOf(a, 1)];

  // A answers A, B answers B. Answers stay hidden from the other player until the reveal.
  const choices = (page: Page) => page.getByRole('group', { name: 'Answers' }).getByRole('button');
  await choices(a).nth(0).click();
  await expect(a.getByRole('status')).toHaveText('Answer locked in');
  await expect(b.getByTestId('seat-0')).toContainText('answered');
  await expect(b.getByText(`Answered: ${names[0]!}`)).toBeVisible();
  await choices(b).nth(1).click();

  // Everyone answered, so the round closes early and the reveal starts.
  const headline = /^Correct answer: ([A-D])\. /;
  await expect(a.getByRole('status')).toHaveText(headline);
  await expect(b.getByRole('status')).toHaveText(headline);
  const revealed = headline.exec((await a.getByRole('status').textContent()) ?? '');
  const correct = LETTERS.indexOf(revealed![1]!);

  const scores: number[] = [];
  for (const seat of [0, 1]) {
    const text = (await a.getByTestId(`score-${String(seat)}`).textContent()) ?? '';
    scores.push(Number(/^(\d+) pts$/.exec(text)?.[1]));
    await expect(b.getByTestId(`score-${String(seat)}`)).toHaveText(text);
    const right = correct === seat;
    expect(scores[seat]! > 0).toBe(right);
    await expect(a.getByTestId(`seat-${String(seat)}`)).toContainText(right ? 'correct' : 'wrong');
  }

  // The reveal lasts 5 seconds, then the one-question quiz ends.
  const best = Math.max(...scores);
  const winners = [0, 1].filter((seat) => scores[seat] === best).map((seat) => names[seat]!);
  const final = winners.length === 1 ? `Winner: ${winners[0]!}` : `Winners: ${winners.join(', ')}`;
  for (const page of [a, b]) {
    await expect(page.getByRole('status')).toHaveText(final, { timeout: 10_000 });
    await expect(page.getByText('Game over')).toBeVisible();
  }
});
