/**
 * staff_stock_view (build-contracts-2026-09-23 §2.24.5, §8.2): stock by
 * quantity, never by money, for the head roles and the court desk.
 *
 *   * the head barista and the head chef see purchased and prepared stock,
 *     the court desk retail stock with the shop product each row backs, MGMT
 *     all three; a head asking for retail, or the desk for purchased, is
 *     FORBIDDEN; an unknown kind is INVALID_ARGUMENT;
 *   * no key at any depth ends in _iqd or starts with cost, supplier, revenue
 *     or discount;
 *   * barista, chef, cashier, driver, marketing and prep are refused (§0 P5,
 *     §8.2);
 *   * another venue's ingredients never appear, nor inactive ones;
 *   * on_hand equals the batch sum after a delivery and a sale; low and
 *     below_par follow the threshold and par (strictly below par).
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness): staff, ingredients, a shop product,
 * a delivery and a sale are created inside it and each call runs as
 * `authenticated` with the caller's JWT claims. Nothing is committed. Without
 * docker on PATH the suite skips itself.
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

// ── the in-transaction harness (as protocols-engine-flow.test.ts) ──────────
// t() runs one statement as a staff member (as `authenticated`); as() runs it
// as the definer's caller (postgres, with the JWT claims set) for internal
// functions; q() reads as postgres; keep() stores a value; mk() makes an auth
// user + staff row (the 0123 trigger files a non-owner at venue A).
const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('cashier', '${SEED_STAFF_IDS.cashier}'), ('desk', '${SEED_STAFF_IDS.court_desk}'),
  ('prep', '${SEED_STAFF_IDS.prep}'), ('venue', '${VENUE_A_ID}');

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
  execute pg_temp.sub(p_sql) into v;
  if v is null then raise exception 'keep %: no value', p_name; end if;
  insert into pg_temp.vars values (p_name, v) on conflict (name) do update set val = excluded.val;
end $f$;

create function pg_temp.mk(p_name text, p_role staff_role) returns void language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'ssv-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'SSV ' || p_name, p_role, true);
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

const TAX = 'b0000000-0000-4000-8000-000000000001';
const OTHER_VENUE = '00000000-0000-4000-8000-00000000c6c6';
const ING = (name: string, kind: string, unit: string, extra = '', venue = '{{venue}}') =>
  KEEP(name, `insert into ingredients (kind, name_en, name_ar, unit, venue_id, pack_size, pack_cost_iqd, supplier_name${extra ? ', ' + extra.split('=')[0] : ''})
              values ('${kind}', 'SSV ${name}', 'مادة ${name}', '${unit}', ${venue}, 1000, 25000, 'SSV Mill'${extra ? ', ' + extra.split('=')[1] : ''})
              returning id::text`);

/** Keys that would carry money or a supplier, at any depth. */
function moneyKeys(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => moneyKeys(x, `${path}[${i}]`));
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [
      ...(/_iqd$|^cost|^supplier|^revenue|^discount|price/i.test(k) ? [`${path}.${k}`] : []),
      ...moneyKeys(x, `${path}.${k}`),
    ]);
  }
  return [];
}

interface Row {
  ingredient_id: string;
  kind: string;
  name_en: string;
  unit: string;
  pack_size: number | null;
  on_hand: number;
  par_level: number | null;
  low_stock_threshold: number | null;
  low: boolean;
  below_par: boolean;
  next_expiry: string | null;
  product: null | { menu_item_id: string; name_en: string; size_name_en: string };
}
type View = { as_of: string; items: Row[] };
const names = (r: Results, label: string) =>
  ok<View>(r, label).items.map((i) => i.name_en).filter((n) => n.startsWith('SSV '));

describe.skipIf(!docker)('staff_stock_view (rolled-back transactions)', () => {
  it('each role sees exactly its kinds, with quantities and no money', () => {
    const r = scenario([
      `insert into venues (id, slug, name_en, name_ar, is_active)
       values ('${OTHER_VENUE}', 'ssv-other-venue', 'SSV other', 'مكان آخر', false);`,
      MK('hb', 'head_barista'), MK('hc', 'head_chef'),
      ...(['bar', 'chef', 'drv', 'mkt'] as const).map((w) =>
        MK(w, { bar: 'barista', chef: 'chef', drv: 'driver', mkt: 'marketing' }[w])),
      ING('beans', 'purchased', 'g', 'par_level=5000'),
      ING('milk', 'purchased', 'ml', 'low_stock_threshold=2000'),
      ING('syrup', 'prepared', 'ml', 'par_level=500'),
      ING('ball', 'retail', 'pc', 'low_stock_threshold=3'),
      ING('off', 'purchased', 'g', 'is_active=false'),
      ING('far', 'purchased', 'g', '', `'${OTHER_VENUE}'`),
      KEEP('shop_cat', `insert into menu_categories (name_en, name_ar, tax_group_id, venue_id, kind)
                        values ('SSV shop', 'متجر', '${TAX}', {{venue}}, 'shop') returning id::text`),
      KEEP('ball_item', `insert into menu_items (category_id, name_en, name_ar, venue_id)
                         values ({{shop_cat}}::uuid, 'SSV Padel ball', 'كرة بادل', {{venue}}) returning id::text`),
      KEEP('ball_size', `insert into menu_item_variants (item_id, name_en, name_ar, price_iqd, is_default)
                         values ({{ball_item}}::uuid, 'Tube of 3', 'علبة 3', 12000, true) returning id::text`),
      `insert into recipe_lines (variant_id, ingredient_id, qty)
       select s.val::uuid, b.val::uuid, 1 from pg_temp.vars s, pg_temp.vars b where s.name = 'ball_size' and b.name = 'ball';`,
      // A delivery (two batches of beans, one of milk, balls), then a sale of beans.
      T('delivery', 'manager', `select app.receive_delivery(jsonb_build_array(
          jsonb_build_object('ingredient_id', {{beans}}, 'qty_expected', 3000, 'qty_received', 3000, 'unit_cost_iqd', 20, 'expiry_date', '2031-01-10'),
          jsonb_build_object('ingredient_id', {{beans}}, 'qty_expected', 2000, 'qty_received', 2000, 'unit_cost_iqd', 21, 'expiry_date', '2031-02-10'),
          jsonb_build_object('ingredient_id', {{milk}}, 'qty_expected', 1500, 'qty_received', 1500, 'unit_cost_iqd', 2),
          jsonb_build_object('ingredient_id', {{ball}}, 'qty_expected', 5, 'qty_received', 5, 'unit_cost_iqd', 9000)),
          'SSV Mill', null, null, null, null)`),
      `select app.consume_fefo((select val::uuid from pg_temp.vars where name = 'beans'), 250, 'sale_consumption');`,
      Q('batch_sum', `select to_jsonb(sum(qty_remaining)) from stock_batches
                       where ingredient_id = (select val::uuid from pg_temp.vars where name = 'beans')`),
      ...(['hb', 'hc', 'desk', 'manager', 'owner'] as const).map((who) =>
        T(`view_${who}`, who, `select app.staff_stock_view({{venue}})`)),
      T('hb_retail', 'hb', `select app.staff_stock_view({{venue}}, 'retail')`),
      T('desk_purchased', 'desk', `select app.staff_stock_view({{venue}}, 'purchased')`),
      T('hc_prepared', 'hc', `select app.staff_stock_view(null, 'prepared')`),
      T('mgr_retail', 'manager', `select app.staff_stock_view({{venue}}, 'retail')`),
      T('bad_kind', 'manager', `select app.staff_stock_view({{venue}}, 'frozen')`),
      T('far', 'owner', `select app.staff_stock_view('${OTHER_VENUE}')`),
      T('far_mgr', 'manager', `select app.staff_stock_view('${OTHER_VENUE}')`),
      ...(['bar', 'chef', 'cashier', 'drv', 'mkt', 'prep'] as const).map((who) =>
        T(`view_${who}`, who, `select app.staff_stock_view({{venue}})`)),
    ]);
    ok(r, 'delivery');
    for (const who of ['hb', 'hc']) {
      expect(names(r, `view_${who}`).sort(), who).toEqual(['SSV beans', 'SSV milk', 'SSV syrup']);
      expect(ok<View>(r, `view_${who}`).items.every((i) => i.kind !== 'retail'), who).toBe(true);
    }
    expect(names(r, 'view_desk')).toEqual(['SSV ball']);
    expect(ok<View>(r, 'view_desk').items.every((i) => i.kind === 'retail')).toBe(true);
    for (const who of ['manager', 'owner']) {
      expect(names(r, `view_${who}`).sort(), who).toEqual(['SSV ball', 'SSV beans', 'SSV milk', 'SSV syrup']);
    }
    for (const who of ['hb', 'hc', 'desk', 'manager', 'owner']) {
      expect(moneyKeys(ok(r, `view_${who}`)), who).toEqual([]);
      const ours = ok<View>(r, `view_${who}`).items.filter((i) => i.name_en.startsWith('SSV '));
      expect(JSON.stringify(ours), who).not.toMatch(/SSV Mill|25000/);
    }
    const byName = (label: string) => Object.fromEntries(ok<View>(r, label).items.map((i) => [i.name_en, i]));
    const mgr = byName('view_manager');
    // on_hand is the batch sum after the delivery and the sale.
    expect(mgr['SSV beans']!.on_hand).toBe(Number(ok<number>(r, 'batch_sum')));
    expect(mgr['SSV beans']).toMatchObject({ on_hand: 4750, par_level: 5000, below_par: true, low: false,
                                             unit: 'g', pack_size: 1000, next_expiry: '2031-01-10', product: null });
    expect(mgr['SSV milk']).toMatchObject({ on_hand: 1500, low_stock_threshold: 2000, low: true, below_par: false,
                                            next_expiry: null });
    expect(mgr['SSV syrup']).toMatchObject({ on_hand: 0, below_par: true, low: false });
    expect(mgr['SSV ball']).toMatchObject({ on_hand: 5, low: false,
                                            product: { name_en: 'SSV Padel ball', size_name_en: 'Tube of 3' } });
    // Low first.
    const mine = ok<View>(r, 'view_manager').items.filter((i) => i.name_en.startsWith('SSV '));
    expect(mine[0]!.name_en).toBe('SSV milk');
    expect(refused(r, 'hb_retail')).toBe('FORBIDDEN:kind');
    expect(refused(r, 'desk_purchased')).toBe('FORBIDDEN:kind');
    expect(names(r, 'hc_prepared')).toEqual(['SSV syrup']);
    expect(names(r, 'mgr_retail')).toEqual(['SSV ball']);
    expect(refused(r, 'bad_kind')).toBe('INVALID_ARGUMENT:kind');
    expect(refused(r, 'far')).toBe('FORBIDDEN');
    expect(refused(r, 'far_mgr')).toBe('FORBIDDEN');
    for (const who of ['bar', 'chef', 'cashier', 'drv', 'mkt', 'prep']) {
      expect(refused(r, `view_${who}`), who).toBe('FORBIDDEN');
    }
  });

  it('agrees with production_today at exactly par', () => {
    const r = scenario([
      MK('hc', 'head_chef'),
      ING('dough', 'prepared', 'g', 'par_level=100'),
      KEEP('flour', `insert into ingredients (kind, name_en, name_ar, unit, venue_id)
                     values ('purchased', 'SSV flour', 'طحين', 'g', {{venue}}) returning id::text`),
      `insert into recipe_lines (output_ingredient_id, ingredient_id, qty)
       select d.val::uuid, f.val::uuid, 1 from pg_temp.vars d, pg_temp.vars f where d.name = 'dough' and f.name = 'flour';`,
      `insert into stock_batches (ingredient_id, qty_received, qty_remaining, unit_cost_iqd, venue_id)
       select val::uuid, 100, 100, 3, '${VENUE_A_ID}' from pg_temp.vars where name = 'dough';`,
      T('view', 'hc', `select app.staff_stock_view({{venue}}, 'prepared')`),
      T('make', 'hc', `select app.production_today({{venue}})`),
    ]);
    const view = ok<View>(r, 'view').items.find((i) => i.name_en === 'SSV dough')!;
    const make = ok<{ items: Array<{ name_en: string; on_hand: number; below_par: boolean }> }>(r, 'make').items
      .find((i) => i.name_en === 'SSV dough')!;
    expect(view).toMatchObject({ on_hand: 100, below_par: false });
    expect(make).toMatchObject({ on_hand: view.on_hand, below_par: view.below_par });
  });
});
