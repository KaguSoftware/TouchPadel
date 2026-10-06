/**
 * Loyalty promotions and the nightly run, the 0309 review fixes
 * (20261006000309_loyalty_promotions_nightly.sql):
 *
 *   * c6/c16 a tier promotion names its tier by id (limits.tierMin): the owner's upsert and the
 *     price-protocol validator take it, refuse an unknown tier or a number, and keep it on an edit;
 *     eligibility follows the tiers' points, and the tiers' sort is renumbered to match;
 *   * c7 apply_best_promotion drops a promotion that no longer qualifies, and the drop stands;
 *   * c14 a promotion takes at most what the other discounts leave;
 *   * c15 two tills applying one single-use code at once: one wins (committed, two connections);
 *   * c8 the inactivity expiry waits while loyalty is off and counts from the switch-on;
 *   * c31 the nightly per account: an unchanged cache skipped, a drifted one rebuilt, a held
 *     account skipped without waiting, the cron job CALLs the procedure that commits per batch.
 *
 * The in-transaction cases are rolled-back psql transactions (stores-harness `scenario`), with
 * the order_items foreign keys to the menu dropped inside them; the two committed cases plant
 * their own rows and remove what they can. Without docker the suite skips.
 */
import { describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import {
  asStaff,
  dockerReachable,
  KEEP,
  ok,
  psql,
  psqlSession,
  Q,
  refused,
  scenario,
  T,
  waitForSleeper,
  X,
  type Results,
} from './stores-harness';
import { SEED_STAFF_IDS, VENUE_A_ID } from './helpers';

const up = await stackAvailable();
const docker = up && dockerReachable();

function phone(): string {
  return `+96477${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
}

let keySeq = 0;
const KEY = (tag: string) => `'lp-${tag}-${Date.now().toString(36)}-${(keySeq++).toString(36)}'`;

const PRE = String.raw`
set constraints all immediate;

do $drop_fk$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
      from pg_constraint c
     where c.contype = 'f'
       and c.conrelid = 'public.order_items'::regclass
       and c.confrelid in ('public.menu_items'::regclass, 'public.menu_item_variants'::regclass)
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $drop_fk$;

create function pg_temp.var(p_name text) returns text language sql as $f$
  select val from pg_temp.vars where name = p_name
$f$;

create function pg_temp.guest(p_name text, p_phone text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, raw_user_meta_data, aud, role, phone, phone_confirmed_at)
  values (v, 'lp-' || p_name || '-' || v || '@test.touch.local', jsonb_build_object('full_name', 'LP ' || p_name),
          'authenticated', 'authenticated', app.phone_digits(p_phone), now());
  insert into pg_temp.vars values (p_name, v::text) on conflict (name) do update set val = excluded.val;
  return v;
end $f$;

-- An open café tab at branch A with one line of p_goods (a made-up item).
create function pg_temp.tab(p_name text, p_customer text, p_goods bigint) returns uuid language plpgsql as $f$
declare v uuid; o uuid; v_day uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  select d.id into v_day from day_sessions d where d.venue_id = pg_temp.var('venue')::uuid and d.status = 'open'
   order by d.opened_at desc limit 1;
  if v_day is null then
    insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd)
    values (pg_temp.var('venue')::uuid, date '2001-01-01' + (random() * 3000)::int, 'open',
            pg_temp.var('manager')::uuid, 0)
    returning id into v_day;
  end if;
  insert into tabs (venue_id, day_session_id, kind, status, label, opened_by_staff_id, customer_id)
  values (pg_temp.var('venue')::uuid, v_day, 'cafe', 'open', 'LP ' || p_name, pg_temp.var('cashier')::uuid,
          case when p_customer is not null then pg_temp.var(p_customer)::uuid end)
  returning id into v;
  insert into orders (tab_id, source, placed_by_staff_id, venue_id)
  values (v, 'till', pg_temp.var('cashier')::uuid, pg_temp.var('venue')::uuid)
  returning id into o;
  insert into order_items (order_id, menu_item_id, variant_id, qty, unit_price_iqd, line_total_iqd)
  values (o, gen_random_uuid(), gen_random_uuid(), 1, p_goods, p_goods);
  insert into pg_temp.vars values (p_name, v::text) on conflict (name) do update set val = excluded.val;
  return v;
end $f$;

-- Points earned p_ago before now (a made-up tab).
create function pg_temp.pts(p_guest text, p_delta int, p_ago interval default '0'::interval) returns void
language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  insert into loyalty_ledger (profile_id, delta, kind, source_kind, source_id, note, created_at)
  values (pg_temp.var(p_guest)::uuid, p_delta, 'earn', 'tab', gen_random_uuid(), 'fixture', now() - p_ago);
end $f$;

-- A tab discount that is not a promotion (a loyalty redemption's shape).
create function pg_temp.disc(p_tab text, p_amount bigint) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  insert into tab_adjustments (tab_id, kind, value, amount_iqd, applied_by, authorized_by, reason_code)
  values (pg_temp.var(p_tab)::uuid, 'discount_amount', p_amount, p_amount, pg_temp.var('cashier')::uuid,
          pg_temp.var('cashier')::uuid, 'loyalty_points');
end $f$;

-- A statement as postgres, its refusal recorded instead of raised.
create function pg_temp.try(p_label text, p_sql text) returns void language plpgsql as $f$
declare v_res jsonb; v_msg text; v_hint text;
begin
  begin
    execute pg_temp.sub(p_sql) into v_res;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v_res));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'hint', nullif(v_hint, '')));
  end;
end $f$;

-- Only this scenario's promotions compete.
update promotions set enabled = false where enabled;
update loyalty_settings set enabled = true, enabled_at = null, inactivity_expiry_months = null where id;
`;

const GUEST = (name: string) => `select pg_temp.guest('${name}', '${phone()}');`;
const TAB = (name: string, customer: string | null, goods: number) =>
  X(`select pg_temp.tab('${name}', ${customer ? `'${customer}'` : 'null'}, ${goods})`);
const PTS = (guest: string, delta: number, ago = '0') =>
  X(`select pg_temp.pts('${guest}', ${delta}, '${ago}'::interval)`);
const DISC = (tab: string, amount: number) => X(`select pg_temp.disc('${tab}', ${amount})`);
const TRY = (label: string, sql: string) => `select pg_temp.try('${label}', $q$${sql}$q$);`;
const TIER = (label: string, name: string, min: number, sort: number) =>
  T(
    label,
    'owner',
    `select app.upsert_loyalty_tier('{"name_en":"${name}","name_ar":"${name}","min_points_12m":${min},"sort":${sort}}'::jsonb)`,
  );
/** app.upsert_promotion as the owner: an automatic percent promotion with these limits. */
const PROMO = (
  label: string,
  limits: string,
  o: { id?: string; name?: string; value?: number } = {},
) =>
  T(
    label,
    'owner',
    `select to_jsonb(app.upsert_promotion(p_id => ${o.id ? `{{${o.id}}}::uuid` : 'null'},
       p_name_en => '${o.name ?? 'LP promo'}', p_name_ar => 'عرض', p_type => 'percent',
       p_value => ${o.value ?? 10}, p_limits => ${limits}))`,
  );
const KEEP_RES = (name: string, label: string) =>
  KEEP(name, `select res #>> '{data}' from pg_temp.out where label = '${label}'`);
const ELIG = (label: string, tab: string) =>
  T(label, 'cashier', `select app.eligible_promotions({{${tab}}}, null)`);
const APPLY = (label: string, tab: string) =>
  T(label, 'cashier', `select app.apply_best_promotion({{${tab}}}, null, ${KEY(label)}, null)`);
const VALIDATE = (limits: string) =>
  `select app.price_promo_promotion(jsonb_build_object('name_en', 'P', 'name_ar', 'ب', 'type', 'percent',
     'value', 10, 'weekdays', '[]'::jsonb, 'scope', '{}'::jsonb, 'limits', ${limits}), null)->'limits'`;

function run(tag: string, body: string[]): Results {
  return scenario(tag, [PRE, ...body]);
}

const ids = (r: Results, l: string) =>
  ok<Array<{ promotionId: string }>>(r, l).map((x) => x.promotionId);

// ── c6/c16: the tier, by id ─────────────────────────────────────────────────

describe.skipIf(!docker)('a tier promotion names its tier by id (c6, c16)', () => {
  it('takes tierMin as a tier id, refuses anything else, keeps it on an edit, and ranks tiers by points', () => {
    const r = run('lp-tier', [
      GUEST('base'),
      GUEST('silver_g'),
      GUEST('gold_g'),
      // Gold first, then Silver below it: the sorts follow the points, not the order of creation.
      TIER('gold', 'Gold', 500, 1),
      TIER('silver', 'Silver', 100, 2),
      Q(
        'sorts',
        `select jsonb_object_agg(name_en, sort) from loyalty_tiers where name_en in ('Gold', 'Silver')`,
      ),
      KEEP('silver_id', `select id::text from loyalty_tiers where name_en = 'Silver'`),
      PROMO('promo', `jsonb_build_object('tierMin', {{silver_id}})`),
      KEEP_RES('promo_id', 'promo'),
      Q('stored', `select limits from promotions where id = {{promo_id}}::uuid`),
      PROMO('bad_number', `'{"tierMin": 1}'::jsonb`),
      PROMO('bad_unknown', `jsonb_build_object('tierMin', gen_random_uuid())`),
      // the price-protocol validator (a manager's proposal goes through it)
      TRY('proto', VALIDATE(`jsonb_build_object('tierMin', {{silver_id}})`)),
      TRY('proto_unknown', VALIDATE(`jsonb_build_object('tierMin', gen_random_uuid())`)),
      TRY('proto_number', VALIDATE(`'{"tierMin": 1}'::jsonb`)),
      PTS('silver_g', 150),
      PTS('gold_g', 600),
      TAB('t_base', 'base', 10000),
      TAB('t_silver', 'silver_g', 10000),
      TAB('t_gold', 'gold_g', 10000),
      TAB('t_none', null, 10000),
      ELIG('e_base', 't_base'),
      ELIG('e_silver', 't_silver'),
      ELIG('e_gold', 't_gold'),
      ELIG('e_none', 't_none'),
      // an edit (a new name) keeps the tier
      PROMO('edit', `jsonb_build_object('tierMin', {{silver_id}})`, {
        id: 'promo_id',
        name: 'LP renamed',
      }),
      ELIG('e_base_after_edit', 't_base'),
      ELIG('e_silver_after_edit', 't_silver'),
      // a legacy number (0306: a tier's sort) reads as that sort's tier: Gold's, after the renumber
      KEEP(
        'legacy',
        `insert into promotions (name_en, name_ar, type, value, auto, enabled, limits, created_by, venue_id)
         values ('LP legacy', 'قديم', 'percent', 5, true, true,
                 jsonb_build_object('tierMin', (select sort from loyalty_tiers where name_en = 'Gold')),
                 {{manager}}, null)
         returning id::text`,
      ),
      Q('legacy_id', `select to_jsonb({{legacy}}::uuid)`),
      ELIG('legacy_silver', 't_silver'),
      ELIG('legacy_gold', 't_gold'),
      // loyalty off: no tier promotion for anyone
      X(`update loyalty_settings set enabled = false where id`),
      ELIG('e_gold_off', 't_gold'),
      X(`update loyalty_settings set enabled = true where id`),
      // a tier's promotion link is no longer written
      T(
        'tier_link',
        'owner',
        `select app.upsert_loyalty_tier(jsonb_build_object('id', {{silver_id}}, 'promotion_id', {{promo_id}}))`,
      ),
      Q(
        'link_col',
        `select to_jsonb(promotion_id) from loyalty_tiers where id = {{silver_id}}::uuid`,
      ),
    ]);
    expect(ok(r, 'sorts')).toEqual({ Silver: 1, Gold: 2 });
    expect(ok(r, 'silver')).toMatchObject({ name_en: 'Silver', sort: 1 });
    const promo = ok<string>(r, 'promo');
    const silver = ok<{ tierMin: string }>(r, 'stored').tierMin;
    expect(silver).toMatch(/^[0-9a-f-]{36}$/);
    expect(refused(r, 'bad_number')).toMatch(/^INVALID_VALUE/);
    expect(refused(r, 'bad_unknown')).toMatch(/^INVALID_VALUE/);
    expect(ok(r, 'proto')).toEqual({ tierMin: silver });
    expect(refused(r, 'proto_unknown')).toBe('RECORD_INVALID:promotion.limits.tierMin');
    expect(refused(r, 'proto_number')).toBe('RECORD_INVALID:promotion.limits.tierMin');
    expect(ids(r, 'e_base')).not.toContain(promo);
    expect(ids(r, 'e_silver')).toContain(promo);
    expect(ids(r, 'e_gold')).toContain(promo);
    expect(ids(r, 'e_none')).not.toContain(promo);
    expect(ok(r, 'edit')).toBe(promo);
    expect(ids(r, 'e_base_after_edit')).not.toContain(promo);
    expect(ids(r, 'e_silver_after_edit')).toContain(promo);
    const legacy = ok<string>(r, 'legacy_id');
    expect(ids(r, 'legacy_gold')).toContain(legacy);
    expect(ids(r, 'legacy_silver')).not.toContain(legacy);
    expect(ids(r, 'e_gold_off')).not.toContain(promo);
    expect(ok(r, 'tier_link')).toMatchObject({ promotion_id: null });
    expect(ok(r, 'link_col')).toBeNull();
  });
});

describe.skipIf(!docker)('a tier a promotion names cannot be deleted (c6)', () => {
  it('refuses TIER_IN_USE while a promotion, on or off, names the tier, and deletes it once none does', () => {
    const DEL = (label: string) =>
      T(
        label,
        'owner',
        `with d as (select app.delete_loyalty_tier({{silver_id}}::uuid)) select to_jsonb(count(*)) from d`,
      );
    const r = run('lp-tier-del', [
      TIER('silver', 'Silver', 100, 1),
      KEEP('silver_id', `select id::text from loyalty_tiers where name_en = 'Silver'`),
      PROMO('promo', `jsonb_build_object('tierMin', {{silver_id}})`),
      KEEP_RES('promo_id', 'promo'),
      DEL('in_use'),
      // switched off, it still names the tier (its next edit would be refused)
      X(`update promotions set enabled = false where id = {{promo_id}}::uuid`),
      DEL('in_use_off'),
      // the promotion opened to everyone: the tier goes
      PROMO('cleared', `'{}'::jsonb`, { id: 'promo_id' }),
      DEL('deleted'),
      Q('gone', `select to_jsonb(count(*)) from loyalty_tiers where id = {{silver_id}}::uuid`),
      // a promotion cannot name it any more
      PROMO('dead', `jsonb_build_object('tierMin', {{silver_id}})`),
    ]);
    expect(refused(r, 'in_use')).toMatch(/^TIER_IN_USE/);
    expect(refused(r, 'in_use_off')).toMatch(/^TIER_IN_USE/);
    expect(ok(r, 'cleared')).toBe(ok<string>(r, 'promo'));
    expect(ok(r, 'deleted')).toBe(1);
    expect(ok(r, 'gone')).toBe(0);
    expect(refused(r, 'dead')).toMatch(/^INVALID_VALUE/);
  });
});

// ── c7: a promotion that no longer qualifies goes ───────────────────────────

describe.skipIf(!docker)('apply_best_promotion drops what no longer qualifies (c7)', () => {
  it('drops the tier promotion of a customer who no longer qualifies, and moves a kept one', () => {
    const r = run('lp-drop', [
      GUEST('gold1'),
      GUEST('gold2'),
      GUEST('plain'),
      TIER('gold', 'Gold', 500, 1),
      KEEP('gold_id', `select id::text from loyalty_tiers where name_en = 'Gold'`),
      PROMO('promo', `jsonb_build_object('tierMin', {{gold_id}})`, { value: 20 }),
      PTS('gold1', 600),
      PTS('gold2', 700),
      TAB('t1', 'gold1', 10000),
      APPLY('a1', 't1'),
      // the cashier attaches someone else (the plain guest): the next apply drops the 20%
      X(`update tabs set customer_id = {{plain}}::uuid where id = {{t1}}::uuid`),
      APPLY('a2', 't1'),
      Q(
        'left',
        `select jsonb_build_object(
           'redemptions', (select count(*) from promotion_redemptions where tab_id = {{t1}}::uuid),
           'adjustments', (select count(*) from tab_adjustments where tab_id = {{t1}}::uuid and promotion_id is not null),
           'audit', (select count(*) from audit_log where action = 'promotion.drop_ineligible'
                                                     and before->>'tab_id' = {{t1}}))`,
      ),
      // nothing on the tab to drop: still a plain refusal
      APPLY('a3', 't1'),
      // another Gold member: the promotion stays and its redemption follows the customer
      TAB('t2', 'gold1', 10000),
      APPLY('b1', 't2'),
      X(`update tabs set customer_id = {{gold2}}::uuid where id = {{t2}}::uuid`),
      APPLY('b2', 't2'),
      Q('gold2_id', `select to_jsonb({{gold2}}::uuid)`),
      Q(
        'b_customer',
        `select to_jsonb(customer_id) from promotion_redemptions where tab_id = {{t2}}::uuid`,
      ),
    ]);
    const promo = ok<string>(r, 'promo');
    expect(ok(r, 'a1')).toMatchObject({ promotionId: promo, amountIqd: 2000 });
    expect(ok(r, 'a2')).toMatchObject({
      promotionId: null,
      amountIqd: 0,
      dropped: true,
      refused: 'NO_ELIGIBLE_PROMOTION',
      replacedPromotionId: promo,
    });
    expect(ok(r, 'left')).toEqual({ redemptions: 0, adjustments: 0, audit: 1 });
    expect(refused(r, 'a3')).toBe('NO_ELIGIBLE_PROMOTION');
    expect(ok(r, 'b2')).toMatchObject({ promotionId: promo, unchanged: true });
    expect(ok<string>(r, 'b_customer')).toBe(ok<string>(r, 'gold2_id'));
  });
});

// ── c7 across the tracks: set_tab_customer reads tierMin as a tier id ───────

describe.skipIf(!docker)(
  'a customer change on a tab with a tier promotion (c7, the 0308 merge)',
  () => {
    it('swaps the customer without an error, and drops the promotion when set_tab_customer re-checks it', () => {
      const r = run('lp-swap', [
        GUEST('gold1'),
        GUEST('plain'),
        TIER('gold', 'Gold', 500, 1),
        KEEP('gold_id', `select id::text from loyalty_tiers where name_en = 'Gold'`),
        PROMO('promo', `jsonb_build_object('tierMin', {{gold_id}})`, { value: 20 }),
        PTS('gold1', 600),
        TAB('t1', 'gold1', 10000),
        APPLY('a1', 't1'),
        // 0308's re-check compared tierMin to a tier's sort as an int; tierMin is now a uuid.
        T('swap', 'cashier', `select app.set_tab_customer({{t1}}::uuid, {{plain}}::uuid)`),
        Q(
          'rechecks',
          `select to_jsonb(pg_get_functiondef('app.set_tab_customer(uuid, uuid)'::regprocedure)
                         like '%promotion_redemptions%')`,
        ),
        Q(
          'left',
          `select to_jsonb((select count(*) from promotion_redemptions where tab_id = {{t1}}::uuid))`,
        ),
      ]);
      expect(ok(r, 'a1')).toMatchObject({ promotionId: ok<string>(r, 'promo') });
      expect(ok(r, 'swap')).toMatchObject({ customer_id: expect.any(String) });
      // Before 0308 set_tab_customer does not look at promotions (the next apply drops it, c7 above).
      expect(ok<number>(r, 'left')).toBe(ok<boolean>(r, 'rechecks') ? 0 : 1);
    });
  },
);

// ── c14: never more than the bill has left ──────────────────────────────────

describe.skipIf(!docker)('a promotion takes at most what the other discounts leave (c14)', () => {
  it('caps the amount at the goods less the other discounts, and offers nothing when none is left', () => {
    const r = run('lp-cap', [
      PROMO('promo', `'{}'::jsonb`, { value: 50 }),
      // the whole bill already taken by points
      TAB('full', null, 10000),
      DISC('full', 10000),
      ELIG('e_full', 'full'),
      APPLY('a_full', 'full'),
      // 8,000 of 10,000 taken: 50% would be 5,000, only 2,000 is left
      TAB('part', null, 10000),
      DISC('part', 8000),
      ELIG('e_part', 'part'),
      APPLY('a_part', 'part'),
      Q(
        'part_sum',
        `select to_jsonb(sum(amount_iqd)) from tab_adjustments where tab_id = {{part}}::uuid`,
      ),
    ]);
    const promo = ok<string>(r, 'promo');
    expect(ids(r, 'e_full')).not.toContain(promo);
    expect(refused(r, 'a_full')).toBe('NO_ELIGIBLE_PROMOTION');
    expect(ok<Array<{ promotionId: string; amountIqd: number }>>(r, 'e_part')).toEqual([
      expect.objectContaining({ promotionId: promo, amountIqd: 2000 }),
    ]);
    expect(ok(r, 'a_part')).toMatchObject({ promotionId: promo, amountIqd: 2000 });
    expect(ok<number>(r, 'part_sum')).toBe(10000);
  });
});

// ── c8, c31: the nightly run ────────────────────────────────────────────────

describe.skipIf(!docker)('the nightly run (c8, c31)', () => {
  it('expires nothing while loyalty is off, counts from the switch-on, and rebuilds only a drifted cache', () => {
    const r = run('lp-night', [
      GUEST('g1'),
      GUEST('g2'),
      PTS('g1', 100, '13 months'),
      PTS('g2', 40),
      X(`update loyalty_settings set enabled = false, inactivity_expiry_months = 12 where id`),
      Q('off', `select app.loyalty_nightly()`),
      Q(
        'off_balance',
        `select to_jsonb(balance) from loyalty_accounts where profile_id = {{g1}}::uuid`,
      ),
      // switched back on: a year of pause is not a year of inactivity
      T('on', 'owner', `select app.set_loyalty_settings('{"enabled": true}'::jsonb)`),
      Q(
        'enabled_at',
        `select to_jsonb(enabled_at > now() - interval '1 minute') from loyalty_settings where id`,
      ),
      Q('after_on', `select app.loyalty_nightly()`),
      Q(
        'after_on_balance',
        `select to_jsonb(balance) from loyalty_accounts where profile_id = {{g1}}::uuid`,
      ),
      // a year after the switch-on, the idle balance goes
      X(`update loyalty_settings set enabled_at = now() - interval '13 months' where id`),
      Q('later', `select app.loyalty_nightly()`),
      Q(
        'later_balance',
        `select to_jsonb(balance) from loyalty_accounts where profile_id = {{g1}}::uuid`,
      ),
      // a drifted cache is rebuilt; a matching one is left alone
      X(`update loyalty_accounts set balance = 999 where profile_id = {{g2}}::uuid`),
      Q('drift', `select app.loyalty_nightly()`),
      Q(
        'g2_balance',
        `select to_jsonb(balance) from loyalty_accounts where profile_id = {{g2}}::uuid`,
      ),
      Q('again', `select app.loyalty_nightly()`),
      // Per account: the stack's other accounts (an adjustment in the window is always rebuilt) are not this test's.
      Q('g1_again', `select to_jsonb(app.loyalty_nightly_one({{g1}}::uuid, null, null))`),
      Q('g2_again', `select to_jsonb(app.loyalty_nightly_one({{g2}}::uuid, null, null))`),
      Q(
        'cron',
        `select to_jsonb(command) from cron.job where jobname = 'tp_loyalty_nightly' and schedule = '15 0 * * *'`,
      ),
    ]);
    type Night = { expired: number; recomputed: number; unchanged: number; error: number };
    expect(ok<Night>(r, 'off').expired).toBe(0);
    expect(ok<number>(r, 'off_balance')).toBe(100);
    expect(ok<boolean>(r, 'enabled_at')).toBe(true);
    expect(ok<Night>(r, 'after_on').expired).toBe(0);
    expect(ok<number>(r, 'after_on_balance')).toBe(100);
    expect(ok<Night>(r, 'later').expired).toBeGreaterThanOrEqual(1);
    expect(ok<number>(r, 'later_balance')).toBe(0);
    expect(ok<Night>(r, 'drift').recomputed).toBeGreaterThanOrEqual(1);
    expect(ok<number>(r, 'g2_balance')).toBe(40);
    expect(ok<Night>(r, 'again').error).toBe(0);
    expect(ok(r, 'g1_again')).toBe('unchanged');
    expect(ok(r, 'g2_again')).toBe('unchanged');
    expect(ok<string>(r, 'cron')).toBe('call app.loyalty_nightly_run();');
  });

  it('rebuilds a cache whose 12-month points went stale even after a retier stamped it', () => {
    const r = run('lp-night-retier', [
      GUEST('aged'),
      PTS('aged', 100, '13 months'),
      PTS('aged', 5),
      // The cache as of a recompute before the 100 left the window: 105 points.
      X(
        `update loyalty_accounts set points_12m = 105, updated_at = now() - interval '1 day'
          where profile_id = {{aged}}::uuid`,
      ),
      // A new tier at 100: app.loyalty_retier moves the account up and stamps updated_at, no recount.
      TIER('hundred', 'LP Hundred', 100, 3),
      Q(
        'before',
        `select jsonb_build_object('points', a.points_12m, 'tier', t.name_en, 'stamped', a.updated_at = now())
           from loyalty_accounts a join loyalty_tiers t on t.id = a.tier_id where a.profile_id = {{aged}}::uuid`,
      ),
      Q('one', `select to_jsonb(app.loyalty_nightly_one({{aged}}::uuid, null, null))`),
      Q(
        'after',
        `select jsonb_build_object('points', a.points_12m, 'tier', t.name_en)
           from loyalty_accounts a join loyalty_tiers t on t.id = a.tier_id where a.profile_id = {{aged}}::uuid`,
      ),
      Q('again', `select to_jsonb(app.loyalty_nightly_one({{aged}}::uuid, null, null))`),
    ]);
    expect(ok(r, 'before')).toEqual({ points: 105, tier: 'LP Hundred', stamped: true });
    expect(ok(r, 'one')).toBe('recomputed');
    expect(ok<{ points: number; tier: string }>(r, 'after').points).toBe(5);
    expect(ok<{ points: number; tier: string }>(r, 'after').tier).not.toBe('LP Hundred');
    expect(ok(r, 'again')).toBe('unchanged');
  });

  it('skips an account a till holds instead of waiting, and the procedure commits per batch', async () => {
    const id = psql(`select gen_random_uuid()`);
    psql(`insert into auth.users (id, email, raw_user_meta_data, aud, role)
          values ('${id}', 'lp-night-${id}@test.touch.local', '{"full_name": "LP night"}'::jsonb,
                  'authenticated', 'authenticated');
          insert into loyalty_ledger (profile_id, delta, kind, source_kind, source_id, note)
          values ('${id}', 10, 'earn', 'tab', gen_random_uuid(), 'lp night');`);
    const holder = psqlSession(`set application_name = 'lp_hold';
begin;
select 1 from loyalty_accounts where profile_id = '${id}' for update;
select pg_sleep(3);
commit;`);
    await waitForSleeper('lp_hold');
    const t0 = Date.now();
    const night = JSON.parse(psql(`select app.loyalty_nightly()`)) as {
      locked: number;
      error: number;
    };
    const took = Date.now() - t0;
    await holder;
    expect(night.locked).toBeGreaterThanOrEqual(1);
    expect(night.error).toBe(0);
    expect(took).toBeLessThan(2500);
    // the cron body: a CALL that commits every account (p_batch 1)
    expect(() => psql(`call app.loyalty_nightly_run(1)`)).not.toThrow();
  });
});

// ── c15: one single-use code, two tills ─────────────────────────────────────

describe.skipIf(!docker)('one single-use code on two tabs at once (c15)', () => {
  it('lets the first apply win and refuses the second once the first commits', async () => {
    const code = `LPR${Math.random().toString(36).slice(2, 10).toUpperCase()}`.slice(0, 12);
    const setup = JSON.parse(
      psql(`select set_config('request.jwt.claims', '', false);
with cat as (insert into menu_categories (name_en, name_ar, tax_group_id, venue_id)
             values ('LP race', 'سباق', 'b0000000-0000-4000-8000-000000000001', '${VENUE_A_ID}') returning id),
     item as (insert into menu_items (category_id, name_en, name_ar, venue_id, is_active)
              select id, 'LP race item', 'صنف', '${VENUE_A_ID}', true from cat returning id),
     variant as (insert into menu_item_variants (item_id, name_en, name_ar, price_iqd, is_default)
                 select id, 'One', 'واحد', 10000, true from item returning id, item_id),
     open_day as (select d.id from day_sessions d where d.venue_id = '${VENUE_A_ID}' and d.status = 'open'
                   order by d.opened_at desc limit 1),
     new_day as (insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd)
                 select '${VENUE_A_ID}', date '2001-01-01' + (random() * 3000)::int, 'open',
                        '${SEED_STAFF_IDS.manager}', 0
                  where not exists (select 1 from open_day) returning id),
     day as (select id from open_day union all select id from new_day),
     tabs_ as (insert into tabs (venue_id, day_session_id, kind, status, label, opened_by_staff_id)
               select '${VENUE_A_ID}', day.id, 'cafe', 'open', 'LP race ' || n, '${SEED_STAFF_IDS.cashier}'
                 from day, generate_series(1, 2) n returning id),
     orders_ as (insert into orders (tab_id, source, placed_by_staff_id, venue_id)
                 select id, 'till', '${SEED_STAFF_IDS.cashier}', '${VENUE_A_ID}' from tabs_ returning id, tab_id),
     lines as (insert into order_items (order_id, menu_item_id, variant_id, qty, unit_price_iqd, line_total_iqd)
               select o.id, v.item_id, v.id, 1, 10000, 10000 from orders_ o, variant v returning id),
     promo as (insert into promotions (name_en, name_ar, type, value, auto, public_code, code_single_use,
                                       enabled, limits, created_by, venue_id)
               values ('LP race', 'سباق', 'amount', 1000, false, '${code}', true, true, '{}'::jsonb,
                       '${SEED_STAFF_IDS.owner}', null) returning id)
select json_build_object(
  'tabs', (select json_agg(id) from tabs_),
  'promo', (select id from promo),
  'cat', (select id from cat), 'item', (select id from item), 'variant', (select id from variant),
  'new_day', (select id from new_day),
  'lines', (select count(*) from lines));`),
    ) as {
      tabs: [string, string];
      promo: string;
      cat: string;
      item: string;
      variant: string;
      new_day: string | null;
    };
    const [tabA, tabB] = setup.tabs;
    const apply = (tab: string) =>
      asStaff(
        SEED_STAFF_IDS.cashier,
        `select app.apply_best_promotion('${tab}', '${code}', 'lp-race-${tab}', null)`,
      );
    try {
      const first = psqlSession(`set application_name = 'lp_race';
begin;
${apply(tabA)}
select pg_sleep(2);
commit;`);
      await waitForSleeper('lp_race');
      const second = psqlSession(`begin;
${apply(tabB)}
commit;`);
      await expect(first).resolves.toBeTypeOf('string');
      await expect(second).rejects.toThrow(/CODE_NOT_ELIGIBLE/);
      expect(
        psql(`select count(*) from promotion_redemptions where promotion_id = '${setup.promo}'`),
      ).toBe('1');
    } finally {
      psql(`select set_config('request.jwt.claims', '', false);
delete from promotion_redemptions where promotion_id = '${setup.promo}';
delete from tab_adjustments where tab_id in ('${tabA}', '${tabB}');
delete from order_items where order_id in (select id from orders where tab_id in ('${tabA}', '${tabB}'));
delete from orders where tab_id in ('${tabA}', '${tabB}');
delete from tabs where id in ('${tabA}', '${tabB}');
delete from promotions where id = '${setup.promo}';
delete from menu_item_variants where id = '${setup.variant}';
delete from menu_items where id = '${setup.item}';
delete from menu_categories where id = '${setup.cat}';
${setup.new_day ? `delete from day_sessions where id = '${setup.new_day}';` : ''}`);
    }
  });
});
