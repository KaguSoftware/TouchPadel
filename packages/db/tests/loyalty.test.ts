/**
 * Loyalty (Phase 2 M3, docs/design/loyalty/build-contracts-2026-10-05.md §1.3, §1.4): points on
 * every settled tab, taken back on a refund, spent at the till; the member token and the spoken
 * phone; tiers and tier promotions; the account's deletion; the café session link.
 *
 *   * earn per tabs.kind (café with a court fee, shop, lesson, tournament), the per-domain
 *     switches, the tier multiplier, once per tab, nothing while off or without a customer, the
 *     booking's guest as the customer, and the arithmetic held to earnPoints (@touch/core/loyalty)
 *     on one table;
 *   * clawback on a refund: proportional, rounded up, capped at what the tab earned;
 *   * redeem (points and rewards) capped at what is left to discount, its refusals, the replay,
 *     unredeem; adjust behind a PIN grant;
 *   * identify by token (now, ±2 steps accepted, ±3 MEMBER_CODE_EXPIRED, garbage
 *     MEMBER_CODE_INVALID) and by the exact phone (a partial one is MEMBER_NOT_FOUND); the shop
 *     assistant identifies and attaches on a shop tab, never a café tab;
 *   * a tier promotion (limits.tierMin) only from that tier up; settings and tiers for the owner;
 *   * delete_my_account takes the card and the cache; link_guest_session hands a guest_web
 *     tab's earn to the linked account; the ledger is append-only; the nightly run.
 *
 * Every case but the last is one rolled-back psql transaction (stores-harness `scenario`); the
 * last races two committed sessions on one account (its guest and rows stay, like the coaching
 * races). Tabs, orders and lines are planted as postgres with the foreign keys to parents the
 * suite never builds dropped inside the transaction (no lesson enrolment, tournament entry, menu
 * row, café table or court: the engine reads tabs.kind, payments and the lines);
 * payments, refunds and the settle are plain fixture writes, so the deferred earn and clawback
 * triggers run (SET CONSTRAINTS ALL IMMEDIATE makes them fire per statement). Without docker the
 * suite skips.
 */
import { describe, expect, it } from 'vitest';
import { earnPoints, type TabKind } from '../../core/src/loyalty/points';
import { stackAvailable } from './helpers';
import {
  dockerReachable,
  KEEP,
  MK,
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

const up = await stackAvailable();
const docker = up && dockerReachable();

const NIL = '00000000-0000-4000-8000-0000000003a5';

/** A fresh Iraqi mobile number per call (profiles_phone_key_live: one live profile per phone). */
function phone(): { e164: string; local: string } {
  const rest = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  return { e164: `+96477${rest}`, local: `077${rest}` };
}

let keySeq = 0;
const KEY = (tag: string) => `'loy-${tag}-${Date.now().toString(36)}-${(keySeq++).toString(36)}'`;

const LOY = String.raw`
set constraints all immediate;

-- The planted rows point at parents this suite never builds (a lesson enrolment, a tournament
-- entry, a menu item, a café table, a court): those foreign keys are dropped inside the
-- transaction and come back with the rollback. The db suite runs one file at a time (vitest
-- singleFork), so the ACCESS EXCLUSIVE these take blocks nobody.
do $drop_fk$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
      from pg_constraint c
     where c.contype = 'f'
       and ((c.conrelid = 'public.tabs'::regclass
             and c.conname in ('tabs_lesson_enrolment_fkey', 'tabs_tournament_entry_fkey'))
            or (c.conrelid = 'public.order_items'::regclass
                and c.confrelid in ('public.menu_items'::regclass, 'public.menu_item_variants'::regclass))
            or (c.conrelid = 'public.guest_sessions'::regclass and c.confrelid = 'public.cafe_tables'::regclass)
            or (c.conrelid = 'public.reservations'::regclass and c.confrelid = 'public.courts'::regclass))
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $drop_fk$;

create function pg_temp.var(p_name text) returns text language sql as $f$
  select val from pg_temp.vars where name = p_name
$f$;

-- A guest (the 0004 trigger makes the profile) with a phone and name parts. The phone is the
-- account's confirmed auth phone (0307: only a proven number is the till's phone_key); p_typed
-- plants one the guest only typed into the profile.
create function pg_temp.guest(p_name text, p_phone text, p_given text default null, p_family text default null,
                              p_typed boolean default false)
returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, raw_user_meta_data, aud, role, phone, phone_confirmed_at)
  values (v, 'loy-' || p_name || '-' || v || '@test.touch.local', jsonb_build_object('full_name', 'Loyal ' || p_name),
          'authenticated', 'authenticated',
          case when not p_typed then app.phone_digits(p_phone) end, case when not p_typed then now() end);
  update profiles set phone = p_phone where id = v;
  if p_given is not null then
    update profiles set given_name = p_given, family_name = p_family where id = v;
  end if;
  insert into pg_temp.vars values (p_name, v::text) on conflict (name) do update set val = excluded.val;
  return v;
end $f$;

-- A day at branch A for the planted payments (an open one if there is one).
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
  insert into pg_temp.vars values ('_day', v::text);
  return v;
end $f$;

-- An open tab of a kind at branch A (a lesson tab's enrolment and a tournament tab's entry are
-- made-up ids), its court fee, customer and goods (one line of a made-up item).
create function pg_temp.tab(p_name text, p_kind text, p_court bigint default 0, p_customer text default null,
                            p_goods bigint default 0, p_reservation text default null)
returns uuid language plpgsql as $f$
declare v uuid; o uuid; v_day uuid := pg_temp.day();
begin
  perform set_config('request.jwt.claims', '', true);
  insert into tabs (venue_id, day_session_id, kind, status, label, opened_by_staff_id, court_iqd, customer_id,
                    reservation_id, lesson_enrolment_id, tournament_entry_id)
  values (pg_temp.var('venue')::uuid, v_day, p_kind, 'open', 'LOY ' || p_name, pg_temp.var('cashier')::uuid, p_court,
          case when p_customer is not null then pg_temp.var(p_customer)::uuid end,
          case when p_reservation is not null then pg_temp.var(p_reservation)::uuid end,
          case when p_kind = 'lesson' then gen_random_uuid() end,
          case when p_kind = 'tournament' then gen_random_uuid() end)
  returning id into v;
  if p_goods > 0 then
    insert into orders (tab_id, source, placed_by_staff_id, venue_id)
    values (v, 'till', pg_temp.var('cashier')::uuid, pg_temp.var('venue')::uuid)
    returning id into o;
    insert into order_items (order_id, menu_item_id, variant_id, qty, unit_price_iqd, line_total_iqd)
    values (o, gen_random_uuid(), gen_random_uuid(), 1, p_goods, p_goods);
  end if;
  insert into pg_temp.vars values (p_name, v::text) on conflict (name) do update set val = excluded.val;
  return v;
end $f$;

-- A cash payment on a tab (the till's own insert shape, no station).
create function pg_temp.pay(p_name text, p_tab text, p_amount bigint) returns uuid language plpgsql as $f$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into payments (tab_id, day_session_id, method, amount_iqd, recorded_by, venue_id)
  select t.id, t.day_session_id, 'cash', p_amount, pg_temp.var('cashier')::uuid, t.venue_id
    from tabs t where t.id = pg_temp.var(p_tab)::uuid
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text) on conflict (name) do update set val = excluded.val;
  return v;
end $f$;

create function pg_temp.refund(p_name text, p_payment text, p_amount bigint) returns uuid language plpgsql as $f$
declare v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into refunds (payment_id, amount_iqd, reason_code, refunded_by, venue_id)
  select p.id, p_amount, 'customer_request', pg_temp.var('manager')::uuid, p.venue_id
    from payments p where p.id = pg_temp.var(p_payment)::uuid
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text) on conflict (name) do update set val = excluded.val;
  return v;
end $f$;

create function pg_temp.settle(p_tab text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  update tabs set status = 'settled', settled_at = now() where id = pg_temp.var(p_tab)::uuid;
end $f$;

-- Points planted as a fixture adjustment (no PIN round trip).
create function pg_temp.pts(p_guest text, p_delta int, p_ago interval default '0'::interval) returns void
language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  insert into loyalty_ledger (profile_id, delta, kind, source_kind, source_id, note, created_at)
  values (pg_temp.var(p_guest)::uuid, p_delta, 'adjust', 'adjust', gen_random_uuid(), 'fixture', now() - p_ago);
end $f$;

-- The member token of a guest's card k steps from now (the card must exist).
create function pg_temp.tok(p_name text, p_guest text, k int) returns text language plpgsql as $f$
declare v text;
begin
  select 'TP-' || c.member_code || '-'
         || app.loyalty_totp(c.secret, floor(extract(epoch from now()) / s.totp_step_seconds)::bigint + k)
    into v
    from loyalty_cards c, loyalty_settings s
   where c.profile_id = pg_temp.var(p_guest)::uuid and s.id;
  insert into pg_temp.vars values (p_name, v) on conflict (name) do update set val = excluded.val;
  return v;
end $f$;

-- A statement as postgres, its refusal recorded instead of raised.
create function pg_temp.try(p_label text, p_sql text) returns void language plpgsql as $f$
declare v_msg text; v_detail text;
begin
  begin
    execute pg_temp.sub(p_sql);
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'detail', nullif(v_detail, '')));
  end;
end $f$;

update loyalty_settings set enabled = true, iqd_per_point = 1000, point_value_iqd = 50, min_redeem_points = 100,
       earn_cafe = true, earn_shop = true, earn_court = true, earn_lesson = true, earn_tournament = true,
       inactivity_expiry_months = null, totp_step_seconds = 30
 where id;
`;

const GUEST = (name: string, given?: string, family?: string) => {
  const p = phone();
  return `select pg_temp.guest('${name}', '${p.e164}', ${given ? `'${given}'` : 'null'}, ${family ? `'${family}'` : 'null'});`;
};
const TAB = (
  name: string,
  kind: TabKind,
  o: { court?: number; customer?: string; goods?: number; res?: string } = {},
) =>
  X(
    `select pg_temp.tab('${name}', '${kind}', ${o.court ?? 0}, ${o.customer ? `'${o.customer}'` : 'null'}, ${o.goods ?? 0}, ${o.res ? `'${o.res}'` : 'null'})`,
  );
const PAY = (name: string, tab: string, amount: number) =>
  X(`select pg_temp.pay('${name}', '${tab}', ${amount})`);
const REFUND = (name: string, payment: string, amount: number) =>
  X(`select pg_temp.refund('${name}', '${payment}', ${amount})`);
const SETTLE = (tab: string) => X(`select pg_temp.settle('${tab}')`);
const PTS = (guest: string, delta: number, ago = '0') =>
  X(`select pg_temp.pts('${guest}', ${delta}, '${ago}'::interval)`);
const SET = (patch: string) => X(`update loyalty_settings set ${patch} where id`);
const GRANT = (who: string) =>
  X(`insert into app.pin_grants (caller_id, authorizer_id) values ({{${who}}}, {{manager}})`);
const TRY = (label: string, sql: string) => `select pg_temp.try('${label}', $q$${sql}$q$);`;

/** The ledger of a guest as [{kind, delta, source_kind}], oldest first. */
const LEDGER = (label: string, guest: string) =>
  Q(
    label,
    `select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'delta', delta, 'source_kind', source_kind)
                                       order by created_at, kind), '[]'::jsonb)
              from loyalty_ledger where profile_id = {{${guest}}}::uuid`,
  );
const BALANCE = (label: string, guest: string) =>
  Q(
    label,
    `select to_jsonb(coalesce((select balance from loyalty_accounts where profile_id = {{${guest}}}::uuid), 0))`,
  );
const EARNED = (label: string, tab: string) =>
  Q(
    label,
    `select to_jsonb(coalesce((select sum(delta) from loyalty_ledger where kind = 'earn' and source_kind = 'tab'
                                        and source_id = {{${tab}}}::uuid), 0))`,
  );

function run(tag: string, body: string[]): Results {
  return scenario(tag, [LOY, ...body]);
}

// ── 1. earn ──────────────────────────────────────────────────────────────────

describe.skipIf(!docker)('loyalty earn (contracts §1.3)', () => {
  it('earns per kind, with the court portion, the switches and the tier multiplier, once', () => {
    const r = run('loy-earn', [
      GUEST('g1'),
      GUEST('g2'),
      GUEST('g3'),
      // café with a court fee, through set_tab_customer as the cashier
      TAB('cafe1', 'cafe', { court: 40000 }),
      T('attach', 'cashier', `select app.set_tab_customer({{cafe1}}, {{g1}})`),
      PAY('p1', 'cafe1', 55000),
      SETTLE('cafe1'),
      EARNED('cafe1_pts', 'cafe1'),
      // shop, lesson, tournament
      TAB('shop1', 'shop', { customer: 'g1' }),
      PAY('p2', 'shop1', 23500),
      SETTLE('shop1'),
      EARNED('shop1_pts', 'shop1'),
      TAB('les1', 'lesson', { customer: 'g1' }),
      PAY('p3', 'les1', 30000),
      SETTLE('les1'),
      EARNED('les1_pts', 'les1'),
      TAB('tour1', 'tournament', { customer: 'g1' }),
      PAY('p4', 'tour1', 25000),
      SETTLE('tour1'),
      EARNED('tour1_pts', 'tour1'),
      // a court fee larger than what was paid: the court portion is capped at paid
      TAB('cafe_cap', 'cafe', { court: 40000, customer: 'g1' }),
      PAY('p5', 'cafe_cap', 30000),
      SETTLE('cafe_cap'),
      EARNED('cafe_cap_pts', 'cafe_cap'),
      // the switches: court off (only the café part), then shop off (nothing)
      SET('earn_court = false'),
      TAB('cafe2', 'cafe', { court: 40000, customer: 'g1' }),
      PAY('p6', 'cafe2', 50000),
      SETTLE('cafe2'),
      EARNED('cafe2_pts', 'cafe2'),
      SET('earn_court = true, earn_shop = false'),
      TAB('shop2', 'shop', { customer: 'g1' }),
      PAY('p7', 'shop2', 9000),
      SETTLE('shop2'),
      EARNED('shop2_pts', 'shop2'),
      SET('earn_shop = true'),
      // the multiplier: g2 reaches Gold (x1.5) at 100 points
      T(
        'gold',
        'owner',
        `select app.upsert_loyalty_tier('{"name_en":"Gold","name_ar":"ذهبي","min_points_12m":100,"earn_multiplier":1.5,"sort":1}'::jsonb)`,
      ),
      PTS('g2', 100),
      Q(
        'g2_tier',
        `select to_jsonb(t.name_en) from loyalty_accounts a join loyalty_tiers t on t.id = a.tier_id where a.profile_id = {{g2}}::uuid`,
      ),
      TAB('cafe3', 'cafe', { customer: 'g2' }),
      PAY('p8', 'cafe3', 20500),
      SETTLE('cafe3'),
      EARNED('cafe3_pts', 'cafe3'),
      // once: reopened and settled again, still one row
      X(`update tabs set status = 'open', settled_at = null where id = {{cafe3}}`),
      SETTLE('cafe3'),
      Q(
        'cafe3_rows',
        `select to_jsonb(count(*)) from loyalty_ledger where source_id = {{cafe3}}::uuid`,
      ),
      // no customer, and loyalty off: nothing
      TAB('anon1', 'cafe'),
      PAY('p9', 'anon1', 40000),
      SETTLE('anon1'),
      Q(
        'anon1_rows',
        `select to_jsonb(count(*)) from loyalty_ledger where source_id = {{anon1}}::uuid`,
      ),
      SET('enabled = false'),
      TAB('off1', 'cafe', { customer: 'g3' }),
      PAY('p10', 'off1', 40000),
      SETTLE('off1'),
      Q(
        'off1_rows',
        `select to_jsonb(count(*)) from loyalty_ledger where source_id = {{off1}}::uuid`,
      ),
      SET('enabled = true'),
      BALANCE('g1_balance', 'g1'),
      Q(
        'g1_acct',
        `select to_jsonb(a) - 'updated_at' - 'last_activity_at' - 'tier_id' from loyalty_accounts a where a.profile_id = {{g1}}::uuid`,
      ),
    ]);

    expect(ok<{ tab_id: string; customer_id: string }>(r, 'attach').customer_id).toBeTruthy();
    expect(ok<number>(r, 'cafe1_pts')).toBe(55); // 40,000 court + 15,000 café
    expect(ok<number>(r, 'shop1_pts')).toBe(23);
    expect(ok<number>(r, 'les1_pts')).toBe(30);
    expect(ok<number>(r, 'tour1_pts')).toBe(25);
    expect(ok<number>(r, 'cafe_cap_pts')).toBe(30); // court capped at paid, nothing left for café
    expect(ok<number>(r, 'cafe2_pts')).toBe(10); // court off: 50,000 - 40,000
    expect(ok<number>(r, 'shop2_pts')).toBe(0);
    expect(ok<string>(r, 'g2_tier')).toBe('Gold');
    expect(ok<number>(r, 'cafe3_pts')).toBe(30); // floor(20.5 * 1.5)
    expect(ok<number>(r, 'cafe3_rows')).toBe(1);
    expect(ok<number>(r, 'anon1_rows')).toBe(0);
    expect(ok<number>(r, 'off1_rows')).toBe(0);
    expect(ok<number>(r, 'g1_balance')).toBe(55 + 23 + 30 + 25 + 30 + 10);
    expect(ok<Record<string, number>>(r, 'g1_acct')).toMatchObject({
      balance: 173,
      lifetime_earned: 173,
      points_12m: 173,
    });
  });

  it("earns for the booking's guest when no one is attached", () => {
    const r = run('loy-earn-res', [
      GUEST('g1'),
      KEEP(
        'res1',
        `insert into reservations (court_id, kind, status, start_at, end_at, source, venue_id, guest_id)
         values (gen_random_uuid(), 'booking', 'confirmed', now() + interval '400 days', now() + interval '400 days 1 hour',
                 'desk', {{venue}}, {{g1}}) returning id::text`,
      ),
      TAB('cafe1', 'cafe', { court: 20000, res: 'res1' }),
      Q('customer', `select to_jsonb(app.tab_customer({{cafe1}}))`),
      PAY('p1', 'cafe1', 20000),
      SETTLE('cafe1'),
      EARNED('pts', 'cafe1'),
    ]);
    expect(ok<string>(r, 'customer')).toBeTruthy();
    expect(ok<number>(r, 'pts')).toBe(20);
  });

  it('computes the same points as earnPoints (@touch/core/loyalty)', () => {
    type Row = {
      kind: TabKind;
      paid: number;
      court: number;
      per: number;
      mult: number;
      off?: string;
    };
    const rows: Row[] = [
      { kind: 'cafe', paid: 55000, court: 40000, per: 1000, mult: 1 },
      { kind: 'cafe', paid: 30000, court: 40000, per: 1000, mult: 1 },
      { kind: 'cafe', paid: 50000, court: 40000, per: 1000, mult: 1, off: 'court' },
      { kind: 'cafe', paid: 50000, court: 40000, per: 1000, mult: 1, off: 'cafe' },
      { kind: 'shop', paid: 23999, court: 0, per: 1000, mult: 1 },
      { kind: 'shop', paid: 9000, court: 0, per: 1000, mult: 1, off: 'shop' },
      { kind: 'lesson', paid: 30000, court: 0, per: 750, mult: 1.25 },
      { kind: 'tournament', paid: 25000, court: 0, per: 1000, mult: 2.5 },
      { kind: 'cafe', paid: 20500, court: 0, per: 1000, mult: 1.5 },
      { kind: 'cafe', paid: 7000, court: 0, per: 1000, mult: 1.1 },
      { kind: 'shop', paid: 0, court: 0, per: 1000, mult: 3 },
      { kind: 'lesson', paid: 99999, court: 12345, per: 333, mult: 4.99, off: 'lesson' },
    ];
    const sw = (o?: string) => ({
      earn_cafe: o !== 'cafe',
      earn_shop: o !== 'shop',
      earn_court: o !== 'court',
      earn_lesson: o !== 'lesson',
      earn_tournament: o !== 'tournament',
    });
    const values = rows
      .map((x, i) => {
        const s = sw(x.off);
        return `(${i}, '${x.kind}', ${x.paid}, ${x.court}, ${x.per}, ${x.mult}, ${s.earn_cafe}, ${s.earn_shop}, ${s.earn_court}, ${s.earn_lesson}, ${s.earn_tournament})`;
      })
      .join(',\n');
    const r = run('loy-points', [
      Q(
        'sql',
        `select jsonb_agg(app.loyalty_points_for(k, p, c, n, m::numeric(3,2), a, b, d, e, f) order by i)
           from (values ${values}) v(i, k, p, c, n, m, a, b, d, e, f)`,
      ),
    ]);
    const sql = ok<number[]>(r, 'sql');
    rows.forEach((x, i) => {
      const ts = earnPoints({
        kind: x.kind,
        paid: x.paid,
        courtIqd: x.court,
        iqdPerPoint: x.per,
        multiplier: x.mult,
        switches: sw(x.off),
      });
      expect(sql[i], `row ${i} ${JSON.stringify(x)}`).toBe(ts);
    });
  });
});

// ── 2. clawback ──────────────────────────────────────────────────────────────

describe.skipIf(!docker)('loyalty clawback (contracts §1.3)', () => {
  it('takes back a refund share, rounded up, never more than the tab earned', () => {
    const r = run('loy-claw', [
      GUEST('g1'),
      TAB('t1', 'cafe', { customer: 'g1' }),
      PAY('p1', 't1', 30000),
      PAY('p2', 't1', 20000),
      SETTLE('t1'),
      EARNED('earned', 't1'),
      REFUND('r1', 'p1', 10000), // ceil(50 * 10,000 / 50,000) = 10
      BALANCE('after_r1', 'g1'),
      REFUND('r2', 'p2', 20000), // 20
      REFUND('r3', 'p1', 20000), // 20, the rest: a full refund takes all 50
      BALANCE('after_full', 'g1'),
      // rounding up, then the cap: 7 points on 7,500; two halves of 3,750 take 4 then 3
      GUEST('g2'),
      TAB('t2', 'shop', { customer: 'g2' }),
      PAY('q1', 't2', 7500),
      SETTLE('t2'),
      EARNED('earned2', 't2'),
      REFUND('s1', 'q1', 3750),
      REFUND('s2', 'q1', 3750),
      LEDGER('ledger2', 'g2'),
      // a refund on a tab that earned nothing writes nothing
      TAB('t3', 'cafe'),
      PAY('z1', 't3', 10000),
      SETTLE('t3'),
      REFUND('y1', 'z1', 10000),
      Q('t3_rows', `select to_jsonb(count(*)) from loyalty_ledger where tab_id = {{t3}}::uuid`),
    ]);
    expect(ok<number>(r, 'earned')).toBe(50);
    expect(ok<number>(r, 'after_r1')).toBe(40);
    expect(ok<number>(r, 'after_full')).toBe(0);
    expect(ok<number>(r, 'earned2')).toBe(7);
    expect(
      ok<Array<{ kind: string; delta: number }>>(r, 'ledger2').map((x) => [x.kind, x.delta]),
    ).toEqual([
      ['earn', 7],
      ['clawback', -4],
      ['clawback', -3],
    ]);
    expect(ok<number>(r, 't3_rows')).toBe(0);
  });

  it('earns net of a refund taken while the tab was open, and claws back on that base', () => {
    const r = run('loy-claw-open', [
      GUEST('g1'),
      TAB('t1', 'cafe', { customer: 'g1' }),
      PAY('p1', 't1', 30000),
      REFUND('r0', 'p1', 10000), // while open (DISCOUNT_REQUIRES_REFUND, a method switch): no earn to claw yet
      PAY('p2', 't1', 5000),
      SETTLE('t1'),
      EARNED('earned', 't1'), // 30,000 + 5,000 - 10,000
      REFUND('r1', 'p2', 5000), // ceil(25 * 5,000 / 25,000) = 5
      BALANCE('after_r1', 'g1'),
      REFUND('r2', 'p1', 20000), // the rest of the money: the rest of the points
      BALANCE('after_all', 'g1'),
    ]);
    expect(ok<number>(r, 'earned')).toBe(25);
    expect(ok<number>(r, 'after_r1')).toBe(20);
    expect(ok<number>(r, 'after_all')).toBe(0);
  });
});

// ── 3. redeem, unredeem, adjust ──────────────────────────────────────────────

const REDEEM = (
  tab: string,
  points: number | null,
  reward: string | null,
  key: string | null = KEY('r'),
) =>
  `select app.loyalty_redeem({{${tab}}}, ${points ?? 'null'}, ${reward ? `{{${reward}}}` : 'null'}, ${key ?? 'null'})`;

describe.skipIf(!docker)('loyalty redeem (contracts §1.3)', () => {
  it('spends points and rewards, capped at what is left, and gives them back on unredeem', () => {
    const replayKey = KEY('replay');
    const r = run('loy-redeem', [
      MK('shop', 'shop_staff'),
      GUEST('g1'),
      PTS('g1', 300),
      TAB('t1', 'cafe', { goods: 10000 }),
      T('attach', 'cashier', `select app.set_tab_customer({{t1}}, {{g1}})`),
      T('below_min', 'cashier', REDEEM('t1', 50, null)),
      T('insufficient', 'cashier', REDEEM('t1', 400, null)),
      T('both', 'cashier', `select app.loyalty_redeem({{t1}}, 100, '${NIL}', ${KEY('b')})`),
      T('redeem', 'cashier', REDEEM('t1', 250, null, replayKey)),
      T('replay', 'cashier', REDEEM('t1', 250, null, replayKey)),
      Q(
        'adj',
        `select to_jsonb(a) - 'id' - 'created_at' - 'applied_by' - 'authorized_by' - 'tab_id'
                  from tab_adjustments a where a.tab_id = {{t1}}::uuid`,
      ),
      Q('totals', `select to_jsonb(t) from app.compute_tab_totals({{t1}}) t`),
      T('nothing_left', 'cashier', REDEEM('t1', 100, null)),
      KEEP('adj1', `select id::text from tab_adjustments where tab_id = {{t1}}::uuid`),
      T('shop_unredeem', 'shop', `select app.loyalty_unredeem({{adj1}})`),
      T('unredeem', 'cashier', `select app.loyalty_unredeem({{adj1}})`),
      Q('adj_after', `select to_jsonb(count(*)) from tab_adjustments where tab_id = {{t1}}::uuid`),
      LEDGER('ledger', 'g1'),
      // rewards
      T(
        'rw1',
        'owner',
        `select app.upsert_loyalty_reward('{"name_en":"3k off","name_ar":"خصم","cost_points":120,"kind":"iqd_off","iqd_off":3000}'::jsonb)`,
      ),
      KEEP(
        'rw1',
        `select id::text from loyalty_rewards where name_en = '3k off' order by created_at desc limit 1`,
      ),
      T('reward', 'cashier', REDEEM('t1', null, 'rw1')),
      T(
        'rw2',
        'owner',
        `select app.upsert_loyalty_reward('{"name_en":"Big","name_ar":"كبير","cost_points":100,"kind":"iqd_off","iqd_off":50000}'::jsonb)`,
      ),
      KEEP(
        'rw2',
        `select id::text from loyalty_rewards where name_en = 'Big' order by created_at desc limit 1`,
      ),
      TAB('t2', 'cafe', { goods: 2000, customer: 'g1' }),
      T('reward_capped', 'cashier', REDEEM('t2', null, 'rw2')),
      T('no_reward', 'cashier', `select app.loyalty_redeem({{t2}}, null, '${NIL}', ${KEY('n')})`),
      // the refusals around the tab
      TAB('t3', 'cafe', { goods: 5000 }),
      T('no_customer', 'cashier', REDEEM('t3', 100, null)),
      TAB('t4', 'cafe', { goods: 5000, customer: 'g1' }),
      SETTLE('t4'),
      T('settled', 'cashier', REDEEM('t4', 100, null)),
      TAB('t5', 'cafe', { goods: 5000, customer: 'g1' }),
      T('shop_on_cafe', 'shop', REDEEM('t5', 100, null)),
      T('prep', 'prep', REDEEM('t5', 100, null)),
      SET('enabled = false'),
      T('off', 'cashier', REDEEM('t5', 100, null)),
    ]);

    expect(refused(r, 'below_min')).toBe('POINTS_BELOW_MIN');
    expect(refused(r, 'insufficient')).toBe('POINTS_INSUFFICIENT');
    expect(refused(r, 'both')).toBe('INVALID_ARGUMENT');
    // 250 points would be 12,500; the goods are 10,000: 200 points fit.
    expect(ok(r, 'redeem')).toMatchObject({ points: 200, amount_iqd: 10000, balance: 100 });
    expect(ok(r, 'replay')).toMatchObject({ points: 200, duplicate: true });
    expect(ok(r, 'adj')).toMatchObject({
      kind: 'discount_amount',
      value: 200,
      amount_iqd: 10000,
      reason_code: 'loyalty_points',
      order_item_id: null,
      promotion_id: null,
    });
    expect(ok(r, 'totals')).toMatchObject({ subtotal_iqd: 10000, discount_iqd: 10000 });
    expect(refused(r, 'nothing_left')).toBe(
      'NOTHING_OWED:nothing on this bill is left to discount',
    );
    expect(refused(r, 'shop_unredeem')).toBe('TAB_KIND_FORBIDDEN');
    expect(ok(r, 'unredeem')).toMatchObject({ balance: 300 });
    expect(ok<number>(r, 'adj_after')).toBe(0);
    expect(
      ok<Array<{ kind: string; delta: number }>>(r, 'ledger').map((x) => [x.kind, x.delta]),
    ).toEqual([
      ['adjust', 300],
      ['redeem', -200],
      ['redeem_void', 200],
    ]);
    expect(ok(r, 'reward')).toMatchObject({ points: 120, amount_iqd: 3000, balance: 180 });
    expect(ok(r, 'reward_capped')).toMatchObject({ points: 100, amount_iqd: 2000, balance: 80 });
    expect(refused(r, 'no_reward')).toBe('REWARD_NOT_FOUND');
    expect(refused(r, 'no_customer')).toBe('NO_CUSTOMER');
    expect(refused(r, 'settled')).toBe('TAB_NOT_OPEN');
    expect(refused(r, 'shop_on_cafe')).toBe('TAB_KIND_FORBIDDEN');
    expect(refused(r, 'prep')).toBe('FORBIDDEN');
    expect(refused(r, 'off')).toBe('LOYALTY_OFF');
  });

  it('adjusts only behind a manager PIN grant, with a reason', () => {
    const r = run('loy-adjust', [
      GUEST('g1'),
      T('cashier', 'cashier', `select app.loyalty_adjust({{g1}}, 50, 'goodwill')`),
      // Grants other suites left for the shared seed manager (committed, within the TTL) age out
      // inside this rolled-back transaction, so the call below has none to consume (the
      // coaching-desk-money precedent).
      X(
        `update app.pin_grants set created_at = now() - interval '1 day' where caller_id = {{manager}} and consumed_at is null`,
      ),
      T('no_grant', 'manager', `select app.loyalty_adjust({{g1}}, 50, 'goodwill')`),
      T('no_reason', 'manager', `select app.loyalty_adjust({{g1}}, 50, '  ')`),
      T('zero', 'manager', `select app.loyalty_adjust({{g1}}, 0, 'goodwill')`),
      T('nobody', 'manager', `select app.loyalty_adjust('${NIL}', 50, 'goodwill')`),
      GRANT('manager'),
      T('adjust', 'manager', `select app.loyalty_adjust({{g1}}, 50, 'goodwill')`),
      GRANT('manager'),
      T('minus', 'manager', `select app.loyalty_adjust({{g1}}, -80, 'correction')`),
      T('reused', 'manager', `select app.loyalty_adjust({{g1}}, 10, 'again')`),
      T('customer', 'cashier', `select app.loyalty_customer({{g1}})`),
      T('customer_guest', 'g1', `select app.loyalty_customer({{g1}})`),
    ]);
    expect(refused(r, 'cashier')).toBe('FORBIDDEN');
    expect(refused(r, 'no_grant')).toBe('PIN_GRANT_REQUIRED');
    expect(refused(r, 'no_reason')).toBe('REASON_REQUIRED');
    expect(refused(r, 'zero')).toBe('INVALID_ARGUMENT');
    expect(refused(r, 'nobody')).toBe('MEMBER_NOT_FOUND');
    expect(ok(r, 'adjust')).toEqual({ balance: 50 });
    expect(ok(r, 'minus')).toEqual({ balance: -30 });
    expect(refused(r, 'reused')).toBe('PIN_GRANT_REQUIRED');
    const c = ok<{
      balance: number;
      lifetime: number;
      history: Array<{ kind: string; note: string }>;
    }>(r, 'customer');
    expect(c.balance).toBe(-30);
    expect(c.lifetime).toBe(0);
    expect(c.history.map((h) => h.note)).toEqual(['correction', 'goodwill']);
    expect(refused(r, 'customer_guest')).toBe('FORBIDDEN');
  });
});

// ── 4. identify ──────────────────────────────────────────────────────────────

describe.skipIf(!docker)('loyalty identify (contracts §1.3, L-4)', () => {
  it('takes a token within ±2 steps or the exact phone, and tells expired from invalid', () => {
    const p = phone();
    const q = phone();
    const r = run('loy-identify', [
      `select pg_temp.guest('g1', '${p.e164}', 'Sara', 'Haddad');`,
      T('card', 'g1', `select app.my_member_card()`),
      T('card_again', 'g1', `select app.my_member_card()`),
      ...[0, 2, -2, 3, -3].map((k) =>
        X(`select pg_temp.tok('k${k < 0 ? 'm' : ''}${Math.abs(k)}', 'g1', ${k})`),
      ),
      T('now', 'cashier', `select app.loyalty_identify({{k0}}, {{venue}})`),
      T('plus2', 'cashier', `select app.loyalty_identify(lower({{k2}}), null)`),
      T('minus2', 'cashier', `select app.loyalty_identify('  ' || {{km2}} || ' ', {{venue}})`),
      T('plus3', 'cashier', `select app.loyalty_identify({{k3}}, {{venue}})`),
      T('minus3', 'cashier', `select app.loyalty_identify({{km3}}, {{venue}})`),
      T('garbage', 'cashier', `select app.loyalty_identify('TP-ZZZZ-12', {{venue}})`),
      T('word', 'cashier', `select app.loyalty_identify('hello there', {{venue}})`),
      T('unknown', 'cashier', `select app.loyalty_identify('TP-00000000-123456', {{venue}})`),
      T('phone', 'desk', `select app.loyalty_identify('${p.local}', {{venue}})`),
      T('phone_intl', 'cashier', `select app.loyalty_identify('${p.e164}', {{venue}})`),
      T('partial', 'cashier', `select app.loyalty_identify('${p.local.slice(0, 8)}', {{venue}})`),
      T('other_venue', 'cashier', `select app.loyalty_identify({{k0}}, {{other_venue}})`),
      T('guest', 'g1', `select app.loyalty_identify({{k0}}, null)`),
      T('prep', 'prep', `select app.loyalty_identify({{k0}}, null)`),
      // 0307 (c1): a number another guest only typed into its profile is nobody's at the till.
      `select pg_temp.guest('sq', '${q.e164}', 'Squat', 'Ter', true);`,
      T('typed', 'cashier', `select app.loyalty_identify('${q.local}', {{venue}})`),
      Q(
        'audits',
        `select to_jsonb(count(*)) from audit_log where action = 'loyalty.identify' and entity_id = {{g1}}`,
      ),
      // the shop assistant: identifies, attaches on a shop tab, never a café tab
      MK('shop', 'shop_staff'),
      T('shop_identify', 'shop', `select app.loyalty_identify({{k0}}, null)`),
      TAB('shop1', 'shop'),
      TAB('cafe1', 'cafe'),
      T('shop_attach', 'shop', `select app.set_tab_customer({{shop1}}, {{g1}})`),
      T('shop_cafe', 'shop', `select app.set_tab_customer({{cafe1}}, {{g1}})`),
      T('detach', 'shop', `select app.set_tab_customer({{shop1}}, null)`),
      T('ghost', 'cashier', `select app.set_tab_customer({{cafe1}}, '${NIL}')`),
      SETTLE('cafe1'),
      T('closed', 'cashier', `select app.set_tab_customer({{cafe1}}, {{g1}})`),
      // a rotated secret retires the old token
      T('rotate', 'g1', `select app.rotate_member_card()`),
      T('old_token', 'cashier', `select app.loyalty_identify({{k0}}, null)`),
      T('mine', 'g1', `select app.my_loyalty()`),
    ]);

    const card = ok<{ member_code: string; secret_b32: string; step: number }>(r, 'card');
    expect(card.member_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(card.secret_b32).toMatch(/^[A-Z2-7]{32}$/);
    expect(card.step).toBe(30);
    expect(ok(r, 'card_again')).toEqual(card);

    const who = ok<Record<string, unknown>>(r, 'now');
    expect(who).toMatchObject({
      display_name: 'Sara H.',
      phone_masked: `${'•'.repeat(p.e164.length - 5)}${p.e164.slice(-4)}`,
      tier_name_en: 'Member',
      tier_name_ar: 'عضو',
      balance: 0,
      enabled: true,
    });
    for (const l of ['plus2', 'minus2', 'phone', 'phone_intl', 'shop_identify']) {
      expect(ok<{ customer_id: string }>(r, l).customer_id, l).toBe(who.customer_id);
    }
    expect(refused(r, 'plus3')).toBe('MEMBER_CODE_EXPIRED');
    expect(refused(r, 'minus3')).toBe('MEMBER_CODE_EXPIRED');
    expect(refused(r, 'garbage')).toBe('MEMBER_CODE_INVALID');
    expect(refused(r, 'word')).toBe('MEMBER_CODE_INVALID');
    expect(refused(r, 'unknown')).toBe('MEMBER_CODE_INVALID');
    expect(refused(r, 'partial')).toBe('MEMBER_NOT_FOUND');
    expect(refused(r, 'typed')).toBe('MEMBER_NOT_FOUND');
    expect(refused(r, 'other_venue')).toBe('VENUE_MISMATCH');
    expect(refused(r, 'guest')).toBe('FORBIDDEN');
    expect(refused(r, 'prep')).toBe('FORBIDDEN');
    expect(ok<number>(r, 'audits')).toBe(5); // now, plus2, minus2, phone, phone_intl: a refusal rolls its row back
    expect(ok(r, 'shop_attach')).toMatchObject({ customer_id: who.customer_id });
    expect(refused(r, 'shop_cafe')).toBe('TAB_KIND_FORBIDDEN');
    expect(ok(r, 'detach')).toMatchObject({ customer_id: null });
    expect(refused(r, 'ghost')).toBe('MEMBER_NOT_FOUND');
    expect(refused(r, 'closed')).toBe('TAB_NOT_OPEN');
    const rotated = ok<{ member_code: string; secret_b32: string }>(r, 'rotate');
    expect(rotated.member_code).toBe(card.member_code);
    expect(rotated.secret_b32).not.toBe(card.secret_b32);
    expect(refused(r, 'old_token')).toBe('MEMBER_CODE_INVALID');
    const mine = ok<Record<string, unknown>>(r, 'mine');
    expect(Object.keys(mine).sort()).toEqual(
      [
        'balance',
        'enabled',
        'history',
        'lifetime',
        'min_redeem_points',
        'next_tier',
        'point_value_iqd',
        'points_12m',
        'rewards',
        'tier',
      ].sort(),
    );
    expect(mine).toMatchObject({
      enabled: true,
      balance: 0,
      point_value_iqd: 50,
      min_redeem_points: 100,
    });
  });
});

// ── 5. tiers, promotions, settings ───────────────────────────────────────────

describe.skipIf(!docker)('loyalty tiers and the tier promotion (contracts §1.4)', () => {
  it('makes a tierMin promotion eligible only from that tier up, and only while loyalty is on', () => {
    const r = run('loy-tier', [
      GUEST('g1'),
      T(
        'silver',
        'owner',
        `select app.upsert_loyalty_tier('{"name_en":"Silver","name_ar":"فضي","min_points_12m":100,"earn_multiplier":1,"sort":1}'::jsonb)`,
      ),
      KEEP(
        'promo',
        `insert into promotions (name_en, name_ar, type, value, auto, enabled, limits, created_by, venue_id)
                     values ('Silver 10%', 'فضي ١٠٪', 'percent', 10, true, true, '{"tierMin":1}'::jsonb, {{manager}}, null)
                     returning id::text`,
      ),
      Q('promo_id', `select to_jsonb({{promo}}::uuid)`),
      TAB('t1', 'cafe', { goods: 10000, customer: 'g1' }),
      T('base', 'cashier', `select app.eligible_promotions({{t1}}, null)`),
      PTS('g1', 150),
      T('silver_tier', 'cashier', `select app.eligible_promotions({{t1}}, null)`),
      T('apply', 'cashier', `select app.apply_best_promotion({{t1}}, null, ${KEY('p')}, null)`),
      Q(
        'redemption',
        `select to_jsonb(customer_id) from promotion_redemptions where tab_id = {{t1}}::uuid`,
      ),
      TAB('t2', 'cafe', { goods: 10000 }),
      T('no_customer', 'cashier', `select app.eligible_promotions({{t2}}, null)`),
      SET('enabled = false'),
      T('off', 'cashier', `select app.eligible_promotions({{t1}}, null)`),
      SET('enabled = true'),
      // the owner's setup
      T('admin_mgr', 'manager', `select app.loyalty_admin()`),
      T('admin_cashier', 'cashier', `select app.loyalty_admin()`),
      T(
        'settings_mgr',
        'manager',
        `select app.set_loyalty_settings('{"iqd_per_point":500}'::jsonb)`,
      ),
      T('settings_unknown', 'owner', `select app.set_loyalty_settings('{"bogus":1}'::jsonb)`),
      T(
        'settings_bad',
        'owner',
        `select app.set_loyalty_settings('{"totp_step_seconds":5}'::jsonb)`,
      ),
      T(
        'settings',
        'owner',
        `select app.set_loyalty_settings('{"iqd_per_point":500,"inactivity_expiry_months":12}'::jsonb)`,
      ),
      KEEP('base_tier', `select id::text from loyalty_tiers where sort = 0`),
      T(
        'del_base',
        'owner',
        `select to_jsonb(1) from (select app.delete_loyalty_tier({{base_tier}})) z`,
      ),
      T(
        'dup_threshold',
        'owner',
        `select app.upsert_loyalty_tier('{"name_en":"Dup","name_ar":"مكرر","min_points_12m":100,"sort":5}'::jsonb)`,
      ),
      KEEP('silver', `select id::text from loyalty_tiers where name_en = 'Silver'`),
      // 0309: a tier a promotion names is TIER_IN_USE (loyalty-promotions.test.ts); open it to everyone first.
      X(`update promotions set limits = '{}'::jsonb where id = {{promo}}::uuid`),
      T(
        'del_silver',
        'owner',
        `select to_jsonb(1) from (select app.delete_loyalty_tier({{silver}})) z`,
      ),
      Q(
        'g1_tier',
        `select to_jsonb(t.sort) from loyalty_accounts a join loyalty_tiers t on t.id = a.tier_id where a.profile_id = {{g1}}::uuid`,
      ),
    ]);
    const ids = (l: string) => ok<Array<{ promotionId: string }>>(r, l).map((x) => x.promotionId);
    expect(ok(r, 'silver')).toMatchObject({ name_en: 'Silver', sort: 1, min_points_12m: 100 });
    const promoId = ok<string>(r, 'promo_id');
    expect(ids('base')).not.toContain(promoId);
    expect(ids('silver_tier')).toContain(promoId);
    expect(ok<string>(r, 'redemption')).toBeTruthy();
    expect(ids('no_customer')).not.toContain(promoId);
    expect(ids('off')).not.toContain(promoId);

    const admin = ok<{
      settings: Record<string, unknown>;
      tiers: Array<{ sort: number }>;
      rewards: unknown[];
    }>(r, 'admin_mgr');
    expect(admin.settings).toMatchObject({ enabled: true, iqd_per_point: 1000 });
    expect(admin.tiers.map((t) => t.sort)).toEqual([0, 1]);
    expect(refused(r, 'admin_cashier')).toBe('FORBIDDEN');
    expect(refused(r, 'settings_mgr')).toBe('FORBIDDEN');
    expect(refused(r, 'settings_unknown')).toBe('INVALID_ARGUMENT');
    expect(refused(r, 'settings_bad')).toBe('INVALID_VALUE');
    expect(ok(r, 'settings')).toMatchObject({
      iqd_per_point: 500,
      inactivity_expiry_months: 12,
      point_value_iqd: 50,
    });
    expect(refused(r, 'del_base')).toBe('INVALID_ARGUMENT');
    expect(refused(r, 'dup_threshold')).toBe('INVALID_VALUE');
    expect(ok(r, 'del_silver')).toBe(1);
    expect(ok<number>(r, 'g1_tier')).toBe(0);
  });
});

// ── 6. the account: deletion, the café link, the ledger, the nightly run ────

describe.skipIf(!docker)('loyalty and the account (contracts §1.3, §1.4)', () => {
  it('delete_my_account removes the card and the cache and keeps the ledger', () => {
    const r = run('loy-delete', [
      GUEST('g1'),
      T('card', 'g1', `select app.my_member_card()`),
      PTS('g1', 40),
      T('delete', 'g1', `select app.delete_my_account('DELETE')`),
      Q('cards', `select to_jsonb(count(*)) from loyalty_cards where profile_id = {{g1}}::uuid`),
      Q(
        'accounts',
        `select to_jsonb(count(*)) from loyalty_accounts where profile_id = {{g1}}::uuid`,
      ),
      Q('ledger', `select to_jsonb(count(*)) from loyalty_ledger where profile_id = {{g1}}::uuid`),
      // the nightly run does not rebuild the tombstone's cache from the ledger it keeps
      X(`select app.loyalty_nightly()`),
      Q(
        'accounts_after_night',
        `select to_jsonb(count(*)) from loyalty_accounts where profile_id = {{g1}}::uuid`,
      ),
      Q(
        'audit',
        `select after from audit_log where action = 'account.delete' and entity_id = {{g1}} order by id desc limit 1`,
      ),
    ]);
    expect(ok(r, 'delete')).toMatchObject({ deleted: true });
    expect(ok<number>(r, 'cards')).toBe(0);
    expect(ok<number>(r, 'accounts')).toBe(0);
    expect(ok<number>(r, 'ledger')).toBe(1);
    expect(ok<number>(r, 'accounts_after_night')).toBe(0);
    expect(ok(r, 'audit')).toMatchObject({ loyalty_card_deleted: true });
  });

  it("link_guest_session hands a guest_web tab's earn to the linked account", () => {
    const r = run('loy-link', [
      GUEST('g1', 'Omar', 'Saleh'),
      T('card', 'g1', `select app.my_member_card()`),
      X(`select pg_temp.tok('tk', 'g1', 0)`),
      X(`select pg_temp.tok('tk_old', 'g1', -5)`),
      // an anonymous café user with a live session at a table of branch A
      KEEP(
        'anon',
        `insert into auth.users (id, aud, role, is_anonymous) values (gen_random_uuid(), 'authenticated', 'authenticated', true) returning id::text`,
      ),
      KEEP(
        'anon2',
        `insert into auth.users (id, aud, role, is_anonymous) values (gen_random_uuid(), 'authenticated', 'authenticated', true) returning id::text`,
      ),
      KEEP(
        'sess',
        `insert into guest_sessions (table_id, auth_user_id, expires_at, venue_id)
                    values (gen_random_uuid(), {{anon}}, now() + interval '1 hour', {{venue}}) returning id::text`,
      ),
      T('no_session', 'anon2', `select app.link_guest_session({{tk}})`),
      T('not_anon', 'g1', `select app.link_guest_session({{tk}})`),
      T('expired', 'anon', `select app.link_guest_session({{tk_old}})`),
      T('link', 'anon', `select app.link_guest_session({{tk}})`),
      Q(
        'linked',
        `select to_jsonb(linked_profile_id) from guest_sessions where id = {{sess}}::uuid`,
      ),
      // the guest's web order on a café tab, then the settle
      TAB('t1', 'cafe'),
      X(
        `insert into orders (tab_id, source, guest_session_id, venue_id) values ({{t1}}, 'guest_web', {{sess}}, {{venue}})`,
      ),
      Q('customer', `select to_jsonb(app.tab_customer({{t1}}))`),
      PAY('p1', 't1', 12000),
      SETTLE('t1'),
      EARNED('pts', 't1'),
      Q('earner', `select to_jsonb(profile_id) from loyalty_ledger where source_id = {{t1}}::uuid`),
    ]);
    expect(refused(r, 'no_session')).toBe('SESSION_EXPIRED');
    expect(refused(r, 'not_anon')).toBe('FORBIDDEN');
    expect(refused(r, 'expired')).toBe('MEMBER_CODE_EXPIRED');
    expect(ok(r, 'link')).toEqual({ linked: true, display_name: 'Omar S.' });
    const g1 = ok<string>(r, 'linked');
    expect(g1).toBeTruthy();
    expect(ok<string>(r, 'customer')).toBe(g1);
    expect(ok<number>(r, 'pts')).toBe(12);
    expect(ok<string>(r, 'earner')).toBe(g1);
  });

  it('keeps the ledger append-only except for the merge re-point, and the nightly run expires idle points', () => {
    const r = run('loy-ledger', [
      GUEST('g1'),
      GUEST('g2'),
      PTS('g1', 70, '3 months'),
      TRY('update', `update loyalty_ledger set delta = 1 where profile_id = {{g1}}::uuid`),
      TRY('delete', `delete from loyalty_ledger where profile_id = {{g1}}::uuid`),
      TRY(
        'merge_other_column',
        `select set_config('app.loyalty_merge', 'on', true);
                                 update loyalty_ledger set delta = 1 where profile_id = {{g1}}::uuid`,
      ),
      TRY(
        'merge',
        `select set_config('app.loyalty_merge', 'on', true);
                    update loyalty_ledger set profile_id = {{g2}}::uuid where profile_id = {{g1}}::uuid;
                    select set_config('app.loyalty_merge', '', true);
                    select app.loyalty_recompute({{g1}}::uuid);
                    select app.loyalty_recompute({{g2}}::uuid);`,
      ),
      BALANCE('g2_after_merge', 'g2'),
      BALANCE('g1_after_merge', 'g1'),
      // expiry: off by default; at 2 months, 3 months idle loses the balance
      Q('night_off', `select app.loyalty_nightly()`),
      BALANCE('g2_kept', 'g2'),
      SET('inactivity_expiry_months = 2'),
      Q('night_on', `select app.loyalty_nightly()`),
      BALANCE('g2_expired', 'g2'),
      LEDGER('g2_ledger', 'g2'),
      Q(
        'cron',
        `select to_jsonb(count(*)) from cron.job where jobname = 'tp_loyalty_nightly' and schedule = '15 0 * * *'`,
      ),
    ]);
    expect(refused(r, 'update')).toBe('FORBIDDEN');
    expect(refused(r, 'delete')).toBe('FORBIDDEN');
    expect(refused(r, 'merge_other_column')).toBe('FORBIDDEN');
    expect(r['merge']?.ok, JSON.stringify(r['merge'])).toBe(true);
    expect(ok<number>(r, 'g2_after_merge')).toBe(70);
    expect(ok<number>(r, 'g1_after_merge')).toBe(0);
    expect(ok<{ expired: number }>(r, 'night_off').expired).toBe(0);
    expect(ok<number>(r, 'g2_kept')).toBe(70);
    expect(ok<{ expired: number }>(r, 'night_on').expired).toBeGreaterThanOrEqual(1);
    expect(ok<number>(r, 'g2_expired')).toBe(0);
    expect(
      ok<Array<{ kind: string; delta: number }>>(r, 'g2_ledger').map((x) => [x.kind, x.delta]),
    ).toEqual([
      ['adjust', 70],
      ['expire', -70],
    ]);
    expect(ok<number>(r, 'cron')).toBe(1);
  });
});

// ── 7. the cache under two committed writers ─────────────────────────────────

describe.skipIf(!docker)('loyalty account cache (committed, two connections)', () => {
  it('keeps balance = sum(ledger) when two writers for one profile overlap', async () => {
    const id = psql(`select gen_random_uuid()`);
    psql(`insert into auth.users (id, email, raw_user_meta_data, aud, role)
          values ('${id}', 'loy-race-${id}@test.touch.local', '{"full_name": "Loyal race"}'::jsonb,
                  'authenticated', 'authenticated')`);
    const ins = (delta: number) =>
      `insert into loyalty_ledger (profile_id, delta, kind, source_kind, source_id, note)
       values ('${id}', ${delta}, 'adjust', 'adjust', gen_random_uuid(), 'race')`;
    // The holder writes its row (and the account row) and holds them two seconds; the racer's
    // row lands meanwhile, and its cache write waits for the holder's commit.
    const holder = psqlSession(`set application_name = 'loy_race';
begin;
${ins(10)};
select pg_sleep(2);
commit;`);
    await waitForSleeper('loy_race');
    const racer = psqlSession(`begin;
${ins(5)};
commit;`);
    await Promise.all([holder, racer]);
    const out = JSON.parse(
      psql(`select json_build_object(
                'balance', (select balance from loyalty_accounts where profile_id = '${id}'),
                'sum', (select sum(delta) from loyalty_ledger where profile_id = '${id}'))`),
    ) as { balance: number; sum: number };
    expect(out).toEqual({ balance: 15, sum: 15 });
  });
});
