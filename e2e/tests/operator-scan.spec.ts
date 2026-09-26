/**
 * Scanned paper (Phase 2 Milestone 4b; migrations 0236–0239), driven the way
 * the venue will drive it. The photo is filed the way the phone files it (a
 * staff-media slot, the upload, create_order_slip / create_receipt); the
 * reading is stored the way receipt-scan stores it, as the service role, so
 * the spec does not depend on a model or on the functions runtime (the edge
 * flow is covered by packages/db/tests/receipt-scan.test.ts).
 *
 *  (a) the till — a waiter's order slip for table T11 shows up under Scanned
 *      orders; the cashier opens it, removes what is not on the menu and
 *      sends it: one order on T11's tab with a kitchen ticket, the waiter's
 *      note on the latte, and the slip marked sent.
 *  (b) @ar Goods in — a supplier receipt read as milk, sugar and a delivery
 *      fee; the manager, in Arabic, removes the fee and puts it into stock:
 *      one delivery (source receipt) and the milk on hand goes up by 12 L.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OPERATOR_URL } from '../playwright.config';
import {
  DEV_PASSWORD,
  SEED_STAFF,
  appRpc,
  ensureFixtureStock,
  ensureOpenDay,
  ensureTillFresh,
  fixtureTableId,
  serviceClient,
  signedInClient,
  startTillHeartbeat,
  voidOpenTabsForTable,
} from './helpers';

const VENUE_A = 'c0000000-0000-4000-8000-000000000001';
const TABLE = fixtureTableId(11); // T11
const LATTE_REGULAR = 'f1f70000-0000-4000-8000-0000f0030001';
const CAPPUCCINO_LARGE = 'f1f70000-0000-4000-8000-0000f0020002';
const WHOLE_MILK = 'f1f70000-0000-4000-8000-000000001002';
// A 1x1 PNG: the bucket takes jpeg, png and webp; the till only shows it.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function signIn(browser: Browser, email: string, locale: 'en' | 'ar' = 'en'): Promise<Page> {
  const context = await browser.newContext({ locale: locale === 'ar' ? 'ar-IQ' : 'en-US' });
  await context.addInitScript((l) => {
    try {
      localStorage.setItem('touch-operator-locale', l);
    } catch {
      /* no storage */
    }
  }, locale);
  const page = await context.newPage();
  await page.goto(`${OPERATOR_URL}/`);
  const emailBox = page.locator('input[type="email"]');
  await emailBox.waitFor({ timeout: 30_000 });
  await emailBox.fill(email);
  await page.locator('input[type="password"]').fill(DEV_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 30_000 });
  return page;
}

/** Upload a photo into `folder` as `email` and file it with `create`; returns the new id. */
/** Every photo this run uploaded, removed in afterAll so no other suite sees the seed manager's uploads. */
const uploaded: string[] = [];

async function filePhoto(email: string, folder: 'slips' | 'receipts', create: (path: string) => [string, Record<string, unknown>]): Promise<string> {
  const client = await signedInClient(email);
  try {
    const slot = await appRpc<{ path: string }>(client, 'staff_media_slot', { p_venue_id: VENUE_A, p_folder: folder, p_ext: 'png' });
    const up = await client.storage.from('staff-media').upload(slot.path, PNG, { contentType: 'image/png', upsert: false });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    uploaded.push(slot.path);
    const [fn, args] = create(slot.path);
    return (await appRpc<{ id: string }>(client, fn, args)).id;
  } finally {
    await client.auth.signOut();
  }
}

/** Store a reading as receipt-scan does (service role: begin, then store). */
async function storeReading(svc: SupabaseClient, kind: 'slip' | 'receipt', id: string, reading: unknown): Promise<void> {
  const begin = await svc.schema('app').rpc(kind === 'slip' ? 'slip_begin_reading' : 'receipt_begin_reading', { p_id: id });
  if (begin.error) throw new Error(`begin: ${begin.error.message}`);
  const store = await svc.schema('app').rpc(kind === 'slip' ? 'slip_store_reading' : 'receipt_store_reading', {
    p_id: id,
    p_reading: reading,
    p_model: 'fake-receipt-reader',
  });
  if (store.error) throw new Error(`store: ${store.error.message}`);
}

test.describe('operator scanned paper', () => {
  test.describe.configure({ mode: 'serial' });

  let svc: SupabaseClient;
  let stopHeartbeat: () => void;

  test.beforeAll(async () => {
    svc = serviceClient();
    await ensureTillFresh(svc);
    await ensureOpenDay(svc);
    await ensureFixtureStock(svc);
    await voidOpenTabsForTable(svc, TABLE);
    stopHeartbeat = startTillHeartbeat(svc);
  });

  test.afterAll(async () => {
    stopHeartbeat?.();
    await voidOpenTabsForTable(svc, TABLE);
    // The slip and receipt rows keep their paths as text; the upload ledger and
    // the objects go, so the RLS matrix's "own uploads" rows stay empty.
    if (uploaded.length > 0) {
      await svc.storage.from('staff-media').remove(uploaded);
      await svc.from('staff_media_uploads').delete().in('path', uploaded);
    }
  });

  test('(a) a scanned order slip is checked on the till and sent to the kitchen', async ({ browser }) => {
    const slipId = await filePhoto(SEED_STAFF.manager, 'slips', (path) => [
      'create_order_slip',
      { p_venue_id: VENUE_A, p_storage_path: path, p_idempotency_key: `e2e:slip:${Date.now()}` },
    ]);
    await storeReading(svc, 'slip', slipId, {
      table_number: '11',
      lines: [
        { text: 'لاتيه', qty: 2, notes: 'بدون سكر', flags: [] },
        { text: 'كابتشينو كبير', qty: 1, flags: [] },
        { text: 'Xqwz vbnm', qty: 1, flags: [] },
      ],
    });

    const page = await signIn(browser, SEED_STAFF.cashier);
    await page.goto(`${OPERATOR_URL}/till`);
    const panel = page.getByTestId('scanned-slips');
    await expect(panel).toBeVisible();
    await panel.getByTestId('scanned-slips.row').filter({ hasText: 'T11' }).getByRole('button', { name: 'Open' }).click();

    const dialog = page.getByRole('dialog', { name: 'Scanned order' });
    await expect(dialog).toBeVisible();
    const lines = dialog.getByTestId('slip.line');
    await expect(lines).toHaveCount(3);
    await expect(lines.nth(2)).toContainText('No match');
    // The stranger holds the send until it is removed.
    await expect(dialog.getByTestId('slip.send')).toBeDisabled();
    await dialog.getByRole('button', { name: 'Remove line 3' }).click();
    await expect(lines).toHaveCount(2);
    await dialog.getByTestId('slip.send').click();
    await expect(dialog).toBeHidden();

    const slip = await svc.from('order_slips').select('status, order_id, tab_id, table_id').eq('id', slipId).single();
    expect(slip.data).toMatchObject({ status: 'sent', table_id: TABLE });
    const orderId = (slip.data as { order_id: string }).order_id;
    const items = await svc.from('order_items').select('variant_id, qty, notes').eq('order_id', orderId);
    const byVariant = new Map((items.data as { variant_id: string; qty: number; notes: string | null }[]).map((i) => [i.variant_id, i]));
    expect(byVariant.get(LATTE_REGULAR)).toMatchObject({ qty: 2, notes: 'بدون سكر' });
    expect(byVariant.get(CAPPUCCINO_LARGE)).toMatchObject({ qty: 1 });
    const ticket = await svc.from('tickets').select('id').eq('order_id', orderId);
    expect(ticket.data).toHaveLength(1);
    await page.context().close();
  });

  test('@ar a scanned receipt is put into stock from Goods in, in Arabic', async ({ browser }) => {
    const receiptId = await filePhoto(SEED_STAFF.manager, 'receipts', (path) => [
      'create_receipt',
      { p_venue_id: VENUE_A, p_storage_path: path, p_source: 'phone', p_idempotency_key: `e2e:receipt:${Date.now()}` },
    ]);
    await storeReading(svc, 'receipt', receiptId, {
      supplier_name: 'E2E Dairy',
      total_iqd: 30000,
      lines: [
        { text: 'Whole milk 1L', qty: 12, unit: 'L', unit_price_iqd: 1500, line_total_iqd: 18000, flags: [] },
        { text: 'Delivery fee', qty: 1, line_total_iqd: 2000, flags: [] },
      ],
    });
    const before = await svc.from('stock_batches').select('qty_remaining').eq('ingredient_id', WHOLE_MILK);
    const onHand = (rows: { qty_remaining: number }[] | null) => (rows ?? []).reduce((s, r) => s + Number(r.qty_remaining), 0);

    const page = await signIn(browser, SEED_STAFF.manager, 'ar');
    await page.goto(`${OPERATOR_URL}/stock/receive?receipt=${receiptId}`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const review = page.getByTestId('receipt-review');
    await expect(review.getByTestId('receipt.read-line')).toHaveCount(2);
    // The delivery fee is not stock: remove its line (the second).
    await review.getByRole('button', { name: /السطر ٢|السطر 2/ }).click();
    await expect(review.getByTestId('receipt.read-line')).toHaveCount(1);
    await review.getByTestId('receipt.confirm').click();
    await expect(page).toHaveURL(/\/stock\/receive$/);

    const receipt = await svc.from('supplier_receipts').select('status, delivery_id').eq('id', receiptId).single();
    expect((receipt.data as { status: string }).status).toBe('confirmed');
    const delivery = await svc.from('deliveries').select('source').eq('id', (receipt.data as { delivery_id: string }).delivery_id).single();
    expect(delivery.data).toMatchObject({ source: 'receipt' });
    const after = await svc.from('stock_batches').select('qty_remaining').eq('ingredient_id', WHOLE_MILK);
    expect(onHand(after.data as { qty_remaining: number }[])).toBeCloseTo(onHand(before.data as { qty_remaining: number }[]) + 12000, 3);
    await page.context().close();
  });
});
