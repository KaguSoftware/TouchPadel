/**
 * scan_hardening (0240): the scanned-paper audit fixes of 2026-09-27.
 *
 *   * a reading holds a lease (reading_token): a stale token neither stores
 *     nor ends it; a reading that tried nothing is given back and not counted;
 *   * a paper is read at most three times; staff below MGMT ask for at most
 *     100 readings a day; a re-read that fails keeps the earlier lines;
 *   * a stored reading drops wrong types, unknown flags, a future date and
 *     never raises on them; a long table number does not overflow;
 *   * the sweeper ends a reading older than three minutes;
 *   * send: several open tabs is TAB_AMBIGUOUS, another branch's table is
 *     VENUE_MISMATCH; a cashier cannot re-point an alias, a manager can
 *     (audited);
 *   * confirm keeps the guessed supplier; evidence photos are not deletable
 *     by hand and set-aside papers are purged on schedule; a former driver no
 *     longer reads their receipts.
 *
 * HOW. The order-slips.test.ts harness (one rolled-back psql transaction per
 * scenario). Without docker on PATH the suite skips itself.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { stackAvailable, SEED_STAFF_IDS, SEED_TAX_GROUP_STANDARD, VENUE_A_ID } from './helpers';

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

const OTHER_VENUE = '00000000-0000-4000-8000-00000000c5c5';
const TABLE_NO = '8741';

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

create function pg_temp.t(p_label text, p_who text, p_sql text) returns void language plpgsql as $f$
declare v_uid text; v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_hint text;
begin
  select val into v_uid from pg_temp.vars where name = p_who;
  if v_uid is null then raise exception 'unknown principal %', p_who; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
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

create function pg_temp.svc(p_label text, p_sql text) returns void language plpgsql as $f$
declare v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_hint text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
  set local role service_role;
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
  perform set_config('request.jwt.claims', '', true);
  execute pg_temp.sub(p_sql) into v;
  if v is null then raise exception 'keep %: no value', p_name; end if;
  insert into pg_temp.vars values (p_name, v) on conflict (name) do update set val = excluded.val;
end $f$;

create function pg_temp.mk(p_name text, p_role staff_role) returns void language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'os-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'OS ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

select pg_temp.mk('wtr', 'waiter');
select pg_temp.mk('drv', 'driver');
select pg_temp.mk('mkt', 'marketing');

-- An open day at venue A (inside this transaction only).
do $d$
begin
  if not exists (select 1 from day_sessions where venue_id = '${VENUE_A_ID}' and status in ('open','closing')) then
    insert into day_sessions (business_date, opened_by, opening_float_iqd, venue_id)
    values (date '3000-01-01' + (random() * 300000)::int, '${SEED_STAFF_IDS.owner}', 0, '${VENUE_A_ID}');
  end if;
end $d$;

-- A menu of our own, with words nothing else on the menu uses.
with c as (
  insert into menu_categories (name_en, name_ar, tax_group_id, venue_id, kind)
  values ('OS drinks', 'مشروبات', '${SEED_TAX_GROUP_STANDARD}', '${VENUE_A_ID}', 'cafe') returning id)
insert into vars select 'cat', id::text from c;
insert into menu_items (category_id, name_en, name_ar, venue_id)
select val::uuid, 'Zanzibar Latte', 'لاتيه زنجبار', '${VENUE_A_ID}' from vars where name = 'cat';
insert into vars select 'latte', id::text from menu_items where name_en = 'Zanzibar Latte' and venue_id = '${VENUE_A_ID}';
insert into menu_items (category_id, name_en, name_ar, venue_id)
select val::uuid, 'Qarmat Karak', 'كرك قرمطي', '${VENUE_A_ID}' from vars where name = 'cat';
insert into vars select 'karak', id::text from menu_items where name_en = 'Qarmat Karak' and venue_id = '${VENUE_A_ID}';
insert into menu_item_variants (item_id, name_en, name_ar, price_iqd, is_default, sort_order)
select (select val::uuid from vars where name = 'latte'), 'Regular', 'عادي', 4000, true, 1
union all select (select val::uuid from vars where name = 'latte'), 'Large', 'كبير', 5000, false, 2
union all select (select val::uuid from vars where name = 'karak'), 'Regular', 'عادي', 2000, true, 1;
insert into vars select 'latte_r', id::text from menu_item_variants where item_id = (select val::uuid from vars where name = 'latte') and is_default;
insert into vars select 'latte_l', id::text from menu_item_variants where item_id = (select val::uuid from vars where name = 'latte') and not is_default;
insert into vars select 'karak_r', id::text from menu_item_variants where item_id = (select val::uuid from vars where name = 'karak');
-- Karak needs one sugar choice (min_select 1).
insert into modifier_groups (name_en, name_ar, min_select, max_select, venue_id) values ('OS sugar', 'سكر', 1, 1, '${VENUE_A_ID}');
insert into vars select 'sugar_grp', id::text from modifier_groups where name_en = 'OS sugar';
insert into modifiers (group_id, name_en, name_ar) select val::uuid, 'No sugar', 'بدون سكر' from vars where name = 'sugar_grp';
insert into vars select 'no_sugar', id::text from modifiers where name_en = 'No sugar' and group_id = (select val::uuid from vars where name = 'sugar_grp');
insert into menu_item_modifier_groups (item_id, group_id) select (select val::uuid from vars where name = 'karak'), val::uuid from vars where name = 'sugar_grp';
insert into cafe_tables (table_number, venue_id) values ('T${TABLE_NO}', '${VENUE_A_ID}');
insert into vars select 'table', id::text from cafe_tables where table_number = 'T${TABLE_NO}';

-- Receipts: an ingredient and a supplier of our own.
insert into ingredients (kind, name_en, name_ar, unit, is_active, venue_id, pack_size, pack_cost_iqd)
values ('purchased', 'Roasted Zanzibari Beans', 'بن زنجباري محمص', 'g', true, '${VENUE_A_ID}', 1000, 12000);
insert into vars select 'beans', id::text from ingredients where name_en = 'Roasted Zanzibari Beans' and venue_id = '${VENUE_A_ID}' limit 1;
insert into suppliers (venue_id, name) values ('${VENUE_A_ID}', 'SH Qarmat Dairy Traders');

insert into venues (id, slug, name_en, name_ar, is_active)
values ('${OTHER_VENUE}', 'sh-other-venue', 'SH other', 'فرع آخر', false);
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

const T = (label: string, who: string, sql: string) => `select pg_temp.t('${label}', '${who}', $q$${sql}$q$);`;
const SVC = (label: string, sql: string) => `select pg_temp.svc('${label}', $q$${sql}$q$);`;
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
const SLOT = (name: string, who: string, folder = 'slips') => [
  T(`slot_${name}`, who, `select app.staff_media_slot({{venue}}, '${folder}', 'jpg')`),
  RES(name, `slot_${name}`, 'path'),
];
const VOID = (sql: string) => `select 'true'::jsonb from (select ${sql}) x`;
/** File a slip as `who`, take it for a reading and store `reading`. */
const READ_SLIP = (name: string, who: string, reading: object) => [
  ...SLOT(`p_${name}`, who),
  T(`create_${name}`, who, `select app.create_order_slip({{venue}}, {{p_${name}}})`),
  RES(name, `create_${name}`, 'id'),
  SVC(`begin_${name}`, `select app.slip_begin_reading({{${name}}})`),
  SVC(`store_${name}`, `select app.slip_store_reading({{${name}}}, '${JSON.stringify(reading)}', 'fake-receipt-reader')`),
];

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

/** File a receipt as `who`, take it for a reading as `asker` and keep its lease as `<name>_tok`. */
const BEGIN_RECEIPT = (name: string, who: string, asker: string) => [
  ...SLOT(`p_${name}`, who, 'receipts'),
  T(`create_${name}`, who, `select app.create_receipt({{venue}}, {{p_${name}}}, 'phone')`),
  RES(name, `create_${name}`, 'id'),
  SVC(`begin_${name}`, `select app.receipt_begin_reading({{${name}}}, {{${asker}}})`),
  RES(`${name}_tok`, `begin_${name}`, 'reading_token'),
];
/** Raw SQL as postgres, with no caller (a fixture step). */
const RAW = (sql: string) => `select set_config('request.jwt.claims', '', true);\n${sql};`;
const RECEIPT = JSON.stringify({
  supplier_name: 'SH Qarmat Dairy Traders',
  lines: [{ text: 'Roasted Zanzibari Beans', qty: 2, unit_price_iqd: 14000, line_total_iqd: 28000, flags: [] }],
});

describe.skipIf(!docker)('scan hardening 0240 (rolled-back transactions)', () => {
  it('a reading holds a lease: a stale token can neither store nor end it; nothing tried is given back', () => {
    const r = scenario([
      ...BEGIN_RECEIPT('rc', 'manager', 'drv'),
      SVC('busy', `select app.receipt_begin_reading({{rc}}, {{drv}})`),
      SVC('store_stale', `select app.receipt_store_reading({{rc}}, '${RECEIPT}', 'm', gen_random_uuid())`),
      SVC('fail_stale', VOID(`app.receipt_fail_reading({{rc}}, 'UPSTREAM', 'failed', gen_random_uuid())`)),
      Q('after_stale', `select to_jsonb(status) from supplier_receipts where id = {{rc}}::uuid`),
      SVC('fail_null_status', VOID(`app.receipt_fail_reading({{rc}}, 'UPSTREAM', null, {{rc_tok}}::uuid)`)),
      SVC('given_back', VOID(`app.receipt_fail_reading({{rc}}, 'READER_NOT_CONFIGURED', 'uploaded', {{rc_tok}}::uuid)`)),
      Q('after_back', `select jsonb_build_object('status', status, 'code', error_code) from supplier_receipts where id = {{rc}}::uuid`),
      Q('reads_after_back', `select to_jsonb(count(*)) from scan_reads where paper_id = {{rc}}::uuid`),
      SVC('begin2', `select app.receipt_begin_reading({{rc}}, {{drv}})`),
      RES('tok2', 'begin2', 'reading_token'),
      SVC('store_ok', `select app.receipt_store_reading({{rc}}, '${RECEIPT}', 'm', {{tok2}}::uuid)`),
      T('detail', 'manager', `select app.receipt_detail({{rc}})`),
    ]);
    expect(ok<{ reading_token: string }>(r, 'begin_rc').reading_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(refused(r, 'busy')).toBe('RECEIPT_BUSY');
    expect(refused(r, 'store_stale')).toBe('READING_SUPERSEDED');
    ok(r, 'fail_stale');
    expect(ok(r, 'after_stale')).toBe('reading');
    expect(refused(r, 'fail_null_status')).toBe('INVALID_ARGUMENT:status');
    expect(ok(r, 'after_back')).toEqual({ status: 'uploaded', code: 'READER_NOT_CONFIGURED' });
    expect(ok(r, 'reads_after_back')).toBe(0);
    expect(ok(r, 'store_ok')).toMatchObject({ lines: 1 });
    const d = ok<{ status: string; reading_started_at: string; server_now: string }>(r, 'detail');
    expect(d.status).toBe('read');
    expect(Date.parse(d.server_now)).toBeGreaterThanOrEqual(Date.parse(d.reading_started_at));
  });

  it('a paper is read at most three times; a re-read that fails keeps the earlier lines', () => {
    const r = scenario([
      ...BEGIN_RECEIPT('rc', 'manager', 'manager'),
      SVC('store1', `select app.receipt_store_reading({{rc}}, '${RECEIPT}', 'm', {{rc_tok}}::uuid)`),
      SVC('b2', `select app.receipt_begin_reading({{rc}}, {{manager}})`),
      RES('t2', 'b2', 'reading_token'),
      SVC('f2', VOID(`app.receipt_fail_reading({{rc}}, 'TIMEOUT', 'failed', {{t2}}::uuid)`)),
      Q('after_f2', `select jsonb_build_object('status', status, 'code', error_code,
                       'lines', (select count(*) from supplier_receipt_lines where receipt_id = {{rc}}::uuid))
                       from supplier_receipts where id = {{rc}}::uuid`),
      SVC('b3', `select app.receipt_begin_reading({{rc}}, {{manager}})`),
      RES('t3', 'b3', 'reading_token'),
      SVC('f3', VOID(`app.receipt_fail_reading({{rc}}, 'UPSTREAM', 'failed', {{t3}}::uuid)`)),
      SVC('b4', `select app.receipt_begin_reading({{rc}}, {{manager}})`),
    ]);
    ok(r, 'store1');
    expect(ok(r, 'after_f2')).toEqual({ status: 'read', code: 'TIMEOUT', lines: 1 });
    expect(refused(r, 'b4')).toBe('SCAN_REREAD_LIMIT');
  });

  it('staff below MGMT ask for at most 100 readings a day; managers are not counted', () => {
    const r = scenario([
      ...SLOT('p1', 'wtr'),
      T('create', 'wtr', `select app.create_order_slip({{venue}}, {{p1}})`),
      RES('s1', 'create', 'id'),
      RAW(`insert into scan_reads (venue_id, kind, paper_id, requested_by)
             select '${VENUE_A_ID}', 'order_slip', gen_random_uuid(), (select val::uuid from pg_temp.vars where name = 'wtr')
               from generate_series(1, 100)`),
      SVC('waiter', `select app.slip_begin_reading({{s1}}, {{wtr}})`),
      RAW(`insert into scan_reads (venue_id, kind, paper_id, requested_by)
             select '${VENUE_A_ID}', 'order_slip', gen_random_uuid(), (select val::uuid from pg_temp.vars where name = 'manager')
               from generate_series(1, 100)`),
      SVC('manager', `select app.slip_begin_reading({{s1}}, {{manager}})`),
    ]);
    expect(refused(r, 'waiter')).toBe('SCAN_USER_DAILY_LIMIT');
    ok(r, 'manager');
  });

  it('a stored reading drops fields of the wrong type, unknown flags and a future date, and never raises', () => {
    const bad = JSON.stringify({
      receipt_date: '2099-01-01',
      total_iqd: '62000',
      lines: [
        { text: 'Beans', qty: 'abc', unit_price_iqd: 'x', line_total_iqd: 28000, expiry_date: '2026-02-30', flags: ['EVIL', 'UNCLEAR', 'UNCLEAR'] },
        { text: 'Dust', qty: 0.0004 },
        'not a line',
      ],
    });
    const r = scenario([
      ...BEGIN_RECEIPT('rc', 'manager', 'manager'),
      SVC('store', `select app.receipt_store_reading({{rc}}, '${bad}', 'm', {{rc_tok}}::uuid)`),
      T('detail', 'manager', `select app.receipt_detail({{rc}})`),
      ...SLOT('p1', 'wtr'),
      T('create', 'wtr', `select app.create_order_slip({{venue}}, {{p1}})`),
      RES('s1', 'create', 'id'),
      // A table named with more digits than a bigint holds once failed every reading at the branch.
      RAW(`insert into cafe_tables (table_number, venue_id) values ('Terrace 123456789012345678901234', '${VENUE_A_ID}')`),
      SVC('sb', `select app.slip_begin_reading({{s1}}, {{wtr}})`),
      SVC('slip_store', `select app.slip_store_reading({{s1}},
        '{"table_number":"000${TABLE_NO}","lines":[{"text":"x","qty":"2","flags":["NOPE","NO_QTY"]}]}', 'm')`),
      T('slip', 'cashier', `select app.slip_detail({{s1}})`),
    ]);
    expect(ok(r, 'store')).toMatchObject({ lines: 2 });
    const d = ok<{ receipt_date: string | null; total_iqd_read: number | null; lines: Record<string, unknown>[] }>(r, 'detail');
    expect(d.receipt_date).toBeNull();
    expect(d.total_iqd_read).toBeNull();
    expect(d.lines[0]).toMatchObject({ qty_read: null, unit_price_iqd_read: null, line_total_iqd_read: 28000, expiry_read: null, flags: ['UNCLEAR'] });
    expect(d.lines[1]).toMatchObject({ qty_read: null });
    ok(r, 'slip_store');
    const s = ok<{ table_number: string | null; lines: Record<string, unknown>[] }>(r, 'slip');
    expect(s.table_number).toBe(`T${TABLE_NO}`);
    expect(s.lines[0]).toMatchObject({ qty_read: null, flags: ['NO_QTY'] });
  });

  it('the sweeper ends a reading older than three minutes; one with earlier lines goes back to read', () => {
    const r = scenario([
      ...BEGIN_RECEIPT('fresh', 'manager', 'manager'),
      ...BEGIN_RECEIPT('old', 'manager', 'manager'),
      ...BEGIN_RECEIPT('reread', 'manager', 'manager'),
      RAW(`update supplier_receipts set reading_started_at = now() - interval '4 minutes'
            where id in ((select val::uuid from pg_temp.vars where name = 'old'),
                         (select val::uuid from pg_temp.vars where name = 'reread'))`),
      RAW(`update supplier_receipts set read_at = now() - interval '1 hour'
            where id = (select val::uuid from pg_temp.vars where name = 'reread')`),
      SVC('sweep', `select to_jsonb(app.scan_sweep_stale())`),
      Q('states', `select jsonb_object_agg(v.name, jsonb_build_object('status', r.status, 'code', r.error_code))
                     from supplier_receipts r join pg_temp.vars v on v.val = r.id::text
                    where v.name in ('fresh', 'old', 'reread')`),
      Q('audit', `select to_jsonb(count(*)) from audit_log
                   where action = 'receipt.read_failed' and after->>'code' = 'READ_ABANDONED'
                     and entity_id in ({{old}}, {{reread}})`),
      T('sweep_staff', 'manager', `select to_jsonb(app.scan_sweep_stale())`),
    ]);
    expect(ok<number>(r, 'sweep')).toBeGreaterThanOrEqual(2);
    expect(ok(r, 'states')).toEqual({
      fresh: { status: 'reading', code: null },
      old: { status: 'failed', code: 'READ_ABANDONED' },
      reread: { status: 'read', code: 'READ_ABANDONED' },
    });
    expect(ok(r, 'audit')).toBe(2);
    expect(refused(r, 'sweep_staff')).toMatch(/permission denied/);
  });

  it('send: several open tabs is TAB_AMBIGUOUS, another branch is VENUE_MISMATCH', () => {
    const r = scenario([
      ...READ_SLIP('s1', 'wtr', { table_number: TABLE_NO, lines: [{ text: 'لاتيه زنجبار', qty: 1, flags: [] }] }),
      T('tab1', 'cashier', `select app.open_tab({{table}}, 'one')`),
      T('tab2', 'cashier', `select app.open_tab({{table}}, 'two')`),
      KEEP('l1', `select id::text from order_slip_lines where slip_id = {{s1}}::uuid`),
      T('ambiguous', 'cashier', `select app.send_order_slip({{s1}},
          jsonb_build_array(jsonb_build_object('line_id', {{l1}}, 'variant_id', {{latte_r}}, 'qty', 1)), null, {{table}})`),
      RAW(`insert into cafe_tables (table_number, venue_id) values ('SH-other', '${OTHER_VENUE}')`),
      KEEP('other_table', `select id::text from cafe_tables where table_number = 'SH-other'`),
      T('mismatch', 'cashier', `select app.send_order_slip({{s1}},
          jsonb_build_array(jsonb_build_object('line_id', {{l1}}, 'variant_id', {{latte_r}}, 'qty', 1)), null, {{other_table}})`),
      RES('tab1_id', 'tab1', 'tab_id'),
      T('named', 'cashier', `select app.send_order_slip({{s1}},
          jsonb_build_array(jsonb_build_object('line_id', {{l1}}, 'variant_id', {{latte_r}}, 'qty', 1)), {{tab1_id}}, {{table}})`),
    ]);
    ok(r, 'tab1');
    ok(r, 'tab2');
    expect(refused(r, 'ambiguous')).toBe('TAB_AMBIGUOUS');
    expect(refused(r, 'mismatch')).toBe('VENUE_MISMATCH');
    expect(ok<{ tab_id: string }>(r, 'named').tab_id).toBe(ok<{ tab_id: string }>(r, 'tab1').tab_id);
  });

  it('a cashier teaches new wordings but cannot re-point one; a manager can, and it is audited', () => {
    const line = { table_number: TABLE_NO, lines: [{ text: 'لاتيه زنجبار', qty: 1, flags: [] }] };
    const send = (label: string, who: string, slip: string, variant: string) => [
      KEEP(`${slip}_l`, `select id::text from order_slip_lines where slip_id = {{${slip}}}::uuid`),
      T(label, who, `select app.send_order_slip({{${slip}}},
          jsonb_build_array(jsonb_build_object('line_id', {{${slip}_l}}, 'variant_id', {{${variant}}}, 'qty', 1)), null, {{table}})`),
    ];
    const alias = (label: string) =>
      Q(label, `select jsonb_build_object('v', variant_id, 'uses', uses) from menu_aliases
                 where venue_id = {{venue}}::uuid and alias_norm = app.search_norm('لاتيه زنجبار')`);
    const r = scenario([
      ...READ_SLIP('s1', 'wtr', line),
      ...send('send1', 'cashier', 's1', 'latte_r'),
      alias('a1'),
      ...READ_SLIP('s2', 'wtr', line),
      ...send('send2', 'cashier', 's2', 'latte_l'),
      alias('a2'),
      ...READ_SLIP('s3', 'wtr', line),
      ...send('send3', 'manager', 's3', 'latte_l'),
      alias('a3'),
      Q('audit', `select to_jsonb(count(*)) from audit_log where action = 'menu_alias.repoint'
                   and after->>'slip_id' = {{s3}}`),
    ]);
    ok(r, 'send1');
    ok(r, 'send2');
    ok(r, 'send3');
    const latteR = ok<{ v: string }>(r, 'a1').v;
    expect(ok(r, 'a1')).toMatchObject({ uses: 1 });
    expect(ok(r, 'a2')).toEqual({ v: latteR, uses: 1 });
    expect(ok<{ v: string }>(r, 'a3').v).not.toBe(latteR);
    expect(ok(r, 'a3')).toMatchObject({ uses: 1 });
    expect(ok(r, 'audit')).toBe(1);
  });

  it('confirm keeps the guessed supplier when the manager names none', () => {
    const r = scenario([
      ...BEGIN_RECEIPT('rc', 'manager', 'manager'),
      SVC('store', `select app.receipt_store_reading({{rc}}, '${RECEIPT}', 'm', {{rc_tok}}::uuid)`),
      KEEP('l1', `select id::text from supplier_receipt_lines where receipt_id = {{rc}}::uuid`),
      T('confirm', 'manager', `select app.confirm_receipt({{rc}}, jsonb_build_array(
          jsonb_build_object('line_id', {{l1}}, 'ingredient_id', {{beans}}, 'qty_received', 2000, 'unit_cost_iqd', 14)))`),
      Q('delivery', `select jsonb_build_object('sup', d.supplier_id, 'name', d.supplier_name)
                       from deliveries d join supplier_receipts r on r.delivery_id = d.id where r.id = {{rc}}::uuid`),
      Q('alias_sup', `select to_jsonb(supplier_id) from ingredient_aliases
                        where venue_id = {{venue}}::uuid and ingredient_id = {{beans}}::uuid`),
    ]);
    ok(r, 'confirm');
    const d = ok<{ sup: string; name: string }>(r, 'delivery');
    expect(d.sup).toBeTruthy();
    expect(d.name).toBe('SH Qarmat Dairy Traders');
    expect(ok(r, 'alias_sup')).toBe(d.sup);
  });

  it('evidence photos cannot be deleted by hand; set-aside papers are purged on schedule; confirmed receipts kept', () => {
    const r = scenario([
      ...SLOT('loose', 'manager', 'receipts'),
      ...BEGIN_RECEIPT('kept', 'manager', 'manager'),
      ...BEGIN_RECEIPT('gone', 'manager', 'manager'),
      T('ev_receipt', 'manager', `select to_jsonb(app.staff_media_is_evidence({{p_kept}}))`),
      T('ev_loose', 'manager', `select to_jsonb(app.staff_media_is_evidence({{loose}}))`),
      Q('policy', `select to_jsonb(qual) from pg_policies where tablename = 'objects' and policyname = 'staff_media_delete'`),
      SVC('fail_gone', VOID(`app.receipt_fail_reading({{gone}}, 'UNREADABLE', 'failed', {{gone_tok}}::uuid)`)),
      T('reject', 'manager', `select to_jsonb(true) from (select app.reject_receipt({{gone}}, 'not ours')) x`),
      RAW(`update supplier_receipts set rejected_at = now() - interval '31 days'
            where id = (select val::uuid from pg_temp.vars where name = 'gone')`),
      RAW(`update staff_media_uploads set created_at = now() - interval '2 days'
            where path = (select val from pg_temp.vars where name = 'loose')`),
      SVC('due', `select app.staff_media_orphan_purge_due(500)`),
    ]);
    expect(ok(r, 'ev_receipt')).toBe(true);
    expect(ok(r, 'ev_loose')).toBe(false);
    expect(String(ok(r, 'policy'))).toContain('staff_media_is_evidence');
    ok(r, 'reject');
    const due = ok<string[]>(r, 'due');
    const vars = (name: string) => r[`slot_${name}`]!.data as { path: string };
    expect(due).toContain(vars('p_gone').path);
    expect(due).toContain(vars('loose').path);
    expect(due).not.toContain(vars('p_kept').path);
  });

  it('a former driver no longer reads their receipts', () => {
    const r = scenario([
      ...SLOT('p1', 'drv', 'receipts'),
      T('create', 'drv', `select app.create_receipt({{venue}}, {{p1}}, 'phone')`),
      RES('rc', 'create', 'id'),
      T('rows_active', 'drv', `select to_jsonb(count(*)) from supplier_receipts where id = {{rc}}::uuid`),
      RAW(`update staff set is_active = false where id = (select val::uuid from pg_temp.vars where name = 'drv')`),
      T('rows_gone', 'drv', `select to_jsonb(count(*)) from supplier_receipts where id = {{rc}}::uuid`),
      T('detail_gone', 'drv', `select app.receipt_detail({{rc}})`),
    ]);
    expect(ok(r, 'rows_active')).toBe(1);
    expect(ok(r, 'rows_gone')).toBe(0);
    expect(refused(r, 'detail_gone')).toBe('FORBIDDEN');
  });
});
