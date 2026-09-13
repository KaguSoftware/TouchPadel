/**
 * 0093 — Courts analytics (five owner-only jsonb RPCs + app.analytics_open_cells).
 *
 * Seeds a known fixture through the real RPCs on two fresh courts and asserts
 * the guards, the shapes and the arithmetic against raw rows the service role
 * can read. Every court-filtered figure is exact; venue-wide calls are smoke
 * runs over whatever residue the shared stack holds, plus the anonymity sweep.
 *
 * Court A carries the story:
 *   D1  desk booking, 90 min, 4 players, a phone identity        (live)
 *   D2  desk booking, 60 min, 4 players, the SAME phone          (live, returning)
 *   M1  mobile hold confirmed by an account guest, 2 players     (live)
 *   H1  mobile hold left to expire (service-role update)          (hold funnel)
 *   C1  desk booking cancelled by staff a week ahead              (cancellation)
 *   N1  desk booking backdated a day, marked no_show              (no-show)
 *   X1  desk booking backdated two days, marked completed, with a
 *       linked cafe tab settled in cash                           (live, attach)
 * Court B carries one plain desk booking so the court filter has something to
 * exclude. One walk-in cafe tab (no reservation) proves unlinked orders stay
 * out of the attach figures and in all_orders_total.
 *
 * Venue timezone is Asia/Baghdad (UTC+3, no DST); futureSlot() gives each
 * booking its own local hour on the same future day.
 *
 * Runs against the live local stack; skips itself when the stack is down.
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
  testIdemKey,
  outcome,
  SEED_STAFF,
  createTestCourt,
  createTestMenuItem,
  createTestCafeTable,
  ensureTestRateRule,
  ensureOpenDay,
  ensureTillFresh,
  futureSlot,
} from './helpers';

const up = await stackAvailable();

const FNS = [
  'analytics_courts_summary',
  'analytics_courts_demand',
  'analytics_courts_endings',
  'analytics_courts_guests',
  'analytics_courts_cafe',
] as const;

/** The SEC-29 key patterns (scripts/check-analytics-payload.mjs), verbatim. */
const FORBIDDEN_KEYS = [
  /guest_id/i, /guest_name/i, /guest_phone/i,
  /customer_id/i, /customer_name/i, /customer_phone/i,
  /profile_id/i, /auth_user_id/i, /\bphone\b/i, /email/i, /full_name/i,
  /\buser_id\b/i, /session_id/i, /device_id/i,
];

type Json = Record<string, unknown>;
type Row = { key: string; n: number; bookings_total: number };
type Cell = { dow: number; hour: number; booked_minutes: number; bookings: number };
type RawRes = {
  id: string; court_id: string; status: string; source: string; start_at: string; end_at: string;
  created_at: string; price_iqd: number | null; players: number | null; series_id: string | null;
};

const LOCAL_OFFSET_MS = 3 * 3_600_000; // Asia/Baghdad
const local = (at: string | Date | number) => new Date(new Date(at).getTime() + LOCAL_OFFSET_MS);
const cellOf = (at: string | Date | number) => ({ dow: local(at).getUTCDay(), hour: local(at).getUTCHours() });
const LIVE = new Set(['confirmed', 'arrived', 'completed']);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const shiftDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

function walkKeys(v: unknown, out: string[]): void {
  if (Array.isArray(v)) v.forEach((x) => walkKeys(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Json)) {
      out.push(k);
      walkKeys(x, out);
    }
  }
}

function leadBucket(minutes: number): string {
  if (minutes < 120) return 'lt2h';
  if (minutes < 360) return '2_6h';
  if (minutes < 1440) return '6_24h';
  if (minutes < 4320) return '1_3d';
  if (minutes < 10080) return '3_7d';
  return '7d_plus';
}

describe.skipIf(!up)('0093 courts analytics', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let desk: SupabaseClient;
  let guest: SupabaseClient; // an account guest (mobile)
  let anon: SupabaseClient; // a cafe guest with no role at all

  let courtA: string;
  let courtB: string;
  let guestUid: string;
  let phone: string;
  let ids: { D1: string; D2: string; M1: string; H1: string; C1: string; N1: string; X1: string; B1: string };
  let tab: { id: string; total_iqd: number; court_iqd: number };
  let item: Awaited<ReturnType<typeof createTestMenuItem>>;
  let from: string;
  let to: string;

  const NAME_DESK = 'Courts Desk Guest';
  const NAME_WALKIN = 'Courts Walk-in';
  const ITEM_PRICE = 7_000;

  const call = (c: SupabaseClient, fn: string, court?: string | null) =>
    appRpc(c, fn, { p_from: from, p_to: to, ...(court === undefined ? {} : { p_court_id: court }) }).then(outcome);
  const ownerData = async <T = Json>(fn: string, court?: string | null): Promise<T> => {
    const res = await call(owner, fn, court);
    if (!res.ok) throw new Error(`${fn}: ${res.errorMessage}`);
    return res.data as T;
  };

  async function deskBooking(court: string, minutes: number, extra: Record<string, unknown>): Promise<string> {
    const slot = futureSlot();
    const res = await appRpc(desk, 'staff_create_reservation', {
      p_court_id: court,
      p_kind: 'booking',
      p_start_at: slot.start.toISOString(),
      p_end_at: slot.plus(minutes).toISOString(),
      p_idempotency_key: testIdemKey('reservation.create'),
      ...extra,
    }).then(outcome);
    if (!res.ok) throw new Error(`seed desk booking failed: ${res.errorMessage}`);
    // futureSlot() hands out consecutive hours; a longer booking must not run into the next one.
    for (let extra = minutes - 60; extra > 0; extra -= 60) futureSlot();
    return (res.data as { reservation_id: string }).reservation_id;
  }

  async function guestHold(court: string): Promise<string> {
    const slot = futureSlot();
    const res = await appRpc(guest, 'hold_slot', {
      p_court_id: court,
      p_start_at: slot.start.toISOString(),
      p_duration_min: 60,
    }).then(outcome);
    if (!res.ok) throw new Error(`seed hold failed: ${res.errorMessage}`);
    return (res.data as { reservation_id: string }).reservation_id;
  }

  /** Move a confirmed booking into the past so mark_reservation accepts no_show / completed (no-show.test.ts recipe). */
  async function backdate(id: string, hoursAgo: number): Promise<void> {
    // On the hour, like every real slot, so the heatmap split stays in whole minutes.
    const start = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - hoursAgo * 3_600_000);
    const { error } = await svc
      .from('reservations')
      .update({ start_at: start.toISOString(), end_at: new Date(start.getTime() + 60 * 60_000).toISOString() })
      .eq('id', id);
    if (error) throw new Error(`backdate failed: ${error.message}`);
  }

  async function rawRows(court: string): Promise<RawRes[]> {
    const { data, error } = await svc
      .from('reservations')
      .select('id, court_id, status, source, start_at, end_at, created_at, price_iqd, players, series_id')
      .eq('court_id', court)
      .eq('kind', 'booking');
    if (error) throw new Error(error.message);
    return data as RawRes[];
  }

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    desk = await signedInClient(SEED_STAFF.court_desk);
    guest = await guestClient(svc, 'courts');
    anon = await anonymousSessionClient();
    guestUid = (await guest.auth.getUser()).data.user!.id;

    await ensureTillFresh(svc);
    await ensureOpenDay(manager, svc);
    await ensureTestRateRule(svc);
    courtA = await createTestCourt(svc, `Courts A ${Date.now()}`);
    courtB = await createTestCourt(svc, `Courts B ${Date.now()}`);
    // A phone nobody else on this stack has used, so the identity is new on every run.
    phone = `+96477${Date.now().toString().slice(-8)}`;

    const D1 = await deskBooking(courtA, 90, { p_guest_name: NAME_DESK, p_guest_phone: phone, p_players: 4 });
    const D2 = await deskBooking(courtA, 60, { p_guest_name: NAME_DESK, p_guest_phone: phone, p_players: 4 });

    const M1 = await guestHold(courtA);
    const confirmed = await appRpc(guest, 'confirm_booking', { p_hold_id: M1, p_players: 2 }).then(outcome);
    if (!confirmed.ok) throw new Error(`seed confirm failed: ${confirmed.errorMessage}`);

    const H1 = await guestHold(courtA);
    const expired = await svc.from('reservations').update({ status: 'expired' }).eq('id', H1);
    if (expired.error) throw new Error(`seed expire failed: ${expired.error.message}`);

    const C1 = await deskBooking(courtA, 60, { p_guest_name: NAME_WALKIN });
    const cancelled = await appRpc(desk, 'cancel_reservation', { p_reservation_id: C1, p_reason: 'staff_op' }).then(outcome);
    if (!cancelled.ok) throw new Error(`seed cancel failed: ${cancelled.errorMessage}`);

    const N1 = await deskBooking(courtA, 60, { p_guest_name: NAME_WALKIN });
    await backdate(N1, 26);
    const noShow = await appRpc(desk, 'mark_reservation', { p_reservation_id: N1, p_status: 'no_show', p_reason: 'guest_no_show' }).then(outcome);
    if (!noShow.ok) throw new Error(`seed no_show failed: ${noShow.errorMessage}`);

    const X1 = await deskBooking(courtA, 60, { p_guest_name: NAME_WALKIN });
    await backdate(X1, 50);
    const done = await appRpc(desk, 'mark_reservation', { p_reservation_id: X1, p_status: 'completed', p_reason: 'staff_op' }).then(outcome);
    if (!done.ok) throw new Error(`seed completed failed: ${done.errorMessage}`);

    const B1 = await deskBooking(courtB, 60, { p_guest_name: NAME_WALKIN });
    ids = { D1, D2, M1, H1, C1, N1, X1, B1 };

    // Cafe: one tab linked to X1 (two of the item, settled in cash) and one walk-in tab.
    item = await createTestMenuItem(svc, 'courts', ITEM_PRICE);
    const opened = await appRpc(cashier, 'open_tab', {
      p_reservation_id: X1,
      p_label: 'courts-linked',
      p_idempotency_key: testIdemKey('tab.open'),
    }).then(outcome);
    if (!opened.ok) throw new Error(`seed open_tab failed: ${opened.errorMessage}`);
    const tabId = (opened.data as { tab_id: string }).tab_id;
    const added = await appRpc(cashier, 'till_add_items', {
      p_tab_id: tabId,
      p_items: [{ variant_id: item.variantId, qty: 2 }],
      p_idempotency_key: testIdemKey('order.add_items'),
    }).then(outcome);
    if (!added.ok) throw new Error(`seed till_add_items failed: ${added.errorMessage}`);
    const settled = await appRpc(cashier, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'cash',
      p_tendered_iqd: 500_000,
      p_idempotency_key: testIdemKey('payment.record'),
    }).then(outcome);
    if (!settled.ok) throw new Error(`seed settle_tab failed: ${settled.errorMessage}`);
    const { data: t } = await svc.from('tabs').select('id, total_iqd, court_iqd').eq('id', tabId).single();
    tab = t as typeof tab;

    const walkIn = await appRpc(cashier, 'open_tab', {
      p_table_id: await createTestCafeTable(svc, 'courts'),
      p_label: 'courts-walk-in',
      p_idempotency_key: testIdemKey('tab.open'),
    }).then(outcome);
    if (!walkIn.ok) throw new Error(`seed walk-in open_tab failed: ${walkIn.errorMessage}`);
    const walkInId = (walkIn.data as { tab_id: string }).tab_id;
    const walkInItems = await appRpc(cashier, 'till_add_items', {
      p_tab_id: walkInId,
      p_items: [{ variant_id: item.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.add_items'),
    }).then(outcome);
    if (!walkInItems.ok) throw new Error(`seed walk-in items failed: ${walkInItems.errorMessage}`);
    const walkInSettled = await appRpc(cashier, 'settle_tab', {
      p_tab_id: walkInId,
      p_method: 'cash',
      p_tendered_iqd: 100_000,
      p_idempotency_key: testIdemKey('payment.record'),
    }).then(outcome);
    if (!walkInSettled.ok) throw new Error(`seed walk-in settle failed: ${walkInSettled.errorMessage}`);

    // A range that holds the backdated rows (two days back) and the future slots (a week or two out).
    from = iso(shiftDays(new Date(), -5));
    to = iso(shiftDays(new Date(), 30));
  });

  afterAll(async () => {
    await Promise.all([owner, manager, cashier, desk, guest, anon].map((c) => c?.auth.signOut()));
  });

  // -------------------------------------------------------------------------
  // Guards and arguments
  // -------------------------------------------------------------------------
  it('refuses a cafe guest, an account guest, a cashier and a manager; admits the owner; guard before arguments', async () => {
    for (const fn of FNS) {
      for (const [who, c] of [['anon', anon], ['guest', guest], ['cashier', cashier], ['manager', manager]] as const) {
        const r = await call(c, fn);
        expect(r.ok, `${fn} as ${who}`).toBe(false);
        expect(r.errorMessage, `${fn} as ${who}`).toContain('FORBIDDEN');
      }
      const nulls = await appRpc(anon, fn, { p_from: null, p_to: null, p_court_id: null }).then(outcome);
      expect(nulls.errorMessage, `${fn} as guest with nulls`).toContain('FORBIDDEN');
      const o = await call(owner, fn);
      expect(o.ok, `${fn} as owner: ${o.errorMessage}`).toBe(true);
    }
  });

  it('INVALID_RANGE on an inverted range and on 401 days; the helper is not client-callable', async () => {
    for (const fn of FNS) {
      const inverted = await appRpc(owner, fn, { p_from: to, p_to: from }).then(outcome);
      expect(inverted.errorMessage, fn).toContain('INVALID_RANGE');
      const tooLong = await appRpc(owner, fn, { p_from: '2020-01-01', p_to: '2021-02-05' }).then(outcome);
      expect(tooLong.errorMessage, fn).toContain('INVALID_RANGE');
      const maxOk = await appRpc(owner, fn, { p_from: '2020-01-01', p_to: '2021-02-04' }).then(outcome);
      expect(maxOk.ok, `${fn} at 400 days: ${maxOk.errorMessage}`).toBe(true);
    }
    const helper = await appRpc(owner, 'analytics_open_cells', {
      p_ts_from: new Date().toISOString(), p_ts_to: new Date().toISOString(), p_tz: 'Asia/Baghdad',
    });
    expect(helper.error?.message).toMatch(/permission denied|not find/i);
  });

  it('p_court_id narrows every surface; an unknown court is empty, a malformed one is refused', async () => {
    const a = await ownerData<{ courts_count: number; per_court: { court_id: string }[]; kpis: { bookings: number } }>('analytics_courts_summary', courtA);
    expect(a.courts_count).toBe(1);
    expect(a.per_court.map((c) => c.court_id)).toEqual([courtA]);
    const b = await ownerData<{ courts_count: number; per_court: { court_id: string }[]; kpis: { bookings: number } }>('analytics_courts_summary', courtB);
    expect(b.per_court.map((c) => c.court_id)).toEqual([courtB]);
    expect(b.kpis.bookings).toBe(1);

    const none = '00000000-0000-4000-8000-000000000000';
    const s = await ownerData<{ courts_count: number; per_court: unknown[]; kpis: { bookings: number; booked_total: number } }>('analytics_courts_summary', none);
    expect(s.courts_count).toBe(0);
    expect(s.per_court).toEqual([]);
    expect(s.kpis.booked_total).toBe(0);
    const d = await ownerData<{ durations: unknown[]; hold_funnel: { holds_ended: number; conversion_pct: number | null } }>('analytics_courts_demand', none);
    expect(d.durations).toEqual([]);
    expect(d.hold_funnel).toMatchObject({ holds_ended: 0, conversion_pct: null });
    const e = await ownerData<{ cancellations: { total: number; by_court: unknown[] } }>('analytics_courts_endings', none);
    expect(e.cancellations.total).toBe(0);
    expect(e.cancellations.by_court).toEqual([]);
    const g = await ownerData<{ identities: number; returning_pct: number | null }>('analytics_courts_guests', none);
    expect(g.identities).toBe(0);
    expect(g.returning_pct).toBeNull();
    const c = await ownerData<{ attach: { live_bookings: number; attach_pct: number | null }; per_court: unknown[] }>('analytics_courts_cafe', none);
    expect(c.attach).toMatchObject({ live_bookings: 0, attach_pct: null });
    expect(c.per_court).toEqual([]);

    const malformed = await appRpc(owner, 'analytics_courts_summary', { p_from: from, p_to: to, p_court_id: 'not-a-uuid' }).then(outcome);
    expect(malformed.ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  it('summary: KPIs and the per-court row reconcile with raw rows; rates use booked_total', async () => {
    const s = await ownerData<{
      range: { from: string; to: string }; courts_count: number; open_minutes: number;
      kpis: Record<string, number | null>; per_court: Record<string, number | string | null>[];
      by_day: { business_date: string; closed: boolean; bookings: number }[];
    }>('analytics_courts_summary', courtA);
    const rows = await rawRows(courtA);
    const live = rows.filter((r) => LIVE.has(r.status));
    const revenue = live.reduce((acc, r) => acc + Number(r.price_iqd ?? 0), 0);
    const minutes = live.reduce((acc, r) => acc + (new Date(r.end_at).getTime() - new Date(r.start_at).getTime()) / 60_000, 0);

    expect(s.range).toEqual({ from, to });
    expect(live).toHaveLength(4);
    expect(minutes).toBe(270);
    expect(Object.keys(s.kpis).sort()).toEqual([
      'booked_minutes', 'booked_total', 'booking_days', 'bookings', 'cancellation_rate_pct', 'cancellations',
      'desk_bookings', 'holds_expired', 'mobile_bookings', 'no_show_rate_pct', 'no_shows', 'occupancy_pct',
      'price_per_booked_hour_iqd', 'rev_per_open_hour_iqd', 'revenue_iqd',
    ]);
    expect(s.kpis).toMatchObject({
      bookings: 4, booked_minutes: 270, revenue_iqd: revenue, cancellations: 1, no_shows: 1, booked_total: 6,
      cancellation_rate_pct: 16.7, no_show_rate_pct: 16.7, mobile_bookings: 1, desk_bookings: 3, holds_expired: 1,
      price_per_booked_hour_iqd: Math.round((revenue * 60) / 270),
    });
    expect(s.kpis.booking_days).toBeGreaterThanOrEqual(2); // the future day and the backdated one(s)
    expect(s.open_minutes).toBeGreaterThan(0);
    expect(s.kpis.occupancy_pct).toBe(Number(((270 * 100) / s.open_minutes).toFixed(1)));
    expect(s.kpis.rev_per_open_hour_iqd).toBe(Math.round((revenue * 60) / s.open_minutes));

    const pc = s.per_court[0]!;
    expect(Object.keys(pc).sort()).toEqual([
      'avg_duration_min', 'booked_minutes', 'booked_total', 'bookings', 'cancellation_rate_pct', 'cancellations',
      'court_id', 'desk_bookings', 'is_active', 'mobile_bookings', 'name_ar', 'name_en', 'no_show_rate_pct', 'no_shows',
      'occupancy_pct', 'open_minutes', 'players_avg', 'players_known', 'rev_per_open_hour_iqd', 'revenue_iqd',
    ]);
    expect(pc).toMatchObject({
      court_id: courtA, is_active: true, bookings: 4, booked_minutes: 270, open_minutes: s.open_minutes,
      revenue_iqd: revenue, cancellations: 1, no_shows: 1, booked_total: 6, mobile_bookings: 1, desk_bookings: 3,
      avg_duration_min: 67.5, players_known: 3, players_avg: 3.33,
    });

    // by_day: one row per calendar day of the range, zeros kept, no open-day flagged closed.
    const days = (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000 + 1;
    expect(s.by_day).toHaveLength(days);
    expect(s.by_day[0]!.business_date).toBe(from);
    expect(s.by_day.reduce((acc, d) => acc + d.bookings, 0)).toBe(4);
    expect(s.by_day.some((d) => d.closed)).toBe(false);
  });

  it('summary: the heatmap splits a 90-minute booking across two hour cells and keeps open cells', async () => {
    const s = await ownerData<{ heatmap: Cell[] }>('analytics_courts_summary', courtA);
    const rows = await rawRows(courtA);

    // Expected minutes per (dow, hour) from the raw rows, split at each local hour boundary.
    const expected = new Map<string, number>();
    const starts = new Map<string, number>();
    for (const r of rows.filter((x) => LIVE.has(x.status))) {
      const sc = cellOf(r.start_at);
      starts.set(`${sc.dow}:${sc.hour}`, (starts.get(`${sc.dow}:${sc.hour}`) ?? 0) + 1);
      let t = new Date(r.start_at).getTime();
      const end = new Date(r.end_at).getTime();
      while (t < end) {
        const next = Math.floor(local(t).getTime() / 3_600_000 + 1) * 3_600_000 - LOCAL_OFFSET_MS;
        const c = cellOf(t);
        expected.set(`${c.dow}:${c.hour}`, (expected.get(`${c.dow}:${c.hour}`) ?? 0) + (Math.min(end, next) - t) / 60_000);
        t = next;
      }
    }
    const byKey = new Map(s.heatmap.map((c) => [`${c.dow}:${c.hour}`, c]));
    for (const [k, mins] of expected) expect(byKey.get(k)?.booked_minutes, `cell ${k}`).toBe(Math.round(mins));
    for (const [k, n] of starts) expect(byKey.get(k)?.bookings, `cell ${k} starts`).toBe(n);
    for (const c of s.heatmap) {
      if (!expected.has(`${c.dow}:${c.hour}`)) expect(c.booked_minutes, `cell ${c.dow}:${c.hour}`).toBe(0);
    }

    // D1 is 90 minutes on the hour: 60 in its start cell, the other 30 spill into the next hour.
    const { data: d1 } = await svc.from('reservations').select('start_at, end_at').eq('id', ids.D1).single();
    const c0 = cellOf((d1 as { start_at: string }).start_at);
    const c1 = cellOf(new Date(new Date((d1 as { start_at: string }).start_at).getTime() + 60 * 60_000));
    expect(byKey.get(`${c0.dow}:${c0.hour}`)!.booked_minutes).toBeGreaterThanOrEqual(60);
    expect(byKey.get(`${c1.dow}:${c1.hour}`)!.booked_minutes).toBeGreaterThanOrEqual(30);
    expect(expected.get(`${c1.dow}:${c1.hour}`)! % 60).toBe(30);

    // Open cells with nothing booked are present too (the venue opens 09:00-02:00 every day).
    expect(s.heatmap.some((c) => c.booked_minutes === 0 && (c as unknown as { open_minutes: number }).open_minutes > 0)).toBe(true);
    for (const c of s.heatmap) {
      expect(Object.keys(c).sort()).toEqual([
        'booked_minutes', 'bookings', 'cancellations', 'dow', 'holds_expired', 'hour', 'no_shows', 'open_days', 'open_minutes', 'revenue_iqd',
      ]);
    }
  });

  // -------------------------------------------------------------------------
  // Demand
  // -------------------------------------------------------------------------
  it('demand: durations, lead-time buckets, sources, the mobile hold funnel, players incl. unknown, series', async () => {
    const d = await ownerData<{
      durations: { duration_min: number; bookings: number; booked_minutes: number; revenue_iqd: number; revenue_per_hour_iqd: number | null }[];
      lead_time: { median_min: number | null; buckets: { bucket: string; bookings: number; mobile: number; desk: number }[] };
      created_hour: { hour: number; bookings: number }[];
      created_dow: { dow: number; bookings: number }[];
      sources: { source: string; bookings: number; cancellations: number; no_shows: number; avg_duration_min: number | null }[];
      hold_funnel: { holds_ended: number; converted: number; pending: number; conversion_pct: number | null };
      players: { known: number; unknown: number; avg: number | null; rows: { players: number | null; bookings: number; mobile: number; desk: number }[] };
      players_by_court: { court_id: string; players: number | null; bookings: number }[];
      series: { series_bookings: number; single_bookings: number; series_pct: number | null; series_revenue_iqd: number };
    }>('analytics_courts_demand', courtA);
    const rows = await rawRows(courtA);
    const live = rows.filter((r) => LIVE.has(r.status));

    expect(d.durations.map((x) => [x.duration_min, x.bookings, x.booked_minutes])).toEqual([[60, 3, 180], [90, 1, 90]]);
    for (const x of d.durations) expect(x.revenue_per_hour_iqd).toBe(Math.round((x.revenue_iqd * 60) / x.booked_minutes));

    // Lead time: computed from the raw rows, so the assertion holds whatever the clock says.
    const want = new Map<string, { n: number; mobile: number; desk: number }>();
    for (const r of live.filter((x) => x.series_id === null)) {
      const b = leadBucket((new Date(r.start_at).getTime() - new Date(r.created_at).getTime()) / 60_000);
      const w = want.get(b) ?? { n: 0, mobile: 0, desk: 0 };
      w.n += 1;
      if (r.source === 'mobile') w.mobile += 1; else w.desk += 1;
      want.set(b, w);
    }
    expect(d.lead_time.buckets.map((b) => b.bucket)).toEqual(['lt2h', '2_6h', '6_24h', '1_3d', '3_7d', '7d_plus']);
    for (const b of d.lead_time.buckets) {
      const w = want.get(b.bucket) ?? { n: 0, mobile: 0, desk: 0 };
      expect([b.bookings, b.mobile, b.desk], b.bucket).toEqual([w.n, w.mobile, w.desk]);
    }
    expect(want.get('lt2h')!.n).toBe(1); // X1 was backdated, so it "started" before it was created
    expect(d.lead_time.buckets.reduce((acc, b) => acc + b.bookings, 0)).toBe(4);
    expect(typeof d.lead_time.median_min).toBe('number');

    expect(d.created_hour).toHaveLength(24);
    expect(d.created_dow).toHaveLength(7);
    expect(d.created_hour.reduce((acc, h) => acc + h.bookings, 0)).toBe(4);
    expect(d.created_dow.reduce((acc, h) => acc + h.bookings, 0)).toBe(4);

    expect(d.sources.map((s) => s.source)).toEqual(['desk', 'mobile']);
    expect(d.sources[0]).toMatchObject({ source: 'desk', bookings: 3, cancellations: 1, no_shows: 1, avg_duration_min: 70 });
    expect(d.sources[1]).toMatchObject({ source: 'mobile', bookings: 1, cancellations: 0, no_shows: 0, avg_duration_min: 60 });

    expect(d.hold_funnel).toEqual({ holds_ended: 2, converted: 1, pending: 0, conversion_pct: 50 });

    expect(d.players).toMatchObject({ known: 3, unknown: 1, avg: 3.33 });
    expect(d.players.rows.map((r) => [r.players, r.bookings, r.mobile, r.desk])).toEqual([[2, 1, 1, 0], [4, 2, 0, 2], [null, 1, 0, 1]]);
    expect(d.players_by_court.map((r) => [r.court_id, r.players, r.bookings])).toEqual([[courtA, 2, 1], [courtA, 4, 2], [courtA, null, 1]]);

    expect(d.series).toEqual({ series_bookings: 0, single_bookings: 4, series_pct: 0, series_revenue_iqd: 0 });
  });

  // -------------------------------------------------------------------------
  // Endings
  // -------------------------------------------------------------------------
  it('endings: the staff cancellation lands in by_actor and by_notice; the no-show does not; segments carry booked_total', async () => {
    const e = await ownerData<{
      cancellations: {
        total: number; revenue_iqd: number; late_revenue_iqd: number; median_notice_min: number | null;
        by_notice: { bucket: string; n: number }[]; by_actor: { actor: string; n: number }[];
        by_hour: Row[]; by_dow: Row[]; by_court: (Row & { court_id: string; name_en: string; name_ar: string })[];
        by_source: Row[]; by_duration: Row[]; by_lead_time: Row[]; by_series: Row[]; by_type: Row[];
      };
      no_shows: {
        total: number; revenue_iqd: number; by_hour: Row[]; by_dow: Row[]; by_court: Row[]; by_source: Row[];
        by_duration: Row[]; by_lead_time: Row[]; by_series: Row[]; by_type: Row[]; by_players: Row[];
      };
    }>('analytics_courts_endings', courtA);
    const rows = await rawRows(courtA);
    const c1 = rows.find((r) => r.id === ids.C1)!;
    const n1 = rows.find((r) => r.id === ids.N1)!;

    expect(e.cancellations).toMatchObject({ total: 1, revenue_iqd: Number(c1.price_iqd), late_revenue_iqd: 0 });
    expect(e.cancellations.median_notice_min).toBeGreaterThan(3 * 1440);
    expect(e.cancellations.by_notice.map((b) => b.bucket)).toEqual(['after_start', 'lt2h', '2_6h', '6_24h', '1_3d', '3d_plus']);
    expect(e.cancellations.by_notice.map((b) => b.n)).toEqual([0, 0, 0, 0, 0, 1]);
    expect(e.cancellations.by_actor).toEqual([{ actor: 'guest', n: 0 }, { actor: 'staff', n: 1 }, { actor: 'unknown', n: 0 }]);

    const court = e.cancellations.by_court.find((r) => r.court_id === courtA)!;
    expect(court).toMatchObject({ key: courtA, n: 1, bookings_total: 6 });
    expect(typeof court.name_en).toBe('string');
    expect(typeof court.name_ar).toBe('string');
    expect(e.cancellations.by_source.find((r) => r.key === 'desk')).toEqual({ key: 'desk', n: 1, bookings_total: 5 });
    expect(e.cancellations.by_source.find((r) => r.key === 'mobile')).toEqual({ key: 'mobile', n: 0, bookings_total: 1 });
    expect(e.cancellations.by_series).toEqual([{ key: 'single', n: 1, bookings_total: 6 }]);
    expect(e.cancellations.by_duration.find((r) => r.key === '60')).toEqual({ key: '60', n: 1, bookings_total: 5 });
    expect(e.cancellations.by_duration.find((r) => r.key === '90')).toEqual({ key: '90', n: 0, bookings_total: 1 });
    expect(e.cancellations.by_type.map((r) => r.key)).toEqual(['returning', 'new', 'unidentified']);
    expect(e.cancellations.by_type).toEqual([
      { key: 'returning', n: 0, bookings_total: 1 },
      { key: 'new', n: 0, bookings_total: 2 },
      { key: 'unidentified', n: 1, bookings_total: 3 },
    ]);
    const c1Cell = cellOf(c1.start_at);
    expect(e.cancellations.by_hour.find((r) => r.key === String(c1Cell.hour))).toMatchObject({ n: 1 });
    expect(e.cancellations.by_dow.find((r) => r.key === String(c1Cell.dow))!.n).toBe(1);
    expect(e.cancellations.by_lead_time.reduce((acc, r) => acc + r.bookings_total, 0)).toBe(6);
    expect(e.cancellations.by_hour.reduce((acc, r) => acc + r.bookings_total, 0)).toBe(6);

    expect(e.no_shows).toMatchObject({ total: 1, revenue_iqd: Number(n1.price_iqd) });
    expect(e.no_shows.by_players).toEqual([
      { key: '2', n: 0, bookings_total: 1 },
      { key: '4', n: 0, bookings_total: 2 },
      { key: 'unknown', n: 1, bookings_total: 3 },
    ]);
    expect(e.no_shows.by_type.find((r) => r.key === 'unidentified')).toEqual({ key: 'unidentified', n: 1, bookings_total: 3 });
    expect(e.no_shows.by_source.find((r) => r.key === 'desk')!.n).toBe(1);
    expect((e.no_shows as unknown as Json).by_notice).toBeUndefined();
    expect(e.cancellations.by_notice.reduce((acc, b) => acc + b.n, 0)).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Guests
  // -------------------------------------------------------------------------
  it('guests: two identities, one returning booking, visit buckets, weeks; nothing identifying leaves', async () => {
    const g = await ownerData<{
      lookback_days: number; regular_window_days: number; lapse_days: number;
      identified_bookings: number; unidentified_bookings: number; identities: number;
      returning_bookings: number; new_bookings: number; returning_pct: number | null;
      visit_buckets: { bucket: string; identities: number; bookings: number }[];
      regulars: number; lapsing_regulars: number; regulars_bookings_pct: number | null; regulars_fixed_slot_pct: number | null;
      by_week: { week_start: string; new_identities: number; returning_identities: number; bookings: number }[];
    }>('analytics_courts_guests', courtA);

    expect(g).toMatchObject({
      lookback_days: 180, regular_window_days: 90, lapse_days: 28,
      identified_bookings: 3, unidentified_bookings: 1, identities: 2,
      returning_bookings: 1, new_bookings: 2, returning_pct: 33.3,
      regulars: 0, lapsing_regulars: 0, regulars_bookings_pct: 0, regulars_fixed_slot_pct: null,
    });
    expect(g.visit_buckets).toEqual([
      { bucket: '1', identities: 1, bookings: 1 },
      { bucket: '2_3', identities: 1, bookings: 2 },
      { bucket: '4_6', identities: 0, bookings: 0 },
      { bucket: '7_plus', identities: 0, bookings: 0 },
    ]);
    expect(g.by_week.reduce((acc, w) => acc + w.bookings, 0)).toBe(4);
    expect(g.by_week.reduce((acc, w) => acc + w.new_identities, 0)).toBe(2);
    expect(g.by_week.reduce((acc, w) => acc + w.returning_identities, 0)).toBeLessThanOrEqual(1);
    for (const w of g.by_week) expect(new Date(`${w.week_start}T00:00:00Z`).getUTCDay()).toBe(1); // ISO weeks start Monday
  });

  // -------------------------------------------------------------------------
  // Cafe
  // -------------------------------------------------------------------------
  it('cafe: attach 1 of 4, cafe money is the tab total less the court fee, timing bucket, top item, walk-in excluded', async () => {
    const c = await ownerData<{
      attach: Record<string, number | null>;
      per_court: Record<string, unknown>[];
      top_items: { court_id: string; item_id: string; name_en: string; name_ar: string; qty: number; revenue_iqd: number; linked_orders_with_item: number }[];
      items: { item_id: string; linked_orders_with_item: number; all_orders_with_item: number }[];
      linked_orders_total: number; all_orders_total: number;
      order_timing: { median_offset_min: number | null; buckets: { bucket: string; orders: number; revenue_iqd: number }[] };
      attach_cells: { dow: number; hour: number; live_bookings: number; linked_bookings: number }[];
      by_players: { players: number | null; bookings: number; linked: number; cafe_iqd: number }[];
      by_duration: { duration_min: number; bookings: number; linked: number; cafe_iqd: number }[];
    }>('analytics_courts_cafe', courtA);
    const rows = await rawRows(courtA);
    const live = rows.filter((r) => LIVE.has(r.status));
    const courtIqd = live.reduce((acc, r) => acc + Number(r.price_iqd ?? 0), 0);
    const cafeIqd = Number(tab.total_iqd) - Number(tab.court_iqd);
    expect(cafeIqd).toBe(2 * ITEM_PRICE);

    expect(Object.keys(c.attach).sort()).toEqual([
      'attach_pct', 'booked_minutes', 'cafe_iqd', 'cafe_per_booking_iqd', 'cafe_per_linked_iqd', 'combined_per_booked_hour_iqd',
      'combined_per_open_hour_iqd', 'court_iqd', 'linked_bookings', 'live_bookings', 'open_minutes', 'settled_linked',
    ]);
    expect(c.attach).toMatchObject({
      live_bookings: 4, linked_bookings: 1, attach_pct: 25, settled_linked: 1, cafe_iqd: cafeIqd,
      cafe_per_linked_iqd: cafeIqd, cafe_per_booking_iqd: Math.round(cafeIqd / 4), court_iqd: courtIqd, booked_minutes: 270,
      combined_per_booked_hour_iqd: Math.round(((courtIqd + cafeIqd) * 60) / 270),
    });
    expect(c.attach.open_minutes).toBeGreaterThan(0);
    expect(c.attach.combined_per_open_hour_iqd).toBe(Math.round(((courtIqd + cafeIqd) * 60) / c.attach.open_minutes!));
    expect(c.per_court).toHaveLength(1);
    expect(c.per_court[0]).toMatchObject({ court_id: courtA, live_bookings: 4, linked_bookings: 1, cafe_iqd: cafeIqd, open_minutes: c.attach.open_minutes });

    expect(c.top_items).toEqual([{
      court_id: courtA, item_id: item.itemId, name_en: expect.any(String), name_ar: expect.any(String),
      qty: 2, revenue_iqd: 2 * ITEM_PRICE, linked_orders_with_item: 1,
    }]);
    const it = c.items.find((i) => i.item_id === item.itemId)!;
    expect(it.linked_orders_with_item).toBe(1);
    expect(it.all_orders_with_item).toBeGreaterThanOrEqual(2); // the linked order and the walk-in
    expect(c.linked_orders_total).toBe(1);
    expect(c.all_orders_total).toBeGreaterThanOrEqual(2);

    // X1 ended two days ago and the order was placed now: after_30plus, and the median offset says so.
    expect(c.order_timing.buckets.map((b) => b.bucket)).toEqual(['before_30plus', 'before_0_30', 'first_half', 'second_half', 'after_0_30', 'after_30plus']);
    expect(c.order_timing.buckets.map((b) => [b.orders, b.revenue_iqd])).toEqual([[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [1, 2 * ITEM_PRICE]]);
    expect(c.order_timing.median_offset_min).toBeGreaterThan(48 * 60);

    expect(c.attach_cells.reduce((acc, x) => acc + x.live_bookings, 0)).toBe(4);
    expect(c.attach_cells.reduce((acc, x) => acc + x.linked_bookings, 0)).toBe(1);
    expect(c.by_players).toEqual([
      { players: 2, bookings: 1, linked: 0, cafe_iqd: 0 },
      { players: 4, bookings: 2, linked: 0, cafe_iqd: 0 },
      { players: null, bookings: 1, linked: 1, cafe_iqd: cafeIqd },
    ]);
    expect(c.by_duration).toEqual([
      { duration_min: 60, bookings: 3, linked: 1, cafe_iqd: cafeIqd },
      { duration_min: 90, bookings: 1, linked: 0, cafe_iqd: 0 },
    ]);
  });

  // -------------------------------------------------------------------------
  // SEC-29: what leaves. Venue-wide, so every row on the stack is swept.
  // -------------------------------------------------------------------------
  it('anonymity: no seeded name, phone or account id and no identifying key in any payload', async () => {
    const canon = phone.replace(/^\+964/, '');
    for (const fn of FNS) {
      const data = await ownerData(fn);
      const text = JSON.stringify(data);
      expect(text, fn).not.toContain(NAME_DESK);
      expect(text, fn).not.toContain(NAME_WALKIN);
      expect(text, fn).not.toContain('Test Guest courts');
      expect(text, fn).not.toContain(phone);
      expect(text, fn).not.toContain(canon);
      expect(text, fn).not.toContain(guestUid);
      const keys: string[] = [];
      walkKeys(data, keys);
      const hits = keys.filter((k) => FORBIDDEN_KEYS.some((re) => re.test(k)));
      expect(hits, `${fn} keys`).toEqual([]);
      expect(keys.length, fn).toBeGreaterThan(10);
    }
  });
});
