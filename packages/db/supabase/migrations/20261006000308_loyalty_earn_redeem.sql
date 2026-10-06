set lock_timeout = '3s';
set statement_timeout = '60s';

-- loyalty_earn_redeem — the second review of the loyalty engine (0305/0306;
-- decisions of 2026-10-06: spending points needs the member's QR or a manager
-- PIN; everything earns, online money included, each domain behind its own
-- switch). Every function below is re-issued from its latest body (0305 or
-- 0306) with the marked 0308 lines.
--
--   c2  loyalty_redeem takes p_member_token: the token must name the tab's
--       customer (single use), or the caller spends a manager PIN grant whose
--       authorizer is not the customer. authorized_by records who vouched.
--       set_tab_customer asks a PIN grant before attaching an active staff
--       member (the caller included) and records tabs.customer_method.
--   c3  member tokens are single use (loyalty_cards.last_counter) inside a
--       ±1 step window; failed tries land in loyalty_token_attempts and lock
--       a caller (5 per 10 minutes anonymous, 10 staff) and a member code
--       (20 per hour). link_guest_session answers a bad token with
--       {linked: false} so the try is kept, and never says "expired".
--   c4  app.tab_customer reads the tournament entry's and the lesson
--       enrolment's guest, and an open-match seat tab's seat holder.
--   c5  booking_payments earn when they succeed (deposit and ticket under
--       earn_court, lesson under earn_lesson) and claw back when refunded.
--   c12 the café fallback ignores voided orders and needs one linked profile.
--   c23 the booking guest's fallback is only for the tab that carries the
--       booking's court line.
--   c13 a reward worth more than the bill is REWARD_EXCEEDS_BILL; at settle
--       the points of a redemption the discount cap swallowed come back
--       (redeem_void); a refund of a settled tab gives back its share of the
--       points spent on it.
--   c22 the clawback works on a cumulative target over the eligible base the
--       earn stored (earn_base_iqd, earn_court_iqd), itemised refunds counted
--       as goods.
--   c17 loyalty_adjust: never on yourself, never a gift to active staff, a
--       gift above 1,000 points is the owner's, and adjust rows no longer
--       count toward lifetime or the 12-month tier points.
--   c43 loyalty_customer is the desk's (cashier, shop_staff, court_desk,
--       manager, owner).
--   s1  my_loyalty shows a note only on reward and expire rows.
--   s2  the minimum is checked again after the points are fitted to the bill.
--   c7  (from the 0309 list, here because set_tab_customer is re-issued
--       here) a customer change re-checks the tab's promotion: tierMin and
--       perCustomer are tested for the new customer and the promotion is
--       dropped (audited promotion.drop_on_customer_change) when it no longer
--       qualifies; otherwise its redemption follows the new customer.
--
-- Lock order: unchanged. The new deferred triggers (redeem cap at settle,
-- booking-payment earn and claw) write ledger rows whose account recompute
-- takes loyalty_accounts last, at commit. loyalty_cards, pin_grants and
-- loyalty_token_attempts are unranked single-row writes, like pin_grants
-- elsewhere.

-- ===========================================================================
-- 1. Columns and the attempts table
-- ===========================================================================

alter table tabs add column if not exists customer_method text;

do $tabs_customer_method_0308$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'tabs_customer_method'
                    and conrelid = 'public.tabs'::regclass) then
    alter table tabs add constraint tabs_customer_method
      check (customer_method is null or customer_method in ('qr', 'phone', 'desk', 'session', 'booking')) not valid;
  end if;
end $tabs_customer_method_0308$;

do $tabs_customer_method_validate_0308$
begin
  if exists (select 1 from pg_constraint
              where conname = 'tabs_customer_method'
                and conrelid = 'public.tabs'::regclass
                and not convalidated) then
    alter table tabs validate constraint tabs_customer_method;
  end if;
end $tabs_customer_method_validate_0308$;

comment on column tabs.customer_method is
  'Loyalty (0308, c2). How the desk identified tabs.customer_id: qr (a member token this caller identified in the last 15 minutes), phone, or desk (anything else, such as a record picked by id). Null with no attached customer. Informational: a redemption always needs the member''s token or a manager PIN.';

alter table loyalty_cards add column if not exists last_counter bigint;

comment on column loyalty_cards.last_counter is
  'Loyalty (0308, c3). The TOTP counter of the last member token spent (a redemption or a café link): a token is single use, only a later counter is accepted.';

alter table loyalty_ledger add column if not exists earn_base_iqd bigint;
alter table loyalty_ledger add column if not exists earn_court_iqd bigint;

comment on column loyalty_ledger.earn_base_iqd is
  'Loyalty (0308, c22). On an earn row: the IQD that earned (the eligible court part plus the eligible goods part), the base a later clawback is measured against.';
comment on column loyalty_ledger.earn_court_iqd is
  'Loyalty (0308, c22). On an earn row: the eligible court part of earn_base_iqd (0 when earn_court was off).';

create table if not exists loyalty_token_attempts (
  id           bigint generated always as identity primary key,
  auth_user_id uuid,
  member_code  text,
  ok           boolean not null,
  at           timestamptz not null default clock_timestamp()
);

comment on table loyalty_token_attempts is
  'Loyalty (0308, c3). Every member-token or phone lookup at app.link_guest_session and app.loyalty_identify, success or not: the throttle counts the failures per caller (10 minutes) and per member code (an hour). Rows older than a day are pruned on write. No client grant.';

alter table loyalty_token_attempts enable row level security;
revoke all on loyalty_token_attempts from anon, authenticated;
grant all on loyalty_token_attempts to service_role;

-- ===========================================================================
-- 2. The member token: one match, a throttle, single use
-- ===========================================================================

-- The member code a token names (upper case), or null when it is not shaped
-- like one.
create or replace function app.loyalty_token_code(p_token text) returns text
language sql immutable set search_path = public as $loyalty_token_code_0308$
  select (regexp_match(upper(btrim(coalesce(p_token, ''))), '^TP-([0-9A-HJKMNP-TV-Z]{8})-([0-9]{6})$'))[1]
$loyalty_token_code_0308$;

revoke all on function app.loyalty_token_code(text) from public, anon, authenticated;

-- The profile and counter a member token names (internal). 0308 (c3): the
-- current step ±1 is accepted; a match within ten minutes outside it is
-- MEMBER_CODE_EXPIRED, anything else MEMBER_CODE_INVALID.
create or replace function app.loyalty_token_match(p_token text, out profile_id uuid, out counter bigint)
language plpgsql stable security definer set search_path = public as $loyalty_token_match_0308$
declare
  v_t       text := upper(btrim(coalesce(p_token, '')));
  v_m       text[];
  v_card    loyalty_cards%rowtype;
  v_step    int;
  v_now     bigint;
  v_window  int;
  k         int;
begin
  v_m := regexp_match(v_t, '^TP-([0-9A-HJKMNP-TV-Z]{8})-([0-9]{6})$');
  if v_m is null then
    raise exception 'MEMBER_CODE_INVALID' using errcode = 'P0001';
  end if;
  select c.* into v_card
    from loyalty_cards c
    join profiles p on p.id = c.profile_id and p.deleted_at is null
   where c.member_code = v_m[1];
  if not found then
    raise exception 'MEMBER_CODE_INVALID' using errcode = 'P0001';
  end if;
  v_step := coalesce((select s.totp_step_seconds from loyalty_settings s where s.id), 30);
  v_now := floor(extract(epoch from now()) / v_step)::bigint;
  for k in -1 .. 1 loop
    if app.loyalty_totp(v_card.secret, v_now + k) = v_m[2] then
      profile_id := v_card.profile_id;
      counter := v_now + k;
      return;
    end if;
  end loop;
  v_window := ceil(600.0 / v_step)::int;
  for k in -v_window .. v_window loop
    continue when k between -1 and 1;
    if app.loyalty_totp(v_card.secret, v_now + k) = v_m[2] then
      raise exception 'MEMBER_CODE_EXPIRED' using errcode = 'P0001';
    end if;
  end loop;
  raise exception 'MEMBER_CODE_INVALID' using errcode = 'P0001';
end $loyalty_token_match_0308$;

comment on function app.loyalty_token_match(text) is
  'Loyalty (0308, c3). Internal: the live profile and the TOTP counter a TP-<member_code>-<6 digits> token names, the digits checked against counters now ± 1 (now = floor(epoch / totp_step_seconds)). MEMBER_CODE_EXPIRED when they match a step within ten minutes outside that window, MEMBER_CODE_INVALID otherwise. Reads only: app.loyalty_token_consume spends a token.';

revoke all on function app.loyalty_token_match(text) from public, anon, authenticated;

-- loyalty_token_profile: re-issued from 20261005000305_loyalty.sql:652 as a
-- reader over app.loyalty_token_match (0308: ±1 step, not ±2).
create or replace function app.loyalty_token_profile(p_token text) returns uuid
language plpgsql stable security definer set search_path = public as $loyalty_token_profile_0308$
begin
  return (app.loyalty_token_match(p_token)).profile_id;
end $loyalty_token_profile_0308$;

comment on function app.loyalty_token_profile(text) is
  'Loyalty (M3; 0308). Internal: the live profile a member token names (app.loyalty_token_match: now ± 1 step, MEMBER_CODE_EXPIRED, MEMBER_CODE_INVALID), without spending it.';

revoke all on function app.loyalty_token_profile(text) from public, anon, authenticated;

-- Spend a member token (internal, 0308 c3): the counter must be later than the
-- card's last spent one. A replay is MEMBER_CODE_INVALID.
create or replace function app.loyalty_token_consume(p_token text) returns uuid
language plpgsql security definer set search_path = public as $loyalty_token_consume_0308$
declare
  v_match record;
begin
  select * into v_match from app.loyalty_token_match(p_token);
  update loyalty_cards
     set last_counter = v_match.counter
   where profile_id = v_match.profile_id
     and (last_counter is null or last_counter < v_match.counter);
  if not found then
    raise exception 'MEMBER_CODE_INVALID' using errcode = 'P0001', detail = 'replayed';
  end if;
  return v_match.profile_id;
end $loyalty_token_consume_0308$;

comment on function app.loyalty_token_consume(text) is
  'Loyalty (0308, c3). Internal: spends a member token: app.loyalty_token_match, then loyalty_cards.last_counter moves to the token''s counter, only forward (a row-locking update, so two spends of one token cannot both pass). A replay is MEMBER_CODE_INVALID (detail replayed). Returns the profile.';

revoke all on function app.loyalty_token_consume(text) from public, anon, authenticated;

-- The throttle (internal, 0308 c3): MEMBER_CODE_LOCKED once the caller has
-- p_user_limit failures in ten minutes, or the member code 20 in an hour.
create or replace function app.loyalty_throttle_check(p_uid uuid, p_code text, p_user_limit int) returns void
language plpgsql stable security definer set search_path = public as $loyalty_throttle_check_0308$
begin
  if p_uid is not null and (select count(*) from loyalty_token_attempts a
                             where a.auth_user_id = p_uid and not a.ok
                               and a.at > now() - interval '10 minutes') >= p_user_limit then
    raise exception 'MEMBER_CODE_LOCKED' using errcode = 'P0001', detail = 'caller';
  end if;
  if p_code is not null and (select count(*) from loyalty_token_attempts a
                              where a.member_code = p_code and not a.ok
                                and a.at > now() - interval '1 hour') >= 20 then
    raise exception 'MEMBER_CODE_LOCKED' using errcode = 'P0001', detail = 'member_code';
  end if;
end $loyalty_throttle_check_0308$;

comment on function app.loyalty_throttle_check(uuid, text, int) is
  'Loyalty (0308, c3). Internal: MEMBER_CODE_LOCKED (detail caller | member_code) when the caller has p_user_limit failed lookups in the last ten minutes, or the member code 20 in the last hour (loyalty_token_attempts).';

revoke all on function app.loyalty_throttle_check(uuid, text, int) from public, anon, authenticated;

create or replace function app.loyalty_attempt_record(p_uid uuid, p_code text, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $loyalty_attempt_record_0308$
begin
  delete from loyalty_token_attempts where at < now() - interval '1 day';
  insert into loyalty_token_attempts (auth_user_id, member_code, ok) values (p_uid, p_code, p_ok);
end $loyalty_attempt_record_0308$;

comment on function app.loyalty_attempt_record(uuid, text, boolean) is
  'Loyalty (0308, c3). Internal: one loyalty_token_attempts row (rows older than a day pruned first).';

revoke all on function app.loyalty_attempt_record(uuid, text, boolean) from public, anon, authenticated;

-- ===========================================================================
-- 3. The customer of a tab (c4, c12, c23)
-- ===========================================================================

-- tab_customer: re-issued from 20261005000305_loyalty.sql:217
create or replace function app.tab_customer(p_tab_id uuid) returns uuid
language plpgsql stable security definer set search_path = public as $tab_customer_0308$
declare
  v_tab tabs%rowtype;
  v     uuid;
  v_n   int;   -- 0308
begin
  select * into v_tab from tabs where id = p_tab_id;
  if not found then
    return null;
  end if;
  if v_tab.customer_id is not null then
    select p.id into v from profiles p where p.id = v_tab.customer_id and p.deleted_at is null;
    if v is not null then
      return v;
    end if;
  end if;
  -- 0308 (c4): a tournament or lesson tab is its entry's or enrolment's guest.
  if v_tab.tournament_entry_id is not null then
    select p.id into v
      from tournament_entries e
      join profiles p on p.id = e.guest_id and p.deleted_at is null
     where e.id = v_tab.tournament_entry_id;
    return v;
  end if;
  if v_tab.lesson_enrolment_id is not null then
    select p.id into v
      from lesson_enrolments e
      join profiles p on p.id = e.guest_id and p.deleted_at is null
     where e.id = v_tab.lesson_enrolment_id;
    return v;
  end if;
  if v_tab.reservation_id is not null then
    -- 0308 (c4, c23): a capped tab (an open-match seat share, or a bill
    -- closed by match_link_payment) is the seats its payments paid for, when
    -- they name one account; never the booking's guest.
    if v_tab.court_cap_iqd is not null then
      select count(distinct s.guest_id), (array_agg(distinct s.guest_id))[1]
        into v_n, v
        from payments pay
        join payment_match_seats pm on pm.payment_id = pay.id
        join match_seats s on s.id = pm.match_seat_id
       where pay.tab_id = p_tab_id and s.guest_id is not null;
      if v_n = 1 and exists (select 1 from profiles p where p.id = v and p.deleted_at is null) then
        return v;
      end if;
      return null;
    end if;
    -- 0308 (c23): the booking's guest only on the tab that carries the court
    -- line: not once another tab of the booking settled with court money.
    if not exists (select 1 from tabs o
                    where o.reservation_id = v_tab.reservation_id and o.id <> v_tab.id
                      and o.status = 'settled' and coalesce(o.court_iqd, 0) > 0) then
      select p.id into v
        from reservations r
        join profiles p on p.id = r.guest_id and p.deleted_at is null
       where r.id = v_tab.reservation_id;
      if v is not null then
        return v;
      end if;
    end if;
  end if;
  -- 0308 (c12): the café sessions that ordered something not voided; one
  -- linked account only (more than one is the desk's call: attach someone).
  select count(distinct p.id), (array_agg(distinct p.id))[1]
    into v_n, v
    from orders o
    join guest_sessions g on g.id = o.guest_session_id
    join profiles p on p.id = g.linked_profile_id and p.deleted_at is null
   where o.tab_id = p_tab_id
     and o.source = 'guest_web'
     and o.status <> 'voided'
     and exists (select 1 from order_items oi where oi.order_id = o.id and not oi.voided);
  if v_n = 1 then
    return v;
  end if;
  return null;
end $tab_customer_0308$;

comment on function app.tab_customer(uuid) is
  'Loyalty (M3; 0308). Internal: the customer of a tab: tabs.customer_id; else a tournament tab''s entry guest or a lesson tab''s enrolment guest; else, on a booking tab with court_cap_iqd (an open-match seat share), the one account among the seats its payments are linked to; else the booking''s guest, but only while no other tab of the booking has settled with court money (c23); else the one linked profile among the guest_web orders that hold a line not voided (two or more linked accounts: none, the desk attaches). A deleted profile counts as none; NULL when there is no customer.';

revoke all on function app.tab_customer(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 4. The account cache: adjust rows do not raise a tier (c17)
-- ===========================================================================

-- loyalty_recompute: re-issued from 20261005000305_loyalty.sql:306
create or replace function app.loyalty_recompute(p_profile uuid) returns void
language plpgsql security definer set search_path = public as $loyalty_recompute_0308$
declare
  v_balance  bigint;
  v_life     bigint;
  v_12m      bigint;
  v_last     timestamptz;
  v_tier     uuid;
begin
  if p_profile is null then
    return;
  end if;
  -- The row first, then the sums: a concurrent writer for the same profile
  -- holds this row until it commits, and the sums below (a fresh snapshot,
  -- after the wait) then include its ledger row. Summing first and upserting
  -- after the wait would write a balance that misses it.
  insert into loyalty_accounts (profile_id) values (p_profile) on conflict (profile_id) do nothing;
  perform 1 from loyalty_accounts a where a.profile_id = p_profile for update;

  -- 0308 (c17): lifetime and the 12-month tier points are earn + clawback; a
  -- manager's adjustment moves the balance only.
  select coalesce(sum(l.delta), 0),
         coalesce(sum(l.delta) filter (where l.kind in ('earn', 'clawback')), 0),
         coalesce(sum(l.delta) filter (where l.kind in ('earn', 'clawback')
                                         and l.created_at > now() - interval '12 months'), 0),
         max(l.created_at) filter (where l.kind <> 'expire')
    into v_balance, v_life, v_12m, v_last
    from loyalty_ledger l
   where l.profile_id = p_profile;

  select t.id into v_tier
    from loyalty_tiers t
   where t.min_points_12m <= greatest(v_12m, 0)
   order by t.min_points_12m desc
   limit 1;

  update loyalty_accounts
     set balance          = v_balance,
         lifetime_earned  = greatest(v_life, 0),
         points_12m       = greatest(v_12m, 0),
         tier_id          = v_tier,
         last_activity_at = v_last,
         updated_at       = now()
   where profile_id = p_profile;
end $loyalty_recompute_0308$;

comment on function app.loyalty_recompute(uuid) is
  'Loyalty (M3; 0308). Internal: rebuilds one profile''s loyalty_accounts row from the ledger (balance = sum(delta); lifetime_earned and points_12m = earn + clawback, all time and the last 12 months: since 0308 a manager adjustment moves the balance only, never the tier; tier = the highest tier reached by points_12m; last_activity_at = the newest row that is not an expiry). Called after every ledger insert, by the nightly run and by the account merge (through to_regprocedure).';

revoke all on function app.loyalty_recompute(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 5. Earn and clawback on tabs (c22), the redeem cap at settle (c13)
-- ===========================================================================

-- trg_loyalty_earn: re-issued from 20261005000305_loyalty.sql:414
create or replace function app.trg_loyalty_earn() returns trigger
language plpgsql security definer set search_path = public as $trg_loyalty_earn_0308$
declare
  v_s        loyalty_settings%rowtype;
  v_tab      tabs%rowtype;
  v_customer uuid;
  v_paid     bigint;
  v_points   int;
  v_court    bigint;    -- 0308 (c22)
  v_own      boolean;   -- 0308
  v_bc       bigint;    -- 0308
  v_base     bigint;    -- 0308
begin
  select * into v_s from loyalty_settings where id;
  if not found or not v_s.enabled then
    return null;
  end if;
  select * into v_tab from tabs where id = new.id;
  if not found or v_tab.status <> 'settled' then
    return null;
  end if;
  v_customer := app.tab_customer(v_tab.id);
  if v_customer is null then
    return null;
  end if;

  -- Net of refunds (app.tab_net_paid, 0037): a refund taken while the tab was
  -- open (DISCOUNT_ / VOID_REQUIRES_REFUND, a method switch) found no earn to
  -- claw back, so the money it returned must not earn here either.
  v_paid := app.tab_net_paid(v_tab.id);
  v_points := app.loyalty_points_for(v_tab.kind, v_paid, coalesce(v_tab.court_iqd, 0), v_s.iqd_per_point,
                                     app.loyalty_multiplier(v_customer), v_s.earn_cafe, v_s.earn_shop,
                                     v_s.earn_court, v_s.earn_lesson, v_s.earn_tournament);
  -- 0308 (c22): the eligible base, as loyalty_points_for splits it, kept on
  -- the row for the clawback.
  v_court := least(greatest(coalesce(v_tab.court_iqd, 0), 0), greatest(v_paid, 0));
  v_own := case v_tab.kind when 'cafe' then v_s.earn_cafe when 'shop' then v_s.earn_shop
                           when 'lesson' then v_s.earn_lesson when 'tournament' then v_s.earn_tournament
                           else false end;
  v_bc := case when v_s.earn_court then v_court else 0 end;
  v_base := v_bc + case when coalesce(v_own, false) then greatest(v_paid, 0) - v_court else 0 end;
  if v_points > 0 then
    insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, tab_id, actor_id,
                                earn_base_iqd, earn_court_iqd)
    values (v_customer, v_tab.venue_id, v_points, 'earn', 'tab', v_tab.id, v_tab.id, auth.uid(), v_base, v_bc)
    on conflict (kind, source_kind, source_id) do nothing;
  end if;
  return null;
end $trg_loyalty_earn_0308$;

comment on function app.trg_loyalty_earn() is
  'Loyalty (M3, contracts §1.3, L-5; 0308). Deferred AFTER UPDATE OF status on tabs, when the tab becomes settled: skipped while loyalty is off, when the tab is no longer settled at commit, or with no customer (app.tab_customer). paid = the tab''s payments less its refunds (app.tab_net_paid); points = app.loyalty_points_for(kind, paid, court_iqd, iqd_per_point, the customer''s tier multiplier, the switches); a row (earn, tab, tab_id) when above 0, once (on conflict do nothing), with earn_base_iqd and earn_court_iqd (0308: the eligible IQD, for the clawback).';

revoke all on function app.trg_loyalty_earn() from public, anon, authenticated;

-- What a tab had been paid when it settled (internal, 0308): its payments less
-- the refunds taken up to the settle. A refund after it is created later
-- (app.refund in a later transaction).
create or replace function app.loyalty_tab_paid_at_settle(p_tab_id uuid) returns bigint
language sql stable security definer set search_path = public as $loyalty_tab_paid_at_settle_0308$
  select coalesce((select sum(p.amount_iqd) from payments p where p.tab_id = t.id), 0)
       - coalesce((select sum(r.amount_iqd) from refunds r join payments p on p.id = r.payment_id
                    where p.tab_id = t.id and r.created_at <= t.settled_at), 0)
    from tabs t
   where t.id = p_tab_id
$loyalty_tab_paid_at_settle_0308$;

revoke all on function app.loyalty_tab_paid_at_settle(uuid) from public, anon, authenticated;

-- trg_loyalty_clawback: re-issued from 20261005000305_loyalty.sql:468
create or replace function app.trg_loyalty_clawback() returns trigger
language plpgsql security definer set search_path = public as $trg_loyalty_clawback_0308$
declare
  v_tab     uuid;
  v_t       tabs%rowtype;        -- 0308
  v_earn    loyalty_ledger%rowtype;
  v_paid    bigint;
  v_prior   bigint;
  v_claw    bigint;
  v_base    bigint;              -- 0308 (c22)
  v_goods   boolean;             -- 0308
  v_elig    numeric;             -- 0308
  v_target  bigint;              -- 0308
  v_used    bigint;              -- 0308 (c13)
  v_back    bigint;              -- 0308
  v_post    bigint;              -- 0308
  v_who     uuid;                -- 0308
begin
  select p.tab_id into v_tab from payments p where p.id = new.payment_id;
  if v_tab is null then
    return null;
  end if;
  select * into v_t from tabs where id = v_tab;
  -- 0308: only a refund of a settled tab, taken after its settle, moves
  -- points; a refund taken while it was open shaped the earn instead.
  if v_t.status <> 'settled' or v_t.settled_at is null
     or not exists (select 1 from refunds r where r.id = new.id and r.created_at > v_t.settled_at) then
    return null;
  end if;
  v_paid := app.loyalty_tab_paid_at_settle(v_tab);
  if coalesce(v_paid, 0) <= 0 then
    return null;
  end if;

  select * into v_earn from loyalty_ledger l
   where l.kind = 'earn' and l.source_kind = 'tab' and l.source_id = v_tab;
  if found and exists (select 1 from profiles p where p.id = v_earn.profile_id and p.deleted_at is null) then
    -- 0308 (c22): a cumulative target over every refund since the settle:
    -- ceil(earned * eligible refunded / eligible base), never more than
    -- earned, less what earlier refunds already took. An itemised refund is
    -- goods (eligible when the goods earned); money refunded without items
    -- comes first out of what did not earn (a court fee while earn_court was
    -- off, goods while their switch was off), then out of the base.
    v_base  := coalesce(v_earn.earn_base_iqd, v_paid);
    v_goods := coalesce(v_earn.earn_base_iqd - v_earn.earn_court_iqd, v_paid) > 0;
    if v_base > 0 then
      select case when v_goods then x.items else 0 end
           + greatest(x.amount - x.items
                      - case when v_goods then greatest(v_paid - v_base, 0)
                             else greatest(v_paid - v_base - x.items, 0) end, 0)
        into v_elig
        from (select coalesce(sum(r.amount_iqd), 0) as amount,
                     coalesce(sum(least(r.amount_iqd,
                                        coalesce((select sum(round(oi.line_total_iqd::numeric * ri.qty / nullif(oi.qty, 0)))
                                                    from refund_items ri join order_items oi on oi.id = ri.order_item_id
                                                   where ri.refund_id = r.id), 0))), 0) as items
                from refunds r join payments p on p.id = r.payment_id
               where p.tab_id = v_tab and r.created_at > v_t.settled_at) x;
      v_target := least(v_earn.delta::bigint,
                        ceil((v_earn.delta::numeric * least(v_elig, v_base::numeric)) / v_base)::bigint);
      select coalesce(-sum(l.delta), 0) into v_prior
        from loyalty_ledger l
       where l.kind = 'clawback' and l.source_kind = 'refund' and l.tab_id = v_tab;
      v_claw := v_target - v_prior;
      if v_claw > 0 then
        insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, tab_id, actor_id)
        values (v_earn.profile_id, new.venue_id, -v_claw, 'clawback', 'refund', new.id, v_tab, auth.uid())
        on conflict (kind, source_kind, source_id) do nothing;
      end if;
    end if;
  end if;

  -- 0308 (c13): the points spent on the tab come back in proportion to the
  -- money refunded since the settle (floor, cumulative), to the account that
  -- spent them.
  select coalesce(-sum(l.delta) filter (where l.kind in ('redeem', 'reward')), 0)
       - coalesce(sum(l.delta) filter (where l.kind = 'redeem_void' and l.source_kind = 'tab_adjustment'), 0),
         coalesce(sum(l.delta) filter (where l.kind = 'redeem_void' and l.source_kind = 'refund'), 0)
    into v_used, v_back
    from loyalty_ledger l
   where l.tab_id = v_tab;
  if v_used > 0 then
    select l.profile_id into v_who
      from loyalty_ledger l
     where l.tab_id = v_tab and l.kind in ('redeem', 'reward')
     order by l.created_at desc
     limit 1;
    select coalesce(sum(r.amount_iqd), 0) into v_post
      from refunds r join payments p on p.id = r.payment_id
     where p.tab_id = v_tab and r.created_at > v_t.settled_at;
    v_target := floor((v_used::numeric * least(v_post, v_paid)) / v_paid)::bigint;
    if v_target - v_back > 0
       and exists (select 1 from profiles p where p.id = v_who and p.deleted_at is null) then
      insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, tab_id, actor_id)
      values (v_who, new.venue_id, v_target - v_back, 'redeem_void', 'refund', new.id, v_tab, auth.uid())
      on conflict (kind, source_kind, source_id) do nothing;
    end if;
  end if;
  return null;
end $trg_loyalty_clawback_0308$;

comment on function app.trg_loyalty_clawback() is
  'Loyalty (M3, contracts §1.3; 0308). Deferred AFTER INSERT on refunds, for a refund of a settled tab taken after its settle (paid = the payments less the refunds up to the settle). Clawback (c22): when the tab earned, a cumulative target ceil(earned * eligible refunded / earn_base_iqd), capped at earned, less the earlier clawbacks: an itemised refund (refund_items) is goods, eligible when the goods earned; money refunded without items comes first out of what did not earn (paid less earn_base_iqd), then out of the base; (clawback, refund, refund_id). Points spent (c13): floor(points spent on the tab * refunded since the settle / paid) less what earlier refunds gave back, as (redeem_void, refund, refund_id) to the account that spent them. Runs whether loyalty is on or off; skipped for a deleted profile. The balance may go negative.';

revoke all on function app.trg_loyalty_clawback() from public, anon, authenticated;

-- The redeem cap at settle (0308, c13): compute_tab_totals caps every
-- discount at the goods subtotal. The loyalty redemptions take what the other
-- discounts leave, in the order applied; the points of the part the cap
-- swallowed come back as (redeem_void, tab_adjustment, adjustment_id), the
-- key app.loyalty_unredeem uses on an open tab.
create or replace function app.trg_loyalty_redeem_cap() returns trigger
language plpgsql security definer set search_path = public as $trg_loyalty_redeem_cap_0308$
declare
  v_tab    tabs%rowtype;
  v_sub    bigint;
  v_other  bigint;
  v_room   bigint;
  v_used   bigint;
  v_back   bigint;
  a        record;
begin
  select * into v_tab from tabs where id = new.id;
  if not found or v_tab.status <> 'settled' then
    return null;
  end if;
  if not exists (select 1 from tab_adjustments x where x.tab_id = v_tab.id
                    and x.reason_code in ('loyalty_points', 'loyalty_reward')) then
    return null;
  end if;

  select coalesce(sum(oi.line_total_iqd), 0) into v_sub
    from order_items oi
    join orders o on o.id = oi.order_id
   where o.tab_id = v_tab.id and o.status <> 'voided' and not oi.voided;
  select coalesce(sum(x.amount_iqd), 0) into v_other
    from tab_adjustments x
   where x.tab_id = v_tab.id
     and x.kind in ('discount_percent', 'discount_amount')
     and x.reason_code is distinct from 'loyalty_points' and x.reason_code is distinct from 'loyalty_reward'
     and (x.order_item_id is null
          or exists (select 1 from order_items oi join orders o on o.id = oi.order_id
                      where oi.id = x.order_item_id and o.tab_id = v_tab.id
                        and o.status <> 'voided' and not oi.voided));
  v_room := greatest(v_sub - v_other, 0);

  for a in
    select x.id, x.amount_iqd, l.profile_id, l.venue_id, -l.delta as points
      from tab_adjustments x
      join loyalty_ledger l on l.kind in ('redeem', 'reward') and l.source_kind = 'tab_adjustment'
                           and l.source_id = x.id
     where x.tab_id = v_tab.id and x.reason_code in ('loyalty_points', 'loyalty_reward')
     order by x.created_at, x.id
  loop
    v_used := least(a.amount_iqd, v_room);
    v_room := v_room - v_used;
    if a.amount_iqd > v_used and a.amount_iqd > 0 then
      v_back := floor((a.points::numeric * (a.amount_iqd - v_used)) / a.amount_iqd)::bigint;
      if v_back > 0 then
        insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, tab_id, actor_id)
        values (a.profile_id, a.venue_id, v_back, 'redeem_void', 'tab_adjustment', a.id, v_tab.id, auth.uid())
        on conflict (kind, source_kind, source_id) do nothing;
      end if;
    end if;
  end loop;
  return null;
end $trg_loyalty_redeem_cap_0308$;

comment on function app.trg_loyalty_redeem_cap() is
  'Loyalty (0308, c13). Deferred AFTER UPDATE OF status on tabs, when the tab becomes settled: the loyalty redemptions on it take what the goods subtotal leaves after the other discounts (lines not voided, every manual and promotion discount first), in the order applied; for each, floor(points * unused / amount) points come back as (redeem_void, tab_adjustment, adjustment_id). Runs whether loyalty is on or off.';

revoke all on function app.trg_loyalty_redeem_cap() from public, anon, authenticated;

drop trigger if exists tabs_loyalty_redeem_cap on tabs;
create constraint trigger tabs_loyalty_redeem_cap
  after update of status on tabs
  deferrable initially deferred
  for each row
  when (new.status = 'settled' and old.status is distinct from 'settled')
  execute function app.trg_loyalty_redeem_cap();

-- ===========================================================================
-- 6. Online money earns (c5)
-- ===========================================================================

-- A succeeded booking payment earns its payer points (a deposit or a ticket
-- under earn_court, a lesson under earn_lesson); a refunded one takes back
-- its share. Deferred like the tab earn (loyalty_accounts last, at commit).
create or replace function app.trg_loyalty_booking_payment() returns trigger
language plpgsql security definer set search_path = public as $trg_loyalty_booking_payment_0308$
declare
  v_s      loyalty_settings%rowtype;
  v        booking_payments%rowtype;
  v_points int;
  v_court  boolean;
  v_earn   loyalty_ledger%rowtype;
  v_target bigint;
  v_prior  bigint;
begin
  select * into v from booking_payments where id = new.id;
  if not found or v.sandbox or v.guest_id is null then
    return null;
  end if;
  if not exists (select 1 from profiles p where p.id = v.guest_id and p.deleted_at is null) then
    return null;
  end if;

  if v.status = 'succeeded' and (tg_op = 'INSERT' or old.status is distinct from 'succeeded') then
    select * into v_s from loyalty_settings where id;
    if not found or not v_s.enabled then
      return null;
    end if;
    v_court := v.purpose in ('deposit', 'ticket');
    v_points := app.loyalty_points_for(case when v_court then 'court' else v.purpose end, v.amount_iqd,
                                       case when v_court then v.amount_iqd else 0 end, v_s.iqd_per_point,
                                       app.loyalty_multiplier(v.guest_id), v_s.earn_cafe, v_s.earn_shop,
                                       v_s.earn_court, v_s.earn_lesson, v_s.earn_tournament);
    if v_points > 0 then
      insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, actor_id,
                                  earn_base_iqd, earn_court_iqd)
      values (v.guest_id, v.venue_id, v_points, 'earn', 'booking_payment', v.id, auth.uid(),
              v.amount_iqd, case when v_court then v.amount_iqd else 0 end)
      on conflict (kind, source_kind, source_id) do nothing;
    end if;
  elsif v.status = 'refunded' and (tg_op = 'INSERT' or old.status is distinct from 'refunded') then
    select * into v_earn from loyalty_ledger l
     where l.kind = 'earn' and l.source_kind = 'booking_payment' and l.source_id = v.id;
    if not found or v.amount_iqd <= 0 then
      return null;
    end if;
    v_target := least(v_earn.delta::bigint,
                      ceil((v_earn.delta::numeric * coalesce(v.refund_amount_iqd, v.amount_iqd)) / v.amount_iqd)::bigint);
    select coalesce(-sum(l.delta), 0) into v_prior
      from loyalty_ledger l
     where l.kind = 'clawback' and l.source_kind = 'booking_refund' and l.source_id = v.id;
    if v_target - v_prior > 0 then
      insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, actor_id)
      values (v_earn.profile_id, v.venue_id, -(v_target - v_prior), 'clawback', 'booking_refund', v.id, auth.uid())
      on conflict (kind, source_kind, source_id) do nothing;
    end if;
  end if;
  return null;
end $trg_loyalty_booking_payment_0308$;

comment on function app.trg_loyalty_booking_payment() is
  'Loyalty (0308, c5). Deferred AFTER INSERT OR UPDATE OF status on booking_payments (not sandbox, a live payer). Becoming succeeded, while loyalty is on: (earn, booking_payment, payment_id) of app.loyalty_points_for over the amount: deposit and ticket money is court money (earn_court), lesson money earn_lesson; the tier multiplier applies. Becoming refunded: (clawback, booking_refund, payment_id) of ceil(earned * refund_amount / amount), capped at earned, whether loyalty is on or off. A desk tab never counts this money again: court_fee_paid nets an online deposit out of the court line.';

revoke all on function app.trg_loyalty_booking_payment() from public, anon, authenticated;

drop trigger if exists booking_payments_loyalty on booking_payments;
create constraint trigger booking_payments_loyalty
  after insert or update of status on booking_payments
  deferrable initially deferred
  for each row
  when (new.status in ('succeeded', 'refunded'))
  execute function app.trg_loyalty_booking_payment();

-- ===========================================================================
-- 7. The guest: history notes (s1), the café link (c3)
-- ===========================================================================

-- The guest's own history (s1): a note only on reward rows (the reward's
-- name) and expiry rows; a manager's adjustment reason stays staff-side.
create or replace function app.loyalty_history_guest(p_profile uuid, p_limit int) returns jsonb
language sql stable security definer set search_path = public as $loyalty_history_guest_0308$
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'kind', h.kind, 'delta', h.delta,
                                               'venue_id', h.venue_id, 'created_at', h.created_at,
                                               'note', case when h.kind in ('reward', 'expire') then h.note end)
                            order by h.created_at desc, h.id desc), '[]'::jsonb)
    from (select l.* from loyalty_ledger l
           where l.profile_id = p_profile
           order by l.created_at desc, l.id desc
           limit p_limit) h
$loyalty_history_guest_0308$;

revoke all on function app.loyalty_history_guest(uuid, int) from public, anon, authenticated;

-- my_loyalty: re-issued from 20261005000305_loyalty.sql:779
create or replace function app.my_loyalty() returns jsonb
language plpgsql stable security definer set search_path = public as $my_loyalty_0308$
declare
  v_me    uuid := app.loyalty_me();
  v_s     loyalty_settings%rowtype;
  v_acct  loyalty_accounts%rowtype;
  v_tier  loyalty_tiers%rowtype;
  v_next  jsonb;
begin
  select * into v_s from loyalty_settings where id;
  select * into v_acct from loyalty_accounts where profile_id = v_me;
  select * into v_tier from loyalty_tiers
   where id = coalesce(v_acct.tier_id, (select b.id from loyalty_tiers b order by b.sort limit 1));
  select jsonb_build_object('id', t.id, 'name_en', t.name_en, 'name_ar', t.name_ar,
                            'multiplier', t.earn_multiplier, 'min_points_12m', t.min_points_12m)
    into v_next
    from loyalty_tiers t
   where t.min_points_12m > coalesce(v_tier.min_points_12m, 0)
   order by t.min_points_12m
   limit 1;

  return jsonb_build_object(
    'enabled',           coalesce(v_s.enabled, false),
    'balance',           coalesce(v_acct.balance, 0),
    'lifetime',          coalesce(v_acct.lifetime_earned, 0),
    'points_12m',        coalesce(v_acct.points_12m, 0),
    'tier',              app.loyalty_tier_json(v_tier.id),
    'next_tier',         v_next,
    'point_value_iqd',   v_s.point_value_iqd,
    'min_redeem_points', v_s.min_redeem_points,
    'history',           app.loyalty_history_guest(v_me, 50),   -- 0308 (s1)
    'rewards',           coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'name_en', r.name_en, 'name_ar', r.name_ar,
                                          'cost_points', r.cost_points, 'kind', r.kind, 'iqd_off', r.iqd_off)
                       order by r.cost_points, r.id)
        from loyalty_rewards r
       where r.active), '[]'::jsonb));
end $my_loyalty_0308$;

comment on function app.my_loyalty() is
  'Loyalty (M3, contracts §1.3; 0308). The signed-in guest''s points: {enabled, balance, lifetime, points_12m, tier {id, name_en, name_ar, multiplier} (the base tier without an account), next_tier (+ min_points_12m) | null, point_value_iqd, min_redeem_points, history (50 newest LedgerRow; since 0308 the note only on reward and expire rows), rewards (every active one, any branch)}. AUTH_REQUIRED without a session, ACCOUNT_REQUIRED for an anonymous session or a deleted account.';

revoke all on function app.my_loyalty() from public, anon;
grant execute on function app.my_loyalty() to authenticated;

-- link_guest_session: re-issued from 20261005000305_loyalty.sql:865
create or replace function app.link_guest_session(p_member_token text) returns jsonb
language plpgsql security definer set search_path = public as $link_guest_session_0308$
declare
  v_uid     uuid := auth.uid();
  v_sess    guest_sessions%rowtype;
  v_profile uuid;
  v_code    text := app.loyalty_token_code(p_member_token);   -- 0308
  v_msg     text;                                             -- 0308
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_uid and u.is_anonymous) then
    raise exception 'FORBIDDEN' using errcode = 'P0001',
      detail = 'only an anonymous café session links to an account';
  end if;
  select * into v_sess
    from guest_sessions
   where auth_user_id = v_uid and closed_at is null and expires_at > now()
   order by created_at desc
   limit 1
   for update;
  if not found then
    raise exception 'SESSION_EXPIRED' using errcode = 'P0001';
  end if;

  -- 0308 (c3): five failures in ten minutes lock the session's user, twenty
  -- in an hour the member code; a token is spent once; a failure is answered
  -- (not raised) so its attempt row commits, and always as invalid.
  perform app.loyalty_throttle_check(v_uid, v_code, 5);   -- MEMBER_CODE_LOCKED
  begin
    v_profile := app.loyalty_token_consume(p_member_token);
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg not in ('MEMBER_CODE_INVALID', 'MEMBER_CODE_EXPIRED') then
      raise;
    end if;
    perform app.loyalty_attempt_record(v_uid, v_code, false);
    return jsonb_build_object('linked', false, 'error', 'MEMBER_CODE_INVALID');
  end;
  perform app.loyalty_attempt_record(v_uid, v_code, true);

  update guest_sessions set linked_profile_id = v_profile where id = v_sess.id;
  perform set_config('app.venue_id', v_sess.venue_id::text, true);
  perform app.write_audit('loyalty.link_session', 'guest_sessions', v_sess.id::text,
                          jsonb_build_object('linked_profile_id', v_sess.linked_profile_id),
                          jsonb_build_object('linked_profile_id', v_profile), null);
  return jsonb_build_object('linked', true, 'display_name', app.loyalty_display_name(v_profile));
end $link_guest_session_0308$;

comment on function app.link_guest_session(text) is
  'Loyalty (M3, contracts §1.3; 0308). An anonymous café session (auth.users.is_anonymous) with a live guest_sessions row sets its linked_profile_id from a member token, spent once (app.loyalty_token_consume, now ± 1 step). Returns {linked: true, display_name}; a token that does not pass (wrong, expired, replayed) answers {linked: false, error: MEMBER_CODE_INVALID} and is counted. AUTH_REQUIRED, FORBIDDEN (not anonymous), SESSION_EXPIRED (no live session), MEMBER_CODE_LOCKED (5 failures by this user in 10 minutes, or 20 on the member code in an hour). Audited loyalty.link_session.';

revoke all on function app.link_guest_session(text) from public, anon;
grant execute on function app.link_guest_session(text) to authenticated;

-- ===========================================================================
-- 8. The desk
-- ===========================================================================

-- loyalty_identify: re-issued from 20261005000305_loyalty.sql:910
create or replace function app.loyalty_identify(p_code text, p_venue_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $loyalty_identify_0308$
declare
  v_raw     text := upper(btrim(coalesce(p_code, '')));
  v_digits  text;
  v_key     text;
  v_profile profiles%rowtype;
  v_id      uuid;
  v_method  text;
  v_acct    loyalty_accounts%rowtype;
  v_tier    loyalty_tiers%rowtype;
  v_code    text := app.loyalty_token_code(p_code);   -- 0308
  v_msg     text;                                     -- 0308
begin
  if not app.is_staff('cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_venue_id is not null then
    if not (p_venue_id = any(app.visible_venue_ids())) then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', p_venue_id::text, true);
  end if;

  -- 0308 (c3): ten failed lookups in ten minutes lock the caller, twenty in an
  -- hour a member code; a miss is answered as {error} so its attempt row
  -- commits. The token is read, not spent: the redemption spends it.
  perform app.loyalty_throttle_check(auth.uid(), v_code, 10);   -- MEMBER_CODE_LOCKED
  begin
    if v_raw like 'TP-%' then
      v_method := 'qr';
      v_id := app.loyalty_token_profile(v_raw);   -- MEMBER_CODE_INVALID | MEMBER_CODE_EXPIRED
    else
      v_digits := app.phone_digits(p_code);
      if v_raw ~ '[A-Z]' or v_digits is null or length(v_digits) not between 7 and 15 then
        raise exception 'MEMBER_CODE_INVALID' using errcode = 'P0001';
      end if;
      v_method := 'phone';
      v_key := app.phone_canon(p_code);
      select p.id into v_id
        from profiles p
       where p.phone_key = v_key and p.deleted_at is null
       order by p.created_at
       limit 1;
      if v_id is null then
        raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
      end if;
    end if;
  exception when raise_exception then
    get stacked diagnostics v_msg = message_text;
    if v_msg not in ('MEMBER_CODE_INVALID', 'MEMBER_CODE_EXPIRED', 'MEMBER_NOT_FOUND') then
      raise;
    end if;
    perform app.loyalty_attempt_record(auth.uid(), v_code, false);
    return jsonb_build_object('customer_id', null, 'error', v_msg);
  end;
  perform app.loyalty_attempt_record(auth.uid(), v_code, true);

  select * into v_profile from profiles where id = v_id;
  select * into v_acct from loyalty_accounts where profile_id = v_id;
  select * into v_tier from loyalty_tiers
   where id = coalesce(v_acct.tier_id, (select b.id from loyalty_tiers b order by b.sort limit 1));

  perform app.write_audit('loyalty.identify', 'profiles', v_id::text, null,
                          jsonb_build_object('method', v_method, 'venue_id', p_venue_id), null);

  return jsonb_build_object(
    'customer_id',  v_id,
    'display_name', app.loyalty_display_name(v_id),
    'phone_masked', app.loyalty_phone_masked(v_profile.phone),
    'tier_name_en', v_tier.name_en,
    'tier_name_ar', v_tier.name_ar,
    'balance',      coalesce(v_acct.balance, 0),
    'enabled',      coalesce((select s.enabled from loyalty_settings s where s.id), false));
end $loyalty_identify_0308$;

comment on function app.loyalty_identify(text, uuid) is
  'Loyalty (M3, contracts §1.3, L-4; 0308). Cashier, shop_staff, court_desk, manager, owner; p_venue_id (when sent) one the caller can see (VENUE_MISMATCH). p_code is a member token (TP-…, app.loyalty_token_profile: now ± 1 step; read, not spent) or a phone of 7-15 digits matched exactly on profiles.phone_key. A miss answers {customer_id: null, error: MEMBER_CODE_INVALID | MEMBER_CODE_EXPIRED | MEMBER_NOT_FOUND} and is counted (loyalty_token_attempts); MEMBER_CODE_LOCKED after 10 misses by the caller in 10 minutes or 20 on the member code in an hour. Returns {customer_id, display_name (given name + family initial), phone_masked (last four digits), tier_name_en, tier_name_ar, balance, enabled}. Audited loyalty.identify {method qr|phone, venue_id}.';

revoke all on function app.loyalty_identify(text, uuid) from public, anon;
grant execute on function app.loyalty_identify(text, uuid) to authenticated;

-- set_tab_customer: re-issued from 20261005000305_loyalty.sql:976
create or replace function app.set_tab_customer(p_tab_id uuid, p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $set_tab_customer_0308$
declare
  v_venue uuid;
  v_tab   tabs%rowtype;
  v_auth   uuid;                          -- 0308 (c2)
  v_method text;                          -- 0308
  v_red    promotion_redemptions%rowtype; -- 0308 (c7)
  v_promo  promotions%rowtype;            -- 0308
  v_adj    tab_adjustments%rowtype;       -- 0308
  v_cust   uuid;                          -- 0308
  v_ok     boolean;                       -- 0308
  v_limit  bigint;                        -- 0308
begin
  if not app.is_staff('cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the tab's branch decides who may act and where the rows land.
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app.assert_tab_kind_role(v_tab.kind);   -- 0244: shop_staff shop tabs only
  if v_tab.status <> 'open' then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;
  if p_customer_id is not null
     and not exists (select 1 from profiles p where p.id = p_customer_id and p.deleted_at is null) then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_tab.customer_id is distinct from p_customer_id then
    -- 0308 (c2): points spent on the tab belong to the account that spent
    -- them; undo them before changing who the tab is for.
    if exists (select 1 from tab_adjustments a
                where a.tab_id = p_tab_id and a.reason_code in ('loyalty_points', 'loyalty_reward')) then
      raise exception 'LOYALTY_REDEEMED' using errcode = 'P0001';
    end if;
    -- 0308 (c2): an active staff member (the caller included) is attached
    -- only behind a manager PIN grant that is not their own.
    if p_customer_id is not null and exists (select 1 from staff s where s.id = p_customer_id and s.is_active) then
      v_auth := app.consume_pin_grant(null);   -- PIN_GRANT_REQUIRED
      if v_auth = p_customer_id then
        raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'self_dealing';
      end if;
    end if;
    -- 0308: how the desk knew them: a member token this caller identified in
    -- the last 15 minutes, a phone, or neither.
    if p_customer_id is not null then
      select coalesce(a.after->>'method', 'desk') into v_method
        from audit_log a
       where a.entity = 'profiles' and a.entity_id = p_customer_id::text
         and a.action = 'loyalty.identify' and a.actor_id = auth.uid()
         and a.at > now() - interval '15 minutes'
       order by a.id desc
       limit 1;
      v_method := coalesce(v_method, 'desk');
    end if;

    update tabs set customer_id = p_customer_id, customer_method = v_method where id = p_tab_id;
    perform app.write_audit('loyalty.attach', 'tabs', p_tab_id::text,
                            jsonb_build_object('customer_id', v_tab.customer_id),
                            jsonb_build_object('customer_id', p_customer_id, 'method', v_method), null,
                            v_auth);

    -- 0308 (c7): the tab's promotion was chosen for the earlier customer.
    -- tierMin and perCustomer are tested for the new one (app.tab_customer
    -- after the change); a promotion that no longer qualifies goes, one that
    -- does follows the new customer.
    select * into v_red from promotion_redemptions where tab_id = p_tab_id;
    if found then
      select * into v_promo from promotions where id = v_red.promotion_id;
      v_cust := app.tab_customer(p_tab_id);
      v_ok := true;
      if v_promo.limits ? 'tierMin' then
        v_ok := coalesce((select s.enabled from loyalty_settings s where s.id), false)
                and v_cust is not null
                and coalesce((select t.sort from loyalty_accounts a join loyalty_tiers t on t.id = a.tier_id
                               where a.profile_id = v_cust), 0) >= (v_promo.limits->>'tierMin')::int;
      end if;
      v_limit := (v_promo.limits->>'perCustomer')::bigint;
      if v_ok and v_limit is not null then
        v_ok := v_cust is not null
                and (select count(*) from promotion_redemptions r
                      where r.promotion_id = v_promo.id and r.customer_id = v_cust and r.tab_id <> p_tab_id) < v_limit;
      end if;
      if v_ok then
        update promotion_redemptions set customer_id = v_cust where id = v_red.id and customer_id is distinct from v_cust;
      else
        select * into v_adj from tab_adjustments where id = v_red.adjustment_id;
        delete from promotion_redemptions where id = v_red.id;
        delete from tab_adjustments where tab_id = p_tab_id and promotion_id is not null;
        perform app.write_audit('promotion.drop_on_customer_change', 'tab_adjustments', v_red.adjustment_id::text,
                                to_jsonb(v_adj) || jsonb_build_object('redemption', to_jsonb(v_red)),
                                jsonb_build_object('customer_id', v_cust), 'promotion');
      end if;
    end if;
  end if;
  return jsonb_build_object('tab_id', p_tab_id, 'customer_id', p_customer_id);
end $set_tab_customer_0308$;

comment on function app.set_tab_customer(uuid, uuid) is
  'Loyalty (M3, contracts §1.3; 0308). Cashier, shop_staff, court_desk, manager, owner at the tab''s branch (VENUE_MISMATCH), the tab''s kind for the role (app.assert_tab_kind_role, TAB_KIND_FORBIDDEN): attaches a guest to an open tab (TAB_NOT_OPEN), or detaches with null. MEMBER_NOT_FOUND for an unknown or deleted profile; TAB_NOT_FOUND. On a change (0308): LOYALTY_REDEEMED while points are used on the tab; an active staff member is attached only behind a manager PIN grant (PIN_GRANT_REQUIRED) not their own (FORBIDDEN detail self_dealing); tabs.customer_method = qr | phone (the caller''s loyalty.identify of that profile in the last 15 minutes) | desk; the tab''s promotion is re-checked for the new customer (tierMin, perCustomer) and dropped when it no longer qualifies (audited promotion.drop_on_customer_change), else its redemption follows the customer. Online-only (L-6). Returns {tab_id, customer_id}; audited loyalty.attach when it changes.';

revoke all on function app.set_tab_customer(uuid, uuid) from public, anon;
grant execute on function app.set_tab_customer(uuid, uuid) to authenticated;

-- loyalty_redeem: re-issued from 20261005000305_loyalty.sql:1027 with a new
-- argument, p_member_token (0308, c2): the old signature goes.
drop function if exists app.loyalty_redeem(uuid, int, uuid, text);

create or replace function app.loyalty_redeem(
  p_tab_id          uuid,
  p_points          int,
  p_reward_id       uuid,
  p_idempotency_key text,
  p_member_token    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $loyalty_redeem_0308$
declare
  v_venue     uuid;
  v_s         loyalty_settings%rowtype;
  v_replay    jsonb;
  v_tab       tabs%rowtype;
  v_customer  uuid;
  v_balance   bigint;
  v_reward    loyalty_rewards%rowtype;
  v_totals    record;
  v_room      bigint;
  v_points    int;
  v_amount    bigint;
  v_adj       tab_adjustments%rowtype;
  v_paid      bigint;
  v_new_total bigint;
  v_result    jsonb;
  v_auth      uuid;   -- 0308 (c2)
  v_how       text;   -- 0308
  v_member    uuid;   -- 0308
  v_value     bigint; -- 0308 (c13)
begin
  if not app.is_staff('cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := (select t.venue_id from tabs t where t.id = p_tab_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if (p_points is null) = (p_reward_id is null) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'exactly one of p_points and p_reward_id';
  end if;
  if p_points is not null and p_points < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_points';
  end if;
  select * into v_s from loyalty_settings where id;
  if not coalesce(v_s.enabled, false) then
    raise exception 'LOYALTY_OFF' using errcode = 'P0001';
  end if;

  -- 0049: claim after the guards and before any lock or write.
  v_replay := app.claim_replay(p_idempotency_key, 'loyalty_redeem');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app.assert_tab_kind_role(v_tab.kind);
  if v_tab.merged_into_tab_id is not null then
    raise exception 'TAB_MERGED' using errcode = 'P0001', detail = v_tab.merged_into_tab_id::text;
  end if;
  if v_tab.status <> 'open' then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;
  v_customer := app.tab_customer(p_tab_id);
  if v_customer is null then
    raise exception 'NO_CUSTOMER' using errcode = 'P0001';
  end if;

  -- 0308 (c2): the member is here (their token, spent once, names the tab's
  -- customer), or a manager vouches with a PIN grant that is not the
  -- customer's own. A member's token never lets staff spend their own points.
  if nullif(btrim(coalesce(p_member_token, '')), '') is not null then
    v_member := app.loyalty_token_consume(p_member_token);   -- MEMBER_CODE_INVALID | MEMBER_CODE_EXPIRED
    if v_member is distinct from v_customer then
      raise exception 'MEMBER_CODE_MISMATCH' using errcode = 'P0001';
    end if;
    if v_customer = auth.uid() then
      raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'self_dealing';
    end if;
    v_auth := auth.uid();
    v_how := 'qr';
  else
    v_auth := app.consume_pin_grant(null);   -- PIN_GRANT_REQUIRED
    if v_auth = v_customer then
      raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'self_dealing';
    end if;
    v_how := 'pin';
  end if;

  -- loyalty_accounts last (lock order): the balance read below holds.
  select a.balance into v_balance from loyalty_accounts a where a.profile_id = v_customer for update;
  v_balance := coalesce(v_balance, 0);

  select * into v_totals from app.compute_tab_totals(p_tab_id);
  v_room := least(greatest(coalesce(v_totals.subtotal_iqd, 0) - coalesce(v_totals.discount_iqd, 0), 0),
                  greatest(coalesce(v_totals.total_iqd, 0) - app.tab_net_paid(p_tab_id), 0));

  if p_reward_id is not null then
    select * into v_reward from loyalty_rewards r
     where r.id = p_reward_id and r.active and (r.venue_id is null or r.venue_id = v_tab.venue_id);
    if not found then
      raise exception 'REWARD_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_balance < v_reward.cost_points then
      raise exception 'POINTS_INSUFFICIENT' using errcode = 'P0001',
        detail = format('balance %s, cost %s', v_balance, v_reward.cost_points);
    end if;
    v_points := v_reward.cost_points;
    v_value := case when v_reward.kind = 'iqd_off' then v_reward.iqd_off::bigint
                    else (select v.price_iqd from menu_item_variants v where v.id = v_reward.menu_variant_id)
               end;
    -- 0308 (c13): a reward is used whole: worth more than what is left to
    -- discount, it would cost its points for less than its value.
    if coalesce(v_value, 0) > v_room then
      raise exception 'REWARD_EXCEEDS_BILL' using errcode = 'P0001',
        detail = format('reward %s, left %s', coalesce(v_value, 0), v_room);
    end if;
    v_amount := v_value;
  else
    if p_points < v_s.min_redeem_points then
      raise exception 'POINTS_BELOW_MIN' using errcode = 'P0001',
        detail = v_s.min_redeem_points::text;
    end if;
    if v_balance < p_points then
      raise exception 'POINTS_INSUFFICIENT' using errcode = 'P0001',
        detail = format('balance %s, asked %s', v_balance, p_points);
    end if;
    -- Rounded down to fit: the discount never exceeds what is left (redeemAmount).
    v_points := least(p_points::bigint, v_room / v_s.point_value_iqd)::int;
    v_amount := v_points::bigint * v_s.point_value_iqd;
    -- 0308 (s2): the minimum holds for what is actually used.
    if v_points >= 1 and v_points < v_s.min_redeem_points then
      raise exception 'POINTS_BELOW_MIN' using errcode = 'P0001',
        detail = v_s.min_redeem_points::text,
        hint = format('only %s points fit what is left to discount', v_points);
    end if;
  end if;
  if coalesce(v_amount, 0) < 1 or v_points < 1 then
    raise exception 'NOTHING_OWED' using errcode = 'P0001',
      hint = 'nothing on this bill is left to discount';
  end if;

  -- MATCH_BOOKING_NO_CAFE / LESSON_TAB_NO_GOODS come from the 0262/0281
  -- trigger on tab_adjustments, as for every discount.
  insert into tab_adjustments (tab_id, order_item_id, kind, value, amount_iqd,
                               applied_by, authorized_by, reason_code)
  values (p_tab_id, null, 'discount_amount', v_points, v_amount, auth.uid(), v_auth,
          case when p_reward_id is null then 'loyalty_points' else 'loyalty_reward' end)
  returning * into v_adj;

  insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, tab_id, actor_id, note)
  values (v_customer, v_tab.venue_id, -v_points,
          case when p_reward_id is null then 'redeem' else 'reward' end,
          'tab_adjustment', v_adj.id, p_tab_id, auth.uid(),
          case when p_reward_id is not null then left(v_reward.name_en, 200) end);

  -- DISCOUNT-AFTER-PAYMENT GUARD (0037), verbatim shape.
  v_paid := app.tab_net_paid(p_tab_id);
  if v_paid > 0 then
    select t.total_iqd into v_new_total from app.compute_tab_totals(p_tab_id) t;
    if v_new_total < v_paid then
      raise exception 'DISCOUNT_REQUIRES_REFUND' using errcode = 'P0001',
        detail = format('paid %s, post-discount total %s', v_paid, v_new_total),
        hint = 'refund the difference via app.refund before discounting';
    end if;
  end if;

  perform app.write_audit('loyalty.redeem', 'tab_adjustments', v_adj.id::text, null,
                          to_jsonb(v_adj) || jsonb_build_object('customer_id', v_customer,
                                                                'reward_id', p_reward_id,
                                                                'proof', v_how),
                          v_adj.reason_code, v_auth);

  v_result := jsonb_build_object(
    'adjustment_id', v_adj.id,
    'points',        v_points,
    'amount_iqd',    v_amount,
    'balance',       (select a.balance from loyalty_accounts a where a.profile_id = v_customer));
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $loyalty_redeem_0308$;

comment on function app.loyalty_redeem(uuid, int, uuid, text, text) is
  'Loyalty (M3, contracts §1.3, L-5; 0308). Cashier, shop_staff, court_desk, manager, owner at the tab''s branch, the tab''s kind for the role. Exactly one of p_points and p_reward_id (INVALID_ARGUMENT). LOYALTY_OFF, then claim_replay, then the tab (TAB_NOT_FOUND, TAB_MERGED, TAB_NOT_OPEN: open only) and its customer (NO_CUSTOMER). 0308 (c2): the proof: p_member_token, spent once, must name the customer (MEMBER_CODE_INVALID, MEMBER_CODE_EXPIRED, MEMBER_CODE_MISMATCH; FORBIDDEN self_dealing when the customer is the caller), or without it a manager PIN grant (PIN_GRANT_REQUIRED) whose authorizer is not the customer (FORBIDDEN self_dealing). Then the account, locked last. Points: POINTS_BELOW_MIN (min_redeem_points, checked again after the fit: hint the points that fit), POINTS_INSUFFICIENT, rounded down to fit what is left to discount (the goods not yet discounted, and the unpaid bill), amount = points * point_value_iqd. Reward: active, this branch or every branch (REWARD_NOT_FOUND), POINTS_INSUFFICIENT for cost_points, REWARD_EXCEEDS_BILL when its value (iqd_off or the variant''s price) is more than what is left (0308, c13). NOTHING_OWED when nothing is left to discount. Writes a tab_adjustments discount_amount (value = points, applied_by = the caller, authorized_by = the caller for a token or the PIN''s manager, reason_code loyalty_points | loyalty_reward) and a ledger row (redeem | reward, tab_adjustment, adjustment_id) in one transaction, then the 0037 guard. Returns {adjustment_id, points, amount_iqd, balance}. Audited loyalty.redeem {proof qr | pin}.';

revoke all on function app.loyalty_redeem(uuid, int, uuid, text, text) from public, anon;
grant execute on function app.loyalty_redeem(uuid, int, uuid, text, text) to authenticated;

-- loyalty_adjust: re-issued from 20261005000305_loyalty.sql:1232
create or replace function app.loyalty_adjust(p_profile_id uuid, p_delta int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $loyalty_adjust_0308$
declare
  v_auth   uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_id     uuid := gen_random_uuid();
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_delta';
  end if;
  if not exists (select 1 from profiles p where p.id = p_profile_id and p.deleted_at is null) then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- 0308 (c17): never your own points, never a gift to active staff, and a
  -- gift above 1,000 points is the owner's call.
  if p_profile_id = auth.uid() then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'self_dealing';
  end if;
  if p_delta > 0 and exists (select 1 from staff s where s.id = p_profile_id and s.is_active) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'staff_member';
  end if;
  if p_delta > 1000 and not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'owner_required';
  end if;

  -- 0115/0119: the caller proved a manager PIN to app.verify_manager_pin and
  -- holds a single-use grant; PIN_GRANT_REQUIRED otherwise.
  v_auth := app.consume_pin_grant(null);
  if v_auth = p_profile_id then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'self_dealing';
  end if;

  perform 1 from loyalty_accounts a where a.profile_id = p_profile_id for update;
  insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, actor_id, note)
  values (p_profile_id, null, p_delta, 'adjust', 'adjust', v_id, auth.uid(), left(app.safe_line(v_reason), 200));

  perform app.write_audit('loyalty.adjust', 'profiles', p_profile_id::text, null,
                          jsonb_build_object('delta', p_delta, 'ledger_source_id', v_id), v_reason, v_auth);
  return jsonb_build_object('balance',
    (select a.balance from loyalty_accounts a where a.profile_id = p_profile_id));
end $loyalty_adjust_0308$;

comment on function app.loyalty_adjust(uuid, int, text) is
  'Loyalty (M3, contracts §1.3; 0308). Manager or owner, behind a manager PIN grant (app.consume_pin_grant, PIN_GRANT_REQUIRED; 0115 pattern): adds p_delta points (non-zero, at most a million either way; INVALID_ARGUMENT) to a live profile (MEMBER_NOT_FOUND) with a reason (REASON_REQUIRED), as (adjust, adjust, fresh id) with the reason as the note. 0308 (c17): FORBIDDEN detail self_dealing for the caller''s own profile or a PIN of the member themself, staff_member for a positive delta to active staff, owner_required for more than 1,000 points by a manager. Moves the balance only: not lifetime, not the 12-month tier points. Returns {balance}. Audited loyalty.adjust with the authorizer.';

revoke all on function app.loyalty_adjust(uuid, int, text) from public, anon;
grant execute on function app.loyalty_adjust(uuid, int, text) to authenticated;

-- loyalty_customer: re-issued from 20261005000305_loyalty.sql:1272
create or replace function app.loyalty_customer(p_profile_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $loyalty_customer_0308$
declare
  v_acct loyalty_accounts%rowtype;
begin
  -- 0308 (c43): the desk roles, as every other loyalty desk read.
  if not app.is_staff('cashier', 'shop_staff', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles p where p.id = p_profile_id) then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_acct from loyalty_accounts where profile_id = p_profile_id;
  return jsonb_build_object(
    'balance',    coalesce(v_acct.balance, 0),
    'lifetime',   coalesce(v_acct.lifetime_earned, 0),
    'points_12m', coalesce(v_acct.points_12m, 0),
    'tier',       app.loyalty_tier_json(v_acct.tier_id),
    'history',    app.loyalty_history(p_profile_id, 100));
end $loyalty_customer_0308$;

comment on function app.loyalty_customer(uuid) is
  'Loyalty (M3, contracts §1.3; 0308). Cashier, shop_staff, court_desk, manager, owner (0308, c43: no longer any staff): one guest''s points for the customer record {balance, lifetime, points_12m, tier, history (100 newest LedgerRow)}. MEMBER_NOT_FOUND for an unknown profile.';

revoke all on function app.loyalty_customer(uuid) from public, anon;
grant execute on function app.loyalty_customer(uuid) to authenticated;
