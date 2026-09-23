/**
 * Operator-side cafe administration — the screens the rebuild added, driven the
 * way the owner will drive them, and (where it matters) verified on the GUEST
 * app in the same test:
 *
 *  (a) Home screen  — a featured hero written here shows up on the guest page.
 *  (b) Menu         — the 86 / sold-out switch stamps the guest card.
 *  (c) Tables & QR  — one A6 card per active table at print time; the bell switch persists.
 *  (d) Telegram     — the test message enqueues even with no bot configured.
 *  (e) Analytics    — the zones render sales-only, saying PostHog is missing.
 *  (f) KDS          — a ticket left queued raises the stale banner.
 *  (g) Audit log    — a real action taken here is traceable to a named actor.
 *  (h) Staff        — the owner creates an account, changes its role, removes its access.
 *  (j) Courts       — create a court, see it on the desk, switch it off.
 *
 * Role gates matter here: /admin/telegram, /admin/staff and /analytics are
 * owner-only, so these sign in as the owner unless the case is about a manager.
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
    // op.hero.title — the page h1 names the rail row it opens from ("Guest site").
    await expect(page.getByRole('heading', { level: 1, name: 'Guest site home screen', exact: true })).toBeVisible({
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
    // The mode is a card-shaped toggle button named by its label (aria-pressed).
    const featured = page.getByRole('button', { name: 'Featured item', exact: true });
    await featured.click();
    await expect(featured).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('Badge (EN)', { exact: true }).fill(badge);
    // The one Save lives in the sticky bar at the foot of the form.
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    // exact: the save bar's own "Everything is saved." also contains the word.
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

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
    await expect(page.getByRole('heading', { level: 1, name: 'Tables & QR', exact: true })).toBeVisible({
      timeout: 30_000,
    });

    const { count: activeTables } = await svc
      .from('cafe_tables')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);
    const active = activeTables ?? 0;

    // The screen is a list now; one row per active table (table_qr_tokens).
    const list = page.getByRole('table', { name: 'Tables', exact: true });
    await expect(list.locator('tbody tr')).toHaveCount(active, { timeout: 30_000 });

    // One printable A6 page per active table. The print sheet is mounted only
    // while printing, so capture it at the moment window.print() runs: the
    // stub records how many [data-print-page] cards exist, how many carry a QR
    // path, and that the A6 print mode is on. The real print dialog never opens.
    await page.evaluate(() => {
      const w = window as unknown as { __printed?: { pages: number; withQr: number; mode: string | undefined } };
      window.print = () => {
        w.__printed = {
          pages: document.querySelectorAll('[data-print-page]').length,
          withQr: document.querySelectorAll('[data-print-page] svg path').length,
          mode: document.body.dataset.print,
        };
      };
    });
    await page.getByRole('button', { name: `Print all cards (${active})`, exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __printed?: { pages: number } }).__printed?.pages ?? -1))
      .toBe(active);
    const printed = await page.evaluate(
      () => (window as unknown as { __printed: { pages: number; withQr: number; mode: string | undefined } }).__printed,
    );
    expect(printed.mode).toBe('a6');
    // Cards must carry a real QR, not a placeholder: at least one path per card.
    expect(printed.withQr).toBeGreaterThanOrEqual(active);
    // …and the sheet is gone again once printing is over.
    await expect(page.locator('[data-print-page]')).toHaveCount(0);

    // T12 ships with the bell OFF (fixtures/tables.sql) — flip it and check the DB.
    // The row's switch is named for its table (hidden label on the list).
    const bell = page.getByRole('switch', { name: 'Waiter bell for table T12', exact: true });
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
    await expect(page.getByRole('heading', { level: 1, name: 'Telegram', exact: true })).toHaveCount(0, {
      timeout: 20_000,
    });
    // Sign-out is confirmed: the rail button opens the dialog, the dialog signs out.
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('dialog', { name: 'Sign out?' }).getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toBeVisible();

    await signIn(page, SEED_STAFF.owner);
    await gotoAdmin(page, 'telegram');
    await expect(page.getByRole('heading', { level: 1, name: 'Telegram', exact: true })).toBeVisible({ timeout: 30_000 });

    // No bot token exists locally, so the row must land as queued or failed —
    // never crash the screen. The point of the case is that it ENQUEUES.
    const before = await svc
      .from('telegram_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'test');

    // "Send test" is gated on telegram_enabled AND a saved chat id — set both,
    // the way the owner will on setup day. With no bot locally there is no
    // detected group to pick, so the id is typed into the folded manual field.
    await page.getByText('Enter the group chat ID by hand', { exact: true }).click();
    await page.getByLabel('Group chat ID', { exact: true }).fill('-1001234567890');
    // Save appears beside the field once the id differs from the saved one.
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.getByRole('switch', { name: 'Send notifications to Telegram', exact: true }).click();

    const sendTest = page.getByRole('button', { name: 'Send test message', exact: true });
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

    // The sent-messages tab lists it, in words (kind 'test' → "Test message").
    await page.getByRole('tab', { name: 'Sent messages', exact: true }).click();
    await expect(
      page.getByRole('table', { name: 'Sent messages', exact: true }).getByText('Test message', { exact: true }).first(),
    ).toBeVisible();
  });

  test('(e) analytics renders sales-only and says PostHog is missing', async ({ page }) => {
    await signIn(page, SEED_STAFF.owner);
    await page.goto(`${OPERATOR_URL}/analytics/cafe?range=7d`);

    // Analytics is a Management rail row with two tabs; the cafe tab is the one
    // this case is about. The page h1 is the wait target (the rail row is also
    // called "Analytics", so a bare text match would resolve to the link).
    await expect(page.getByRole('heading', { level: 1, name: 'Analytics' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page).toHaveURL(/\/analytics\/cafe\?range=7d/);
    await expect(page.getByRole('tab', { name: 'Cafe' })).toHaveAttribute('aria-selected', 'true');
    for (const zone of ['Summary', 'What stands out', 'Menu', 'Sales and the guest menu', 'Busy times']) {
      await expect(page.getByRole('heading', { name: zone, exact: true })).toBeVisible();
    }

    // Sales come from OUR till data, so this KPI must render even with no
    // PostHog project — that is the whole "sales-only mode" contract.
    // exact: the tile's info tooltips are always in the DOM and open with the same words.
    await expect(page.getByText('Cafe sales', { exact: true })).toBeVisible();
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

  test('(i) an item-ready mark survives a reload — server state since 0061', async ({ page }) => {
    await voidOpenTabsForTable(svc, KDS_TABLE);
    const guest = await openGuestSession(KDS_TABLE);
    const order = await appRpc<{ ticket_id: string }>(guest.client, 'create_guest_order', {
      p_items: [
        { variant_id: 'f1f70000-0000-4000-8000-0000f0010001', qty: 1 },
        { variant_id: 'f1f70000-0000-4000-8000-0000f0050001', qty: 1 },
      ],
      p_idempotency_key: `e2e-kds-ready-${Date.now()}`,
    });
    const ticketId = order.ticket_id;
    await guest.client.auth.signOut();

    await signIn(page, SEED_STAFF.prep);
    // The checkbox's accessible name is its line ("1× Espresso (Regular)") —
    // target by name so leftovers from other cases can't shift the indexes.
    const espresso = page.getByRole('checkbox', { name: /Espresso/ }).first();
    const karak = page.getByRole('checkbox', { name: /Karak/ }).first();
    await expect(espresso).toBeVisible({ timeout: 30_000 });

    // Tick one item; the mark is optimistic, then persisted server-side.
    await espresso.check();
    await expect(espresso).toBeChecked();

    // The audit's M1 repro: a reload used to lose every mark.
    await page.reload();
    await expect(page.getByRole('checkbox', { name: /Espresso/ }).first()).toBeChecked({
      timeout: 30_000,
    });
    await expect(karak).not.toBeChecked();

    // Clean up: run the ticket out so other cases see an empty board.
    const prep = await signedInClient(SEED_STAFF.prep);
    try {
      await appRpc(prep, 'set_ticket_status', { p_ticket_id: ticketId, p_status: 'ready' });
      await appRpc(prep, 'set_ticket_status', { p_ticket_id: ticketId, p_status: 'completed' });
    } finally {
      await prep.auth.signOut();
    }
    await voidOpenTabsForTable(svc, KDS_TABLE);
  });

  test('(j) courts admin: create a court, see it on the desk, deactivate it', async ({ page }) => {
    const name = `E2E Court ${Date.now() % 100000}`;
    await signIn(page, SEED_STAFF.manager);
    await page.goto(`${OPERATOR_URL}/admin/courts`);
    await page.getByRole('button', { name: 'Add court', exact: true }).click();
    // The editor is a side panel; its own "Add court" submit shares the header
    // button's name, so everything below is scoped to the panel.
    const editor = page.getByTestId('court-editor');
    await editor.getByLabel('Name (English)', { exact: true }).fill(name);
    await editor.getByLabel('Name (Arabic)', { exact: true }).fill(`ملعب ${name}`);
    // Booking-length chips: add 45, drop 120 → 45/60/90.
    await editor.getByRole('button', { name: '45 min', exact: true }).click();
    await editor.getByRole('button', { name: '120 min', exact: true }).click();
    await editor.getByRole('button', { name: 'Add court', exact: true }).click();
    await expect(editor).toHaveCount(0);
    const row = page.locator('tr', { hasText: name });
    await expect(row).toBeVisible();
    await expect(row.getByText('45 min · 60 min · 90 min', { exact: true })).toBeVisible();

    // The desk calendar picks it up without a redeploy (courts broadcast).
    await page.goto(`${OPERATOR_URL}/desk`);
    await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });

    // Deactivate (no bookings yet, so the 0062 guard allows it) and clean up.
    await page.goto(`${OPERATOR_URL}/admin/courts`);
    await row.getByRole('button', { name: 'Edit', exact: true }).click();
    await editor.getByRole('switch', { name: 'Open for booking', exact: true }).click();
    // Save waits for the upcoming-bookings count (none for a new court).
    const save = editor.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeEnabled({ timeout: 15_000 });
    await save.click();
    const confirmOff = page.getByRole('dialog', { name: `Switch off ${name}?` });
    await confirmOff.getByRole('button', { name: 'Switch off', exact: true }).click();
    await expect
      .poll(
        async () => {
          const { data } = await svc.from('courts').select('is_active').eq('name_en', name).single();
          return (data as { is_active: boolean } | null)?.is_active;
        },
        { timeout: 15_000 },
      )
      .toBe(false);
    // Switched-off courts fold away from the list; showing them names the state.
    await expect(row).toHaveCount(0);
    await page.getByRole('button', { name: /^Show switched-off courts/ }).click();
    await expect(row.getByText('Switched off', { exact: true })).toBeVisible();

    const { error } = await svc.from('courts').delete().eq('name_en', name);
    expect(error).toBeNull();
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
    // By role, not label: getByLabel matches substrings, and once a term is set
    // the filter chip's "Remove filter: Search: …" button matches too.
    const search = page.getByRole('searchbox', { name: 'Search' });
    await search.fill('sold_out');
    const firstRow = page.locator('tbody tr').first();
    // The row names the action in words; the stored code stays on the cell
    // as data-audit-action, which is what the log is searched by.
    await expect(firstRow.locator('[data-audit-action]')).toHaveAttribute('data-audit-action', 'menu.item.sold_out');
    await expect(firstRow).toContainText('Item sold out or back on sale');
    await expect(firstRow).toContainText('Dev Owner');

    // Before/after is a field-level diff, not two blobs of jsonb, with the
    // column named as a manager reads it.
    await firstRow.getByRole('button', { name: /Changes/ }).click();
    await expect(page.getByText('Sold out', { exact: true }).first()).toBeVisible();

    // Filtering by area narrows to that family and nothing else.
    await firstRow.getByRole('button', { name: 'Hide' }).click();
    await search.fill('');
    await choose(page.getByLabel('Area'), 'menu');
    // Scoped by attribute: the expanded before/after table repeats the column
    // positions, so an nth-child selector would also match its cells. Read the
    // attribute, not the text — the cell shows the action in words.
    await expect(page.locator('[data-audit-action]').first()).toBeVisible();
    const actions = await page
      .locator('[data-audit-action]')
      .evaluateAll((cells) => cells.map((c) => c.getAttribute('data-audit-action') ?? ''));
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
      await expect(page.getByRole('heading', { level: 1, name: 'Staff', exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await page.getByRole('button', { name: 'Add staff member', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Add staff member' });
      await dialog.getByLabel('Name', { exact: true }).fill(name);
      await dialog.getByLabel('Email', { exact: true }).fill(email);
      await dialog.getByLabel('Password', { exact: true }).fill('a-long-enough-password');
      await dialog.getByRole('button', { name: 'Add staff member', exact: true }).click();

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

      // Promote to manager in the account panel. A role change is confirmed
      // before anything is written: nothing may change on the select alone.
      await row.getByRole('button', { name: 'Manage', exact: true }).click();
      const editor = page.getByTestId('staff-editor');
      await choose(editor.getByLabel('Role', { exact: true }), 'manager');
      await editor.getByRole('button', { name: 'Change role', exact: true }).click();
      const roleDialog = page.getByRole('dialog', { name: `Change ${name}’s role to Manager?` });
      await expect(roleDialog).toBeVisible();
      {
        const { data } = await svc.from('staff').select('role').eq('id', createdId!).single();
        expect((data as { role: string }).role).toBe('cashier');
      }
      await roleDialog.getByRole('button', { name: 'Change to Manager', exact: true }).click();
      await expect(async () => {
        const { data } = await svc.from('staff').select('role').eq('id', createdId!).single();
        expect((data as { role: string }).role).toBe('manager');
      }).toPass({ timeout: 20_000 });

      // A manager can hold an authorisation PIN; a cashier has nothing to
      // authorise, so the control only appears once the role allows it.
      await expect(editor.getByRole('button', { name: 'Set PIN', exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // Remove access. The account is KEPT — past work stays attributable.
      await editor.getByRole('button', { name: 'Remove access', exact: true }).click();
      const confirmDialog = page.getByRole('dialog', { name: `Remove access for ${name}?` });
      await confirmDialog.getByRole('button', { name: 'Remove access', exact: true }).click();
      await expect(async () => {
        const { data } = await svc
          .from('staff')
          .select('is_active, display_name')
          .eq('id', createdId!)
          .single();
        expect((data as { is_active: boolean }).is_active).toBe(false);
        expect((data as { display_name: string }).display_name).toBe(name);
      }).toPass({ timeout: 20_000 });
      // The panel now offers access back rather than removal…
      await expect(editor.getByRole('button', { name: 'Give access back', exact: true })).toBeVisible({ timeout: 15_000 });
      // …and the row is still there, folded with the other people without access.
      await page.getByRole('button', { name: /^Show people without access/ }).click();
      await expect(row.getByText('No access', { exact: true })).toBeVisible();
      await editor.getByRole('button', { name: 'Close', exact: true }).click();

      // The owner cannot re-role or remove their OWN account: with one owner
      // that guard is all that stands between the venue and a lockout.
      const selfRow = page.locator('tr').filter({ has: page.getByText('You', { exact: true }) });
      await selfRow.getByRole('button', { name: 'Manage', exact: true }).click();
      await expect(editor.getByLabel('Role', { exact: true })).toBeDisabled();
      await expect(editor.getByRole('button', { name: 'Remove access', exact: true })).toBeDisabled();
    } finally {
      if (createdId) {
        await svc.from('staff').delete().eq('id', createdId);
        await svc.auth.admin.deleteUser(createdId).catch(() => undefined);
      }
    }
  });
});