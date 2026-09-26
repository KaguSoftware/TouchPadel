/**
 * receipt_scan (0236/0237, Phase 2 Milestone 4b): photographed supplier
 * receipts, read by a model, matched to stock, confirmed into Goods in.
 *
 *   * the driver and MGMT file a receipt from their own unclaimed upload in
 *     the receipts folder; a retry with the same key files it once; a photo
 *     claimed by another receipt, one from another folder, a bad source and
 *     another branch are refused; everyone else is FORBIDDEN;
 *   * the uploader and MGMT read it, nobody else; the reading functions are
 *     the service role's alone;
 *   * a reading takes the receipt (a second one is RECEIPT_BUSY), stores the
 *     lines, guesses the supplier, and matches each line: an exact Arabic name
 *     and a close English one by trigram, a stranger to nothing;
 *   * the manager's confirm books ONE delivery (source receipt) with their
 *     quantities and costs, retries once by key, learns the wording as this
 *     supplier's alias, and the next receipt matches by alias at confidence 1;
 *     a manager's different pick is recorded as manual and moves the alias;
 *   * with no model (the reading gives up as uploaded) the manager still
 *     confirms lines typed by hand; a rejected or confirmed receipt stays
 *     done; bad lines and another branch's receipt are refused.
 *
 * HOW. The shopping-purchases.test.ts harness: every scenario is ONE psql
 * transaction that is rolled back, each call runs as `authenticated` with the
 * caller's JWT claims, and pg_temp.svc runs as `service_role` (the edge
 * function). Without docker on PATH the suite skips itself.
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

const OTHER_VENUE = '00000000-0000-4000-8000-00000000c3c3';

// ── the in-transaction harness (as shopping-purchases.test.ts) ─────────────
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

-- As the edge function: the service role, no user.
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
  execute pg_temp.sub(p_sql) into v;
  insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
end $f$;

create function pg_temp.keep(p_name text, p_sql text) returns void language plpgsql as $f$
declare v text;
begin
  execute pg_temp.sub(p_sql) into v;
  if v is null then raise exception 'keep %: no value', p_name; end if;
  insert into pg_temp.vars values (p_name, v) on conflict (name) do update set val = excluded.val;
end $f$;

create function pg_temp.mk(p_name text, p_role staff_role) returns void language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'rc-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'RC ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

-- A stock ingredient of venue A, created as postgres (before any call).
create function pg_temp.ing(p_name text, p_en text, p_ar text, p_unit stock_unit) returns void
language plpgsql as $f$
declare v uuid;
begin
  insert into ingredients (kind, name_en, name_ar, unit, is_active, venue_id, pack_size, pack_cost_iqd)
  values ('purchased', p_en, p_ar, p_unit, true, '${VENUE_A_ID}', 1000, 12000)
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

select pg_temp.mk('drv', 'driver');
select pg_temp.mk('mkt', 'marketing');
select pg_temp.ing('syrup', 'Zanzibar Vanilla Syrup', 'شراب فانيليا زنجبار', 'ml');
select pg_temp.ing('beans', 'Roasted Zanzibari Beans', 'بن زنجباري محمص', 'g');
select pg_temp.ing('sugar', 'Qarmat Cane Sugar', 'سكر قصب قرمط', 'g');
insert into suppliers (venue_id, name) values ('${VENUE_A_ID}', 'Qarmat Dairy Traders');
insert into vars select 'dairy', id::text from suppliers
  where venue_id = '${VENUE_A_ID}' and name = 'Qarmat Dairy Traders';

-- A branch nobody here works at (inactive), with one receipt of its own.
insert into venues (id, slug, name_en, name_ar, is_active)
values ('${OTHER_VENUE}', 'rc-other-venue', 'RC other', 'فرع آخر', false);
insert into supplier_receipts (venue_id, storage_path, source, uploaded_by)
values ('${OTHER_VENUE}', '${OTHER_VENUE}/receipts/rc-other.jpg', 'phone', '${SEED_STAFF_IDS.owner}');
insert into vars select 'other_receipt', id::text from supplier_receipts
  where storage_path = '${OTHER_VENUE}/receipts/rc-other.jpg';
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

/** Mint a receipts slot as `who` and keep its path as `name`. */
const SLOT = (name: string, who: string, folder = 'receipts') => [
  T(`slot_${name}`, who, `select app.staff_media_slot({{venue}}, '${folder}', 'jpg')`),
  RES(name, `slot_${name}`, 'path'),
];
const VOID = (sql: string) => `select 'true'::jsonb from (select ${sql}) x`;

/** A reading as receipt-scan stores it after validate.ts. */
const READING = JSON.stringify({
  supplier_name: 'Qarmat Dairy',
  receipt_date: '2026-09-20',
  total_iqd: 62000,
  lines: [
    { text: 'ZANZIBAR VANILLA SYRUP 750ML', qty: 12, unit: 'btl', unit_price_iqd: 1500, line_total_iqd: 18000, flags: [] },
    { text: 'بن زنجباري محمص', qty: 2, unit: 'kg', unit_price_iqd: 20000, line_total_iqd: 40000, flags: [] },
    { text: 'Qwxz delivery fee', qty: 1, line_total_iqd: 4000, flags: ['NO_PRICE'] },
    { text: '   ', qty: 1 },
  ],
});

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

interface Line {
  id: string;
  line_no: number;
  text_read: string;
  ingredient_id: string | null;
  match_source: string;
  confidence: number | null;
  flags: string[];
}
interface Detail {
  status: string;
  supplier_id: string | null;
  supplier_name_read: string | null;
  total_iqd_read: number | null;
  error_code: string | null;
  lines: Line[];
}

describe.skipIf(!docker)('receipt scanning (rolled-back transactions)', () => {
  it('the driver and MGMT file receipts; the uploader and MGMT read them; reading is the service role\'s', () => {
    const r = scenario([
      ...SLOT('p1', 'drv'),
      T('create_drv', 'drv', `select app.create_receipt({{venue}}, {{p1}}, 'phone', 'RC-KEY-1')`),
      T('create_drv_again', 'drv', `select app.create_receipt({{venue}}, {{p1}}, 'phone', 'RC-KEY-1')`),
      RES('rc1', 'create_drv', 'id'),
      T('claimed_twice', 'manager', `select app.create_receipt({{venue}}, {{p1}}, 'operator')`),
      ...SLOT('inc', 'drv', 'incidents'),
      T('wrong_folder', 'drv', `select app.create_receipt({{venue}}, {{inc}}, 'phone')`),
      ...SLOT('p2', 'manager'),
      T('bad_source', 'manager', `select app.create_receipt({{venue}}, {{p2}}, 'fax')`),
      T('no_path', 'manager', `select app.create_receipt({{venue}}, '  ', 'operator')`),
      T('other_branch', 'manager', `select app.create_receipt('${OTHER_VENUE}', {{p2}}, 'operator')`),
      T('create_cashier', 'cashier', `select app.create_receipt({{venue}}, {{p2}}, 'phone')`),
      T('create_mkt', 'mkt', `select app.create_receipt({{venue}}, {{p2}}, 'phone')`),
      Q('audit', `select to_jsonb(count(*)) from audit_log
                   where action = 'receipt.create' and entity_id = {{rc1}} and at = now()`),

      T('detail_drv', 'drv', `select app.receipt_detail({{rc1}})`),
      T('detail_mgr', 'manager', `select app.receipt_detail({{rc1}})`),
      T('detail_owner', 'owner', `select app.receipt_detail({{rc1}})`),
      T('detail_mkt', 'mkt', `select app.receipt_detail({{rc1}})`),
      T('detail_cashier', 'cashier', `select app.receipt_detail({{rc1}})`),
      T('review_mgr', 'manager', `select app.receipts_to_review({{venue}})`),
      T('review_drv', 'drv', `select app.receipts_to_review({{venue}})`),
      T('rows_drv', 'drv', `select to_jsonb(count(*)) from supplier_receipts where id = {{rc1}}::uuid`),
      T('rows_mkt', 'mkt', `select to_jsonb(count(*)) from supplier_receipts where id = {{rc1}}::uuid`),

      T('begin_mgr', 'manager', `select app.receipt_begin_reading({{rc1}})`),
      T('store_mgr', 'manager', `select app.receipt_store_reading({{rc1}}, '{"lines":[]}', 'x')`),
      T('fail_mgr', 'manager', VOID(`app.receipt_fail_reading({{rc1}}, 'X')`)),
    ]);

    const id = ok<{ id: string }>(r, 'create_drv').id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ok<{ id: string; duplicate?: boolean }>(r, 'create_drv_again')).toMatchObject({ id, duplicate: true });
    expect(refused(r, 'claimed_twice')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'wrong_folder')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'bad_source')).toBe('INVALID_ARGUMENT:source');
    expect(refused(r, 'no_path')).toBe('PHOTO_PATH_INVALID');
    expect(refused(r, 'other_branch')).toBe('FORBIDDEN');
    expect(refused(r, 'create_cashier')).toBe('FORBIDDEN');
    expect(refused(r, 'create_mkt')).toBe('FORBIDDEN');
    expect(ok<number>(r, 'audit')).toBe(1);

    for (const who of ['drv', 'mgr', 'owner']) {
      expect(ok<Detail>(r, `detail_${who}`), who).toMatchObject({ status: 'uploaded', lines: [] });
    }
    expect(refused(r, 'detail_mkt')).toBe('RECEIPT_NOT_FOUND');
    expect(refused(r, 'detail_cashier')).toBe('RECEIPT_NOT_FOUND');
    const review = ok<{ receipts: { id: string; uploaded_by_name: string; source: string }[] }>(r, 'review_mgr');
    expect(review.receipts.find((x) => x.id === id)).toMatchObject({ uploaded_by_name: 'RC drv', source: 'phone' });
    expect(refused(r, 'review_drv')).toBe('FORBIDDEN');
    expect(ok<number>(r, 'rows_drv')).toBe(1);
    expect(ok<number>(r, 'rows_mkt')).toBe(0);

    for (const label of ['begin_mgr', 'store_mgr', 'fail_mgr']) {
      expect(refused(r, label), label).toMatch(/^permission denied for function/);
    }
  });

  it('a reading is matched; the confirm books one delivery and teaches aliases the next receipt uses', () => {
    const r = scenario([
      ...SLOT('p1', 'manager'),
      T('create', 'manager', `select app.create_receipt({{venue}}, {{p1}}, 'operator')`),
      RES('rc', 'create', 'id'),
      SVC('begin', `select app.receipt_begin_reading({{rc}})`),
      SVC('begin_busy', `select app.receipt_begin_reading({{rc}})`),
      SVC('store', `select app.receipt_store_reading({{rc}}, '${READING}', 'fake-reader')`),
      SVC('store_again', `select app.receipt_store_reading({{rc}}, '${READING}', 'fake-reader')`),
      T('detail', 'manager', `select app.receipt_detail({{rc}})`),
      KEEP('l1', `select id::text from supplier_receipt_lines where receipt_id = {{rc}}::uuid and line_no = 1`),
      KEEP('l2', `select id::text from supplier_receipt_lines where receipt_id = {{rc}}::uuid and line_no = 2`),

      T('confirm_cashier', 'cashier', `select app.confirm_receipt({{rc}}, '[]')`),
      T('confirm', 'manager', `select app.confirm_receipt({{rc}}, jsonb_build_array(
          jsonb_build_object('line_id', {{l1}}, 'ingredient_id', {{syrup}}, 'qty_received', 9000, 'unit_cost_iqd', 2),
          jsonb_build_object('line_id', {{l2}}, 'ingredient_id', {{beans}}, 'qty_received', 2000, 'unit_cost_iqd', 20,
                             'expiry_date', '2027-03-01'),
          jsonb_build_object('ingredient_id', {{sugar}}, 'qty_received', 1000, 'unit_cost_iqd', 1.5)),
        {{dairy}}, null, null, 'RC-CONFIRM-1')`),
      T('confirm_retry', 'manager', `select app.confirm_receipt({{rc}}, '[{"ingredient_id":"00000000-0000-4000-8000-000000000000"}]',
        null, null, null, 'RC-CONFIRM-1')`),
      T('confirm_again', 'manager', `select app.confirm_receipt({{rc}}, jsonb_build_array(
          jsonb_build_object('ingredient_id', {{sugar}}, 'qty_received', 1, 'unit_cost_iqd', 1)))`),
      T('reject_done', 'manager', VOID(`app.reject_receipt({{rc}})`)),
      SVC('begin_done', `select app.receipt_begin_reading({{rc}})`),
      RES('delivery', 'confirm', 'delivery_id'),
      Q('delivery_row', `select jsonb_build_object('source', d.source, 'supplier_id', d.supplier_id,
                                                   'supplier_name', d.supplier_name, 'location', d.location)
                           from deliveries d where d.id = {{delivery}}::uuid`),
      Q('delivery_lines', `select jsonb_agg(jsonb_build_object('ing', dl.ingredient_id, 'qty', dl.qty_received,
                                                               'cost', dl.unit_cost_iqd, 'expiry', dl.expiry_date)
                                            order by dl.qty_received)
                             from delivery_lines dl where dl.delivery_id = {{delivery}}::uuid`),
      Q('receipt_row', `select jsonb_build_object('status', status, 'delivery_id', delivery_id, 'supplier_id', supplier_id)
                          from supplier_receipts where id = {{rc}}::uuid`),
      Q('aliases', `select jsonb_agg(jsonb_build_object('alias', alias_norm, 'ing', ingredient_id, 'sup', supplier_id)
                                     order by alias_norm)
                      from ingredient_aliases where venue_id = {{venue}}::uuid and created_at = now()`),

      // The next receipt from the same supplier: the alias wins; a different
      // pick by the manager is manual and moves the alias.
      ...SLOT('p2', 'manager'),
      T('create2', 'manager', `select app.create_receipt({{venue}}, {{p2}}, 'operator')`),
      RES('rc2', 'create2', 'id'),
      SVC('begin2', `select app.receipt_begin_reading({{rc2}})`),
      SVC('store2', `select app.receipt_store_reading({{rc2}},
        '{"supplier_name":"Qarmat Dairy Traders","lines":[{"text":"Zanzibar vanilla syrup 750ml","qty":6}]}', 'fake-reader')`),
      T('detail2', 'manager', `select app.receipt_detail({{rc2}})`),
      KEEP('m1', `select id::text from supplier_receipt_lines where receipt_id = {{rc2}}::uuid and line_no = 1`),
      T('confirm2', 'manager', `select app.confirm_receipt({{rc2}}, jsonb_build_array(
          jsonb_build_object('line_id', {{m1}}, 'ingredient_id', {{sugar}}, 'qty_received', 6000, 'unit_cost_iqd', 1)),
        {{dairy}})`),
      Q('line2_after', `select jsonb_build_object('src', match_source, 'ing', ingredient_id, 'conf', confidence)
                          from supplier_receipt_lines where id = {{m1}}::uuid`),
      Q('alias_after', `select jsonb_build_object('ing', ingredient_id, 'uses', uses)
                          from ingredient_aliases
                         where venue_id = {{venue}}::uuid and supplier_id = {{dairy}}::uuid
                           and alias_norm = 'zanzibar vanilla syrup 750ml'`),
    ]);

    expect(ok<{ supplier_names: string[] }>(r, 'begin').supplier_names).toContain('Qarmat Dairy Traders');
    expect(refused(r, 'begin_busy')).toBe('RECEIPT_BUSY');
    expect(ok<{ lines: number; matched: number }>(r, 'store')).toMatchObject({ lines: 3, matched: 2 });
    expect(refused(r, 'store_again')).toBe('RECEIPT_NOT_READING');

    const detail = ok<Detail>(r, 'detail');
    expect(detail).toMatchObject({ status: 'read', supplier_name_read: 'Qarmat Dairy', total_iqd_read: 62000 });
    expect(detail.supplier_id).toBeTruthy();
    const [l1, l2, l3] = detail.lines;
    expect(detail.lines).toHaveLength(3);
    expect(l1).toMatchObject({ line_no: 1, match_source: 'trigram' });
    expect(l1!.confidence).toBeGreaterThanOrEqual(0.45);
    expect(l2).toMatchObject({ line_no: 2, match_source: 'trigram', confidence: 1 });
    expect(l3).toMatchObject({ line_no: 3, ingredient_id: null, match_source: 'none', flags: ['NO_PRICE'] });

    expect(refused(r, 'confirm_cashier')).toBe('FORBIDDEN');
    const conf = ok<{ receipt_id: string; delivery_id: string; batch_ids: string[] }>(r, 'confirm');
    expect(conf.batch_ids).toHaveLength(3);
    expect(ok<{ delivery_id: string; duplicate?: boolean }>(r, 'confirm_retry'))
      .toMatchObject({ delivery_id: conf.delivery_id, duplicate: true });
    expect(refused(r, 'confirm_again')).toBe('RECEIPT_ALREADY_DONE');
    expect(refused(r, 'reject_done')).toBe('RECEIPT_ALREADY_DONE');
    expect(refused(r, 'begin_done')).toBe('RECEIPT_ALREADY_DONE');

    expect(ok(r, 'delivery_row')).toMatchObject({ source: 'receipt', supplier_name: 'Qarmat Dairy Traders',
                                                   location: 'cafe' });
    const lines = ok<{ qty: number; cost: number; expiry: string | null }[]>(r, 'delivery_lines');
    expect(lines.map((l) => [l.qty, Number(l.cost)])).toEqual([[1000, 1.5], [2000, 20], [9000, 2]]);
    expect(lines[1]!.expiry).toBe('2027-03-01');
    expect(ok(r, 'receipt_row')).toMatchObject({ status: 'confirmed', delivery_id: conf.delivery_id });

    const aliases = ok<{ alias: string; sup: string }[]>(r, 'aliases');
    expect(aliases.map((a) => a.alias)).toEqual(['zanzibar vanilla syrup 750ml', 'بن زنجباري محمص']);
    expect(new Set(aliases.map((a) => a.sup)).size).toBe(1);

    const d2 = ok<Detail>(r, 'detail2');
    expect(d2.lines[0]).toMatchObject({ match_source: 'alias', confidence: 1 });
    ok(r, 'confirm2');
    expect(ok(r, 'line2_after')).toMatchObject({ src: 'manual', conf: null });
    expect(ok<{ uses: number }>(r, 'alias_after').uses).toBe(2);
  });

  it('no model: the manager types the lines; reject, bad lines and another branch are refused', () => {
    const r = scenario([
      ...SLOT('p1', 'drv'),
      T('create', 'drv', `select app.create_receipt({{venue}}, {{p1}}, 'phone')`),
      RES('rc', 'create', 'id'),
      SVC('begin', `select app.receipt_begin_reading({{rc}})`),
      SVC('gave_up', VOID(`app.receipt_fail_reading({{rc}}, 'READER_NOT_CONFIGURED', 'uploaded')`)),
      SVC('bad_status', VOID(`app.receipt_fail_reading({{rc}}, 'X', 'read')`)),
      T('detail', 'manager', `select app.receipt_detail({{rc}})`),
      T('empty', 'manager', `select app.confirm_receipt({{rc}}, '[]')`),
      T('bad_line', 'manager', `select app.confirm_receipt({{rc}}, '[{"ingredient_id":"nope"}]')`),
      T('foreign_line', 'manager', `select app.confirm_receipt({{rc}}, jsonb_build_array(jsonb_build_object(
          'line_id', '00000000-0000-4000-8000-000000000000', 'ingredient_id', {{sugar}},
          'qty_received', 1, 'unit_cost_iqd', 1)))`),
      T('bad_supplier', 'manager', `select app.confirm_receipt({{rc}}, jsonb_build_array(jsonb_build_object(
          'ingredient_id', {{sugar}}, 'qty_received', 1, 'unit_cost_iqd', 1)), '00000000-0000-4000-8000-000000000000')`),
      T('by_hand', 'manager', `select app.confirm_receipt({{rc}}, jsonb_build_array(jsonb_build_object(
          'ingredient_id', {{sugar}}, 'qty_received', 500, 'unit_cost_iqd', 2)), null, '  Corner shop  ')`),
      RES('delivery', 'by_hand', 'delivery_id'),
      Q('delivery_row', `select jsonb_build_object('source', source, 'supplier_name', supplier_name)
                           from deliveries where id = {{delivery}}::uuid`),

      ...SLOT('p2', 'manager'),
      T('create2', 'manager', `select app.create_receipt({{venue}}, {{p2}}, 'operator')`),
      RES('rc2', 'create2', 'id'),
      T('reject_cashier', 'cashier', VOID(`app.reject_receipt({{rc2}}, 'no')`)),
      T('reject_long', 'manager', VOID(`app.reject_receipt({{rc2}}, repeat('x', 201))`)),
      T('reject', 'manager', VOID(`app.reject_receipt({{rc2}}, '  Not a supplier receipt  ')`)),
      T('confirm_rejected', 'manager', `select app.confirm_receipt({{rc2}}, jsonb_build_array(jsonb_build_object(
          'ingredient_id', {{sugar}}, 'qty_received', 1, 'unit_cost_iqd', 1)))`),
      Q('rejected_row', `select jsonb_build_object('status', status, 'reason', rejected_reason)
                           from supplier_receipts where id = {{rc2}}::uuid`),
      T('review', 'manager', `select app.receipts_to_review({{venue}})`),

      T('other_confirm', 'manager', `select app.confirm_receipt({{other_receipt}}, jsonb_build_array(jsonb_build_object(
          'ingredient_id', {{sugar}}, 'qty_received', 1, 'unit_cost_iqd', 1)))`),
      T('other_reject', 'manager', VOID(`app.reject_receipt({{other_receipt}})`)),
      T('other_detail', 'manager', `select app.receipt_detail({{other_receipt}})`),
    ]);

    ok(r, 'gave_up');
    expect(refused(r, 'bad_status')).toBe('INVALID_ARGUMENT:status');
    expect(ok<Detail>(r, 'detail')).toMatchObject({ status: 'uploaded', error_code: 'READER_NOT_CONFIGURED', lines: [] });
    expect(refused(r, 'empty')).toBe('EMPTY_DELIVERY');
    expect(refused(r, 'bad_line')).toBe('INVALID_ARGUMENT:lines');
    expect(refused(r, 'foreign_line')).toBe('INVALID_ARGUMENT:lines');
    expect(refused(r, 'bad_supplier')).toBe('SUPPLIER_NOT_FOUND');
    expect(ok<{ batch_ids: string[] }>(r, 'by_hand').batch_ids).toHaveLength(1);
    expect(ok(r, 'delivery_row')).toEqual({ source: 'receipt', supplier_name: 'Corner shop' });

    expect(refused(r, 'reject_cashier')).toBe('FORBIDDEN');
    expect(refused(r, 'reject_long')).toBe('TEXT_TOO_LONG:reason');
    ok(r, 'reject');
    expect(refused(r, 'confirm_rejected')).toBe('RECEIPT_ALREADY_DONE');
    expect(ok(r, 'rejected_row')).toEqual({ status: 'rejected', reason: 'Not a supplier receipt' });
    const open = ok<{ receipts: { id: string }[] }>(r, 'review').receipts.map((x) => x.id);
    expect(open).not.toContain(ok<{ id: string }>(r, 'create2').id);
    expect(open).not.toContain(ok<{ id: string }>(r, 'create').id);

    expect(refused(r, 'other_confirm')).toBe('RECEIPT_NOT_FOUND');
    expect(refused(r, 'other_reject')).toBe('RECEIPT_NOT_FOUND');
    expect(refused(r, 'other_detail')).toBe('RECEIPT_NOT_FOUND');
  });
});
