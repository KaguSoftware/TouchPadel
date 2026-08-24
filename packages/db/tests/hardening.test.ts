/**
 * Hardening sweep (0026) — adversarial-review fixes:
 *   1. app.assert_bookable: CLOSED_DATE + venue-local OUTSIDE_HOURS on
 *      hold_slot and staff_create_reservation (maintenance exempt).
 *   2. PIN rekey: verify_manager_pin rate-limits per CALLER — rotating the
 *      client-supplied device id no longer resets the 5-failure window.
 *   3. staff_create_reservation: unpriced bookings raise NO_RATE; manager/owner
 *      p_price_override_iqd is accepted and audited (reason 'price_override').
 *   4. void_after_send: VOID_REQUIRES_REFUND when the void would drop the tab
 *      total below the net amount already paid; the refund -> void -> settle
 *      remainder unwind terminates.
 *
 * Venue assumptions (seed): timezone Asia/Baghdad (UTC+3), opening hours
 * 09:00-23:00 every day, closed_dates empty.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  guestClient,
  appRpc,
  createTestCourt,
  ensureTestRateRule,
  createTestMenuItem,
  ensureOpenDay,
  ensureTillFresh,
  testIdemKey,
  outcome,
  SEED_STAFF,
  DEV_PINS,
} from './helpers';

const up = await stackAvailable();

/** UTC calendar date string N days out. */
function isoDatePlus(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe.skipIf(!up)('hardening fixes (0026)', () => {
  let svc: SupabaseClient;
  let desk: SupabaseClient;
  let manager: SupabaseClient;
  let courtId: string;

  async function setClosedDates(dates: string[]): Promise<void> {
    const { error } = await svc
      .from('venue_settings')
      .update({ closed_dates: dates })
      .eq('id', true);
    if (error) throw new Error(`closed_dates update failed: ${error.message}`);
  }

  beforeAll(async () => {
    svc = serviceClient();
    desk = await signedInClient(SEED_STAFF.court_desk);
    manager = await signedInClient(SEED_STAFF.manager);
    await ensureTestRateRule(svc);
    await ensureTillFresh(svc);
    courtId = await createTestCourt(svc, 'HARDEN');
  });

  afterAll(async () => {
    // Never leave a closed date behind for later suites / reruns.
    if (svc) await setClosedDates([]);
  });

  // ── 1a. CLOSED_DATE ────────────────────────────────────────────────────────

  it('CLOSED_DATE: guest hold and desk booking refused on a closed date; maintenance exempt', async () => {
    const closed = isoDatePlus(40);
    await setClosedDates([closed]);
    try {
      // 09:00 UTC = 12:00 venue-local, same calendar date — inside opening
      // hours, so ONLY the closed date can reject it.
      const start = `${closed}T09:00:00Z`;
      const end = `${closed}T10:00:00Z`;

      const guest = await anonymousSessionClient();
      const hold = await appRpc(guest, 'hold_slot', {
        p_court_id: courtId,
        p_start_at: start,
        p_duration_min: 60,
      }).then(outcome);
      expect(hold.ok).toBe(false);
      expect(hold.errorMessage).toContain('CLOSED_DATE');

      const booking = await appRpc(desk, 'staff_create_reservation', {
        p_court_id: courtId,
        p_kind: 'booking',
        p_start_at: start,
        p_end_at: end,
        p_guest_name: 'Closed Day Guest',
      }).then(outcome);
      expect(booking.ok).toBe(false);
      expect(booking.errorMessage).toContain('CLOSED_DATE');

      // Maintenance on the closed day is legitimate (resurfacing, private event).
      const maint = await appRpc(desk, 'staff_create_reservation', {
        p_court_id: courtId,
        p_kind: 'maintenance',
        p_start_at: start,
        p_end_at: end,
        p_notes: 'closed-day resurfacing',
      }).then(outcome);
      expect(maint.ok, maint.errorMessage).toBe(true);
    } finally {
      await setClosedDates([]);
    }
  });

  // ── 1b. OUTSIDE_HOURS ─────────────────────────────────────────────────────

  it('OUTSIDE_HOURS: starts after close / ends past close refused; ending AT close allowed', async () => {
    const d = isoDatePlus(41);
    const guest = await anonymousSessionClient();

    // 20:30 UTC = 23:30 local — starts after closing.
    const late = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: `${d}T20:30:00Z`,
      p_duration_min: 60,
    }).then(outcome);
    expect(late.ok).toBe(false);
    expect(late.errorMessage).toContain('OUTSIDE_HOURS');

    // 19:30 UTC = 22:30 local, +60min ends 23:30 — spills past closing.
    const spill = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: `${d}T19:30:00Z`,
      p_duration_min: 60,
    }).then(outcome);
    expect(spill.ok).toBe(false);
    expect(spill.errorMessage).toContain('OUTSIDE_HOURS');

    // Desk booking gets the same guard.
    const deskSpill = await appRpc(desk, 'staff_create_reservation', {
      p_court_id: courtId,
      p_kind: 'booking',
      p_start_at: `${d}T19:30:00Z`,
      p_end_at: `${d}T20:30:00Z`,
      p_guest_name: 'After Hours',
    }).then(outcome);
    expect(deskSpill.ok).toBe(false);
    expect(deskSpill.errorMessage).toContain('OUTSIDE_HOURS');

    // 19:00 UTC = 22:00 local, +60min ends exactly 23:00 — half-open window,
    // ending AT closing time is allowed.
    const boundary = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: `${d}T19:00:00Z`,
      p_duration_min: 60,
    }).then(outcome);
    expect(boundary.ok, boundary.errorMessage).toBe(true);
  });

  // ── 2. PIN rekey: rotating device ids no longer evades the lockout ────────

  it('PIN rekey: 5 failures across ROTATED device ids lock the caller; other callers unaffected', async () => {
    const attacker = await guestClient(svc, 'pin-rotate');
    for (let i = 0; i < 5; i++) {
      const bad = await appRpc(attacker, 'verify_manager_pin', {
        p_pin: '000000',
        p_device_id: `ROTATE-${Date.now()}-${i}`, // fresh device id every attempt
      });
      expect(bad.error).toBeNull();
      expect(bad.data).toBeNull(); // invalid PIN => NULL (attempt row persists)
    }
    // 6th attempt on yet ANOTHER device id, with the RIGHT pin: still locked —
    // the window is per caller, not per client-supplied device id.
    const locked = await appRpc(attacker, 'verify_manager_pin', {
      p_pin: DEV_PINS.manager,
      p_device_id: `ROTATE-fresh-${Date.now()}`,
    });
    expect(locked.error?.message).toContain('PIN_LOCKED');

    // A different caller with the correct PIN is not collateral damage.
    const bystander = await guestClient(svc, 'pin-clean');
    const ok = await appRpc(bystander, 'verify_manager_pin', {
      p_pin: DEV_PINS.manager,
      p_device_id: 'ROTATE-bystander',
    });
    expect(ok.error).toBeNull();
    expect(typeof ok.data).toBe('string'); // authorizer staff uuid
  });

  // ── 3. NO_RATE + manager/owner price override ─────────────────────────────

  it('unpriced booking raises NO_RATE; desk override FORBIDDEN; manager override stored + audited', async () => {
    const court = await createTestCourt(svc, 'HARDEN-RATE');
    const d = isoDatePlus(42);
    // 30-minute range: no rule (fixtures or TEST all-day) prices 30 minutes.
    const start = `${d}T09:00:00Z`;
    const end = `${d}T09:30:00Z`;

    const unpriced = await appRpc(desk, 'staff_create_reservation', {
      p_court_id: court,
      p_kind: 'booking',
      p_start_at: start,
      p_end_at: end,
      p_guest_name: 'Odd Range',
    }).then(outcome);
    expect(unpriced.ok).toBe(false);
    expect(unpriced.errorMessage).toContain('NO_RATE');

    const deskOverride = await appRpc(desk, 'staff_create_reservation', {
      p_court_id: court,
      p_kind: 'booking',
      p_start_at: start,
      p_end_at: end,
      p_guest_name: 'Odd Range',
      p_price_override_iqd: 25_000,
    }).then(outcome);
    expect(deskOverride.ok).toBe(false);
    expect(deskOverride.errorMessage).toContain('FORBIDDEN');

    const managerOverride = await appRpc(manager, 'staff_create_reservation', {
      p_court_id: court,
      p_kind: 'booking',
      p_start_at: start,
      p_end_at: end,
      p_guest_name: 'Odd Range',
      p_price_override_iqd: 25_000,
    }).then(outcome);
    expect(managerOverride.ok, managerOverride.errorMessage).toBe(true);
    const resId = (managerOverride.data as { reservation_id: string; price_iqd: number })
      .reservation_id;
    expect(Number((managerOverride.data as { price_iqd: number }).price_iqd)).toBe(25_000);

    const { data: row } = await svc
      .from('reservations')
      .select('price_iqd, rate_rule_id')
      .eq('id', resId)
      .single();
    expect(Number((row as { price_iqd: number }).price_iqd)).toBe(25_000);

    // Audited with reason 'price_override', applied_by + value recorded.
    const { data: audit } = await svc
      .from('audit_log')
      .select('action, reason_code, actor_id, after')
      .eq('entity_id', resId)
      .eq('action', 'reservation.price_override');
    expect(audit).toHaveLength(1);
    const a = audit![0] as {
      reason_code: string;
      actor_id: string;
      after: { price_override_iqd: number; applied_by: string };
    };
    expect(a.reason_code).toBe('price_override');
    expect(Number(a.after.price_override_iqd)).toBe(25_000);
    expect(a.after.applied_by).toBe(a.actor_id);
  });

  // ── 4. VOID_REQUIRES_REFUND + the refund -> void -> settle unwind ─────────

  it('void below net paid raises VOID_REQUIRES_REFUND; refund unwind then settles the remainder', async () => {
    await ensureOpenDay(manager, svc);
    const menu = await createTestMenuItem(svc, 'void-guard', 5_000);

    const tab = await appRpc(manager, 'open_tab', {
      p_label: `طاولة فحص الإبطال ${Date.now()}`,
      p_idempotency_key: testIdemKey('tab.open'),
    }).then(outcome);
    expect(tab.ok, tab.errorMessage).toBe(true);
    const tabId = (tab.data as { tab_id: string }).tab_id;

    // Two 5,000 lines -> 10,000 total.
    const order = await appRpc(manager, 'till_add_items', {
      p_tab_id: tabId,
      p_items: [
        { variant_id: menu.variantId, qty: 1 },
        { variant_id: menu.variantId, qty: 1 },
      ],
      p_idempotency_key: testIdemKey('order.add'),
    }).then(outcome);
    expect(order.ok, order.errorMessage).toBe(true);
    const orderId = (order.data as { order_id: string }).order_id;

    // Partial payment: 8,000 of 10,000 -> awaiting_payment.
    const pay = await appRpc(manager, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'cash',
      p_amount_iqd: 8_000,
      p_tendered_iqd: 8_000,
      p_idempotency_key: testIdemKey('payment.settle'),
    }).then(outcome);
    expect(pay.ok, pay.errorMessage).toBe(true);
    expect((pay.data as { status: string }).status).toBe('awaiting_payment');
    const paymentId = (pay.data as { payment_id: string }).payment_id;

    const { data: items } = await svc
      .from('order_items')
      .select('id')
      .eq('order_id', orderId);
    expect(items).toHaveLength(2);
    const itemId = (items![0] as { id: string }).id;

    // Voiding a 5,000 line would drop the total to 5,000 < 8,000 paid: refused.
    const blocked = await appRpc(manager, 'void_after_send', {
      p_order_item_id: itemId,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'wrong item',
    }).then(outcome);
    expect(blocked.ok).toBe(false);
    expect(blocked.errorMessage).toContain('VOID_REQUIRES_REFUND');

    // The raise rolled the strike back — the line is still live.
    const { data: still } = await svc
      .from('order_items')
      .select('voided')
      .eq('id', itemId)
      .single();
    expect((still as { voided: boolean }).voided).toBe(false);

    // UNWIND: refund 5,000 (net paid 3,000) -> void succeeds -> settle the
    // remaining 2,000 -> tab settled, day stays closable.
    const refund = await appRpc(manager, 'refund', {
      p_payment_id: paymentId,
      p_amount_iqd: 5_000,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'void unwind',
    }).then(outcome);
    expect(refund.ok, refund.errorMessage).toBe(true);

    const voided = await appRpc(manager, 'void_after_send', {
      p_order_item_id: itemId,
      p_pin: DEV_PINS.manager,
      p_reason_code: 'wrong item',
    }).then(outcome);
    expect(voided.ok, voided.errorMessage).toBe(true);

    const remainder = await appRpc(manager, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'cash',
      p_tendered_iqd: 2_000,
      p_idempotency_key: testIdemKey('payment.settle'),
    }).then(outcome);
    expect(remainder.ok, remainder.errorMessage).toBe(true);
    expect((remainder.data as { status: string }).status).toBe('settled');
    expect(Number((remainder.data as { amount_iqd: number }).amount_iqd)).toBe(2_000);
  });

  // ── 4b. set_staff_pin writes an audit row without PIN material ────────────

  it('set_staff_pin writes a staff.pin_set audit row with no PIN material', async () => {
    const owner = await signedInClient(SEED_STAFF.owner);
    const managerId = 'a0000000-0000-4000-8000-000000000002'; // seeded manager
    const before = Date.now();
    const res = await appRpc(owner, 'set_staff_pin', {
      p_staff_id: managerId,
      p_pin: DEV_PINS.manager, // reset to the same seeded PIN — no state change
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);

    const { data: audit } = await svc
      .from('audit_log')
      .select('action, after, reason_code')
      .eq('action', 'staff.pin_set')
      .eq('entity_id', managerId)
      .gte('at', new Date(before - 1_000).toISOString());
    expect(audit!.length).toBeGreaterThanOrEqual(1);
    for (const row of audit as { after: Record<string, unknown> }[]) {
      expect(JSON.stringify(row.after)).not.toContain(DEV_PINS.manager);
    }
  });
});
