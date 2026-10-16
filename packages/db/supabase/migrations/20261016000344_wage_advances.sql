-- 0344 wage_advances — part of a wage handed over before pay day, and where
-- the money for a wage, an advance or a coach's pay came from.
--
-- Feature: main cash (0343) and wages (0270–0272, 0333). Majed 2026-10-16:
-- "for the salaries make it that we pay someone in advance and that will auto
-- calculate how much money we still owe him at the end of the month"; and,
-- asked, "when wages or coach pay are marked paid, take the money out of the
-- safe: ask 'Paid from', Safe preselected".
-- Depends on: main_cash (0343: app.main_cash_record_payment,
-- app.main_cash_void_source), reward_wages (0333: wage_line, wages_month,
-- mark_wage_paid), wages_rpcs (0271: undo_wage_paid), coach_statements_fixes
-- (0293: coach_statement_mark_paid).
-- Re-runnable: create … if not exists, add column if not exists, guarded
-- constraint swaps, drop function if exists + create or replace.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on a new, empty table
--
-- AN ADVANCE belongs to one person's pay month at one branch, like a
-- deduction. app.wage_line sums the month's advances (advances_iqd) and
-- answers what is still owed (owed_iqd = net - advances, signed) and what Mark
-- paid hands over (to_pay_iqd = owed, or 0 below it). An advance is given
-- only while its month is open and at most up to what is still owed then
-- (WAGE_ADVANCE_TOO_LARGE); a deduction approved later can still take the
-- owed amount below zero, and then Mark paid hands over 0 (nothing carries
-- over, as before). Paying the month freezes its advances (snapshot on
-- wage_payments.advances_iqd / advance_count); undoing an advance needs the
-- month open again.
--
-- PAID FROM. mark_wage_paid, give_wage_advance and coach_statement_mark_paid
-- take p_paid_from (safe | bank) and record the payment in the main cash
-- (source wage, wage_advance, coach_pay); undo_wage_paid and
-- undo_wage_advance take it back. NULL (an operator build from before 0344)
-- records nothing, as before. mark_wage_paid and coach_statement_mark_paid
-- gain parameters, so their old signatures are dropped and the grants
-- re-issued; PostgREST still finds the new ones for a call without them.
--
-- THE LLM WALL (as 0270). wage_advances is money about a named person: owner
-- only, never readable by the owner assistant or any LLM; audit rows carry
-- {status} only.
--
-- covered by packages/db/tests/main-cash.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. wage_advances.
-- ---------------------------------------------------------------------------
create table if not exists wage_advances (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null references venues(id),
  staff_id     uuid not null references staff(id),
  pay_month    date not null,
  amount_iqd   iqd not null,
  paid_from    text not null,
  note         text,
  status       text not null default 'given',
  given_by     uuid not null references staff(id),
  given_at     timestamptz not null default now(),
  undone_by    uuid references staff(id),
  undone_at    timestamptz,
  undo_reason  text,
  constraint wage_advances_month_first_chk check (pay_month = date_trunc('month', pay_month)::date),
  constraint wage_advances_amount_chk check (amount_iqd between 1 and 100000000),
  constraint wage_advances_paid_from_chk check (paid_from in ('safe','bank')),
  constraint wage_advances_status_chk check (status in ('given','undone')),
  constraint wage_advances_undone_chk
    check ((status = 'undone') = (undone_by is not null)
           and (undone_by is null) = (undone_at is null)
           and (undone_by is null) = (undo_reason is null)),
  constraint wage_advances_text_chk
    check (coalesce(length(note), 0) <= 300 and coalesce(length(undo_reason), 0) <= 1000)
);

create index if not exists wage_advances_month on wage_advances (venue_id, staff_id, pay_month);

comment on table wage_advances is
  'wage_advances (0344): part of a person''s wage handed over before pay day, counted against one pay month at one branch; app.wage_line takes the month''s given advances off what Mark paid hands over. Written by app.give_wage_advance / app.undo_wage_advance; read by the owner only. Never readable by the owner assistant or any LLM.';
comment on column wage_advances.pay_month is 'The pay month the advance comes off (first of the month).';
comment on column wage_advances.amount_iqd is 'The cash or transfer handed over, IQD (1 to 100,000,000).';
comment on column wage_advances.paid_from is 'safe (the main cash paid it) or bank (a transfer).';
comment on column wage_advances.note is 'An optional note (at most 300 characters). Never readable by the owner assistant.';
comment on column wage_advances.status is 'given, or undone (logged in error; counts for nothing).';

alter table wage_advances enable row level security;

drop policy if exists wage_advances_owner_read on wage_advances;
create policy wage_advances_owner_read on wage_advances
  for select to authenticated
  using ((select app.is_staff('owner'))
         and venue_id = any((select app.visible_venue_ids())::uuid[]));

grant select on wage_advances to authenticated;
grant all on wage_advances to service_role;

drop trigger if exists zz_branch_guard on public.wage_advances;
create trigger zz_branch_guard before insert or update or delete on public.wage_advances
  for each row execute function app.trg_branch_guard('scoped');

-- ---------------------------------------------------------------------------
-- 2. wage_payments — the advances snapshot and where the money came from.
-- ---------------------------------------------------------------------------
alter table wage_payments add column if not exists advances_iqd iqd not null default 0;
alter table wage_payments add column if not exists advance_count int not null default 0;
alter table wage_payments add column if not exists paid_from text;

comment on column wage_payments.advances_iqd is 'Snapshot (0344): the advances given against the month, already handed over.';
comment on column wage_payments.advance_count is 'Snapshot (0344): how many advances.';
comment on column wage_payments.paid_from is 'safe or bank (0344): where the money handed over at Mark paid came from; null before 0344 or from an older operator.';
comment on column wage_payments.paid_iqd is 'What Mark paid handed over: the net minus the advances, or 0 below zero (0344).';

-- The paid CHECK gains the advances. Every existing row has advances_iqd 0,
-- so validation cannot fail; the swap runs once (the new definition names
-- advances_iqd).
do $wage_payments_paid_chk_0344$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'wage_payments_paid_chk'
                    and conrelid = 'public.wage_payments'::regclass
                    and pg_get_constraintdef(oid) like '%advances_iqd%') then
    alter table wage_payments drop constraint if exists wage_payments_paid_chk;
    alter table wage_payments add constraint wage_payments_paid_chk
      check (paid_iqd = greatest(net_iqd - advances_iqd, 0)) not valid;
  end if;
end $wage_payments_paid_chk_0344$;

do $wage_payments_paid_chk_validate_0344$
begin
  if exists (select 1 from pg_constraint
              where conname = 'wage_payments_paid_chk'
                and conrelid = 'public.wage_payments'::regclass
                and not convalidated) then
    alter table wage_payments validate constraint wage_payments_paid_chk;
  end if;
end $wage_payments_paid_chk_validate_0344$;

do $wage_payments_adv_chk_0344$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'wage_payments_advances_chk'
                    and conrelid = 'public.wage_payments'::regclass) then
    alter table wage_payments add constraint wage_payments_advances_chk
      check (advance_count >= 0 and (paid_from is null or paid_from in ('safe','bank'))) not valid;
  end if;
end $wage_payments_adv_chk_0344$;

do $wage_payments_adv_chk_validate_0344$
begin
  if exists (select 1 from pg_constraint
              where conname = 'wage_payments_advances_chk'
                and conrelid = 'public.wage_payments'::regclass
                and not convalidated) then
    alter table wage_payments validate constraint wage_payments_advances_chk;
  end if;
end $wage_payments_adv_chk_validate_0344$;

-- ---------------------------------------------------------------------------
-- 3. app.wage_line — 0333 plus the month's advances, what is still owed
--    (owed_iqd) and what Mark paid hands over (to_pay_iqd).
-- ---------------------------------------------------------------------------
create or replace function app.wage_line(
  p_venue  uuid,
  p_staff  uuid,
  p_month  date,
  p_today  date,
  p_remind int
) returns jsonb
language plpgsql stable security definer set search_path = public as $wage_line_0344$
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
    'bonus_only',      v_only,
    'net_iqd',         v_salary - v_ded - v_pen + v_bon,
    'advances_iqd',    v_adv,
    'advance_count',   v_adv_n,
    'advances',        v_advances,
    'owed_iqd',        case when v_paid then 0 else v_salary - v_ded - v_pen + v_bon - v_adv end,
    'to_pay_iqd',      case when v_paid then 0 else greatest(v_salary - v_ded - v_pen + v_bon - v_adv, 0) end,
    'payment',         v_payment);
end $wage_line_0344$;

comment on function app.wage_line(uuid, uuid, date, date, int) is
  'wages (0271), reward bonuses (0333), advances (0344). Internal: one person''s pay month at a branch, {month, status (unset, none, upcoming, due, overdue, paid), salary_iqd, pay_day, rate_from, next_rate, due_date, days_left, deductions_iqd, deduction_count, penalties_iqd, penalty_days, bonuses_iqd, bonus_count, bonuses: [{id, earned_month, target, reward_iqd, prize}], bonus_only, net_iqd (salary - deductions - penalties + bonuses), advances_iqd, advance_count, advances: [{id, amount_iqd, paid_from, note, given_at, given_by_name}], owed_iqd (net - advances, signed; 0 once paid), to_pay_iqd (owed, or 0 below zero; 0 once paid), payment (+ advances_iqd, paid_from)}. A paid month answers from its payment snapshot; otherwise the rate in force, the approved deductions, the lateness penalties, the reward bonuses and the given advances whose pay month it is. bonus_only: an unpaid month that carries a bonus for someone no longer active at the branch who placed no order and had no recorded day there in it; its salary_iqd is 0 (no salary for a month not worked), so the bonus is paid alone. due is today within p_remind days of the pay day.';

revoke all on function app.wage_line(uuid, uuid, date, date, int) from public, anon, authenticated;
grant execute on function app.wage_line(uuid, uuid, date, date, int) to service_role;

-- ---------------------------------------------------------------------------
-- 4. app.wages_month — 0333 plus advance totals and anyone given one.
-- ---------------------------------------------------------------------------
create or replace function app.wages_month(
  p_venue_id uuid default null,
  p_month    date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $wages_month_0344$
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
end $wages_month_0344$;

comment on function app.wages_month(uuid, date) is
  'wages (0271), reward bonuses (0333), advances (0344). The owner at the branch: {month, current_month, today, remind_days, totals: {salary_iqd, deductions_iqd, penalties_iqd, bonuses_iqd, net_iqd, advances_iqd, to_pay_iqd, paid_iqd, people, paid, due, overdue, upcoming, unset}, people: [app.wage_line (with bonuses, advances, owed_iqd, to_pay_iqd) + {staff_id, display_name, role, is_active, member, waiting_count, deductions: [{id, amount_iqd, deduction_date, reason, decided_at}], lateness: [{id, work_date, late_minutes, early_leave_minutes, grace_minutes, penalty_iqd, note}]}]} for p_month (NULL: the branch''s current business month): everyone active at the branch but an owner, and anyone the month has a payment, approved deduction, recorded day, reward bonus or given advance for. FORBIDDEN for anyone else.';

revoke all on function app.wages_month(uuid, date) from public, anon;
grant execute on function app.wages_month(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.mark_wage_paid — 0333 plus the advances and where the money came
--    from. New parameters: the old signature is dropped.
-- ---------------------------------------------------------------------------
drop function if exists app.mark_wage_paid(uuid, date, bigint, uuid, text);

create or replace function app.mark_wage_paid(
  p_staff_id         uuid,
  p_month            date,
  p_expected_net_iqd bigint default null,
  p_venue_id         uuid default null,
  p_idempotency_key  text default null,
  p_paid_from        text default null,
  p_expected_paid_iqd bigint default null
) returns jsonb
language plpgsql security definer set search_path = public as $mark_wage_paid_0344$
declare
  v_venue   uuid;
  v_replay  jsonb;
  v_today   date;
  v_current date;
  v_month   date;
  v_line    jsonb;
  v_net     bigint;
  v_adv     bigint;
  v_paid    bigint;
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

  -- 0344: where the money came from; null is an older client that did not ask.
  if p_paid_from is not null and p_paid_from not in ('safe', 'bank') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'paid_from';
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
  -- 0344: the advances already handed over come off what is paid now, and
  -- the amount the owner confirmed handing over must still be it.
  v_adv  := coalesce((v_line ->> 'advances_iqd')::bigint, 0);
  v_paid := greatest(v_net - v_adv, 0);
  if p_expected_paid_iqd is not null and p_expected_paid_iqd <> v_paid then
    raise exception 'WAGE_CHANGED' using errcode = 'P0001';
  end if;

  insert into wage_payments (venue_id, staff_id, pay_month, due_date, salary_iqd, deductions_iqd,
                             deduction_count, penalties_iqd, penalty_days, bonuses_iqd, bonus_count,
                             net_iqd, advances_iqd, advance_count, paid_iqd, paid_from, status, paid_by)
  values (v_venue, p_staff_id, v_month,
          -- A month with no rate has no pay day: the bonus is due by its end.
          coalesce((v_line ->> 'due_date')::date, ((v_month + interval '1 month')::date - 1)),
          (v_line ->> 'salary_iqd')::bigint, (v_line ->> 'deductions_iqd')::bigint,
          (v_line ->> 'deduction_count')::int, (v_line ->> 'penalties_iqd')::bigint,
          (v_line ->> 'penalty_days')::int, (v_line ->> 'bonuses_iqd')::bigint,
          (v_line ->> 'bonus_count')::int, v_net, v_adv, (v_line ->> 'advance_count')::int,
          v_paid, p_paid_from, 'paid', auth.uid())
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
         advances_iqd    = excluded.advances_iqd,
         advance_count   = excluded.advance_count,
         paid_iqd        = excluded.paid_iqd,
         paid_from       = excluded.paid_from,
         status          = 'paid',
         paid_by         = excluded.paid_by,
         paid_at         = now(),
         undone_by       = null,
         undone_at       = null,
         undo_reason     = null
  returning id into v_id;

  -- 0344: the safe (or the bank) pays what is handed over now.
  perform app.main_cash_record_payment(v_venue, v_paid, 'wages',
                                       (select s.display_name from staff s where s.id = p_staff_id),
                                       p_paid_from, 'wage', v_id);

  perform app.write_audit('staff.wage.paid', 'wage_payment', v_id::text, null,
                          jsonb_build_object('status', 'paid'));

  v_result := jsonb_build_object('id', v_id, 'status', 'paid', 'pay_month', v_month,
                                 'net_iqd', v_net, 'advances_iqd', v_adv, 'paid_iqd', v_paid,
                                 'paid_from', p_paid_from);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $mark_wage_paid_0344$;

comment on function app.mark_wage_paid(uuid, date, bigint, uuid, text, text, bigint) is
  'wages (0271), reward bonuses (0333), advances and paid from (0344). The owner at the branch: marks a person''s pay month (at most next month) paid, recording app.wage_line''s figures as they stand: salary, approved deductions, lateness penalties, reward bonuses (bonuses_iqd, bonus_count), net, the advances already given (advances_iqd, advance_count), and the amount handed over now (paid_iqd: the net minus the advances, or 0 below zero; nothing carries over). The month is frozen from then on. p_expected_net_iqd, the net the owner confirmed (bonuses included), must still be the net; p_expected_paid_iqd, the amount they confirmed handing over, must still be it. p_paid_from (safe | bank) records the amount handed over in the main cash (source wage); NULL records nothing (an older operator). Returns {id, status: paid, pay_month, net_iqd, advances_iqd, paid_iqd, paid_from}. Idempotent by key. FORBIDDEN (hint staff_id), INVALID_ARGUMENT (hint month, paid_from), WAGE_ALREADY_PAID, WAGE_NOT_SET (no salary for that month, or 0, and no reward bonus in it; a month with no salary but a bonus is paid for the bonus alone, due by the month''s last day when there is no pay day), WAGE_CHANGED. Audit staff.wage.paid {status}.';

revoke all on function app.mark_wage_paid(uuid, date, bigint, uuid, text, text, bigint) from public, anon;
grant execute on function app.mark_wage_paid(uuid, date, bigint, uuid, text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 6a. app.undo_wage_paid — 0271 plus the main cash payment taken back.
-- ---------------------------------------------------------------------------
create or replace function app.undo_wage_paid(p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $undo_wage_paid_0344$
declare
  v_venue  uuid;
  v_staff  uuid;
  v_row    wage_payments%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select p.venue_id, p.staff_id into v_venue, v_staff from wage_payments p where p.id = p_id;
  if not found or not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff_at(v_venue, 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  -- The person's lock before the row's, as every pay write takes them.
  perform app.lock_wage(v_venue, v_staff);
  select * into v_row from wage_payments where id = p_id for update;
  if v_row.status <> 'paid' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'reason';
  end if;

  update wage_payments
     set status = 'undone', undone_by = auth.uid(), undone_at = now(), undo_reason = v_reason
   where id = p_id
   returning * into v_row;

  -- 0344: the money it paid goes back where it came from.
  perform app.main_cash_void_source('wage', p_id, 'Wage payment undone: ' || v_reason);

  perform app.write_audit('staff.wage.undo', 'wage_payment', p_id::text,
                          jsonb_build_object('status', 'paid'),
                          jsonb_build_object('status', 'undone'));
  return jsonb_build_object('status', 'undone', 'undone_at', v_row.undone_at);
end $undo_wage_paid_0344$;

comment on function app.undo_wage_paid(uuid, text) is
  'wages (0271), main cash (0344). The owner takes back a payment marked in error, with a reason (1 to 1000): the month is open again and adds up afresh (its advances stand); a day or deduction that landed in a later month while it was paid stays there; the main cash payment it recorded is voided. Returns {status: undone, undone_at}. REF_NOT_FOUND (hint id), FORBIDDEN, INVALID_TRANSITION (not paid), REASON_REQUIRED, TEXT_TOO_LONG (hint reason). Audit staff.wage.undo {status}.';

revoke all on function app.undo_wage_paid(uuid, text) from public, anon;
grant execute on function app.undo_wage_paid(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6b. app.coach_statement_mark_paid — 0293 plus where the money came from.
--     A new parameter: the old signature is dropped.
-- ---------------------------------------------------------------------------
drop function if exists app.coach_statement_mark_paid(uuid, text, text, text);

create or replace function app.coach_statement_mark_paid(
  p_statement_id uuid,
  p_reference    text,
  p_pin          text,
  p_device_id    text default null,
  p_paid_from    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $coach_statement_mark_paid_0344$
declare
  v_s    coach_statements%rowtype;
  v_rail uuid;
  v_ref  text;
  v_auth uuid;
  v_at   timestamptz := now();
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0344: where the money came from; null is an older client that did not ask.
  if p_paid_from is not null and p_paid_from not in ('safe', 'bank') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_paid_from';
  end if;
  v_ref := btrim(app.safe_line(p_reference));
  if v_ref is null or v_ref = '' or char_length(v_ref) > 80 then
    raise exception 'STATEMENT_REFERENCE_REQUIRED' using errcode = 'P0001';
  end if;
  -- R49, R74 (amended, DB-21): a receipt or transfer number, never a card or
  -- account number, whatever its digits or separators.
  if app.looks_like_card(v_ref) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reference', hint = 'digits';
  end if;

  select * into v_s from coach_statements where id = p_statement_id;
  if not found or not (v_s.venue_id = any ((select app.visible_venue_ids())::uuid[])) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_statement_id';
  end if;
  begin
    v_rail := app.current_venue();
  exception when sqlstate 'P0001' then
    v_rail := null;
  end;
  if v_rail is distinct from v_s.venue_id or not app.is_staff_at(v_s.venue_id, 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_s.venue_id::text, true);
  if exists (select 1 from coaches c where c.id = v_s.coach_id and c.profile_id = auth.uid()) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'own_statement';
  end if;

  -- Answered before any grant is spent.
  if v_s.status = 'paid' then
    return jsonb_build_object('duplicate', true, 'statement_id', v_s.id, 'status', 'paid',
                              'paid_at', v_s.paid_at, 'paid_reference', v_s.paid_reference,
                              'total_iqd', v_s.coach_iqd + v_s.adjustments_iqd);
  end if;
  if v_s.status <> 'approved' then
    raise exception 'STATEMENT_NOT_APPROVED' using errcode = 'P0001', detail = v_s.status;
  end if;
  -- R59: a negative month is voided and carried forward, never "paid".
  if v_s.coach_iqd + v_s.adjustments_iqd < 0 then
    raise exception 'STATEMENT_NOT_APPROVED' using errcode = 'P0001', detail = 'negative';
  end if;

  -- [pin grant] -> coach_advisory (money.md §9). 0115: p_pin is never read.
  v_auth := app.consume_pin_grant(p_device_id);
  -- CM-11 (amended, DB-22): the coach's own PIN never authorises their
  -- statement. The raise rolls back, so the grant is not spent.
  if v_auth = (select c.profile_id from coaches c where c.id = v_s.coach_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', detail = 'own_statement_pin';
  end if;

  perform app.lock_coach(v_s.coach_id);
  select * into v_s from coach_statements where id = p_statement_id;
  if v_s.status = 'paid' then
    return jsonb_build_object('duplicate', true, 'statement_id', v_s.id, 'status', 'paid',
                              'paid_at', v_s.paid_at, 'paid_reference', v_s.paid_reference,
                              'total_iqd', v_s.coach_iqd + v_s.adjustments_iqd);
  end if;
  if v_s.status <> 'approved' then
    raise exception 'STATEMENT_NOT_APPROVED' using errcode = 'P0001', detail = v_s.status;
  end if;

  update coach_statements
     set status = 'paid', paid_by = auth.uid(), paid_at = v_at, paid_reference = v_ref
   where id = v_s.id and status = 'approved';

  -- 0344: the safe (or the bank) pays the coach.
  perform app.main_cash_record_payment(v_s.venue_id, v_s.coach_iqd + v_s.adjustments_iqd, 'coach_pay',
                                       (select coalesce(nullif(c.display_name_en, ''), c.display_name_ar)
                                          from coaches c where c.id = v_s.coach_id),
                                       p_paid_from, 'coach_pay', v_s.id);

  -- C-28: no amount and no reference in the audit row (both are on the
  -- statement, which no LLM reads).
  perform app.write_audit('coach.statement_paid', 'coach_statements', v_s.id::text,
                          jsonb_build_object('status', 'approved'),
                          jsonb_build_object('statement_id', v_s.id, 'coach_id', v_s.coach_id,
                                             'month', v_s.month, 'status', 'paid'),
                          null, v_auth, p_device_id);

  -- R40: Money's other direct push call. Never fails the write.
  begin
    perform app.lesson_notify(v_s.id, 'coach.statement_paid',
                              'l:' || v_s.id::text || ':coach.statement_paid', '{}'::jsonb);
  exception when others then
    raise warning 'coach_statement_mark_paid: push left out: % (%)', sqlerrm, sqlstate;
  end;

  return jsonb_build_object('duplicate', false, 'statement_id', v_s.id, 'status', 'paid',
                            'paid_at', v_at, 'total_iqd', v_s.coach_iqd + v_s.adjustments_iqd);
end $coach_statement_mark_paid_0344$;

comment on function app.coach_statement_mark_paid(uuid, text, text, text, text) is
  '0287, 0293, 0344 (money.md §7.4; C-12, CM-11, R4, R49, R59, R74). Manager or owner at the statement''s branch, the rail''s (R21), never their own (CM-11), with a manager PIN grant that is not the statement''s coach''s own (0293, DB-22) (p_pin is never read: the transports prove it to verify_manager_pin first, 0115). An approved statement whose total (coach_iqd + adjustments_iqd) is not negative becomes paid with p_reference (a receipt or transfer number, 1..80, never card-like: app.looks_like_card, 0293). The money is handed over outside the till: no payments, refunds or booking_payments row; p_paid_from (safe | bank, 0344) records it in the main cash (source coach_pay), NULL records nothing (an older operator). Audit coach.statement_paid {statement_id, coach_id, month, status} with the authorising manager (no amount, no reference, C-28); the coach is told coach.statement_paid. Already paid answers {duplicate: true, paid_reference} before any grant is spent. Returns {duplicate, statement_id, status: paid, paid_at, total_iqd}. FORBIDDEN (detail own_statement; own_statement_pin, the grant left unspent), STATEMENT_REFERENCE_REQUIRED, INVALID_ARGUMENT (p_reference hint digits; p_statement_id; p_paid_from), VENUE_MISMATCH, STATEMENT_NOT_APPROVED (detail the status, or negative), PIN_GRANT_REQUIRED.';

revoke all on function app.coach_statement_mark_paid(uuid, text, text, text, text) from public, anon;
grant execute on function app.coach_statement_mark_paid(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.give_wage_advance — the owner hands over part of a wage early.
-- ---------------------------------------------------------------------------
create or replace function app.give_wage_advance(
  p_staff_id        uuid,
  p_amount_iqd      bigint,
  p_paid_from       text,
  p_month           date default null,
  p_note            text default null,
  p_venue_id        uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $give_wage_advance_0344$
declare
  v_venue   uuid;
  v_replay  jsonb;
  v_today   date;
  v_current date;
  v_month   date;
  v_note    text := nullif(btrim(coalesce(app.safe_line(p_note), '')), '');
  v_line    jsonb;
  v_owed    bigint;
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

  v_replay := app.claim_replay(p_idempotency_key, 'give_wage_advance');
  if v_replay is not null then
    return v_replay;
  end if;

  v_today   := app.venue_business_date(v_venue);
  v_current := date_trunc('month', v_today)::date;
  v_month   := coalesce(date_trunc('month', p_month)::date, v_current);
  if v_month < (v_current - interval '1 month')::date or v_month > (v_current + interval '1 month')::date then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'month';
  end if;
  if p_staff_id is null or not exists (select 1 from staff s where s.id = p_staff_id and s.role <> 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'staff_id';
  end if;
  if p_amount_iqd is null or p_amount_iqd < 1 or p_amount_iqd > 100000000 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'amount';
  end if;
  if p_paid_from is null or p_paid_from not in ('safe', 'bank') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'paid_from';
  end if;
  if length(v_note) > 300 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;

  perform app.lock_wage(v_venue, p_staff_id);

  v_line := app.wage_line(v_venue, p_staff_id, v_month, v_today, 0);
  if v_line ->> 'status' = 'paid' then
    raise exception 'WAGE_ALREADY_PAID' using errcode = 'P0001';
  end if;
  if v_line ->> 'status' in ('unset', 'none') then
    raise exception 'WAGE_NOT_SET' using errcode = 'P0001';
  end if;
  -- At most what is still owed for the month as it stands.
  v_owed := (v_line ->> 'owed_iqd')::bigint;
  if p_amount_iqd > v_owed then
    raise exception 'WAGE_ADVANCE_TOO_LARGE' using errcode = 'P0001', hint = greatest(v_owed, 0)::text;
  end if;

  insert into wage_advances (venue_id, staff_id, pay_month, amount_iqd, paid_from, note, given_by)
  values (v_venue, p_staff_id, v_month, p_amount_iqd, p_paid_from, v_note, auth.uid())
  returning id into v_id;

  perform app.main_cash_record_payment(v_venue, p_amount_iqd, 'advance',
                                       (select s.display_name from staff s where s.id = p_staff_id),
                                       p_paid_from, 'wage_advance', v_id);

  perform app.write_audit('staff.wage.advance', 'wage_advance', v_id::text, null,
                          jsonb_build_object('status', 'given'));

  v_result := jsonb_build_object('id', v_id, 'status', 'given', 'pay_month', v_month,
                                 'owed_iqd', v_owed - p_amount_iqd);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $give_wage_advance_0344$;

comment on function app.give_wage_advance(uuid, bigint, text, date, text, uuid, text) is
  'wage advances (0344). The owner at the branch hands a person part of a pay month''s wage early: p_amount_iqd (1 to 100,000,000, at most what is still owed for the month: net minus the advances already given), p_paid_from (safe: recorded in the main cash and the balance drops; bank: listed with the costs), p_month (NULL: the current business month; last month to next month), p_note optional (at most 300). Mark paid then hands over the rest. Returns {id, status: given, pay_month, owed_iqd (still owed after it)}. Idempotent by key. FORBIDDEN (hint staff_id), INVALID_ARGUMENT (hint month, amount, paid_from), TEXT_TOO_LONG (hint note), WAGE_ALREADY_PAID, WAGE_NOT_SET, WAGE_ADVANCE_TOO_LARGE (hint the most that may be given). Audit staff.wage.advance {status}.';
revoke all on function app.give_wage_advance(uuid, bigint, text, date, text, uuid, text) from public, anon;
grant execute on function app.give_wage_advance(uuid, bigint, text, date, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.undo_wage_advance — take back an advance logged in error.
-- ---------------------------------------------------------------------------
create or replace function app.undo_wage_advance(p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $undo_wage_advance_0344$
declare
  v_venue  uuid;
  v_staff  uuid;
  v_row    wage_advances%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select a.venue_id, a.staff_id into v_venue, v_staff from wage_advances a where a.id = p_id;
  if not found or not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff_at(v_venue, 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  perform app.lock_wage(v_venue, v_staff);
  select * into v_row from wage_advances where id = p_id for update;
  if v_row.status <> 'given' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'reason';
  end if;
  -- A paid month is frozen: undo its payment first.
  if exists (select 1 from wage_payments p
              where p.venue_id = v_venue and p.staff_id = v_staff
                and p.pay_month = v_row.pay_month and p.status = 'paid') then
    raise exception 'WAGE_ALREADY_PAID' using errcode = 'P0001';
  end if;

  update wage_advances
     set status = 'undone', undone_by = auth.uid(), undone_at = now(), undo_reason = v_reason
   where id = p_id
   returning * into v_row;

  perform app.main_cash_void_source('wage_advance', p_id, 'Advance undone: ' || v_reason);

  perform app.write_audit('staff.wage.advance_undo', 'wage_advance', p_id::text,
                          jsonb_build_object('status', 'given'),
                          jsonb_build_object('status', 'undone'));
  return jsonb_build_object('status', 'undone', 'undone_at', v_row.undone_at);
end $undo_wage_advance_0344$;

comment on function app.undo_wage_advance(uuid, text) is
  'wage advances (0344). The owner takes back an advance logged in error, with a reason (1 to 1000), while its month is still open; its main cash payment is voided with it. Returns {status: undone, undone_at}. REF_NOT_FOUND (hint id), FORBIDDEN, INVALID_TRANSITION (already undone), REASON_REQUIRED, TEXT_TOO_LONG (hint reason), WAGE_ALREADY_PAID (the month is paid: undo that first). Audit staff.wage.advance_undo {status}.';
revoke all on function app.undo_wage_advance(uuid, text) from public, anon;
grant execute on function app.undo_wage_advance(uuid, text) to authenticated;
