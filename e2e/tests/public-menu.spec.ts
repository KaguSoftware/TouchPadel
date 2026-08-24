/**
 * Public web surfaces: /{locale} landing + /{locale}/menu, bilingual fixture
 * content, correct dir attributes, and no horizontal scroll on a mobile
 * viewport.
 */
import { test, expect, type Page } from '@playwright/test';

const MOBILE = { width: 390, height: 844 };

async function assertNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow, 'page must not scroll horizontally on mobile').toBeLessThanOrEqual(1);
}

test.describe('public pages (EN)', () => {
  test.use({ viewport: MOBILE });

  test('landing renders and is LTR', async ({ page }) => {
    await page.goto('/en');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'en');
    await expect(html).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('heading', { name: 'Padel, coffee, community.' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole('link', { name: 'View the cafe menu' })).toBeVisible();
    await assertNoHorizontalScroll(page);
  });

  test('menu renders fixture categories and items', async ({ page }) => {
    await page.goto('/en/menu');
    await expect(page.getByRole('heading', { name: 'Touch Cafe Menu' })).toBeVisible({
      timeout: 60_000,
    });
    for (const cat of ['Hot Drinks', 'Cold Drinks', 'Breakfast', 'Mains', 'Desserts', 'Snacks']) {
      await expect(page.getByRole('heading', { name: cat, exact: true })).toBeVisible();
    }
    await expect(page.getByText('Cappuccino', { exact: true })).toBeVisible();
    await expect(page.getByText('Turkish Coffee', { exact: true })).toBeVisible();
    // Ordering-is-not-paying notice on every cafe surface (SOW).
    await expect(
      page.getByText('Ordering here is not payment', { exact: false }).first(),
    ).toBeVisible();
    await assertNoHorizontalScroll(page);
  });
});

test.describe('public pages (AR) @ar', () => {
  test.use({ viewport: MOBILE });

  test('landing renders and is RTL', async ({ page }) => {
    await page.goto('/ar');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', 'ar');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'بادل، قهوة، ومجتمع.' })).toBeVisible({
      timeout: 60_000,
    });
    await assertNoHorizontalScroll(page);
  });

  test('menu renders Arabic fixture categories and items', async ({ page }) => {
    await page.goto('/ar/menu');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { name: 'قائمة تتش كافيه' })).toBeVisible({
      timeout: 60_000,
    });
    for (const cat of ['مشروبات ساخنة', 'مشروبات باردة', 'الفطور', 'الحلويات']) {
      await expect(page.getByRole('heading', { name: cat, exact: true })).toBeVisible();
    }
    await expect(page.getByText('كابتشينو', { exact: true })).toBeVisible();
    await assertNoHorizontalScroll(page);
  });
});
