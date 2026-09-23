/**
 * Touch Shop (Phase 2 item 5; migrations 0143–0146), driven the way the venue
 * will drive it:
 *
 *  (a) products  — a manager adds a product with a barcode under Stock → Shop
 *                  products; it starts tracked, at zero on hand.
 *  (b) goods in  — the product's own stock is received on the usual screen,
 *                  with a supplier picked from the list.
 *  (c) till      — a cashier opens a counter sale (no table), SCANS the barcode
 *                  (a USB wedge types it fast and presses Enter), and sends:
 *                  no kitchen ticket is made and the shelf goes down by one.
 *  (d) return    — a refund of that line puts it back on the shelf.
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
  serviceClient,
  signedInClient,
  startTillHeartbeat,
} from './helpers';

const TAX_STANDARD = 'b0000000-0000-4000-8000-000000000001';
const VENUE_A = 'c0000000-0000-4000-8000-000000000001';

async function signIn(page: Page, email: string) {
  await page.goto(`${OPERATOR_URL}/`);
  const emailBox = page.getByLabel('Email');
  await emailBox.waitFor({ timeout: 30_000 });
  await emailBox.fill(email);
  await page.getByLabel('Password').fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toHaveCount(0, { timeout: 30_000 });
}

test.describe('operator Touch Shop', () => {
  test.describe.configure({ mode: 'serial' });

  let svc: SupabaseClient;
  let stopHeartbeat: () => void;
  const stamp = Date.now() % 1_000_000;
  const SECTION = `E2E Rackets ${stamp}`;
  const PRODUCT = `E2E Racket ${stamp}`;
  const SUPPLIER = `E2E Sports ${stamp}`;
  const BARCODE = `629${String(stamp).padStart(10, '0')}`;
  const COUNTER = `Walk-in ${stamp}`;
  let sectionId: string;
  let ingredientId: string;
  let orderId: string;

  const onHand = async () => {
    const { data } = await svc.from('stock_batches').select('qty_remaining').eq('ingredient_id', ingredientId);
    return (data as { qty_remaining: number }[]).reduce((s, r) => s + Number(r.qty_remaining), 0);
  };

  test.beforeAll(async () => {
    svc = serviceClient();
    await ensureTillFresh(svc);
    await ensureOpenDay(svc);
    stopHeartbeat = startTillHeartbeat(svc);

    // The section and the supplier are setup, not the subject: made directly,
    // then switched to shop through the RPC the section editor uses.
    const { data, error } = await svc
      .from('menu_categories')
      .insert({ name_en: SECTION, name_ar: `مضارب ${stamp}`, tax_group_id: TAX_STANDARD, is_active: true, venue_id: VENUE_A, sort_order: 999 })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    sectionId = (data as { id: string }).id;
    const manager = await signedInClient(SEED_STAFF.manager);
    try {
      await appRpc(manager, 'set_category_kind', { p_id: sectionId, p_kind: 'shop' });
      await appRpc(manager, 'upsert_supplier', { p_name: SUPPLIER });
    } finally {
      await manager.auth.signOut();
    }
  });

  test.afterAll(async () => {
    stopHeartbeat?.();
    // Hide what this run made so the till and other suites never see it again.
    if (sectionId) {
      await svc.from('menu_items').update({ is_active: false }).eq('category_id', sectionId);
      await svc.from('menu_categories').update({ is_active: false }).eq('id', sectionId);
    }
    await svc.from('suppliers').update({ is_active: false }).eq('name', SUPPLIER);
  });

  test('(a) a manager adds a product with a barcode; it is tracked at zero', async ({ page }) => {
    await signIn(page, SEED_STAFF.manager);
    await page.goto(`${OPERATOR_URL}/stock/products`);
    await page.getByRole('button', { name: 'New product' }).first().click();
    const form = page.getByRole('dialog', { name: 'New product' });
    await choose(form.getByLabel('Shop section'), { label: SECTION });
    await form.getByLabel('Product name (English)').fill(PRODUCT);
    await form.getByLabel('Product name (Arabic)').fill(`مضرب ${stamp}`);
    await form.getByLabel('Price (IQD)').fill('250000');
    await form.getByLabel('Barcode').fill(BARCODE);
    await choose(form.getByLabel('Supplier'), { label: SUPPLIER });
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form).toBeHidden();
    await expect(page.getByText(BARCODE)).toBeVisible();

    const { data: variant } = await svc.from('menu_item_variants').select('id').eq('barcode', BARCODE).single();
    const { data } = await svc
      .from('ingredients')
      .select('id, kind, unit')
      .eq('variant_id', (variant as { id: string }).id)
      .single();
    const ing = data as { id: string; kind: string; unit: string };
    expect(ing).toMatchObject({ kind: 'retail', unit: 'pc' });
    ingredientId = ing.id;
    expect(await onHand()).toBe(0);
  });

  test('(b) goods in receives the product like any stock', async ({ page }) => {
    await signIn(page, SEED_STAFF.manager);
    await page.goto(`${OPERATOR_URL}/stock/receive`);
    await choose(page.getByLabel('Ingredient').first(), { label: `${PRODUCT} One size` });
    await page.getByLabel(/^Received/).first().fill('3');
    await page.getByLabel(/^Cost per/).first().fill('180000');
    await page.getByRole('button', { name: 'Record delivery' }).click();
    await expect(page.getByText(/Delivery recorded/)).toBeVisible();
    await expect.poll(onHand).toBe(3);
  });

  test('(c) a counter sale scans the barcode and sends with no kitchen ticket', async ({ page }) => {
    await signIn(page, SEED_STAFF.cashier);
    // The till lands on the floor plan; a counter sale has no table to tap.
    await expect(page.getByRole('heading', { name: 'Floor', exact: true })).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'New tab', exact: true }).click();
    const newTab = page.getByRole('dialog', { name: 'New tab' });
    await newTab.getByRole('switch', { name: 'Shop counter sale' }).click();
    await newTab.getByLabel('Name on the tab').fill(COUNTER);
    await newTab.getByRole('button', { name: 'Open tab' }).click();
    await expect(newTab).toBeHidden();
    // The basket starts with its lines folded away; open it to read them.
    await page.getByRole('button', { name: 'Show the basket lines' }).click();

    // A wedge scanner: fast keys into the page (not a field), then Enter.
    // The tab's own header takes the focus off every input.
    await page.getByRole('heading', { name: COUNTER, exact: true }).click();
    await page.keyboard.type(BARCODE, { delay: 5 });
    await page.keyboard.press('Enter');
    await expect(page.getByText(`1× ${PRODUCT} (One size)`)).toBeVisible();

    await page.getByRole('button', { name: 'Send to kitchen' }).click();
    await expect(page.getByText('Basket is empty — pick items from the grid.')).toBeVisible();

    const { data: tab } = await svc.from('tabs').select('id, kind, table_id').eq('label', COUNTER).single();
    expect(tab).toMatchObject({ kind: 'shop', table_id: null });
    const { data: orders } = await svc.from('orders').select('id, status').eq('tab_id', (tab as { id: string }).id);
    expect(orders).toHaveLength(1);
    orderId = (orders as { id: string }[])[0]!.id;
    expect((orders as { status: string }[])[0]!.status).toBe('served');
    const { data: tickets } = await svc.from('tickets').select('id').eq('order_id', orderId);
    expect(tickets).toEqual([]);
    await expect.poll(onHand).toBe(2);
  });

  test('(d) a return of the sold piece puts it back on the shelf', async () => {
    const { data: tab } = await svc.from('tabs').select('id').eq('label', COUNTER).single();
    const tabId = (tab as { id: string }).id;
    const cashier = await signedInClient(SEED_STAFF.cashier);
    const manager = await signedInClient(SEED_STAFF.manager);
    try {
      const settled = await appRpc<{ payment_id: string }>(cashier, 'settle_tab', {
        p_tab_id: tabId,
        p_method: 'card',
        p_idempotency_key: `TILL1:tab.settle:${crypto.randomUUID().replaceAll('-', '').toUpperCase().slice(0, 26)}`,
      });
      const { data: line } = await svc.from('order_items').select('id').eq('order_id', orderId).single();
      await appRpc(manager, 'verify_manager_pin', { p_pin: '380517', p_device_id: null });
      await appRpc(manager, 'refund', {
        p_payment_id: settled.payment_id,
        p_amount_iqd: 250_000,
        p_pin: '380517',
        p_reason_code: 'retail_return',
        p_items: [{ order_item_id: (line as { id: string }).id, qty: 1 }],
      });
    } finally {
      await cashier.auth.signOut();
      await manager.auth.signOut();
    }
    await expect.poll(onHand).toBe(3);
  });
});
