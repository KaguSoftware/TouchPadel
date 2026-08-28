/**
 * Operator-side cafe administration — the screens the rebuild added, driven the
 * way the owner will drive them, and (where it matters) verified on the GUEST
 * app in the same test:
 *
 *  (a) Home screen  — a featured hero written here shows up on the guest page.
 *  (b) Menu         — the 86 / sold-out switch stamps the guest card.
 *  (c) Table QR     — one A6 card per active table; the bell switch persists.
 *  (d) Telegram     — the test message enqueues even with no bot configured.
 *  (e) Analytics    — the zones render sales-only, saying PostHog is missing.
 *  (f) KDS          — a ticket left queued raises the stale banner.
 *  (g) Audit log    — a real action taken here is traceable to a named actor.
 *  (h) Staff        — the owner creates an account, changes its role, removes it.
 *
 * Role gates matter here: /admin/telegram, /admin/staff and /analytics are
 * owner-only, so these sign in as the owner unless the case is about a manager.
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
  mintTableToken,
  openGuestSession,
  channelJoined,
  serviceClient,
  signedInClient,
  startTillHeartbeat,
  voidOpenTabsForTable,
} from './helpers';

const KDS_TABLE = fixtureTableId(9); // T9 — kept away from the till journey's T8
const TURKISH_COFFEE = 'f1f70000-0000-4000-8000-00000000e004';
const KAHI = 'f1f70000-0000-4000-8000-00000000e017';

async function signIn(page: Page, email: string) {
  await page.goto(OPERATOR_URL);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Wait for the shell. Navigating while the sign-in request is still in flight
  // reloads the SPA mid-auth and lands back on the form.
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toHaveCount(0, {
    timeout: 30_000,
  });
}

async function gotoAdmin(page: Page, sub: string) {
  await page.goto(`${OPERATOR_URL}/admin/${sub}`);
}

test.describe('operator cafe admin', () => {
  let svc: SupabaseClient;
  let stopHeartbeat: () => void;

  test.beforeAll(async () => {
    svc = serviceClient();
    await ensureTillFresh(svc);
    await ensureOpenDay(svc);
    stopHeartbeat = startTillHeartbeat(svc);
  });

  test('(a) the home screen builder drives the guest hero', async ({ page, context }) => {
    await signIn(page, SEED_STAFF.owner);
    await gotoAdmin(page, 'hero');
    await expect(page.getByRole('heading', { name: 'Home screen' })).toBeVisible({
      timeout: 30_000,
    });

    // Open the guest app FIRST and wait for its `menu` subscription: the SSR
    // menu is cached for 60s, so a page loaded after the save could legitimately
    // still show the old badge. The live path is the one worth asserting.
    const guest = await context.newPage();
    await guest.setViewportSize({ width: 390, height: 844 });
    const joined = channelJoined(guest);
    await guest.goto('/en');
    await expect(guest.locator('.tp-hero__marquee')).toBeVisible({ timeout: 60_000 });
    await joined;

    // The fixture already sits in "featured" mode — change the badge so the
    // assertion cannot pass on stale state.
    const badge = `E2E${Date.now() % 100000}`;
    await page.getByRole('button', { name: 'Featured item' }).click();
    await page.getByLabel('Badge (EN)').fill(badge);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    await expect(guest.locator('.tp-hero__badge')).toHaveText(badge, { timeout: 30_000 });
    await guest.close();
  });

  test('(b) the sold-out switch stamps the guest card', async ({ page, context }) => {
    // Menu content is manager-level — prove the manager can do it.
    await signIn(page, SEED_STAFF.manager);
    await gotoAdmin(page, 'menu');
    await expect(page.getByRole('heading', { name: 'Menu items' })).toBeVisible({
      timeout: 30_000,
    });

    const guest = await context.newPage();
    await guest.setViewportSize({ width: 390, height: 844 });
    const joined = channelJoined(guest);
    await guest.goto('/en');
    const card = guest.locator('.tp-menu-item', { hasText: 'Turkish Coffee' }).first();
    await expect(card).toBeVisible({ timeout: 60_000 });
    await joined;

    const manager = await signedInClient(SEED_STAFF.manager);
    try {
      await appRpc(manager, 'set_item_sold_out', { p_item_id: TURKISH_COFFEE, p_sold_out: true });
      await expect(card).toHaveAttribute('data-sold-out', 'true', { timeout: 20_000 });
      await expect(card.locator('.tp-stamp')).toHaveText('Sold out');
    } finally {
      await appRpc(manager, 'set_item_sold_out', { p_item_id: TURKISH_COFFEE, p_sold_out: false });
      await manager.auth.signOut();
    }
    await guest.close();
  });

  test('(c) QR page prints one card per active table and the bell persists', async ({ page }) => {
    await signIn(page, SEED_STAFF.manager);
    await gotoAdmin(page, 'qr');
    await expect(page.getByRole('heading', { name: /Table QR codes/ })).toBeVisible({
      timeout: 30_000,
    });

    const { count: activeTables } = await svc
      .from('cafe_tables')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);

    // One printable A6 page per active table.
    await expect(page.locator('[data-print-page]')).toHaveCount(activeTables ?? 0);
    // Cards must carry a real QR, not a placeholder.
    await expect(page.locator('[data-print-page] svg').first()).toBeVisible();

    // T12 ships with the bell OFF (fixtures/tables.sql) — flip it and check the DB.
    // Anchor on the card's own QR image label; `hasText: 'T12'` would also match
    // the printed URL on any card.
    const t12 = page
      .locator('[data-print-page]')
      .filter({ has: page.getByRole('img', { name: 'TABLE T12' }) })
      .first();
    const bell = t12.getByRole('switch');
    await expect(bell).toHaveAttribute('aria-checked', 'false');
    await bell.click();
    await expect(bell).toHaveAttribute('aria-checked', 'true');
    await expect
      .poll(
        async () => {
          const { data } = await svc
            .from('cafe_tables')
            .select('bell_enabled')
            .eq('table_number', 'T12')
            .single();
          return (data as { bell_enabled: boolean } | null)?.bell_enabled;
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    // Restore the fixture state.
    const manager = await signedInClient(SEED_STAFF.manager);
    try {
      const { data: row } = await svc
        .from('cafe_tables')
        .select('id')
        .eq('table_number', 'T12')
        .single();
      await appRpc(manager, 'set_table_bell', {
        p_table_id: (row as { id: string }).id,
        p_enabled: false,
      });
    } finally {
      await manager.auth.signOut();
    }
  });

  test('(c2) a bell-off table hides the guest bell', async ({ page }) => {
    // T12's bell is off in the fixtures — the guest must get the counter hint,
    // never a dead button.
    const bellOwner = await signedInClient(SEED_STAFF.owner);
    try {
      await appRpc(bellOwner, 'set_table_bell', {
        p_table_id: fixtureTableId(12),
        p_enabled: false,
      });
    } finally {
      await bellOwner.auth.signOut();
    }
    const token = await mintTableToken(fixtureTableId(12));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/t/${token}`);
    await expect(page.locator('.tp-cafe__table')).toContainText('T12', { timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Call a waiter' })).toHaveCount(0);
  });

  test('(d) Telegram is owner-only and the test message enqueues', async ({ page }) => {
    // Manager must not reach it (auth.tsx default-deny + ROUTE_ROLES).
    await signIn(page, SEED_STAFF.manager);
    await gotoAdmin(page, 'telegram');
    await expect(page.getByRole('heading', { name: 'Telegram' })).toHaveCount(0, {
      timeout: 20_000,
    });
    await page.getByRole('button', { name: 'Sign out' }).click();

    await signIn(page, SEED_STAFF.owner);
    await gotoAdmin(page, 'telegram');
    await expect(page.getByRole('heading', { name: 'Telegram' })).toBeVisible({ timeout: 30_000 });

    // No bot token exists locally, so the row must land as queued or failed —
    // never crash the screen. The point of the case is that it ENQUEUES.
    const before = await svc
      .from('telegram_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'test');

    // "Send test" is gated on telegram_enabled AND a saved chat id — set both,
    // the way the owner will on setup day.
    await page.getByLabel('Group chat ID').fill('-1001234567890');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.getByRole('switch', { name: 'Send notifications to Telegram' }).click();

    const sendTest = page.getByRole('button', { name: 'Send test message' });
    await expect(sendTest).toBeEnabled({ timeout: 15_000 });
    await sendTest.click();

    await expect
      .poll(
        async () => {
          const { count } = await svc
            .from('telegram_outbox')
            .select('id', { count: 'exact', head: true })
            .eq('kind', 'test');
          return count ?? 0;
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(before.count ?? 0);

    // The outbox tab lists it.
    await page.getByRole('tab', { name: 'Outbox' }).click();
    await expect(page.getByText('test').first()).toBeVisible();
  });

  test('(e) analytics renders sales-only and says PostHog is missing', async ({ page }) => {
    await signIn(page, SEED_STAFF.owner);
    await page.goto(`${OPERATOR_URL}/analytics?range=7d`);

    // The page title lives in the control deck, not a heading; the ZONES are the
    // headings. Wait on the deck, then assert every zone rendered.
    await expect(page.getByText('Analytics', { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });
    for (const zone of ['Pulse', 'Insights', 'Menu', 'Sales & engagement', 'Time']) {
      await expect(page.getByRole('heading', { name: zone, exact: true })).toBeVisible();
    }

    // Sales come from OUR till data, so this KPI must render even with no
    // PostHog project — that is the whole "sales-only mode" contract.
    await expect(page.getByText('Item sales')).toBeVisible();
    await expect(
      page.getByText('Guest analytics are not configured yet', { exact: false }).first(),
    ).toBeVisible();

    // The range lives in the URL, so a reload keeps the owner where they were.
    await page.reload();
    await expect(page.getByRole('button', { name: '7 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('(f) a ticket left queued raises the KDS stale banner', async ({ page }) => {
    await voidOpenTabsForTable(svc, KDS_TABLE);

    // Build a real guest order on T9, then age its ticket past STALE_SECS (90).
    const guest = await openGuestSession(KDS_TABLE);
    const order = await appRpc<{ ticket_id: string }>(guest.client, 'create_guest_order', {
      p_items: [{ variant_id: 'f1f70000-0000-4000-8000-0000f0010001', qty: 1 }],
      p_idempotency_key: `e2e-kds-${Date.now()}`,
    });
    const ticketId = order.ticket_id;
    await guest.client.auth.signOut();
    await svc
      .from('tickets')
      .update({ created_at: new Date(Date.now() - 100_000).toISOString() })
      .eq('id', ticketId);

    await signIn(page, SEED_STAFF.prep);
    await expect(page.getByText('⚠', { exact: false }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('need attention', { exact: false })).toBeVisible();
    await expect(page.getByText('Waiting too long').first()).toBeVisible();

    // Clear it so the KDS board is clean for other runs.
    const prep = await signedInClient(SEED_STAFF.prep);
    try {
      await appRpc(prep, 'set_ticket_status', { p_ticket_id: ticketId, p_status: 'preparing' });
      await appRpc(prep, 'set_ticket_status', { p_ticket_id: ticketId, p_status: 'ready' });
      await appRpc(prep, 'set_ticket_status', { p_ticket_id: ticketId, p_status: 'completed' });
    } finally {
      await prep.auth.signOut();
    }
    await voidOpenTabsForTable(svc, KDS_TABLE);
  });

  test.afterAll(async () => {
    stopHeartbeat?.();
    // Undo the Telegram setup case (d) performed.
    const tgOwner = await signedInClient(SEED_STAFF.owner);
    try {
      await appRpc(tgOwner, 'set_cafe_setting', { p_key: 'telegram_enabled', p_value: false });
      await appRpc(tgOwner, 'set_cafe_setting', { p_key: 'telegram_chat_id', p_value: null });
    } finally {
      await tgOwner.auth.signOut();
    }
    // Leave the featured hero the way the fixtures had it.
    const owner = await signedInClient(SEED_STAFF.owner);
    try {
      await appRpc(owner, 'set_cafe_setting', { p_key: 'featured_badge_en', p_value: 'New' });
      await appRpc(owner, 'set_cafe_setting', { p_key: 'featured_item_id', p_value: KAHI });
    } finally {
      await owner.auth.signOut();
    }
  });
  test('(g) an action taken in the app is traceable in the audit log', async ({ page }) => {
    // SOW L241-243 promises the log; L434-439 makes "every discount, void and
    // refund traceable to a named actor" an acceptance test. The log has been
    // written correctly since day 1 and, until this screen existed, read by
    // nothing — so the promise was demonstrable only by typing SQL.
    await signIn(page, SEED_STAFF.owner);

    // Take a real, audited action first: the sold-out switch writes
    // 'menu.item.sold_out' against the item id.
    await gotoAdmin(page, 'menu');
    const soldOut = page.getByRole('switch').first();
    await expect(soldOut).toBeVisible({ timeout: 30_000 });
    const wasOn = (await soldOut.getAttribute('aria-checked')) === 'true';
    await soldOut.click();
    await expect(soldOut).toHaveAttribute('aria-checked', String(!wasOn), { timeout: 15_000 });

    await gotoAdmin(page, 'audit');
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible({
      timeout: 30_000,
    });

    // The actor is a NAME, not a uuid — that is the contractual word.
    const search = page.getByLabel('Search');
    await search.fill('sold_out');
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toContainText('menu.item.sold_out');
    await expect(firstRow).toContainText('Dev Owner');

    // Before/after is a field-level diff, not two blobs of jsonb.
    await firstRow.getByRole('button', { name: /Changes/ }).click();
    await expect(page.getByText('sold_out', { exact: true }).first()).toBeVisible();

    // Filtering by area narrows to that family and nothing else.
    await firstRow.getByRole('button', { name: 'Hide' }).click();
    await search.fill('');
    await page.getByLabel('Area').selectOption('menu');
    // Scoped by attribute: the expanded before/after table repeats the column
    // positions, so an nth-child selector would also match its cells.
    const actions = await page.locator('[data-audit-action]').allInnerTexts();
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every((a) => a.startsWith('menu.'))).toBe(true);

    // Put the item back the way it was.
    await gotoAdmin(page, 'menu');
    const restore = page.getByRole('switch').first();
    await expect(restore).toBeVisible({ timeout: 30_000 });
    await restore.click();
    await expect(restore).toHaveAttribute('aria-checked', String(wasOn), { timeout: 15_000 });
  });
  test('(h) the owner creates, re-roles and removes a staff account', async ({ page }) => {
    // SOW L234 — "Staff accounts created and managed by the owner role" — and a
    // phase-acceptance condition (L997). This screen was a read-only table whose
    // own header said invites stay in the Supabase dashboard, so the promise
    // could not be demonstrated at handover at all.
    const stamp = Date.now();
    const email = `e2e-staff-${stamp}@test.touch.local`;
    // Unique per run: a run that fails BEFORE the id is known cannot clean up
    // after itself, and a fixed name then makes every later run ambiguous.
    const name = `E2E Staff ${stamp}`;
    let createdId: string | null = null;

    // Sweep anything an earlier interrupted run left behind.
    const { data: stale } = await svc
      .from('staff')
      .select('id')
      .like('display_name', 'E2E Staff %');
    for (const row of (stale ?? []) as { id: string }[]) {
      await svc.from('staff').delete().eq('id', row.id);
      await svc.auth.admin.deleteUser(row.id).catch(() => undefined);
    }

    try {
      await signIn(page, SEED_STAFF.owner);
      await gotoAdmin(page, 'staff');
      await expect(page.getByRole('heading', { name: 'Staff' })).toBeVisible({
        timeout: 30_000,
      });

      await page.getByRole('button', { name: 'Add staff member' }).click();
      const dialog = page.getByRole('dialog', { name: 'Add staff member' });
      await dialog.getByLabel('Email').fill(email);
      await dialog.getByLabel('Name').fill(name);
      await dialog.getByLabel('Password').fill('a-long-enough-password');
      await dialog.getByRole('button', { name: 'Add staff member' }).click();

      await expect(page.getByText('Account created.')).toBeVisible({ timeout: 30_000 });
      const row = page.locator(`tr:has-text("${name}")`);
      await expect(row).toBeVisible();

      const { data: staffRow } = await svc
        .from('staff')
        .select('id, role, is_active')
        .eq('display_name', name)
        .single();
      createdId = (staffRow as { id: string }).id;
      expect((staffRow as { role: string }).role).toBe('cashier');

      // Promote to manager through the row select.
      await row.getByRole('combobox').selectOption('manager');
      await expect(async () => {
        const { data } = await svc.from('staff').select('role').eq('id', createdId!).single();
        expect((data as { role: string }).role).toBe('manager');
      }).toPass({ timeout: 20_000 });

      // A manager can hold an authorisation PIN; a cashier has nothing to
      // authorise, so the control only appears once the role allows it.
      await expect(row.getByRole('button', { name: 'Set PIN' })).toBeVisible({
        timeout: 15_000,
      });

      // Remove access. The row is KEPT — past work stays attributable.
      await row.getByRole('button', { name: 'Remove', exact: true }).click();
      const confirmDialog = page.getByRole('dialog', { name: 'Remove access?' });
      await confirmDialog.getByRole('button', { name: 'Remove', exact: true }).click();
      await expect(async () => {
        const { data } = await svc
          .from('staff')
          .select('is_active, display_name')
          .eq('id', createdId!)
          .single();
        expect((data as { is_active: boolean }).is_active).toBe(false);
        expect((data as { display_name: string }).display_name).toBe(name);
      }).toPass({ timeout: 20_000 });

      // The owner cannot re-role or remove their OWN account: with one owner
      // that guard is all that stands between the venue and a lockout.
      const selfRow = page.locator('tr', { hasText: '(you)' });
      await expect(selfRow.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled();
      await expect(selfRow.getByRole('combobox')).toBeDisabled();
    } finally {
      if (createdId) {
        await svc.from('staff').delete().eq('id', createdId);
        await svc.auth.admin.deleteUser(createdId).catch(() => undefined);
      }
    }
  });
});