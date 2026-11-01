set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0394 — cron sweeps that catch their errors report them (Majed, 2026-11-01,
-- launch findings F-15/F-26; DECISIONS.md "Monitoring contract": "where pg_cron
-- jobs catch errors, call app.monitor").
--
-- 0393's tp_monitor_cron sees every pg_cron run that FAILED. A sweep that
-- catches a branch's error in its own exception block and carries on with
-- the next branch never fails, so until now that error lived only in a
-- `raise warning` nobody reads. These three sweeps now also store it on the
-- Monitoring page (kind cron_failed, source cron) through app.monitor, which
-- never raises, so the sweep goes on exactly as before.
--
--   app.protocol_remind_sweep  0363's body verbatim (0394 holds it now)
--   app.reward_sweep           0333's body verbatim (0394 holds it now)
--   app.shop_reward_sweep      0355's body verbatim (0394 holds it now)
--
-- Each body is its latest, copied verbatim; the only change is one
-- `perform app.monitor(...)` after the `raise warning` of its per-branch
-- handler, and the dollar tag. Signatures are unchanged; the revoke/grant pair
-- is re-issued. The other sweeps that catch errors (match_sweep, lesson_sweep,
-- tournament_sweep, checklist_sweep, loyalty_nightly_one, price_promo_apply_due)
-- are left to their own lanes' next re-issue: their failures that escape still
-- reach the page through tp_monitor_cron.
--
-- covered by packages/db/tests/monitoring.test.ts
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- app.protocol_remind_sweep — 0363's body verbatim plus app.monitor in the branch handler.
-- ---------------------------------------------------------------------------
create or replace function app.protocol_remind_sweep()
returns int
language plpgsql security definer set search_path = public as $protocol_remind_sweep_0394$
declare
  c_first  constant interval := interval '3 hours';
  c_repeat constant interval := interval '24 hours';
  v_venue  record;
  v_sub    record;
  v_to     uuid[];
  v_n      int := 0;
begin
  for v_venue in
    select v.id, coalesce(v.timezone, 'Asia/Baghdad') as tz
      from venues v
     where v.status <> 'closed'
     order by v.id
  loop
    -- Not at night: a reminder due then waits for the morning.
    continue when extract(hour from now() at time zone v_venue.tz) not between 9 and 22;
    begin
      perform set_config('app.venue_id', v_venue.id::text, true);
      for v_sub in
        select x.id, x.submitted_by, x.reminded_at, s.id as step_id, s.needs_owner_ok, r.id as run_id
          from protocol_submissions x
          join protocol_run_steps s on s.id = x.run_step_id
          join protocol_runs r on r.id = x.run_id
         where r.venue_id = v_venue.id
           and r.status = 'active'
           and s.status = 'submitted'
           and x.round = s.round
           and x.decision is null
           and x.withdrawn_at is null
           and x.superseded_at is null
           and ((x.reminded_at is null and now() >= x.submitted_at + c_first)
                or now() >= x.reminded_at + c_repeat)
         order by x.submitted_at, x.id
      loop
        update protocol_submissions
           set reminded_at = now()
         where id = v_sub.id
           and reminded_at is not distinct from v_sub.reminded_at;
        -- Another sweep stamped it first.
        continue when not found;

        select coalesce(array_agg(d.id), '{}'::uuid[]) into v_to
          from unnest(app.protocol_engine_decider_ids(v_venue.id, v_sub.needs_owner_ok)) d(id)
         where d.id <> v_sub.submitted_by;
        v_n := v_n + app.protocol_engine_notify(
          v_to, 'staff_decide', 'decision_waiting', 'staff-step', v_sub.step_id, v_sub.run_id, v_sub.step_id);
      end loop;
    exception when others then
      raise warning 'protocol_remind_sweep venue %: % (%)', v_venue.id, sqlerrm, sqlstate;
      perform app.monitor('cron', 'error', 'cron_failed',
        format('protocol_remind_sweep venue %s: %s (%s)', v_venue.id, sqlerrm, sqlstate),
        jsonb_build_object('job', 'protocol_remind_sweep', 'sqlstate', sqlstate));
    end;
  end loop;
  return v_n;
end $protocol_remind_sweep_0394$;

revoke all on function app.protocol_remind_sweep() from public, anon, authenticated;
grant execute on function app.protocol_remind_sweep() to service_role;

-- ---------------------------------------------------------------------------
-- app.reward_sweep — 0333's body verbatim plus app.monitor in the branch handler.
-- ---------------------------------------------------------------------------
create or replace function app.reward_sweep()
returns jsonb
language plpgsql security definer set search_path = public as $reward_sweep_0394$
declare
  v_venue    uuid;
  v_open     boolean;
  v_tz       text;
  v_hour     int;
  v_today    date;
  v_month    date;
  v_last     date;
  v_next     date;
  v_ts_from  timestamptz;
  v_ts_to    timestamptz;
  v_from     date;
  v_upto     date;
  v_m        date;
  v_ts_a     timestamptz;
  v_ts_b     timestamptz;
  v_row      record;
  v_pushes   int := 0;
  v_unlocks  int := 0;
  v_earnings int := 0;
  v_n        int;
begin
  for v_venue, v_open in
    select v.id, v.status <> 'closed'
      from venues v
     where exists (select 1 from staff_rewards r where r.venue_id = v.id)
     order by v.id
  loop
    begin
      perform set_config('app.venue_id', v_venue::text, true);

      -- The branch's business month, as 0332 names months.
      v_tz      := coalesce((select v.timezone from venues v where v.id = v_venue), 'Asia/Baghdad');
      v_hour    := coalesce(app.cafe_setting_int('analytics_business_day_start_hour', v_venue), 4);
      v_today   := app.venue_business_date(v_venue);
      v_month   := date_trunc('month', v_today)::date;
      v_last    := (v_month - interval '1 month')::date;
      v_next    := (v_month + interval '1 month')::date;
      v_ts_from := (v_month::timestamp + make_interval(hours => v_hour)) at time zone v_tz;
      v_ts_to   := (v_next::timestamp  + make_interval(hours => v_hour)) at time zone v_tz;

      -- (1) Unlocks, at a branch that is not closed: an active reward whose
      -- person's count this month reached its target, once per month. Only to
      -- a person who still works at the branch; no amount, no name, no id.
      if v_open then
        for v_row in
          with counts as (
            select o.placed_by_staff_id as staff_id, count(*) as n
              from orders o
             where o.venue_id = v_venue
               and o.placed_by_staff_id is not null
               and o.status <> 'voided'
               and o.placed_at >= v_ts_from
               and o.placed_at <  v_ts_to
             group by o.placed_by_staff_id
          )
          select r.id, r.staff_id
            from staff_rewards r
            join counts c on c.staff_id = r.staff_id
            join staff s on s.id = r.staff_id
           where r.venue_id = v_venue
             and r.ended_at is null
             and r.target <= c.n
             and s.is_active
             and exists (select 1 from staff_venues sv where sv.staff_id = s.id and sv.venue_id = v_venue)
             -- Once per person, target and month: a reward removed and set
             -- again at the same target is not announced twice.
             and not exists (select 1 from staff_reward_unlocks u
                               join staff_rewards r2 on r2.id = u.reward_id
                              where u.venue_id = v_venue and u.staff_id = r.staff_id
                                and r2.target = r.target and u.business_month = v_month)
           order by r.staff_id, r.target, r.id
        loop
          insert into staff_reward_unlocks (reward_id, business_month, venue_id, staff_id)
          values (v_row.id, v_month, v_venue, v_row.staff_id)
          on conflict (reward_id, business_month) do nothing;
          -- Another sweep recorded it first.
          continue when not found;
          v_unlocks := v_unlocks + 1;
          v_pushes := v_pushes + app.notify_staff(
            array[v_row.staff_id], 'staff_info',
            jsonb_build_object('route', 'staff-rewards', 'title_key', 'reward_unlocked'),
            'reward:' || v_row.id::text || ':' || v_month::text);
        end loop;
      end if;

      -- (2) Every ended month not closed yet, oldest first: every reward
      -- active at any moment of it whose target its final count reached
      -- becomes a bonus, one per person and target (the reward set last, so a
      -- removed and re-set target pays once), paid in the first unpaid wage
      -- month from the month after. A month is closed once the new month's
      -- first business day has passed, so an order voided at the boundary no
      -- longer counts. The months not closed yet start after the last month
      -- that paid a bonus at the branch, no earlier than the month of its
      -- first reward and at most twelve back, so a month the cron missed is
      -- still closed. Under the person's wage lock, so "mark paid" never
      -- snapshots around it. This venue block is all or nothing, so a month
      -- is never left half closed behind a later one.
      v_upto := case when v_today > v_month then v_last
                     else (v_last - interval '1 month')::date end;
      select greatest((v_last - interval '11 months')::date,
                      date_trunc('month', min(r.set_at at time zone v_tz) - make_interval(hours => v_hour))::date,
                      (select (max(e.earned_month) + interval '1 month')::date
                         from staff_reward_earnings e where e.venue_id = v_venue))
        into v_from
        from staff_rewards r
       where r.venue_id = v_venue;
      for v_m in
        select g::date from generate_series(v_from::timestamp, v_upto::timestamp, interval '1 month') g
      loop
        v_ts_a := (v_m::timestamp + make_interval(hours => v_hour)) at time zone v_tz;
        v_ts_b := ((v_m + interval '1 month')::timestamp + make_interval(hours => v_hour)) at time zone v_tz;
        for v_row in
          with counts as (
            select o.placed_by_staff_id as staff_id, count(*) as n
              from orders o
             where o.venue_id = v_venue
               and o.placed_by_staff_id is not null
               and o.status <> 'voided'
               and o.placed_at >= v_ts_a
               and o.placed_at <  v_ts_b
             group by o.placed_by_staff_id
          ), cand as (
            select distinct on (r.staff_id, r.target) r.id, r.staff_id, r.target, r.reward_iqd, r.prize
              from staff_rewards r
              join counts c on c.staff_id = r.staff_id
             where r.venue_id = v_venue
               and r.metric = 'orders_placed'
               and r.set_at < v_ts_b
               and (r.ended_at is null or r.ended_at >= v_ts_a)
               and r.target <= c.n
             order by r.staff_id, r.target, r.set_at desc, r.id desc
          )
          select cand.id, cand.staff_id, cand.target, cand.reward_iqd, cand.prize
            from cand
           where not exists (select 1 from staff_reward_earnings e
                              where e.venue_id = v_venue and e.staff_id = cand.staff_id
                                and e.target = cand.target and e.earned_month = v_m)
           order by cand.staff_id, cand.target, cand.id
        loop
          perform app.lock_wage(v_venue, v_row.staff_id);
          insert into staff_reward_earnings (venue_id, staff_id, reward_id, earned_month, target,
                                             reward_iqd, prize, pay_month)
          values (v_venue, v_row.staff_id, v_row.id, v_m, v_row.target, v_row.reward_iqd, v_row.prize,
                  app.wage_open_month(v_venue, v_row.staff_id, (v_m + interval '1 month')::date))
          on conflict do nothing;
          get diagnostics v_n = row_count;
          v_earnings := v_earnings + v_n;
        end loop;
      end loop;
    exception when others then
      raise warning 'reward_sweep venue %: % (%)', v_venue, sqlerrm, sqlstate;
      perform app.monitor('cron', 'error', 'cron_failed',
        format('reward_sweep venue %s: %s (%s)', v_venue, sqlerrm, sqlstate),
        jsonb_build_object('job', 'reward_sweep', 'sqlstate', sqlstate));
    end;
  end loop;

  return jsonb_build_object('pushes', v_pushes, 'unlocks', v_unlocks, 'earnings', v_earnings);
end $reward_sweep_0394$;

revoke all on function app.reward_sweep() from public, anon, authenticated;
grant execute on function app.reward_sweep() to service_role;

-- ---------------------------------------------------------------------------
-- app.shop_reward_sweep — 0355's body verbatim plus app.monitor in the branch handler.
-- ---------------------------------------------------------------------------
create or replace function app.shop_reward_sweep()
returns jsonb
language plpgsql security definer set search_path = public as $shop_reward_sweep_0394$
declare
  v_venue    uuid;
  v_tz       text;
  v_hour     int;
  v_today    date;
  v_month    date;
  v_last     date;
  v_from     date;
  v_upto     date;
  v_m        date;
  v_ts_a     timestamptz;
  v_ts_b     timestamptz;
  v_row      record;
  v_earnings int := 0;
  v_n        int;
begin
  for v_venue in
    select v.id
      from venues v
     where exists (select 1 from shop_sale_reward_rates r where r.venue_id = v.id)
     order by v.id
  loop
    begin
      perform set_config('app.venue_id', v_venue::text, true);

      -- The branch's business month, as 0332 names months.
      v_tz    := coalesce((select v.timezone from venues v where v.id = v_venue), 'Asia/Baghdad');
      v_hour  := coalesce(app.cafe_setting_int('analytics_business_day_start_hour', v_venue), 4);
      v_today := app.venue_business_date(v_venue);
      v_month := date_trunc('month', v_today)::date;
      v_last  := (v_month - interval '1 month')::date;

      -- As 0333: a month is closed once the new month's first business day
      -- has passed; the months not closed yet start after the last month
      -- that paid a reward at the branch, no earlier than the month of its
      -- first frozen rate and at most twelve back. This venue block is all
      -- or nothing.
      v_upto := case when v_today > v_month then v_last
                     else (v_last - interval '1 month')::date end;
      select greatest((v_last - interval '11 months')::date,
                      date_trunc('month', min(r.created_at at time zone v_tz) - make_interval(hours => v_hour))::date,
                      (select (max(e.earned_month) + interval '1 month')::date
                         from shop_sale_reward_earnings e where e.venue_id = v_venue))
        into v_from
        from shop_sale_reward_rates r
       where r.venue_id = v_venue;
      for v_m in
        select g::date from generate_series(v_from::timestamp, v_upto::timestamp, interval '1 month') g
      loop
        v_ts_a := (v_m::timestamp + make_interval(hours => v_hour)) at time zone v_tz;
        v_ts_b := ((v_m + interval '1 month')::timestamp + make_interval(hours => v_hour)) at time zone v_tz;
        for v_row in
          select l.staff_id, l.sales_iqd, l.reward_iqd
            from app.shop_reward_lines(v_venue, v_ts_a, v_ts_b) l
           where l.reward_iqd > 0
             and not exists (select 1 from shop_sale_reward_earnings e
                              where e.venue_id = v_venue and e.staff_id = l.staff_id
                                and e.earned_month = v_m)
           order by l.staff_id
        loop
          perform app.lock_wage(v_venue, v_row.staff_id);
          insert into shop_sale_reward_earnings (venue_id, staff_id, earned_month, sales_iqd,
                                                 reward_iqd, pay_month)
          values (v_venue, v_row.staff_id, v_m, v_row.sales_iqd, v_row.reward_iqd,
                  app.wage_open_month(v_venue, v_row.staff_id, (v_m + interval '1 month')::date))
          on conflict do nothing;
          get diagnostics v_n = row_count;
          v_earnings := v_earnings + v_n;
        end loop;
      end loop;
    exception when others then
      raise warning 'shop_reward_sweep venue %: % (%)', v_venue, sqlerrm, sqlstate;
      perform app.monitor('cron', 'error', 'cron_failed',
        format('shop_reward_sweep venue %s: %s (%s)', v_venue, sqlerrm, sqlstate),
        jsonb_build_object('job', 'shop_reward_sweep', 'sqlstate', sqlstate));
    end;
  end loop;

  return jsonb_build_object('earnings', v_earnings);
end $shop_reward_sweep_0394$;

revoke all on function app.shop_reward_sweep() from public, anon, authenticated;
grant execute on function app.shop_reward_sweep() to service_role;
