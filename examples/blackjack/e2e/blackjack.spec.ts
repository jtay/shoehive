import { expect, test, type Browser, type Page } from '@playwright/test';

const STARTING_BALANCE = 1000;
// What a hand returns per unit bet, by the label of its outcome badge (see game.ts).
const PAYOUT: Record<string, number> = { Blackjack: 2.5, Win: 2, Push: 1, Lose: 0, Bust: 0 };

// Each player gets their own browser context: separate localStorage, so a separate guest.
async function newPlayer(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test.afterEach(async ({ browser }) => {
  for (const context of browser.contexts()) await context.close();
});

const hasDigit = (text: string | null): boolean => /\d/.test(text ?? '');
const turnGroup = (page: Page) => page.getByRole('group', { name: 'Your move' });

/**
 * Plays one hand on both pages: the seats in `bets` (seat index to amount) bet, then
 * whoever's turn it is stands until the dealer plays, then the settlement is checked.
 */
async function playHand(pages: Page[], bets: Record<number, number>): Promise<void> {
  const [a, b] = pages as [Page, Page];
  const seats = Object.keys(bets).map(Number);

  // Betting is open on every page; remember each bankroll to check the payout against.
  // Seats that bet this hand are in the round; a player who sat after betting opened
  // is told they join from the next hand.
  for (const [i, page] of pages.entries()) {
    await expect(page.getByRole('status')).toHaveText(
      seats.includes(i) ? 'Place your bet' : 'You can bet from the next hand',
    );
  }
  const before: number[] = [];
  for (const i of [0, 1]) {
    before[i] = Number(await a.getByTestId(`bankroll-${String(i)}`).textContent());
  }

  for (const i of seats) {
    const page = pages[i]!;
    await page.getByLabel('Bet amount').fill(String(bets[i]));
    await page.getByRole('button', { name: 'Bet' }).click();
    // The bet form goes away once the bet is in (the round may close right away).
    await expect(page.getByRole('button', { name: 'Bet' })).toBeHidden();
  }

  // Every bet is in, so the round closes early and the cards are dealt.
  for (const page of pages) {
    await expect(page.getByTestId('dealer-card-1')).toBeVisible();
    for (const i of seats) {
      await expect(page.getByTestId(`bet-${String(i)}`)).toHaveText(String(bets[i]));
      await expect(page.getByTestId(`bankroll-${String(i)}`)).toHaveText(
        String(before[i]! - bets[i]!),
      );
    }
  }

  // Whoever's turn it is stands, until the dealer plays. A natural has no turn, so a hand
  // can skip straight to the dealer. Until then the hole card must stay face down.
  const dealerTotal = a.getByTestId('dealer-total');
  for (;;) {
    const state = { turn: 'wait' as 'a' | 'b' | 'dealer' | 'wait' };
    await expect
      .poll(
        async () => {
          if (await turnGroup(a).isVisible()) state.turn = 'a';
          else if (await turnGroup(b).isVisible()) state.turn = 'b';
          else if (hasDigit(await dealerTotal.textContent())) state.turn = 'dealer';
          else state.turn = 'wait';
          return state.turn;
        },
        { message: 'waiting for a turn or the dealer' },
      )
      .not.toBe('wait');
    if (state.turn === 'dealer') break;

    for (const page of pages) {
      await expect(page.getByTestId('dealer-card-0')).toHaveAccessibleName(/ of /);
      await expect(page.getByTestId('dealer-card-1')).toHaveAccessibleName('Face-down card');
      await expect(page.getByTestId('card-back')).toHaveCount(0);
    }
    const actor = state.turn === 'a' ? a : b;
    await actor.getByRole('button', { name: 'Stand' }).click();
    await expect(turnGroup(actor)).toBeHidden();
  }

  // The dealer played: the hole card is face up and the hands are settled on both pages.
  for (const page of pages) {
    await expect(page.getByTestId('dealer-total')).toHaveText(/^\d+$/);
    await expect(page.getByTestId('dealer-card-1')).toHaveAccessibleName(/ of /);
    await expect(page.getByRole('status')).toHaveText('Hand settled');
    for (const i of [0, 1]) {
      const badge = page.getByTestId(`outcome-${String(i)}`);
      if (!seats.includes(i)) {
        await expect(badge).toHaveCount(0);
        await expect(page.getByTestId(`bankroll-${String(i)}`)).toHaveText(String(before[i]));
        continue;
      }
      await expect(badge).toHaveText(/^(Blackjack|Win|Push|Lose|Bust)$/);
      const outcome = (await badge.textContent())!;
      const expected = before[i]! - bets[i]! + Math.floor(bets[i]! * PAYOUT[outcome]!);
      await expect(page.getByTestId(`bankroll-${String(i)}`)).toHaveText(String(expected));
    }
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
}

test('two players bet, stand, and see the dealer reveal and the payouts', async ({ browser }) => {
  const a = await newPlayer(browser);
  await a.goto('/');
  await a.getByRole('button', { name: 'New table' }).click();
  await expect(a).toHaveURL(/#\/table\/.+/);
  await a.getByRole('button', { name: 'Take a seat' }).click();
  await expect(a.getByTestId('seat-0')).toContainText('(you)');

  const b = await newPlayer(browser);
  await b.goto(a.url());
  await b.getByRole('button', { name: 'Take a seat' }).click();
  await expect(b.getByTestId('seat-1')).toContainText('(you)');
  const pages = [a, b];

  // Everyone starts with the wallet's 1000 chips and sees the betting countdown.
  for (const page of pages) {
    for (const i of [0, 1]) {
      await expect(page.getByTestId(`bankroll-${String(i)}`)).toHaveText(String(STARTING_BALANCE));
    }
    await expect(page.getByTestId('countdown')).toHaveText(/^\d+ s left$/);
  }

  // The first sitter opened the first betting round alone, so the second player is not in
  // it ("NOT_PARTICIPANT") and joins from hand 2. Hand 1 is the first player's alone.
  await playHand(pages, { 0: 50 });
  for (const page of pages) {
    // The next hand starts 5 s after the settlement.
    await expect(page.getByText('Hand 2')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('outcome-0')).toHaveCount(0);
  }

  // Hand 2: both players bet.
  await playHand(pages, { 0: 50, 1: 100 });
});
