-- 0332 staff_rewards — the owner sets a bonus or a prize for a number of
-- orders a person places in a business month; each person sees their own
-- progress on the staff phone.
--
-- Feature: staff rewards (2026-10-10). The staff phone's "My rewards" card
-- reads app.my_rewards; the owner's board reads app.staff_rewards_board and
-- writes through app.set_staff_reward and app.end_staff_reward.
-- Depends on: floor_orders (0251: orders.placed_by_staff_id on phone orders),
-- cafe_settings_readers_per_venue (0211: app.venue_business_date),
-- branch_write_guard (0230: zz_branch_guard).
-- Re-runnable: create … if not exists, create or replace, drop … if exists.
--
-- A STANDING RULE, COUNTED FRESH EVERY MONTH. A reward is "reach <target>
-- orders this business month and earn <reward_iqd> and/or <prize>". It stays
-- until the owner ends it; nothing is stored per month. The count is the
-- person's orders at the branch that were not voided (orders.status <>
-- 'voided'), by orders.placed_by_staff_id, placed inside the branch's
-- business month: from the month's first business day's start hour
-- (analytics_business_day_start_hour, in the branch's time zone) to the next
-- month's, the same day app.venue_business_date names. Last month's reached
-- rewards are those active at any moment of last month whose target is at
-- most last month's count. A RECORD, NOT PAYROLL: the owner pays it outside
-- the system (as 0197).
--
-- WHO. Waiters, cashiers and managers active at the branch earn rewards
-- (they place orders); never an owner. Up to 5 active rewards per person and
-- one per target. The owner sets, ends and reads every person's; each staff
-- member reads only their own (app.my_rewards), never anyone else's count. No
-- ranking: the board is ordered by name, never by count.
--
-- THE LLM WALL (as 0197, 0270). Money about a named person: never readable by
-- the owner assistant or any LLM. Coverage excluded, no
-- assistant_readable_columns row, no assistant tool; audit rows carry
-- {status} only. No push.
--
-- covered by packages/db/tests/staff-rewards.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. staff_rewards — the owner's standing rules, per branch and person.
-- ---------------------------------------------------------------------------
create table if not exists staff_rewards (
  id         uuid primary key default gen_random_uuid(),
  venue_id   uuid not null references venues(id),
  staff_id   uuid not null references staff(id),
  metric     text not null default 'orders_placed',
  target     int not null,
  reward_iqd iqd not null default 0,
  prize      text,
  set_by     uuid not null references staff(id),
  set_at     timestamptz not null default now(),
  ended_by   uuid references staff(id),
  ended_at   timestamptz,
  constraint staff_rewards_metric_chk check (metric = 'orders_placed'),
  constraint staff_rewards_target_chk check (target between 1 and 100000),
  constraint staff_rewards_reward_chk check (reward_iqd <= 10000000),
  constraint staff_rewards_prize_chk
    check (prize is null or (prize = btrim(prize) and length(prize) between 1 and 80)),
  constraint staff_rewards_something_chk check (reward_iqd > 0 or prize is not null),
  constraint staff_rewards_ended_chk check ((ended_by is null) = (ended_at is null)),
  -- One active reward per person, metric and target: a partial unique key,
  -- declared with the table (btree exclusion on equality) so no separate
  -- CREATE INDEX runs; app.set_staff_reward answers REWARD_TARGET_TAKEN first.
  constraint staff_rewards_active_target_key
    exclude using btree (venue_id with =, staff_id with =, metric with =, target with =)
    where (ended_at is null)
);

comment on table staff_rewards is
  'staff_rewards (0332): the owner''s standing reward for a person at one branch: reach target orders placed (not voided) in a business month and earn reward_iqd and/or prize. Counted fresh every business month; one active row per person and target, at most 5 active per person. Written by the owner through app.set_staff_reward and app.end_staff_reward; read by the owner only (each person reads their own through app.my_rewards). Never readable by the owner assistant or any LLM.';
comment on column staff_rewards.id is 'Row id.';
comment on column staff_rewards.venue_id is 'The branch whose orders count.';
comment on column staff_rewards.staff_id is 'The person (a waiter, cashier or manager at the branch).';
comment on column staff_rewards.metric is 'What is counted: orders_placed (the only one).';
comment on column staff_rewards.target is 'The number of orders in a business month, 1 to 100,000.';
comment on column staff_rewards.reward_iqd is 'The bonus, 0 to 10,000,000 IQD; 0 when there is only a prize.';
comment on column staff_rewards.prize is 'An optional prize in the owner''s words (1 to 80 characters).';
comment on column staff_rewards.set_by is 'The owner who set it.';
comment on column staff_rewards.set_at is 'When it was set.';
comment on column staff_rewards.ended_by is 'The owner who ended it.';
comment on column staff_rewards.ended_at is 'When it was ended; NULL while active.';

alter table staff_rewards enable row level security;

drop policy if exists staff_rewards_owner_read on staff_rewards;
create policy staff_rewards_owner_read on staff_rewards
  for select to authenticated
  using ((select app.is_staff('owner'))
         and venue_id = any((select app.visible_venue_ids())::uuid[]));

grant select on staff_rewards to authenticated;
grant all on staff_rewards to service_role;

drop trigger if exists zz_branch_guard on public.staff_rewards;
create trigger zz_branch_guard before insert or update or delete on public.staff_rewards
  for each row execute function app.trg_branch_guard('scoped');

-- ---------------------------------------------------------------------------
-- 2. app.my_rewards — any staff member: their own count and rewards.
-- ---------------------------------------------------------------------------
create or replace function app.my_rewards(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $my_rewards_0332$
declare
  v_role      staff_role := app.staff_role();
  v_me        uuid := auth.uid();
  v_venue     uuid;
  v_tz        text;
  v_hour      int;
  v_today     date;
  v_month     date;
  v_last      date;
  v_next      date;
  v_ts_last   timestamptz;
  v_ts_from   timestamptz;
  v_ts_to     timestamptz;
  v_count     bigint;
  v_last_n    bigint;
  v_rewards   jsonb;
  v_reached   jsonb;
begin
  if v_role is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if v_venue is null
     or not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, v_role)) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- The branch's business month, as app.venue_business_date counts days.
  v_tz      := coalesce((select v.timezone from venues v where v.id = v_venue), 'Asia/Baghdad');
  v_hour    := coalesce(app.cafe_setting_int('analytics_business_day_start_hour', v_venue), 4);
  v_today   := app.venue_business_date(v_venue);
  v_month   := date_trunc('month', v_today)::date;
  v_last    := (v_month - interval '1 month')::date;
  v_next    := (v_month + interval '1 month')::date;
  v_ts_last := (v_last::timestamp  + make_interval(hours => v_hour)) at time zone v_tz;
  v_ts_from := (v_month::timestamp + make_interval(hours => v_hour)) at time zone v_tz;
  v_ts_to   := (v_next::timestamp  + make_interval(hours => v_hour)) at time zone v_tz;

  -- Only the caller's own orders, never anyone else's.
  select count(*) filter (where o.placed_at >= v_ts_from),
         count(*) filter (where o.placed_at <  v_ts_from)
    into v_count, v_last_n
    from orders o
   where o.venue_id = v_venue
     and o.placed_by_staff_id = v_me
     and o.status <> 'voided'
     and o.placed_at >= v_ts_last
     and o.placed_at <  v_ts_to;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',         r.id,
           'target',     r.target,
           'reward_iqd', r.reward_iqd,
           'prize',      r.prize)
           order by r.target, r.id), '[]'::jsonb)
    into v_rewards
    from staff_rewards r
   where r.venue_id = v_venue and r.staff_id = v_me and r.ended_at is null;

  -- Active at any moment of last month, and reached by last month's count.
  select coalesce(jsonb_agg(jsonb_build_object(
           'target',     r.target,
           'reward_iqd', r.reward_iqd,
           'prize',      r.prize)
           order by r.target, r.id), '[]'::jsonb)
    into v_reached
    from staff_rewards r
   where r.venue_id = v_venue and r.staff_id = v_me
     and r.set_at < v_ts_from
     and (r.ended_at is null or r.ended_at >= v_ts_last)
     and r.target <= v_last_n;

  return jsonb_build_object(
    'month',      v_month,
    'month_end',  (v_next - 1),
    'days_left',  (v_next - v_today),
    'count',      v_count,
    'rewards',    v_rewards,
    'last_month', jsonb_build_object(
                    'month',   v_last,
                    'count',   v_last_n,
                    'reached', v_reached));
end $my_rewards_0332$;

comment on function app.my_rewards(uuid) is
  'staff rewards (0332). Any active staff member at the branch, about themselves only: {month, month_end, days_left (today included), count (their orders placed at the branch this business month, voided ones excluded), rewards: [{id, target, reward_iqd, prize}] (active, by target), last_month: {month, count, reached: [{target, reward_iqd, prize}]} (rewards active at any moment of last month whose target is at most last month''s count, by target)}. Never another person''s data. FORBIDDEN for anyone else.';

revoke all on function app.my_rewards(uuid) from public, anon;
grant execute on function app.my_rewards(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.staff_rewards_board — the owner: everyone who can earn one.
-- ---------------------------------------------------------------------------
create or replace function app.staff_rewards_board(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $staff_rewards_board_0332$
declare
  v_venue   uuid;
  v_tz      text;
  v_hour    int;
  v_today   date;
  v_month   date;
  v_last    date;
  v_next    date;
  v_ts_last timestamptz;
  v_ts_from timestamptz;
  v_ts_to   timestamptz;
  v_people  jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if v_venue is null
     or not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_tz      := coalesce((select v.timezone from venues v where v.id = v_venue), 'Asia/Baghdad');
  v_hour    := coalesce(app.cafe_setting_int('analytics_business_day_start_hour', v_venue), 4);
  v_today   := app.venue_business_date(v_venue);
  v_month   := date_trunc('month', v_today)::date;
  v_last    := (v_month - interval '1 month')::date;
  v_next    := (v_month + interval '1 month')::date;
  v_ts_last := (v_last::timestamp  + make_interval(hours => v_hour)) at time zone v_tz;
  v_ts_from := (v_month::timestamp + make_interval(hours => v_hour)) at time zone v_tz;
  v_ts_to   := (v_next::timestamp  + make_interval(hours => v_hour)) at time zone v_tz;

  -- Waiters, cashiers and managers active at the branch, by name: no ranking.
  with people as (
    select s.id, s.display_name, s.role
      from staff s
     where s.is_active
       and s.role in ('waiter', 'cashier', 'manager')
       and exists (select 1 from staff_venues sv where sv.staff_id = s.id and sv.venue_id = v_venue)
  ), counts as (
    select o.placed_by_staff_id as staff_id,
           count(*) filter (where o.placed_at >= v_ts_from) as n,
           count(*) filter (where o.placed_at <  v_ts_from) as last_n
      from orders o
     where o.venue_id = v_venue
       and o.placed_by_staff_id in (select p.id from people p)
       and o.status <> 'voided'
       and o.placed_at >= v_ts_last
       and o.placed_at <  v_ts_to
     group by o.placed_by_staff_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'staff_id',         p.id,
           'name',             p.display_name,
           'role',             p.role,
           'count',            coalesce(c.n, 0),
           'last_month_count', coalesce(c.last_n, 0),
           'rewards',          (select coalesce(jsonb_agg(jsonb_build_object(
                                         'id',         r.id,
                                         'target',     r.target,
                                         'reward_iqd', r.reward_iqd,
                                         'prize',      r.prize,
                                         'set_at',     r.set_at)
                                       order by r.target, r.id), '[]'::jsonb)
                                  from staff_rewards r
                                 where r.venue_id = v_venue and r.staff_id = p.id
                                   and r.ended_at is null))
           order by p.display_name, p.id), '[]'::jsonb)
    into v_people
    from people p
    left join counts c on c.staff_id = p.id;

  return jsonb_build_object(
    'month',     v_month,
    'month_end', (v_next - 1),
    'days_left', (v_next - v_today),
    'people',    v_people);
end $staff_rewards_board_0332$;

comment on function app.staff_rewards_board(uuid) is
  'staff rewards (0332). The owner at the branch: {month, month_end, days_left (today included), people: [{staff_id, name, role, count, last_month_count, rewards: [{id, target, reward_iqd, prize, set_at}]}]}: every active waiter, cashier and manager at the branch, by name (never ranked by count), with their orders placed this and last business month (voided ones excluded) and their active rewards by target. FORBIDDEN for anyone else.';

revoke all on function app.staff_rewards_board(uuid) from public, anon;
grant execute on function app.staff_rewards_board(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.set_staff_reward — the owner sets a reward for a person.
-- ---------------------------------------------------------------------------
create or replace function app.set_staff_reward(
  p_venue_id   uuid,
  p_staff_id   uuid,
  p_target     int,
  p_reward_iqd bigint,
  p_prize      text default null
) returns uuid
language plpgsql security definer set search_path = public as $set_staff_reward_0332$
declare
  v_venue  uuid;
  v_reward bigint := coalesce(p_reward_iqd, 0);
  v_prize  text := nullif(btrim(coalesce(p_prize, '')), '');
  v_active int;
  v_id     uuid;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if v_venue is null
     or not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  -- A waiter, cashier or manager active at the branch; never an owner.
  if p_staff_id is null
     or not exists (select 1 from staff s
                     where s.id = p_staff_id and s.is_active
                       and s.role in ('waiter', 'cashier', 'manager')
                       and exists (select 1 from staff_venues sv
                                    where sv.staff_id = s.id and sv.venue_id = v_venue)) then
    raise exception 'REWARD_STAFF_INVALID' using errcode = 'P0001';
  end if;
  if p_target is null or p_target < 1 or p_target > 100000 then
    raise exception 'REWARD_INVALID' using errcode = 'P0001', hint = 'target';
  end if;
  if v_reward < 0 or v_reward > 10000000 then
    raise exception 'REWARD_INVALID' using errcode = 'P0001', hint = 'reward_iqd';
  end if;
  if v_prize is not null and length(v_prize) > 80 then
    raise exception 'REWARD_INVALID' using errcode = 'P0001', hint = 'prize';
  end if;
  if v_reward = 0 and v_prize is null then
    raise exception 'REWARD_INVALID' using errcode = 'P0001', hint = 'empty';
  end if;

  -- One writer per person and branch, so the limit and the target hold.
  perform pg_advisory_xact_lock(hashtextextended('app.staff_rewards:' || v_venue::text || ':' || p_staff_id::text, 0));

  if exists (select 1 from staff_rewards r
              where r.venue_id = v_venue and r.staff_id = p_staff_id
                and r.metric = 'orders_placed' and r.target = p_target
                and r.ended_at is null) then
    raise exception 'REWARD_TARGET_TAKEN' using errcode = 'P0001';
  end if;
  select count(*) into v_active
    from staff_rewards r
   where r.venue_id = v_venue and r.staff_id = p_staff_id and r.ended_at is null;
  if v_active >= 5 then
    raise exception 'REWARD_LIMIT' using errcode = 'P0001';
  end if;

  insert into staff_rewards (venue_id, staff_id, metric, target, reward_iqd, prize, set_by)
  values (v_venue, p_staff_id, 'orders_placed', p_target, v_reward, v_prize, auth.uid())
  returning id into v_id;

  perform app.write_audit('staff.reward.set', 'staff_reward', v_id::text, null,
                          jsonb_build_object('status', 'active'));
  return v_id;
end $set_staff_reward_0332$;

comment on function app.set_staff_reward(uuid, uuid, int, bigint, text) is
  'staff rewards (0332). The owner at the branch: a standing reward for a waiter, cashier or manager active there: reach p_target orders (1 to 100,000) in a business month and earn p_reward_iqd (0 to 10,000,000 IQD) and/or p_prize (trimmed, at most 80 characters); one of the two is required. At most 5 active per person, one per target. Returns the new id. FORBIDDEN, REWARD_STAFF_INVALID, REWARD_INVALID (hint target, reward_iqd, prize, empty), REWARD_TARGET_TAKEN, REWARD_LIMIT. Audit staff.reward.set {status}. No push.';

revoke all on function app.set_staff_reward(uuid, uuid, int, bigint, text) from public, anon;
grant execute on function app.set_staff_reward(uuid, uuid, int, bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.end_staff_reward — the owner ends a reward.
-- ---------------------------------------------------------------------------
create or replace function app.end_staff_reward(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $end_staff_reward_0332$
declare
  v_venue uuid;
  v_staff uuid;
  v_ended timestamptz;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select r.venue_id, r.staff_id into v_venue, v_staff from staff_rewards r where r.id = p_id;
  if not found or not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff_at(v_venue, 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  perform pg_advisory_xact_lock(hashtextextended('app.staff_rewards:' || v_venue::text || ':' || v_staff::text, 0));
  select r.ended_at into v_ended from staff_rewards r where r.id = p_id for update;
  if v_ended is not null then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;

  update staff_rewards
     set ended_by = auth.uid(), ended_at = now()
   where id = p_id;

  perform app.write_audit('staff.reward.end', 'staff_reward', p_id::text,
                          jsonb_build_object('status', 'active'),
                          jsonb_build_object('status', 'ended'));
end $end_staff_reward_0332$;

comment on function app.end_staff_reward(uuid) is
  'staff rewards (0332). The owner at the branch ends an active reward: it stops counting from now; last month''s reached list still shows it for the month it was active in. REF_NOT_FOUND (hint id: missing, another branch, or already ended), FORBIDDEN. Audit staff.reward.end {status}.';

revoke all on function app.end_staff_reward(uuid) from public, anon;
grant execute on function app.end_staff_reward(uuid) to authenticated;
