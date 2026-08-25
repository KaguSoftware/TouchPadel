/**
 * The guest menu must react to operator edits WITHOUT a reload: 0033 broadcasts
 * `menu_changed` / `settings_changed`, the guest debounces and refetches.
 *
 * This drives the DB directly through the same RPCs the operator admin calls,
 * so a regression in either the trigger or the guest listener fails here.
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SEED_STAFF, appRpc, channelJoined, serviceClient, signedInClient } from './helpers';

// Fixture ids (packages/db/fixtures/menu.sql).
const MIXED_NUTS = 'f1f70000-0000-4000-8000-00000000e030'; // seeded sold_out
const TURKISH_COFFEE = 'f1f70000-0000-4000-8000-00000000e004';

test.describe('live menu updates', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  let svc: SupabaseClient;
  let manager: SupabaseClient;

  test.beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
  });

  test.afterAll(async () => {
    // Restore the fixture state so reruns (and the other suites) stay honest.
    await appRpc(manager, 'set_item_sold_out', { p_item_id: TURKISH_COFFEE, p_sold_out: false });
    await appRpc(manager, 'set_item_sold_out', { p_item_id: MIXED_NUTS, p_sold_out: true });
    await manager.auth.signOut();
  });

  test('a sold-out toggle reaches an open guest page over broadcast', async ({ page }) => {
    await appRpc(manager, 'set_item_sold_out', { p_item_id: TURKISH_COFFEE, p_sold_out: false });

    const joined = channelJoined(page);
    await page.goto('/en');
    const card = page.locator('.tp-menu-item', { hasText: 'Turkish Coffee' }).first();
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).not.toHaveAttribute('data-sold-out', 'true');
    await joined;

    // Operator 86s the item — no reload on the guest side.
    await appRpc(manager, 'set_item_sold_out', { p_item_id: TURKISH_COFFEE, p_sold_out: true });
    await expect(card).toHaveAttribute('data-sold-out', 'true', { timeout: 20_000 });
    await expect(card.locator('.tp-stamp')).toHaveText('Sold out');

    // A sold-out card is not orderable — it must not open an addable sheet.
    await expect(card).not.toHaveAttribute('role', 'button');

    // ...and back again.
    await appRpc(manager, 'set_item_sold_out', { p_item_id: TURKISH_COFFEE, p_sold_out: false });
    await expect(card).not.toHaveAttribute('data-sold-out', 'true', { timeout: 20_000 });
  });

  test('the fixture sold-out item renders its stamp from SSR', async ({ page }) => {
    await appRpc(manager, 'set_item_sold_out', { p_item_id: MIXED_NUTS, p_sold_out: true });
    await page.goto('/en');
    const nuts = page.locator('.tp-menu-item', { hasText: 'Mixed Nuts' }).first();
    await expect(nuts).toHaveAttribute('data-sold-out', 'true', { timeout: 60_000 });
  });

  test('a ticker settings change reaches the guest page', async ({ page }) => {
    const owner = await signedInClient(SEED_STAFF.owner);
    try {
      const joined = channelJoined(page);
      await page.goto('/en');
      await expect(page.locator('.tp-ticker__item').first()).toBeVisible({ timeout: 60_000 });
      await joined;

      const phrase = `Live check ${Date.now()}`;
      await appRpc(owner, 'set_cafe_setting', {
        p_key: 'ticker_en',
        p_value: [phrase, 'Pay at the desk'],
      });
      await expect(page.locator('.tp-ticker__item', { hasText: phrase }).first()).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      // Restore the fixture ticker.
      await appRpc(owner, 'set_cafe_setting', {
        p_key: 'ticker_en',
        p_value: ['Fresh beans roasted weekly', 'Pay at the desk', 'Free Wi-Fi: touchcafe'],
      });
      await owner.auth.signOut();
    }
  });
});
