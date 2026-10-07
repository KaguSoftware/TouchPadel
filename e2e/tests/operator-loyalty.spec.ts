/**
 * Loyalty on the operator (docs/design/loyalty/build-contracts-2026-10-05.md §1.3, plan §5.3),
 * against the local stack once the loyalty migrations (0303–0306) are in it. Labels are read
 * from the catalogs, so a copy edit does not break a journey.
 *
 *  1. Cashier: a café tab on T5 with one Karak on it. "Member" → the guest's phone typed into
 *     the one field → the member chip on the tab with their balance (points seeded by the
 *     service role as an `adjust` ledger row). "Use points" → the smallest use → the bill's
 *     "Loyalty points" row, and the ledger and the tab's adjustment agree. Undo gives them back.
 *  2. Owner: Setup › Loyalty loads its three panels.
 *  3. @ar: the same page in Arabic, right to left.
 *
 * Loyalty ships switched off (L-1): the suite switches it on with the service role for its own
 * run and puts the settings back after, so no other suite earns points by accident.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { OPERATOR_URL as CONFIG_OPERATOR_URL } from '../playwright.config';
import { ar } from '../../packages/i18n/src/catalogs/ar';
import { en } from '../../packages/i18n/src/catalogs/en';
import {
  DEV_PASSWORD,
  MANAGER_PIN,
  SEED_STAFF,
  appRpc,
  ensureOpenDay,
  fixtureTableId,
  seedMatchPlayers,
  serviceClient,
  signedInClient,
  voidOpenTabsForTable,
  type MatchPlayer,
} from './helpers';

const OPERATOR_URL = process.env.E2E_OPERATOR_URL ?? CONFIG_OPERATOR_URL;
/** The station id the operator's browser bridge reports (src/ipc/bridge.ts). */
const STATION = 'DEV1';
/** T5: no other suite sits there. */
const TABLE = fixtureTableId(5);
/** Karak Tea, Regular (packages/db/fixtures/menu.sql). */
const KARAK_REGULAR = 'f1f70000-0000-4000-8000-0000f0050001';
const L = en.ws.loyalty;
const POINT_VALUE = 50;
const MIN_REDEEM = 10;
const SEEDED_POINTS = 500;

const key = (type: string) =>
  `${STATION}:${type}:${crypto.randomUUID().replaceAll('-', '').toUpperCase().slice(0, 26)}`;

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

type SettingsRow = { enabled: boolean; point_value_iqd: number; min_redeem_points: number };

async function readSettings(svc: SupabaseClient): Promise<SettingsRow> {
  const { data, error } = await svc
    .from('loyalty_settings')
    .select('enabled, point_value_iqd, min_redeem_points')
    .single();
  if (error) throw new Error(`loyalty_settings: ${error.message}`);
  return data as SettingsRow;
}

async function writeSettings(svc: SupabaseClient, row: SettingsRow): Promise<void> {
  const { error } = await svc.from('loyalty_settings').update(row).eq('id', true);
  if (error) throw new Error(`loyalty_settings update: ${error.message}`);
}

/** The guest's balance from the account cache the ledger trigger keeps. */
async function balanceOf(svc: SupabaseClient, profileId: string): Promise<number> {
  const { data } = await svc
    .from('loyalty_accounts')
    .select('balance')
    .eq('profile_id', profileId)
    .maybeSingle();
  return Number((data as { balance: number } | null)?.balance ?? 0);
}

/** Top the guest up to SEEDED_POINTS with one `adjust` row, so a rerun starts from the same balance. */
async function seedPoints(svc: SupabaseClient, profileId: string): Promise<void> {
  const delta = SEEDED_POINTS - (await balanceOf(svc, profileId));
  if (delta === 0) return;
  const { error } = await svc.from('loyalty_ledger').insert({
    profile_id: profileId,
    delta,
    kind: 'adjust',
    source_kind: 'e2e',
    source_id: crypto.randomUUID(),
    note: 'Playwright seed',
  });
  if (error) throw new Error(`seedPoints: ${error.message}`);
}

test.describe('operator loyalty', () => {
  test.describe.configure({ mode: 'serial' });

  let svc: SupabaseClient;
  let before: SettingsRow;
  let guest: MatchPlayer;
  let phone = '';

  test.beforeAll(async () => {
    svc = serviceClient();
    await ensureOpenDay(svc);
    await voidOpenTabsForTable(svc, TABLE);
    before = await readSettings(svc);
    await writeSettings(svc, {
      enabled: true,
      point_value_iqd: POINT_VALUE,
      min_redeem_points: MIN_REDEEM,
    });
    [guest] = await seedMatchPlayers(svc, ['l']);
    const { data } = await svc.from('profiles').select('phone').eq('id', guest.id).single();
    phone = (data as { phone: string }).phone;
    // Since 0307 a phone is a member's identity only once verified: confirm it on the auth user,
    // as a phone sign-up would, so the till's phone lookup finds them.
    const confirmed = await svc.auth.admin.updateUserById(guest.id, { phone, phone_confirm: true });
    if (confirmed.error) throw new Error(`confirm phone: ${confirmed.error.message}`);
    await seedPoints(svc, guest.id);
  });

  test.afterAll(async () => {
    await voidOpenTabsForTable(svc, TABLE);
    if (before) await writeSettings(svc, before);
  });

  test('a cashier adds a member by phone to a café tab, uses points and undoes them', async ({
    browser,
  }) => {
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
    await page.goto(`${OPERATOR_URL}/till?tab=${tabId}`);

    // The one field: the phone the guest says.
    await page.getByTestId('member-button').click();
    const find = page.getByRole('dialog', { name: L.member.title });
    await expect(find).toBeVisible();
    await find.getByTestId('member-code').fill(phone);
    await find.getByTestId('member-find').click();
    await expect(find).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId('member-chip')).toBeVisible();
    await expect(page.getByTestId('member-balance')).toContainText(String(SEEDED_POINTS));
    const { data: tab } = await svc.from('tabs').select('customer_id').eq('id', tabId).single();
    expect((tab as { customer_id: string }).customer_id).toBe(guest.id);

    // Use points: the smallest use, so the Karak still has something left to pay.
    await page.getByTestId('member-use-points').click();
    const redeem = page.getByRole('dialog', { name: L.redeem.title });
    await redeem.getByTestId('redeem-points').fill(String(MIN_REDEEM));
    // Found by phone, not by a scanned card: spending points takes a manager's PIN (0308).
    await redeem.getByTestId('redeem-pin').fill(MANAGER_PIN);
    await redeem.getByTestId('redeem-confirm').click();
    await expect(redeem).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText(L.redeem.billRow)).toBeVisible();
    const { data: adj } = await svc
      .from('tab_adjustments')
      .select('id, amount_iqd, reason_code')
      .eq('tab_id', tabId)
      .eq('reason_code', 'loyalty_points');
    expect(adj).toHaveLength(1);
    expect((adj![0] as { amount_iqd: number }).amount_iqd).toBe(MIN_REDEEM * POINT_VALUE);
    expect(await balanceOf(svc, guest.id)).toBe(SEEDED_POINTS - MIN_REDEEM);

    // Undo gives the points back and takes the row off the bill.
    await page.getByTestId('member-undo').click();
    await expect(page.getByText(L.redeem.billRow)).toBeHidden({ timeout: 30_000 });
    await expect.poll(() => balanceOf(svc, guest.id)).toBe(SEEDED_POINTS);
  });

  test('the owner opens Setup › Loyalty', async ({ browser }) => {
    const page = await signIn(browser, SEED_STAFF.owner);
    await page.goto(`${OPERATOR_URL}/admin/loyalty`);
    await expect(page.getByRole('heading', { name: L.setup.title, level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('loyalty-settings')).toBeVisible();
    await expect(page.getByTestId('loyalty-tiers')).toContainText('Member');
    await expect(page.getByTestId('loyalty-rewards')).toBeVisible();
  });

  test('@ar Setup › Loyalty reads right to left', async ({ browser }) => {
    const page = await signIn(browser, SEED_STAFF.owner, 'ar');
    await page.goto(`${OPERATOR_URL}/admin/loyalty`);
    await expect(
      page.getByRole('heading', { name: ar.ws.loyalty.setup.title, level: 1 }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('loyalty-tiers')).toContainText(ar.ws.loyalty.setup.tiers.title);
  });
});
