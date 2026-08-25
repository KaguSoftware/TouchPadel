/**
 * The site root IS the cafe app (owner decision: the padel landing was dropped).
 *
 * Covers the routing contract from web-slice §1 — Arabic default, locale
 * negotiation, the legacy /menu alias, server-rendered menu content — and the
 * scan-gate: a guest with no table may browse everything but may not send an
 * order or ring the bell.
 */
import { test, expect, type Page } from '@playwright/test';

const MOBILE = { width: 390, height: 844 };

async function assertNoHorizontalScroll(page: Page) {
  // The app shell is position:fixed with ONE inner scroller, so overflow here
  // means a child broke out (the classic RTL marquee / swoosh regression).
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return Math.max(el.scrollWidth - el.clientWidth, document.body.scrollWidth - el.clientWidth);
  });
  expect(overflow, 'page must not scroll horizontally on mobile').toBeLessThanOrEqual(1);
}

test.describe('cafe at the site root', () => {
  test.use({ viewport: MOBILE });

  test('/ falls back to Arabic when the browser asks for nothing we speak', async ({ browser }) => {
    // No tp-locale cookie and an Accept-Language we do not support must land on
    // Arabic — the owner's default, not the developer's.
    const ctx = await browser.newContext({ locale: 'fr-FR' });
    const page = await ctx.newPage();
    const res = await page.goto('/');
    expect(new URL(page.url()).pathname).toBe('/ar');
    expect(res?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await ctx.close();
  });

  test('/ follows Accept-Language when it names a supported locale', async ({ browser }) => {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'accept-language': 'en-GB,en;q=0.9' } });
    const page = await ctx.newPage();
    await page.goto('/');
    expect(new URL(page.url()).pathname).toBe('/en');
    await ctx.close();
  });

  test('/en/menu is a permanent redirect to /en', async ({ page }) => {
    const res = await page.goto('/en/menu');
    expect(new URL(page.url()).pathname).toBe('/en');
    // 308 on the redirect hop itself (Playwright reports the final response).
    const chain = res?.request().redirectedFrom();
    expect(chain, 'the alias must redirect, not render').not.toBeNull();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('the menu is server-rendered — readable with JavaScript disabled', async ({ browser }) => {
    // The Vercel incident lesson: the menu must paint from SSR, never depend on
    // the anonymous sign-in or any client fetch.
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: MOBILE });
    const page = await ctx.newPage();
    await page.goto('/ar');
    await expect(page.getByText('كابتشينو', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('مشروبات ساخنة').first()).toBeVisible();
    await ctx.close();
  });

  test('EN root renders the fixture menu and the pay-at-desk notice', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByText('Cappuccino', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    for (const cat of ['Hot Drinks', 'Cold Drinks', 'Breakfast', 'Desserts']) {
      await expect(page.getByRole('button', { name: cat, exact: true }).first()).toBeVisible();
    }
    await assertNoHorizontalScroll(page);
  });

  test('no table: sending the basket asks for the QR instead of ordering', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByText('Cappuccino', { exact: true }).first()).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: /Cappuccino/ }).first().click();
    const sheet = page.getByRole('dialog', { name: 'Cappuccino' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: /Add to order/ }).click();

    await page.getByRole('button', { name: /Basket · 1/ }).click();
    const basket = page.getByRole('dialog', { name: 'Your basket' });
    await basket.getByRole('button', { name: 'Send to waiter' }).click();

    // Scan-gate, not an error: the basket survives so the guest can scan and send.
    const qr = page.getByRole('dialog', { name: 'Scan the QR on your table' });
    await expect(qr).toBeVisible();
    await expect(qr).toContainText('Your basket is saved');
    await assertNoHorizontalScroll(page);
  });

  test('no table: the bell is gated the same way', async ({ page }) => {
    await page.goto('/en');
    await expect(page.getByText('Cappuccino', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Call a waiter' }).click();
    await expect(page.getByRole('dialog', { name: 'Scan the QR on your table' })).toBeVisible();
  });

  test('analytics stays silent without a PostHog key', async ({ page }) => {
    const posthogHits: string[] = [];
    page.on('request', (r) => {
      if (/posthog\.com/i.test(r.url())) posthogHits.push(r.url());
    });
    await page.goto('/en');
    await expect(page.getByText('Cappuccino', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: /Cappuccino/ }).first().click();
    await page.waitForTimeout(3_000); // past the idle-load window
    expect(posthogHits, 'unconfigured analytics must not phone home').toEqual([]);
  });
});

test.describe('cafe at the site root (AR) @ar', () => {
  test.use({ viewport: MOBILE });

  test('Arabic root is RTL, branded and horizontally clean', async ({ page }) => {
    await page.goto('/ar');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(html).toHaveAttribute('lang', 'ar');
    await expect(page.getByText('كابتشينو', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    // Featured hero (fixture: Kahi at −15%).
    await expect(page.locator('.tp-hero__discount, .tp-hero__badge').first()).toBeVisible();
    await assertNoHorizontalScroll(page);
  });

  test('the locale switcher keeps you on the cafe app', async ({ page }) => {
    await page.goto('/ar');
    await expect(page.getByText('كابتشينو', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('link', { name: 'English' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(new URL(page.url()).pathname).toBe('/en');
  });
});
