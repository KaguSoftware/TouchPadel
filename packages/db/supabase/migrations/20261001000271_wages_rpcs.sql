-- 0271 wages_rpcs — what the owner's Wages page and the manager's Attendance
-- page call.
--
-- Feature: wages (Parsa 2026-10-01). Tables and settings: 0270. The deduction
-- RPCs that feed a wage: 0272.
-- Re-runnable: create or replace.
--
-- ONE COMPUTATION. app.wage_line is the only place a month's figures are
-- added up: the rate in force, its pay day in that month, the approved
-- deductions and the lateness penalties whose pay month it is, the net, and
-- where the wage stands (unset, none, upcoming, due, overdue, paid). The page,
-- the reminder and "mark paid" all read it, so they cannot disagree. A paid
-- month answers from its snapshot.
--
-- A PAID MONTH IS FROZEN. app.wage_open_month names the first month on or
-- after a date that is not yet paid for the person: a day recorded, or a
-- deduction approved (0272), after the owner paid its month lands there.
-- A recorded day in a paid month cannot be changed or cleared.
--
-- ONE LOCK. app.lock_wage serialises every write that changes what a
-- person's month adds up to (a payment, an undo, a day, a deduction's
-- decision or cancel) so "mark paid" never snapshots a month while another
-- write lands in it. It is always taken before any wage_payments,
-- staff_attendance or salary_deductions row lock the same body takes after.
--
-- WHO. Wages and payments: the owner. Attendance: a manager or the owner at
-- the branch, for anyone active there but an owner and themselves; a manager
-- never reads a day about themselves. Money about a named person: never
-- readable by the owner assistant or any LLM, and audit rows carry {status}
-- only (0197, V17).
--
-- covered by packages/db/tests/wages.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Internal helpers. No client calls them.
-- ---------------------------------------------------------------------------

-- The pay day of a month: p_pay_day, or the month's last day when it is
-- shorter (31 → 30 April, 28 or 29 February).
create or replace function app.wage_due_date(p_month date, p_pay_day int)
returns date
language sql immutable security definer set search_path = public as $wage_due_date_0271$
  select make_date(d.y, d.m,
                   least(greatest(p_pay_day, 1),
                         extract(day from (make_date(d.y, d.m, 1) + interval '1 month' - interval '1 day'))::int))
    from (select extract(year from p_month)::int as y, extract(month from p_month)::int as m) d
   where p_month is not null and p_pay_day is not null
$wage_due_date_0271$;

comment on function app.wage_due_date(date, int) is
  'wages (0271). Internal: the pay day p_pay_day of p_month''s month, or that month''s last day when it is shorter. NULL when either is NULL.';

revoke all on function app.wage_due_date(date, int) from public, anon, authenticated;
grant execute on function app.wage_due_date(date, int) to service_role;

-- Whether the owner marked the person's month paid at the branch.
create or replace function app.wage_month_paid(p_venue uuid, p_staff uuid, p_month date)
returns boolean
language sql stable security definer set search_path = public as $wage_month_paid_0271$
  select exists (select 1 from wage_payments p
                  where p.venue_id = p_venue
                    and p.staff_id = p_staff
                    and p.pay_month = date_trunc('month', p_month)::date
                    and p.status = 'paid')
$wage_month_paid_0271$;

comment on function app.wage_month_paid(uuid, uuid, date) is
  'wages (0271). Internal: true when the person''s pay month (the month of p_month) is marked paid at the branch.';

revoke all on function app.wage_month_paid(uuid, uuid, date) from public, anon, authenticated;
grant execute on function app.wage_month_paid(uuid, uuid, date) to service_role;

-- The first month on or after p_from's month that is not paid for the person.
create or replace function app.wage_open_month(p_venue uuid, p_staff uuid, p_from date)
returns date
language plpgsql stable security definer set search_path = public as $wage_open_month_0271$
declare
  v_month date := date_trunc('month', p_from)::date;
  v_i     int  := 0;
begin
  -- Payments reach one month ahead at most (mark_wage_paid), so this walks a
  -- step or two; the cap only bounds a corrupt history.
  while v_month is not null and v_i < 36 and app.wage_month_paid(p_venue, p_staff, v_month) loop
    v_month := (v_month + interval '1 month')::date;
    v_i := v_i + 1;
  end loop;
  return v_month;
end $wage_open_month_0271$;

comment on function app.wage_open_month(uuid, uuid, date) is
  'wages (0271). Internal: the first pay month on or after p_from''s month that the person''s branch has not marked paid; where a recorded day or an approved deduction (0272) lands.';

revoke all on function app.wage_open_month(uuid, uuid, date) from public, anon, authenticated;
grant execute on function app.wage_open_month(uuid, uuid, date) to service_role;

-- The serialisation point for one person's pay at one branch.
create or replace function app.lock_wage(p_venue uuid, p_staff uuid)
returns void
language plpgsql security definer set search_path = public as $lock_wage_0271$
begin
  if p_venue is not null and p_staff is not null then
    -- Namespaced key, xact-scoped: released on COMMIT or ROLLBACK (0042's shape).
    perform pg_advisory_xact_lock(hashtextextended('app.wages:' || p_venue::text || ':' || p_staff::text, 0));
  end if;
end $lock_wage_0271$;

comment on function app.lock_wage(uuid, uuid) is
  'wages (0271). Internal: a transaction advisory lock on one person''s pay at one branch, taken by every write that changes what a pay month adds up to, before any row lock.';

revoke all on function app.lock_wage(uuid, uuid) from public, anon, authenticated;
grant execute on function app.lock_wage(uuid, uuid) to service_role;

-- One person's pay month: the only place its figures are added up.
create or replace function app.wage_line(
  p_venue  uuid,
  p_staff  uuid,
  p_month  date,
  p_today  date,
  p_remind int
) returns jsonb
language plpgsql stable security definer set search_path = public as $wage_line_0271$
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
  v_paid    boolean;
  v_status  text;
  v_payment jsonb;
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
    if v_rate.id is not null then
      v_due := app.wage_due_date(v_month, v_rate.pay_day);
    end if;
  end if;

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
    'net_iqd',         v_salary - v_ded - v_pen,
    'payment',         v_payment);
end $wage_line_0271$;

comment on function app.wage_line(uuid, uuid, date, date, int) is
  'wages (0271). Internal: one person''s pay month at a branch, {month, status (unset, none, upcoming, due, overdue, paid), salary_iqd, pay_day, rate_from, next_rate, due_date, days_left, deductions_iqd, deduction_count, penalties_iqd, penalty_days, net_iqd, payment}. A paid month answers from its payment snapshot; otherwise the rate in force, the approved deductions and the lateness penalties whose pay month it is. due is today within p_remind days of the pay day.';

revoke all on function app.wage_line(uuid, uuid, date, date, int) from public, anon, authenticated;
grant execute on function app.wage_line(uuid, uuid, date, date, int) to service_role;

-- ---------------------------------------------------------------------------
-- 2. app.wages_month — the owner: one branch's pay month, person by person.
-- ---------------------------------------------------------------------------
create or replace function app.wages_month(
  p_venue_id uuid default null,
  p_month    date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $wages_month_0271$
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
  -- an approved deduction or a recorded day for. Never an owner.
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
                        where a.venue_id = v_venue and a.staff_id = s.id and a.pay_month = v_month))
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
end $wages_month_0271$;

comment on function app.wages_month(uuid, date) is
  'wages (0271). The owner at the branch: {month, current_month, today, remind_days, totals: {salary_iqd, deductions_iqd, penalties_iqd, net_iqd, paid_iqd, people, paid, due, overdue, upcoming, unset}, people: [app.wage_line + {staff_id, display_name, role, is_active, member, waiting_count, deductions: [{id, amount_iqd, deduction_date, reason, decided_at}], lateness: [{id, work_date, late_minutes, early_leave_minutes, grace_minutes, penalty_iqd, note}]}]} for p_month (NULL: the branch''s current business month): everyone active at the branch but an owner, and anyone the month has a payment, approved deduction or recorded day for. FORBIDDEN for anyone else.';

revoke all on function app.wages_month(uuid, date) from public, anon;
grant execute on function app.wages_month(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.wages_due — the owner: the wages to pay now (the reminder).
-- ---------------------------------------------------------------------------
create or replace function app.wages_due(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $wages_due_0271$
declare
  v_venue   uuid;
  v_today   date;
  v_current date;
  v_remind  int;
  v_rows    jsonb;
  v_count   int;
  v_overdue int;
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
  v_remind  := coalesce(app.cafe_setting_int('wage_reminder_days', v_venue), 3);

  -- Every unpaid month from the person's first rate (at most a year back) to
  -- next month whose pay day is within the reminder window or past.
  select coalesce(jsonb_agg(x.line || jsonb_build_object(
                    'staff_id',     x.id,
                    'display_name', x.display_name,
                    'role',         x.role)
                  order by (x.line ->> 'due_date')::date, x.display_name, x.id), '[]'::jsonb),
         count(*),
         count(*) filter (where x.line ->> 'status' = 'overdue')
    into v_rows, v_count, v_overdue
    from (select s.id, s.display_name, s.role,
                 app.wage_line(v_venue, s.id, m.month::date, v_today, v_remind) as line
            from staff s
            join lateral (select min(w.effective_month) as first_month
                            from staff_wages w
                           where w.venue_id = v_venue and w.staff_id = s.id) f on f.first_month is not null
            cross join lateral generate_series(
                   greatest(f.first_month, (v_current - interval '11 months')::date)::timestamp,
                   (v_current + interval '1 month')::timestamp,
                   interval '1 month') as m(month)
           where s.is_active
             and s.role <> 'owner'
             and exists (select 1 from staff_venues sv where sv.staff_id = s.id and sv.venue_id = v_venue)) x
   where x.line ->> 'status' in ('due', 'overdue');

  return jsonb_build_object(
    'today',         v_today,
    'remind_days',   v_remind,
    'count',         v_count,
    'overdue_count', v_overdue,
    'people',        v_rows);
end $wages_due_0271$;

comment on function app.wages_due(uuid) is
  'wages (0271). The owner at the branch: {today, remind_days, count, overdue_count, people: [app.wage_line + {staff_id, display_name, role}]}, the unpaid pay months (from the person''s first rate, at most eleven months back, to next month) of everyone active at the branch whose pay day is within wage_reminder_days or past, by pay day. The Wages badge and the panel''s reminder. FORBIDDEN for anyone else.';

revoke all on function app.wages_due(uuid) from public, anon;
grant execute on function app.wages_due(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.set_staff_wage — the owner sets a person's salary and pay day.
-- ---------------------------------------------------------------------------
create or replace function app.set_staff_wage(
  p_staff_id   uuid,
  p_salary_iqd bigint,
  p_pay_day    int,
  p_from_month date default null,
  p_venue_id   uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_staff_wage_0271$
declare
  v_venue     uuid;
  v_today     date;
  v_current   date;
  v_last_paid date;
  v_from      date;
  v_id        uuid;
  v_replaced  boolean;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  if p_salary_iqd is null or p_salary_iqd < 0 or p_salary_iqd > 100000000 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;
  if p_pay_day is null or p_pay_day < 1 or p_pay_day > 31 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'pay_day';
  end if;
  -- Someone active at the branch, never an owner.
  if p_staff_id is null
     or not exists (select 1 from staff s
                     where s.id = p_staff_id and s.is_active and s.role <> 'owner'
                       and exists (select 1 from staff_venues sv
                                    where sv.staff_id = s.id and sv.venue_id = v_venue)) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'staff_id';
  end if;

  perform app.lock_wage(v_venue, p_staff_id);

  v_today   := app.venue_business_date(v_venue);
  v_current := date_trunc('month', v_today)::date;
  select max(p.pay_month) into v_last_paid
    from wage_payments p
   where p.venue_id = v_venue and p.staff_id = p_staff_id and p.status = 'paid';

  if p_from_month is null then
    -- The first pay day from today: this month's if it has not passed.
    v_from := case when app.wage_due_date(v_current, p_pay_day) >= v_today
                   then v_current
                   else (v_current + interval '1 month')::date end;
    if v_last_paid is not null and v_from <= v_last_paid then
      v_from := (v_last_paid + interval '1 month')::date;
    end if;
  else
    v_from := date_trunc('month', p_from_month)::date;
    -- Never a paid month or one before it: a paid month is frozen.
    if v_from < (v_current - interval '12 months')::date
       or v_from > (v_current + interval '12 months')::date
       or (v_last_paid is not null and v_from <= v_last_paid) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'month';
    end if;
  end if;

  select w.id into v_id
    from staff_wages w
   where w.venue_id = v_venue and w.staff_id = p_staff_id and w.effective_month = v_from
   for update;
  v_replaced := v_id is not null;
  if v_replaced then
    update staff_wages
       set salary_iqd = p_salary_iqd, pay_day = p_pay_day, set_by = auth.uid(), set_at = now()
     where id = v_id;
  else
    insert into staff_wages (venue_id, staff_id, effective_month, salary_iqd, pay_day, set_by)
    values (v_venue, p_staff_id, v_from, p_salary_iqd, p_pay_day, auth.uid())
    returning id into v_id;
  end if;

  perform app.write_audit('staff.wage.set', 'staff_wage', v_id::text,
                          case when v_replaced then jsonb_build_object('status', 'set') end,
                          jsonb_build_object('status', 'set'));

  return jsonb_build_object('id', v_id, 'effective_month', v_from, 'salary_iqd', p_salary_iqd,
                            'pay_day', p_pay_day, 'replaced', v_replaced);
end $set_staff_wage_0271$;

comment on function app.set_staff_wage(uuid, bigint, int, date, uuid) is
  'wages (0271). The owner at the branch: sets the monthly salary (0 to 100,000,000 IQD; 0 = not paid here) and pay day (1 to 31) of someone active at the branch but an owner, from pay month p_from_month (NULL: the first pay day from today, after the last paid month). Never a paid month or one before it, at most twelve months away. Replaces the row for that month. Returns {id, effective_month, salary_iqd, pay_day, replaced}. INVALID_AMOUNT, INVALID_ARGUMENT (hint pay_day, month), FORBIDDEN (hint staff_id). Audit staff.wage.set {status}.';

revoke all on function app.set_staff_wage(uuid, bigint, int, date, uuid) from public, anon;
grant execute on function app.set_staff_wage(uuid, bigint, int, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.mark_wage_paid — the owner paid a person's month.
-- ---------------------------------------------------------------------------
create or replace function app.mark_wage_paid(
  p_staff_id         uuid,
  p_month            date,
  p_expected_net_iqd bigint default null,
  p_venue_id         uuid default null,
  p_idempotency_key  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $mark_wage_paid_0271$
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
  if v_line ->> 'status' in ('unset', 'none') then
    raise exception 'WAGE_NOT_SET' using errcode = 'P0001';
  end if;
  v_net := (v_line ->> 'net_iqd')::bigint;
  -- What the owner confirmed is what is recorded: a deduction or a day that
  -- landed while the dialog was open sends them back to look again.
  if p_expected_net_iqd is not null and p_expected_net_iqd <> v_net then
    raise exception 'WAGE_CHANGED' using errcode = 'P0001';
  end if;

  insert into wage_payments (venue_id, staff_id, pay_month, due_date, salary_iqd, deductions_iqd,
                             deduction_count, penalties_iqd, penalty_days, net_iqd, paid_iqd,
                             status, paid_by)
  values (v_venue, p_staff_id, v_month, (v_line ->> 'due_date')::date,
          (v_line ->> 'salary_iqd')::bigint, (v_line ->> 'deductions_iqd')::bigint,
          (v_line ->> 'deduction_count')::int, (v_line ->> 'penalties_iqd')::bigint,
          (v_line ->> 'penalty_days')::int, v_net, greatest(v_net, 0),
          'paid', auth.uid())
  on conflict (venue_id, staff_id, pay_month) do update
     set due_date        = excluded.due_date,
         salary_iqd      = excluded.salary_iqd,
         deductions_iqd  = excluded.deductions_iqd,
         deduction_count = excluded.deduction_count,
         penalties_iqd   = excluded.penalties_iqd,
         penalty_days    = excluded.penalty_days,
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
end $mark_wage_paid_0271$;

comment on function app.mark_wage_paid(uuid, date, bigint, uuid, text) is
  'wages (0271). The owner at the branch: marks a person''s pay month (at most next month) paid, recording app.wage_line''s figures as they stand: salary, approved deductions, lateness penalties, net, and the amount paid (the net, or 0 below zero; nothing carries over). The month is frozen from then on. p_expected_net_iqd, the net the owner confirmed, must still be the net. Returns {id, status: paid, pay_month, net_iqd, paid_iqd}. Idempotent by key. FORBIDDEN (hint staff_id), INVALID_ARGUMENT (hint month), WAGE_ALREADY_PAID, WAGE_NOT_SET (no salary for that month, or 0), WAGE_CHANGED. Audit staff.wage.paid {status}.';

revoke all on function app.mark_wage_paid(uuid, date, bigint, uuid, text) from public, anon;
grant execute on function app.mark_wage_paid(uuid, date, bigint, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.undo_wage_paid — the owner takes a payment back, with a reason.
-- ---------------------------------------------------------------------------
create or replace function app.undo_wage_paid(p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $undo_wage_paid_0271$
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

  perform app.write_audit('staff.wage.undo', 'wage_payment', p_id::text,
                          jsonb_build_object('status', 'paid'),
                          jsonb_build_object('status', 'undone'));
  return jsonb_build_object('status', 'undone', 'undone_at', v_row.undone_at);
end $undo_wage_paid_0271$;

comment on function app.undo_wage_paid(uuid, text) is
  'wages (0271). The owner takes back a payment marked in error, with a reason (1 to 1000): the month is open again and adds up afresh; a day or deduction that landed in a later month while it was paid stays there. Returns {status: undone, undone_at}. REF_NOT_FOUND (hint id), FORBIDDEN, INVALID_TRANSITION (not paid), REASON_REQUIRED, TEXT_TOO_LONG (hint reason). Audit staff.wage.undo {status}.';

revoke all on function app.undo_wage_paid(uuid, text) from public, anon;
grant execute on function app.undo_wage_paid(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.attendance_month — a manager or the owner: one month of recorded days.
-- ---------------------------------------------------------------------------
create or replace function app.attendance_month(
  p_venue_id uuid default null,
  p_month    date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $attendance_month_0271$
declare
  v_venue   uuid;
  v_today   date;
  v_current date;
  v_month   date;
  v_targets jsonb;
  v_people  jsonb;
  v_totals  jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_today   := app.venue_business_date(v_venue);
  v_current := date_trunc('month', v_today)::date;
  v_month   := coalesce(date_trunc('month', p_month)::date, v_current);

  -- Who the caller may record a day for: active at the branch, never an owner
  -- or themselves.
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'display_name', s.display_name, 'role', s.role)
                            order by s.display_name, s.id), '[]'::jsonb)
    into v_targets
    from staff s
   where s.is_active and s.role <> 'owner' and s.id <> auth.uid()
     and exists (select 1 from staff_venues sv where sv.staff_id = s.id and sv.venue_id = v_venue);

  -- The month's days by work date; never a day about the caller.
  with days as (
    select a.*, r.display_name as recorded_by_name,
           app.wage_month_paid(a.venue_id, a.staff_id, a.pay_month) as locked
      from staff_attendance a
      left join staff r on r.id = a.recorded_by
     where a.venue_id = v_venue
       and a.staff_id is distinct from auth.uid()
       and a.work_date >= v_month
       and a.work_date < (v_month + interval '1 month')::date
  ), people as (
    select d.staff_id, s.display_name, s.role, s.is_active,
           count(*)                                   as days,
           count(*) filter (where d.penalty_iqd > 0)  as penalty_days,
           coalesce(sum(d.penalty_iqd), 0)            as penalties_iqd,
           coalesce(sum(d.late_minutes), 0)           as late_minutes,
           coalesce(sum(d.early_leave_minutes), 0)    as early_leave_minutes,
           jsonb_agg(jsonb_build_object(
             'id',                  d.id,
             'work_date',           d.work_date,
             'late_minutes',        d.late_minutes,
             'early_leave_minutes', d.early_leave_minutes,
             'grace_minutes',       d.grace_minutes,
             'penalty_rule_iqd',    d.penalty_rule_iqd,
             'penalty_iqd',         d.penalty_iqd,
             'pay_month',           d.pay_month,
             'locked',              d.locked,
             'note',                d.note,
             'recorded_by_name',    d.recorded_by_name,
             'recorded_at',         d.recorded_at)
             order by d.work_date, d.id) as days_list
      from days d
      join staff s on s.id = d.staff_id
     group by d.staff_id, s.display_name, s.role, s.is_active
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'staff_id',            p.staff_id,
           'display_name',        p.display_name,
           'role',                p.role,
           'is_active',           p.is_active,
           'day_count',           p.days,
           'penalty_days',        p.penalty_days,
           'penalties_iqd',       p.penalties_iqd,
           'late_minutes',        p.late_minutes,
           'early_leave_minutes', p.early_leave_minutes,
           'days',                p.days_list)
           order by p.display_name, p.staff_id), '[]'::jsonb),
         jsonb_build_object(
           'days',          coalesce(sum(p.days), 0),
           'penalty_days',  coalesce(sum(p.penalty_days), 0),
           'penalties_iqd', coalesce(sum(p.penalties_iqd), 0),
           'people',        count(*))
    into v_people, v_totals
    from people p;

  return jsonb_build_object(
    'month',         v_month,
    'current_month', v_current,
    'today',         v_today,
    'window_days',   60,
    'rule',          jsonb_build_object(
                       'grace_minutes', coalesce(app.cafe_setting_int('attendance_grace_minutes', v_venue), 0),
                       'penalty_iqd',   coalesce(app.cafe_setting_int('attendance_penalty_iqd', v_venue), 0)),
    'staff',         v_targets,
    'totals',        v_totals,
    'people',        v_people);
end $attendance_month_0271$;

comment on function app.attendance_month(uuid, date) is
  'wages (0271). A manager or the owner at the branch: {month, current_month, today, window_days, rule: {grace_minutes, penalty_iqd}, staff: [{id, display_name, role}] (who the caller may record a day for), totals: {days, penalty_days, penalties_iqd, people}, people: [{staff_id, display_name, role, is_active, day_count, penalty_days, penalties_iqd, late_minutes, early_leave_minutes, days: [{id, work_date, late_minutes, early_leave_minutes, grace_minutes, penalty_rule_iqd, penalty_iqd, pay_month, locked, note, recorded_by_name, recorded_at}]}]} for the work days of p_month (NULL: the branch''s current business month), never a day about the caller. locked: its pay month is paid. FORBIDDEN for anyone else.';

revoke all on function app.attendance_month(uuid, date) from public, anon;
grant execute on function app.attendance_month(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.record_attendance — a manager or the owner records a work day.
-- ---------------------------------------------------------------------------
create or replace function app.record_attendance(
  p_staff_id            uuid,
  p_date                date,
  p_late_minutes        int,
  p_early_leave_minutes int,
  p_note                text default null,
  p_venue_id            uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $record_attendance_0271$
declare
  v_venue  uuid;
  v_today  date;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_old    staff_attendance%rowtype;
  v_row    staff_attendance%rowtype;
  v_grace  int;
  v_rule   bigint;
  v_found  boolean;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  -- The branch's own day: up to 60 days back, never ahead (0197's window).
  v_today := app.venue_business_date(v_venue);
  if p_date is null or p_date > v_today or p_date < v_today - 60 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'date';
  end if;
  if p_late_minutes is null or p_late_minutes < 0 or p_late_minutes > 720 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'late_minutes';
  end if;
  if p_early_leave_minutes is null or p_early_leave_minutes < 0 or p_early_leave_minutes > 720 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'early_leave_minutes';
  end if;
  if p_late_minutes + p_early_leave_minutes = 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'minutes';
  end if;
  if v_note is not null and length(v_note) > 300 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;
  -- Someone active at the branch, never an owner or the caller.
  if p_staff_id is null
     or p_staff_id = auth.uid()
     or not exists (select 1 from staff s
                     where s.id = p_staff_id and s.is_active and s.role <> 'owner'
                       and exists (select 1 from staff_venues sv
                                    where sv.staff_id = s.id and sv.venue_id = v_venue)) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'staff_id';
  end if;

  perform app.lock_wage(v_venue, p_staff_id);

  select * into v_old
    from staff_attendance a
   where a.venue_id = v_venue and a.staff_id = p_staff_id and a.work_date = p_date
   for update;
  v_found := found;
  if v_found and app.wage_month_paid(v_venue, p_staff_id, v_old.pay_month) then
    raise exception 'WAGE_ALREADY_PAID' using errcode = 'P0001';
  end if;

  -- The rule in force now goes onto the row: a later change never rewrites it.
  v_grace := coalesce(app.cafe_setting_int('attendance_grace_minutes', v_venue), 0);
  v_rule  := coalesce(app.cafe_setting_int('attendance_penalty_iqd', v_venue), 0);

  if v_found then
    update staff_attendance
       set late_minutes        = p_late_minutes,
           early_leave_minutes = p_early_leave_minutes,
           grace_minutes       = v_grace,
           penalty_rule_iqd    = v_rule,
           note                = v_note,
           recorded_by         = auth.uid(),
           recorded_at         = now()
     where id = v_old.id
     returning * into v_row;
  else
    insert into staff_attendance (venue_id, staff_id, work_date, late_minutes, early_leave_minutes,
                                  grace_minutes, penalty_rule_iqd, pay_month, note, recorded_by)
    values (v_venue, p_staff_id, p_date, p_late_minutes, p_early_leave_minutes,
            v_grace, v_rule, app.wage_open_month(v_venue, p_staff_id, p_date), v_note, auth.uid())
    returning * into v_row;
  end if;

  perform app.write_audit('staff.attendance.record', 'staff_attendance', v_row.id::text,
                          case when v_found then jsonb_build_object('status', 'recorded') end,
                          jsonb_build_object('status', 'recorded'));

  return jsonb_build_object('id', v_row.id, 'penalty_iqd', v_row.penalty_iqd,
                            'pay_month', v_row.pay_month, 'replaced', v_found);
end $record_attendance_0271$;

comment on function app.record_attendance(uuid, date, int, int, text, uuid) is
  'wages (0271). A manager or the owner at the branch: records minutes late and minutes left early (each 0 to 720, not both 0) on a work day within the 60 days up to the branch''s business date, with an optional note (at most 300), for someone active at the branch but an owner and themselves. One row per person and day: recording the day again replaces it, unless its pay month is paid. The branch''s rule (attendance_grace_minutes, attendance_penalty_iqd) is copied onto the row; a new row''s pay month is the day''s month, or the person''s next unpaid one. Returns {id, penalty_iqd, pay_month, replaced}. INVALID_ARGUMENT (hint date, late_minutes, early_leave_minutes, minutes), TEXT_TOO_LONG (hint note), FORBIDDEN (hint staff_id), WAGE_ALREADY_PAID. Audit staff.attendance.record {status}.';

revoke all on function app.record_attendance(uuid, date, int, int, text, uuid) from public, anon;
grant execute on function app.record_attendance(uuid, date, int, int, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.clear_attendance — a manager or the owner removes a recorded day.
-- ---------------------------------------------------------------------------
create or replace function app.clear_attendance(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $clear_attendance_0271$
declare
  v_venue uuid;
  v_staff uuid;
  v_row   staff_attendance%rowtype;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select a.venue_id, a.staff_id into v_venue, v_staff from staff_attendance a where a.id = p_id;
  if not found or not (v_venue = any(app.staff_venue_ids())) or v_staff = auth.uid() then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  perform app.lock_wage(v_venue, v_staff);
  select * into v_row from staff_attendance where id = p_id for update;
  if not found then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if app.wage_month_paid(v_venue, v_staff, v_row.pay_month) then
    raise exception 'WAGE_ALREADY_PAID' using errcode = 'P0001';
  end if;

  delete from staff_attendance where id = p_id;

  perform app.write_audit('staff.attendance.clear', 'staff_attendance', p_id::text,
                          jsonb_build_object('status', 'recorded'),
                          jsonb_build_object('status', 'cleared'));
  return jsonb_build_object('status', 'cleared');
end $clear_attendance_0271$;

comment on function app.clear_attendance(uuid) is
  'wages (0271). A manager or the owner at the branch removes a recorded day, never one about themselves or one whose pay month is paid. Returns {status: cleared}. REF_NOT_FOUND (hint id), FORBIDDEN, WAGE_ALREADY_PAID. Audit staff.attendance.clear {status}.';

revoke all on function app.clear_attendance(uuid) from public, anon;
grant execute on function app.clear_attendance(uuid) to authenticated;
