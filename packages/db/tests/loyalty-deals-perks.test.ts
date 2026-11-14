/**
 * Deals in the app and tier privileges (20261112000410_loyalty_deals_perks.sql):
 *
 *   * the owner gives a tier privileges (free add-ons on named groups or on every add-on, or a
 *     line the staff honour by hand); loyalty_admin lists them, my_loyalty answers the whole
 *     ladder with what each tier gives;
 *   * a member's free add-ons land on the bill as line discounts (loyalty_perks_refresh), follow
 *     the card (their tier and every tier below), go when the member, the line or the privilege
 *     goes, and never take a part-paid bill below what was paid;
 *   * the owner lists a promotion in the app (set_promotion_app); a guest reads my_deals and
 *     picks one; the picked deal is eligible with no code, sorts first at the till, and the pick
 *     is spent when the bill settles.
 *
 * Each case is one rolled-back psql transaction (stores-harness `scenario`). Without docker the
 * suite skips.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, KEEP, ok, Q, refused, scenario, T, X, type Results } from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

function phone(): string {
  return `+96477${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}

let keySeq = 0;
const KEY = (tag: string) => `'ldp-${tag}-${Date.now().toString(36)}-${(keySeq++).toString(36)}'`;

const PRE = String.raw`
set constraints all immediate;

-- The planted lines name made-up menu items (the add-ons are real rows): those two foreign keys
-- are dropped inside the transaction and come back with the rollback.
do $drop_fk$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
      from pg_constraint c
     where c.contype = 'f' and c.conrelid = 'public.order_items'::regclass
       and c.confrelid in ('public.menu_items'::regclass, 'public.menu_item_variants'::regclass)
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $drop_fk$;

create function pg_temp.var(p_name text) returns text language sql as $f$
  select val from pg_temp.vars where name = p_name
$f$;

create function pg_temp.put(p_name text, p_val text) returns void language sql as $f$
  insert into pg_temp.vars values (p_name, p_val) on conflict (name) do update set val = excluded.val
$f$;

create function pg_temp.guest(p_name text, p_phone text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, raw_user_meta_data, aud, role, phone, phone_confirmed_at)
  values (v, 'ldp-' || p_name || '-' || v || '@test.touch.local', jsonb_build_object('full_name', 'LDP ' || p_name),
          'authenticated', 'authenticated', app.phone_digits(p_phone), now());
  perform pg_temp.put(p_name, v::text);
  return v;
end $f$;

create function pg_temp.pts(p_guest text, p_delta int) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  insert into loyalty_ledger (profile_id, delta, kind, source_kind, source_id, note)
  values (pg_temp.var(p_guest)::uuid, p_delta, 'earn', 'fixture', gen_random_uuid(), 'fixture');
end $f$;

create function pg_temp.day() returns uuid language plpgsql as $f$
declare v uuid;
begin
  select val::uuid into v from pg_temp.vars where name = '_day';
  if v is not null then return v; end if;
  select d.id into v from day_sessions d where d.venue_id = pg_temp.var('venue')::uuid and d.status = 'open'
   order by d.opened_at desc limit 1;
  if v is null then
    insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd)
    values (pg_temp.var('venue')::uuid, date '2001-01-01' + (random() * 3000)::int, 'open',
            pg_temp.var('manager')::uuid, 0)
    returning id into v;
  end if;
  perform pg_temp.put('_day', v::text);
  return v;
end $f$;

-- An open café tab at branch A, with or without a customer.
create function pg_temp.tab(p_name text, p_customer text default null) returns uuid language plpgsql as $f$
declare v uuid; v_day uuid := pg_temp.day();
begin
  perform set_config('request.jwt.claims', '', true);
  insert into tabs (venue_id, day_session_id, kind, status, label, opened_by_staff_id, customer_id)
  values (pg_temp.var('venue')::uuid, v_day, 'cafe', 'open', 'LDP ' || p_name, pg_temp.var('cashier')::uuid,
          case when p_customer is not null then pg_temp.var(p_customer)::uuid end)
  returning id into v;
  perform pg_temp.put(p_name, v::text);
  return v;
end $f$;

-- An add-on group with one add-on at branch A.
create function pg_temp.addon(p_name text, p_price bigint) returns uuid language plpgsql as $f$
declare g uuid; m uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into modifier_groups (name_en, name_ar, min_select, max_select, venue_id)
  values ('LDP ' || p_name, 'إضافة ' || p_name, 0, 3, pg_temp.var('venue')::uuid)
  returning id into g;
  insert into modifiers (group_id, name_en, name_ar, price_delta_iqd, sort_order, is_active)
  values (g, 'LDP ' || p_name, 'إضافة ' || p_name, p_price, 0, true)
  returning id into m;
  perform pg_temp.put(p_name || '_group', g::text);
  perform pg_temp.put(p_name, m::text);
  return m;
end $f$;

-- A line on a tab: p_unit a unit, p_qty of them, with add-ons given as 'name:qty,name:qty'. The
-- line total is (unit + add-ons) * qty, as app.add_order_items prices it.
create function pg_temp.line(p_name text, p_tab text, p_unit bigint, p_qty int, p_addons text default '')
returns uuid language plpgsql as $f$
declare o uuid; v uuid; v_mods bigint := 0; a text; v_mod uuid; v_mqty int; v_price bigint;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into orders (tab_id, source, placed_by_staff_id, venue_id)
  values (pg_temp.var(p_tab)::uuid, 'till', pg_temp.var('cashier')::uuid, pg_temp.var('venue')::uuid)
  returning id into o;
  insert into order_items (order_id, menu_item_id, variant_id, qty, unit_price_iqd, line_total_iqd)
  values (o, gen_random_uuid(), gen_random_uuid(), p_qty, p_unit, 0)
  returning id into v;
  foreach a in array coalesce(string_to_array(nullif(p_addons, ''), ','), '{}'::text[]) loop
    v_mod := pg_temp.var(split_part(a, ':', 1))::uuid;
    v_mqty := split_part(a, ':', 2)::int;
    select m.price_delta_iqd into v_price from modifiers m where m.id = v_mod;
    insert into order_item_modifiers (order_item_id, modifier_id, qty, price_delta_iqd)
    values (v, v_mod, v_mqty, v_price);
    v_mods := v_mods + v_price * v_mqty;
  end loop;
  update order_items set line_total_iqd = (p_unit + v_mods) * p_qty where id = v;
  perform pg_temp.put(p_name, v::text);
  return v;
end $f$;

create function pg_temp.pay(p_tab text, p_amount bigint) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  insert into payments (tab_id, day_session_id, method, amount_iqd, recorded_by, venue_id)
  select t.id, t.day_session_id, 'cash', p_amount, pg_temp.var('cashier')::uuid, t.venue_id
    from tabs t where t.id = pg_temp.var(p_tab)::uuid;
end $f$;

create function pg_temp.settle(p_tab text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  update tabs set status = 'settled', settled_at = clock_timestamp() where id = pg_temp.var(p_tab)::uuid;
end $f$;

-- A promotion planted as the manager's (the editor's writer is covered by promotions.test.ts).
create function pg_temp.promo(p_name text, p_value int, p_auto boolean, p_limits jsonb default '{}'::jsonb,
                              p_scope jsonb default '{}'::jsonb)
returns uuid language plpgsql as $f$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into promotions (name_en, name_ar, type, value, auto, enabled, limits, scope, created_by, venue_id)
  values ('LDP ' || p_name, 'عرض ' || p_name, 'percent', p_value, p_auto, true, p_limits, p_scope,
          pg_temp.var('manager')::uuid, null)
  returning id into v;
  perform pg_temp.put(p_name, v::text);
  return v;
end $f$;

-- Nothing another suite left listed or automatic gets in the way (rolled back with the rest).
update promotions set enabled = false where enabled;
update loyalty_settings set enabled = true where id;
`;

const GUEST = (name: string) => `select pg_temp.guest('${name}', '${phone()}');`;
const PTS = (guest: string, delta: number) => X(`select pg_temp.pts('${guest}', ${delta})`);
const TAB = (name: string, customer?: string) =>
  X(`select pg_temp.tab('${name}', ${customer ? `'${customer}'` : 'null'})`);
const ADDON = (name: string, price: number) => X(`select pg_temp.addon('${name}', ${price})`);
const LINE = (name: string, tab: string, unit: number, qty: number, addons = '') =>
  X(`select pg_temp.line('${name}', '${tab}', ${unit}, ${qty}, '${addons}')`);
const PAY = (tab: string, amount: number) => X(`select pg_temp.pay('${tab}', ${amount})`);
const SETTLE = (tab: string) => X(`select pg_temp.settle('${tab}')`);
const PROMO = (name: string, value: number, auto: boolean, limits = '{}', scope = '{}') =>
  X(`select pg_temp.promo('${name}', ${value}, ${auto}, '${limits}'::jsonb, '${scope}'::jsonb)`);
const TIER = (label: string, body: string) =>
  T(label, 'owner', `select app.upsert_loyalty_tier('${body}'::jsonb)`);
const TIER_ID = (name: string, tier: string) =>
  KEEP(name, `select id::text from loyalty_tiers where name_en = '${tier}'`);
const PERK = (label: string, who: string, body: string) =>
  T(label, who, `select app.upsert_loyalty_tier_perk(${body})`);
const TOTALS = (label: string, tab: string) =>
  Q(
    label,
    `select jsonb_build_object('subtotal', t.subtotal_iqd, 'discount', t.discount_iqd, 'total', t.total_iqd)
       from app.compute_tab_totals({{${tab}}}::uuid) t`,
  );
/** The free add-on rows of a tab as [{line, amount, by, auth}], by amount. */
const PERK_ROWS = (label: string, tab: string) =>
  Q(
    label,
    `select coalesce(jsonb_agg(jsonb_build_object('line', a.order_item_id, 'amount', a.amount_iqd, 'kind', a.kind,
                                                  'by', a.applied_by, 'auth', a.authorized_by)
                               order by a.amount_iqd, a.order_item_id), '[]'::jsonb)
       from tab_adjustments a where a.tab_id = {{${tab}}}::uuid and a.reason_code = 'loyalty_tier_perk'`,
  );

function run(tag: string, body: string[]): Results {
  return scenario(tag, [PRE, ...body]);
}

const GOLD = '{"name_en":"LDP Gold","name_ar":"ذهبي","min_points_12m":100,"sort":1,"color":"gold"}';
const BLACK = '{"name_en":"LDP Black","name_ar":"أسود","min_points_12m":500,"sort":2,"color":"black"}';

interface Benefits {
  customer_id: string | null;
  enabled: boolean;
  tier: { name_en: string; min_points_12m: number } | null;
  perks: Array<{ kind: string; name_en: string; tier_name_en: string }>;
  addons: { on_bill_iqd: number; due_iqd: number; needs_refresh: boolean };
  deal: { promotion_id: string; name_en: string; applied: boolean } | null;
}
interface Deal {
  id: string;
  name_en: string;
  blurb_en: string | null;
  type: string;
  value: number;
  state: 'open' | 'locked' | 'used';
  picked: boolean;
  used: number;
  per_customer: number | null;
  tier: { name_en: string } | null;
  on: { items: unknown[]; categories: unknown[]; courts: boolean };
}
interface MyDeals {
  picked_id: string | null;
  picked_until: string | null;
  deals: Deal[];
}

describe.skipIf(!docker)('tier privileges (0410)', () => {
  it('the owner writes them, the admin and the guest read them, and a card holds the tiers below', () => {
    const r = run('ldp-perks', [
      GUEST('g1'),
      ADDON('milk', 1000),
      TIER('gold', GOLD),
      TIER('black', BLACK),
      TIER_ID('gold_id', 'LDP Gold'),
      TIER_ID('black_id', 'LDP Black'),
      PERK(
        'milk_perk',
        'owner',
        `jsonb_build_object('tier_id', {{gold_id}}, 'kind', 'free_addons', 'name_en', 'Free milk swaps',
                            'name_ar', 'تبديل الحليب مجانًا', 'modifier_group_ids', jsonb_build_array({{milk_group}}))`,
      ),
      PERK(
        'custom_perk',
        'owner',
        `jsonb_build_object('tier_id', {{black_id}}, 'kind', 'custom', 'name_en', 'Priority booking',
                            'name_ar', 'أولوية الحجز', 'modifier_group_ids', jsonb_build_array({{milk_group}}))`,
      ),
      PERK(
        'all_perk',
        'owner',
        `jsonb_build_object('tier_id', {{black_id}}, 'kind', 'free_addons', 'name_en', 'Every add-on free',
                            'name_ar', 'كل الإضافات مجانًا')`,
      ),
      PERK(
        'mgr',
        'manager',
        `jsonb_build_object('tier_id', {{gold_id}}, 'kind', 'custom', 'name_en', 'x', 'name_ar', 'x')`,
      ),
      PERK('null', 'owner', `null`),
      PERK(
        'no_tier',
        'owner',
        `jsonb_build_object('tier_id', gen_random_uuid(), 'kind', 'custom', 'name_en', 'x', 'name_ar', 'x')`,
      ),
      PERK(
        'bad_group',
        'owner',
        `jsonb_build_object('tier_id', {{gold_id}}, 'kind', 'free_addons', 'name_en', 'x', 'name_ar', 'x',
                            'modifier_group_ids', jsonb_build_array(gen_random_uuid()))`,
      ),
      PERK(
        'bad_kind',
        'owner',
        `jsonb_build_object('tier_id', {{gold_id}}, 'kind', 'cashback', 'name_en', 'x', 'name_ar', 'x')`,
      ),
      PERK('no_name', 'owner', `jsonb_build_object('tier_id', {{gold_id}}, 'kind', 'custom', 'name_en', 'x')`),
      T('admin', 'manager', `select app.loyalty_admin()`),
      T('admin_cashier', 'cashier', `select app.loyalty_admin()`),
      PTS('g1', 150),
      T('mine', 'g1', `select app.my_loyalty()`),
      // switched off: the guest no longer reads it, the owner still does
      KEEP('milk_perk_id', `select id::text from loyalty_tier_perks where name_en = 'Free milk swaps'`),
      PERK('off', 'owner', `jsonb_build_object('id', {{milk_perk_id}}, 'active', false)`),
      T('mine_off', 'g1', `select app.my_loyalty()`),
      T('admin_off', 'owner', `select app.loyalty_admin()`),
      T('del_mgr', 'manager', `select to_jsonb(1) from (select app.delete_loyalty_tier_perk({{milk_perk_id}})) z`),
      T('del', 'owner', `select to_jsonb(1) from (select app.delete_loyalty_tier_perk({{milk_perk_id}})) z`),
      T('del_again', 'owner', `select to_jsonb(1) from (select app.delete_loyalty_tier_perk({{milk_perk_id}})) z`),
      Q('audit', `select to_jsonb(count(*)) from audit_log where action in ('loyalty.perk', 'loyalty.perk_delete')
                    and entity = 'loyalty_tier_perks'`),
    ]);
    expect(ok(r, 'milk_perk')).toMatchObject({ kind: 'free_addons', name_en: 'Free milk swaps', active: true, sort: 0 });
    expect(ok<{ modifier_group_ids: string[] }>(r, 'milk_perk').modifier_group_ids).toHaveLength(1);
    // a custom privilege frees nothing: the groups sent with it are dropped
    expect(ok(r, 'custom_perk')).toMatchObject({ kind: 'custom', modifier_group_ids: [], sort: 0 });
    expect(ok(r, 'all_perk')).toMatchObject({ kind: 'free_addons', modifier_group_ids: [], sort: 1 });
    expect(refused(r, 'mgr')).toBe('FORBIDDEN');
    expect(refused(r, 'null')).toBe('INVALID_ARGUMENT');
    expect(refused(r, 'no_tier')).toBe('INVALID_ARGUMENT');
    expect(refused(r, 'bad_group')).toBe('INVALID_ARGUMENT');
    expect(refused(r, 'bad_kind')).toBe('INVALID_VALUE');
    expect(refused(r, 'no_name')).toBe('INVALID_VALUE');

    type AdminTier = { name_en: string; perks: Array<{ name_en: string; kind: string; active: boolean }> };
    const admin = ok<{ tiers: AdminTier[] }>(r, 'admin');
    const tierOf = (a: { tiers: AdminTier[] }, name: string) => a.tiers.find((t) => t.name_en === name);
    expect(tierOf(admin, 'LDP Gold')?.perks.map((p) => p.name_en)).toEqual(['Free milk swaps']);
    expect(tierOf(admin, 'LDP Black')?.perks.map((p) => p.name_en)).toEqual(['Priority booking', 'Every add-on free']);
    expect(admin.tiers.find((t) => !t.name_en.startsWith('LDP '))?.perks).toEqual([]);
    expect(refused(r, 'admin_cashier')).toBe('FORBIDDEN');

    type Ladder = Array<{ name_en: string; min_points_12m: number; perks: Array<{ kind: string; name_en: string }>; deals: unknown[] }>;
    const mine = ok<{ tier: { name_en: string; min_points_12m: number }; next_tier: { name_en: string }; tiers: Ladder }>(r, 'mine');
    expect(mine.tier).toMatchObject({ name_en: 'LDP Gold', min_points_12m: 100 });
    expect(mine.next_tier).toMatchObject({ name_en: 'LDP Black' });
    const ladder = mine.tiers.filter((t) => t.name_en.startsWith('LDP ') || t.min_points_12m === 0);
    expect(ladder.map((t) => t.min_points_12m)).toEqual([0, 100, 500]);
    expect(ladder[1]?.perks).toEqual([expect.objectContaining({ kind: 'free_addons', name_en: 'Free milk swaps' })]);
    expect(ladder[2]?.perks.map((p) => p.kind)).toEqual(['custom', 'free_addons']);
    // a guest reads the names only, never the owner's fields
    expect(Object.keys(ladder[1]?.perks[0] ?? {}).sort()).toEqual(['id', 'kind', 'name_ar', 'name_en']);

    expect(ok(r, 'off')).toMatchObject({ active: false, name_en: 'Free milk swaps', kind: 'free_addons' });
    expect(ok<{ tiers: Ladder }>(r, 'mine_off').tiers.find((t) => t.name_en === 'LDP Gold')?.perks).toEqual([]);
    expect(tierOf(ok<{ tiers: AdminTier[] }>(r, 'admin_off'), 'LDP Gold')?.perks).toEqual([
      expect.objectContaining({ name_en: 'Free milk swaps', active: false }),
    ]);
    expect(refused(r, 'del_mgr')).toBe('FORBIDDEN');
    expect(ok(r, 'del')).toBe(1);
    expect(refused(r, 'del_again')).toBe('INVALID_ARGUMENT');
    // three creates, one edit, one delete
    expect(ok<number>(r, 'audit')).toBe(5);
  });

  it('frees the add-ons the card covers on the bill, and follows the card, the lines and the member', () => {
    const r = run('ldp-addons', [
      GUEST('g1'),
      ADDON('milk', 1000),
      ADDON('syrup', 500),
      TIER('gold', GOLD),
      TIER('black', BLACK),
      TIER_ID('gold_id', 'LDP Gold'),
      TIER_ID('black_id', 'LDP Black'),
      PERK(
        'milk_perk',
        'owner',
        `jsonb_build_object('tier_id', {{gold_id}}, 'kind', 'free_addons', 'name_en', 'Free milk swaps',
                            'name_ar', 'تبديل الحليب مجانًا', 'modifier_group_ids', jsonb_build_array({{milk_group}}))`,
      ),
      PERK(
        'all_perk',
        'owner',
        `jsonb_build_object('tier_id', {{black_id}}, 'kind', 'free_addons', 'name_en', 'Every add-on free',
                            'name_ar', 'كل الإضافات مجانًا')`,
      ),
      PERK(
        'custom_perk',
        'owner',
        `jsonb_build_object('tier_id', {{gold_id}}, 'kind', 'custom', 'name_en', 'A racket to borrow',
                            'name_ar', 'مضرب للاستعارة')`,
      ),
      TAB('t1', 'g1'),
      // two lattes at 4,000, each with oat milk (1,000) and two syrups (500): (4,000 + 2,000) x 2
      LINE('l1', 't1', 4000, 2, 'milk:1,syrup:2'),
      LINE('l2', 't1', 3000, 1),
      // the base card frees nothing
      T('base', 'cashier', `select app.loyalty_tab_benefits({{t1}})`),
      T('base_refresh', 'cashier', `select app.loyalty_perks_refresh({{t1}}, 'dev-1')`),
      // Gold: milk only
      PTS('g1', 150),
      T('gold_benefits', 'cashier', `select app.loyalty_tab_benefits({{t1}})`),
      T('gold_refresh', 'cashier', `select app.loyalty_perks_refresh({{t1}}, 'dev-1')`),
      T('gold_again', 'cashier', `select app.loyalty_perks_refresh({{t1}}, 'dev-1')`),
      PERK_ROWS('gold_rows', 't1'),
      TOTALS('gold_totals', 't1'),
      T('gold_after', 'cashier', `select app.loyalty_tab_benefits({{t1}})`),
      // Black: every add-on, and Gold's privileges still count
      PTS('g1', 450),
      T('black_benefits', 'cashier', `select app.loyalty_tab_benefits({{t1}})`),
      T('black_refresh', 'cashier', `select app.loyalty_perks_refresh({{t1}}, null)`),
      PERK_ROWS('black_rows', 't1'),
      // a second line with an add-on, added after: the bill says a refresh is due
      LINE('l3', 't1', 2000, 1, 'syrup:1'),
      T('more_benefits', 'cashier', `select app.loyalty_tab_benefits({{t1}})`),
      T('more_refresh', 'cashier', `select app.loyalty_perks_refresh({{t1}}, null)`),
      // a voided line stops counting at once, and its row goes at the next refresh
      X(`update order_items set voided = true, void_reason_code = 'mistake' where id = {{l1}}::uuid`),
      TOTALS('void_totals', 't1'),
      T('void_refresh', 'cashier', `select app.loyalty_perks_refresh({{t1}}, null)`),
      PERK_ROWS('void_rows', 't1'),
      // another line discount leaves less of the line to free
      X(`insert into tab_adjustments (tab_id, order_item_id, kind, value, amount_iqd, applied_by, authorized_by, reason_code)
         values ({{t1}}::uuid, {{l3}}::uuid, 'discount_amount', 2200, 2200, {{cashier}}::uuid, {{manager}}::uuid, 'manager_comp')`),
      T('capped_refresh', 'cashier', `select app.loyalty_perks_refresh({{t1}}, null)`),
      PERK_ROWS('capped_rows', 't1'),
      // the member taken off the bill: nothing is free any more
      X(`update tabs set customer_id = null where id = {{t1}}::uuid`),
      T('off_benefits', 'cashier', `select app.loyalty_tab_benefits({{t1}})`),
      T('off_refresh', 'cashier', `select app.loyalty_perks_refresh({{t1}}, null)`),
      PERK_ROWS('off_rows', 't1'),
      // who may ask
      T('guest_refresh', 'g1', `select app.loyalty_perks_refresh({{t1}}, null)`),
      T('guest_benefits', 'g1', `select app.loyalty_tab_benefits({{t1}})`),
      T('nil', 'cashier', `select app.loyalty_perks_refresh(gen_random_uuid(), null)`),
      Q('audit', `select to_jsonb(count(*)) from audit_log where action = 'loyalty.perks_apply' and entity_id = {{t1}}`),
    ]);
    const base = ok<Benefits>(r, 'base');
    expect(base.tier).toMatchObject({ min_points_12m: 0 });
    expect(base.perks).toEqual([]);
    expect(base.addons).toEqual({ on_bill_iqd: 0, due_iqd: 0, needs_refresh: false });
    expect(ok(r, 'base_refresh')).toEqual({ changed: false, amount_iqd: 0, lines: 0 });

    const gold = ok<Benefits>(r, 'gold_benefits');
    expect(gold.tier).toMatchObject({ name_en: 'LDP Gold' });
    expect(gold.perks.map((p) => p.name_en)).toEqual(['Free milk swaps', 'A racket to borrow']);
    // oat milk on two lattes
    expect(gold.addons).toEqual({ on_bill_iqd: 0, due_iqd: 2000, needs_refresh: true });
    expect(ok(r, 'gold_refresh')).toEqual({ changed: true, amount_iqd: 2000, lines: 1 });
    expect(ok(r, 'gold_again')).toEqual({ changed: false, amount_iqd: 2000, lines: 1 });
    const goldRows = ok<Array<{ line: string; amount: number; kind: string; by: string; auth: string }>>(r, 'gold_rows');
    expect(goldRows).toHaveLength(1);
    // a line discount, applied by the cashier, authorised by the owner who made the privilege
    expect(goldRows[0]).toMatchObject({ amount: 2000, kind: 'discount_amount' });
    expect(goldRows[0]?.by).not.toBe(goldRows[0]?.auth);
    expect(ok(r, 'gold_totals')).toEqual({ subtotal: 15000, discount: 2000, total: 13000 });
    expect(ok<Benefits>(r, 'gold_after').addons).toEqual({ on_bill_iqd: 2000, due_iqd: 2000, needs_refresh: false });

    const black = ok<Benefits>(r, 'black_benefits');
    expect(black.perks.map((p) => p.tier_name_en)).toEqual(['LDP Black', 'LDP Gold', 'LDP Gold']);
    // milk 1,000 + two syrups 1,000, on two lattes
    expect(black.addons).toMatchObject({ due_iqd: 4000, needs_refresh: true });
    expect(ok(r, 'black_refresh')).toEqual({ changed: true, amount_iqd: 4000, lines: 1 });
    expect(ok<unknown[]>(r, 'black_rows')).toHaveLength(1);

    expect(ok<Benefits>(r, 'more_benefits').addons).toEqual({ on_bill_iqd: 4000, due_iqd: 4500, needs_refresh: true });
    expect(ok(r, 'more_refresh')).toEqual({ changed: true, amount_iqd: 4500, lines: 2 });

    // l1 voided: 3,000 + 2,500 of goods left, only l3's 500 still counts
    expect(ok(r, 'void_totals')).toEqual({ subtotal: 5500, discount: 500, total: 5000 });
    expect(ok(r, 'void_refresh')).toEqual({ changed: true, amount_iqd: 500, lines: 1 });
    expect(ok<Array<{ amount: number }>>(r, 'void_rows').map((x) => x.amount)).toEqual([500]);

    // l3 is 2,500 with 2,200 already off: 300 is all there is left to free
    expect(ok(r, 'capped_refresh')).toEqual({ changed: true, amount_iqd: 300, lines: 1 });
    expect(ok<Array<{ amount: number }>>(r, 'capped_rows').map((x) => x.amount)).toEqual([300]);

    const off = ok<Benefits>(r, 'off_benefits');
    expect(off.customer_id).toBeNull();
    expect(off.perks).toEqual([]);
    expect(off.addons).toEqual({ on_bill_iqd: 300, due_iqd: 0, needs_refresh: true });
    expect(ok(r, 'off_refresh')).toEqual({ changed: true, amount_iqd: 0, lines: 0 });
    expect(ok(r, 'off_rows')).toEqual([]);

    expect(refused(r, 'guest_refresh')).toBe('FORBIDDEN');
    expect(refused(r, 'guest_benefits')).toBe('FORBIDDEN');
    expect(refused(r, 'nil')).toBe('TAB_NOT_FOUND');
    // every refresh that changed something, and none that did not
    expect(ok<number>(r, 'audit')).toBe(6);
  });

  it('stays off while loyalty is off, leaves a closed bill alone and never undercuts what was paid', () => {
    const r = run('ldp-guards', [
      GUEST('g1'),
      ADDON('milk', 1000),
      TIER('gold', GOLD),
      TIER_ID('gold_id', 'LDP Gold'),
      PERK(
        'perk',
        'owner',
        `jsonb_build_object('tier_id', {{gold_id}}, 'kind', 'free_addons', 'name_en', 'Free add-ons',
                            'name_ar', 'إضافات مجانية')`,
      ),
      PTS('g1', 150),
      // loyalty off: the card gives nothing
      TAB('t1', 'g1'),
      LINE('l1', 't1', 4000, 1, 'milk:1'),
      X(`update loyalty_settings set enabled = false where id`),
      T('off_benefits', 'cashier', `select app.loyalty_tab_benefits({{t1}})`),
      T('off_refresh', 'cashier', `select app.loyalty_perks_refresh({{t1}}, null)`),
      X(`update loyalty_settings set enabled = true where id`),
      // paid in full before the refresh: taking the add-on off now would mean a refund
      PAY('t1', 5000),
      T('paid_refresh', 'cashier', `select app.loyalty_perks_refresh({{t1}}, null)`),
      PERK_ROWS('paid_rows', 't1'),
      // a settled bill keeps what it carried
      TAB('t2', 'g1'),
      LINE('l2', 't2', 4000, 1, 'milk:1'),
      T('t2_refresh', 'cashier', `select app.loyalty_perks_refresh({{t2}}, null)`),
      PAY('t2', 4000),
      SETTLE('t2'),
      X(`update loyalty_tier_perks set active = false where true`),
      T('settled_benefits', 'cashier', `select app.loyalty_tab_benefits({{t2}})`),
      T('settled_refresh', 'cashier', `select app.loyalty_perks_refresh({{t2}}, null)`),
      PERK_ROWS('settled_rows', 't2'),
    ]);
    const off = ok<Benefits>(r, 'off_benefits');
    expect(off.enabled).toBe(false);
    expect(off.perks).toEqual([]);
    expect(off.addons).toEqual({ on_bill_iqd: 0, due_iqd: 0, needs_refresh: false });
    expect(ok(r, 'off_refresh')).toEqual({ changed: false, amount_iqd: 0, lines: 0 });

    expect(ok(r, 'paid_refresh')).toEqual({ changed: false, amount_iqd: 0, lines: 0, refused: 'DISCOUNT_REQUIRES_REFUND' });
    expect(ok(r, 'paid_rows')).toEqual([]);

    expect(ok(r, 't2_refresh')).toEqual({ changed: true, amount_iqd: 1000, lines: 1 });
    expect(ok<Benefits>(r, 'settled_benefits').addons).toEqual({ on_bill_iqd: 1000, due_iqd: 0, needs_refresh: false });
    expect(ok(r, 'settled_refresh')).toEqual({ changed: false, amount_iqd: 1000, lines: 1 });
    expect(ok<Array<{ amount: number }>>(r, 'settled_rows').map((x) => x.amount)).toEqual([1000]);
  });
});

describe.skipIf(!docker)('deals in the app (0410)', () => {
  it('the owner lists a promotion with its line for guests', () => {
    const r = run('ldp-list', [
      PROMO('app', 20, false),
      PROMO('single', 10, false),
      X(`update promotions set public_code = 'LDPONCE1', code_single_use = true where id = {{single}}::uuid`),
      T('mgr', 'manager', `select app.set_promotion_app({{app}}, true, null, null)`),
      T('one_line', 'owner', `select app.set_promotion_app({{app}}, true, 'Any drink', null)`),
      T('long', 'owner', `select app.set_promotion_app({{app}}, true, repeat('x', 161), repeat('x', 161))`),
      T('null', 'owner', `select app.set_promotion_app({{app}}, null, null, null)`),
      T('unknown', 'owner', `select app.set_promotion_app(gen_random_uuid(), true, null, null)`),
      T('single_use', 'owner', `select app.set_promotion_app({{single}}, true, null, null)`),
      T('on', 'owner', `select app.set_promotion_app({{app}}, true, '  Any drink, any day  ', 'أي مشروب في أي يوم')`),
      T('bare', 'owner', `select app.set_promotion_app({{app}}, true, '', '')`),
      T('off', 'owner', `select app.set_promotion_app({{app}}, false, null, null)`),
      Q('audit', `select to_jsonb(count(*)) from audit_log where action = 'promotion.app' and entity_id = {{app}}`),
    ]);
    expect(refused(r, 'mgr')).toBe('FORBIDDEN');
    expect(refused(r, 'one_line')).toMatch(/^NAME_REQUIRED/);
    expect(refused(r, 'long')).toMatch(/^TEXT_TOO_LONG/);
    expect(refused(r, 'null')).toBe('INVALID_ARGUMENT');
    expect(refused(r, 'unknown')).toBe('PROMOTION_NOT_FOUND');
    expect(refused(r, 'single_use')).toBe('INVALID_VALUE');
    expect(ok(r, 'on')).toMatchObject({ in_app: true, app_blurb_en: 'Any drink, any day', app_blurb_ar: 'أي مشروب في أي يوم' });
    expect(ok(r, 'bare')).toMatchObject({ in_app: true, app_blurb_en: null, app_blurb_ar: null });
    expect(ok(r, 'off')).toMatchObject({ in_app: false });
    expect(ok<number>(r, 'audit')).toBe(3);
  });

  it('a guest reads the deals, picks one, and the till applies the picked deal first, once', () => {
    const r = run('ldp-pick', [
      GUEST('g1'),
      GUEST('g2'),
      TIER('gold', GOLD),
      TIER_ID('gold_id', 'LDP Gold'),
      // app: in the app only (not automatic, no code). big: automatic and larger, not listed.
      PROMO('app', 20, false),
      PROMO('big', 30, true),
      PROMO('once', 10, false, '{"perCustomer":1}'),
      PROMO('hidden', 50, false),
      X(`select pg_temp.promo('goldonly', 40, false, jsonb_build_object('tierMin', {{gold_id}}))`),
      X(`select pg_temp.promo('spent', 15, false, '{"total":1}'::jsonb)`),
      T('list_app', 'owner', `select app.set_promotion_app({{app}}, true, 'Any drink', 'أي مشروب')`),
      T('list_once', 'owner', `select app.set_promotion_app({{once}}, true, null, null)`),
      T('list_gold', 'owner', `select app.set_promotion_app({{goldonly}}, true, null, null)`),
      T('list_spent', 'owner', `select app.set_promotion_app({{spent}}, true, null, null)`),
      // "spent": its one use is on someone else's settled bill
      TAB('t0', 'g2'),
      LINE('l0', 't0', 10000, 1),
      X(`insert into tab_adjustments (id, tab_id, kind, value, amount_iqd, applied_by, authorized_by, reason_code, promotion_id)
         values ('00000000-0000-4000-8000-0000000410a0', {{t0}}::uuid, 'discount_percent', 1500, 1500, {{cashier}}::uuid,
                 {{manager}}::uuid, 'promotion', {{spent}}::uuid)`),
      X(`insert into promotion_redemptions (promotion_id, tab_id, adjustment_id, customer_id, amount_iqd, redeemed_by)
         values ({{spent}}::uuid, {{t0}}::uuid, '00000000-0000-4000-8000-0000000410a0', {{g2}}::uuid, 1500, {{cashier}}::uuid)`),

      T('deals', 'g1', `select app.my_deals()`),
      T('mine', 'g1', `select app.my_loyalty()`),
      T('pick_locked', 'g1', `select app.pick_deal({{goldonly}})`),
      T('pick_hidden', 'g1', `select app.pick_deal({{hidden}})`),
      T('pick_spent', 'g1', `select app.pick_deal({{spent}})`),
      T('pick_unknown', 'g1', `select app.pick_deal(gen_random_uuid())`),

      // before the pick: the in-app deal is not on offer at the till, the automatic one is
      TAB('t1', 'g1'),
      LINE('l1', 't1', 10000, 1),
      T('before', 'cashier', `select app.eligible_promotions({{t1}}, null)`),
      T('pick', 'g1', `select app.pick_deal({{app}})`),
      T('after', 'cashier', `select app.eligible_promotions({{t1}}, null)`),
      // someone else's bill, and a bill with nobody on it, do not get g1's pick
      TAB('t2', 'g2'),
      LINE('l2', 't2', 10000, 1),
      T('other', 'cashier', `select app.eligible_promotions({{t2}}, null)`),
      T('benefits', 'cashier', `select app.loyalty_tab_benefits({{t1}})`),
      T('apply', 'cashier', `select app.apply_best_promotion({{t1}}, null, ${KEY('a')}, null)`),
      T('applied', 'cashier', `select app.loyalty_tab_benefits({{t1}})`),
      T('reapply', 'cashier', `select app.apply_best_promotion({{t1}}, null, ${KEY('b')}, null)`),
      // the bill settles: the pick is spent
      PAY('t1', 8000),
      SETTLE('t1'),
      T('spent_pick', 'g1', `select app.my_deals()`),
      TAB('t3', 'g1'),
      LINE('l3', 't3', 10000, 1),
      T('next_bill', 'cashier', `select app.eligible_promotions({{t3}}, null)`),

      // a deal with one use each: picked, used, then no longer theirs to pick
      T('pick_once', 'g1', `select app.pick_deal({{once}})`),
      X(`update promotions set enabled = false where id = {{big}}::uuid`),
      T('apply_once', 'cashier', `select app.apply_best_promotion({{t3}}, null, ${KEY('c')}, null)`),
      PAY('t3', 9000),
      SETTLE('t3'),
      T('used', 'g1', `select app.my_deals()`),
      T('pick_used', 'g1', `select app.pick_deal({{once}})`),

      // a pick lapses after a day, and can be cleared
      T('pick_again', 'g1', `select app.pick_deal({{app}})`),
      X(`update loyalty_cards set deal_picked_at = now() - interval '25 hours' where profile_id = {{g1}}::uuid`),
      T('lapsed', 'g1', `select app.my_deals()`),
      T('pick_third', 'g1', `select app.pick_deal({{app}})`),
      T('clear', 'g1', `select app.pick_deal(null)`),

      // Gold opens the tier deal, and the ladder names it
      PTS('g1', 150),
      T('gold_deals', 'g1', `select app.my_deals()`),
      T('gold_mine', 'g1', `select app.my_loyalty()`),
      T('pick_gold', 'g1', `select app.pick_deal({{goldonly}})`),
      T('cashier_deals', 'cashier', `select app.my_deals()`),
    ]);
    const idOf = (name: string) => ok<{ id?: string }>(r, `list_${name}`).id as string;
    const appId = idOf('app');
    const onceId = idOf('once');
    const goldId = idOf('gold');
    const spentId = idOf('spent');

    const deals = ok<MyDeals>(r, 'deals');
    expect(deals.picked_id).toBeNull();
    // listed and running only: not the automatic one, not the unlisted one, not the one all used up
    expect(deals.deals.map((d) => d.id).sort()).toEqual([appId, onceId, goldId].sort());
    expect(deals.deals.map((d) => d.id)).not.toContain(spentId);
    const app = deals.deals.find((d) => d.id === appId);
    expect(app).toMatchObject({
      name_en: 'LDP app', blurb_en: 'Any drink', type: 'percent', value: 20, state: 'open', picked: false, used: 0,
      tier: null, on: { items: [], categories: [], courts: false },
    });
    expect(deals.deals.find((d) => d.id === goldId)).toMatchObject({ state: 'locked', tier: { name_en: 'LDP Gold' } });
    // open deals before the locked one
    expect(deals.deals[deals.deals.length - 1]?.id).toBe(goldId);
    type Ladder = Array<{ name_en: string; deals: Array<{ id: string }> }>;
    expect(ok<{ tiers: Ladder }>(r, 'mine').tiers.find((t) => t.name_en === 'LDP Gold')?.deals.map((d) => d.id)).toEqual([goldId]);

    expect(refused(r, 'pick_locked')).toBe('DEAL_LOCKED');
    expect(refused(r, 'pick_hidden')).toBe('DEAL_UNAVAILABLE');
    expect(refused(r, 'pick_spent')).toBe('DEAL_UNAVAILABLE');
    expect(refused(r, 'pick_unknown')).toBe('DEAL_UNAVAILABLE');

    type Elig = Array<{ promotionId: string; amountIqd: number; picked: boolean }>;
    const before = ok<Elig>(r, 'before');
    expect(before.map((e) => e.promotionId)).not.toContain(appId);
    expect(before[0]).toMatchObject({ amountIqd: 3000, picked: false });

    const picked = ok<MyDeals>(r, 'pick');
    expect(picked.picked_id).toBe(appId);
    expect(picked.picked_until).toBeTruthy();
    expect(picked.deals[0]).toMatchObject({ id: appId, picked: true });

    // the picked deal first, although the automatic one is worth more
    const after = ok<Elig>(r, 'after');
    expect(after[0]).toMatchObject({ promotionId: appId, amountIqd: 2000, picked: true });
    expect(after[1]).toMatchObject({ amountIqd: 3000, picked: false });
    expect(ok<Elig>(r, 'other').map((e) => e.promotionId)).not.toContain(appId);

    expect(ok<Benefits>(r, 'benefits').deal).toMatchObject({ promotion_id: appId, name_en: 'LDP app', applied: false });
    expect(ok(r, 'apply')).toMatchObject({ promotionId: appId, amountIqd: 2000, unchanged: false });
    expect(ok<Benefits>(r, 'applied').deal).toMatchObject({ promotion_id: appId, applied: true });
    expect(ok(r, 'reapply')).toMatchObject({ promotionId: appId, unchanged: true });

    const spent = ok<MyDeals>(r, 'spent_pick');
    expect(spent.picked_id).toBeNull();
    expect(spent.deals.find((d) => d.id === appId)).toMatchObject({ picked: false, used: 1, state: 'open' });
    expect(ok<Elig>(r, 'next_bill').map((e) => e.promotionId)).not.toContain(appId);

    expect(ok<MyDeals>(r, 'pick_once').picked_id).toBe(onceId);
    expect(ok(r, 'apply_once')).toMatchObject({ promotionId: onceId, amountIqd: 1000 });
    const used = ok<MyDeals>(r, 'used');
    expect(used.deals.find((d) => d.id === onceId)).toMatchObject({ state: 'used', used: 1, per_customer: 1 });
    expect(refused(r, 'pick_used')).toBe('DEAL_USED');

    expect(ok<MyDeals>(r, 'pick_again').picked_id).toBe(appId);
    expect(ok<MyDeals>(r, 'lapsed').picked_id).toBeNull();
    expect(ok<MyDeals>(r, 'pick_third').picked_id).toBe(appId);
    expect(ok<MyDeals>(r, 'clear')).toMatchObject({ picked_id: null, picked_until: null });

    expect(ok<MyDeals>(r, 'gold_deals').deals.find((d) => d.id === goldId)).toMatchObject({ state: 'open' });
    expect(ok<{ tier: { name_en: string } }>(r, 'gold_mine').tier.name_en).toBe('LDP Gold');
    expect(ok<MyDeals>(r, 'pick_gold').picked_id).toBe(goldId);
    // staff are accounts too: the call answers, with their own (empty) pick
    expect(ok<MyDeals>(r, 'cashier_deals').picked_id).toBeNull();
  });

  it('says what a deal covers and when it runs', () => {
    const r = run('ldp-shape', [
      GUEST('g1'),
      // a category and an item of the suite's own, at branch A
      KEEP(
        'cat',
        `insert into menu_categories (name_en, name_ar, tax_group_id, venue_id)
         values ('LDP Drinks', 'مشروبات', {{tax}}::uuid, {{venue}}::uuid) returning id::text`,
      ),
      KEEP(
        'item',
        `insert into menu_items (category_id, name_en, name_ar, venue_id)
         values ({{cat}}::uuid, 'LDP Latte', 'لاتيه', {{venue}}::uuid) returning id::text`,
      ),
      PROMO('scoped', 25, true, '{"minSpendIqd":5000,"perCustomer":3}'),
      // a deal on named items belongs to their branch (promotions_chain_scope_chk); every day but
      // today, in the branch's time: listed, but not live now
      X(`update promotions set in_app = true, ends_at = now() + interval '3 days', venue_id = {{venue}}::uuid,
                scope = jsonb_build_object('itemIds', jsonb_build_array({{item}}), 'categoryIds', jsonb_build_array({{cat}})),
                weekdays = array(select d from generate_series(0, 6) d
                                  where d <> extract(dow from now() at time zone
                                    coalesce((select vs.timezone from venue_settings vs where vs.venue_id = {{venue}}::uuid), 'Asia/Baghdad'))::int),
                hour_from = '08:00', hour_to = '12:00'
          where id = {{scoped}}::uuid`),
      PROMO('ended', 10, true),
      X(`update promotions set in_app = true, starts_at = now() - interval '3 days', ends_at = now() - interval '1 day'
          where id = {{ended}}::uuid`),
      PROMO('later', 10, true),
      X(`update promotions set in_app = true, starts_at = now() + interval '1 day' where id = {{later}}::uuid`),
      T('deals', 'g1', `select app.my_deals()`),
    ]);
    const deals = ok<{ deals: Array<Record<string, unknown>> }>(r, 'deals').deals;
    // an ended deal and one that has not started are not shown
    expect(deals).toHaveLength(1);
    const d = deals[0] as {
      weekdays: number[]; hour_from: string; hour_to: string; live_now: boolean; min_spend_iqd: number;
      per_customer: number; ends_at: string; venue_id: string | null;
      on: { items: Array<{ name_en: string; name_ar: string }>; categories: Array<{ name_en: string }>; courts: boolean };
    };
    expect(d.weekdays).toHaveLength(6);
    expect(d).toMatchObject({ hour_from: '08:00', hour_to: '12:00', live_now: false, min_spend_iqd: 5000, per_customer: 3 });
    expect(d.venue_id).toBeTruthy();
    expect(d.ends_at).toBeTruthy();
    expect(d.on.items).toHaveLength(1);
    expect(d.on.items[0]?.name_en).toBeTruthy();
    expect(d.on.items[0]?.name_ar).toBeTruthy();
    expect(d.on.categories).toHaveLength(1);
    expect(d.on.courts).toBe(false);
  });
});
