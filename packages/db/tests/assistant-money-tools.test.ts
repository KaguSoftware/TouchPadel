/**
 * 0421 assistant_money_staff_tools: five owner-only tools over the day closes,
 * the costs and the cash result, the safe, wages and attendance (Majed,
 * 2026-11-12, lifted the LLM wall for the OWNER assistant only).
 *
 *   * owner only: a manager and a cashier get FORBIDDEN through the wall, and
 *     no client may call a tool function directly (no grant);
 *   * branch scope: with one branch chosen, another branch's rows never
 *     appear, and with that branch chosen they do;
 *   * every total equals the sum of the rows the tool itself returns;
 *   * people rows (wages, attendance, presence) are in name order;
 *   * the safe balance and the month's costs equal main_cash_overview's for
 *     the same branch and month; the wages totals equal wages_month's; the
 *     cash result is panel_headline's revenue minus the payments, and null
 *     with a note when a pre-system monthly report is counted in it;
 *   * engagement and files are known scopes (assistant_set_scopes).
 *
 * Everything runs in ONE rolled-back psql transaction (tests/psql-scenario.ts)
 * in a random month far from real data. The fixture writes go first, as
 * postgres with the JWT claims cleared (0230): the first assistant_run_tool
 * turns the transaction read-only. Assumes the migrations through 0421 are
 * applied (CI applies them before the suite).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { stackAvailable } from './helpers';
import { docker, scenario, T, Q, FX, LET, MK, type Results } from './psql-scenario';

const up = await stackAvailable();

const LOCAL = (day: string, time: string) => `((${day})::date + time '${time}') at time zone 'Asia/Baghdad'`;

const CASH = `insert into main_cash_entries (venue_id, kind, amount_iqd, delta_iqd, paid_from, category, payee, note, box,
                                             day_session_id, source, occurred_on, logged_by, voided_at, voided_by, void_reason)`;

const PLANT = [
  LET('tag', `select upper(substr(md5(random()::text), 1, 8))`),
  // m: the case's month (first day), between 1960 and 1999; m2: the month after, holding a pre-system report.
  LET('m', `select (date '1960-01-01' + ((random() * 479)::int) * interval '1 month')::date::text`),
  LET('m_end', `select ({{m}}::date + interval '1 month' - interval '1 day')::date::text`),
  LET('m2', `select ({{m}}::date + interval '1 month')::date::text`),
  LET('m2_end', `select ({{m}}::date + interval '2 months' - interval '1 day')::date::text`),
  LET('m_prev', `select ({{m}}::date - 1)::text`),
  LET('vb', `insert into venues (slug, name_en, name_ar, status) values ('mt-' || lower({{tag}}), 'MT branch B ' || {{tag}}, 'فرع ب', 'open') returning id`),
  LET('va_name', `select name_en from venues where id = {{venue}}::uuid`),
  // People: created z first, a second, so name order is not insertion order.
  MK('wz', 'barista'),
  MK('wa', 'cashier'),
  MK('wb', 'waiter', 'vb'),
  FX(`insert into staff_wages (venue_id, staff_id, effective_month, salary_iqd, pay_day, set_by)
      values ({{venue}}::uuid, {{wz}}::uuid, {{m}}::date, 1000000, 25, {{owner}}::uuid),
             ({{venue}}::uuid, {{wa}}::uuid, {{m}}::date, 800000, 28, {{owner}}::uuid),
             ({{vb}}::uuid, {{wb}}::uuid, {{m}}::date, 600000, 25, {{owner}}::uuid)`),
  FX(`insert into salary_deductions (venue_id, staff_id, amount_iqd, deduction_date, pay_month, reason, proposed_by, proposed_at,
                                     status, decided_by, decided_at)
      values ({{venue}}::uuid, {{wz}}::uuid, 50000, {{m}}::date + 2, {{m}}::date, 'MT short stock', {{manager}}::uuid, now(),
              'approved', {{owner}}::uuid, now())`),
  FX(`insert into staff_attendance (venue_id, staff_id, work_date, late_minutes, early_leave_minutes, grace_minutes,
                                    penalty_rule_iqd, pay_month, note, recorded_by)
      values ({{venue}}::uuid, {{wa}}::uuid, {{m}}::date + 3, 20, 0, 10, 5000, {{m}}::date, 'MT traffic', {{manager}}::uuid),
             ({{venue}}::uuid, {{wz}}::uuid, {{m}}::date + 4, 5, 0, 10, 5000, {{m}}::date, null, {{manager}}::uuid),
             ({{vb}}::uuid, {{wb}}::uuid, {{m}}::date + 3, 30, 0, 10, 0, {{m}}::date, null, {{manager}}::uuid)`),
  FX(`insert into wage_advances (venue_id, staff_id, pay_month, amount_iqd, paid_from, note, given_by, given_at)
      values ({{venue}}::uuid, {{wa}}::uuid, {{m}}::date, 100000, 'safe', 'MT rent help', {{owner}}::uuid, ${LOCAL('{{m}}::date + 5', '12:00')})`),
  FX(`insert into wage_payments (venue_id, staff_id, pay_month, due_date, salary_iqd, deductions_iqd, deduction_count, penalties_iqd,
                                 penalty_days, bonuses_iqd, bonus_count, net_iqd, advances_iqd, advance_count, paid_iqd, status,
                                 paid_by, paid_at, paid_from)
      values ({{venue}}::uuid, {{wz}}::uuid, {{m}}::date, {{m}}::date + 24, 1000000, 50000, 1, 0, 0, 0, 0, 950000, 0, 0, 950000, 'paid',
              {{owner}}::uuid, now(), 'bank')`),
  // Day closes: two closed days at A (short 2,000, over 500), one at B (short 7,000).
  LET('day1', `insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd, closed_at, closed_by,
                                         cash_expected_iqd, cash_counted_iqd, cash_variance_iqd, card_expected_iqd, card_terminal_batch_iqd, notes)
               values ({{venue}}::uuid, {{m}}::date + 1, 'closed', {{owner}}::uuid, 0, now(), {{manager}}::uuid,
                       500000, 498000, -2000, 100000, 99000, 'MT short') returning id`),
  LET('day2', `insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd, closed_at, closed_by,
                                         cash_expected_iqd, cash_counted_iqd, cash_variance_iqd, card_expected_iqd)
               values ({{venue}}::uuid, {{m}}::date + 2, 'closed', {{owner}}::uuid, 0, now(), {{manager}}::uuid,
                       300000, 300500, 500, 0) returning id`),
  LET('dayb', `insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd, closed_at, closed_by,
                                         cash_expected_iqd, cash_counted_iqd, cash_variance_iqd)
               values ({{vb}}::uuid, {{m}}::date + 1, 'closed', {{owner}}::uuid, 0, now(), {{manager}}::uuid,
                       100000, 93000, -7000) returning id`),
  LET('desk_st', `insert into stations (id, venue_id, is_till, mode) values ('MTD-' || {{tag}}, {{venue}}::uuid, false, 'desk') returning id`),
  LET('till_st', `insert into stations (id, venue_id, is_till, mode) values ('MTT-' || {{tag}}, {{venue}}::uuid, true, 'till') returning id`),
  FX(`insert into till_shifts (venue_id, day_session_id, station_id, staff_id, opened_at, opening_float_iqd, closed_at, closed_by,
                               closed_via, cash_payments_iqd, cash_refunds_iqd, cash_expected_iqd, cash_counted_iqd, cash_variance_iqd,
                               card_payments_iqd, card_refunds_iqd, payment_count, refund_count)
      values ({{venue}}::uuid, {{day1}}::uuid, {{desk_st}}, {{wa}}::uuid, ${LOCAL('{{m}}::date + 1', '10:00')}, 0,
              ${LOCAL('{{m}}::date + 1', '18:00')}, {{wa}}::uuid, 'own_pin', 70000, 0, 70000, 69000, -1000, 0, 0, 1, 0)`),
  FX(`insert into till_shifts (venue_id, day_session_id, station_id, staff_id, opened_at, opening_float_iqd)
      values ({{venue}}::uuid, {{day1}}::uuid, {{till_st}}, {{wz}}::uuid, ${LOCAL('{{m}}::date + 1', '09:00')}, 0)`),
  LET('tab', `insert into tabs (venue_id, day_session_id, label, kind) values ({{venue}}::uuid, {{day1}}::uuid, 'MT tab', 'cafe') returning id`),
  FX(`insert into payments (venue_id, tab_id, day_session_id, method, amount_iqd, recorded_by, device_id)
      values ({{venue}}::uuid, {{tab}}::uuid, {{day1}}::uuid, 'cash', 70000, {{manager}}::uuid, {{desk_st}}),
             ({{venue}}::uuid, {{tab}}::uuid, {{day1}}::uuid, 'cash', 20000, {{manager}}::uuid, null)`),
  // The safe at A: rent from the safe, a supplier by bank, a wage paid by hand, the owner's cash, the
  // desk's day-close hand-in, a float out to the café, a count, a voided payment, and a row the month before.
  FX(`${CASH} values
      ({{venue}}::uuid, 'payment', 300000, -300000, 'safe', 'rent', 'MT Landlord', 'MT rent', null, null, 'manual', {{m}}::date + 3, {{owner}}::uuid, null, null, null),
      ({{venue}}::uuid, 'payment', 200000, 0, 'bank', 'supplier', 'MT Supplier', null, null, null, 'manual', {{m}}::date + 4, {{owner}}::uuid, null, null, null),
      ({{venue}}::uuid, 'payment', 150000, -150000, 'safe', 'wages', 'LDB wa', null, null, null, 'manual', {{m}}::date + 20, {{owner}}::uuid, null, null, null),
      ({{venue}}::uuid, 'owner_in', 1000000, 1000000, null, null, null, null, null, null, 'manual', {{m}}::date, {{owner}}::uuid, null, null, null),
      ({{venue}}::uuid, 'hand_in', 70000, 70000, null, null, null, null, 'desk', {{day1}}::uuid, 'day_close', {{m}}::date + 1, {{manager}}::uuid, null, null, null),
      ({{venue}}::uuid, 'to_drawer', 50000, -50000, null, null, null, null, 'cafe', null, 'manual', {{m}}::date + 2, {{manager}}::uuid, null, null, null),
      ({{venue}}::uuid, 'count', 560000, -20000, null, null, null, null, null, null, 'manual', {{m}}::date + 21, {{owner}}::uuid, null, null, null),
      ({{venue}}::uuid, 'payment', 99999, -99999, 'safe', 'other', 'MT voided', null, null, null, 'manual', {{m}}::date + 5, {{owner}}::uuid, now(), {{owner}}::uuid, 'MT test'),
      ({{venue}}::uuid, 'owner_in', 10000, 10000, null, null, null, null, null, null, 'manual', {{m_prev}}::date, {{owner}}::uuid, null, null, null),
      ({{vb}}::uuid, 'payment', 70000, -70000, 'safe', 'rent', 'MT Landlord B', null, null, null, 'manual', {{m}}::date + 3, {{owner}}::uuid, null, null, null),
      ({{vb}}::uuid, 'owner_in', 70000, 70000, null, null, null, null, null, null, 'manual', {{m}}::date, {{owner}}::uuid, null, null, null)`),
  // Revenue: one played booking at A in m; a pre-system report covering all of m2.
  LET('court', `insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
                values ({{venue}}::uuid, 'MT court ' || {{tag}}, 'ملعب MT', '{60,90,120}', 993, true) returning id`),
  FX(`insert into reservations (court_id, venue_id, kind, status, start_at, end_at, source, guest_name, price_iqd)
      values ({{court}}::uuid, {{venue}}::uuid, 'booking', 'completed', ${LOCAL('{{m}}::date + 9', '12:00')},
              ${LOCAL('{{m}}::date + 9', '13:00')}, 'desk', 'MT guest', 90000)`),
  FX(`insert into legacy_reports (id, venue_id, department, period_from, period_to, period_stated, title_stated,
                                  report_no_stated, employee_name, section_heading_stated, summary_stated,
                                  revenue_amount, revenue_stated, revenue_approximate, source_file, source_sha256)
      values (gen_random_uuid(), {{venue}}::uuid, 'padel', {{m2}}::date, {{m2_end}}::date, 'MT test', 'MT test',
              '1', 'MT test', 'MT test', 'MT test', 777000, '777,000', false, 'mt-test-' || {{tag}},
              md5({{tag}}) || md5({{tag}}))`),
  LET('conv', `insert into assistant_conversations (owner_id) values ({{owner}}::uuid) returning id`),
];

const SCOPE = (v: string) => FX(`select set_config('request.headers', json_build_object('x-venue-scope', {{${v}}})::text, true)`);
const run = (label: string, rpc: string, args: string, who = 'owner') => T(label, who, `select app.assistant_run_tool('${rpc}', ${args})`);
const range = (extra = '') => `jsonb_build_object('p_from', {{m}}, 'p_to', {{m_end}}${extra})`;
/** True when the staff_name values at `path` of a result are in the database's name order. */
const nameOrder = (label: string, of: string, path: string) =>
  Q(
    label,
    `select to_jsonb(coalesce(n = (select array_agg(x order by x) from unnest(n) x), true))
       from (select array(select e ->> 'staff_name'
                            from pg_temp.out o, jsonb_array_elements(o.res #> '{data,data,${path}}') with ordinality as t(e, i)
                           where o.label = '${of}' order by t.i) as n) s`,
  );

const CALLS = [
  `select pg_temp.q('ids', $q$select jsonb_object_agg(name, val) from pg_temp.vars$q$);`,
  // Before the first dispatcher call: it turns the transaction read-only.
  T('scopes', 'owner', `select to_jsonb(app.assistant_set_scopes({{conv}}::uuid, array['engagement','files','money']))`),
  SCOPE('venue'),
  run('cc_a', 'assistant_cash_closes', range(`, 'p_detail', 'shifts'`)),
  run('cs_a', 'assistant_costs_summary', range()),
  run('cs_w', 'assistant_costs_summary', range(`, 'p_group', 'week'`)),
  run('cs_leg', 'assistant_costs_summary', `jsonb_build_object('p_from', {{m2}}, 'p_to', {{m2_end}})`),
  run('pn_a', 'panel_headline', range()),
  run('sf_a', 'assistant_safe_summary', range(`, 'p_rows', true`)),
  run('wg_a', 'assistant_wages_summary', range(`, 'p_detail', true`)),
  run('at_a', 'assistant_attendance_summary', range()),
  T('ov_a', 'owner', `select app.main_cash_overview({{venue}}::uuid, {{m}}::date)`),
  T('wm_a', 'owner', `select app.wages_month({{venue}}::uuid, {{m}}::date)`),
  run('mgr', 'assistant_cash_closes', range(), 'manager'),
  run('cashier', 'assistant_wages_summary', range(), 'cashier'),
  T('mgr_direct', 'manager', `select app.assistant_safe_summary({{m}}::date, {{m_end}}::date, true)`),
  run('wg_wide', 'assistant_wages_summary', `jsonb_build_object('p_from', {{m}}, 'p_to', ({{m}}::date + interval '12 months')::date)`),
  SCOPE('vb'),
  run('cc_b', 'assistant_cash_closes', range()),
  run('cs_b', 'assistant_costs_summary', range()),
  run('sf_b', 'assistant_safe_summary', range(`, 'p_rows', true`)),
  run('wg_b', 'assistant_wages_summary', range()),
  run('at_b', 'assistant_attendance_summary', range()),
  nameOrder('ord_wg', 'wg_a', 'people'),
  nameOrder('ord_at', 'at_a', 'people'),
  nameOrder('ord_pr', 'at_a', 'presence'),
];

type N = number | string;
const num = (v: N | null | undefined) => Number(v ?? 0);
const sum = <R>(rows: R[], f: (r: R) => N | null | undefined) => rows.reduce((s, x) => s + num(f(x)), 0);

interface CashCloses {
  totals: Record<string, N>;
  by_box: Array<{ box: string; shifts: N; variance_iqd: N; net_cash_iqd: N; handed_in_iqd: N }>;
  days_total: N;
  days: Array<{ business_date: string; branch: string; status: string; variance: N | null; boxes: Array<{ box: string; net: N; handed_in: N | null }> }>;
  shifts_total?: N;
  shifts?: Array<{ opened_at: string; staff_name: string; box: string; variance: N | null; counted: N | null }>;
}
interface Costs {
  totals: { total_iqd: N; from_safe_iqd: N; from_bank_iqd: N; count: N; revenue_iqd: N | null; cash_result_iqd: N | null };
  by_category: Array<{ category: string; total_iqd: N; count: N }>;
  by_branch: Array<{ branch: string; total_iqd: N }>;
  by_bucket: Array<{ period: string; total_iqd: N }>;
  note?: string;
}
interface SafeBranch {
  branch: string;
  balance_now_iqd: N;
  opening_iqd: N;
  closing_iqd: N;
  in: { hand_in_by_box: Record<string, N>; owner_in: N; bank_in: N };
  out: { paid_from_safe: N; to_drawer: N; owner_out: N; bank_out: N };
  count_adjust_iqd: N;
  paid_by_bank_iqd: N;
}
interface Safe {
  by_branch: SafeBranch[];
  totals: Record<string, N>;
  rows_total: N;
  rows: Array<{ occurred_on: string; branch: string; kind: string; category: string | null; payee: string | null; delta: N }>;
}
interface WagePerson {
  staff_id: string;
  staff_name: string;
  branch: string;
  net_iqd: N;
  salary_iqd: N;
  deductions_iqd: N;
  penalties_iqd: N;
  advances_iqd: N;
  paid_iqd: N | null;
  to_pay_iqd: N;
  status: string;
  paid_from: string | null;
  lines?: Array<{ kind: string; amount_iqd: N; note: string | null }>;
}
interface Wages {
  totals: Record<string, N>;
  by_branch_month: Array<{ branch: string; net_iqd: N; people: N }>;
  people_total: N;
  people: WagePerson[];
}
interface Attendance {
  coverage: string;
  totals: Record<string, N>;
  people_total: N;
  people: Array<{ staff_id: string; staff_name: string; days: N; late_minutes: N; early_leave_minutes: N; penalty_days: N; penalties_iqd: N }>;
  presence: Array<{ staff_id: string; staff_name: string; shift_days: N }>;
}

describe.skipIf(!up || !docker)('0421 assistant money and staff tools', () => {
  let r: Results = {};
  let ids: Record<string, string> = {};

  const out = <D>(label: string) => {
    const o = r[label];
    expect(o, `no result for ${label}`).toBeDefined();
    expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.detail ?? ''} ${o!.hint ?? ''}`).toBe(true);
    return (o!.data as { data: D }).data;
  };
  const page = <D>(label: string) => {
    const o = r[label];
    expect(o?.ok, `${label}: ${o?.code ?? ''}`).toBe(true);
    return o!.data as D;
  };

  beforeAll(() => {
    r = scenario([...PLANT, ...CALLS]);
    const o = r.ids;
    expect(o?.ok, `fixture: ${o?.code ?? 'no ids'}`).toBe(true);
    ids = o!.data as Record<string, string>;
  });

  it('owner only: manager and cashier are FORBIDDEN, and no client calls a tool function directly', () => {
    expect(r.mgr?.ok).toBe(false);
    expect(r.mgr?.code).toMatch(/FORBIDDEN/);
    expect(r.cashier?.ok).toBe(false);
    expect(r.cashier?.code).toMatch(/FORBIDDEN/);
    expect(r.mgr_direct?.ok).toBe(false);
    expect(r.mgr_direct?.code).toMatch(/permission denied/);
  });

  it('engagement and files are known scopes', () => {
    const row = page<{ scopes: string[] }>('scopes');
    expect([...row.scopes].sort()).toEqual(['engagement', 'files', 'money']);
  });

  it('cash_closes: totals are the sum of its own days and shifts, boxes carry the hand-in', () => {
    const c = out<CashCloses>('cc_a');
    expect(c.days.map((d) => [d.business_date, d.branch, d.status])).toEqual([
      [new Date(Date.parse(`${ids.m}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10), ids.va_name, 'closed'],
      [new Date(Date.parse(`${ids.m}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10), ids.va_name, 'closed'],
    ]);
    expect(num(c.days_total)).toBe(c.days.length);
    expect(num(c.totals.variance_iqd)).toBe(sum(c.days, (d) => d.variance));
    expect(num(c.totals.variance_iqd)).toBe(-1500);
    expect([num(c.totals.short_days), num(c.totals.short_iqd), num(c.totals.over_days), num(c.totals.over_iqd)]).toEqual([1, 2000, 1, 500]);
    expect(num(c.totals.card_gap_iqd)).toBe(-1000);
    expect(c.shifts!.map((s) => s.staff_name)).toEqual(['LDB wz', 'LDB wa']); // time order
    expect(num(c.totals.shifts)).toBe(c.shifts!.length);
    expect(num(c.totals.shifts_uncounted)).toBe(c.shifts!.filter((s) => s.counted === null).length);
    expect(num(c.totals.shift_variance_iqd)).toBe(sum(c.shifts!, (s) => s.variance));
    const boxes = c.days.flatMap((d) => d.boxes);
    expect(num(c.totals.handed_in_iqd)).toBe(sum(boxes, (b) => b.handed_in));
    expect(num(c.totals.hand_in_gap_iqd)).toBe(sum(boxes, (b) => num(b.net) - num(b.handed_in)));
    expect(c.by_box.map((b) => [b.box, num(b.net_cash_iqd), num(b.handed_in_iqd)])).toEqual([
      ['cafe', 20000, 0],
      ['desk', 70000, 70000],
    ]);
    expect(num(c.totals.hand_in_gap_iqd)).toBe(20000);
  });

  it('cash_closes: branch B is out of scope A and alone in scope B', () => {
    expect(out<CashCloses>('cc_a').days.map((d) => d.branch)).not.toContain(`MT branch B ${ids.tag}`);
    const b = out<CashCloses>('cc_b');
    expect(b.days.map((d) => d.branch)).toEqual([`MT branch B ${ids.tag}`]);
    expect(num(b.totals.variance_iqd)).toBe(-7000);
  });

  it('costs_summary: safe and bank payments by category and bucket, the voided row and branch B left out', () => {
    const c = out<Costs>('cs_a');
    expect(num(c.totals.total_iqd)).toBe(650000);
    expect([num(c.totals.from_safe_iqd), num(c.totals.from_bank_iqd), num(c.totals.count)]).toEqual([450000, 200000, 3]);
    expect(c.by_category.map((x) => [x.category, num(x.total_iqd)])).toEqual([
      ['supplier', 200000],
      ['rent', 300000],
      ['wages', 150000],
    ]);
    expect(sum(c.by_category, (x) => x.total_iqd)).toBe(num(c.totals.total_iqd));
    expect(sum(c.by_bucket, (x) => x.total_iqd)).toBe(num(c.totals.total_iqd));
    const w = out<Costs>('cs_w');
    expect(sum(w.by_bucket, (x) => x.total_iqd)).toBe(650000);
    expect(w.by_bucket.length).toBeGreaterThan(3);
    expect(num(out<Costs>('cs_b').totals.total_iqd)).toBe(70000);
  });

  it('costs_summary: the cash result is panel revenue minus the payments, null with a note while a report is counted', () => {
    const c = out<Costs>('cs_a');
    const revenue = out<{ figures: Array<{ key: string; value: N }> }>('pn_a').figures.find((f) => f.key === 'revenue')!.value;
    expect(num(c.totals.revenue_iqd)).toBe(num(revenue));
    expect(num(c.totals.revenue_iqd)).toBeGreaterThanOrEqual(90000);
    expect(num(c.totals.cash_result_iqd)).toBe(num(revenue) - 650000);
    const leg = out<Costs>('cs_leg');
    expect(leg.totals.cash_result_iqd).toBeNull();
    expect(num(leg.totals.revenue_iqd)).toBeGreaterThanOrEqual(777000);
    expect(leg.note).toMatch(/pre-system monthly reports/);
  });

  it('costs_summary: the month equals main_cash_overview for the same branch and month', () => {
    const ov = page<{ costs_total_iqd: N; balance_iqd: N }>('ov_a');
    expect(num(out<Costs>('cs_a').totals.total_iqd)).toBe(num(ov.costs_total_iqd));
  });

  it('safe_summary: balance equals the Safe page, closing = opening + in - out + counts, rows carry payees', () => {
    const s = out<Safe>('sf_a');
    const ov = page<{ balance_iqd: N }>('ov_a');
    expect(s.by_branch.map((b) => b.branch)).toEqual([ids.va_name]);
    const a = s.by_branch[0]!;
    expect(num(a.balance_now_iqd)).toBe(num(ov.balance_iqd));
    const ins = sum(Object.values(a.in.hand_in_by_box), (x) => x) + num(a.in.owner_in) + num(a.in.bank_in);
    const outs = num(a.out.paid_from_safe) + num(a.out.to_drawer) + num(a.out.owner_out) + num(a.out.bank_out);
    expect(num(a.closing_iqd)).toBe(num(a.opening_iqd) + ins - outs + num(a.count_adjust_iqd));
    expect([num(a.in.hand_in_by_box.desk), num(a.in.owner_in), num(a.out.paid_from_safe), num(a.out.to_drawer)]).toEqual([70000, 1000000, 450000, 50000]);
    expect([num(a.count_adjust_iqd), num(a.paid_by_bank_iqd)]).toEqual([-20000, 200000]);
    expect(num(s.rows_total)).toBe(7);
    expect(s.rows).toHaveLength(7);
    expect(num(s.totals.voided_rows_in_range)).toBe(1);
    expect(sum(s.rows, (x) => x.delta)).toBe(num(a.closing_iqd) - num(a.opening_iqd));
    expect(s.rows.find((x) => x.category === 'wages')?.payee).toBe('LDB wa');
    expect(s.rows.map((x) => x.occurred_on)).toEqual([...s.rows.map((x) => x.occurred_on)].sort());
    const b = out<Safe>('sf_b');
    expect(b.by_branch.map((x) => x.branch)).toEqual([`MT branch B ${ids.tag}`]);
    expect(b.rows.every((x) => x.branch === `MT branch B ${ids.tag}`)).toBe(true);
  });

  it('wages_summary: totals equal wages_month for the same branch and month, and the sum of its people', () => {
    const w = out<Wages>('wg_a');
    const wm = page<{ totals: Record<string, N> }>('wm_a');
    for (const k of ['salary_iqd', 'deductions_iqd', 'penalties_iqd', 'bonuses_iqd', 'net_iqd', 'advances_iqd', 'to_pay_iqd', 'paid_iqd', 'people', 'paid', 'due', 'overdue', 'upcoming', 'unset']) {
      expect(num(w.totals[k]), k).toBe(num(wm.totals[k]));
    }
    if (num(w.people_total) === w.people.length) {
      expect(sum(w.people, (p) => p.net_iqd)).toBe(num(w.totals.net_iqd));
      expect(sum(w.people, (p) => p.to_pay_iqd)).toBe(num(w.totals.to_pay_iqd));
    }
    expect(sum(w.by_branch_month, (x) => x.net_iqd)).toBe(num(w.totals.net_iqd));
    expect(num(w.totals.paid_from_bank_iqd)).toBe(950000);
    expect(num(w.totals.advances_given_iqd)).toBe(100000);
    const zed = w.people.find((p) => p.staff_id === ids.wz)!;
    expect([zed.status, num(zed.paid_iqd), zed.paid_from, num(zed.deductions_iqd)]).toEqual(['paid', 950000, 'bank', 50000]);
    expect(zed.lines?.map((l) => [l.kind, num(l.amount_iqd), l.note])).toEqual([
      ['deduction', 50000, 'MT short stock'],
      ['lateness', 0, null],
    ]);
    const amy = w.people.find((p) => p.staff_id === ids.wa)!;
    expect([num(amy.salary_iqd), num(amy.penalties_iqd), num(amy.advances_iqd), num(amy.to_pay_iqd)]).toEqual([800000, 5000, 100000, 695000]);
    expect(w.people.map((p) => p.staff_id)).not.toContain(ids.wb);
    expect(r.ord_wg?.data).toBe(true);
  });

  it('wages_summary: branch B alone in scope B; at most 12 pay months', () => {
    const b = out<Wages>('wg_b');
    expect(b.people.map((p) => p.staff_id)).toContain(ids.wb);
    expect(b.people.every((p) => p.branch === `MT branch B ${ids.tag}`)).toBe(true);
    expect(r.wg_wide?.ok).toBe(false);
    expect(r.wg_wide?.code).toMatch(/INVALID_RANGE/);
  });

  it('attendance_summary: totals are the sum of its people, name order, presence from till shifts, a coverage note', () => {
    const a = out<Attendance>('at_a');
    expect(a.coverage).toMatch(/no clock-in/);
    expect(a.people.map((p) => p.staff_id).sort()).toEqual([ids.wa, ids.wz].sort());
    for (const k of ['late_minutes', 'early_leave_minutes', 'penalty_days', 'penalties_iqd'] as const) {
      expect(num(a.totals[k]), k).toBe(sum(a.people, (p) => p[k]));
    }
    expect(num(a.totals.days_recorded)).toBe(sum(a.people, (p) => p.days));
    expect([num(a.totals.late_minutes), num(a.totals.penalty_days), num(a.totals.penalties_iqd)]).toEqual([25, 1, 5000]);
    expect(a.people.map((p) => p.staff_name)).toEqual(['LDB wa', 'LDB wz']);
    expect(a.presence.filter((p) => p.staff_id === ids.wa || p.staff_id === ids.wz).map((p) => [p.staff_name, num(p.shift_days)])).toEqual([
      ['LDB wa', 1],
      ['LDB wz', 1],
    ]);
    expect(r.ord_at?.data).toBe(true);
    expect(r.ord_pr?.data).toBe(true);
    const b = out<Attendance>('at_b');
    expect(b.people.map((p) => p.staff_id)).toEqual([ids.wb]);
  });
});
