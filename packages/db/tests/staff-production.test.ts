/**
 * staff_production (build-contracts-2026-09-23 §2.16, §8.2): the chefs record
 * a batch on the phone.
 *
 *   * production_today lists the venue's active prepared ingredients with an
 *     output recipe, below par first, with on hand, par and made today, and
 *     no cost;
 *   * record_batch (the head chef, the chef, MGMT) deducts the components
 *     FEFO and books a production_in batch exactly as the manager's
 *     record_production does, returns quantity and expiry but never the unit
 *     cost, refuses an ingredient of another venue, and deducts once under a
 *     retried key;
 *   * production_log_today is "Made today": the business day's production_in
 *     rows, who and how much;
 *   * record_production keeps its MGMT guard and result; the shared body is no
 *     client's to call;
 *   * the head barista, the barista, the driver, marketing, the till, the desk
 *     and prep are refused every one of them (§8.2 denials).
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff, ingredients, recipes and
 * batches are created inside it and each call runs as `authenticated` with the
 * caller's JWT claims. Nothing is committed, so no batch or ledger row stays
 * on the shared stack (stock_movements is append-only). Without docker on PATH
 * the suite skips itself.
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

// ── the in-transaction harness (as protocols-engine-flow.test.ts) ──────────
const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('cashier', '${SEED_STAFF_IDS.cashier}'), ('desk', '${SEED_STAFF_IDS.court_desk}'),
  ('prep', '${SEED_STAFF_IDS.prep}'), ('venue', '${VENUE_A_ID}'), ('other_venue', '${OTHER_VENUE}');

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
  values (v, 'pr-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'PR ' || p_name, p_role, true);
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

-- An ingredient, created as postgres, optionally with a batch in stock.
create function pg_temp.ing(p_name text, p_kind ingredient_kind, p_unit stock_unit, p_active boolean,
                            p_venue uuid, p_par numeric, p_shelf int, p_stock numeric, p_cost numeric)
returns void language plpgsql as $f$
declare v uuid;
begin
  insert into ingredients (kind, name_en, name_ar, unit, is_active, venue_id, par_level, shelf_life_days)
  values (p_kind, 'PR ' || p_name, 'مادة ' || p_name, p_unit, p_active, p_venue, p_par, p_shelf)
  returning id into v;
  if p_stock is not null then
    insert into stock_batches (ingredient_id, qty_received, qty_remaining, unit_cost_iqd, venue_id)
    values (v, p_stock, p_stock, p_cost, p_venue);
  end if;
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

insert into venues (id, slug, name_en, name_ar, is_active)
values ('${OTHER_VENUE}', 'pr-other-venue', 'PR other', 'مكان آخر', false);

-- Components in stock; dough and cookies made from them (per ONE base unit of
-- output); a prepared syrup with no recipe; a purchased sugar; a retired
-- prepared item; and the same dough at a venue nobody here works at.
select pg_temp.ing('flour',   'purchased', 'g',  true,  '${VENUE_A_ID}', null, null, 100000, 2);
select pg_temp.ing('butter',  'purchased', 'g',  true,  '${VENUE_A_ID}', null, null, 50000, 10);
select pg_temp.ing('dough',   'prepared',  'g',  true,  '${VENUE_A_ID}', 3000, 2, null, null);
select pg_temp.ing('cookies', 'prepared',  'pc', true,  '${VENUE_A_ID}', null, null, null, null);
select pg_temp.ing('syrup',   'prepared',  'ml', true,  '${VENUE_A_ID}', 1000, null, null, null);
select pg_temp.ing('sugar',   'purchased', 'g',  true,  '${VENUE_A_ID}', null, null, 1000, 1);
select pg_temp.ing('retired', 'prepared',  'g',  false, '${VENUE_A_ID}', null, null, null, null);
select pg_temp.ing('far_dough', 'prepared', 'g', true,  '${OTHER_VENUE}', null, null, null, null);
insert into recipe_lines (output_ingredient_id, ingredient_id, qty)
select v1.val::uuid, v2.val::uuid, q
  from (values ('dough', 'flour', 0.6), ('dough', 'butter', 0.2), ('cookies', 'flour', 20),
               ('retired', 'flour', 1), ('far_dough', 'flour', 1)) x(o, c, q)
  join pg_temp.vars v1 on v1.name = x.o
  join pg_temp.vars v2 on v2.name = x.c;
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
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
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

/** Keys that would carry money or cost, at any depth. */
function moneyKeys(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => moneyKeys(x, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [
      ...(/_iqd$|^cost|price|margin/i.test(k) ? [`${path}.${k}`] : []),
      ...moneyKeys(x, `${path}.${k}`),
    ]);
  }
  return [];
}

interface TodayItem {
  ingredient_id: string;
  name_en: string;
  unit: string;
  on_hand: number;
  par_level: number | null;
  below_par: boolean;
  made_today: number;
  shelf_life_days: number | null;
}
interface LogRow {
  movement_id: number;
  ingredient_id: string;
  name_en: string;
  qty: number;
  unit: string;
  staff_name: string;
  at: string;
}

// The venue's business day starts here (the analytics start hour, in the
// venue's timezone), as the reads compute it.
const DAY_START = `select ((app.business_date(now(), 'Asia/Baghdad',
                      coalesce(app.cafe_setting_int('analytics_business_day_start_hour'), 4))
                    + make_interval(hours => coalesce(app.cafe_setting_int('analytics_business_day_start_hour'), 4)))
                   at time zone 'Asia/Baghdad')::text`;

describe.skipIf(!docker)('staff production (rolled-back transactions)', () => {
  it('the chefs see what to make and record batches that deduct stock once, with no cost in sight', () => {
    const r = scenario([
      MK('hc', 'head_chef'), MK('chef', 'chef'),
      T('today_before', 'chef', `select app.production_today({{venue}})`),

      T('batch', 'chef', `select app.record_batch({{dough}}, 1000, null, {{venue}}, 'PR-KEY-1')`),
      T('batch_replay', 'chef', `select app.record_batch({{dough}}, 1000, null, {{venue}}, 'PR-KEY-1')`),
      T('batch_hc', 'hc', `select app.record_batch({{dough}}, 500, '2026-12-01')`),
      T('batch_mgr', 'manager', `select app.record_batch({{cookies}}, 12, null, {{venue}})`),
      RES('batch_id', 'batch', 'batch_id'),
      Q('dough_moves', `select jsonb_agg(jsonb_build_object('type', m.movement_type, 'qty', m.qty_delta, 'staff', m.staff_id,
                                                           'venue', m.venue_id) order by m.id)
                          from stock_movements m where m.ingredient_id = {{dough}}::uuid`),
      Q('flour_used', `select to_jsonb(-sum(qty_delta)) from stock_movements
                        where ingredient_id = {{flour}}::uuid and movement_type = 'production_consume'`),
      Q('butter_used', `select to_jsonb(-sum(qty_delta)) from stock_movements
                         where ingredient_id = {{butter}}::uuid and movement_type = 'production_consume'`),
      Q('batch_row', `select jsonb_build_object('qty', qty_remaining, 'unit_cost', unit_cost_iqd, 'venue', venue_id,
                                                'expiry', expiry_date, 'expected_expiry', current_date + 2)
                        from stock_batches where id = {{batch_id}}::uuid`),
      Q('audit', `select jsonb_agg(a.actor_id order by a.id) from audit_log a
                   where a.action = 'stock.record_production' and a.entity_id = {{dough}} and a.at = now()`),

      // An earlier business day's batch does not count as made today.
      KEEP('day_start', DAY_START),
      Q('old', `with x as (insert into stock_movements
                  (ingredient_id, movement_type, qty_delta, unit_cost_iqd, staff_id, venue_id, at)
                  values ({{dough}}::uuid, 'production_in', 7777, 1, {{hc}}::uuid, {{venue}}::uuid,
                          {{day_start}}::timestamptz - interval '1 minute') returning 1)
                select to_jsonb(count(*)) from x`),

      T('today_after', 'chef', `select app.production_today()`),
      T('log_chef', 'chef', `select app.production_log_today({{venue}})`),
      T('log_mgr', 'owner', `select app.production_log_today({{venue}})`),
    ]);

    const before = ok<{ items: TodayItem[] }>(r, 'today_before').items;
    const mine = (items: TodayItem[]) => items.filter((i) => i.name_en.startsWith('PR '));
    // Active prepared items with an output recipe, below par first; no syrup
    // (no recipe), no sugar (bought, not made), no retired or far dough.
    expect(mine(before).map((i) => i.name_en)).toEqual(['PR dough', 'PR cookies']);
    expect(mine(before)[0]).toMatchObject({ unit: 'g', on_hand: 0, par_level: 3000, below_par: true, made_today: 0,
                                            shelf_life_days: 2 });
    expect(mine(before)[1]).toMatchObject({ unit: 'pc', par_level: null, below_par: false });
    expect(moneyKeys(before)).toEqual([]);
    expect(Object.keys(before[0]!).sort()).toEqual(
      ['below_par', 'ingredient_id', 'made_today', 'name_ar', 'name_en', 'on_hand', 'par_level', 'shelf_life_days', 'unit'],
    );

    // Quantity and expiry, never the unit cost; a retried key is one batch.
    const batch = ok<Record<string, unknown>>(r, 'batch');
    expect(Object.keys(batch).sort()).toEqual(['batch_id', 'expiry_date', 'qty']);
    expect(batch.qty).toBe(1000);
    expect(ok<Record<string, unknown>>(r, 'batch_replay')).toEqual({ ...batch, duplicate: true });
    expect(ok<Record<string, unknown>>(r, 'batch_hc')).toMatchObject({ qty: 500, expiry_date: '2026-12-01' });
    expect(ok<Record<string, unknown>>(r, 'batch_mgr')).toMatchObject({ qty: 12 });
    const moves = ok<Array<{ type: string; qty: number; venue: string }>>(r, 'dough_moves');
    expect(moves.map((m) => [m.type, m.qty, m.venue])).toEqual([
      ['production_in', 1000, VENUE_A_ID], ['production_in', 500, VENUE_A_ID],
    ]);
    // The components, FEFO, at 0.6 g flour and 0.2 g butter per gram of dough
    // (and 20 g of flour per cookie).
    expect(ok<number>(r, 'flour_used')).toBe(1500 * 0.6 + 12 * 20);
    expect(ok<number>(r, 'butter_used')).toBe(1500 * 0.2);
    // Costed as the manager's production is: what was consumed ÷ quantity.
    expect(ok<Record<string, unknown>>(r, 'batch_row')).toMatchObject({
      qty: 1000, unit_cost: (600 * 2 + 200 * 10) / 1000, venue: VENUE_A_ID,
    });
    const row = ok<{ expiry: string; expected_expiry: string }>(r, 'batch_row');
    expect(row.expiry).toBe(row.expected_expiry);
    expect(ok<string[]>(r, 'audit')).toHaveLength(2);

    const after = mine(ok<{ items: TodayItem[] }>(r, 'today_after').items);
    expect(after[0]).toMatchObject({ name_en: 'PR dough', on_hand: 1500, made_today: 1500, below_par: true });
    expect(after[1]).toMatchObject({ name_en: 'PR cookies', on_hand: 12, made_today: 12 });

    for (const label of ['log_chef', 'log_mgr']) {
      const rows = ok<{ rows: LogRow[] }>(r, label).rows.filter((x) => x.name_en.startsWith('PR '));
      expect(moneyKeys(rows), label).toEqual([]);
      expect(rows.map((x) => [x.name_en, x.qty, x.unit, x.staff_name]), label).toEqual(
        expect.arrayContaining([
          ['PR dough', 1000, 'g', 'PR chef'], ['PR dough', 500, 'g', 'PR hc'], ['PR cookies', 12, 'pc', 'Dev Manager'],
        ]),
      );
      // The earlier day's batch is not "made today".
      expect(rows.some((x) => x.qty === 7777), label).toBe(false);
    }
  });

  it('refuses the wrong ingredient, the wrong venue and every other role; record_production keeps its guard', () => {
    const r = scenario([
      MK('hc', 'head_chef'), MK('chef', 'chef'), MK('hb', 'head_barista'), MK('bar', 'barista'),
      MK('drv', 'driver'), MK('mkt', 'marketing'),
      T('qty_zero', 'chef', `select app.record_batch({{dough}}, 0)`),
      T('no_recipe', 'chef', `select app.record_batch({{syrup}}, 100)`),
      T('bought', 'chef', `select app.record_batch({{sugar}}, 100)`),
      T('retired', 'chef', `select app.record_batch({{retired}}, 100)`),
      T('far', 'chef', `select app.record_batch({{far_dough}}, 100)`),
      T('missing', 'chef', `select app.record_batch('00000000-0000-4000-8000-000000000000', 100)`),
      T('other_venue', 'hc', `select app.record_batch({{dough}}, 100, null, {{other_venue}})`),
      T('today_other_venue', 'hc', `select app.production_today({{other_venue}})`),
      ...(['hb', 'bar', 'drv', 'mkt', 'cashier', 'desk', 'prep'] as const).flatMap((who) => [
        T(`batch_${who}`, who, `select app.record_batch({{dough}}, 100)`),
        T(`today_${who}`, who, `select app.production_today({{venue}})`),
        T(`log_${who}`, who, `select app.production_log_today({{venue}})`),
      ]),
      // The manager's door is unchanged: MGMT only, with its unit cost.
      T('rp_mgr', 'manager', `select app.record_production({{dough}}, 100)`),
      T('rp_chef', 'chef', `select app.record_production({{dough}}, 100)`),
      T('rp_hc', 'hc', `select app.record_production({{dough}}, 100)`),
      T('internal', 'manager', `select app.record_production_internal({{dough}}, 100, null, null)`),
      // No cost anywhere for the chefs: the ledger and batches stay MGMT's.
      ...(['chef', 'hc', 'drv', 'mkt'] as const).flatMap((who) => [
        T(`read_${who}_batches`, who, `select count(*)::text::jsonb from stock_batches`),
        T(`read_${who}_moves`, who, `select count(*)::text::jsonb from stock_movements`),
      ]),
      Q('moves', `select count(*)::text::jsonb from stock_movements
                   where ingredient_id in ({{dough}}::uuid, {{syrup}}::uuid, {{sugar}}::uuid, {{retired}}::uuid,
                                           {{far_dough}}::uuid)`),
    ]);

    expect(refused(r, 'qty_zero')).toBe('INVALID_QTY');
    expect(refused(r, 'no_recipe')).toBe('NO_RECIPE');
    expect(refused(r, 'bought')).toMatch(/^NOT_PREPARED/);
    expect(refused(r, 'retired')).toMatch(/^NOT_PREPARED/);
    expect(refused(r, 'far')).toBe('INGREDIENT_NOT_FOUND');
    expect(refused(r, 'missing')).toBe('INGREDIENT_NOT_FOUND');
    expect(refused(r, 'other_venue')).toBe('FORBIDDEN');
    expect(refused(r, 'today_other_venue')).toBe('FORBIDDEN');
    for (const who of ['hb', 'bar', 'drv', 'mkt', 'cashier', 'desk', 'prep']) {
      expect(refused(r, `batch_${who}`), who).toBe('FORBIDDEN');
      expect(refused(r, `today_${who}`), who).toBe('FORBIDDEN');
      expect(refused(r, `log_${who}`), who).toBe('FORBIDDEN');
    }
    expect(Object.keys(ok<Record<string, unknown>>(r, 'rp_mgr')).sort()).toEqual(['batch_id', 'expiry_date', 'unit_cost_iqd']);
    expect(refused(r, 'rp_chef')).toBe('FORBIDDEN');
    expect(refused(r, 'rp_hc')).toBe('FORBIDDEN');
    expect(refused(r, 'internal')).toMatch(/permission denied/);
    for (const who of ['chef', 'hc', 'drv', 'mkt']) {
      expect(ok<number>(r, `read_${who}_batches`), who).toBe(0);
      expect(ok<number>(r, `read_${who}_moves`), who).toBe(0);
    }
    // Only the manager's 100 g of dough moved.
    expect(ok<number>(r, 'moves')).toBe(1);
  });
});
