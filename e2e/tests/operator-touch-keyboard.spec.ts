/**
 * The on-screen keyboard of the touch stations (apps/operator
 * components/TouchKeyboard.tsx, owner call 2026-11-20): the café till and the
 * cashier are touch screens, so every field types with a finger.
 *
 *  (a) a cashier signs in with the on-screen keys alone, Enter included, on a
 *      till-sized screen: the keys stay under 40% of the height, and the field
 *      and the Sign in button stay above them;
 *  (b) the same on an 800×480 screen, where the keys shrink to fit;
 *  (c) a field already clear of the keys (the customer search at the top)
 *      moves nothing on the screen;
 *  (d) the floating keyboard button brings the keys up with no field touched;
 *  (e) @ar: in Arabic the keys open on the Arabic layout and type into the
 *      search.
 *
 * Contexts are touch contexts (hasTouch), and the keyboard is switched on in
 * the browser by its localStorage flag (in the Electron shell it is always
 * on). Nothing here writes to the database.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { OPERATOR_URL as CONFIG_OPERATOR_URL } from '../playwright.config';
import { DEV_PASSWORD, SEED_STAFF } from './helpers';

const OPERATOR_URL = process.env.E2E_OPERATOR_URL ?? CONFIG_OPERATOR_URL;
const keyboard = (page: Page) => page.getByTestId('osk');
const key = (page: Page, k: string) => keyboard(page).locator(`[data-osk-key="${k}"]`);

async function touchPage(browser: Browser, size: { width: number; height: number }, locale: 'en' | 'ar' = 'en'): Promise<Page> {
  const context = await browser.newContext({ viewport: size, hasTouch: true, locale: locale === 'ar' ? 'ar-IQ' : 'en-US' });
  await context.addInitScript((l) => {
    try {
      localStorage.setItem('touch-operator-osk', 'on');
      localStorage.setItem('touch-operator-locale', l);
    } catch {
      /* no storage */
    }
  }, locale);
  const page = await context.newPage();
  await page.goto(`${OPERATOR_URL}/`);
  await page.locator('input[type="email"]').waitFor({ timeout: 30_000 });
  return page;
}

/** Types with the on-screen keys only; a character missing from the letters is found on the symbols layer. */
async function typeOnKeys(page: Page, text: string): Promise<void> {
  for (const ch of text) {
    if ((await key(page, ch).count()) === 0) {
      await key(page, 'symbols').tap();
      await key(page, ch).first().tap();
      await key(page, 'letters').tap();
    } else {
      await key(page, ch).first().tap();
    }
  }
}

/** The keys' share of the window, and whether the field and the form's submit button are clear above them. */
async function fit(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[data-testid="osk"]')!.getBoundingClientRect();
    const field = (document.activeElement as HTMLElement).getBoundingClientRect();
    const submit = document.querySelector('button[type="submit"]')?.getBoundingClientRect() ?? null;
    const keys = Array.from(document.querySelectorAll('[data-testid="osk"] [data-osk-key]')).map((k) => k.getBoundingClientRect());
    return {
      share: panel.height / innerHeight,
      fieldClear: field.top >= 0 && field.bottom <= panel.top + 0.5,
      submitClear: submit === null || (submit.top >= 0 && submit.bottom <= panel.top + 0.5),
      keysOnScreen: keys.every((r) => r.left >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5),
    };
  });
}

/** The keys fit, and the field and the submit button are clear of them, once the screen has settled. */
async function expectFit(page: Page) {
  await expect.poll(() => fit(page), { timeout: 5_000 }).toEqual({ share: expect.any(Number), fieldClear: true, submitClear: true, keysOnScreen: true });
  expect((await fit(page)).share).toBeLessThanOrEqual(0.4);
}

async function signInByFill(page: Page) {
  await page.locator('input[type="email"]').fill(SEED_STAFF.cashier);
  await page.locator('input[type="password"]').fill(DEV_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 30_000 });
}

test.describe('on-screen keyboard (touch stations)', () => {
  test('(a) a cashier signs in with the on-screen keys alone', async ({ browser }) => {
    const page = await touchPage(browser, { width: 1366, height: 768 });
    await page.locator('input[type="email"]').tap();
    await expect(keyboard(page)).toBeVisible();
    await expect(keyboard(page)).toHaveAttribute('data-osk-kind', 'email');
    await typeOnKeys(page, SEED_STAFF.cashier);
    await expect(page.locator('input[type="email"]')).toHaveValue(SEED_STAFF.cashier);

    await page.locator('input[type="password"]').tap();
    await expectFit(page);

    await typeOnKeys(page, DEV_PASSWORD);
    await key(page, 'enter').tap();
    await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 30_000 });
    // The field went with the sign-in screen, and so did the keys and the room they took.
    await expect(keyboard(page)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--tp-osk-inset'))).toBe('');
    await page.context().close();
  });

  test('(b) on an 800×480 screen the keys shrink to fit and keep the form in reach', async ({ browser }) => {
    const page = await touchPage(browser, { width: 800, height: 480 });
    await page.locator('input[type="password"]').tap();
    await expect(keyboard(page)).toBeVisible();
    await expectFit(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.context().close();
  });

  test('(c) a field already clear of the keys moves nothing', async ({ browser }) => {
    const page = await touchPage(browser, { width: 1366, height: 768 });
    await signInByFill(page);
    await page.getByRole('link', { name: 'Customers' }).first().click();
    const search = page.locator('main input, input[type="search"]').first();
    await search.waitFor({ timeout: 30_000 });
    await search.tap();
    await expect(keyboard(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--tp-osk-inset'))).toBe('');
    await typeOnKeys(page, 'ali');
    await expect(search).toHaveValue('ali');
    await page.context().close();
  });

  test('(d) the floating button brings the keys up with no field touched', async ({ browser }) => {
    const page = await touchPage(browser, { width: 1366, height: 768 });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(keyboard(page)).toHaveCount(0);
    await page.getByTestId('osk-button').tap();
    await expect(keyboard(page)).toBeVisible();
    await expect(page.getByTestId('osk-button')).toHaveCount(0);
    await key(page, 'hide').tap();
    await expect(keyboard(page)).toHaveCount(0);
    await expect(page.getByTestId('osk-button')).toBeVisible();
    await page.context().close();
  });

  test('(e) @ar the keys open on the Arabic layout and type into the search', async ({ browser }) => {
    const page = await touchPage(browser, { width: 1366, height: 768 }, 'ar');
    await signInByFill(page);
    await page.getByRole('link', { name: 'الزبائن' }).first().click();
    const search = page.locator('main input, input[type="search"]').first();
    await search.waitFor({ timeout: 30_000 });
    await search.tap();
    await expect(keyboard(page)).toHaveAttribute('data-osk-lang', 'ar');
    await typeOnKeys(page, 'محمد');
    await expect(search).toHaveValue('محمد');
    await page.context().close();
  });
});
