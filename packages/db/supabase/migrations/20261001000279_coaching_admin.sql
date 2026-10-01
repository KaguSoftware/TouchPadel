set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0279 coaching_admin — coaching, lane DB (docs/design/coaching/db.md §4.6;
-- build contracts §1.1, §1.5, §1.6, §1.7, C-4, C-5, C-7, C-17, C-22, C-25,
-- C-27, CD-9, CD-10, R16, R26, R43, R45, R46, R52, R56, R57, R61, R70, R73,
-- R81).
--
--   1. The coach's identity: app.coach_self (the first statement of every
--      coach RPC; a retired coach is NOT_A_COACH, R45, R70), app.coach_of_caller
--      (whatever the status; coach_me and Money's my_coach_statements) and
--      app.coach_me (never raises; publicByDesign, R12).
--   2. Availability, grid and price helpers (internal, stable):
--      coach_in_hours, coach_available, lesson_on_grid (the twin of core
--      grid.ts isOnLessonGrid, C-20, R9), lesson_bookable, lesson_price_for.
--   3. Coaches (manager, owner): coaches_admin (X19), coach_promote (R43
--      photo folder, R61 not public until accepted), coach_update,
--      set_coach_branches (R52, R73 detail coach_lessons),
--      set_coach_lesson_types (unlinking deletes the coach's price, R46).
--   4. Lesson types and per-coach prices (the price lock, C-17, R46):
--      upsert_lesson_type over upsert_lesson_type_internal, set_coach_price
--      over set_coach_price_internal. PRICE_VIA_PROTOCOL detail price | shape,
--      LAUNCH_VIA_PROTOCOL (both reused, R14).
--   5. Hours and time off (C-4, CD-10): set_coach_hours / set_my_coach_hours,
--      coach_hours_mine, add_coach_time_off / add_my_time_off,
--      cancel_coach_time_off / cancel_my_time_off. HOURS_OVERLAP detail is the
--      0-based index of the clashing submitted window, or time_off (R73).
--   6. Photos (R43): app.storage_path_in_use re-issued to count a coach's
--      photo; the purge queue's service RPCs coach_photo_purge_due and
--      coach_photo_purged (the incident-photo pair's shape).
--
-- Every function is security definer with search_path public. Internals are
-- revoked from public, anon and authenticated; RPCs from public and anon and
-- granted to authenticated. Staff RPCs check the role first, before any
-- argument check or app.current_venue() (R57), then the branch; a manager acts
-- on a coach only when the coach has a coach_branches row at a branch the
-- manager works at (app.coach_staff_scope), the owner on every coach. Every
-- write is audited with ids and flags, never a student's name or phone.
--
-- Locks (db.md §2.3 level H): the writers that can race a booking take the
-- coach mutex (app.lock_coach, 0275) and nothing else. No body here takes a
-- court lock or locks a reservations row.
--
-- Functions of other coaching files called here (bound late, by name):
--   0274 app.coaching_rules; 0275 app.lock_coach.

-- ===========================================================================
-- 1. The coach's identity (db.md §4.6.1)
-- ===========================================================================

-- The caller's coaches row whatever its status, or NULL. Never raises.
create or replace function app.coach_of_caller() returns coaches
language sql stable security definer set search_path = public as $coach_of_caller_0279$
  select c.* from coaches c where c.profile_id = auth.uid()
$coach_of_caller_0279$;

comment on function app.coach_of_caller() is
  '0279 (db.md §4.6.1, R45, R70). Internal. The caller''s coaches row whatever its status (active, paused or retired), or NULL; never raises. Read only by coach_me and Money''s my_coach_statements (a retired coach still reads their approved and paid statements, C-25).';

revoke all on function app.coach_of_caller() from public, anon, authenticated;

-- The first statement of every coach RPC. Each code is its own literal raise
-- (check-error-codes sees literals only). With p_raise false every refusal is
-- NULL instead.
create or replace function app.coach_self(p_raise boolean default true) returns coaches
language plpgsql stable security definer set search_path = public as $coach_self_0279$
declare
  v_uid   uuid := auth.uid();
  v_raise boolean := coalesce(p_raise, true);
  v_c     coaches%rowtype;
begin
  if v_uid is null then
    if v_raise then
      raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
    end if;
    return null;
  end if;
  if not exists (select 1 from profiles p where p.id = v_uid and p.deleted_at is null) then
    if v_raise then
      raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
    end if;
    return null;
  end if;
  -- R45: a retired coach is not a coach here (no rosters, no phones, no
  -- schedule); a paused one is (reads, cancels, marks; booking refuses
  -- COACH_INACTIVE in the caller).
  select * into v_c from coaches c where c.profile_id = v_uid and c.status <> 'retired';
  if not found then
    if v_raise then
      raise exception 'NOT_A_COACH' using errcode = 'P0001';
    end if;
    return null;
  end if;
  return v_c;
end $coach_self_0279$;

comment on function app.coach_self(boolean) is
  '0279 (db.md §4.6.1, R45, R70). Internal: the first statement of every coach RPC. AUTH_REQUIRED without a session; ACCOUNT_REQUIRED without a live profile; NOT_A_COACH when the caller has no coaches row that is not retired. Returns the caller''s coach (active or paused). With p_raise false each refusal is NULL instead.';

revoke all on function app.coach_self(boolean) from public, anon, authenticated;

-- ===========================================================================
-- 2. Availability, grid and price helpers (db.md §4.6.2; internal, stable)
-- ===========================================================================

-- True when the coach may teach over p_period at p_venue: an active branch
-- row, the period inside one local day (24:00 = the next local midnight,
-- CD-10), inside one of the coach's windows at that branch on that weekday,
-- and no live time off over it. Does not look at other lessons.
create or replace function app.coach_in_hours(p_coach_id uuid, p_venue uuid, p_period tstzrange) returns boolean
language plpgsql stable security definer set search_path = public as $coach_in_hours_0279$
declare
  v_tz  text;
  v_ls  timestamp;
  v_le  timestamp;
  v_end time;
begin
  if p_coach_id is null or p_venue is null or p_period is null or isempty(p_period)
     or lower_inf(p_period) or upper_inf(p_period) then
    return false;
  end if;
  if not exists (select 1 from coach_branches b
                  where b.coach_id = p_coach_id and b.venue_id = p_venue and b.active) then
    return false;
  end if;
  select vs.timezone into v_tz from venue_settings vs where vs.venue_id = p_venue;
  v_tz := coalesce(v_tz, 'Asia/Baghdad');
  v_ls := lower(p_period) at time zone v_tz;
  v_le := upper(p_period) at time zone v_tz;
  if v_le::date = v_ls::date then
    v_end := v_le::time;
  elsif v_le = (v_ls::date + 1)::timestamp then
    v_end := time '24:00';
  else
    return false;
  end if;
  if not exists (select 1 from coach_hours h
                  where h.coach_id = p_coach_id
                    and h.venue_id = p_venue
                    and h.weekday = extract(dow from v_ls)::int
                    and h.start_time <= v_ls::time
                    and h.end_time >= v_end) then
    return false;
  end if;
  if exists (select 1 from coach_time_off t
              where t.coach_id = p_coach_id and t.cancelled_at is null and t.period && p_period) then
    return false;
  end if;
  return true;
end $coach_in_hours_0279$;

comment on function app.coach_in_hours(uuid, uuid, tstzrange) is
  '0279 (db.md §4.6.2, CD-10). Internal. True when coach p_coach_id is active at branch p_venue, the period lies inside one local day of the branch (an end at the next local midnight is 24:00), one of the coach''s windows at that branch on that weekday covers it, and no live time off overlaps it. Other lessons are not looked at (app.coach_available adds them).';

revoke all on function app.coach_in_hours(uuid, uuid, tstzrange) from public, anon, authenticated;

-- coach_in_hours and no held or scheduled lesson of the coach, at any branch,
-- over the period (lessons_coach_no_overlap is the backstop). A reschedule
-- uses coach_in_hours plus its own overlap test that leaves the lesson out.
create or replace function app.coach_available(p_coach_id uuid, p_venue uuid, p_period tstzrange) returns boolean
language sql stable security definer set search_path = public as $coach_available_0279$
  select app.coach_in_hours(p_coach_id, p_venue, p_period)
     and not exists (select 1 from lessons l
                      where l.coach_id = p_coach_id
                        and l.status in ('held', 'scheduled')
                        and l.period && p_period)
$coach_available_0279$;

comment on function app.coach_available(uuid, uuid, tstzrange) is
  '0279 (db.md §4.6.2). Internal. app.coach_in_hours and no held or scheduled lesson of the coach at any branch overlapping p_period. Callers turn false into COACH_BUSY when such a lesson exists, else COACH_UNAVAILABLE. Money''s late-success revival reads it too (0281).';

revoke all on function app.coach_available(uuid, uuid, tstzrange) from public, anon, authenticated;

-- The 30-minute grid (C-20, R9): the server twin of packages/core
-- src/coaching/grid.ts isOnLessonGrid: local minute 0 or 30, to the second.
create or replace function app.lesson_on_grid(p_start_at timestamptz, p_venue uuid) returns boolean
language sql stable security definer set search_path = public as $lesson_on_grid_0279$
  select coalesce((
    select date_trunc('minute', x.l) = x.l and extract(minute from x.l)::int in (0, 30)
      from (select p_start_at at time zone coalesce(
                     (select vs.timezone from venue_settings vs where vs.venue_id = p_venue),
                     'Asia/Baghdad') as l) x
     where p_start_at is not null), false)
$lesson_on_grid_0279$;

comment on function app.lesson_on_grid(timestamptz, uuid) is
  '0279 (db.md §4.6.2; C-20, R9). Internal. True when p_start_at, in the branch''s time zone, is :00 or :30 to the second: the twin of @touch/core isOnLessonGrid. Every lesson start (each kind, on booking, creation and reschedule) must pass (SLOT_NOT_ON_GRID).';

revoke all on function app.lesson_on_grid(timestamptz, uuid) from public, anon, authenticated;

-- NULL, or the first of CLOSED_DATE, OUTSIDE_HOURS that the branch's opening
-- hours raise for the period (app.assert_bookable on its first active court,
-- caught: the 0261 match_quote shape); NO_COURT_FREE when the branch has no
-- active court. Lets the slot reads and the course pre-check report without
-- raising.
create or replace function app.lesson_bookable(p_venue uuid, p_start_at timestamptz, p_end_at timestamptz)
returns text
language plpgsql stable security definer set search_path = public as $lesson_bookable_0279$
declare
  v_court uuid;
begin
  select c.id into v_court from courts c where c.venue_id = p_venue and c.is_active order by c.id limit 1;
  if v_court is null then
    return 'NO_COURT_FREE';
  end if;
  begin
    perform app.assert_bookable(v_court, p_start_at, p_end_at);
  exception when sqlstate 'P0001' then
    if sqlerrm in ('CLOSED_DATE', 'OUTSIDE_HOURS') then
      return sqlerrm;
    end if;
    raise;
  end;
  return null;
end $lesson_bookable_0279$;

comment on function app.lesson_bookable(uuid, timestamptz, timestamptz) is
  '0279 (db.md §4.6.2). Internal. NULL when the branch''s opening hours and closed dates allow the period; else CLOSED_DATE or OUTSIDE_HOURS (app.assert_bookable on the branch''s first active court, caught), or NO_COURT_FREE when the branch has no active court. Callers re-raise each as a literal.';

revoke all on function app.lesson_bookable(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- coalesce(the coach's own price, the type's price); NULL for a type with no
-- price. A coach price exists only while the coach teaches the type (R46).
create or replace function app.lesson_price_for(p_coach_id uuid, p_lesson_type_id uuid) returns bigint
language sql stable security definer set search_path = public as $lesson_price_for_0279$
  select coalesce(
    (select cp.price_iqd::bigint from coach_prices cp
      where cp.coach_id = p_coach_id and cp.lesson_type_id = p_lesson_type_id),
    (select lt.price_iqd::bigint from lesson_types lt where lt.id = p_lesson_type_id))
$lesson_price_for_0279$;

comment on function app.lesson_price_for(uuid, uuid) is
  '0279 (db.md §4.6.2; C-5). Internal. The price of one lesson type taught by one coach: the coach''s own price (coach_prices) when there is one, else the type''s price_iqd; NULL for a type with no price. Private: the whole lesson; group: one place; course: the whole course.';

revoke all on function app.lesson_price_for(uuid, uuid) from public, anon, authenticated;

-- ===========================================================================
-- 3. Coaches (db.md §4.6.3)
-- ===========================================================================

-- A manager acts on a coach only when the coach has a coach_branches row at a
-- branch the manager works at; the owner on every coach.
create or replace function app.coach_staff_scope(p_coach_id uuid) returns boolean
language sql stable security definer set search_path = public as $coach_staff_scope_0279$
  select case
    when app.is_staff('owner') then true
    else exists (select 1 from coach_branches b
                  where b.coach_id = p_coach_id
                    and app.is_staff_at(b.venue_id, 'manager', 'owner'))
  end
$coach_staff_scope_0279$;

comment on function app.coach_staff_scope(uuid) is
  '0279 (db.md §4.6). Internal. True for the owner; for a manager, true when the coach has a coach_branches row (active or not) at a branch the manager works at. The admin writers refuse FORBIDDEN otherwise.';

revoke all on function app.coach_staff_scope(uuid) from public, anon, authenticated;

-- R43: a coach photo lives in a fresh random folder, coaches/<uuid>/<file>,
-- never one named by a profile or a coach. NULL is fine (no photo).
create or replace function app.coach_photo_path_ok(p_path text) returns boolean
language plpgsql stable security definer set search_path = public as $coach_photo_path_ok_0279$
declare
  v_folder uuid;
begin
  if p_path is null then
    return true;
  end if;
  if p_path !~ '^coaches/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$' then
    return false;
  end if;
  begin
    v_folder := substring(p_path from '^coaches/([0-9a-f-]{36})/')::uuid;
  exception when others then
    return false;
  end;
  return not exists (select 1 from profiles p where p.id = v_folder)
     and not exists (select 1 from coaches c where c.id = v_folder);
end $coach_photo_path_ok_0279$;

comment on function app.coach_photo_path_ok(text) is
  '0279 (R43). Internal. True for NULL, or a menu-media path coaches/<uuid>/<file> whose folder is a fresh uuid: never a profiles.id or a coaches.id, so no public payload carries a profile id.';

revoke all on function app.coach_photo_path_ok(text) from public, anon, authenticated;

-- coach_me (X9, R45, R61, R81; publicByDesign): first statement reads the
-- caller's coach row whatever its status; never raises; reads no switch and
-- no staff status (a staff member who coaches gets the same answer, C-27).
create or replace function app.coach_me() returns jsonb
language plpgsql stable security definer set search_path = public as $coach_me_0279$
declare
  v_c        coaches%rowtype := app.coach_of_caller();
  v_branches jsonb;
  v_types    jsonb;
  v_adds     int;
  v_open     int;
  v_cap      int;
begin
  if v_c.id is null then
    return jsonb_build_object('coach', null, 'server_now', now());
  end if;
  if v_c.status = 'retired' then
    -- R45, C-25: the card and nothing else.
    return jsonb_build_object(
      'coach', jsonb_build_object('id', v_c.id, 'status', 'retired',
                                  'display_name_en', v_c.display_name_en,
                                  'display_name_ar', v_c.display_name_ar),
      'server_now', now());
  end if;

  -- Every branch, not closed, where the coach is active, whatever its
  -- switch: coach mode shows "Lessons are switched off at {branch}" rather
  -- than hiding (R45). open_private / open_private_cap are the R56 count and
  -- cap of that branch.
  select coalesce(jsonb_agg(jsonb_build_object(
           'venue_id', x.id,
           'name_en', x.name_en,
           'name_ar', x.name_ar,
           'timezone', x.tz,
           'coaching_enabled', x.enabled,
           'open_private', x.open_n,
           'open_private_cap', x.cap)
           order by x.name_en, x.id), '[]'::jsonb),
         coalesce(sum(x.open_n), 0)::int,
         min(x.cap)::int
    into v_branches, v_open, v_cap
    from (select v.id, v.name_en, v.name_ar,
                 coalesce(vs.timezone, v.timezone) as tz,
                 coalesce(vs.coaching_enabled, false) and v.is_active as enabled,
                 coalesce(vs.coach_max_open_private, 10) as cap,
                 (select count(*) from lessons l
                   where l.coach_id = v_c.id and l.venue_id = v.id and l.kind = 'private'
                     and l.booked_by_kind = 'coach' and l.status in ('held', 'scheduled')
                     and l.start_at > now())::int as open_n
            from coach_branches b
            join venues v on v.id = b.venue_id and v.status <> 'closed'
            left join venue_settings vs on vs.venue_id = v.id
           where b.coach_id = v_c.id and b.active) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'venue_id', t.venue_id,
           'kind', t.kind,
           'name_en', t.name_en,
           'name_ar', t.name_ar,
           'duration_min', t.duration_min,
           'max_places', t.max_places,
           'min_places', t.min_places,
           'sessions_count', t.sessions_count,
           'cutoff_hours', t.cutoff_hours,
           'price_iqd', app.lesson_price_for(v_c.id, t.id),
           'is_active', t.is_active)
           order by t.venue_id, t.sort_order, t.name_en, t.id), '[]'::jsonb)
    into v_types
    from coach_lesson_types ct
    join lesson_types t on t.id = ct.lesson_type_id
    join coach_branches b on b.coach_id = ct.coach_id and b.venue_id = t.venue_id and b.active
    join venues v on v.id = t.venue_id and v.status <> 'closed'
   where ct.coach_id = v_c.id;

  -- CD-9: what the coach added in the last 24 hours, whatever became of it.
  select count(*) into v_adds
    from lesson_enrolments e
   where e.booked_by_kind = 'coach'
     and e.booked_by_profile_id = v_c.profile_id
     and e.created_at > now() - interval '24 hours';

  return jsonb_build_object(
    'coach', jsonb_build_object(
      'id', v_c.id,
      'status', v_c.status,
      'display_name_en', v_c.display_name_en,
      'display_name_ar', v_c.display_name_ar,
      'bio_en', v_c.bio_en,
      'bio_ar', v_c.bio_ar,
      'photo_path', v_c.photo_path,
      'public_accepted', v_c.public_accepted_at is not null,
      'public_accepted_at', v_c.public_accepted_at,
      'branches', v_branches,
      'lesson_types', v_types,
      'adds_today', v_adds,
      'add_cap', 30,
      'private_open', coalesce(v_open, 0),
      'private_cap', v_cap),
    'server_now', now());
end $coach_me_0279$;

comment on function app.coach_me() is
  '0279 (db.md §4.6.1; X9, R45, R61, R81; publicByDesign). Authenticated, never raises: {coach: null} for a caller who is not a coach; {coach: {id, status: retired, display_name_en, display_name_ar}} for a retired coach (C-25); else {coach: {id, status, display_name_*, bio_*, photo_path, public_accepted, public_accepted_at, branches: [{venue_id, name_*, timezone, coaching_enabled, open_private, open_private_cap}], lesson_types: [{id, venue_id, kind, name_*, duration_min, max_places, min_places, sessions_count, cutoff_hours, price_iqd, is_active}], adds_today, add_cap: 30, private_open, private_cap}, server_now}. Branches are every not-closed branch where the coach is active, whatever its switch (R45); private_open sums them and private_cap is the lowest branch cap. Reads no coaching switch and no staff status (C-27). Never the profile''s phone.';

revoke all on function app.coach_me() from public, anon;
grant execute on function app.coach_me() to authenticated;

-- The admin read (X19, operator.md §5.6.3): every coach with a coach_branches
-- row at the branch, with the profile's name and phone (staff see customers),
-- and every lesson type of the branch. The desk never reads it (R20).
create or replace function app.coaches_admin(p_venue_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $coaches_admin_0279$
declare
  v_venue uuid;
  v_rules jsonb;
begin
  -- R57: the role first, then the branch.
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_rules := app.coaching_rules(v_venue);

  return jsonb_build_object(
    'venue_id', v_venue,
    'coaching_enabled', coalesce((v_rules->>'coaching_enabled')::boolean, false),
    'server_now', now(),
    'coaches', coalesce((
      select jsonb_agg(x.j order by x.sort_order, x.name, x.id)
        from (
          select c.sort_order, c.display_name_en as name, c.id,
                 jsonb_build_object(
                   'coach_id', c.id,
                   'profile_id', c.profile_id,
                   'full_name', p.full_name,
                   'phone', p.phone,
                   'account_deleted', p.deleted_at is not null,
                   'display_name_en', c.display_name_en,
                   'display_name_ar', c.display_name_ar,
                   'bio_en', c.bio_en,
                   'bio_ar', c.bio_ar,
                   'photo_path', c.photo_path,
                   'status', c.status,
                   'public_accepted_at', c.public_accepted_at,
                   'retired_at', c.retired_at,
                   'sort_order', c.sort_order,
                   'venue_ids', coalesce((select jsonb_agg(b2.venue_id order by b2.venue_id)
                                            from coach_branches b2
                                           where b2.coach_id = c.id and b2.active), '[]'::jsonb),
                   'active_here', exists (select 1 from coach_branches b3
                                           where b3.coach_id = c.id and b3.venue_id = v_venue and b3.active),
                   'lesson_type_ids', coalesce((select jsonb_agg(ct.lesson_type_id order by ct.lesson_type_id)
                                                  from coach_lesson_types ct
                                                 where ct.coach_id = c.id and ct.venue_id = v_venue), '[]'::jsonb),
                   'prices', coalesce((select jsonb_agg(jsonb_build_object('lesson_type_id', cp.lesson_type_id,
                                                                           'price_iqd', cp.price_iqd,
                                                                           'protocol_run_id', cp.protocol_run_id)
                                                        order by cp.lesson_type_id)
                                         from coach_prices cp
                                        where cp.coach_id = c.id and cp.venue_id = v_venue), '[]'::jsonb),
                   'hours', coalesce((select jsonb_agg(jsonb_build_object(
                                                'id', h.id,
                                                'weekday', h.weekday,
                                                'start_time', to_char(h.start_time, 'HH24:MI'),
                                                'end_time', case when h.end_time = time '24:00' then '24:00'
                                                                 else to_char(h.end_time, 'HH24:MI') end)
                                              order by h.weekday, h.start_time)
                                        from coach_hours h
                                       where h.coach_id = c.id and h.venue_id = v_venue), '[]'::jsonb),
                   'hours_set_by', lh.set_by,
                   'hours_set_by_name', case when lh.set_by = 'staff' then
                                               (select s.display_name from staff s where s.id = lh.set_by_staff_id)
                                             when lh.set_by = 'coach' then c.display_name_en end,
                   'hours_updated_at', lh.updated_at,
                   'hours_elsewhere', coalesce((
                       select jsonb_agg(jsonb_build_object(
                                'venue_id', h.venue_id,
                                'venue_name_en', ve.name_en,
                                'venue_name_ar', ve.name_ar,
                                'weekday', h.weekday,
                                'start_time', to_char(h.start_time, 'HH24:MI'),
                                'end_time', case when h.end_time = time '24:00' then '24:00'
                                                 else to_char(h.end_time, 'HH24:MI') end)
                              order by ve.name_en, h.weekday, h.start_time)
                         from coach_hours h
                         join venues ve on ve.id = h.venue_id
                        where h.coach_id = c.id and h.venue_id <> v_venue), '[]'::jsonb),
                   'time_off', coalesce((
                       select jsonb_agg(jsonb_build_object(
                                'id', t.id,
                                'starts_at', lower(t.period),
                                'ends_at', upper(t.period),
                                'reason', t.reason,
                                'set_by', t.set_by,
                                'set_by_name', case when t.set_by = 'staff' then
                                                      (select s.display_name from staff s where s.id = t.set_by_staff_id)
                                                    else c.display_name_en end)
                              order by lower(t.period))
                         from coach_time_off t
                        where t.coach_id = c.id and t.cancelled_at is null and upper(t.period) > now()), '[]'::jsonb),
                   -- What retiring would cancel (R45): live lessons not yet
                   -- started that are not course sessions, at every branch,
                   -- and courses with a session left to start.
                   'upcoming_lessons', (select count(*) from lessons l
                                         where l.coach_id = c.id and l.course_id is null
                                           and l.status in ('held', 'scheduled') and l.start_at > now()),
                   'open_courses', (select count(*) from courses co
                                     where co.coach_id = c.id and co.status in ('open', 'running')
                                       and exists (select 1 from lessons s2
                                                    where s2.course_id = co.id and s2.status = 'scheduled'
                                                      and s2.start_at > now()))
                 ) as j
            from coaches c
            join profiles p on p.id = c.profile_id
            left join lateral (select h.set_by, h.set_by_staff_id, h.updated_at
                                 from coach_hours h
                                where h.coach_id = c.id and h.venue_id = v_venue
                                order by h.updated_at desc, h.id
                                limit 1) lh on true
           where exists (select 1 from coach_branches b where b.coach_id = c.id and b.venue_id = v_venue)
        ) x), '[]'::jsonb),
    'lesson_types', coalesce((
      select jsonb_agg(jsonb_build_object(
               'lesson_type_id', t.id,
               'id', t.id,
               'kind', t.kind,
               'name_en', t.name_en,
               'name_ar', t.name_ar,
               'description_en', t.description_en,
               'description_ar', t.description_ar,
               'duration_min', t.duration_min,
               'price_iqd', t.price_iqd,
               'court_share_iqd', t.court_share_iqd,
               'max_places', t.max_places,
               'min_places', t.min_places,
               'cutoff_hours', t.cutoff_hours,
               'sessions_count', t.sessions_count,
               'is_active', t.is_active,
               'launched_at', t.launched_at,
               'sort_order', t.sort_order,
               'coach_ids', coalesce((select jsonb_agg(ct.coach_id order by ct.coach_id)
                                        from coach_lesson_types ct
                                       where ct.lesson_type_id = t.id), '[]'::jsonb),
               -- The open price run on this type, if any (R46: the operator
               -- shows the launched fields read-only and the run's state).
               'pending_run', (
                 select jsonb_build_object('run_id', r.id, 'change', pr.rec->>'change')
                   from protocol_runs r
                   cross join lateral (
                     select x.record as rec
                       from protocol_submissions x
                       join protocol_run_steps s on s.id = x.run_step_id
                      where x.run_id = r.id and s.step_key = 'propose' and x.withdrawn_at is null
                      order by x.round desc, x.submitted_at desc, x.id desc
                      limit 1) pr
                  where r.venue_id = t.venue_id
                    and r.kind = 'price_promo'
                    and r.status in ('active', 'scheduled')
                    and pr.rec->>'change' in ('lesson_price', 'lesson_launch')
                    and pr.rec->>'lesson_type_id' = t.id::text
                  order by r.started_at desc, r.id
                  limit 1))
             order by t.sort_order, t.name_en, t.id)
        from lesson_types t
       where t.venue_id = v_venue), '[]'::jsonb));
end $coaches_admin_0279$;

comment on function app.coaches_admin(uuid) is
  '0279 (db.md §4.6.3; X19, R46, R57). Manager and owner, at the branch (default: the caller''s resolved branch). {venue_id, coaching_enabled, server_now, coaches: [{coach_id, profile_id, full_name, phone, account_deleted, display_name_*, bio_*, photo_path, status, public_accepted_at, retired_at, sort_order, venue_ids, active_here, lesson_type_ids, prices, hours, hours_set_by, hours_set_by_name, hours_updated_at, hours_elsewhere, time_off, upcoming_lessons, open_courses}], lesson_types: [{lesson_type_id, kind, name_*, description_*, duration_min, price_iqd, court_share_iqd, max_places, min_places, cutoff_hours, sessions_count, is_active, launched_at, sort_order, coach_ids, pending_run}]} for every coach with a coach_branches row at the branch and every type of the branch. The profile''s name and phone are staff data, never public. FORBIDDEN by role, then by branch.';

revoke all on function app.coaches_admin(uuid) from public, anon;
grant execute on function app.coaches_admin(uuid) to authenticated;

-- Promote a guest profile to coach (C-7), or bring a retired coach back with
-- the fields replaced and the consent cleared (R61: not public until the
-- coach accepts again). The branches named become active; on a revival every
-- other branch row is switched off, so the coach starts with exactly the
-- branches chosen.
create or replace function app.coach_promote(
  p_profile_id      uuid,
  p_display_name_en text,
  p_display_name_ar text,
  p_bio_en          text,
  p_bio_ar          text,
  p_photo_path      text,
  p_venue_ids       uuid[]
) returns jsonb
language plpgsql security definer set search_path = public as $coach_promote_0279$
declare
  v_staff   uuid := auth.uid();
  v_name_en text := app.safe_line(p_display_name_en);
  v_name_ar text := app.safe_line(p_display_name_ar);
  v_bio_en  text := coalesce(app.safe_text(p_bio_en), '');
  v_bio_ar  text := coalesce(app.safe_text(p_bio_ar), '');
  v_photo   text := nullif(btrim(coalesce(p_photo_path, '')), '');
  v_venues  uuid[];
  v_v       uuid;
  v_c       coaches%rowtype;
  v_revived boolean := false;
begin
  -- R57: the role first.
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_profile_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_profile_id';
  end if;
  if v_name_en is null or char_length(v_name_en) not between 1 and 60 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_display_name_en';
  end if;
  if v_name_ar is null or char_length(v_name_ar) not between 1 and 60 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_display_name_ar';
  end if;
  if char_length(v_bio_en) > 1000 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_bio_en';
  end if;
  if char_length(v_bio_ar) > 1000 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_bio_ar';
  end if;
  -- R43: the format, and a folder that is a fresh uuid, never a profile or a coach.
  if not app.coach_photo_path_ok(v_photo) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_photo_path';
  end if;
  if p_venue_ids is null or cardinality(p_venue_ids) = 0 or array_position(p_venue_ids, null) is not null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_venue_ids';
  end if;
  v_venues := array(select distinct x from unnest(p_venue_ids) x order by x);

  if not exists (select 1 from profiles p where p.id = p_profile_id and p.deleted_at is null) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;

  foreach v_v in array v_venues loop
    if not app.is_staff_at(v_v, 'manager', 'owner') then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
  end loop;

  select * into v_c from coaches c where c.profile_id = p_profile_id;
  if found and v_c.status <> 'retired' then
    raise exception 'ALREADY_COACH' using errcode = 'P0001', detail = v_c.id::text;
  end if;

  if found then
    -- A retired coach comes back (set_coach_status never un-retires, R45).
    perform app.lock_coach(v_c.id);
    update coaches
       set status = 'active', retired_at = null, public_accepted_at = null,
           display_name_en = v_name_en, display_name_ar = v_name_ar,
           bio_en = v_bio_en, bio_ar = v_bio_ar, photo_path = v_photo,
           updated_at = now()
     where id = v_c.id and status = 'retired'
    returning * into v_c;
    if v_c.id is null then
      raise exception 'ALREADY_COACH' using errcode = 'P0001';
    end if;
    v_revived := true;
  else
    begin
      insert into coaches (profile_id, display_name_en, display_name_ar, bio_en, bio_ar, photo_path,
                           status, created_by_staff_id)
      values (p_profile_id, v_name_en, v_name_ar, v_bio_en, v_bio_ar, v_photo, 'active', v_staff)
      returning * into v_c;
    exception when unique_violation then
      raise exception 'ALREADY_COACH' using errcode = 'P0001';
    end;
  end if;

  foreach v_v in array v_venues loop
    perform set_config('app.venue_id', v_v::text, true);
    insert into coach_branches (coach_id, venue_id, active)
    values (v_c.id, v_v, true)
    on conflict (coach_id, venue_id) do update set active = true;
  end loop;
  if v_revived then
    for v_v in
      select b.venue_id from coach_branches b
       where b.coach_id = v_c.id and b.active and not (b.venue_id = any (v_venues))
       order by b.venue_id
    loop
      perform set_config('app.venue_id', v_v::text, true);
      update coach_branches set active = false where coach_id = v_c.id and venue_id = v_v;
    end loop;
  end if;

  perform app.write_audit('coaching.coach.promote', 'coaches', v_c.id::text, null,
                          jsonb_build_object('coach_id', v_c.id, 'profile_id', p_profile_id,
                                             'venue_ids', to_jsonb(v_venues), 'revived', v_revived,
                                             'photo', v_photo is not null));
  return jsonb_build_object('coach_id', v_c.id, 'status', v_c.status, 'venue_ids', to_jsonb(v_venues),
                            'revived', v_revived, 'duplicate', false);
end $coach_promote_0279$;

comment on function app.coach_promote(uuid, text, text, text, text, text, uuid[]) is
  '0279 (db.md §4.6.3; C-7, R43, R61). Manager and owner: make a guest profile a coach at the named branches (each one the caller works at), or bring a retired coach back with the fields replaced, public_accepted_at cleared (R61) and exactly the named branches active. Refusals: FORBIDDEN (role); INVALID_ARGUMENT p_profile_id | p_display_name_en | p_display_name_ar (1..60) | p_bio_en | p_bio_ar (<= 1000) | p_photo_path (coaches/<uuid>/<file>, the folder never a profile or coach id, R43) | p_venue_ids (empty); CUSTOMER_NOT_FOUND (no live profile); FORBIDDEN (a branch the caller does not work at); ALREADY_COACH (detail the coach id). Audited coaching.coach.promote. Returns {coach_id, status, venue_ids, revived, duplicate}.';

revoke all on function app.coach_promote(uuid, text, text, text, text, text, uuid[]) from public, anon;
grant execute on function app.coach_promote(uuid, text, text, text, text, text, uuid[]) to authenticated;

-- The display names, bios, photo and order (C-7: only managers edit them).
create or replace function app.coach_update(p_coach_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $coach_update_0279$
declare
  v_allowed text[] := array['display_name_en', 'display_name_ar', 'bio_en', 'bio_ar', 'photo_path', 'sort_order'];
  v_c       coaches%rowtype;
  v_new     coaches;
  v_key     text;
  v_text    text;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_coach_id is not null then
    select * into v_c from coaches c where c.id = p_coach_id;
  end if;
  if v_c.id is null then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.coach_staff_scope(v_c.id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_patch';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;
  if v_c.status = 'retired' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'retired';
  end if;

  v_new := v_c;
  if p_patch ? 'display_name_en' then
    v_text := case when jsonb_typeof(p_patch->'display_name_en') = 'string'
                   then app.safe_line(p_patch->>'display_name_en') end;
    if v_text is null or char_length(v_text) not between 1 and 60 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'display_name_en';
    end if;
    v_new.display_name_en := v_text;
  end if;
  if p_patch ? 'display_name_ar' then
    v_text := case when jsonb_typeof(p_patch->'display_name_ar') = 'string'
                   then app.safe_line(p_patch->>'display_name_ar') end;
    if v_text is null or char_length(v_text) not between 1 and 60 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'display_name_ar';
    end if;
    v_new.display_name_ar := v_text;
  end if;
  if p_patch ? 'bio_en' then
    if jsonb_typeof(p_patch->'bio_en') not in ('string', 'null') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'bio_en';
    end if;
    v_text := coalesce(app.safe_text(p_patch->>'bio_en'), '');
    if char_length(v_text) > 1000 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'bio_en';
    end if;
    v_new.bio_en := v_text;
  end if;
  if p_patch ? 'bio_ar' then
    if jsonb_typeof(p_patch->'bio_ar') not in ('string', 'null') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'bio_ar';
    end if;
    v_text := coalesce(app.safe_text(p_patch->>'bio_ar'), '');
    if char_length(v_text) > 1000 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'bio_ar';
    end if;
    v_new.bio_ar := v_text;
  end if;
  if p_patch ? 'photo_path' then
    if jsonb_typeof(p_patch->'photo_path') not in ('string', 'null') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'photo_path';
    end if;
    v_text := nullif(btrim(coalesce(p_patch->>'photo_path', '')), '');
    -- R43; keeping the coach's current photo is always fine.
    if v_text is distinct from v_c.photo_path and not app.coach_photo_path_ok(v_text) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'photo_path';
    end if;
    v_new.photo_path := v_text;
  end if;
  if p_patch ? 'sort_order' then
    v_new.sort_order := app.venue_patch_int(p_patch, 'sort_order', 0, 100000);
  end if;

  update coaches
     set display_name_en = v_new.display_name_en,
         display_name_ar = v_new.display_name_ar,
         bio_en = v_new.bio_en,
         bio_ar = v_new.bio_ar,
         photo_path = v_new.photo_path,
         sort_order = v_new.sort_order,
         updated_at = now()
   where id = v_c.id
  returning * into v_new;

  perform app.write_audit('coaching.coach.update', 'coaches', v_c.id::text,
                          jsonb_build_object('display_name_en', v_c.display_name_en,
                                             'display_name_ar', v_c.display_name_ar,
                                             'photo_path', v_c.photo_path, 'sort_order', v_c.sort_order,
                                             'bio_changed', false),
                          jsonb_build_object('display_name_en', v_new.display_name_en,
                                             'display_name_ar', v_new.display_name_ar,
                                             'photo_path', v_new.photo_path, 'sort_order', v_new.sort_order,
                                             'bio_changed', v_new.bio_en is distinct from v_c.bio_en
                                                            or v_new.bio_ar is distinct from v_c.bio_ar));
  return jsonb_build_object(
    'coach_id', v_new.id,
    'status', v_new.status,
    'display_name_en', v_new.display_name_en,
    'display_name_ar', v_new.display_name_ar,
    'bio_en', v_new.bio_en,
    'bio_ar', v_new.bio_ar,
    'photo_path', v_new.photo_path,
    'sort_order', v_new.sort_order,
    'public_accepted_at', v_new.public_accepted_at,
    'updated_at', v_new.updated_at);
end $coach_update_0279$;

comment on function app.coach_update(uuid, jsonb) is
  '0279 (db.md §4.6.3; C-7, R43). Manager (a coach in scope) and owner: patch a coach''s display_name_en, display_name_ar (1..60), bio_en, bio_ar (<= 1000), photo_path (NULL clears; coaches/<fresh uuid>/<file>, R43) and sort_order. Refusals: FORBIDDEN (role); COACH_NOT_FOUND; FORBIDDEN (scope); INVALID_ARGUMENT p_patch | the key | retired. Audited coaching.coach.update (names, photo, order and whether a bio changed). Returns the coach''s card.';

revoke all on function app.coach_update(uuid, jsonb) from public, anon;
grant execute on function app.coach_update(uuid, jsonb) to authenticated;

-- The branches a coach teaches at. The listed ones become active; the
-- caller's other branches are switched off (the owner's: every other branch).
-- R52, R73: a branch it would drop that still has a live lesson of the coach
-- not yet ended, or an open or running course, refuses BRANCH_HAS_BOOKINGS
-- detail coach_lessons (hint: that branch's id).
create or replace function app.set_coach_branches(p_coach_id uuid, p_venue_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $set_coach_branches_0279$
declare
  v_c      coaches%rowtype;
  v_venues uuid[];
  v_v      uuid;
  v_drop   uuid[];
  v_before uuid[];
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_coach_id is not null then
    select * into v_c from coaches c where c.id = p_coach_id;
  end if;
  if v_c.id is null then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_venue_ids is null or cardinality(p_venue_ids) = 0 or array_position(p_venue_ids, null) is not null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_venue_ids';
  end if;
  v_venues := array(select distinct x from unnest(p_venue_ids) x order by x);
  if not app.coach_staff_scope(v_c.id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  foreach v_v in array v_venues loop
    if not app.is_staff_at(v_v, 'manager', 'owner') then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
  end loop;

  perform app.lock_coach(v_c.id);

  v_before := array(select b.venue_id from coach_branches b
                     where b.coach_id = v_c.id and b.active order by b.venue_id);
  -- Only branches the caller works at are ever switched off.
  v_drop := array(select b.venue_id from coach_branches b
                   where b.coach_id = v_c.id and b.active
                     and not (b.venue_id = any (v_venues))
                     and app.is_staff_at(b.venue_id, 'manager', 'owner')
                   order by b.venue_id);
  foreach v_v in array v_drop loop
    if exists (select 1 from lessons l
                where l.coach_id = v_c.id and l.venue_id = v_v
                  and l.status in ('held', 'scheduled') and l.end_at > now())
       or exists (select 1 from courses co
                   where co.coach_id = v_c.id and co.venue_id = v_v and co.status in ('open', 'running')) then
      raise exception 'BRANCH_HAS_BOOKINGS' using errcode = 'P0001', detail = 'coach_lessons', hint = v_v::text;
    end if;
  end loop;

  foreach v_v in array v_venues loop
    perform set_config('app.venue_id', v_v::text, true);
    insert into coach_branches (coach_id, venue_id, active)
    values (v_c.id, v_v, true)
    on conflict (coach_id, venue_id) do update set active = true;
  end loop;
  foreach v_v in array v_drop loop
    perform set_config('app.venue_id', v_v::text, true);
    update coach_branches set active = false where coach_id = v_c.id and venue_id = v_v and active;
  end loop;

  perform app.write_audit('coaching.coach.branches', 'coaches', v_c.id::text,
                          jsonb_build_object('venue_ids', to_jsonb(v_before)),
                          jsonb_build_object('venue_ids', (select coalesce(jsonb_agg(b.venue_id order by b.venue_id), '[]'::jsonb)
                                                             from coach_branches b
                                                            where b.coach_id = v_c.id and b.active),
                                             'dropped', to_jsonb(v_drop)));
  return jsonb_build_object(
    'coach_id', v_c.id,
    'venue_ids', (select coalesce(jsonb_agg(b.venue_id order by b.venue_id), '[]'::jsonb)
                    from coach_branches b where b.coach_id = v_c.id and b.active),
    'dropped', to_jsonb(v_drop));
end $set_coach_branches_0279$;

comment on function app.set_coach_branches(uuid, uuid[]) is
  '0279 (db.md §4.6.3; R52, R73). Manager (coach in scope) and owner: the listed branches (each one the caller works at) become active; the caller''s other branches of the coach are switched off (their lessons are kept). Refusals: FORBIDDEN (role); COACH_NOT_FOUND; INVALID_ARGUMENT p_venue_ids (empty); FORBIDDEN (scope, or a listed branch the caller does not work at); under the coach lock, BRANCH_HAS_BOOKINGS detail coach_lessons (hint the branch id) when a branch it would switch off has a held or scheduled lesson of the coach not yet ended or an open or running course. Audited coaching.coach.branches. Returns {coach_id, venue_ids, dropped}.';

revoke all on function app.set_coach_branches(uuid, uuid[]) from public, anon;
grant execute on function app.set_coach_branches(uuid, uuid[]) to authenticated;

-- The lesson types a coach teaches at one branch. R46: unlinking a type
-- deletes the coach's own price for it, so a relink starts from the type
-- price and an old approval never comes back against a different price.
create or replace function app.set_coach_lesson_types(p_coach_id uuid, p_venue_id uuid, p_lesson_type_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $set_coach_lesson_types_0279$
declare
  v_venue   uuid;
  v_c       coaches%rowtype;
  v_ids     uuid[];
  v_t       uuid;
  v_added   uuid[];
  v_removed uuid[];
  v_prices  jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_coach_id is not null then
    select * into v_c from coaches c where c.id = p_coach_id;
  end if;
  if v_c.id is null then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not exists (select 1 from coach_branches b
                  where b.coach_id = v_c.id and b.venue_id = v_venue and b.active) then
    raise exception 'COACH_NOT_AT_BRANCH' using errcode = 'P0001';
  end if;
  if p_lesson_type_ids is null or array_position(p_lesson_type_ids, null) is not null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_type_ids';
  end if;
  v_ids := array(select distinct x from unnest(p_lesson_type_ids) x order by x);
  foreach v_t in array v_ids loop
    if not exists (select 1 from lesson_types lt where lt.id = v_t and lt.venue_id = v_venue) then
      raise exception 'LESSON_TYPE_NOT_FOUND' using errcode = 'P0001', detail = v_t::text;
    end if;
  end loop;

  -- Level H: a booking reads coach_lesson_types under the same key.
  perform app.lock_coach(v_c.id);
  perform set_config('app.venue_id', v_venue::text, true);

  v_removed := array(select ct.lesson_type_id from coach_lesson_types ct
                      where ct.coach_id = v_c.id and ct.venue_id = v_venue
                        and not (ct.lesson_type_id = any (v_ids))
                      order by ct.lesson_type_id);
  v_added := array(select x from unnest(v_ids) x
                    where not exists (select 1 from coach_lesson_types ct
                                       where ct.coach_id = v_c.id and ct.lesson_type_id = x)
                    order by x);

  select coalesce(jsonb_agg(jsonb_build_object('lesson_type_id', cp.lesson_type_id, 'price_iqd', cp.price_iqd)
                            order by cp.lesson_type_id), '[]'::jsonb)
    into v_prices
    from coach_prices cp
   where cp.coach_id = v_c.id and cp.lesson_type_id = any (v_removed);

  delete from coach_prices where coach_id = v_c.id and lesson_type_id = any (v_removed);
  delete from coach_lesson_types where coach_id = v_c.id and lesson_type_id = any (v_removed);
  insert into coach_lesson_types (coach_id, lesson_type_id, venue_id)
  select v_c.id, x, v_venue from unnest(v_added) x
  on conflict (coach_id, lesson_type_id) do nothing;

  if cardinality(v_added) > 0 or cardinality(v_removed) > 0 then
    perform app.write_audit('coaching.coach.types', 'coaches', v_c.id::text, null,
                            jsonb_build_object('venue_id', v_venue, 'added', to_jsonb(v_added),
                                               'removed', to_jsonb(v_removed), 'prices_removed', v_prices));
  end if;
  return jsonb_build_object(
    'coach_id', v_c.id,
    'venue_id', v_venue,
    'lesson_type_ids', (select coalesce(jsonb_agg(ct.lesson_type_id order by ct.lesson_type_id), '[]'::jsonb)
                          from coach_lesson_types ct where ct.coach_id = v_c.id and ct.venue_id = v_venue),
    'prices_removed', v_prices);
end $set_coach_lesson_types_0279$;

comment on function app.set_coach_lesson_types(uuid, uuid, uuid[]) is
  '0279 (db.md §4.6.3; R46). Manager and owner at the branch: replace the lesson types coach p_coach_id teaches at branch p_venue_id (default: the caller''s resolved branch) with p_lesson_type_ids (empty: none). The coach''s own price of every type dropped from the set is deleted (R46); lessons are untouched. Refusals: FORBIDDEN (role; branch); COACH_NOT_FOUND; COACH_NOT_AT_BRANCH (no active row there); INVALID_ARGUMENT p_lesson_type_ids; LESSON_TYPE_NOT_FOUND (detail the id; a type not at the branch). Audited coaching.coach.types with the prices removed. Returns {coach_id, venue_id, lesson_type_ids, prices_removed}.';

revoke all on function app.set_coach_lesson_types(uuid, uuid, uuid[]) from public, anon;
grant execute on function app.set_coach_lesson_types(uuid, uuid, uuid[]) to authenticated;

-- ===========================================================================
-- 4. Lesson types and coach prices: the price lock (db.md §4.6.4; C-17, R46)
-- ===========================================================================

-- The one validator (R46): applies p_patch to p_old (a NULL p_old.id is a new
-- type at p_venue) and returns the resulting row, or refuses INVALID_ARGUMENT
-- naming the key. The wrapper and the protocol apply both run it, so an apply
-- never meets a raw 23514.
create or replace function app.lesson_type_merge(p_old lesson_types, p_patch jsonb, p_venue uuid)
returns lesson_types
language plpgsql stable security definer set search_path = public as $lesson_type_merge_0279$
declare
  v_allowed text[] := array['name_en', 'name_ar', 'description_en', 'description_ar', 'duration_min',
                            'price_iqd', 'court_share_iqd', 'max_places', 'min_places', 'cutoff_hours',
                            'sessions_count', 'is_active', 'sort_order', 'kind'];
  v_new     lesson_types;
  v_create  boolean := p_old.id is null;
  v_key     text;
  v_text    text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_patch';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    -- launched_at, venue_id, id and created_by_staff_id are refused by name
    -- like every other key outside the list.
    if not (v_key = any (v_allowed)) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;
  if v_create and not (p_patch ? 'kind') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'kind';
  end if;
  if not v_create and p_patch ? 'kind' then
    -- D-9: a type's kind never changes.
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'kind';
  end if;

  v_new := p_old;
  if v_create then
    v_new.venue_id := p_venue;
    v_new.kind := case when jsonb_typeof(p_patch->'kind') = 'string' then p_patch->>'kind' end;
    if v_new.kind is null or v_new.kind not in ('private', 'group', 'course') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'kind';
    end if;
    v_new.description_en := '';
    v_new.description_ar := '';
    v_new.court_share_iqd := 0;
    v_new.min_places := 1;
    -- R26: a group or course type gets a two-hour cut-off unless one is given.
    v_new.cutoff_hours := case when v_new.kind = 'private' then 0 else 2 end;
    v_new.is_active := false;
    v_new.sort_order := 0;
  end if;

  if p_patch ? 'name_en' then
    v_text := case when jsonb_typeof(p_patch->'name_en') = 'string' then app.safe_line(p_patch->>'name_en') end;
    if v_text is null or char_length(v_text) not between 1 and 60 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'name_en';
    end if;
    v_new.name_en := v_text;
  end if;
  if p_patch ? 'name_ar' then
    v_text := case when jsonb_typeof(p_patch->'name_ar') = 'string' then app.safe_line(p_patch->>'name_ar') end;
    if v_text is null or char_length(v_text) not between 1 and 60 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'name_ar';
    end if;
    v_new.name_ar := v_text;
  end if;
  if p_patch ? 'description_en' then
    if jsonb_typeof(p_patch->'description_en') not in ('string', 'null') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'description_en';
    end if;
    v_new.description_en := coalesce(app.safe_text(p_patch->>'description_en'), '');
  end if;
  if p_patch ? 'description_ar' then
    if jsonb_typeof(p_patch->'description_ar') not in ('string', 'null') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'description_ar';
    end if;
    v_new.description_ar := coalesce(app.safe_text(p_patch->>'description_ar'), '');
  end if;
  if p_patch ? 'duration_min' then
    v_new.duration_min := app.venue_patch_int(p_patch, 'duration_min', 30, 240);
  end if;
  if p_patch ? 'price_iqd' then
    if jsonb_typeof(p_patch->'price_iqd') = 'null' then
      v_new.price_iqd := null;
    else
      v_new.price_iqd := app.venue_patch_int(p_patch, 'price_iqd', 1, 100000000);
    end if;
  end if;
  if p_patch ? 'court_share_iqd' then
    v_new.court_share_iqd := app.venue_patch_int(p_patch, 'court_share_iqd', 0, 100000000);
  end if;
  if p_patch ? 'max_places' then
    v_new.max_places := app.venue_patch_int(p_patch, 'max_places', 1, 16);
  end if;
  if p_patch ? 'min_places' then
    v_new.min_places := app.venue_patch_int(p_patch, 'min_places', 1, 16);
  end if;
  if p_patch ? 'cutoff_hours' then
    v_new.cutoff_hours := app.venue_patch_int(p_patch, 'cutoff_hours', 0, 168);
  end if;
  if p_patch ? 'sessions_count' then
    if jsonb_typeof(p_patch->'sessions_count') = 'null' then
      v_new.sessions_count := null;
    else
      v_new.sessions_count := app.venue_patch_int(p_patch, 'sessions_count', 2, 52);
    end if;
  end if;
  if p_patch ? 'is_active' then
    if jsonb_typeof(p_patch->'is_active') <> 'boolean' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'is_active';
    end if;
    v_new.is_active := (p_patch->>'is_active')::boolean;
  end if;
  if p_patch ? 'sort_order' then
    v_new.sort_order := app.venue_patch_int(p_patch, 'sort_order', 0, 100000);
  end if;

  -- The resulting row against lesson_types' CHECKs (0275), key by key.
  if v_new.name_en is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'name_en';
  end if;
  if v_new.name_ar is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'name_ar';
  end if;
  if char_length(v_new.description_en) > 500 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'description_en';
  end if;
  if char_length(v_new.description_ar) > 500 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'description_ar';
  end if;
  if v_new.duration_min is null or v_new.duration_min not between 30 and 240 or v_new.duration_min % 30 <> 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'duration_min';
  end if;
  if v_new.max_places is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'max_places';
  end if;
  if v_new.kind = 'private' then
    if v_new.max_places not between 1 and 4 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'max_places';
    end if;
    if v_new.min_places <> 1 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'min_places';
    end if;
    if v_new.cutoff_hours <> 0 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'cutoff_hours';
    end if;
  else
    if v_new.max_places not between 2 and 16 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'max_places';
    end if;
    if v_new.min_places not between 1 and v_new.max_places then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'min_places';
    end if;
    if v_new.cutoff_hours not between 0 and 168 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'cutoff_hours';
    end if;
    -- lesson_types_cutoff (R26): a minimum above one needs a cut-off of an hour.
    if v_new.min_places > 1 and v_new.cutoff_hours < 1 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'cutoff_hours';
    end if;
  end if;
  if (v_new.kind = 'course') <> (v_new.sessions_count is not null) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'sessions_count';
  end if;
  if v_new.price_iqd is not null and v_new.kind = 'course' and v_new.price_iqd < v_new.sessions_count then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'price_iqd';
  end if;
  -- lesson_types_launch: a launched or active type keeps a price.
  if v_new.price_iqd is null and (v_new.launched_at is not null or v_new.is_active) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'price_iqd';
  end if;
  return v_new;
end $lesson_type_merge_0279$;

comment on function app.lesson_type_merge(lesson_types, jsonb, uuid) is
  '0279 (db.md §4.6.4; R26, R46). Internal: the one lesson-type validator. Applies p_patch (keys name_en, name_ar, description_en, description_ar, duration_min, price_iqd, court_share_iqd, max_places, min_places, cutoff_hours, sessions_count, is_active, sort_order, and kind on create only) to p_old (NULL id: a new type at p_venue; a new group or course type gets cutoff_hours 2, R26) and returns the resulting row, or INVALID_ARGUMENT naming the key: an unknown key (launched_at, venue_id, id, created_by_staff_id included), kind missing on create or present on update, or a value outside lesson_types'' CHECKs for the resulting row. Writes nothing.';

revoke all on function app.lesson_type_merge(lesson_types, jsonb, uuid) from public, anon, authenticated;

-- No role check: called by the wrapper below and by the protocol apply
-- (0282's price_promo_apply_internal, with a null actor).
create or replace function app.upsert_lesson_type_internal(p_venue uuid, p_id uuid, p_patch jsonb)
returns lesson_types
language plpgsql security definer set search_path = public as $upsert_lesson_type_internal_0279$
declare
  v_old lesson_types;
  v_new lesson_types;
  v_row lesson_types;
begin
  if p_venue is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_venue_id';
  end if;
  if p_id is not null then
    select * into v_old from lesson_types where id = p_id for update;
    if v_old.id is null or v_old.venue_id <> p_venue then
      raise exception 'LESSON_TYPE_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;
  v_new := app.lesson_type_merge(v_old, p_patch, p_venue);

  perform set_config('app.venue_id', p_venue::text, true);

  if v_old.id is null then
    insert into lesson_types (venue_id, kind, name_en, name_ar, description_en, description_ar, duration_min,
                              price_iqd, court_share_iqd, max_places, min_places, cutoff_hours, sessions_count,
                              is_active, launched_at, sort_order, created_by_staff_id)
    values (p_venue, v_new.kind, v_new.name_en, v_new.name_ar, v_new.description_en, v_new.description_ar,
            v_new.duration_min, v_new.price_iqd, v_new.court_share_iqd, v_new.max_places, v_new.min_places,
            v_new.cutoff_hours, v_new.sessions_count, v_new.is_active,
            case when v_new.is_active then now() end, v_new.sort_order,
            case when app.staff_role() is not null then auth.uid() end)
    returning * into v_row;
    perform app.write_audit('coaching.lesson_type.create', 'lesson_types', v_row.id::text, null,
                            to_jsonb(v_row) - 'description_en' - 'description_ar');
  else
    update lesson_types
       set name_en = v_new.name_en,
           name_ar = v_new.name_ar,
           description_en = v_new.description_en,
           description_ar = v_new.description_ar,
           duration_min = v_new.duration_min,
           price_iqd = v_new.price_iqd,
           court_share_iqd = v_new.court_share_iqd,
           max_places = v_new.max_places,
           min_places = v_new.min_places,
           cutoff_hours = v_new.cutoff_hours,
           sessions_count = v_new.sessions_count,
           is_active = v_new.is_active,
           -- Switching on a never-launched type launches it.
           launched_at = case when v_new.is_active and launched_at is null then now() else launched_at end,
           sort_order = v_new.sort_order,
           updated_at = now()
     where id = v_old.id
    returning * into v_row;
    perform app.write_audit('coaching.lesson_type.update', 'lesson_types', v_row.id::text,
                            to_jsonb(v_old) - 'description_en' - 'description_ar',
                            to_jsonb(v_row) - 'description_en' - 'description_ar');
  end if;
  return v_row;
end $upsert_lesson_type_internal_0279$;

comment on function app.upsert_lesson_type_internal(uuid, uuid, jsonb) is
  '0279 (db.md §4.6.4; C-17, R46). Internal, no role check: called by app.upsert_lesson_type and by the price-or-promotion apply (0282). Reads an existing type FOR UPDATE (LESSON_TYPE_NOT_FOUND unless at p_venue), validates the result with app.lesson_type_merge (INVALID_ARGUMENT naming the key), then inserts or updates; is_active turning true on a never-launched type stamps launched_at. Existing lessons keep their snapshots. Audited coaching.lesson_type.create | update.';

revoke all on function app.upsert_lesson_type_internal(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function app.upsert_lesson_type(p_venue_id uuid, p_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $upsert_lesson_type_0279$
declare
  v_venue uuid;
  v_old   lesson_types;
  v_new   lesson_types;
  v_row   lesson_types;
begin
  -- R57: the role first, then the branch.
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- Read FOR UPDATE so a save racing a protocol apply waits for it and then
  -- sees the type launched (the 0177 size-lock rule).
  if p_id is not null then
    select * into v_old from lesson_types where id = p_id for update;
    if v_old.id is null or v_old.venue_id <> v_venue then
      raise exception 'LESSON_TYPE_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;
  v_new := app.lesson_type_merge(v_old, p_patch, v_venue);

  -- The lock, for a manager (the 0177:1767-1769 shape). Drafts are edited
  -- freely (C-17); names, descriptions, group and course places, cut-off,
  -- order and switching a launched type off or on stay the manager's.
  if app.staff_role() = 'manager' then
    if v_old.id is not null and v_old.launched_at is not null then
      if v_new.price_iqd is distinct from v_old.price_iqd
         or v_new.court_share_iqd is distinct from v_old.court_share_iqd then
        raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001', detail = 'price';
      end if;
      -- R46: the price would buy something else.
      if v_new.duration_min is distinct from v_old.duration_min
         or v_new.sessions_count is distinct from v_old.sessions_count
         or (v_old.kind = 'private' and v_new.max_places is distinct from v_old.max_places) then
        raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001', detail = 'shape';
      end if;
    elsif v_new.is_active then
      raise exception 'LAUNCH_VIA_PROTOCOL' using errcode = 'P0001';
    end if;
  end if;

  v_row := app.upsert_lesson_type_internal(v_venue, v_old.id, p_patch);
  return to_jsonb(v_row) || jsonb_build_object('lesson_type_id', v_row.id);
end $upsert_lesson_type_0279$;

comment on function app.upsert_lesson_type(uuid, uuid, jsonb) is
  '0279 (db.md §4.6.4; C-17, R46, R57). Manager and owner at the branch: create (p_id NULL; kind required) or edit a lesson type. For a manager: on a launched type a change of price_iqd or court_share_iqd is PRICE_VIA_PROTOCOL detail price, of duration_min, sessions_count or a private type''s max_places PRICE_VIA_PROTOCOL detail shape; switching a never-launched type on is LAUNCH_VIA_PROTOCOL. Drafts and every other field are direct. The owner passes every lock. Refusals before that: FORBIDDEN (role; branch); LESSON_TYPE_NOT_FOUND; INVALID_ARGUMENT naming the key (app.lesson_type_merge). Returns the type row with lesson_type_id.';

revoke all on function app.upsert_lesson_type(uuid, uuid, jsonb) from public, anon;
grant execute on function app.upsert_lesson_type(uuid, uuid, jsonb) to authenticated;

-- The only writer of coach_prices besides set_coach_lesson_types' delete.
create or replace function app.set_coach_price_internal(p_coach_id uuid, p_lesson_type_id uuid, p_price_iqd bigint,
                                                        p_run_id uuid)
returns void
language plpgsql security definer set search_path = public as $set_coach_price_internal_0279$
declare
  v_venue  uuid;
  v_before bigint;
begin
  select lt.venue_id into v_venue from lesson_types lt where lt.id = p_lesson_type_id;
  if v_venue is null then
    raise exception 'LESSON_TYPE_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  select cp.price_iqd into v_before from coach_prices cp
   where cp.coach_id = p_coach_id and cp.lesson_type_id = p_lesson_type_id;
  if p_price_iqd is null then
    delete from coach_prices where coach_id = p_coach_id and lesson_type_id = p_lesson_type_id;
  else
    insert into coach_prices (coach_id, lesson_type_id, venue_id, price_iqd, set_at, protocol_run_id)
    values (p_coach_id, p_lesson_type_id, v_venue, p_price_iqd, now(), p_run_id)
    on conflict (coach_id, lesson_type_id)
      do update set price_iqd = excluded.price_iqd, set_at = now(), protocol_run_id = excluded.protocol_run_id;
  end if;
  perform app.write_audit('coaching.coach_price', 'coach_prices', p_coach_id::text || ':' || p_lesson_type_id::text,
                          jsonb_build_object('price_iqd', v_before),
                          jsonb_build_object('coach_id', p_coach_id, 'lesson_type_id', p_lesson_type_id,
                                             'price_iqd', p_price_iqd, 'protocol_run_id', p_run_id));
end $set_coach_price_internal_0279$;

comment on function app.set_coach_price_internal(uuid, uuid, bigint, uuid) is
  '0279 (db.md §4.6.4; C-5, C-17). Internal, no role check: called by app.set_coach_price (the owner, p_run_id NULL) and the price-or-promotion apply (0282, the run). NULL price deletes the coach''s price; else upserts it with protocol_run_id. Asserts app.venue_id to the type''s branch. Audited coaching.coach_price.';

revoke all on function app.set_coach_price_internal(uuid, uuid, bigint, uuid) from public, anon, authenticated;

create or replace function app.set_coach_price(p_coach_id uuid, p_lesson_type_id uuid, p_price_iqd bigint)
returns jsonb
language plpgsql security definer set search_path = public as $set_coach_price_0279$
declare
  v_c coaches%rowtype;
  v_t lesson_types%rowtype;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_coach_id is not null then
    select * into v_c from coaches c where c.id = p_coach_id and c.status <> 'retired';
  end if;
  if v_c.id is null then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_lesson_type_id is not null then
    select * into v_t from lesson_types lt where lt.id = p_lesson_type_id;
  end if;
  if v_t.id is null then
    raise exception 'LESSON_TYPE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_t.venue_id, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- D-8: a manager never sets a coach price directly, drafts included.
  if app.staff_role() = 'manager' then
    raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001', detail = 'price';
  end if;
  if p_price_iqd is not null
     and (p_price_iqd <= 0 or p_price_iqd > 100000000
          or (v_t.kind = 'course' and p_price_iqd < v_t.sessions_count)) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_price_iqd';
  end if;
  if not exists (select 1 from coach_lesson_types ct
                  where ct.coach_id = v_c.id and ct.lesson_type_id = v_t.id) then
    raise exception 'LESSON_TYPE_NOT_OFFERED' using errcode = 'P0001';
  end if;

  perform app.lock_coach(v_c.id);
  perform app.set_coach_price_internal(v_c.id, v_t.id, p_price_iqd, null);
  return jsonb_build_object('coach_id', v_c.id, 'lesson_type_id', v_t.id, 'price_iqd', p_price_iqd);
end $set_coach_price_0279$;

comment on function app.set_coach_price(uuid, uuid, bigint) is
  '0279 (db.md §4.6.4; C-5, C-17, D-8). The owner sets (or with NULL removes) a coach''s own price for a lesson type they teach; a manager goes through the price-or-promotion protocol (coach_price). Refusals: FORBIDDEN (role); COACH_NOT_FOUND (unknown or retired); LESSON_TYPE_NOT_FOUND; FORBIDDEN (branch); PRICE_VIA_PROTOCOL detail price (a manager, drafts included); INVALID_ARGUMENT p_price_iqd (<= 0, over 100,000,000, or below the sessions of a course); LESSON_TYPE_NOT_OFFERED. Returns {coach_id, lesson_type_id, price_iqd}.';

revoke all on function app.set_coach_price(uuid, uuid, bigint) from public, anon;
grant execute on function app.set_coach_price(uuid, uuid, bigint) to authenticated;

-- ===========================================================================
-- 5. Hours and time off (db.md §4.6.5; C-4, CD-10, R73)
-- ===========================================================================

-- p_windows as sent: an array of 0..28 objects {weekday 0..6, start, end}
-- ("HH:MM" on :00 or :30; end may be 24:00). start_time / end_time are read
-- too (both spellings reached the lane files). Returns the windows
-- normalised as [{i, weekday, start_time, end_time}] (i = the 0-based index
-- sent), or HOURS_INVALID detail the index (p_windows for the array itself),
-- or HOURS_OVERLAP detail the index of a window that overlaps an earlier one
-- of the set on its weekday (R73).
create or replace function app.coach_windows_parse(p_windows jsonb) returns jsonb
language plpgsql immutable security definer set search_path = public as $coach_windows_parse_0279$
declare
  v_w   jsonb;
  v_i   int;
  v_wd  text;
  v_s   text;
  v_e   text;
  v_out jsonb := '[]'::jsonb;
  v_x   record;
begin
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' or jsonb_array_length(p_windows) > 28 then
    raise exception 'HOURS_INVALID' using errcode = 'P0001', detail = 'p_windows';
  end if;
  for v_w, v_i in
    select x.value, (x.ordinality - 1)::int from jsonb_array_elements(p_windows) with ordinality x
  loop
    if jsonb_typeof(v_w) <> 'object' then
      raise exception 'HOURS_INVALID' using errcode = 'P0001', detail = v_i::text;
    end if;
    v_wd := v_w->>'weekday';
    v_s := coalesce(v_w->>'start_time', v_w->>'start');
    v_e := coalesce(v_w->>'end_time', v_w->>'end');
    if v_wd is null or v_wd !~ '^[0-6]$'
       or v_s is null or v_s !~ '^([01][0-9]|2[0-3]):(00|30)$'
       or v_e is null or v_e !~ '^(([01][0-9]|2[0-3]):(00|30)|24:00)$'
       or v_s::time >= v_e::time then
      raise exception 'HOURS_INVALID' using errcode = 'P0001', detail = v_i::text;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('i', v_i, 'weekday', v_wd::int,
                                                           'start_time', v_s, 'end_time', v_e));
  end loop;

  -- Two windows of the set overlapping on one weekday: the later one's index.
  for v_x in
    select b.i
      from jsonb_to_recordset(v_out) as a(i int, weekday int, start_time time, end_time time)
      join jsonb_to_recordset(v_out) as b(i int, weekday int, start_time time, end_time time)
        on b.weekday = a.weekday and b.i > a.i
       and b.start_time < a.end_time and a.start_time < b.end_time
     order by b.i
     limit 1
  loop
    raise exception 'HOURS_OVERLAP' using errcode = 'P0001', detail = v_x.i::text;
  end loop;
  return v_out;
end $coach_windows_parse_0279$;

comment on function app.coach_windows_parse(jsonb) is
  '0279 (db.md §4.6.5; CD-10, D-18, R73). Internal. Validates a coach''s weekly windows for one branch: an array of 0..28 objects {weekday 0..6, start, end} (or start_time, end_time), "HH:MM" on :00 or :30, end up to 24:00, start before end; HOURS_INVALID detail the 0-based index (p_windows for the array). Two windows of the set overlapping on a weekday: HOURS_OVERLAP detail the later index. Returns [{i, weekday, start_time, end_time}].';

revoke all on function app.coach_windows_parse(jsonb) from public, anon, authenticated;

-- The shared writer of set_coach_hours and set_my_coach_hours: under the
-- coach lock, a window that overlaps one of the coach's windows at another
-- branch on its weekday is HOURS_OVERLAP detail its index (R73); then the
-- coach's rows at the branch are replaced. Lessons already booked outside
-- the new hours stay.
create or replace function app.coach_hours_write(p_coach_id uuid, p_venue uuid, p_windows jsonb, p_staff_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $coach_hours_write_0279$
declare
  v_w     jsonb;
  v_x     record;
  v_out   jsonb;
begin
  if not exists (select 1 from coach_branches b
                  where b.coach_id = p_coach_id and b.venue_id = p_venue and b.active) then
    raise exception 'COACH_NOT_AT_BRANCH' using errcode = 'P0001';
  end if;
  v_w := app.coach_windows_parse(p_windows);

  -- Level H.
  perform app.lock_coach(p_coach_id);

  for v_x in
    select w.i
      from jsonb_to_recordset(v_w) as w(i int, weekday int, start_time time, end_time time)
     where exists (select 1 from coach_hours h
                    where h.coach_id = p_coach_id and h.venue_id <> p_venue
                      and h.weekday = w.weekday
                      and h.start_time < w.end_time and w.start_time < h.end_time)
     order by w.i
     limit 1
  loop
    raise exception 'HOURS_OVERLAP' using errcode = 'P0001', detail = v_x.i::text;
  end loop;

  perform set_config('app.venue_id', p_venue::text, true);
  delete from coach_hours where coach_id = p_coach_id and venue_id = p_venue;
  insert into coach_hours (coach_id, venue_id, weekday, start_time, end_time, set_by, set_by_staff_id, updated_at)
  select p_coach_id, p_venue, w.weekday, w.start_time, w.end_time,
         case when p_staff_id is null then 'coach' else 'staff' end, p_staff_id, now()
    from jsonb_to_recordset(v_w) as w(i int, weekday int, start_time time, end_time time)
   order by w.i;

  perform app.write_audit('coaching.hours', 'coaches', p_coach_id::text, null,
                          jsonb_build_object('coach_id', p_coach_id, 'venue_id', p_venue,
                                             'windows', jsonb_array_length(v_w),
                                             'set_by', case when p_staff_id is null then 'coach' else 'staff' end));

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', h.id,
           'weekday', h.weekday,
           'start_time', to_char(h.start_time, 'HH24:MI'),
           'end_time', case when h.end_time = time '24:00' then '24:00' else to_char(h.end_time, 'HH24:MI') end,
           'set_by', h.set_by,
           'updated_at', h.updated_at)
           order by h.weekday, h.start_time), '[]'::jsonb)
    into v_out
    from coach_hours h
   where h.coach_id = p_coach_id and h.venue_id = p_venue;
  return jsonb_build_object('coach_id', p_coach_id, 'venue_id', p_venue, 'windows', v_out, 'hours', v_out);
end $coach_hours_write_0279$;

comment on function app.coach_hours_write(uuid, uuid, jsonb, uuid) is
  '0279 (db.md §4.6.5; R73). Internal: replaces a coach''s weekly windows at one branch (set_by staff with p_staff_id, else coach). COACH_NOT_AT_BRANCH without an active branch row; app.coach_windows_parse''s HOURS_INVALID and HOURS_OVERLAP; under the coach lock, HOURS_OVERLAP detail the index of a window overlapping the coach''s window at another branch on that weekday. Audited coaching.hours. Returns {coach_id, venue_id, windows, hours} (the same list under both names).';

revoke all on function app.coach_hours_write(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

create or replace function app.set_coach_hours(p_coach_id uuid, p_venue_id uuid, p_windows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $set_coach_hours_0279$
declare
  v_venue uuid;
  v_c     coaches%rowtype;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_coach_id is not null then
    select * into v_c from coaches c where c.id = p_coach_id and c.status <> 'retired';
  end if;
  if v_c.id is null then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0001';
  end if;
  return app.coach_hours_write(v_c.id, v_venue, p_windows, auth.uid());
end $set_coach_hours_0279$;

comment on function app.set_coach_hours(uuid, uuid, jsonb) is
  '0279 (db.md §4.6.5; C-4). Manager and owner at the branch: replace coach p_coach_id''s weekly windows at branch p_venue_id (default: the caller''s resolved branch); set_by staff. Refusals: FORBIDDEN (role; branch); COACH_NOT_FOUND (unknown or retired); then app.coach_hours_write''s COACH_NOT_AT_BRANCH, HOURS_INVALID, HOURS_OVERLAP. Returns {coach_id, venue_id, windows, hours}.';

revoke all on function app.set_coach_hours(uuid, uuid, jsonb) from public, anon;
grant execute on function app.set_coach_hours(uuid, uuid, jsonb) to authenticated;

create or replace function app.set_my_coach_hours(p_venue_id uuid, p_windows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $set_my_coach_hours_0279$
declare
  v_c coaches%rowtype := app.coach_self();
begin
  if p_venue_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_venue_id';
  end if;
  return app.coach_hours_write(v_c.id, p_venue_id, p_windows, null);
end $set_my_coach_hours_0279$;

comment on function app.set_my_coach_hours(uuid, jsonb) is
  '0279 (db.md §4.6.5; C-4). Coach (app.coach_self first): replace the caller''s weekly windows at branch p_venue_id; set_by coach. Refusals: NOT_A_COACH (and the session codes); INVALID_ARGUMENT p_venue_id; COACH_NOT_AT_BRANCH, HOURS_INVALID, HOURS_OVERLAP (app.coach_hours_write). Returns {coach_id, venue_id, windows, hours}.';

revoke all on function app.set_my_coach_hours(uuid, jsonb) from public, anon;
grant execute on function app.set_my_coach_hours(uuid, jsonb) to authenticated;

create or replace function app.coach_hours_mine() returns jsonb
language plpgsql stable security definer set search_path = public as $coach_hours_mine_0279$
declare
  v_c coaches%rowtype := app.coach_self();
begin
  return jsonb_build_object(
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'venue_id', v.id,
               'name_en', v.name_en,
               'name_ar', v.name_ar,
               'timezone', coalesce(vs.timezone, v.timezone),
               'coaching_enabled', coalesce(vs.coaching_enabled, false) and v.is_active,
               'windows', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', h.id,
                          'weekday', h.weekday,
                          'start_time', to_char(h.start_time, 'HH24:MI'),
                          'end_time', case when h.end_time = time '24:00' then '24:00'
                                           else to_char(h.end_time, 'HH24:MI') end,
                          'set_by', h.set_by,
                          'updated_at', h.updated_at)
                          order by h.weekday, h.start_time)
                   from coach_hours h
                  where h.coach_id = v_c.id and h.venue_id = v.id), '[]'::jsonb))
             order by v.name_en, v.id)
        from coach_branches b
        join venues v on v.id = b.venue_id and v.status <> 'closed'
        left join venue_settings vs on vs.venue_id = v.id
       where b.coach_id = v_c.id and b.active), '[]'::jsonb),
    'time_off', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id,
               'starts_at', lower(t.period),
               'ends_at', upper(t.period),
               'reason', t.reason,
               'set_by', t.set_by)
             order by lower(t.period))
        from coach_time_off t
       where t.coach_id = v_c.id and t.cancelled_at is null and upper(t.period) > now()), '[]'::jsonb),
    'server_now', now());
end $coach_hours_mine_0279$;

comment on function app.coach_hours_mine() is
  '0279 (db.md §4.6.5; guest.md §4.3). Coach (app.coach_self first): {branches: [{venue_id, name_*, timezone, coaching_enabled, windows: [{id, weekday, start_time, end_time, set_by, updated_at}]}], time_off: [{id, starts_at, ends_at, reason, set_by}] (not cancelled, not ended), server_now} for every not-closed branch where the caller is active.';

revoke all on function app.coach_hours_mine() from public, anon;
grant execute on function app.coach_hours_mine() to authenticated;

-- The shared writer of add_coach_time_off and add_my_time_off.
create or replace function app.coach_time_off_add(p_coach_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
                                                  p_reason text, p_staff_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $coach_time_off_add_0279$
declare
  v_reason text := coalesce(app.safe_line(p_reason), '');
  v_count  int;
  v_t      coach_time_off%rowtype;
begin
  if p_starts_at is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_starts_at';
  end if;
  if p_ends_at is null or p_ends_at <= p_starts_at or p_ends_at <= now()
     or p_ends_at - p_starts_at > interval '366 days' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_ends_at';
  end if;
  if char_length(v_reason) > 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reason';
  end if;

  -- Level H: no booking can land in the period while it is checked.
  perform app.lock_coach(p_coach_id);

  select count(*) into v_count
    from lessons l
   where l.coach_id = p_coach_id
     and l.status in ('held', 'scheduled')
     and l.period && tstzrange(p_starts_at, p_ends_at, '[)');
  if v_count > 0 then
    raise exception 'TIME_OFF_HAS_LESSONS' using errcode = 'P0001', detail = v_count::text,
      hint = 'move or cancel those lessons first';
  end if;

  begin
    insert into coach_time_off (coach_id, period, reason, set_by, set_by_staff_id)
    values (p_coach_id, tstzrange(p_starts_at, p_ends_at, '[)'), v_reason,
            case when p_staff_id is null then 'coach' else 'staff' end, p_staff_id)
    returning * into v_t;
  exception when exclusion_violation then
    raise exception 'HOURS_OVERLAP' using errcode = 'P0001', detail = 'time_off';
  end;

  perform app.write_audit('coaching.time_off', 'coach_time_off', v_t.id::text, null,
                          jsonb_build_object('coach_id', p_coach_id, 'starts_at', p_starts_at,
                                             'ends_at', p_ends_at, 'set_by', v_t.set_by, 'action', 'add'));
  return jsonb_build_object('id', v_t.id, 'starts_at', lower(v_t.period), 'ends_at', upper(v_t.period),
                            'reason', v_t.reason, 'set_by', v_t.set_by);
end $coach_time_off_add_0279$;

comment on function app.coach_time_off_add(uuid, timestamptz, timestamptz, text, uuid) is
  '0279 (db.md §4.6.5). Internal: one time-off period of a coach (set_by staff with p_staff_id, else coach). INVALID_ARGUMENT p_starts_at | p_ends_at (start >= end, end <= now, over 366 days) | p_reason (over 200); under the coach lock TIME_OFF_HAS_LESSONS detail how many held or scheduled lessons of the coach overlap; HOURS_OVERLAP detail time_off when it overlaps a live period (coach_time_off_no_overlap). Audited coaching.time_off (no reason text). Returns {id, starts_at, ends_at, reason, set_by}.';

revoke all on function app.coach_time_off_add(uuid, timestamptz, timestamptz, text, uuid) from public, anon, authenticated;

create or replace function app.add_coach_time_off(p_coach_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
                                                  p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $add_coach_time_off_0279$
declare
  v_c coaches%rowtype;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_coach_id is not null then
    select * into v_c from coaches c where c.id = p_coach_id and c.status <> 'retired';
  end if;
  if v_c.id is null then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.coach_staff_scope(v_c.id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return app.coach_time_off_add(v_c.id, p_starts_at, p_ends_at, p_reason, auth.uid());
end $add_coach_time_off_0279$;

comment on function app.add_coach_time_off(uuid, timestamptz, timestamptz, text) is
  '0279 (db.md §4.6.5; C-4). Manager (coach in scope) and owner: add a time-off period for a coach (set_by staff). Refusals: FORBIDDEN (role); COACH_NOT_FOUND; FORBIDDEN (scope); then app.coach_time_off_add''s INVALID_ARGUMENT, TIME_OFF_HAS_LESSONS, HOURS_OVERLAP time_off. Returns {id, starts_at, ends_at, reason, set_by}.';

revoke all on function app.add_coach_time_off(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function app.add_coach_time_off(uuid, timestamptz, timestamptz, text) to authenticated;

create or replace function app.add_my_time_off(p_starts_at timestamptz, p_ends_at timestamptz, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $add_my_time_off_0279$
declare
  v_c coaches%rowtype := app.coach_self();
begin
  return app.coach_time_off_add(v_c.id, p_starts_at, p_ends_at, p_reason, null);
end $add_my_time_off_0279$;

comment on function app.add_my_time_off(timestamptz, timestamptz, text) is
  '0279 (db.md §4.6.5; C-4). Coach (app.coach_self first): add a time-off period of the caller''s (set_by coach); the refusals of app.coach_time_off_add. Returns {id, starts_at, ends_at, reason, set_by}.';

revoke all on function app.add_my_time_off(timestamptz, timestamptz, text) from public, anon;
grant execute on function app.add_my_time_off(timestamptz, timestamptz, text) to authenticated;

create or replace function app.cancel_coach_time_off(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $cancel_coach_time_off_0279$
declare
  v_t coach_time_off%rowtype;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_id is not null then
    select * into v_t from coach_time_off t where t.id = p_id;
  end if;
  -- X31: an unknown id is INVALID_ARGUMENT p_id (the operator refetches).
  if v_t.id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_id';
  end if;
  if not app.coach_staff_scope(v_t.coach_id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_t.cancelled_at is not null then
    return jsonb_build_object('id', v_t.id, 'cancelled_at', v_t.cancelled_at, 'duplicate', true);
  end if;
  perform app.lock_coach(v_t.coach_id);
  update coach_time_off set cancelled_at = now() where id = v_t.id and cancelled_at is null
  returning * into v_t;
  if v_t.id is null then
    select * into v_t from coach_time_off t where t.id = p_id;
    return jsonb_build_object('id', v_t.id, 'cancelled_at', v_t.cancelled_at, 'duplicate', true);
  end if;
  perform app.write_audit('coaching.time_off', 'coach_time_off', v_t.id::text, null,
                          jsonb_build_object('coach_id', v_t.coach_id, 'action', 'cancel', 'by', 'staff'));
  return jsonb_build_object('id', v_t.id, 'cancelled_at', v_t.cancelled_at, 'duplicate', false);
end $cancel_coach_time_off_0279$;

comment on function app.cancel_coach_time_off(uuid) is
  '0279 (db.md §4.6.5; X31). Manager (coach in scope) and owner: end a time-off period. Refusals: FORBIDDEN (role); INVALID_ARGUMENT p_id (unknown); FORBIDDEN (scope). Already cancelled: {duplicate: true}. Audited coaching.time_off. Returns {id, cancelled_at, duplicate}.';

revoke all on function app.cancel_coach_time_off(uuid) from public, anon;
grant execute on function app.cancel_coach_time_off(uuid) to authenticated;

create or replace function app.cancel_my_time_off(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $cancel_my_time_off_0279$
declare
  v_c coaches%rowtype := app.coach_self();
  v_t coach_time_off%rowtype;
begin
  if p_id is not null then
    select * into v_t from coach_time_off t where t.id = p_id and t.coach_id = v_c.id;
  end if;
  -- Unknown and someone else's read the same (X31).
  if v_t.id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_id';
  end if;
  if v_t.cancelled_at is not null then
    return jsonb_build_object('id', v_t.id, 'cancelled_at', v_t.cancelled_at, 'duplicate', true);
  end if;
  perform app.lock_coach(v_c.id);
  update coach_time_off set cancelled_at = now() where id = v_t.id and cancelled_at is null
  returning * into v_t;
  if v_t.id is null then
    select * into v_t from coach_time_off t where t.id = p_id;
    return jsonb_build_object('id', v_t.id, 'cancelled_at', v_t.cancelled_at, 'duplicate', true);
  end if;
  perform app.write_audit('coaching.time_off', 'coach_time_off', v_t.id::text, null,
                          jsonb_build_object('coach_id', v_c.id, 'action', 'cancel', 'by', 'coach'));
  return jsonb_build_object('id', v_t.id, 'cancelled_at', v_t.cancelled_at, 'duplicate', false);
end $cancel_my_time_off_0279$;

comment on function app.cancel_my_time_off(uuid) is
  '0279 (db.md §4.6.5; X31). Coach (app.coach_self first): end one of the caller''s own time-off periods. INVALID_ARGUMENT p_id for an unknown or someone else''s id; already cancelled: {duplicate: true}. Returns {id, cancelled_at, duplicate}.';

revoke all on function app.cancel_my_time_off(uuid) from public, anon;
grant execute on function app.cancel_my_time_off(uuid) to authenticated;

-- ===========================================================================
-- 6. Photos (db.md §4.6.3, R43)
-- ===========================================================================

-- app.storage_path_in_use re-issued from
-- 20260926000223_open_a_new_branch.sql:498, verbatim plus the coaches row
-- (R43): the operator's removeMedia never deletes a live coach photo and
-- does delete a replaced one.
create or replace function app.storage_path_in_use(p_path text)
returns boolean
language plpgsql stable security definer set search_path = public as $storage_path_in_use_0279$
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_path, '')), '') is null then
    return false;
  end if;
  return (  (select count(*) from menu_items      where photo_path = p_path)
          + (select count(*) from menu_categories where photo_path = p_path)
          + (select count(*) from courts          where photo_path = p_path)
          + (select count(*) from cafe_settings   where key = 'hero_media_path' and value #>> '{}' = p_path)
          + (select count(*) from coaches         where photo_path = p_path)   -- 0279 (R43)
         ) > 0;
end $storage_path_in_use_0279$;

comment on function app.storage_path_in_use(text) is
  '0223 (MV6), coaches since 0279 (R43). Staff: true while any row (menu item, category, court, a branch''s hero, a coach) still points at this storage path. The operator asks it after moving a row off a photo, so replacing a photo on one branch never deletes the object another branch shares, and a live coach photo is never removed.';

revoke all on function app.storage_path_in_use(text) from public, anon;
grant execute on function app.storage_path_in_use(text) to authenticated;

-- The purge queue's service pair (the incident_photo_purge_due /
-- incident_photos_purged shape, 0198:577-610): protocol-action lists the
-- objects under each folder, removes them from menu-media and marks the row.
create or replace function app.coach_photo_purge_due(p_limit int default 20) returns jsonb
language sql stable security definer set search_path = public as $coach_photo_purge_due_0279$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'folder', d.folder) order by d.queued_at, d.id),
                  '[]'::jsonb)
    from (select q.id, q.folder, q.queued_at
            from coach_photo_purges q
           where q.purged_at is null
           order by q.queued_at, q.id
           limit greatest(coalesce(p_limit, 20), 1)) d
$coach_photo_purge_due_0279$;

comment on function app.coach_photo_purge_due(int) is
  '0279 (R43). Service role: [{id, folder}], the oldest coach photo folders queued for removal (retirement, account deletion) and not yet purged; protocol-action removes coaches/<folder>/* from menu-media and calls app.coach_photo_purged.';

revoke all on function app.coach_photo_purge_due(int) from public, anon, authenticated;
grant execute on function app.coach_photo_purge_due(int) to service_role;

create or replace function app.coach_photo_purged(p_id uuid) returns void
language sql security definer set search_path = public as $coach_photo_purged_0279$
  update coach_photo_purges set purged_at = now() where id = p_id and purged_at is null
$coach_photo_purged_0279$;

comment on function app.coach_photo_purged(uuid) is
  '0279 (R43). Service role: marks a queued coach photo folder removed from storage.';

revoke all on function app.coach_photo_purged(uuid) from public, anon, authenticated;
grant execute on function app.coach_photo_purged(uuid) to service_role;
