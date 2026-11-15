/**
 * 0430 audit_fixes — three database fixes from the 2026-11-15 audit.
 *
 *   1. One in-app deal pick, one bill: app.loyalty_picked_deal_on(profile, tab)
 *      drops a pick already redeemed on ANOTHER open bill of the member, and
 *      keeps it on the bill that holds it (eligible_promotions asks it).
 *   2. app.phone_canon strips 00, then 964, then a trunk 0, so "+964 0770 …"
 *      is the same number as "0770 …" (the TS twins: iraq.fixtures.ts).
 *   3. apply_customer_court_discount locks the booking's live bill before the
 *      court, so it and settle_tab never pass each other (read from the live
 *      body: two sessions racing are not reproducible in one test).
 *   4. queued_rpc_claim refuses a page the caller is blocked from (AREA_BLOCKED).
 *   5. A push token written to one profile leaves every other profile, and the
 *      same account writing it again (a reinstall) keeps it.
 *
 * ONE rolled-back psql transaction: nothing it plants outlives it.
 */
import { describe, it, expect } from 'vitest';
import { docker, psql } from './psql-scenario';
import { SEED_STAFF_IDS, VENUE_A_ID } from './helpers';

const SCENARIO = `begin;
set client_min_messages = warning;
select set_config('request.jwt.claims', '', true);
create temp table v (k text primary key, val uuid);
insert into v values ('owner', '${SEED_STAFF_IDS.owner}');
-- the guest
with x as (insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'g0430-' || substr(md5(random()::text), 1, 8) || '@test.local', '{"full_name": "Guest 0430"}')
  returning id) insert into v select 'guest', id from x;
with x as (insert into promotions (created_by, name_en, name_ar, type, value, enabled, in_app, auto)
  values ((select val from v where k='owner'), 'P0430', 'P0430', 'percent', 10, true, true, false) returning id) insert into v select 'promo', id from x;
with x as (insert into day_sessions (business_date, status, opened_by, opening_float_iqd, venue_id, closed_at)
  values (date '1951-03-03', 'closed', (select val from v where k='owner'), 0, '${VENUE_A_ID}', now()) returning id) insert into v select 'ds', id from x;
with x as (insert into tabs (day_session_id, venue_id, label, customer_id) values ((select val from v where k='ds'), '${VENUE_A_ID}', 'T0430a', (select val from v where k='guest')) returning id) insert into v select 'ta', id from x;
with x as (insert into tabs (day_session_id, venue_id, label, customer_id) values ((select val from v where k='ds'), '${VENUE_A_ID}', 'T0430b', (select val from v where k='guest')) returning id) insert into v select 'tb', id from x;
insert into loyalty_cards (profile_id, member_code, secret, deal_promotion_id, deal_picked_at, deal_uses_before)
values ((select val from v where k='guest'), 'ZZ0430ZZ', extensions.gen_random_bytes(20), (select val from v where k='promo'), now(), 0)
on conflict (profile_id) do update set deal_promotion_id = excluded.deal_promotion_id, deal_picked_at = now(), deal_uses_before = 0;
select 'before', app.loyalty_picked_deal_on((select val from v where k='guest'), (select val from v where k='tb')) = (select val from v where k='promo');
with x as (insert into tab_adjustments (tab_id, kind, value, amount_iqd, applied_by, authorized_by, reason_code, promotion_id)
  values ((select val from v where k='ta'), 'discount_amount', 100, 100, (select val from v where k='owner'), (select val from v where k='owner'), 'promotion', (select val from v where k='promo')) returning id) insert into v select 'adj', id from x;
insert into promotion_redemptions (promotion_id, tab_id, adjustment_id, amount_iqd, redeemed_by, customer_id)
values ((select val from v where k='promo'), (select val from v where k='ta'), (select val from v where k='adj'), 100, (select val from v where k='owner'), (select val from v where k='guest'));
select 'other_bill_blocked', app.loyalty_picked_deal_on((select val from v where k='guest'), (select val from v where k='tb')) is null;
select 'own_bill_keeps', app.loyalty_picked_deal_on((select val from v where k='guest'), (select val from v where k='ta')) = (select val from v where k='promo');
select 'canon', app.phone_canon('+964 0770 123 4567') = '7701234567' and app.phone_canon('07701234567') = '7701234567' and app.phone_canon('009647701234567') = '7701234567' and app.phone_canon('+90 532 123 4567') = '905321234567';
select 'court_lock_first', position('from tabs t' in prosrc) between 1 and position('app.lock_court' in prosrc) from pg_proc where proname = 'apply_customer_court_discount';
-- 5. one phone, one account: B signing in on A's phone takes the token from A
with x as (insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'g0430b-' || substr(md5(random()::text), 1, 8) || '@test.local', '{"full_name": "Guest 0430 B"}')
  returning id) insert into v select 'guest_b', id from x;
update profiles set expo_push_token = 'ExponentPushToken[t0430]' where id = (select val from v where k='guest');
update profiles set expo_push_token = 'ExponentPushToken[t0430]' where id = (select val from v where k='guest_b');
select 'push_moved', (select expo_push_token from profiles where id = (select val from v where k='guest')) is null
   and (select expo_push_token from profiles where id = (select val from v where k='guest_b')) = 'ExponentPushToken[t0430]';
-- reinstall: the same account writes its token again and keeps it
update profiles set expo_push_token = 'ExponentPushToken[t0430]' where id = (select val from v where k='guest_b');
select 'push_rewrite_keeps', (select expo_push_token from profiles where id = (select val from v where k='guest_b')) = 'ExponentPushToken[t0430]';
-- 4. a page blocked for the manager stays blocked through queued_rpc
create temp table res (k text, val text);
update staff set blocked_areas = '{admin}' where id = '${SEED_STAFF_IDS.manager}';
do $blk$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '${SEED_STAFF_IDS.manager}', 'role', 'authenticated')::text, true);
  begin
    perform app.queued_rpc_claim('TILL1:rpc.queued:01J5XAAAAAAAAAAAAAAAAAAAAA', 'add_coach_time_off');
    insert into res values ('area', 'passed');
  exception when others then
    insert into res values ('area', sqlerrm);
  end;
  perform set_config('request.jwt.claims', '', true);
end $blk$;
select 'area_blocked', val = 'AREA_BLOCKED' from res where k = 'area';
rollback;`;

describe.skipIf(!docker)('0430 audit fixes', () => {
  it('one pick one bill, +964 0, court discount lock, blocked pages through the queue, one phone one account', () => {
    const rows = Object.fromEntries(
      psql(SCENARIO)
        .split('\n')
        .filter((l) => l.includes('|'))
        .map((l) => l.split('|') as [string, string]),
    );
    expect(rows).toEqual({
      before: 't',
      other_bill_blocked: 't',
      own_bill_keeps: 't',
      canon: 't',
      court_lock_first: 't',
      push_moved: 't',
      push_rewrite_keeps: 't',
      area_blocked: 't',
    });
  });
});
