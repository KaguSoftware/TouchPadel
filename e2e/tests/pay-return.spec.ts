/**
 * The payment return page, `/{locale}/pay/return?ref=…`: where Qi's hosted payment page
 * sends the guest's browser (docs/design/payments/qi-deposit-plan-2026-09-20.md §6, §11).
 *
 * This build takes no online payment (F-02/F-03, Majed 2026-11-01): `NEXT_PUBLIC_ONLINE_PAYMENTS`
 * is unset, here as in production, so any visit is a stray one (an old link, a bookmark). The
 * page then says online payment is not available and that the desk takes payment, offers the
 * way home, and neither reads the ref nor hands anything to the app
 * (`apps/web/src/lib/site/payments.ts`). The payments-on page (Open the app with the ref, the
 * automatic hop on a phone, "Don't have the app?") is covered by page.test.tsx and
 * OpenAppOnLoad.test.tsx until a reviewed release turns the switch on.
 *
 * What only a real server and browser can prove: both locales answer 200 with `noindex`,
 * uncached and with no cookie set; the off copy, with no app link and no ref anywhere in the
 * document; nothing on the page states a payment result; Arabic is right to left; nothing
 * scrolls sideways at 360 px; the home link lands on the home page.
 */
import { test, expect, type Page } from '@playwright/test';
import { en } from '../../packages/i18n/src/catalogs/en';
import { ar } from '../../packages/i18n/src/catalogs/ar';

const REF = '7c1d2a44-0f3e-4b8a-9d61-2f5e8c9a1b30';
const SMALL = { width: 360, height: 740 };
const RESULT_EN = /\b(paid|success\w*|succeed\w*|approved|declined|failed|confirmed)\b/i;
const RESULT_AR = /دفع|مدفوع|نجح|نجاح|ناجح|مقبول|مرفوض|فشل|اكتمل|مكتمل|تأكد|مؤكد/;

async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText.replace(/[ً-ْٰ]/g, ''));
}

/** Every link's raw href on the page. */
async function linkTargets(page: Page): Promise<string[]> {
  return page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return Math.max(el.scrollWidth - el.clientWidth, document.body.scrollWidth - el.clientWidth);
  });
}

test.describe('pay return page', () => {
  test('answers 200, never indexed, uncached, no cookie; says payment is at the desk, with no app link', async ({
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

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.site.payReturn.off.title);
    await expect(page.getByText(en.site.payReturn.off.body)).toBeVisible();
    await expect(page.getByRole('link', { name: en.site.payReturn.open })).toHaveCount(0);
    // The ref is neither read nor forwarded, and no link points at the app's scheme.
    const links = await linkTargets(page);
    expect(links.filter((href) => href.startsWith('touchpadel:'))).toEqual([]);
    expect(links.filter((href) => href.includes(REF))).toEqual([]);
    expect(await visibleText(page)).not.toContain(REF);
    // The page stays where it is: no script sends the browser anywhere.
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe('/en/pay/return');
    expect(await visibleText(page)).not.toMatch(RESULT_EN);
  });

  test('the home link lands on the home page', async ({ page }) => {
    await page.goto(`/en/pay/return?ref=${REF}`);
    await page.locator('main').getByRole('link', { name: en.site.error.home }).click();
    await expect(page).toHaveURL(/\/en$/);
  });

  test('never echoes a ref, even one that is not a UUID', async ({ page }) => {
    const res = await page.goto('/en/pay/return?ref=%22%3E%3Cscript%3Ealert(1)%3C/script%3E');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.site.payReturn.off.title);
    // No script element of the ref's own (the address may sit, escaped, in Next's own data).
    const injected = await page
      .locator('script')
      .evaluateAll((scripts) => scripts.filter((el) => el.textContent?.trim() === 'alert(1)').length);
    expect(injected).toBe(0);
    expect((await linkTargets(page)).filter((href) => href.includes('alert'))).toEqual([]);
  });

  test('fits a 360 px phone without scrolling sideways', async ({ page }) => {
    await page.setViewportSize(SMALL);
    await page.goto(`/en/pay/return?ref=${REF}`);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe('pay return page @ar', () => {
  test('Arabic, right to left, the same desk words, no app link, no result words', async ({ page }) => {
    const res = await page.goto(`/ar/pay/return?ref=${REF}`);
    expect(res?.status()).toBe(200);
    expect(res?.headers()['set-cookie']).toBeUndefined();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(ar.site.payReturn.off.title);
    await expect(page.getByText(ar.site.payReturn.off.body)).toBeVisible();
    await expect(page.getByRole('link', { name: ar.site.payReturn.open })).toHaveCount(0);
    expect((await linkTargets(page)).filter((href) => href.startsWith('touchpadel:'))).toEqual([]);
    expect(await visibleText(page)).not.toMatch(RESULT_AR);
    await page.setViewportSize(SMALL);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
