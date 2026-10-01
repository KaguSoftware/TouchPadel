/**
 * wages (0270–0272): the owner sets each person's salary and pay day, marks a
 * month paid, and is reminded when a wage is due; a manager records late
 * arrivals and early leaves, and a day over the branch's grace costs its
 * penalty; approved deductions and penalties come off the wage.
 *
 *   * who: only the owner reads or writes wages and payments; a manager or the
 *     owner records attendance for anyone active at the branch but an owner
 *     and themselves, and never reads a day about themselves; every other role
 *     is refused;
 *   * the pay day: 1 to 31, clamped to a shorter month's last day;
 *   * the penalty is per day: late + early minutes over X cost Y; the rule in
 *     force is copied onto the row, so changing it never rewrites a recorded
 *     day; Y = 0 is off;
 *   * a paid month is frozen: its days cannot change, its approved deductions
 *     cannot be cancelled, and a day recorded or a deduction approved later
 *     lands in the next unpaid month; "mark paid" refuses a net that moved
 *     (WAGE_CHANGED), a month already paid, and a month with no salary; an
 *     undo reopens the month;
 *   * the reminder: an unpaid month whose pay day is within wage_reminder_days
 *     is due, a past one overdue; a salary of 0 is never due;
 *   * another branch's rows are REF_NOT_FOUND or FORBIDDEN;
 *   * the LLM wall: no assistant_readable_columns row for the three tables,
 *     and every staff.wage.% / staff.attendance.% audit row carries {status}
 *     only.
 *
 * HOW. As salary-deductions.test.ts: every scenario is ONE psql transaction
 * that is rolled back; staff are created inside it and each call runs as
 * `authenticated` with the caller's JWT claims. Without docker on PATH the
 * suite skips itself.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { stackAvailable, SEED_STAFF_IDS, VENUE_A_ID } from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}
const docker = up && dockerReachable();

// ── the in-transaction harness (as salary-deductions.test.ts) ──────────────
const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('cashier', '${SEED_STAFF_IDS.cashier}'), ('desk', '${SEED_STAFF_IDS.court_desk}'),
  ('venue', '${VENUE_A_ID}');

create function pg_temp.sub(p_sql text) returns text language plpgsql as $f$
declare r record; v text := p_sql;
begin
  for r in select name, val from pg_temp.vars order by length(name) desc loop
    v := replace(v, '{{' || r.name || '}}', quote_literal(r.val));
  end loop;
  if v ~ '\\{\\{[a-z0-9_]+\\}\\}' then raise exception 'unbound variable in: %', v; end if;
  return v;
end $f$;

create function pg_temp.run(p_label text, p_who text, p_sql text, p_role text) returns void language plpgsql as $f$
declare v_uid text; v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_hint text;
begin
  select val into v_uid from pg_temp.vars where name = p_who;
  if v_uid is null then raise exception 'unknown principal %', p_who; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  if p_role is not null then execute 'set local role ' || p_role; end if;
  begin
    execute v_sql into v_res;
    reset role;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v_res));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    reset role;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'hint', nullif(v_hint, '')));
  end;
end $f$;

create function pg_temp.q(p_label text, p_sql text) returns void language plpgsql as $f$
declare v jsonb;
begin
  execute pg_temp.sub(p_sql) into v;
  insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
end $f$;

create function pg_temp.keep(p_name text, p_sql text) returns void language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', '', true);  -- 0230: a fixture write, not a staff write
  execute pg_temp.sub(p_sql) into v;
  if v is null then raise exception 'keep %: no value', p_name; end if;
  insert into pg_temp.vars values (p_name, v) on conflict (name) do update set val = excluded.val;
end $f$;

create function pg_temp.mk(p_name text, p_role staff_role) returns void language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'wg-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'WG ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;
`;

interface Outcome {
  ok: boolean;
  data?: unknown;
  code?: string;
  hint?: string | null;
}
type Results = Record<string, Outcome>;

function scenario(body: string[]): Results {
  const raw = psql(
    `begin;\n${PRELUDE}\n${body.join('\n')}\n` +
      `select label || E'\\t' || res::text from pg_temp.out order by seq;\nrollback;\n`,
  );
  const results: Results = {};
  for (const line of raw.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    results[line.slice(0, tab)] = JSON.parse(line.slice(tab + 1)) as Outcome;
  }
  return results;
}

const T = (label: string, who: string, sql: string) =>
  `select pg_temp.run('${label}', '${who}', $q$${sql}$q$, 'authenticated');`;
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const MK = (name: string, role: string) => `select pg_temp.mk('${name}', '${role}');`;

function ok<T>(r: Results, label: string): T {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.hint ?? ''}`).toBe(true);
  return o!.data as T;
}
function refused(r: Results, label: string): string {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail`).toBe(false);
  return o!.hint ? `${o!.code}:${o!.hint}` : o!.code!;
}

const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
const OTHER_VENUE = '00000000-0000-4000-8000-00000000d4d4';
const OTHER_VENUE_SQL = `insert into venues (id, slug, name_en, name_ar, is_active)
  values ('${OTHER_VENUE}', 'wg-other-venue', 'WG other', 'مكان آخر', false);`;
/** The venue's business day and its months, as the RPCs compute them. */
const DAYS = [
  KEEP('today', `select app.venue_business_date({{venue}}::uuid)::text`),
  KEEP('month', `select date_trunc('month', app.venue_business_date({{venue}}::uuid))::date::text`),
  KEEP('last_month', `select (date_trunc('month', app.venue_business_date({{venue}}::uuid)) - interval '1 month')::date::text`),
  KEEP('next_month', `select (date_trunc('month', app.venue_business_date({{venue}}::uuid)) + interval '1 month')::date::text`),
];

const setWage = (label: string, who: string, target: string, salary: number | string, payDay: number | string, from = 'null') =>
  T(label, who, `select app.set_staff_wage({{${target}}}::uuid, ${salary}, ${payDay}, ${from})`);
const record = (label: string, who: string, target: string, date: string, late: number, early: number, note = 'null') =>
  T(label, who, `select app.record_attendance({{${target}}}::uuid, ${date}, ${late}, ${early}, ${note})`);
const rule = (label: string, who: string, grace: number, penalty: number) =>
  T(label, who, `select app.set_cafe_settings(jsonb_build_object('attendance_grace_minutes', ${grace},
                                                                 'attendance_penalty_iqd', ${penalty}), {{venue}})`);
const line = (label: string, target: string, month: string) =>
  T(label, 'owner', `select p from jsonb_array_elements(app.wages_month({{venue}}, ${month})->'people') p
                      where p->>'staff_id' = {{${target}}}`);

interface Line {
  status: string;
  salary_iqd: number;
  pay_day: number | null;
  due_date: string | null;
  deductions_iqd: number;
  deduction_count: number;
  penalties_iqd: number;
  penalty_days: number;
  net_iqd: number;
  payment: { id: string; status: string; paid_iqd: number; undo_reason: string | null } | null;
  [k: string]: unknown;
}

describe.skipIf(!docker)('wages (rolled-back transactions)', () => {
  it('only the owner reads and writes wages; the limits hold', () => {
    const r = scenario([
      ...DAYS,
      MK('bar', 'barista'), MK('mgr2', 'manager'),
      setWage('set_bar', 'owner', 'bar', 500000, 25),
      KEEP('expect_from', `select (case when app.wage_due_date({{month}}::date, 25) >= {{today}}::date
                                        then {{month}}::date else {{next_month}}::date end)::text`),
      setWage('set_mgr2', 'owner', 'mgr2', 900000, 1, '{{month}}::date'),
      setWage('replace_mgr2', 'owner', 'mgr2', 950000, 2, '{{month}}::date'),
      setWage('by_manager', 'manager', 'bar', 1, 1),
      setWage('by_cashier', 'cashier', 'bar', 1, 1),
      setWage('owner_target', 'owner', 'owner', 1, 1),
      setWage('negative', 'owner', 'bar', -1, 1),
      setWage('too_much', 'owner', 'bar', 100000001, 1),
      setWage('day0', 'owner', 'bar', 1, 0),
      setWage('day32', 'owner', 'bar', 1, 32),
      setWage('far', 'owner', 'bar', 1, 1, `({{month}}::date + interval '13 months')::date`),
      T('read_owner', 'owner', `select to_jsonb(count(*)) from staff_wages where staff_id in ({{bar}}::uuid, {{mgr2}}::uuid)`),
      T('read_manager', 'manager', `select to_jsonb(count(*)) from staff_wages`),
      T('read_pay_manager', 'manager', `select to_jsonb(count(*)) from wage_payments`),
      T('month_manager', 'manager', `select app.wages_month({{venue}})`),
      T('due_manager', 'manager', `select app.wages_due({{venue}})`),
      T('mark_manager', 'manager', `select app.mark_wage_paid({{bar}}::uuid, {{month}}::date)`),
      T('undo_manager', 'manager', `select app.undo_wage_paid(gen_random_uuid(), 'x')`),
      T('month_cashier', 'cashier', `select app.wages_month({{venue}})`),
      Q('clamp', `select jsonb_build_object(
                    'feb',  app.wage_due_date('2027-02-10', 31),
                    'leap', app.wage_due_date('2028-02-01', 30),
                    'apr',  app.wage_due_date('2026-04-15', 31),
                    'jan',  app.wage_due_date('2026-01-01', 31),
                    'd15',  app.wage_due_date('2026-11-30', 15))`),
      Q('who', `select jsonb_build_object('expect_from', {{expect_from}}, 'month', {{month}})`),
    ]);
    const who = ok<Record<string, string>>(r, 'who');
    // The default month is the first pay day from today.
    expect(ok(r, 'set_bar')).toMatchObject({ effective_month: who.expect_from, salary_iqd: 500000, pay_day: 25, replaced: false });
    expect(ok(r, 'set_mgr2')).toMatchObject({ effective_month: who.month, replaced: false });
    expect(ok(r, 'replace_mgr2')).toMatchObject({ effective_month: who.month, salary_iqd: 950000, pay_day: 2, replaced: true });
    for (const l of ['by_manager', 'by_cashier', 'month_manager', 'due_manager', 'mark_manager', 'undo_manager', 'month_cashier']) {
      expect(refused(r, l), l).toBe('FORBIDDEN');
    }
    expect(refused(r, 'owner_target')).toBe('FORBIDDEN:staff_id');
    expect(refused(r, 'negative')).toBe('INVALID_AMOUNT');
    expect(refused(r, 'too_much')).toBe('INVALID_AMOUNT');
    expect(refused(r, 'day0')).toBe('INVALID_ARGUMENT:pay_day');
    expect(refused(r, 'day32')).toBe('INVALID_ARGUMENT:pay_day');
    expect(refused(r, 'far')).toBe('INVALID_ARGUMENT:month');
    expect(ok<number>(r, 'read_owner')).toBe(2);
    expect(ok<number>(r, 'read_manager')).toBe(0);
    expect(ok<number>(r, 'read_pay_manager')).toBe(0);
    // A month shorter than the pay day pays on its last day.
    expect(ok(r, 'clamp')).toEqual({ feb: '2027-02-28', leap: '2028-02-29', apr: '2026-04-30', jan: '2026-01-31', d15: '2026-11-15' });
  });

  it('a day over the grace costs the penalty; the rule in force is copied onto the row', () => {
    const r = scenario([
      ...DAYS,
      MK('bar', 'barista'), MK('mgr2', 'manager'),
      // Off by default: nothing is taken until a manager sets it.
      record('off', 'manager', 'bar', '{{today}}::date', 120, 0),
      rule('rule_mgr', 'manager', 15, 5000),
      record('over', 'manager', 'bar', '{{today}}::date - 1', 20, 0),
      record('at', 'manager', 'bar', '{{today}}::date - 2', 10, 5),
      record('early', 'manager', 'bar', '{{today}}::date - 3', 0, 16, `'Left for the bank'`),
      rule('rule_owner', 'owner', 15, 9000),
      record('dearer', 'owner', 'bar', '{{today}}::date - 4', 30, 0),
      // Recording the same day again replaces it, under the rule now.
      record('again', 'manager', 'bar', '{{today}}::date - 1', 25, 0),
      record('mgr2_day', 'manager', 'mgr2', '{{today}}::date', 40, 0),
      record('self', 'manager', 'manager', '{{today}}::date', 5, 0),
      record('of_owner', 'manager', 'owner', '{{today}}::date', 5, 0),
      record('by_cashier', 'cashier', 'bar', '{{today}}::date', 5, 0),
      record('tomorrow', 'manager', 'bar', '{{today}}::date + 1', 5, 0),
      record('day61', 'manager', 'bar', '{{today}}::date - 61', 5, 0),
      record('none', 'manager', 'bar', '{{today}}::date', 0, 0),
      record('negative', 'manager', 'bar', '{{today}}::date', -1, 5),
      record('too_long', 'manager', 'bar', '{{today}}::date', 0, 721),
      record('long_note', 'manager', 'bar', '{{today}}::date', 5, 0, `repeat('n', 301)`),
      T('owner_key', 'manager', `select app.set_cafe_settings(jsonb_build_object('wage_reminder_days', 1), {{venue}})`),
      Q('rows', `select jsonb_object_agg(work_date - {{today}}::date,
                                         jsonb_build_object('penalty', penalty_iqd, 'grace', grace_minutes, 'rule', penalty_rule_iqd,
                                                            'pay_month', pay_month = date_trunc('month', work_date)::date))
                   from staff_attendance where staff_id = {{bar}}::uuid`),
      T('month_mgr', 'manager', `select app.attendance_month({{venue}})`),
      T('month_mgr2', 'mgr2', `select app.attendance_month({{venue}})`),
      T('rows_mgr2', 'mgr2', `select to_jsonb(count(*)) from staff_attendance where staff_id = {{mgr2}}::uuid`),
      T('rows_mgr', 'manager', `select to_jsonb(count(*)) from staff_attendance where staff_id = {{mgr2}}::uuid`),
      T('rows_cashier', 'cashier', `select to_jsonb(count(*)) from staff_attendance`),
      T('month_cashier', 'cashier', `select app.attendance_month({{venue}})`),
      RES('mgr2_day', 'mgr2_day', 'id'),
      RES('early_id', 'early', 'id'),
      T('clear_own', 'mgr2', `select app.clear_attendance({{mgr2_day}}::uuid)`),
      T('clear_cashier', 'cashier', `select app.clear_attendance({{early_id}}::uuid)`),
      T('clear', 'manager', `select app.clear_attendance({{early_id}}::uuid)`),
      T('clear_again', 'manager', `select app.clear_attendance({{early_id}}::uuid)`),
      Q('who', `select jsonb_build_object('bar', {{bar}}, 'mgr2', {{mgr2}}, 'manager', {{manager}})`),
    ]);
    const who = ok<Record<string, string>>(r, 'who');
    expect(ok(r, 'off')).toMatchObject({ penalty_iqd: 0, replaced: false });
    ok(r, 'rule_mgr');
    ok(r, 'rule_owner');
    expect(ok(r, 'over')).toMatchObject({ penalty_iqd: 5000 });
    expect(ok(r, 'at')).toMatchObject({ penalty_iqd: 0 }); // 15 is not more than 15
    expect(ok(r, 'early')).toMatchObject({ penalty_iqd: 5000 });
    expect(ok(r, 'dearer')).toMatchObject({ penalty_iqd: 9000 });
    expect(ok(r, 'again')).toMatchObject({ penalty_iqd: 9000, replaced: true });
    // Rows recorded before the change keep its rule; each lands in its own month.
    const rows = ok<Record<string, { penalty: number; grace: number; rule: number; pay_month: boolean }>>(r, 'rows');
    expect(rows['0']).toEqual({ penalty: 0, grace: 0, rule: 0, pay_month: true });
    expect(rows['-2']).toEqual({ penalty: 0, grace: 15, rule: 5000, pay_month: true });
    expect(rows['-4']).toEqual({ penalty: 9000, grace: 15, rule: 9000, pay_month: true });

    for (const l of ['self', 'of_owner']) expect(refused(r, l), l).toBe('FORBIDDEN:staff_id');
    for (const l of ['by_cashier', 'month_cashier', 'clear_cashier']) expect(refused(r, l), l).toBe('FORBIDDEN');
    expect(refused(r, 'tomorrow')).toBe('INVALID_ARGUMENT:date');
    expect(refused(r, 'day61')).toBe('INVALID_ARGUMENT:date');
    expect(refused(r, 'none')).toBe('INVALID_ARGUMENT:minutes');
    expect(refused(r, 'negative')).toBe('INVALID_ARGUMENT:late_minutes');
    expect(refused(r, 'too_long')).toBe('INVALID_ARGUMENT:early_leave_minutes');
    expect(refused(r, 'long_note')).toBe('TEXT_TOO_LONG:note');
    expect(refused(r, 'owner_key')).toBe('FORBIDDEN');

    // The month view: the rule, who may be recorded, and never the caller.
    type Month = { rule: { grace_minutes: number; penalty_iqd: number }; staff: Array<{ id: string }>;
                   people: Array<{ staff_id: string; days: unknown[] }> };
    const m = ok<Month>(r, 'month_mgr');
    expect(m.rule).toEqual({ grace_minutes: 15, penalty_iqd: 9000 });
    expect(m.staff.map((s) => s.id)).toEqual(expect.arrayContaining([who.bar, who.mgr2]));
    expect(m.staff.map((s) => s.id)).not.toContain(who.manager);
    expect(m.staff.map((s) => s.id)).not.toContain(SEED_STAFF_IDS.owner);
    expect(m.people.map((p) => p.staff_id)).toContain(who.mgr2);
    expect(ok<Month>(r, 'month_mgr2').people.map((p) => p.staff_id)).not.toContain(who.mgr2);
    expect(ok<number>(r, 'rows_mgr2')).toBe(0);
    expect(ok<number>(r, 'rows_mgr')).toBe(1);
    expect(ok<number>(r, 'rows_cashier')).toBe(0);
    expect(refused(r, 'clear_own')).toBe('REF_NOT_FOUND:id');
    expect(ok(r, 'clear')).toEqual({ status: 'cleared' });
    expect(refused(r, 'clear_again')).toBe('REF_NOT_FOUND:id');
  });

  it('a paid month is frozen; later days and approvals land in the next unpaid month; undo reopens it', () => {
    const r = scenario([
      ...DAYS,
      MK('bar', 'barista'), MK('hb', 'head_barista'),
      rule('rule', 'manager', 15, 5000),
      setWage('wage', 'owner', 'bar', 500000, 28, '{{last_month}}::date'),
      // Last month: one day over the grace, recorded before it is paid.
      record('day_a', 'manager', 'bar', '{{last_month}}::date + 26', 30, 0), RES('day_a', 'day_a', 'id'),
      line('last_before', 'bar', '{{last_month}}::date'),
      T('stale', 'owner', `select app.mark_wage_paid({{bar}}::uuid, {{last_month}}::date, 1)`),
      T('pay_last', 'owner', `select app.mark_wage_paid({{bar}}::uuid, {{last_month}}::date, 495000, null, 'WG-KEY-1')`),
      T('pay_replay', 'owner', `select app.mark_wage_paid({{bar}}::uuid, {{last_month}}::date, 495000, null, 'WG-KEY-1')`),
      T('pay_twice', 'owner', `select app.mark_wage_paid({{bar}}::uuid, {{last_month}}::date)`),
      // The paid month is frozen; a new day dated in it lands in this month.
      record('edit_a', 'manager', 'bar', '{{last_month}}::date + 26', 5, 0),
      T('clear_a', 'manager', `select app.clear_attendance({{day_a}}::uuid)`),
      record('day_b', 'manager', 'bar', '{{last_month}}::date + 27', 40, 0),
      // This month: a deduction approved, then the month paid.
      T('prop1', 'hb', `select app.propose_deduction({{bar}}::uuid, 20000, {{today}}::date, 'Broke a cup')`), RES('d1', 'prop1', 'id'),
      T('approve1', 'owner', `select app.decide_deduction({{d1}}::uuid, true)`),
      line('this_before', 'bar', '{{month}}::date'),
      T('pay_this', 'owner', `select app.mark_wage_paid({{bar}}::uuid, {{month}}::date, 475000)`), RES('pay_this', 'pay_this', 'id'),
      // Approved after this month was paid: next month.
      T('prop2', 'hb', `select app.propose_deduction({{bar}}::uuid, 7000, {{today}}::date, 'Late again')`), RES('d2', 'prop2', 'id'),
      T('approve2', 'owner', `select app.decide_deduction({{d2}}::uuid, true)`),
      T('owner_entry', 'owner', `select app.propose_deduction({{bar}}::uuid, 3000, {{today}}::date, 'Uniform')`),
      T('cancel1', 'owner', `select app.cancel_deduction({{d1}}::uuid, 'x')`),
      T('cancel2', 'owner', `select app.cancel_deduction({{d2}}::uuid, 'Wrong person')`),
      T('page', 'owner', `select app.deductions_page({{venue}}, 'all', 200)`),
      T('dmonth', 'owner', `select app.deductions_month({{venue}})`),
      T('pay_far', 'owner', `select app.mark_wage_paid({{bar}}::uuid, ({{next_month}}::date + interval '1 month')::date)`),
      // Undo: the owner only, with a reason; then the month adds up afresh.
      T('undo_mgr', 'manager', `select app.undo_wage_paid({{pay_this}}::uuid, 'x')`),
      T('undo_bare', 'owner', `select app.undo_wage_paid({{pay_this}}::uuid, '  ')`),
      T('undo', 'owner', `select app.undo_wage_paid({{pay_this}}::uuid, 'Paid the wrong person')`),
      T('undo_again', 'owner', `select app.undo_wage_paid({{pay_this}}::uuid, 'x')`),
      line('this_undone', 'bar', '{{month}}::date'),
      T('pay_again', 'owner', `select app.mark_wage_paid({{bar}}::uuid, {{month}}::date, 475000)`),
      Q('days', `select jsonb_object_agg(work_date - {{last_month}}::date, pay_month) from staff_attendance where staff_id = {{bar}}::uuid`),
      Q('deds', `select jsonb_object_agg(amount_iqd, jsonb_build_object('status', status, 'pay_month', pay_month))
                   from salary_deductions where staff_id = {{bar}}::uuid`),
      Q('snap', `select jsonb_agg(jsonb_build_object('month', pay_month, 'net', net_iqd, 'paid', paid_iqd, 'status', status) order by pay_month)
                   from wage_payments where staff_id = {{bar}}::uuid`),
      T('nobody', 'owner', `select app.mark_wage_paid({{hb}}::uuid, {{month}}::date)`),
      Q('who', `select jsonb_build_object('month', {{month}}, 'last_month', {{last_month}}, 'next_month', {{next_month}},
                                          'd1', {{d1}}, 'd2', {{d2}}, 'pay_this', {{pay_this}}, 'bar', {{bar}})`),
    ]);
    const who = ok<Record<string, string>>(r, 'who');
    ok(r, 'wage');
    const lastBefore = ok<Line>(r, 'last_before');
    expect(lastBefore).toMatchObject({ salary_iqd: 500000, penalties_iqd: 5000, penalty_days: 1, deductions_iqd: 0, net_iqd: 495000 });
    expect(['overdue', 'due']).toContain(lastBefore.status);
    expect(refused(r, 'stale')).toBe('WAGE_CHANGED');
    expect(ok(r, 'pay_last')).toMatchObject({ status: 'paid', pay_month: who.last_month, net_iqd: 495000, paid_iqd: 495000 });
    expect(ok(r, 'pay_replay')).toMatchObject({ status: 'paid', duplicate: true });
    expect(refused(r, 'pay_twice')).toBe('WAGE_ALREADY_PAID');
    expect(refused(r, 'edit_a')).toBe('WAGE_ALREADY_PAID');
    expect(refused(r, 'clear_a')).toBe('WAGE_ALREADY_PAID');
    expect(ok(r, 'day_b')).toMatchObject({ penalty_iqd: 5000, pay_month: who.month });

    expect(ok(r, 'approve1')).toMatchObject({ status: 'approved', pay_month: who.month });
    expect(ok<Line>(r, 'this_before')).toMatchObject({ salary_iqd: 500000, deductions_iqd: 20000, penalties_iqd: 5000, net_iqd: 475000 });
    expect(ok(r, 'pay_this')).toMatchObject({ status: 'paid', paid_iqd: 475000 });
    expect(ok(r, 'approve2')).toMatchObject({ status: 'approved', pay_month: who.next_month });
    expect(ok(r, 'owner_entry')).toMatchObject({ status: 'approved', pay_month: who.next_month });
    expect(refused(r, 'cancel1')).toBe('WAGE_ALREADY_PAID');
    expect(ok(r, 'cancel2')).toMatchObject({ status: 'cancelled' });
    const page = ok<{ deductions: Array<{ id: string; can_cancel: boolean }> }>(r, 'page');
    expect(page.deductions.find((d) => d.id === who.d1)).toMatchObject({ can_cancel: false });
    const dmonth = ok<{ people: Array<{ staff_id: string; wage_paid: boolean }> }>(r, 'dmonth');
    expect(dmonth.people.find((p) => p.staff_id === who.bar)).toMatchObject({ wage_paid: true });
    expect(refused(r, 'pay_far')).toBe('INVALID_ARGUMENT:month');

    expect(refused(r, 'undo_mgr')).toBe('FORBIDDEN');
    expect(refused(r, 'undo_bare')).toBe('REASON_REQUIRED');
    expect(ok(r, 'undo')).toMatchObject({ status: 'undone' });
    expect(refused(r, 'undo_again')).toBe('INVALID_TRANSITION');
    const undone = ok<Line>(r, 'this_undone');
    expect(undone.status).not.toBe('paid');
    expect(undone.payment).toMatchObject({ status: 'undone', undo_reason: 'Paid the wrong person' });
    // Paying again reuses the month's row.
    expect(ok(r, 'pay_again')).toMatchObject({ id: who.pay_this, status: 'paid', paid_iqd: 475000 });

    expect(ok(r, 'days')).toEqual({ '26': who.last_month, '27': who.month });
    expect(ok(r, 'deds')).toEqual({
      '20000': { status: 'approved', pay_month: who.month },
      '7000': { status: 'cancelled', pay_month: who.next_month },
      '3000': { status: 'approved', pay_month: who.next_month },
    });
    expect(ok(r, 'snap')).toEqual([
      { month: who.last_month, net: 495000, paid: 495000, status: 'paid' },
      { month: who.month, net: 475000, paid: 475000, status: 'paid' },
    ]);
    expect(refused(r, 'nobody')).toBe('WAGE_NOT_SET');
  });

  it('pays nothing below zero and carries nothing over', () => {
    const r = scenario([
      ...DAYS,
      MK('bar', 'barista'),
      setWage('wage', 'owner', 'bar', 10000, 28, '{{month}}::date'),
      T('ded', 'owner', `select app.propose_deduction({{bar}}::uuid, 25000, {{today}}::date, 'Broken till')`),
      line('line', 'bar', '{{month}}::date'),
      T('pay', 'owner', `select app.mark_wage_paid({{bar}}::uuid, {{month}}::date, -15000)`),
    ]);
    expect(ok(r, 'ded')).toMatchObject({ status: 'approved' });
    expect(ok<Line>(r, 'line')).toMatchObject({ salary_iqd: 10000, deductions_iqd: 25000, net_iqd: -15000 });
    expect(ok(r, 'pay')).toMatchObject({ net_iqd: -15000, paid_iqd: 0 });
  });

  it('reminds the owner of wages due within the window and overdue ones', () => {
    const r = scenario([
      ...DAYS,
      MK('today_pay', 'barista'), MK('old', 'chef'), MK('zero', 'waiter'), MK('gone', 'barista'),
      T('remind', 'owner', `select app.set_cafe_settings(jsonb_build_object('wage_reminder_days', 0), {{venue}})`),
      // Paid today: due. Paid on the 1st since last month: last month overdue.
      setWage('w_today', 'owner', 'today_pay', 400000, `extract(day from {{today}}::date)::int`, '{{month}}::date'),
      setWage('w_old', 'owner', 'old', 300000, 1, '{{last_month}}::date'),
      setWage('w_zero', 'owner', 'zero', 0, 1, '{{last_month}}::date'),
      setWage('w_gone', 'owner', 'gone', 300000, 1, '{{last_month}}::date'),
      KEEP('off', `update staff set is_active = false where id = {{gone}}::uuid returning id::text`),
      T('due', 'owner', `select app.wages_due({{venue}})`),
      T('pay_old', 'owner', `select app.mark_wage_paid({{old}}::uuid, {{last_month}}::date)`),
      T('due_after', 'owner', `select app.wages_due({{venue}})`),
      Q('who', `select jsonb_build_object('today_pay', {{today_pay}}, 'old', {{old}}, 'zero', {{zero}}, 'gone', {{gone}},
                                          'month', {{month}}, 'last_month', {{last_month}})`),
    ]);
    const who = ok<Record<string, string>>(r, 'who');
    ok(r, 'remind');
    type Due = { remind_days: number; count: number; overdue_count: number;
                 people: Array<{ staff_id: string; month: string; status: string }> };
    const due = ok<Due>(r, 'due');
    expect(due.remind_days).toBe(0);
    const of = (d: Due, id: string) => d.people.filter((p) => p.staff_id === id).map((p) => [p.month, p.status]);
    expect(of(due, who.today_pay!)).toEqual([[who.month, 'due']]);
    expect(of(due, who.old!)).toContainEqual([who.last_month, 'overdue']);
    expect(of(due, who.zero!)).toEqual([]);
    expect(of(due, who.gone!)).toEqual([]);
    expect(due.count).toBe(due.people.length);
    expect(due.overdue_count).toBe(due.people.filter((p) => p.status === 'overdue').length);
    ok(r, 'pay_old');
    expect(of(ok<Due>(r, 'due_after'), who.old!)).not.toContainEqual([who.last_month, 'overdue']);
  });

  it('refuses another branch', () => {
    const r = scenario([
      ...DAYS,
      OTHER_VENUE_SQL,
      MK('bar', 'barista'),
      KEEP('far_pay', `insert into wage_payments (venue_id, staff_id, pay_month, due_date, salary_iqd, deductions_iqd,
                                                  deduction_count, penalties_iqd, penalty_days, net_iqd, paid_iqd, paid_by)
                       values ('${OTHER_VENUE}', {{bar}}::uuid, {{month}}::date, {{month}}::date, 1, 0, 0, 0, 0, 1, 1,
                               {{owner}}::uuid) returning id::text`),
      KEEP('far_day', `insert into staff_attendance (venue_id, staff_id, work_date, late_minutes, grace_minutes,
                                                     penalty_rule_iqd, pay_month, recorded_by)
                       values ('${OTHER_VENUE}', {{bar}}::uuid, {{today}}::date, 5, 0, 0, {{month}}::date,
                               {{manager}}::uuid) returning id::text`),
      T('set_far', 'owner', `select app.set_staff_wage({{bar}}::uuid, 1, 1, null, '${OTHER_VENUE}')`),
      T('month_far', 'owner', `select app.wages_month('${OTHER_VENUE}')`),
      T('undo_far', 'owner', `select app.undo_wage_paid({{far_pay}}::uuid, 'x')`),
      T('clear_far', 'manager', `select app.clear_attendance({{far_day}}::uuid)`),
      T('record_far', 'manager', `select app.record_attendance({{bar}}::uuid, {{today}}::date, 5, 0, null, '${OTHER_VENUE}')`),
    ]);
    for (const l of ['set_far', 'month_far', 'record_far']) expect(refused(r, l), l).toBe('FORBIDDEN');
    for (const l of ['undo_far', 'clear_far']) expect(refused(r, l), l).toBe('REF_NOT_FOUND:id');
  });

  it('keeps wages from the owner assistant: no readable column, and audit rows carry {status} only', () => {
    const r = scenario([
      ...DAYS,
      MK('bar', 'barista'),
      rule('rule', 'manager', 0, 4000),
      setWage('wage', 'owner', 'bar', 600000, 28, '{{month}}::date'), RES('wage', 'wage', 'id'),
      record('day', 'manager', 'bar', '{{today}}::date', 12, 0, `'Traffic'`), RES('day', 'day', 'id'),
      T('pay', 'owner', `select app.mark_wage_paid({{bar}}::uuid, {{month}}::date, 596000)`), RES('pay', 'pay', 'id'),
      T('undo', 'owner', `select app.undo_wage_paid({{pay}}::uuid, 'Paid by mistake')`),
      T('clear', 'manager', `select app.clear_attendance({{day}}::uuid)`),
      Q('columns', `select to_jsonb(count(*)) from app.assistant_readable_columns
                     where table_name in ('staff_wages', 'wage_payments', 'staff_attendance')`),
      Q('audit', `select jsonb_agg(jsonb_build_object('action', a.action, 'entity', a.entity, 'before', a.before,
                                                      'after', a.after, 'reason_code', a.reason_code) order by a.id)
                    from audit_log a
                   where (a.action like 'staff.wage.%' or a.action like 'staff.attendance.%')
                     and a.entity_id in ({{wage}}, {{day}}, {{pay}})`),
    ]);
    for (const l of ['wage', 'day', 'pay', 'undo', 'clear']) ok(r, l);
    expect(ok<number>(r, 'columns')).toBe(0);
    const audit = ok<Array<{ action: string; entity: string; before: object | null; after: object; reason_code: null }>>(r, 'audit');
    expect(audit.map((a) => a.action).sort()).toEqual([
      'staff.attendance.clear', 'staff.attendance.record', 'staff.wage.paid', 'staff.wage.set', 'staff.wage.undo',
    ]);
    for (const a of audit) {
      expect(a.reason_code).toBeNull();
      for (const side of [a.before, a.after]) {
        if (side !== null) expect(Object.keys(side)).toEqual(['status']);
      }
    }
    expect(JSON.stringify(audit)).not.toMatch(/600000|596000|4000|Traffic|mistake|WG bar/);
  });
});
