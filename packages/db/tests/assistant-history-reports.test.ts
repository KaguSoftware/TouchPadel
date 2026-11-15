/**
 * 0420 assistant_history_reports: the owner assistant's history tools count
 * the pre-system monthly reports the way the pages do, and the new
 * unpaid_played_bookings tool reads bookings played but not paid.
 *
 *   * history_figures: totals equal panel_headline for the same range, a
 *     report counted only when its whole month is in the range (0349); with
 *     group month the report is in its month's row, with group week the rows
 *     are the system's own and history.inRows says so; a range that cuts the
 *     report leaves it out and names it in history.partial; no report, no
 *     history.
 *   * history_courts: the system's own bookings only (a live run over a whole
 *     report month used to add the report's bookings through kpis), history
 *     names the report, occupancy is null while a report is counted (as the
 *     courts page) and equals the page's occupancy otherwise.
 *   * unpaid_played_bookings: unpaid_played_bookings' predicate over a range
 *     (played, priced, court fee still owed, the branch in scope only), the
 *     totals over every match, the largest debt first, the row limit flagged
 *     as truncated by the dispatcher, owner only, at most 92 days.
 *
 * Everything runs in ONE rolled-back psql transaction (tests/psql-scenario.ts):
 * a report of the case's own in a random month far from real data, bookings
 * on a court of its own, a branch B for the scope check. The fixture writes go
 * first, as postgres with the JWT claims cleared (0230): the first
 * assistant_run_tool turns the transaction read-only. The stored-days cache is
 * switched off inside the transaction so every day is read live.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { stackAvailable } from './helpers';
import { docker, scenario, T, FX, LET, type Results } from './psql-scenario';

const up = await stackAvailable();

const LOCAL = (day: string, time: string) => `((${day})::date + time '${time}') at time zone 'Asia/Baghdad'`;

const PLANT = [
  LET('tag', `select substr(md5(random()::text), 1, 10)`),
  // m: the report month (first day), between 1960 and 1999; u: the unpaid fixtures' day, before m.
  LET('m', `select (date '1960-01-01' + ((random() * 479)::int) * interval '1 month')::date::text`),
  LET('m_end', `select ({{m}}::date + interval '1 month' - interval '1 day')::date::text`),
  LET('m2', `select ({{m}}::date + interval '1 month')::date::text`),
  LET('m2_end', `select ({{m}}::date + interval '2 months' - interval '1 day')::date::text`),
  LET('m_cut', `select ({{m}}::date + 5)::text`),
  LET('m3', `select ({{m}}::date + interval '2 months')::date::text`),
  LET('m3_end', `select ({{m}}::date + interval '2 months' + interval '6 days')::date::text`),
  LET('u', `select ({{m}}::date - 40)::text`),
  LET('u_far', `select ({{m}}::date - 40 + 92)::text`),
  FX(`update assistant_cache_config set enabled = false where id`),
  LET(
    'rep',
    `insert into legacy_reports (id, venue_id, department, period_from, period_to, period_stated, title_stated,
                                 report_no_stated, employee_name, section_heading_stated, summary_stated,
                                 revenue_amount, revenue_stated, revenue_approximate, source_file, source_sha256)
     values (gen_random_uuid(), {{venue}}::uuid, 'padel', {{m}}::date, {{m_end}}::date, 'HR test', 'HR test',
             '1', 'HR test', 'HR test', 'HR test', 1234000, '1,234,000', true, 'hr-test-' || {{tag}},
             md5({{tag}}) || md5({{tag}})) returning id`,
  ),
  FX(`insert into legacy_report_figures (report_id, venue_id, source, position, category, label_stated, count)
      values ({{rep}}::uuid, {{venue}}::uuid, 'summary', 1, 'completed', 'done', 40),
             ({{rep}}::uuid, {{venue}}::uuid, 'summary', 2, 'no_show', 'no show', 3),
             ({{rep}}::uuid, {{venue}}::uuid, 'summary', 3, 'training', 'training', 5)`),
  LET(
    'court',
    `insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
     values ({{venue}}::uuid, 'HR court ' || {{tag}}, 'ملعب HR', '{60,90,120}', 994, true) returning id`,
  ),
  // History: one booking in the report month, one in the next.
  FX(`insert into reservations (court_id, venue_id, kind, status, start_at, end_at, source, guest_name, price_iqd)
      values ({{court}}::uuid, {{venue}}::uuid, 'booking', 'completed', ${LOCAL('{{m}}::date + 9', '12:00')}, ${LOCAL('{{m}}::date + 9', '13:00')}, 'desk', 'HR in', 50000),
             ({{court}}::uuid, {{venue}}::uuid, 'booking', 'completed', ${LOCAL('{{m2}}::date + 2', '12:00')}, ${LOCAL('{{m2}}::date + 2', '13:00')}, 'desk', 'HR next', 70000)`),
  // Unpaid: owes 30,000 (completed); owes 15,000 (confirmed and over, 5,000 court discount);
  // cancelled; fully discounted; unpriced; the next business day; and one at branch B.
  ...(
    [
      ['up_full', 'completed', '10:00', 30000, 'HR owes full'],
      ['up_part', 'confirmed', '11:00', 20000, 'HR owes part'],
      ['up_cancel', 'cancelled', '12:00', 20000, 'HR cancelled'],
      ['up_free', 'completed', '13:00', 20000, 'HR discounted'],
      ['up_noprice', 'completed', '14:00', null, 'HR no price'],
    ] as const
  ).map(([name, status, time, price, guest]) =>
    LET(
      name,
      `insert into reservations (court_id, venue_id, kind, status, start_at, end_at, source, guest_name, price_iqd)
       values ({{court}}::uuid, {{venue}}::uuid, 'booking', '${status}', ${LOCAL('{{u}}', time)},
               ${LOCAL('{{u}}', time)} + interval '1 hour', 'desk', '${guest}', ${price ?? 'null'}) returning id`,
    ),
  ),
  LET(
    'up_next',
    `insert into reservations (court_id, venue_id, kind, status, start_at, end_at, source, guest_name, price_iqd)
     values ({{court}}::uuid, {{venue}}::uuid, 'booking', 'completed', ${LOCAL('{{u}}::date + 1', '12:00')},
             ${LOCAL('{{u}}::date + 1', '13:00')}, 'desk', 'HR next day', 40000) returning id`,
  ),
  FX(`insert into reservation_court_discounts (reservation_id, kind, value, reason, standing, applied_by, authorized_by)
      values ({{up_part}}::uuid, 'amount', 5000, 'other', false, {{owner}}::uuid, {{owner}}::uuid),
             ({{up_free}}::uuid, 'amount', 20000, 'other', false, {{owner}}::uuid, {{owner}}::uuid)`),
  LET(
    'vb',
    `insert into venues (slug, name_en, name_ar, status)
     values ('hr-' || {{tag}}, 'HR branch B', 'فرع ب', 'open') returning id`,
  ),
  LET(
    'court_b',
    `insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
     values ({{vb}}::uuid, 'HR court B ' || {{tag}}, 'ملعب ب', '{60,90,120}', 994, true) returning id`,
  ),
  LET(
    'up_b',
    `insert into reservations (court_id, venue_id, kind, status, start_at, end_at, source, guest_name, price_iqd)
     values ({{court_b}}::uuid, {{vb}}::uuid, 'booking', 'completed', ${LOCAL('{{u}}', '10:00')},
             ${LOCAL('{{u}}', '11:00')}, 'desk', 'HR branch B', 10000) returning id`,
  ),
];

const SCOPE_A = FX(`select set_config('request.headers', json_build_object('x-venue-scope', {{venue}})::text, true)`);
const SCOPE_B = FX(`select set_config('request.headers', json_build_object('x-venue-scope', {{vb}})::text, true)`);
const run = (label: string, tool: string, args: string, who = 'owner') =>
  T(label, who, `select app.assistant_run_tool('${tool}', ${args})`);
const range = (from: string, to: string, extra = '') => `jsonb_build_object('p_from', {{${from}}}, 'p_to', {{${to}}}${extra})`;
const panel = (label: string, from: string, to: string) =>
  T(label, 'owner', `select app.assistant_run_tool('panel_headline', ${range(from, to)}) -> 'data'`);

const CALLS = [
  `select pg_temp.q('ids', $q$select jsonb_object_agg(name, val) from pg_temp.vars$q$);`,
  SCOPE_A,
  run('hf_month', 'assistant_history_figures', range('m', 'm2_end', `, 'p_group', 'month'`)),
  run('hf_week', 'assistant_history_figures', range('m', 'm2_end', `, 'p_group', 'week'`)),
  panel('panel_whole', 'm', 'm2_end'),
  run('hf_cut', 'assistant_history_figures', range('m_cut', 'm2_end', `, 'p_group', 'month'`)),
  panel('panel_cut', 'm_cut', 'm2_end'),
  run('hf_none', 'assistant_history_figures', range('m3', 'm3_end')),
  run('hc_whole', 'assistant_history_courts', range('m', 'm2_end')),
  run('hc_month', 'assistant_history_courts', range('m', 'm2_end', `, 'p_group', 'month'`)),
  run('hc_next', 'assistant_history_courts', range('m2', 'm2_end')),
  T('page_next', 'owner', `select app.assistant_run_tool('analytics_courts_summary', ${range('m2', 'm2_end')}) -> 'data' -> 'kpis'`),
  run('up_a', 'assistant_unpaid_played_bookings', range('u', 'u')),
  run('up_a1', 'assistant_unpaid_played_bookings', range('u', 'u', `, 'p_limit', 1`)),
  run('up_wide', 'assistant_unpaid_played_bookings', range('u', 'u_far')),
  run('up_mgr', 'assistant_unpaid_played_bookings', range('u', 'u'), 'manager'),
  SCOPE_B,
  run('up_b_scope', 'assistant_unpaid_played_bookings', range('u', 'u')),
];

type Fig = Record<string, number>;
interface History {
  included: Array<{ from: string; to: string; revenue: number | null }>;
  partial: Array<{ from: string; to: string }>;
  revenue: number | null;
  revenueApproximate: boolean;
  inRows: boolean;
}
interface HistFigures {
  rows: Array<Fig & { period: string }>;
  totals: Fig;
  history: History | null;
}
interface HistCourts {
  total: { bookings: number; revenue_iqd: number; occupancy_pct: number | null };
  rows: Array<{ period: string; bookings: number }>;
  history: History | null;
}
interface Unpaid {
  total: number;
  remaining_iqd: number;
  rows: Array<{ id: string; business_date: string; guest_name: string; price_iqd: number; remaining_iqd: number; court_name_en: string }>;
}

describe.skipIf(!up || !docker)('0420 assistant history tools and the pre-system monthly reports', () => {
  let r: Results = {};
  let ids: Record<string, string> = {};

  /** The dispatcher's {tool, data, row_count, truncated} of one call. */
  const out = <D>(label: string) => {
    const o = r[label];
    expect(o, `no result for ${label}`).toBeDefined();
    expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.detail ?? ''} ${o!.hint ?? ''}`).toBe(true);
    return o!.data as { data: D; row_count: number | null; truncated: boolean };
  };
  const figures = (label: string): Fig => {
    const o = r[label];
    expect(o?.ok, `${label}: ${o?.code ?? ''}`).toBe(true);
    const list = (o!.data as { figures: Array<{ key: string; value: number }> }).figures;
    return Object.fromEntries(list.map((f) => [f.key, Number(f.value)]));
  };

  beforeAll(() => {
    r = scenario([...PLANT, ...CALLS]);
    const o = r.ids;
    expect(o?.ok, `fixture: ${o?.code ?? 'no ids'}`).toBe(true);
    ids = o!.data as Record<string, string>;
  });

  it('history_figures totals equal panel_headline with the report month whole in the range', () => {
    const h = out<HistFigures>('hf_month').data;
    const p = figures('panel_whole');
    for (const k of ['revenue', 'padelRevenue', 'bookings', 'noShows', 'cash', 'card', 'cafeRevenue']) {
      expect(Number(h.totals[k]), k).toBe(p[k]);
    }
    // 50,000 + 70,000 of the case's bookings + the report's 1,234,000.
    expect(Number(h.totals.padelRevenue)).toBe(1_354_000);
    expect(Number(h.totals.bookings)).toBe(42);
    expect(h.history?.included.map((x) => x.from)).toEqual([ids.m]);
    expect(h.history?.partial).toEqual([]);
    expect(h.history?.revenueApproximate).toBe(true);
  });

  it('group month: the report is in its own month\'s row; group week: rows are the system\'s own', () => {
    const month = out<HistFigures>('hf_month').data;
    expect(month.rows.map((x) => [x.period, Number(x.padelRevenue), Number(x.bookings), Number(x.noShows)])).toEqual([
      [ids.m, 1_284_000, 41, 3],
      [ids.m2, 70_000, 1, 0],
    ]);
    expect(month.history?.inRows).toBe(true);

    const week = out<HistFigures>('hf_week').data;
    expect(week.totals).toEqual(month.totals);
    expect(week.rows.reduce((s, x) => s + Number(x.padelRevenue), 0)).toBe(120_000);
    expect(week.history?.inRows).toBe(false);
  });

  it('a range that cuts the report month leaves it out, names it, and still equals the panel', () => {
    const h = out<HistFigures>('hf_cut').data;
    const p = figures('panel_cut');
    for (const k of ['revenue', 'padelRevenue', 'bookings', 'noShows']) expect(Number(h.totals[k]), k).toBe(p[k]);
    expect(Number(h.totals.padelRevenue)).toBe(120_000);
    expect(h.history?.included).toEqual([]);
    expect(h.history?.partial.map((x) => [x.from, x.to])).toEqual([[ids.m, ids.m_end]]);
  });

  it('no report in the range: history is null', () => {
    expect(out<HistFigures>('hf_none').data.history).toBeNull();
  });

  it('history_courts counts the system\'s own bookings, names the report, and hides occupancy while it is counted', () => {
    const whole = out<HistCourts>('hc_whole').data;
    expect(Number(whole.total.bookings)).toBe(2);
    expect(Number(whole.total.revenue_iqd)).toBe(120_000);
    expect(whole.total.occupancy_pct).toBeNull();
    expect(whole.history?.included.map((x) => x.from)).toEqual([ids.m]);
    expect(whole.history?.inRows).toBe(false);
    expect(out<HistCourts>('hc_month').data.rows.map((x) => Number(x.bookings))).toEqual([1, 1]);
  });

  it('history_courts occupancy is the courts page\'s (booked + lesson minutes over open minutes)', () => {
    const next = out<HistCourts>('hc_next').data;
    expect(r.page_next?.ok, `page_next: ${r.page_next?.code ?? ''}`).toBe(true);
    const page = r.page_next!.data as { occupancy_pct: number | null };
    expect(next.history).toBeNull();
    expect(Number(next.total.bookings)).toBe(1);
    expect(next.total.occupancy_pct).toBe(page.occupancy_pct === null ? 0 : Number(page.occupancy_pct));
  });

  it('unpaid_played_bookings: played, priced, still owing, this branch, totals over every match, largest debt first', () => {
    const res = out<Unpaid>('up_a');
    const d = res.data;
    expect(Number(d.total)).toBe(2);
    expect(Number(d.remaining_iqd)).toBe(45_000);
    expect(d.rows.map((x) => [x.id, Number(x.remaining_iqd), Number(x.price_iqd), x.guest_name, x.business_date])).toEqual([
      [ids.up_full, 30_000, 30_000, 'HR owes full', ids.u],
      [ids.up_part, 15_000, 20_000, 'HR owes part', ids.u],
    ]);
    expect(d.rows[0]!.court_name_en).toMatch(/^HR court /);
    expect(res.truncated).toBe(false);
  });

  it('unpaid_played_bookings: the row limit keeps the totals and the dispatcher flags truncated', () => {
    const res = out<Unpaid>('up_a1');
    expect(res.data.rows).toHaveLength(1);
    expect(Number(res.data.total)).toBe(2);
    expect(Number(res.data.remaining_iqd)).toBe(45_000);
    expect(res.truncated).toBe(true);
  });

  it('unpaid_played_bookings: the other branch is out of scope A and in scope B', () => {
    const b = out<Unpaid>('up_b_scope').data;
    expect(b.rows.map((x) => x.id)).toEqual([ids.up_b]);
    expect(out<Unpaid>('up_a').data.rows.map((x) => x.id)).not.toContain(ids.up_b);
  });

  it('unpaid_played_bookings: owner only, at most 92 days', () => {
    expect(r.up_mgr?.ok).toBe(false);
    expect(r.up_mgr?.code).toMatch(/FORBIDDEN/);
    expect(r.up_wide?.ok).toBe(false);
    expect(r.up_wide?.code).toMatch(/INVALID_RANGE/);
  });
});
