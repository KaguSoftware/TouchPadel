-- 0323 checklist_schedules — scheduled, assigned checklists. The 0165 lists
-- (role x open/close, daily, shared) extended in place: a list is for a role
-- (one shared copy, or everyone their own) or for named people, repeats on
-- chosen weekdays or on one to four dates a month, is due at the branch's
-- opening or closing time or at a typed time, and is pushed before it is due
-- and once it is overdue. Nothing is locked or blocked: day close still only
-- warns.
--
-- Feature: scheduled checklists
-- (docs/design/checklists/scheduled-checklists-2026-10-08.md §1-§3, the binding
-- contract; Majed's calls 2026-10-08 in its §0).
-- Depends on: checklists (0165), checklist_photos (0184), checklist_day_state_asof
-- (0188), branch_write_guard (0230), staff_push (0160: staff_ids_with_roles),
-- staff_requests (0072: approved leave), shop_price_watch (0322: notify_staff).
--
-- MIGRATION-RISK-ACCEPTED: two plain indexes on checklist_runs (the occurrence
-- key that replaces the dropped (template_id, business_date) key, and
-- (venue_id, business_date) for the sweep). The table holds a few runs a day
-- per branch (hundreds of rows), so each build is milliseconds; CONCURRENTLY
-- cannot run inside the migration's transaction.
--
-- THE SCHEDULE (contract §1.1). repeat_kind 'weekdays' with weekdays (0 =
-- Sunday, the coach_hours convention) or 'monthdays' with month_days (1..31; a
-- date past the month's end is its last day, so 31 is "the last day"). The
-- occurrence for business date D starts on the latest scheduled day S <= D and
-- ends the day before the next scheduled day: a daily list lives a day, a
-- Sunday list Sunday to Saturday, a 1st-and-15th list 1-14 and 15-end. A list
-- stays open until it is done or the next one starts; a missed one simply ends
-- (no "missed" record, SOW:480). app.checklist_is_scheduled and
-- app.checklist_occurrence are the maths, pure and immutable.
--
-- THE DUE TIME (§1.2). app.checklist_due_at, computed once when a run is
-- created: a typed due_time on S (a time before the business-day start hour
-- is after midnight, so S + 1 day: the business day S runs until then), else
-- the branch's opening (slot open) or closing (slot close) on S from
-- venue_settings.opening_hours. The hours are stored as windows per calendar
-- day with an overnight night split in two (seed.sql "HOURS",
-- @touch/core time/openingHours.ts): a window 00:00-<24:00 is the previous
-- night's tail and never the day's opening, and a day's last window that runs
-- to 24:00 closes at the next day's tail end. No hours for the day: open at the
-- business-day start hour on S, close a minute before it on S + 1.
-- overdue = now() > due_at and done < total, at read time, never stored.
--
-- THE RUNS. app.checklist_materialize(venue, D) creates the current
-- occurrence's runs of every live list with lines (a snapshot of its lines and
-- its due time): one shared run (assignee_id NULL) for a shared role list, one
-- per active holder of the role at the branch for an 'each' list, one per
-- active assignee at the branch for a people list, skipping anyone on approved
-- leave on S. An owner's edit made mid-occurrence applies from the next
-- occurrence: a run of another occurrence that reaches into the new rule's
-- (one that started after S, or an older one whose period runs to S or past
-- it), or an occurrence that started in the other shape (shared vs each), is
-- left to run out, and the new rule starts on its first scheduled day after.
-- A list saved after its occurrence started with nothing running (a new
-- list, a list on the 1st made on the 8th) starts on its next scheduled day,
-- and a person put on a people list mid-occurrence gets their first copy from
-- the next one: no copy is born for a day already over. A run is CURRENT on D
-- (app.checklist_current) when S <= D <= period_end and no newer run of the
-- same list started on or before D. checklist_day_state's no-run fallback
-- follows the same rules, so day close never warns about a list that has no
-- copy on purpose.
--
-- WHO. Only the owner writes lists (save_checklist, archive_checklist, and the
-- legacy save_checklist_template for operator stations on the old build). A
-- person's run is ticked by that person or MGMT at the branch; a shared run by
-- the role's holders or MGMT, as before. A tick on a run that is no longer
-- current, or of an archived list, is CHECKLIST_CLOSED.
--
-- THE PUSH. app.checklist_sweep (cron tp_checklist_sweep, every five
-- minutes): per branch, materialise today, then a checklist_due push once in
-- the half hour before due and a checklist_overdue push once past due, to the
-- assignee while they still work at the branch, or for a shared run to the role's holders minus the owners (unless
-- the list is the owners'), never to anyone on approved leave today. The list
-- name rides as params.step {en, ar}, so each phone reads it in its own
-- language (the shop_price_changed shape).
--
-- WHAT IT IS NOT (SOW:265, :480, PRODUCT.md:37). No per-person history, no
-- counts across periods, no completion rates: the reads return the current
-- occurrence only, with the assignee's and the tickers' names.
--
-- Re-issues, each from its latest body: my_checklists_today,
-- mark_checklist_item, checklist_board, save_checklist_template (0184),
-- checklist_day_state (0188), notify_staff (0322, plus checklist_due and
-- checklist_overdue after shop_price_changed), create_branch (0233, copies role
-- lists with their schedule and skips people lists and archived lists) and
-- staff_media_visible (0238, a person's checklist photo is that person's, not
-- the role's). Same signatures throughout, so no drop and no re-grant.
-- checklist_board is no longer STABLE: it materialises today.
-- Backfill: every existing run gets period_end = business_date and due_at
-- from the rule above, and is marked as already pushed (no burst of pushes
-- for lists made before pushes existed).
-- Re-runnable: add column if not exists, guarded constraint work, create or
-- replace, on conflict do nothing.
--
-- covered by packages/db/tests/checklists.test.ts (and checklist-photos,
-- checklist-day-state, staff-push, staff-push-keys, send-push-staff)

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. checklist_templates: who, how it repeats, when it is due, archived.
--    Constant defaults (created_at's now() is evaluated once), so no rewrite.
-- ---------------------------------------------------------------------------
alter table checklist_templates add column if not exists audience    text not null default 'role';
alter table checklist_templates add column if not exists copy_mode   text not null default 'shared';
alter table checklist_templates add column if not exists repeat_kind text not null default 'weekdays';
alter table checklist_templates add column if not exists weekdays    smallint[] not null default '{0,1,2,3,4,5,6}';
alter table checklist_templates add column if not exists month_days  smallint[];
alter table checklist_templates add column if not exists due_time    time;
alter table checklist_templates add column if not exists archived_at timestamptz;
alter table checklist_templates add column if not exists created_at  timestamptz not null default now();
alter table checklist_templates alter column role drop not null;
alter table checklist_templates drop constraint if exists checklist_templates_role_slot_key;

do $add_tpl_schedule_chk_0323$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'checklist_templates_schedule_chk'
                    and conrelid = 'public.checklist_templates'::regclass) then
    alter table checklist_templates
      add constraint checklist_templates_schedule_chk check (
        audience in ('role', 'people')
        and copy_mode in ('shared', 'each')
        and repeat_kind in ('weekdays', 'monthdays')
        and (audience = 'role') = (role is not null)
        and (audience <> 'people' or copy_mode = 'each')
        and cardinality(weekdays) between 1 and 7
        and weekdays <@ '{0,1,2,3,4,5,6}'::smallint[]
        and (repeat_kind = 'monthdays') = (month_days is not null)
        and (month_days is null
             or (cardinality(month_days) between 1 and 4
                 and month_days <@ '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31}'::smallint[]))
      ) not valid;
  end if;
end $add_tpl_schedule_chk_0323$;

do $validate_tpl_schedule_chk_0323$
begin
  if exists (select 1 from pg_constraint
              where conname = 'checklist_templates_schedule_chk'
                and conrelid = 'public.checklist_templates'::regclass
                and not convalidated) then
    alter table checklist_templates validate constraint checklist_templates_schedule_chk;
  end if;
end $validate_tpl_schedule_chk_0323$;

comment on table checklist_templates is
  'checklists (§2.14), scheduled by checklist_schedules (0323): the owner''s list at one branch, EN and AR, for a role (one shared copy, or everyone their own) or for named people (checklist_assignees), repeating on chosen weekdays or dates of the month, due at opening, closing or a typed time. Saved through app.save_checklist (and the legacy app.save_checklist_template). Each occurrence is a checklist_runs snapshot. Read by MGMT at the branch.';
comment on column checklist_templates.role is 'The role whose list this is (audience role); NULL for a people list. Never prep (soft-retired).';
comment on column checklist_templates.slot is 'open or close: the due anchor when due_time is NULL (the branch''s opening or closing time), else derived from due_time (before 14:00 open, else close) so older readers keep a label.';
comment on column checklist_templates.audience is 'checklist_schedules (0323): role (a role''s list) or people (named people, checklist_assignees).';
comment on column checklist_templates.copy_mode is 'checklist_schedules (0323): shared (one list everyone in the role ticks) or each (everyone their own copy); always each for a people list.';
comment on column checklist_templates.repeat_kind is 'checklist_schedules (0323): weekdays (on the days in weekdays) or monthdays (on the dates in month_days).';
comment on column checklist_templates.weekdays is 'checklist_schedules (0323): the days it repeats on, 0 = Sunday .. 6 = Saturday; all seven is every day. Used when repeat_kind is weekdays.';
comment on column checklist_templates.month_days is 'checklist_schedules (0323): one to four dates of the month, 1..31; a date past the month''s end means its last day. NULL unless repeat_kind is monthdays.';
comment on column checklist_templates.due_time is 'checklist_schedules (0323): the time of day it is due on its first day, in the branch''s timezone; NULL means the branch''s opening (slot open) or closing (slot close) time.';
comment on column checklist_templates.archived_at is 'checklist_schedules (0323): when the owner archived it; an archived list is hidden everywhere, its open runs included.';
comment on column checklist_templates.created_at is 'checklist_schedules (0323): when the list was first saved (lists older than 0323 carry the migration''s time).';

-- ---------------------------------------------------------------------------
-- 2. checklist_assignees: the named people of a people list.
-- ---------------------------------------------------------------------------
create table if not exists checklist_assignees (
  template_id uuid not null references checklist_templates(id) on delete cascade,
  staff_id    uuid not null references staff(id),
  venue_id    uuid not null references venues(id),
  created_at  timestamptz not null default now(),
  primary key (template_id, staff_id)
);

comment on table checklist_assignees is
  'checklist_schedules (0323): the people a people list is for, one row per person, replaced whole by app.save_checklist. Each gets their own copy of every occurrence while active at the branch. Read by MGMT at the branch.';
comment on column checklist_assignees.template_id is 'The checklist template (a people list).';
comment on column checklist_assignees.staff_id is 'The staff member the list is for.';
comment on column checklist_assignees.venue_id is 'The branch: the template''s.';
comment on column checklist_assignees.created_at is 'When the person was put on the list.';

alter table checklist_assignees enable row level security;

drop policy if exists checklist_assignees_mgmt_read on checklist_assignees;
create policy checklist_assignees_mgmt_read on checklist_assignees as permissive for select to authenticated
  using ((( select app.is_staff(variadic array['manager'::staff_role, 'owner'::staff_role]) as is_staff)
          and (venue_id = any (( select app.visible_venue_ids() as visible_venue_ids)::uuid[]))));

revoke all on checklist_assignees from anon, authenticated;
grant select on checklist_assignees to authenticated;
grant all on checklist_assignees to service_role;

-- 'scoped': the row carries venue_id, which must be its template's.
drop trigger if exists zz_branch_guard on public.checklist_assignees;
create trigger zz_branch_guard before insert or update or delete on public.checklist_assignees
  for each row execute function app.trg_branch_guard('scoped', 'checklist_templates', 'template_id');

-- ---------------------------------------------------------------------------
-- 3. checklist_runs: one occurrence of a list, shared or one person's.
-- ---------------------------------------------------------------------------
alter table checklist_runs add column if not exists assignee_id       uuid;
alter table checklist_runs add column if not exists period_end        date;
alter table checklist_runs add column if not exists due_at            timestamptz;
alter table checklist_runs add column if not exists due_pushed_at     timestamptz;
alter table checklist_runs add column if not exists overdue_pushed_at timestamptz;
alter table checklist_runs alter column role drop not null;

do $add_run_assignee_fk_0323$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'checklist_runs_assignee_id_fkey'
                    and conrelid = 'public.checklist_runs'::regclass) then
    alter table checklist_runs
      add constraint checklist_runs_assignee_id_fkey foreign key (assignee_id) references staff(id) not valid;
  end if;
end $add_run_assignee_fk_0323$;

do $validate_run_assignee_fk_0323$
begin
  if exists (select 1 from pg_constraint
              where conname = 'checklist_runs_assignee_id_fkey'
                and conrelid = 'public.checklist_runs'::regclass
                and not convalidated) then
    alter table checklist_runs validate constraint checklist_runs_assignee_id_fkey;
  end if;
end $validate_run_assignee_fk_0323$;

do $add_run_period_chk_0323$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'checklist_runs_period_chk'
                    and conrelid = 'public.checklist_runs'::regclass) then
    alter table checklist_runs
      add constraint checklist_runs_period_chk
      check (period_end is null or period_end >= business_date) not valid;
  end if;
end $add_run_period_chk_0323$;

do $validate_run_period_chk_0323$
begin
  if exists (select 1 from pg_constraint
              where conname = 'checklist_runs_period_chk'
                and conrelid = 'public.checklist_runs'::regclass
                and not convalidated) then
    alter table checklist_runs validate constraint checklist_runs_period_chk;
  end if;
end $validate_run_period_chk_0323$;

-- One run per list, occurrence and person (NULL = the shared run). The old
-- one-per-day key goes: an 'each' list has a run per person.
create unique index if not exists checklist_runs_occurrence_key
  on checklist_runs (template_id, business_date, assignee_id) nulls not distinct;
alter table checklist_runs drop constraint if exists checklist_runs_template_day_key;
-- The sweep and the reads: a branch's runs by start day.
create index if not exists checklist_runs_venue_day_idx on checklist_runs (venue_id, business_date);

comment on table checklist_runs is
  'checklists (§2.14), scheduled by checklist_schedules (0323): one occurrence of a list, shared (assignee_id NULL) or one person''s, created by app.checklist_materialize as a snapshot of the template''s lines and due time, so a later edit never orphans a tick. Current from business_date to period_end until a newer run of the list starts. Read by MGMT at the branch.';
comment on column checklist_runs.role is 'The role the list is for (copied from the template); NULL for a people list.';
comment on column checklist_runs.business_date is 'The occurrence''s first business day (period_start), in the branch''s timezone with the analytics start hour (app.venue_business_date).';
comment on column checklist_runs.created_at is 'When the occurrence''s run was created.';
comment on column checklist_runs.assignee_id is 'checklist_schedules (0323): the person this copy is for; NULL for a role''s one shared list.';
comment on column checklist_runs.period_end is 'checklist_schedules (0323): the occurrence''s last business day, the day before the list''s next scheduled day (snapshot).';
comment on column checklist_runs.due_at is 'checklist_schedules (0323): when the list is due, computed when the run was created (app.checklist_due_at). Overdue = past it with lines open, computed at read time.';
comment on column checklist_runs.due_pushed_at is 'checklist_schedules (0323): when the sweep sent the due-soon push (at most once).';
comment on column checklist_runs.overdue_pushed_at is 'checklist_schedules (0323): when the sweep sent the overdue push (at most once).';

-- ---------------------------------------------------------------------------
-- 4. The schedule maths. Internal, pure: no client grant.
-- ---------------------------------------------------------------------------
create or replace function app.checklist_is_scheduled(
  p_kind       text,
  p_weekdays   smallint[],
  p_month_days smallint[],
  p_day        date
) returns boolean
language sql immutable set search_path = public as $checklist_is_scheduled_0323$
  select case p_kind
           when 'weekdays' then
             coalesce(extract(dow from p_day)::smallint = any(p_weekdays), false)
           when 'monthdays' then
             exists (select 1
                       from unnest(p_month_days) m
                      where least(m::int,
                                  extract(day from (date_trunc('month', p_day) + interval '1 month - 1 day'))::int)
                            = extract(day from p_day)::int)
           else false
         end
$checklist_is_scheduled_0323$;

comment on function app.checklist_is_scheduled(text, smallint[], smallint[], date) is
  'checklist_schedules (0323). Internal, pure: true when p_day is a scheduled day of the rule. weekdays: its day of the week (0 = Sunday) is in p_weekdays. monthdays: its date is in p_month_days, a date past the month''s end counting as the month''s last day (31 = the last day; 30 and 31 both fall on 28 February).';

revoke all on function app.checklist_is_scheduled(text, smallint[], smallint[], date) from public, anon, authenticated;

create or replace function app.checklist_occurrence(
  p_kind       text,
  p_weekdays   smallint[],
  p_month_days smallint[],
  p_day        date
) returns table (period_start date, period_end date)
language sql immutable set search_path = public as $checklist_occurrence_0323$
  select x.s,
         (select min(x.s + i)
            from generate_series(1, 40) i
           where app.checklist_is_scheduled(p_kind, p_weekdays, p_month_days, x.s + i)) - 1
    from (select max(p_day - i) as s
            from generate_series(0, 40) i
           where app.checklist_is_scheduled(p_kind, p_weekdays, p_month_days, p_day - i)) x
   where x.s is not null
$checklist_occurrence_0323$;

comment on function app.checklist_occurrence(text, smallint[], smallint[], date) is
  'checklist_schedules (0323). Internal, pure: the occurrence of the rule that holds business date p_day, {period_start: the latest scheduled day on or before p_day, period_end: the day before the next scheduled day}. No row for a rule with no scheduled day (an empty list). A weekly rule spans at most 7 days and a monthly one at most 31, so 40 days either way always finds both ends.';

revoke all on function app.checklist_occurrence(text, smallint[], smallint[], date) from public, anon, authenticated;

create or replace function app.checklist_due_at(
  p_venue    uuid,
  p_slot     text,
  p_due_time time,
  p_start    date
) returns timestamptz
language plpgsql stable security definer set search_path = public as $checklist_due_at_0323$
declare
  v_tz    text;
  v_h     int;
  v_hours jsonb;
  v_next  jsonb;
  v_s     interval;
  v_e     interval;
  v_tail  interval;
begin
  select v.timezone into v_tz from venues v where v.id = p_venue;
  v_tz := coalesce(v_tz, 'Asia/Baghdad');
  v_h := coalesce(app.cafe_setting_int('analytics_business_day_start_hour', p_venue), 4);
  if v_h not between 0 and 23 then
    v_h := 4;
  end if;

  -- A typed time: that wall-clock time of business day S, which runs from the
  -- start hour on S to the start hour on S + 1.
  if p_due_time is not null then
    return (p_start + p_due_time
            + case when p_due_time < make_time(v_h, 0, 0) then interval '1 day' else interval '0' end)
           at time zone v_tz;
  end if;

  -- The branch's hours ({"mon": [["09:00","24:00"]], ...}, per calendar day).
  -- Malformed hours fall through to the start-hour fallback below.
  begin
    select vs.opening_hours -> lower(to_char(p_start, 'Dy')),
           vs.opening_hours -> lower(to_char(p_start + 1, 'Dy'))
      into v_hours, v_next
      from venue_settings vs
     where vs.venue_id = p_venue
     limit 1;
    if jsonb_typeof(v_hours) <> 'array' then
      v_hours := '[]'::jsonb;
    end if;
    if jsonb_typeof(v_next) <> 'array' then
      v_next := '[]'::jsonb;
    end if;

    -- The day's own windows: not 00:00-<24:00, the previous night's tail.
    if p_slot = 'open' then
      select (w ->> 0)::interval into v_s
        from jsonb_array_elements(v_hours) w
       where not ((w ->> 0)::interval = interval '0' and (w ->> 1)::interval < interval '24 hours')
       order by (w ->> 0)::interval
       limit 1;
      if v_s is not null then
        return (p_start + v_s) at time zone v_tz;
      end if;
    else
      select (w ->> 0)::interval, (w ->> 1)::interval into v_s, v_e
        from jsonb_array_elements(v_hours) w
       where not ((w ->> 0)::interval = interval '0' and (w ->> 1)::interval < interval '24 hours')
       order by (w ->> 0)::interval desc
       limit 1;
      if v_e is not null then
        if v_e >= interval '24 hours' then
          -- Open to midnight: the night closes at the next day's tail end.
          select (t ->> 1)::interval into v_tail
            from jsonb_array_elements(v_next) t
           where (t ->> 0)::interval = interval '0' and (t ->> 1)::interval < interval '24 hours'
           limit 1;
          return (p_start + interval '1 day' + coalesce(v_tail, interval '0')) at time zone v_tz;
        elsif v_e <= v_s then
          return (p_start + interval '1 day' + v_e) at time zone v_tz;
        end if;
        return (p_start + v_e) at time zone v_tz;
      end if;
    end if;
  exception when others then
    null;
  end;

  -- No hours that day (or no settings row): the business day's edges.
  if p_slot = 'open' then
    return (p_start + make_interval(hours => v_h)) at time zone v_tz;
  end if;
  return (p_start + interval '1 day' + make_interval(hours => v_h) - interval '1 minute') at time zone v_tz;
end $checklist_due_at_0323$;

comment on function app.checklist_due_at(uuid, text, time, date) is
  'checklist_schedules (0323). Internal: when an occurrence starting on business day p_start is due, in the branch''s timezone. A typed p_due_time on that business day (before the start hour means after midnight, S + 1). Else from venue_settings.opening_hours of S: slot open the first own window''s start (a 00:00-<24:00 window is the previous night''s tail and is skipped), slot close the last own window''s end (24:00 continues to the next day''s tail end; an end at or before its start is after midnight). No hours: open S at the start hour, close S + 1 at the start hour less a minute. Never raises.';

revoke all on function app.checklist_due_at(uuid, text, time, date) from public, anon, authenticated;

-- A run is current on p_day while its occurrence holds the day and no newer
-- run of the same list has started (an owner's schedule edit).
create or replace function app.checklist_current(
  p_template uuid,
  p_start    date,
  p_end      date,
  p_day      date
) returns boolean
language sql stable security definer set search_path = public as $checklist_current_0323$
  select p_start <= p_day
     and coalesce(p_end, p_start) >= p_day
     and not exists (select 1 from checklist_runs n
                      where n.template_id = p_template
                        and n.business_date > p_start
                        and n.business_date <= p_day)
$checklist_current_0323$;

comment on function app.checklist_current(uuid, date, date, date) is
  'checklist_schedules (0323). Internal: true when a run of p_template that started on p_start and ends on p_end is the list''s current one on business day p_day: the day is inside its occurrence and no newer run of the list started on or before it.';

revoke all on function app.checklist_current(uuid, date, date, date) from public, anon, authenticated;

create or replace function app.checklist_on_leave(p_staff uuid, p_day date)
returns boolean
language sql stable security definer set search_path = public as $checklist_on_leave_0323$
  select exists (select 1 from staff_requests r
                  where r.staff_id = p_staff
                    and r.kind = 'leave'
                    and r.status = 'approved'
                    and r.from_date <= p_day
                    and r.to_date >= p_day)
$checklist_on_leave_0323$;

comment on function app.checklist_on_leave(uuid, date) is
  'checklist_schedules (0323). Internal: true when the staff member has approved leave (staff_requests kind leave, status approved) covering p_day. They get no copy of an occurrence starting that day and no checklist push.';

revoke all on function app.checklist_on_leave(uuid, date) from public, anon, authenticated;

create or replace function app.checklist_member_at(p_staff uuid, p_venue uuid)
returns boolean
language sql stable security definer set search_path = public as $checklist_member_at_0323$
  select exists (select 1 from staff s
                  where s.id = p_staff
                    and s.is_active
                    and (s.role = 'owner'
                         or exists (select 1
                                      from staff_venues sv
                                      join venues v on v.id = sv.venue_id and v.status <> 'closed'
                                     where sv.staff_id = s.id
                                       and sv.venue_id = p_venue)))
$checklist_member_at_0323$;

comment on function app.checklist_member_at(uuid, uuid) is
  'checklist_schedules (0323). Internal: true when the staff member is active and works at the branch (a staff_venues row at a branch that is not closed, the membership app.is_staff_at reads); an owner works at every branch.';

revoke all on function app.checklist_member_at(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Backfill: the runs made before 0323 are one-day occurrences, due by the
--    rule, and count as pushed.
-- ---------------------------------------------------------------------------
update checklist_runs r
   set period_end        = r.business_date,
       due_at            = app.checklist_due_at(r.venue_id, r.slot, null, r.business_date),
       due_pushed_at     = coalesce(r.due_pushed_at, now()),
       overdue_pushed_at = coalesce(r.overdue_pushed_at, now())
 where r.period_end is null;

-- ---------------------------------------------------------------------------
-- 6. app.checklist_materialize — internal: the current occurrence's runs.
-- ---------------------------------------------------------------------------
create or replace function app.checklist_materialize(p_venue uuid, p_date date)
returns int
language plpgsql security definer set search_path = public as $checklist_materialize_0323$
declare
  v_tpl    record;
  v_start  date;
  v_end    date;
  v_due    timestamptz;
  v_people uuid[];
  v_person uuid;
  v_run    uuid;
  v_n      int := 0;
begin
  if p_venue is null or p_date is null then
    return 0;
  end if;

  for v_tpl in
    select t.*
      from checklist_templates t
     where t.venue_id = p_venue
       and t.archived_at is null
       and exists (select 1 from checklist_template_items i where i.template_id = t.id)
     order by t.id
  loop
    v_start := null;
    select o.period_start, o.period_end into v_start, v_end
      from app.checklist_occurrence(v_tpl.repeat_kind, v_tpl.weekdays, v_tpl.month_days, p_date) o;
    continue when v_start is null;

    -- The edit applies from the next occurrence (§0). A run of another
    -- occurrence that reaches into this one (the rule was edited since: a run
    -- that started after S, or an older run whose period runs to S or past it)
    -- runs out first; the new rule starts on its first scheduled day after.
    -- So a half-ticked copy never closes under an edit, and no copy is ever
    -- born for a day that is already over.
    continue when exists (select 1 from checklist_runs r
                           where r.template_id = v_tpl.id
                             and r.business_date <> v_start
                             and r.business_date <= p_date
                             and coalesce(r.period_end, r.business_date) >= v_start);
    -- A list first saved, or saved with nothing running, after S has started
    -- starts on its next scheduled day: a list on the 1st made on the 8th is
    -- not born overdue since the 1st. An occurrence already running (it has a
    -- run) keeps taking holders who joined since (§1.3).
    continue when v_start < app.venue_business_date(p_venue, v_tpl.updated_at)
              and not exists (select 1 from checklist_runs r
                               where r.template_id = v_tpl.id
                                 and r.business_date = v_start);

    v_due := app.checklist_due_at(p_venue, v_tpl.slot, v_tpl.due_time, v_start);

    if v_tpl.audience = 'role' and v_tpl.copy_mode = 'shared' then
      -- Started as everyone's own copy: it stays so until it ends.
      continue when exists (select 1 from checklist_runs r
                             where r.template_id = v_tpl.id
                               and r.business_date = v_start
                               and r.assignee_id is not null);
      v_people := array[null::uuid];
    else
      continue when exists (select 1 from checklist_runs r
                             where r.template_id = v_tpl.id
                               and r.business_date = v_start
                               and r.assignee_id is null);
      if v_tpl.audience = 'role' then
        select coalesce(array_agg(s.id order by s.id), '{}'::uuid[]) into v_people
          from staff s
         where s.role = v_tpl.role
           and app.checklist_member_at(s.id, p_venue)
           and not app.checklist_on_leave(s.id, v_start);
      else
        -- Someone the owner put on the list after S started gets their first
        -- copy from the next occurrence (the edit rule, per person).
        select coalesce(array_agg(a.staff_id order by a.staff_id), '{}'::uuid[]) into v_people
          from checklist_assignees a
         where a.template_id = v_tpl.id
           and app.checklist_member_at(a.staff_id, p_venue)
           and not app.checklist_on_leave(a.staff_id, v_start)
           and app.venue_business_date(p_venue, a.created_at) <= v_start;
      end if;
    end if;

    foreach v_person in array v_people loop
      v_run := null;
      insert into checklist_runs (venue_id, template_id, role, slot, business_date, assignee_id,
                                  period_end, due_at)
      values (p_venue, v_tpl.id, v_tpl.role, v_tpl.slot, v_start, v_person, v_end, v_due)
      on conflict do nothing
      returning id into v_run;
      if v_run is not null then
        insert into checklist_run_items (run_id, position, text_en, text_ar, photo_required)
        select v_run, i.position, i.text_en, i.text_ar, i.photo_required
          from checklist_template_items i
         where i.template_id = v_tpl.id;
        v_n := v_n + 1;
      end if;
    end loop;
  end loop;

  return v_n;
end $checklist_materialize_0323$;

comment on function app.checklist_materialize(uuid, date) is
  'checklist_schedules (0323). Internal: creates the runs of the occurrence holding business day p_date for every live list with lines at the branch, each a snapshot of the lines and the due time: one shared run for a shared role list, one per active holder of the role at the branch for an each list, one per active assignee at the branch for a people list, skipping anyone on approved leave on the occurrence''s first day and anyone put on a people list after that day. An occurrence already running in the other shape, or a run of another occurrence that reaches into this one (an edit), is left to run out, and the new rule starts on its first scheduled day after; a list saved after its occurrence started, with nothing running, starts on its next scheduled day. Idempotent; returns the runs created. Called by my_checklists_today, checklist_board (today) and checklist_sweep.';

revoke all on function app.checklist_materialize(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.my_checklists_today — 0184 plus the schedule: the caller's shared
--    role lists and their own copies current today.
-- ---------------------------------------------------------------------------
create or replace function app.my_checklists_today(p_venue_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $my_checklists_today_0323$
declare
  v_role  staff_role := app.staff_role();
  v_venue uuid;
  v_date  date;
  v_lists jsonb;
begin
  if v_role is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  v_date := app.venue_business_date(v_venue);

  -- Two phones opening the list at once: the second insert waits for the
  -- first and does nothing, and the read below sees the first one's lines.
  perform app.checklist_materialize(v_venue, v_date);

  select coalesce(jsonb_agg(jsonb_build_object(
           'run_id',       x.id,
           'role',         x.role,
           'slot',         x.slot,
           'name_en',      x.name_en,
           'name_ar',      x.name_ar,
           'done',         x.done,
           'total',        x.total,
           'items',        (select coalesce(jsonb_agg(jsonb_build_object(
                                     'id',             i.id,
                                     'position',       i.position,
                                     'text_en',        i.text_en,
                                     'text_ar',        i.text_ar,
                                     'done_by_name',   s.display_name,
                                     'done_at',        i.done_at,
                                     'note',           i.note,
                                     'photo_required', i.photo_required,
                                     'photo_path',     i.photo_path)
                                   order by i.position, i.id), '[]'::jsonb)
                              from checklist_run_items i
                              left join staff s on s.id = i.done_by
                             where i.run_id = x.id),
           'template_id',  x.template_id,
           'audience',     x.audience,
           'copy_mode',    x.copy_mode,
           'repeat_kind',  x.repeat_kind,
           'weekdays',     to_jsonb(x.weekdays),
           'month_days',   to_jsonb(x.month_days),
           'period_start', x.business_date,
           'period_end',   x.period_end,
           'due_at',       x.due_at,
           'overdue',      x.overdue,
           'assignee_id',  x.assignee_id,
           -- A typed due time (HH:MM): the slot is then only derived from it,
           -- so the phone labels the list by its due line, not "Opening".
           'due_time',     to_char(x.due_time, 'HH24:MI'))
         order by (x.done < x.total and x.overdue) desc, (x.done < x.total) desc,
                  x.due_at nulls last, case x.slot when 'open' then 1 else 2 end, x.id), '[]'::jsonb)
    into v_lists
    from (
      select r.id, r.role, r.slot, r.template_id, r.business_date, r.period_end, r.due_at,
             r.assignee_id, t.name_en, t.name_ar, t.audience, t.copy_mode, t.repeat_kind,
             t.weekdays, t.month_days, t.due_time, c.done, c.total,
             coalesce(now() > r.due_at and c.done < c.total, false) as overdue
        from checklist_runs r
        join checklist_templates t on t.id = r.template_id
        cross join lateral (
          select count(*) filter (where i.done_at is not null) as done, count(*) as total
            from checklist_run_items i
           where i.run_id = r.id
        ) c
       where r.venue_id = v_venue
         and t.archived_at is null
         and r.business_date <= v_date
         and app.checklist_current(r.template_id, r.business_date, r.period_end, v_date)
         and ((r.assignee_id is null and r.role = v_role)
              or r.assignee_id = auth.uid())
    ) x;

  return jsonb_build_object('business_date', v_date, 'lists', v_lists);
end $my_checklists_today_0323$;

comment on function app.my_checklists_today(uuid) is
  'checklists (§2.14), re-issued by checklist_photos (§2.24.8) and checklist_schedules (0323). Any active staff member at the venue: the lists current on today''s business day that are the caller''s, the shared lists of their role and their own copies, {business_date, lists: [{run_id, role, slot, name_en, name_ar, done, total, items: [{id, position, text_en, text_ar, done_by_name, done_at, note, photo_required, photo_path}], template_id, audience, copy_mode, repeat_kind, weekdays, month_days, period_start, period_end, due_at, overdue, assignee_id, due_time (HH:MM, or null when due at opening or closing)}]}: unfinished overdue first, then unfinished by due time, then finished. Creates the current occurrence''s runs at the branch first (app.checklist_materialize). Archived lists are left out. FORBIDDEN for a venue the caller does not work at.';

revoke all on function app.my_checklists_today(uuid) from public, anon;
grant execute on function app.my_checklists_today(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.mark_checklist_item — 0184 plus the person guard and CHECKLIST_CLOSED.
-- ---------------------------------------------------------------------------
create or replace function app.mark_checklist_item(
  p_item_id    uuid,
  p_done       boolean,
  p_note       text default null,
  p_photo_path text default null
) returns jsonb
language plpgsql security definer set search_path = public as $mark_checklist_item_0323$
declare
  v_item  checklist_run_items%rowtype;
  v_run   checklist_runs%rowtype;
  v_note  text;
  v_photo text := nullif(btrim(coalesce(p_photo_path, '')), '');
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_item from checklist_run_items where id = p_item_id for update;
  if found then
    select * into v_run from checklist_runs where id = v_item.run_id;
  end if;
  if v_run.id is null or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'CHECKLIST_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- 0323: a person's copy is theirs (or MGMT's); a shared list is its role's.
  if v_run.assignee_id is not null then
    if not (v_run.assignee_id = auth.uid()
            or app.is_staff_at(v_run.venue_id, 'manager', 'owner')) then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
  elsif not (app.is_staff_at(v_run.venue_id, v_run.role)
             or app.is_staff_at(v_run.venue_id, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);

  -- 0323: a list that ended (its occurrence is over, the next one started, or
  -- the owner archived it) takes no more ticks.
  if not app.checklist_current(v_run.template_id, v_run.business_date, v_run.period_end,
                               app.venue_business_date(v_run.venue_id))
     or exists (select 1 from checklist_templates t
                 where t.id = v_run.template_id and t.archived_at is not null) then
    raise exception 'CHECKLIST_CLOSED' using errcode = 'P0001';
  end if;

  if p_done is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'done';
  end if;
  if p_note is not null then
    v_note := nullif(btrim(p_note), '');
    if length(v_note) > 300 then
      raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
    end if;
  end if;

  -- checklist_photos (#69): a line that needs a photo is ticked with one, the
  -- one sent or the one it already carries. An untick sends none.
  if p_done then
    if v_item.photo_required and coalesce(v_photo, v_item.photo_path) is null then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'photo_path';
    end if;
    if v_photo is not null then
      perform app.claim_staff_media(array[v_photo], v_run.venue_id, array['checklists'],
                                    'checklist_item:' || v_item.id::text);
    end if;
  end if;

  update checklist_run_items
     set done_by    = case when p_done then coalesce(done_by, auth.uid()) end,
         done_at    = case when p_done then coalesce(done_at, now()) end,
         note       = case when p_note is null then note else v_note end,
         photo_path = case when p_done then coalesce(v_photo, photo_path) end
   where id = p_item_id
   returning * into v_item;

  return jsonb_build_object(
    'id',             v_item.id,
    'position',       v_item.position,
    'text_en',        v_item.text_en,
    'text_ar',        v_item.text_ar,
    'done_by_name',   (select s.display_name from staff s where s.id = v_item.done_by),
    'done_at',        v_item.done_at,
    'note',           v_item.note,
    'photo_required', v_item.photo_required,
    'photo_path',     v_item.photo_path);
end $mark_checklist_item_0323$;

comment on function app.mark_checklist_item(uuid, boolean, text, text) is
  'checklists (§2.14), re-created by checklist_photos (§2.24.8) with p_photo_path, re-issued by checklist_schedules (0323). Ticks (p_done true) or unticks one line of a current list: a person''s copy by that person or MGMT at its venue, a shared list by anyone holding its role at its venue or MGMT. A repeat tick keeps the first ticker and time. A line that needs a photo is ticked only with one, sent now (a checklists slot of the caller, claimed as checklist_item:<id>) or already on it; any line may carry one; a new photo replaces the line''s; an untick clears it. p_note (at most 300) sets the line''s note, blank clears it, NULL leaves it. Returns the line {id, position, text_en, text_ar, done_by_name, done_at, note, photo_required, photo_path}. CHECKLIST_NOT_FOUND for a line at a venue the caller does not work at; FORBIDDEN for another role or person; CHECKLIST_CLOSED for a list whose occurrence ended, was replaced by the next, or was archived; RECORD_INVALID (hint photo_path); PHOTO_PATH_INVALID; TEXT_TOO_LONG (hint note).';

revoke all on function app.mark_checklist_item(uuid, boolean, text, text) from public, anon;
grant execute on function app.mark_checklist_item(uuid, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.save_checklist — the owner writes one list: who, how it repeats,
--    when it is due, and its lines.
-- ---------------------------------------------------------------------------
create or replace function app.save_checklist(
  p_venue_id         uuid,
  p_template_id      uuid,
  p_expected_version int,
  p_spec             jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $save_checklist_0323$
declare
  v_venue    uuid;
  v_en       text;
  v_ar       text;
  v_audience text;
  v_role_txt text;
  v_role     staff_role;
  v_copy     text;
  v_kind     text;
  v_slot_in  text;
  v_slot     text;
  v_due_txt  text;
  v_due      time;
  v_wd       smallint[] := '{0,1,2,3,4,5,6}';
  v_md       smallint[];
  v_staff    uuid[] := '{}';
  v_el       jsonb;
  v_ten      text;
  v_tar      text;
  v_texts    text[] := '{}';
  v_textsa   text[] := '{}';
  v_photos   boolean[] := '{}';
  v_before   int;
  v_tpl      checklist_templates%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id,
                      (select t.venue_id from checklist_templates t where t.id = p_template_id),
                      app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  if p_spec is null or jsonb_typeof(p_spec) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'spec';
  end if;

  -- Name, both languages.
  v_en := nullif(btrim(coalesce(p_spec ->> 'name_en', '')), '');
  v_ar := nullif(btrim(coalesce(p_spec ->> 'name_ar', '')), '');
  if v_en is null or v_ar is null then
    raise exception 'TEXT_BOTH_LANGUAGES_REQUIRED' using errcode = 'P0001', hint = 'name';
  end if;
  if length(v_en) > 120 or length(v_ar) > 120 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'name';
  end if;

  -- Who.
  v_audience := p_spec ->> 'audience';
  if v_audience is null or v_audience not in ('role', 'people') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'audience';
  end if;
  if v_audience = 'role' then
    v_role_txt := p_spec ->> 'role';
    if v_role_txt is null
       or not (v_role_txt = any(enum_range(null::staff_role)::text[])) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'role';
    end if;
    v_role := v_role_txt::staff_role;
    if v_role = 'prep' then
      raise exception 'INVALID_ROLE' using errcode = 'P0001', hint = 'role';
    end if;
    v_copy := coalesce(p_spec ->> 'copy_mode', 'shared');
    if v_copy not in ('shared', 'each') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'copy_mode';
    end if;
  else
    v_role := null;
    v_copy := coalesce(p_spec ->> 'copy_mode', 'each');
    if v_copy <> 'each' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'copy_mode';
    end if;
    -- Each test only once the shape before it holds (OR does not promise an order).
    if jsonb_typeof(p_spec -> 'staff_ids') is distinct from 'array' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'staff_ids';
    end if;
    if jsonb_array_length(p_spec -> 'staff_ids') not between 1 and 50
       or exists (select 1 from jsonb_array_elements(p_spec -> 'staff_ids') e
                   where jsonb_typeof(e) <> 'string'
                      or (e #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'staff_ids';
    end if;
    select array_agg(distinct (e #>> '{}')::uuid) into v_staff
      from jsonb_array_elements(p_spec -> 'staff_ids') e;
    if exists (select 1 from unnest(v_staff) x(id) where not app.checklist_member_at(x.id, v_venue)) then
      raise exception 'ASSIGNEE_NOT_AT_BRANCH' using errcode = 'P0001', hint = 'staff_ids';
    end if;
  end if;

  -- How it repeats.
  v_kind := p_spec ->> 'repeat_kind';
  if v_kind is null or v_kind not in ('weekdays', 'monthdays') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'repeat_kind';
  end if;
  if v_kind = 'weekdays' then
    if jsonb_typeof(p_spec -> 'weekdays') is distinct from 'array' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'weekdays';
    end if;
    if jsonb_array_length(p_spec -> 'weekdays') not between 1 and 7
       or exists (select 1 from jsonb_array_elements(p_spec -> 'weekdays') e
                   where jsonb_typeof(e) <> 'number' or (e #>> '{}') !~ '^[0-6]$')
       or (select count(distinct e #>> '{}') from jsonb_array_elements(p_spec -> 'weekdays') e)
          <> jsonb_array_length(p_spec -> 'weekdays') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'weekdays';
    end if;
    select array_agg((e #>> '{}')::smallint order by (e #>> '{}')::smallint) into v_wd
      from jsonb_array_elements(p_spec -> 'weekdays') e;
    v_md := null;
  else
    if jsonb_typeof(p_spec -> 'month_days') is distinct from 'array' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'month_days';
    end if;
    if jsonb_array_length(p_spec -> 'month_days') not between 1 and 4
       or exists (select 1 from jsonb_array_elements(p_spec -> 'month_days') e
                   where jsonb_typeof(e) <> 'number' or (e #>> '{}') !~ '^([1-9]|[12][0-9]|3[01])$')
       or (select count(distinct e #>> '{}') from jsonb_array_elements(p_spec -> 'month_days') e)
          <> jsonb_array_length(p_spec -> 'month_days') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'month_days';
    end if;
    select array_agg((e #>> '{}')::smallint order by (e #>> '{}')::smallint) into v_md
      from jsonb_array_elements(p_spec -> 'month_days') e;
    v_wd := '{0,1,2,3,4,5,6}';
  end if;

  -- When it is due.
  v_slot_in := p_spec ->> 'slot';
  if v_slot_in is null or v_slot_in not in ('open', 'close', 'time') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'slot';
  end if;
  if v_slot_in = 'time' then
    v_due_txt := p_spec ->> 'due_time';
    if v_due_txt is null or v_due_txt !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'due_time';
    end if;
    v_due := v_due_txt::time;
    v_slot := case when v_due < time '14:00' then 'open' else 'close' end;
  else
    v_due := null;
    v_slot := v_slot_in;
  end if;

  -- The lines (save_checklist_template's limits).
  if jsonb_typeof(p_spec -> 'items') is distinct from 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
  end if;
  if jsonb_array_length(p_spec -> 'items') > 30 then
    raise exception 'LIST_TOO_LONG' using errcode = 'P0001', hint = 'items';
  end if;
  for v_el in select e from jsonb_array_elements(p_spec -> 'items') e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
    end if;
    v_ten := nullif(btrim(coalesce(v_el ->> 'text_en', '')), '');
    v_tar := nullif(btrim(coalesce(v_el ->> 'text_ar', '')), '');
    if v_ten is null or v_tar is null then
      raise exception 'TEXT_BOTH_LANGUAGES_REQUIRED' using errcode = 'P0001', hint = 'items';
    end if;
    if length(v_ten) > 200 or length(v_tar) > 200 then
      raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'items';
    end if;
    if coalesce(jsonb_typeof(v_el -> 'photo_required'), 'null') not in ('boolean', 'null') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
    end if;
    v_texts  := v_texts  || v_ten;
    v_textsa := v_textsa || v_tar;
    v_photos := v_photos || coalesce((v_el ->> 'photo_required')::boolean, false);
  end loop;

  if p_template_id is null then
    if coalesce(p_expected_version, 0) <> 0 then
      raise exception 'TEMPLATE_CHANGED' using errcode = 'P0001';
    end if;
    v_before := 0;
    insert into checklist_templates (venue_id, role, slot, name_en, name_ar, version, updated_by,
                                     audience, copy_mode, repeat_kind, weekdays, month_days, due_time)
    values (v_venue, v_role, v_slot, v_en, v_ar, 1, auth.uid(),
            v_audience, v_copy, v_kind, v_wd, v_md, v_due)
    returning * into v_tpl;
  else
    select * into v_tpl from checklist_templates
     where id = p_template_id and venue_id = v_venue
     for update;
    if not found or v_tpl.archived_at is not null then
      raise exception 'CHECKLIST_NOT_FOUND' using errcode = 'P0001';
    end if;
    if p_expected_version is distinct from v_tpl.version then
      raise exception 'TEMPLATE_CHANGED' using errcode = 'P0001';
    end if;
    v_before := v_tpl.version;
    update checklist_templates
       set name_en = v_en, name_ar = v_ar, role = v_role, slot = v_slot,
           audience = v_audience, copy_mode = v_copy, repeat_kind = v_kind,
           weekdays = v_wd, month_days = v_md, due_time = v_due,
           version = version + 1, updated_by = auth.uid(), updated_at = now()
     where id = v_tpl.id
     returning * into v_tpl;
    delete from checklist_template_items where template_id = v_tpl.id;
  end if;

  insert into checklist_template_items (template_id, position, text_en, text_ar, photo_required)
  select v_tpl.id, x.o, x.en, v_textsa[x.o], v_photos[x.o]
    from unnest(v_texts) with ordinality as x(en, o);

  -- The people, replaced whole (none for a role list). Someone who stays on
  -- the list keeps their row and its created_at, which says from which
  -- occurrence they get a copy (checklist_materialize).
  delete from checklist_assignees
   where template_id = v_tpl.id
     and not (staff_id = any(v_staff));
  insert into checklist_assignees (template_id, staff_id, venue_id)
  select v_tpl.id, x.id, v_venue
    from unnest(v_staff) x(id)
  on conflict (template_id, staff_id) do nothing;

  perform app.write_audit('checklist.save', 'checklist_template', v_tpl.id::text,
                          jsonb_build_object('version', v_before),
                          jsonb_build_object('audience', v_audience, 'role', v_role, 'copy_mode', v_copy,
                                             'repeat_kind', v_kind, 'weekdays', to_jsonb(v_wd),
                                             'month_days', to_jsonb(v_md), 'slot', v_slot,
                                             'due_time', to_char(v_due, 'HH24:MI'),
                                             'version', v_tpl.version,
                                             'items', cardinality(v_texts),
                                             'people', cardinality(v_staff)));

  return jsonb_build_object('template_id', v_tpl.id, 'version', v_tpl.version);
end $save_checklist_0323$;

comment on function app.save_checklist(uuid, uuid, int, jsonb) is
  'checklist_schedules (0323). Owner only, owner at the branch: creates (p_template_id NULL, expected version 0 or NULL) or rewrites one list from p_spec {name_en, name_ar, audience: role|people, role?, copy_mode: shared|each, staff_ids?: uuid[], repeat_kind: weekdays|monthdays, weekdays?: [0..6] (0 = Sunday), month_days?: [1..31] (31 = the last day), slot: open|close|time, due_time?: HH:MM, items: [{text_en, text_ar, photo_required?}]}. A people list is always each, 1 to 50 people who work at the branch; weekdays 1 to 7 distinct; month_days 1 to 4 distinct; slot time stores due_time and a derived slot (before 14:00 open, else close). Lines and people replaced whole; an occurrence already running keeps its snapshot (the edit applies from the next one). Returns {template_id, version}. INVALID_ARGUMENT (hint spec, audience, role, copy_mode, staff_ids, repeat_kind, weekdays, month_days, slot, due_time, items), INVALID_ROLE (prep), ASSIGNEE_NOT_AT_BRANCH (hint staff_ids), TEMPLATE_CHANGED, CHECKLIST_NOT_FOUND (unknown or archived), LIST_TOO_LONG, TEXT_BOTH_LANGUAGES_REQUIRED, TEXT_TOO_LONG. Audit checklist.save (counts, never the text).';

revoke all on function app.save_checklist(uuid, uuid, int, jsonb) from public, anon;
grant execute on function app.save_checklist(uuid, uuid, int, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. app.archive_checklist — the owner retires a list.
-- ---------------------------------------------------------------------------
create or replace function app.archive_checklist(p_template_id uuid, p_expected_version int)
returns jsonb
language plpgsql security definer set search_path = public as $archive_checklist_0323$
declare
  v_tpl checklist_templates%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_tpl from checklist_templates where id = p_template_id for update;
  if not found or not (v_tpl.venue_id = any(app.staff_venue_ids())) then
    raise exception 'CHECKLIST_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_tpl.venue_id::text, true);
  if p_expected_version is distinct from v_tpl.version then
    raise exception 'TEMPLATE_CHANGED' using errcode = 'P0001';
  end if;
  if v_tpl.archived_at is not null then
    return jsonb_build_object('template_id', v_tpl.id, 'version', v_tpl.version,
                              'archived_at', v_tpl.archived_at);
  end if;

  update checklist_templates
     set archived_at = now(), version = version + 1, updated_by = auth.uid(), updated_at = now()
   where id = v_tpl.id
   returning * into v_tpl;

  perform app.write_audit('checklist.archive', 'checklist_template', v_tpl.id::text,
                          jsonb_build_object('version', v_tpl.version - 1),
                          jsonb_build_object('version', v_tpl.version, 'archived', true));

  return jsonb_build_object('template_id', v_tpl.id, 'version', v_tpl.version,
                            'archived_at', v_tpl.archived_at);
end $archive_checklist_0323$;

comment on function app.archive_checklist(uuid, int) is
  'checklist_schedules (0323). Owner only: archives a list at a branch the owner can see, which hides it everywhere at once, its open runs included (no more ticks: CHECKLIST_CLOSED). p_expected_version is the version read. Returns {template_id, version, archived_at}; an archived list answers as it is. CHECKLIST_NOT_FOUND, TEMPLATE_CHANGED. Audit checklist.archive.';

revoke all on function app.archive_checklist(uuid, int) from public, anon;
grant execute on function app.archive_checklist(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. app.save_checklist_template — 0184, kept for operator stations on the
--     old build: the oldest live role list for (branch, role, slot), under a
--     transaction lock now that the unique key is gone.
-- ---------------------------------------------------------------------------
create or replace function app.save_checklist_template(
  p_venue_id         uuid,
  p_role             staff_role,
  p_slot             text,
  p_expected_version int,
  p_name_en          text,
  p_name_ar          text,
  p_items            jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $save_checklist_template_0323$
declare
  v_venue  uuid;
  v_en     text := nullif(btrim(coalesce(p_name_en, '')), '');
  v_ar     text := nullif(btrim(coalesce(p_name_ar, '')), '');
  v_el     jsonb;
  v_ten    text;
  v_tar    text;
  v_texts  text[] := '{}';
  v_textsa text[] := '{}';
  v_photos boolean[] := '{}';
  v_before int;
  v_tpl    checklist_templates%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  if p_role is null or p_role = 'prep' then
    raise exception 'INVALID_ROLE' using errcode = 'P0001', hint = 'role';
  end if;
  if p_slot is null or p_slot not in ('open', 'close') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'slot';
  end if;
  if v_en is null or v_ar is null then
    raise exception 'TEXT_BOTH_LANGUAGES_REQUIRED' using errcode = 'P0001', hint = 'name';
  end if;
  if length(v_en) > 120 or length(v_ar) > 120 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'name';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'LIST_TOO_LONG' using errcode = 'P0001', hint = 'items';
  end if;
  for v_el in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
    end if;
    v_ten := nullif(btrim(coalesce(v_el->>'text_en', '')), '');
    v_tar := nullif(btrim(coalesce(v_el->>'text_ar', '')), '');
    if v_ten is null or v_tar is null then
      raise exception 'TEXT_BOTH_LANGUAGES_REQUIRED' using errcode = 'P0001', hint = 'items';
    end if;
    if length(v_ten) > 200 or length(v_tar) > 200 then
      raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'items';
    end if;
    -- checklist_photos: "Needs a photo", absent or null meaning no.
    if coalesce(jsonb_typeof(v_el->'photo_required'), 'null') not in ('boolean', 'null') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
    end if;
    v_texts  := v_texts  || v_ten;
    v_textsa := v_textsa || v_tar;
    v_photos := v_photos || coalesce((v_el->>'photo_required')::boolean, false);
  end loop;

  -- 0323: (venue, role, slot) is no longer unique. Two first saves of one
  -- list wait for each other here, so the second finds the first's row.
  perform pg_advisory_xact_lock(
    hashtextextended('checklist_template:' || v_venue::text || ':' || p_role::text || ':' || p_slot, 0));
  select * into v_tpl from checklist_templates
   where venue_id = v_venue and audience = 'role' and role = p_role and slot = p_slot
     and archived_at is null
   order by created_at, id
   limit 1
   for update;
  if not found then
    if coalesce(p_expected_version, 0) <> 0 then
      raise exception 'TEMPLATE_CHANGED' using errcode = 'P0001';
    end if;
    v_before := 0;
    -- A new list from an old build: shared, every day, due at opening or closing.
    insert into checklist_templates (venue_id, role, slot, name_en, name_ar, version, updated_by)
    values (v_venue, p_role, p_slot, v_en, v_ar, 1, auth.uid())
    returning * into v_tpl;
  else
    if p_expected_version is distinct from v_tpl.version then
      raise exception 'TEMPLATE_CHANGED' using errcode = 'P0001';
    end if;
    v_before := v_tpl.version;
    update checklist_templates
       set name_en = v_en, name_ar = v_ar, version = version + 1,
           updated_by = auth.uid(), updated_at = now()
     where id = v_tpl.id
     returning * into v_tpl;
    delete from checklist_template_items where template_id = v_tpl.id;
  end if;

  insert into checklist_template_items (template_id, position, text_en, text_ar, photo_required)
  select v_tpl.id, x.o, x.en, v_textsa[x.o], v_photos[x.o]
    from unnest(v_texts) with ordinality as x(en, o);

  perform app.write_audit('checklist.template.save', 'checklist_template', v_tpl.id::text,
                          jsonb_build_object('version', v_before),
                          jsonb_build_object('role', p_role, 'slot', p_slot, 'version', v_tpl.version,
                                             'items', cardinality(v_texts)));

  return jsonb_build_object('template_id', v_tpl.id, 'version', v_tpl.version);
end $save_checklist_template_0323$;

comment on function app.save_checklist_template(uuid, staff_role, text, int, text, text, jsonb) is
  'checklists (§2.14), re-issued by checklist_photos (§2.24.8) and checklist_schedules (0323, kept for operator stations on the old build). Owner only: writes the oldest live role list for (venue, role, slot) under a transaction lock, names and lines ([{text_en, text_ar, photo_required?}], at most 30, both languages, 200 characters each, photo_required a boolean) replaced whole; its schedule is left as it is. With none, creates one: shared, every day, due at opening or closing. p_expected_version is 0 (or NULL) for a new list, else the version read. Returns {template_id, version}. INVALID_ROLE (prep), INVALID_ARGUMENT (slot, items), TEMPLATE_CHANGED, LIST_TOO_LONG, TEXT_BOTH_LANGUAGES_REQUIRED, TEXT_TOO_LONG. Audit checklist.template.save. An occurrence already running keeps its snapshot.';

revoke all on function app.save_checklist_template(uuid, staff_role, text, int, text, text, jsonb) from public, anon;
grant execute on function app.save_checklist_template(uuid, staff_role, text, int, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. app.checklist_staff_options — MGMT: the picker's people.
-- ---------------------------------------------------------------------------
create or replace function app.checklist_staff_options(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $checklist_staff_options_0323$
declare
  v_venue uuid;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'display_name', s.display_name,
                                                       'role', s.role)
                                    order by s.display_name, s.id), '[]'::jsonb)
            from staff s
           where app.checklist_member_at(s.id, v_venue));
end $checklist_staff_options_0323$;

comment on function app.checklist_staff_options(uuid) is
  'checklist_schedules (0323). MGMT at the branch: the people a list can be for, [{id, display_name, role}], the active staff who work at the branch plus the owners, by name. FORBIDDEN for anyone else.';

revoke all on function app.checklist_staff_options(uuid) from public, anon;
grant execute on function app.checklist_staff_options(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. app.checklist_board — 0184 plus the schedule, the people and every
--     current run. Materialises when the day asked is today, so no longer
--     STABLE.
-- ---------------------------------------------------------------------------
create or replace function app.checklist_board(
  p_venue_id      uuid default null,
  p_business_date date default null
) returns jsonb
language plpgsql volatile security definer set search_path = public as $checklist_board_0323$
declare
  v_venue uuid;
  v_today date;
  v_date  date;
  v_rows  jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_today := app.venue_business_date(v_venue);
  v_date := coalesce(p_business_date, v_today);
  if v_date = v_today then
    perform set_config('app.venue_id', v_venue::text, true);
    perform app.checklist_materialize(v_venue, v_date);
  end if;

  select coalesce(jsonb_agg(b.j || jsonb_build_object(
           'today', (select r from jsonb_array_elements(b.j -> 'runs') with ordinality e(r, n)
                      order by (r ->> 'assignee_id') is null desc, n
                      limit 1))
         order by b.k1, b.k2, b.k3, b.k4, b.k5), '[]'::jsonb)
    into v_rows
    from (
      -- Within a role and slot the oldest list first: an old build edits the
      -- first list of a (role, slot) it reads, and the legacy
      -- save_checklist_template writes the oldest, so both are the same list.
      -- The new operator sorts by name itself.
      select t.role is null as k1, t.role as k2, case t.slot when 'open' then 1 else 2 end as k3,
             t.created_at as k4, t.id as k5,
             jsonb_build_object(
               'template_id', t.id,
               'role',        t.role,
               'slot',        t.slot,
               'name_en',     t.name_en,
               'name_ar',     t.name_ar,
               'version',     t.version,
               'items',       (select coalesce(jsonb_agg(jsonb_build_object(
                                        'position', i.position, 'text_en', i.text_en, 'text_ar', i.text_ar,
                                        'photo_required', i.photo_required)
                                      order by i.position), '[]'::jsonb)
                                 from checklist_template_items i
                                where i.template_id = t.id),
               'audience',    t.audience,
               'copy_mode',   t.copy_mode,
               'repeat_kind', t.repeat_kind,
               'weekdays',    to_jsonb(t.weekdays),
               'month_days',  to_jsonb(t.month_days),
               'due_time',    to_char(t.due_time, 'HH24:MI'),
               'assignees',   (select coalesce(jsonb_agg(jsonb_build_object(
                                        'id', s.id, 'display_name', s.display_name, 'role', s.role)
                                      order by s.display_name, s.id), '[]'::jsonb)
                                 from checklist_assignees a
                                 join staff s on s.id = a.staff_id
                                where a.template_id = t.id),
               'runs',        (select coalesce(jsonb_agg(jsonb_build_object(
                                        'run_id',        x.id,
                                        'assignee_id',   x.assignee_id,
                                        'assignee_name', x.assignee_name,
                                        'period_start',  x.business_date,
                                        'period_end',    x.period_end,
                                        'due_at',        x.due_at,
                                        'overdue',       x.overdue,
                                        'done',          x.done,
                                        'total',         x.total,
                                        'items',         (select coalesce(jsonb_agg(jsonb_build_object(
                                                                  'id',             ri.id,
                                                                  'position',       ri.position,
                                                                  'text_en',        ri.text_en,
                                                                  'text_ar',        ri.text_ar,
                                                                  'done_by_name',   s.display_name,
                                                                  'done_at',        ri.done_at,
                                                                  'note',           ri.note,
                                                                  'photo_required', ri.photo_required,
                                                                  'photo_path',     ri.photo_path)
                                                                order by ri.position, ri.id), '[]'::jsonb)
                                                           from checklist_run_items ri
                                                           left join staff s on s.id = ri.done_by
                                                          where ri.run_id = x.id))
                                      order by (x.done < x.total and x.overdue) desc, x.due_at nulls last,
                                               x.assignee_name nulls first, x.id), '[]'::jsonb)
                                 from (
                                   select r.id, r.assignee_id, p.display_name as assignee_name,
                                          r.business_date, r.period_end, r.due_at, c.done, c.total,
                                          coalesce(now() > r.due_at and c.done < c.total, false) as overdue
                                     from checklist_runs r
                                     left join staff p on p.id = r.assignee_id
                                     cross join lateral (
                                       select count(*) filter (where ri.done_at is not null) as done,
                                              count(*) as total
                                         from checklist_run_items ri
                                        where ri.run_id = r.id
                                     ) c
                                    where r.template_id = t.id
                                      and r.business_date <= v_date
                                      and app.checklist_current(r.template_id, r.business_date,
                                                                r.period_end, v_date)
                                 ) x)
             ) as j
        from checklist_templates t
       where t.venue_id = v_venue
         and t.archived_at is null
    ) b;

  return jsonb_build_object('business_date', v_date, 'templates', v_rows);
end $checklist_board_0323$;

comment on function app.checklist_board(uuid, date) is
  'checklists (§2.14), re-issued by checklist_photos (§2.24.8) and checklist_schedules (0323). MGMT at the venue: {business_date, templates: [{template_id, role, slot, name_en, name_ar, version, items: [{position, text_en, text_ar, photo_required}], audience, copy_mode, repeat_kind, weekdays, month_days, due_time (HH:MM or null), assignees: [{id, display_name, role}], runs: [{run_id, assignee_id, assignee_name, period_start, period_end, due_at, overdue, done, total, items: [{id, position, text_en, text_ar, done_by_name, done_at, note, photo_required, photo_path}]}], today: the shared run, else the first run, else null}]} for the live lists, by role, slot and then oldest first (the list the legacy save_checklist_template writes leads its role and slot), and the runs current on the business day asked (default today). Creates the current occurrence''s runs when the day is today (app.checklist_materialize). The operator opens a photo_path by signed URL. FORBIDDEN for anyone else.';

revoke all on function app.checklist_board(uuid, date) from public, anon;
grant execute on function app.checklist_board(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 14. app.checklist_day_state — 0188 plus one entry per current run. A list
--     with no current run keeps 0188's as-of fallback (one entry, nothing
--     done). A read: it creates no run.
-- ---------------------------------------------------------------------------
create or replace function app.checklist_day_state(
  p_venue_id      uuid default null,
  p_business_date date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $checklist_day_state_0323$
declare
  v_venue uuid;
  v_date  date;
  v_lists jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_date := coalesce(p_business_date, app.venue_business_date(v_venue));

  select coalesce(jsonb_agg(jsonb_build_object(
           'role',          x.role,
           'slot',          x.slot,
           'name_en',       x.name_en,
           'name_ar',       x.name_ar,
           'total',         x.total,
           'done',          x.done,
           'open_items',    x.open_items,
           'template_id',   x.template_id,
           'assignee_name', x.assignee_name,
           'due_at',        x.due_at,
           'overdue',       coalesce(now() > x.due_at and x.done < x.total, false),
           'period_start',  x.period_start,
           'period_end',    x.period_end,
           -- Who and which copy, so two people with one name stay two rows.
           'assignee_id',   x.assignee_id,
           'run_id',        x.run_id)
         order by x.role is null, x.role, case x.slot when 'open' then 1 else 2 end, x.name_en,
                  x.template_id, x.assignee_name nulls first, x.assignee_id nulls first, x.run_id), '[]'::jsonb)
    into v_lists
    from (
      -- The runs current on the day, one entry each.
      select t.role, t.slot, t.name_en, t.name_ar, t.id as template_id,
             p.display_name as assignee_name, r.due_at,
             r.business_date as period_start, r.period_end,
             r.assignee_id, r.id as run_id,
             (select count(*) from checklist_run_items ri where ri.run_id = r.id) as total,
             (select count(*) from checklist_run_items ri
               where ri.run_id = r.id and ri.done_at is not null) as done,
             (select coalesce(jsonb_agg(jsonb_build_object('text_en', ri.text_en, 'text_ar', ri.text_ar)
                                        order by ri.position, ri.id), '[]'::jsonb)
                from checklist_run_items ri
               where ri.run_id = r.id and ri.done_at is null) as open_items
        from checklist_templates t
        join checklist_runs r on r.template_id = t.id
        left join staff p on p.id = r.assignee_id
       where t.venue_id = v_venue
         and t.archived_at is null
         and r.business_date <= v_date
         and app.checklist_current(r.template_id, r.business_date, r.period_end, v_date)
         and (t.audience = 'people'
              or cardinality(app.staff_ids_with_roles(v_venue, array[t.role])) > 0)
         and exists (select 1 from checklist_run_items ri where ri.run_id = r.id)

      union all

      -- 0188: a list nobody opened that day, as it stood at the day's end.
      select t.role, t.slot, t.name_en, t.name_ar, t.id,
             null::text,
             case when o.period_start is not null
                  then app.checklist_due_at(v_venue, t.slot, t.due_time, o.period_start) end,
             o.period_start, o.period_end,
             null::uuid, null::uuid,
             case when c.stood
                  then (select count(*) from checklist_template_items ti where ti.template_id = t.id)
                  else s.items
             end,
             0::bigint,
             case when c.stood
                  then (select coalesce(jsonb_agg(jsonb_build_object('text_en', ti.text_en, 'text_ar', ti.text_ar)
                                                  order by ti.position), '[]'::jsonb)
                          from checklist_template_items ti
                         where ti.template_id = t.id)
                  else '[]'::jsonb
             end
        from checklist_templates t
        -- R7: the template as it stands was last saved on or before the day.
        cross join lateral (
          select app.venue_business_date(v_venue, t.updated_at) <= v_date as stood
        ) c
        -- R7: else its line count at the day's end, from its last save by
        -- then (NULL when it was first saved after the day).
        left join lateral (
          select case when a.after->>'items' ~ '^[0-9]{1,9}$'
                      then (a.after->>'items')::bigint
                 end as items
            from audit_log a
           where not c.stood
             and a.entity = 'checklist_template'
             and a.entity_id = t.id::text
             and a.action in ('checklist.template.save', 'checklist.save')
             and app.venue_business_date(v_venue, a.at) <= v_date
           order by a.at desc, a.id desc
           limit 1
        ) s on true
        left join lateral app.checklist_occurrence(t.repeat_kind, t.weekdays, t.month_days, v_date) o on true
       where t.venue_id = v_venue
         and t.archived_at is null
         and not exists (select 1 from checklist_runs r
                          where r.template_id = t.id
                            and r.business_date <= v_date
                            and app.checklist_current(r.template_id, r.business_date, r.period_end, v_date))
         -- 0323: no warning for a list that has no copy on purpose; the same
         -- rules as checklist_materialize. A run of another occurrence reaches
         -- into this one (an edit: it runs out first, and the new rule starts
         -- after it)...
         and not exists (select 1 from checklist_runs r
                          where r.template_id = t.id
                            and r.business_date <> o.period_start
                            and r.business_date <= v_date
                            and coalesce(r.period_end, r.business_date) >= o.period_start)
         -- ...or the list as it stands was saved after its occurrence started,
         -- with nothing running (it starts on its next scheduled day)...
         and not (c.stood
                  and o.period_start < app.venue_business_date(v_venue, t.updated_at)
                  and not exists (select 1 from checklist_runs r
                                   where r.template_id = t.id
                                     and r.business_date = o.period_start))
         -- ...or nobody gets a copy: a people list or an each list whose
         -- people are all gone, on approved leave on its first day, or (a
         -- people list) put on it after that day. A shared list is the role's.
         and (case when t.audience = 'people'
                   then exists (select 1 from checklist_assignees a
                                 where a.template_id = t.id
                                   and app.checklist_member_at(a.staff_id, v_venue)
                                   and not app.checklist_on_leave(a.staff_id, o.period_start)
                                   and app.venue_business_date(v_venue, a.created_at) <= o.period_start)
                   when t.copy_mode = 'each'
                   then exists (select 1 from staff s
                                 where s.role = t.role
                                   and app.checklist_member_at(s.id, v_venue)
                                   and not app.checklist_on_leave(s.id, o.period_start))
                   else cardinality(app.staff_ids_with_roles(v_venue, array[t.role])) > 0
              end)
         and (case when c.stood
                   then exists (select 1 from checklist_template_items ti where ti.template_id = t.id)
                   else coalesce(s.items, 0) > 0
              end)
    ) x;

  return jsonb_build_object('business_date', v_date, 'lists', v_lists);
end $checklist_day_state_0323$;

comment on function app.checklist_day_state(uuid, date) is
  'checklists (§2.14, plan §7.3), re-issued by checklist_day_state_asof (R7) and checklist_schedules (0323). MGMT at the venue: {business_date, lists: [{role, slot, name_en, name_ar, total, done, open_items: [{text_en, text_ar}], template_id, assignee_name, due_at, overdue, period_start, period_end, assignee_id, run_id}]} for the business day asked (default today): one entry per run current on the day (a role list whose role an active staff member holds at the venue, or a people list), and for a live list with no current run that checklist_materialize would give a copy one entry from the template with nothing done (assignee_name, assignee_id and run_id null, due_at from its schedule); a list left without a copy on purpose (an edit running out the occurrence before it, saved after its occurrence started, or nobody to give one to: gone, on approved leave on its first day, or put on a people list after it) has no entry. For a past day only what stood at the end of that day (the venue''s business day) counts: a list first saved later is left out, and a list saved since counts with the number of lines its last save by then recorded, its lines not named. Archived lists are left out. Day close shows it as a warning, never a block. Creates nothing.';

revoke all on function app.checklist_day_state(uuid, date) from public, anon;
grant execute on function app.checklist_day_state(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 15. app.notify_staff — 0322 verbatim, plus checklist_due and
--     checklist_overdue after shop_price_changed.
-- ---------------------------------------------------------------------------
create or replace function app.notify_staff(
  p_staff_ids uuid[],
  p_kind      text,
  p_payload   jsonb,
  p_dedupe    text default null
) returns int
language plpgsql security definer set search_path = public as $notify_staff_0323$
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
    'checklist_overdue'];
  c_routes     constant text[] := array[
    'staff', 'staff-step', 'staff-run', 'staff-request', 'staff-shopping',
    'staff-checklist', 'staff-notes'];
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
end $notify_staff_0323$;

comment on function app.notify_staff(uuid[], text, jsonb, text) is
  'staff_push (§2.4, §2.21), re-issued by staff_push_keys (§2.24.1), staff_push_keys_wave5, match_guest_rpcs (0261, match_report_new), loyalty_earn_redeem (0308, loyalty_gift), staff_screenshot_report (0313, screenshot_taken), shop_price_watch (0322, shop_price_changed) and checklist_schedules (0323, checklist_due and checklist_overdue). Internal: queues one notification_outbox row per recipient (profile_id = staff.id) and nudges send-push. Skips NULLs, inactive staff and the caller; with p_dedupe, a recipient who got the same dedupe value in the last 15 minutes. INVALID_ARGUMENT for a kind, title_key or route outside _shared/staff-push.json, or a payload key outside {route, id, title_key, params, dedupe} / params key outside {step, title, name}. Returns the rows queued.';

revoke all on function app.notify_staff(uuid[], text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 16. app.checklist_sweep — internal, cron tp_checklist_sweep: materialise
--     each branch's day and push due-soon and overdue lists, once each.
-- ---------------------------------------------------------------------------
create or replace function app.checklist_sweep()
returns int
language plpgsql security definer set search_path = public as $checklist_sweep_0323$
declare
  v_venue  uuid;
  v_date   date;
  v_run    record;
  v_key    text;
  v_to     uuid[];
  v_n      int := 0;
begin
  for v_venue in
    select v.id
      from venues v
     where v.status <> 'closed'
       and exists (select 1 from checklist_templates t
                    where t.venue_id = v.id and t.archived_at is null)
     order by v.id
  loop
    begin
      perform set_config('app.venue_id', v_venue::text, true);
      v_date := app.venue_business_date(v_venue);
      perform app.checklist_materialize(v_venue, v_date);

      for v_run in
        select r.id, r.role, r.assignee_id, r.due_at, r.due_pushed_at, r.overdue_pushed_at,
               t.name_en, t.name_ar
          from checklist_runs r
          join checklist_templates t on t.id = r.template_id
         where r.venue_id = v_venue
           and t.archived_at is null
           and r.business_date <= v_date
           and r.due_at is not null
           and (r.overdue_pushed_at is null
                or (r.due_pushed_at is null and now() < r.due_at))
           and now() >= r.due_at - interval '30 minutes'
           and app.checklist_current(r.template_id, r.business_date, r.period_end, v_date)
           and exists (select 1 from checklist_run_items i where i.run_id = r.id and i.done_at is null)
         order by r.id
      loop
        if now() >= v_run.due_at then
          continue when v_run.overdue_pushed_at is not null;
          v_key := 'checklist_overdue';
          update checklist_runs set overdue_pushed_at = now()
           where id = v_run.id and overdue_pushed_at is null;
        else
          continue when v_run.due_pushed_at is not null;
          v_key := 'checklist_due';
          update checklist_runs set due_pushed_at = now()
           where id = v_run.id and due_pushed_at is null;
        end if;
        -- Another sweep stamped it first.
        continue when not found;

        if v_run.assignee_id is not null then
          -- Only while they still work at the branch (materialise's rule): a
          -- person moved away mid-occurrence gets no push naming its list.
          v_to := case when app.checklist_member_at(v_run.assignee_id, v_venue)
                       then array[v_run.assignee_id] else '{}'::uuid[] end;
        else
          v_to := app.staff_ids_with_roles(v_venue, array[v_run.role]);
          if v_run.role <> 'owner' then
            select coalesce(array_agg(x.id), '{}'::uuid[]) into v_to
              from unnest(v_to) x(id)
             where not exists (select 1 from staff s where s.id = x.id and s.role = 'owner');
          end if;
        end if;
        select coalesce(array_agg(x.id), '{}'::uuid[]) into v_to
          from unnest(v_to) x(id)
         where not app.checklist_on_leave(x.id, v_date);

        if cardinality(v_to) > 0 then
          v_n := v_n + app.notify_staff(
            v_to, 'staff_task',
            jsonb_build_object('route', 'staff-checklist', 'id', v_run.id::text, 'title_key', v_key,
                               'params', jsonb_build_object(
                                 'step', jsonb_build_object('en', v_run.name_en, 'ar', v_run.name_ar))),
            'checklist:' || v_run.id::text || ':' || v_key);
        end if;
      end loop;
    exception when others then
      raise warning 'checklist_sweep venue %: % (%)', v_venue, sqlerrm, sqlstate;
    end;
  end loop;

  return v_n;
end $checklist_sweep_0323$;

comment on function app.checklist_sweep() is
  'checklist_schedules (0323). Internal, service role (cron tp_checklist_sweep, every five minutes). For every branch that is not closed and has a live list, in its own exception block with app.venue_id set: materialises today''s occurrences, then for each current unfinished run with a due time queues one checklist_due staff_task push in the half hour before it is due (due_pushed_at) and one checklist_overdue push once it is past due (overdue_pushed_at; a run created after its due time gets only this one). To the assignee of a person''s copy while they still work at the branch (app.checklist_member_at); for a shared list to the role''s active holders at the branch (app.staff_ids_with_roles) minus the owners unless the list is the owners''; never to anyone on approved leave today. Payload {route staff-checklist, id run, title_key, params {step {en, ar}: the list''s name}}, deduped per run and key. Returns the pushes queued.';

revoke all on function app.checklist_sweep() from public, anon, authenticated;
grant execute on function app.checklist_sweep() to service_role;

-- tp_checklist_sweep: every five minutes, its own transaction. Guarded like
-- 0300's tp_tournament_sweep. After a hosted push, cron.job must have the row
-- (packages/db/CLAUDE.md).
do $checklist_sweep_cron_0323$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_checklist_sweep not scheduled';
    return;
  end if;
  perform cron.schedule('tp_checklist_sweep', '*/5 * * * *', 'select app.checklist_sweep();');
end $checklist_sweep_cron_0323$;

-- ---------------------------------------------------------------------------
-- 17. app.create_branch — 0233 verbatim, plus the schedule columns on the
--     copied checklist templates; people lists and archived lists stay at
--     the source.
-- ---------------------------------------------------------------------------
create or replace function app.create_branch(p_source_venue uuid, p_slug text, p_name_en text, p_name_ar text, p_phone text DEFAULT NULL::text, p_timezone text DEFAULT NULL::text, p_address_en text DEFAULT NULL::text, p_address_ar text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $create_branch_0323$
declare
  v_src     venues%rowtype;
  v_new     uuid := gen_random_uuid();
  v_slug    text := lower(btrim(coalesce(p_slug, '')));
  v_name_en text := btrim(coalesce(p_name_en, ''));
  v_name_ar text := btrim(coalesce(p_name_ar, ''));
  v_phone   text := nullif(btrim(coalesce(p_phone, '')), '');
  v_tz      text;
  v_counts  jsonb := '{}'::jsonb;
  v_n       int;
  v_feat    jsonb;
  v_excl    jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 0233: one copy at a time chain-wide, taken before the slug check, so two
  -- owners asking for one slug get SLUG_TAKEN rather than a unique violation.
  perform pg_advisory_xact_lock(hashtextextended('create_branch', 0));

  select * into v_src from venues where id = p_source_venue;
  if not found then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,31}$' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_slug',
      hint = '2-32 lowercase letters, digits and dashes';
  end if;
  if exists (select 1 from venues where slug = v_slug) then
    raise exception 'SLUG_TAKEN' using errcode = 'P0001';
  end if;
  if char_length(v_name_en) not between 2 and 80 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_name_en';
  end if;
  if char_length(v_name_ar) not between 2 and 80 then
    raise exception 'TEXT_BOTH_LANGUAGES_REQUIRED' using errcode = 'P0001', detail = 'p_name_ar';
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9 ()-]{6,20}$' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_phone';
  end if;
  v_tz := coalesce(nullif(btrim(coalesce(p_timezone, '')), ''), v_src.timezone);
  if not exists (select 1 from pg_timezone_names where name = v_tz) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_timezone';
  end if;

  -- Every write below that relies on a column default files at the new branch.
  perform set_config('app.venue_id', v_new::text, true);

  create temporary table if not exists _branch_map (
    kind   text not null,
    old_id uuid not null,
    new_id uuid not null,
    primary key (kind, old_id)
  ) on commit drop;   -- one per call: every RPC is its own transaction

  -- The branch itself.
  insert into venues (id, slug, name_en, name_ar, timezone, phone, status, address_en, address_ar, map_url)
  values (v_new, v_slug, v_name_en, v_name_ar, v_tz, v_phone, 'preparing',
          nullif(btrim(coalesce(p_address_en, '')), ''), nullif(btrim(coalesce(p_address_ar, '')), ''), null);

  -- Settings: the source's rules and hours, the new branch's identity.
  -- 0233: the chain's own settings (currency, the hold cap, the LLM keys) live
  -- in platform_settings since 0207; their deprecated columns keep defaults.
  insert into venue_settings (id, venue_id, venue_name, timezone, opening_hours, closed_dates,
                              hold_ttl_seconds, protected_horizon_hours, heartbeat_stale_seconds,
                              table_token_ttl_minutes, waiter_call_cooldown_seconds,
                              cancellation_window_hours, cash_rounding_iqd, expiring_soon_days,
                              tax_inclusive, phone, max_booking_horizon_days,
                              guest_orders_per_minute, guest_items_per_order, tab_confirm_threshold_iqd)
  select true, v_new, v_name_en, v_tz, vs.opening_hours, vs.closed_dates,
         vs.hold_ttl_seconds, vs.protected_horizon_hours, vs.heartbeat_stale_seconds,
         vs.table_token_ttl_minutes, vs.waiter_call_cooldown_seconds,
         vs.cancellation_window_hours, vs.cash_rounding_iqd, vs.expiring_soon_days,
         vs.tax_inclusive, v_phone, vs.max_booking_horizon_days,
         vs.guest_orders_per_minute, vs.guest_items_per_order, vs.tab_confirm_threshold_iqd
    from venue_settings vs
   where vs.venue_id = p_source_venue;

  -- Tax groups and suppliers.
  insert into _branch_map select 'tax_group', id, gen_random_uuid() from tax_groups where venue_id = p_source_venue;
  insert into tax_groups (id, venue_id, name_en, name_ar, rate_bp, is_active)
  select m.new_id, v_new, t.name_en, t.name_ar, t.rate_bp, t.is_active
    from tax_groups t join _branch_map m on m.kind = 'tax_group' and m.old_id = t.id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('tax_groups', v_n);

  insert into _branch_map select 'supplier', id, gen_random_uuid() from suppliers where venue_id = p_source_venue;
  insert into suppliers (id, venue_id, name, phone, notes, is_active)
  select m.new_id, v_new, s.name, s.phone, s.notes, s.is_active
    from suppliers s join _branch_map m on m.kind = 'supplier' and m.old_id = s.id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('suppliers', v_n);

  -- Courts and their rates.
  -- Active courts only: a retired court (active_to set) stays history at the source.
  insert into _branch_map select 'court', id, gen_random_uuid() from courts where venue_id = p_source_venue and is_active;
  insert into courts (id, venue_id, name_en, name_ar, description_en, description_ar, indoor, photo_path,
                      duration_options, sort_order, is_active, active_from, active_to)
  select m.new_id, v_new, c.name_en, c.name_ar, c.description_en, c.description_ar, c.indoor, c.photo_path,
         c.duration_options, c.sort_order, c.is_active, null, null
    from courts c join _branch_map m on m.kind = 'court' and m.old_id = c.id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('courts', v_n);

  insert into _branch_map select 'rate_rule', id, gen_random_uuid() from rate_rules where venue_id = p_source_venue;
  insert into rate_rules (id, venue_id, name, court_id, days_of_week, start_time, end_time, priority,
                          valid_from, valid_to, is_active)
  select m.new_id, v_new, r.name, mc.new_id, r.days_of_week, r.start_time, r.end_time, r.priority,
         r.valid_from, r.valid_to, r.is_active
    from rate_rules r
    join _branch_map m on m.kind = 'rate_rule' and m.old_id = r.id
    left join _branch_map mc on mc.kind = 'court' and mc.old_id = r.court_id
   where r.court_id is null or mc.new_id is not null;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('rate_rules', v_n);

  insert into rate_rule_prices (rule_id, duration_min, price_iqd)
  select m.new_id, p.duration_min, p.price_iqd
    from rate_rule_prices p join _branch_map m on m.kind = 'rate_rule' and m.old_id = p.rule_id
   where exists (select 1 from rate_rules r where r.id = m.new_id);

  -- Tables (new ids: new QR codes are printed for the new branch).
  insert into cafe_tables (id, venue_id, table_number, zone, capacity, token_version, is_active, bell_enabled)
  select gen_random_uuid(), v_new, t.table_number, t.zone, t.capacity, 1, t.is_active, t.bell_enabled
    from cafe_tables t where t.venue_id = p_source_venue and t.is_active;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('cafe_tables', v_n);

  -- Menu.
  insert into _branch_map select 'category', id, gen_random_uuid() from menu_categories where venue_id = p_source_venue;
  insert into menu_categories (id, venue_id, name_en, name_ar, tax_group_id, sort_order, is_active, photo_path,
                               photo_blur, serve_temp, kind)
  select m.new_id, v_new, c.name_en, c.name_ar,
         -- 0233: a tax group at another branch (no FK keeps it here) falls
         -- back to the new branch's first one instead of failing the copy.
         coalesce(mt.new_id, (select m2.new_id from _branch_map m2 join tax_groups t2 on t2.id = m2.old_id
                               where m2.kind = 'tax_group' order by t2.is_active desc, t2.name_en limit 1)),
         c.sort_order, c.is_active, c.photo_path,
         c.photo_blur, c.serve_temp, c.kind
    from menu_categories c
    join _branch_map m on m.kind = 'category' and m.old_id = c.id
    left join _branch_map mt on mt.kind = 'tax_group' and mt.old_id = c.tax_group_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('menu_categories', v_n);

  insert into _branch_map
  select 'item', i.id, gen_random_uuid() from menu_items i where i.venue_id = p_source_venue;
  insert into menu_items (id, venue_id, category_id, name_en, name_ar, description_en, description_ar, photo_path,
                          is_active, unavailable_on, sort_order, hook_en, hook_ar, highlight, sold_out,
                          photo_blur, serve_temp, release_run_id, launched_at)
  select m.new_id, v_new, mc.new_id, i.name_en, i.name_ar, i.description_en, i.description_ar, i.photo_path,
         i.is_active, null, i.sort_order, i.hook_en, i.hook_ar, i.highlight, false,
         i.photo_blur, i.serve_temp, null,
         coalesce(i.launched_at, case when i.is_active then now() end)
    from menu_items i
    join _branch_map m  on m.kind = 'item' and m.old_id = i.id
    join _branch_map mc on mc.kind = 'category' and mc.old_id = i.category_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('menu_items', v_n);

  insert into _branch_map
  select 'variant', v.id, gen_random_uuid()
    from menu_item_variants v join _branch_map mi on mi.kind = 'item' and mi.old_id = v.item_id;
  insert into menu_item_variants (id, item_id, name_en, name_ar, price_iqd, is_default, sort_order, sku, barcode)
  select m.new_id, mi.new_id, v.name_en, v.name_ar, v.price_iqd, v.is_default, v.sort_order, v.sku, v.barcode
    from menu_item_variants v
    join _branch_map m  on m.kind = 'variant' and m.old_id = v.id
    join _branch_map mi on mi.kind = 'item' and mi.old_id = v.item_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('menu_item_variants', v_n);

  insert into menu_item_costs (item_id, cost_iqd, updated_at, updated_by)
  select mi.new_id, c.cost_iqd, now(), auth.uid()
    from menu_item_costs c join _branch_map mi on mi.kind = 'item' and mi.old_id = c.item_id;

  insert into menu_item_allergens (item_id, allergen_id)
  select mi.new_id, a.allergen_id
    from menu_item_allergens a join _branch_map mi on mi.kind = 'item' and mi.old_id = a.item_id;

  insert into addon_suggestions (item_id, suggested_item_id, sort_order)
  select ma.new_id, mb.new_id, s.sort_order
    from addon_suggestions s
    join _branch_map ma on ma.kind = 'item' and ma.old_id = s.item_id
    join _branch_map mb on mb.kind = 'item' and mb.old_id = s.suggested_item_id;

  -- Add-ons.
  insert into _branch_map select 'group', id, gen_random_uuid() from modifier_groups where venue_id = p_source_venue;
  insert into modifier_groups (id, venue_id, name_en, name_ar, min_select, max_select)
  select m.new_id, v_new, g.name_en, g.name_ar, g.min_select, g.max_select
    from modifier_groups g join _branch_map m on m.kind = 'group' and m.old_id = g.id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('modifier_groups', v_n);

  insert into _branch_map
  select 'modifier', md.id, gen_random_uuid()
    from modifiers md join _branch_map mg on mg.kind = 'group' and mg.old_id = md.group_id;
  insert into modifiers (id, group_id, name_en, name_ar, price_delta_iqd, sort_order, is_active, launched_at)
  select m.new_id, mg.new_id, md.name_en, md.name_ar, md.price_delta_iqd, md.sort_order, md.is_active,
         coalesce(md.launched_at, case when md.is_active then now() end)
    from modifiers md
    join _branch_map m  on m.kind = 'modifier' and m.old_id = md.id
    join _branch_map mg on mg.kind = 'group' and mg.old_id = md.group_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('modifiers', v_n);

  insert into menu_item_modifier_groups (item_id, group_id, sort_order)
  select mi.new_id, mg.new_id, l.sort_order
    from menu_item_modifier_groups l
    join _branch_map mi on mi.kind = 'item' and mi.old_id = l.item_id
    join _branch_map mg on mg.kind = 'group' and mg.old_id = l.group_id;

  insert into modifier_reveals (modifier_id, group_id, sort_order)
  select mm.new_id, mg.new_id, r.sort_order
    from modifier_reveals r
    join _branch_map mm on mm.kind = 'modifier' and mm.old_id = r.modifier_id
    join _branch_map mg on mg.kind = 'group' and mg.old_id = r.group_id;

  -- Stock definitions (never stock: the new branch starts at zero).
  insert into _branch_map select 'ingredient', id, gen_random_uuid() from ingredients where venue_id = p_source_venue;
  insert into ingredients (id, venue_id, kind, name_en, name_ar, unit, pack_size, pack_cost_iqd, supplier_name,
                           shelf_life_days, yield_percent, waste_allowance_percent, par_level,
                           low_stock_threshold, is_active, variant_id, supplier_id)
  select m.new_id, v_new, i.kind, i.name_en, i.name_ar, i.unit, i.pack_size, i.pack_cost_iqd, i.supplier_name,
         i.shelf_life_days, i.yield_percent, i.waste_allowance_percent, i.par_level,
         i.low_stock_threshold, i.is_active, mv.new_id, ms.new_id
    from ingredients i
    join _branch_map m on m.kind = 'ingredient' and m.old_id = i.id
    left join _branch_map mv on mv.kind = 'variant' and mv.old_id = i.variant_id
    left join _branch_map ms on ms.kind = 'supplier' and ms.old_id = i.supplier_id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('ingredients', v_n);

  insert into recipe_lines (id, variant_id, modifier_id, output_ingredient_id, ingredient_id, qty)
  select gen_random_uuid(), mv.new_id, mm.new_id, mo.new_id, mi.new_id, r.qty
    from recipe_lines r
    join _branch_map mi on mi.kind = 'ingredient' and mi.old_id = r.ingredient_id
    left join _branch_map mv on mv.kind = 'variant'    and mv.old_id = r.variant_id
    left join _branch_map mm on mm.kind = 'modifier'   and mm.old_id = r.modifier_id
    left join _branch_map mo on mo.kind = 'ingredient' and mo.old_id = r.output_ingredient_id
   where (r.variant_id is null or mv.new_id is not null)
     and (r.modifier_id is null or mm.new_id is not null)
     and (r.output_ingredient_id is null or mo.new_id is not null);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('recipe_lines', v_n);

  -- Protocol templates (the source's edited ones), then the defaults for any
  -- kind the source never had.
  insert into _branch_map select 'ptemplate', id, gen_random_uuid() from protocol_templates where venue_id = p_source_venue;
  insert into protocol_templates (id, venue_id, kind, variant, name_en, name_ar, version, updated_by, updated_at)
  select m.new_id, v_new, t.kind, t.variant, t.name_en, t.name_ar, 1, auth.uid(), now()
    from protocol_templates t join _branch_map m on m.kind = 'ptemplate' and m.old_id = t.id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('protocol_templates', v_n);

  insert into _branch_map
  select 'pstep', s.id, gen_random_uuid()
    from protocol_template_steps s join _branch_map mt on mt.kind = 'ptemplate' and mt.old_id = s.template_id;
  insert into protocol_template_steps (id, template_id, position, step_key, name_en, name_ar, actor_roles,
                                       needs_owner_ok, optional)
  select m.new_id, mt.new_id, s.position, s.step_key, s.name_en, s.name_ar, s.actor_roles,
         s.needs_owner_ok, s.optional
    from protocol_template_steps s
    join _branch_map m  on m.kind = 'pstep' and m.old_id = s.id
    join _branch_map mt on mt.kind = 'ptemplate' and mt.old_id = s.template_id;

  insert into protocol_template_items (id, step_id, position, text_en, text_ar)
  select gen_random_uuid(), ms.new_id, i.position, i.text_en, i.text_ar
    from protocol_template_items i join _branch_map ms on ms.kind = 'pstep' and ms.old_id = i.step_id;

  perform app.protocol_seed_venue(v_new);

  -- Checklist templates. 0323: role lists with their schedule; a people list
  -- (its people work at the source) and an archived list stay behind.
  insert into _branch_map select 'ctemplate', id, gen_random_uuid() from checklist_templates
   where venue_id = p_source_venue and audience = 'role' and archived_at is null;
  insert into checklist_templates (id, venue_id, role, slot, name_en, name_ar, version, updated_by, updated_at,
                                   audience, copy_mode, repeat_kind, weekdays, month_days, due_time)
  select m.new_id, v_new, t.role, t.slot, t.name_en, t.name_ar, 1, auth.uid(), now(),
         t.audience, t.copy_mode, t.repeat_kind, t.weekdays, t.month_days, t.due_time
    from checklist_templates t join _branch_map m on m.kind = 'ctemplate' and m.old_id = t.id;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('checklist_templates', v_n);

  insert into checklist_template_items (id, template_id, position, text_en, text_ar, photo_required)
  select gen_random_uuid(), mt.new_id, i.position, i.text_en, i.text_ar, i.photo_required
    from checklist_template_items i join _branch_map mt on mt.kind = 'ctemplate' and mt.old_id = i.template_id;

  -- Cafe settings: the source's values, minus its Telegram group (MV3), with
  -- the featured item and the excluded items pointed at the copies.
  insert into cafe_settings (venue_id, key, value, is_public, updated_at, updated_by)
  select v_new, cs.key, cs.value, cs.is_public, now(), auth.uid()
    from cafe_settings cs
   where cs.venue_id = p_source_venue
     and cs.key not like 'telegram\_%';

  select value into v_feat from cafe_settings where venue_id = v_new and key = 'featured_item_id';
  if v_feat is not null and jsonb_typeof(v_feat) = 'string' then
    update cafe_settings
       set value = coalesce((select to_jsonb(m.new_id::text) from _branch_map m
                              where m.kind = 'item' and m.old_id::text = (v_feat #>> '{}')), 'null'::jsonb)
     where venue_id = v_new and key = 'featured_item_id';
  end if;

  select value into v_excl from cafe_settings where venue_id = v_new and key = 'analytics_excluded_item_ids';
  if v_excl is not null and jsonb_typeof(v_excl) = 'array' then
    update cafe_settings
       set value = coalesce((select jsonb_agg(to_jsonb(m.new_id::text))
                               from jsonb_array_elements_text(v_excl) e
                               join _branch_map m on m.kind = 'item' and m.old_id::text = e), '[]'::jsonb)
     where venue_id = v_new and key = 'analytics_excluded_item_ids';
  end if;

  perform app.write_audit('venue.create', 'venues', v_new::text, null,
    jsonb_build_object('source_venue', p_source_venue, 'slug', v_slug, 'name_en', v_name_en,
                       'name_ar', v_name_ar, 'counts', v_counts));

  return jsonb_build_object('venue_id', v_new, 'slug', v_slug, 'status', 'preparing', 'counts', v_counts);
end $create_branch_0323$;

-- ---------------------------------------------------------------------------
-- 18. app.staff_media_visible — 0238 verbatim, except a checklist tick's photo
--     on a person's copy is that person's (with its uploader and MGMT), not
--     the whole role's.
-- ---------------------------------------------------------------------------
create or replace function app.staff_media_visible(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $staff_media_visible_0323$
declare
  c_sub  constant text := '^protocol_submission:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_ref  constant text := '^(release_idea|checklist_item|teaching|marketing_request):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_content constant text := '^marketing_content:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_up   staff_media_uploads%rowtype;
  v_step protocol_run_steps%rowtype;
  v_run  protocol_runs%rowtype;
  v_kind text;
  v_ref  uuid;
begin
  if not app.is_staff_media_path(p_name) or app.staff_role() is null then
    return false;
  end if;
  select * into v_up from staff_media_uploads where path = p_name;
  if not found or not (v_up.venue_id = any(app.staff_venue_ids())) then
    return false;
  end if;

  -- staff_media_incidents (§2.4, V4): a content item's images are the
  -- uploader's, marketing's and the owners' at its venue, and not a
  -- manager's, so this answers before the MGMT rule below. Nested behind its
  -- table, which a later migration creates.
  if v_up.used_by ~ c_content then
    if v_up.uploader = auth.uid() then
      return true;
    end if;
    if to_regclass('public.marketing_content') is null then
      return false;
    end if;
    return exists (select 1 from marketing_content c
                    where c.id = split_part(v_up.used_by, ':', 2)::uuid
                      and c.venue_id = v_up.venue_id)
       and app.is_staff_at(v_up.venue_id, 'marketing', 'owner');
  end if;

  if v_up.uploader = auth.uid() or app.is_staff_at(v_up.venue_id, 'manager', 'owner') then
    return true;
  end if;

  -- order_slip_tables (0238): a waiter's order slip is read at the till.
  if v_up.used_by ~ '^order_slip:' then
    return app.is_staff_at(v_up.venue_id, 'cashier');
  end if;

  if v_up.used_by ~ c_sub then
    select s.* into v_step
      from protocol_submissions x
      join protocol_run_steps s on s.id = x.run_step_id
     where x.id = split_part(v_up.used_by, ':', 2)::uuid;
    if not found then
      return false;
    end if;
    select * into v_run from protocol_runs where id = v_step.run_id;
    return exists (select 1 from protocol_submissions x
                    where x.run_step_id = v_step.id
                      and x.submitted_by = auth.uid()
                      and p_name = any(x.photos))
        or (coalesce(app.protocol_step_def(v_run.kind, v_run.variant, v_step.step_key)->>'record_visibility',
                     'run') = 'run'
            and app.protocol_engine_involved(v_run.id));
  end if;

  if v_up.used_by ~ '^marketing_note:' then
    return app.is_staff_at(v_up.venue_id, 'marketing');
  end if;

  -- staff_media_folders (§2.24.2): the role spec's records. Each read is
  -- nested behind its table, which a later migration may create.
  if v_up.used_by !~ c_ref then
    return false;
  end if;
  v_kind := split_part(v_up.used_by, ':', 1);
  v_ref  := split_part(v_up.used_by, ':', 2)::uuid;

  if v_kind = 'release_idea' then
    if to_regclass('public.release_ideas') is null then
      return false;
    end if;
    return exists (select 1 from release_ideas i
                    where i.id = v_ref
                      and i.venue_id = v_up.venue_id
                      and app.is_staff_at(i.venue_id, app.staff_team_head(i.team)));
  elsif v_kind = 'checklist_item' then
    return exists (select 1
                     from checklist_run_items ci
                     join checklist_runs r on r.id = ci.run_id
                    where ci.id = v_ref
                      and r.venue_id = v_up.venue_id
                      -- 0323: a person's copy is theirs, a shared list its role's.
                      and case when r.assignee_id is not null
                               then r.assignee_id = auth.uid()
                               else app.is_staff_at(r.venue_id, r.role)
                          end);
  elsif v_kind = 'teaching' then
    if to_regclass('public.teachings') is null then
      return false;
    end if;
    return exists (select 1 from teachings t
                    where t.id = v_ref
                      and t.venue_id = v_up.venue_id
                      and t.archived_at is null
                      and t.team = app.staff_team(app.staff_role())
                      and app.is_staff_at(t.venue_id, app.staff_role()));
  elsif v_kind = 'marketing_request' then
    if to_regclass('public.marketing_requests') is null then
      return false;
    end if;
    return exists (select 1 from marketing_requests m
                    where m.id = v_ref
                      and m.venue_id = v_up.venue_id)
       and app.is_staff_at(v_up.venue_id, 'marketing');
  end if;
  return false;
end $staff_media_visible_0323$;

comment on function app.staff_media_visible(text) is
  'protocols_engine_rpcs (§2.3, §2.7 "Visibility"), re-issued by staff_media_folders (§2.24.2), staff_media_incidents (wave5-addendum §2.4), order_slip_tables (0238) and checklist_schedules (0323). True when the caller may read a staff-media photo: a marketing content item''s image only its uploader, and marketing and the owners at its venue (never a manager); any other photo its uploader and MGMT at its venue always; an order slip''s photo also the cashier at its venue; a protocol submission''s photo also its step''s sender and, on a step whose record is run-visible, anyone involved in the run; a marketing note''s photo also marketing at the venue; an idea''s photo also the holders of the idea''s team head role at its venue; a checklist tick''s photo also the holders of the list''s role at its venue, or on a person''s copy that person; a teaching''s photo also its team at its venue while it is not archived; a request to marketing''s photo also marketing at its venue; an incident''s photo and anything else nobody else. False for a guest, another venue and any name that is not a staff-media path; never raises. The staff_media_read storage policy evaluates it as the reading role, hence the authenticated grant.';

revoke all on function app.staff_media_visible(text) from public, anon;
grant execute on function app.staff_media_visible(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 19. Owner assistant: checklist_assignees and the new columns join the
--     table_read rows (the 0144 statement, limited to these tables; the
--     existing rows stay).
-- ---------------------------------------------------------------------------
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name,
       c.column_name,
       case when t.table_type = 'VIEW' then 'view' else 'table' end,
       not (c.column_name in ('before', 'after', 'payload', 'idempotency_key', 'device_id',
                              'client_ref', 'photo_path', 'photo_blur')
            or c.data_type = 'jsonb'),
       c.data_type,
       c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
 where c.table_schema = 'public'
   and t.table_type in ('BASE TABLE', 'VIEW')
   and c.table_name in ('checklist_templates', 'checklist_runs', 'checklist_assignees')
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;
