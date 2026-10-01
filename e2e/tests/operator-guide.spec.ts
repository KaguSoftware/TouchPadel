/**
 * The workspace guides (apps/operator features/guide): one dialog per worker
 * workspace, opened from the rail footer (court desk, till, Touch Shop) or the
 * kitchen board's key legend.
 *
 *  (a) cashier: open from the rail, tick a step, reload and it is still
 *      ticked, "Go there" lands on Open tabs, and Esc hands focus back to the
 *      rail row;
 *  (b) kitchen (prep login): open from the legend's pill, the dialog wears the
 *      board's dark tone, 1 and S do nothing to the tickets behind it, Esc
 *      closes it;
 *  (c) court desk: the rail row opens the desk's guide;
 *  (d) @ar: the till's guide in Arabic, the rail row on the inline start side.
 *
 * Nothing here writes to the database: the ticks live in the station's
 * localStorage (touch-operator-guide:<staff id>), cleared per test context.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { OPERATOR_URL as CONFIG_OPERATOR_URL } from '../playwright.config';
import { DEV_PASSWORD, SEED_STAFF } from './helpers';

const OPERATOR_URL = process.env.E2E_OPERATOR_URL ?? CONFIG_OPERATOR_URL;

async function signIn(browser: Browser, email: string, locale: 'en' | 'ar' = 'en'): Promise<Page> {
  const context = await browser.newContext({ locale: locale === 'ar' ? 'ar-IQ' : 'en-US' });
  await context.addInitScript((l) => {
    try {
      localStorage.setItem('touch-operator-locale', l);
    } catch {
      /* no storage */
    }
  }, locale);
  const page = await context.newPage();
  await page.goto(`${OPERATOR_URL}/`);
  const emailBox = page.locator('input[type="email"]');
  await emailBox.waitFor({ timeout: 30_000 });
  await emailBox.fill(email);
  await page.locator('input[type="password"]').fill(DEV_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 30_000 });
  return page;
}

test.describe('workspace guides', () => {
  test('(a) cashier: open, tick, reload, Go there, Esc', async ({ browser }) => {
    const page = await signIn(browser, SEED_STAFF.cashier);
    const row = page.getByTestId('rail.guide');
    await expect(row).toBeVisible();
    await row.click();

    const dialog = page.getByRole('dialog', { name: 'Till guide' });
    await expect(dialog).toBeVisible();
    const progress = dialog.getByTestId('guide-progress');
    await expect(progress).toHaveText(/^0 of \d+ learned$/);

    const first = dialog.getByTestId('guide-step').first();
    await first.getByRole('checkbox', { name: 'I know this' }).check();
    await expect(progress).toHaveText(/^1 of \d+ learned$/);

    // The tick is kept per person on this station.
    await page.reload();
    await page.getByTestId('rail.guide').click();
    await expect(dialog).toBeVisible();
    await expect(progress).toHaveText(/^1 of \d+ learned$/);
    await expect(dialog.getByTestId('guide-step').first().getByRole('checkbox')).toBeChecked();

    // Go there: the merge step links to Open tabs and the dialog gets out of the way.
    await dialog.getByRole('tab', { name: /Corrections/ }).click();
    await dialog.locator('[data-step-id="cashier.fix.merge"]').getByRole('button', { name: 'Go there' }).click();
    await expect(page).toHaveURL(/\/till\/tabs/);
    await expect(dialog).toBeHidden();

    // Esc closes and hands focus back to the row that opened it.
    await page.getByTestId('rail.guide').click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('rail.guide')).toBeFocused();
    await page.context().close();
  });

  test('(b) kitchen: the legend pill, the dark tone, and keys stay off the board', async ({ browser }) => {
    const page = await signIn(browser, SEED_STAFF.prep);
    await expect(page.getByTestId('kitchen-display')).toBeVisible({ timeout: 30_000 });
    // The board has no rail: the guide is the legend's pill.
    await expect(page.getByTestId('rail.guide')).toHaveCount(0);
    const pill = page.getByTestId('key-legend').getByTestId('kds-guide');
    await expect(pill).toBeVisible();

    const cards = page.getByTestId('ticket-card');
    const before = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-status')));

    await pill.click();
    const dialog = page.getByRole('dialog', { name: 'Kitchen guide' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-tone', 'board');

    // Keys pressed inside the guide never reach the tickets behind it.
    await page.keyboard.press('1');
    await page.keyboard.press('s');
    await expect(page.locator('[data-testid="ticket-card"][data-selected]')).toHaveCount(0);
    expect(await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-status')))).toEqual(before);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // ? opens it again from the board itself.
    await page.keyboard.press('?');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.context().close();
  });

  test('(c) court desk: the rail row opens the desk guide', async ({ browser }) => {
    const page = await signIn(browser, SEED_STAFF.court_desk);
    await page.getByTestId('rail.guide').click();
    const dialog = page.getByRole('dialog', { name: 'Court desk guide' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('tab', { name: /Bookings/ })).toBeVisible();
    await dialog.getByTestId('guide-close').click();
    await expect(dialog).toBeHidden();
    await page.context().close();
  });

  test('(d) the till guide in Arabic @ar', async ({ browser }) => {
    const page = await signIn(browser, SEED_STAFF.cashier, 'ar');
    const row = page.getByTestId('rail.guide');
    await expect(row).toBeVisible();
    // RTL: the rail, and so the row, sits on the right-hand side of the window.
    const box = await row.boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    expect(box && box.x > width / 2).toBe(true);

    await row.click();
    const dialog = page.getByRole('dialog', { name: 'دليل الصندوق' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('guide-progress')).toHaveText(/^تعلّمت 0 من \d+$/);
    await dialog.getByTestId('guide-step').first().getByRole('checkbox', { name: 'أعرف هذا' }).check();
    await expect(dialog.getByTestId('guide-progress')).toHaveText(/^تعلّمت 1 من \d+$/);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.context().close();
  });
});
