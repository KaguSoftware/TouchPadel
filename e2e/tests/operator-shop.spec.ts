/**
 * Touch Shop as its own desk (0243–0246; Parsa, 2026-09-27: "the touch shop
 * has its own desk, its own stock, its own items"), driven the way the shop
 * will drive it:
 *
 *  (a) sections  — the shop assistant signs in, lands on the shop till, and
 *                  makes a shop section from Products (never the café menu).
 *  (b) products  — they add a product with a barcode; the shop assistant's
 *                  product goes on sale directly (no price protocol).
 *  (c) goods in  — its stock is received at the shop desk, into the shop
 *                  store, with no store to pick.
 *  (d) sell      — the till: the scanner types the barcode and presses Enter,
 *                  Cash takes the payment on the spot (the shop PC's drawer),
 *                  and the receipt opens; no kitchen ticket, the shop store
 *                  goes down by one.
 *  (e) café      — the café's till no longer offers the shop's product.
 */
import { test, expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OPERATOR_URL } from '../playwright.config';
import {
  choose,
  DEV_PASSWORD,
  SEED_STAFF,
  appRpc,
  ensureOpenDay,
  ensureTillFresh,
  passShiftGate,
  serviceClient,
  signedInClient,
  startTillHeartbeat,
} from './helpers';

// The browser operator beats as DEV1 (the till-shift spec's station): one
// open shift there at a time, so each block starts and ends with none open.
const STATION = 'DEV1';
const MANAGER_PIN = '380517';

/** Close whatever shift is open at the station, the way a manager does (operator-till-shift.spec.ts). */
async function closeOpenShift(): Promise<void> {
  const manager = await signedInClient(SEED_STAFF.manager);
  try {
    await appRpc(manager, 'heartbeat', { p_device_id: STATION, p_queue_depth: 0, p_app_version: 'e2e', p_is_till: false });
    const status = await appRpc<{ shift: { id: string; cash_expected_iqd?: number } | null }>(manager, 'till_shift_status', {
      p_device_id: STATION,
    });
    if (!status.shift) return;
    await appRpc(manager, 'verify_manager_pin', { p_pin: MANAGER_PIN, p_device_id: STATION });
    await appRpc(manager, 'close_till_shift_for', {
      p_till_shift_id: status.shift.id,
      p_counted_iqd: Math.max(0, status.shift.cash_expected_iqd ?? 0),
      p_device_id: STATION,
    });
  } finally {
    await manager.auth.signOut();
  }
}

async function signIn(page: Page, email: string) {
  await page.goto(`${OPERATOR_URL}/`);
  const emailBox = page.getByLabel('Email');
  await emailBox.waitFor({ timeout: 30_000 });
  await emailBox.fill(email);
  await page.getByLabel('Password').fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toHaveCount(0, { timeout: 30_000 });
}

test.describe('operator Touch Shop desk', () => {
  test.describe.configure({ mode: 'serial' });

  let svc: SupabaseClient;
  let stopHeartbeat: () => void;
  const stamp = Date.now() % 1_000_000;
  const SHOP_EMAIL = `e2e-shop-${stamp}@test.touch.local`;
  const SECTION = `E2E Rackets ${stamp}`;
  const PRODUCT = `E2E Racket ${stamp}`;
  const SUPPLIER = `E2E Sports ${stamp}`;
  const BARCODE = `629${String(stamp).padStart(10, '0')}`;
  let shopStaffId: string;
  let sectionId: string;
  let itemId: string;
  let ingredientId: string;

  const onHandAt = async (): Promise<Record<string, number>> => {
    const { data } = await svc.from('stock_batches').select('location, qty_remaining').eq('ingredient_id', ingredientId);
    const out: Record<string, number> = {};
    for (const r of (data ?? []) as { location: string; qty_remaining: number }[]) {
      out[r.location] = (out[r.location] ?? 0) + Number(r.qty_remaining);
    }
    return out;
  };

  test.beforeAll(async () => {
    svc = serviceClient();
    await ensureTillFresh(svc);
    await ensureOpenDay(svc);
    stopHeartbeat = startTillHeartbeat(svc);
    await closeOpenShift();

    // The shop assistant (0243) has no seeded account: one for this run.
    const { data, error } = await svc.auth.admin.createUser({ email: SHOP_EMAIL, password: DEV_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    shopStaffId = data.user.id;
    const ins = await svc.from('staff').insert({ id: shopStaffId, display_name: `E2E Shop ${stamp}`, role: 'shop_staff', is_active: true });
    if (ins.error) throw new Error(ins.error.message);

    // The supplier is setup, not the subject.
    const manager = await signedInClient(SEED_STAFF.manager);
    try {
      await appRpc(manager, 'upsert_supplier', { p_name: SUPPLIER });
    } finally {
      await manager.auth.signOut();
    }
  });

  test.afterAll(async () => {
    await closeOpenShift().catch(() => undefined);
    stopHeartbeat?.();
    // Hide what this run made so the tills and other suites never see it again.
    if (sectionId) {
      await svc.from('menu_items').update({ is_active: false }).eq('category_id', sectionId);
      await svc.from('menu_categories').update({ is_active: false }).eq('id', sectionId);
    }
    await svc.from('suppliers').update({ is_active: false }).eq('name', SUPPLIER);
    if (shopStaffId) await svc.from('staff').update({ is_active: false }).eq('id', shopStaffId);
  });

  test('(a) the shop assistant lands on the shop till and makes a shop section from Products', async ({ page }) => {
    await signIn(page, SHOP_EMAIL);
    await expect(page.getByRole('heading', { name: 'Sell', exact: true })).toBeVisible({ timeout: 30_000 });
    await page.goto(`${OPERATOR_URL}/shop/products`);
    await page.getByTestId('shop-section-add').click();
    const dialog = page.getByRole('dialog', { name: 'New section' });
    await dialog.getByTestId('shop-section-name-en').fill(SECTION);
    await dialog.getByTestId('shop-section-name-ar').fill(`مضارب ${stamp}`);
    await dialog.getByTestId('shop-section-save').click();
    await expect(dialog).toBeHidden();

    const { data } = await svc.from('menu_categories').select('id, kind').eq('name_en', SECTION).single();
    expect((data as { kind: string }).kind).toBe('shop');
    sectionId = (data as { id: string }).id;
  });

  test('(b) the shop assistant adds a product with a barcode; it goes on sale directly', async ({ page }) => {
    await signIn(page, SHOP_EMAIL);
    await page.goto(`${OPERATOR_URL}/shop/products`);
    await page.getByRole('button', { name: 'New product' }).first().click();
    const form = page.getByRole('dialog', { name: 'New product' });
    await choose(form.getByLabel('Shop section'), { label: SECTION });
    await form.getByLabel('Product name (English)').fill(PRODUCT);
    await form.getByLabel('Product name (Arabic)').fill(`مضرب ${stamp}`);
    await form.getByLabel('Price (IQD)').fill('250000');
    await form.getByLabel('Barcode').fill(BARCODE);
    // exact: the price watch (0322) put a "Supplier link" field in the same form.
    await choose(form.getByLabel('Supplier', { exact: true }), { label: SUPPLIER });
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form).toBeHidden();
    await expect(page.getByText(BARCODE)).toBeVisible();

    const { data: variant } = await svc.from('menu_item_variants').select('id, item_id').eq('barcode', BARCODE).single();
    const { data: ing } = await svc.from('ingredients').select('id, kind').eq('variant_id', (variant as { id: string }).id).single();
    expect((ing as { kind: string }).kind).toBe('retail');
    ingredientId = (ing as { id: string }).id;
    itemId = (variant as { item_id: string }).item_id;
    const { data: item } = await svc.from('menu_items').select('is_active').eq('id', itemId).single();
    expect((item as { is_active: boolean }).is_active).toBe(true);
  });

  test('(c) goods in at the shop desk receives into the shop store, with no store to pick', async ({ page }) => {
    await signIn(page, SHOP_EMAIL);
    await page.goto(`${OPERATOR_URL}/shop/receive`);
    await expect(page.getByTestId('goods-in-store')).toHaveCount(0);
    await choose(page.getByLabel('Ingredient').first(), { label: `${PRODUCT} One size` });
    await page.getByLabel(/^Received/).first().fill('3');
    await page.getByLabel(/^Cost per/).first().fill('180000');
    await page.getByRole('button', { name: 'Record delivery' }).click();
    await expect(page.getByText(/Delivery recorded/)).toBeVisible();
    await expect.poll(onHandAt).toEqual({ shop: 3 });
  });

  test('(d) the shop till: scan, Cash, receipt; no kitchen ticket, the shop store down by one', async ({ page }) => {
    await signIn(page, SHOP_EMAIL);
    await expect(page.getByRole('heading', { name: 'Sell', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('shop-till-products').getByText(PRODUCT)).toBeVisible();

    // A wedge scanner: fast keys into the page (not a field), then Enter.
    await page.getByRole('heading', { name: 'Sell', exact: true }).click();
    await page.keyboard.type(BARCODE, { delay: 5 });
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('shop-till-basket').getByText(PRODUCT)).toBeVisible();

    await page.getByTestId('shop-till-cash').click();
    await passShiftGate(page);
    const cash = page.getByRole('dialog', { name: 'Cash' });
    // Above the price, whatever tax the server adds: the change is the server's.
    await cash.getByLabel('Tendered').fill('400000');
    await cash.getByRole('button', { name: 'Record payment' }).click();
    // The receipt opens (and prints on the shop printer; the browser's dialog here).
    await expect(page.getByRole('dialog', { name: 'Bill' })).toBeVisible({ timeout: 15_000 });

    const { data: tabs } = await svc
      .from('tabs')
      .select('id, kind, table_id, reservation_id, status')
      .eq('opened_by_staff_id', shopStaffId)
      .order('opened_at', { ascending: false })
      .limit(1);
    const tab = (tabs as { id: string; kind: string; table_id: string | null; reservation_id: string | null; status: string }[])[0]!;
    expect(tab).toMatchObject({ kind: 'shop', table_id: null, reservation_id: null, status: 'settled' });
    const { data: orders } = await svc.from('orders').select('id, status').eq('tab_id', tab.id);
    expect(orders).toHaveLength(1);
    expect((orders as { status: string }[])[0]!.status).toBe('served');
    const { data: tickets } = await svc.from('tickets').select('id').eq('order_id', (orders as { id: string }[])[0]!.id);
    expect(tickets).toEqual([]);
    await expect.poll(onHandAt).toEqual({ shop: 2 });
  });

  test('(e) the café till no longer offers the shop’s product', async ({ page }) => {
    await signIn(page, SEED_STAFF.cashier);
    await expect(page.getByRole('heading', { name: 'Floor', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(SECTION)).toHaveCount(0);
    await expect(page.getByText(PRODUCT)).toHaveCount(0);
    // And the café cashier cannot open a shop sale at all.
    const cashier = await signedInClient(SEED_STAFF.cashier);
    try {
      await expect(appRpc(cashier, 'open_tab', { p_kind: 'shop', p_label: 'x' })).rejects.toThrow(/TAB_KIND_FORBIDDEN/);
    } finally {
      await cashier.auth.signOut();
    }
  });
});

// The Arabic desk: its own run (the AR project greps `@ar`), so it makes what
// it sells itself, through the shop assistant's own RPCs.
test.describe('operator Touch Shop desk (Arabic)', () => {
  let svc: SupabaseClient;
  let stopHeartbeat: () => void;
  const stamp = (Date.now() + 7) % 1_000_000;
  const SHOP_EMAIL = `e2e-shop-ar-${stamp}@test.touch.local`;
  const PRODUCT_AR = `كرات بادل ${stamp}`;
  const BARCODE = `628${String(stamp).padStart(10, '0')}`;
  let shopStaffId: string;
  let sectionId: string;

  test.beforeAll(async () => {
    svc = serviceClient();
    await ensureTillFresh(svc);
    await ensureOpenDay(svc);
    stopHeartbeat = startTillHeartbeat(svc);
    await closeOpenShift();
    const { data, error } = await svc.auth.admin.createUser({ email: SHOP_EMAIL, password: DEV_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    shopStaffId = data.user.id;
    const ins = await svc.from('staff').insert({ id: shopStaffId, display_name: `متجر ${stamp}`, role: 'shop_staff', is_active: true });
    if (ins.error) throw new Error(ins.error.message);
    const shop = await signedInClient(SHOP_EMAIL);
    try {
      const { data: tax } = await svc.from('tax_groups').select('id').limit(1).single();
      sectionId = await appRpc<string>(shop, 'upsert_shop_category', {
        p_name_en: `E2E Balls ${stamp}`,
        p_name_ar: `كرات ${stamp}`,
        p_tax_group_id: (tax as { id: string }).id,
      });
      const itemId = await appRpc<string>(shop, 'upsert_menu_item', {
        p_category_id: sectionId,
        p_name_en: `E2E Balls ${stamp}`,
        p_name_ar: PRODUCT_AR,
        p_is_active: true,
      });
      const size = await appRpc<{ ingredient_id: string }>(shop, 'upsert_retail_variant', {
        p_item_id: itemId,
        p_name_en: 'Tube of 3',
        p_name_ar: 'علبة ٣',
        p_price_iqd: 15_000,
        p_barcode: BARCODE,
      });
      await appRpc(shop, 'receive_delivery', {
        p_lines: [{ ingredient_id: size.ingredient_id, qty_received: 5, unit_cost_iqd: 10_000 }],
      });
    } finally {
      await shop.auth.signOut();
    }
  });

  test.afterAll(async () => {
    await closeOpenShift().catch(() => undefined);
    stopHeartbeat?.();
    if (sectionId) {
      await svc.from('menu_items').update({ is_active: false }).eq('category_id', sectionId);
      await svc.from('menu_categories').update({ is_active: false }).eq('id', sectionId);
    }
    if (shopStaffId) await svc.from('staff').update({ is_active: false }).eq('id', shopStaffId);
  });

  test('@ar the shop assistant sells in Arabic: the shop till, a scan, card, the receipt', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'ar-IQ' });
    await context.addInitScript(() => {
      try {
        localStorage.setItem('touch-operator-locale', 'ar');
      } catch {
        /* no storage */
      }
    });
    const page = await context.newPage();
    await page.goto(`${OPERATOR_URL}/`);
    await page.getByLabel(/البريد|Email/).waitFor({ timeout: 30_000 });
    await page.getByLabel(/البريد|Email/).fill(SHOP_EMAIL);
    await page.getByLabel(/كلمة المرور|Password/).fill(DEV_PASSWORD);
    await page.getByRole('button', { name: /تسجيل الدخول|Sign in/ }).click();
    await expect(page.getByRole('heading', { name: 'البيع', exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('shop-till-products').getByText(PRODUCT_AR)).toBeVisible();

    await page.getByRole('heading', { name: 'البيع', exact: true }).click();
    await page.keyboard.type(BARCODE, { delay: 5 });
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('shop-till-basket').getByText(PRODUCT_AR)).toBeVisible();
    await page.getByTestId('shop-till-card').click();
    const start = page.getByRole('dialog', { name: 'بدء ورديتي' });
    const card = page.getByRole('dialog', { name: /بطاقة|Card/ });
    await expect(start.or(card)).toBeVisible();
    if (await start.isVisible()) {
      await start.getByRole('button').filter({ hasText: /صحيح/ }).first().click();
    }
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: /تسجيل|Record/ }).last().click();
    await expect(page.getByRole('dialog', { name: /الفاتورة|Bill/ })).toBeVisible({ timeout: 15_000 });
    await context.close();
  });
});
