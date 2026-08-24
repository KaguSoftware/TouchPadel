/**
 * Flagship guest cafe journey: QR token -> table binding -> menu -> item with
 * size + modifier -> basket -> order -> LIVE status (broadcast) -> waiter call
 * with cooldown -> resolution. Then the Arabic (RTL) variant.
 *
 * Staff-side transitions run through real app.* RPCs with seeded staff
 * accounts (prep bumps the ticket, owner resolves the waiter call).
 */
import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SEED_STAFF,
  appRpc,
  clearWaiterCalls,
  ensureOpenDay,
  ensureTillFresh,
  fixtureTableId,
  latestOrderForTable,
  mintTableToken,
  openWaiterCall,
  serviceClient,
  signedInClient,
  voidOpenTabsForTable,
} from './helpers';

const EN_TABLE = fixtureTableId(3); // T3
const AR_TABLE = fixtureTableId(4); // T4

test.describe('guest cafe journey (EN)', () => {
  let svc: SupabaseClient;
  let token: string;

  test.beforeAll(async () => {
    svc = serviceClient();
    await ensureTillFresh(svc);
    await ensureOpenDay(svc);
    await clearWaiterCalls(svc, EN_TABLE);
    await voidOpenTabsForTable(svc, EN_TABLE);
    token = await mintTableToken(EN_TABLE);
  });

  test('order + live status + waiter call lifecycle', async ({ page }) => {
    // ---- table binds ------------------------------------------------------
    await page.goto(`/en/t/${token}`);
    await expect(page.locator('.tp-cafe__table')).toContainText('T3', { timeout: 60_000 });
    await expect(page.getByText('Ordering here is not payment', { exact: false })).toBeVisible();

    // ---- browse menu ------------------------------------------------------
    await page.getByRole('button', { name: 'Hot Drinks' }).click();
    await page.getByRole('button', { name: /Cappuccino/ }).click();

    // ---- item sheet: size + modifier -------------------------------------
    const sheet = page.getByRole('dialog', { name: 'Cappuccino' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('radio', { name: /Large/ }).check();
    await sheet.getByRole('radio', { name: /Oat Milk/ }).check();
    // Large 5,000 + oat milk 1,000
    await sheet.getByRole('button', { name: /Add to order/ }).click();
    await expect(page.getByText('Added to your basket.')).toBeVisible();

    // ---- basket + place order --------------------------------------------
    await page.getByRole('button', { name: /Basket · 1/ }).click();
    const basket = page.getByRole('dialog', { name: 'Your basket' });
    await expect(basket).toContainText('Cappuccino');
    await expect(basket).toContainText('Large');
    await expect(basket).toContainText('Oat Milk');
    await basket.getByRole('button', { name: 'Place order' }).click();
    await expect(page.getByText('Order sent — it is on its way to the kitchen.')).toBeVisible();

    // ---- status card: sent/received --------------------------------------
    await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
    const status = page.locator('.tp-order__status').first();
    await expect(status).toHaveText('Received');

    // ---- staff bump the ticket; guest page updates LIVE (broadcast) -------
    const { ticketId } = await latestOrderForTable(svc, EN_TABLE);
    const prep = await signedInClient(SEED_STAFF.prep);
    try {
      await appRpc(prep, 'set_ticket_status', { p_ticket_id: ticketId, p_status: 'preparing' });
      await expect(status).toHaveText('Preparing', { timeout: 20_000 });
      await appRpc(prep, 'set_ticket_status', { p_ticket_id: ticketId, p_status: 'ready' });
      await expect(status).toHaveText('Ready', { timeout: 20_000 });
    } finally {
      await prep.auth.signOut();
    }

    // ---- waiter call ------------------------------------------------------
    await page.getByRole('button', { name: 'Call a waiter' }).click();
    const waiterSheet = page.getByRole('dialog', { name: 'Call a waiter' });
    await waiterSheet.getByRole('button', { name: 'Water' }).click();
    // Banner (and a transient toast) share the same string.
    await expect(page.getByText('A member of staff is on their way.').first()).toBeVisible();

    // ---- second call inside the window -> cooldown feedback ---------------
    await page.getByRole('button', { name: 'Call a waiter' }).click();
    await waiterSheet.getByRole('button', { name: 'The bill' }).click();
    await expect(
      page.getByText('Staff have already been notified for this table.'),
    ).toBeVisible();

    // ---- staff resolve; guest page reflects it (20s poll) -----------------
    const call = await openWaiterCall(svc, EN_TABLE);
    const owner = await signedInClient(SEED_STAFF.owner);
    try {
      await appRpc(owner, 'resolve_waiter_call', { p_call_id: call.id });
    } finally {
      await owner.auth.signOut();
    }
    // The persistent "staff on their way" banner clears once the guest's
    // 20-second poll observes status=resolved.
    await expect(page.getByText('A member of staff is on their way.')).toHaveCount(0, {
      timeout: 45_000,
    });
  });
});

test.describe('guest cafe journey (AR) @ar', () => {
  let token: string;

  test.beforeAll(async () => {
    const svc = serviceClient();
    await ensureTillFresh(svc);
    await clearWaiterCalls(svc, AR_TABLE);
    token = await mintTableToken(AR_TABLE);
  });

  test('binds RTL and renders Arabic menu', async ({ page }) => {
    await page.goto(`/ar/t/${token}`);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(html).toHaveAttribute('lang', 'ar');

    // Cafe brand + table label in Arabic
    await expect(page.getByText('تتش كافيه').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.tp-cafe__table')).toContainText('T4');
    await expect(page.getByText('الطلب هنا لا يعني الدفع', { exact: false })).toBeVisible();

    // Arabic category + item; sheet renders Arabic size/modifier/CTA strings
    await page.getByRole('button', { name: 'مشروبات ساخنة' }).click();
    await page.getByRole('button', { name: /كابتشينو/ }).click();
    const sheet = page.getByRole('dialog', { name: 'كابتشينو' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('كبير').first()).toBeVisible(); // Large
    await expect(sheet.getByText('حليب شوفان').first()).toBeVisible(); // Oat Milk
    await expect(sheet.getByRole('button', { name: /أضف إلى الطلب/ })).toBeVisible();
  });
});
