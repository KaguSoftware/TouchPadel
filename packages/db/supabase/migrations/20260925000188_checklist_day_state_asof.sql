-- 0188 checklist_day_state_asof — the day-close checklist warning for a PAST
-- business day counts only the lists and lines that stood at the end of it.
--
-- Feature: checklist_day_state_asof (wave 3 review R7; checklists,
-- docs/design/protocols/build-contracts-2026-09-23.md §2.14, plan §7.3).
-- Depends on: checklists (0165: the four checklist tables,
-- app.venue_business_date, and the checklist.template.save audit rows that
-- app.save_checklist_template writes, 0165 and its 0184 re-issue alike).
-- Re-issues (§2.18): app.checklist_day_state from 0165, its latest body
-- (0166–0187 do not re-issue it; 0184 says so). Same signature, guard, grants
-- and return shape; the comment is re-issued with the as-of rule.
-- Re-runnable: create or replace; comment, revoke and grant re-issued.
--
-- THE BUG. Day close asks for the business day of the session it closes, which
-- is often yesterday once the close runs past the start hour. For a list that
-- nobody opened that day, 0165 fell back to the template AS IT STANDS NOW, so
-- a list the owner wrote after that day (or lines added to it since) showed
-- as unfinished on a day it did not exist.
--
-- THE FIX. The day's end is the venue's own business-day boundary:
-- app.venue_business_date, the three-argument app.business_date in the
-- venue's timezone with the analytics start hour (never the one-argument 0034
-- form, which reads venue_settings unqualified). A list with no run that day:
--   * last saved on or before that business day: its template lines are the
--     ones that stood at the end of it (every save replaces the lines whole
--     and stamps updated_at), so they count as before;
--   * saved since, with a save on or before that day: it existed then, but the
--     template keeps no copy of its old lines. It counts with the number of
--     lines its last save by then recorded in the audit row, nothing done, and
--     names no lines (open_items is empty) rather than today's lines;
--   * first saved after that day: it did not exist, so it is left out;
--   * a list that had no lines at the end of the day is left out, as 0165
--     leaves out a list with no lines.
-- A list opened that day reads from its run, the day's own snapshot, exactly
-- as before. Today and any later day are unchanged: every save so far falls on
-- or before them. The role filter stays "someone active holds the role now",
-- as in 0165 (staff rows keep no history of when a role was held).
--
-- Day close still only warns (DayClose.tsx, dayCloseLogic.ts: nothing in the
-- close block reads this); app.close_day does not read checklists.
--
-- covered by packages/db/tests/checklist-day-state.test.ts and checklists.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- app.checklist_day_state — 0165 verbatim, plus the as-of rule for a list
-- nobody opened that day (the lateral reads and the three CASE branches).
-- ---------------------------------------------------------------------------
create or replace function app.checklist_day_state(
  p_venue_id      uuid default null,
  p_business_date date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $checklist_day_state_0188$
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
           'role',       x.role,
           'slot',       x.slot,
           'name_en',    x.name_en,
           'name_ar',    x.name_ar,
           'total',      x.total,
           'done',       x.done,
           'open_items', x.open_items)
         order by x.role, case x.slot when 'open' then 1 else 2 end), '[]'::jsonb)
    into v_lists
    from (
      select t.role, t.slot, t.name_en, t.name_ar,
             case when r.id is not null
                  then (select count(*) from checklist_run_items ri where ri.run_id = r.id)
                  when c.stood
                  then (select count(*) from checklist_template_items ti where ti.template_id = t.id)
                  else s.items
             end as total,
             case when r.id is not null
                  then (select count(*) from checklist_run_items ri
                         where ri.run_id = r.id and ri.done_at is not null)
                  else 0
             end as done,
             case when r.id is not null
                  then (select coalesce(jsonb_agg(jsonb_build_object('text_en', ri.text_en, 'text_ar', ri.text_ar)
                                                  order by ri.position, ri.id), '[]'::jsonb)
                          from checklist_run_items ri
                         where ri.run_id = r.id and ri.done_at is null)
                  when c.stood
                  then (select coalesce(jsonb_agg(jsonb_build_object('text_en', ti.text_en, 'text_ar', ti.text_ar)
                                                  order by ti.position), '[]'::jsonb)
                          from checklist_template_items ti
                         where ti.template_id = t.id)
                  else '[]'::jsonb
             end as open_items
        from checklist_templates t
        left join checklist_runs r on r.template_id = t.id and r.business_date = v_date
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
           where r.id is null
             and not c.stood
             and a.entity = 'checklist_template'
             and a.entity_id = t.id::text
             and a.action = 'checklist.template.save'
             and app.venue_business_date(v_venue, a.at) <= v_date
           order by a.at desc, a.id desc
           limit 1
        ) s on true
       where t.venue_id = v_venue
         and cardinality(app.staff_ids_with_roles(v_venue, array[t.role])) > 0
         and (case when r.id is not null
                   then exists (select 1 from checklist_run_items ri where ri.run_id = r.id)
                   when c.stood
                   then exists (select 1 from checklist_template_items ti where ti.template_id = t.id)
                   else coalesce(s.items, 0) > 0
              end)
    ) x;

  return jsonb_build_object('business_date', v_date, 'lists', v_lists);
end $checklist_day_state_0188$;

comment on function app.checklist_day_state(uuid, date) is
  'checklists (§2.14, plan §7.3), re-issued by checklist_day_state_asof (R7). MGMT at the venue: {business_date, lists: [{role, slot, name_en, name_ar, total, done, open_items: [{text_en, text_ar}]}]} for the business day asked (default today): every list with lines whose role an active staff member holds at the venue, from its day''s run when opened, else from the template with nothing done. For a past day only what stood at the end of that day (the venue''s business day) counts: a list first saved later is left out, and a list saved since counts with the number of lines its last save by then recorded, its lines not named. Day close shows it as a warning, never a block. Creates nothing.';

revoke all on function app.checklist_day_state(uuid, date) from public, anon;
grant execute on function app.checklist_day_state(uuid, date) to authenticated;
