/**
 * 0048 — the padel-audit findings, turned into a permanent regression net.
 *
 * Every case here is a reproduction from docs/design/padel-backend-audit-2026-08-27.md.
 * That document was report-only; these are the assertions that keep the fixes fixed.
 *
 *   C1  an anonymous session could hold a court under guest_id = NULL: blocking
 *       real guests, unconfirmable and uncancellable by its own creator, with no
 *       quota, no horizon and no audit trail.
 *   H1  move / extend never re-priced.
 *   H2  move / extend never re-validated against closed dates or opening hours.
 *   H3  an idempotency replay was looked up by key alone, so one principal could
 *       read another's reservation id + status through the RPC.
 *   H4  a midnight-crossing rate rule priced differently in SQL and @touch/core.
 *
 * Venue timezone is Asia/Baghdad (UTC+3, no DST since 2008), so local hour =
 * UTC hour + 3. Opening hours are 09:00-23:00 local.
 */
import { describe, it, expect, beforeAll } from 'vitest';
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
  futureSlot,
  testIdemKey,
  outcome,
  SEED_STAFF,
} from './helpers';

const up = await stackAvailable();

/** A date `days` out, at `utcHour` UTC (= utcHour + 3 venue-local). */
function at(days: number, utcHour: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(utcHour, 0, 0, 0);
  return d;
}

describe.skipIf(!up)('0048 booking hardening (padel audit C1, H1-H4)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let courtId: string;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    await ensureTestRateRule(svc);
    courtId = await createTestCourt(svc, 'H0048');
  });

  it('C1: an anonymous session cannot hold a court (ACCOUNT_REQUIRED)', async () => {
    const anon = await anonymousSessionClient();
    const slot = futureSlot();
    const res = await appRpc(anon, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: slot.start.toISOString(),
      p_duration_min: 60,
    }).then(outcome);

    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('ACCOUNT_REQUIRED');

    // and nothing was written: the orphan row IS the finding.
    const { data } = await svc
      .from('reservations')
      .select('id')
      .eq('court_id', courtId)
      .is('guest_id', null)
      .eq('kind', 'hold');
    expect(data ?? []).toHaveLength(0);
  });

  it('C1: a real account CAN hold, and the hold is audited', async () => {
    const guest = await guestClient(svc, 'c1-ok');
    const slot = futureSlot();
    const res = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: slot.start.toISOString(),
      p_duration_min: 60,
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);

    const id = (res.data as { reservation_id: string }).reservation_id;
    const { data } = await svc
      .from('audit_log')
      .select('action')
      .eq('entity', 'reservations')
      .eq('entity_id', id)
      .eq('action', 'reservation.hold');
    expect(data ?? []).toHaveLength(1);
  });

  it('C1: live holds are capped per account (HOLD_QUOTA_EXCEEDED)', async () => {
    const { data: vs } = await svc
      .from('venue_settings')
      .select('max_live_holds_per_guest')
      .single();
    const cap = (vs as { max_live_holds_per_guest: number }).max_live_holds_per_guest;
    expect(cap).toBeGreaterThan(0);

    const guest = await guestClient(svc, 'c1-quota');
    for (let i = 0; i < cap; i++) {
      const slot = futureSlot();
      const ok = await appRpc(guest, 'hold_slot', {
        p_court_id: courtId,
        p_start_at: slot.start.toISOString(),
        p_duration_min: 60,
      }).then(outcome);
      expect(ok.ok, `hold ${i + 1} of ${cap}: ${ok.errorMessage}`).toBe(true);
    }

    const slot = futureSlot();
    const over = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: slot.start.toISOString(),
      p_duration_min: 60,
    }).then(outcome);
    expect(over.ok).toBe(false);
    expect(over.errorMessage).toContain('HOLD_QUOTA_EXCEEDED');
  });

  it('C1: a slot beyond the booking horizon is refused (BEYOND_HORIZON)', async () => {
    const { data: vs } = await svc
      .from('venue_settings')
      .select('max_booking_horizon_days')
      .single();
    const horizon = (vs as { max_booking_horizon_days: number }).max_booking_horizon_days;
    expect(horizon).toBeGreaterThan(0);

    const guest = await guestClient(svc, 'c1-horizon');
    const res = await appRpc(guest, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: at(horizon + 10, 7).toISOString(),
      p_duration_min: 60,
    }).then(outcome);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('BEYOND_HORIZON');
  });

  it('H3: one account cannot replay another key, and learns nothing', async () => {
    const a = await guestClient(svc, 'h3-a');
    const b = await guestClient(svc, 'h3-b');
    const key = testIdemKey('reservation.hold');

    const slotA = futureSlot();
    const held = await appRpc(a, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: slotA.start.toISOString(),
      p_duration_min: 60,
      p_idempotency_key: key,
    }).then(outcome);
    expect(held.ok, held.errorMessage).toBe(true);
    const aId = (held.data as { reservation_id: string }).reservation_id;

    // B replays A's key against a DIFFERENT slot and duration.
    const slotB = futureSlot();
    const replay = await appRpc(b, 'hold_slot', {
      p_court_id: courtId,
      p_start_at: slotB.start.toISOString(),
      p_duration_min: 90,
      p_idempotency_key: key,
    }).then(outcome);

    expect(replay.ok).toBe(false);
    expect(replay.errorMessage).toContain('IDEMPOTENCY_CONFLICT');
    // The oracle was the leak, not the refusal: no id may appear in the error.
    expect(replay.errorMessage).not.toContain(aId);
  });

  it('H3: replaying your OWN key still returns the duplicate', async () => {
    const guest = await guestClient(svc, 'h3-own');
    const slot = futureSlot();
    const args = {
      p_court_id: courtId,
      p_start_at: slot.start.toISOString(),
      p_duration_min: 60,
      p_idempotency_key: testIdemKey('reservation.hold'),
    };
    const first = await appRpc(guest, 'hold_slot', args).then(outcome);
    const second = await appRpc(guest, 'hold_slot', args).then(outcome);

    expect(first.ok, first.errorMessage).toBe(true);
    expect(second.ok, second.errorMessage).toBe(true);
    expect(second.duplicate).toBe(true);
    expect((second.data as { reservation_id: string }).reservation_id).toBe(
      (first.data as { reservation_id: string }).reservation_id,
    );
  });

  it('H4: a midnight-crossing rate rule is refused at the RPC', async () => {
    const res = await appRpc(owner, 'upsert_rate_rule', {
      p_name: 'Overnight regression',
      p_days_of_week: [0, 1, 2, 3, 4, 5, 6],
      p_start_time: '22:00',
      p_end_time: '02:00',
      p_prices: { 60: 90000 },
    }).then(outcome);
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('INVALID_TIME_RANGE');
  });

  it('H4: the table constraint refuses it too, not just the RPC', async () => {
    const { error } = await svc.from('rate_rules').insert({
      name: 'Overnight direct',
      days_of_week: [1],
      start_time: '22:00',
      end_time: '02:00',
    });
    expect(error?.message ?? '').toContain('rate_rules_time_order');
  });

  it('H4: an ordinary window is still accepted', async () => {
    const res = await appRpc(owner, 'upsert_rate_rule', {
      p_name: `Evening regression ${Date.now()}`,
      p_days_of_week: [0, 1, 2, 3, 4, 5, 6],
      p_start_time: '20:00',
      p_end_time: '23:00',
      p_prices: { 60: 90000 },
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
  });
});

/**
 * H1 + H2 — the desk buttons. Both live on one click in DeskCalendar
 * (move at :680, extend at :627), so a mis-priced move is a daily event, not a
 * corner case.
 *
 * Pricing fixture: one court-specific rule per window, so a move ACROSS windows
 * must change the price and an extend ACROSS durations must too.
 *   cheap  09:00-12:00 local (06:00-09:00 UTC)  60m=30 000  120m=50 000
 *   dear   12:00-15:00 local (09:00-12:00 UTC)  60m=80 000  120m=140 000
 */
describe.skipIf(!up)('0048 desk re-pricing and re-validation (H1, H2)', () => {
  let svc: SupabaseClient;
  let desk: SupabaseClient;
  let courtId: string;

  const price = async (id: string) => {
    const { data } = await svc
      .from('reservations')
      .select('price_iqd, rate_rule_id')
      .eq('id', id)
      .single();
    return data as { price_iqd: number; rate_rule_id: string | null };
  };

  async function book(startUtc: Date, minutes = 60) {
    const res = await appRpc(desk, 'staff_create_reservation', {
      p_court_id: courtId,
      p_kind: 'booking',
      p_start_at: startUtc.toISOString(),
      p_end_at: new Date(startUtc.getTime() + minutes * 60_000).toISOString(),
      p_guest_name: 'Re-pricing Guest',
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    return (res.data as { reservation_id: string }).reservation_id;
  }

  beforeAll(async () => {
    svc = serviceClient();
    desk = await signedInClient(SEED_STAFF.court_desk);
    courtId = await createTestCourt(svc, 'H0048-PRICE');

    for (const r of [
      { name: 'H0048 cheap', start: '09:00', end: '12:00', p60: 30_000, p120: 50_000 },
      { name: 'H0048 dear', start: '12:00', end: '15:00', p60: 80_000, p120: 140_000 },
    ]) {
      const { data, error } = await svc
        .from('rate_rules')
        .insert({
          name: r.name,
          court_id: courtId,
          days_of_week: [0, 1, 2, 3, 4, 5, 6],
          start_time: r.start,
          end_time: r.end,
          priority: 500, // court-specific + high priority: always wins
          is_active: true,
        })
        .select('id')
        .single();
      if (error) throw new Error(`rate rule ${r.name}: ${error.message}`);
      const id = (data as { id: string }).id;
      const { error: pErr } = await svc.from('rate_rule_prices').insert([
        { rule_id: id, duration_min: 60, price_iqd: r.p60 },
        { rule_id: id, duration_min: 120, price_iqd: r.p120 },
      ]);
      if (pErr) throw new Error(`rate rule prices ${r.name}: ${pErr.message}`);
    }
  });

  it('H1: moving a booking across rate windows re-prices it', async () => {
    const id = await book(at(20, 7)); // 10:00 local -> cheap
    expect((await price(id)).price_iqd).toBe(30_000);

    const moved = await appRpc(desk, 'move_reservation', {
      p_reservation_id: id,
      p_start_at: at(20, 10).toISOString(), // 13:00 local -> dear
      p_end_at: at(20, 11).toISOString(),
    }).then(outcome);

    expect(moved.ok, moved.errorMessage).toBe(true);
    expect((moved.data as { price_iqd: number }).price_iqd).toBe(80_000);
    expect((await price(id)).price_iqd).toBe(80_000);
  });

  it('H1: extending a booking re-prices it for the new duration', async () => {
    const id = await book(at(21, 7)); // 10:00 local, 60m -> 30 000
    expect((await price(id)).price_iqd).toBe(30_000);

    const ext = await appRpc(desk, 'extend_reservation', {
      p_reservation_id: id,
      p_new_end_at: at(21, 9).toISOString(), // now 120m
    }).then(outcome);

    expect(ext.ok, ext.errorMessage).toBe(true);
    expect((ext.data as { price_iqd: number }).price_iqd).toBe(50_000);
  });

  it('H1: a manual price override is PRESERVED across a move, not re-priced away', async () => {
    const manager = await signedInClient(SEED_STAFF.manager);
    const start = at(22, 7);
    const res = await appRpc(manager, 'staff_create_reservation', {
      p_court_id: courtId,
      p_kind: 'booking',
      p_start_at: start.toISOString(),
      p_end_at: new Date(start.getTime() + 3_600_000).toISOString(),
      p_guest_name: 'Override Guest',
      p_price_override_iqd: 12_345,
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const id = (res.data as { reservation_id: string }).reservation_id;
    expect((await price(id)).price_iqd).toBe(12_345);

    const moved = await appRpc(desk, 'move_reservation', {
      p_reservation_id: id,
      p_start_at: at(22, 10).toISOString(), // into the dear window
      p_end_at: at(22, 11).toISOString(),
    }).then(outcome);

    expect(moved.ok, moved.errorMessage).toBe(true);
    expect((await price(id)).price_iqd).toBe(12_345);
  });

  it('H2: a move onto a closed date is refused', async () => {
    const id = await book(at(23, 7));
    const closed = at(24, 7).toISOString().slice(0, 10);
    const { error } = await svc
      .from('venue_settings')
      .update({ closed_dates: [closed] })
      .eq('id', true);
    expect(error).toBeNull();

    try {
      const moved = await appRpc(desk, 'move_reservation', {
        p_reservation_id: id,
        p_start_at: at(24, 7).toISOString(),
        p_end_at: at(24, 8).toISOString(),
      }).then(outcome);
      expect(moved.ok).toBe(false);
      expect(moved.errorMessage).toContain('CLOSED_DATE');
    } finally {
      await svc.from('venue_settings').update({ closed_dates: [] }).eq('id', true);
    }
  });

  it('H2: extending past closing time is refused', async () => {
    const id = await book(at(25, 16)); // 19:00 local
    // The venue now trades to 02:00, so 01:00 is INSIDE hours -- the extend has
    // to reach past 02:00 to be refused. 00:00 UTC on day 26 = 03:00 local,
    // inside the shut 02:00-09:00 band.
    const ext = await appRpc(desk, 'extend_reservation', {
      p_reservation_id: id,
      p_new_end_at: at(26, 0).toISOString(), // 03:00 local, next day
    }).then(outcome);
    expect(ext.ok).toBe(false);
    expect(ext.errorMessage).toContain('OUTSIDE_HOURS');
  });
});
