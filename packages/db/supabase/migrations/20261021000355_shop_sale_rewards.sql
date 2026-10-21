-- 0355 shop_sale_rewards — whoever sells in the Touch Shop earns a share of
-- the sale, on their wage.
--
-- Feature: Touch Shop sales reward (Sait 2026-10-21): the person who rings up
-- a shop (padel shop) sale earns a percentage of what the customer paid for
-- their lines; cafe sales earn nothing. One percentage for the whole shop, a
-- cafe setting (shop_sale_reward_pct, default 10, 0..50) that only the owner
-- sets. The shop's Products page and its till show each product's reward;
-- the reward reaches the wage as a bonus, beside the order-target rewards
-- (0332/0333).
-- Depends on: cafe_net_lines (0095), shop_schema (0144, tabs.kind shop),
-- reward_wages (0333: the month rules this copies), wage_advances (0344:
-- the latest app.wage_line and app.wages_month), wages_rpcs (0271:
-- app.lock_wage, app.wage_open_month), stock_logs (0203:
-- app.stock_cost_estimate), cafe_settings_per_venue (0209),
-- branch_write_guard (0230).
-- Re-runnable: create … if not exists, guarded constraints, create or
-- replace, drop trigger if exists, cron.schedule upserts by name.
--
-- THE RATE IS FROZEN AT THE SALE. When a kind 'shop' tab becomes settled
-- (app.settle_tab, app.settle_zero_tab, a replayed settle), the trigger
-- tabs_shop_sale_reward records the branch's shop_sale_reward_pct for it in
-- shop_sale_reward_rates, once. A later change of the setting never rewrites
-- a past sale. Tabs settled before this migration have no row and earn
-- nothing.
--
-- WHO EARNS WHAT. Each line earns for the person who placed its order
-- (orders.placed_by_staff_id; one shop tab may carry several people's
-- orders), never the owner: floor(net × pct / 100), where net is
-- app.cafe_net_lines' net_iqd (after line and tab discounts, less refunds,
-- before tax; voided lines are not there).
--
-- WHEN IT IS PAID. As 0333: once a business month ends and the new month's
-- first business day has passed, app.shop_reward_sweep (cron
-- tp_shop_reward_sweep, every five minutes) writes one frozen
-- shop_sale_reward_earnings row per person and month (the shop tabs settled
-- in it), paid in app.wage_open_month from the month after, under
-- app.lock_wage. A refund after that never touches it. app.wage_line adds it
-- to bonuses_iqd and bonus_count (so mark_wage_paid's snapshot and the net
-- and paid CHECKs need no change) and lists it in shop_rewards[].
--
-- WHAT THE SHOP SEES. app.shop_reward_info(): the percent, each shop size's
-- price, cost and reward, and the caller's own estimate for this business
-- month (the owner: none). For the shop assistant, manager and owner, who
-- cannot all read cafe_settings.
--
-- THE LLM WALL (as 0333). Money about a named person: both tables are
-- coverage-excluded, have no assistant_readable_columns row and no assistant
-- tool. shop_sale_reward_earnings is read by the owner only;
-- shop_sale_reward_rates by no client.
--
-- covered by packages/db/tests/shop-sale-rewards.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The setting: the full 0270 VALUES list + shop_sale_reward_pct.
-- ---------------------------------------------------------------------------
create or replace function app.cafe_setting_specs()
returns table (key text, is_public boolean, jtype text, min_role staff_role, default_value jsonb)
language sql stable security definer set search_path = public as $cafe_specs_0355$
  select v.key, v.is_public, v.jtype, v.min_role, v.default_value
    from (values
      -- public + manager|owner (guest-visible content)
      ('hero_mode',                         true,  'enum(none|media|featured)', 'manager'::staff_role, '"none"'::jsonb),
      ('hero_media_path',                   true,  'media_path(hero)',          'manager'::staff_role, 'null'::jsonb),
      ('hero_media_kind',                   true,  'enum(image|video)',         'manager'::staff_role, '"image"'::jsonb),
      ('featured_item_id',                  true,  'active_item_id',            'manager'::staff_role, 'null'::jsonb),
      ('featured_label_en',                 true,  'text(200)',                 'manager'::staff_role, '""'::jsonb),
      ('featured_label_ar',                 true,  'text(200)',                 'manager'::staff_role, '""'::jsonb),
      ('featured_badge_en',                 true,  'text(60)',                  'manager'::staff_role, '""'::jsonb),
      ('featured_badge_ar',                 true,  'text(60)',                  'manager'::staff_role, '""'::jsonb),
      ('featured_discount_pct',             true,  'int(0,99)',                 'manager'::staff_role, '0'::jsonb),
      ('ticker_en',                         true,  'text_array(12,120)',        'manager'::staff_role, '[]'::jsonb),
      ('ticker_ar',                         true,  'text_array(12,120)',        'manager'::staff_role, '[]'::jsonb),
      ('bell_tutorial_enabled',             true,  'bool',                      'manager'::staff_role, 'true'::jsonb),
      -- private + manager (station behaviour)
      ('till_idle_lock_seconds',            false, 'int(0,3600)',               'manager'::staff_role, '300'::jsonb),
      -- 0105: minutes of break per person per business day; 0 = no breaks.
      ('break_allowance_minutes',           false, 'int(0,480)',                'manager'::staff_role, '60'::jsonb),
      -- 0270: a work day costs attendance_penalty_iqd when minutes late plus
      -- minutes left early exceed attendance_grace_minutes; 0 IQD = off.
      ('attendance_grace_minutes',          false, 'int(0,720)',                'manager'::staff_role, '0'::jsonb),
      ('attendance_penalty_iqd',            false, 'int(0,2000000)',            'manager'::staff_role, '0'::jsonb),
      -- private + owner (operational / secrets-adjacent)
      ('telegram_enabled',                  false, 'bool',                      'owner'::staff_role,   'false'::jsonb),
      ('telegram_chat_id',                  false, 'chat_id',                   'owner'::staff_role,   'null'::jsonb),
      ('telegram_lang',                     false, 'enum(ar|en)',               'owner'::staff_role,   '"ar"'::jsonb),
      ('telegram_last_callback_at',         false, 'timestamp',                 'owner'::staff_role,   'null'::jsonb),
      ('analytics_business_day_start_hour', false, 'int(0,12)',                 'owner'::staff_role,   '4'::jsonb),
      ('analytics_excluded_item_ids',       false, 'uuid_array',                'owner'::staff_role,   '[]'::jsonb),
      ('analytics_engagement_floor',        false, 'date',                      'owner'::staff_role,   'null'::jsonb),
      -- 0270: the Wages reminder shows a wage this many days before its pay day.
      ('wage_reminder_days',                false, 'int(0,14)',                 'owner'::staff_role,   '3'::jsonb),
      -- 0355: whoever rings up a Touch Shop sale earns this percent of what
      -- the customer paid for their lines, on their wage.
      ('shop_sale_reward_pct',              false, 'int(0,50)',                 'owner'::staff_role,   '10'::jsonb)
    ) as v(key, is_public, jtype, min_role, default_value)
$cafe_specs_0355$;

-- ---------------------------------------------------------------------------
-- 2. shop_sale_reward_rates — the percent in force when a shop tab settled.
-- ---------------------------------------------------------------------------
create table if not exists shop_sale_reward_rates (
  tab_id     uuid primary key references tabs(id),
  venue_id   uuid not null references venues(id),
  reward_pct int not null,
  created_at timestamptz not null default now(),
  constraint shop_sale_reward_rates_pct_chk check (reward_pct between 0 and 50)
);

comment on table shop_sale_reward_rates is
  'shop_sale_reward_rates (0355): the shop_sale_reward_pct in force when a kind shop tab was settled, written once by the tabs_shop_sale_reward trigger, so a later change of the setting never rewrites a past sale. A shop tab without a row (settled before 0355) earns no reward. Read by no client. Never readable by the owner assistant or any LLM.';
comment on column shop_sale_reward_rates.tab_id is 'The settled shop tab.';
comment on column shop_sale_reward_rates.venue_id is 'The tab''s branch.';
comment on column shop_sale_reward_rates.reward_pct is 'The percent of each line''s net its seller earns.';
comment on column shop_sale_reward_rates.created_at is 'When the tab settled.';

alter table shop_sale_reward_rates enable row level security;

grant all on shop_sale_reward_rates to service_role;

drop trigger if exists zz_branch_guard on public.shop_sale_reward_rates;
create trigger zz_branch_guard before insert or update or delete on public.shop_sale_reward_rates
  for each row execute function app.trg_branch_guard('scoped', 'tabs', 'tab_id');

-- ---------------------------------------------------------------------------
-- 3. shop_sale_reward_earnings — one person's shop sales reward for a month.
-- ---------------------------------------------------------------------------
create table if not exists shop_sale_reward_earnings (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null references venues(id),
  staff_id     uuid not null references staff(id),
  earned_month date not null,
  sales_iqd    iqd not null,
  reward_iqd   iqd not null,
  pay_month    date not null,
  created_at   timestamptz not null default now(),
  constraint shop_sale_reward_earnings_month_key unique (venue_id, staff_id, earned_month),
  constraint shop_sale_reward_earnings_earned_first_chk
    check (earned_month = date_trunc('month', earned_month)::date),
  constraint shop_sale_reward_earnings_pay_first_chk
    check (pay_month = date_trunc('month', pay_month)::date),
  constraint shop_sale_reward_earnings_pay_after_chk check (pay_month > earned_month),
  constraint shop_sale_reward_earnings_reward_chk check (reward_iqd > 0 and reward_iqd <= sales_iqd)
);

comment on table shop_sale_reward_earnings is
  'shop_sale_reward_earnings (0355): what one person earned from their Touch Shop sales in a business month (earned_month, as 0332 names months), written by app.shop_reward_sweep once that month ended and the next month''s first business day passed: the net of their lines on the shop tabs settled in it (sales_iqd) and the reward at each tab''s frozen percent (reward_iqd), with the wage month it is paid in (pay_month, the first unpaid one from the month after). Frozen once written. app.wage_line adds reward_iqd to the bonuses of its pay month. Read by the owner only. Never readable by the owner assistant or any LLM.';
comment on column shop_sale_reward_earnings.id is 'Row id.';
comment on column shop_sale_reward_earnings.venue_id is 'The branch whose shop sales counted.';
comment on column shop_sale_reward_earnings.staff_id is 'The person who rang the sales up.';
comment on column shop_sale_reward_earnings.earned_month is 'The business month of the sales (its first day).';
comment on column shop_sale_reward_earnings.sales_iqd is 'The net of their shop lines in the month (after discounts and refunds, before tax).';
comment on column shop_sale_reward_earnings.reward_iqd is 'The reward in IQD.';
comment on column shop_sale_reward_earnings.pay_month is 'The wage month the reward is added to (its first day).';
comment on column shop_sale_reward_earnings.created_at is 'When the month was closed for it.';

alter table shop_sale_reward_earnings enable row level security;

drop policy if exists shop_sale_reward_earnings_owner_read on shop_sale_reward_earnings;
create policy shop_sale_reward_earnings_owner_read on shop_sale_reward_earnings
  for select to authenticated
  using ((select app.is_staff('owner'))
         and venue_id = any((select app.visible_venue_ids())::uuid[]));

grant select on shop_sale_reward_earnings to authenticated;
grant all on shop_sale_reward_earnings to service_role;

drop trigger if exists zz_branch_guard on public.shop_sale_reward_earnings;
create trigger zz_branch_guard before insert or update or delete on public.shop_sale_reward_earnings
  for each row execute function app.trg_branch_guard('scoped');

-- ---------------------------------------------------------------------------
-- 4. app.trg_shop_sale_reward — freeze the percent when a shop tab settles.
-- ---------------------------------------------------------------------------
create or replace function app.trg_shop_sale_reward()
returns trigger
language plpgsql security definer set search_path = public as $trg_shop_sale_reward_0355$
begin
  insert into shop_sale_reward_rates (tab_id, venue_id, reward_pct)
  values (new.id, new.venue_id,
          least(greatest(coalesce(app.cafe_setting_int('shop_sale_reward_pct', new.venue_id), 10), 0), 50))
  on conflict (tab_id) do nothing;
  return null;
end $trg_shop_sale_reward_0355$;

comment on function app.trg_shop_sale_reward() is
  'shop sales reward (0355). Trigger (AFTER UPDATE OF status ON tabs, a kind shop tab becoming settled): records the branch''s shop_sale_reward_pct for the tab in shop_sale_reward_rates, once.';

revoke all on function app.trg_shop_sale_reward() from public, anon, authenticated;

drop trigger if exists tabs_shop_sale_reward on public.tabs;
create trigger tabs_shop_sale_reward
  after update of status on public.tabs
  for each row
  when (new.kind = 'shop' and new.status = 'settled' and old.status is distinct from 'settled')
  execute function app.trg_shop_sale_reward();

-- ---------------------------------------------------------------------------
-- 5. app.shop_reward_lines — internal: each seller's net and reward on the
--    shop tabs settled in a window.
-- ---------------------------------------------------------------------------
create or replace function app.shop_reward_lines(p_venue uuid, p_from timestamptz, p_to timestamptz)
returns table (staff_id uuid, sales_iqd bigint, reward_iqd bigint)
language sql stable security definer set search_path = public as $shop_reward_lines_0355$
  with st as (
    select t.id, r.reward_pct
      from tabs t
      join shop_sale_reward_rates r on r.tab_id = t.id
     where t.venue_id = p_venue
       and t.kind = 'shop'
       and t.status = 'settled'
       and t.merged_into_tab_id is null
       and t.settled_at >= p_from and t.settled_at < p_to
  ), nl as (
    select x.* from app.cafe_net_lines((select coalesce(array_agg(st.id), '{}'::uuid[]) from st)) x
  )
  select o.placed_by_staff_id,
         sum(greatest(nl.net_iqd, 0))::bigint,
         sum(floor(greatest(nl.net_iqd, 0) * st.reward_pct / 100.0))::bigint
    from nl
    join st on st.id = nl.tab_id
    join orders o on o.id = nl.order_id
    join staff s on s.id = o.placed_by_staff_id
   where s.role <> 'owner'
   group by o.placed_by_staff_id
$shop_reward_lines_0355$;

comment on function app.shop_reward_lines(uuid, timestamptz, timestamptz) is
  'shop sales reward (0355). Internal: for the kind shop tabs of a branch settled in [p_from, p_to) that carry a shop_sale_reward_rates row, one row per person who placed their orders (never an owner): sales_iqd, the net of their lines (app.cafe_net_lines net_iqd, at least 0), and reward_iqd, the sum over lines of floor(net × the tab''s percent / 100).';

revoke all on function app.shop_reward_lines(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function app.shop_reward_lines(uuid, timestamptz, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 6. app.shop_reward_sweep — internal, cron tp_shop_reward_sweep: the
--    rewards of every ended month not closed yet.
-- ---------------------------------------------------------------------------
create or replace function app.shop_reward_sweep()
returns jsonb
language plpgsql security definer set search_path = public as $shop_reward_sweep_0355$
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
    end;
  end loop;

  return jsonb_build_object('earnings', v_earnings);
end $shop_reward_sweep_0355$;

comment on function app.shop_reward_sweep() is
  'shop sales reward (0355). Internal, service role (cron tp_shop_reward_sweep, every five minutes). For every branch with a frozen shop rate, in its own exception block with app.venue_id set: for every ended business month not closed yet (after the last month with an earning at the branch, from the month of its first rate, at most twelve back, oldest first), and only once the new month''s first business day has passed, every person whose app.shop_reward_lines reward for the month is above 0 gets one shop_sale_reward_earnings row (sales_iqd, reward_iqd, pay_month = app.wage_open_month from the month after), under app.lock_wage, idempotent by (branch, person, month). Returns {earnings}.';

revoke all on function app.shop_reward_sweep() from public, anon, authenticated;
grant execute on function app.shop_reward_sweep() to service_role;

do $shop_reward_sweep_cron_0355$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_shop_reward_sweep not scheduled';
    return;
  end if;
  perform cron.schedule('tp_shop_reward_sweep', '*/5 * * * *', 'select app.shop_reward_sweep();');
end $shop_reward_sweep_cron_0355$;

-- ---------------------------------------------------------------------------
-- 7. app.wage_line — 0344 plus the shop sales rewards whose pay month it is.
-- ---------------------------------------------------------------------------
create or replace function app.wage_line(
  p_venue  uuid,
  p_staff  uuid,
  p_month  date,
  p_today  date,
  p_remind int
) returns jsonb
language plpgsql stable security definer set search_path = public as $wage_line_0355$
declare
  v_month   date := date_trunc('month', p_month)::date;
  v_rate    staff_wages%rowtype;
  v_next    staff_wages%rowtype;
  v_pay     wage_payments%rowtype;
  v_due     date;
  v_salary  bigint;
  v_ded     bigint;
  v_ded_n   int;
  v_pen     bigint;
  v_pen_n   int;
  v_bon     bigint;
  v_bon_n   int;
  v_bonuses jsonb;
  v_shop    jsonb;
  v_sbon    bigint;
  v_sbon_n  int;
  v_adv     bigint;
  v_adv_n   int;
  v_advances jsonb;
  v_paid    boolean;
  v_status  text;
  v_payment jsonb;
  v_only    boolean := false;
  v_tz      text;
  v_hour    int;
begin
  select * into v_rate
    from staff_wages w
   where w.venue_id = p_venue and w.staff_id = p_staff and w.effective_month <= v_month
   order by w.effective_month desc
   limit 1;
  select * into v_next
    from staff_wages w
   where w.venue_id = p_venue and w.staff_id = p_staff and w.effective_month > v_month
   order by w.effective_month
   limit 1;
  select * into v_pay
    from wage_payments p
   where p.venue_id = p_venue and p.staff_id = p_staff and p.pay_month = v_month;
  v_paid := v_pay.id is not null and v_pay.status = 'paid';

  if v_paid then
    -- A paid month answers from what the owner saw.
    v_salary := v_pay.salary_iqd;
    v_ded    := v_pay.deductions_iqd;
    v_ded_n  := v_pay.deduction_count;
    v_pen    := v_pay.penalties_iqd;
    v_pen_n  := v_pay.penalty_days;
    v_bon    := v_pay.bonuses_iqd;
    v_bon_n  := v_pay.bonus_count;
    v_adv    := v_pay.advances_iqd;
    v_adv_n  := v_pay.advance_count;
    v_due    := v_pay.due_date;
  else
    v_salary := coalesce(v_rate.salary_iqd, 0);
    select coalesce(sum(d.amount_iqd), 0), count(*)
      into v_ded, v_ded_n
      from salary_deductions d
     where d.venue_id = p_venue and d.staff_id = p_staff
       and d.status = 'approved' and d.pay_month = v_month;
    select coalesce(sum(a.penalty_iqd), 0), count(*) filter (where a.penalty_iqd > 0)
      into v_pen, v_pen_n
      from staff_attendance a
     where a.venue_id = p_venue and a.staff_id = p_staff and a.pay_month = v_month;
    select coalesce(sum(e.reward_iqd), 0), count(*) filter (where e.reward_iqd > 0)
      into v_bon, v_bon_n
      from staff_reward_earnings e
     where e.venue_id = p_venue and e.staff_id = p_staff and e.pay_month = v_month;
    -- 0355: the Touch Shop sales rewards paid in the month join the bonuses.
    select coalesce(sum(e.reward_iqd), 0), count(*)
      into v_sbon, v_sbon_n
      from shop_sale_reward_earnings e
     where e.venue_id = p_venue and e.staff_id = p_staff and e.pay_month = v_month;
    v_bon   := v_bon + v_sbon;
    v_bon_n := v_bon_n + v_sbon_n;
    -- 0344: the advances already handed over against the month.
    select coalesce(sum(a.amount_iqd), 0), count(*)
      into v_adv, v_adv_n
      from wage_advances a
     where a.venue_id = p_venue and a.staff_id = p_staff
       and a.pay_month = v_month and a.status = 'given';
    -- A bonus that lands after the person left: no salary for a month they
    -- did not work. Left = no longer active at the branch; not worked = no
    -- order placed there in the month (as 0332 counts months) and no day
    -- recorded in it. Only a month that carries a bonus is changed, so every
    -- other line reads as 0271 did.
    if v_salary > 0
       and (exists (select 1 from staff_reward_earnings e
                     where e.venue_id = p_venue and e.staff_id = p_staff and e.pay_month = v_month)
            or exists (select 1 from shop_sale_reward_earnings e
                        where e.venue_id = p_venue and e.staff_id = p_staff and e.pay_month = v_month))
       and not exists (select 1 from staff s
                        where s.id = p_staff and s.is_active
                          and exists (select 1 from staff_venues sv
                                       where sv.staff_id = s.id and sv.venue_id = p_venue))
       and not exists (select 1 from staff_attendance a
                        where a.venue_id = p_venue and a.staff_id = p_staff
                          and a.work_date >= v_month
                          and a.work_date <  (v_month + interval '1 month')::date) then
      v_tz   := coalesce((select v.timezone from venues v where v.id = p_venue), 'Asia/Baghdad');
      v_hour := coalesce(app.cafe_setting_int('analytics_business_day_start_hour', p_venue), 4);
      if not exists (select 1 from orders o
                      where o.venue_id = p_venue and o.placed_by_staff_id = p_staff
                        and o.placed_at >= (v_month::timestamp + make_interval(hours => v_hour)) at time zone v_tz
                        and o.placed_at <  ((v_month + interval '1 month')::timestamp
                                            + make_interval(hours => v_hour)) at time zone v_tz) then
        v_salary := 0;
        v_only   := true;
      end if;
    end if;
    if v_rate.id is not null then
      v_due := app.wage_due_date(v_month, v_rate.pay_day);
    end if;
  end if;

  -- The rewards behind the bonuses, prize-only ones too (the owner hands the
  -- prize over); earnings never change, so a paid month lists what it paid.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           e.id,
           'earned_month', e.earned_month,
           'target',       e.target,
           'reward_iqd',   e.reward_iqd,
           'prize',        e.prize)
           order by e.earned_month, e.target, e.id), '[]'::jsonb)
    into v_bonuses
    from staff_reward_earnings e
   where e.venue_id = p_venue and e.staff_id = p_staff and e.pay_month = v_month;

  -- 0355: the shop sales rewards behind the bonuses, one per earned month;
  -- frozen once written, so a paid month lists what it paid.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           e.id,
           'earned_month', e.earned_month,
           'sales_iqd',    e.sales_iqd,
           'reward_iqd',   e.reward_iqd)
           order by e.earned_month, e.id), '[]'::jsonb)
    into v_shop
    from shop_sale_reward_earnings e
   where e.venue_id = p_venue and e.staff_id = p_staff and e.pay_month = v_month;

  -- 0344: the advances behind the figure. A paid month's are frozen (an
  -- advance is undone only while its month is open), so the list is the
  -- snapshot's.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',         a.id,
           'amount_iqd', a.amount_iqd,
           'paid_from',  a.paid_from,
           'note',       a.note,
           'given_at',   a.given_at,
           'given_by_name', (select s.display_name from staff s where s.id = a.given_by))
           order by a.given_at, a.id), '[]'::jsonb)
    into v_advances
    from wage_advances a
   where a.venue_id = p_venue and a.staff_id = p_staff
     and a.pay_month = v_month and a.status = 'given';

  v_status := case
    when v_paid                     then 'paid'
    when v_rate.id is null          then 'unset'
    when v_rate.salary_iqd = 0      then 'none'
    when p_today > v_due            then 'overdue'
    when p_today >= v_due - greatest(coalesce(p_remind, 0), 0) then 'due'
    else 'upcoming'
  end;

  if v_pay.id is not null then
    v_payment := jsonb_build_object(
      'id',             v_pay.id,
      'status',         v_pay.status,
      'paid_iqd',       v_pay.paid_iqd,
      'advances_iqd',   v_pay.advances_iqd,
      'paid_from',      v_pay.paid_from,
      'paid_at',        v_pay.paid_at,
      'paid_by_name',   (select s.display_name from staff s where s.id = v_pay.paid_by),
      'undone_at',      v_pay.undone_at,
      'undone_by_name', (select s.display_name from staff s where s.id = v_pay.undone_by),
      'undo_reason',    v_pay.undo_reason);
  end if;

  return jsonb_build_object(
    'month',           v_month,
    'status',          v_status,
    'salary_iqd',      v_salary,
    'pay_day',         v_rate.pay_day,
    'rate_from',       v_rate.effective_month,
    'next_rate',       case when v_next.id is not null then jsonb_build_object(
                         'salary_iqd', v_next.salary_iqd,
                         'pay_day',    v_next.pay_day,
                         'from',       v_next.effective_month) end,
    'due_date',        v_due,
    'days_left',       case when v_due is not null then v_due - p_today end,
    'deductions_iqd',  v_ded,
    'deduction_count', v_ded_n,
    'penalties_iqd',   v_pen,
    'penalty_days',    v_pen_n,
    'bonuses_iqd',     v_bon,
    'bonus_count',     v_bon_n,
    'bonuses',         v_bonuses,
    'shop_rewards',    v_shop,
    'bonus_only',      v_only,
    'net_iqd',         v_salary - v_ded - v_pen + v_bon,
    'advances_iqd',    v_adv,
    'advance_count',   v_adv_n,
    'advances',        v_advances,
    'owed_iqd',        case when v_paid then 0 else v_salary - v_ded - v_pen + v_bon - v_adv end,
    'to_pay_iqd',      case when v_paid then 0 else greatest(v_salary - v_ded - v_pen + v_bon - v_adv, 0) end,
    'payment',         v_payment);
end $wage_line_0355$;

comment on function app.wage_line(uuid, uuid, date, date, int) is
  'wages (0271), reward bonuses (0333), advances (0344), shop sales rewards (0355). Internal: one person''s pay month at a branch, {month, status (unset, none, upcoming, due, overdue, paid), salary_iqd, pay_day, rate_from, next_rate, due_date, days_left, deductions_iqd, deduction_count, penalties_iqd, penalty_days, bonuses_iqd, bonus_count, bonuses: [{id, earned_month, target, reward_iqd, prize}], shop_rewards: [{id, earned_month, sales_iqd, reward_iqd}] (0355: the Touch Shop sales rewards paid in the month, also counted in bonuses_iqd and bonus_count), bonus_only, net_iqd (salary - deductions - penalties + bonuses), advances_iqd, advance_count, advances: [{id, amount_iqd, paid_from, note, given_at, given_by_name}], owed_iqd (net - advances, signed; 0 once paid), to_pay_iqd (owed, or 0 below zero; 0 once paid), payment (+ advances_iqd, paid_from)}. A paid month answers from its payment snapshot; otherwise the rate in force, the approved deductions, the lateness penalties, the reward bonuses and the given advances whose pay month it is. bonus_only: an unpaid month that carries a bonus for someone no longer active at the branch who placed no order and had no recorded day there in it; its salary_iqd is 0 (no salary for a month not worked), so the bonus is paid alone. due is today within p_remind days of the pay day.';

revoke all on function app.wage_line(uuid, uuid, date, date, int) from public, anon, authenticated;
grant execute on function app.wage_line(uuid, uuid, date, date, int) to service_role;

-- ---------------------------------------------------------------------------
-- 8. app.wages_month — 0344 plus anyone a shop sales reward lands on.
-- ---------------------------------------------------------------------------
create or replace function app.wages_month(
  p_venue_id uuid default null,
  p_month    date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $wages_month_0355$
declare
  v_venue   uuid;
  v_today   date;
  v_current date;
  v_month   date;
  v_remind  int;
  v_people  jsonb;
  v_totals  jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_today   := app.venue_business_date(v_venue);
  v_current := date_trunc('month', v_today)::date;
  v_month   := coalesce(date_trunc('month', p_month)::date, v_current);
  v_remind  := coalesce(app.cafe_setting_int('wage_reminder_days', v_venue), 3);

  -- Everyone active at the branch, and anyone else the month has a payment,
  -- an approved deduction, a recorded day or a reward bonus for. Never an owner.
  with people as (
    select s.id, s.display_name, s.role, s.is_active,
           s.is_active and exists (select 1 from staff_venues sv
                                    where sv.staff_id = s.id and sv.venue_id = v_venue) as member
      from staff s
     where s.role <> 'owner'
       and ((s.is_active and exists (select 1 from staff_venues sv
                                      where sv.staff_id = s.id and sv.venue_id = v_venue))
            or exists (select 1 from wage_payments p
                        where p.venue_id = v_venue and p.staff_id = s.id and p.pay_month = v_month)
            or exists (select 1 from salary_deductions d
                        where d.venue_id = v_venue and d.staff_id = s.id
                          and d.status = 'approved' and d.pay_month = v_month)
            or exists (select 1 from staff_attendance a
                        where a.venue_id = v_venue and a.staff_id = s.id and a.pay_month = v_month)
            or exists (select 1 from staff_reward_earnings e
                        where e.venue_id = v_venue and e.staff_id = s.id and e.pay_month = v_month)
            or exists (select 1 from shop_sale_reward_earnings e
                        where e.venue_id = v_venue and e.staff_id = s.id and e.pay_month = v_month)
            or exists (select 1 from wage_advances a
                        where a.venue_id = v_venue and a.staff_id = s.id
                          and a.pay_month = v_month and a.status = 'given'))
  ), lines as (
    select p.*, app.wage_line(v_venue, p.id, v_month, v_today, v_remind) as line
      from people p
  )
  select coalesce(jsonb_agg(
           l.line || jsonb_build_object(
             'staff_id',      l.id,
             'display_name',  l.display_name,
             'role',          l.role,
             'is_active',     l.is_active,
             'member',        l.member,
             'waiting_count', (select count(*) from salary_deductions d
                                where d.venue_id = v_venue and d.staff_id = l.id and d.status = 'waiting'),
             'deductions',    (select coalesce(jsonb_agg(jsonb_build_object(
                                        'id',             d.id,
                                        'amount_iqd',     d.amount_iqd,
                                        'deduction_date', d.deduction_date,
                                        'reason',         d.reason,
                                        'decided_at',     d.decided_at)
                                      order by d.deduction_date, d.decided_at, d.id), '[]'::jsonb)
                                 from salary_deductions d
                                where d.venue_id = v_venue and d.staff_id = l.id
                                  and d.status = 'approved' and d.pay_month = v_month),
             'lateness',      (select coalesce(jsonb_agg(jsonb_build_object(
                                        'id',                  a.id,
                                        'work_date',           a.work_date,
                                        'late_minutes',        a.late_minutes,
                                        'early_leave_minutes', a.early_leave_minutes,
                                        'grace_minutes',       a.grace_minutes,
                                        'penalty_iqd',         a.penalty_iqd,
                                        'note',                a.note)
                                      order by a.work_date, a.id), '[]'::jsonb)
                                 from staff_attendance a
                                where a.venue_id = v_venue and a.staff_id = l.id and a.pay_month = v_month))
           order by l.display_name, l.id), '[]'::jsonb),
         jsonb_build_object(
           'salary_iqd',     coalesce(sum((l.line ->> 'salary_iqd')::bigint), 0),
           'deductions_iqd', coalesce(sum((l.line ->> 'deductions_iqd')::bigint), 0),
           'penalties_iqd',  coalesce(sum((l.line ->> 'penalties_iqd')::bigint), 0),
           'bonuses_iqd',    coalesce(sum((l.line ->> 'bonuses_iqd')::bigint), 0),
           'net_iqd',        coalesce(sum((l.line ->> 'net_iqd')::bigint), 0),
           'advances_iqd',   coalesce(sum((l.line ->> 'advances_iqd')::bigint), 0),
           'to_pay_iqd',     coalesce(sum((l.line ->> 'to_pay_iqd')::bigint), 0),
           'paid_iqd',       coalesce(sum((l.line #>> '{payment,paid_iqd}')::bigint)
                                        filter (where l.line ->> 'status' = 'paid'), 0),
           'people',         count(*),
           'paid',           count(*) filter (where l.line ->> 'status' = 'paid'),
           'due',            count(*) filter (where l.line ->> 'status' = 'due'),
           'overdue',        count(*) filter (where l.line ->> 'status' = 'overdue'),
           'upcoming',       count(*) filter (where l.line ->> 'status' = 'upcoming'),
           'unset',          count(*) filter (where l.line ->> 'status' = 'unset'))
    into v_people, v_totals
    from lines l;

  return jsonb_build_object(
    'month',         v_month,
    'current_month', v_current,
    'today',         v_today,
    'remind_days',   v_remind,
    'totals',        v_totals,
    'people',        v_people);
end $wages_month_0355$;
comment on function app.wages_month(uuid, date) is
  'wages (0271), reward bonuses (0333), advances (0344), shop sales rewards (0355). The owner at the branch: {month, current_month, today, remind_days, totals: {salary_iqd, deductions_iqd, penalties_iqd, bonuses_iqd, net_iqd, advances_iqd, to_pay_iqd, paid_iqd, people, paid, due, overdue, upcoming, unset}, people: [app.wage_line (with bonuses, advances, owed_iqd, to_pay_iqd) + {staff_id, display_name, role, is_active, member, waiting_count, deductions: [{id, amount_iqd, deduction_date, reason, decided_at}], lateness: [{id, work_date, late_minutes, early_leave_minutes, grace_minutes, penalty_iqd, note}]}]} for p_month (NULL: the branch''s current business month): everyone active at the branch but an owner, and anyone the month has a payment, approved deduction, recorded day, reward bonus, shop sales reward or given advance for. FORBIDDEN for anyone else.';

revoke all on function app.wages_month(uuid, date) from public, anon;
grant execute on function app.wages_month(uuid, date) to authenticated;


-- ---------------------------------------------------------------------------
-- 9. app.shop_reward_info — what the shop's pages show.
-- ---------------------------------------------------------------------------
create or replace function app.shop_reward_info()
returns jsonb
language plpgsql stable security definer set search_path = public as $shop_reward_info_0355$
declare
  v_venue    uuid;
  v_pct      int;
  v_tz       text;
  v_hour     int;
  v_month    date;
  v_products jsonb;
  v_me       jsonb;
  v_sales    bigint;
  v_reward   bigint;
begin
  if not app.is_staff('manager', 'owner', 'shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := app.current_venue();
  if not app.is_staff_at(v_venue, 'manager', 'owner', 'shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_pct := least(greatest(coalesce(app.cafe_setting_int('shop_sale_reward_pct', v_venue), 10), 0), 50);

  -- Every shop size at the branch: its price, its cost (the latest delivery
  -- with a cost, else the cost typed on the product; NULL when neither) and
  -- what selling one earns at today's percent.
  select coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', mv.id,
           'price_iqd',  mv.price_iqd,
           'cost_iqd',   (select case when c.cost_source = 'none' then null else round(c.unit_cost)::bigint end
                            from ingredients i, app.stock_cost_estimate(i.id) c
                           where i.variant_id = mv.id and i.kind = 'retail'
                           order by i.id
                           limit 1),
           'reward_iqd', floor(mv.price_iqd * v_pct / 100.0)::bigint)
           order by mv.id), '[]'::jsonb)
    into v_products
    from menu_item_variants mv
    join menu_items mi on mi.id = mv.item_id
    join menu_categories mc on mc.id = mi.category_id
   where mc.kind = 'shop' and mi.venue_id = v_venue;

  -- The caller's own shop sales this business month, at each tab's frozen
  -- percent. Not the owner's: the owner earns none.
  if not app.is_staff('owner') then
    v_tz    := coalesce((select v.timezone from venues v where v.id = v_venue), 'Asia/Baghdad');
    v_hour  := coalesce(app.cafe_setting_int('analytics_business_day_start_hour', v_venue), 4);
    v_month := date_trunc('month', app.venue_business_date(v_venue))::date;
    select coalesce(l.sales_iqd, 0), coalesce(l.reward_iqd, 0)
      into v_sales, v_reward
      from app.shop_reward_lines(
             v_venue,
             (v_month::timestamp + make_interval(hours => v_hour)) at time zone v_tz,
             ((v_month + interval '1 month')::timestamp + make_interval(hours => v_hour)) at time zone v_tz) l
     where l.staff_id = auth.uid();
    v_me := jsonb_build_object(
      'month',            v_month,
      'month_sales_iqd',  coalesce(v_sales, 0),
      'month_reward_iqd', coalesce(v_reward, 0));
  end if;

  return jsonb_build_object('pct', v_pct, 'products', v_products, 'me', v_me);
end $shop_reward_info_0355$;

comment on function app.shop_reward_info() is
  'shop sales reward (0355). The shop assistant, a manager or the owner at the branch: {pct (shop_sale_reward_pct, default 10), products: [{variant_id, price_iqd, cost_iqd (the latest delivery cost, else the cost typed on the product, NULL when neither), reward_iqd (floor(price × pct / 100))}] for every shop size, me: {month, month_sales_iqd, month_reward_iqd} (the caller''s own shop sales this business month at each tab''s frozen percent; NULL for the owner, who earns none)}. FORBIDDEN for anyone else.';

revoke all on function app.shop_reward_info() from public, anon;
grant execute on function app.shop_reward_info() to authenticated;
