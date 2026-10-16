/**
 * 0342 — standing customer discounts.
 *
 * The people the club looks after (sponsored players, relatives, coaches)
 * carry their own price: a café discount and a court discount, each a
 * percent or an amount, set by any till or desk staff with no manager PIN.
 * Each case is a night at the desk: the cashier sets it on the record, a
 * percent follows the bill as drinks are added, a one-off at the bill stays
 * one-off, the court fee drops on the booking and day close sees it paid, a
 * closed bill's discount cannot move, and nobody gives themselves one.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  guestClient,
  appRpc,
  testIdemKey,
  SEED_STAFF,
  SEED_STAFF_IDS,
  createTestMenuItem,
  createTestCourt,
  createTestCafeTable,
  ensureOpenDay,
  ensureTillFresh,
} from './helpers';

const up = await stackAvailable();

type Part = { kind: 'percent' | 'amount'; value: number } | null;
type Standing = {
  cafe: Part;
  court: Part;
  reason: string;
  note: string | null;
  set_by: { id: string; name: string };
  set_at: string;
};
type BillState = {
  customer: { id: string; name: string } | null;
  standing: Standing | null;
  cafe: { kind: string; value: number; amount_iqd: number; standing: boolean } | null;
  court: { kind: string; value: number; amount_iqd: number; standing: boolean; reason: string; closed: boolean } | null;
  cafe_needs_refresh: boolean;
  court_needs_refresh: boolean;
  cafe_waived: boolean;
  court_waived: boolean;
  court_allowed: boolean;
};

function errCode(e: { message: string } | null): string | null {
  return e ? e.message : null;
}

describe.skipIf(!up)('0342 customer discounts', () => {
  let svc: SupabaseClient;
  let desk: SupabaseClient;
  let cashier: SupabaseClient;
  let manager: SupabaseClient;
  let customerId: string;
  let plainId: string;
  let courtId: string;
  let drink: Awaited<ReturnType<typeof createTestMenuItem>>;

  let slot = 0;
  async function makeBooking(priceIqd: number, guestId: string | null): Promise<string> {
    const start = new Date(Date.now() + (70 + slot++) * 86_400_000);
    start.setUTCHours(12, 0, 0, 0);
    const { data, error } = await svc
      .from('reservations')
      .insert({
        court_id: courtId,
        kind: 'booking',
        status: 'confirmed',
        source: 'desk',
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + 60 * 60_000).toISOString(),
        guest_id: guestId,
        guest_name: guestId ? null : 'Discount Walk-in',
        price_iqd: priceIqd,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string }).id;
  }

  async function openTab(client: SupabaseClient, args: Record<string, unknown>): Promise<string> {
    const res = await appRpc(client, 'open_tab', { ...args, p_idempotency_key: testIdemKey('tab.open') });
    if (res.error) throw new Error(`open_tab: ${res.error.message}`);
    return (res.data as { tab_id: string }).tab_id;
  }

  /** A café tab with the customer on it (the till's member attach, done here as the service role). */
  async function cafeTabFor(customer: string | null): Promise<string> {
    const tabId = await openTab(cashier, { p_table_id: await createTestCafeTable(svc, 'disc') });
    if (customer) {
      const { error } = await svc.from('tabs').update({ customer_id: customer, customer_method: 'desk' }).eq('id', tabId);
      if (error) throw new Error(error.message);
    }
    return tabId;
  }

  async function addDrinks(tabId: string, qty: number) {
    const res = await appRpc(cashier, 'till_add_items', {
      p_tab_id: tabId,
      p_items: [{ variant_id: drink.variantId, qty }],
      p_idempotency_key: testIdemKey('order.add_items'),
    });
    if (res.error) throw new Error(`till_add_items: ${res.error.message}`);
  }

  async function totals(tabId: string) {
    const res = await appRpc(svc, 'compute_tab_totals', { p_tab_id: tabId });
    if (res.error) throw new Error(res.error.message);
    const row = (res.data as { subtotal_iqd: number; discount_iqd: number; court_iqd: number; total_iqd: number }[])[0]!;
    return row;
  }

  async function state(client: SupabaseClient, args: Record<string, unknown>): Promise<BillState> {
    const res = await appRpc(client, 'bill_customer_discount', args);
    if (res.error) throw new Error(`bill_customer_discount: ${res.error.message}`);
    return res.data as BillState;
  }

  async function setDiscount(client: SupabaseClient, customer: string, args: Record<string, unknown>) {
    return appRpc(client, 'set_customer_discount', { p_customer_id: customer, ...args });
  }

  async function courtRemaining(reservationId: string): Promise<number> {
    const res = await appRpc(desk, 'booking_bill', { p_reservation_id: reservationId });
    if (res.error) throw new Error(res.error.message);
    return (res.data as { court_remaining_iqd: number }).court_remaining_iqd;
  }

  beforeAll(async () => {
    svc = serviceClient();
    desk = await signedInClient(SEED_STAFF.court_desk);
    cashier = await signedInClient(SEED_STAFF.cashier);
    manager = await signedInClient(SEED_STAFF.manager);
    await ensureTillFresh(svc);
    await ensureOpenDay(manager, svc);
    courtId = await createTestCourt(svc, `Discounts ${Date.now()}`);
    drink = await createTestMenuItem(svc, 'discount-drink', 5000);
    const c = await guestClient(svc, 'discount-coach');
    customerId = (await c.auth.getUser()).data.user!.id;
    await c.auth.signOut();
    const p = await guestClient(svc, 'discount-plain');
    plainId = (await p.auth.getUser()).data.user!.id;
    await p.auth.signOut();
  });

  afterAll(async () => {
    await svc.from('customer_discounts').delete().in('customer_id', [customerId, plainId]);
    await desk.auth.signOut();
    await cashier.auth.signOut();
    await manager.auth.signOut();
  });

  // ── the customer's standing discount ──────────────────────────────────────

  it('a cashier sets, reads and clears a standing discount with no PIN, and it is audited', async () => {
    const set = await setDiscount(cashier, plainId, {
      p_cafe_kind: 'percent', p_cafe_value: 1500, p_court_kind: 'amount', p_court_value: 10_000,
      p_reason: 'family', p_note: '  brother of the coach  ',
    });
    expect(set.error).toBeNull();
    expect(set.data).toMatchObject({
      cafe: { kind: 'percent', value: 1500 },
      court: { kind: 'amount', value: 10_000 },
      reason: 'family',
      note: 'brother of the coach',
      set_by: { id: SEED_STAFF_IDS.cashier },
    });

    const read = await appRpc(desk, 'customer_discount', { p_customer_id: plainId });
    expect(read.error).toBeNull();
    expect((read.data as { discount: Standing }).discount.cafe).toEqual({ kind: 'percent', value: 1500 });

    const { data: audit } = await svc
      .from('audit_log')
      .select('action, actor_id, reason_code')
      .eq('entity', 'customer_discounts')
      .eq('entity_id', plainId)
      .order('at', { ascending: false })
      .limit(1);
    expect(audit?.[0]).toMatchObject({ action: 'customer.discount_set', actor_id: SEED_STAFF_IDS.cashier, reason_code: 'family' });

    const cleared = await setDiscount(desk, plainId, {});
    expect(cleared.error).toBeNull();
    expect(cleared.data).toBeNull();
    const again = await appRpc(desk, 'customer_discount', { p_customer_id: plainId });
    expect((again.data as { discount: Standing | null }).discount).toBeNull();
  });

  it('refuses a discount on yourself, a missing reason and a value out of range', async () => {
    expect(errCode((await setDiscount(cashier, SEED_STAFF_IDS.cashier, { p_cafe_kind: 'percent', p_cafe_value: 10000, p_reason: 'staff' })).error))
      .toBe('SELF_DISCOUNT');
    expect(errCode((await setDiscount(cashier, plainId, { p_cafe_kind: 'percent', p_cafe_value: 1000 })).error))
      .toBe('REASON_REQUIRED');
    expect(errCode((await setDiscount(cashier, plainId, { p_cafe_kind: 'percent', p_cafe_value: 10001, p_reason: 'other' })).error))
      .toBe('INVALID_VALUE');
    expect(errCode((await setDiscount(cashier, plainId, { p_court_kind: 'free', p_court_value: 1, p_reason: 'other' })).error))
      .toBe('INVALID_KIND');
  });

  // ── café goods ────────────────────────────────────────────────────────────

  it('a percent follows the bill as drinks are added, authorised by whoever set it', async () => {
    expect((await setDiscount(desk, customerId, {
      p_cafe_kind: 'percent', p_cafe_value: 2000, p_court_kind: 'percent', p_court_value: 5000, p_reason: 'coach',
    })).error).toBeNull();

    const tabId = await cafeTabFor(customerId);
    await addDrinks(tabId, 2);   // 10,000
    expect((await state(cashier, { p_tab_id: tabId })).cafe_needs_refresh).toBe(true);

    const first = await appRpc(cashier, 'apply_customer_discount', { p_tab_id: tabId });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ applied: true, unchanged: false, kind: 'percent', amount_iqd: 2000, standing: true });
    const { data: adj } = await svc.from('tab_adjustments').select('reason_code, applied_by, authorized_by').eq('tab_id', tabId);
    expect(adj).toEqual([{ reason_code: 'customer_discount', applied_by: SEED_STAFF_IDS.cashier, authorized_by: SEED_STAFF_IDS.court_desk }]);

    await addDrinks(tabId, 1);   // 15,000
    const s = await state(cashier, { p_tab_id: tabId });
    expect(s.customer?.id).toBe(customerId);
    expect(s.cafe).toMatchObject({ amount_iqd: 2000, standing: true });
    expect(s.cafe_needs_refresh).toBe(true);

    expect((await appRpc(cashier, 'apply_customer_discount', { p_tab_id: tabId })).data).toMatchObject({ amount_iqd: 3000 });
    expect((await appRpc(cashier, 'apply_customer_discount', { p_tab_id: tabId })).data).toMatchObject({ unchanged: true });
    expect((await state(cashier, { p_tab_id: tabId })).cafe_needs_refresh).toBe(false);
    const t = await totals(tabId);
    expect(t.discount_iqd).toBe(3000);
  });

  it('stacks after a manager discount and never takes the goods below nothing', async () => {
    const tabId = await cafeTabFor(customerId);
    await addDrinks(tabId, 2);   // 10,000
    // A manager's 5,000 off, written as apply_discount writes it (its PIN
    // path is covered by its own suites).
    const { error } = await svc.from('tab_adjustments').insert({
      tab_id: tabId, kind: 'discount_amount', value: 5000, amount_iqd: 5000,
      applied_by: SEED_STAFF_IDS.cashier, authorized_by: SEED_STAFF_IDS.manager, reason_code: 'comp',
    });
    expect(error).toBeNull();
    // 20% of what is left (5,000), not of 10,000.
    expect((await appRpc(cashier, 'apply_customer_discount', { p_tab_id: tabId })).data).toMatchObject({ amount_iqd: 1000 });
    expect((await totals(tabId)).discount_iqd).toBe(6000);
  });

  it('a one-off at the bill stays on this bill only, and can be taken off', async () => {
    const tabId = await cafeTabFor(plainId);
    await addDrinks(tabId, 2);
    const once = await appRpc(cashier, 'apply_customer_discount', {
      p_tab_id: tabId, p_kind: 'amount', p_value: 1500, p_reason: 'family',
    });
    expect(once.error).toBeNull();
    expect(once.data).toMatchObject({ applied: true, amount_iqd: 1500, standing: false });
    // A refresh keeps the one-off (plain has no standing discount to replace it).
    expect((await appRpc(cashier, 'apply_customer_discount', { p_tab_id: tabId })).data).toMatchObject({ unchanged: true, amount_iqd: 1500 });
    const { data: standing } = await svc.from('customer_discounts').select('customer_id').eq('customer_id', plainId);
    expect(standing).toEqual([]);

    const off = await appRpc(cashier, 'apply_customer_discount', { p_tab_id: tabId, p_kind: 'none' });
    expect(off.data).toMatchObject({ applied: false });
    expect((await totals(tabId)).discount_iqd).toBe(0);
  });

  it('needs a customer on the bill, and not the cashier themself', async () => {
    const tabId = await cafeTabFor(null);
    await addDrinks(tabId, 1);
    expect((await appRpc(cashier, 'apply_customer_discount', { p_tab_id: tabId })).data).toMatchObject({ applied: false });
    expect(errCode((await appRpc(cashier, 'apply_customer_discount', {
      p_tab_id: tabId, p_kind: 'percent', p_value: 10000, p_reason: 'other',
    })).error)).toBe('NO_CUSTOMER');

    await svc.from('tabs').update({ customer_id: SEED_STAFF_IDS.cashier, customer_method: 'desk' }).eq('id', tabId);
    expect(errCode((await appRpc(cashier, 'apply_customer_discount', {
      p_tab_id: tabId, p_kind: 'percent', p_value: 10000, p_reason: 'staff',
    })).error)).toBe('SELF_DISCOUNT');
  });

  it('a refresh after part payment answers the refusal as data and changes nothing', async () => {
    const tab2 = await cafeTabFor(plainId);
    await addDrinks(tab2, 2);   // 10,000
    const p2 = await appRpc(cashier, 'settle_tab', {
      p_tab_id: tab2, p_method: 'card', p_amount_iqd: 9_000, p_idempotency_key: testIdemKey('payment.record'),
    });
    expect(p2.error).toBeNull();
    expect((await setDiscount(desk, plainId, { p_cafe_kind: 'percent', p_cafe_value: 5000, p_reason: 'family' })).error).toBeNull();
    const r = await appRpc(cashier, 'apply_customer_discount', { p_tab_id: tab2 });
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ unchanged: true, refused: 'DISCOUNT_REQUIRES_REFUND' });
    expect((await totals(tab2)).discount_iqd).toBe(0);
    expect(errCode((await appRpc(cashier, 'apply_customer_discount', {
      p_tab_id: tab2, p_kind: 'percent', p_value: 5000, p_reason: 'family',
    })).error)).toBe('DISCOUNT_REQUIRES_REFUND');
    await setDiscount(desk, plainId, {});
  });

  it('"remove from this bill" keeps that bill at full price on every refresh, and standing puts it back', async () => {
    const tabId = await cafeTabFor(customerId);   // coach: 20% café
    await addDrinks(tabId, 2);
    expect((await appRpc(cashier, 'apply_customer_discount', { p_tab_id: tabId })).data).toMatchObject({ amount_iqd: 2000 });

    expect((await appRpc(cashier, 'apply_customer_discount', { p_tab_id: tabId, p_kind: 'none' })).data).toMatchObject({ applied: false });
    const waived = await state(cashier, { p_tab_id: tabId });
    expect(waived).toMatchObject({ cafe: null, cafe_waived: true, cafe_needs_refresh: false });
    await addDrinks(tabId, 1);
    expect((await appRpc(cashier, 'apply_customer_discount', { p_tab_id: tabId })).data).toMatchObject({ applied: false });
    expect((await totals(tabId)).discount_iqd).toBe(0);

    // A one-off on the bill, then back to the standing one in place of it.
    expect((await appRpc(cashier, 'apply_customer_discount', {
      p_tab_id: tabId, p_kind: 'amount', p_value: 1000, p_reason: 'coach',
    })).data).toMatchObject({ standing: false, amount_iqd: 1000 });
    expect((await state(cashier, { p_tab_id: tabId })).cafe_waived).toBe(false);
    expect((await appRpc(cashier, 'apply_customer_discount', { p_tab_id: tabId, p_kind: 'standing' })).data)
      .toMatchObject({ standing: true, amount_iqd: 3000 });
    const { data: rows } = await svc.from('tab_adjustments').select('reason_code').eq('tab_id', tabId);
    expect(rows).toEqual([{ reason_code: 'customer_discount' }]);
  });

  // ── the court fee ─────────────────────────────────────────────────────────

  it('the court discount lowers what the booking owes, and the paid bill closes it', async () => {
    const r = await makeBooking(40_000, customerId);
    const before = await state(desk, { p_reservation_id: r });
    expect(before.court_allowed).toBe(true);
    expect(before.court_needs_refresh).toBe(true);

    const applied = await appRpc(desk, 'apply_customer_court_discount', { p_reservation_id: r });
    expect(applied.error).toBeNull();
    expect(applied.data).toMatchObject({ applied: true, kind: 'percent', value: 5000, amount_iqd: 20_000, standing: true, remaining_iqd: 20_000 });
    expect(await courtRemaining(r)).toBe(20_000);

    const tabId = await openTab(desk, { p_reservation_id: r });
    expect((await totals(tabId)).court_iqd).toBe(20_000);
    const paid = await appRpc(desk, 'settle_tab', {
      p_tab_id: tabId, p_method: 'cash', p_tendered_iqd: 20_000, p_expected_total_iqd: 20_000,
      p_idempotency_key: testIdemKey('tab.settle'),
    });
    expect(paid.error).toBeNull();
    expect(await courtRemaining(r)).toBe(0);

    // The bill closed with it: it stands, and no refresh or edit moves it.
    const after = await state(desk, { p_reservation_id: r });
    expect(after.court).toMatchObject({ amount_iqd: 20_000, closed: true });
    expect(after.court_needs_refresh).toBe(false);
    expect(errCode((await appRpc(desk, 'apply_customer_court_discount', { p_reservation_id: r, p_kind: 'none' })).error))
      .toBe('COURT_BILL_CLOSED');
    expect((await appRpc(desk, 'apply_customer_court_discount', { p_reservation_id: r })).data).toMatchObject({ unchanged: true });

    const { data: unpaid } = await appRpc(manager, 'unpaid_played_bookings', {});
    expect(((unpaid as { reservation_id: string }[] | null) ?? []).some((u) => u.reservation_id === r)).toBe(false);
  });

  it('follows the price when the booking is extended', async () => {
    const r = await makeBooking(40_000, customerId);
    await appRpc(desk, 'apply_customer_court_discount', { p_reservation_id: r });
    await svc.from('reservations').update({ price_iqd: 60_000 }).eq('id', r);
    expect(await courtRemaining(r)).toBe(30_000);
  });

  it('a court discount taken off one booking stays off there, and standing puts it back', async () => {
    const r = await makeBooking(40_000, customerId);   // coach: 50% court
    expect((await appRpc(desk, 'apply_customer_court_discount', { p_reservation_id: r })).data).toMatchObject({ amount_iqd: 20_000 });
    expect((await appRpc(desk, 'apply_customer_court_discount', { p_reservation_id: r, p_kind: 'none' })).data)
      .toMatchObject({ applied: false, remaining_iqd: 40_000 });
    expect(await state(desk, { p_reservation_id: r })).toMatchObject({ court: null, court_waived: true, court_needs_refresh: false });
    expect((await appRpc(desk, 'apply_customer_court_discount', { p_reservation_id: r })).data).toMatchObject({ applied: false });
    expect(await courtRemaining(r)).toBe(40_000);

    expect((await appRpc(desk, 'apply_customer_court_discount', { p_reservation_id: r, p_kind: 'standing' })).data)
      .toMatchObject({ applied: true, standing: true, remaining_iqd: 20_000 });
    expect(await state(desk, { p_reservation_id: r })).toMatchObject({ court: { reason: 'coach' }, court_waived: false });
  });

  it('a one-off court discount on a walk-in with no account needs a customer', async () => {
    const r = await makeBooking(40_000, null);
    expect((await appRpc(desk, 'apply_customer_court_discount', { p_reservation_id: r })).data).toMatchObject({ applied: false });
    expect(errCode((await appRpc(desk, 'apply_customer_court_discount', {
      p_reservation_id: r, p_kind: 'amount', p_value: 5000, p_reason: 'other',
    })).error)).toBe('NO_CUSTOMER');
  });

  it('an amount off a booking for this bill only, then removed before paying', async () => {
    const r = await makeBooking(40_000, plainId);
    const once = await appRpc(desk, 'apply_customer_court_discount', {
      p_reservation_id: r, p_kind: 'amount', p_value: 15_000, p_reason: 'sponsored',
    });
    expect(once.error).toBeNull();
    expect(once.data).toMatchObject({ standing: false, amount_iqd: 15_000, remaining_iqd: 25_000 });
    const off = await appRpc(desk, 'apply_customer_court_discount', { p_reservation_id: r, p_kind: 'none' });
    expect(off.data).toMatchObject({ applied: false, remaining_iqd: 40_000 });
  });

  it('refuses a court discount larger than what is still owed after a part payment', async () => {
    const r = await makeBooking(40_000, plainId);
    const tabId = await openTab(desk, { p_reservation_id: r });
    const part = await appRpc(desk, 'settle_tab', {
      p_tab_id: tabId, p_method: 'card', p_amount_iqd: 30_000, p_idempotency_key: testIdemKey('payment.record'),
    });
    expect(part.error).toBeNull();
    expect(errCode((await appRpc(desk, 'apply_customer_court_discount', {
      p_reservation_id: r, p_kind: 'percent', p_value: 5000, p_reason: 'family',
    })).error)).toBe('DISCOUNT_REQUIRES_REFUND');
    // Nothing written: the booking still owes its full fee (the open bill's
    // part payment counts once that bill settles).
    expect(await courtRemaining(r)).toBe(40_000);
    expect((await state(desk, { p_reservation_id: r })).court).toBeNull();
  });

  it('a booking already paid has nothing to discount', async () => {
    const r = await makeBooking(30_000, plainId);
    const tabId = await openTab(desk, { p_reservation_id: r });
    expect((await appRpc(desk, 'settle_tab', {
      p_tab_id: tabId, p_method: 'cash', p_tendered_iqd: 30_000, p_idempotency_key: testIdemKey('tab.settle'),
    })).error).toBeNull();
    expect(errCode((await appRpc(desk, 'apply_customer_court_discount', {
      p_reservation_id: r, p_kind: 'percent', p_value: 1000, p_reason: 'other',
    })).error)).toBe('COURT_FEE_PAID');
  });

  // ── account deletion ──────────────────────────────────────────────────────

  it('a deleted account loses its standing discount', async () => {
    const g = await guestClient(svc, 'discount-deleted');
    const gid = (await g.auth.getUser()).data.user!.id;
    expect((await setDiscount(desk, gid, { p_cafe_kind: 'percent', p_cafe_value: 1000, p_reason: 'other', p_note: 'x' })).error).toBeNull();
    const del = await appRpc(g, 'delete_my_account', { p_confirm: 'DELETE' });
    expect(del.error).toBeNull();
    const { data } = await svc.from('customer_discounts').select('customer_id').eq('customer_id', gid);
    expect(data).toEqual([]);
  });
});
