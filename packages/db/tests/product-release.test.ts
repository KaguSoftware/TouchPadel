/**
 * product_release (build-contracts-2026-09-23 §2.9, §2.8, §2.21, §2.22, §8.2):
 * a new menu item's way onto the menu, and the ideas that come before it.
 *
 *   * a head chef's proposal to the owner's launch: the manager's accept
 *     builds the hidden draft (sizes at price 0, the stocked lines as its
 *     recipe), a send-back to the proposal rebuilds it in place, the test
 *     consumes stock as product_test (not waste) on every round, the price
 *     goes to the owner, the launch now needs the copied menu photo, and the
 *     item goes on sale with its photo and launched_at;
 *   * ITEM_IN_RELEASE for the manager and the owner on a price change, a new
 *     size and a switch-on while the price step still writes the prices;
 *   * the count differences and the stock report carry the product tests;
 *   * a manager-started release passes its proposal at once with a category;
 *     the manager new-item guard (ITEM_VIA_RELEASE, LAUNCH_VIA_PROTOCOL), a
 *     shop product on sale moved into a cafe category, a release draft kept
 *     out of a shop category (for the owner too), the owner's direct path,
 *     launched_at, and the accepted rename limit (#59);
 *   * a release stopped at the test deletes its draft;
 *   * ideas (#65): each team's head only, the start with the photos carried
 *     over, the author's view of the run with no record, the refusals, the
 *     roll-back of a failing proposal, decline and withdraw, who reads an
 *     idea's photo;
 *   * driver and marketing refused every release and idea RPC, and no row of
 *     release_ideas.
 *
 * HOW. Every scenario is ONE psql transaction that is rolled back (the
 * protocols-engine-flow.test.ts harness, without its hook replacement: these
 * are the real product release hooks). Staff, categories, ingredients, runs
 * and slots are created inside it and each call runs as `authenticated` with
 * the caller's JWT claims. Nothing is committed. Without docker on PATH the
 * suite skips itself.
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

// ── the in-transaction harness (as protocols-engine-flow.test.ts) ──────────
// vars: named values; {{name}} in a statement is its quoted literal, @@name@@
// its raw text. t(): one call as a staff member (role authenticated + claims).
// q(): a read as postgres. x(): a statement as postgres. keep(): a value into vars. mk(): an auth user and a
// staff row (the 0123 trigger files a non-owner at venue A). photo(): a slot
// minted by a staff member in a folder.
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
declare v_uid text; v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_hint text; v_state text;
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
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint, v_state = returned_sqlstate;
    reset role;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'hint', nullif(v_hint, ''), 'state', v_state));
  end;
end $f$;

create function pg_temp.q(p_label text, p_sql text) returns void language plpgsql as $f$
declare v jsonb;
begin
  execute pg_temp.sub(p_sql) into v;
  insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
end $f$;

create function pg_temp.x(p_sql text) returns void language plpgsql as $f$
begin
  execute pg_temp.sub(p_sql);
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

create function pg_temp.photo(p_name text, p_who text, p_folder text) returns void language plpgsql as $f$
declare v_uid uuid;
begin
  select val::uuid into v_uid from pg_temp.vars where name = p_who;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  insert into pg_temp.vars values (p_name, app.staff_media_slot('${VENUE_A_ID}', p_folder, 'jpg')->>'path');
end $f$;
`;

interface Outcome {
  ok: boolean;
  data?: unknown;
  code?: string;
  hint?: string | null;
  state?: string;
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
const RES = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data${path ? `,${path}` : ''}}' from pg_temp.out where label = '${label}'`);
const MK = (name: string, role: string) => `select pg_temp.mk('${name}', '${role}');`;
const PHOTO = (name: string, who: string, folder: string) => `select pg_temp.photo('${name}', '${who}', '${folder}');`;
const STEPK = (name: string, run: string, key: string) =>
  KEEP(name, `select id::text from protocol_run_steps where run_id = {{${run}}} and step_key = '${key}'`);
/** The live (undecided, not withdrawn or set aside) submission of a step. */
const LIVE_SUB = (name: string, step: string) =>
  KEEP(
    name,
    `select id::text from protocol_submissions where run_step_id = {{${step}}}
       and decision is null and withdrawn_at is null and superseded_at is null`,
  );
const OUTBOX_Q = (label: string) =>
  Q(
    label,
    `select coalesce(jsonb_agg(jsonb_build_object('to', o.profile_id, 'kind', o.kind, 'payload', o.payload)
                               order by o.id), '[]')
       from notification_outbox o
      where o.created_at = now()`,
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

interface Push {
  to: string;
  kind: string;
  payload: { route: string; id: string; title_key: string; params: Record<string, unknown> };
}
const pushesOf = (pushes: Push[], titleKey: string) => pushes.filter((p) => p.payload.title_key === titleKey);

// ── shared setup: the staff, a cafe category, two stocked ingredients ──────
const SETUP = [
  MK('hc', 'head_chef'),
  MK('chef', 'chef'),
  MK('hb', 'head_barista'),
  MK('ba', 'barista'),
  MK('ba2', 'barista'),
  MK('drv', 'driver'),
  MK('mkt', 'marketing'),
  KEEP(
    'cat',
    `insert into menu_categories (name_en, name_ar, tax_group_id, is_active, venue_id, kind)
     values ('PR drinks', 'مشروبات', {{tax}}, true, {{venue}}, 'cafe') returning id::text`,
  ),
  KEEP(
    'shopcat',
    `insert into menu_categories (name_en, name_ar, tax_group_id, is_active, venue_id, kind)
     values ('PR shop', 'متجر', {{tax}}, true, {{venue}}, 'shop') returning id::text`,
  ),
  KEEP(
    'milk',
    `insert into ingredients (kind, name_en, name_ar, unit, is_active, venue_id)
     values ('purchased', 'PR milk', 'حليب', 'g', true, {{venue}}) returning id::text`,
  ),
  // Half of what is poured is kept: the test consumes qty / 0.5.
  KEEP(
    'rose',
    `insert into ingredients (kind, name_en, name_ar, unit, is_active, yield_percent, venue_id)
     values ('purchased', 'PR rose syrup', 'شراب الورد', 'ml', true, 50, {{venue}}) returning id::text`,
  ),
  X(`insert into stock_batches (ingredient_id, qty_received, qty_remaining, unit_cost_iqd, venue_id)
     values ({{milk}}::uuid, 10000, 10000, 2, {{venue}}::uuid)`),
];

/** A proposal: two stocked lines, one free-text line, the given sizes. */
const proposal = (sizes: string, extra = '') =>
  `jsonb_build_object('name_en', 'Rose latte', 'item_kind', 'drink',
     'lines', jsonb_build_array(
       jsonb_build_object('ingredient_id', {{milk}}, 'qty', 200, 'unit', 'g'),
       jsonb_build_object('ingredient_id', {{rose}}, 'qty', 10, 'unit', 'ml'),
       jsonb_build_object('label', 'Edible petals', 'qty', 2, 'unit', 'pc')),
     'sizes', ${sizes}, 'link', 'https://example.com/rose'${extra})`;
const TWO_SIZES = `jsonb_build_array(jsonb_build_object('name_en', 'Small'),
                                     jsonb_build_object('name_en', 'Large', 'name_ar', 'كبير'))`;
const ONE_SIZE = `jsonb_build_array(jsonb_build_object('name_ar', 'عادي'))`;
const start = (record: string, data = `'{}'::jsonb`, photos = `'{}'::text[]`, title = `'Rose latte'`) =>
  `select app.start_protocol('product_release', null, ${title}, null, ${data}, ${record}, ${photos}, {{venue}}::uuid, null)`;

describe.skipIf(!docker)('product_release (rolled-back transactions)', () => {
  it('runs a head chef’s proposal to the owner’s launch, rebuilding the draft on a send-back', () => {
    const r = scenario([
      ...SETUP,
      T('start', 'hc', start(proposal(TWO_SIZES))),
      RES('run', 'start', 'run_id'),
      RES('sub1', 'start', 'submission_id'),
      STEPK('p_step', 'run', 'propose'),
      STEPK('test', 'run', 'test'),
      STEPK('an', 'run', 'analysis'),
      STEPK('mk_step', 'run', 'marketing'),
      STEPK('launch', 'run', 'launch'),
      // The manager accepts without a category, then with one.
      T('accept_nocat', 'manager', `select app.decide_step({{sub1}}::uuid, 'approve', null, null, '{}'::jsonb)`),
      T('accept', 'manager', `select app.decide_step({{sub1}}::uuid, 'approve', null, null, jsonb_build_object('category_id', {{cat}}))`),
      KEEP('item', `select menu_item_id::text from protocol_runs where id = {{run}}`),
      Q(
        'draft',
        `select jsonb_build_object(
           'active', mi.is_active, 'launched_at', mi.launched_at, 'release_run', mi.release_run_id,
           'category', mi.category_id, 'name_en', mi.name_en, 'name_ar', mi.name_ar, 'venue', mi.venue_id,
           'sizes', (select jsonb_agg(jsonb_build_object('en', v.name_en, 'ar', v.name_ar, 'price', v.price_iqd,
                                                         'default', v.is_default) order by v.sort_order)
                       from menu_item_variants v where v.item_id = mi.id),
           'recipe', (select count(*) from recipe_lines rl join menu_item_variants v on v.id = rl.variant_id
                       where v.item_id = mi.id))
           from menu_items mi where mi.id = {{item}}`,
      ),
      KEEP('v1', `select id::text from menu_item_variants where item_id = {{item}} order by sort_order limit 1`),
      KEEP('v2', `select id::text from menu_item_variants where item_id = {{item}} order by sort_order desc limit 1`),
      // In release: nobody changes a price or adds a size, nobody switches it on.
      T('mgr_price', 'manager', `select to_jsonb(app.upsert_variant({{item}}::uuid, 'Small', 'Small', 5000, {{v1}}::uuid, true, 0))`),
      T('own_price', 'owner', `select to_jsonb(app.upsert_variant({{item}}::uuid, 'Small', 'Small', 5000, {{v1}}::uuid, true, 0))`),
      T('own_size', 'owner', `select to_jsonb(app.upsert_variant({{item}}::uuid, 'Huge', 'ضخم', 0, null, false, 9))`),
      T('mgr_rename', 'manager', `select to_jsonb(app.upsert_variant({{item}}::uuid, 'Petite', 'صغير', 0, {{v1}}::uuid, true, 0))`),
      T(
        'own_on',
        'owner',
        `select to_jsonb(app.upsert_menu_item({{cat}}::uuid, 'Rose latte', 'Rose latte', {{item}}::uuid, null, null, 0, true))`,
      ),
      T(
        'mgr_on',
        'manager',
        `select to_jsonb(app.upsert_menu_item({{cat}}::uuid, 'Rose latte', 'Rose latte', {{item}}::uuid, null, null, 0, true))`,
      ),
      // The proposer makes test servings; the test context has no cost.
      T('ctx_hc', 'hc', `select app.release_test_context({{run}}::uuid)`),
      T('ctx_hb', 'hb', `select app.release_test_context({{run}}::uuid)`),
      T('ctx_chef', 'chef', `select app.release_test_context({{run}}::uuid)`),
      PHOTO('p_t1', 'hc', 'tests'),
      T(
        'test1',
        'hc',
        `select app.submit_step({{test}}::uuid,
           jsonb_build_object('servings', jsonb_build_array(jsonb_build_object('variant_id', {{v1}}, 'count', 2))),
           array[{{p_t1}}])`,
      ),
      LIVE_SUB('tsub1', 'test'),
      // The manager sends the test back to the proposal: one size this time.
      T(
        'back',
        'manager',
        `select app.decide_step({{tsub1}}::uuid, 'send_back', 'One size is enough', {{p_step}}::uuid, '{}'::jsonb)`,
      ),
      T('prop2', 'hc', `select app.submit_step({{p_step}}::uuid, ${proposal(ONE_SIZE)}, '{}'::text[])`),
      RES('sub2', 'prop2', 'submission_id'),
      T('accept2', 'manager', `select app.decide_step({{sub2}}::uuid, 'approve', null, null, jsonb_build_object('category_id', {{cat}}))`),
      Q(
        'rebuilt',
        `select jsonb_build_object(
           'item', (select menu_item_id from protocol_runs where id = {{run}}),
           'sizes', (select jsonb_agg(jsonb_build_object('id', v.id, 'en', v.name_en, 'ar', v.name_ar) order by v.sort_order)
                       from menu_item_variants v where v.item_id = {{item}}),
           'recipe', (select count(*) from recipe_lines rl join menu_item_variants v on v.id = rl.variant_id
                       where v.item_id = {{item}}))`,
      ),
      PHOTO('p_t2', 'hc', 'tests'),
      T(
        'test2',
        'hc',
        `select app.submit_step({{test}}::uuid,
           jsonb_build_object('servings', jsonb_build_array(jsonb_build_object('variant_id', {{v1}}, 'count', 1))),
           array[{{p_t2}}])`,
      ),
      Q(
        'consumed',
        `select jsonb_build_object(
           'milk', -sum(qty_delta) filter (where ingredient_id = {{milk}}::uuid),
           'rose', -sum(qty_delta) filter (where ingredient_id = {{rose}}::uuid),
           'types', jsonb_agg(distinct movement_type),
           'staff', jsonb_agg(distinct staff_id))
           from stock_movements where reason_code = 'run:' || {{run}}`,
      ),
      LIVE_SUB('tsub2', 'test'),
      T('test_ok', 'manager', `select app.decide_step({{tsub2}}::uuid, 'approve', null, null, '{}'::jsonb)`),
      T('ready_before', 'manager', `select app.release_readiness({{run}}::uuid)`),
      T('cost', 'manager', `select app.release_cost({{run}}::uuid)`),
      // The price: the manager's figures go to the owner (fixed OK, #58).
      T(
        'price',
        'manager',
        `select app.submit_step({{an}}::uuid, jsonb_build_object(
           'prices', jsonb_build_array(jsonb_build_object('variant_id', {{v1}}, 'price_iqd', 4500)),
           'name_en', 'Rose Latte', 'name_ar', 'لاتيه الورد'), '{}'::text[])`,
      ),
      LIVE_SUB('asub', 'an'),
      T('price_ok_mgr', 'manager', `select app.decide_step({{asub}}::uuid, 'approve', null, null, '{}'::jsonb)`),
      T('price_ok', 'owner', `select app.decide_step({{asub}}::uuid, 'approve', null, null, '{}'::jsonb)`),
      Q(
        'priced',
        `select jsonb_build_object('name_en', mi.name_en, 'name_ar', mi.name_ar, 'active', mi.is_active,
                                   'price', (select v.price_iqd from menu_item_variants v where v.id = {{v1}}))
           from menu_items mi where mi.id = {{item}}`,
      ),
      // Still in release after the price: the owner cannot change it either.
      T('own_price2', 'owner', `select to_jsonb(app.upsert_variant({{item}}::uuid, 'Petite', 'صغير', 6000, {{v1}}::uuid, true, 0))`),
      T(
        'mkt',
        'mkt',
        `select app.submit_step({{mk_step}}::uuid, jsonb_build_object('highlights_en', 'Floral, light', 'highlights_ar', 'زهري وخفيف'), '{}'::text[])`,
      ),
      LIVE_SUB('msub', 'mk_step'),
      T('mkt_ok', 'owner', `select app.decide_step({{msub}}::uuid, 'approve', null, null, '{}'::jsonb)`),
      T('ready', 'manager', `select app.release_readiness({{run}}::uuid)`),
      // The launch: owner only, the copied menu path only, a photo of this run.
      KEEP('menu_path', `select 'items/' || {{item}} || '/' || {{run}} || '.jpg'`),
      PHOTO('p_other', 'owner', 'tests'),
      T('l_mgr', 'manager', `select app.submit_step({{launch}}::uuid, jsonb_build_object('when', 'now', 'photo_path', {{p_t2}}, 'menu_photo_path', {{menu_path}}))`),
      T('l_nomenu', 'owner', `select app.submit_step({{launch}}::uuid, jsonb_build_object('when', 'now', 'photo_path', {{p_t2}}))`),
      T(
        'l_foreign',
        'owner',
        `select app.submit_step({{launch}}::uuid, jsonb_build_object('when', 'now', 'photo_path', {{p_t2}},
           'menu_photo_path', 'items/' || {{item}} || '/someone-else.jpg'))`,
      ),
      T('l_photo', 'owner', `select app.submit_step({{launch}}::uuid, jsonb_build_object('when', 'now', 'photo_path', {{p_other}}, 'menu_photo_path', {{menu_path}}))`),
      T(
        'l_far',
        'owner',
        `select app.submit_step({{launch}}::uuid, jsonb_build_object('when', 'date', 'at', now() + interval '91 days', 'photo_path', {{p_t2}}))`,
      ),
      // The right path with no copy behind it: a direct submit_step cannot
      // put the item on the menu with a missing photo.
      T('l_nocopy', 'owner', `select app.submit_step({{launch}}::uuid, jsonb_build_object('when', 'now', 'photo_path', {{p_t2}}, 'menu_photo_path', {{menu_path}}))`),
      // What protocol-action's copy leaves in the public menu bucket.
      X(`insert into storage.objects (bucket_id, name) values ('menu-media', {{menu_path}})`),
      T('launch_now', 'owner', `select app.submit_step({{launch}}::uuid, jsonb_build_object('when', 'now', 'photo_path', {{p_t2}}, 'menu_photo_path', {{menu_path}}))`),
      Q(
        'launched',
        `select jsonb_build_object('active', mi.is_active, 'launched', mi.launched_at is not null,
                                   'photo', mi.photo_path,
                                   'run', (select jsonb_build_object('status', r.status, 'live', r.live_at is not null)
                                             from protocol_runs r where r.id = {{run}}))
           from menu_items mi where mi.id = {{item}}`,
      ),
      // Launched: the release's lock is gone.
      T('own_price3', 'owner', `select to_jsonb(app.upsert_variant({{item}}::uuid, 'Petite', 'صغير', 6000, {{v1}}::uuid, true, 0))`),
      OUTBOX_Q('pushes'),
      Q(
        'audit',
        `select jsonb_agg(distinct action) from audit_log
          where at = now() and action in ('protocol.release.accept', 'stock.product_test', 'protocol.release.launch')`,
      ),
      // A count after the tests: the difference is explained as product tests.
      KEEP(
        'count',
        `insert into stock_counts (finalized_at, counted_by, venue_id)
         values (now(), {{manager}}::uuid, {{venue}}::uuid) returning id::text`,
      ),
      X(`insert into stock_count_lines (count_id, ingredient_id, theoretical_qty, counted_qty)
         values ({{count}}::uuid, {{milk}}::uuid, 9400, 9400)`),
      Q('variance', `select to_jsonb(v) from v_variance_report v where v.count_id = {{count}}::uuid and v.ingredient_id = {{milk}}::uuid`),
      T(
        'report',
        'manager',
        `select (select e from jsonb_array_elements(app.report_stock(current_date - 1, current_date + 1,
                   jsonb_build_object('ingredientId', {{milk}}))->'variance') e
                 where e->>'countId' = {{count}})`,
      ),
    ]);

    const started = ok<{ status: string; auto: boolean }>(r, 'start');
    expect(started).toMatchObject({ status: 'active', auto: false });
    expect(refused(r, 'accept_nocat')).toBe('RECORD_INVALID:category_id');
    ok(r, 'accept');
    const draft = ok<{
      active: boolean;
      launched_at: string | null;
      category: string;
      name_en: string;
      name_ar: string;
      sizes: Array<{ en: string; ar: string; price: number; default: boolean }>;
      recipe: number;
    }>(r, 'draft');
    expect(draft).toMatchObject({ active: false, launched_at: null, name_en: 'Rose latte', name_ar: 'Rose latte', recipe: 4 });
    expect(draft.sizes).toEqual([
      { en: 'Small', ar: 'Small', price: 0, default: true },
      { en: 'Large', ar: 'كبير', price: 0, default: false },
    ]);

    expect(refused(r, 'mgr_price')).toBe('ITEM_IN_RELEASE');
    expect(refused(r, 'own_price')).toBe('ITEM_IN_RELEASE');
    expect(refused(r, 'own_size')).toBe('ITEM_IN_RELEASE');
    ok(r, 'mgr_rename');
    expect(refused(r, 'own_on')).toBe('ITEM_IN_RELEASE');
    expect(refused(r, 'mgr_on')).toBe('ITEM_IN_RELEASE');

    const ctx = ok<{ sizes: Array<{ lines: Array<Record<string, unknown>> }> }>(r, 'ctx_hc');
    expect(ctx.sizes).toHaveLength(2);
    expect(ctx.sizes[0]!.lines.map((l) => Object.keys(l).sort())).toEqual([
      ['ingredient_id', 'name_ar', 'name_en', 'qty', 'unit'],
      ['ingredient_id', 'name_ar', 'name_en', 'qty', 'unit'],
    ]);
    expect(refused(r, 'ctx_hb')).toBe('NOT_STEP_ACTOR');
    expect(refused(r, 'ctx_chef')).toBe('PROTOCOL_NOT_FOUND');

    ok(r, 'test1');
    ok(r, 'back');
    ok(r, 'prop2');
    ok(r, 'accept2');
    const rebuilt = ok<{ item: string; sizes: Array<{ id: string; en: string; ar: string }>; recipe: number }>(r, 'rebuilt');
    // The same draft, rebuilt in place: its first size kept, the other gone.
    expect(rebuilt.item).toBe(psqlVar(r, 'item'));
    expect(rebuilt.sizes).toEqual([{ id: psqlVar(r, 'v1'), en: 'عادي', ar: 'عادي' }]);
    expect(rebuilt.recipe).toBe(2);

    ok(r, 'test2');
    // Round 1: 2 × 200 g milk, 2 × 10 ml / 50 % rose; round 2: one more serving.
    // Both rounds stay: the stock was used.
    expect(ok<Record<string, unknown>>(r, 'consumed')).toEqual({
      milk: 600,
      rose: 60,
      types: ['product_test'],
      staff: [expect.any(String)],
    });
    ok(r, 'test_ok');

    const before = ok<{ ready: boolean; checks: Array<{ key: string; ok: boolean }> }>(r, 'ready_before');
    expect(before.ready).toBe(false);
    expect(before.checks.filter((c) => !c.ok).map((c) => c.key)).toEqual(['prices']);
    const cost = ok<{ sizes: Array<{ cost_iqd: number; cost_known: boolean }>; unknown_lines: string[] }>(r, 'cost');
    expect(cost.unknown_lines).toEqual(['Edible petals']);
    expect(cost.sizes).toEqual([expect.objectContaining({ cost_iqd: 400, cost_known: false })]);

    expect(ok<{ auto: boolean }>(r, 'price').auto).toBe(false);
    expect(refused(r, 'price_ok_mgr')).toBe('NOT_DECIDER');
    ok(r, 'price_ok');
    expect(ok(r, 'priced')).toEqual({ name_en: 'Rose Latte', name_ar: 'لاتيه الورد', active: false, price: 4500 });
    expect(refused(r, 'own_price2')).toBe('ITEM_IN_RELEASE');
    ok(r, 'mkt');
    ok(r, 'mkt_ok');
    expect(ok<{ ready: boolean }>(r, 'ready').ready).toBe(true);

    expect(refused(r, 'l_mgr')).toBe('NOT_STEP_ACTOR');
    expect(refused(r, 'l_nomenu')).toBe('RECORD_INVALID:menu_photo_path');
    expect(refused(r, 'l_foreign')).toBe('RECORD_INVALID:menu_photo_path');
    expect(refused(r, 'l_photo')).toBe('RECORD_INVALID:photo_path');
    expect(refused(r, 'l_far')).toBe('RECORD_INVALID:at');
    expect(refused(r, 'l_nocopy')).toBe('RECORD_INVALID:menu_photo_path');
    expect(ok<{ auto: boolean; run_status: string }>(r, 'launch_now')).toMatchObject({ auto: true, run_status: 'live' });
    const launched = ok<{ active: boolean; launched: boolean; photo: string; run: { status: string; live: boolean } }>(r, 'launched');
    expect(launched).toMatchObject({ active: true, launched: true, run: { status: 'live', live: true } });
    expect(launched.photo).toMatch(/^items\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
    ok(r, 'own_price3');

    const pushes = ok<Push[]>(r, 'pushes');
    expect(pushesOf(pushes, 'run_live').map((p) => p.to)).toEqual([psqlVar(r, 'hc')]);
    expect(ok<string[]>(r, 'audit').sort()).toEqual(['protocol.release.accept', 'protocol.release.launch', 'stock.product_test']);

    expect(ok<{ product_test_qty: number; sold_qty: number }>(r, 'variance')).toMatchObject({ product_test_qty: 600, sold_qty: 0 });
    expect(ok<{ productTestQty: number }>(r, 'report')).toMatchObject({ productTestQty: 600 });
  });

  it('passes a manager’s proposal at once, and keeps a manager from putting new items on sale', () => {
    const r = scenario([
      ...SETUP,
      T('mgr_nocat', 'manager', start(proposal(ONE_SIZE))),
      T('mgr_start', 'manager', start(proposal(ONE_SIZE, `, 'category_id', {{cat}}`))),
      RES('mrun', 'mgr_start', 'run_id'),
      Q(
        'mrun_state',
        `select jsonb_build_object(
           'propose', (select status from protocol_run_steps where run_id = {{mrun}} and step_key = 'propose'),
           'test', (select jsonb_build_object('status', status, 'assigned', assigned_to) from protocol_run_steps
                     where run_id = {{mrun}} and step_key = 'test'),
           'draft', (select jsonb_build_object('active', is_active, 'category', category_id) from menu_items
                      where id = (select menu_item_id from protocol_runs where id = {{mrun}})))`,
      ),
      // A head's proposal may carry a category; it may not carry a bad one.
      T('hc_badcat', 'hc', start(proposal(ONE_SIZE, `, 'category_id', {{shopcat}}`))),
      T('hc_badline', 'hc', start(`jsonb_set(${proposal(ONE_SIZE)}, '{lines,0,unit}', '"ml"')`)),
      T('hc_link', 'hc', start(`jsonb_set(${proposal(ONE_SIZE)}, '{link}', '"http://example.com"')`)),
      T('hc_noname', 'hc', start(`(${proposal(ONE_SIZE)}) - 'name_en'`)),
      // The owner creates and switches on directly; launched_at follows.
      T('own_new', 'owner', `select to_jsonb(app.upsert_menu_item({{cat}}::uuid, 'Owner tea', 'شاي', null, null, null, 0, true))`),
      RES('own_item', 'own_new', ''),
      T('own_draft', 'owner', `select to_jsonb(app.upsert_menu_item({{cat}}::uuid, 'Owner draft', 'مسودة', null, null, null, 0, false))`),
      RES('own_draft_id', 'own_draft', ''),
      Q(
        'stamps',
        `select jsonb_build_object(
           'on', (select launched_at is not null from menu_items where id = {{own_item}}),
           'draft', (select launched_at is not null from menu_items where id = {{own_draft_id}}))`,
      ),
      // The manager: no new cafe item, hidden or on.
      T('mgr_new_on', 'manager', `select to_jsonb(app.upsert_menu_item({{cat}}::uuid, 'M tea', 'شاي', null, null, null, 0, true))`),
      T('mgr_new_off', 'manager', `select to_jsonb(app.upsert_menu_item({{cat}}::uuid, 'M tea', 'شاي', null, null, null, 0, false))`),
      // The owner's hidden draft: a manager may rename it, not switch it on.
      T('mgr_draft_rename', 'manager', `select to_jsonb(app.upsert_menu_item({{cat}}::uuid, 'Owner draft 2', 'مسودة', {{own_draft_id}}::uuid, null, null, 0, false))`),
      T('mgr_draft_on', 'manager', `select to_jsonb(app.upsert_menu_item({{cat}}::uuid, 'Owner draft 2', 'مسودة', {{own_draft_id}}::uuid, null, null, 0, true))`),
      // A hidden shop draft of the owner: moved into a cafe category, refused.
      T('own_shop_draft', 'owner', `select to_jsonb(app.upsert_menu_item({{shopcat}}::uuid, 'Beans 1kg', 'بن', null, null, null, 0, false))`),
      RES('shop_draft', 'own_shop_draft', ''),
      T('mgr_move', 'manager', `select to_jsonb(app.upsert_menu_item({{cat}}::uuid, 'Beans 1kg', 'بن', {{shop_draft}}::uuid, null, null, 0, false))`),
      // A manager's shop product: hidden passes, on is LAUNCH_VIA_PROTOCOL.
      T('mgr_shop_on', 'manager', `select to_jsonb(app.upsert_menu_item({{shopcat}}::uuid, 'Cup', 'كوب', null, null, null, 0, true))`),
      T('mgr_shop_off', 'manager', `select to_jsonb(app.upsert_menu_item({{shopcat}}::uuid, 'Cup', 'كوب', null, null, null, 0, false))`),
      RES('mgr_shop', 'mgr_shop_off', ''),
      Q('mgr_shop_stamp', `select to_jsonb(launched_at is null) from menu_items where id = {{mgr_shop}}`),
      T('mgr_shop_later', 'manager', `select to_jsonb(app.upsert_menu_item({{shopcat}}::uuid, 'Cup', 'كوب', {{mgr_shop}}::uuid, null, null, 0, true))`),
      // The accepted limit (#59): an item that existed before the migration,
      // switched off today, is renamed and switched back on by a manager.
      KEEP(
        'old_item',
        `insert into menu_items (category_id, name_en, name_ar, is_active, venue_id, launched_at)
         values ({{cat}}::uuid, 'Old tea', 'شاي قديم', false, {{venue}}::uuid, now() - interval '1 year')
         returning id::text`,
      ),
      T('mgr_old_on', 'manager', `select to_jsonb(app.upsert_menu_item({{cat}}::uuid, 'New tea', 'شاي جديد', {{old_item}}::uuid, null, null, 0, true))`),
      // A seeded item written around the RPCs (on, no stamp) is on sale, so
      // it is not a draft: a manager edits it as before.
      KEEP(
        'seed_item',
        `insert into menu_items (category_id, name_en, name_ar, is_active, venue_id)
         values ({{cat}}::uuid, 'Seeded', 'مزروع', true, {{venue}}::uuid) returning id::text`,
      ),
      T('mgr_seed_edit', 'manager', `select to_jsonb(app.upsert_menu_item({{cat}}::uuid, 'Seeded 2', 'مزروع', {{seed_item}}::uuid, null, null, 0, true))`),
      // The manager's release draft stays a cafe item: hidden in a shop
      // category it would reach the menu through a shop_launch, past the
      // owner's Launch. A rename in its own category passes.
      KEEP('mdraft', `select menu_item_id::text from protocol_runs where id = {{mrun}}`),
      T('mgr_draft_to_shop', 'manager', `select to_jsonb(app.upsert_menu_item({{shopcat}}::uuid, 'Rose', 'ورد', {{mdraft}}::uuid, null, null, 0, false))`),
      T('own_draft_to_shop', 'owner', `select to_jsonb(app.upsert_menu_item({{shopcat}}::uuid, 'Rose', 'ورد', {{mdraft}}::uuid, null, null, 0, false))`),
      T('mgr_draft_name', 'manager', `select to_jsonb(app.upsert_menu_item({{cat}}::uuid, 'Rose', 'ورد', {{mdraft}}::uuid, null, null, 0, false))`),
      // A shop product that is on sale (launched by a shop_launch, or before
      // the migration) moved into a cafe category is a new menu item there.
      KEEP(
        'sold_product',
        `insert into menu_items (category_id, name_en, name_ar, is_active, venue_id, launched_at)
         values ({{shopcat}}::uuid, 'Iced matcha', 'ماتشا', true, {{venue}}::uuid, now() - interval '1 day')
         returning id::text`,
      ),
      T('mgr_product_to_cafe', 'manager', `select to_jsonb(app.upsert_menu_item({{cat}}::uuid, 'Iced matcha', 'ماتشا', {{sold_product}}::uuid, null, null, 0, true))`),
      T('mgr_product_to_cafe_off', 'manager', `select to_jsonb(app.upsert_menu_item({{cat}}::uuid, 'Iced matcha', 'ماتشا', {{sold_product}}::uuid, null, null, 0, false))`),
      T('mgr_product_edit', 'manager', `select to_jsonb(app.upsert_menu_item({{shopcat}}::uuid, 'Iced matcha 2', 'ماتشا', {{sold_product}}::uuid, null, null, 0, true))`),
      T('own_product_to_cafe', 'owner', `select to_jsonb(app.upsert_menu_item({{cat}}::uuid, 'Iced matcha', 'ماتشا', {{sold_product}}::uuid, null, null, 0, true))`),
    ]);

    expect(refused(r, 'mgr_nocat')).toBe('RECORD_INVALID:category_id');
    expect(ok<{ auto: boolean; status: string }>(r, 'mgr_start')).toMatchObject({ auto: true, status: 'active' });
    const state = ok<{ propose: string; test: { status: string; assigned: string }; draft: { active: boolean; category: string } }>(
      r,
      'mrun_state',
    );
    expect(state.propose).toBe('passed');
    expect(state.test).toEqual({ status: 'open', assigned: SEED_STAFF_IDS.manager });
    expect(state.draft.active).toBe(false);

    expect(refused(r, 'hc_badcat')).toBe('RECORD_INVALID:category_id');
    expect(refused(r, 'hc_badline')).toBe('RECORD_INVALID:lines');
    expect(refused(r, 'hc_link')).toBe('RECORD_INVALID:link');
    expect(refused(r, 'hc_noname')).toBe('RECORD_INVALID:name_en');

    ok(r, 'own_new');
    ok(r, 'own_draft');
    expect(ok(r, 'stamps')).toEqual({ on: true, draft: false });
    expect(refused(r, 'mgr_new_on')).toBe('ITEM_VIA_RELEASE');
    expect(refused(r, 'mgr_new_off')).toBe('ITEM_VIA_RELEASE');
    ok(r, 'mgr_draft_rename');
    expect(refused(r, 'mgr_draft_on')).toBe('ITEM_VIA_RELEASE');
    ok(r, 'own_shop_draft');
    expect(refused(r, 'mgr_move')).toBe('ITEM_VIA_RELEASE');
    expect(refused(r, 'mgr_shop_on')).toBe('LAUNCH_VIA_PROTOCOL');
    ok(r, 'mgr_shop_off');
    expect(ok(r, 'mgr_shop_stamp')).toBe(true);
    expect(refused(r, 'mgr_shop_later')).toBe('LAUNCH_VIA_PROTOCOL');
    ok(r, 'mgr_old_on');
    ok(r, 'mgr_seed_edit');
    expect(refused(r, 'mgr_draft_to_shop')).toBe('ITEM_IN_RELEASE');
    expect(refused(r, 'own_draft_to_shop')).toBe('ITEM_IN_RELEASE');
    ok(r, 'mgr_draft_name');
    expect(refused(r, 'mgr_product_to_cafe')).toBe('ITEM_VIA_RELEASE');
    expect(refused(r, 'mgr_product_to_cafe_off')).toBe('ITEM_VIA_RELEASE');
    ok(r, 'mgr_product_edit');
    ok(r, 'own_product_to_cafe');
  });

  it('deletes the draft of a release stopped at the test', () => {
    const r = scenario([
      ...SETUP,
      T('start', 'hc', start(proposal(TWO_SIZES))),
      RES('run', 'start', 'run_id'),
      RES('sub1', 'start', 'submission_id'),
      T('accept', 'manager', `select app.decide_step({{sub1}}::uuid, 'approve', null, null, jsonb_build_object('category_id', {{cat}}))`),
      KEEP('item', `select menu_item_id::text from protocol_runs where id = {{run}}`),
      T('stop', 'manager', `select app.stop_protocol({{run}}::uuid, 'Not this season')`),
      Q(
        'after',
        `select jsonb_build_object(
           'item', (select count(*) from menu_items where id = {{item}}::uuid),
           'sizes', (select count(*) from menu_item_variants where item_id = {{item}}::uuid),
           'run', (select jsonb_build_object('status', status, 'item', menu_item_id) from protocol_runs where id = {{run}}))`,
      ),
    ]);
    ok(r, 'accept');
    ok(r, 'stop');
    expect(ok(r, 'after')).toEqual({ item: 0, sizes: 0, run: { status: 'stopped', item: null } });
  });

  it('sends ideas to their team’s head, who starts a release from one or declines it', () => {
    const idea = (name: string, extra = '') =>
      `jsonb_build_object('name_en', '${name}', 'item_kind', 'dessert',
         'lines', jsonb_build_array(jsonb_build_object('label', 'Cream', 'qty', 30, 'unit', 'g')),
         'sizes', jsonb_build_array(jsonb_build_object('name_en', 'Slice'))${extra})`;
    const r = scenario([
      ...SETUP,
      PHOTO('p_idea', 'ba', 'proposals'),
      T('ba_idea', 'ba', `select app.submit_release_idea(${idea('Rose cake')}, array[{{p_idea}}], {{venue}}::uuid, null)`),
      RES('idea_ba', 'ba_idea', 'id'),
      T('chef_idea', 'chef', `select app.submit_release_idea(${idea('Tahini tart')}, '{}'::text[], {{venue}}::uuid, null)`),
      RES('idea_chef', 'chef_idea', 'id'),
      T('ba_cat', 'ba', `select app.submit_release_idea(${idea('X', `, 'category_id', {{cat}}`)}, '{}'::text[], {{venue}}::uuid, null)`),
      ...['hb', 'hc', 'cashier', 'desk', 'drv', 'mkt'].map((who) =>
        T(`submit_${who}`, who, `select app.submit_release_idea(${idea('Nope')}, '{}'::text[], {{venue}}::uuid, null)`),
      ),
      OUTBOX_Q('pushes_submit'),
      T('review_hb', 'hb', `select app.release_ideas_to_review({{venue}}::uuid)`),
      T('review_hc', 'hc', `select app.release_ideas_to_review({{venue}}::uuid)`),
      T('review_mgr', 'manager', `select app.release_ideas_to_review({{venue}}::uuid)`),
      T('review_drv', 'drv', `select app.release_ideas_to_review({{venue}}::uuid)`),
      T('review_mkt', 'mkt', `select app.release_ideas_to_review({{venue}}::uuid)`),
      T('mine_drv', 'drv', `select app.my_release_ideas({{venue}}::uuid)`),
      T('mine_mkt', 'mkt', `select app.my_release_ideas({{venue}}::uuid)`),
      // Who reads the idea's photo while it waits.
      ...['ba', 'hb', 'manager', 'owner', 'hc', 'ba2', 'drv', 'mkt'].map((who) =>
        T(`see_${who}`, who, `select to_jsonb(app.staff_media_visible({{p_idea}}))`),
      ),
      // The other team's head may not start it; a failing proposal rolls the
      // start back and the idea keeps waiting.
      T('hc_start', 'hc', start(idea('Rose cake'), `jsonb_build_object('idea_id', {{idea_ba}})`, `array[{{p_idea}}]`)),
      T(
        'hb_bad',
        'hb',
        start(`(${idea('Rose cake')}) - 'item_kind'`, `jsonb_build_object('idea_id', {{idea_ba}})`, `array[{{p_idea}}]`),
      ),
      Q('after_bad', `select to_jsonb(status) from release_ideas where id = {{idea_ba}}::uuid`),
      T('hb_extra', 'hb', start(idea('Rose cake'), `jsonb_build_object('idea_id', {{idea_ba}}, 'x', 1)`)),
      T('hb_start', 'hb', start(idea('Rose cake'), `jsonb_build_object('idea_id', {{idea_ba}})`, `array[{{p_idea}}]`)),
      RES('run', 'hb_start', 'run_id'),
      T('hb_again', 'hb', start(idea('Rose cake'), `jsonb_build_object('idea_id', {{idea_ba}})`)),
      Q(
        'started',
        `select jsonb_build_object(
           'idea', (select jsonb_build_object('status', status, 'run', run_id, 'by', decided_by) from release_ideas where id = {{idea_ba}}::uuid),
           'run_data', (select data from protocol_runs where id = {{run}}::uuid),
           'photos', (select to_jsonb(x.photos) from protocol_submissions x where x.run_id = {{run}}::uuid),
           'used_by', (select used_by from staff_media_uploads where path = {{p_idea}}))`,
      ),
      T('mine_ba', 'ba', `select app.my_release_ideas({{venue}}::uuid)`),
      // Decline: a reason is required, the other team's head is refused.
      T('dec_noreason', 'hc', `select app.decline_release_idea({{idea_chef}}::uuid, '  ')`),
      T('dec_hb', 'hb', `select app.decline_release_idea({{idea_chef}}::uuid, 'Not ours')`),
      T('dec_hc', 'hc', `select app.decline_release_idea({{idea_chef}}::uuid, 'Too close to the baklava')`),
      T('dec_again', 'hc', `select app.decline_release_idea({{idea_chef}}::uuid, 'Again')`),
      T('mine_chef', 'chef', `select app.my_release_ideas({{venue}}::uuid)`),
      // Withdraw: the author only, while it waits.
      T('ba_idea2', 'ba', `select app.submit_release_idea(${idea('Mint tea')}, '{}'::text[], {{venue}}::uuid, null)`),
      RES('idea2', 'ba_idea2', 'id'),
      T('wd_other', 'ba2', `select app.withdraw_release_idea({{idea2}}::uuid)`),
      T('wd', 'ba', `select app.withdraw_release_idea({{idea2}}::uuid)`),
      T('wd_again', 'ba', `select app.withdraw_release_idea({{idea2}}::uuid)`),
      OUTBOX_Q('pushes'),
      // The table itself: MGMT only.
      T('tbl_drv', 'drv', `select to_jsonb(count(*)) from release_ideas`),
      T('tbl_mkt', 'mkt', `select to_jsonb(count(*)) from release_ideas`),
      T('tbl_hb', 'hb', `select to_jsonb(count(*)) from release_ideas`),
      T('tbl_mgr', 'manager', `select to_jsonb(count(*)) from release_ideas where id in ({{idea_ba}}::uuid, {{idea_chef}}::uuid)`),
    ]);
    const id = (name: string) => psqlVar(r, name);

    ok(r, 'ba_idea');
    ok(r, 'chef_idea');
    expect(refused(r, 'ba_cat')).toBe('RECORD_INVALID:category_id');
    for (const who of ['hb', 'hc', 'cashier', 'desk', 'drv', 'mkt']) expect(refused(r, `submit_${who}`)).toBe('FORBIDDEN');

    // Each idea reaches its own team's head, in the push and the list (the
    // stack's dev logins hold the head roles too, so only this scenario's
    // staff are compared).
    const ours = new Set(['hb', 'hc', 'ba', 'ba2', 'chef', 'drv', 'mkt'].map(id));
    const submitted = pushesOf(ok<Push[]>(r, 'pushes_submit'), 'idea_submitted').filter((p) => ours.has(p.to));
    expect(submitted.map((p) => [p.to, p.payload.params.title]).sort()).toEqual(
      [
        [id('hb'), 'Rose cake'],
        [id('hc'), 'Tahini tart'],
      ].sort(),
    );
    type Review = { ideas: Array<{ id: string; team: string; record: Record<string, unknown> }>; count: number };
    expect(ok<Review>(r, 'review_hb').ideas.map((i) => i.team)).toEqual(['bar']);
    expect(ok<Review>(r, 'review_hc').ideas.map((i) => i.team)).toEqual(['kitchen']);
    expect(ok<Review>(r, 'review_mgr').ideas.map((i) => i.id)).toEqual(expect.arrayContaining([id('idea_ba'), id('idea_chef')]));
    for (const label of ['review_drv', 'review_mkt', 'mine_drv', 'mine_mkt']) expect(refused(r, label)).toBe('FORBIDDEN');

    // The idea's photo: its uploader, the team's head and MGMT, nobody else.
    for (const who of ['ba', 'hb', 'manager', 'owner']) expect(ok(r, `see_${who}`), who).toBe(true);
    for (const who of ['hc', 'ba2', 'drv', 'mkt']) expect(ok(r, `see_${who}`), who).toBe(false);

    expect(refused(r, 'hc_start')).toBe('FORBIDDEN');
    expect(refused(r, 'hb_bad')).toBe('RECORD_INVALID:item_kind');
    expect(ok(r, 'after_bad')).toBe('waiting');
    expect(refused(r, 'hb_extra')).toBe('RECORD_INVALID:data');
    ok(r, 'hb_start');
    expect(refused(r, 'hb_again')).toBe('SUBMISSION_DECIDED');
    const started = ok<{ idea: { status: string; run: string; by: string }; run_data: unknown; photos: string[]; used_by: string }>(
      r,
      'started',
    );
    expect(started.idea).toEqual({ status: 'started', run: id('run'), by: id('hb') });
    expect(started.run_data).toEqual({ idea_id: id('idea_ba') });
    expect(started.photos).toEqual([id('p_idea')]);
    expect(started.used_by).toMatch(/^protocol_submission:/);

    // The author follows the run by its status and step names, no record.
    const mine = ok<{ ideas: Array<{ status: string; run: Record<string, unknown> | null }> }>(r, 'mine_ba');
    const followed = mine.ideas.find((i) => i.run)!;
    expect(followed.status).toBe('started');
    expect(Object.keys(followed.run!).sort()).toEqual(['current_steps', 'run_id', 'status', 'title_ar', 'title_en']);
    expect(followed.run!.current_steps).toEqual([{ name_en: 'Proposal', name_ar: 'الاقتراح', status: 'submitted' }]);

    expect(refused(r, 'dec_noreason')).toBe('REASON_REQUIRED');
    expect(refused(r, 'dec_hb')).toBe('FORBIDDEN');
    expect(ok(r, 'dec_hc')).toEqual({ status: 'declined' });
    expect(refused(r, 'dec_again')).toBe('SUBMISSION_DECIDED');
    const chefIdeas = ok<{ ideas: Array<{ status: string; decline_reason: string }> }>(r, 'mine_chef');
    expect(chefIdeas.ideas[0]).toMatchObject({ status: 'declined', decline_reason: 'Too close to the baklava' });

    expect(refused(r, 'wd_other')).toBe('FORBIDDEN');
    expect(ok(r, 'wd')).toEqual({ status: 'withdrawn' });
    expect(refused(r, 'wd_again')).toBe('SUBMISSION_DECIDED');

    const pushes = ok<Push[]>(r, 'pushes');
    expect(pushesOf(pushes, 'idea_started').map((p) => p.to)).toEqual([id('ba')]);
    expect(pushesOf(pushes, 'idea_declined').map((p) => p.to)).toEqual([id('chef')]);

    expect(ok(r, 'tbl_drv')).toBe(0);
    expect(ok(r, 'tbl_mkt')).toBe(0);
    expect(ok(r, 'tbl_hb')).toBe(0);
    expect(ok(r, 'tbl_mgr')).toBe(2);
  });

  it('refuses the driver and marketing every release read and write', () => {
    const r = scenario([
      ...SETUP,
      T('start', 'hc', start(proposal(TWO_SIZES))),
      RES('run', 'start', 'run_id'),
      ...['drv', 'mkt'].flatMap((who) => [
        T(`${who}_start`, who, start(proposal(TWO_SIZES))),
        T(`${who}_ready`, who, `select app.release_readiness({{run}}::uuid)`),
        T(`${who}_cost`, who, `select app.release_cost({{run}}::uuid)`),
        T(`${who}_ctx`, who, `select app.release_test_context({{run}}::uuid)`),
        T(`${who}_detail`, who, `select app.protocol_run_detail({{run}}::uuid)`),
        T(`${who}_menu`, who, `select to_jsonb(app.upsert_menu_item({{cat}}::uuid, 'x', 'x', null, null, null, 0, false))`),
        T(`${who}_variant`, who, `select to_jsonb(app.upsert_variant(gen_random_uuid(), 'x', 'x', 1))`),
      ]),
    ]);
    ok(r, 'start');
    for (const who of ['drv', 'mkt']) {
      expect(refused(r, `${who}_start`)).toBe('FORBIDDEN');
      expect(refused(r, `${who}_ready`)).toBe('FORBIDDEN');
      expect(refused(r, `${who}_cost`)).toBe('FORBIDDEN');
      expect(refused(r, `${who}_menu`)).toBe('FORBIDDEN');
      expect(refused(r, `${who}_variant`)).toBe('FORBIDDEN');
    }
    // Outside the run nobody learns it exists; marketing's own step makes it
    // involved, but not the test's assignee.
    expect(refused(r, 'drv_ctx')).toBe('PROTOCOL_NOT_FOUND');
    expect(refused(r, 'drv_detail')).toBe('PROTOCOL_NOT_FOUND');
    expect(refused(r, 'mkt_ctx')).toBe('NOT_STEP_ACTOR');
  });
});

/** A harness variable's value, read back from the `keep` rows of a scenario (the uuid it minted). */
function psqlVar(r: Results, name: string): string {
  const v = r[`__var_${name}`];
  if (v?.ok && typeof v.data === 'string') return v.data;
  throw new Error(`no variable ${name}`);
}
