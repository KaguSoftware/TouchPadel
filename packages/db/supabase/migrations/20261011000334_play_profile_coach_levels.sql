set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0334 play_profile_coach_levels — the Play tab, the Coaches tab and the
-- tournament seating board (Majed 2026-10-11;
-- docs/design/play-coaches/contracts-2026-10-11.md §4).
--
--   1. profiles gains the guest's play profile: play_level (new | beginner |
--      intermediate | advanced), play_years (never | under_one | one_to_three
--      | three_plus), play_wants (a subset of matches, tournaments, lessons)
--      and play_survey_at (stamped when the sign-up survey is answered or
--      skipped; NULL = never asked). Plain nullable columns with CHECKs: no
--      rewrite. The four are readable like the username (a column grant, so
--      the phone's own-profile select names them; the desk reads them through
--      profiles_select as it reads the name); none is client-writable.
--   2. app.set_my_play_profile(p_level, p_years, p_wants): the only writer.
--      Any argument may be NULL (a skipped question; all three NULL is a
--      skipped survey); play_survey_at is always stamped. A bad value is
--      INVALID_PLAY_PROFILE (detail the argument).
--   3. Account deletion empties the four: the tombstone trigger
--      (app.trg_profile_media_tombstone, latest 0317) is re-issued with them.
--      delete_my_account (latest 0306) is not re-issued; a 0303 merge's drop
--      is tombstoned by the same UPDATE, so it is emptied too.
--   4. coaches.levels text[] NOT NULL DEFAULT '{}', a subset of beginner,
--      intermediate, advanced; EMPTY MEANS ALL LEVELS. No client grant
--      (coaches has none, 0278); read through the RPCs below.
--   5. coaches_admin and coach_update (latest 0290) carry levels; coach_update
--      accepts it in p_patch (an array, kept in the canonical order, duplicates
--      dropped). coaching_public and coach_profile (latest 0283) carry levels on
--      each coach / the coach card.
--   6. tournament_public (latest 0311) gains entries: [{player, mine}], the
--      registered entries in registration order (when each became registered:
--      promoted_at for a promoted waitlist entry, else entered_at), before and
--      after the schedule exists; [] for a missing tournament. The player is
--      the existing public shape {name ("First I.", null for a desk-added
--      profile with no accepted terms), former, no (seed_no, null before the
--      draw)}; mine is false for anon. No guest id, phone or full name (T-8).

-- ---------------------------------------------------------------------------
-- 1. profiles: the play profile, its CHECKs and its read grant
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists play_level     text;
alter table profiles add column if not exists play_years     text;
alter table profiles add column if not exists play_wants     text[];
alter table profiles add column if not exists play_survey_at timestamptz;

comment on column profiles.play_level is
  '0334. The guest''s own level from the play survey: new | beginner | intermediate | advanced, NULL = not answered. Written only by app.set_my_play_profile; orders suggestions, never hides anything. Emptied by account deletion.';
comment on column profiles.play_years is
  '0334. How long the guest has played: never | under_one | one_to_three | three_plus, NULL = not answered. Written only by app.set_my_play_profile. Emptied by account deletion.';
comment on column profiles.play_wants is
  '0334. What the guest is after: a subset of matches, tournaments, lessons in that order, NULL = not answered. Written only by app.set_my_play_profile. Emptied by account deletion.';
comment on column profiles.play_survey_at is
  '0334. When the play survey was answered or skipped (app.set_my_play_profile always stamps it); NULL = never asked. Emptied by account deletion.';

do $constraints_0334$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_play_level_chk'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_play_level_chk check (
      play_level is null or play_level in ('new', 'beginner', 'intermediate', 'advanced')) not valid;
    alter table profiles validate constraint profiles_play_level_chk;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_play_years_chk'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_play_years_chk check (
      play_years is null or play_years in ('never', 'under_one', 'one_to_three', 'three_plus')) not valid;
    alter table profiles validate constraint profiles_play_years_chk;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'profiles_play_wants_chk'
                    and conrelid = 'public.profiles'::regclass) then
    alter table profiles add constraint profiles_play_wants_chk check (
      play_wants is null
      or (cardinality(play_wants) between 1 and 3
          and array_position(play_wants, null) is null
          and play_wants <@ array['matches', 'tournaments', 'lessons']::text[])) not valid;
    alter table profiles validate constraint profiles_play_wants_chk;
  end if;
end $constraints_0334$;

-- Readable like the username (0314): the guest's own row, and the desk's
-- through profiles_select. No UPDATE grant: the RPC below is the only writer.
grant select (play_level, play_years, play_wants, play_survey_at) on profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.set_my_play_profile — written by its guest only
-- ---------------------------------------------------------------------------
create or replace function app.set_my_play_profile(p_level text default null, p_years text default null,
                                                   p_wants text[] default null)
returns jsonb
language plpgsql security definer set search_path = public as $set_my_play_profile_0334$
declare
  v_uid   uuid := auth.uid();
  v_wants text[];
  v_row   profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  -- An anonymous café session has no profile (0004 skips is_anonymous).
  if not exists (select 1 from profiles where id = v_uid and deleted_at is null) then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  if p_level is not null and p_level not in ('new', 'beginner', 'intermediate', 'advanced') then
    raise exception 'INVALID_PLAY_PROFILE' using errcode = 'P0001', detail = 'p_level', hint = 'p_level';
  end if;
  if p_years is not null and p_years not in ('never', 'under_one', 'one_to_three', 'three_plus') then
    raise exception 'INVALID_PLAY_PROFILE' using errcode = 'P0001', detail = 'p_years', hint = 'p_years';
  end if;
  if p_wants is not null then
    if array_position(p_wants, null) is not null
       or not (p_wants <@ array['matches', 'tournaments', 'lessons']::text[]) then
      raise exception 'INVALID_PLAY_PROFILE' using errcode = 'P0001', detail = 'p_wants', hint = 'p_wants';
    end if;
    -- The canonical order, each once; an empty choice is no answer.
    v_wants := array(select w.v
                       from unnest(array['matches', 'tournaments', 'lessons']::text[]) with ordinality w(v, o)
                      where w.v = any (p_wants)
                      order by w.o);
    if cardinality(v_wants) = 0 then
      v_wants := null;
    end if;
  end if;

  update profiles
     set play_level     = p_level,
         play_years     = p_years,
         play_wants     = v_wants,
         play_survey_at = now()
   where id = v_uid
     and deleted_at is null
  returning * into v_row;
  if not found then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'play_level', v_row.play_level,
    'play_years', v_row.play_years,
    'play_wants', to_jsonb(v_row.play_wants),
    'play_survey_at', v_row.play_survey_at);
end $set_my_play_profile_0334$;

comment on function app.set_my_play_profile(text, text, text[]) is
  '0334 (play-coaches contracts §4.1). The caller''s own profile: the play survey''s answers. p_level new | beginner | intermediate | advanced, p_years never | under_one | one_to_three | three_plus, p_wants a subset of matches, tournaments, lessons (kept in that order, each once; an empty array is no answer). Any argument may be NULL or left out (a skipped question; all three NULL = the survey skipped); play_survey_at is always stamped now(). AUTH_REQUIRED; ACCOUNT_REQUIRED (no live profile: an anonymous session or a deleted account); INVALID_PLAY_PROFILE detail p_level | p_years | p_wants. Returns {play_level, play_years, play_wants, play_survey_at}.';

revoke all on function app.set_my_play_profile(text, text, text[]) from public, anon;
grant execute on function app.set_my_play_profile(text, text, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The tombstone trigger: re-created from
--    20261007000317_frame_style.sql:190, verbatim plus the play profile.
-- ---------------------------------------------------------------------------
create or replace function app.trg_profile_media_tombstone() returns trigger
language plpgsql security definer set search_path = public as $trg_profile_media_tombstone_0334$
begin
  if tg_op = 'DELETE' then
    insert into avatar_purges (path) values (old.id::text);
    return old;
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    new.avatar_path := null;
    new.birth_date  := null;
    insert into avatar_purges (path) values (new.id::text);
    -- 0314: the username is held from everyone else for 90 days.
    if old.username is not null then
      insert into username_holds (username, profile_id, released_at, reason)
      values (old.username, new.id, now() + interval '90 days', 'deleted')
      on conflict (username) do update
        set profile_id = excluded.profile_id, held_at = now(),
            released_at = excluded.released_at, reason = excluded.reason;
    end if;
    new.username            := null;
    new.username_changed_at := null;
    new.avatar_frame        := 'brand-green';
    new.avatar_frame_style  := 'solid';
    -- 0334: the play survey's answers.
    new.play_level     := null;
    new.play_years     := null;
    new.play_wants     := null;
    new.play_survey_at := null;
  end if;
  return new;
end $trg_profile_media_tombstone_0334$;

comment on function app.trg_profile_media_tombstone() is
  '0302, username and frame since 0314, frame style since 0317, the play profile since 0334. Trigger profiles_media_tombstone: on the 0077 tombstone UPDATE (account deletion, or a 0303 merge''s drop), empties avatar_path, birth_date, the username (held 90 days in username_holds) and the play profile (play_level, play_years, play_wants, play_survey_at) and puts the frame back to brand-green, solid; on that UPDATE or a DELETE, queues the account''s whole avatars folder in avatar_purges.';

revoke all on function app.trg_profile_media_tombstone() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. coaches.levels — the levels a coach teaches; empty = every level
-- ---------------------------------------------------------------------------
alter table coaches add column if not exists levels text[] not null default '{}';

comment on column coaches.levels is
  '0334. The levels this coach teaches: a subset of beginner, intermediate, advanced, kept in that order. EMPTY MEANS ALL LEVELS: such a coach shows under every level of the Coaches tab. Written only by app.coach_update (p_patch levels); read through coaches_admin, coaching_public and coach_profile (no client grant on coaches).';

do $coach_levels_0334$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'coaches_levels_chk'
                    and conrelid = 'public.coaches'::regclass) then
    alter table coaches add constraint coaches_levels_chk check (
      cardinality(levels) <= 3
      and array_position(levels, null) is null
      and levels <@ array['beginner', 'intermediate', 'advanced']::text[]) not valid;
    alter table coaches validate constraint coaches_levels_chk;
  end if;
end $coach_levels_0334$;

-- ---------------------------------------------------------------------------
-- 5a. app.coaches_admin (re-issued from 0290:134, plus levels)
-- ---------------------------------------------------------------------------
create or replace function app.coaches_admin(p_venue_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $coaches_admin_0334$
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
                   -- 0334: the levels the coach teaches; empty = every level.
                   'levels', to_jsonb(c.levels),
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
                         join venues ve on ve.id = h.venue_id and ve.status <> 'closed'
                         join coach_branches hb on hb.coach_id = h.coach_id and hb.venue_id = h.venue_id
                                               and hb.active
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
end $coaches_admin_0334$;

comment on function app.coaches_admin(uuid) is
  '0282 (db.md §4.6.3; X19, R46, R57), 0290 (DB-02: hours_elsewhere only at active, not-closed branches), 0334 (levels). Manager and owner, at the branch (default: the caller''s resolved branch). {venue_id, coaching_enabled, server_now, coaches: [{coach_id, profile_id, full_name, phone, account_deleted, display_name_*, bio_*, photo_path, status, public_accepted_at, retired_at, sort_order, levels (a subset of beginner, intermediate, advanced; [] = every level), venue_ids, active_here, lesson_type_ids, prices, hours, hours_set_by, hours_set_by_name, hours_updated_at, hours_elsewhere, time_off, upcoming_lessons, open_courses}], lesson_types: [{lesson_type_id, kind, name_*, description_*, duration_min, price_iqd, court_share_iqd, max_places, min_places, cutoff_hours, sessions_count, is_active, launched_at, sort_order, coach_ids, pending_run}]} for every coach with a coach_branches row at the branch and every type of the branch. hours_elsewhere lists the coach''s windows at the other branches where the coach is active and that are not closed. The profile''s name and phone are staff data, never public. FORBIDDEN by role, then by branch.';

revoke all on function app.coaches_admin(uuid) from public, anon;
grant execute on function app.coaches_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5b. app.coach_update (re-issued from 0290:459, plus levels in p_patch)
-- ---------------------------------------------------------------------------
create or replace function app.coach_update(p_coach_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $coach_update_0334$
declare
  v_allowed text[] := array['display_name_en', 'display_name_ar', 'bio_en', 'bio_ar', 'photo_path', 'sort_order',
                             'levels'];
  v_c       coaches%rowtype;
  v_new     coaches;
  v_key     text;
  v_text    text;
  v_old_dir text;
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

  -- 0290 (DB-03): level H, then the row as it stands now. A retirement holds
  -- the coach lock; an account deletion holds the row (it never takes the
  -- mutex), so both are waited for and the status below is the committed one.
  perform app.lock_coach(v_c.id);
  select * into v_c from coaches c where c.id = p_coach_id for update;
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
  -- 0334: the levels taught, an array of beginner | intermediate | advanced
  -- (empty = every level), kept in that order, each once.
  if p_patch ? 'levels' then
    if jsonb_typeof(p_patch->'levels') <> 'array'
       or exists (select 1 from jsonb_array_elements(p_patch->'levels') x
                   where jsonb_typeof(x) <> 'string'
                      or x #>> '{}' not in ('beginner', 'intermediate', 'advanced')) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'levels';
    end if;
    v_new.levels := array(select l.v
                            from unnest(array['beginner', 'intermediate', 'advanced']::text[])
                                 with ordinality l(v, o)
                           where exists (select 1 from jsonb_array_elements_text(p_patch->'levels') y(v)
                                          where y.v = l.v)
                           order by l.o);
  end if;

  update coaches
     set display_name_en = v_new.display_name_en,
         display_name_ar = v_new.display_name_ar,
         bio_en = v_new.bio_en,
         bio_ar = v_new.bio_ar,
         photo_path = v_new.photo_path,
         sort_order = v_new.sort_order,
         levels = v_new.levels,
         updated_at = now()
   where id = v_c.id
     and status <> 'retired'
  returning * into v_new;
  if not found then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'retired';
  end if;

  -- 0290 (R43): a replaced photo's folder is queued for removal, as a
  -- retirement's is; the purge skips any object a row still points at.
  v_old_dir := substring(v_c.photo_path from '^(coaches/[0-9a-f-]{36})/');
  if v_old_dir is not null
     and v_old_dir is distinct from substring(v_new.photo_path from '^(coaches/[0-9a-f-]{36})/') then
    insert into coach_photo_purges (coach_id, folder) values (v_c.id, v_old_dir);
  end if;

  perform app.write_audit('coaching.coach.update', 'coaches', v_c.id::text,
                          jsonb_build_object('display_name_en', v_c.display_name_en,
                                             'display_name_ar', v_c.display_name_ar,
                                             'photo_path', v_c.photo_path, 'sort_order', v_c.sort_order,
                                             'levels', to_jsonb(v_c.levels),
                                             'bio_changed', false),
                          jsonb_build_object('display_name_en', v_new.display_name_en,
                                             'display_name_ar', v_new.display_name_ar,
                                             'photo_path', v_new.photo_path, 'sort_order', v_new.sort_order,
                                             'levels', to_jsonb(v_new.levels),
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
    'levels', to_jsonb(v_new.levels),
    'public_accepted_at', v_new.public_accepted_at,
    'updated_at', v_new.updated_at);
end $coach_update_0334$;

comment on function app.coach_update(uuid, jsonb) is
  '0282 (db.md §4.6.3; C-7, R43), 0290 (DB-03), 0334 (levels). Manager (a coach in scope) and owner: patch a coach''s display_name_en, display_name_ar (1..60), bio_en, bio_ar (<= 1000), photo_path (NULL clears; coaches/<fresh uuid>/<file>, R43), sort_order and levels (an array of beginner | intermediate | advanced, stored in that order, each once; [] = every level). Under the coach lock with the row FOR UPDATE, so a retirement or account deletion committed first is never written over. A replaced photo''s old folder is queued in coach_photo_purges. Refusals: FORBIDDEN (role); COACH_NOT_FOUND; FORBIDDEN (scope); INVALID_ARGUMENT p_patch | the key | retired. Audited coaching.coach.update (names, photo, order, levels and whether a bio changed). Returns the coach''s card {coach_id, status, display_name_*, bio_*, photo_path, sort_order, levels, public_accepted_at, updated_at}.';

revoke all on function app.coach_update(uuid, jsonb) from public, anon;
grant execute on function app.coach_update(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 5c. app.coaching_public (re-issued from 0283:4917, plus levels on a coach)
-- ---------------------------------------------------------------------------
create or replace function app.coaching_public(p_venue_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $coaching_public_0334$
declare
  v_venues  uuid[];
  v_coaches jsonb;
  v_types   jsonb;
  v_branch  jsonb;
begin
  -- Open branches with coaching on; a named branch that is off, closed or
  -- unknown, or no branch at all, is {off: true} and nothing else.
  select coalesce(array_agg(v.id order by v.created_at, v.id), '{}'::uuid[])
    into v_venues
    from venues v
    join venue_settings vs on vs.venue_id = v.id
   where v.is_active
     and vs.coaching_enabled
     and (p_venue_id is null or v.id = p_venue_id);
  if cardinality(v_venues) = 0 then
    return jsonb_build_object('off', true);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'venue_id', v.id,
           'name_en', v.name_en,
           'name_ar', v.name_ar,
           'timezone', coalesce(vs.timezone, v.timezone),
           'payment_mode', vs.lesson_payment_mode,
           'prices_public', vs.lesson_prices_public,
           'cancellation_window_hours', vs.cancellation_window_hours)
           order by v.created_at, v.id), '[]'::jsonb)
    into v_branch
    from venues v
    join venue_settings vs on vs.venue_id = v.id
   where v.id = any (v_venues);

  -- Active coaches who accepted going public (R16, R61, R76), with an active
  -- branch row at a listed branch. Prices are always sent (C-11).
  select coalesce(jsonb_agg(x.j order by x.sort_order, x.display_name_en, x.id), '[]'::jsonb)
    into v_coaches
    from (select co.id, co.sort_order, co.display_name_en,
                 jsonb_build_object(
                   'id', co.id,
                   'display_name_en', co.display_name_en,
                   'display_name_ar', co.display_name_ar,
                   'bio_en', co.bio_en,
                   'bio_ar', co.bio_ar,
                   'photo_path', co.photo_path,
                   'sort_order', co.sort_order,
                   -- 0334: empty = every level.
                   'levels', to_jsonb(co.levels),
                   'venue_ids', to_jsonb(b.venue_ids),
                   'offers', coalesce((
                     select jsonb_agg(jsonb_build_object(
                              'lesson_type_id', t.id,
                              'venue_id', t.venue_id,
                              'price_iqd', app.lesson_price_for(co.id, t.id))
                              order by t.venue_id, t.sort_order, t.name_en, t.id)
                       from coach_lesson_types clt
                       join lesson_types t on t.id = clt.lesson_type_id
                      where clt.coach_id = co.id
                        and t.is_active
                        and t.venue_id = any (b.venue_ids)), '[]'::jsonb)) as j
            from coaches co
            cross join lateral (select array_agg(cb.venue_id order by cb.venue_id) as venue_ids
                                  from coach_branches cb
                                 where cb.coach_id = co.id
                                   and cb.active
                                   and cb.venue_id = any (v_venues)) b
           where co.status = 'active'
             and co.public_accepted_at is not null
             and b.venue_ids is not null) x;

  -- Types on sale at a listed branch that a listed coach teaches there.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id,
           'venue_id', t.venue_id,
           'kind', t.kind,
           'name_en', t.name_en,
           'name_ar', t.name_ar,
           'description_en', t.description_en,
           'description_ar', t.description_ar,
           'duration_min', t.duration_min,
           'max_places', t.max_places,
           'min_places', t.min_places,
           'sessions_count', t.sessions_count,
           'price_iqd', t.price_iqd,
           'sort_order', t.sort_order)
           order by t.venue_id, t.sort_order, t.name_en, t.id), '[]'::jsonb)
    into v_types
    from lesson_types t
   where t.venue_id = any (v_venues)
     and t.is_active
     and exists (select 1
                   from coach_lesson_types clt
                   join coaches co on co.id = clt.coach_id
                   join coach_branches cb on cb.coach_id = co.id and cb.venue_id = t.venue_id and cb.active
                  where clt.lesson_type_id = t.id
                    and co.status = 'active'
                    and co.public_accepted_at is not null);

  return jsonb_build_object(
    'off', false,
    'branches', v_branch,
    'coaches', v_coaches,
    'lesson_types', v_types,
    'sessions', app.lesson_read_sessions(v_venues, null),
    'server_now', now());
end $coaching_public_0334$;

comment on function app.coaching_public(uuid) is
  '0283 (db.md §4.7.9, guest.md §4.3; X1, C-11, R16, R61, R76), 0334 (levels). Anon and authenticated, public by design; never raises. {off: true} when the named branch has coaching off, is closed or unknown, or (p_venue_id NULL) no open branch has coaching on. Else {off: false, branches[{venue_id, name_en, name_ar, timezone, payment_mode, prices_public, cancellation_window_hours}], coaches[{id, display_name_en, display_name_ar, bio_en, bio_ar, photo_path, sort_order, levels (0334: a subset of beginner, intermediate, advanced; [] = every level), venue_ids, offers[{lesson_type_id, venue_id, price_iqd}]}] (active coaches who accepted going public, with an active branch row), lesson_types[{id, venue_id, kind, name_*, description_*, duration_min, max_places, min_places, sessions_count, price_iqd, sort_order}] (on sale, taught by a listed coach), sessions[] (app.lesson_read_sessions), server_now}. Prices are always sent; the website drops them while prices_public is false. No student, phone, profile id or court id.';

revoke all on function app.coaching_public(uuid) from public;
grant execute on function app.coaching_public(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5d. app.coach_profile (re-issued from 0283:5033, plus levels on the card)
-- ---------------------------------------------------------------------------
create or replace function app.coach_profile(p_coach_id uuid, p_venue_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $coach_profile_0334$
declare
  v_co     coaches%rowtype;
  v_v      venues%rowtype;
  v_vs     venue_settings%rowtype;
  v_ids    uuid[];
  v_card   jsonb;
  v_paused boolean;
  v_offers jsonb;
begin
  if p_coach_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_coach_id';
  end if;
  select * into v_co from coaches where id = p_coach_id;
  if not found or v_co.status = 'retired' or v_co.public_accepted_at is null then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_paused := v_co.status = 'paused';

  select coalesce(array_agg(v.id order by v.created_at, v.id), '{}'::uuid[])
    into v_ids
    from coach_branches cb
    join venues v on v.id = cb.venue_id and v.is_active
    join venue_settings vs on vs.venue_id = v.id and vs.coaching_enabled
   where cb.coach_id = v_co.id
     and cb.active;

  v_card := jsonb_build_object(
    'id', v_co.id,
    'display_name_en', v_co.display_name_en,
    'display_name_ar', v_co.display_name_ar,
    'bio_en', v_co.bio_en,
    'bio_ar', v_co.bio_ar,
    'photo_path', v_co.photo_path,
    'status', v_co.status,
    -- 0334: empty = every level.
    'levels', to_jsonb(v_co.levels),
    'venue_ids', to_jsonb(v_ids));

  if p_venue_id is null then
    if cardinality(v_ids) = 0 then
      return jsonb_build_object('off', true);
    end if;
    return jsonb_build_object(
      'off', false, 'coach', v_card, 'venue', null, 'bookable', not v_paused,
      'offers', '[]'::jsonb, 'sessions', '[]'::jsonb, 'server_now', now());
  end if;

  select * into v_v from venues where id = p_venue_id and is_active;
  select * into v_vs from venue_settings where venue_id = p_venue_id;
  if v_v.id is null or not coalesce(v_vs.coaching_enabled, false) then
    return jsonb_build_object('off', true);
  end if;
  if not exists (select 1 from coach_branches cb
                  where cb.coach_id = v_co.id and cb.venue_id = p_venue_id and cb.active) then
    raise exception 'COACH_NOT_AT_BRANCH' using errcode = 'P0001';
  end if;

  if v_paused then
    v_offers := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
             'lesson_type_id', t.id,
             'kind', t.kind,
             'name_en', t.name_en,
             'name_ar', t.name_ar,
             'description_en', t.description_en,
             'description_ar', t.description_ar,
             'duration_min', t.duration_min,
             'max_places', t.max_places,
             'min_places', t.min_places,
             'sessions_count', t.sessions_count,
             'cutoff_hours', t.cutoff_hours,
             'price_iqd', app.lesson_price_for(v_co.id, t.id))
             order by t.sort_order, t.name_en, t.id), '[]'::jsonb)
      into v_offers
      from coach_lesson_types clt
      join lesson_types t on t.id = clt.lesson_type_id
     where clt.coach_id = v_co.id
       and t.venue_id = p_venue_id
       and t.is_active;
  end if;

  return jsonb_build_object(
    'off', false,
    'coach', v_card,
    'venue', jsonb_build_object(
      'venue_id', v_v.id,
      'name_en', v_v.name_en,
      'name_ar', v_v.name_ar,
      'timezone', coalesce(v_vs.timezone, v_v.timezone),
      'phone', coalesce(v_vs.phone, v_v.phone),
      'payment_mode', v_vs.lesson_payment_mode,
      'prices_public', v_vs.lesson_prices_public,
      'cancellation_window_hours', v_vs.cancellation_window_hours),
    'bookable', not v_paused,
    'offers', v_offers,
    'sessions', case when v_paused then '[]'::jsonb
                     else app.lesson_read_sessions(array[p_venue_id], v_co.id) end,
    'server_now', now());
end $coach_profile_0334$;

comment on function app.coach_profile(uuid, uuid) is
  '0283 (db.md §4.7.9, guest.md §4.3; X2, R17, R61, R76), 0334 (levels). Anon and authenticated, public by design. INVALID_ARGUMENT (p_coach_id NULL); COACH_NOT_FOUND (unknown, retired, or not yet accepted). p_venue_id NULL: {off: true} when the coach is active at no open branch with coaching on, else {off: false, coach: {id, display_name_*, bio_*, photo_path, status, levels (0334: a subset of beginner, intermediate, advanced; [] = every level), venue_ids}, venue: null, bookable, offers: [], sessions: [], server_now}. A named branch: {off: true} when it is closed, unknown or has coaching off; COACH_NOT_AT_BRANCH when the coach is not active there; else the card, venue {venue_id, name_*, timezone, phone (the branch''s), payment_mode, prices_public, cancellation_window_hours}, bookable, offers[{lesson_type_id, kind, name_*, description_*, duration_min, max_places, min_places, sessions_count, cutoff_hours, price_iqd (lesson_price_for)}] and sessions[] (app.lesson_read_sessions). A paused coach answers status paused, bookable false, no offers and no sessions (R76). No profile id, student or court.';

revoke all on function app.coach_profile(uuid, uuid) from public;
grant execute on function app.coach_profile(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.tournament_public (re-issued from 0311:733, plus entries)
-- ---------------------------------------------------------------------------
create or replace function app.tournament_public(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $tournament_public_0334$
declare
  v_uid       uuid := auth.uid();
  v_t         tournaments%rowtype;
  v_branch    jsonb;
  v_reg       int;
  v_wait      int;
  v_who       jsonb;
  v_courtno   jsonb;
  v_rounds    jsonb := '[]'::jsonb;
  v_standings jsonb := '[]'::jsonb;
  v_me        jsonb;
  v_entries   jsonb := '[]'::jsonb;
begin
  if p_id is null then
    return jsonb_build_object('missing', true, 'entries', '[]'::jsonb);
  end if;
  select * into v_t from tournaments where id = p_id;
  if not found or not app.tournament_on(v_t.venue_id)
     or (v_t.status = 'cancelled' and v_t.cancelled_at < now() - interval '7 days') then
    return jsonb_build_object('missing', true, 'entries', '[]'::jsonb);
  end if;

  select jsonb_build_object('venue_id', v.id, 'name_en', v.name_en, 'name_ar', v.name_ar,
                            'timezone', coalesce(vs.timezone, v.timezone))
    into v_branch
    from venues v left join venue_settings vs on vs.venue_id = v.id
   where v.id = v_t.venue_id;
  select count(*) filter (where e.status = 'registered')::int, count(*) filter (where e.status = 'waitlisted')::int
    into v_reg, v_wait
    from tournament_entries e
   where e.tournament_id = v_t.id;

  -- 0334: the registered entries in registration order (when each became
  -- registered: a promoted waitlist entry at its promotion), before and after
  -- the schedule exists, for the seating board. The player is the public
  -- shape the rounds use; mine is the caller's own entry (false for anon).
  select coalesce(jsonb_agg(jsonb_build_object(
           'player', jsonb_build_object(
             'name', case when e.added_by_kind = 'staff' and p.terms_version is null then null
                          else d.v->>'name' end,
             'former', coalesce((d.v->>'former')::boolean, false),
             'no', e.seed_no),
           'mine', coalesce(e.guest_id = v_uid, false))
           order by coalesce(e.promoted_at, e.entered_at), e.id), '[]'::jsonb)
    into v_entries
    from tournament_entries e
    left join profiles p on p.id = e.guest_id
    cross join lateral (select app.match_display_name(e.guest_id) as v) d
   where e.tournament_id = v_t.id
     and e.status = 'registered';

  if exists (select 1 from tournament_rounds r where r.tournament_id = v_t.id) then
    -- Every entry that can appear in the schedule or the standings.
    select coalesce(jsonb_object_agg(e.id::text, jsonb_build_object(
             'name', case when e.added_by_kind = 'staff' and p.terms_version is null then null
                          else d.v->>'name' end,
             'former', coalesce((d.v->>'former')::boolean, false),
             'no', e.seed_no)), '{}'::jsonb)
      into v_who
      from tournament_entries e
      left join profiles p on p.id = e.guest_id
      cross join lateral (select app.match_display_name(e.guest_id) as v) d
     where e.tournament_id = v_t.id and e.status <> 'waitlisted';

    select coalesce(jsonb_object_agg(c.id::text, c.n), '{}'::jsonb)
      into v_courtno
      from (select c.id, row_number() over (order by c.sort_order, c.id) as n
              from courts c
             where c.id in (select m.court_id from tournament_matches m where m.tournament_id = v_t.id)) c;

    select coalesce(jsonb_agg(jsonb_build_object(
             'round_no', r.round_no,
             'sit_out', coalesce((select jsonb_agg(v_who->(b.id::text) order by b.ord)
                                    from unnest(r.bye_entry_ids) with ordinality b(id, ord)), '[]'::jsonb),
             'matches', coalesce((select jsonb_agg(jsonb_build_object(
                                           'court_no', (v_courtno->>(m.court_id::text))::int,
                                           'a', jsonb_build_array(v_who->(m.a1::text), v_who->(m.a2::text)),
                                           'b', jsonb_build_array(v_who->(m.b1::text), v_who->(m.b2::text)),
                                           'points_a', m.points_a,
                                           'points_b', m.points_b)
                                           order by (v_courtno->>(m.court_id::text))::int)
                                    from tournament_matches m
                                   where m.round_id = r.id), '[]'::jsonb))
             order by r.round_no), '[]'::jsonb)
      into v_rounds
      from tournament_rounds r
     where r.tournament_id = v_t.id;

    -- The function's own order, as the desk reads it.
    select coalesce(jsonb_agg(jsonb_build_object(
             'rank', s.rank,
             'player', v_who->(s.entry_id::text),
             'points_won', s.points_won,
             'diff', s.diff,
             'played', s.played,
             'withdrawn', s.withdrawn)
             order by s.rank, se.seed_no nulls last, s.entry_id), '[]'::jsonb)
      into v_standings
      from app.tournament_standings(v_t.id) s
      left join tournament_entries se on se.id = s.entry_id;
  end if;

  if v_uid is not null then
    select jsonb_build_object(
             'entry_id', e.id,
             'status', e.status,
             'waitlist_position',
               case when e.status = 'waitlisted' then
                 (select count(*)::int + 1 from tournament_entries w
                   where w.tournament_id = e.tournament_id and w.status = 'waitlisted'
                     and (w.entered_at, w.id) < (e.entered_at, e.id)) end,
             'owed_iqd', (app.tournament_entry_money(e.id)->>'owed_iqd')::bigint)
      into v_me
      from tournament_entries e
     where e.tournament_id = v_t.id and e.guest_id = v_uid;
  end if;

  return jsonb_build_object(
    'missing', false,
    'id', v_t.id,
    'venue_id', v_t.venue_id,
    'branch', v_branch,
    'name_en', v_t.name_en,
    'name_ar', v_t.name_ar,
    'format', v_t.format,
    'category', v_t.category,
    'points_target', v_t.points_target,
    'rounds_planned', v_t.rounds_planned,
    'starts_at', v_t.starts_at,
    'ends_at', v_t.ends_at,
    'registration_closes_at', v_t.registration_closes_at,
    'entry_fee_iqd', v_t.entry_fee_iqd,
    'prize_en', v_t.prize_en,
    'prize_ar', v_t.prize_ar,
    'status', v_t.status,
    'max_entries', v_t.max_entries,
    'entries_count', v_reg,
    'places_left', greatest(v_t.max_entries - v_reg, 0),
    'waitlist_open', v_t.status = 'open' and now() < v_t.registration_closes_at
                     and v_reg >= v_t.max_entries and v_wait < v_t.waitlist_max,
    'server_now', now(),
    'rounds', v_rounds,
    'standings', v_standings,
    'entries', v_entries,
    'me', v_me);
end $tournament_public_0334$;

comment on function app.tournament_public(uuid) is
  'Tournaments (M7, T-8, §1.8, review M8; 0311 c27; 0334 entries). Public by design (anon and authenticated; never raises): {missing: true, entries: []} for an unknown id, a branch closed or switched off, or a tournament cancelled more than 7 days ago; otherwise {missing: false, id, venue_id, branch {venue_id, name_en, name_ar, timezone}, name_en, name_ar, format, category, points_target, rounds_planned, starts_at, ends_at, registration_closes_at, entry_fee_iqd, prize_en, prize_ar, status, max_entries, entries_count (registered), places_left, waitlist_open, server_now, rounds [{round_no, sit_out [player], matches [{court_no, a [player, player], b [player, player], points_a, points_b}]}], standings [{rank, player, points_won, diff, played, withdrawn (0311: left the play; ranked after every registered entry)}], entries [{player, mine}] (0334: the registered entries in registration order, promoted_at for a promoted waitlist entry else entered_at, then id; present before and after the schedule exists; mine is the caller''s own entry, false for anon), me {entry_id, status, waitlist_position, owed_iqd} (the caller''s own entry, with a session) | null}. A player is {name ("First I." via app.match_display_name, null for a desk-added profile with no accepted terms), former (a deleted account), no (seed_no)}; rounds and standings are empty until a schedule exists (entries is not: 0334, the seating board names the registered entries before the draw; no is null until seeds are given), and the waitlist is never named. court_no is an ordinal; no court id, guest id, phone or full name.';
