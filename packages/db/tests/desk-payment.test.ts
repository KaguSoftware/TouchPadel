/**
 * 0106 — the court desk takes court payment.
 *
 * Every case here is a way a real night goes: the guest pays at the desk, a
 * second clerk opens the same bill, drinks follow a paid court, a booking is
 * extended or shortened after it was paid, a no-show leaves an empty bill, a
 * part-paid booking is cancelled. Each one used to end in a double charge, a
 * lost difference, or a tab that could never close — and a tab that can never
 * close is a day that can never close.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  testIdemKey,
  SEED_STAFF,
  DEV_PINS,
  createTestMenuItem,
  createTestCourt,
  createTestCafeTable,
  ensureOpenDay,
  ensureTillFresh,
} from './helpers';

const up = await stackAvailable();

type Bill = {
  live: boolean;
  day_open: boolean;
  live_tab: null | {
    id: string;
    status: string;
    court_iqd: number;
    total_iqd: number;
    paid_iqd: number;
    due_iqd: number;
    over_paid_iqd: number;
    has_orders: boolean;
  };
  court_paid_iqd: number;
  court_remaining_iqd: number;
  court_refund_due_iqd: number;
  settled_tabs: { tab_id: string; court_iqd: number; payments: { method: string; amount_iqd: number; recorded_by_name: string | null }[] }[];
};
type BillState = { reservation_id: string; state: string; due_iqd: number; court_refund_due_iqd: number; live_tab_id: string | null };

function errCode(e: { message: string } | null): string | null {
  return e ? e.message : null;
}

describe.skipIf(!up)('0106 desk payment', () => {
  let svc: SupabaseClient;
  let desk: SupabaseClient;
  let cashier: SupabaseClient;
  let manager: SupabaseClient;
  let courtId: string;
  let dayId: string;
  let drink: Awaited<ReturnType<typeof createTestMenuItem>>;

  let slot = 0;
  /** A booking on the test court, its own day each time (exclusion constraint). */
  async function makeBooking(priceIqd: number, status = 'confirmed', at?: Date): Promise<string> {
    const start = at ?? new Date(Date.now() + (40 + slot++) * 86_400_000);
    if (!at) start.setUTCHours(12, 0, 0, 0);
    const { data, error } = await svc
      .from('reservations')
      .insert({
        court_id: courtId,
        kind: 'booking',
        status,
        source: 'desk',
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + 60 * 60_000).toISOString(),
        guest_name: 'Desk Pay Test',
        price_iqd: priceIqd,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  async function openBookingTab(client: SupabaseClient, reservationId: string): Promise<string> {
    const res = await appRpc(client, 'open_tab', {
      p_reservation_id: reservationId,
      p_idempotency_key: testIdemKey('tab.open'),
    });
    if (res.error) throw new Error(`open_tab: ${res.error.message}`);
    return (res.data as { tab_id: string }).tab_id;
  }

  async function addDrink(tabId: string, qty = 1) {
    const res = await appRpc(cashier, 'till_add_items', {
      p_tab_id: tabId,
      p_items: [{ variant_id: drink.variantId, qty }],
      p_idempotency_key: testIdemKey('order.add_items'),
    });
    if (res.error) throw new Error(`till_add_items: ${res.error.message}`);
  }

  async function bill(client: SupabaseClient, reservationId: string): Promise<Bill> {
    const res = await appRpc(client, 'booking_bill', { p_reservation_id: reservationId });
    if (res.error) throw new Error(`booking_bill: ${res.error.message}`);
    return res.data as Bill;
  }

  async function stateOf(reservationId: string): Promise<BillState> {
    const res = await appRpc(desk, 'booking_bill_states', { p_reservation_ids: [reservationId] });
    if (res.error) throw new Error(`booking_bill_states: ${res.error.message}`);
    return (res.data as BillState[])[0]!;
  }

  async function payCash(client: SupabaseClient, tabId: string, tendered: number, extra: Record<string, unknown> = {}) {
    return appRpc(client, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'cash',
      p_tendered_iqd: tendered,
      p_idempotency_key: testIdemKey('tab.settle'),
      ...extra,
    });
  }

  beforeAll(async () => {
    svc = serviceClient();
    desk = await signedInClient(SEED_STAFF.court_desk);
    cashier = await signedInClient(SEED_STAFF.cashier);
    manager = await signedInClient(SEED_STAFF.manager);
    await ensureTillFresh(svc);
    dayId = await ensureOpenDay(manager, svc);
    courtId = await createTestCourt(svc, `Desk Pay ${Date.now()}`);
    drink = await createTestMenuItem(svc, 'desk-pay-drink', 5000);
  });

  afterAll(async () => {
    await desk.auth.signOut();
    await cashier.auth.signOut();
    await manager.auth.signOut();
  });

  it('the desk takes the court fee in cash, and the day close sees it as desk cash', async () => {
    const r = await makeBooking(30_000);
    const before = await bill(desk, r);
    expect(before.day_open).toBe(true);
    expect(before.live_tab).toBeNull();
    expect(before.court_remaining_iqd).toBe(30_000);
    expect((await stateOf(r)).state).toBe('none');

    const { data: dayBefore } = await manager.from('v_day_close_summary').select('desk_cash_iqd').eq('day_session_id', dayId).single();
    const deskCashBefore = Number((dayBefore as { desk_cash_iqd: number }).desk_cash_iqd);

    const tabId = await openBookingTab(desk, r);
    const open = await bill(desk, r);
    expect(open.live_tab?.court_iqd).toBe(30_000);
    expect(open.live_tab?.due_iqd).toBe(30_000);
    expect((await stateOf(r)).state).toBe('open');

    const paid = await payCash(desk, tabId, 50_000, { p_expected_total_iqd: 30_000 });
    expect(paid.error).toBeNull();
    expect(paid.data).toMatchObject({ status: 'settled', change_iqd: 20_000, court_iqd: 30_000 });

    const after = await bill(desk, r);
    expect(after.live_tab).toBeNull();
    expect(after.court_paid_iqd).toBe(30_000);
    expect(after.court_remaining_iqd).toBe(0);
    expect(after.settled_tabs[0]?.payments[0]).toMatchObject({ method: 'cash', amount_iqd: 30_000 });
    expect((await stateOf(r)).state).toBe('paid');

    const { data: dayAfter } = await manager.from('v_day_close_summary').select('desk_cash_iqd').eq('day_session_id', dayId).single();
    expect(Number((dayAfter as { desk_cash_iqd: number }).desk_cash_iqd)).toBe(deskCashBefore + 30_000);
  });

  it('refuses a second live bill on one booking and names the first', async () => {
    const r = await makeBooking(30_000);
    const first = await openBookingTab(desk, r);
    const second = await appRpc(cashier, 'open_tab', { p_reservation_id: r, p_idempotency_key: testIdemKey('tab.open') });
    expect(errCode(second.error)).toBe('BOOKING_TAB_OPEN');
    expect((second.error as { details?: string }).details).toBe(first);
  });

  it('two clerks opening the same booking at once get exactly one bill', async () => {
    const r = await makeBooking(30_000);
    const results = await Promise.all([
      appRpc(desk, 'open_tab', { p_reservation_id: r, p_idempotency_key: testIdemKey('tab.open') }),
      appRpc(cashier, 'open_tab', { p_reservation_id: r, p_idempotency_key: testIdemKey('tab.open') }),
    ]);
    const ok = results.filter((x) => !x.error);
    const refused = results.filter((x) => x.error);
    expect(ok).toHaveLength(1);
    expect(refused.map((x) => errCode(x.error))).toEqual(['BOOKING_TAB_OPEN']);
    const { count } = await svc.from('tabs').select('id', { count: 'exact', head: true }).eq('reservation_id', r);
    expect(count).toBe(1);
  });

  it('drinks after a paid court do not charge the court again', async () => {
    const r = await makeBooking(30_000);
    const courtTab = await openBookingTab(desk, r);
    expect((await payCash(desk, courtTab, 30_000)).error).toBeNull();

    const drinksTab = await openBookingTab(cashier, r);
    await addDrink(drinksTab, 2);
    const b = await bill(desk, r);
    expect(b.live_tab?.court_iqd).toBe(0);
    expect(b.live_tab?.total_iqd).toBe(10_000);
    expect(b.court_paid_iqd).toBe(30_000);
  });

  it('a booking that got dearer after payment owes only the difference', async () => {
    const r = await makeBooking(30_000);
    const tab = await openBookingTab(desk, r);
    expect((await payCash(desk, tab, 30_000)).error).toBeNull();

    await svc.from('reservations').update({ price_iqd: 45_000 }).eq('id', r);
    const s = await stateOf(r);
    expect(s.state).toBe('owed');
    expect(s.due_iqd).toBe(15_000);

    const delta = await openBookingTab(desk, r);
    const b = await bill(desk, r);
    expect(b.live_tab?.court_iqd).toBe(15_000);
    expect((await payCash(desk, delta, 15_000)).error).toBeNull();
    expect((await stateOf(r)).state).toBe('paid');
    expect((await bill(desk, r)).court_paid_iqd).toBe(45_000);
  });

  it('a booking that got cheaper after payment shows what may be owed back', async () => {
    const r = await makeBooking(30_000);
    const tab = await openBookingTab(desk, r);
    expect((await payCash(desk, tab, 30_000)).error).toBeNull();

    await svc.from('reservations').update({ price_iqd: 20_000 }).eq('id', r);
    const s = await stateOf(r);
    expect(s.state).toBe('refund_due');
    expect(s.court_refund_due_iqd).toBe(10_000);
    expect((await bill(desk, r)).court_remaining_iqd).toBe(0);
  });

  it('an empty bill on a no-show can be removed; on a live unpaid booking it cannot', async () => {
    const r = await makeBooking(30_000);
    const tab = await openBookingTab(desk, r);

    const refused = await appRpc(desk, 'cancel_tab', { p_tab_id: tab, p_reason_code: 'staff_error' });
    expect(errCode(refused.error)).toBe('TAB_NOT_EMPTY');

    await svc.from('reservations').update({ status: 'no_show' }).eq('id', r);
    expect((await stateOf(r)).state).toBe('dead_open');
    const removed = await appRpc(desk, 'cancel_tab', { p_tab_id: tab, p_reason_code: 'no_show' });
    expect(removed.error).toBeNull();
    const { data } = await svc.from('tabs').select('status').eq('id', tab).single();
    expect((data as { status: string }).status).toBe('void');
  });

  it('a bill whose only lines were voided closes at zero instead of blocking the day', async () => {
    const r = await makeBooking(30_000);
    const tab = await openBookingTab(desk, r);
    await addDrink(tab);
    await svc.from('reservations').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', r);

    const { data: lines } = await svc.from('orders').select('order_items(id)').eq('tab_id', tab);
    const lineId = (lines as { order_items: { id: string }[] }[])[0]!.order_items[0]!.id;
    const voided = await appRpc(manager, 'void_after_send', { p_order_item_id: lineId, p_pin: DEV_PINS.manager, p_reason_code: 'guest_left' });
    expect(voided.error).toBeNull();

    expect(errCode((await payCash(desk, tab, 1)).error)).toBe('ALREADY_PAID');
    expect(errCode((await appRpc(desk, 'settle_zero_tab', { p_tab_id: tab, p_reason_code: '' })).error)).toBe('REASON_REQUIRED');
    const closed = await appRpc(desk, 'settle_zero_tab', { p_tab_id: tab, p_reason_code: 'booking_cancelled' });
    expect(closed.error).toBeNull();
    expect(closed.data).toMatchObject({ status: 'settled', total_iqd: 0 });

    const { data: audit } = await svc
      .from('audit_log')
      .select('action, reason_code')
      .eq('entity_id', tab)
      .eq('action', 'tab.settle');
    expect(audit).toEqual([{ action: 'tab.settle', reason_code: 'booking_cancelled' }]);
  });

  it('a part-paid booking that is cancelled names the refund, then closes', async () => {
    const r = await makeBooking(30_000);
    const tab = await openBookingTab(desk, r);
    const part = await appRpc(desk, 'settle_tab', {
      p_tab_id: tab, p_method: 'card', p_amount_iqd: 10_000, p_idempotency_key: testIdemKey('tab.settle'),
    });
    expect(part.error).toBeNull();
    expect((await stateOf(r)).state).toBe('partly_paid');

    await svc.from('reservations').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', r);
    const s = await stateOf(r);
    expect(s.state).toBe('refund_due');
    expect(s.court_refund_due_iqd).toBe(10_000);

    const blocked = await appRpc(desk, 'settle_zero_tab', { p_tab_id: tab, p_reason_code: 'booking_cancelled' });
    expect(errCode(blocked.error)).toBe('REFUND_DUE');
    expect((blocked.error as { details?: string }).details).toBe('10000');

    const paymentId = (part.data as { payment_id: string }).payment_id;
    const refund = await appRpc(manager, 'refund', {
      p_payment_id: paymentId, p_amount_iqd: 10_000, p_pin: DEV_PINS.manager, p_reason_code: 'booking_cancelled',
    });
    expect(refund.error).toBeNull();

    const closed = await appRpc(desk, 'settle_zero_tab', { p_tab_id: tab, p_reason_code: 'booking_cancelled' });
    expect(closed.error).toBeNull();
    expect((await stateOf(r)).state).toBe('none');
  });

  it('settle_zero_tab will not close a bill that owes money or never had anything', async () => {
    const owing = await makeBooking(30_000);
    const owingTab = await openBookingTab(desk, owing);
    const notZero = await appRpc(desk, 'settle_zero_tab', { p_tab_id: owingTab, p_reason_code: 'x_test' });
    expect(errCode(notZero.error)).toBe('NOT_ZERO');

    const dead = await makeBooking(30_000);
    const deadTab = await openBookingTab(desk, dead);
    await svc.from('reservations').update({ status: 'no_show' }).eq('id', dead);
    const empty = await appRpc(desk, 'settle_zero_tab', { p_tab_id: deadTab, p_reason_code: 'x_test' });
    expect(errCode(empty.error)).toBe('TAB_EMPTY');
  });

  it('refuses the payment when the bill changed since the clerk read it, and writes nothing', async () => {
    const r = await makeBooking(30_000);
    const tab = await openBookingTab(desk, r);
    const seen = (await bill(desk, r)).live_tab!.total_iqd;
    await addDrink(tab);

    const stale = await payCash(desk, tab, 50_000, { p_expected_total_iqd: seen });
    expect(errCode(stale.error)).toBe('TOTAL_CHANGED');
    const { count } = await svc.from('payments').select('id', { count: 'exact', head: true }).eq('tab_id', tab);
    expect(count).toBe(0);
    const { data } = await svc.from('tabs').select('status, total_iqd').eq('id', tab).single();
    expect(data).toMatchObject({ status: 'open', total_iqd: null });

    const fresh = await payCash(desk, tab, 50_000, { p_expected_total_iqd: 35_000 });
    expect(fresh.error).toBeNull();
    expect(fresh.data).toMatchObject({ status: 'settled', change_iqd: 15_000 });
  });

  it('the desk pulls a table bill onto the booking, never the other way', async () => {
    const r = await makeBooking(30_000);
    const bookingTab = await openBookingTab(desk, r);
    const tableRes = await appRpc(cashier, 'open_tab', {
      p_table_id: await createTestCafeTable(svc, 'desk-pay'),
      p_idempotency_key: testIdemKey('tab.open'),
    });
    const tableTab = (tableRes.data as { tab_id: string }).tab_id;
    await addDrink(tableTab, 3);

    const wrongWay = await appRpc(desk, 'merge_tabs', { p_donor_tab_id: bookingTab, p_survivor_tab_id: tableTab });
    expect(errCode(wrongWay.error)).toBe('BOOKING_TAB_DONOR');

    const merged = await appRpc(desk, 'merge_tabs', { p_donor_tab_id: tableTab, p_survivor_tab_id: bookingTab });
    expect(merged.error).toBeNull();
    const b = await bill(desk, r);
    expect(b.live_tab?.court_iqd).toBe(30_000);
    expect(b.live_tab?.total_iqd).toBe(45_000);
  });

  it('refuses a bill on a booking that has already ended unplayed', async () => {
    const r = await makeBooking(30_000, 'cancelled');
    const res = await appRpc(desk, 'open_tab', { p_reservation_id: r, p_idempotency_key: testIdemKey('tab.open') });
    expect(errCode(res.error)).toBe('RESERVATION_NOT_LIVE');
  });

  it('day close lists bookings played but not paid, for the manager only', async () => {
    const { data: day } = await svc.from('day_sessions').select('business_date').eq('id', dayId).single();
    const businessDate = (day as { business_date: string }).business_date;
    const r = await makeBooking(25_000, 'arrived', new Date(`${businessDate}T15:00:00Z`));

    const listed = await appRpc(manager, 'unpaid_played_bookings', { p_day_session_id: dayId });
    expect(listed.error).toBeNull();
    const row = (listed.data as { reservation_id: string; remaining_iqd: number }[]).find((x) => x.reservation_id === r);
    expect(row?.remaining_iqd).toBe(25_000);

    const forbidden = await appRpc(desk, 'unpaid_played_bookings', { p_day_session_id: dayId });
    expect(errCode(forbidden.error)).toBe('FORBIDDEN');

    const tab = await openBookingTab(desk, r);
    expect((await payCash(desk, tab, 25_000)).error).toBeNull();
    const after = await appRpc(manager, 'unpaid_played_bookings', { p_day_session_id: dayId });
    expect((after.data as { reservation_id: string }[]).some((x) => x.reservation_id === r)).toBe(false);
  });

  it('the desk reads the day row but still not the payments ledger', async () => {
    const day = await desk.from('day_sessions').select('id').eq('id', dayId);
    expect(day.data ?? []).toHaveLength(1);
    const ledger = await desk.from('payments').select('id').limit(1);
    expect(ledger.data ?? []).toHaveLength(0);
  });
});
