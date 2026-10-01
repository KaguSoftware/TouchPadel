-- 0270 wages_tables — a salary and a pay day for every worker, the payments
-- the owner marks, and the late arrivals and early leaves a manager records.
--
-- Feature: wages (Parsa 2026-10-01; plan "Wages, attendance penalties,
-- owner-approved deductions"). The RPCs are 0271; the deduction rules that
-- now feed a wage are 0272.
-- Depends on: salary_deductions (0197), zz_branch_guard (0230), the per-branch
-- cafe settings (0209).
-- Re-runnable: create … if not exists, create or replace, drop … if exists.
--
-- PER BRANCH. A wage, a payment and an attendance day each belong to one
-- branch, like salary_deductions: a person who works at two branches has a
-- rate at each (0 = not paid at this one), and the owner reads one branch's
-- wages at a time.
--
-- STAFF_WAGES is dated: the rate for pay month M is the newest row whose
-- effective_month is on or before M, so a change never rewrites a month
-- already paid. pay_day is 1 to 31; a month shorter than that pays on its last
-- day (app.wage_due_date, 0271). Pay month M is the wage paid on the pay day
-- that falls in M.
--
-- WAGE_PAYMENTS is the owner's "paid": one row per person and pay month, with
-- a snapshot of the figures the owner saw. Undone, the row stays (status
-- undone, with the reason) until the month is paid again. A paid month is
-- frozen: a deduction approved or a day recorded later lands in the person's
-- next unpaid month (0271, 0272).
--
-- STAFF_ATTENDANCE is one row per person and work day: minutes late and
-- minutes left early. The day costs the branch's penalty (Y IQD) when the two
-- together are more than its grace (X minutes). X and Y are copied onto the
-- row when it is recorded, so changing the rule never rewrites a recorded day.
-- Y = 0 is off (the default): nothing is taken until a manager sets it.
--
-- WHO. The owner reads and writes wages and payments; a manager or the owner
-- records attendance for anyone active at the branch but an owner and
-- themselves, and never reads a row about themselves. Every write is an RPC
-- (0271); the tables are select-only to clients.
--
-- THE LLM WALL (as 0197). Money about a named person: never readable by the
-- owner assistant or any LLM. Coverage excluded, no
-- assistant_readable_columns row, no assistant tool; audit rows carry
-- {status} only.
--
-- covered by packages/db/tests/wages.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. staff_wages — the salary and pay day, dated by pay month.
-- ---------------------------------------------------------------------------
create table if not exists staff_wages (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references venues(id),
  staff_id        uuid not null references staff(id),
  effective_month date not null,
  salary_iqd      iqd not null,
  pay_day         smallint not null,
  set_by          uuid not null references staff(id),
  set_at          timestamptz not null default now(),
  constraint staff_wages_month_key unique (venue_id, staff_id, effective_month),
  constraint staff_wages_month_first_chk
    check (effective_month = date_trunc('month', effective_month)::date),
  constraint staff_wages_salary_chk check (salary_iqd between 0 and 100000000),
  constraint staff_wages_pay_day_chk check (pay_day between 1 and 31)
);

comment on table staff_wages is
  'staff_wages (0270): a person''s monthly salary and pay day at one branch, dated by pay month: the rate for month M is the newest row with effective_month <= M. Written by the owner through app.set_staff_wage; read by the owner only. Never readable by the owner assistant or any LLM.';
comment on column staff_wages.id is 'Row id.';
comment on column staff_wages.venue_id is 'The branch that pays it.';
comment on column staff_wages.staff_id is 'The person.';
comment on column staff_wages.effective_month is 'The first pay month this rate applies to (the first day of that month).';
comment on column staff_wages.salary_iqd is 'The monthly salary, 0 to 100,000,000 IQD; 0 = not paid at this branch.';
comment on column staff_wages.pay_day is 'The day of the month it is paid, 1 to 31; a shorter month pays on its last day.';
comment on column staff_wages.set_by is 'The owner who set it.';
comment on column staff_wages.set_at is 'When it was set.';

alter table staff_wages enable row level security;

drop policy if exists staff_wages_owner_read on staff_wages;
create policy staff_wages_owner_read on staff_wages
  for select to authenticated
  using ((select app.is_staff('owner'))
         and venue_id = any((select app.visible_venue_ids())::uuid[]));

grant select on staff_wages to authenticated;
grant all on staff_wages to service_role;

drop trigger if exists zz_branch_guard on public.staff_wages;
create trigger zz_branch_guard before insert or update or delete on public.staff_wages
  for each row execute function app.trg_branch_guard('scoped');

-- ---------------------------------------------------------------------------
-- 2. wage_payments — the owner marked a person's month paid.
-- ---------------------------------------------------------------------------
create table if not exists wage_payments (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references venues(id),
  staff_id        uuid not null references staff(id),
  pay_month       date not null,
  due_date        date not null,
  salary_iqd      iqd not null,
  deductions_iqd  iqd not null,
  deduction_count int not null,
  penalties_iqd   iqd not null,
  penalty_days    int not null,
  net_iqd         iqd_signed not null,
  paid_iqd        iqd not null,
  status          text not null default 'paid',
  paid_by         uuid not null references staff(id),
  paid_at         timestamptz not null default now(),
  undone_by       uuid references staff(id),
  undone_at       timestamptz,
  undo_reason     text,
  constraint wage_payments_month_key unique (venue_id, staff_id, pay_month),
  constraint wage_payments_month_first_chk
    check (pay_month = date_trunc('month', pay_month)::date),
  constraint wage_payments_status_chk check (status in ('paid','undone')),
  constraint wage_payments_counts_chk check (deduction_count >= 0 and penalty_days >= 0),
  constraint wage_payments_net_chk check (net_iqd = salary_iqd - deductions_iqd - penalties_iqd),
  constraint wage_payments_paid_chk check (paid_iqd = greatest(net_iqd, 0)),
  constraint wage_payments_undone_chk
    check ((status = 'undone') = (undone_by is not null)
           and (undone_by is null) = (undone_at is null)
           and (undone_by is null) = (undo_reason is null)),
  constraint wage_payments_undo_reason_chk
    check (undo_reason is null or (length(btrim(undo_reason)) > 0 and length(undo_reason) <= 1000))
);

comment on table wage_payments is
  'wage_payments (0270): the owner marked a person''s pay month paid at a branch, with a snapshot of the figures (salary, approved deductions, lateness penalties, net, the amount paid). One row per person and month; undone, the row stays with the reason until the month is paid again. A paid month is frozen. Read by the owner only. Never readable by the owner assistant or any LLM.';
comment on column wage_payments.id is 'Payment id.';
comment on column wage_payments.venue_id is 'The branch that paid it.';
comment on column wage_payments.staff_id is 'The person paid.';
comment on column wage_payments.pay_month is 'The pay month (the first day of that month).';
comment on column wage_payments.due_date is 'The pay day in that month, as it was when paid.';
comment on column wage_payments.salary_iqd is 'Snapshot: the salary for the month.';
comment on column wage_payments.deductions_iqd is 'Snapshot: the approved deductions whose pay month it is.';
comment on column wage_payments.deduction_count is 'Snapshot: how many approved deductions.';
comment on column wage_payments.penalties_iqd is 'Snapshot: the lateness penalties whose pay month it is.';
comment on column wage_payments.penalty_days is 'Snapshot: how many days cost a penalty.';
comment on column wage_payments.net_iqd is 'Snapshot: salary minus deductions minus penalties; may be below zero.';
comment on column wage_payments.paid_iqd is 'The amount paid: the net, or 0 when the net is below zero (nothing carries over).';
comment on column wage_payments.status is 'paid, or undone (the owner took it back; paying the month again makes it paid).';
comment on column wage_payments.paid_by is 'The owner who marked it paid.';
comment on column wage_payments.paid_at is 'When it was marked paid.';
comment on column wage_payments.undone_by is 'The owner who undid it.';
comment on column wage_payments.undone_at is 'When it was undone.';
comment on column wage_payments.undo_reason is 'Why it was undone (1 to 1000 characters).';

alter table wage_payments enable row level security;

drop policy if exists wage_payments_owner_read on wage_payments;
create policy wage_payments_owner_read on wage_payments
  for select to authenticated
  using ((select app.is_staff('owner'))
         and venue_id = any((select app.visible_venue_ids())::uuid[]));

grant select on wage_payments to authenticated;
grant all on wage_payments to service_role;

drop trigger if exists zz_branch_guard on public.wage_payments;
create trigger zz_branch_guard before insert or update or delete on public.wage_payments
  for each row execute function app.trg_branch_guard('scoped');

-- ---------------------------------------------------------------------------
-- 3. staff_attendance — minutes late and minutes left early, per work day.
-- ---------------------------------------------------------------------------
create table if not exists staff_attendance (
  id                  uuid primary key default gen_random_uuid(),
  venue_id            uuid not null references venues(id),
  staff_id            uuid not null references staff(id),
  work_date           date not null,
  late_minutes        int not null default 0,
  early_leave_minutes int not null default 0,
  grace_minutes       int not null,
  penalty_rule_iqd    iqd not null,
  penalty_iqd         bigint generated always as (
                        case when penalty_rule_iqd > 0
                              and late_minutes + early_leave_minutes > grace_minutes
                             then penalty_rule_iqd else 0 end) stored,
  pay_month           date not null,
  note                text,
  recorded_by         uuid not null references staff(id),
  recorded_at         timestamptz not null default now(),
  constraint staff_attendance_day_key unique (venue_id, staff_id, work_date),
  constraint staff_attendance_minutes_chk
    check (late_minutes between 0 and 720 and early_leave_minutes between 0 and 720
           and late_minutes + early_leave_minutes > 0),
  constraint staff_attendance_grace_chk check (grace_minutes between 0 and 720),
  constraint staff_attendance_rule_chk check (penalty_rule_iqd <= 2000000),
  constraint staff_attendance_pay_month_chk
    check (pay_month = date_trunc('month', pay_month)::date
           and pay_month >= date_trunc('month', work_date)::date),
  constraint staff_attendance_note_chk check (note is null or length(note) <= 300),
  constraint staff_attendance_not_self_chk check (staff_id <> recorded_by)
);

comment on table staff_attendance is
  'staff_attendance (0270): a manager or the owner records how late a person arrived and how early they left on a work day at a branch. The day costs penalty_rule_iqd when the minutes together exceed grace_minutes, both copied from the branch''s rule (attendance_grace_minutes, attendance_penalty_iqd) when recorded. It comes off the wage of pay_month: the work day''s month, or the person''s next unpaid month when that one was already paid. Read by MGMT at the branch, never a row about themselves. Never readable by the owner assistant or any LLM.';
comment on column staff_attendance.id is 'Row id.';
comment on column staff_attendance.venue_id is 'The branch.';
comment on column staff_attendance.staff_id is 'The person.';
comment on column staff_attendance.work_date is 'The work day.';
comment on column staff_attendance.late_minutes is 'Minutes late, 0 to 720.';
comment on column staff_attendance.early_leave_minutes is 'Minutes left early, 0 to 720.';
comment on column staff_attendance.grace_minutes is 'The rule''s X when recorded: more minutes than this costs the penalty.';
comment on column staff_attendance.penalty_rule_iqd is 'The rule''s Y when recorded: the penalty for a day over X; 0 = the rule was off.';
comment on column staff_attendance.penalty_iqd is 'What the day costs: penalty_rule_iqd when late + early minutes exceed grace_minutes, else 0.';
comment on column staff_attendance.pay_month is 'The pay month it comes off (the first day of that month).';
comment on column staff_attendance.note is 'An optional note (at most 300 characters).';
comment on column staff_attendance.recorded_by is 'The manager or owner who recorded it.';
comment on column staff_attendance.recorded_at is 'When it was recorded or last changed.';

alter table staff_attendance enable row level security;

drop policy if exists staff_attendance_mgmt_read on staff_attendance;
create policy staff_attendance_mgmt_read on staff_attendance
  for select to authenticated
  using ((select app.is_staff('manager','owner'))
         and venue_id = any((select app.visible_venue_ids())::uuid[])
         and staff_id is distinct from (select auth.uid()));

grant select on staff_attendance to authenticated;
grant all on staff_attendance to service_role;

drop trigger if exists zz_branch_guard on public.staff_attendance;
create trigger zz_branch_guard before insert or update or delete on public.staff_attendance
  for each row execute function app.trg_branch_guard('scoped');

-- ---------------------------------------------------------------------------
-- 4. The three settings: the full 0105 VALUES list + 3 rows.
-- ---------------------------------------------------------------------------
create or replace function app.cafe_setting_specs()
returns table (key text, is_public boolean, jtype text, min_role staff_role, default_value jsonb)
language sql stable security definer set search_path = public as $cafe_specs_0270$
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
      ('wage_reminder_days',                false, 'int(0,14)',                 'owner'::staff_role,   '3'::jsonb)
    ) as v(key, is_public, jtype, min_role, default_value)
$cafe_specs_0270$;
