/**
 * What the Green and Blue cards give (20261114000425_loyalty_card_gifts.sql):
 *
 *   * the owner writes the four new privilege kinds (gift, free_with, frame, stamp_size) and their
 *     config is checked;
 *   * a birthday gift frees the dearest matching unit once per window, only for a birth date set
 *     30 days before it opened, and a card holds the lower cards' gifts (Blue = drink + dessert);
 *   * free with: one tea or water free per dessert on the bill;
 *   * the drink card: paid stamping units stamp at the settle, a full card frees the dearest
 *     stamping unit on the next bill and the settle spends the stamps; Blue's card fills at 6;
 *   * the card rings: a card unlocks its ring, losing the card or the privilege takes it off;
 *   * my_card_extras / loyalty_card_extras;
 *   * Redeem in the app (2026-11-15): a free drink and a gift reach a bill only once the member
 *     pressed Redeem (claim_card_reward) or a till did for them (claim_card_reward_for_tab);
 *   * buy one, get one (promotions.type free_item): the cheapest given units, one per earning unit.
 *
 * Each case is one rolled-back psql transaction (stores-harness `scenario`). Without docker the
 * suite skips.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, KEEP, ok, Q, refused, RES, scenario, T, X, type Results } from './stores-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

function phone(): string {
  return `+96477${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}

const PRE = String.raw`
set constraints all immediate;

-- Lines name real menu items (the rules read their categories) but made-up variants.
do $drop_fk$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
      from pg_constraint c
     where c.contype = 'f' and c.conrelid = 'public.order_items'::regclass
       and c.confrelid = 'public.menu_item_variants'::regclass
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
  -- Bookings name made-up courts (the court-hour gift reads only the booking).
  for r in
    select c.conrelid::regclass as tbl, c.conname
      from pg_constraint c
     where c.contype = 'f' and c.conrelid = 'public.reservations'::regclass
       and c.confrelid = 'public.courts'::regclass
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
  values (v, 'lcg-' || p_name || '-' || v || '@test.touch.local', jsonb_build_object('full_name', 'LCG ' || p_name),
          'authenticated', 'authenticated', app.phone_digits(p_phone), now());
  perform pg_temp.put(p_name, v::text);
  return v;
end $f$;

create function pg_temp.pts(p_guest text, p_delta int) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  insert into loyalty_ledger (profile_id, delta, kind, source_kind, source_id, note)
  values (pg_temp.var(p_guest)::uuid, p_delta, case when p_delta < 0 then 'adjust' else 'earn' end,
          'fixture', gen_random_uuid(), 'fixture');
end $f$;

-- A birth date whose birthday is today at branch A, set p_days_ago days ago.
create function pg_temp.birthday(p_guest text, p_days_ago int, p_offset int default 0) returns void
language plpgsql as $f$
declare v_today date := (now() at time zone coalesce((select vs.timezone from venue_settings vs
                                                       where vs.venue_id = pg_temp.var('venue')::uuid), 'Asia/Baghdad'))::date;
        v_b date := v_today + p_offset;
begin
  perform set_config('request.jwt.claims', '', true);
  update profiles
     set birth_date = make_date(1992, extract(month from v_b)::int,
                                least(extract(day from v_b)::int, case when extract(month from v_b) = 2 then 28 else 31 end)),
         birth_date_set_at = now() - make_interval(days => p_days_ago)
   where id = pg_temp.var(p_guest)::uuid;
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

create function pg_temp.tab(p_name text, p_customer text default null, p_res text default null) returns uuid
language plpgsql as $f$
declare v uuid; v_day uuid := pg_temp.day();
begin
  perform set_config('request.jwt.claims', '', true);
  insert into tabs (venue_id, day_session_id, kind, status, label, opened_by_staff_id, customer_id, reservation_id)
  values (pg_temp.var('venue')::uuid, v_day, 'cafe', 'open', 'LCG ' || p_name, pg_temp.var('cashier')::uuid,
          case when p_customer is not null then pg_temp.var(p_customer)::uuid end,
          case when p_res is not null then pg_temp.var(p_res)::uuid end)
  returning id into v;
  perform pg_temp.put(p_name, v::text);
  return v;
end $f$;

-- A menu category at branch A, and an item in it.
create function pg_temp.cat(p_name text) returns uuid language plpgsql as $f$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into menu_categories (name_en, name_ar, tax_group_id, venue_id)
  values ('LCG ' || p_name, 'فئة ' || p_name, pg_temp.var('tax')::uuid, pg_temp.var('venue')::uuid)
  returning id into v;
  perform pg_temp.put(p_name, v::text);
  return v;
end $f$;

create function pg_temp.item(p_name text, p_cat text) returns uuid language plpgsql as $f$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into menu_items (category_id, name_en, name_ar, venue_id)
  values (pg_temp.var(p_cat)::uuid, 'LCG ' || p_name, 'صنف ' || p_name, pg_temp.var('venue')::uuid)
  returning id into v;
  perform pg_temp.put(p_name, v::text);
  return v;
end $f$;

-- A size of an item.
create function pg_temp.size(p_name text, p_item text, p_price bigint) returns uuid language plpgsql as $f$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into menu_item_variants (item_id, name_en, name_ar, price_iqd)
  values (pg_temp.var(p_item)::uuid, 'LCG ' || p_name, 'حجم ' || p_name, p_price)
  returning id into v;
  perform pg_temp.put(p_name, v::text);
  return v;
end $f$;

-- A booking of a guest at branch A, p_hours long, priced p_price.
create function pg_temp.booking(p_name text, p_guest text, p_hours int, p_price bigint) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into reservations (court_id, kind, status, start_at, end_at, source, venue_id, guest_id, price_iqd)
  values (gen_random_uuid(), 'booking', 'confirmed', now() + interval '3 days',
          now() + interval '3 days' + make_interval(hours => p_hours), 'desk',
          pg_temp.var('venue')::uuid, pg_temp.var(p_guest)::uuid, p_price)
  returning id into v;
  perform pg_temp.put(p_name, v::text);
  return v;
end $f$;

-- A line of p_qty units of an item at p_unit each (p_variant: a planted size, or none).
create function pg_temp.line(p_name text, p_tab text, p_item text, p_unit bigint, p_qty int,
                             p_variant text default null) returns uuid
language plpgsql as $f$
declare o uuid; v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into orders (tab_id, source, placed_by_staff_id, venue_id)
  values (pg_temp.var(p_tab)::uuid, 'till', pg_temp.var('cashier')::uuid, pg_temp.var('venue')::uuid)
  returning id into o;
  insert into order_items (order_id, menu_item_id, variant_id, qty, unit_price_iqd, line_total_iqd)
  values (o, pg_temp.var(p_item)::uuid,
          coalesce(case when p_variant is not null then pg_temp.var(p_variant)::uuid end, gen_random_uuid()),
          p_qty, p_unit, p_unit * p_qty)
  returning id into v;
  perform pg_temp.put(p_name, v::text);
  return v;
end $f$;

create function pg_temp.settle(p_tab text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  update tabs set status = 'settled', settled_at = clock_timestamp() where id = pg_temp.var(p_tab)::uuid;
end $f$;

-- Planted privileges (the owner's writer is its own case).
create function pg_temp.perk(p_name text, p_tier text, p_kind text, p_config jsonb) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into loyalty_tier_perks (tier_id, kind, name_en, name_ar, config, created_by)
  values ((select id from loyalty_tiers where name_en = p_tier), p_kind, 'LCG ' || p_name, 'ميزة ' || p_name,
          p_config, pg_temp.var('owner')::uuid)
  returning id into v;
  perform pg_temp.put(p_name, v::text);
  return v;
end $f$;

-- Redeem in the app: the member's press on every gift and the free drink, as claim_card_reward
-- records it but without its checks. clock_timestamp: a scenario is one transaction, and a press
-- made after a settle must count as later than the stamps that settle spent.
create function pg_temp.claim_for_tab(p_tab text) returns void language plpgsql as $f$
declare v_c uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  v_c := app.tab_customer(pg_temp.var(p_tab)::uuid);
  insert into loyalty_reward_claims (profile_id, kind, perk_id, claimed_at, expires_at)
  select v_c, 'gift', k.id, clock_timestamp(), clock_timestamp() + interval '30 days'
    from loyalty_tier_perks k where k.kind = 'gift'
  on conflict (profile_id, reward_key) do update set claimed_at = excluded.claimed_at, expires_at = excluded.expires_at;
  insert into loyalty_reward_claims (profile_id, kind, perk_id, claimed_at, expires_at)
  values (v_c, 'stamp', null, clock_timestamp(), clock_timestamp() + interval '7 days')
  on conflict (profile_id, reward_key) do update set claimed_at = excluded.claimed_at, expires_at = excluded.expires_at;
end $f$;

update promotions set enabled = false where enabled;
update loyalty_settings set enabled = true where id;
delete from loyalty_tier_perks;
delete from loyalty_tiers where sort > 0;
insert into loyalty_tiers (name_en, name_ar, min_points_12m, earn_multiplier, sort, color)
values ('LCG Green', 'الخضراء', 250, 1.1, 1, 'green'), ('LCG Blue', 'الزرقاء', 1000, 1.25, 2, 'blue');

select pg_temp.cat('drinks');
select pg_temp.cat('desserts');
select pg_temp.cat('hot');
select pg_temp.item('latte', 'drinks');
select pg_temp.item('mojito', 'drinks');
select pg_temp.item('water', 'drinks');
select pg_temp.item('cake', 'desserts');
select pg_temp.item('tea', 'hot');
`;

const GUEST = (name: string) => `select pg_temp.guest('${name}', '${phone()}');`;
const PTS = (guest: string, delta: number) => X(`select pg_temp.pts('${guest}', ${delta})`);
const BIRTHDAY = (guest: string, daysAgo: number, offset = 0) =>
  X(`select pg_temp.birthday('${guest}', ${daysAgo}, ${offset})`);
const TAB = (name: string, customer?: string, res?: string) =>
  X(`select pg_temp.tab('${name}', ${customer ? `'${customer}'` : 'null'}, ${res ? `'${res}'` : 'null'})`);
const SIZE = (name: string, item: string, price: number) => X(`select pg_temp.size('${name}', '${item}', ${price})`);
const BOOKING = (name: string, guest: string, hours: number, price: number) =>
  X(`select pg_temp.booking('${name}', '${guest}', ${hours}, ${price})`);
const VLINE = (name: string, tab: string, item: string, unit: number, qty: number, variant: string) =>
  X(`select pg_temp.line('${name}', '${tab}', '${item}', ${unit}, ${qty}, '${variant}')`);
const LINE = (name: string, tab: string, item: string, unit: number, qty: number) =>
  X(`select pg_temp.line('${name}', '${tab}', '${item}', ${unit}, ${qty})`);
const SETTLE = (tab: string) => X(`select pg_temp.settle('${tab}')`);
const PERK = (name: string, tier: string, kind: string, config: string) =>
  X(`select pg_temp.perk('${name}', '${tier}', '${kind}', ${config})`);
/** The bill's member pressed Redeem on every gift and the free drink (pg_temp.claim_for_tab). */
const CLAIM = (tab: string) => X(`select pg_temp.claim_for_tab('${tab}')`);
const REFRESH = (label: string, tab: string) =>
  T(label, 'cashier', `select app.loyalty_perks_refresh({{${tab}}}::uuid)`);
/** The bill's detail lines as {line name → [kind, units, amount]}. */
const DETAIL = (label: string, tab: string, names: string[]) =>
  Q(
    label,
    `select coalesce(jsonb_agg(jsonb_build_object('line', case l.order_item_id
                 ${names.map((n) => `when {{${n}}}::uuid then '${n}'`).join(' ')} else 'other' end,
               'kind', l.kind, 'units', l.units, 'amount', l.amount_iqd)
               order by l.kind, l.amount_iqd), '[]'::jsonb)
       from loyalty_perk_lines l where l.tab_id = {{${tab}}}::uuid`,
  );
const STAMPS = (label: string, guest: string) =>
  Q(
    label,
    `select coalesce(jsonb_agg(jsonb_build_object('kind', s.kind, 'delta', s.delta) order by s.created_at, s.kind), '[]'::jsonb)
       from loyalty_stamps s where s.profile_id = {{${guest}}}::uuid`,
  );
const CARD_ON = (size = 8) =>
  X(`update loyalty_stamp_card set enabled = true, size = ${size},
       category_ids = array[pg_temp.var('drinks')::uuid],
       excluded_item_ids = array[pg_temp.var('water')::uuid] where id`);

function run(tag: string, body: string[]): Results {
  return scenario(tag, [PRE, ...body]);
}

type Row = { line: string; kind: string; units: number; amount: number };

describe.skipIf(!docker)('the owner writes the new privileges (0445)', () => {
  it('checks each kind\'s config and keeps a tidy copy', () => {
    const r = run('lcg-write', [
      KEEP('green_id', `select id::text from loyalty_tiers where name_en = 'LCG Green'`),
      T(
        'gift',
        'owner',
        `select app.upsert_loyalty_tier_perk(jsonb_build_object('tier_id', {{green_id}}, 'kind', 'gift',
           'name_en', 'Birthday drink', 'name_ar', 'مشروب عيد الميلاد',
           'config', jsonb_build_object('categoryIds', jsonb_build_array({{drinks}}, {{drinks}}), 'days', 3)))`,
      ),
      KEEP('gift_id', `select id::text from loyalty_tier_perks where name_en = 'Birthday drink'`),
      // The On switch sends no config: the saved one stays, unchecked (a menu item deleted since
      // must not block it).
      X(`update loyalty_tier_perks set config = jsonb_set(config, '{itemIds}', jsonb_build_array(gen_random_uuid())) where id = {{gift_id}}::uuid`),
      T('gift_off', 'owner', `select app.upsert_loyalty_tier_perk(jsonb_build_object('id', {{gift_id}}, 'active', false))`),
      T(
        'gift_empty',
        'owner',
        `select app.upsert_loyalty_tier_perk(jsonb_build_object('tier_id', {{green_id}}, 'kind', 'gift',
           'name_en', 'x', 'name_ar', 'x', 'config', '{}'::jsonb))`,
      ),
      T(
        'gift_days',
        'owner',
        `select app.upsert_loyalty_tier_perk(jsonb_build_object('tier_id', {{green_id}}, 'kind', 'gift',
           'name_en', 'x', 'name_ar', 'x', 'config', jsonb_build_object('categoryIds', jsonb_build_array({{drinks}}), 'days', 40)))`,
      ),
      T(
        'with',
        'owner',
        `select app.upsert_loyalty_tier_perk(jsonb_build_object('tier_id', {{green_id}}, 'kind', 'free_with',
           'name_en', 'Tea with dessert', 'name_ar', 'شاي مع الحلى',
           'config', jsonb_build_object('triggerCategoryIds', jsonb_build_array({{desserts}}),
                                        'freeItemIds', jsonb_build_array({{tea}}, {{water}}))))`,
      ),
      T(
        'with_no_free',
        'owner',
        `select app.upsert_loyalty_tier_perk(jsonb_build_object('tier_id', {{green_id}}, 'kind', 'free_with',
           'name_en', 'x', 'name_ar', 'x', 'config', jsonb_build_object('triggerCategoryIds', jsonb_build_array({{desserts}}))))`,
      ),
      T(
        'frame',
        'owner',
        `select app.upsert_loyalty_tier_perk(jsonb_build_object('tier_id', {{green_id}}, 'kind', 'frame',
           'name_en', 'Green ring', 'name_ar', 'الحلقة الخضراء', 'config', '{"frameId":"card-green"}'::jsonb))`,
      ),
      T(
        'frame_bad',
        'owner',
        `select app.upsert_loyalty_tier_perk(jsonb_build_object('tier_id', {{green_id}}, 'kind', 'frame',
           'name_en', 'x', 'name_ar', 'x', 'config', '{"frameId":"champion"}'::jsonb))`,
      ),
      T(
        'size',
        'owner',
        `select app.upsert_loyalty_tier_perk(jsonb_build_object('tier_id', {{green_id}}, 'kind', 'stamp_size',
           'name_en', 'Card full at 6', 'name_ar', 'البطاقة تكتمل عند 6', 'config', '{"size":6}'::jsonb))`,
      ),
      T(
        'size_bad',
        'owner',
        `select app.upsert_loyalty_tier_perk(jsonb_build_object('tier_id', {{green_id}}, 'kind', 'stamp_size',
           'name_en', 'x', 'name_ar', 'x', 'config', '{"size":1}'::jsonb))`,
      ),
      T(
        'mgr',
        'manager',
        `select app.upsert_loyalty_tier_perk(jsonb_build_object('tier_id', {{green_id}}, 'kind', 'stamp_size',
           'name_en', 'x', 'name_ar', 'x', 'config', '{"size":6}'::jsonb))`,
      ),
      T('card_bad', 'owner', `select app.set_stamp_card('{"enabled":true,"category_ids":[]}'::jsonb)`),
      T(
        'card',
        'owner',
        `select app.set_stamp_card(jsonb_build_object('enabled', true, 'size', 8,
           'category_ids', jsonb_build_array({{drinks}}), 'excluded_item_ids', jsonb_build_array({{water}})))`,
      ),
      T('card_read', 'manager', `select app.stamp_card_settings()`),
      T('card_cashier', 'cashier', `select app.stamp_card_settings()`),
    ]);
    expect(ok(r, 'gift')).toMatchObject({ kind: 'gift', config: { when: 'birthday', days: 3, itemIds: [] } });
    expect((ok(r, 'gift') as { config: { categoryIds: string[] } }).config.categoryIds).toHaveLength(1);
    expect(ok(r, 'gift_off')).toMatchObject({ active: false, config: { days: 3 } });
    expect((ok(r, 'gift_off') as { config: { itemIds: string[] } }).config.itemIds).toHaveLength(1);
    expect(refused(r, 'gift_empty')).toBe('INVALID_ARGUMENT');
    expect(refused(r, 'gift_days')).toBe('INVALID_ARGUMENT');
    expect(ok(r, 'with')).toMatchObject({ kind: 'free_with' });
    expect(refused(r, 'with_no_free')).toBe('INVALID_ARGUMENT');
    expect(ok(r, 'frame')).toMatchObject({ config: { frameId: 'card-green' } });
    expect(refused(r, 'frame_bad')).toBe('INVALID_ARGUMENT');
    expect(ok(r, 'size')).toMatchObject({ config: { size: 6 } });
    expect(refused(r, 'size_bad')).toBe('INVALID_ARGUMENT');
    expect(refused(r, 'mgr')).toBe('FORBIDDEN');
    expect(refused(r, 'card_bad')).toMatch(/^INVALID_ARGUMENT/);
    expect(ok(r, 'card')).toMatchObject({ enabled: true, size: 8 });
    expect(ok(r, 'card_read')).toMatchObject({ enabled: true, size: 8 });
    expect(refused(r, 'card_cashier')).toBe('FORBIDDEN');
  });
});

describe.skipIf(!docker)('birthday gifts (0445)', () => {
  it('Green gets a drink, Blue a drink and a dessert, once per window, on a date set in time', () => {
    const r = run('lcg-birthday', [
      PERK('bday_drink', 'LCG Green', 'gift', `jsonb_build_object('when', 'birthday', 'categoryIds', jsonb_build_array(pg_temp.var('drinks')), 'itemIds', '[]'::jsonb, 'days', 7)`),
      PERK('bday_dessert', 'LCG Blue', 'gift', `jsonb_build_object('when', 'birthday', 'categoryIds', jsonb_build_array(pg_temp.var('desserts')), 'itemIds', '[]'::jsonb, 'days', 7)`),
      GUEST('green'),
      PTS('green', 300),
      BIRTHDAY('green', 60),
      GUEST('blue'),
      PTS('blue', 1200),
      BIRTHDAY('blue', 60),
      GUEST('late'),
      PTS('late', 1200),
      BIRTHDAY('late', 5),
      GUEST('past'),
      PTS('past', 1200),
      BIRTHDAY('past', 60, -10),
      // Green: two drinks, the dearer is free; the cake is paid.
      TAB('g1', 'green'),
      LINE('g1_latte', 'g1', 'latte', 4000, 1),
      LINE('g1_mojito', 'g1', 'mojito', 6000, 2),
      LINE('g1_cake', 'g1', 'cake', 5000, 1),
      CLAIM('g1'),
      REFRESH('g1_ref', 'g1'),
      DETAIL('g1_detail', 'g1', ['g1_latte', 'g1_mojito', 'g1_cake']),
      // A second open bill the same day: the gift is held by the first.
      TAB('g2', 'green'),
      LINE('g2_latte', 'g2', 'latte', 4000, 1),
      CLAIM('g2'),
      REFRESH('g2_ref', 'g2'),
      DETAIL('g2_detail', 'g2', ['g2_latte']),
      // Blue: the drink (Green's) and the dessert (its own).
      TAB('b1', 'blue'),
      LINE('b1_latte', 'b1', 'latte', 4000, 1),
      LINE('b1_cake', 'b1', 'cake', 5000, 1),
      CLAIM('b1'),
      REFRESH('b1_ref', 'b1'),
      DETAIL('b1_detail', 'b1', ['b1_latte', 'b1_cake']),
      // A date set 5 days ago, and a birthday 10 days back (out of the 7-day window): nothing.
      TAB('l1', 'late'),
      LINE('l1_latte', 'l1', 'latte', 4000, 1),
      CLAIM('l1'),
      REFRESH('l1_ref', 'l1'),
      DETAIL('l1_detail', 'l1', ['l1_latte']),
      TAB('p1', 'past'),
      LINE('p1_latte', 'p1', 'latte', 4000, 1),
      CLAIM('p1'),
      REFRESH('p1_ref', 'p1'),
      DETAIL('p1_detail', 'p1', ['p1_latte']),
      T('blue_extras', 'blue', `select app.my_card_extras()`),
      T('late_extras', 'late', `select app.my_card_extras()`),
      T('staff_extras', 'cashier', `select app.loyalty_card_extras({{blue}}::uuid)`),
    ]);
    expect(ok<Row[]>(r, 'g1_detail')).toEqual([{ line: 'g1_mojito', kind: 'gift', units: 1, amount: 6000 }]);
    expect(ok<{ changed: boolean; amount_iqd: number }>(r, 'g1_ref')).toMatchObject({ changed: true, amount_iqd: 6000 });
    expect(ok<Row[]>(r, 'g2_detail')).toEqual([]);
    expect(ok<Row[]>(r, 'b1_detail')).toEqual([
      { line: 'b1_latte', kind: 'gift', units: 1, amount: 4000 },
      { line: 'b1_cake', kind: 'gift', units: 1, amount: 5000 },
    ]);
    expect(ok<Row[]>(r, 'l1_detail')).toEqual([]);
    expect(ok<Row[]>(r, 'p1_detail')).toEqual([]);

    const blue = ok<{ birthday: { has_date: boolean; gifts: Array<{ used: boolean; eligible: boolean; window_from: string | null }> } }>(r, 'blue_extras');
    expect(blue.birthday.has_date).toBe(true);
    expect(blue.birthday.gifts).toHaveLength(2);
    expect(blue.birthday.gifts.every((g) => g.used && g.eligible && g.window_from !== null)).toBe(true);
    const late = ok<{ birthday: { gifts: Array<{ eligible: boolean }> } }>(r, 'late_extras');
    expect(late.birthday.gifts.every((g) => !g.eligible)).toBe(true);
    const staff = ok<{ birthday: { gifts: Array<{ window_from: string | null }>; counts_from: string | null } }>(r, 'staff_extras');
    expect(staff.birthday.gifts.every((g) => g.window_from === null)).toBe(true);
    expect(staff.birthday.counts_from).toBeNull();
  });

  it('changing the birth date restarts the 30 days', () => {
    const r = run('lcg-birthday-move', [
      GUEST('g'),
      T('set', 'g', `select app.set_my_birth_date(date '1990-01-01')`),
      Q('stamped', `select to_jsonb(birth_date_set_at > now() - interval '1 minute') from profiles where id = {{g}}::uuid`),
      T('same', 'g', `select app.set_my_birth_date(date '1990-01-01')`),
      T('clear', 'g', `select app.set_my_birth_date(null)`),
      Q('cleared', `select to_jsonb(birth_date_set_at is null) from profiles where id = {{g}}::uuid`),
    ]);
    expect(ok(r, 'stamped')).toBe(true);
    expect(ok(r, 'cleared')).toBe(true);
  });
});

describe.skipIf(!docker)('free with (0445)', () => {
  it('one tea or water free per dessert, dearest first, for the card that holds it', () => {
    const r = run('lcg-with', [
      PERK('with', 'LCG Blue', 'free_with', `jsonb_build_object('triggerCategoryIds', jsonb_build_array(pg_temp.var('desserts')), 'triggerItemIds', '[]'::jsonb, 'freeCategoryIds', '[]'::jsonb, 'freeItemIds', jsonb_build_array(pg_temp.var('tea'), pg_temp.var('water')))`),
      GUEST('blue'),
      PTS('blue', 1200),
      GUEST('green'),
      PTS('green', 300),
      TAB('b1', 'blue'),
      LINE('b1_cake', 'b1', 'cake', 5000, 2),
      LINE('b1_tea', 'b1', 'tea', 1500, 2),
      LINE('b1_water', 'b1', 'water', 500, 1),
      CLAIM('b1'),
      REFRESH('b1_ref', 'b1'),
      DETAIL('b1_detail', 'b1', ['b1_cake', 'b1_tea', 'b1_water']),
      TAB('g1', 'green'),
      LINE('g1_cake', 'g1', 'cake', 5000, 1),
      LINE('g1_tea', 'g1', 'tea', 1500, 1),
      CLAIM('g1'),
      REFRESH('g1_ref', 'g1'),
      DETAIL('g1_detail', 'g1', ['g1_cake', 'g1_tea']),
    ]);
    expect(ok<Row[]>(r, 'b1_detail')).toEqual([{ line: 'b1_tea', kind: 'free_with', units: 2, amount: 3000 }]);
    expect(ok<Row[]>(r, 'g1_detail')).toEqual([]);
  });
});

describe.skipIf(!docker)('the drink card (0445)', () => {
  it('stamps paid drinks at the settle, frees the dearest drink when full, and spends the stamps', () => {
    const r = run('lcg-stamps', [
      CARD_ON(8),
      PERK('six', 'LCG Blue', 'stamp_size', `'{"size":6}'::jsonb`),
      GUEST('blue'),
      PTS('blue', 1200),
      GUEST('plain'),
      // Blue: 5 lattes and a water (water never stamps) settle: 5 stamps.
      TAB('b1', 'blue'),
      LINE('b1_latte', 'b1', 'latte', 4000, 5),
      LINE('b1_water', 'b1', 'water', 500, 1),
      REFRESH('b1_ref', 'b1'),
      SETTLE('b1'),
      STAMPS('after_b1', 'blue'),
      // Next bill: not full yet (5 of 6), nothing free; one mojito settles: 6.
      TAB('b2', 'blue'),
      LINE('b2_mojito', 'b2', 'mojito', 6000, 1),
      REFRESH('b2_ref', 'b2'),
      DETAIL('b2_detail', 'b2', ['b2_mojito']),
      SETTLE('b2'),
      // Full at 6: the dearest drink (the mojito) is free; the latte stamps; the settle spends 6.
      Q('probe', `select jsonb_build_object('bal', app.loyalty_stamp_balance({{blue}}::uuid), 'size', app.loyalty_stamp_size({{blue}}::uuid), 'floor', app.loyalty_tier_floor({{blue}}::uuid))`),
      TAB('b3', 'blue'),
      LINE('b3_latte', 'b3', 'latte', 4000, 1),
      LINE('b3_mojito', 'b3', 'mojito', 6000, 1),
      // Full, but nothing is free until the member presses Redeem (2026-11-15).
      REFRESH('b3_unclaimed', 'b3'),
      DETAIL('b3_detail_unclaimed', 'b3', ['b3_latte', 'b3_mojito']),
      T('b3_extras_ready', 'blue', `select app.my_card_extras()`),
      T('b3_claim', 'blue', `select app.claim_card_reward('stamp')`),
      REFRESH('b3_ref', 'b3'),
      DETAIL('b3_detail', 'b3', ['b3_latte', 'b3_mojito']),
      T('b3_extras', 'blue', `select app.my_card_extras()`),
      SETTLE('b3'),
      STAMPS('after_b3', 'blue'),
      // The plain card fills at the standard 8.
      T('plain_extras', 'plain', `select app.my_card_extras()`),
    ]);
    expect(ok(r, 'after_b1')).toEqual([{ kind: 'earn', delta: 5 }]);
    expect(ok(r, 'probe')).toEqual({ bal: 6, size: 6, floor: 1000 });
    expect(ok<Row[]>(r, 'b2_detail')).toEqual([]);
    expect(ok<Row[]>(r, 'b3_detail_unclaimed')).toEqual([]);
    expect(ok(r, 'b3_extras_ready')).toMatchObject({ stamps: { ready: true, held: false, claimed_until: null } });
    expect((ok(r, 'b3_claim') as { stamps: { claimed_until: string | null } }).stamps.claimed_until).not.toBeNull();
    ok(r, 'b3_ref');
    expect(ok<Row[]>(r, 'b3_detail')).toEqual([{ line: 'b3_mojito', kind: 'stamp', units: 1, amount: 6000 }]);
    expect(ok(r, 'b3_extras')).toMatchObject({ stamps: { enabled: true, count: 6, size: 6, ready: true, held: true } });
    expect(ok(r, 'after_b3')).toEqual([
      { kind: 'earn', delta: 5 },
      { kind: 'earn', delta: 1 },
      { kind: 'earn', delta: 1 },
      { kind: 'redeem', delta: -6 },
    ]);
    expect(ok(r, 'plain_extras')).toMatchObject({ stamps: { size: 8, count: 0, ready: false } });
  });

  it('stamps nothing while the card is off', () => {
    const r = run('lcg-stamps-off', [
      GUEST('g'),
      TAB('t1', 'g'),
      LINE('t1_latte', 't1', 'latte', 4000, 3),
      SETTLE('t1'),
      STAMPS('stamps', 'g'),
    ]);
    expect(ok(r, 'stamps')).toEqual([]);
  });
});

describe.skipIf(!docker)('card rings (0445)', () => {
  it('a card unlocks its ring, and losing the card or the privilege takes it off', () => {
    const r = run('lcg-rings', [
      PERK('ring', 'LCG Green', 'frame', `'{"frameId":"card-green"}'::jsonb`),
      GUEST('green'),
      PTS('green', 300),
      GUEST('plain'),
      T('frames', 'green', `select app.my_frames()`),
      T('wear', 'green', `select app.set_my_frame('card-green')`),
      T('wear_lines', 'green', `select app.set_my_frame('card-green', 'lines')`),
      T('plain_wear', 'plain', `select app.set_my_frame('card-green')`),
      // The points go: the card drops to the base tier and the ring comes off.
      PTS('green', -300),
      Q('after_drop', `select to_jsonb(avatar_frame) from profiles where id = {{green}}::uuid`),
      PTS('green', 300),
      T('wear_again', 'green', `select app.set_my_frame('card-green')`),
      T('remove', 'owner', `select jsonb_build_object('removed', true) from (select app.delete_loyalty_tier_perk({{ring}}::uuid)) x`),
      Q('after_remove', `select to_jsonb(avatar_frame) from profiles where id = {{green}}::uuid`),
    ]);
    const frames = ok<{ frames: Array<{ id: string; unlocked: boolean; card: { name_en: string } | null }> }>(r, 'frames');
    expect(frames.frames.find((f) => f.id === 'card-green')).toMatchObject({ unlocked: true, card: { name_en: 'LCG Green' } });
    expect(frames.frames.find((f) => f.id === 'card-blue')).toMatchObject({ unlocked: false, card: null });
    expect(ok(r, 'wear')).toBeTruthy();
    expect(refused(r, 'wear_lines')).toMatch(/^FRAME_INVALID/);
    expect(refused(r, 'plain_wear')).toMatch(/^FRAME_LOCKED/);
    expect(ok(r, 'after_drop')).toBe('brand-green');
    expect(ok(r, 'wear_again')).toBeTruthy();
    ok(r, 'remove');
    expect(ok(r, 'after_remove')).toBe('brand-green');
  });
});

describe.skipIf(!docker)('monthly and card-up gifts (0445)', () => {
  it('a monthly gift once a month; a card-up gift only for the card just reached', () => {
    const r = run('lcg-monthly-cardup', [
      PERK('monthly', 'LCG Blue', 'gift', `jsonb_build_object('when', 'monthly', 'target', 'items', 'categoryIds', jsonb_build_array(pg_temp.var('drinks')), 'itemIds', '[]'::jsonb)`),
      PERK('green_up', 'LCG Green', 'gift', `jsonb_build_object('when', 'card_up', 'target', 'items', 'categoryIds', jsonb_build_array(pg_temp.var('drinks')), 'itemIds', '[]'::jsonb, 'days', 30)`),
      GUEST('blue'),
      PTS('blue', 1200),
      GUEST('green'),
      PTS('green', 300),
      // Blue: the monthly drink; Green's card-up gift is not Blue's (they reached Blue).
      TAB('b1', 'blue'),
      LINE('b1_latte', 'b1', 'latte', 4000, 1),
      CLAIM('b1'),
      REFRESH('b1_ref', 'b1'),
      DETAIL('b1_detail', 'b1', ['b1_latte']),
      SETTLE('b1'),
      TAB('b2', 'blue'),
      LINE('b2_latte', 'b2', 'latte', 4000, 1),
      CLAIM('b2'),
      REFRESH('b2_ref', 'b2'),
      DETAIL('b2_detail', 'b2', ['b2_latte']),
      // Green: just moved up, the card-up drink once.
      TAB('g1', 'green'),
      LINE('g1_mojito', 'g1', 'mojito', 6000, 1),
      CLAIM('g1'),
      REFRESH('g1_ref', 'g1'),
      DETAIL('g1_detail', 'g1', ['g1_mojito']),
      T('green_extras', 'green', `select app.my_card_extras()`),
      SETTLE('g1'),
      TAB('g2', 'green'),
      LINE('g2_mojito', 'g2', 'mojito', 6000, 1),
      CLAIM('g2'),
      REFRESH('g2_ref', 'g2'),
      DETAIL('g2_detail', 'g2', ['g2_mojito']),
      Q('up_at', `select to_jsonb(tier_up_at is not null) from loyalty_accounts where profile_id = {{green}}::uuid`),
    ]);
    expect(ok<Row[]>(r, 'b1_detail')).toEqual([{ line: 'b1_latte', kind: 'gift', units: 1, amount: 4000 }]);
    expect(ok<Row[]>(r, 'b2_detail')).toEqual([]);
    expect(ok<Row[]>(r, 'g1_detail')).toEqual([{ line: 'g1_mojito', kind: 'gift', units: 1, amount: 6000 }]);
    expect(ok(r, 'green_extras')).toMatchObject({ gifts: [{ when: 'card_up', target: 'items', used: true }] });
    expect(ok<Row[]>(r, 'g2_detail')).toEqual([]);
    expect(ok(r, 'up_at')).toBe(true);
  });
});

describe.skipIf(!docker)('a birthday court hour (0445)', () => {
  it('takes one hour off the booking the bill belongs to, and comes back when the booking is cancelled', () => {
    const r = run('lcg-court-hour', [
      PERK('bday_court', 'LCG Blue', 'gift', `jsonb_build_object('when', 'birthday', 'target', 'court_hour', 'categoryIds', '[]'::jsonb, 'itemIds', '[]'::jsonb, 'days', 7)`),
      GUEST('blue'),
      PTS('blue', 1200),
      BIRTHDAY('blue', 60),
      BOOKING('res', 'blue', 2, 40000),
      TAB('t1', 'blue', 'res'),
      // Not redeemed yet: the booking keeps its fee.
      REFRESH('ref_unclaimed', 't1'),
      CLAIM('t1'),
      REFRESH('ref', 't1'),
      Q('gift', `select to_jsonb(amount_iqd) from reservation_card_gifts where reservation_id = {{res}}::uuid`),
      Q('left', `select to_jsonb(app.court_fee_remaining({{res}}::uuid))`),
      T('benefits', 'cashier', `select app.loyalty_tab_benefits({{t1}}::uuid)`),
      REFRESH('ref_again', 't1'),
      // A second booking the same week: the gift is used.
      BOOKING('res2', 'blue', 1, 20000),
      TAB('t2', 'blue', 'res2'),
      REFRESH('ref2', 't2'),
      Q('gift2', `select to_jsonb(count(*)) from reservation_card_gifts where reservation_id = {{res2}}::uuid`),
      // The first booking is cancelled: the hour is free again for the next.
      X(`update reservations set status = 'cancelled' where id = {{res}}::uuid`),
      REFRESH('ref3', 't2'),
      Q('gift3', `select to_jsonb(amount_iqd) from reservation_card_gifts where reservation_id = {{res2}}::uuid`),
    ]);
    expect(ok(r, 'ref_unclaimed')).toMatchObject({ changed: false });
    expect(ok(r, 'ref')).toMatchObject({ changed: true });
    expect(ok(r, 'gift')).toBe(20000);
    expect(ok(r, 'left')).toBe(20000);
    expect(ok(r, 'benefits')).toMatchObject({ court_gift: { amount_iqd: 20000, name_en: 'LCG bday_court' } });
    expect(ok(r, 'ref_again')).toMatchObject({ changed: false });
    expect(ok(r, 'gift2')).toBe(0);
    expect(ok(r, 'gift3')).toBe(20000);
  });
});

describe.skipIf(!docker)('a free size upgrade (0445)', () => {
  it('charges the next size down on every unit, and nothing on the smallest size', () => {
    const r = run('lcg-size-up', [
      PERK('upgrade', 'LCG Blue', 'size_upgrade', `jsonb_build_object('categoryIds', jsonb_build_array(pg_temp.var('drinks')), 'itemIds', '[]'::jsonb)`),
      SIZE('small', 'latte', 3000),
      SIZE('medium', 'latte', 4000),
      SIZE('large', 'latte', 5500),
      GUEST('blue'),
      PTS('blue', 1200),
      TAB('b1', 'blue'),
      VLINE('b1_large', 'b1', 'latte', 5500, 2, 'large'),
      VLINE('b1_small', 'b1', 'latte', 3000, 1, 'small'),
      REFRESH('ref', 'b1'),
      DETAIL('detail', 'b1', ['b1_large', 'b1_small']),
    ]);
    expect(ok<Row[]>(r, 'detail')).toEqual([{ line: 'b1_large', kind: 'size_upgrade', units: 2, amount: 3000 }]);
  });
});

describe.skipIf(!docker)('Redeem in the app (2026-11-15)', () => {
  it('the guest presses Redeem, a till can press it for a member without the app, and nothing is taken twice', () => {
    const r = run('lcg-redeem', [
      PERK('monthly', 'LCG Blue', 'gift', `jsonb_build_object('when', 'monthly', 'target', 'items', 'categoryIds', jsonb_build_array(pg_temp.var('drinks')), 'itemIds', '[]'::jsonb)`),
      GUEST('blue'),
      PTS('blue', 1200),
      GUEST('blue2'),
      PTS('blue2', 1200),
      GUEST('plain'),
      T('plain_drink', 'plain', `select app.claim_card_reward('stamp')`),
      T('bad_kind', 'blue', `select app.claim_card_reward('points')`),
      T('no_perk', 'blue', `select app.claim_card_reward('gift')`),
      // Before the press the gift waits; after it the next bill frees the drink.
      TAB('t1', 'blue'),
      LINE('t1_latte', 't1', 'latte', 4000, 1),
      REFRESH('t1_before', 't1'),
      DETAIL('t1_detail_before', 't1', ['t1_latte']),
      T('claim', 'blue', `select app.claim_card_reward('gift', {{monthly}}::uuid)`),
      REFRESH('t1_ref', 't1'),
      DETAIL('t1_detail', 't1', ['t1_latte']),
      SETTLE('t1'),
      T('again', 'blue', `select app.claim_card_reward('gift', {{monthly}}::uuid)`),
      // A till presses it for a member without the app; a guest cannot use the till's call.
      TAB('t2', 'blue2'),
      LINE('t2_latte', 't2', 'latte', 4000, 1),
      T('till', 'cashier', `select app.claim_card_reward_for_tab({{t2}}::uuid, 'gift', {{monthly}}::uuid)`),
      DETAIL('t2_detail', 't2', ['t2_latte']),
      T('till_guest', 'blue2', `select app.claim_card_reward_for_tab({{t2}}::uuid, 'gift', {{monthly}}::uuid)`),
      TAB('t3'),
      T('till_nobody', 'cashier', `select app.claim_card_reward_for_tab({{t3}}::uuid, 'gift', {{monthly}}::uuid)`),
      Q('audit', `select to_jsonb(count(*)) from audit_log where action = 'loyalty.claim' and entity_id = {{blue2}}`),
    ]);
    expect(refused(r, 'plain_drink')).toBe('REWARD_NOT_READY');
    expect(refused(r, 'bad_kind')).toBe('INVALID_ARGUMENT');
    expect(refused(r, 'no_perk')).toBe('INVALID_ARGUMENT');
    expect(ok<Row[]>(r, 't1_detail_before')).toEqual([]);
    const claimed = ok<{ gifts: Array<{ perk_id: string; claimed_until: string | null }> }>(r, 'claim');
    expect(claimed.gifts[0]?.claimed_until).not.toBeNull();
    expect(ok<Row[]>(r, 't1_detail')).toEqual([{ line: 't1_latte', kind: 'gift', units: 1, amount: 4000 }]);
    expect(refused(r, 'again')).toBe('REWARD_NOT_READY');
    expect(ok(r, 'till')).toMatchObject({ lines: [{ kind: 'gift', units: 1, amount_iqd: 4000 }] });
    expect(ok<Row[]>(r, 't2_detail')).toEqual([{ line: 't2_latte', kind: 'gift', units: 1, amount: 4000 }]);
    expect(refused(r, 'till_guest')).toBe('FORBIDDEN');
    expect(refused(r, 'till_nobody')).toBe('INVALID_ARGUMENT');
    expect(ok(r, 'audit')).toBe(1);
  });
});

describe.skipIf(!docker)('buy one, get one (0445)', () => {
  const BOGO = (scope: string, value = 100, id = 'null') =>
    `select to_jsonb(app.upsert_promotion(p_id => ${id}::uuid, p_name_en => 'LCG bogo', p_name_ar => 'اشترِ واحصل',
       p_type => 'free_item', p_value => ${value}, p_scope => ${scope}))`;
  const AMOUNT = (label: string, tab: string) =>
    T(label, 'cashier', `select coalesce((select (e->>'amountIqd')::int from jsonb_array_elements(app.eligible_promotions({{${tab}}}::uuid)) e
                                 where e->>'name_en' = 'LCG bogo'), 0)`);

  it('gives the cheapest units given, one per earning unit, never one unit both ways, and checks its shape', () => {
    const r = run('lcg-bogo', [
      T('no_get', 'owner', BOGO(`jsonb_build_object('buyItemIds', jsonb_build_array({{latte}}))`)),
      T('no_buy', 'owner', BOGO(`jsonb_build_object('itemIds', jsonb_build_array({{cake}}))`)),
      T('too_much', 'owner', BOGO(`jsonb_build_object('buyItemIds', jsonb_build_array({{latte}}), 'itemIds', jsonb_build_array({{cake}}))`, 101)),
      T('wrong_type', 'owner', `select to_jsonb(app.upsert_promotion(p_name_en => 'x', p_name_ar => 'x', p_type => 'percent', p_value => 10,
                                  p_scope => jsonb_build_object('buyItemIds', jsonb_build_array({{latte}}))))`),
      T('per_bill_bad', 'owner', BOGO(`jsonb_build_object('buyItemIds', jsonb_build_array({{latte}}), 'itemIds', jsonb_build_array({{cake}}), 'perBill', 11)`)),
      T('made', 'owner', BOGO(`jsonb_build_object('buyItemIds', jsonb_build_array({{latte}}), 'itemIds', jsonb_build_array({{cake}}))`)),
      KEEP('bogo_id', `select id::text from promotions where name_en = 'LCG bogo'`),
      Q('stored', `select scope - 'buyItemIds' - 'itemIds' from promotions where name_en = 'LCG bogo'`),
      // Cakes with no latte: nothing earns them.
      TAB('t0'),
      LINE('t0_cake', 't0', 'cake', 5000, 2),
      AMOUNT('t0_amount', 't0'),
      // Two lattes, cakes at 5,000 and 4,000: one a bill, the cheaper cake.
      TAB('t1'),
      LINE('t1_latte', 't1', 'latte', 4000, 2),
      LINE('t1_cake', 't1', 'cake', 5000, 1),
      LINE('t1_cake2', 't1', 'cake', 4000, 1),
      AMOUNT('t1_one', 't1'),
      // Two a bill at half price: both cakes, half off.
      T('two', 'owner', BOGO(`jsonb_build_object('buyItemIds', jsonb_build_array({{latte}}), 'itemIds', jsonb_build_array({{cake}}), 'perBill', 2)`, 50, '{{bogo_id}}')),
      AMOUNT('t1_two', 't1'),
      // Buy a cake, get a cake: one cake earns nothing, two give the cheaper one.
      T('same', 'owner', BOGO(`jsonb_build_object('buyItemIds', jsonb_build_array({{cake}}), 'itemIds', jsonb_build_array({{cake}}))`, 100, '{{bogo_id}}')),
      TAB('t2'),
      LINE('t2_cake', 't2', 'cake', 5000, 1),
      AMOUNT('t2_one_cake', 't2'),
      LINE('t2_cake2', 't2', 'cake', 4000, 1),
      AMOUNT('t2_two_cakes', 't2'),
      // Earned by a court booking (no buy ids): the court check is eligibility's; the base is the cheapest given.
      Q('court_base', `select to_jsonb(app.promotion_base_iqd({{t1}}::uuid, jsonb_build_object('itemIds', jsonb_build_array({{cake}}), 'perBill', 1)))`),
    ]);
    expect(refused(r, 'no_get')).toMatch(/^INVALID_VALUE/);
    expect(refused(r, 'no_buy')).toMatch(/^INVALID_VALUE/);
    expect(refused(r, 'too_much')).toMatch(/^INVALID_VALUE/);
    expect(refused(r, 'wrong_type')).toMatch(/^INVALID_VALUE/);
    expect(refused(r, 'per_bill_bad')).toMatch(/^INVALID_VALUE/);
    ok(r, 'made');
    expect(ok(r, 'stored')).toEqual({ perBill: 1 });
    expect(ok(r, 't0_amount')).toBe(0);
    expect(ok(r, 't1_one')).toBe(4000);
    ok(r, 'two');
    expect(ok(r, 't1_two')).toBe(4500);
    ok(r, 'same');
    expect(ok(r, 't2_one_cake')).toBe(0);
    expect(ok(r, 't2_two_cakes')).toBe(4000);
    expect(ok(r, 'court_base')).toBe(4000);
  });
});

describe.skipIf(!docker)('a deal\'s own QR (0445, 2026-11-15)', () => {
  const DEAL = (name: string, limits: string) =>
    X(`insert into promotions (name_en, name_ar, type, value, scope, limits, auto, enabled, in_app, created_by, venue_id)
       values ('LCG ${name}', 'عرض', 'percent', 20, jsonb_build_object('categoryIds', jsonb_build_array(pg_temp.var('drinks'))),
               ${limits}, false, true, true, pg_temp.var('owner')::uuid,
               (select id from venues where is_active order by created_at limit 1))`);
  const ID = (name: string) => KEEP(`${name}_id`, `select id::text from promotions where name_en = 'LCG ${name}'`);

  it('Redeem gives one live code; the till scans it once onto that member\'s bill, or refuses and keeps nothing', () => {
    const r = run('lcg-deal-qr', [
      DEAL('drinks', `'{"perCustomer": 1}'::jsonb`),
      ID('drinks'),
      DEAL('big', `'{"minSpendIqd": 100000}'::jsonb`),
      ID('big'),
      GUEST('blue'),
      PTS('blue', 300),
      GUEST('other'),
      T('first', 'blue', `select app.redeem_deal({{drinks_id}}::uuid)`),
      RES('first_code', 'first', 'voucher,code'),
      T('second', 'blue', `select app.redeem_deal({{drinks_id}}::uuid)`),
      RES('code', 'second', 'voucher,code'),
      T('mine', 'blue', `select app.my_deal_vouchers()`),
      T('nobody', 'cashier', `select app.use_deal_voucher(gen_random_uuid(), 'TPD-0000')`),
      // The first code was cancelled by the second Redeem.
      TAB('t1'),
      LINE('t1_latte', 't1', 'latte', 4000, 2),
      T('old', 'cashier', `select app.use_deal_voucher({{t1}}::uuid, {{first_code}})`),
      T('bogus', 'cashier', `select app.use_deal_voucher({{t1}}::uuid, 'TPD-ZZZZZZZZZZZZ')`),
      // Another member's bill: refused.
      TAB('t_other', 'other'),
      LINE('t_other_latte', 't_other', 'latte', 4000, 1),
      T('wrong_member', 'cashier', `select app.use_deal_voucher({{t_other}}::uuid, {{code}})`),
      // The bill with nobody takes the member and the deal; typed without dashes is the same code.
      T('used', 'cashier', `select app.use_deal_voucher({{t1}}::uuid, replace({{code}}, '-', ''))`),
      Q('t1_customer', `select to_jsonb(customer_id = {{blue}}::uuid) from tabs where id = {{t1}}::uuid`),
      Q('t1_promo', `select to_jsonb(amount_iqd) from tab_adjustments where tab_id = {{t1}}::uuid and promotion_id = {{drinks_id}}::uuid`),
      T('again', 'cashier', `select app.use_deal_voucher({{t1}}::uuid, {{code}})`),
      // Used once already (perCustomer 1): no new code.
      T('used_up', 'blue', `select app.redeem_deal({{drinks_id}}::uuid)`),
      // A bill that cannot take the deal (under its minimum): refused, nothing kept, the code still live.
      T('big_code', 'blue', `select app.redeem_deal({{big_id}}::uuid)`),
      RES('big', 'big_code', 'voucher,code'),
      TAB('t2'),
      LINE('t2_latte', 't2', 'latte', 4000, 1),
      T('too_small', 'cashier', `select app.use_deal_voucher({{t2}}::uuid, {{big}})`),
      Q('t2_after', `select jsonb_build_object('customer', customer_id is not null,
                       'promo', exists (select 1 from tab_adjustments a where a.tab_id = {{t2}}::uuid and a.promotion_id is not null))
                       from tabs where id = {{t2}}::uuid`),
      Q('big_status', `select to_jsonb(status) from loyalty_deal_vouchers where code = {{big}}`),
      // Past its 15 minutes and the minute of grace.
      X(`update loyalty_deal_vouchers set created_at = now() - interval '20 minutes', expires_at = now() - interval '5 minutes' where code = {{big}}`),
      T('late', 'cashier', `select app.use_deal_voucher({{t2}}::uuid, {{big}})`),
      T('guest_till', 'blue', `select app.use_deal_voucher({{t2}}::uuid, {{big}})`),
      KEEP('big_vid', `select id::text from loyalty_deal_vouchers where code = {{big}}`),
      T('cancel', 'blue', `select app.cancel_deal_voucher({{big_vid}}::uuid)`),
    ]);
    const first = ok<{ voucher: { code: string; status: string; expires_at: string; created_at: string } }>(r, 'first');
    expect(first.voucher.code).toMatch(/^TPD-[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(first.voucher.status).toBe('active');
    expect(Date.parse(first.voucher.expires_at) - Date.parse(first.voucher.created_at)).toBe(15 * 60 * 1000);
    const mine = ok<{ vouchers: Array<{ status: string }> }>(r, 'mine');
    expect(mine.vouchers.map((v) => v.status)).toEqual(['active', 'cancelled']);
    expect(refused(r, 'nobody')).toBe('TAB_NOT_FOUND');
    expect(refused(r, 'old')).toBe('VOUCHER_USED');
    expect(refused(r, 'bogus')).toBe('VOUCHER_NOT_FOUND');
    expect(refused(r, 'wrong_member')).toBe('VOUCHER_OTHER_MEMBER');
    expect(ok(r, 'used')).toMatchObject({ amountIqd: 1600 });
    expect(ok(r, 't1_customer')).toBe(true);
    expect(ok(r, 't1_promo')).toBe(1600);
    expect(refused(r, 'again')).toBe('VOUCHER_USED');
    expect(refused(r, 'used_up')).toBe('DEAL_USED');
    expect(refused(r, 'too_small')).toBe('DEAL_NOT_ON_BILL');
    expect(ok(r, 't2_after')).toEqual({ customer: false, promo: false });
    expect(ok(r, 'big_status')).toBe('active');
    expect(refused(r, 'late')).toBe('VOUCHER_EXPIRED');
    expect(refused(r, 'guest_till')).toBe('FORBIDDEN');
    const after = ok<{ vouchers: Array<{ status: string }> }>(r, 'cancel');
    expect(after.vouchers.some((v) => v.status === 'active')).toBe(false);
  });
});
