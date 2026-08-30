/**
 * Operator SPA journeys against the local stack:
 *  1. court_desk — desk calendar renders fixture courts, walk-in booking
 *     create + cancel (with reason).
 *  2. cashier — till: open a tab on a table, add 2 items (one with modifier),
 *     settle cash with tendered amount, change shown, tab settled.
 *  3. court_desk — week view (SOW L307) and the reason recorded on an override
 *     (SOW L313), which the desk used to leave as the 'staff_op' default.
 *  4. manager — closed days (SOW L319), which nothing could write until now.
 *  5. manager — an overnight close (09:00->02:00) surviving a save, the
 *     regression test for the editor that used to delete the second window.
 *  6. cashier — price override (L450-451), the guest bill (L456) and a refund
 *     that reverses stock (L453): three clauses whose RPCs existed and whose
 *     UI did not, so "every discount, void and refund traceable to a named
 *     actor" (L434-439) had no refund to trace.
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
  signedInClient,
  appRpc,
  voidOpenTabsForTable,
} from './helpers';

const TILL_TABLE = fixtureTableId(8); // T8
const WALKIN_NAME = 'E2E Walk-in';

async function signIn(page: Page, email: string) {
  await page.goto(OPERATOR_URL);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(DEV_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Wait for the shell before any caller navigates: going to a URL while the
  // sign-in request is still in flight reloads the SPA mid-auth and lands back
  // on the form.
  await expect(page.getByRole('heading', { name: 'Staff sign-in' })).toHaveCount(0, {
    timeout: 30_000,
  });
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
  test('court_desk: week view shows the whole week, and an override records a reason', async ({
    page,
  }) => {
    // SOW L307 asks for a day AND week calendar across all courts; the desk was
    // day-only. SOW L313 requires a reason on every override — the RPCs have
    // taken one since 0048 and the desk never passed it, so every move, extend
    // and status change was audited as the generic 'staff_op'.
    const name = `E2E Week ${Date.now()}`;
    let reservationId: string | null = null;

    try {
      await signIn(page, SEED_STAFF.court_desk);
      await expect(page.getByRole('heading', { name: 'Desk calendar' })).toBeVisible({
        timeout: 30_000,
      });

      // Book tomorrow so every slot is in the future.
      await page.getByRole('button', { name: '›' }).click();
      await expect(page.getByTitle('Free').first()).toBeVisible();
      await page.getByTitle('Free').nth(8).click();
      const dialog = page.getByRole('dialog', { name: 'New booking' });
      await dialog.getByLabel('Guest name').fill(name);
      // 90 minutes, so shortening lands on 60 — a duration the fixture rate
      // rules actually price. The venue sells 60/90/120; shortening to 30 has
      // no price and the server rightly refuses it.
      await dialog.getByLabel('Duration').selectOption('90');
      await dialog.getByRole('button', { name: 'Create booking' }).click();
      await expect(dialog).toBeHidden();

      const { data: made } = await svc
        .from('reservations')
        .select('id')
        .eq('guest_name', name)
        .single();
      reservationId = (made as { id: string }).id;

      // The same booking is visible in the week view, which is the point of
      // having one: the day grid answers "what is court 2 doing at 19:00", the
      // week answers "are we free on Saturday".
      // 'Week' also matches the week-view chips' accessible names, so anchor it.
      await page.getByRole('button', { name: 'Week', exact: true }).click();
      await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible({
        timeout: 15_000,
      });

      // Open it from the week grid — the SAME detail modal, so move, shorten,
      // extend and cancel all work here without a second code path.
      await page.getByRole('button', { name: new RegExp(name) }).first().click();
      const actions = page.getByRole('dialog', { name });
      await expect(actions).toBeVisible();

      // Shorten: SOW L310 lists it and there was no UI path at all.
      await actions.getByLabel('Reason for this change').selectOption('customer_request');
      const { data: beforeRow } = await svc
        .from('reservations')
        .select('end_at')
        .eq('id', reservationId)
        .single();
      await actions.getByRole('button', { name: 'Shorten −30 min' }).click();

      await expect(async () => {
        const { data } = await svc
          .from('reservations')
          .select('end_at')
          .eq('id', reservationId!)
          .single();
        expect(new Date((data as { end_at: string }).end_at).getTime()).toBeLessThan(
          new Date((beforeRow as { end_at: string }).end_at).getTime(),
        );
      }).toPass({ timeout: 20_000 });

      // …and the audit row carries the reason the desk chose, not the default.
      const { data: audit } = await svc
        .from('audit_log')
        .select('action, reason_code')
        .eq('entity_id', reservationId)
        .eq('action', 'reservation.extend')
        .order('id', { ascending: false })
        .limit(1)
        .single();
      expect((audit as { reason_code: string }).reason_code).toBe('customer_request');
    } finally {
      if (reservationId) {
        await svc
          .from('reservations')
          .update({ status: 'cancelled', cancelled_reason: 'staff_error' })
          .eq('id', reservationId);
      }
    }
  });

  test('manager: closed days can be set, and the calendar honours them', async ({ page }) => {
    // SOW L319. `venue_settings.closed_dates` has existed since 0006,
    // `assert_bookable` refuses bookings on those days and the desk greys them
    // out — but nothing could WRITE the list, so closing for Eid meant running
    // SQL against the client's production database.
    const { data: before } = await svc
      .from('venue_settings')
      .select('closed_dates')
      .single();
    const original = (before as { closed_dates: string[] | null }).closed_dates ?? [];

    // A date far enough out that no other suite is booking on it.
    const target = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);

    try {
      await signIn(page, SEED_STAFF.manager);
      await page.goto(`${OPERATOR_URL}/admin/hours`);
      await expect(page.getByRole('heading', { name: 'Closed days' })).toBeVisible({
        timeout: 30_000,
      });

      await page.getByLabel('Add closed day').fill(target);
      await page.getByRole('button', { name: 'Add closed day' }).click();
      await page.getByRole('button', { name: /Save/ }).click();

      await expect(async () => {
        const { data } = await svc
          .from('venue_settings')
          .select('closed_dates')
          .single();
        expect((data as { closed_dates: string[] }).closed_dates).toContain(target);
      }).toPass({ timeout: 20_000 });

      // The desk now refuses to draw a grid for that day.
      await page.goto(`${OPERATOR_URL}/desk`);
      await page.locator('input[type="date"]').fill(target);
      await expect(page.getByText('The venue is closed on this date.')).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      // Put the venue back exactly as it was.
      const owner = await signedInClient(SEED_STAFF.manager);
      try {
        await appRpc(owner, 'set_opening_hours', { p_closed_dates: original });
      } finally {
        await owner.auth.signOut();
      }
    }
  });
  test('manager: an overnight close (09:00 to 02:00) survives a save and reload', async ({
    page,
  }) => {
    // The regression test for a real data-loss bug. Touch trades 09:00 -> 02:00,
    // which venue_settings stores as TWO windows on adjacent calendar days:
    // [["00:00","02:00"],["09:00","24:00"]]. This screen used to read windows[0]
    // and write [[open, close]], so simply opening /admin/hours and pressing Save
    // silently DELETED the inherited 00:00-02:00 tail on every day -- and with it
    // the venue's ability to take a booking after midnight.
    const { data: before } = await svc.from('venue_settings').select('opening_hours').single();
    const original = (before as { opening_hours: unknown }).opening_hours;

    try {
      await signIn(page, SEED_STAFF.manager);
      await page.goto(`${OPERATOR_URL}/admin/hours`);
      await expect(page.getByRole('heading', { name: 'Opening hours' })).toBeVisible({
        timeout: 30_000,
      });

      // The seed already ships Touch's real hours, so the round trip is what
      // matters: read 09:00/02:00, save untouched, and still read 09:00/02:00.
      const opens = page.getByLabel('Opens');
      const closes = page.getByLabel('Closes');
      await expect(opens.first()).toHaveValue('09:00');
      await expect(closes.first()).toHaveValue('02:00');
      // The close is on the following day, and the screen has to say so.
      await expect(page.getByText('next day').first()).toBeVisible();

      await page.getByRole('button', { name: /Save/ }).click();

      // Both windows still present in the database, on every day.
      await expect(async () => {
        const { data } = await svc.from('venue_settings').select('opening_hours').single();
        const hours = (data as { opening_hours: Record<string, [string, string][]> })
          .opening_hours;
        for (const day of ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']) {
          expect(hours[day]).toEqual([
            ['00:00', '02:00'],
            ['09:00', '24:00'],
          ]);
        }
      }).toPass({ timeout: 20_000 });

      // And the screen reads them back as one human pair, not as two rows.
      await page.reload();
      await expect(opens.first()).toHaveValue('09:00');
      await expect(closes.first()).toHaveValue('02:00');

      // The desk grid draws one continuous trading night: it must reach past
      // midnight rather than stopping at 24:00 with a dead 02:00-09:00 band.
      await page.goto(`${OPERATOR_URL}/desk`);
      await expect(page.getByText('23:00').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('01:00').first()).toBeVisible();
      await expect(page.getByText('05:00')).toHaveCount(0);
    } finally {
      const manager = await signedInClient(SEED_STAFF.manager);
      try {
        await appRpc(manager, 'set_opening_hours', { p_opening_hours: original });
      } finally {
        await manager.auth.signOut();
      }
    }
  });

  test('cashier: override a price, show the bill, refund with items', async ({ page }) => {
    // The RPCs behind all three have been granted and tested since the first
    // drops. Nothing called them.
    const TABLE = fixtureTableId(7); // T7 — away from the T8 journey above
    await voidOpenTabsForTable(svc, TABLE);

    await signIn(page, SEED_STAFF.manager);
    // A manager lands on the desk (homeRoute), not the till.
    await page.goto(`${OPERATOR_URL}/till`);
    await expect(page.getByRole('heading', { name: 'Open tabs' })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole('button', { name: '+', exact: true }).click();
    const newTab = page.getByRole('dialog', { name: 'New tab' });
    await newTab.getByLabel('Table').selectOption({ label: 'T7' });
    await newTab.getByRole('button', { name: 'Open tab' }).click();
    await expect(newTab).toBeHidden();

    await page.getByRole('button', { name: /Hot Drinks/ }).click();
    await page.getByRole('button', { name: /^Turkish Coffee/ }).click();
    const turk = page.getByRole('dialog', { name: 'Turkish Coffee' });
    await turk.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Send to kitchen' }).click();
    await expect(page.getByText('IQD 3,000').first()).toBeVisible();

    // ---- price override (L450-451): PIN + reason, same as a discount -----
    await page.getByRole('button', { name: 'Change price' }).first().click();
    const override = page.getByRole('dialog', { name: 'Change price' });
    await override.getByLabel('New price each').fill('2500');
    await override.getByRole('button', { name: 'Change price' }).click();
    const pin = page.getByRole('dialog', { name: 'Change price' }).last();
    await pin.getByLabel('Reason').selectOption('staff_error');
    await pin.getByLabel('Manager PIN').fill('222222');
    await pin.getByRole('button', { name: /Confirm|Apply|Change price/ }).last().click();

    await expect(async () => {
      const { data } = await svc
        .from('tabs')
        .select('id, orders(order_items(unit_price_iqd))')
        .eq('table_id', TABLE)
        .in('status', ['open', 'awaiting_payment'])
        .single();
      const prices = (data as { orders: { order_items: { unit_price_iqd: number }[] }[] }).orders
        .flatMap((o) => o.order_items)
        .map((i) => i.unit_price_iqd);
      expect(prices).toContain(2500);
    }).toPass({ timeout: 20_000 });

    // ---- the guest bill (L456) -------------------------------------------
    await page.getByRole('button', { name: 'Bill', exact: true }).click();
    const bill = page.getByRole('dialog', { name: 'Bill' });
    await expect(bill).toContainText('Turkish Coffee');
    await expect(bill).toContainText('IQD 2,500');
    await bill.getByRole('button', { name: 'Close' }).click();

    // ---- settle, then refund with the item going back to stock (L453) ----
    await page.getByRole('button', { name: 'Cash', exact: true }).click();
    const cash = page.getByRole('dialog', { name: 'Cash' });
    await cash.getByLabel('Tendered').fill('2500');
    await cash.getByRole('button', { name: 'Record payment' }).click();
    await expect(cash).toBeHidden();
    await expect(page.getByText('Tab settled.')).toBeVisible();

    await page.getByRole('button', { name: 'Refund', exact: true }).click();
    const refund = page.getByRole('dialog', { name: 'Refund' });
    await refund.getByLabel('Amount to refund').fill('2500');
    await refund.getByLabel('Turkish Coffee').fill('1');
    await refund.getByRole('button', { name: 'Refund', exact: true }).click();
    const refundPin = page.getByRole('dialog', { name: 'Refund' }).last();
    await refundPin.getByLabel('Reason').selectOption('quality');
    await refundPin.getByLabel('Manager PIN').fill('222222');
    await refundPin.getByRole('button', { name: /Confirm|Apply|Refund/ }).last().click();

    // The audit row is the acceptance test: a refund traceable to a named
    // actor, with a reason.
    await expect(async () => {
      const { data } = await svc
        .from('audit_log')
        .select('action, reason_code, authorizer_id')
        .eq('action', 'payment.refund')
        .order('id', { ascending: false })
        .limit(1)
        .single();
      expect((data as { reason_code: string }).reason_code).toBe('quality');
      expect((data as { authorizer_id: string | null }).authorizer_id).not.toBeNull();
    }).toPass({ timeout: 20_000 });
  });
});