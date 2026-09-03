/**
 * Module 5 — stock & recipes, driven the way the manager will drive it. The
 * final case IS the SOW acceptance script (L509-514): "a physical count is run
 * against a period of trading and the variance report reconciles … every
 * movement traceable to the order, delivery or waste entry that caused it."
 *
 *  (a) ingredient master data  — create via /stock/ingredients, appears on hand at 0
 *  (b) goods in                — a delivery raises on-hand; the ledger names it
 *  (c) recipe → auto-deduction — attach a BOM, ring the item on the till,
 *                                sale_consumption appears without any stock UI touch
 *  (d) waste                   — spillage with a mandatory reason
 *  (e) count → variance        — a deliberate shortage shows as the variance,
 *                                movements one click away
 */
import { test, expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OPERATOR_URL } from '../playwright.config';
import {
  DEV_PASSWORD,
  SEED_STAFF,
  appRpc,
  ensureOpenDay,
  ensureTillFresh,
  fixtureTableId,
  serviceClient,
  signedInClient,
  voidOpenTabsForTable,
} from './helpers';

const TILL_TABLE = fixtureTableId(8);

async function signIn(page: Page, email: string) {
  await page.goto(`${OPERATOR_URL}/`);
  const emailBox = page.getByLabel('Email');
  await emailBox.waitFor({ timeout: 30_000 });
  await emailBox.fill(email);
  await page.getByLabel('Password').fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation')).toBeVisible({ timeout: 30_000 });
}

test.describe('operator stock (module 5)', () => {
  test.describe.configure({ mode: 'serial' });

  let svc: SupabaseClient;
  const stamp = Date.now() % 1_000_000;
  const ING = `E2E Beans ${stamp}`;
  let ingredientId: string;
  // Karak Tea Regular — a fixture variant the till can ring up.
  const KARAK_VARIANT = 'f1f70000-0000-4000-8000-0000f0050001';

  test.beforeAll(async () => {
    svc = serviceClient();
    await ensureTillFresh(svc);
    await ensureOpenDay(svc);
    // A leftover open count (aborted runs, db suites) blocks start_count.
    await svc
      .from('stock_counts')
      .update({ finalized_at: new Date().toISOString() })
      .is('finalized_at', null);
    await voidOpenTabsForTable(svc, TILL_TABLE);
  });

  test.afterAll(async () => {
    // Detach the recipe so other suites' Karak orders stop consuming stock,
    // then remove everything this run created.
    const manager = await signedInClient(SEED_STAFF.manager);
    try {
      await appRpc(manager, 'set_recipe', {
        p_target: 'variant',
        p_target_id: KARAK_VARIANT,
        p_lines: [],
      });
    } finally {
      await manager.auth.signOut();
    }
    if (ingredientId) {
      await svc.from('recipe_lines').delete().eq('ingredient_id', ingredientId);
      await svc.from('stock_count_lines').delete().eq('ingredient_id', ingredientId);
      await svc.from('stock_movements').delete().eq('ingredient_id', ingredientId);
      await svc.from('stock_batches').delete().eq('ingredient_id', ingredientId);
      await svc.from('manager_alerts').delete().contains('payload', { ingredient_id: ingredientId });
      await svc.from('ingredients').delete().eq('id', ingredientId);
    }
    await voidOpenTabsForTable(svc, TILL_TABLE);
  });

  test('(a) create an ingredient; it appears on hand at zero', async ({ page }) => {
    await signIn(page, SEED_STAFF.manager);
    await page.goto(`${OPERATOR_URL}/stock/ingredients`);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByLabel('Name (English)').fill(ING);
    await page.getByLabel('Name (Arabic)').fill(`بن ${stamp}`);
    await page.getByLabel('Pack size (base units)').fill('1000');
    await page.getByLabel('Pack cost (IQD)').fill('15000');
    await page.getByLabel('Supplier').fill('Al-Rasheed');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByText(ING).first()).toBeVisible();

    const { data } = await svc.from('ingredients').select('id').eq('name_en', ING).single();
    ingredientId = (data as { id: string }).id;

    await page.goto(`${OPERATOR_URL}/stock`);
    await expect(page.getByText(ING).first()).toBeVisible();
  });

  test('(b) goods in raises on-hand and the ledger names the delivery', async ({ page }) => {
    await signIn(page, SEED_STAFF.manager);
    await page.goto(`${OPERATOR_URL}/stock/receive`);
    await page.getByLabel('Ingredient').first().selectOption({ label: `${ING} (g)` });
    await page.getByLabel('Expected').first().fill('500');
    await page.getByLabel('Received').first().fill('400');
    await expect(page.getByText('Short by 100')).toBeVisible(); // short-delivery capture
    await page.getByLabel('Cost/unit (IQD)').first().fill('15');
    await page.getByRole('button', { name: 'Record delivery' }).click();
    await expect(page.getByText(/Delivery recorded/)).toBeVisible();

    await page.goto(`${OPERATOR_URL}/stock`);
    const row = page.locator('tr').filter({ hasText: ING });
    await expect(row.getByText('400').first()).toBeVisible();
    await row.getByRole('button', { name: 'Ledger' }).click();
    await expect(page.getByText('goods_in')).toBeVisible();
    await expect(page.getByText(/delivery /)).toBeVisible();
  });

  test('(c) a recipe makes a till sale deduct stock by itself', async ({ page }) => {
    const manager = await signedInClient(SEED_STAFF.manager);
    try {
      // 50 g of beans per Karak Regular.
      const res = await appRpc(manager, 'set_recipe', {
        p_target: 'variant',
        p_target_id: KARAK_VARIANT,
        p_lines: [{ ingredient_id: ingredientId, qty: 50 }],
      });
      expect(res).toBe(1);
    } finally {
      await manager.auth.signOut();
    }

    // Ring one Karak on the till and send it to the kitchen.
    await signIn(page, SEED_STAFF.cashier);
    await page.getByRole('button', { name: '+', exact: true }).click();
    const newTab = page.getByRole('dialog', { name: 'New tab' });
    await newTab.getByLabel('Table').selectOption({ label: 'T8' });
    await newTab.getByRole('button', { name: 'Open tab' }).click();
    await expect(newTab).toBeHidden();
    await page.getByRole('button', { name: /Hot Drinks/ }).click();
    await page.getByRole('button', { name: /^Karak Tea/ }).click();
    const karak = page.getByRole('dialog', { name: 'Karak Tea' });
    await karak.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Send to kitchen' }).click();
    await expect(page.getByText('1× Karak Tea (Regular)').first()).toBeVisible();

    // The 0018 trigger consumed 50 g — no stock screen was touched.
    await expect
      .poll(
        async () => {
          const { data } = await svc
            .from('stock_movements')
            .select('qty_delta')
            .eq('ingredient_id', ingredientId)
            .eq('movement_type', 'sale_consumption');
          return (data ?? []).reduce((s, m) => s + Number((m as { qty_delta: number }).qty_delta), 0);
        },
        { timeout: 15_000 },
      )
      .toBe(-50);

    // Settle so the day can close and other suites find the table free.
    await page.getByRole('button', { name: 'Cash', exact: true }).click();
    const cash = page.getByRole('dialog', { name: 'Cash' });
    await cash.getByLabel('Tendered').fill('2000');
    await cash.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByText('Tab settled.')).toBeVisible();
  });

  test('(d) waste demands a reason and lands in the ledger', async ({ page }) => {
    await signIn(page, SEED_STAFF.manager);
    await page.goto(`${OPERATOR_URL}/stock/waste`);
    await page.getByLabel('Ingredient').selectOption({ label: `${ING} (g)` });
    await page.getByLabel('Qty', { exact: true }).fill('30');
    await page.getByLabel('Reason').fill('dropped the bag');
    await page.getByRole('button', { name: 'Record waste' }).click();

    await expect
      .poll(async () => {
        const { data } = await svc
          .from('stock_movements')
          .select('reason_code')
          .eq('ingredient_id', ingredientId)
          .eq('movement_type', 'waste_spill');
        return (data ?? []).length;
      })
      .toBe(1);
  });

  test('(e) THE ACCEPTANCE SCRIPT: a count with a shortage reconciles on the variance report', async ({
    page,
  }) => {
    await signIn(page, SEED_STAFF.manager);
    await page.goto(`${OPERATOR_URL}/stock/counts`);
    await page.getByRole('button', { name: 'Start count' }).click();
    await expect(page.getByText(/Counting — started/)).toBeVisible({ timeout: 20_000 });

    // Theoretical for our ingredient: 400 in − 50 sold − 30 waste = 320.
    // Count 300: a deliberate 20 g shortage.
    await page.getByRole('textbox', { name: ING }).fill('300');
    await page.getByRole('button', { name: 'Finalize count' }).click();
    await page
      .getByRole('dialog', { name: 'Finalize the count?' })
      .getByRole('button', { name: 'Confirm' })
      .click();

    await expect(page).toHaveURL(/\/stock\/variance/, { timeout: 20_000 });
    const row = page.locator('tr').filter({ hasText: ING });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText('320')).toBeVisible(); // theoretical
    await expect(row.getByText('300', { exact: true })).toBeVisible(); // counted
    await expect(row.getByText('-20')).toBeVisible(); // the shortage, named
    await expect(row.getByText('50', { exact: true })).toBeVisible(); // sold
    await expect(row.getByText('30', { exact: true })).toBeVisible(); // recorded waste

    // "Every movement traceable … one click away."
    await row.getByRole('button', { name: 'Movements' }).click();
    await expect(page.getByText('goods_in')).toBeVisible();
    await expect(page.getByText('sale_consumption')).toBeVisible();
    await expect(page.getByText('waste_spill')).toBeVisible();
  });
});
