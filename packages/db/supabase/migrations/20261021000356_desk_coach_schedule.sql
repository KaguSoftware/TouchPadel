set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0356 desk_coach_schedule — the court desk sees each coach's day.
--
-- Feature: a Coaches tab on the court desk (Sait 2026-10-21): the desk sees
-- every coach's schedule (their hours, their time off, the lessons they
-- already teach) and the times they are free, and books a lesson for a
-- customer with a coach from there. Booking goes through the existing desk
-- RPCs (desk_book_lesson, desk_create_group, desk_create_course); the free
-- starts of a private lesson are app.coach_slots (0294), which the desk can
-- already read. What the desk could not read is the coach's hours and time
-- off: app.coaches_admin is the manager's and the owner's (it carries the
-- coach's phone and money), so this is the desk's own read, with no phone,
-- no profile, no money and no reason for the time off.
-- Depends on: coaching_tables (0278: coaches, coach_branches, coach_hours,
-- coach_time_off, lessons), coaching_reads (0294: the desk_lessons guard
-- this copies).
-- Re-runnable: create or replace.
--
-- WHAT "BUSY" IS. The coach's held, scheduled and completed lessons
-- overlapping the window, at every branch (a coach teaching at another
-- branch is not free here either: app.coach_available counts them too).
-- A lesson at this branch carries its id (the desk opens it); one at another
-- branch carries nothing but its period, so the desk learns no other
-- branch's lesson.

create or replace function app.desk_coach_schedule(p_venue_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $desk_coach_schedule_0356$
declare
  v_venue uuid;
  v_tz    text;
begin
  -- The role first, then the arguments, then the branch (desk_lessons, 0294).
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_from';
  elsif p_to is null or p_to <= p_from or p_to - p_from > interval '7 days' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_to';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select vs.timezone into v_tz from venue_settings vs where vs.venue_id = v_venue;

  return jsonb_build_object(
    'venue_id', v_venue,
    'timezone', coalesce(v_tz, 'Asia/Baghdad'),
    'server_now', now(),
    -- Active and paused coaches at the branch, as desk_lessons lists them.
    'coaches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'coach_id', co.id,
               'display_name_en', co.display_name_en,
               'display_name_ar', co.display_name_ar,
               'status', co.status,
               'photo_path', co.photo_path,
               -- The weekly windows at this branch (weekday 0 = Sunday, local time).
               'hours', coalesce((select jsonb_agg(jsonb_build_object(
                                           'weekday', h.weekday,
                                           'start_time', to_char(h.start_time, 'HH24:MI'),
                                           'end_time', case when h.end_time = time '24:00' then '24:00'
                                                            else to_char(h.end_time, 'HH24:MI') end)
                                         order by h.weekday, h.start_time)
                                    from coach_hours h
                                   where h.coach_id = co.id and h.venue_id = v_venue), '[]'::jsonb),
               'time_off', coalesce((select jsonb_agg(jsonb_build_object(
                                              'starts_at', lower(t.period),
                                              'ends_at', upper(t.period))
                                            order by lower(t.period))
                                       from coach_time_off t
                                      where t.coach_id = co.id and t.cancelled_at is null
                                        and t.period && tstzrange(p_from, p_to, '[)')), '[]'::jsonb),
               'busy', coalesce((select jsonb_agg(jsonb_build_object(
                                          'lesson_id', case when l.venue_id = v_venue then l.id end,
                                          'here', l.venue_id = v_venue,
                                          'start_at', l.start_at,
                                          'end_at', l.end_at)
                                        order by l.start_at, l.id)
                                   from lessons l
                                  where l.coach_id = co.id
                                    and l.status in ('held', 'scheduled', 'completed')
                                    and l.start_at < p_to and l.end_at > p_from), '[]'::jsonb))
             order by co.sort_order, co.display_name_en, co.id)
        from coaches co
       where co.status in ('active', 'paused')
         and exists (select 1 from coach_branches cb
                      where cb.coach_id = co.id and cb.venue_id = v_venue and cb.active)), '[]'::jsonb));
end $desk_coach_schedule_0356$;

comment on function app.desk_coach_schedule(uuid, timestamptz, timestamptz) is
  '0356 (Sait 2026-10-21, the court desk''s Coaches tab). Court desk, manager, owner (the role first): FORBIDDEN; INVALID_ARGUMENT (a NULL, p_to <= p_from, a window over 7 days); FORBIDDEN unless staff at the branch (p_venue_id, default the resolved branch). {venue_id, timezone, server_now, coaches[{coach_id, display_name_*, status, photo_path, hours[{weekday (0 = Sunday), start_time, end_time}] (this branch, local HH24:MI, end 24:00 allowed), time_off[{starts_at, ends_at}] (live, overlapping the window; no reason), busy[{lesson_id (this branch only, else null), here, start_at, end_at}] (held, scheduled and completed lessons overlapping the window at every branch)}]} for the active and paused coaches active at the branch. No phone, profile, money or other branch''s lesson id.';

revoke all on function app.desk_coach_schedule(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function app.desk_coach_schedule(uuid, timestamptz, timestamptz) to authenticated;
