/**
 * 0071 — Phase 2 booking and money integrity (docs/security/security-general.md §06).
 *
 * The standard §17 of that document sets for a tick: "the test that goes red
 * when the fix is removed". Each block below is written to do exactly that —
 * revert the matching section of 0071 and the block fails.
 *
 *   SEC-07  a LIVE hold must belong to an account (structural, not only the
 *           ACCOUNT_REQUIRED guard 0048/C1 put on app.hold_slot)
 *   SEC-10  rate_rule_prices: a price must be positive, a duration must be sane
 *   SEC-09  a move or extend that CHANGES the price needs a real reason, and
 *           both prices land in the audit row as named fields
 *   SEC-11  ★ no_show and completed — the two transitions that free the slot —
 *           are refused before the reservation has started
 *
 * Venue timezone is Asia/Baghdad (UTC+3, no DST since 2008), so local hour =
 * UTC hour + 3. Opening hours are 09:00-24:00 local plus a 00:00-02:00 tail.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  guestClient,
  appRpc,
  createTestCourt,
  ensureTestRateRule,
  futureSlot,
  outcome,
  SEED_STAFF,
} from './helpers';

const up = await stackAvailable();

/** Latest audit row for one reservation, whatever the action. */
async function lastAudit(svc: SupabaseClient, reservationId: string) {
  const { data } = await svc
    .from('audit_log')
    .select('action, reason_code, after')
    .eq('entity', 'reservations')
    .eq('entity_id', reservationId)
    .order('at', { ascending: false }) // audit_log's timestamp column is `at` (0005), not created_at
    .limit(1);
  return (data ?? [])[0] as
    { action: string; reason_code: string | null; after: Record<string, unknown> } | undefined;
}

describe.skipIf(!up)('0071 booking integrity (SEC-07 / 09 / 10 / 11)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let desk: SupabaseClient;
  let courtId: string;
  let otherCourtId: string;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    desk = await signedInClient(SEED_STAFF.court_desk);
    await ensureTestRateRule(svc);
    courtId = await createTestCourt(svc, 'INTEG0071');

    // A court-specific rule at priority 500 always wins app.price_slot's
    // resolution (court-specificity -> priority -> id), and — unlike the shared
    // "TEST all-day" fixture, which prices every duration at 40,000 — it prices
    // each duration DIFFERENTLY. Without that, an extend from 60 to 120 minutes
    // would not change the price and the SEC-09 cases would pass vacuously.
    const { data: rule, error } = await svc
      .from('rate_rules')
      .insert({
        name: 'TEST 0071 tiered',
        court_id: courtId,
        days_of_week: [0, 1, 2, 3, 4, 5, 6],
        start_time: '00:00',
        end_time: '23:59:59',
        priority: 500,
        is_active: true,
      })
      .select('id')
      .single();
    if (error) throw new Error(`0071 rate rule: ${error.message}`);
    const ruleId = (rule as { id: string }).id;
    const { error: pErr } = await svc.from('rate_rule_prices').insert([
      { rule_id: ruleId, duration_min: 60, price_iqd: 40_000 },
      { rule_id: ruleId, duration_min: 90, price_iqd: 55_000 },
      { rule_id: ruleId, duration_min: 120, price_iqd: 70_000 },
    ]);
    if (pErr) throw new Error(`0071 rate prices: ${pErr.message}`);

    // A SECOND court priced IDENTICALLY, for the "a move that changes nothing
    // needs no reason" case. Relying on the shared all-day fixture for the
    // destination made that test depend on which fixture packs happen to be
    // loaded: with packages/db/fixtures/courts.sql applied, the destination
    // resolves to the venue's real peak/off-peak/weekend rates instead of a flat
    // 40,000, the price changes, and the test fails for a reason that has
    // nothing to do with what it asserts. Its own court, its own rule, same
    // numbers — so "the price did not change" is true by construction.
    otherCourtId = await createTestCourt(svc, 'INTEG0071-B');
    const { data: rule2, error: e2 } = await svc
      .from('rate_rules')
      .insert({
        name: 'TEST 0071 tiered (court B)',
        court_id: otherCourtId,
        days_of_week: [0, 1, 2, 3, 4, 5, 6],
        start_time: '00:00',
        end_time: '23:59:59',
        priority: 500,
        is_active: true,
      })
      .select('id')
      .single();
    if (e2) throw new Error(`0071 rate rule B: ${e2.message}`);
    const { error: pErr2 } = await svc.from('rate_rule_prices').insert(
      [
        { duration_min: 60, price_iqd: 40_000 },
        { duration_min: 90, price_iqd: 55_000 },
        { duration_min: 120, price_iqd: 70_000 },
      ].map((r) => ({ ...r, rule_id: (rule2 as { id: string }).id })),
    );
    if (pErr2) throw new Error(`0071 rate prices B: ${pErr2.message}`);
  });

  /** A confirmed desk booking on the test court, priced by the tiered rule. */
  async function deskBooking(durationMin = 60) {
    // futureSlot() hands out consecutive HOURS on the same day, so two bookings
    // in a row are back-to-back. Several tests here extend a 60-minute booking
    // to 120, which then occupies the next caller's slot and fails it with
    // SLOT_TAKEN — a collision between tests, not a fault in anything under
    // test. Burning one slot per booking leaves a two-hour lane, which is the
    // longest any test here needs.
    const slot = futureSlot();
    futureSlot();
    const res = await appRpc(desk, 'staff_create_reservation', {
      p_court_id: courtId,
      p_kind: 'booking',
      p_start_at: slot.start.toISOString(),
      p_end_at: slot.plus(durationMin).toISOString(),
      p_guest_name: 'Integrity Test',
    }).then(outcome);
    if (!res.ok) throw new Error(`deskBooking failed: ${res.errorMessage}`);
    const d = res.data as { reservation_id: string; price_iqd: number };
    return { id: d.reservation_id, priceIqd: d.price_iqd, slot };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SEC-07 — a live hold belongs to an account
  // ═══════════════════════════════════════════════════════════════════════
  describe('SEC-07 a live hold belongs to an account', () => {
    it('the database refuses a pending hold with no guest, even from service_role', async () => {
      const slot = futureSlot();
      // service_role bypasses RLS. It does NOT bypass a CHECK constraint, which
      // is the whole reason this is a constraint and not a third guard in a
      // third RPC: it holds for every writer, including the one nobody wrote yet.
      const { error } = await svc.from('reservations').insert({
        court_id: courtId,
        kind: 'hold',
        status: 'pending',
        start_at: slot.start.toISOString(),
        end_at: slot.plus(60).toISOString(),
        guest_id: null,
        source: 'mobile',
        hold_expires_at: new Date(Date.now() + 300_000).toISOString(),
      });

      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/reservations_live_hold_has_guest/);
    });

    it('a hold WITH an account is accepted, and cannot then have its guest removed', async () => {
      const guest = await guestClient(svc, 'sec07');
      const slot = futureSlot();
      const held = await appRpc(guest, 'hold_slot', {
        p_court_id: courtId,
        p_start_at: slot.start.toISOString(),
        p_duration_min: 60,
      }).then(outcome);
      expect(held.ok).toBe(true);
      const holdId = (held.data as { reservation_id: string }).reservation_id;

      // The constraint is evaluated on UPDATE as well as INSERT, so a repair
      // script cannot orphan a live hold either.
      const { error } = await svc.from('reservations').update({ guest_id: null }).eq('id', holdId);
      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/reservations_live_hold_has_guest/);
    });

    it('the reaper still expires a TTL-lapsed hold (the widening did not break it)', async () => {
      const guest = await guestClient(svc, 'sec07-ttl');
      const slot = futureSlot();
      const held = await appRpc(guest, 'hold_slot', {
        p_court_id: courtId,
        p_start_at: slot.start.toISOString(),
        p_duration_min: 60,
      }).then(outcome);
      expect(held.ok).toBe(true);
      const holdId = (held.data as { reservation_id: string }).reservation_id;

      // Age it past its TTL. guest_id stays set, so this exercises the ORIGINAL
      // branch of the predicate — the regression this widening could have broken.
      await svc
        .from('reservations')
        .update({ hold_expires_at: new Date(Date.now() - 60_000).toISOString() })
        .eq('id', holdId);

      const swept = await appRpc(owner, 'expire_stale_holds', {
        p_court_id: courtId,
        p_period: null,
      }).then(outcome);
      expect(swept.ok).toBe(true);

      const { data } = await svc.from('reservations').select('status').eq('id', holdId).single();
      expect((data as { status: string }).status).toBe('expired');
    });

    // NOTE, deliberately not a test: the reaper's `guest_id is null` branch
    // cannot be exercised from here, because the constraint above makes an
    // orphan hold uninsertable. That is the intended relationship — the
    // constraint stops new ones, the one-shot UPDATE in 0071 cleans the ones
    // already in the hosted database, and the widened predicate is what catches
    // a legacy row on a database that reaches this migration late. Asserting it
    // would mean dropping the constraint to prove the backstop, which tests the
    // test rather than the system.
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SEC-10 — a price must be positive, a duration must be sane
  // ═══════════════════════════════════════════════════════════════════════
  describe('SEC-10 rate rule prices are constrained', () => {
    const validRule = {
      p_name: 'SEC-10 probe',
      p_days_of_week: [0, 1, 2, 3, 4, 5, 6],
      p_start_time: '09:00',
      p_end_time: '17:00',
    };

    it('a zero price is refused with a named error, not a raw constraint violation', async () => {
      const res = await appRpc(owner, 'upsert_rate_rule', {
        ...validRule,
        p_prices: { '60': 0 },
      }).then(outcome);

      expect(res.ok).toBe(false);
      expect(res.errorMessage).toContain('INVALID_PRICES');
      // SEC-36's quiet-error rule: the caller learns what to fix, not the schema.
      expect(res.errorMessage).not.toContain('rate_rule_prices_price_positive');
    });

    it('an out-of-range duration is refused with a named error', async () => {
      for (const bad of [0, 7, 10, 600]) {
        const res = await appRpc(owner, 'upsert_rate_rule', {
          ...validRule,
          p_prices: { [String(bad)]: 40_000 },
        }).then(outcome);
        expect(res.ok, `duration ${bad} should be refused`).toBe(false);
        expect(res.errorMessage).toContain('INVALID_DURATION');
      }
    });

    it('the constraints hold against a direct write, not only through the RPC', async () => {
      const { data: rule } = await svc
        .from('rate_rules')
        .insert({
          name: 'SEC-10 direct probe',
          court_id: courtId,
          days_of_week: [1],
          start_time: '09:00',
          end_time: '10:00',
          priority: -500,
          is_active: false,
        })
        .select('id')
        .single();
      const ruleId = (rule as { id: string }).id;

      const zero = await svc
        .from('rate_rule_prices')
        .insert({ rule_id: ruleId, duration_min: 60, price_iqd: 0 });
      expect(zero.error?.message).toMatch(/rate_rule_prices_price_positive/);

      const stray = await svc
        .from('rate_rule_prices')
        .insert({ rule_id: ruleId, duration_min: 7, price_iqd: 40_000 });
      expect(stray.error?.message).toMatch(/rate_rule_prices_duration_bounds/);
    });

    it('a rejected price map leaves the existing prices intact', async () => {
      // upsert_rate_rule replaces prices WHOLESALE (delete then insert), so a
      // validation failure part-way through the loop would leave a rule priced
      // for fewer durations than before — configured in the admin UI, silently
      // unpriced for the durations that were dropped. 0071 validates the whole
      // map before the first write; this is the case that proves it.
      const created = await appRpc(owner, 'upsert_rate_rule', {
        ...validRule,
        p_name: 'SEC-10 partial-write probe',
        p_prices: { '60': 40_000, '90': 55_000 },
      }).then(outcome);
      expect(created.ok).toBe(true);
      const ruleId = created.data as string;

      const rejected = await appRpc(owner, 'upsert_rate_rule', {
        ...validRule,
        p_name: 'SEC-10 partial-write probe',
        p_id: ruleId,
        p_prices: { '60': 45_000, '90': 0 }, // second entry is the bad one
      }).then(outcome);
      expect(rejected.ok).toBe(false);
      expect(rejected.errorMessage).toContain('INVALID_PRICES');

      const { data } = await svc
        .from('rate_rule_prices')
        .select('duration_min, price_iqd')
        .eq('rule_id', ruleId)
        .order('duration_min');
      expect(data).toEqual([
        { duration_min: 60, price_iqd: 40_000 },
        { duration_min: 90, price_iqd: 55_000 },
      ]);
    });

    it('a well-formed rule still saves', async () => {
      const res = await appRpc(owner, 'upsert_rate_rule', {
        ...validRule,
        p_name: 'SEC-10 happy path',
        p_prices: { '60': 40_000, '90': 55_000, '120': 70_000 },
      }).then(outcome);
      expect(res.ok).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SEC-09 — a re-price needs a reason, and both prices are auditable
  // ═══════════════════════════════════════════════════════════════════════
  describe('SEC-09 a price change carries a reason', () => {
    it('an extend that re-prices is refused when the reason is the default', async () => {
      const b = await deskBooking(60);
      expect(b.priceIqd).toBe(40_000);

      const res = await appRpc(desk, 'extend_reservation', {
        p_reservation_id: b.id,
        p_new_end_at: b.slot.plus(120).toISOString(),
        p_reason: 'staff_op', // the default: the ABSENCE of a reason
      }).then(outcome);

      expect(res.ok).toBe(false);
      expect(res.errorMessage).toContain('REASON_REQUIRED');

      // Refused BEFORE the write: the booking is untouched, not extended-but-
      // unexplained.
      const { data } = await svc
        .from('reservations')
        .select('end_at, price_iqd')
        .eq('id', b.id)
        .single();
      const row = data as { end_at: string; price_iqd: number };
      expect(row.price_iqd).toBe(40_000);
      expect(new Date(row.end_at).getTime()).toBe(b.slot.plus(60).getTime());
    });

    it('a null or blank reason is refused the same way', async () => {
      const b = await deskBooking(60);
      for (const reason of [null, '', '   ', 'x']) {
        const res = await appRpc(desk, 'extend_reservation', {
          p_reservation_id: b.id,
          p_new_end_at: b.slot.plus(120).toISOString(),
          p_reason: reason,
        }).then(outcome);
        expect(res.ok, `reason ${JSON.stringify(reason)} should be refused`).toBe(false);
        expect(res.errorMessage).toContain('REASON_REQUIRED');
      }
    });

    it('with a real reason it succeeds and the audit row names both prices', async () => {
      const b = await deskBooking(60);

      const res = await appRpc(desk, 'extend_reservation', {
        p_reservation_id: b.id,
        p_new_end_at: b.slot.plus(120).toISOString(),
        p_reason: 'customer_request', // one of the operator's OVERRIDE_REASONS
      }).then(outcome);

      expect(res.ok).toBe(true);
      const out = res.data as { price_iqd: number; price_before: number; price_changed: boolean };
      expect(out.price_before).toBe(40_000);
      expect(out.price_iqd).toBe(70_000);
      expect(out.price_changed).toBe(true);

      const audit = await lastAudit(svc, b.id);
      expect(audit?.action).toBe('reservation.extend');
      expect(audit?.reason_code).toBe('customer_request');
      // Named fields, so "every move that changed a price" is a query rather
      // than a human diffing two row snapshots.
      expect(audit?.after.price_before).toBe(40_000);
      expect(audit?.after.price_after).toBe(70_000);
      expect(audit?.after.price_changed).toBe(true);
    });

    it('a move that does NOT change the price still works with the default reason', async () => {
      // The rule is scoped to price CHANGES on purpose. A desk moving a booking
      // to the identical-priced slot next door is routine work and must not
      // start demanding a justification, or the prompt becomes noise that staff
      // click through — which is how a real reason stops meaning anything.
      const b = await deskBooking(60);

      const res = await appRpc(desk, 'move_reservation', {
        p_reservation_id: b.id,
        p_court_id: otherCourtId,
        p_reason: 'staff_op',
      }).then(outcome);

      // Both courts carry the same tiered prices, so this move cannot change the
      // money — and the default reason is therefore accepted.
      expect(res.ok, res.errorMessage).toBe(true);
      const out = res.data as { price_changed: boolean; price_iqd: number };
      expect(out.price_changed).toBe(false);
      expect(out.price_iqd).toBe(40_000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SEC-11 ★ — a future booking cannot be freed for resale
  // ═══════════════════════════════════════════════════════════════════════
  describe('SEC-11 a future booking cannot be marked absent', () => {
    it('no_show on a future booking is refused, and the court stays taken', async () => {
      const b = await deskBooking(60);

      const res = await appRpc(desk, 'mark_reservation', {
        p_reservation_id: b.id,
        p_status: 'no_show',
        p_reason: 'customer_request',
      }).then(outcome);

      expect(res.ok).toBe(false);
      expect(res.errorMessage).toContain('RESERVATION_NOT_STARTED');

      // The assertion that matters is not the error — it is that the slot was
      // never freed. This is the resale the finding describes.
      const resold = await appRpc(desk, 'staff_create_reservation', {
        p_court_id: courtId,
        p_kind: 'booking',
        p_start_at: b.slot.start.toISOString(),
        p_end_at: b.slot.plus(60).toISOString(),
        p_guest_name: 'Second Buyer',
      }).then(outcome);
      expect(resold.ok).toBe(false);
      expect(resold.errorMessage).toContain('SLOT_TAKEN');
    });

    it('completed on a future booking is refused for the same reason', async () => {
      const b = await deskBooking(60);
      const res = await appRpc(desk, 'mark_reservation', {
        p_reservation_id: b.id,
        p_status: 'completed',
        p_reason: 'customer_request',
      }).then(outcome);

      expect(res.ok).toBe(false);
      expect(res.errorMessage).toContain('RESERVATION_NOT_STARTED');
    });

    it('arrived on a future booking is still allowed — it frees nothing', async () => {
      // 'arrived' stays INSIDE the exclusion predicate
      // (status in ('pending','confirmed','arrived')), so an early check-in
      // cannot resell the slot. Guarding it would break the desk for no gain.
      const b = await deskBooking(60);
      const res = await appRpc(desk, 'mark_reservation', {
        p_reservation_id: b.id,
        p_status: 'arrived',
        p_reason: 'customer_request',
      }).then(outcome);

      expect(res.ok).toBe(true);
      expect((res.data as { status: string }).status).toBe('arrived');
    });

    it('a booking that HAS started can be marked no_show', async () => {
      // Written directly: app.staff_create_reservation runs assert_bookable,
      // which checks opening hours against the wall clock of the slot, and a
      // past slot would make this suite depend on the hour the tests run.
      const start = new Date(Date.now() - 90 * 60_000);
      const end = new Date(Date.now() - 30 * 60_000);
      const pastCourt = await createTestCourt(svc, 'INTEG0071-PAST');
      const { data, error } = await svc
        .from('reservations')
        .insert({
          court_id: pastCourt,
          kind: 'booking',
          status: 'confirmed',
          start_at: start.toISOString(),
          end_at: end.toISOString(),
          guest_name: 'Absent Guest',
          source: 'desk',
        })
        .select('id')
        .single();
      if (error) throw new Error(`past booking insert: ${error.message}`);
      const id = (data as { id: string }).id;

      const res = await appRpc(desk, 'mark_reservation', {
        p_reservation_id: id,
        p_status: 'no_show',
        p_reason: 'customer_request',
      }).then(outcome);

      expect(res.ok).toBe(true);
      expect((res.data as { status: string }).status).toBe('no_show');
    });

    it('the legitimate path is still open: a future booking can be cancelled', async () => {
      // SEC-11 removes a way to free a slot silently. It must not remove the
      // audited way to free one — otherwise the desk has no verb for "this is
      // not going to happen" and staff route around the rule.
      const b = await deskBooking(60);
      const res = await appRpc(desk, 'cancel_reservation', {
        p_reservation_id: b.id,
        p_reason: 'customer_request',
      }).then(outcome);
      expect(res.ok).toBe(true);

      const rebooked = await appRpc(desk, 'staff_create_reservation', {
        p_court_id: courtId,
        p_kind: 'booking',
        p_start_at: b.slot.start.toISOString(),
        p_end_at: b.slot.plus(60).toISOString(),
        p_guest_name: 'Legitimate Rebook',
      }).then(outcome);
      expect(rebooked.ok).toBe(true);
    });
  });
});
