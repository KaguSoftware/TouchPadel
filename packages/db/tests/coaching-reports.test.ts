/**
 * Coaching, migration 0285 lesson_reports (docs/design/coaching/money.md §8, §10
 * coaching-reports.test.ts; build contracts C-18, C-28, C-31, CM-13, CM-14, CM-15, R27, R42, R71,
 * R72, R81).
 *
 *   * reports_figures: lessonRevenue and owedToCoaches; revenue = padel + café net + lessons (C-18);
 *   * panel_headline: the two keys last, every earlier position unchanged;
 *   * report_revenue: lessonIqd and owedToCoachesIqd per bucket equal to lesson_money_figures over
 *     the range; a payment-method filter keeps only the matching desk money and zeroes the accrual;
 *   * report_courts: lesson minutes in occupancy (CM-14), the lessons block (X25) with
 *     owedToCoachesIqd and no coachShareIqd (R72);
 *   * analytics_courts_summary: lesson minutes, and a lapsed lesson payment is not a lapsed hold;
 *   * day_close_online: the lessons block (X27); a desk refund made on a later day counts on that
 *     day, its till shift's (C-31, R27, R71);
 *   * report_lessons (X24): totals, byCoach summing to the totals, the fill rate;
 *   * sandbox lesson money adds 0 everywhere and is counted in sandboxExcluded (CM-15);
 *   * check:analytics passes with PERSON_MONEY_REPORTS (R42).
 *
 * Every figure is planted 30 months back, a month no other suite touches, so the expected numbers
 * are this suite's own. Coach shares through the @touch/core twin.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, KEEP, ok, scenario, T, X } from './stores-harness';
import { COURT, E, GUEST, PLANT } from './coaching-plant';
import { lessonCoachShare } from '../../core/src/coaching/statement';
import { COACHING_SHAPES, missingKeys } from '../../core/src/coaching/shapes';

const up = await stackAvailable();
const docker = up && dockerReachable();

const M = -30;
const at = (day: number, hour: number) => `pg_temp.at(${M}, ${day}, ${hour})`;

/** A completed lesson of c1 on day `day` 10:00-11:00, with its completed court row on court1. */
const DONE = (name: string, day: number, extra = `'{}'::jsonb`, courtRow = true) => [
  KEEP(
    name,
    `select pg_temp.lesson(jsonb_build_object('coach_id', {{c1}}, 'lesson_type_id', {{lt}},
    'status', 'completed', 'completed_at', ${at(day, 11)},
    'start_at', ${at(day, 10)}, 'end_at', ${at(day, 11)}) || ${extra})`,
  ),
  ...(courtRow ? [X(`select pg_temp.courtrow({{${name}}}, {{court1}}, 'completed')`)] : []),
];

const BASE = [
  PLANT,
  X(`select set_config('app.venue_id', {{venue}}, true)`),
  GUEST('gc'),
  KEEP('c1', `select pg_temp.coach({{gc}})`),
  KEEP('lt', `select pg_temp.ltype()`),
  KEEP(
    'lt_group',
    `select pg_temp.ltype('{"kind":"group","name_en":"Group","price_iqd":15000,"max_places":4,
    "min_places":1,"cutoff_hours":1}'::jsonb)`,
  ),
  COURT('court1'),
  KEEP('mf', `select pg_temp.mon(${M})::text`),
  KEEP('mt', `select (pg_temp.mon(${M + 1}) - 1)::text`),
  ...['g1', 'g2', 'g3', 'g4', 'g5'].map(GUEST),
  // p1: a private lesson paid online, 40,000.
  ...DONE('p1', 5),
  KEEP('p1e', `select pg_temp.genrol({{g1}}, jsonb_build_object('lesson_id', {{p1}}))`),
  X(`select pg_temp.paid({{p1e}}, null, jsonb_build_object('succeeded_at', ${at(5, 9)}))`),
  // gr: a group session, two places at 15,000 paid online, one of them a no-show (kept).
  KEEP(
    'gr',
    `select pg_temp.lesson(jsonb_build_object('kind', 'group', 'coach_id', {{c1}},
    'lesson_type_id', {{lt_group}}, 'price_iqd', 15000, 'max_places', 4, 'min_places', 1,
    'cutoff_at', ${at(6, 9)}, 'status', 'completed', 'completed_at', ${at(6, 11)},
    'start_at', ${at(6, 10)}, 'end_at', ${at(6, 11)}))`,
  ),
  X(`select pg_temp.courtrow({{gr}}, {{court1}}, 'completed')`),
  KEEP(
    'gre1',
    `select pg_temp.genrol({{g2}}, jsonb_build_object('lesson_id', {{gr}}, 'price_iqd', 15000))`,
  ),
  KEEP(
    'gre2',
    `select pg_temp.genrol({{g3}}, jsonb_build_object('lesson_id', {{gr}}, 'price_iqd', 15000))`,
  ),
  X(`select pg_temp.paid({{gre1}}, null, jsonb_build_object('succeeded_at', ${at(6, 8)}))`),
  X(`select pg_temp.paid({{gre2}}, null, jsonb_build_object('succeeded_at', ${at(6, 8)}))`),
  X(`select pg_temp.mark({{gr}}, {{gre2}}, 'no_show')`),
  // p4: a private lesson paid in the Qi sandbox (the App Review account): counts 0 (CM-15).
  ...DONE('p4', 9, `'{}'::jsonb`, false),
  KEEP('p4e', `select pg_temp.genrol({{g4}}, jsonb_build_object('lesson_id', {{p4}}))`),
  X(
    `select pg_temp.paid({{p4e}}, null, jsonb_build_object('sandbox', true, 'succeeded_at', ${at(9, 9)}))`,
  ),
  // p5: a private lesson paid at the desk on day 7 (40,000), 5,000 refunded on day 8 outside a
  // shift, 3,000 more on day 8 in a till shift of day 8.
  ...DONE('p5', 7),
  KEEP(
    'p5e',
    `select pg_temp.genrol({{g5}}, jsonb_build_object('lesson_id', {{p5}}, 'payment_mode', 'desk'))`,
  ),
  KEEP(
    'day1',
    `select pg_temp.ins('day_sessions', jsonb_build_object('venue_id', {{venue}},
    'business_date', pg_temp.mon(${M}) + 6, 'opened_by', {{manager}}, 'opening_float_iqd', 0,
    'opened_at', ${at(7, 8)}))`,
  ),
  KEEP(
    'day2',
    `select pg_temp.ins('day_sessions', jsonb_build_object('venue_id', {{venue}},
    'business_date', pg_temp.mon(${M}) + 7, 'opened_by', {{manager}}, 'opening_float_iqd', 0,
    'opened_at', ${at(8, 8)}))`,
  ),
  KEEP(
    'tab5',
    `select pg_temp.ins('tabs', jsonb_build_object('venue_id', {{venue}}, 'day_session_id', {{day1}},
    'kind', 'lesson', 'status', 'settled', 'lesson_enrolment_id', {{p5e}}, 'lesson_iqd', 40000,
    'total_iqd', 40000, 'subtotal_iqd', 0, 'tax_iqd', 0, 'discount_iqd', 0, 'label', 'Lesson',
    'opened_at', ${at(7, 13)}, 'settled_at', ${at(7, 14)}))`,
  ),
  KEEP(
    'pay5',
    `select pg_temp.ins('payments', jsonb_build_object('venue_id', {{venue}}, 'tab_id', {{tab5}},
    'day_session_id', {{day1}}, 'method', 'cash', 'amount_iqd', 40000, 'recorded_by', {{cashier}},
    'created_at', ${at(7, 14)}))`,
  ),
  X(`select pg_temp.ins('refunds', jsonb_build_object('venue_id', {{venue}}, 'payment_id', {{pay5}},
    'amount_iqd', 5000, 'reason_code', 'lesson_goodwill', 'refunded_by', {{manager}}, 'created_at', ${at(8, 9)}))`),
  X(`insert into stations (id, venue_id, is_till) values ('CF285', {{venue}}, true)`),
  X(`select pg_temp.ins('till_shifts', jsonb_build_object('venue_id', {{venue}}, 'day_session_id', {{day2}},
    'station_id', 'CF285', 'staff_id', {{cashier}}, 'opening_float_iqd', 0, 'opened_at', ${at(8, 8)}))`),
  X(`select pg_temp.ins('refunds', jsonb_build_object('venue_id', {{venue}}, 'payment_id', {{pay5}},
    'amount_iqd', 3000, 'reason_code', 'lesson_goodwill', 'refunded_by', {{manager}}, 'device_id', 'CF285',
    'created_at', ${at(8, 10)}))`),
  // Two lessons that did not take place: a staff cancel and an under-filled group session.
  KEEP(
    'px',
    `select pg_temp.lesson(jsonb_build_object('coach_id', {{c1}}, 'lesson_type_id', {{lt}},
    'status', 'cancelled', 'cancel_reason', 'staff_cancel', 'cancelled_at', ${at(10, 8)},
    'start_at', ${at(10, 10)}, 'end_at', ${at(10, 11)}))`,
  ),
  KEEP(
    'gx',
    `select pg_temp.lesson(jsonb_build_object('kind', 'group', 'coach_id', {{c1}},
    'lesson_type_id', {{lt_group}}, 'price_iqd', 15000, 'max_places', 4, 'min_places', 3,
    'cutoff_at', ${at(11, 8)}, 'status', 'cancelled', 'cancel_reason', 'under_filled', 'cancelled_at', ${at(11, 8)},
    'start_at', ${at(11, 10)}, 'end_at', ${at(11, 11)}))`,
  ),
  // A lapsed online lesson payment's hold (not a lapsed court hold) and a guest's lapsed hold.
  KEEP(
    'pe',
    `select pg_temp.lesson(jsonb_build_object('coach_id', {{c1}}, 'lesson_type_id', {{lt}},
    'status', 'expired', 'cancel_reason', 'payment_expired', 'cancelled_at', ${at(12, 9)},
    'booked_by_kind', 'guest', 'created_by_profile_id', {{g1}}, 'created_by_staff_id', null,
    'start_at', ${at(12, 10)}, 'end_at', ${at(12, 11)}))`,
  ),
  X(`select pg_temp.ins('reservations', jsonb_build_object('venue_id', {{venue}}, 'court_id', {{court1}},
    'kind', 'hold', 'status', 'expired', 'hold_expires_at', ${at(12, 9)}, 'start_at', ${at(12, 10)},
    'end_at', ${at(12, 11)}, 'source', 'mobile', 'guest_name', 'Lesson', 'lesson_id', {{pe}}))`),
  X(`select pg_temp.ins('reservations', jsonb_build_object('venue_id', {{venue}}, 'court_id', {{court1}},
    'kind', 'hold', 'status', 'expired', 'hold_expires_at', ${at(13, 9)}, 'start_at', ${at(13, 10)},
    'end_at', ${at(13, 11)}, 'source', 'mobile', 'guest_id', {{g2}}))`),
];

// The expected money (money.md §8.1), through the twin.
const DESK = 40_000;
const DESK_REFUNDS = 5_000 + 3_000;
const ONLINE = 40_000 + 2 * 15_000;
const NET = DESK - DESK_REFUNDS + ONLINE;
const COLLECTED = { p1: 40_000, gr: 30_000, p4: 0, p5: DESK - DESK_REFUNDS };
const COURT_SHARE = 10_000;
const OWED = Object.values(COLLECTED).reduce(
  (a, c) => a + lessonCoachShare(c, COURT_SHARE, 6000),
  0,
);
const COURT_TOTAL = Object.values(COLLECTED).reduce((a, c) => a + Math.min(COURT_SHARE, c), 0);

describe.skipIf(!docker)('coaching 0285: the lesson figures in every report', () => {
  it('lesson_money_figures, reports_figures, panel_headline and report_revenue agree (C-18, CM-13)', () => {
    const r = scenario('cf285-a', [
      ...BASE,
      E(
        'figures',
        `select app.lesson_money_figures(${at(1, 0)} - interval '1 day', ${at(28, 0)} + interval '10 days',
                      array[{{venue}}]::uuid[])`,
      ),
      E('rf', `select app.reports_figures({{mf}}::date, {{mt}}::date)`),
      T('panel', 'owner', `select app.panel_headline({{mf}}::date, {{mt}}::date, 'none')`),
      T(
        'revenue',
        'owner',
        `select app.report_revenue({{mf}}::date, {{mt}}::date, 'month', '{}'::jsonb)`,
      ),
      T(
        'revenue_cash',
        'owner',
        `select app.report_revenue({{mf}}::date, {{mt}}::date, 'month',
                                    '{"paymentMethod":"cash"}'::jsonb)`,
      ),
    ]);
    const f = ok<Record<string, number>>(r, 'figures');
    expect(f).toMatchObject({
      deskIqd: DESK,
      deskCount: 1,
      deskRefundsIqd: DESK_REFUNDS,
      onlineIqd: ONLINE,
      onlineCount: 3,
      onlineRefundsIqd: 0,
      netIqd: NET,
      lessons: 4,
      private: 3,
      group: 1,
      courseSessions: 0,
      lessonMinutes: 240,
      collectedIqd: Object.values(COLLECTED).reduce((a, c) => a + c, 0),
      courtShareIqd: COURT_TOTAL,
      owedToCoachesIqd: OWED,
      places: 4,
      placesTaken: 2,
      noShows: 1,
      attended: 0,
      cancelled: 2,
      underFilled: 1,
      expired: 1,
      lateCancels: 0,
      sandboxExcluded: 1,
    });

    const rf = ok<{
      revenue: number;
      padelRevenue: number;
      cafeNet: number;
      lessonRevenue: number;
      owedToCoaches: number;
    }>(r, 'rf');
    expect(rf.lessonRevenue).toBe(NET);
    expect(rf.owedToCoaches).toBe(OWED);
    expect(rf.revenue).toBe(rf.padelRevenue + rf.cafeNet + rf.lessonRevenue);

    const keys = ok<{ figures: Array<{ key: string }> }>(r, 'panel').figures.map((x) => x.key);
    expect(keys.slice(-2)).toEqual(['lessonRevenue', 'owedToCoaches']);
    expect(keys.slice(0, 20)).toEqual([
      'revenue',
      'padelRevenue',
      'cafeRevenue',
      'cafeNet',
      'cash',
      'card',
      'bookings',
      'orders',
      'avgOrderValue',
      'discounts',
      'refunds',
      'waste',
      'noShows',
      'onlineDeposits',
      'depositForfeits',
      'ticketSales',
      'ticketRefunds',
      'ticketForfeits',
      'ticketLiability',
      'matchWrittenOff',
    ]);

    const revenue = ok<Record<string, unknown>>(r, 'revenue');
    expect(missingKeys(revenue, COACHING_SHAPES.report_revenue)).toEqual([]);
    const totals = revenue.totals as {
      lessonIqd: number;
      owedToCoachesIqd: number;
      totalIqd: number;
      padelIqd: number;
      cafeNetIqd: number;
    };
    expect(totals.lessonIqd).toBe(NET);
    expect(totals.owedToCoachesIqd).toBe(OWED);
    expect(totals.totalIqd).toBe(totals.padelIqd + totals.cafeNetIqd + totals.lessonIqd);
    const cols = (revenue.columns as Array<{ key: string }>).map((c) => c.key);
    expect(cols.slice(cols.indexOf('shopIqd'), cols.indexOf('shopIqd') + 3)).toEqual([
      'shopIqd',
      'lessonIqd',
      'owedToCoachesIqd',
    ]);
    // A cash filter: only the matching desk money; no online money, no accrual.
    const cash = ok<{ totals: Record<string, number> }>(r, 'revenue_cash').totals;
    expect(cash.lessonIqd).toBe(DESK - DESK_REFUNDS);
    expect(cash.owedToCoachesIqd).toBe(0);
  });

  it('report_courts and analytics_courts_summary count lesson minutes as occupied time (CM-14, R72)', () => {
    const r = scenario('cf285-b', [
      ...BASE,
      T(
        'courts',
        'manager',
        `select app.report_courts({{mf}}::date, {{mt}}::date,
                                jsonb_build_object('courtId', {{court1}}))`,
      ),
      T(
        'summary',
        'owner',
        `select app.analytics_courts_summary({{mf}}::date, {{mt}}::date, {{court1}})`,
      ),
    ]);
    const courts = ok<Record<string, unknown>>(r, 'courts');
    expect(missingKeys(courts, COACHING_SHAPES.report_courts)).toEqual([]);
    const row = (
      courts.rows as Array<{
        lessons: number;
        lessonMinutes: number;
        bookedMinutes: number;
        availableMinutes: number;
        occupancyPct: number;
      }>
    )[0]!;
    // p1, gr and p5 hold court1 for an hour each.
    expect(row).toMatchObject({ lessons: 3, lessonMinutes: 180 });
    if (row.availableMinutes > 0) {
      expect(row.occupancyPct).toBeCloseTo(
        Math.round(((row.bookedMinutes + 180) * 1000) / row.availableMinutes) / 10,
        1,
      );
    }
    const block = courts.lessons as Record<string, number>;
    expect(block).toMatchObject({
      lessons: 4,
      owedToCoachesIqd: OWED,
      courtShareIqd: COURT_TOTAL,
      noShows: 1,
    });
    expect(block).not.toHaveProperty('coachShareIqd');
    const cols = (courts.columns as Array<{ key: string }>).map((c) => c.key);
    expect(cols[cols.indexOf('bookedMinutes') + 1]).toBe('lessonMinutes');

    const summary = ok<{
      kpis: Record<string, number>;
      per_court: Array<Record<string, number>>;
      heatmap: Array<{ lesson_minutes: number }>;
    }>(r, 'summary');
    expect(summary.kpis).toMatchObject({ lessons: 3, lesson_minutes: 180, holds_expired: 1 });
    expect(summary.per_court[0]).toMatchObject({ lessons: 3, lesson_minutes: 180 });
    expect(summary.heatmap.reduce((a, h) => a + h.lesson_minutes, 0)).toBe(180);
  });

  it('day_close_online: the lessons block; a later refund counts on the day it was made (C-31, R27)', () => {
    const r = scenario('cf285-c', [
      ...BASE,
      T('day1', 'manager', `select app.day_close_online({{day1}})`),
      T('day2', 'manager', `select app.day_close_online({{day2}})`),
    ]);
    const day1 = ok<Record<string, unknown>>(r, 'day1');
    expect(missingKeys(day1, COACHING_SHAPES.day_close_online)).toEqual([]);
    const l1 = day1.lessons as Record<string, number>;
    // Paid in day 1's session; the refund outside a shift dates by its payment's day (day 1).
    expect(l1).toMatchObject({ desk_paid_iqd: DESK, desk_paid_count: 1, desk_refunded_iqd: 5_000 });
    const l2 = ok<Record<string, unknown>>(r, 'day2').lessons as Record<string, number>;
    // The refund made in day 2's till shift counts on day 2.
    expect(l2).toMatchObject({ desk_paid_iqd: 0, desk_refunded_iqd: 3_000 });
    expect((day1.sandbox_excluded as Record<string, number>).lessons).toBeGreaterThanOrEqual(0);
  });

  it('report_lessons: totals, byCoach summing to them, the fill rate (X24, R42)', () => {
    const r = scenario('cf285-d', [
      ...BASE,
      T('lessons', 'manager', `select app.report_lessons({{mf}}::date, {{mt}}::date)`),
      T('cashier', 'cashier', `select app.report_lessons({{mf}}::date, {{mt}}::date)`),
    ]);
    const rep = ok<Record<string, unknown>>(r, 'lessons');
    expect(missingKeys(rep, COACHING_SHAPES.report_lessons)).toEqual([]);
    const t = rep.totals as {
      collectedIqd: number;
      coachShareIqd: number;
      venueShareIqd: number;
      lessons: number;
    };
    expect(t).toMatchObject({
      lessons: 4,
      private: 3,
      group: 1,
      cancelled: 2,
      underFilled: 1,
      expired: 1,
      collectedIqd: Object.values(COLLECTED).reduce((a, c) => a + c, 0),
      coachShareIqd: OWED,
      deskIqd: DESK,
      onlineIqd: ONLINE,
      refundsIqd: DESK_REFUNDS,
      lessonRevenueIqd: NET,
      sandboxExcluded: 1,
      places: 4,
      placesTaken: 2,
      fillRatePct: 50,
    });
    expect(t.venueShareIqd).toBe(t.collectedIqd - t.coachShareIqd);
    const byCoach = rep.byCoach as Array<{ collectedIqd: number; coachShareIqd: number }>;
    expect(byCoach.reduce((a, c) => a + c.collectedIqd, 0)).toBe(t.collectedIqd);
    expect(byCoach.reduce((a, c) => a + c.coachShareIqd, 0)).toBe(t.coachShareIqd);
    const byDay = rep.byDay as Array<{ lessons: number }>;
    expect(byDay.reduce((a, d) => a + d.lessons, 0)).toBe(t.lessons);
    // No student, phone or guest id anywhere in it (R42).
    expect(JSON.stringify(rep)).not.toMatch(/guest|phone|student|profile/i);
    expect(r.cashier?.ok).toBe(false);
  });
});

describe.skipIf(!docker)('coaching 0285: SEC-29 (R42)', () => {
  it('check:analytics passes: aggregates for the assistant, person-money reports exempt from the coach patterns', () => {
    const out = execFileSync('node', ['scripts/check-analytics-payload.mjs'], { encoding: 'utf8' });
    expect(out).toMatch(/PASS/);
  });
});
