/**
 * Operator SPA journeys against the local stack:
 *  1. court_desk — desk calendar renders fixture courts, walk-in booking
 *     create + cancel (with reason).
 *  2. cashier — till: open a tab on a table, add 2 items (one with modifier),
 *     settle cash with tendered amount, change shown, tab settled.
 */
import { test, expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OPERATOR_URL } from '../playwright.config';
import {
  DEV_PASSWORD,
  FIXTURE_COURTS_EN,
  SEED_STAFF,
  ensureOpenDay,
  ensureTillFresh,
  fixtureTableId,
  serviceClient,
  voidOpenTabsForTable,
} from './helpers';

const TILL_TABLE = fixtureTableId(8); // T8
const WALKIN_NAME = 'E2E Walk-in';

async function signIn(page: Page, email: string) {
  await page.goto(OPERATOR_URL);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('operator journeys', () => {
  let svc: SupabaseClient;

  test.beforeAll(async () => {
    svc = serviceClient();
    await ensureTillFresh(svc);
    await ensureOpenDay(svc);
    // Reruns: cancel any leftover e2e walk-ins so names/slots stay unambiguous,
    // and clear open tabs on the till test table.
    await svc
      .from('reservations')
      .update({ status: 'cancelled', cancelled_reason: 'staff_error' })
      .eq('guest_name', WALKIN_NAME)
      .in('status', ['pending', 'confirmed', 'arrived']);
    await voidOpenTabsForTable(svc, TILL_TABLE);
  });

  test('court_desk: calendar renders courts; walk-in booking create + cancel', async ({
    page,
  }) => {
    await signIn(page, SEED_STAFF.court_desk);
    await expect(page.getByRole('heading', { name: 'Desk calendar' })).toBeVisible({
      timeout: 30_000,
    });

    // Fixture courts render as column headers.
    for (const court of FIXTURE_COURTS_EN) {
      await expect(page.getByText(court, { exact: true })).toBeVisible();
    }

    // Tomorrow: every slot is in the future (today's morning rows are disabled).
    await page.getByRole('button', { name: '›' }).click();
    await expect(page.getByTitle('Free').first()).toBeVisible();

    // 12:00 on the first court (rows start 09:00, 30-min steps).
    await page.getByTitle('Free').nth(6).click();
    const dialog = page.getByRole('dialog', { name: 'New booking' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Guest name').fill(WALKIN_NAME);
    await dialog.getByRole('button', { name: 'Create booking' }).click();
    await expect(dialog).toBeHidden();

    // Booking appears on the grid.
    const block = page.getByRole('button', { name: new RegExp(WALKIN_NAME) });
    await expect(block).toBeVisible();

    // Cancel with a reason.
    await block.click();
    const actions = page.getByRole('dialog', { name: WALKIN_NAME });
    await actions.getByRole('button', { name: 'Cancel booking' }).click();
    await actions.getByLabel('Reason').selectOption('customer_request');
    await actions.getByRole('button', { name: 'Cancel booking' }).click();
    await expect(actions).toBeHidden();
    await expect(block).toBeHidden();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();
  });

  test('cashier: open tab, add items, settle cash with change', async ({ page }) => {
    await signIn(page, SEED_STAFF.cashier);
    await expect(page.getByRole('heading', { name: 'Open tabs' })).toBeVisible({
      timeout: 30_000,
    });

    // ---- open a tab on T8 -------------------------------------------------
    await page.getByRole('button', { name: '+', exact: true }).click();
    const newTab = page.getByRole('dialog', { name: 'New tab' });
    const tableSelect = newTab.getByLabel('Table');
    await expect(tableSelect.locator('option', { hasText: 'T8' })).toHaveCount(1);
    await tableSelect.selectOption({ label: 'T8' });
    await newTab.getByRole('button', { name: 'Open tab' }).click();
    await expect(newTab).toBeHidden();
    await expect(page.getByRole('heading', { name: 'Table T8' })).toBeVisible();

    // ---- item 1: Cappuccino (Regular) + Oat Milk modifier -----------------
    // Leftover db-test categories can sort ahead of the fixtures — pick the
    // fixture category explicitly before reaching for its items.
    await page.getByRole('button', { name: /Hot Drinks/ }).click();
    await page.getByRole('button', { name: /^Cappuccino/ }).click();
    const capp = page.getByRole('dialog', { name: 'Cappuccino' });
    await expect(capp).toBeVisible();
    await capp.getByRole('button', { name: /Oat Milk/ }).click();
    await capp.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(capp).toBeHidden();

    // ---- item 2: Turkish Coffee ------------------------------------------
    await page.getByRole('button', { name: /^Turkish Coffee/ }).click();
    const turk = page.getByRole('dialog', { name: 'Turkish Coffee' });
    await turk.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(turk).toBeHidden();

    // ---- send to kitchen --------------------------------------------------
    // Basket: (4,000 + 1,000) + 3,000 = 8,000
    await expect(page.getByText('1× Cappuccino (Regular)')).toBeVisible();
    await page.getByRole('button', { name: 'Send to kitchen' }).click();
    await expect(page.getByText('Basket is empty — pick items from the grid.')).toBeVisible();
    await expect(page.getByText('Subtotal')).toBeVisible();
    await expect(page.getByText('IQD 8,000').first()).toBeVisible();

    // ---- settle cash: tendered 10,000 -> change 2,000 ---------------------
    await page.getByRole('button', { name: 'Cash', exact: true }).click();
    const cash = page.getByRole('dialog', { name: 'Cash' });
    await cash.getByLabel('Tendered').fill('10000');
    await expect(cash.getByText('IQD 2,000')).toBeVisible(); // change preview
    await cash.getByRole('button', { name: 'Record payment' }).click();
    await expect(cash).toBeHidden();

    // ---- settled + change shown ------------------------------------------
    await expect(page.getByText('Tab settled.')).toBeVisible();
    // The change row renders <span>Change</span><span>amount</span> in one flex
    // row — anchor on the exact label ("IQD 2,000" alone also matches the Karak
    // Tea price tile in the menu grid).
    await expect(page.locator('div:has(> span:text-is("Change"))').last()).toContainText(
      'IQD 2,000',
    );
  });
});
