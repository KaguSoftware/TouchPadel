/**
 * price_promo (build-contracts-2026-09-23 §2.13, §2.8, §2.19, §8.2): the price
 * or promotion change protocol, and the manager locks that send every list
 * price, promotion, court rate and the featured-item discount through it.
 *
 *   * the size and add-on locks (#41, #51, #53), as the manager and as the
 *     owner: a launched item's size price and a new size, cafe or shop,
 *     through upsert_variant and upsert_retail_variant (the pin: it is not
 *     re-issued); a launched add-on's price; LAUNCH_VIA_PROTOCOL on a paid
 *     add-on never launched; the drafts a manager still prices; a free option
 *     stamped launched; the accepted limit (#59): an old item and add-on
 *     renamed and switched back on keep their locked price;
 *   * the compulsory add-on lock: a manager's choice limit, item link,
 *     reveal, or option switched off or moved that raises what a guest pays
 *     at least for an item or a choice (PRICE_VIA_PROTOCOL, required_addon);
 *   * the round 10 locks (#57): promotions (a new one, an edit, a switch-on, a
 *     code; a switch-off passes), court rates (every save) and the featured
 *     discount (the percentage, the featured item under a discount, Featured
 *     mode with a stored discount), set_cafe_settings reaching the lock with
 *     no re-issue (the pin), and the keys that pass as before;
 *   * each of the eight change kinds, started by marketing or the manager,
 *     numbers by the manager, the owner's OK, applied now or on a date by the
 *     cron; an applied promotion names the approving owner as its
 *     authoriser; a shop_launch never takes a release draft, and a launched
 *     product stays off the cafe menu for a manager; the propose-time refusals (RECORD_INVALID with the field, never a
 *     writer's code); PRICE_TARGET_CHANGED for each kind of stale target; a
 *     due run that reverts with apply_not_ready while another applies;
 *   * the featured discount put live by Featured mode reaches add_order_items;
 *   * the driver and marketing (§8.2): no writer, no numbers, no mgmt
 *     record, no shop_launch for marketing, and targets without cost or sales;
 *   * renames (wave5-addendum-2026-09-25 §2.2, Majed's #9): a manager's new
 *     name for a size on sale or a paid add-on on sale is PRICE_VIA_PROTOCOL
 *     hint name, after the price check; whitespace, default, order, a move,
 *     a draft, a free or never-launched add-on and the owner pass; renames
 *     ride on the price and addon_price kinds, apply in place (a swap, a shop
 *     size's stock row), go stale on a name written since, and are refused
 *     at the proposal with renames as the field.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness, with the real price_promo hooks):
 * staff, items, add-ons, courts, rules and runs are created inside it and each
 * call runs as `authenticated` with the caller's JWT claims, as PostgREST runs
 * it. The cron is called as the database owner, as pg_cron calls it. Nothing
 * is committed. Without docker on PATH the suite skips itself.
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

// ── the in-transaction harness (as product-release.test.ts) ────────────────
// vars: named values; {{name}} in a statement is its quoted literal, @@name@@
// its raw text. t(): one call as a staff member (role authenticated + claims).
// q(): a read as postgres. x(): a statement as postgres. keep(): a value into
// vars. mk(): an auth user and a staff row (the 0123 trigger files a non-owner
// at venue A).
const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('cashier', '${SEED_STAFF_IDS.cashier}'), ('desk', '${SEED_STAFF_IDS.court_desk}'),
  ('venue', '${VENUE_A_ID}'), ('tax', '${SEED_TAX_GROUP_STANDARD}');

create function pg_temp.sub(p_sql text) returns text language plpgsql as $f$
declare r record; v text := p_sql;
begin
  for r in select name, val from pg_temp.vars order by length(name) desc loop
    v := replace(v, '{{' || r.name || '}}', quote_literal(r.val));
    v := replace(v, '@@' || r.name || '@@', r.val);
  end loop;
  if v ~ '\\{\\{[a-z0-9_]+\\}\\}|@@[a-z0-9_]+@@' then
    raise exception 'unbound variable in: %', v;
  end if;
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
  perform set_config('request.jwt.claims', '', true);
  execute pg_temp.sub(p_sql) into v;
  insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
end $f$;

create function pg_temp.x(p_sql text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  execute pg_temp.sub(p_sql);
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
  values (v, 'pp-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active) values (v, 'PP ' || p_name, p_role, true);
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
      `insert into pg_temp.out(label, res) select '__var_' || name, jsonb_build_object('ok', true, 'data', val) from pg_temp.vars;\n` +
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
const X = (sql: string) => `select pg_temp.x($q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const RES = (name: string, label: string, path = '') =>
  KEEP(name, `select res #>> '{data${path ? `,${path}` : ''}}' from pg_temp.out where label = '${label}'`);
const MK = (name: string, role: string) => `select pg_temp.mk('${name}', '${role}');`;
const STEPK = (name: string, run: string, key: string) =>
  KEEP(name, `select id::text from protocol_run_steps where run_id = {{${run}}} and step_key = '${key}'`);
/** The live (undecided, not withdrawn or set aside) submission of a step. */
const LIVE_SUB = (name: string, step: string) =>
  KEEP(
    name,
    `select id::text from protocol_submissions where run_step_id = {{${step}}}
       and decision is null and withdrawn_at is null and superseded_at is null`,
  );

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
const v = (r: Results, name: string): string => ok<string>(r, `__var_${name}`);

// ── fixtures, written as postgres inside the transaction ────────────────────
const LONG_AGO = `now() - interval '400 days'`;
const CAT = (name: string, kind: 'cafe' | 'shop') =>
  KEEP(name, `insert into menu_categories (name_en, name_ar, tax_group_id, is_active, venue_id, kind)
              values ('PP ${name}', 'فئة', {{tax}}, true, {{venue}}, '${kind}') returning id::text`);
/** An item: `launched` = it existed before the migration (launched_at set long ago). */
const ITEM = (name: string, cat: string, active: boolean, launched: boolean) =>
  KEEP(name, `insert into menu_items (category_id, name_en, name_ar, is_active, venue_id, launched_at)
              values ({{${cat}}}, 'PP ${name}', 'صنف', ${active}, {{venue}}, ${launched ? LONG_AGO : 'null'})
              returning id::text`);
const SIZE = (name: string, item: string, price: number, sort = 0, isDefault = sort === 0) =>
  KEEP(name, `insert into menu_item_variants (item_id, name_en, name_ar, price_iqd, is_default, sort_order)
              values ({{${item}}}, 'PP ${name}', 'حجم', ${price}, ${isDefault}, ${sort}) returning id::text`);
const GROUP = (name: string, venue = 'venue') =>
  KEEP(name, `insert into modifier_groups (name_en, name_ar, min_select, max_select, venue_id)
              values ('PP ${name}', 'مجموعة', 0, 2, {{${venue}}}) returning id::text`);
const MOD = (name: string, group: string, delta: number, active: boolean, launched: boolean) =>
  KEEP(name, `insert into modifiers (group_id, name_en, name_ar, price_delta_iqd, is_active, launched_at)
              values ({{${group}}}, 'PP ${name}', 'إضافة', ${delta}, ${active}, ${launched ? LONG_AGO : 'null'})
              returning id::text`);
/** A second venue, switched off, for the cross-venue refusals. */
const VENUE_X = KEEP(
  'venue_x',
  `insert into venues (slug, name_en, name_ar, is_active)
   values ('pp-x-' || substr(md5(random()::text), 1, 8), 'PP other', 'فرع آخر', false) returning id::text`,
);
const COURT = (name: string, venue = 'venue') =>
  KEEP(name, `insert into courts (name_en, name_ar, venue_id, sort_order)
              values ('PP ${name}', 'ملعب', {{${venue}}}, 900) returning id::text`);
/** The owner's featured baseline: the item, the percentage and the hero mode. */
const FEATURED = (label: string, item: string, pct: number, mode: string) =>
  T(label, 'owner',
    `select app.set_cafe_settings(jsonb_build_object('featured_item_id', {{${item}}}, 'featured_discount_pct', ${pct}, 'hero_mode', '${mode}'))`);

// ── one run: start, the proposal's decision, numbers, the owner's OK, announce, apply ──
const REASON = `'reason', 'Costs moved', 'expected_effect', 'Same margin'`;
const START = (label: string, who: string, record: string) =>
  T(label, who, `select app.start_protocol(p_kind => 'price_promo', p_title_en => 'PP ${label}',
                   p_title_ar => ${who === 'owner' ? `'تغيير ${label}'` : 'null'},
                   p_first_record => ${record}, p_venue_id => {{venue}}::uuid)`);
/** Start a run and keep its id and step ids as <run>, <run>_prop, _num, _ann, _app. */
const RUN = (run: string, who: string, record: string) => [
  START(`${run}_start`, who, record),
  RES(run, `${run}_start`, 'run_id'),
  STEPK(`${run}_prop`, run, 'propose'),
  STEPK(`${run}_num`, run, 'numbers'),
  STEPK(`${run}_ann`, run, 'announce'),
  STEPK(`${run}_app`, run, 'apply'),
];
/** A manager accepts marketing's proposal. */
const ACCEPT = (run: string) => [
  LIVE_SUB(`${run}_sub1`, `${run}_prop`),
  T(`${run}_prop_ok`, 'manager', `select app.decide_step({{${run}_sub1}}, 'approve')`),
];
/** The manager's numbers, approved by the owner; announce skipped. */
const NUMBERS = (run: string, record = `'{"recommendation":"go"}'`) => [
  T(`${run}_numbers`, 'manager', `select app.submit_step({{${run}_num}}, ${record})`),
  LIVE_SUB(`${run}_sub_num`, `${run}_num`),
  T(`${run}_num_ok`, 'owner', `select app.decide_step({{${run}_sub_num}}, 'approve')`),
  T(`${run}_skip`, 'manager', `select app.skip_step({{${run}_ann}}, 'No announcement')`),
];
const APPLY_NOW = (run: string, label = `${run}_apply`) =>
  T(label, 'manager', `select app.submit_step({{${run}_app}}, '{"when":"now"}')`);
const APPLY_DATE = (run: string) =>
  T(`${run}_apply`, 'manager',
    `select app.submit_step({{${run}_app}}, jsonb_build_object('when', 'date', 'at', now() + interval '1 day'))`);
/** The date has come: the run is due for the cron. */
const DUE = (run: string) => X(`update protocol_runs set scheduled_for = now() - interval '1 minute' where id = {{${run}}}`);
const RUN_STATUS = (label: string, run: string) =>
  Q(label, `select jsonb_build_object('status', status, 'finished', finished_at is not null) from protocol_runs where id = {{${run}}}`);

/** Keys that would carry a cost or a sales figure, at any depth. */
function salesKeys(val: unknown, path = ''): string[] {
  if (Array.isArray(val)) return val.flatMap((x, i) => salesKeys(x, `${path}[${i}]`));
  if (val && typeof val === 'object') {
    return Object.entries(val as Record<string, unknown>).flatMap(([k, x]) => [
      ...(/^(cost|revenue|margin|units|count|redemption|sold)|_30d$/i.test(k) ? [`${path}.${k}`] : []),
      ...salesKeys(x, `${path}.${k}`),
    ]);
  }
  return [];
}

describe.skipIf(!docker)('price_promo: the manager locks and the price or promotion change', () => {
  it('locks sizes, shop products and add-ons for a manager; drafts stay open; the owner passes', () => {
    const retail = (who: string, label: string, item: string, price: number, extra = '') =>
      T(label, who, `select app.upsert_retail_variant(p_item_id => {{${item}}}::uuid, p_name_en => 'M', p_name_ar => 'وسط',
                                                     p_price_iqd => ${price}${extra})`);
    const variant = (who: string, label: string, item: string, name: string, price: number, id: string | null, sort = 0) =>
      T(label, who, `select to_jsonb(app.upsert_variant({{${item}}}::uuid, '${name}', '${name}', ${price},
                                                       ${id ? `{{${id}}}::uuid` : 'null'}, ${id !== null && sort === 0}, ${sort}))`);
    const mod = (who: string, label: string, id: string | null, name: string, price: number, active: boolean, sort = 0,
                 nameAr = name) =>
      T(label, who, `select to_jsonb(app.upsert_modifier({{grp}}::uuid, '${name}', '${nameAr}',
                                                        ${id ? `{{${id}}}::uuid` : 'null'}, ${price}, ${sort}, ${active}))`);
    const r = scenario([
      CAT('cafe', 'cafe'),
      CAT('shop', 'shop'),
      ITEM('on', 'cafe', true, true),
      SIZE('on_s', 'on', 5000),
      ITEM('old', 'cafe', false, true), // existed before the migration, off today
      SIZE('old_s', 'old', 4000),
      ITEM('fixture', 'cafe', true, false), // written around the RPCs, on sale
      SIZE('fixture_s', 'fixture', 3000),
      ITEM('draft', 'cafe', false, false), // never launched, hidden
      SIZE('draft_s', 'draft', 3000),
      ITEM('prod', 'shop', true, true),
      retail('owner', 'prod_size', 'prod', 50000),
      RES('prod_s', 'prod_size', 'variant_id'),
      ITEM('sdraft', 'shop', false, false), // the manager's hidden shop draft
      KEEP('sup', `insert into suppliers (venue_id, name) values ({{venue}}, 'PP supplier ' || substr(md5(random()::text), 1, 6))
                   returning id::text`),
      GROUP('grp'),
      MOD('mod_on', 'grp', 500, true, true),
      MOD('mod_old', 'grp', 750, false, true),
      MOD('mod_draft', 'grp', 1000, false, false),

      // Refused for the manager: every price of what is on sale or was.
      variant('manager', 'm_on_price', 'on', 'PP on_s', 6000, 'on_s'),
      variant('manager', 'm_on_size', 'on', 'Large', 7000, null, 1),
      variant('manager', 'm_old_price', 'old', 'PP old_s', 4500, 'old_s'),
      variant('manager', 'm_fixture_price', 'fixture', 'PP fixture_s', 3500, 'fixture_s'),
      variant('manager', 'm_prod_price', 'prod', 'M', 55000, 'prod_s'),
      retail('manager', 'm_prod_retail', 'prod', 55000, `, p_id => {{prod_s}}::uuid`),
      retail('manager', 'm_prod_retail_new', 'prod', 60000),
      mod('manager', 'm_mod_on', 'mod_on', 'PP mod_on', 600, true),
      mod('manager', 'm_mod_old', 'mod_old', 'PP mod_old', 800, false),

      // Allowed for the manager: the drafts, and everything but the price.
      variant('manager', 'm_draft_price', 'draft', 'PP draft_s', 3500, 'draft_s'),
      variant('manager', 'm_draft_size', 'draft', 'Big', 4500, null, 1),
      retail('manager', 'm_sdraft_size', 'sdraft', 20000),
      RES('sdraft_s', 'm_sdraft_size', 'variant_id'),
      retail('manager', 'm_sdraft_price', 'sdraft', 21000, `, p_id => {{sdraft_s}}::uuid`),
      mod('manager', 'm_mod_draft', 'mod_draft', 'PP mod_draft', 1200, false),
      retail('manager', 'm_prod_meta', 'prod', 50000,
        `, p_sku => 'PP-' || substr(md5(random()::text), 1, 8),
           p_barcode => '62' || lpad((floor(random() * 1e10))::bigint::text, 11, '0'),
           p_supplier_id => {{sup}}::uuid, p_pack_cost_iqd => 30000, p_low_stock_threshold => 5,
           p_id => {{prod_s}}::uuid`),
      // A name is locked with the price since price_promo_renames (#9).
      T('m_rename', 'manager', `select to_jsonb(app.upsert_variant({{on}}::uuid, 'Classic', 'كلاسيك', 5000, {{on_s}}::uuid, false, 3))`),
      mod('manager', 'm_mod_rename', 'mod_on', 'Renamed', 500, true, 4),
      mod('manager', 'm_mod_off', 'mod_on', 'PP mod_on', 500, false, 4, 'إضافة'),
      mod('manager', 'm_mod_on_again', 'mod_on', 'PP mod_on', 500, true, 4, 'إضافة'),

      // A paid add-on goes on sale through a change; a free one directly.
      mod('manager', 'm_oat_on', null, 'Oat milk', 1500, true, 5),
      mod('manager', 'm_oat_hidden', null, 'Oat milk', 1500, false, 5),
      RES('oat', 'm_oat_hidden'),
      mod('manager', 'm_oat_switch_on', 'oat', 'Oat milk', 1500, true, 5),
      mod('manager', 'm_oat_price', 'oat', 'Oat milk', 1800, false, 5),
      mod('manager', 'm_free', null, 'No ice', 0, true, 6),
      RES('free', 'm_free'),
      Q('free_stamp', `select to_jsonb(launched_at is not null) from modifiers where id = {{free}}`),
      mod('manager', 'm_free_price', 'free', 'No ice', 250, true, 6),
      Q('oat_stamp', `select to_jsonb(launched_at is null) from modifiers where id = {{oat}}`),

      // The accepted limit (#59): an old item and add-on come back at their old
      // price only, and the paid add-on under its old name (#9).
      T('m_old_back', 'manager', `select to_jsonb(app.upsert_menu_item({{cafe}}::uuid, 'PP old renamed', 'قديم', {{old}}::uuid,
                                                                      null, null, 0, true))`),
      variant('manager', 'm_old_price2', 'old', 'PP old_s', 4800, 'old_s'),
      mod('manager', 'm_mod_old_rename', 'mod_old', 'Old renamed', 750, true),
      mod('manager', 'm_mod_old_back', 'mod_old', 'PP mod_old', 750, true, 0, 'إضافة'),
      mod('manager', 'm_mod_old_price2', 'mod_old', 'Old renamed', 900, true),

      // The owner passes every lock.
      variant('owner', 'o_on_price', 'on', 'Classic', 6000, 'on_s'),
      variant('owner', 'o_on_size', 'on', 'Large', 7000, null, 4),
      variant('owner', 'o_old_price', 'old', 'PP old_s', 4800, 'old_s'),
      retail('owner', 'o_prod_retail', 'prod', 55000, `, p_id => {{prod_s}}::uuid`),
      mod('owner', 'o_mod_on', 'mod_on', 'Renamed', 600, true, 4),
      mod('owner', 'o_mod_new_paid', null, 'Almond', 1500, true, 7),
      Q('prices', `select jsonb_build_object(
                     'on', (select price_iqd from menu_item_variants where id = {{on_s}}),
                     'on_name', (select name_en from menu_item_variants where id = {{on_s}}),
                     'old', (select price_iqd from menu_item_variants where id = {{old_s}}),
                     'old_on', (select is_active from menu_items where id = {{old}}),
                     'prod', (select price_iqd from menu_item_variants where id = {{prod_s}}),
                     'draft', (select price_iqd from menu_item_variants where id = {{draft_s}}),
                     'sdraft', (select price_iqd from menu_item_variants where id = {{sdraft_s}}),
                     'mod_on', (select price_delta_iqd from modifiers where id = {{mod_on}}),
                     'mod_old', (select jsonb_build_object('price', price_delta_iqd, 'on', is_active) from modifiers where id = {{mod_old}}),
                     'oat', (select jsonb_build_object('price', price_delta_iqd, 'on', is_active) from modifiers where id = {{oat}}))`),
    ]);

    for (const label of ['m_on_price', 'm_on_size', 'm_old_price', 'm_fixture_price', 'm_prod_price', 'm_prod_retail',
                         'm_prod_retail_new', 'm_mod_on', 'm_mod_old', 'm_free_price', 'm_old_price2', 'm_mod_old_price2']) {
      expect(refused(r, label), label).toBe('PRICE_VIA_PROTOCOL');
    }
    for (const label of ['m_draft_price', 'm_draft_size', 'm_sdraft_price', 'm_mod_draft', 'm_prod_meta',
                         'm_mod_off', 'm_mod_on_again', 'm_oat_price', 'm_old_back', 'm_mod_old_back',
                         'o_on_price', 'o_on_size', 'o_old_price', 'o_prod_retail', 'o_mod_on', 'o_mod_new_paid']) {
      ok(r, label);
    }
    for (const label of ['m_rename', 'm_mod_rename', 'm_mod_old_rename']) {
      expect(refused(r, label), label).toBe('PRICE_VIA_PROTOCOL:name');
    }
    expect(refused(r, 'm_oat_on')).toBe('LAUNCH_VIA_PROTOCOL');
    expect(refused(r, 'm_oat_switch_on')).toBe('LAUNCH_VIA_PROTOCOL');
    expect(ok(r, 'free_stamp')).toBe(true);
    expect(ok(r, 'oat_stamp')).toBe(true);
    expect(ok(r, 'prices')).toEqual({
      on: 6000, on_name: 'Classic', old: 4800, old_on: true, prod: 55000, draft: 3500, sdraft: 21000,
      mod_on: 600, mod_old: { price: 750, on: true }, oat: { price: 1800, on: false },
    });
  });

  it('keeps a manager from making a paid add-on compulsory: a choice limit, a link, a reveal, an option off or moved', () => {
    const group = (who: string, label: string, id: string, min: number, max = 2) =>
      T(label, who, `select to_jsonb(app.upsert_modifier_group('PP ${id}', 'مجموعة', {{${id}}}::uuid, ${min}, ${max}))`);
    const link = (who: string, label: string, item: string, grp: string, linked = true) =>
      T(label, who, `select jsonb_build_object('ok', true)
                       from (select app.link_item_modifier_group({{${item}}}::uuid, {{${grp}}}::uuid, 0, ${linked})) x`);
    // The stored names (MOD's) unless a new one is given: a paid add-on's
    // rename is locked on its own (#9).
    const mod = (who: string, label: string, id: string, grp: string, price: number, active: boolean, name?: string) =>
      T(label, who, `select to_jsonb(app.upsert_modifier({{${grp}}}::uuid, '${name ?? `PP ${id}`}', '${name ?? 'إضافة'}',
                                                        {{${id}}}::uuid, ${price}, 0, ${active}))`);
    const reveals = (who: string, label: string, id: string, groups: string[]) =>
      T(label, who, `select jsonb_build_object('ok', true)
                       from (select app.set_modifier_reveals({{${id}}}::uuid,
                               array[${groups.map((g) => `{{${g}}}::uuid`).join(', ')}]::uuid[])) x`);
    const LINK = (item: string, grp: string) =>
      X(`insert into menu_item_modifier_groups (item_id, group_id) values ({{${item}}}, {{${grp}}})`);
    const MIN = (grp: string, min: number) => X(`update modifier_groups set min_select = ${min} where id = {{${grp}}}`);
    const r = scenario([
      CAT('cafe', 'cafe'),
      ITEM('coffee', 'cafe', true, true),
      ITEM('coffee2', 'cafe', true, true),
      ITEM('coffee3', 'cafe', true, true),
      ITEM('meal', 'cafe', true, true),
      // Extra shots, paid only, offered nowhere yet.
      GROUP('shots'),
      MOD('shot', 'shots', 1000, true, true),
      // Milk on the second coffee: a free choice and a paid one.
      GROUP('milk'),
      MOD('regular', 'milk', 0, true, true),
      MOD('oat', 'milk', 1500, true, true),
      LINK('coffee2', 'milk'),
      // "Make it a meal" (free) and two sides it may reveal.
      GROUP('meal_grp'),
      MOD('make_meal', 'meal_grp', 0, true, true),
      LINK('meal', 'meal_grp'),
      GROUP('side'),
      MOD('fries', 'side', 2000, true, true),
      MIN('side', 1),
      GROUP('side_free'),
      MOD('salad', 'side_free', 0, true, true),
      MOD('fries2', 'side_free', 2000, true, true),
      MIN('side_free', 1),
      // The owner's compulsory all-paid group on the third coffee.
      GROUP('shot_size'),
      MOD('single', 'shot_size', 500, true, true),
      MOD('double', 'shot_size', 1000, true, true),
      MIN('shot_size', 1),
      LINK('coffee3', 'shot_size'),

      // Offered nowhere, the group is the manager's as before; linked where
      // it would cost a guest 1000 more, it is the owner's.
      group('manager', 'm_shots_min', 'shots', 1),
      link('manager', 'm_link_shots', 'coffee', 'shots'),
      link('owner', 'o_link_shots', 'coffee', 'shots'),
      // A choice with a free option stays the manager's; a second pick, the
      // free option switched off or moved out, is not.
      group('manager', 'm_milk_min1', 'milk', 1),
      group('manager', 'm_milk_min2', 'milk', 2),
      mod('manager', 'm_regular_off', 'regular', 'milk', 0, false),
      mod('manager', 'm_regular_move', 'regular', 'shots', 0, true),
      mod('manager', 'm_oat_rename', 'oat', 'milk', 1500, true, 'Oat milk'),
      // Reveals: a paid-only side revealed by "Make it a meal" makes the meal
      // cost 2000 more; a side with a free choice does not. Asking for a
      // second side is a raise too, and so is a reveal set while the option
      // is switched off.
      reveals('manager', 'm_reveal_side', 'make_meal', ['side']),
      reveals('manager', 'm_reveal_free', 'make_meal', ['side_free']),
      group('manager', 'm_side_free_min2', 'side_free', 2),
      mod('manager', 'm_meal_off', 'make_meal', 'meal_grp', 0, false),
      reveals('manager', 'm_reveal_side_off', 'make_meal', ['side']),
      mod('manager', 'm_meal_on', 'make_meal', 'meal_grp', 0, true),
      // The limit: in the owner's all-paid group, the cheaper size switched
      // off raises what every guest pays, so it is the owner's too.
      mod('manager', 'm_single_off', 'single', 'shot_size', 500, false),
      mod('owner', 'o_single_off', 'single', 'shot_size', 500, false),
      // Unlinking never raises a price.
      link('manager', 'm_unlink_milk', 'coffee2', 'milk', false),
      Q('floors', `select jsonb_build_object('coffee', app.addon_item_prices({{coffee}})->'floor',
                                             'coffee2', app.addon_item_prices({{coffee2}})->'floor',
                                             'coffee3', app.addon_item_prices({{coffee3}})->'floor',
                                             'meal', app.addon_item_prices({{meal}})->'floor',
                                             'make_meal', app.addon_item_prices({{meal}})->{{make_meal}})`),
      Q('kept', `select jsonb_build_object(
                   'milk_min', (select min_select from modifier_groups where id = {{milk}}),
                   'regular', (select jsonb_build_object('on', is_active, 'group', group_id = {{milk}}) from modifiers where id = {{regular}}),
                   'reveals', (select coalesce(jsonb_agg(group_id = {{side_free}}), '[]') from modifier_reveals where modifier_id = {{make_meal}}))`),
    ]);

    ok(r, 'm_shots_min');
    expect(refused(r, 'm_link_shots')).toBe('PRICE_VIA_PROTOCOL:required_addon');
    ok(r, 'o_link_shots');
    ok(r, 'm_milk_min1');
    for (const label of ['m_milk_min2', 'm_regular_off', 'm_regular_move', 'm_reveal_side', 'm_side_free_min2',
                         'm_reveal_side_off', 'm_single_off']) {
      expect(refused(r, label), label).toBe('PRICE_VIA_PROTOCOL:required_addon');
    }
    for (const label of ['m_reveal_free', 'm_meal_off', 'm_meal_on', 'o_single_off', 'm_unlink_milk']) {
      ok(r, label);
    }
    expect(refused(r, 'm_oat_rename')).toBe('PRICE_VIA_PROTOCOL:name');
    expect(ok(r, 'floors')).toEqual({ coffee: 1000, coffee2: 0, coffee3: 1000, meal: 0, make_meal: 0 });
    expect(ok(r, 'kept')).toEqual({ milk_min: 1, regular: { on: true, group: true }, reveals: [true] });
  });

  it('locks promotions, court rates and the featured discount for a manager (#57)', () => {
    const cafeSetting = (who: string, label: string, key: string, value: string) =>
      T(label, who, `select app.set_cafe_setting('${key}', ${value})`);
    const rule = (who: string, label: string, id: string | null, prices: string, active = true) =>
      T(label, who, `select to_jsonb(app.upsert_rate_rule('PP rule', array[0,1,2,3,4,5,6], '06:00', '07:00', '${prices}',
                                                         ${id ? `{{${id}}}::uuid` : 'null'}, {{court}}::uuid, 0, null, null, ${active}))`);
    const r = scenario([
      CAT('cafe', 'cafe'),
      ITEM('feat', 'cafe', true, true),
      SIZE('feat_s', 'feat', 8000),
      ITEM('feat2', 'cafe', true, true),
      SIZE('feat2_s', 'feat2', 6000),
      COURT('court'),
      KEEP('rule', `insert into rate_rules (name, court_id, days_of_week, start_time, end_time, venue_id)
                    values ('PP rule', {{court}}, '{0,1,2,3,4,5,6}', '06:00', '07:00', {{venue}}) returning id::text`),
      X(`insert into rate_rule_prices (rule_id, duration_min, price_iqd) values ({{rule}}, 60, 20000)`),

      // Promotions.
      T('o_promo_on', 'owner', `select to_jsonb(app.upsert_promotion(p_name_en => 'PP on', p_name_ar => 'عرض', p_type => 'percent', p_value => 10))`),
      RES('promo_on', 'o_promo_on'),
      T('o_promo_off', 'owner', `select to_jsonb(app.upsert_promotion(p_name_en => 'PP off', p_name_ar => 'عرض', p_type => 'amount',
                                                                     p_value => 1000, p_enabled => false))`),
      RES('promo_off', 'o_promo_off'),
      T('m_promo_new', 'manager', `select to_jsonb(app.upsert_promotion(p_name_en => 'PP new', p_name_ar => 'عرض', p_type => 'percent', p_value => 5))`),
      T('m_promo_edit_on', 'manager', `select to_jsonb(app.upsert_promotion(p_id => {{promo_on}}::uuid, p_name_en => 'PP on', p_name_ar => 'عرض',
                                                                           p_type => 'percent', p_value => 20))`),
      T('m_promo_edit_off', 'manager', `select to_jsonb(app.upsert_promotion(p_id => {{promo_off}}::uuid, p_name_en => 'PP off', p_name_ar => 'عرض',
                                                                            p_type => 'amount', p_value => 1000, p_enabled => false))`),
      T('m_promo_enable', 'manager', `select app.set_promotion_enabled({{promo_off}}::uuid, true)`),
      T('m_promo_code', 'manager', `select to_jsonb(app.generate_promo_code({{promo_on}}::uuid))`),
      T('m_promo_off_dup', 'manager', `select app.set_promotion_enabled({{promo_off}}::uuid, false)`),
      T('m_promo_disable', 'manager', `select app.set_promotion_enabled({{promo_on}}::uuid, false)`),
      T('o_promo_enable', 'owner', `select app.set_promotion_enabled({{promo_off}}::uuid, true)`),
      T('o_promo_code', 'owner', `select to_jsonb(app.generate_promo_code({{promo_off}}::uuid))`),
      T('o_promo_edit', 'owner', `select to_jsonb(app.upsert_promotion(p_id => {{promo_on}}::uuid, p_name_en => 'PP on', p_name_ar => 'عرض',
                                                                      p_type => 'percent', p_value => 15, p_enabled => false))`),

      // Court rates: every manager save.
      T('m_rule_new', 'manager', `select to_jsonb(app.upsert_rate_rule('PP m rule', array[1], '08:00', '09:00', '{"60": 20000}'))`),
      rule('manager', 'm_rule_edit', 'rule', '{"60": 25000}'),
      rule('manager', 'm_rule_off', 'rule', '{"60": 20000}', false),
      rule('owner', 'o_rule_edit', 'rule', '{"60": 25000}'),
      rule('owner', 'o_rule_off', 'rule', '{"60": 25000}', false),

      // The featured discount.
      FEATURED('base', 'feat', 0, 'media'),
      cafeSetting('manager', 'm_pct_20', 'featured_discount_pct', `'20'`),
      T('m_pct_20_batch', 'manager', `select app.set_cafe_settings('{"featured_discount_pct": 20}')`),
      cafeSetting('owner', 'o_pct_15', 'featured_discount_pct', `'15'`),
      cafeSetting('manager', 'm_move', 'featured_item_id', `to_jsonb({{feat2}}::text)`),
      cafeSetting('manager', 'm_hero_featured', 'hero_mode', `'"featured"'`),
      cafeSetting('manager', 'm_pct_same', 'featured_discount_pct', `'15'`),
      T('m_content', 'manager', `select app.set_cafe_settings('{"featured_label_en": "PP label", "featured_badge_en": "New",
                                   "ticker_en": ["PP tick"], "bell_tutorial_enabled": true, "hero_media_path": "hero/pp-test.webp"}')`),
      cafeSetting('manager', 'm_pct_0', 'featured_discount_pct', `'0'`),
      cafeSetting('manager', 'm_move_0', 'featured_item_id', `to_jsonb({{feat2}}::text)`),
      cafeSetting('manager', 'm_hero_featured_0', 'hero_mode', `'"featured"'`),
      cafeSetting('owner', 'o_pct_15b', 'featured_discount_pct', `'15'`),
      cafeSetting('manager', 'm_hero_media_15', 'hero_mode', `'"media"'`),
      cafeSetting('owner', 'o_hero_back', 'hero_mode', `'"featured"'`),
      cafeSetting('manager', 'm_hero_none_15', 'hero_mode', `'"none"'`),
      T('m_one_call', 'manager', `select app.set_cafe_settings('{"featured_discount_pct": 0, "hero_mode": "featured"}')`),
      T('m_one_call_move', 'manager', `select app.set_cafe_settings(jsonb_build_object('featured_discount_pct', 0, 'featured_item_id', {{feat}}))`),
      T('o_all', 'owner', `select app.set_cafe_settings(jsonb_build_object('featured_item_id', {{feat2}}, 'featured_discount_pct', 25,
                                                                         'hero_mode', 'featured'))`),
      Q('settings', `select jsonb_build_object('item', app.cafe_setting('featured_item_id') #>> '{}',
                                               'pct', app.cafe_setting('featured_discount_pct'),
                                               'mode', app.cafe_setting('hero_mode') #>> '{}')`),
      Q('promos', `select jsonb_build_object(
                     'on', (select jsonb_build_object('enabled', enabled, 'value', value) from promotions where id = {{promo_on}}),
                     'off', (select jsonb_build_object('enabled', enabled, 'code', public_code is not null) from promotions where id = {{promo_off}}))`),
    ]);

    for (const label of ['m_promo_new', 'm_promo_edit_on', 'm_promo_edit_off', 'm_promo_enable', 'm_promo_code',
                         'm_rule_new', 'm_rule_edit', 'm_rule_off', 'm_pct_20', 'm_pct_20_batch', 'm_move',
                         'm_hero_featured']) {
      expect(refused(r, label), label).toBe('PRICE_VIA_PROTOCOL');
    }
    expect(ok(r, 'm_promo_off_dup')).toMatchObject({ enabled: false, duplicate: true });
    expect(ok(r, 'm_promo_disable')).toMatchObject({ enabled: false, duplicate: false });
    for (const label of ['o_promo_enable', 'o_promo_code', 'o_promo_edit', 'o_rule_edit', 'o_rule_off', 'o_pct_15',
                         'm_pct_same', 'm_content', 'm_pct_0', 'm_move_0', 'm_hero_featured_0', 'o_pct_15b',
                         'm_hero_media_15', 'o_hero_back', 'm_hero_none_15', 'm_one_call', 'm_one_call_move', 'o_all']) {
      ok(r, label);
    }
    expect(ok(r, 'settings')).toEqual({ item: v(r, 'feat2'), pct: 25, mode: 'featured' });
    expect(ok(r, 'promos')).toEqual({ on: { enabled: false, value: 15 }, off: { enabled: true, code: true } });
  });

  it('a price change: marketing proposes, the manager sets the numbers, the owner approves, applied now and on a date', () => {
    const priceRecord = (item: string, prices: string, extra = '') =>
      `jsonb_build_object('change', 'price', ${REASON}, 'menu_item_id', {{${item}}}, 'prices', ${prices}${extra})`;
    const r = scenario([
      MK('mkt', 'marketing'),
      CAT('cafe', 'cafe'),
      CAT('shop', 'shop'),
      ITEM('latte', 'cafe', true, true),
      SIZE('latte_s', 'latte', 5000),
      SIZE('latte_l', 'latte', 6500, 1),
      ITEM('mocha', 'cafe', true, true),
      SIZE('mocha_s', 'mocha', 6000),
      ITEM('tea', 'cafe', true, true),
      SIZE('tea_s', 'tea', 3000),
      ITEM('never', 'cafe', false, false),
      SIZE('never_s', 'never', 3000),
      ITEM('prod', 'shop', true, true),
      SIZE('prod_s', 'prod', 50000),
      // An item in a product release that is still running.
      KEEP('rel', `insert into protocol_runs (venue_id, template_id, template_version, kind, title_en, started_by)
                   select {{venue}}, t.id, t.version, 'product_release', 'PP release', {{manager}}
                     from protocol_templates t where t.venue_id = {{venue}} and t.kind = 'product_release'
                   returning id::text`),
      ITEM('inrel', 'cafe', false, false),
      X(`update menu_items set release_run_id = {{rel}} where id = {{inrel}}`),
      SIZE('inrel_s', 'inrel', 3000),
      // A known recipe cost for the small latte: 100 g of milk at 20 IQD a gram.
      KEEP('milk', `insert into ingredients (kind, name_en, name_ar, unit, is_active, venue_id)
                    values ('purchased', 'PP milk', 'حليب', 'g', true, {{venue}}) returning id::text`),
      X(`insert into stock_batches (ingredient_id, qty_received, qty_remaining, unit_cost_iqd, venue_id)
         values ({{milk}}::uuid, 1000, 1000, 20, {{venue}}::uuid)`),
      X(`insert into recipe_lines (variant_id, ingredient_id, qty) values ({{latte_s}}::uuid, {{milk}}::uuid, 100)`),

      // Marketing proposes: the large latte and a new double size.
      ...RUN('a', 'mkt', priceRecord('latte',
        `jsonb_build_array(jsonb_build_object('variant_id', {{latte_l}}, 'price_iqd', 7000),
                           jsonb_build_object('variant_id', {{latte_s}}, 'price_iqd', 5500))`,
        `, 'new_sizes', jsonb_build_array(jsonb_build_object('name_en', 'Double', 'price_iqd', 9000))`)),
      Q('a_waits', `select to_jsonb(status) from protocol_run_steps where id = {{a_prop}}`),
      ...ACCEPT('a'),
      Q('a_run_item', `select to_jsonb(menu_item_id::text) from protocol_runs where id = {{a}}`),
      // Final figures: the new size at 9,500; a figure for another item's size is refused.
      T('a_num_foreign', 'manager', `select app.submit_step({{a_num}}, jsonb_build_object('recommendation', 'go',
                                       'prices', jsonb_build_array(jsonb_build_object('variant_id', {{mocha_s}}, 'price_iqd', 7000))))`),
      T('a_num_rename', 'manager', `select app.submit_step({{a_num}}, '{"recommendation":"go","new_sizes":[{"name_en":"Triple","price_iqd":9500}]}')`),
      T('a_num_promo', 'manager', `select app.submit_step({{a_num}}, '{"recommendation":"go","promotion_value":10}')`),
      ...NUMBERS('a', `'{"recommendation":"change","new_sizes":[{"name_en":"Double","price_iqd":9500}],"note":"Round up"}'`),
      T('a_figures', 'manager', `select app.price_promo_numbers({{a}})`),
      T('a_figures_mk', 'mkt', `select app.price_promo_numbers({{a}})`),
      T('a_num_mk', 'mkt', `select app.protocol_step_detail({{a_num}})`),
      APPLY_NOW('a'),
      RUN_STATUS('a_after', 'a'),
      Q('latte_after', `select jsonb_agg(jsonb_build_object('name', name_en, 'price', price_iqd, 'default', is_default,
                                                            'sort', sort_order) order by sort_order)
                          from menu_item_variants where item_id = {{latte}}`),
      Q('a_audit', `select jsonb_agg(after) from audit_log where action = 'protocol.price.apply' and entity_id = {{a}}::text`),

      // The manager's own: passes the proposal at once; applied on a date by the cron.
      ...RUN('b', 'manager', priceRecord('mocha', `jsonb_build_array(jsonb_build_object('variant_id', {{mocha_s}}, 'price_iqd', 6500))`)),
      ...NUMBERS('b'),
      APPLY_DATE('b'),
      RUN_STATUS('b_scheduled', 'b'),
      Q('b_not_yet', `select app.price_promo_apply_due()`),
      DUE('b'),
      Q('b_due', `select app.price_promo_apply_due()`),
      RUN_STATUS('b_after', 'b'),
      Q('mocha_after', `select to_jsonb(price_iqd) from menu_item_variants where id = {{mocha_s}}`),

      // Stale targets: a size removed, and an item put in release after the OK.
      ...RUN('c', 'manager', priceRecord('tea', `jsonb_build_array(jsonb_build_object('variant_id', {{tea_s}}, 'price_iqd', 3500))`)),
      ...NUMBERS('c'),
      X(`delete from menu_item_variants where id = {{tea_s}}`),
      APPLY_NOW('c'),
      ...RUN('d', 'manager', priceRecord('latte', `jsonb_build_array(jsonb_build_object('variant_id', {{latte_s}}, 'price_iqd', 6000))`)),
      ...NUMBERS('d'),
      X(`update menu_items set release_run_id = {{rel}} where id = {{latte}}`),
      APPLY_NOW('d'),
      T('d_date', 'manager', `select app.submit_step({{d_app}}, jsonb_build_object('when', 'date', 'at', now() + interval '1 day'))`),
      T('d_past', 'manager', `select app.submit_step({{d_app}}, jsonb_build_object('when', 'date', 'at', now() - interval '1 day'))`),

      // Refused at the proposal, with the field, never a writer's code.
      START('p_never', 'manager', priceRecord('never', `jsonb_build_array(jsonb_build_object('variant_id', {{never_s}}, 'price_iqd', 3500))`)),
      START('p_inrel', 'mkt', priceRecord('inrel', `jsonb_build_array(jsonb_build_object('variant_id', {{inrel_s}}, 'price_iqd', 3500))`)),
      START('p_shop_size', 'manager', priceRecord('prod', `'[]'::jsonb`,
        `, 'new_sizes', jsonb_build_array(jsonb_build_object('name_en', 'XL', 'price_iqd', 60000))`)),
      START('p_empty', 'manager', priceRecord('mocha', `'[]'::jsonb`)),
      START('p_foreign_size', 'manager', priceRecord('mocha', `jsonb_build_array(jsonb_build_object('variant_id', {{prod_s}}, 'price_iqd', 3500))`)),
      START('p_zero', 'manager', priceRecord('mocha', `jsonb_build_array(jsonb_build_object('variant_id', {{mocha_s}}, 'price_iqd', 0))`)),
      START('p_change', 'manager', `jsonb_build_object('change', 'discount', ${REASON})`),
      START('p_reason', 'manager', `jsonb_build_object('change', 'price', 'expected_effect', 'x', 'menu_item_id', {{mocha}},
                                      'prices', jsonb_build_array(jsonb_build_object('variant_id', {{mocha_s}}, 'price_iqd', 7000)))`),
      START('p_stray', 'manager', priceRecord('mocha', `jsonb_build_array(jsonb_build_object('variant_id', {{mocha_s}}, 'price_iqd', 7000))`,
        `, 'discount_pct', 10`)),
    ]);

    // Marketing's proposal waits for a manager; the manager's own passes.
    expect(ok(r, 'a_start')).toMatchObject({ auto: false, status: 'active' });
    expect(ok(r, 'a_waits')).toBe('submitted');
    expect(ok(r, 'a_run_item')).toBe(v(r, 'latte'));
    expect(refused(r, 'a_num_foreign')).toBe('RECORD_INVALID:prices');
    expect(refused(r, 'a_num_rename')).toBe('RECORD_INVALID:new_sizes');
    expect(refused(r, 'a_num_promo')).toBe('RECORD_INVALID:promotion_value');
    expect(ok(r, 'a_numbers')).toMatchObject({ auto: false });
    const figures = ok<{ change: string; sizes: Array<Record<string, unknown>>; promotion: unknown }>(r, 'a_figures');
    expect(figures.change).toBe('price');
    expect(figures.promotion).toBeNull();
    expect(figures.sizes).toEqual([
      { variant_id: v(r, 'latte_l'), name_en: 'PP latte_l', name_ar: 'حجم', current_price_iqd: 6500, new_price_iqd: 7000,
        cost_iqd: 0, cost_known: false, margin_before_iqd: null, margin_after_iqd: null, units_30d: 0, revenue_30d_iqd: 0 },
      { variant_id: v(r, 'latte_s'), name_en: 'PP latte_s', name_ar: 'حجم', current_price_iqd: 5000, new_price_iqd: 5500,
        cost_iqd: 2000, cost_known: true, margin_before_iqd: 3000, margin_after_iqd: 3500, units_30d: 0, revenue_30d_iqd: 0 },
      { variant_id: null, name_en: 'Double', name_ar: 'Double', current_price_iqd: null, new_price_iqd: 9500,
        cost_iqd: 0, cost_known: false, margin_before_iqd: null, margin_after_iqd: null, units_30d: 0, revenue_30d_iqd: 0 },
    ]);
    expect(refused(r, 'a_figures_mk')).toBe('FORBIDDEN');
    // Marketing is involved (announce), yet the numbers are a mgmt record.
    const numStep = ok<{ step: { submissions: Array<{ record: unknown }> } }>(r, 'a_num_mk');
    expect(numStep.step.submissions.length).toBeGreaterThan(0);
    for (const s of numStep.step.submissions) expect(s.record).toBeNull();
    expect(ok(r, 'a_apply')).toMatchObject({ auto: true, run_status: 'done' });
    expect(ok(r, 'a_after')).toEqual({ status: 'done', finished: true });
    expect(ok(r, 'latte_after')).toEqual([
      { name: 'PP latte_s', price: 5500, default: true, sort: 0 },
      { name: 'PP latte_l', price: 7000, default: false, sort: 1 },
      { name: 'Double', price: 9500, default: false, sort: 2 },
    ]);
    expect(ok(r, 'a_audit')).toEqual([{ run_id: v(r, 'a'), change: 'price', counts: { sizes: 2, new_sizes: 1, renamed: 0 } }]);

    expect(ok(r, 'b_start')).toMatchObject({ auto: true });
    expect(ok(r, 'b_apply')).toMatchObject({ auto: true, run_status: 'scheduled' });
    expect(ok(r, 'b_scheduled')).toEqual({ status: 'scheduled', finished: false });
    expect(ok(r, 'b_not_yet')).toEqual({ applied: 0, reverted: 0 });
    expect(ok(r, 'b_due')).toEqual({ applied: 1, reverted: 0 });
    expect(ok(r, 'b_after')).toEqual({ status: 'done', finished: true });
    expect(ok(r, 'mocha_after')).toBe(6500);

    expect(refused(r, 'c_apply')).toBe(`PRICE_TARGET_CHANGED:size:${v(r, 'tea_s')}`);
    expect(refused(r, 'd_apply')).toBe('PRICE_TARGET_CHANGED:item');
    expect(refused(r, 'd_date')).toBe('PRICE_TARGET_CHANGED:item');
    expect(refused(r, 'd_past')).toBe('RECORD_INVALID:at');

    expect(refused(r, 'p_never')).toBe('RECORD_INVALID:menu_item_id');
    expect(refused(r, 'p_inrel')).toBe('RECORD_INVALID:menu_item_id');
    expect(refused(r, 'p_shop_size')).toBe('RECORD_INVALID:new_sizes');
    expect(refused(r, 'p_empty')).toBe('RECORD_INVALID:prices');
    expect(refused(r, 'p_foreign_size')).toBe('RECORD_INVALID:prices');
    expect(refused(r, 'p_zero')).toBe('RECORD_INVALID:prices');
    expect(refused(r, 'p_change')).toBe('RECORD_INVALID:change');
    expect(refused(r, 'p_reason')).toBe('RECORD_INVALID:reason');
    expect(refused(r, 'p_stray')).toBe('RECORD_INVALID:discount_pct');
  });

  it('a hidden shop product and paid add-ons go on sale; stale ones revert at the cron while another applies', () => {
    const retail = (who: string, label: string, item: string, name: string, price: number) =>
      T(label, who, `select app.upsert_retail_variant(p_item_id => {{${item}}}::uuid, p_name_en => '${name}', p_name_ar => '${name}',
                                                     p_price_iqd => ${price})`);
    const shopLaunch = (item: string, sizes: Array<[string, number]>) =>
      `jsonb_build_object('change', 'shop_launch', ${REASON}, 'menu_item_id', {{${item}}},
         'prices', jsonb_build_array(${sizes.map(([s, p]) => `jsonb_build_object('variant_id', {{${s}}}, 'price_iqd', ${p})`).join(', ')}))`;
    const r = scenario([
      MK('mkt', 'marketing'),
      VENUE_X,
      CAT('shop', 'shop'),
      ITEM('prod', 'shop', true, true),
      SIZE('prod_s', 'prod', 50000),
      // The manager's hidden products: sized and priced as drafts.
      ITEM('sd', 'shop', false, false),
      retail('manager', 'sd_m_new', 'sd', 'M', 20000),
      RES('sd_m', 'sd_m_new', 'variant_id'),
      retail('manager', 'sd_l_new', 'sd', 'L', 30000),
      RES('sd_l', 'sd_l_new', 'variant_id'),
      ITEM('sd2', 'shop', false, false),
      retail('manager', 'sd2_new', 'sd2', 'M', 15000),
      RES('sd2_m', 'sd2_new', 'variant_id'),
      ITEM('sd3', 'shop', false, false),
      retail('manager', 'sd3_new', 'sd3', 'M', 10000),
      RES('sd3_m', 'sd3_new', 'variant_id'),
      ITEM('sd4', 'shop', false, false),
      retail('manager', 'sd4_new', 'sd4', 'M', 9000),
      RES('sd4_m', 'sd4_new', 'variant_id'),
      ITEM('son', 'shop', true, false), // on sale, never stamped: not a hidden draft
      SIZE('son_s', 'son', 9000),
      GROUP('grp'),
      MOD('a_off', 'grp', 500, false, true), // launched long ago, off today
      MOD('a_new', 'grp', 1500, false, false), // never launched
      MOD('a_new2', 'grp', 800, false, false),
      GROUP('grp_x', 'venue_x'),
      MOD('a_x', 'grp_x', 100, true, true),
      CAT('cafe', 'cafe'),
      // A product release still running, and a hidden shop product in it
      // (written as postgres: upsert_menu_item refuses the move for anyone).
      KEEP('rel', `insert into protocol_runs (venue_id, template_id, template_version, kind, title_en, started_by)
                   select {{venue}}, t.id, t.version, 'product_release', 'PP release', {{manager}}
                     from protocol_templates t where t.venue_id = {{venue}} and t.kind = 'product_release'
                   returning id::text`),
      ITEM('sd_rel', 'shop', false, false),
      X(`update menu_items set release_run_id = {{rel}} where id = {{sd_rel}}`),
      SIZE('sd_rel_m', 'sd_rel', 7000),
      ITEM('sd5', 'shop', false, false),
      retail('manager', 'sd5_new', 'sd5', 'M', 11000),
      RES('sd5_m', 'sd5_new', 'variant_id'),

      // Marketing is never offered a hidden product.
      START('mk_shop', 'mkt', shopLaunch('sd', [['sd_m', 21000], ['sd_l', 31000]])),
      T('mk_targets_shop', 'mkt', `select app.price_promo_targets('shop_launch', {{venue}}::uuid)`),
      T('m_targets_shop', 'manager', `select app.price_promo_targets('shop_launch', {{venue}}::uuid)`),
      START('p_launched', 'manager', shopLaunch('prod', [['prod_s', 55000]])),
      START('p_one_size', 'manager', shopLaunch('sd', [['sd_m', 21000]])),
      START('p_switched_on', 'manager', shopLaunch('son', [['son_s', 9500]])),
      // A release draft goes on sale at the owner's Launch only.
      START('p_in_release', 'manager', shopLaunch('sd_rel', [['sd_rel_m', 7000]])),
      ...RUN('z', 'manager', shopLaunch('sd5', [['sd5_m', 11000]])),
      ...NUMBERS('z'),
      X(`update menu_items set release_run_id = {{rel}} where id = {{sd5}}`),
      APPLY_NOW('z'),

      // shop_launch, applied now: prices written, product on sale, stamped.
      ...RUN('s', 'manager', shopLaunch('sd', [['sd_m', 21000], ['sd_l', 31000]])),
      ...NUMBERS('s'),
      APPLY_NOW('s'),
      Q('sd_after', `select jsonb_build_object('on', is_active, 'launched', launched_at is not null,
                                               'prices', (select jsonb_agg(price_iqd order by sort_order, price_iqd)
                                                            from menu_item_variants where item_id = {{sd}}))
                       from menu_items where id = {{sd}}`),
      // Launched as a product, it is still not the manager's to put on the
      // cafe menu: that is a new menu item (#52). The owner may.
      T('sd_to_cafe', 'manager', `select to_jsonb(app.upsert_menu_item({{cafe}}::uuid, 'PP sd', 'صنف', {{sd}}::uuid, null, null, 0, true))`),
      T('sd_to_cafe_owner', 'owner', `select to_jsonb(app.upsert_menu_item({{cafe}}::uuid, 'PP sd', 'صنف', {{sd}}::uuid, null, null, 0, true))`),

      // addon_price, applied now: a never-launched add-on goes on sale.
      ...RUN('y', 'manager', `jsonb_build_object('change', 'addon_price', ${REASON},
                                'addons', jsonb_build_array(jsonb_build_object('modifier_id', {{a_new2}}, 'price_delta_iqd', 900)))`),
      ...NUMBERS('y'),
      APPLY_NOW('y'),
      Q('a_new2_after', `select jsonb_build_object('price', price_delta_iqd, 'on', is_active, 'launched', launched_at is not null)
                           from modifiers where id = {{a_new2}}`),

      // An extra size added after the owner's OK never goes on sale.
      ...RUN('t', 'manager', shopLaunch('sd3', [['sd3_m', 12000]])),
      ...NUMBERS('t'),
      retail('owner', 'sd3_extra', 'sd3', 'L', 14000),
      APPLY_NOW('t'),

      // addon_price: refused at the proposal, then applied on a date.
      START('p_addon_x', 'mkt', `jsonb_build_object('change', 'addon_price', ${REASON},
                                    'addons', jsonb_build_array(jsonb_build_object('modifier_id', {{a_x}}, 'price_delta_iqd', 200)))`),
      START('p_addon_free', 'manager', `jsonb_build_object('change', 'addon_price', ${REASON},
                                          'addons', jsonb_build_array(jsonb_build_object('modifier_id', {{a_new}}, 'price_delta_iqd', 0)))`),
      ...RUN('u', 'mkt', `jsonb_build_object('change', 'addon_price', ${REASON},
                            'addons', jsonb_build_array(jsonb_build_object('modifier_id', {{a_off}}, 'price_delta_iqd', 600),
                                                        jsonb_build_object('modifier_id', {{a_new}}, 'price_delta_iqd', 1500)))`),
      ...ACCEPT('u'),
      ...NUMBERS('u', `jsonb_build_object('recommendation', 'go',
                         'addons', jsonb_build_array(jsonb_build_object('modifier_id', {{a_new}}, 'price_delta_iqd', 1700),
                                                     jsonb_build_object('modifier_id', {{a_off}}, 'price_delta_iqd', 600)))`),
      T('u_figures', 'manager', `select app.price_promo_numbers({{u}})`),
      APPLY_DATE('u'),

      // shop_launch on a date, switched on by the owner before it: the cron reverts it.
      ...RUN('w', 'manager', shopLaunch('sd2', [['sd2_m', 16000]])),
      ...NUMBERS('w'),
      APPLY_DATE('w'),
      T('sd2_owner_on', 'owner', `select to_jsonb(app.upsert_menu_item((select category_id from menu_items where id = {{sd2}}),
                                                                      'PP sd2', 'صنف', {{sd2}}::uuid, null, null, 0, true))`),
      // shop_launch on a date that applies at the same tick.
      ...RUN('x', 'manager', shopLaunch('sd4', [['sd4_m', 9500]])),
      ...NUMBERS('x'),
      APPLY_DATE('x'),
      DUE('u'),
      DUE('w'),
      DUE('x'),
      Q('due', `select app.price_promo_apply_due()`),
      RUN_STATUS('u_after', 'u'),
      RUN_STATUS('w_after', 'w'),
      RUN_STATUS('x_after', 'x'),
      Q('sd4_after', `select jsonb_build_object('on', is_active, 'launched', launched_at is not null,
                                                'price', (select price_iqd from menu_item_variants where id = {{sd4_m}}))
                        from menu_items where id = {{sd4}}`),
      Q('w_step', `select jsonb_build_object('status', status, 'round', round) from protocol_run_steps where id = {{w_app}}`),
      Q('w_push', `select coalesce(jsonb_agg(profile_id::text order by profile_id), '[]') from notification_outbox
                    where payload->>'title_key' = 'apply_not_ready' and payload->>'id' = {{w_app}}`),
      Q('w_audit', `select jsonb_agg(after) from audit_log where action = 'protocol.unschedule' and entity_id = {{w}}::text`),
      Q('addons_after', `select jsonb_object_agg(case id when {{a_off}} then 'off' else 'new' end,
                                                 jsonb_build_object('price', price_delta_iqd, 'on', is_active,
                                                                    'launched', launched_at is not null))
                           from modifiers where id in ({{a_off}}, {{a_new}})`),
    ]);

    expect(refused(r, 'mk_shop')).toBe('NOT_STEP_ACTOR:change');
    expect(refused(r, 'mk_targets_shop')).toBe('FORBIDDEN');
    const shopTargets = ok<{ items: Array<{ menu_item_id: string; is_active: boolean; sizes: unknown[] }> }>(r, 'm_targets_shop');
    const listed = shopTargets.items.map((i) => i.menu_item_id);
    expect(listed).toEqual(expect.arrayContaining([v(r, 'sd'), v(r, 'sd2'), v(r, 'sd3')]));
    expect(listed).not.toContain(v(r, 'prod'));
    expect(listed).not.toContain(v(r, 'sd_rel'));
    expect(refused(r, 'p_launched')).toBe('RECORD_INVALID:menu_item_id');
    expect(refused(r, 'p_one_size')).toBe('RECORD_INVALID:prices');
    expect(refused(r, 'p_switched_on')).toBe('RECORD_INVALID:menu_item_id');
    expect(refused(r, 'p_in_release')).toBe('RECORD_INVALID:menu_item_id');
    expect(refused(r, 'z_apply')).toBe('PRICE_TARGET_CHANGED:item');

    expect(ok(r, 's_apply')).toMatchObject({ run_status: 'done' });
    expect(ok(r, 'sd_after')).toEqual({ on: true, launched: true, prices: [21000, 31000] });
    expect(refused(r, 'sd_to_cafe')).toBe('ITEM_VIA_RELEASE');
    ok(r, 'sd_to_cafe_owner');
    expect(refused(r, 't_apply')).toBe('PRICE_TARGET_CHANGED:sizes');
    expect(ok(r, 'y_apply')).toMatchObject({ run_status: 'done' });
    expect(ok(r, 'a_new2_after')).toEqual({ price: 900, on: true, launched: true });

    expect(refused(r, 'p_addon_x')).toBe('RECORD_INVALID:addons');
    expect(refused(r, 'p_addon_free')).toBe('RECORD_INVALID:addons');
    const addonFigures = ok<{ addons: Array<Record<string, unknown>> }>(r, 'u_figures');
    expect(addonFigures.addons.map((a) => [a.modifier_id, a.current_delta_iqd, a.new_delta_iqd, a.count_30d])).toEqual([
      [v(r, 'a_new'), 1500, 1700, 0],
      [v(r, 'a_off'), 500, 600, 0],
    ]);
    expect(ok(r, 'sd2_owner_on')).toBe(v(r, 'sd2'));

    // One tick: the add-on change and one shop product apply, the other reverts.
    expect(ok(r, 'due')).toEqual({ applied: 2, reverted: 1 });
    expect(ok(r, 'u_after')).toEqual({ status: 'done', finished: true });
    expect(ok(r, 'x_after')).toEqual({ status: 'done', finished: true });
    expect(ok(r, 'sd4_after')).toEqual({ on: true, launched: true, price: 9500 });
    expect(ok(r, 'w_after')).toEqual({ status: 'active', finished: false });
    expect(ok(r, 'w_step')).toEqual({ status: 'open', round: 2 });
    expect(ok<string[]>(r, 'w_push')).toContain(SEED_STAFF_IDS.manager);
    expect(ok(r, 'w_audit')).toEqual([
      { status: 'active', run_step_id: v(r, 'w_app'), not_applied: 'PRICE_TARGET_CHANGED', hint: 'item' },
    ]);
    expect(ok(r, 'addons_after')).toEqual({
      off: { price: 600, on: false, launched: true },
      new: { price: 1700, on: true, launched: true },
    });
  });

  it('promotions: a new one from marketing, an edit keeps the switch, a switch-on on a date', () => {
    const promotion = (name: string, extra = '') =>
      `jsonb_build_object('name_en', '${name}', 'name_ar', 'عرض', 'type', 'percent', 'value', 10,
                          'weekdays', jsonb_build_array(5, 6), 'scope', '{}'::jsonb${extra})`;
    const r = scenario([
      MK('mkt', 'marketing'),
      KEEP('code', `select 'PP' || upper(substr(md5(random()::text), 1, 8))`),
      KEEP('taken', `select 'PQ' || upper(substr(md5(random()::text), 1, 8))`),
      // Configured by the manager before the lock: its authoriser until a
      // change the owner approves.
      KEEP('promo_live', `insert into promotions (name_en, name_ar, type, value, enabled, created_by, public_code)
                          values ('PP live', 'عرض', 'amount', 1000, true, {{manager}}, {{taken}}) returning id::text`),
      KEEP('promo_off', `insert into promotions (name_en, name_ar, type, value, enabled, created_by)
                         values ('PP off', 'عرض', 'percent', 5, false, {{owner}}) returning id::text`),
      KEEP('promo_off2', `insert into promotions (name_en, name_ar, type, value, enabled, created_by)
                          values ('PP off 2', 'عرض', 'percent', 5, false, {{manager}}) returning id::text`),

      // A new promotion, from marketing: a disabled draft holds its code until the apply.
      ...RUN('n', 'mkt', `jsonb_build_object('change', 'promotion', ${REASON},
                            'promotion', ${promotion('PP weekend', `, 'auto', false, 'public_code', lower({{code}})`)})`),
      Q('draft', `select jsonb_build_object('enabled', p.enabled, 'code', p.public_code, 'by', p.created_by::text,
                                            'weekdays', to_jsonb(p.weekdays))
                    from promotions p join protocol_runs r on r.promotion_id = p.id where r.id = {{n}}`),
      START('p_taken', 'manager', `jsonb_build_object('change', 'promotion', ${REASON},
                                     'promotion', ${promotion('PP clash', `, 'public_code', {{code}}`)})`),
      START('p_taken2', 'manager', `jsonb_build_object('change', 'promotion', ${REASON},
                                      'promotion', ${promotion('PP clash', `, 'public_code', {{taken}}`)})`),
      START('p_hours', 'manager', `jsonb_build_object('change', 'promotion', ${REASON},
                                     'promotion', ${promotion('PP hours', `, 'hour_from', '10:00'`)})`),
      START('p_value', 'manager', `jsonb_build_object('change', 'promotion', ${REASON},
                                     'promotion', ${promotion('PP value').replace("'value', 10", "'value', 100")})`),
      START('p_scope', 'manager', `jsonb_build_object('change', 'promotion', ${REASON},
                                     'promotion', ${promotion('PP scope').replace("'{}'::jsonb", `jsonb_build_object('itemIds', jsonb_build_array(gen_random_uuid()))`)})`),
      START('p_no_weekdays', 'manager', `jsonb_build_object('change', 'promotion', ${REASON},
                                           'promotion', jsonb_build_object('name_en', 'PP', 'name_ar', 'ع', 'type', 'percent', 'value', 10, 'scope', '{}'::jsonb))`),
      ...ACCEPT('n'),
      ...NUMBERS('n', `'{"recommendation":"go","promotion_value":12}'`),
      APPLY_NOW('n'),
      Q('n_promo', `select jsonb_build_object('enabled', p.enabled, 'value', p.value, 'code', p.public_code, 'auto', p.auto)
                      from promotions p join protocol_runs r on r.promotion_id = p.id where r.id = {{n}}`),
      Q('n_audit', `select jsonb_agg(action order by id) from audit_log
                     where entity_id = {{n}}::text and action like 'protocol.%.apply'`),

      // Edits: the live one stays on, the switched-off one stays off.
      ...RUN('e', 'manager', `jsonb_build_object('change', 'promotion_edit', ${REASON}, 'promotion_id', {{promo_live}},
                                'promotion', jsonb_build_object('name_en', 'PP live 2', 'name_ar', 'عرض', 'type', 'amount',
                                                                'value', 1500, 'weekdays', '[]'::jsonb, 'scope', '{}'::jsonb))`),
      ...NUMBERS('e'),
      APPLY_NOW('e'),
      ...RUN('f', 'mkt', `jsonb_build_object('change', 'promotion_edit', ${REASON}, 'promotion_id', {{promo_off}},
                            'promotion', jsonb_build_object('name_en', 'PP off 2', 'name_ar', 'عرض', 'type', 'percent',
                                                            'value', 8, 'weekdays', '[]'::jsonb, 'scope', '{}'::jsonb))`),
      ...ACCEPT('f'),
      ...NUMBERS('f'),
      APPLY_DATE('f'),
      DUE('f'),
      Q('f_due', `select app.price_promo_apply_due()`),
      Q('edited', `select jsonb_object_agg(case id when {{promo_live}} then 'live' else 'off' end,
                                           jsonb_build_object('name', name_en, 'value', value, 'enabled', enabled,
                                                              'code', public_code))
                     from promotions where id in ({{promo_live}}, {{promo_off}})`),

      // A switch-on, from marketing, on a date.
      START('p_on_already', 'mkt', `jsonb_build_object('change', 'promotion_enable', ${REASON}, 'promotion_id', {{promo_live}})`),
      ...RUN('g', 'mkt', `jsonb_build_object('change', 'promotion_enable', ${REASON}, 'promotion_id', {{promo_off2}})`),
      ...ACCEPT('g'),
      ...NUMBERS('g'),
      APPLY_DATE('g'),
      DUE('g'),
      Q('g_due', `select app.price_promo_apply_due()`),
      Q('g_promo', `select to_jsonb(enabled) from promotions where id = {{promo_off2}}`),
      // A switch-on by the manager, applied now.
      KEEP('promo_off3', `insert into promotions (name_en, name_ar, type, value, enabled, created_by)
                          values ('PP off 3', 'عرض', 'percent', 5, false, {{owner}}) returning id::text`),
      ...RUN('j', 'manager', `jsonb_build_object('change', 'promotion_enable', ${REASON}, 'promotion_id', {{promo_off3}})`),
      ...NUMBERS('j'),
      APPLY_NOW('j'),
      Q('j_promo', `select to_jsonb(enabled) from promotions where id = {{promo_off3}}`),
      // Who each applied promotion names as the authoriser of its discounts
      // (apply_best_promotion's authorized_by, day close's name): the owner
      // who approved the numbers, never marketing or the earlier configurer.
      Q('authorisers', `select jsonb_build_object(
                          'new', (select p.created_by from promotions p join protocol_runs r on r.promotion_id = p.id
                                   where r.id = {{n}}),
                          'edit', (select created_by from promotions where id = {{promo_live}}),
                          'enable', (select created_by from promotions where id = {{promo_off2}}),
                          'audit', (select a.after->'authorized_by' from audit_log a
                                     where a.entity_id = {{n}}::text and a.action = 'protocol.promo.apply'))`),

      // A promotion written after the proposal: the manager switched it off.
      // (now() is one instant in this transaction: the row is aged first, so
      // the switch-off is a later write than the one the proposal saw.)
      X(`update promotions set updated_at = now() - interval '1 hour' where id = {{promo_live}}`),
      ...RUN('h', 'manager', `jsonb_build_object('change', 'promotion_edit', ${REASON}, 'promotion_id', {{promo_live}},
                                'promotion', jsonb_build_object('name_en', 'PP live 3', 'name_ar', 'عرض', 'type', 'amount',
                                                                'value', 2000, 'weekdays', '[]'::jsonb, 'scope', '{}'::jsonb))`),
      ...NUMBERS('h'),
      T('h_switch_off', 'manager', `select app.set_promotion_enabled({{promo_live}}::uuid, false)`),
      APPLY_NOW('h'),
    ]);

    expect(ok(r, 'n_start')).toMatchObject({ auto: false });
    expect(ok(r, 'draft')).toEqual({ enabled: false, code: v(r, 'code'), by: v(r, 'mkt'), weekdays: [5, 6] });
    expect(refused(r, 'p_taken')).toBe('RECORD_INVALID:promotion.public_code');
    expect(refused(r, 'p_taken2')).toBe('RECORD_INVALID:promotion.public_code');
    expect(refused(r, 'p_hours')).toBe('RECORD_INVALID:promotion.hour_to');
    expect(refused(r, 'p_value')).toBe('RECORD_INVALID:promotion.value');
    expect(refused(r, 'p_scope')).toBe('RECORD_INVALID:promotion.scope.itemIds');
    expect(refused(r, 'p_no_weekdays')).toBe('RECORD_INVALID:promotion.weekdays');
    expect(ok(r, 'n_apply')).toMatchObject({ run_status: 'done' });
    expect(ok(r, 'n_promo')).toEqual({ enabled: true, value: 12, code: v(r, 'code'), auto: false });
    expect(ok(r, 'n_audit')).toEqual(['protocol.promo.apply']);

    expect(ok(r, 'f_due')).toEqual({ applied: 1, reverted: 0 });
    expect(ok(r, 'edited')).toEqual({
      live: { name: 'PP live 2', value: 1500, enabled: true, code: v(r, 'taken') },
      off: { name: 'PP off 2', value: 8, enabled: false, code: null },
    });

    expect(refused(r, 'p_on_already')).toBe('RECORD_INVALID:promotion_id');
    expect(ok(r, 'g_due')).toEqual({ applied: 1, reverted: 0 });
    expect(ok(r, 'g_promo')).toBe(true);
    expect(ok(r, 'j_apply')).toMatchObject({ run_status: 'done' });
    expect(ok(r, 'j_promo')).toBe(true);
    const owner = SEED_STAFF_IDS.owner;
    expect(ok(r, 'authorisers')).toEqual({ new: owner, edit: owner, enable: owner, audit: owner });

    expect(ok(r, 'h_switch_off')).toMatchObject({ enabled: false });
    expect(refused(r, 'h_apply')).toBe('PRICE_TARGET_CHANGED:promotion');
  });

  it('court rates: a new rule and a changed one, and the slot price follows', () => {
    const ruleRecord = (extra: string, rule: string) =>
      `jsonb_build_object('change', 'rate', ${REASON}${extra}, 'rule', ${rule})`;
    const rule = (name: string, court: string, prices: string, extra = '') =>
      `jsonb_build_object('name', '${name}', 'court_id', {{${court}}}, 'days_of_week', jsonb_build_array(0,1,2,3,4,5,6),
                          'start_time', '00:00', 'end_time', '23:59', 'prices', '${prices}'::jsonb, 'priority', 1000,
                          'is_active', true${extra})`;
    const SLOT = `date_trunc('day', now()) + interval '1 day 9 hours'`;
    const r = scenario([
      MK('mkt', 'marketing'),
      VENUE_X,
      COURT('court'),
      COURT('court_x', 'venue_x'),
      KEEP('rule', `insert into rate_rules (name, court_id, days_of_week, start_time, end_time, priority, venue_id)
                    values ('PP base', {{court}}, '{0,1,2,3,4,5,6}', '00:00', '23:59', 1000, {{venue}}) returning id::text`),
      X(`insert into rate_rule_prices (rule_id, duration_min, price_iqd) values ({{rule}}, 60, 20000), ({{rule}}, 90, 28000)`),
      KEEP('rule_x', `insert into rate_rules (name, court_id, days_of_week, start_time, end_time, venue_id)
                      values ('PP x', {{court_x}}, '{1}', '10:00', '11:00', {{venue_x}}) returning id::text`),
      Q('slot_before', `select to_jsonb(p.price_iqd) from app.price_slot({{court}}::uuid, ${SLOT}, 60) p`),

      // A new rule, from marketing; the manager's numbers raise it.
      ...RUN('n', 'mkt', ruleRecord('', `jsonb_build_object('name', 'PP evening', 'court_id', {{court}},
                                             'days_of_week', jsonb_build_array(5), 'start_time', '18:00', 'end_time', '22:00',
                                             'prices', '{"60": 30000}'::jsonb, 'is_active', true)`)),
      ...ACCEPT('n'),
      T('n_num_bad', 'manager', `select app.submit_step({{n_num}}, '{"recommendation":"go","rule_prices":{"90":30000}}')`),
      ...NUMBERS('n', `'{"recommendation":"go","rule_prices":{"60":32000}}'`),
      T('n_figures', 'manager', `select app.price_promo_numbers({{n}})`),
      APPLY_NOW('n'),
      Q('n_rule', `select jsonb_build_object('venue', r.venue_id::text, 'court', r.court_id::text, 'days', to_jsonb(r.days_of_week),
                                             'prices', (select jsonb_object_agg(p.duration_min::text, p.price_iqd)
                                                          from rate_rule_prices p where p.rule_id = r.id))
                     from rate_rules r where r.name = 'PP evening' and r.court_id = {{court}}`),

      // The base rule's prices changed: 90 minutes dropped, 60 minutes at 25,000.
      ...RUN('e', 'manager', ruleRecord(`, 'rule_id', {{rule}}`, rule('PP base', 'court', '{"60": 25000}'))),
      T('e_figures', 'manager', `select app.price_promo_numbers({{e}})`),
      ...NUMBERS('e'),
      APPLY_DATE('e'),
      Q('slot_waiting', `select to_jsonb(p.price_iqd) from app.price_slot({{court}}::uuid, ${SLOT}, 60) p`),
      DUE('e'),
      Q('e_due', `select app.price_promo_apply_due()`),
      Q('e_prices', `select jsonb_object_agg(duration_min::text, price_iqd) from rate_rule_prices where rule_id = {{rule}}`),
      Q('slot_after', `select to_jsonb(p.price_iqd) from app.price_slot({{court}}::uuid, ${SLOT}, 60) p`),
      Q('slot_90', `select coalesce((select to_jsonb(p.rule_id::text) from app.price_slot({{court}}::uuid, ${SLOT}, 90) p
                                     where p.rule_id = {{rule}}), 'null'::jsonb)`),

      // A rule edited by the owner after the OK.
      ...RUN('s', 'manager', ruleRecord(`, 'rule_id', {{rule}}`, rule('PP base', 'court', '{"60": 26000}'))),
      ...NUMBERS('s'),
      T('s_owner_edit', 'owner', `select to_jsonb(app.upsert_rate_rule('PP base', array[0,1,2,3,4,5,6], '00:00', '23:59',
                                     '{"60": 24000}', {{rule}}::uuid, {{court}}::uuid, 1000))`),
      APPLY_NOW('s'),

      // Refused at the proposal.
      START('p_end', 'manager', ruleRecord('', rule('PP bad', 'court', '{"60": 20000}').replace("'end_time', '23:59'", "'end_time', '00:00'"))),
      START('p_foreign_rule', 'manager', ruleRecord(`, 'rule_id', {{rule_x}}`, rule('PP x', 'court', '{"60": 20000}'))),
      START('p_foreign_court', 'mkt', ruleRecord('', rule('PP x', 'court_x', '{"60": 20000}'))),
      START('p_duration', 'manager', ruleRecord('', rule('PP d', 'court', '{"61": 20000}'))),
      START('p_days', 'manager', ruleRecord('', rule('PP d', 'court', '{"60": 20000}').replace('jsonb_build_array(0,1,2,3,4,5,6)', 'jsonb_build_array(7)'))),
      START('p_active', 'manager', ruleRecord('', rule('PP d', 'court', '{"60": 20000}').replace("'is_active', true", "'is_active', null"))),
    ]);

    expect(ok(r, 'slot_before')).toBe(20000);
    expect(refused(r, 'n_num_bad')).toBe('RECORD_INVALID:rule_prices');
    expect(ok(r, 'n_figures')).toMatchObject({
      change: 'rate',
      rate: { durations: [{ duration_min: 60, current_price_iqd: null, new_price_iqd: 32000 }], bookings_30d: 0, revenue_30d_iqd: 0 },
    });
    expect(ok(r, 'n_apply')).toMatchObject({ run_status: 'done' });
    expect(ok(r, 'n_rule')).toEqual({ venue: VENUE_A_ID, court: v(r, 'court'), days: [5], prices: { '60': 32000 } });
    expect(ok(r, 'e_figures')).toMatchObject({
      rate: { durations: [{ duration_min: 60, current_price_iqd: 20000, new_price_iqd: 25000 }] },
    });
    expect(ok(r, 'e_apply')).toMatchObject({ run_status: 'scheduled' });
    expect(ok(r, 'slot_waiting')).toBe(20000);
    expect(ok(r, 'e_due')).toEqual({ applied: 1, reverted: 0 });
    expect(ok(r, 'e_prices')).toEqual({ '60': 25000 });
    expect(ok(r, 'slot_after')).toBe(25000);
    expect(ok(r, 'slot_90')).toBeNull();
    expect(refused(r, 's_apply')).toBe('PRICE_TARGET_CHANGED:rule');

    expect(refused(r, 'p_end')).toBe('RECORD_INVALID:rule.end_time');
    expect(refused(r, 'p_foreign_rule')).toBe('RECORD_INVALID:rule_id');
    expect(refused(r, 'p_foreign_court')).toBe('RECORD_INVALID:rule.court_id');
    expect(refused(r, 'p_duration')).toBe('RECORD_INVALID:rule.prices');
    expect(refused(r, 'p_days')).toBe('RECORD_INVALID:rule.days_of_week');
    expect(refused(r, 'p_active')).toBe('RECORD_INVALID:rule.is_active');
  });

  it('the featured discount: a move with a discount, and a stored discount put live by Featured mode', () => {
    const featured = (item: string, pct: number) =>
      `jsonb_build_object('change', 'featured_discount', ${REASON}, 'menu_item_id', {{${item}}}, 'discount_pct', ${pct})`;
    const r = scenario([
      MK('mkt', 'marketing'),
      CAT('cafe', 'cafe'),
      ITEM('feat', 'cafe', true, true),
      SIZE('feat_s', 'feat', 8000),
      ITEM('feat2', 'cafe', true, true),
      SIZE('feat2_s', 'feat2', 6000),
      ITEM('off', 'cafe', false, true),

      // From marketing: move to the second item with 20 %, applied now.
      FEATURED('base_m', 'feat', 0, 'media'),
      ...RUN('m', 'mkt', featured('feat2', 20)),
      ...ACCEPT('m'),
      ...NUMBERS('m'),
      T('m_figures', 'manager', `select app.price_promo_numbers({{m}})`),
      APPLY_NOW('m'),
      Q('m_settings', `select jsonb_build_object('item', app.cafe_setting('featured_item_id') #>> '{}',
                                                 'pct', app.cafe_setting('featured_discount_pct'),
                                                 'mode', app.cafe_setting('hero_mode') #>> '{}')`),

      // The item and 15 % stored, the hero on Media: the change puts it live, on a date.
      FEATURED('base_l', 'feat', 15, 'media'),
      START('p_off', 'mkt', featured('off', 10)),
      ...RUN('l', 'manager', featured('feat', 15)),
      ...NUMBERS('l'),
      APPLY_DATE('l'),
      DUE('l'),
      Q('l_due', `select app.price_promo_apply_due()`),
      Q('l_settings', `select jsonb_build_object('item', app.cafe_setting('featured_item_id') #>> '{}',
                                                 'pct', app.cafe_setting('featured_discount_pct'),
                                                 'mode', app.cafe_setting('hero_mode') #>> '{}')`),
      // The till charges the approved discount: an order line on the featured item.
      KEEP('day', `with d as (select id from day_sessions where status = 'open' and venue_id = {{venue}} limit 1),
                        ins as (insert into day_sessions (business_date, opened_by, opening_float_iqd, venue_id)
                                select date '2001-02-03', {{manager}}, 0, {{venue}} where not exists (select 1 from d)
                                returning id)
                   select coalesce((select id from d), (select id from ins))::text`),
      KEEP('tab', `insert into tabs (day_session_id, venue_id, label) values ({{day}}, {{venue}}, 'PP tab') returning id::text`),
      KEEP('order', `insert into orders (tab_id, source, venue_id) values ({{tab}}, 'till', {{venue}}) returning id::text`),
      X(`select app.add_order_items({{order}}::uuid, jsonb_build_array(jsonb_build_object('variant_id', {{feat_s}}, 'qty', 1)))`),
      Q('line', `select jsonb_build_object('unit', unit_price_iqd, 'pct', discount_pct, 'source', discount_source)
                   from order_items where order_id = {{order}}`),

      // A hero mode changed after the OK: stale.
      FEATURED('base_s', 'feat', 0, 'media'),
      ...RUN('s', 'manager', featured('feat2', 10)),
      ...NUMBERS('s'),
      T('s_owner', 'owner', `select app.set_cafe_setting('hero_mode', '"none"')`),
      APPLY_NOW('s'),
      // The discount changed after the OK: stale too.
      FEATURED('base_t', 'feat', 0, 'media'),
      ...RUN('t', 'mkt', featured('feat2', 10)),
      ...ACCEPT('t'),
      ...NUMBERS('t'),
      T('t_owner', 'owner', `select app.set_cafe_setting('featured_discount_pct', '5')`),
      APPLY_NOW('t'),
    ]);

    expect(ok(r, 'm_start')).toMatchObject({ auto: false });
    expect(ok(r, 'm_figures')).toMatchObject({
      change: 'featured_discount',
      featured: { current_item_id: v(r, 'feat'), new_item_id: v(r, 'feat2'), current_pct: 0, new_pct: 20,
                  current_hero_mode: 'media', units_30d: 0, discount_cost_30d_iqd: 0 },
    });
    expect(ok(r, 'm_apply')).toMatchObject({ run_status: 'done' });
    expect(ok(r, 'm_settings')).toEqual({ item: v(r, 'feat2'), pct: 20, mode: 'featured' });

    expect(refused(r, 'p_off')).toBe('RECORD_INVALID:menu_item_id');
    expect(ok(r, 'l_due')).toEqual({ applied: 1, reverted: 0 });
    expect(ok(r, 'l_settings')).toEqual({ item: v(r, 'feat'), pct: 15, mode: 'featured' });
    expect(ok(r, 'line')).toEqual({ unit: 6800, pct: 15, source: 'featured' });

    expect(refused(r, 's_apply')).toBe('PRICE_TARGET_CHANGED:featured');
    expect(refused(r, 't_apply')).toBe('PRICE_TARGET_CHANGED:featured');
  });

  it('a no-op featured change is refused, and a resubmission keeps its change and target', () => {
    const r = scenario([
      CAT('cafe', 'cafe'),
      ITEM('feat', 'cafe', true, true),
      SIZE('feat_s', 'feat', 8000),
      ITEM('tea', 'cafe', true, true),
      SIZE('tea_s', 'tea', 3000),
      ITEM('mocha', 'cafe', true, true),
      SIZE('mocha_s', 'mocha', 6000),
      FEATURED('base', 'feat', 15, 'featured'),
      START('p_noop', 'manager', `jsonb_build_object('change', 'featured_discount', ${REASON}, 'menu_item_id', {{feat}}, 'discount_pct', 15)`),
      // Sent back to the proposal: the new round may change the figures, not the item.
      ...RUN('b', 'manager', `jsonb_build_object('change', 'price', ${REASON}, 'menu_item_id', {{tea}},
                                'prices', jsonb_build_array(jsonb_build_object('variant_id', {{tea_s}}, 'price_iqd', 3500)))`),
      T('b_numbers', 'manager', `select app.submit_step({{b_num}}, '{"recommendation":"drop"}')`),
      LIVE_SUB('b_sub_num', 'b_num'),
      T('b_back', 'owner', `select app.decide_step({{b_sub_num}}, 'send_back', 'Try the mocha instead', {{b_prop}}::uuid)`),
      T('b_other_item', 'manager', `select app.submit_step({{b_prop}}, jsonb_build_object('change', 'price', ${REASON}, 'menu_item_id', {{mocha}},
                                      'prices', jsonb_build_array(jsonb_build_object('variant_id', {{mocha_s}}, 'price_iqd', 6500))))`),
      T('b_other_change', 'manager', `select app.submit_step({{b_prop}}, jsonb_build_object('change', 'featured_discount', ${REASON},
                                        'menu_item_id', {{tea}}, 'discount_pct', 10))`),
      T('b_same_item', 'manager', `select app.submit_step({{b_prop}}, jsonb_build_object('change', 'price', ${REASON}, 'menu_item_id', {{tea}},
                                     'prices', jsonb_build_array(jsonb_build_object('variant_id', {{tea_s}}, 'price_iqd', 3250))))`),
    ]);
    expect(refused(r, 'p_noop')).toBe('RECORD_INVALID:discount_pct');
    expect(ok(r, 'b_back')).toMatchObject({ decision: 'send_back' });
    expect(refused(r, 'b_other_item')).toBe('RECORD_INVALID:change');
    expect(refused(r, 'b_other_change')).toBe('RECORD_INVALID:change');
    expect(ok(r, 'b_same_item')).toMatchObject({ auto: true });
  });

  it('driver and marketing: no writer, no numbers, no mgmt record; targets carry no cost or sales', () => {
    const writers = [
      ['variant', `select to_jsonb(app.upsert_variant({{latte}}::uuid, 'x', 'x', 1000, {{latte_s}}::uuid))`],
      ['modifier', `select to_jsonb(app.upsert_modifier({{grp}}::uuid, 'x', 'x', {{mod}}::uuid, 900))`],
      ['promotion', `select to_jsonb(app.upsert_promotion(p_name_en => 'x', p_name_ar => 'x', p_type => 'percent', p_value => 5))`],
      ['enable', `select app.set_promotion_enabled({{promo}}::uuid, true)`],
      ['code', `select to_jsonb(app.generate_promo_code({{promo}}::uuid))`],
      ['rate', `select to_jsonb(app.upsert_rate_rule('x', array[1], '08:00', '09:00', '{"60": 1000}'))`],
      ['setting', `select app.set_cafe_setting('featured_discount_pct', '10')`],
      ['settings', `select app.set_cafe_settings('{"featured_discount_pct": 10}')`],
      ['retail', `select app.upsert_retail_variant(p_item_id => {{latte}}::uuid, p_name_en => 'x', p_name_ar => 'x', p_price_iqd => 1)`],
    ];
    const kinds = ['price', 'shop_launch', 'addon_price', 'promotion_edit', 'promotion_enable', 'rate', 'featured_discount'];
    const r = scenario([
      MK('drv', 'driver'),
      MK('mkt', 'marketing'),
      CAT('cafe', 'cafe'),
      ITEM('latte', 'cafe', true, true),
      SIZE('latte_s', 'latte', 5000),
      GROUP('grp'),
      MOD('mod', 'grp', 500, true, true),
      KEEP('promo', `insert into promotions (name_en, name_ar, type, value, enabled, created_by)
                     values ('PP off', 'عرض', 'percent', 5, false, {{owner}}) returning id::text`),
      COURT('court'),
      X(`insert into rate_rules (name, court_id, days_of_week, start_time, end_time, venue_id)
         values ('PP rule', {{court}}, '{1}', '10:00', '11:00', {{venue}})`),
      ...writers.flatMap(([k, sql]) => [T(`drv_${k}`, 'drv', sql!), T(`mkt_${k}`, 'mkt', sql!)]),
      START('drv_start', 'drv', `jsonb_build_object('change', 'price', ${REASON}, 'menu_item_id', {{latte}},
                                   'prices', jsonb_build_array(jsonb_build_object('variant_id', {{latte_s}}, 'price_iqd', 5500)))`),
      T('drv_targets', 'drv', `select app.price_promo_targets('price', {{venue}}::uuid)`),
      T('cashier_targets', 'cashier', `select app.price_promo_targets('price', {{venue}}::uuid)`),
      T('bad_change', 'manager', `select app.price_promo_targets('discount', {{venue}}::uuid)`),
      ...kinds.map((k) => T(`mkt_targets_${k}`, 'mkt', `select app.price_promo_targets('${k}', {{venue}}::uuid)`)),
      ...kinds.map((k) => T(`mgr_targets_${k}`, 'manager', `select app.price_promo_targets('${k}', {{venue}}::uuid)`)),

      // Marketing's run: the numbers are a mgmt record, and neither reads the figures.
      ...RUN('a', 'mkt', `jsonb_build_object('change', 'price', ${REASON}, 'menu_item_id', {{latte}},
                            'prices', jsonb_build_array(jsonb_build_object('variant_id', {{latte_s}}, 'price_iqd', 5500)))`),
      ...ACCEPT('a'),
      T('a_numbers', 'manager', `select app.submit_step({{a_num}}, '{"recommendation":"go","note":"Margin 60%"}')`),
      T('mkt_run', 'mkt', `select app.protocol_run_detail({{a}})`),
      T('mkt_numbers', 'mkt', `select app.price_promo_numbers({{a}})`),
      T('drv_numbers', 'drv', `select app.price_promo_numbers({{a}})`),
      T('drv_run', 'drv', `select app.protocol_run_detail({{a}})`),
      LIVE_SUB('a_sub_num', 'a_num'),
      T('mkt_decide', 'mkt', `select app.decide_step({{a_sub_num}}, 'approve')`),
      T('mkt_apply', 'mkt', `select app.submit_step({{a_app}}, '{"when":"now"}')`),
    ]);

    for (const [k] of writers) {
      expect(refused(r, `drv_${k}`), `driver ${k}`).toBe('FORBIDDEN');
      expect(refused(r, `mkt_${k}`), `marketing ${k}`).toBe('FORBIDDEN');
    }
    expect(refused(r, 'drv_start')).toBe('FORBIDDEN');
    expect(refused(r, 'drv_targets')).toBe('FORBIDDEN');
    expect(refused(r, 'cashier_targets')).toBe('FORBIDDEN');
    expect(refused(r, 'bad_change')).toBe('INVALID_ARGUMENT:change');
    expect(refused(r, 'mkt_targets_shop_launch')).toBe('FORBIDDEN');
    for (const k of kinds) {
      const who = k === 'shop_launch' ? ['mgr'] : ['mkt', 'mgr'];
      for (const w of who) expect(salesKeys(ok(r, `${w}_targets_${k}`)), `${w} ${k}`).toEqual([]);
    }
    // Marketing sees the launched add-on, not the manager's hidden drafts.
    const addons = ok<{ addons: Array<{ modifier_id: string; launched: boolean }> }>(r, 'mkt_targets_addon_price');
    expect(addons.addons.every((a) => a.launched)).toBe(true);
    expect(ok<{ promotions: Array<{ promotion_id: string }> }>(r, 'mkt_targets_promotion_enable').promotions.map((p) => p.promotion_id))
      .toContain(v(r, 'promo'));

    const run = ok<{ steps: Array<{ step_key: string; submissions: Array<{ record: unknown }> }> }>(r, 'mkt_run');
    const numbers = run.steps.find((s) => s.step_key === 'numbers')!;
    expect(numbers.submissions).toHaveLength(1);
    expect(numbers.submissions[0]!.record).toBeNull();
    expect(JSON.stringify(run)).not.toContain('Margin 60%');
    expect(refused(r, 'mkt_numbers')).toBe('FORBIDDEN');
    expect(refused(r, 'drv_numbers')).toBe('FORBIDDEN');
    expect(refused(r, 'drv_run')).toBe('PROTOCOL_NOT_FOUND');
    expect(refused(r, 'mkt_decide')).toBe('NOT_DECIDER');
    expect(refused(r, 'mkt_apply')).toBe('STEP_NOT_OPEN');
  });

  it('sends a manager’s rename of a size or a paid add-on on sale through a price change; the owner passes (#9)', () => {
    const variant = (who: string, label: string, item: string, id: string, en: string, ar: string, price: number,
                     isDefault = true, sort = 0) =>
      T(label, who, `select to_jsonb(app.upsert_variant({{${item}}}::uuid, '${en}', '${ar}', ${price}, {{${id}}}::uuid,
                                                       ${isDefault}, ${sort}))`);
    const retail = (who: string, label: string, en: string, ar: string, id: string | null) =>
      T(label, who, `select app.upsert_retail_variant(p_item_id => {{prod}}::uuid, p_name_en => '${en}', p_name_ar => '${ar}',
                                                     p_price_iqd => 50000${id ? `, p_id => {{${id}}}::uuid` : ''})`);
    const mod = (who: string, label: string, id: string, grp: string, en: string, ar: string, price: number, active: boolean) =>
      T(label, who, `select to_jsonb(app.upsert_modifier({{${grp}}}::uuid, '${en}', '${ar}', {{${id}}}::uuid, ${price}, 0, ${active}))`);
    const r = scenario([
      CAT('cafe', 'cafe'),
      CAT('shop', 'shop'),
      ITEM('on', 'cafe', true, true),
      SIZE('on_s', 'on', 5000),
      SIZE('on_l', 'on', 6500, 1),
      ITEM('draft', 'cafe', false, false),
      SIZE('draft_s', 'draft', 3000),
      ITEM('prod', 'shop', true, true),
      retail('owner', 'prod_size', 'M', 'وسط', null),
      RES('prod_s', 'prod_size', 'variant_id'),
      RES('prod_ing', 'prod_size', 'ingredient_id'),
      GROUP('grp'),
      GROUP('grp2'),
      MOD('paid', 'grp', 500, true, true),
      MOD('paid_old', 'grp', 750, false, true), // on sale before 0177, off today
      MOD('free', 'grp', 0, true, true),
      MOD('hidden', 'grp', 1000, false, false), // never launched

      // Sizes, as the manager: either language, a case change, and through
      // Stock ▸ Products; the price is checked first and keeps no hint.
      variant('manager', 'm_size_en', 'on', 'on_s', 'Classic', 'حجم', 5000),
      variant('manager', 'm_size_ar', 'on', 'on_s', 'PP on_s', 'كلاسيك', 5000),
      variant('manager', 'm_size_case', 'on', 'on_s', 'pp on_s', 'حجم', 5000),
      variant('manager', 'm_size_both', 'on', 'on_s', 'Classic', 'كلاسيك', 5500),
      retail('manager', 'm_retail_rename', 'L', 'كبير', 'prod_s'),
      // What still passes: whitespace, the default and the order, the
      // product's own fields under its names, a draft's size.
      variant('manager', 'm_size_space', 'on', 'on_s', '  PP on_s ', 'حجم ', 5000),
      variant('manager', 'm_size_order', 'on', 'on_l', 'PP on_l', 'حجم', 6500, true, 3),
      retail('manager', 'm_retail_same', 'M', 'وسط', 'prod_s'),
      variant('manager', 'm_draft_rename', 'draft', 'draft_s', 'Small', 'صغير', 3000),

      // Add-ons, as the manager: a paid one on sale, or once on sale, is
      // locked, switched off in the same save or not ...
      mod('manager', 'm_paid_rename', 'paid', 'grp', 'Extra shot', 'شوت إضافي', 500, true),
      mod('manager', 'm_paid_off_rename', 'paid', 'grp', 'Extra shot', 'إضافة', 500, false),
      mod('manager', 'm_paid_old_rename', 'paid_old', 'grp', 'Extra syrup', 'إضافة', 750, false),
      mod('manager', 'm_paid_both', 'paid', 'grp', 'Extra shot', 'شوت إضافي', 600, true),
      // ... a free option, a never-launched one, and a move or whitespace
      // that keeps the name are not.
      mod('manager', 'm_free_rename', 'free', 'grp', 'No ice', 'بدون ثلج', 0, true),
      mod('manager', 'm_hidden_rename', 'hidden', 'grp', 'Oat', 'شوفان', 1000, false),
      mod('manager', 'm_paid_move', 'paid', 'grp2', 'PP paid', 'إضافة', 500, true),
      mod('manager', 'm_paid_space', 'paid', 'grp2', ' PP paid', 'إضافة ', 500, true),

      // The owner passes every lock.
      variant('owner', 'o_size_rename', 'on', 'on_s', 'Classic', 'كلاسيك', 5000),
      retail('owner', 'o_retail_rename', 'L', 'كبير', 'prod_s'),
      mod('owner', 'o_paid_rename', 'paid', 'grp2', 'Extra shot', 'شوت إضافي', 500, true),
      Q('names', `select jsonb_build_object(
                    'on_s', (select jsonb_build_array(name_en, name_ar, price_iqd) from menu_item_variants where id = {{on_s}}),
                    'on_l', (select jsonb_build_array(name_en, is_default, sort_order) from menu_item_variants where id = {{on_l}}),
                    'draft_s', (select name_en from menu_item_variants where id = {{draft_s}}),
                    'prod_s', (select jsonb_build_array(name_en, name_ar) from menu_item_variants where id = {{prod_s}}),
                    'prod_ing', (select jsonb_build_array(name_en, name_ar) from ingredients where id = {{prod_ing}}),
                    'paid', (select jsonb_build_array(name_en, name_ar, price_delta_iqd, group_id = {{grp2}})
                               from modifiers where id = {{paid}}),
                    'paid_old', (select name_en from modifiers where id = {{paid_old}}),
                    'free', (select name_en from modifiers where id = {{free}}),
                    'hidden', (select name_en from modifiers where id = {{hidden}}))`),
    ]);

    for (const label of ['m_size_en', 'm_size_ar', 'm_size_case', 'm_retail_rename', 'm_paid_rename', 'm_paid_off_rename',
                         'm_paid_old_rename']) {
      expect(refused(r, label), label).toBe('PRICE_VIA_PROTOCOL:name');
    }
    expect(refused(r, 'm_size_both')).toBe('PRICE_VIA_PROTOCOL');
    expect(refused(r, 'm_paid_both')).toBe('PRICE_VIA_PROTOCOL');
    for (const label of ['m_size_space', 'm_size_order', 'm_retail_same', 'm_draft_rename', 'm_free_rename', 'm_hidden_rename',
                         'm_paid_move', 'm_paid_space', 'o_size_rename', 'o_retail_rename', 'o_paid_rename']) {
      ok(r, label);
    }
    expect(ok(r, 'names')).toEqual({
      on_s: ['Classic', 'كلاسيك', 5000],
      on_l: ['PP on_l', false, 3],
      draft_s: 'Small',
      prod_s: ['L', 'كبير'],
      prod_ing: ['PP prod L', 'صنف كبير'],
      paid: ['Extra shot', 'شوت إضافي', 500, true],
      paid_old: 'PP paid_old',
      free: 'No ice',
      hidden: 'Oat',
    });
  });

  it('renames through a price change: a swap, a shop size, add-ons, stale names and the refusals (#9)', () => {
    const NAMED = (name: string, item: string, en: string, ar: string, price: number, sort: number) =>
      KEEP(name, `insert into menu_item_variants (item_id, name_en, name_ar, price_iqd, is_default, sort_order)
                  values ({{${item}}}, '${en}', '${ar}', ${price}, ${sort === 0}, ${sort}) returning id::text`);
    const ren = (id: string, en: string, ar: string, key = 'variant_id') =>
      `jsonb_build_object('${key}', {{${id}}}, 'name_en', '${en}', 'name_ar', '${ar}')`;
    const priceRecord = (item: string, renames: string[], prices = `'[]'::jsonb`) =>
      `jsonb_build_object('change', 'price', ${REASON}, 'menu_item_id', {{${item}}}, 'prices', ${prices},
                          'renames', jsonb_build_array(${renames.join(', ')}))`;
    const addonRecord = (renames: string[], extra = '') =>
      `jsonb_build_object('change', 'addon_price', ${REASON}${extra}, 'renames', jsonb_build_array(${renames.join(', ')}))`;
    const SIZES = (label: string, item: string) =>
      Q(label, `select jsonb_agg(jsonb_build_object(
                         'en', v.name_en, 'ar', v.name_ar, 'price', v.price_iqd, 'default', v.is_default,
                         'recipe', (select jsonb_agg(rl.qty) from recipe_lines rl where rl.variant_id = v.id))
                       order by v.sort_order)
                  from menu_item_variants v where v.item_id = {{${item}}}`);
    const COUNTS = (label: string, run: string) =>
      Q(label, `select jsonb_agg(after->'counts') from audit_log where action = 'protocol.price.apply' and entity_id = {{${run}}}::text`);
    const others = ['drv', 'cashier', 'bar', 'asst', 'wtr'];
    const r = scenario([
      MK('mkt', 'marketing'),
      MK('drv', 'driver'),
      MK('bar', 'barista'),
      MK('asst', 'assistant_barista'),
      MK('wtr', 'waiter'),
      VENUE_X,
      CAT('cafe', 'cafe'),
      CAT('shop', 'shop'),
      ITEM('latte', 'cafe', true, true),
      NAMED('small', 'latte', 'Small', 'صغير', 5000, 0),
      NAMED('large', 'latte', 'Large', 'كبير', 6500, 1),
      KEEP('milk', `insert into ingredients (kind, name_en, name_ar, unit, is_active, venue_id)
                    values ('purchased', 'PP milk', 'حليب', 'g', true, {{venue}}) returning id::text`),
      X(`insert into recipe_lines (variant_id, ingredient_id, qty)
         values ({{small}}::uuid, {{milk}}::uuid, 100), ({{large}}::uuid, {{milk}}::uuid, 150)`),
      ITEM('mocha', 'cafe', true, true),
      NAMED('mocha_s', 'mocha', 'Regular', 'عادي', 6000, 0),
      ITEM('tea', 'cafe', true, true),
      NAMED('tea_s', 'tea', 'Cup', 'كوب', 3000, 0),
      ITEM('cake', 'cafe', true, true),
      NAMED('slice', 'cake', 'Slice', 'شريحة', 4000, 0),
      ITEM('prod', 'shop', true, true),
      T('prod_size', 'owner', `select app.upsert_retail_variant(p_item_id => {{prod}}::uuid, p_name_en => 'M', p_name_ar => 'وسط',
                                                               p_price_iqd => 50000)`),
      RES('prod_s', 'prod_size', 'variant_id'),
      RES('prod_ing', 'prod_size', 'ingredient_id'),
      GROUP('grp'),
      MOD('shot', 'grp', 1000, true, true),
      MOD('syrup', 'grp', 500, true, true),
      MOD('hidden', 'grp', 1500, false, false),
      GROUP('grp_x', 'venue_x'),
      MOD('a_x', 'grp_x', 100, true, true),

      // Marketing swaps the latte's two names; numbers never carries names.
      ...RUN('a', 'mkt', priceRecord('latte', [ren('small', 'Large', 'كبير'), ren('large', 'Small', 'صغير')])),
      ...ACCEPT('a'),
      T('a_num_renames', 'manager', `select app.submit_step({{a_num}}, jsonb_build_object('recommendation', 'go',
                                        'renames', jsonb_build_array(${ren('small', 'Tall', 'طويل')})))`),
      ...NUMBERS('a'),
      T('a_figures', 'manager', `select app.price_promo_numbers({{a}})`),
      APPLY_NOW('a'),
      SIZES('latte_after', 'latte'),
      COUNTS('a_counts', 'a'),

      // The manager renames the mocha only; a before_en the client sends is replaced.
      ...RUN('b', 'manager', priceRecord('mocha', [`jsonb_build_object('variant_id', {{mocha_s}}, 'name_en', ' Dark ',
                                                                        'name_ar', 'داكن', 'before_en', 'Bogus')`])),
      Q('b_record', `select x.record->'renames' from protocol_submissions x where x.run_step_id = {{b_prop}}`),
      ...NUMBERS('b'),
      APPLY_NOW('b'),
      SIZES('mocha_after', 'mocha'),

      // A shop size renamed and priced in one run: its stock row takes the new name.
      ...RUN('d', 'manager', priceRecord('prod', [ren('prod_s', 'L', 'كبير')],
                                         `jsonb_build_array(jsonb_build_object('variant_id', {{prod_s}}, 'price_iqd', 55000))`)),
      ...NUMBERS('d', `jsonb_build_object('recommendation', 'go',
                         'prices', jsonb_build_array(jsonb_build_object('variant_id', {{prod_s}}, 'price_iqd', 56000)))`),
      T('d_figures', 'manager', `select app.price_promo_numbers({{d}})`),
      APPLY_NOW('d'),
      Q('prod_after', `select jsonb_build_object(
                         'size', (select jsonb_build_array(name_en, name_ar, price_iqd) from menu_item_variants where id = {{prod_s}}),
                         'stock', (select jsonb_build_array(name_en, name_ar) from ingredients where id = {{prod_ing}}))`),
      COUNTS('d_counts', 'd'),

      // Marketing renames an add-on and prices none.
      ...RUN('e', 'mkt', addonRecord([ren('shot', 'Double shot', 'شوت مزدوج', 'modifier_id')], `, 'addons', '[]'::jsonb`)),
      ...ACCEPT('e'),
      ...NUMBERS('e'),
      T('e_figures', 'manager', `select app.price_promo_numbers({{e}})`),
      APPLY_NOW('e'),
      Q('shot_after', `select jsonb_build_array(name_en, name_ar, price_delta_iqd, is_active) from modifiers where id = {{shot}}`),
      COUNTS('e_counts', 'e'),

      // The owner renames the size after the OK: the dated run goes back at the cron.
      ...RUN('f', 'manager', priceRecord('tea', [ren('tea_s', 'Mug', 'كوب كبير')])),
      ...NUMBERS('f'),
      APPLY_DATE('f'),
      T('f_owner', 'owner', `select to_jsonb(app.upsert_variant({{tea}}::uuid, 'Glass', 'كأس', 3000, {{tea_s}}::uuid, true, 0))`),
      DUE('f'),
      Q('f_due', `select app.price_promo_apply_due()`),
      RUN_STATUS('f_after', 'f'),
      Q('f_audit', `select jsonb_agg(after) from audit_log where action = 'protocol.unschedule' and entity_id = {{f}}::text`),
      Q('f_push', `select coalesce(jsonb_agg(profile_id::text order by profile_id), '[]') from notification_outbox
                    where payload->>'title_key' = 'apply_not_ready' and payload->>'id' = {{f_app}}`),
      // And an add-on renamed after the OK, applied now.
      ...RUN('g', 'manager', addonRecord([ren('syrup', 'Vanilla', 'فانيلا', 'modifier_id')])),
      ...NUMBERS('g'),
      T('g_owner', 'owner', `select to_jsonb(app.upsert_modifier({{grp}}::uuid, 'Caramel', 'كراميل', {{syrup}}::uuid, 500, 0, true))`),
      APPLY_NOW('g'),

      // Refused at the proposal, with renames as the field.
      START('p_foreign', 'manager', priceRecord('cake', [ren('mocha_s', 'Big', 'كبير')])),
      START('p_same', 'manager', priceRecord('cake', [ren('slice', 'Slice', 'شريحة')])),
      START('p_same_space', 'mkt', priceRecord('cake', [ren('slice', ' Slice ', 'شريحة ')])),
      START('p_blank', 'manager', priceRecord('cake', [ren('slice', '  ', 'شريحة كبيرة')])),
      START('p_one_name', 'manager', priceRecord('cake', [`jsonb_build_object('variant_id', {{slice}}, 'name_en', 'Big slice')`])),
      START('p_long', 'manager', priceRecord('cake', [ren('slice', 'x'.repeat(81), 'شريحة')])),
      START('p_twice', 'manager', priceRecord('cake', [ren('slice', 'Big', 'كبيرة'), ren('slice', 'Huge', 'ضخمة')])),
      START('p_stray', 'manager', priceRecord('cake', [`jsonb_build_object('variant_id', {{slice}}, 'name_en', 'Big',
                                                                              'name_ar', 'كبيرة', 'price_iqd', 4500)`])),
      START('p_thirteen', 'manager', priceRecord('cake', Array.from({ length: 13 }, () => ren('slice', 'Big', 'كبيرة')))),
      START('p_nothing', 'manager', priceRecord('cake', [])),
      START('p_hidden', 'manager', addonRecord([ren('hidden', 'Oat', 'شوفان', 'modifier_id')])),
      START('p_addon_x', 'mkt', addonRecord([ren('a_x', 'Big', 'كبير', 'modifier_id')])),
      START('p_addon_nothing', 'manager', addonRecord([], `, 'addons', '[]'::jsonb`)),
      START('p_shop_launch', 'manager', `jsonb_build_object('change', 'shop_launch', ${REASON}, 'menu_item_id', {{prod}},
                                           'prices', '[]'::jsonb, 'renames', '[]'::jsonb)`),
      START('p_80', 'manager', priceRecord('cake', [ren('slice', 'x'.repeat(80), 'شريحة')])),

      // Nobody else starts one or reads the figures, marketing included.
      ...others.map((who) => START(`${who}_start`, who, priceRecord('cake', [ren('slice', 'Big', 'كبيرة')]))),
      ...[...others, 'mkt'].map((who) => T(`${who}_numbers`, who, `select app.price_promo_numbers({{a}})`)),
    ]);

    // The swap: names change places; each row keeps its price and its recipe.
    expect(refused(r, 'a_num_renames')).toBe('RECORD_INVALID:renames');
    const a = ok<{ sizes: unknown[]; addons: unknown[]; renames: unknown[] }>(r, 'a_figures');
    expect(a.sizes).toEqual([]);
    expect(a.renames).toEqual([
      { target: 'size', id: v(r, 'small'), from_en: 'Small', from_ar: 'صغير', to_en: 'Large', to_ar: 'كبير', price_iqd: 5000 },
      { target: 'size', id: v(r, 'large'), from_en: 'Large', from_ar: 'كبير', to_en: 'Small', to_ar: 'صغير', price_iqd: 6500 },
    ]);
    expect(ok(r, 'a_apply')).toMatchObject({ run_status: 'done' });
    expect(ok(r, 'latte_after')).toEqual([
      { en: 'Large', ar: 'كبير', price: 5000, default: true, recipe: [100] },
      { en: 'Small', ar: 'صغير', price: 6500, default: false, recipe: [150] },
    ]);
    expect(ok(r, 'a_counts')).toEqual([{ sizes: 0, new_sizes: 0, renamed: 2 }]);

    expect(ok(r, 'b_start')).toMatchObject({ auto: true });
    expect(ok(r, 'b_record')).toEqual([
      { variant_id: v(r, 'mocha_s'), name_en: 'Dark', name_ar: 'داكن', before_en: 'Regular', before_ar: 'عادي' },
    ]);
    expect(ok(r, 'mocha_after')).toEqual([{ en: 'Dark', ar: 'داكن', price: 6000, default: true, recipe: null }]);

    expect(ok<{ renames: unknown[] }>(r, 'd_figures').renames).toEqual([
      { target: 'size', id: v(r, 'prod_s'), from_en: 'M', from_ar: 'وسط', to_en: 'L', to_ar: 'كبير', price_iqd: 56000 },
    ]);
    expect(ok(r, 'prod_after')).toEqual({ size: ['L', 'كبير', 56000], stock: ['PP prod L', 'صنف كبير'] });
    expect(ok(r, 'd_counts')).toEqual([{ sizes: 1, new_sizes: 0, renamed: 1 }]);

    const e = ok<{ addons: unknown[]; renames: unknown[] }>(r, 'e_figures');
    expect(e.addons).toEqual([]);
    expect(e.renames).toEqual([
      { target: 'addon', id: v(r, 'shot'), from_en: 'PP shot', from_ar: 'إضافة', to_en: 'Double shot', to_ar: 'شوت مزدوج',
        price_iqd: 1000 },
    ]);
    expect(ok(r, 'e_apply')).toMatchObject({ run_status: 'done' });
    expect(ok(r, 'shot_after')).toEqual(['Double shot', 'شوت مزدوج', 1000, true]);
    expect(ok(r, 'e_counts')).toEqual([{ addons: 0, launched: 0, renamed: 1 }]);

    ok(r, 'f_owner');
    expect(ok(r, 'f_due')).toEqual({ applied: 0, reverted: 1 });
    expect(ok(r, 'f_after')).toEqual({ status: 'active', finished: false });
    expect(ok(r, 'f_audit')).toEqual([
      { status: 'active', run_step_id: v(r, 'f_app'), not_applied: 'PRICE_TARGET_CHANGED', hint: `size:${v(r, 'tea_s')}` },
    ]);
    expect(ok<string[]>(r, 'f_push')).toContain(SEED_STAFF_IDS.manager);
    ok(r, 'g_owner');
    expect(refused(r, 'g_apply')).toBe(`PRICE_TARGET_CHANGED:addon:${v(r, 'syrup')}`);

    for (const label of ['p_foreign', 'p_same', 'p_same_space', 'p_blank', 'p_one_name', 'p_twice', 'p_stray', 'p_thirteen',
                         'p_hidden', 'p_addon_x', 'p_shop_launch']) {
      expect(refused(r, label), label).toBe('RECORD_INVALID:renames');
    }
    // Past 80 characters is the text cap, as for a new size's name.
    expect(refused(r, 'p_long')).toBe('TEXT_TOO_LONG:renames');
    ok(r, 'p_80');
    expect(refused(r, 'p_nothing')).toBe('RECORD_INVALID:prices');
    expect(refused(r, 'p_addon_nothing')).toBe('RECORD_INVALID:addons');

    for (const who of others) expect(refused(r, `${who}_start`), who).toBe('FORBIDDEN');
    for (const who of [...others, 'mkt']) expect(refused(r, `${who}_numbers`), who).toBe('FORBIDDEN');
  });
});
