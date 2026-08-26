/**
 * RTL layout guard for the guest cafe app @ar.
 *
 * The brand chrome is full of things that leak in Arabic if a physical property
 * sneaks in: the white swoosh band, the featured marquee, the ticker, the
 * category rail's mask fade and the bell FAB. These assertions are geometric,
 * not textual — they fail on a broken layout even when every string is right.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';

const MOBILE = { width: 390, height: 844 };

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return Math.max(el.scrollWidth - el.clientWidth, document.body.scrollWidth - el.clientWidth);
  });
}

/** Every element must stay inside the viewport on both edges. */
async function assertWithinViewport(locator: Locator, name: string) {
  const box = await locator.boundingBox();
  expect(box, `${name} must be laid out`).not.toBeNull();
  expect(box!.x, `${name} must not overflow the start edge`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${name} must not overflow the end edge`).toBeLessThanOrEqual(
    MOBILE.width + 1,
  );
}

test.describe('cafe RTL layout @ar', () => {
  test.use({ viewport: MOBILE });

  test.beforeEach(async ({ page }) => {
    await page.goto('/ar');
    await expect(page.getByText('كابتشينو', { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });
  });

  test('chrome is RTL and nothing overflows horizontally', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await assertWithinViewport(page.locator('.tp-cafe__topbar').first(), 'top bar');
    await assertWithinViewport(page.locator('.tp-hero__band').first(), 'swoosh band');
    // The ticker TRACK is deliberately wider than the viewport (it is the
    // marquee); its clipping container is what must stay put.
    await assertWithinViewport(page.locator('.tp-ticker').first(), 'ticker');
  });

  test('the bell FAB flips to the inline-start side in Arabic', async ({ page }) => {
    // .tp-fab--bell is pinned with inset-inline-START, so it sits left in
    // English and RIGHT in Arabic — and never on top of the scroll-top FAB,
    // which is pinned inline-end.
    const bell = page.getByRole('button', { name: 'استدعاء النادل' });
    await expect(bell).toBeVisible();
    const box = (await bell.boundingBox())!;
    expect(box.x, 'the bell must hug the inline-start (right) edge in Arabic').toBeGreaterThan(
      MOBILE.width / 2,
    );
    await assertWithinViewport(bell, 'bell FAB');
  });

  test('the featured marquee scrolls the RTL way and stays inside', async ({ page }) => {
    const marquee = page.locator('.tp-hero__marquee').first();
    await expect(marquee).toBeVisible();
    await assertWithinViewport(marquee, 'featured marquee');
    // --tp-dir-sign flips the animation instead of a second keyframe set.
    const sign = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--tp-dir-sign').trim(),
    );
    expect(sign, 'RTL must invert the marquee direction sign').toBe('-1');
  });

  test('the category rail scrolls without pushing the page sideways', async ({ page }) => {
    const rail = page.locator('.tp-cattabs').first();
    await expect(rail).toBeVisible();
    await rail.evaluate((el) => el.scrollBy({ left: -400 }));
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });

  test('an open item sheet stays within the viewport in Arabic', async ({ page }) => {
    await page.getByRole('button', { name: /كابتشينو/ }).first().click();
    const sheet = page.getByRole('dialog', { name: 'كابتشينو' });
    await expect(sheet).toBeVisible();
    await assertWithinViewport(sheet, 'item sheet');
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);
  });
});
