/**
 * main cash (0343) and wage advances (0344): the branch's safe, the costs
 * paid out of it, the day-close hand-in per drawer box, and part of a wage
 * handed over early.
 *
 *   * the safe: main_cash_pay (safe or bank), main_cash_move (hand-in, float
 *     out, owner, bank), main_cash_count (the balance becomes the count, and a
 *     balance that moved meanwhile is MAIN_CASH_CHANGED), main_cash_void
 *     (reason required, once), and main_cash_overview's balance, costs by
 *     category, payees and today's in and out;
 *   * who: a manager and the owner; a cashier is refused everywhere and no
 *     client reads the table; a manager does not see the person on a wage or
 *     advance row;
 *   * day close: main_cash_day_boxes splits a day's cash by drawer box (the
 *     station's mode; anything else is the café till), less its cash refunds,
 *     and main_cash_hand_in_day hands each box in once;
 *   * advances: give_wage_advance (owner only, at most what is still owed,
 *     never into a paid month), wage_line's advances, owed_iqd and
 *     to_pay_iqd, mark_wage_paid paying the rest from the safe, the undo
 *     pair putting the money back, and an older client (no p_paid_from)
 *     recording nothing in the safe;
 *   * coach pay: coach_statement_mark_paid refuses an unknown p_paid_from
 *     before anything else.
 *
 * HOW. As reward-wages.test.ts: every scenario is ONE psql transaction that
 * is rolled back; staff, days, stations, tabs and payments are created inside
 * it as fixtures, and each client call runs as `authenticated` with the
 * caller's JWT claims. Without docker on PATH the suite skips itself.
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

const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('cashier', '${SEED_STAFF_IDS.cashier}'), ('venue', '${VENUE_A_ID}');

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
  perform set_config('request.jwt.claims', '', true);
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
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'mc-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'MC ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

-- Every test starts from an empty safe at the branch: the rows already there
-- (a dev's own) are voided inside the rolled-back transaction.
select set_config('request.jwt.claims', '', true);
update main_cash_entries set voided_at = now(), voided_by = '${SEED_STAFF_IDS.owner}', void_reason = 'test'
 where venue_id = '${VENUE_A_ID}' and voided_at is null;
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
/** A field of what a T(...) call returned, kept under `name`. */
const RES = (name: string, label: string, field: string) =>
  KEEP(name, `select res->'data'->>'${field}' from pg_temp.out where label = '${label}'`);

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

const pay = (label: string, who: string, amount: number, category: string, payee: string, from: string, key = 'null') =>
  T(label, who, `select app.main_cash_pay(${amount}, '${category}', '${payee}', '${from}', null, {{venue}}::uuid, ${key})`);
const move = (label: string, who: string, kind: string, amount: number, box = 'null') =>
  T(label, who, `select app.main_cash_move('${kind}', ${amount}, ${box}, null, {{venue}}::uuid)`);
const overview = (label: string, who: string) => T(label, who, `select app.main_cash_overview({{venue}}::uuid)`);

interface Overview {
  balance_iqd: number;
  today_figures: { in_iqd: number; out_iqd: number };
  last_count: { counted_iqd: number; difference_iqd: number } | null;
  costs: Array<{ category: string; total_iqd: number; count: number; from_bank_iqd: number }>;
  costs_total_iqd: number;
  entries: Array<{
    kind: string;
    source: string;
    category: string | null;
    payee: string | null;
    payee_hidden: boolean;
    voided_at: string | null;
    balance_after_iqd: number | null;
  }>;
  payees: Array<{ category: string; payee: string }>;
  boxes: string[];
  is_owner: boolean;
}

describe.skipIf(!docker)('main cash (rolled-back transactions)', () => {
  it('pays, moves, counts and voids, and the overview adds them up', () => {
    const r = scenario([
      move('owner_in', 'owner', 'owner_in', 1000000),
      pay('shop', 'manager', 50000, 'shopping', 'Al-Noor market', 'safe', `'mc:pay:1'`),
      pay('shop_again', 'manager', 50000, 'shopping', 'Al-Noor market', 'safe', `'mc:pay:1'`),
      pay('bank', 'owner', 200000, 'supplier', 'Ice supplier', 'bank'),
      pay('wage_cat', 'owner', 1000, 'wages', 'x', 'safe'),
      pay('bad_from', 'owner', 1000, 'other', 'x', 'drawer'),
      pay('zero', 'owner', 0, 'other', 'x', 'safe'),
      pay('cashier_pay', 'cashier', 1000, 'other', 'x', 'safe'),
      move('hand_in', 'manager', 'hand_in', 300000, `'desk'`),
      move('float', 'owner', 'to_drawer', 100000, `'cafe'`),
      move('no_box', 'owner', 'hand_in', 1000),
      move('bad_kind', 'owner', 'payment', 1000),
      // Balance: 1,000,000 - 50,000 + 300,000 - 100,000 = 1,150,000.
      T('count_stale', 'owner', `select app.main_cash_count(1145000, 1000000, null, {{venue}}::uuid)`),
      T('count', 'manager', `select app.main_cash_count(1145000, 1150000, 'short a note', {{venue}}::uuid)`),
      RES('shop_id', 'shop', 'id'),
      T('void_no_reason', 'owner', `select app.main_cash_void({{shop_id}}::uuid, '  ')`),
      T('void', 'owner', `select app.main_cash_void({{shop_id}}::uuid, 'Logged twice')`),
      T('void_again', 'owner', `select app.main_cash_void({{shop_id}}::uuid, 'Again')`),
      overview('ov', 'owner'),
      overview('ov_cashier', 'cashier'),
      T('direct_read', 'manager', `select to_jsonb(count(*)) from main_cash_entries`),
    ]);

    expect(ok<{ balance_iqd: number }>(r, 'owner_in').balance_iqd).toBe(1000000);
    expect(ok<{ balance_iqd: number }>(r, 'shop').balance_iqd).toBe(950000);
    expect(ok<{ duplicate?: boolean }>(r, 'shop_again').duplicate).toBe(true);
    expect(ok<{ balance_iqd: number }>(r, 'bank').balance_iqd).toBe(950000);
    expect(refused(r, 'wage_cat')).toBe('INVALID_ARGUMENT:category');
    expect(refused(r, 'bad_from')).toBe('INVALID_ARGUMENT:paid_from');
    expect(refused(r, 'zero')).toBe('INVALID_ARGUMENT:amount');
    expect(refused(r, 'cashier_pay')).toBe('FORBIDDEN');
    expect(ok<{ balance_iqd: number }>(r, 'hand_in').balance_iqd).toBe(1250000);
    expect(ok<{ balance_iqd: number }>(r, 'float').balance_iqd).toBe(1150000);
    expect(refused(r, 'no_box')).toBe('INVALID_ARGUMENT:box');
    expect(refused(r, 'bad_kind')).toBe('INVALID_ARGUMENT:kind');
    expect(refused(r, 'count_stale')).toBe('MAIN_CASH_CHANGED');
    expect(ok<{ balance_iqd: number; difference_iqd: number }>(r, 'count')).toMatchObject({
      balance_iqd: 1145000,
      difference_iqd: -5000,
    });
    expect(refused(r, 'void_no_reason')).toBe('REASON_REQUIRED');
    // The voided 50,000 comes back: 1,145,000 + 50,000.
    expect(ok<{ balance_iqd: number }>(r, 'void').balance_iqd).toBe(1195000);
    expect(refused(r, 'void_again')).toBe('INVALID_TRANSITION');
    expect(refused(r, 'ov_cashier')).toBe('FORBIDDEN');
    expect(r.direct_read!.ok).toBe(false);

    const ov = ok<Overview>(r, 'ov');
    expect(ov.balance_iqd).toBe(1195000);
    expect(ov.is_owner).toBe(true);
    expect(ov.boxes[0]).toBe('cafe');
    expect(ov.last_count).toMatchObject({ counted_iqd: 1145000, difference_iqd: -5000 });
    // Costs: the voided shopping row is out; the bank-paid supplier is in.
    expect(ov.costs).toEqual([{ category: 'supplier', total_iqd: 200000, count: 1, from_bank_iqd: 200000 }]);
    expect(ov.costs_total_iqd).toBe(200000);
    // Today's in and out leave the count's difference out (the voided row too).
    expect(ov.today_figures).toEqual({ in_iqd: 1300000, out_iqd: 100000 });
    expect(ov.payees).toEqual([{ category: 'supplier', payee: 'Ice supplier' }]);
    expect(ov.entries).toHaveLength(6);
    expect(ov.entries[0]).toMatchObject({ kind: 'count', balance_after_iqd: 1195000 });
    const voided = ov.entries.find((e) => e.voided_at !== null)!;
    expect(voided).toMatchObject({ kind: 'payment', category: 'shopping', balance_after_iqd: null });
  });

  it('splits a day by drawer box and hands each box in once', () => {
    const r = scenario([
      KEEP('day', `insert into day_sessions (venue_id, business_date, opened_by, opening_float_iqd)
                   values ({{venue}}, date '3000-01-01' + (random() * 900000)::int, {{owner}}::uuid, 50000)
                   returning id::text`),
      KEEP('desk_st', `insert into stations (id, venue_id, is_till, mode)
                       values ('MC-' || upper(substr(md5(random()::text), 1, 10)), {{venue}}, false, 'desk') returning id`),
      KEEP('tab', `insert into tabs (venue_id, day_session_id, label, kind)
                   values ({{venue}}, {{day}}::uuid, 'MC tab', 'cafe') returning id::text`),
      KEEP('p_desk', `insert into payments (venue_id, tab_id, day_session_id, method, amount_iqd, recorded_by, device_id)
                      values ({{venue}}, {{tab}}::uuid, {{day}}::uuid, 'cash', 70000, {{manager}}::uuid, {{desk_st}})
                      returning id::text`),
      KEEP('p_card', `insert into payments (venue_id, tab_id, day_session_id, method, amount_iqd, recorded_by, device_id)
                      values ({{venue}}, {{tab}}::uuid, {{day}}::uuid, 'card', 50000, {{manager}}::uuid, {{desk_st}})
                      returning id::text`),
      KEEP('p_cafe', `insert into payments (venue_id, tab_id, day_session_id, method, amount_iqd, recorded_by)
                      values ({{venue}}, {{tab}}::uuid, {{day}}::uuid, 'cash', 30000, {{cashier}}::uuid)
                      returning id::text`),
      KEEP('r_cafe', `insert into refunds (payment_id, amount_iqd, reason_code, refunded_by, venue_id)
                      values ({{p_cafe}}::uuid, 10000, 'other', {{manager}}::uuid, {{venue}}) returning id::text`),
      T('boxes', 'manager', `select app.main_cash_day_boxes({{day}}::uuid)`),
      T('boxes_cashier', 'cashier', `select app.main_cash_day_boxes({{day}}::uuid)`),
      T('hand_in', 'manager', `select app.main_cash_hand_in_day({{day}}::uuid,
                                 '[{"box":"cafe","amount_iqd":20000},{"box":"desk","amount_iqd":70000},{"box":"shop","amount_iqd":0}]'::jsonb)`),
      T('hand_in_again', 'owner', `select app.main_cash_hand_in_day({{day}}::uuid, '[{"box":"desk","amount_iqd":1}]'::jsonb)`),
      T('bad_box', 'owner', `select app.main_cash_hand_in_day({{day}}::uuid, '[{"box":"bar","amount_iqd":1}]'::jsonb)`),
      T('boxes_after', 'owner', `select app.main_cash_day_boxes({{day}}::uuid)`),
    ]);

    type Boxes = { boxes: Array<{ box: string; cash_in_iqd: number; cash_out_iqd: number; net_iqd: number; handed_in_iqd: number | null }> };
    const byBox = (b: Boxes) => Object.fromEntries(b.boxes.map((x) => [x.box, x]));
    const before = byBox(ok<Boxes>(r, 'boxes'));
    expect(before.cafe).toMatchObject({ cash_in_iqd: 30000, cash_out_iqd: 10000, net_iqd: 20000, handed_in_iqd: null });
    expect(before.desk).toMatchObject({ cash_in_iqd: 70000, cash_out_iqd: 0, net_iqd: 70000, handed_in_iqd: null });
    expect(refused(r, 'boxes_cashier')).toBe('FORBIDDEN');
    expect(ok<{ handed_in: number; total_iqd: number; balance_iqd: number }>(r, 'hand_in')).toMatchObject({
      handed_in: 2,
      total_iqd: 90000,
      balance_iqd: 90000,
    });
    expect(refused(r, 'hand_in_again')).toBe('MAIN_CASH_HANDED_IN:desk');
    expect(refused(r, 'bad_box')).toBe('INVALID_ARGUMENT:box');
    const after = byBox(ok<Boxes>(r, 'boxes_after'));
    expect(after.cafe!.handed_in_iqd).toBe(20000);
    expect(after.desk!.handed_in_iqd).toBe(70000);
  });
});

describe.skipIf(!docker)('wage advances (rolled-back transactions)', () => {
  const MONTH = KEEP('month', `select date_trunc('month', app.venue_business_date({{venue}}::uuid))::date::text`);
  const wageLine = (label: string, who = 'owner') =>
    T(label, who, `select p from jsonb_array_elements(app.wages_month({{venue}}, {{month}}::date)->'people') p
                    where p->>'staff_id' = {{w1}}`);
  interface Line {
    status: string;
    net_iqd: number;
    advances_iqd: number;
    advance_count: number;
    owed_iqd: number;
    to_pay_iqd: number;
    advances: Array<{ amount_iqd: number; paid_from: string }>;
    payment: { paid_iqd: number; advances_iqd: number; paid_from: string | null } | null;
  }

  it('an advance comes off what is paid at the end of the month, and the safe pays both', () => {
    const r = scenario([
      MONTH,
      MK('w1', 'waiter'),
      T('wage', 'owner', `select app.set_staff_wage({{w1}}::uuid, 500000, 28, {{month}}::date)`),
      move('fund', 'owner', 'owner_in', 1000000),
      T('adv_manager', 'manager', `select app.give_wage_advance({{w1}}::uuid, 100000, 'safe', {{month}}::date)`),
      T('adv_bad_from', 'owner', `select app.give_wage_advance({{w1}}::uuid, 100000, 'drawer', {{month}}::date)`),
      T('adv', 'owner', `select app.give_wage_advance({{w1}}::uuid, 100000, 'safe', {{month}}::date, 'Rent help', null, 'mc:adv:1')`),
      T('adv_dup', 'owner', `select app.give_wage_advance({{w1}}::uuid, 100000, 'safe', {{month}}::date, 'Rent help', null, 'mc:adv:1')`),
      T('adv_big', 'owner', `select app.give_wage_advance({{w1}}::uuid, 450000, 'bank', {{month}}::date)`),
      wageLine('line'),
      overview('ov_owner', 'owner'),
      overview('ov_manager', 'manager'),
      T('pay_wrong', 'owner', `select app.mark_wage_paid({{w1}}::uuid, {{month}}::date, 500000, null, null, 'safe', 500000)`),
      T('pay', 'owner', `select app.mark_wage_paid({{w1}}::uuid, {{month}}::date, 500000, null, null, 'safe', 400000)`),
      wageLine('line_paid'),
      overview('ov_paid', 'owner'),
      RES('adv_id', 'adv', 'id'),
      T('undo_adv_paid', 'owner', `select app.undo_wage_advance({{adv_id}}::uuid, 'Wrong person')`),
      RES('pay_id', 'pay', 'id'),
      T('undo_pay', 'owner', `select app.undo_wage_paid({{pay_id}}::uuid, 'Wrong month')`),
      T('undo_adv', 'owner', `select app.undo_wage_advance({{adv_id}}::uuid, 'Wrong person')`),
      T('undo_adv_again', 'owner', `select app.undo_wage_advance({{adv_id}}::uuid, 'Again')`),
      wageLine('line_undone'),
      overview('ov_undone', 'owner'),
      // An operator from before 0344 sends no p_paid_from: nothing in the safe.
      T('pay_old', 'owner', `select app.mark_wage_paid({{w1}}::uuid, {{month}}::date, 500000)`),
      overview('ov_old', 'owner'),
      Q('chk', `select to_jsonb(paid_iqd = greatest(net_iqd - advances_iqd, 0)) from wage_payments where id = {{pay_id}}::uuid`),
      T('coach_bad_from', 'manager', `select app.coach_statement_mark_paid(gen_random_uuid(), 'R-1', null, null, 'drawer')`),
    ]);

    expect(refused(r, 'adv_manager')).toBe('FORBIDDEN');
    expect(refused(r, 'adv_bad_from')).toBe('INVALID_ARGUMENT:paid_from');
    expect(ok<{ owed_iqd: number }>(r, 'adv').owed_iqd).toBe(400000);
    expect(ok<{ duplicate?: boolean }>(r, 'adv_dup').duplicate).toBe(true);
    expect(refused(r, 'adv_big')).toBe('WAGE_ADVANCE_TOO_LARGE:400000');

    const line = ok<Line>(r, 'line');
    expect(line).toMatchObject({ net_iqd: 500000, advances_iqd: 100000, advance_count: 1, owed_iqd: 400000, to_pay_iqd: 400000 });
    expect(line.advances).toEqual([expect.objectContaining({ amount_iqd: 100000, paid_from: 'safe' })]);

    const owner = ok<Overview>(r, 'ov_owner');
    expect(owner.balance_iqd).toBe(900000);
    const advRow = owner.entries.find((e) => e.source === 'wage_advance')!;
    expect(advRow).toMatchObject({ category: 'advance', payee: 'MC w1', payee_hidden: false });
    const managerRow = ok<Overview>(r, 'ov_manager').entries.find((e) => e.source === 'wage_advance')!;
    expect(managerRow).toMatchObject({ payee: null, payee_hidden: true });

    expect(refused(r, 'pay_wrong')).toBe('WAGE_CHANGED');
    expect(ok<{ paid_iqd: number; advances_iqd: number; paid_from: string }>(r, 'pay')).toMatchObject({
      paid_iqd: 400000,
      advances_iqd: 100000,
      paid_from: 'safe',
    });
    const paid = ok<Line>(r, 'line_paid');
    expect(paid).toMatchObject({ status: 'paid', advances_iqd: 100000, owed_iqd: 0, to_pay_iqd: 0 });
    expect(paid.payment).toMatchObject({ paid_iqd: 400000, advances_iqd: 100000, paid_from: 'safe' });
    expect(ok<Overview>(r, 'ov_paid').balance_iqd).toBe(500000);

    expect(refused(r, 'undo_adv_paid')).toBe('WAGE_ALREADY_PAID');
    ok(r, 'undo_pay');
    ok(r, 'undo_adv');
    expect(refused(r, 'undo_adv_again')).toBe('INVALID_TRANSITION');
    expect(ok<Line>(r, 'line_undone')).toMatchObject({ advances_iqd: 0, owed_iqd: 500000, to_pay_iqd: 500000 });
    // Both payments went back into the safe.
    expect(ok<Overview>(r, 'ov_undone').balance_iqd).toBe(1000000);

    expect(ok<{ paid_iqd: number; paid_from: string | null }>(r, 'pay_old')).toMatchObject({ paid_iqd: 500000, paid_from: null });
    expect(ok<Overview>(r, 'ov_old').balance_iqd).toBe(1000000);
    expect(ok<boolean>(r, 'chk')).toBe(true);
    expect(refused(r, 'coach_bad_from')).toBe('INVALID_ARGUMENT');
  });
});
