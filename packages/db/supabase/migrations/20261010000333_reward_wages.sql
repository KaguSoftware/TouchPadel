-- 0333 reward_wages — a reward reached in a business month becomes a bonus on
-- the person's wage, and the person hears when they reach one.
--
-- Feature: staff rewards (owner decisions 2026-10-10/11): rewards are part of
-- the wage; each reward reached is its own bonus (reaching 100 and 200 earns
-- both); a push tells the person, and only the person, when they unlock one.
-- Depends on: staff_rewards (0332), wages_rpcs (0271: app.wage_line,
-- app.wages_month, app.mark_wage_paid, app.wage_open_month, app.lock_wage),
-- wages_tables (0270: wage_payments), checklist_schedules (0323:
-- app.notify_staff, the tp_checklist_sweep shape), branch_write_guard (0230).
-- Re-runnable: create … if not exists, add column if not exists, guarded
-- constraint swap, create or replace, cron.schedule upserts by name.
--
-- WHEN A BONUS IS EARNED. Only when a business month ENDS (0332 names months:
-- the branch's business month, from the first business day's start hour),
-- and only once the new month's first business day has passed too, so an
-- order still open at the boundary and voided by the closing cashier no
-- longer counts. Every ended month not closed yet is closed, oldest first
-- (at most twelve back), so a month the cron missed entirely is still closed.
-- For each such month M, every reward that was active at any moment of M (set
-- before M ended, not ended before M began: 0332's last_month.reached rule)
-- whose target is at most the person's final count for M becomes one
-- staff_reward_earnings row, amount and prize copied. ONE per person and
-- target: when the owner removed a reward and set the same target again in
-- M (the way an amount is changed), the one set last pays, never both. Its
-- pay month is app.wage_open_month(branch, person, the month after M): the
-- first wage month from then on that is not paid yet, the way a late
-- deduction lands (0272). The row is frozen once written: a later void, a
-- changed reward or an ended one never touches it. app.reward_sweep writes
-- them (cron tp_reward_sweep, every five minutes) under app.lock_wage, so
-- "mark paid" never snapshots a month while a bonus lands in it.
--
-- THE WAGE. wage_payments gains bonuses_iqd and bonus_count, and the net is
-- salary - deductions - penalties + bonuses (the CHECK is swapped). app.wage_line
-- adds the earnings whose pay month it is (a paid month answers from its
-- snapshot) and lists them as 'bonuses', prize-only rows included so the owner
-- remembers to hand the prize over. app.mark_wage_paid snapshots them; its
-- p_expected_net_iqd check already covers them (the net includes them).
-- A month with no salary (no rate, or a rate of 0) that carries a bonus can
-- be marked paid for the bonus alone. A person who left the branch (not an
-- active member) and did no work there in a month (no order placed, no day
-- recorded) is charged no salary in a month that only carries their bonus
-- (bonus_only): the bonus is paid without a salary for a month not worked.
--
-- THE PUSH. The first time in a business month a person's count reaches an
-- active reward's target, app.reward_sweep records a staff_reward_unlocks row
-- and queues one reward_unlocked staff_info push to THAT person, route
-- staff-rewards: no amount, no prize, no name, no id. Once per person, target
-- and month: a reward removed and set again at the same target is not
-- announced twice.
--
-- THE LLM WALL (as 0197, 0270, 0332). Money about a named person: both new
-- tables are coverage-excluded, have no assistant_readable_columns row and no
-- assistant tool. staff_reward_earnings is read by the owner only;
-- staff_reward_unlocks by no client at all (push bookkeeping).
--
-- covered by packages/db/tests/reward-wages.test.ts (and staff-rewards.test.ts,
-- wages.test.ts, staff-push.test.ts)

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. staff_reward_earnings — one reached reward in one business month.
-- ---------------------------------------------------------------------------
create table if not exists staff_reward_earnings (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null references venues(id),
  staff_id     uuid not null references staff(id),
  reward_id    uuid not null references staff_rewards(id),
  earned_month date not null,
  target       int not null,
  reward_iqd   iqd not null,
  prize        text,
  pay_month    date not null,
  created_at   timestamptz not null default now(),
  constraint staff_reward_earnings_month_key unique (reward_id, earned_month),
  -- One bonus per person, target and month, whatever rewards were set at it.
  constraint staff_reward_earnings_target_month_key unique (venue_id, staff_id, target, earned_month),
  constraint staff_reward_earnings_earned_first_chk
    check (earned_month = date_trunc('month', earned_month)::date),
  constraint staff_reward_earnings_pay_first_chk
    check (pay_month = date_trunc('month', pay_month)::date),
  constraint staff_reward_earnings_pay_after_chk check (pay_month > earned_month),
  constraint staff_reward_earnings_target_chk check (target between 1 and 100000),
  constraint staff_reward_earnings_reward_chk check (reward_iqd <= 10000000),
  constraint staff_reward_earnings_prize_chk
    check (prize is null or (prize = btrim(prize) and length(prize) between 1 and 80)),
  constraint staff_reward_earnings_something_chk check (reward_iqd > 0 or prize is not null)
);

comment on table staff_reward_earnings is
  'staff_reward_earnings (0333): a reward the person reached in a business month (earned_month, as 0332 names months), written by app.reward_sweep once that month ended and the next month''s first business day passed, one per person, target and month, with the bonus and prize copied and the wage month it is paid in (pay_month, the first unpaid one from the month after). Frozen once written: a later void or a changed reward never touches it. app.wage_line adds reward_iqd to the net of its pay month. Read by the owner only. Never readable by the owner assistant or any LLM.';
comment on column staff_reward_earnings.id is 'Row id.';
comment on column staff_reward_earnings.venue_id is 'The branch whose orders counted.';
comment on column staff_reward_earnings.staff_id is 'The person who reached it.';
comment on column staff_reward_earnings.reward_id is 'The standing reward (staff_rewards) it was reached for.';
comment on column staff_reward_earnings.earned_month is 'The business month it was reached in (its first day).';
comment on column staff_reward_earnings.target is 'Copied: the number of orders it asked for.';
comment on column staff_reward_earnings.reward_iqd is 'Copied: the bonus in IQD; 0 for a prize-only reward.';
comment on column staff_reward_earnings.prize is 'Copied: the prize in the owner''s words, or NULL.';
comment on column staff_reward_earnings.pay_month is 'The wage month the bonus is added to (its first day).';
comment on column staff_reward_earnings.created_at is 'When the month was closed for it.';

alter table staff_reward_earnings enable row level security;

drop policy if exists staff_reward_earnings_owner_read on staff_reward_earnings;
create policy staff_reward_earnings_owner_read on staff_reward_earnings
  for select to authenticated
  using ((select app.is_staff('owner'))
         and venue_id = any((select app.visible_venue_ids())::uuid[]));

grant select on staff_reward_earnings to authenticated;
grant all on staff_reward_earnings to service_role;

drop trigger if exists zz_branch_guard on public.staff_reward_earnings;
create trigger zz_branch_guard before insert or update or delete on public.staff_reward_earnings
  for each row execute function app.trg_branch_guard('scoped', 'staff_rewards', 'reward_id');

-- ---------------------------------------------------------------------------
-- 2. staff_reward_unlocks — the push was sent for a reward in a month.
-- ---------------------------------------------------------------------------
create table if not exists staff_reward_unlocks (
  reward_id      uuid not null references staff_rewards(id),
  business_month date not null,
  venue_id       uuid not null references venues(id),
  staff_id       uuid not null references staff(id),
  unlocked_at    timestamptz not null default now(),
  constraint staff_reward_unlocks_pkey primary key (reward_id, business_month),
  constraint staff_reward_unlocks_month_first_chk
    check (business_month = date_trunc('month', business_month)::date)
);

comment on table staff_reward_unlocks is
  'staff_reward_unlocks (0333): push bookkeeping. app.reward_sweep writes one row the first time in a business month a person''s count reaches an active reward''s target, and queues the reward_unlocked push to that person then; the row stops a second push for the same reward and month. Read by no client. Never readable by the owner assistant or any LLM.';
comment on column staff_reward_unlocks.reward_id is 'The reward reached.';
comment on column staff_reward_unlocks.business_month is 'The business month it was reached in (its first day).';
comment on column staff_reward_unlocks.venue_id is 'The branch.';
comment on column staff_reward_unlocks.staff_id is 'The person told.';
comment on column staff_reward_unlocks.unlocked_at is 'When the sweep saw it.';

alter table staff_reward_unlocks enable row level security;

grant all on staff_reward_unlocks to service_role;

drop trigger if exists zz_branch_guard on public.staff_reward_unlocks;
create trigger zz_branch_guard before insert or update or delete on public.staff_reward_unlocks
  for each row execute function app.trg_branch_guard('scoped', 'staff_rewards', 'reward_id');

-- ---------------------------------------------------------------------------
-- 3. wage_payments — the bonus snapshot, and the net with bonuses.
-- ---------------------------------------------------------------------------
alter table wage_payments add column if not exists bonuses_iqd iqd not null default 0;
alter table wage_payments add column if not exists bonus_count int not null default 0;

comment on column wage_payments.bonuses_iqd is 'Snapshot: the reward bonuses whose pay month it is (0333).';
comment on column wage_payments.bonus_count is 'Snapshot: how many reward bonuses above 0 IQD (0333).';
comment on column wage_payments.net_iqd is 'Snapshot: salary minus deductions minus penalties plus bonuses (0333); may be below zero.';

-- The net CHECK gains the bonuses. Every existing row has bonuses_iqd 0, so the
-- validation cannot fail; the swap runs once (the new definition names
-- bonuses_iqd).
do $wage_payments_net_chk_0333$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'wage_payments_net_chk'
                    and conrelid = 'public.wage_payments'::regclass
                    and pg_get_constraintdef(oid) like '%bonuses_iqd%') then
    alter table wage_payments drop constraint if exists wage_payments_net_chk;
    alter table wage_payments add constraint wage_payments_net_chk
      check (net_iqd = salary_iqd - deductions_iqd - penalties_iqd + bonuses_iqd) not valid;
  end if;
end $wage_payments_net_chk_0333$;

do $wage_payments_net_chk_validate_0333$
begin
  if exists (select 1 from pg_constraint
              where conname = 'wage_payments_net_chk'
                and conrelid = 'public.wage_payments'::regclass
                and not convalidated) then
    alter table wage_payments validate constraint wage_payments_net_chk;
  end if;
end $wage_payments_net_chk_validate_0333$;

do $wage_payments_bonus_count_chk_0333$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'wage_payments_bonus_count_chk'
                    and conrelid = 'public.wage_payments'::regclass) then
    alter table wage_payments add constraint wage_payments_bonus_count_chk
      check (bonus_count >= 0) not valid;
  end if;
end $wage_payments_bonus_count_chk_0333$;

do $wage_payments_bonus_count_chk_validate_0333$
begin
  if exists (select 1 from pg_constraint
              where conname = 'wage_payments_bonus_count_chk'
                and conrelid = 'public.wage_payments'::regclass
                and not convalidated) then
    alter table wage_payments validate constraint wage_payments_bonus_count_chk;
  end if;
end $wage_payments_bonus_count_chk_validate_0333$;

-- ---------------------------------------------------------------------------
-- 4. app.wage_line — 0271 plus the bonuses whose pay month it is.
-- ---------------------------------------------------------------------------
create or replace function app.wage_line(
  p_venue  uuid,
  p_staff  uuid,
  p_month  date,
  p_today  date,
  p_remind int
) returns jsonb
language plpgsql stable security definer set search_path = public as $wage_line_0333$
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
    -- A bonus that lands after the person left: no salary for a month they
    -- did not work. Left = no longer active at the branch; not worked = no
    -- order placed there in the month (as 0332 counts months) and no day
    -- recorded in it. Only a month that carries a bonus is changed, so every
    -- other line reads as 0271 did.
    if v_salary > 0
       and exists (select 1 from staff_reward_earnings e
                    where e.venue_id = p_venue and e.staff_id = p_staff and e.pay_month = v_month)
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
    'bonus_only',      v_only,
    'net_iqd',         v_salary - v_ded - v_pen + v_bon,
    'payment',         v_payment);
end $wage_line_0333$;

comment on function app.wage_line(uuid, uuid, date, date, int) is
  'wages (0271), reward bonuses (0333). Internal: one person''s pay month at a branch, {month, status (unset, none, upcoming, due, overdue, paid), salary_iqd, pay_day, rate_from, next_rate, due_date, days_left, deductions_iqd, deduction_count, penalties_iqd, penalty_days, bonuses_iqd, bonus_count, bonuses: [{id, earned_month, target, reward_iqd, prize}], bonus_only, net_iqd (salary - deductions - penalties + bonuses), payment}. A paid month answers from its payment snapshot; otherwise the rate in force, the approved deductions, the lateness penalties and the reward bonuses whose pay month it is. bonus_only: an unpaid month that carries a bonus for someone no longer active at the branch who placed no order and had no recorded day there in it; its salary_iqd is 0 (no salary for a month not worked), so the bonus is paid alone. bonuses lists the staff_reward_earnings rows paid in the month (prize-only ones included), by earned month and target. due is today within p_remind days of the pay day.';

revoke all on function app.wage_line(uuid, uuid, date, date, int) from public, anon, authenticated;
grant execute on function app.wage_line(uuid, uuid, date, date, int) to service_role;

-- ---------------------------------------------------------------------------
-- 5. app.wages_month — 0271 plus bonus totals and anyone a bonus lands on.
-- ---------------------------------------------------------------------------
create or replace function app.wages_month(
  p_venue_id uuid default null,
  p_month    date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $wages_month_0333$
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
                        where e.venue_id = v_venue and e.staff_id = s.id and e.pay_month = v_month))
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
end $wages_month_0333$;

comment on function app.wages_month(uuid, date) is
  'wages (0271), reward bonuses (0333). The owner at the branch: {month, current_month, today, remind_days, totals: {salary_iqd, deductions_iqd, penalties_iqd, bonuses_iqd, net_iqd, paid_iqd, people, paid, due, overdue, upcoming, unset}, people: [app.wage_line (with bonuses_iqd, bonus_count, bonuses, bonus_only) + {staff_id, display_name, role, is_active, member, waiting_count, deductions: [{id, amount_iqd, deduction_date, reason, decided_at}], lateness: [{id, work_date, late_minutes, early_leave_minutes, grace_minutes, penalty_iqd, note}]}]} for p_month (NULL: the branch''s current business month): everyone active at the branch but an owner, and anyone the month has a payment, approved deduction, recorded day or reward bonus for. FORBIDDEN for anyone else.';

revoke all on function app.wages_month(uuid, date) from public, anon;
grant execute on function app.wages_month(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.mark_wage_paid — 0271 plus the bonus snapshot.
-- ---------------------------------------------------------------------------
create or replace function app.mark_wage_paid(
  p_staff_id         uuid,
  p_month            date,
  p_expected_net_iqd bigint default null,
  p_venue_id         uuid default null,
  p_idempotency_key  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $mark_wage_paid_0333$
declare
  v_venue   uuid;
  v_replay  jsonb;
  v_today   date;
  v_current date;
  v_month   date;
  v_line    jsonb;
  v_net     bigint;
  v_id      uuid;
  v_result  jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'mark_wage_paid');
  if v_replay is not null then
    return v_replay;
  end if;

  v_today   := app.venue_business_date(v_venue);
  v_current := date_trunc('month', v_today)::date;
  v_month   := date_trunc('month', p_month)::date;
  if v_month is null or v_month > (v_current + interval '1 month')::date then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'month';
  end if;
  if p_staff_id is null or not exists (select 1 from staff s where s.id = p_staff_id and s.role <> 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'staff_id';
  end if;

  perform app.lock_wage(v_venue, p_staff_id);

  v_line := app.wage_line(v_venue, p_staff_id, v_month, v_today, 0);
  if v_line ->> 'status' = 'paid' then
    raise exception 'WAGE_ALREADY_PAID' using errcode = 'P0001';
  end if;
  -- No salary for the month (no rate, or a rate of 0): only a reward bonus
  -- can be paid, so a month with none is refused as before.
  if v_line ->> 'status' in ('unset', 'none')
     and coalesce((v_line ->> 'bonuses_iqd')::bigint, 0) = 0 then
    raise exception 'WAGE_NOT_SET' using errcode = 'P0001';
  end if;
  v_net := (v_line ->> 'net_iqd')::bigint;
  -- What the owner confirmed is what is recorded: a deduction, a day or a
  -- reward bonus that landed while the dialog was open sends them back to
  -- look again (the net includes all three).
  if p_expected_net_iqd is not null and p_expected_net_iqd <> v_net then
    raise exception 'WAGE_CHANGED' using errcode = 'P0001';
  end if;

  insert into wage_payments (venue_id, staff_id, pay_month, due_date, salary_iqd, deductions_iqd,
                             deduction_count, penalties_iqd, penalty_days, bonuses_iqd, bonus_count,
                             net_iqd, paid_iqd, status, paid_by)
  values (v_venue, p_staff_id, v_month,
          -- A month with no rate has no pay day: the bonus is due by its end.
          coalesce((v_line ->> 'due_date')::date, ((v_month + interval '1 month')::date - 1)),
          (v_line ->> 'salary_iqd')::bigint, (v_line ->> 'deductions_iqd')::bigint,
          (v_line ->> 'deduction_count')::int, (v_line ->> 'penalties_iqd')::bigint,
          (v_line ->> 'penalty_days')::int, (v_line ->> 'bonuses_iqd')::bigint,
          (v_line ->> 'bonus_count')::int, v_net, greatest(v_net, 0),
          'paid', auth.uid())
  on conflict (venue_id, staff_id, pay_month) do update
     set due_date        = excluded.due_date,
         salary_iqd      = excluded.salary_iqd,
         deductions_iqd  = excluded.deductions_iqd,
         deduction_count = excluded.deduction_count,
         penalties_iqd   = excluded.penalties_iqd,
         penalty_days    = excluded.penalty_days,
         bonuses_iqd     = excluded.bonuses_iqd,
         bonus_count     = excluded.bonus_count,
         net_iqd         = excluded.net_iqd,
         paid_iqd        = excluded.paid_iqd,
         status          = 'paid',
         paid_by         = excluded.paid_by,
         paid_at         = now(),
         undone_by       = null,
         undone_at       = null,
         undo_reason     = null
  returning id into v_id;

  perform app.write_audit('staff.wage.paid', 'wage_payment', v_id::text, null,
                          jsonb_build_object('status', 'paid'));

  v_result := jsonb_build_object('id', v_id, 'status', 'paid', 'pay_month', v_month,
                                 'net_iqd', v_net, 'paid_iqd', greatest(v_net, 0));
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $mark_wage_paid_0333$;

comment on function app.mark_wage_paid(uuid, date, bigint, uuid, text) is
  'wages (0271), reward bonuses (0333). The owner at the branch: marks a person''s pay month (at most next month) paid, recording app.wage_line''s figures as they stand: salary, approved deductions, lateness penalties, reward bonuses (bonuses_iqd, bonus_count), net, and the amount paid (the net, or 0 below zero; nothing carries over). The month is frozen from then on. p_expected_net_iqd, the net the owner confirmed (bonuses included), must still be the net. Returns {id, status: paid, pay_month, net_iqd, paid_iqd}. Idempotent by key. FORBIDDEN (hint staff_id), INVALID_ARGUMENT (hint month), WAGE_ALREADY_PAID, WAGE_NOT_SET (no salary for that month, or 0, and no reward bonus in it; a month with no salary but a bonus is paid for the bonus alone, due by the month''s last day when there is no pay day), WAGE_CHANGED. Audit staff.wage.paid {status}.';

revoke all on function app.mark_wage_paid(uuid, date, bigint, uuid, text) from public, anon;
grant execute on function app.mark_wage_paid(uuid, date, bigint, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.my_rewards — 0332 plus pay_month on last month's reached rewards.
-- ---------------------------------------------------------------------------
create or replace function app.my_rewards(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $my_rewards_0333$
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

  if exists (select 1 from staff_reward_earnings e
              where e.venue_id = v_venue and e.staff_id = v_me and e.earned_month = v_last) then
    -- The month is closed (app.reward_sweep): what was earned, frozen, and
    -- the wage month each bonus is added to.
    select coalesce(jsonb_agg(jsonb_build_object(
             'target',     e.target,
             'reward_iqd', e.reward_iqd,
             'prize',      e.prize,
             'pay_month',  e.pay_month)
             order by e.target, e.reward_id), '[]'::jsonb)
      into v_reached
      from staff_reward_earnings e
     where e.venue_id = v_venue and e.staff_id = v_me and e.earned_month = v_last;
  else
    -- Not closed yet: active at any moment of last month, and reached by last
    -- month's count; one per target, the one set last (as the sweep pays).
    select coalesce(jsonb_agg(jsonb_build_object(
             'target',     r.target,
             'reward_iqd', r.reward_iqd,
             'prize',      r.prize,
             'pay_month',  null)
             order by r.target, r.id), '[]'::jsonb)
      into v_reached
      from (select distinct on (x.target) x.*
              from staff_rewards x
             where x.venue_id = v_venue and x.staff_id = v_me
               and x.set_at < v_ts_from
               and (x.ended_at is null or x.ended_at >= v_ts_last)
               and x.target <= v_last_n
             order by x.target, x.set_at desc, x.id desc) r;
  end if;

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
end $my_rewards_0333$;

comment on function app.my_rewards(uuid) is
  'staff rewards (0332), reward wages (0333). Any active staff member at the branch, about themselves only: {month, month_end, days_left (today included), count (their orders placed at the branch this business month, voided ones excluded), rewards: [{id, target, reward_iqd, prize}] (active, by target), last_month: {month, count, reached: [{target, reward_iqd, prize, pay_month}]}}. reached: once app.reward_sweep closed last month, the staff_reward_earnings rows (frozen, pay_month = the wage month the bonus is added to); before that, the rewards active at any moment of last month whose target is at most last month''s count (one per target, the one set last, as app.reward_sweep pays), pay_month NULL. By target. Never another person''s data. FORBIDDEN for anyone else.';

revoke all on function app.my_rewards(uuid) from public, anon;
grant execute on function app.my_rewards(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.notify_staff — 0323 verbatim, plus reward_unlocked after
--    checklist_overdue and the route staff-rewards after staff-notes.
-- ---------------------------------------------------------------------------
create or replace function app.notify_staff(
  p_staff_ids uuid[],
  p_kind      text,
  p_payload   jsonb,
  p_dedupe    text default null
) returns int
language plpgsql security definer set search_path = public as $notify_staff_0333$
declare
  c_kinds      constant text[] := array['staff_task', 'staff_decide', 'staff_decided', 'staff_info'];
  c_title_keys constant text[] := array[
    'step_open', 'step_submitted', 'step_approved', 'step_sent_back', 'step_stopped',
    'run_stopped', 'run_live', 'launch_not_ready', 'apply_not_ready', 'review_ready',
    'request_submitted', 'request_approved', 'request_rejected', 'shopping_new',
    'purchase_to_receive', 'idea_submitted', 'idea_started', 'idea_declined',
    'teaching_new', 'recipe_change_submitted', 'recipe_change_approved',
    'recipe_change_declined', 'shopping_to_approve', 'shopping_declined',
    'marketing_request_new', 'marketing_request_answered', 'deduction_proposed',
    'deduction_approved', 'deduction_declined', 'deduction_recorded',
    'incident_reported', 'incident_reviewed', 'content_submitted', 'content_approved',
    'content_changes', 'content_declined', 'waiter_call_new', 'match_report_new',
    'loyalty_gift', 'screenshot_taken', 'shop_price_changed', 'checklist_due',
    'checklist_overdue', 'reward_unlocked'];
  c_routes     constant text[] := array[
    'staff', 'staff-step', 'staff-run', 'staff-request', 'staff-shopping',
    'staff-checklist', 'staff-notes', 'staff-rewards'];
  v_payload jsonb;
  v_dedupe  text := nullif(btrim(p_dedupe), '');
  v_count   int;
begin
  if p_kind is null or not (p_kind = any(c_kinds)) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'payload';
  end if;
  if not coalesce(p_payload->>'title_key' = any(c_title_keys), false) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'title_key';
  end if;
  if not coalesce(p_payload->>'route' = any(c_routes), false) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'route';
  end if;
  -- The shape is closed, so no caller can put money, a phone number or a
  -- candidate name on a lock screen by adding a key.
  if exists (select 1 from jsonb_object_keys(p_payload) k
              where k not in ('route', 'id', 'title_key', 'params', 'dedupe')) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'payload';
  end if;
  if p_payload ? 'params' and p_payload->'params' <> 'null'::jsonb then
    if jsonb_typeof(p_payload->'params') <> 'object'
       or exists (select 1 from jsonb_object_keys(p_payload->'params') k
                   where k not in ('step', 'title', 'name')) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'params';
    end if;
  end if;

  v_payload := (p_payload - 'dedupe')
            || case when v_dedupe is null then '{}'::jsonb
                    else jsonb_build_object('dedupe', v_dedupe) end;

  insert into notification_outbox (profile_id, kind, payload)
  select s.id, p_kind, v_payload
    from staff s
    join profiles p on p.id = s.id
   where s.id = any(coalesce(p_staff_ids, '{}'::uuid[]))
     and s.is_active
     and s.id is distinct from auth.uid()
     and (v_dedupe is null
          or not exists (select 1 from notification_outbox o
                          where o.profile_id = s.id
                            and o.payload->>'dedupe' = v_dedupe
                            and o.created_at > now() - interval '15 minutes'));
  get diagnostics v_count = row_count;

  perform app.push_nudge();
  return v_count;
end $notify_staff_0333$;

comment on function app.notify_staff(uuid[], text, jsonb, text) is
  'staff_push (§2.4, §2.21), re-issued by staff_push_keys (§2.24.1), staff_push_keys_wave5, match_guest_rpcs (0261, match_report_new), loyalty_earn_redeem (0308, loyalty_gift), staff_screenshot_report (0313, screenshot_taken), shop_price_watch (0322, shop_price_changed), checklist_schedules (0323, checklist_due and checklist_overdue) and reward_wages (0333, reward_unlocked and the route staff-rewards). Internal: queues one notification_outbox row per recipient (profile_id = staff.id) and nudges send-push. Skips NULLs, inactive staff and the caller; with p_dedupe, a recipient who got the same dedupe value in the last 15 minutes. INVALID_ARGUMENT for a kind, title_key or route outside _shared/staff-push.json, or a payload key outside {route, id, title_key, params, dedupe} / params key outside {step, title, name}. Returns the rows queued.';

revoke all on function app.notify_staff(uuid[], text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.reward_sweep — internal, cron tp_reward_sweep: the unlock pushes and
--    the bonuses of the month that just ended.
-- ---------------------------------------------------------------------------
create or replace function app.reward_sweep()
returns jsonb
language plpgsql security definer set search_path = public as $reward_sweep_0333$
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
    end;
  end loop;

  return jsonb_build_object('pushes', v_pushes, 'unlocks', v_unlocks, 'earnings', v_earnings);
end $reward_sweep_0333$;

comment on function app.reward_sweep() is
  'reward wages (0333). Internal, service role (cron tp_reward_sweep, every five minutes). For every branch with a reward, in its own exception block with app.venue_id set: (1) at a branch that is not closed, every active reward whose person (still active at the branch) placed at least its target of orders this business month (voided ones excluded) and no reward of theirs at that target has a staff_reward_unlocks row for the month gets one, and one reward_unlocked staff_info push to that person only (route staff-rewards; no amount, prize, name or id), once per person, target and month; (2) for every ended business month not closed yet (after the last month with an earning at the branch, from the month of its first reward, at most twelve back, oldest first), and only once the new month''s first business day has passed, every reward active at any moment of it whose target that month''s final count reached becomes a staff_reward_earnings row, one per person and target (the reward set last), with target, reward_iqd and prize copied and pay_month = app.wage_open_month from the month after, under app.lock_wage, idempotent by (person, target, month). Returns {pushes, unlocks, earnings}.';

revoke all on function app.reward_sweep() from public, anon, authenticated;
grant execute on function app.reward_sweep() to service_role;

-- tp_reward_sweep: every five minutes, its own transaction. Guarded like
-- 0323's tp_checklist_sweep. After a hosted push, cron.job must have the row
-- (packages/db/CLAUDE.md).
do $reward_sweep_cron_0333$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_reward_sweep not scheduled';
    return;
  end if;
  perform cron.schedule('tp_reward_sweep', '*/5 * * * *', 'select app.reward_sweep();');
end $reward_sweep_cron_0333$;
