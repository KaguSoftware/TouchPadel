/**
 * Till shifts on the operator (docs/design/protocols/wave5-addendum-2026-09-25.md
 * §2.9, §5.1, §6.2; §8 Q29, Q30), one drawer passed between two people:
 *
 *  (a) the cashier's first payment asks for a shift: "That's right" takes what
 *      the drawer is offered, the tender opens in its place, and the payment
 *      lands in her shift; she ends it with a blind count, signed with a
 *      manager's PIN (she has none), sees "Short by 1,000 IQD" and signs out;
 *  (b) the desk takes the handover as counted: the start panel names who left
 *      how much, and one tap starts the next shift;
 *  (c) day close lists both shifts, the open one as a warning that never holds
 *      the close;
 *  (d) @ar: the same start and blind close in Arabic.
 *
 * The browser station is DEV1 (the operator's browser bridge). Every shift a
 * test opens there is closed again (a manager's PIN, through the same RPCs the
 * screen uses), so a rerun starts from an empty drawer. The day is never closed
 * here: other suites share it.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OPERATOR_URL as CONFIG_OPERATOR_URL } from '../playwright.config';
import {
  DEV_PASSWORD,
  SEED_STAFF,
  appRpc,
  ensureOpenDay,
  fixtureTableId,
  passShiftGate,
  serviceClient,
  signedInClient,
  voidOpenTabsForTable,
} from './helpers';

// A run against a second operator server on the local stack (the visual-check
// recipe) points here; the default is the config's own server.
const OPERATOR_URL = process.env.E2E_OPERATOR_URL ?? CONFIG_OPERATOR_URL;
/** The station id the operator's browser bridge reports (src/ipc/bridge.ts). */
const STATION = 'DEV1';
const MANAGER_PIN = '380517';
/** T10: no other suite sits there (T1, T3, T4, T7, T8, T9 and T12 are taken). */
const TABLE = fixtureTableId(10);
/** Karak Tea, Regular (packages/db/fixtures/menu.sql). */
const KARAK_REGULAR = 'f1f70000-0000-4000-8000-0000f0050001';

/** Names are isolate()d wherever they are interpolated: read past the marks. */
const bare = (s: string) => s.replace(/[\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();

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

const key = (type: string) => `${STATION}:${type}:${crypto.randomUUID().replaceAll('-', '').toUpperCase().slice(0, 26)}`;

/**
 * Close whatever shift is open at the station, the way a manager does at the
 * till: beat from it, prove the PIN (a single-use grant), then close it counted
 * at what it should hold.
 */
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

/** The shift open at the station right now, read as the service role. */
async function openShiftAtStation(svc: SupabaseClient) {
  const { data, error } = await svc
    .from('till_shifts')
    .select('id, staff_id, opening_float_iqd')
    .eq('station_id', STATION)
    .is('closed_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; staff_id: string; opening_float_iqd: number } | null;
}

test.describe('operator till shifts', () => {
  test.describe.configure({ mode: 'serial' });

  let svc: SupabaseClient;
  let counted = 0;

  test.beforeAll(async () => {
    svc = serviceClient();
    await ensureOpenDay(svc);
    await voidOpenTabsForTable(svc, TABLE);
    await closeOpenShift();
  });

  test.afterAll(async () => {
    await closeOpenShift();
  });

  test('(a) the first payment asks for a shift, and the shift ends blind with a manager’s PIN', async ({ browser }) => {
    // A tab with one Karak on it, opened at this station.
    const cashier = await signedInClient(SEED_STAFF.cashier);
    let tabId = '';
    try {
      const opened = await appRpc<{ tab_id: string }>(cashier, 'open_tab', {
        p_table_id: TABLE,
        p_device_id: STATION,
        p_idempotency_key: key('tab.open'),
      });
      tabId = opened.tab_id;
      await appRpc(cashier, 'till_add_items', {
        p_tab_id: tabId,
        p_items: [{ variant_id: KARAK_REGULAR, qty: 1 }],
        p_device_id: STATION,
        p_idempotency_key: key('order.add_items'),
      });
    } finally {
      await cashier.auth.signOut();
    }

    const page = await signIn(browser, SEED_STAFF.cashier);
    await expect(page.getByTestId('rail.shift.start')).toBeVisible({ timeout: 30_000 });
    await page.goto(`${OPERATOR_URL}/till?tab=${tabId}`);
    await page.getByRole('button', { name: 'Cash', exact: true }).click();
    // The gate: the start panel first, the tender in its place once started.
    const start = page.getByRole('dialog', { name: 'Start my shift' });
    await expect(start).toBeVisible();
    await expect(start.getByText('Start your shift to take payment.')).toBeVisible();
    await passShiftGate(page);
    const cash = page.getByRole('dialog', { name: 'Cash' });
    await cash.getByRole('button', { name: 'Exact amount' }).click();
    await cash.getByRole('button', { name: 'Record payment' }).click();
    await expect(cash).toBeHidden();

    // The payment landed in her shift (the station's stamp, §2.9.3).
    const shift = await openShiftAtStation(svc);
    expect(shift).not.toBeNull();
    const { data: pays } = await svc.from('payments').select('amount_iqd, method, till_shift_id').eq('tab_id', tabId);
    expect(pays).toHaveLength(1);
    expect(pays![0]).toMatchObject({ method: 'cash', till_shift_id: shift!.id });
    const expected = shift!.opening_float_iqd + Number((pays![0] as { amount_iqd: number }).amount_iqd);
    counted = expected - 1_000;

    // End my shift: count first, with no expected figure anywhere (Q29).
    await expect(page.getByTestId('rail.shift.end')).toBeVisible();
    await page.getByTestId('rail.shift.end').click();
    const end = page.getByRole('dialog', { name: 'End my shift' });
    await expect(end.getByText(/Count all the cash in the drawer/)).toBeVisible();
    await expect(end).not.toContainText('Expected');
    await end.getByLabel('Cash in the drawer').fill(String(counted));
    await end.getByRole('button', { name: 'Next' }).click();
    // She has no PIN of her own: a manager signs the count.
    await expect(end.getByText('You have no PIN yet, so a manager signs this count.')).toBeVisible();
    await end.getByLabel('Manager’s PIN').fill(MANAGER_PIN);
    await end.getByRole('button', { name: 'End my shift' }).click();

    const closed = page.getByRole('dialog', { name: 'Shift closed' });
    await expect(closed.getByText('Short by 1,000 IQD')).toBeVisible();
    await closed.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 30_000 });
    await page.context().close();
  });

  test('(b) the desk takes the handover as counted', async ({ browser }) => {
    const page = await signIn(browser, SEED_STAFF.court_desk);
    await page.getByTestId('rail.shift.start').click();
    const start = page.getByRole('dialog', { name: 'Start my shift' });
    const handover = start.getByText(/left .* in the drawer at/);
    await expect(handover).toBeVisible();
    expect(bare(await handover.innerText())).toContain(`Dev Cashier left ${counted.toLocaleString('en-US')} IQD in the drawer at`);
    await start.getByRole('button', { name: 'That’s right' }).click();
    await expect(start).toBeHidden();
    await expect(page.getByTestId('rail.shift.end')).toBeVisible();
    const shift = await openShiftAtStation(svc);
    expect(shift?.opening_float_iqd).toBe(counted);
    await page.context().close();
  });

  test('(c) day close lists both shifts, the open one a warning that never holds the close', async ({ browser }) => {
    const page = await signIn(browser, SEED_STAFF.manager);
    await page.goto(`${OPERATOR_URL}/admin/day-close`);
    const step = page.getByTestId('day-close-shifts');
    await expect(step).toBeVisible({ timeout: 30_000 });
    await expect(step.getByText('Short by 1,000 IQD').first()).toBeVisible();
    await expect(step.getByText('Open', { exact: true }).first()).toBeVisible();
    await expect(step).toContainText('Closing the day ends an open shift without a count');
    // Whatever holds the close, it is never the shift: the reasons name tabs,
    // sync or the count, and nothing else (closeBlock is unchanged).
    await page.getByLabel('Counted cash (IQD)').fill('1');
    const close = page.getByRole('button', { name: 'Close the day' });
    const reason = await close.getAttribute('aria-describedby');
    if (reason) await expect(page.locator(`[id="${reason}"]`)).not.toContainText(/shift/i);
    await page.context().close();
  });

  test('(d) @ar the same start and blind close, in Arabic', async ({ browser }) => {
    await closeOpenShift();
    const page = await signIn(browser, SEED_STAFF.cashier, 'ar');
    await page.getByTestId('rail.shift.start').click();
    const start = page.getByRole('dialog', { name: 'بدء ورديتي' });
    await start.getByRole('button', { name: 'نعم، صحيح' }).click();
    await expect(start).toBeHidden();
    const shift = await openShiftAtStation(svc);
    expect(shift).not.toBeNull();

    await page.getByTestId('rail.shift.end').click();
    const end = page.getByRole('dialog', { name: 'إنهاء ورديتي' });
    await expect(end).not.toContainText('المتوقّع');
    await end.getByLabel('النقد في الدرج').fill(String(shift!.opening_float_iqd));
    await end.getByRole('button', { name: 'التالي' }).click();
    await end.getByLabel('رمز المدير').fill(MANAGER_PIN);
    await end.getByRole('button', { name: 'إنهاء ورديتي' }).click();
    await expect(page.getByRole('dialog', { name: 'أُغلقت الوردية' }).getByText('الدرج مطابق')).toBeVisible();
    await page.context().close();
  });
});
