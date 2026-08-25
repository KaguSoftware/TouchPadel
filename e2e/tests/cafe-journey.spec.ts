/**
 * Flagship guest journey on the rebuilt cafe app: printed QR -> table binding ->
 * menu -> item sheet with a REVEALED modifier group -> basket (featured
 * discount) -> order -> live status over broadcast -> waiter call acknowledged
 * and resolved over broadcast. Then the Arabic (RTL) twin.
 *
 * Staff-side transitions run through the real app.* RPCs with seeded staff
 * accounts, exactly as the KDS and till would.
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
  startTillHeartbeat,
  voidOpenTabsForTable,
} from './helpers';

const EN_TABLE = fixtureTableId(3); // T3
const AR_TABLE = fixtureTableId(4); // T4

test.describe('guest cafe journey (EN)', () => {
  let svc: SupabaseClient;
  let token: string;
  let stopHeartbeat: () => void;

  test.beforeAll(async () => {
    svc = serviceClient();
    await ensureTillFresh(svc);
    await ensureOpenDay(svc);
    await clearWaiterCalls(svc, EN_TABLE);
    await voidOpenTabsForTable(svc, EN_TABLE);
    token = await mintTableToken(EN_TABLE);
    // The journey runs longer than heartbeat_stale_seconds (45s) — keep the
    // till alive or ordering degrades mid-test.
    stopHeartbeat = startTillHeartbeat(svc);
  });

  test.afterAll(() => stopHeartbeat?.());

  test('reveals + featured discount + order + live status', async ({ page }) => {
    // The printed URL is locale-less and must stay VERBATIM (rewrite, not
    // redirect) — a redirected URL would break reloads of the printed card.
    await page.goto(`/t/${token}`);
    expect(new URL(page.url()).pathname).toBe(`/t/${token}`);

    // The menu is server-rendered, so it is readable BEFORE the anonymous
    // sign-in binds the table.
    await expect(page.getByText('Cappuccino', { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('.tp-cafe__table')).toContainText('T3', { timeout: 60_000 });

    // ---- the first-scan bell coach mark AUTO-DISMISSES --------------------
    // Regression guard: its scrim covers the whole menu, so if the 6s timer is
    // ever restarted by a re-render the guest can never open an item again.
    const coach = page.getByRole('dialog', { name: 'Tap the bell to call a waiter' });
    await expect(coach).toBeVisible();
    await expect(coach).toHaveCount(0, { timeout: 15_000 });

    // ---- item sheet: a modifier that REVEALS a nested group (0028) ---------
    await page.getByRole('button', { name: /Beef Burger/ }).first().click();
    const burger = page.getByRole('dialog', { name: 'Beef Burger' });
    await expect(burger).toBeVisible();

    // "Pick a drink" is revealed by "Meal upgrade" — it must not exist yet.
    await expect(burger.getByRole('group', { name: /Pick a drink/ })).toHaveCount(0);
    await burger.getByRole('radio', { name: /Meal upgrade/ }).click();
    const revealed = burger.getByRole('group', { name: /Pick a drink/ });
    await expect(revealed).toBeVisible();

    // The revealed group is required (min 1) — the CTA stays blocked until picked.
    const addBurger = burger.getByRole('button', { name: /Add to order/ });
    await expect(addBurger).toBeDisabled();
    await revealed.getByRole('radio', { name: /Cola/ }).click();
    await expect(addBurger).toBeEnabled();

    // Un-picking the parent clears the revealed group (and its picks) transitively.
    await burger.getByRole('radio', { name: /Meal upgrade/ }).click();
    await expect(burger.getByRole('group', { name: /Pick a drink/ })).toHaveCount(0);
    await burger.getByRole('radio', { name: /Meal upgrade/ }).click();
    await burger
      .getByRole('group', { name: /Pick a drink/ })
      .getByRole('radio', { name: /Cola/ })
      .click();
    await addBurger.click();
    await expect(page.getByText('Added to your basket.')).toBeVisible();

    // ---- the featured item carries the operator's discount ----------------
    await page.getByRole('button', { name: /Kahi with Geymar/ }).first().click();
    const kahi = page.getByRole('dialog', { name: 'Kahi with Geymar' });
    await expect(kahi.locator('.tp-itemsheet__price--list')).toContainText('8,000');
    await kahi.getByRole('button', { name: /Add to order/ }).click();

    // ---- basket ------------------------------------------------------------
    await page.getByRole('button', { name: /Basket · 2/ }).click();
    const basket = page.getByRole('dialog', { name: 'Your basket' });
    await expect(basket).toContainText('Beef Burger');
    await expect(basket).toContainText('Meal upgrade');
    await expect(basket).toContainText('Cola');
    // Server-side featured pricing is previewed here (8,000 −15% = 6,800).
    await expect(basket).toContainText('Featured offer −15%');
    await expect(basket).toContainText('6,800');
    await expect(basket).toContainText('Ordering here is not payment');

    await basket.getByRole('button', { name: 'Send to waiter' }).click();
    await expect(page.getByText('Sent — a waiter has your order.')).toBeVisible({ timeout: 30_000 });

    // ---- live status over broadcast ---------------------------------------
    await page.getByRole('button', { name: /Preparing · 1 order/ }).click();
    const orders = page.getByRole('dialog', { name: 'Your orders' });
    const status = orders.locator('.tp-order__status').first();
    await expect(status).toHaveText('Received');

    const { ticketId, orderId } = await latestOrderForTable(svc, EN_TABLE);

    // The persisted order must carry the discount the guest was shown — the
    // server prices it, the client only previews it.
    const { data: lines } = await svc
      .from('order_items')
      .select('list_price_iqd, unit_price_iqd, discount_pct, discount_source')
      .eq('order_id', orderId)
      .eq('discount_source', 'featured');
    expect(lines?.length, 'the featured line must be discounted server-side').toBe(1);
    expect(lines?.[0]).toMatchObject({
      list_price_iqd: 8000,
      unit_price_iqd: 6800,
      discount_pct: 15,
    });

    const prep = await signedInClient(SEED_STAFF.prep);
    try {
      await appRpc(prep, 'set_ticket_status', { p_ticket_id: ticketId, p_status: 'preparing' });
      await expect(status).toHaveText('Preparing', { timeout: 20_000 });
      await appRpc(prep, 'set_ticket_status', { p_ticket_id: ticketId, p_status: 'ready' });
      await expect(status).toHaveText('Ready', { timeout: 20_000 });
    } finally {
      await prep.auth.signOut();
    }
    await orders.getByRole('button', { name: 'Close' }).click();

    // ---- waiter call: raised -> acknowledged -> done, all over broadcast ---
    await page.getByRole('button', { name: 'Call a waiter' }).click();
    const waiterSheet = page.getByRole('dialog', { name: 'Call a waiter' });
    await waiterSheet.getByRole('button', { name: 'Water' }).click();
    await expect(waiterSheet.getByText('A member of staff is on their way.')).toBeVisible({
      timeout: 20_000,
    });

    const call = await openWaiterCall(svc, EN_TABLE);
    const owner = await signedInClient(SEED_STAFF.owner);
    try {
      await appRpc(owner, 'ack_waiter_call', { p_call_id: call.id });
      // 0033 broadcasts on session:{id} — the old 20s poll is gone.
      await expect(waiterSheet.getByText('On the way')).toBeVisible({ timeout: 10_000 });
      await appRpc(owner, 'resolve_waiter_call', { p_call_id: call.id });
      await expect(waiterSheet.getByText('Done')).toBeVisible({ timeout: 10_000 });
    } finally {
      await owner.auth.signOut();
    }
  });
});

test.describe('guest cafe journey (AR) @ar', () => {
  let svc: SupabaseClient;
  let token: string;
  let stopHeartbeat: () => void;

  test.beforeAll(async () => {
    svc = serviceClient();
    await ensureTillFresh(svc);
    await ensureOpenDay(svc);
    await clearWaiterCalls(svc, AR_TABLE);
    await voidOpenTabsForTable(svc, AR_TABLE);
    token = await mintTableToken(AR_TABLE);
    stopHeartbeat = startTillHeartbeat(svc);
  });

  test.afterAll(() => stopHeartbeat?.());

  test('binds RTL, reveals in Arabic, and sends the order', async ({ page }) => {
    await page.goto(`/ar/t/${token}`);
    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'rtl');
    await expect(html).toHaveAttribute('lang', 'ar');

    await expect(page.getByText('كابتشينو', { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('.tp-cafe__table')).toContainText('T4', { timeout: 60_000 });
    // The notice appears in the top bar AND the footer — assert the top-bar one.
    await expect(
      page.getByRole('banner').getByText('الطلب هنا لا يعني الدفع', { exact: false }),
    ).toBeVisible();

    // Dismiss the Arabic coach mark the way a guest would.
    const coach = page.getByRole('dialog', { name: 'اضغط الجرس لاستدعاء النادل' });
    await expect(coach).toBeVisible();
    await coach.getByRole('button', { name: 'فهمت' }).click();
    await expect(coach).toHaveCount(0);

    await page.getByRole('button', { name: /برغر لحم/ }).first().click();
    const burger = page.getByRole('dialog', { name: 'برغر لحم' });
    await expect(burger.getByRole('group', { name: /اختر مشروبك/ })).toHaveCount(0);
    await burger.getByRole('radio', { name: /ترقية لوجبة/ }).click();
    await burger
      .getByRole('group', { name: /اختر مشروبك/ })
      .getByRole('radio', { name: /كولا/ })
      .click();
    await burger.getByRole('button', { name: /أضف إلى الطلب/ }).click();
    await expect(page.getByText('تمت الإضافة إلى سلّتك.')).toBeVisible();

    await page.getByRole('button', { name: /السلة · 1/ }).click();
    const basket = page.getByRole('dialog', { name: 'سلّتك' });
    await expect(basket).toContainText('برغر لحم');
    await basket.getByRole('button', { name: 'أرسل إلى النادل' }).click();
    await expect(page.getByText('تم الإرسال — النادل استلم طلبك.')).toBeVisible({ timeout: 30_000 });

    // Arabic live status over the same broadcast channel.
    const { ticketId } = await latestOrderForTable(svc, AR_TABLE);
    const prep = await signedInClient(SEED_STAFF.prep);
    try {
      await appRpc(prep, 'set_ticket_status', { p_ticket_id: ticketId, p_status: 'preparing' });
      await page.locator('.tp-orders-strip').click();
      const orders = page.getByRole('dialog', { name: 'طلباتك' });
      await expect(orders.locator('.tp-order__status').first()).toHaveText('قيد التحضير', {
        timeout: 20_000,
      });
    } finally {
      await prep.auth.signOut();
    }
  });
});
