-- 0345 staff_access — second jobs and blocked pages, per person.
--
-- Feature: the owner's Access list on the Staff page. Majed 2026-10-16: "in
-- staff setup there is a list of checkboxes that the owner can give access to
-- workers at any times, this is because some workers have 2 responsibilities
-- and some have restricted access to stuff".
-- Depends on: app_schema (0003: app.staff_role), null_safe_role_guard (0010:
-- app.is_staff), staff_push (0160: app.staff_ids_with_roles).
-- Re-runnable: add column if not exists, guarded constraint adds,
-- create or replace.
--
-- SECOND JOBS (staff.extra_roles). A cashier who also runs the court desk holds
-- court_desk as a second job. app.is_staff answers true when the main role OR a
-- second job is in the list, and app.is_staff is the guard of almost every RPC
-- and policy, so the desk's writes open for them exactly as for a desk clerk.
-- app.staff_ids_with_roles counts second jobs too, so the desk's pushes reach
-- them. Only the front-line jobs can be a second job (staff_extra_roles_chk):
-- manager, owner and the team heads carry approvals (verify_manager_pin, the
-- deductions, the decisions) that a tick must never hand out. What still reads
-- the main role alone: app.staff_role() itself, so a team's teachings and
-- checklists, a shop assistant's home store and every `staff_role() = '…'`
-- branch follow the main job.
--
-- BLOCKED PAGES (staff.blocked_areas). Pages the person's jobs open that the
-- owner unticked. The operator and the staff phone keep them out of those
-- screens; no RPC reads the column, so a block is a screen rule, not a server
-- refusal. The area keys are packages/core/src/staff/access.ts ACCESS_AREAS,
-- held here by staff_blocked_areas_chk; tests/staff-access.test.ts compares
-- the two lists.
--
-- app.set_staff_access(p_staff_id, p_extra_roles, p_blocked_areas): owner
-- only, never one's own row (CANNOT_EDIT_SELF, like set_staff_role), never an
-- owner's (an owner opens everything), the whole of both lists at once.
-- Audited as staff.access_set with both lists before and after.
--
-- covered by packages/db/tests/staff-access.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The two columns. Readable by whoever reads the row (the person, MGMT).
-- ---------------------------------------------------------------------------
alter table staff add column if not exists extra_roles staff_role[] not null default '{}';
alter table staff add column if not exists blocked_areas text[] not null default '{}';

grant select (extra_roles, blocked_areas) on staff to authenticated;

do $staff_extra_roles_chk_0345$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'staff_extra_roles_chk'
                    and conrelid = 'public.staff'::regclass) then
    alter table staff add constraint staff_extra_roles_chk
      check (extra_roles <@ array['cashier', 'waiter', 'court_desk', 'shop_staff',
                                  'barista', 'chef', 'driver', 'marketing']::staff_role[]
             and cardinality(extra_roles) <= 8) not valid;
  end if;
end $staff_extra_roles_chk_0345$;

do $staff_extra_roles_chk_validate_0345$
begin
  if exists (select 1 from pg_constraint
              where conname = 'staff_extra_roles_chk'
                and conrelid = 'public.staff'::regclass
                and not convalidated) then
    alter table staff validate constraint staff_extra_roles_chk;
  end if;
end $staff_extra_roles_chk_validate_0345$;

do $staff_blocked_areas_chk_0345$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'staff_blocked_areas_chk'
                    and conrelid = 'public.staff'::regclass) then
    alter table staff add constraint staff_blocked_areas_chk
      check (blocked_areas <@ array['till', 'desk', 'customers', 'tournaments', 'kds',
                                    'shop', 'tasks', 'incidents', 'ops', 'stock', 'admin',
                                    'reports', 'protocols', 'suggestions', 'deductions',
                                    'attendance']::text[]
             and cardinality(blocked_areas) <= 16) not valid;
  end if;
end $staff_blocked_areas_chk_0345$;

do $staff_blocked_areas_chk_validate_0345$
begin
  if exists (select 1 from pg_constraint
              where conname = 'staff_blocked_areas_chk'
                and conrelid = 'public.staff'::regclass
                and not convalidated) then
    alter table staff validate constraint staff_blocked_areas_chk;
  end if;
end $staff_blocked_areas_chk_validate_0345$;

-- ---------------------------------------------------------------------------
-- 2. app.is_staff — 0010, plus the second jobs. Still null-safe: a guest (no
--    row) reads false, never NULL. Still LANGUAGE sql SECURITY DEFINER with a
--    SET clause, so it is never inlined into a caller's plan.
-- ---------------------------------------------------------------------------
create or replace function app.is_staff(variadic roles staff_role[]) returns boolean
language sql stable security definer set search_path = public as $is_staff_0345$
  select coalesce(
    (select s.role = any(roles) or s.extra_roles && roles
       from staff s
      where s.id = auth.uid() and s.is_active),
    false)
$is_staff_0345$;

revoke all on function app.is_staff(variadic staff_role[]) from public;
grant execute on function app.is_staff(variadic staff_role[]) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.staff_ids_with_roles — 0160, plus the second jobs: the court desk's
--    pushes reach the cashier who also works the desk.
-- ---------------------------------------------------------------------------
create or replace function app.staff_ids_with_roles(p_venue uuid, p_roles staff_role[])
returns uuid[]
language sql stable security definer set search_path = public as $staff_ids_with_roles_0345$
  select coalesce(array_agg(s.id order by s.id), '{}'::uuid[])
    from staff s
   where s.is_active
     and (s.role = any(p_roles) or s.extra_roles && p_roles)
     and (s.role = 'owner'
          or exists (select 1
                       from staff_venues sv
                       join venues v on v.id = sv.venue_id and v.is_active
                      where sv.staff_id = s.id
                        and sv.venue_id = p_venue))
$staff_ids_with_roles_0345$;

comment on function app.staff_ids_with_roles(uuid, staff_role[]) is
  'staff_push (§2.4) + 0345. Internal: the active staff holding one of p_roles as their role or a second job, who are members of p_venue (an active venue); owners count at every venue. The recipient list for app.notify_staff.';

revoke all on function app.staff_ids_with_roles(uuid, staff_role[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.set_staff_access — the owner saves both lists at once.
-- ---------------------------------------------------------------------------
create or replace function app.set_staff_access(
  p_staff_id      uuid,
  p_extra_roles   staff_role[],
  p_blocked_areas text[]
) returns jsonb
language plpgsql security definer set search_path = public as $set_staff_access_0345$
declare
  v_before staff%rowtype;
  v_after  staff%rowtype;
  v_extra  staff_role[];
  v_block  text[];
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_staff_id = auth.uid() then
    raise exception 'CANNOT_EDIT_SELF' using errcode = 'P0001',
      hint = 'another owner must change your own access';
  end if;

  select * into v_before from staff where id = p_staff_id for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_before.role = 'owner' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      hint = 'an owner opens everything';
  end if;

  -- Sorted and once each, without the main role: the row reads the same
  -- however the boxes were ticked, and an audit diff shows only real changes.
  select coalesce(array_agg(distinct r order by r), '{}'::staff_role[]) into v_extra
    from unnest(coalesce(p_extra_roles, '{}'::staff_role[])) r
   where r is not null and r <> v_before.role;
  select coalesce(array_agg(distinct a order by a), '{}'::text[]) into v_block
    from unnest(coalesce(p_blocked_areas, '{}'::text[])) a
   where a is not null;

  if not (v_extra <@ array['cashier', 'waiter', 'court_desk', 'shop_staff',
                           'barista', 'chef', 'driver', 'marketing']::staff_role[]) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'extra_roles';
  end if;
  if not (v_block <@ array['till', 'desk', 'customers', 'tournaments', 'kds',
                           'shop', 'tasks', 'incidents', 'ops', 'stock', 'admin',
                           'reports', 'protocols', 'suggestions', 'deductions',
                           'attendance']::text[]) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'blocked_areas';
  end if;

  update staff
     set extra_roles   = v_extra,
         blocked_areas = v_block
   where id = p_staff_id
   returning * into v_after;

  perform app.write_audit('staff.access_set', 'staff', p_staff_id::text,
                          jsonb_build_object('extra_roles', v_before.extra_roles,
                                             'blocked_areas', v_before.blocked_areas),
                          jsonb_build_object('extra_roles', v_after.extra_roles,
                                             'blocked_areas', v_after.blocked_areas),
                          null);

  return jsonb_build_object('id', v_after.id, 'role', v_after.role,
                            'extra_roles', v_after.extra_roles,
                            'blocked_areas', v_after.blocked_areas);
end $set_staff_access_0345$;

comment on function app.set_staff_access(uuid, staff_role[], text[]) is
  '0345. Owner-only, never one''s own row (CANNOT_EDIT_SELF) and never an owner''s (INVALID_ARGUMENT). Replaces the person''s second jobs (front-line roles that app.is_staff counts beside the main role) and blocked pages (operator and phone screen rule only). STAFF_NOT_FOUND for an unknown id. Audited as staff.access_set.';

revoke all on function app.set_staff_access(uuid, staff_role[], text[]) from public, anon;
grant execute on function app.set_staff_access(uuid, staff_role[], text[]) to authenticated;
