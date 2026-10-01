/**
 * The payment return page, `/{locale}/pay/return?ref=…`: where Qi's hosted payment page
 * sends the guest's browser (docs/design/payments/qi-deposit-plan-2026-09-20.md §6, §11).
 *
 * What only a real server and browser can prove: both locales answer 200 with `noindex`,
 * uncached and with no cookie set; the Open the app button carries the app link with the
 * ref; nothing on the page says "paid" or "success" (it cannot know the result); Arabic is
 * right to left; nothing scrolls sideways at 360 px; "Don't have the app?" lands on the
 * home page's app band. These projects are desktop Chrome, which is exactly the visitor the
 * page must NOT bounce into the scheme (plan §10 row 34): it has to stay put and explain.
 * The phone-side hop is OpenAppOnLoad.test.tsx.
 */
import { test, expect, type Page } from '@playwright/test';

const REF = '7c1d2a44-0f3e-4b8a-9d61-2f5e8c9a1b30';
const SMALL = { width: 360, height: 740 };
const RESULT_EN = /\b(paid|success\w*|succeed\w*|approved|declined|failed|confirmed)\b/i;
const RESULT_AR = /دفع|مدفوع|نجح|نجاح|ناجح|مقبول|مرفوض|فشل|اكتمل|مكتمل|تأكد|مؤكد/;

async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText.replace(/[ً-ْٰ]/g, ''));
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return Math.max(el.scrollWidth - el.clientWidth, document.body.scrollWidth - el.clientWidth);
  });
}

test.describe('pay return page', () => {
  test('answers 200, never indexed, uncached, no cookie; the button opens the app with the ref', async ({
    page,
  }) => {
    const res = await page.goto(`/en/pay/return?ref=${REF}`);
    expect(res?.status()).toBe(200);
    const headers = res?.headers() ?? {};
    expect(headers['set-cookie']).toBeUndefined();
    // force-dynamic: Next's own value for a dynamic page (`no-cache, must-revalidate` under
    // dev, and on the wire for /en/t, proxy.ts). Never a copy a shared cache may serve.
    expect(headers['cache-control'] ?? '').toMatch(/no-cache|no-store/);
    expect(headers['cache-control'] ?? '').not.toMatch(/public|s-maxage/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /nofollow/);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Return to the Touch Padel app to see your booking',
    );
    await expect(page.getByRole('link', { name: 'Open the app' })).toHaveAttribute(
      'href',
      `touchpadel://pay/return?ref=${REF}`,
    );
    // Desktop: the page stays where it is instead of bouncing into a scheme nothing handles.
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe('/en/pay/return');
    expect(await visibleText(page)).not.toMatch(RESULT_EN);
  });

  test('"Don\'t have the app?" lands on the app band of the home page', async ({ page }) => {
    await page.goto(`/en/pay/return?ref=${REF}`);
    await page.getByRole('link', { name: 'Don’t have the app?' }).click();
    await expect(page).toHaveURL(/\/en#app$/);
    await expect(page.locator('#app.tp-appband')).toHaveCount(1);
  });

  test('drops a ref that is not a UUID', async ({ page }) => {
    const res = await page.goto('/en/pay/return?ref=%22%3E%3Cscript%3Ealert(1)%3C/script%3E');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('link', { name: 'Open the app' })).toHaveAttribute(
      'href',
      'touchpadel://pay/return',
    );
  });

  test('fits a 360 px phone without scrolling sideways', async ({ page }) => {
    await page.setViewportSize(SMALL);
    await page.goto(`/en/pay/return?ref=${REF}`);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe('pay return page @ar', () => {
  test('Arabic, right to left, the same app link, no result words', async ({ page }) => {
    const res = await page.goto(`/ar/pay/return?ref=${REF}`);
    expect(res?.status()).toBe(200);
    expect(res?.headers()['set-cookie']).toBeUndefined();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'ارجع إلى تطبيق تتش بادل لترى حجزك',
    );
    await expect(page.getByRole('link', { name: 'افتح التطبيق' })).toHaveAttribute(
      'href',
      `touchpadel://pay/return?ref=${REF}`,
    );
    expect(await visibleText(page)).not.toMatch(RESULT_AR);
    await page.setViewportSize(SMALL);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
