-- 0383 second_jobs — a second job opens everything its role opens (launch
-- findings F-18 and F-39 server side, Majed 2026-11-01: "Second jobs get full
-- access across both roles everywhere").
--
-- 0345 made app.is_staff count staff.extra_roles, so every RPC guard and
-- policy written as is_staff(...) / is_staff_at(...) already opens for a
-- second job. What still read the main role alone, app.staff_role(), and so
-- shut a second job out:
--   * checklists (F-39): app.my_checklists_today (0323) and
--     app.my_checklist_history (0375) listed a shared list only to holders of
--     its role as their MAIN job, while app.checklist_sweep pushes it to
--     app.staff_ids_with_roles (second jobs included): a person was pushed for
--     a list their phone could not show. app.checklist_materialize (0323)
--     gave an "each" list's copies only to main-role holders, and
--     app.checklist_day_state (0323) counted only them;
--   * teachings: app.teachings_for_me (0194) and the teaching branch of
--     app.staff_media_visible (0323) read the main role's team only;
--   * stock on the phone: app.log_stock, app.submit_stock_count,
--     app.stock_pick_list, app.stock_today and app.staff_stock_view (0245)
--     chose the kinds and the stores from the main role, so a cashier who also
--     works the shop could not log, count or see shop stock (and a shop
--     assistant who also works the till was held to the shop store).
-- Each is re-issued from its latest body with the main role replaced by
-- app.my_staff_roles() (the main job, then each second job; an owner's list is
-- the owner alone), and the stock rules are the union of the jobs' rules:
--   app.stock_log_kinds(roles)       purchased for head_barista, head_chef and
--                                    cashier; retail for shop_staff; both for
--                                    manager and owner (0245's table);
--   app.stock_may_log_at(roles, loc) a logger who is not only a shop assistant
--                                    may log anywhere; the shop assistant at
--                                    the shop store;
--   app.stock_may_count_at(roles, loc) head_chef and chef at the bakery, the
--                                    shop assistant at the shop, manager and
--                                    owner anywhere.
-- The default store when none is named stays the main job's
-- (app.staff_home_location). Edge functions: _shared/auth.ts requireStaffRole
-- reads staff.extra_roles in the same change (desk-customer-create and
-- receipt-scan answered 403 to a second job).
-- Left on the main role on purpose: the head roles' powers (deduction_targets,
-- the team head of a release idea) and management-only branches
-- (set_cafe_setting, the manager price rules), since only front-line jobs can
-- be a second job (staff_extra_roles_chk).
--
-- covered by packages/db/tests/second-jobs.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The helpers.
-- ---------------------------------------------------------------------------
create or replace function app.my_staff_roles() returns staff_role[]
language sql stable security definer set search_path = public as $my_staff_roles_0383$
  select coalesce(
    (select case when s.role = 'owner' then array[s.role]
                 else array[s.role] || array(select distinct r from unnest(s.extra_roles) r
                                              where r <> s.role order by r)
            end
       from staff s
      where s.id = auth.uid() and s.is_active),
    '{}'::staff_role[])
$my_staff_roles_0383$;

comment on function app.my_staff_roles() is
  '0383 (F-18). The caller''s jobs: the main role first, then each second job (staff.extra_roles, 0345) once; an owner is the owner alone; empty for anyone who is not active staff. What a body reads instead of app.staff_role() when a second job must count.';

revoke all on function app.my_staff_roles() from public;
grant execute on function app.my_staff_roles() to anon, authenticated, service_role;

create or replace function app.stock_log_kinds(p_roles staff_role[]) returns text[]
language sql immutable set search_path = public as $stock_log_kinds_0383$
  select array(select k from unnest(array['purchased','retail']) k
                where (p_roles && array['manager','owner']::staff_role[])
                   or (k = 'purchased' and p_roles && array['head_barista','head_chef','cashier']::staff_role[])
                   or (k = 'retail' and 'shop_staff' = any(p_roles)))
$stock_log_kinds_0383$;

comment on function app.stock_log_kinds(staff_role[]) is
  '0383. Internal: the ingredient kinds these jobs may log (0245''s table, as a union): purchased for head_barista, head_chef and cashier, retail for shop_staff, both for manager and owner.';

revoke all on function app.stock_log_kinds(staff_role[]) from public, anon, authenticated;

create or replace function app.stock_may_log_at(p_roles staff_role[], p_loc stock_location) returns boolean
language sql immutable set search_path = public as $stock_may_log_at_0383$
  select exists (select 1 from unnest(p_roles) r
                  where r in ('head_barista','head_chef','cashier','shop_staff','manager','owner')
                    and (r <> 'shop_staff' or p_loc = 'shop'))
$stock_may_log_at_0383$;

comment on function app.stock_may_log_at(staff_role[], stock_location) is
  '0383. Internal: true when one of these jobs may log stock at p_loc (0245: the shop assistant at the shop store, every other logger anywhere).';

revoke all on function app.stock_may_log_at(staff_role[], stock_location) from public, anon, authenticated;

create or replace function app.stock_may_count_at(p_roles staff_role[], p_loc stock_location) returns boolean
language sql immutable set search_path = public as $stock_may_count_at_0383$
  select exists (select 1 from unnest(p_roles) r
                  where (r in ('manager','owner'))
                     or (r in ('head_chef','chef') and p_loc = 'bakery')
                     or (r = 'shop_staff' and p_loc = 'shop'))
$stock_may_count_at_0383$;

comment on function app.stock_may_count_at(staff_role[], stock_location) is
  '0383. Internal: true when one of these jobs may count stock at p_loc (0201/0245: head_chef and chef at the bakery, shop_staff at the shop, manager and owner anywhere).';

revoke all on function app.stock_may_count_at(staff_role[], stock_location) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Checklists (F-39): shared lists and copies for every job.
-- ---------------------------------------------------------------------------
create or replace function app.my_checklists_today(p_venue_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $my_checklists_today_0383$
declare
  v_role  staff_role := app.staff_role();
  v_roles staff_role[] := app.my_staff_roles();   -- 0383: the main job and the second jobs
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
         and ((r.assignee_id is null and r.role = any(v_roles))
              or r.assignee_id = auth.uid())
    ) x;

  return jsonb_build_object('business_date', v_date, 'lists', v_lists);
end $my_checklists_today_0383$;

revoke all on function app.my_checklists_today(uuid) from public, anon;
grant execute on function app.my_checklists_today(uuid) to authenticated;

create or replace function app.my_checklist_history(
  p_venue_id    uuid default null,
  p_before_date date default null,
  p_before_run  uuid default null,
  p_limit       int  default 20
) returns jsonb
language plpgsql security definer set search_path = public as $my_checklist_history_0383$
declare
  v_role  staff_role := app.staff_role();
  v_roles staff_role[] := app.my_staff_roles();   -- 0383: the main job and the second jobs
  v_me    uuid := auth.uid();
  v_venue uuid;
  v_today date;
  v_lists jsonb;
  v_next  jsonb;
begin
  if v_role is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'limit';
  end if;
  if (p_before_date is null) <> (p_before_run is null) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'before';
  end if;
  v_today := app.venue_business_date(v_venue);

  -- One more than asked, to know whether there is a next page.
  select coalesce(jsonb_agg(x.j order by x.business_date desc, x.id desc), '[]'::jsonb)
    into v_lists
    from (
      select r.id, r.business_date,
             jsonb_build_object(
               'run_id',       r.id,
               'template_id',  r.template_id,
               'role',         r.role,
               'slot',         r.slot,
               'name_en',      t.name_en,
               'name_ar',      t.name_ar,
               'done',         c.done,
               'total',        c.total,
               'last_done_at', c.last_done_at,
               'period_start', r.business_date,
               'period_end',   r.period_end,
               'due_at',       r.due_at,
               'assignee_id',  r.assignee_id,
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
                                 where i.run_id = r.id)) as j
        from checklist_runs r
        join checklist_templates t on t.id = r.template_id
        cross join lateral (
          select count(*) filter (where i.done_at is not null) as done, count(*) as total,
                 max(i.done_at) as last_done_at
            from checklist_run_items i
           where i.run_id = r.id
        ) c
       where r.venue_id = v_venue
         and r.business_date <= v_today
         and c.total > 0
         -- Past: no longer open (my_checklists_today shows the open ones).
         and not (t.archived_at is null
                  and app.checklist_current(r.template_id, r.business_date, r.period_end, v_today))
         and ((r.assignee_id is null and r.role = any(v_roles))
              or r.assignee_id = v_me
              or exists (select 1 from checklist_run_items i where i.run_id = r.id and i.done_by = v_me))
         and (p_before_date is null or (r.business_date, r.id) < (p_before_date, p_before_run))
       order by r.business_date desc, r.id desc
       limit p_limit + 1
    ) x;

  if jsonb_array_length(v_lists) > p_limit then
    v_lists := v_lists - p_limit;
    v_next := jsonb_build_object('before_date', v_lists -> (p_limit - 1) ->> 'period_start',
                                 'before_run',  v_lists -> (p_limit - 1) ->> 'run_id');
  end if;

  return jsonb_build_object('business_date', v_today, 'lists', v_lists, 'next', v_next);
end $my_checklist_history_0383$;

revoke all on function app.my_checklist_history(uuid, date, uuid, integer) from public, anon;
grant execute on function app.my_checklist_history(uuid, date, uuid, integer) to authenticated;

create or replace function app.checklist_materialize(p_venue uuid, p_date date)
returns int
language plpgsql security definer set search_path = public as $checklist_materialize_0383$
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
         where (s.role = v_tpl.role or v_tpl.role = any(s.extra_roles))   -- 0383: second jobs too
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
end $checklist_materialize_0383$;

revoke all on function app.checklist_materialize(uuid, date) from public, anon, authenticated;

create or replace function app.checklist_day_state(
  p_venue_id      uuid default null,
  p_business_date date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $checklist_day_state_0383$
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
                                 where (s.role = t.role or t.role = any(s.extra_roles))   -- 0383
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
end $checklist_day_state_0383$;

revoke all on function app.checklist_day_state(uuid, date) from public, anon;
grant execute on function app.checklist_day_state(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Teachings: every job's team.
-- ---------------------------------------------------------------------------
create or replace function app.teachings_for_me(
  p_venue_id uuid default null,
  p_team     text default null,
  p_limit    int  default 50,
  p_offset   int  default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $teachings_for_me_0383$
declare
  v_venue  uuid;
  v_mgmt   boolean;
  v_teams  text[];
  v_limit  int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_rows   jsonb;
  v_total  int;
begin
  if not app.is_staff('head_barista','barista','assistant_barista','head_chef','chef','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','barista','assistant_barista','head_chef','chef','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_team is not null and p_team not in ('bar','kitchen') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'team';
  end if;
  v_mgmt := app.is_staff_at(v_venue, 'manager','owner');
  if v_mgmt then
    v_teams := case when p_team is null then array['bar','kitchen'] else array[p_team] end;
  else
    -- 0383 (F-18): the team of every job the person holds, a second job too.
    v_teams := array(select distinct app.staff_team(r)
                       from unnest(app.my_staff_roles()) r
                      where app.staff_team(r) is not null);
    if p_team is not null then
      if not (p_team = any(v_teams)) then
        raise exception 'FORBIDDEN' using errcode = 'P0001';
      end if;
      v_teams := array[p_team];
    end if;
  end if;

  select count(*) into v_total
    from teachings t
   where t.venue_id = v_venue and t.team = any(v_teams) and t.archived_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',          x.id,
           'team',        x.team,
           'title',       x.title,
           'body',        x.body,
           'photos',      to_jsonb(x.photos),
           'author_name', s.display_name,
           'created_at',  x.created_at,
           'updated_at',  x.updated_at,
           'mine',        x.author_id = auth.uid(),
           'editable',    x.author_id = auth.uid() or v_mgmt)
         order by x.created_at desc, x.id), '[]'::jsonb)
    into v_rows
    from (select * from teachings t
           where t.venue_id = v_venue and t.team = any(v_teams) and t.archived_at is null
           order by t.created_at desc, t.id
           limit v_limit offset v_offset) x
    left join staff s on s.id = x.author_id;

  return jsonb_build_object('teachings', v_rows, 'total', v_total);
end $teachings_for_me_0383$;

revoke all on function app.teachings_for_me(uuid, text, integer, integer) from public, anon;
grant execute on function app.teachings_for_me(uuid, text, integer, integer) to authenticated;

create or replace function app.staff_media_visible(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $staff_media_visible_0383$
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
                      -- 0383 (F-18): any job the person holds, a second job too.
                      and exists (select 1 from unnest(app.my_staff_roles()) mr
                                   where app.staff_team(mr) = t.team
                                     and app.is_staff_at(t.venue_id, mr)));
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
end $staff_media_visible_0383$;

revoke all on function app.staff_media_visible(text) from public, anon;
grant execute on function app.staff_media_visible(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Stock on the phone: the union of the jobs' rules.
-- ---------------------------------------------------------------------------
create or replace function app.log_stock(
  p_location        text  default null,
  p_lines           jsonb default null,
  p_note            text  default null,
  p_venue_id        uuid  default null,
  p_idempotency_key text  default null
) returns jsonb
language plpgsql security definer set search_path = public as $log_stock_0383$
declare
  c_uuid    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_role    staff_role := app.staff_role();
  v_roles   staff_role[] := app.my_staff_roles();   -- 0383: second jobs count
  v_venue   uuid;
  v_loc     stock_location;
  v_kinds   text[];
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_el      jsonb;
  v_ing     ingredients%rowtype;
  v_qty     numeric;
  v_unit    text;
  v_exp     date;
  v_seen    uuid[] := '{}';
  v_payload jsonb := '[]'::jsonb;
  v_est     record;
  v_sources jsonb := jsonb_build_object('last_batch', 0, 'pack', 0, 'none', 0);
  v_replay  jsonb;
  v_made    jsonb;
  v_lines   jsonb;
  v_result  jsonb;
begin
  -- 0245: the shop assistant takes the court desk's place (shop stock, the
  -- shop store only); the cashier keeps purchased stock only.
  if not app.is_staff('head_barista','head_chef','cashier','shop_staff','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','cashier','shop_staff','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_loc := app.parse_stock_location(p_location, app.staff_home_location(v_role));
  -- 0383 (F-18): every job the person holds, a second job too.
  if not app.stock_may_log_at(v_roles, v_loc) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
  end if;
  v_kinds := app.stock_log_kinds(v_roles);

  if length(v_note) > 200 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 50 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
  end if;
  for v_el in select e from jsonb_array_elements(p_lines) e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    if coalesce(v_el->>'ingredient_id', '') !~ c_uuid then
      raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001',
        detail = coalesce(v_el->>'ingredient_id', '(missing ingredient_id)');
    end if;
    select * into v_ing from ingredients
     where id = (v_el->>'ingredient_id')::uuid and venue_id = v_venue and is_active;
    if not found then
      raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001', detail = v_el->>'ingredient_id';
    end if;
    if v_ing.id = any(v_seen) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    -- Made here, not bought: a batch, never a log. A kind outside the
    -- caller's is refused the same way; 0245: shop stock only in the shop store.
    if not (v_ing.kind::text = any(v_kinds)) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind', detail = v_ing.id::text;
    end if;
    perform app.assert_store_for_kind(v_ing.kind, v_loc);
    if coalesce(jsonb_typeof(v_el->'qty'), 'null') <> 'number' then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    v_qty := (v_el->>'qty')::numeric;
    if v_qty <= 0 or v_qty >= 1000000000 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    v_unit := nullif(v_el->>'unit', '');
    if v_unit is not null and v_unit <> v_ing.unit::text then
      if v_unit <> 'pack' or coalesce(v_ing.pack_size, 0) <= 0 then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'unit';
      end if;
      v_qty := v_qty * v_ing.pack_size;
    end if;
    v_qty := round(v_qty, 3);
    if v_qty <= 0 or v_qty >= 1000000000 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    v_exp := null;
    if nullif(v_el->>'expiry_date', '') is not null then
      begin
        v_exp := (v_el->>'expiry_date')::date;
      exception when others then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'expiry_date';
      end;
      if v_exp < current_date then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'expiry_date';
      end if;
    end if;

    select * into v_est from app.stock_cost_estimate(v_ing.id);
    v_sources := jsonb_set(v_sources, array[v_est.cost_source],
                           to_jsonb((v_sources->>v_est.cost_source)::int + 1));
    v_seen    := v_seen || v_ing.id;
    v_payload := v_payload || jsonb_build_array(jsonb_build_object(
      'ingredient_id', v_ing.id,
      'qty_received',  v_qty,
      'unit_cost_iqd', v_est.unit_cost,
      'cost_source',   v_est.cost_source,
      'expiry_date',   v_exp));
  end loop;

  v_replay := app.claim_replay(p_idempotency_key, 'log_stock');
  if v_replay is not null then
    return v_replay;
  end if;

  v_made := app.receive_delivery_internal(v_venue, v_loc, v_payload, null, v_note, null, null, 'staff_log');

  select coalesce(jsonb_agg(jsonb_build_object('ingredient_id', dl.ingredient_id,
                                               'qty',           dl.qty_received,
                                               'expiry_date',   dl.expiry_date)
                            order by dl.ingredient_id), '[]'::jsonb)
    into v_lines
    from delivery_lines dl
   where dl.delivery_id = (v_made->>'delivery_id')::uuid;

  perform app.write_audit('stock.log', 'deliveries', v_made->>'delivery_id', null,
                          jsonb_build_object('location', v_loc, 'lines', jsonb_array_length(v_payload),
                                             'cost_sources', v_sources));

  v_result := jsonb_build_object('delivery_id', (v_made->>'delivery_id')::uuid, 'location', v_loc,
                                 'lines', v_lines);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $log_stock_0383$;

revoke all on function app.log_stock(text, jsonb, text, uuid, text) from public, anon;
grant execute on function app.log_stock(text, jsonb, text, uuid, text) to authenticated;

create or replace function app.submit_stock_count(
  p_location        text  default null,
  p_lines           jsonb default null,
  p_venue_id        uuid  default null,
  p_idempotency_key text  default null
) returns jsonb
language plpgsql security definer set search_path = public as $submit_stock_count_0383$
declare
  c_uuid   constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_role   staff_role := app.staff_role();
  v_roles  staff_role[] := app.my_staff_roles();   -- 0383: second jobs count
  v_venue  uuid;
  v_loc    stock_location;
  v_el     jsonb;
  v_ing    ingredients%rowtype;
  v_qty    numeric;
  v_unit   text;
  v_seen   uuid[] := '{}';
  v_lines  jsonb := '[]'::jsonb;
  v_replay jsonb;
  v_count  stock_counts%rowtype;
  v_result jsonb;
begin
  if not app.is_staff('head_chef','chef','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'head_chef','chef','manager','owner','shop_staff')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_loc := app.parse_stock_location(p_location, app.staff_home_location(v_role));
  -- 0383 (F-18): every job the person holds, a second job too.
  if not app.stock_may_count_at(v_roles, v_loc) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
  end if;

  -- A line is {ingredient_id, counted_qty, unit?}: unit the base unit or pack.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 300 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
  end if;
  for v_el in select e from jsonb_array_elements(p_lines) e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    if coalesce(v_el->>'ingredient_id', '') !~ c_uuid then
      raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001',
        detail = coalesce(v_el->>'ingredient_id', '(missing ingredient_id)');
    end if;
    select * into v_ing from ingredients
     where id = (v_el->>'ingredient_id')::uuid and venue_id = v_venue and is_active;
    if not found then
      raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001', detail = v_el->>'ingredient_id';
    end if;
    if v_ing.id = any(v_seen) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    perform app.assert_store_for_kind(v_ing.kind, v_loc);   -- 0245 (was: retail in the cafe only)
    if coalesce(jsonb_typeof(v_el->'counted_qty'), 'null') <> 'number' then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    v_qty := (v_el->>'counted_qty')::numeric;
    if v_qty < 0 or v_qty >= 1000000000 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    v_unit := nullif(v_el->>'unit', '');
    if v_unit is not null and v_unit <> v_ing.unit::text then
      if v_unit <> 'pack' or coalesce(v_ing.pack_size, 0) <= 0 then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'unit';
      end if;
      v_qty := v_qty * v_ing.pack_size;
    end if;
    v_qty := round(v_qty, 3);
    if v_qty >= 1000000000 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    v_seen  := v_seen || v_ing.id;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('ingredient_id', v_ing.id, 'counted_qty', v_qty));
  end loop;

  v_replay := app.claim_replay(p_idempotency_key, 'submit_stock_count');
  if v_replay is not null then
    return v_replay;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('stock_count:' || v_venue::text || ':' || v_loc::text, 0));
  if exists (select 1 from stock_counts
              where venue_id = v_venue and location = v_loc and finalized_at is null) then
    raise exception 'COUNT_IN_PROGRESS' using errcode = 'P0001';
  end if;

  insert into stock_counts (counted_by, venue_id, location, source)
  values (auth.uid(), v_venue, v_loc, 'phone')
  returning * into v_count;

  insert into stock_count_lines (count_id, ingredient_id, theoretical_qty, counted_qty)
  select v_count.id, (x->>'ingredient_id')::uuid, t.qty, (x->>'counted_qty')::numeric
    from jsonb_array_elements(v_lines) x
    cross join lateral (select coalesce(sum(m.qty_delta), 0) as qty
                          from stock_movements m
                         where m.ingredient_id = (x->>'ingredient_id')::uuid and m.location = v_loc) t;

  perform app.write_audit('stock.submit_count', 'stock_counts', v_count.id::text, null,
                          jsonb_build_object('location', v_loc, 'lines', jsonb_array_length(v_lines)));

  v_result := jsonb_build_object('count_id', v_count.id, 'location', v_loc,
                                 'lines', jsonb_array_length(v_lines));
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $submit_stock_count_0383$;

revoke all on function app.submit_stock_count(text, jsonb, uuid, text) from public, anon;
grant execute on function app.submit_stock_count(text, jsonb, uuid, text) to authenticated;

create or replace function app.stock_pick_list(
  p_purpose  text,
  p_location text default null,
  p_venue_id uuid default null,
  p_query    text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $stock_pick_list_0383$
declare
  v_role  staff_role := app.staff_role();
  v_roles staff_role[] := app.my_staff_roles();   -- 0383: second jobs count
  v_venue uuid;
  v_loc   stock_location;
  v_kinds text[];
  v_q     text := nullif(btrim(coalesce(p_query, '')), '');
  v_items jsonb;
begin
  if not app.is_staff('head_barista','head_chef','chef','cashier','shop_staff','waiter','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_purpose is null or p_purpose not in ('log', 'move', 'count') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'purpose';
  end if;
  if (p_purpose = 'log'   and not app.is_staff('head_barista','head_chef','cashier','shop_staff','manager','owner'))
     or (p_purpose = 'move'  and not app.is_staff('waiter','manager','owner'))
     or (p_purpose = 'count' and not app.is_staff('head_chef','chef','shop_staff','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'purpose';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','chef','cashier','shop_staff','waiter','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_purpose = 'log' then
    v_loc := app.parse_stock_location(p_location, app.staff_home_location(v_role));
    if not app.stock_may_log_at(v_roles, v_loc) then   -- 0383
      raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
    end if;
    v_kinds := app.stock_log_kinds(v_roles);
  elsif p_purpose = 'move' then
    v_loc   := app.parse_stock_location(p_location, 'cafe');
    v_kinds := array['purchased','prepared'];
  else
    v_loc := app.parse_stock_location(p_location, app.staff_home_location(v_role));
    if not app.stock_may_count_at(v_roles, v_loc) then   -- 0383
      raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'location';
    end if;
    v_kinds := array['purchased','prepared','retail'];
  end if;
  -- 0245: shop stock lives in the shop store only, and the shop store holds nothing else.
  if v_loc = 'shop' then
    v_kinds := array(select k from unnest(v_kinds) k where k = 'retail');
  else
    v_kinds := array_remove(v_kinds, 'retail');
  end if;

  -- A typed search matches either name, anywhere in it. % and _ are escaped,
  -- so a query is text and never a pattern.
  if v_q is not null then
    v_q := '%' || replace(replace(replace(left(v_q, 80), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select coalesce(jsonb_agg(
           case when p_purpose = 'move'
                then jsonb_build_object('ingredient_id', x.id, 'name_en', x.name_en, 'name_ar', x.name_ar,
                                        'unit', x.unit, 'kind', x.kind, 'pack_size', x.pack_size,
                                        'on_hand', x.on_hand)
                else jsonb_build_object('ingredient_id', x.id, 'name_en', x.name_en, 'name_ar', x.name_ar,
                                        'unit', x.unit, 'kind', x.kind, 'pack_size', x.pack_size)
           end
           order by lower(x.name_en), x.id), '[]'::jsonb)
    into v_items
    from (select i.id, i.name_en, i.name_ar, i.unit::text as unit, i.kind::text as kind, i.pack_size, oh.on_hand
            from ingredients i
            cross join lateral (
              select coalesce(sum(b.qty_remaining), 0) as on_hand
                from stock_batches b
               where b.ingredient_id = i.id and b.location = v_loc and b.qty_remaining > 0) oh
           where i.venue_id = v_venue
             and i.is_active
             and i.kind::text = any(v_kinds)
             and (v_q is null or i.name_en ilike v_q or i.name_ar ilike v_q)
             and (p_purpose <> 'move' or oh.on_hand > 0)
           order by lower(i.name_en), i.id
           limit 300) x;

  return jsonb_build_object('purpose', p_purpose, 'location', v_loc, 'items', v_items);
end $stock_pick_list_0383$;

revoke all on function app.stock_pick_list(text, text, uuid, text) from public, anon;
grant execute on function app.stock_pick_list(text, text, uuid, text) to authenticated;

create or replace function app.stock_today(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $stock_today_0383$
declare
  v_roles     staff_role[] := app.my_staff_roles();   -- 0383: every job, a second job too
  v_venue     uuid;
  v_tz        text;
  v_start     int := coalesce(app.cafe_setting_int('analytics_business_day_start_hour'), 4);
  v_day       date;
  v_from      timestamptz;
  v_kinds     text[];
  v_stores    stock_location[];
  v_transfers jsonb;
  v_logs      jsonb;
  v_waiting   int;
  v_counts    jsonb;
begin
  if not app.is_staff('head_barista','head_chef','chef','cashier','shop_staff','waiter','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','chef','cashier','shop_staff','waiter','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_tz   := coalesce((select v.timezone from venues v where v.id = v_venue), 'Asia/Baghdad');
  v_day  := app.venue_business_date(v_venue, now());
  v_from := (v_day + make_interval(hours => v_start)) at time zone v_tz;

  if v_roles && array['waiter','manager','owner']::staff_role[] then
    select coalesce(jsonb_agg(jsonb_build_object(
             'transfer_id',   t.id,
             'from',          t.from_location,
             'to',            t.to_location,
             'moved_by_name', s.display_name,
             'moved_at',      t.moved_at,
             'lines',         (select coalesce(jsonb_agg(jsonb_build_object(
                                        'ingredient_id', l.ingredient_id,
                                        'name_en',       i.name_en,
                                        'name_ar',       i.name_ar,
                                        'unit',          i.unit,
                                        'qty',           l.qty)
                                      order by lower(i.name_en), i.id), '[]'::jsonb)
                                 from stock_transfer_lines l
                                 join ingredients i on i.id = l.ingredient_id
                                where l.transfer_id = t.id))
           order by t.moved_at desc, t.id), '[]'::jsonb)
      into v_transfers
      from stock_transfers t
      join staff s on s.id = t.moved_by
     where t.venue_id = v_venue
       and t.moved_at >= v_from and t.moved_at < v_from + interval '1 day';
  end if;

  -- 0245: the LOG list follows log_stock (shop_staff for court_desk, the cashier purchased only).
  if v_roles && array['head_barista','head_chef','cashier','shop_staff','manager','owner']::staff_role[] then
    v_kinds := app.stock_log_kinds(v_roles);
    select coalesce(jsonb_agg(d.row order by d.received_at desc, d.id), '[]'::jsonb)
      into v_logs
      from (select dv.id, dv.received_at,
                   jsonb_build_object('delivery_id',      dv.id,
                                      'location',         dv.location,
                                      'source',           dv.source,
                                      'received_by_name', s.display_name,
                                      'received_at',      dv.received_at,
                                      'lines',            ln.lines) as row
              from deliveries dv
              join staff s on s.id = dv.received_by
              cross join lateral (
                select jsonb_agg(jsonb_build_object('ingredient_id', dl.ingredient_id,
                                                    'name_en',       i.name_en,
                                                    'name_ar',       i.name_ar,
                                                    'unit',          i.unit,
                                                    'qty',           dl.qty_received,
                                                    'expiry_date',   dl.expiry_date)
                                 order by lower(i.name_en), i.id) as lines
                  from delivery_lines dl
                  join ingredients i on i.id = dl.ingredient_id
                 where dl.delivery_id = dv.id and i.kind::text = any(v_kinds)) ln
             where dv.venue_id = v_venue
               and dv.received_at >= v_from and dv.received_at < v_from + interval '1 day'
               and ln.lines is not null) d;

    -- 0245: the driver buys for the cafe; the shop assistant has none waiting.
    if not (v_roles <@ array['shop_staff']::staff_role[]) then
      select count(*) into v_waiting
        from purchases p
       where p.venue_id = v_venue and p.delivered_at is not null and p.status = 'to_receive';
    end if;
  end if;

  if v_roles && array['head_chef','chef','shop_staff','manager','owner']::staff_role[] then
    v_stores := array(select l from unnest(enum_range(null::stock_location)) l
                       where app.stock_may_count_at(v_roles, l));
    select coalesce(jsonb_agg(jsonb_build_object(
             'count_id',        c.id,
             'location',        c.location,
             'status',          case when c.finalized_at is null then 'waiting' else 'applied' end,
             'counted_by_name', s.display_name,
             'submitted_at',    c.started_at,
             'applied_at',      c.finalized_at,
             'lines',           (select coalesce(jsonb_agg(jsonb_build_object(
                                          'ingredient_id', l.ingredient_id,
                                          'name_en',       i.name_en,
                                          'name_ar',       i.name_ar,
                                          'unit',          i.unit,
                                          'counted_qty',   l.counted_qty)
                                        order by lower(i.name_en), i.id), '[]'::jsonb)
                                   from stock_count_lines l
                                   join ingredients i on i.id = l.ingredient_id
                                  where l.count_id = c.id))
           order by c.started_at desc, c.id), '[]'::jsonb)
      into v_counts
      from stock_counts c
      join staff s on s.id = c.counted_by
     where c.venue_id = v_venue
       and c.source = 'phone'
       and c.location = any(v_stores)
       and c.started_at >= now() - interval '30 days';
  end if;

  return jsonb_build_object('business_date',             v_day,
                            'transfers',                 v_transfers,
                            'logs',                      v_logs,
                            'driver_deliveries_waiting', v_waiting,
                            'counts',                    v_counts);
end $stock_today_0383$;

revoke all on function app.stock_today(uuid) from public, anon;
grant execute on function app.stock_today(uuid) to authenticated;

create or replace function app.staff_stock_view(
  p_venue_id uuid default null,
  p_kind     text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $staff_stock_view_0383$
declare
  v_venue uuid;
  v_roles staff_role[] := app.my_staff_roles();   -- 0383: every job, a second job too
  v_kinds text[];
  v_items jsonb;
begin
  if not app.is_staff('head_barista','head_chef','shop_staff','waiter','manager','owner') then   -- 0245: shop_staff for court_desk
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','shop_staff','waiter','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_kinds := array(select k from unnest(array['purchased','prepared','retail']) k
                    where (v_roles && array['manager','owner']::staff_role[])
                       or (k in ('purchased','prepared')
                           and v_roles && array['head_barista','head_chef','waiter']::staff_role[])
                       or (k = 'retail' and 'shop_staff' = any(v_roles)));
  if p_kind is not null then
    if p_kind not in ('purchased','prepared','retail') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind';
    end if;
    if not (p_kind = any(v_kinds)) then
      raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'kind';
    end if;
    v_kinds := array[p_kind];
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ingredient_id',       x.id,
           'kind',                x.kind,
           'name_en',             x.name_en,
           'name_ar',             x.name_ar,
           'unit',                x.unit,
           'pack_size',           x.pack_size,
           'on_hand',             x.on_hand,
           'par_level',           x.par_level,
           'low_stock_threshold', x.low_stock_threshold,
           'low',                 x.low,
           'below_par',           x.below_par,
           'next_expiry',         x.next_expiry,
           'product',             x.product,
           'by_location',         jsonb_build_object('cafe', x.on_hand_cafe, 'bakery', x.on_hand_bakery,
                                                     'shop', x.on_hand_shop))   -- 0245
         order by x.low desc, lower(x.name_en), x.id), '[]'::jsonb)
    into v_items
    from (select i.id, i.kind::text as kind, i.name_en, i.name_ar, i.unit::text as unit, i.pack_size,
                 oh.on_hand, i.par_level, i.low_stock_threshold,
                 (i.low_stock_threshold is not null and oh.on_hand <= i.low_stock_threshold) as low,
                 (i.par_level is not null and oh.on_hand < i.par_level) as below_par,
                 oh.next_expiry, oh.on_hand_cafe, oh.on_hand_bakery, oh.on_hand_shop,
                 pr.product
            from ingredients i
            cross join lateral (
              select coalesce(sum(b.qty_remaining), 0) as on_hand,
                     min(b.expiry_date) as next_expiry,
                     coalesce(sum(b.qty_remaining) filter (where b.location = 'cafe'), 0) as on_hand_cafe,
                     coalesce(sum(b.qty_remaining) filter (where b.location = 'bakery'), 0) as on_hand_bakery,
                     coalesce(sum(b.qty_remaining) filter (where b.location = 'shop'), 0) as on_hand_shop
                from stock_batches b
               where b.ingredient_id = i.id and b.qty_remaining > 0) oh
            -- A retail ingredient backs one shop size, through its recipe line.
            left join lateral (
              select jsonb_build_object('menu_item_id', mi.id,
                                        'name_en',      mi.name_en,
                                        'name_ar',      mi.name_ar,
                                        'size_name_en', v.name_en,
                                        'size_name_ar', v.name_ar) as product
                from recipe_lines rl
                join menu_item_variants v on v.id = rl.variant_id
                join menu_items mi on mi.id = v.item_id
               where i.kind = 'retail' and rl.ingredient_id = i.id
               order by rl.id
               limit 1) pr on true
           where i.venue_id = v_venue
             and i.is_active
             and i.kind::text = any(v_kinds)) x;

  return jsonb_build_object('as_of', now(), 'items', v_items);
end $staff_stock_view_0383$;

revoke all on function app.staff_stock_view(uuid, text) from public, anon;
grant execute on function app.staff_stock_view(uuid, text) to authenticated;
