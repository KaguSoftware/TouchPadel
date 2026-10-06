/**
 * The member's account on the website (loyalty plan §5.2, build contracts §5), signed out, as
 * the site specs run it (the web server on the local stack, no seeded member):
 *
 *  1. `/en/account` renders in the site shell: the heading, the sign-in form (phone and email,
 *     password, Sign in), never indexed, and no Google or Apple buttons while
 *     `NEXT_PUBLIC_WEB_OAUTH` is unset.
 *  2. A wrong password says so in the page's own words; nothing navigates away.
 *  3. The footer's Account link leads to it from the home page; nothing scrolls sideways at
 *     360 px.
 *  4. @ar: the same page in Arabic, right to left.
 *
 * The signed-in card (QR, points, history) is covered by the page's own vitest with a mocked
 * client; the till side of the token is the operator's operator-loyalty.spec.ts.
 */
import { test, expect, type Page } from '@playwright/test';
import { en } from '../../packages/i18n/src/catalogs/en';
import { ar } from '../../packages/i18n/src/catalogs/ar';

const SMALL = { width: 360, height: 740 };

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return Math.max(el.scrollWidth - el.clientWidth, document.body.scrollWidth - el.clientWidth);
  });
}

test.describe('site account (signed out)', () => {
  test('/en/account: the sign-in form, never indexed', async ({ page }) => {
    const response = await page.goto('/en/account');
    expect(response?.status()).toBe(200);
    const w = en.loyalty.web;
    await expect(page.getByRole('heading', { level: 1, name: w.account.title })).toBeVisible();
    await expect(page.getByLabel(w.signIn.phoneLabel)).toBeVisible();
    await expect(page.getByLabel(w.signIn.passwordLabel)).toBeVisible();
    await expect(page.getByRole('button', { name: w.signIn.submit })).toBeVisible();
    await expect(page.getByRole('button', { name: w.signIn.google })).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

    // Email is the other way in.
    await page.getByLabel(w.signIn.email, { exact: true }).check();
    await expect(page.getByLabel(w.signIn.emailLabel, { exact: true })).toBeVisible();
  });

  test('a wrong password is refused in the page’s own words', async ({ page }) => {
    await page.goto('/en/account');
    const w = en.loyalty.web;
    await page.getByLabel(w.signIn.phoneLabel).fill('0770 999 0001');
    await page.getByLabel(w.signIn.passwordLabel).fill('not-the-password');
    await page.getByRole('button', { name: w.signIn.submit }).click();
    // The e2e stack's auth server answers, so this is the credentials line. Next's route announcer
    // is an empty role=alert too, so the page's own alert is picked out by its text.
    await expect(
      page.getByRole('alert').filter({ hasText: w.signIn.errors.credentials }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/en\/account$/);
  });

  test('the footer links it; nothing scrolls sideways at 360 px', async ({ page }) => {
    await page.setViewportSize(SMALL);
    await page.goto('/en');
    await page
      .getByRole('contentinfo')
      .getByRole('link', { name: en.loyalty.web.account.navLink, exact: true })
      .click();
    await expect(page).toHaveURL(/\/en\/account$/);
    await expect(page.getByLabel(en.loyalty.web.signIn.phoneLabel)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('@ar /ar/account: Arabic, right to left', async ({ page }) => {
    const response = await page.goto('/ar/account');
    expect(response?.status()).toBe(200);
    const w = ar.loyalty.web;
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1, name: w.account.title })).toBeVisible();
    await expect(page.getByLabel(w.signIn.phoneLabel)).toBeVisible();
    await expect(page.getByLabel(w.signIn.passwordLabel)).toBeVisible();
    await expect(page.getByRole('button', { name: w.signIn.submit })).toBeVisible();
    await page.setViewportSize(SMALL);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});
