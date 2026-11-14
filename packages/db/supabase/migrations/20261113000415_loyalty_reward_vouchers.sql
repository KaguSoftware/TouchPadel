-- ===========================================================================
-- 0415 loyalty_reward_vouchers — the guest redeems a reward in the app and
-- gets a QR for that one reward; the till scans it and the reward is done
-- (Majed, 2026-11-13).
--
-- Majed's calls (2026-11-13):
--   * the guest taps Redeem on a reward in the app; that makes a QR for that
--     exact reward and that exact guest; the person at the till scans it and
--     that fulfils the reward. Nothing else is pressed at the till;
--   * the points leave the balance at Redeem and are held by the voucher. A
--     voucher nobody used comes back by itself (expired), and the guest may
--     cancel one (points back at once);
--   * a voucher lives 15 minutes, shown with a countdown;
--   * the QR is fixed and used once: a screenshot works, so a guest may send
--     it to a friend to collect. Whoever holds the code holds the reward.
--
-- 1. Table loyalty_reward_vouchers: one row per redeemed reward: the member,
--    the reward, the points it holds, the code (TPV- and twelve Crockford
--    base32 characters, 60 random bits, unique), status active | used |
--    cancelled | expired, expires_at (created_at + 15 minutes), and once used
--    the tab, the staff member, and the tab adjustment or the free court hour
--    it became. RLS on, no client grant; read through app.my_reward_vouchers.
-- 2. Points. Redeem writes (reward, reward_voucher, the voucher id, -points),
--    the note the reward's English name. Cancel and expiry write
--    (redeem_void, reward_voucher, the voucher id, +points). Use hands the
--    held points over to the bill: (redeem_void, reward_voucher, the voucher
--    id, +points) and the bill's own (reward, tab_adjustment | reservation_
--    reward, its id, -points) in one transaction, so every rule that already
--    reads a redemption off the ledger holds unchanged: the till's Undo
--    (app.loyalty_unredeem) and a voided freed line at the settle
--    (app.trg_loyalty_redeem_cap) give the points back to the voucher's
--    member (the ledger row's profile_id), and so does a cancelled or
--    no-show booking's free court hour (app.trg_loyalty_court_reward_back).
--    loyalty_ledger_once allows one redeem_void per voucher, so a voucher can
--    never be both used and refunded. A used voucher stays used after an Undo
--    at the till: the points are back, and the guest redeems again.
--    The guest's history (app.loyalty_history_guest, re-issued) leaves the
--    hand-over pair out, so one used voucher reads as one "-60 Americano".
-- 3. RPCs for the guest (app.loyalty_me: AUTH_REQUIRED, ACCOUNT_REQUIRED):
--    app.redeem_reward(p_reward_id, p_idempotency_key): LOYALTY_OFF,
--    REWARD_NOT_FOUND (inactive or unknown), VOUCHER_LIMIT (five active at
--    once), POINTS_INSUFFICIENT; returns the voucher.
--    app.cancel_reward_voucher(p_voucher_id): the caller's own active
--    voucher (VOUCHER_NOT_FOUND, VOUCHER_USED detail used | cancelled |
--    expired); returns {balance}.
--    app.my_reward_vouchers(): {now, vouchers}: the active ones and those
--    ended in the last 30 minutes, newest first (the phone shows a voucher
--    turning to "collected" when the till scans it). It expires the caller's
--    own late vouchers first, so the balance it implies is never stale.
-- 4. The till: app.use_reward_voucher(p_tab_id, p_code, p_idempotency_key).
--    Cashier, shop_staff, court_desk, manager, owner at the tab's branch, as
--    app.loyalty_redeem. The code is the proof: no member card, no manager
--    PIN, no customer on the tab needed (a friend may collect it; the bill's
--    own customer, if any, still earns on what they pay). A code that names
--    no voucher is answered {error: VOUCHER_NOT_FOUND} and counted in
--    loyalty_token_attempts (ten misses in ten minutes lock the caller,
--    MEMBER_CODE_LOCKED), with the idempotency claim released.
--    VOUCHER_USED (detail used | cancelled | expired), VOUCHER_EXPIRED (past
--    expires_at plus one minute of grace for a scan at zero),
--    VOUCHER_WRONG_BRANCH (the reward belongs to another branch),
--    FORBIDDEN self_dealing (staff scanning their own voucher). Then the
--    reward exactly as app.loyalty_redeem gives it (0350, 0403): an item
--    reward frees one unit of its exact variant on the tab or orders it onto
--    the tab already free (REWARD_ITEM_NOT_ON_TAB at the court desk); a
--    court_hour reward frees one hour of the tab's booking
--    (REWARD_NEEDS_BOOKING, COURT_DISCOUNT_NOT_ALLOWED, REWARD_ALREADY_ON_
--    BOOKING, COURT_BILL_CLOSED, REWARD_EXCEEDS_BILL); an iqd_off reward
--    takes its IQD off (REWARD_EXCEEDS_BILL). A reward switched off after
--    the voucher was made is still honoured: the guest already paid for it.
--    The tab adjustment is reason_code loyalty_reward and the free hour's
--    proof is 'voucher', so the bill's loyalty list and its Undo show it as
--    any reward. Returns {voucher_id, reward_id, name_en, name_ar, kind,
--    points, amount_iqd, adjustment_id, order_item_id, item_added,
--    court_reward_id, reservation_id, member_name}.
-- 5. tp_reward_voucher_sweep (every minute): app.loyalty_voucher_sweep
--    expires every active voucher past expires_at plus the minute of grace
--    and gives its points back.
--
-- Shared with app.loyalty_redeem: the item, court-hour and IQD paths are
-- copied from 0403's body (marked "-- as 0403"), not called: loyalty_redeem
-- spends the tab customer's points behind a member token or PIN, a voucher
-- spends points already held. A change to either path changes both.
--
-- New: table loyalty_reward_vouchers; internals voucher_code_new,
-- loyalty_voucher_end, loyalty_voucher_json, loyalty_voucher_sweep; RPCs
-- redeem_reward, cancel_reward_voucher, my_reward_vouchers,
-- use_reward_voucher; cron tp_reward_voucher_sweep; error codes
-- VOUCHER_NOT_FOUND, VOUCHER_USED, VOUCHER_EXPIRED, VOUCHER_WRONG_BRANCH,
-- VOUCHER_LIMIT. reservation_loyalty_rewards.proof gains 'voucher'.
-- Re-issued (each change marked "-- 0415"): loyalty_history_guest (0308),
-- profile_merge_columns (0403: + loyalty_reward_vouchers.profile_id).
--
-- Lock order: use_reward_voucher takes day_sessions (an item reward) ->
-- tabs -> loyalty_attempts_advisory -> (orders, order_items, tickets,
-- stock_batches) -> court_advisory -> reservations ->
-- loyalty_reward_vouchers -> loyalty_accounts; redeem_reward and
-- cancel_reward_voucher take loyalty_reward_vouchers -> loyalty_accounts
-- (redeem_reward the account alone before its insert); the sweep takes its
-- vouchers FOR UPDATE SKIP LOCKED, then each account.
--
-- covered by packages/db/tests/loyalty.test.ts ("loyalty reward vouchers (0415)")
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 1. Schema
-- ===========================================================================

create table if not exists loyalty_reward_vouchers (
  id                    uuid primary key default gen_random_uuid(),
  profile_id            uuid not null references profiles(id),
  reward_id             uuid not null references loyalty_rewards(id),
  venue_id              uuid references venues(id),
  code                  text not null,
  points                int not null,
  status                text not null default 'active',
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  ended_at              timestamptz,
  used_by               uuid references staff(id),
  tab_id                uuid references tabs(id),
  tab_adjustment_id     uuid,
  reservation_reward_id uuid,
  constraint loyalty_reward_vouchers_code   unique (code),
  constraint loyalty_reward_vouchers_code_shape check (code ~ '^TPV-[0-9A-HJKMNP-TV-Z]{12}$'),
  constraint loyalty_reward_vouchers_points check (points > 0),
  constraint loyalty_reward_vouchers_status check (status in ('active', 'used', 'cancelled', 'expired')),
  constraint loyalty_reward_vouchers_ended  check ((status = 'active') = (ended_at is null)),
  constraint loyalty_reward_vouchers_used   check ((status = 'used') = (used_by is not null and tab_id is not null))
);

comment on table loyalty_reward_vouchers is
  '0415. A reward the guest redeemed in the app: the points it holds, its fixed single-use code (TPV-<12 Crockford base32>), the 15 minutes it lives, and what it became. status active (points held), used (at a till: the tab, used_by, and tab_adjustment_id or reservation_reward_id, ids only: an Undo deletes those rows), cancelled (by the guest) or expired (app.loyalty_voucher_sweep); the last two gave the points back. venue_id is the reward''s branch, null = every branch. Ledger rows (reward | redeem_void, reward_voucher, id). Written by app.redeem_reward, app.cancel_reward_voucher, app.use_reward_voucher and the sweep; read by app.my_reward_vouchers. No client grant.';

alter table loyalty_reward_vouchers enable row level security;
revoke all on loyalty_reward_vouchers from anon, authenticated;
grant all on loyalty_reward_vouchers to service_role;

drop trigger if exists zz_branch_guard on public.loyalty_reward_vouchers;
create trigger zz_branch_guard before insert or update or delete on public.loyalty_reward_vouchers
  for each row execute function app.trg_branch_guard('scoped', 'tabs', 'tab_id');

-- A free court hour taken with a voucher says so.
alter table reservation_loyalty_rewards drop constraint if exists reservation_loyalty_rewards_proof;
alter table reservation_loyalty_rewards add constraint reservation_loyalty_rewards_proof
  check (proof in ('qr', 'pin', 'voucher')) not valid;
alter table reservation_loyalty_rewards validate constraint reservation_loyalty_rewards_proof;

-- ===========================================================================
-- 2. Internals
-- ===========================================================================

-- A fresh voucher code: TPV- and twelve Crockford base32 characters from 60
-- random bits (the member code's alphabet, no I L O U).
create or replace function app.voucher_code_new() returns text
language plpgsql volatile security definer set search_path = public as $voucher_code_new_0415$
declare
  v_alpha constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea;
  v_code  text;
  i       int;
begin
  loop
    v_bytes := extensions.gen_random_bytes(12);
    v_code := 'TPV-';
    for i in 0..11 loop
      v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from loyalty_reward_vouchers v where v.code = v_code);
  end loop;
  return v_code;
end $voucher_code_new_0415$;

comment on function app.voucher_code_new() is
  '0415. Internal: a voucher code not yet used, TPV- + 12 characters of the Crockford base32 alphabet (each from one random byte mod 32: 60 bits).';

revoke all on function app.voucher_code_new() from public, anon, authenticated;

-- What the phone shows for one voucher.
create or replace function app.loyalty_voucher_json(p_voucher loyalty_reward_vouchers) returns jsonb
language sql stable security definer set search_path = public as $loyalty_voucher_json_0415$
  select jsonb_build_object(
    'id',         p_voucher.id,
    'code',       p_voucher.code,
    'reward_id',  p_voucher.reward_id,
    'name_en',    r.name_en,
    'name_ar',    r.name_ar,
    'kind',       r.kind,
    'points',     p_voucher.points,
    'status',     p_voucher.status,
    'created_at', p_voucher.created_at,
    'expires_at', p_voucher.expires_at,
    'ended_at',   p_voucher.ended_at)
    from loyalty_rewards r
   where r.id = p_voucher.reward_id
$loyalty_voucher_json_0415$;

comment on function app.loyalty_voucher_json(loyalty_reward_vouchers) is
  '0415. Internal: {id, code, reward_id, name_en, name_ar, kind, points, status, created_at, expires_at, ended_at} of one voucher.';

revoke all on function app.loyalty_voucher_json(loyalty_reward_vouchers) from public, anon, authenticated;

-- Ends an active voucher without use (cancelled | expired) and gives its
-- points back. The caller holds the voucher row; the account is locked here,
-- last. A voucher no longer active is left alone (false).
create or replace function app.loyalty_voucher_end(p_voucher_id uuid, p_status text) returns boolean
language plpgsql security definer set search_path = public as $loyalty_voucher_end_0415$
declare
  v loyalty_reward_vouchers%rowtype;
begin
  if p_status not in ('cancelled', 'expired') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_status';
  end if;
  select * into v from loyalty_reward_vouchers where id = p_voucher_id;
  if v.id is null or v.status <> 'active' then
    return false;
  end if;
  perform 1 from loyalty_accounts a where a.profile_id = v.profile_id for update;
  update loyalty_reward_vouchers set status = p_status, ended_at = now() where id = v.id;
  insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, actor_id)
  values (v.profile_id, v.venue_id, v.points, 'redeem_void', 'reward_voucher', v.id, auth.uid());
  return true;
end $loyalty_voucher_end_0415$;

comment on function app.loyalty_voucher_end(uuid, text) is
  '0415. Internal: an active voucher becomes cancelled or expired and its points come back as (redeem_void, reward_voucher, id). False (nothing written) for a voucher that is not active. The caller locks the voucher row first; this locks the account last.';

revoke all on function app.loyalty_voucher_end(uuid, text) from public, anon, authenticated;

-- Every minute: an active voucher past expires_at and the minute of grace
-- expires and its points come back.
create or replace function app.loyalty_voucher_sweep() returns int
language plpgsql security definer set search_path = public as $loyalty_voucher_sweep_0415$
declare
  v_id uuid;
  v_n  int := 0;
begin
  for v_id in
    select v.id from loyalty_reward_vouchers v
     where v.status = 'active' and v.expires_at + interval '1 minute' < now()
     order by v.id
     for update skip locked
  loop
    if app.loyalty_voucher_end(v_id, 'expired') then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $loyalty_voucher_sweep_0415$;

comment on function app.loyalty_voucher_sweep() is
  '0415. Cron tp_reward_voucher_sweep (every minute): every active voucher past expires_at + 1 minute (the grace a scan at zero gets) is expired, its points back (app.loyalty_voucher_end). Rows another call holds are skipped (SKIP LOCKED) and caught next minute. Returns how many expired.';

revoke all on function app.loyalty_voucher_sweep() from public, anon, authenticated;

-- ===========================================================================
-- 3. The guest
-- ===========================================================================

create or replace function app.redeem_reward(p_reward_id uuid, p_idempotency_key text default null) returns jsonb
language plpgsql security definer set search_path = public as $redeem_reward_0415$
declare
  v_me      uuid := app.loyalty_me();
  v_replay  jsonb;
  v_reward  loyalty_rewards%rowtype;
  v_balance bigint;
  v         loyalty_reward_vouchers%rowtype;
  v_result  jsonb;
begin
  if not coalesce((select s.enabled from loyalty_settings s where s.id), false) then
    raise exception 'LOYALTY_OFF' using errcode = 'P0001';
  end if;
  select * into v_reward from loyalty_rewards r where r.id = p_reward_id and r.active;
  if not found then
    raise exception 'REWARD_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_replay := app.claim_replay(p_idempotency_key, 'redeem_reward');
  if v_replay is not null then
    return v_replay;
  end if;

  -- The account first: two redeems at once wait here, so the balance and the
  -- count of active vouchers below hold.
  perform app.loyalty_card_ensure(v_me);
  select a.balance into v_balance from loyalty_accounts a where a.profile_id = v_me for update;
  v_balance := coalesce(v_balance, 0);

  if (select count(*) from loyalty_reward_vouchers x
       where x.profile_id = v_me and x.status = 'active') >= 5 then
    raise exception 'VOUCHER_LIMIT' using errcode = 'P0001', detail = '5';
  end if;
  if v_balance < v_reward.cost_points then
    raise exception 'POINTS_INSUFFICIENT' using errcode = 'P0001',
      detail = format('balance %s, cost %s', v_balance, v_reward.cost_points);
  end if;

  insert into loyalty_reward_vouchers (profile_id, reward_id, venue_id, code, points, expires_at)
  values (v_me, v_reward.id, v_reward.venue_id, app.voucher_code_new(), v_reward.cost_points,
          now() + interval '15 minutes')
  returning * into v;

  insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, actor_id, note)
  values (v_me, v_reward.venue_id, -v.points, 'reward', 'reward_voucher', v.id, v_me, left(v_reward.name_en, 200));

  perform app.write_audit('loyalty.voucher_redeem', 'loyalty_reward_vouchers', v.id::text, null,
                          to_jsonb(v) - 'code', null);

  v_result := app.loyalty_voucher_json(v) || jsonb_build_object(
    'balance', (select a.balance from loyalty_accounts a where a.profile_id = v_me),
    'now',     now());
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $redeem_reward_0415$;

comment on function app.redeem_reward(uuid, text) is
  '0415 (Majed 2026-11-13). The signed-in guest redeems an active reward (any branch: a reward with a branch is used there) in the app: its points leave the balance at once, held by a new voucher with a fixed single-use code that lives 15 minutes (app.use_reward_voucher spends it at a till; app.cancel_reward_voucher or the sweep gives the points back). LOYALTY_OFF, REWARD_NOT_FOUND, VOUCHER_LIMIT (detail 5: five active at once), POINTS_INSUFFICIENT; AUTH_REQUIRED, ACCOUNT_REQUIRED as app.my_loyalty. Idempotent on p_idempotency_key. Ledger (reward, reward_voucher, id), note the reward''s English name. Returns the voucher (app.loyalty_voucher_json) with balance and now. Audited loyalty.voucher_redeem (without the code).';

revoke all on function app.redeem_reward(uuid, text) from public, anon;
grant execute on function app.redeem_reward(uuid, text) to authenticated;

create or replace function app.cancel_reward_voucher(p_voucher_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $cancel_reward_voucher_0415$
declare
  v_me uuid := app.loyalty_me();
  v    loyalty_reward_vouchers%rowtype;
begin
  select * into v from loyalty_reward_vouchers x
   where x.id = p_voucher_id and x.profile_id = v_me
     for update;
  if not found then
    raise exception 'VOUCHER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.status <> 'active' then
    raise exception 'VOUCHER_USED' using errcode = 'P0001', detail = v.status;
  end if;
  perform app.loyalty_voucher_end(v.id, 'cancelled');
  perform app.write_audit('loyalty.voucher_cancel', 'loyalty_reward_vouchers', v.id::text,
                          to_jsonb(v) - 'code', null, null);
  return jsonb_build_object('balance',
    coalesce((select a.balance from loyalty_accounts a where a.profile_id = v_me), 0));
end $cancel_reward_voucher_0415$;

comment on function app.cancel_reward_voucher(uuid) is
  '0415. The signed-in guest cancels their own active voucher: it becomes cancelled and its points come back (redeem_void, reward_voucher, id). VOUCHER_NOT_FOUND (none of theirs), VOUCHER_USED (detail used | cancelled | expired); AUTH_REQUIRED, ACCOUNT_REQUIRED as app.my_loyalty. Returns {balance}. Audited loyalty.voucher_cancel.';

revoke all on function app.cancel_reward_voucher(uuid) from public, anon;
grant execute on function app.cancel_reward_voucher(uuid) to authenticated;

create or replace function app.my_reward_vouchers() returns jsonb
language plpgsql security definer set search_path = public as $my_reward_vouchers_0415$
declare
  v_me uuid := app.loyalty_me();
  v_id uuid;
begin
  -- The caller's own late vouchers end here, so this read never shows a
  -- held balance the sweep has not caught up with.
  for v_id in
    select x.id from loyalty_reward_vouchers x
     where x.profile_id = v_me and x.status = 'active' and x.expires_at + interval '1 minute' < now()
     order by x.id
     for update skip locked
  loop
    perform app.loyalty_voucher_end(v_id, 'expired');
  end loop;

  return jsonb_build_object(
    'now', now(),
    'vouchers', coalesce((
      select jsonb_agg(app.loyalty_voucher_json(x) order by x.created_at desc, x.id desc)
        from loyalty_reward_vouchers x
       where x.profile_id = v_me
         and (x.status = 'active' or x.ended_at > now() - interval '30 minutes')), '[]'::jsonb));
end $my_reward_vouchers_0415$;

comment on function app.my_reward_vouchers() is
  '0415. The signed-in guest''s vouchers: {now (the server clock, for the countdown), vouchers [app.loyalty_voucher_json]}: every active one and those that ended in the last 30 minutes (status used | cancelled | expired, so the phone shows "collected"), newest first. Expires the caller''s own vouchers past expires_at + 1 minute first (points back). AUTH_REQUIRED, ACCOUNT_REQUIRED as app.my_loyalty.';

revoke all on function app.my_reward_vouchers() from public, anon;
grant execute on function app.my_reward_vouchers() to authenticated;

-- ===========================================================================
-- 4. The till
-- ===========================================================================

create or replace function app.use_reward_voucher(
  p_tab_id          uuid,
  p_code            text,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $use_reward_voucher_0415$
declare
  v_venue     uuid;
  v_code      text;
  v_replay    jsonb;
  v_tab       tabs%rowtype;
  v           loyalty_reward_vouchers%rowtype;
  v_vid       uuid;
  v_reward    loyalty_rewards%rowtype;
  v_totals    record;
  v_room      bigint;
  v_amount    bigint;
  v_adj       tab_adjustments%rowtype;
  v_paid      bigint;
  v_new_total bigint;
  v_result    jsonb;
  v_day       uuid;
  v_line      order_items%rowtype;
  v_order     orders%rowtype;
  v_oi        record;
  v_added     boolean := false;
  v_court     boolean := false;
  v_res       reservations%rowtype;
  v_crw       reservation_loyalty_rewards%rowtype;
  v_owed      bigint;
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
  if not coalesce((select s.enabled from loyalty_settings s where s.id), false) then
    raise exception 'LOYALTY_OFF' using errcode = 'P0001';
  end if;
  -- The scanner or the cashier may send it in any case, with spaces or the
  -- display's dashes between groups.
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
  if v_code ~ '^TPV[0-9A-HJKMNP-TV-Z]{12}$' then
    v_code := 'TPV-' || substr(v_code, 4);
  else
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_code';
  end if;

  v_replay := app.claim_replay(p_idempotency_key, 'use_reward_voucher');
  if v_replay is not null then
    return v_replay;
  end if;

  -- An item reward may order its item onto the tab: the open day before the
  -- tab (lock order), as loyalty_redeem.                          -- as 0403
  select x.id, r.kind = 'item' into v_vid, v_added
    from loyalty_reward_vouchers x join loyalty_rewards r on r.id = x.reward_id
   where x.code = v_code;
  if v_added then
    v_day := app.current_open_day_locked();
  end if;
  v_added := false;

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

  -- Guessing is throttled like the member token (0308, c3): ten misses in
  -- ten minutes lock the caller. A miss is answered, not raised, so its
  -- attempt row commits; the idempotency claim goes with it.
  perform app.loyalty_throttle_check(auth.uid(), null, 10);   -- MEMBER_CODE_LOCKED
  if v_vid is null then
    perform app.loyalty_attempt_record(auth.uid(), null, false);
    delete from app.rpc_replays where idempotency_key = p_idempotency_key and fn = 'use_reward_voucher';
    return jsonb_build_object('error', 'VOUCHER_NOT_FOUND');
  end if;
  perform app.loyalty_attempt_record(auth.uid(), null, true);

  -- The voucher's state is read again under its lock, after the booking
  -- (below); here only what decides the path.
  select * into v from loyalty_reward_vouchers where id = v_vid;
  select * into v_reward from loyalty_rewards r where r.id = v.reward_id;
  if v.profile_id = auth.uid() then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'self_dealing';
  end if;
  if v.venue_id is not null and v.venue_id is distinct from v_tab.venue_id then
    raise exception 'VOUCHER_WRONG_BRANCH' using errcode = 'P0001';
  end if;
  if v.status <> 'active' then
    raise exception 'VOUCHER_USED' using errcode = 'P0001', detail = v.status;
  end if;
  if v.expires_at + interval '1 minute' < now() then
    raise exception 'VOUCHER_EXPIRED' using errcode = 'P0001';
  end if;

  if v_reward.kind = 'item' then                                       -- as 0403
    select oi.* into v_line
      from order_items oi
      join orders o on o.id = oi.order_id
     where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided
       and oi.variant_id = v_reward.menu_variant_id
       and (select count(*) from tab_adjustments x
             where x.order_item_id = oi.id and x.reason_code = 'loyalty_reward') < oi.qty
       and oi.line_total_iqd
           - coalesce((select sum(x.amount_iqd) from tab_adjustments x
                        where x.order_item_id = oi.id
                          and x.kind in ('discount_percent', 'discount_amount')), 0)
           >= oi.unit_price_iqd
     order by o.placed_at, oi.line_no
     limit 1;
    if not found then
      if not app.is_staff('cashier', 'manager', 'owner', 'shop_staff') then
        raise exception 'REWARD_ITEM_NOT_ON_TAB' using errcode = 'P0001';
      end if;
      if v_day is null then
        raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
      end if;
      if v_tab.day_session_id is distinct from v_day then
        raise exception 'DAY_CLOSED' using errcode = 'P0001',
          hint = 'this tab belongs to a day that is no longer open';
      end if;
      insert into orders (tab_id, source, placed_by_staff_id)
      values (v_tab.id, 'till', auth.uid())
      returning * into v_order;
      perform app.add_order_items(v_order.id,
        jsonb_build_array(jsonb_build_object('variant_id', v_reward.menu_variant_id, 'qty', 1)));
      if app.order_is_shop(v_order.id) then
        for v_oi in select id from order_items where order_id = v_order.id and not voided loop
          perform app.consume_for_order_item(v_oi.id, null);
        end loop;
        update orders set status = 'served' where id = v_order.id;
      else
        insert into tickets (order_id) values (v_order.id);
      end if;
      select * into v_line from order_items where order_id = v_order.id;
      v_added := true;
    end if;
  elsif v_reward.kind = 'court_hour' then                              -- as 0403
    v_court := true;
    if v_tab.reservation_id is null then
      raise exception 'REWARD_NEEDS_BOOKING' using errcode = 'P0001';
    end if;
    select * into v_res from reservations where id = v_tab.reservation_id;
    perform app.lock_court(v_res.court_id);
    select * into v_res from reservations where id = v_tab.reservation_id for update;
    if v_res.kind <> 'booking' or v_res.status not in ('confirmed', 'arrived', 'completed')
       or v_res.price_iqd is null then
      raise exception 'COURT_DISCOUNT_NOT_ALLOWED' using errcode = 'P0001', detail = 'not_a_live_booking';
    end if;
    if exists (select 1 from matches m where m.reservation_id = v_res.id) then
      raise exception 'COURT_DISCOUNT_NOT_ALLOWED' using errcode = 'P0001', detail = 'match';
    end if;
    if exists (select 1 from reservation_loyalty_rewards x where x.reservation_id = v_res.id) then
      raise exception 'REWARD_ALREADY_ON_BOOKING' using errcode = 'P0001';
    end if;
    if app.court_discount_closed(v_res.id) then
      raise exception 'COURT_BILL_CLOSED' using errcode = 'P0001';
    end if;
  end if;

  -- The voucher under its lock, then the member's account, last: a cancel or
  -- a second scan of the same code waits here and finds it used.
  select * into v from loyalty_reward_vouchers where id = v_vid for update;
  if v.status <> 'active' then
    raise exception 'VOUCHER_USED' using errcode = 'P0001', detail = v.status;
  end if;
  perform 1 from loyalty_accounts a where a.profile_id = v.profile_id for update;

  select * into v_totals from app.compute_tab_totals(p_tab_id);
  v_room := least(greatest(coalesce(v_totals.subtotal_iqd, 0) - coalesce(v_totals.discount_iqd, 0), 0),
                  greatest(coalesce(v_totals.total_iqd, 0) - app.tab_net_paid(p_tab_id), 0));

  if v_reward.kind = 'item' then                                       -- as 0403
    v_amount := v_line.unit_price_iqd::bigint;
  elsif v_court then
    v_amount := app.court_hour_value(v_res.id);
    v_owed := app.court_fee_remaining(v_res.id, null);
    if v_amount > v_owed then
      raise exception 'REWARD_EXCEEDS_BILL' using errcode = 'P0001',
        detail = format('reward %s, court fee left %s', v_amount, v_owed),
        hint = 'part of the court fee is already paid: refund it first, then use the free hour';
    end if;
  else
    v_amount := v_reward.iqd_off::bigint;
    if coalesce(v_amount, 0) > v_room then
      raise exception 'REWARD_EXCEEDS_BILL' using errcode = 'P0001',
        detail = format('reward %s, left %s', coalesce(v_amount, 0), v_room);
    end if;
  end if;
  if coalesce(v_amount, 0) < 1 then
    raise exception 'NOTHING_OWED' using errcode = 'P0001',
      hint = 'nothing on this bill is left to discount';
  end if;

  -- The held points pass from the voucher to the bill: one redeem_void for
  -- the voucher (its one and only), one reward row for what the bill got.
  insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, tab_id, actor_id)
  values (v.profile_id, v_tab.venue_id, v.points, 'redeem_void', 'reward_voucher', v.id, p_tab_id, auth.uid());

  if v_court then
    insert into reservation_loyalty_rewards (reservation_id, tab_id, profile_id, reward_id, points, amount_iqd,
                                             applied_by, authorized_by, proof)
    values (v_res.id, p_tab_id, v.profile_id, v_reward.id, v.points, v_amount, auth.uid(), auth.uid(), 'voucher')
    returning * into v_crw;

    insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, tab_id, actor_id, note)
    values (v.profile_id, v_tab.venue_id, -v.points, 'reward', 'reservation_reward', v_crw.id, p_tab_id, auth.uid(),
            left(v_reward.name_en, 200));
  else
    insert into tab_adjustments (tab_id, order_item_id, kind, value, amount_iqd,
                                 applied_by, authorized_by, reason_code)
    values (p_tab_id, v_line.id, 'discount_amount', v.points, v_amount, auth.uid(), auth.uid(), 'loyalty_reward')
    returning * into v_adj;

    insert into loyalty_ledger (profile_id, venue_id, delta, kind, source_kind, source_id, tab_id, actor_id, note)
    values (v.profile_id, v_tab.venue_id, -v.points, 'reward', 'tab_adjustment', v_adj.id, p_tab_id, auth.uid(),
            left(v_reward.name_en, 200));
  end if;

  update loyalty_reward_vouchers
     set status = 'used', ended_at = now(), used_by = auth.uid(), tab_id = p_tab_id,
         tab_adjustment_id = v_adj.id, reservation_reward_id = v_crw.id
   where id = v.id;

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

  perform app.write_audit('loyalty.voucher_use', 'loyalty_reward_vouchers', v.id::text, to_jsonb(v) - 'code',
                          jsonb_build_object('tab_id', p_tab_id, 'adjustment_id', v_adj.id,
                                             'court_reward_id', v_crw.id, 'amount_iqd', v_amount,
                                             'reward_id', v_reward.id, 'member_id', v.profile_id),
                          'loyalty_voucher', auth.uid());

  v_result := jsonb_build_object(
    'voucher_id',      v.id,
    'reward_id',       v_reward.id,
    'name_en',         v_reward.name_en,
    'name_ar',         v_reward.name_ar,
    'kind',            v_reward.kind,
    'points',          v.points,
    'amount_iqd',      v_amount,
    'adjustment_id',   v_adj.id,
    'order_item_id',   v_line.id,
    'item_added',      v_added,
    'court_reward_id', v_crw.id,
    'reservation_id',  v_res.id,
    'member_name',     (select nullif(btrim(concat_ws(' ', p.given_name, left(p.family_name, 1))), '')
                          from profiles p where p.id = v.profile_id));
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $use_reward_voucher_0415$;

comment on function app.use_reward_voucher(uuid, text, text) is
  '0415 (Majed 2026-11-13). The till scans a reward voucher (TPV-…, any case, spaces and dashes ignored; INVALID_ARGUMENT otherwise) onto an open tab and the reward is given: cashier, shop_staff, court_desk, manager, owner at the tab''s branch, the tab''s kind for the role, as app.loyalty_redeem. The code is the proof (no member token, no PIN, no customer on the tab needed). LOYALTY_OFF; then claim_replay; TAB_NOT_FOUND, TAB_MERGED, TAB_NOT_OPEN; a code that names no voucher is answered {error: VOUCHER_NOT_FOUND}, counted in loyalty_token_attempts with the claim released, MEMBER_CODE_LOCKED after ten misses by the caller in ten minutes; FORBIDDEN self_dealing (the caller''s own voucher), VOUCHER_WRONG_BRANCH, VOUCHER_USED (detail used | cancelled | expired), VOUCHER_EXPIRED (past expires_at + 1 minute). The reward as loyalty_redeem gives it (0350 item: frees one unit of its exact variant or orders it free onto the tab, REWARD_ITEM_NOT_ON_TAB for the court desk, NO_OPEN_DAY, DAY_CLOSED; 0403 court_hour: REWARD_NEEDS_BOOKING, COURT_DISCOUNT_NOT_ALLOWED, REWARD_ALREADY_ON_BOOKING, COURT_BILL_CLOSED, REWARD_EXCEEDS_BILL; iqd_off: REWARD_EXCEEDS_BILL; NOTHING_OWED; DISCOUNT_REQUIRES_REFUND), honoured even if the reward was switched off since. Ledger: (redeem_void, reward_voucher, voucher id, +points) and (reward, tab_adjustment | reservation_reward, id, -points) for the voucher''s member, so loyalty_unredeem and the settle and cancel rules give the points back as for any reward. The voucher becomes used. Returns {voucher_id, reward_id, name_en, name_ar, kind, points, amount_iqd, adjustment_id, order_item_id, item_added, court_reward_id, reservation_id, member_name}. Audited loyalty.voucher_use.';

revoke all on function app.use_reward_voucher(uuid, text, text) from public, anon;
grant execute on function app.use_reward_voucher(uuid, text, text) to authenticated;

-- ===========================================================================
-- 5. The guest's history: one used voucher reads as one row
-- ===========================================================================

-- loyalty_history_guest: re-issued from 20261006000308_loyalty_earn_redeem.sql:838.
create or replace function app.loyalty_history_guest(p_profile uuid, p_limit int) returns jsonb
language sql stable security definer set search_path = public as $loyalty_history_guest_0415$
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'kind', h.kind, 'delta', h.delta,
                                               'venue_id', h.venue_id, 'created_at', h.created_at,
                                               'note', case when h.kind in ('reward', 'expire') then h.note end)
                            order by h.created_at desc, h.id desc), '[]'::jsonb)
    from (select l.* from loyalty_ledger l
           where l.profile_id = p_profile
             -- 0415: a used voucher's hand-over to the bill (its redeem_void,
             -- and the bill's reward row) is not shown: the redeem row is.
             and not (l.kind = 'redeem_void' and l.source_kind = 'reward_voucher'
                      and exists (select 1 from loyalty_reward_vouchers v
                                   where v.id = l.source_id and v.status = 'used'))
             and not (l.kind = 'reward' and l.source_kind in ('tab_adjustment', 'reservation_reward')
                      and exists (select 1 from loyalty_reward_vouchers v
                                   where v.tab_adjustment_id = l.source_id
                                      or v.reservation_reward_id = l.source_id))
           order by l.created_at desc, l.id desc
           limit p_limit) h
$loyalty_history_guest_0415$;

revoke all on function app.loyalty_history_guest(uuid, int) from public, anon, authenticated;

comment on function app.loyalty_history_guest(uuid, int) is
  '0308, 0415. Internal: the p_limit newest ledger rows of a guest as {id, kind, delta, venue_id, created_at, note (reward and expire rows only)}. 0415: a used voucher''s hand-over pair (redeem_void reward_voucher, and the bill''s reward row the voucher became) is left out, so the redeem row stands for it; an Undo at the till still shows as its redeem_void.';

-- ===========================================================================
-- 6. Account merge: the voucher follows its member
-- ===========================================================================

-- profile_merge_columns: re-issued from 20261105000403_loyalty_rewards_only.sql:1364.
create or replace function app.profile_merge_columns()
returns table (ord int, sch text, tbl text, col text, how text)
language sql immutable set search_path = public as $profile_merge_columns_0415$
  select * from (values
    ( 10, 'public', 'tabs',                  'customer_id',           'repoint'),
    ( 20, 'public', 'reservations',          'guest_id',              'repoint'),
    ( 30, 'public', 'reservation_series',    'guest_id',              'repoint'),
    ( 40, 'public', 'guest_sessions',        'linked_profile_id',     'repoint'),
    ( 50, 'public', 'customer_notes',        'customer_id',           'repoint'),
    ( 60, 'public', 'promotion_redemptions', 'customer_id',           'repoint'),
    ( 70, 'public', 'matches',               'organiser_id',          'repoint'),
    ( 80, 'public', 'match_events',          'actor_guest_id',        'repoint'),
    ( 90, 'public', 'coaches',               'profile_id',            'repoint'),
    (100, 'public', 'courses',               'created_by_profile_id', 'repoint'),
    (110, 'public', 'lessons',               'created_by_profile_id', 'repoint'),
    (130, 'public', 'lesson_attendance',     'marked_by_profile_id',  'repoint'),
    (140, 'public', 'lesson_strikes',        'guest_id',              'repoint'),
    (150, 'public', 'lesson_events',         'actor_profile_id',      'repoint'),
    (160, 'public', 'loyalty_ledger',        'profile_id',            'repoint'),
    (170, 'public', 'match_ticket_events',   'guest_id',              'repoint'),
    (180, 'public', 'match_tickets',         'guest_id',              'repoint'),
    (190, 'public', 'notification_outbox',   'profile_id',            'repoint'),
    (200, 'public', 'reservation_court_discounts', 'customer_id',     'repoint'),
    (210, 'public', 'game_results',          'a1',                    'repoint'),
    (211, 'public', 'game_results',          'a2',                    'repoint'),
    (212, 'public', 'game_results',          'b1',                    'repoint'),
    (213, 'public', 'game_results',          'b2',                    'repoint'),
    (220, 'public', 'ranks_ledger',          'profile_id',            'repoint'),
    (230, 'public', 'profiles',              'level_confirmed_by',    'repoint'),
    (240, 'public', 'reservation_loyalty_rewards', 'profile_id',      'repoint'),   -- 0403
    (250, 'public', 'loyalty_reward_vouchers', 'profile_id',          'repoint'),   -- 0415
    (300, 'public', 'customer_flags',        'customer_id',           'rule'),
    (310, 'public', 'booking_payments',      'guest_id',              'rule'),
    (320, 'public', 'hold_standing',         'guest_id',              'rule'),
    (330, 'public', 'match_requests',        'guest_id',              'rule'),
    (340, 'public', 'match_seats',           'guest_id',              'rule'),
    (350, 'public', 'match_exclusions',      'guest_id',              'rule'),
    (360, 'public', 'match_blocks',          'blocker_id',            'rule'),
    (361, 'public', 'match_blocks',          'blocked_id',            'rule'),
    (370, 'public', 'match_reports',         'reporter_id',           'rule'),
    (371, 'public', 'match_reports',         'reported_id',           'rule'),
    (380, 'public', 'lesson_enrolments',     'guest_id',              'rule'),
    (381, 'public', 'lesson_enrolments',     'booked_by_profile_id',  'rule'),
    (390, 'public', 'tournament_entries',    'guest_id',              'rule'),
    (400, 'public', 'loyalty_cards',         'profile_id',            'rule'),
    (410, 'public', 'loyalty_accounts',      'profile_id',            'rule'),
    (420, 'public', 'username_holds',        'profile_id',            'drop_only'),
    (430, 'public', 'frame_grants',          'profile_id',            'rule'),
    (440, 'public', 'customer_discounts',    'customer_id',           'rule'),
    (500, 'auth',   'identities',            'user_id',               'auth'),
    (510, 'auth',   'sessions',              'user_id',               'signout'),
    (520, 'auth',   'one_time_tokens',       'user_id',               'signout'),
    (530, 'auth',   'mfa_factors',           'user_id',               'drop_only'),
    (540, 'auth',   'oauth_authorizations',  'user_id',               'drop_only'),
    (550, 'auth',   'oauth_consents',        'user_id',               'drop_only'),
    (560, 'auth',   'webauthn_credentials',  'user_id',               'drop_only'),
    (570, 'auth',   'webauthn_challenges',   'user_id',               'drop_only'),
    (600, 'public', 'staff',                 'id',                    'refuse'),
    (700, 'app',    'profile_merges',        'keep_id',               'record')
  ) as t (ord, sch, tbl, col, how)
  order by 1;
$profile_merge_columns_0415$;

comment on function app.profile_merge_columns() is
  '0303, 0307, username_holds since 0314, frame_grants since 0320, customer_discounts and reservation_court_discounts since 0347, game_results and ranks_ledger since 0364, profiles.level_confirmed_by since 0368, reservation_loyalty_rewards.profile_id since 0403, loyalty_reward_vouchers.profile_id since 0415. Every column referencing profiles(id) or auth.users(id) and what app.merge_profiles_internal does with it (repoint | rule | auth | signout | drop_only | refuse | record). The repoint rows ARE the merge''s generic loop; account-merge.test.ts holds the list to pg_constraint.';

revoke all on function app.profile_merge_columns() from public, anon, authenticated;

-- ===========================================================================
-- 7. tp_reward_voucher_sweep: every minute. Guarded like 0090.
-- ===========================================================================
do $reward_voucher_cron_0415$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_reward_voucher_sweep not scheduled';
    return;
  end if;
  perform cron.schedule('tp_reward_voucher_sweep', '* * * * *', 'select app.loyalty_voucher_sweep();');
end $reward_voucher_cron_0415$;
