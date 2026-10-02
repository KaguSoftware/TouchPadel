set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0290 coaching_admin_fixes — the coaching post-build review, coach admin
-- (plan "Coaching: make it bulletproof" §1, items DB-01 to DB-06; build
-- contracts §1.15 D3). 0273–0289 are not edited: every function below is
-- re-issued from its latest body, verbatim except for the change named.
--
--   DB-01 app.set_coach_branches (0282:821). A manager's save carries every
--         branch of the coach they cannot show (another manager's, a closed
--         one), so a save never drops one by omission. The listed ids split
--         into the caller's own branches (upserted) and kept ones (left as
--         they are); a kept id must already be an active branch of the coach,
--         so adding a branch the caller does not work at is still FORBIDDEN.
--         A save may list no branch of the caller's own (they untick all of
--         theirs). The owner may drop a closed branch's row (close_branch is
--         not re-issued: it would be the only reason to touch it here).
--   DB-02 Hours left at a dropped branch blocked HOURS_OVERLAP elsewhere for
--         good. Dropping a branch (set_coach_branches, coach_promote's
--         revival) deletes the coach's hours there, audited coaching.hours
--         with 0 windows; app.coach_hours_write's cross-branch overlap and
--         app.coaches_admin's hours_elsewhere read only hours at an active
--         branch row of a branch that is not closed; coach_hours_write checks
--         COACH_NOT_AT_BRANCH again under the coach lock. A one-off data step
--         deletes the hours already stranded.
--   DB-03 app.coach_update (0282:690) takes the coach lock and the coach row
--         FOR UPDATE before it reads the status, and its UPDATE never writes
--         over a retired row (INVALID_ARGUMENT retired), so a retirement or
--         an account deletion is never undone by a stale write; a replaced
--         photo's old folder is queued for removal (R43).
--         app.delete_my_account (0289:57) locks the account's coach rows
--         (profile, then coach) and queues the photo folder of the row it
--         actually clears (UPDATE ... RETURNING the old path), so a photo
--         saved at the same moment is purged too. It still takes no coach
--         mutex, court lock or match lock: 0289's header ("takes no coach
--         lock") means the mutex, app.lock_coach; the coach ROW is now locked.
--         app.coach_promote (0282:567) reads the profile FOR SHARE, so a
--         deletion in flight is waited for and then CUSTOMER_NOT_FOUND.
--   DB-04 R46 races. app.set_coach_price (0282:1328) takes the coach lock
--         before it checks the link and re-reads the coach's status;
--         app.price_promo_apply_internal (0285:700) takes the coach lock
--         before the lesson type row on a coach_price change (coach first,
--         the booking order); app.set_coach_price_internal (0282:1294)
--         refuses LESSON_TYPE_NOT_OFFERED for a price without the link;
--         app.set_coach_lesson_types (0282:905) deletes any coach price of a
--         newly linked type, so a relink always starts from the type price.
--   DB-05 app.coach_in_hours (0282:110): a period is covered by the union of
--         the coach's windows, so touching windows join (10-12 and 12-16
--         take 11:30-12:30), and (§1.15 D3) a lesson may run past local
--         midnight into the next day's windows (Saturday 18-24 and Sunday
--         00-02 take 23:30-00:30). Time off and the active branch row are
--         checked as before.
--   DB-06 app.coach_time_off_add (0282:1604): under the coach lock, a live
--         period of the coach with exactly the same bounds set by the same
--         person comes back with duplicate true and no second audit row
--         (add_my_time_off is retried automatically). Every answer now
--         carries duplicate.
--
-- Locks: no new ranked lock. The coaches row (FOR UPDATE) and the profiles
-- row (FOR SHARE) are not ranked (like lessons, coaches are serialised by the
-- coach mutex); the order on them is profile, then coach, as delete_my_account
-- has always written them. price_promo_apply_internal now holds the coach
-- mutex before the lesson_types row: a booking holds the mutex and then a key
-- share on lesson_types through its foreign key, so the type first would
-- deadlock with it.
--
-- Same signatures and grants: the rls-matrix rows, the allowlist and the
-- assistant coverage stay as they are.

-- ===========================================================================
-- DB-05: app.coach_in_hours (re-issued from 0282:110)
-- ===========================================================================

-- True when the coach may teach over p_period at p_venue: an active branch
-- row, the period covered by the coach's windows at that branch on the local
-- day it starts and the next one (touching windows join, 24:00 meets the next
-- day's 00:00; §1.15 D3: a lesson may cross local midnight), and no live time
-- off over it. Does not look at other lessons.
create or replace function app.coach_in_hours(p_coach_id uuid, p_venue uuid, p_period tstzrange) returns boolean
language plpgsql stable security definer set search_path = public as $coach_in_hours_0290$
declare
  v_tz    text;
  v_ls    timestamp;
  v_le    timestamp;
  v_d     date;
  v_cover tsmultirange;
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
  v_d := v_ls::date;
  -- The windows of the start's local day and of the next day, as local
  -- timestamps, joined where they touch. A period past the next day's last
  -- window (or longer than two days) is never covered.
  select range_agg(tsrange(x.day + h.start_time, x.day + h.end_time, '[)'))
    into v_cover
    from (values (v_d), (v_d + 1)) as x(day)
    join coach_hours h on h.coach_id = p_coach_id
                      and h.venue_id = p_venue
                      and h.weekday = extract(dow from x.day)::int;
  if v_cover is null or not (v_cover @> tsrange(v_ls, v_le, '[)')) then
    return false;
  end if;
  if exists (select 1 from coach_time_off t
              where t.coach_id = p_coach_id and t.cancelled_at is null and t.period && p_period) then
    return false;
  end if;
  return true;
end $coach_in_hours_0290$;

comment on function app.coach_in_hours(uuid, uuid, tstzrange) is
  '0282 (db.md §4.6.2, CD-10), 0290 (DB-05, build contracts §1.15 D3). Internal. True when coach p_coach_id is active at branch p_venue, the union of the coach''s windows at that branch on the local day the period starts and on the next day covers it (touching windows join; an end at 24:00 meets the next day''s 00:00, so a lesson may cross local midnight), and no live time off overlaps it. Other lessons are not looked at (app.coach_available adds them).';

revoke all on function app.coach_in_hours(uuid, uuid, tstzrange) from public, anon, authenticated;

-- ===========================================================================
-- DB-02: app.coaches_admin (re-issued from 0282:396)
-- ===========================================================================

-- The admin read (X19, operator.md §5.6.3): every coach with a coach_branches
-- row at the branch, with the profile's name and phone (staff see customers),
-- and every lesson type of the branch. The desk never reads it (R20).
-- 0290 (DB-02): hours_elsewhere lists only hours at an active branch row of a
-- branch that is not closed, the ones coach_hours_write checks against.
create or replace function app.coaches_admin(p_venue_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $coaches_admin_0290$
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
end $coaches_admin_0290$;

comment on function app.coaches_admin(uuid) is
  '0282 (db.md §4.6.3; X19, R46, R57), 0290 (DB-02: hours_elsewhere only at active, not-closed branches). Manager and owner, at the branch (default: the caller''s resolved branch). {venue_id, coaching_enabled, server_now, coaches: [{coach_id, profile_id, full_name, phone, account_deleted, display_name_*, bio_*, photo_path, status, public_accepted_at, retired_at, sort_order, venue_ids, active_here, lesson_type_ids, prices, hours, hours_set_by, hours_set_by_name, hours_updated_at, hours_elsewhere, time_off, upcoming_lessons, open_courses}], lesson_types: [{lesson_type_id, kind, name_*, description_*, duration_min, price_iqd, court_share_iqd, max_places, min_places, cutoff_hours, sessions_count, is_active, launched_at, sort_order, coach_ids, pending_run}]} for every coach with a coach_branches row at the branch and every type of the branch. hours_elsewhere lists the coach''s windows at the other branches where the coach is active and that are not closed. The profile''s name and phone are staff data, never public. FORBIDDEN by role, then by branch.';

revoke all on function app.coaches_admin(uuid) from public, anon;
grant execute on function app.coaches_admin(uuid) to authenticated;

-- ===========================================================================
-- DB-02, DB-03: app.coach_promote (re-issued from 0282:567)
-- ===========================================================================

-- Promote a guest profile to coach (C-7), or bring a retired coach back with
-- the fields replaced and the consent cleared (R61: not public until the
-- coach accepts again). The branches named become active; on a revival every
-- other branch row is switched off, so the coach starts with exactly the
-- branches chosen. 0290: the profile is read FOR SHARE (an account deletion
-- in flight is waited for, DB-03), and a branch switched off on a revival
-- loses the coach's hours there (DB-02).
create or replace function app.coach_promote(
  p_profile_id      uuid,
  p_display_name_en text,
  p_display_name_ar text,
  p_bio_en          text,
  p_bio_ar          text,
  p_photo_path      text,
  p_venue_ids       uuid[]
) returns jsonb
language plpgsql security definer set search_path = public as $coach_promote_0290$
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
  v_hours   int;
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

  -- 0290 (DB-03): FOR SHARE conflicts with delete_my_account's update of the
  -- profile, so a deletion in flight is waited for and then seen (the row no
  -- longer qualifies): no coach is made or revived on a deleted profile.
  -- Profile, then coach: delete_my_account's order.
  perform 1 from profiles p where p.id = p_profile_id and p.deleted_at is null for share;
  if not found then
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
      -- 0290 (DB-02): hours left at a branch the coach no longer teaches at
      -- would block HOURS_OVERLAP at the others for good.
      delete from coach_hours where coach_id = v_c.id and venue_id = v_v;
      get diagnostics v_hours = row_count;
      if v_hours > 0 then
        perform app.write_audit('coaching.hours', 'coaches', v_c.id::text, null,
                                jsonb_build_object('coach_id', v_c.id, 'venue_id', v_v, 'windows', 0,
                                                   'set_by', 'staff', 'branch_dropped', true));
      end if;
    end loop;
  end if;

  perform app.write_audit('coaching.coach.promote', 'coaches', v_c.id::text, null,
                          jsonb_build_object('coach_id', v_c.id, 'profile_id', p_profile_id,
                                             'venue_ids', to_jsonb(v_venues), 'revived', v_revived,
                                             'photo', v_photo is not null));
  return jsonb_build_object('coach_id', v_c.id, 'status', v_c.status, 'venue_ids', to_jsonb(v_venues),
                            'revived', v_revived, 'duplicate', false);
end $coach_promote_0290$;

comment on function app.coach_promote(uuid, text, text, text, text, text, uuid[]) is
  '0282 (db.md §4.6.3; C-7, R43, R61), 0290 (DB-02, DB-03). Manager and owner: make a guest profile a coach at the named branches (each one the caller works at), or bring a retired coach back with the fields replaced, public_accepted_at cleared (R61) and exactly the named branches active; a branch switched off on a revival loses the coach''s hours there (audited coaching.hours, 0 windows). Refusals: FORBIDDEN (role); INVALID_ARGUMENT p_profile_id | p_display_name_en | p_display_name_ar (1..60) | p_bio_en | p_bio_ar (<= 1000) | p_photo_path (coaches/<uuid>/<file>, the folder never a profile or coach id, R43) | p_venue_ids (empty); CUSTOMER_NOT_FOUND (no live profile; the profile is read FOR SHARE, so an account deletion in flight is waited for); FORBIDDEN (a branch the caller does not work at); ALREADY_COACH (detail the coach id). Audited coaching.coach.promote. Returns {coach_id, status, venue_ids, revived, duplicate}.';

revoke all on function app.coach_promote(uuid, text, text, text, text, text, uuid[]) from public, anon;
grant execute on function app.coach_promote(uuid, text, text, text, text, text, uuid[]) to authenticated;

-- ===========================================================================
-- DB-03: app.coach_update (re-issued from 0282:690)
-- ===========================================================================

-- The display names, bios, photo and order (C-7: only managers edit them).
-- 0290 (DB-03): the coach lock and the row FOR UPDATE before the status is
-- read, so a retirement or an account deletion that commits first is seen
-- (INVALID_ARGUMENT retired) and never written over; a replaced photo's old
-- folder is queued for removal (R43).
create or replace function app.coach_update(p_coach_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $coach_update_0290$
declare
  v_allowed text[] := array['display_name_en', 'display_name_ar', 'bio_en', 'bio_ar', 'photo_path', 'sort_order'];
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

  update coaches
     set display_name_en = v_new.display_name_en,
         display_name_ar = v_new.display_name_ar,
         bio_en = v_new.bio_en,
         bio_ar = v_new.bio_ar,
         photo_path = v_new.photo_path,
         sort_order = v_new.sort_order,
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
end $coach_update_0290$;

comment on function app.coach_update(uuid, jsonb) is
  '0282 (db.md §4.6.3; C-7, R43), 0290 (DB-03). Manager (a coach in scope) and owner: patch a coach''s display_name_en, display_name_ar (1..60), bio_en, bio_ar (<= 1000), photo_path (NULL clears; coaches/<fresh uuid>/<file>, R43) and sort_order. Under the coach lock with the row FOR UPDATE, so a retirement or account deletion committed first is never written over. A replaced photo''s old folder is queued in coach_photo_purges. Refusals: FORBIDDEN (role); COACH_NOT_FOUND; FORBIDDEN (scope); INVALID_ARGUMENT p_patch | the key | retired. Audited coaching.coach.update (names, photo, order and whether a bio changed). Returns the coach''s card.';

revoke all on function app.coach_update(uuid, jsonb) from public, anon;
grant execute on function app.coach_update(uuid, jsonb) to authenticated;

-- ===========================================================================
-- DB-01, DB-02: app.set_coach_branches (re-issued from 0282:821)
-- ===========================================================================

-- The branches a coach teaches at. The listed branches the caller works at
-- become active; the caller's other branches are switched off (the owner's:
-- every other open branch, and a closed one). 0290 (DB-01): a listed branch
-- the caller does not work at (another manager's, a closed one) is kept as it
-- is when it is already an active branch of the coach, else FORBIDDEN.
-- R52, R73: a branch it would drop that still has a live lesson of the coach
-- not yet ended, or an open or running course, refuses BRANCH_HAS_BOOKINGS
-- detail coach_lessons (hint: that branch's id). 0290 (DB-02): a dropped
-- branch loses the coach's hours there.
create or replace function app.set_coach_branches(p_coach_id uuid, p_venue_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $set_coach_branches_0290$
declare
  v_c      coaches%rowtype;
  v_venues uuid[];
  v_mine   uuid[];
  v_kept   uuid[];
  v_v      uuid;
  v_drop   uuid[];
  v_before uuid[];
  v_owner  boolean;
  v_hours  int;
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
  v_owner := app.is_staff('owner');
  -- DB-01: the caller's own branches are written; the others are only kept.
  v_mine := array(select x from unnest(v_venues) x where app.is_staff_at(x, 'manager', 'owner') order by x);
  v_kept := array(select x from unnest(v_venues) x where not app.is_staff_at(x, 'manager', 'owner') order by x);

  perform app.lock_coach(v_c.id);

  -- A kept branch must already be one the coach is active at: listing it
  -- keeps it, it never adds it.
  foreach v_v in array v_kept loop
    if not exists (select 1 from coach_branches b
                    where b.coach_id = v_c.id and b.venue_id = v_v and b.active) then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
  end loop;

  v_before := array(select b.venue_id from coach_branches b
                     where b.coach_id = v_c.id and b.active order by b.venue_id);
  -- Only branches the caller works at are ever switched off, and (the owner)
  -- a closed branch, where nobody is staff.
  v_drop := array(select b.venue_id from coach_branches b
                   where b.coach_id = v_c.id and b.active
                     and not (b.venue_id = any (v_venues))
                     and (app.is_staff_at(b.venue_id, 'manager', 'owner')
                          or (v_owner and exists (select 1 from venues ve
                                                   where ve.id = b.venue_id and ve.status = 'closed')))
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

  foreach v_v in array v_mine loop
    perform set_config('app.venue_id', v_v::text, true);
    insert into coach_branches (coach_id, venue_id, active)
    values (v_c.id, v_v, true)
    on conflict (coach_id, venue_id) do update set active = true;
  end loop;
  foreach v_v in array v_drop loop
    perform set_config('app.venue_id', v_v::text, true);
    update coach_branches set active = false where coach_id = v_c.id and venue_id = v_v and active;
    -- DB-02: hours left at a branch the coach no longer teaches at would
    -- block HOURS_OVERLAP at the others for good.
    delete from coach_hours where coach_id = v_c.id and venue_id = v_v;
    get diagnostics v_hours = row_count;
    if v_hours > 0 then
      perform app.write_audit('coaching.hours', 'coaches', v_c.id::text, null,
                              jsonb_build_object('coach_id', v_c.id, 'venue_id', v_v, 'windows', 0,
                                                 'set_by', 'staff', 'branch_dropped', true));
    end if;
  end loop;

  perform app.write_audit('coaching.coach.branches', 'coaches', v_c.id::text,
                          jsonb_build_object('venue_ids', to_jsonb(v_before)),
                          jsonb_build_object('venue_ids', (select coalesce(jsonb_agg(b.venue_id order by b.venue_id), '[]'::jsonb)
                                                             from coach_branches b
                                                            where b.coach_id = v_c.id and b.active),
                                             'dropped', to_jsonb(v_drop),
                                             'kept', to_jsonb(v_kept)));
  return jsonb_build_object(
    'coach_id', v_c.id,
    'venue_ids', (select coalesce(jsonb_agg(b.venue_id order by b.venue_id), '[]'::jsonb)
                    from coach_branches b where b.coach_id = v_c.id and b.active),
    'dropped', to_jsonb(v_drop));
end $set_coach_branches_0290$;

comment on function app.set_coach_branches(uuid, uuid[]) is
  '0282 (db.md §4.6.3; R52, R73), 0290 (DB-01, DB-02). Manager (coach in scope) and owner: the listed branches the caller works at become active; a listed branch the caller does not work at (another manager''s, a closed one) is kept as it is, and must already be an active branch of the coach; the caller''s other branches of the coach are switched off (their lessons are kept, their hours deleted), and the owner may switch off a closed branch. A save may list none of the caller''s own branches. Refusals: FORBIDDEN (role); COACH_NOT_FOUND; INVALID_ARGUMENT p_venue_ids (empty); FORBIDDEN (scope); under the coach lock, FORBIDDEN (a listed branch the caller does not work at and the coach is not active at) and BRANCH_HAS_BOOKINGS detail coach_lessons (hint the branch id) when a branch it would switch off has a held or scheduled lesson of the coach not yet ended or an open or running course. Audited coaching.coach.branches (and coaching.hours, 0 windows, per branch whose hours went). Returns {coach_id, venue_ids, dropped}.';

revoke all on function app.set_coach_branches(uuid, uuid[]) from public, anon;
grant execute on function app.set_coach_branches(uuid, uuid[]) to authenticated;

-- ===========================================================================
-- DB-04: app.set_coach_lesson_types (re-issued from 0282:905)
-- ===========================================================================

-- The lesson types a coach teaches at one branch. R46: unlinking a type
-- deletes the coach's own price for it, so a relink starts from the type
-- price and an old approval never comes back against a different price.
-- 0290 (DB-04): a newly linked type loses any coach price left over too.
create or replace function app.set_coach_lesson_types(p_coach_id uuid, p_venue_id uuid, p_lesson_type_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $set_coach_lesson_types_0290$
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
   where cp.coach_id = v_c.id and (cp.lesson_type_id = any (v_removed) or cp.lesson_type_id = any (v_added));

  -- DB-04: a newly linked type starts from the type price (R46), even if a
  -- price outlived an earlier unlink.
  delete from coach_prices
   where coach_id = v_c.id and (lesson_type_id = any (v_removed) or lesson_type_id = any (v_added));
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
end $set_coach_lesson_types_0290$;

comment on function app.set_coach_lesson_types(uuid, uuid, uuid[]) is
  '0282 (db.md §4.6.3; R46), 0290 (DB-04). Manager and owner at the branch: replace the lesson types coach p_coach_id teaches at branch p_venue_id (default: the caller''s resolved branch) with p_lesson_type_ids (empty: none). The coach''s own price of every type dropped from the set, and any left over for a type newly added, is deleted (R46: a relink starts from the type price); lessons are untouched. Refusals: FORBIDDEN (role; branch); COACH_NOT_FOUND; COACH_NOT_AT_BRANCH (no active row there); INVALID_ARGUMENT p_lesson_type_ids; LESSON_TYPE_NOT_FOUND (detail the id; a type not at the branch). Audited coaching.coach.types with the prices removed. Returns {coach_id, venue_id, lesson_type_ids, prices_removed}.';

revoke all on function app.set_coach_lesson_types(uuid, uuid, uuid[]) from public, anon;
grant execute on function app.set_coach_lesson_types(uuid, uuid, uuid[]) to authenticated;

-- ===========================================================================
-- DB-04: app.set_coach_price_internal (re-issued from 0282:1294)
-- ===========================================================================

-- The only writer of coach_prices besides set_coach_lesson_types' delete.
-- 0290 (DB-04): a price needs the coach-type link (R46); the callers hold the
-- coach lock, so the link cannot go between this check and the write.
create or replace function app.set_coach_price_internal(p_coach_id uuid, p_lesson_type_id uuid, p_price_iqd bigint,
                                                        p_run_id uuid)
returns void
language plpgsql security definer set search_path = public as $set_coach_price_internal_0290$
declare
  v_venue  uuid;
  v_before bigint;
begin
  select lt.venue_id into v_venue from lesson_types lt where lt.id = p_lesson_type_id;
  if v_venue is null then
    raise exception 'LESSON_TYPE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_price_iqd is not null
     and not exists (select 1 from coach_lesson_types ct
                      where ct.coach_id = p_coach_id and ct.lesson_type_id = p_lesson_type_id) then
    raise exception 'LESSON_TYPE_NOT_OFFERED' using errcode = 'P0001';
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
end $set_coach_price_internal_0290$;

comment on function app.set_coach_price_internal(uuid, uuid, bigint, uuid) is
  '0282 (db.md §4.6.4; C-5, C-17), 0290 (DB-04). Internal, no role check: called under the coach lock by app.set_coach_price (the owner, p_run_id NULL) and the price-or-promotion apply (0285, the run). NULL price deletes the coach''s price; else LESSON_TYPE_NOT_OFFERED when the coach does not teach the type (R46), and upserts it with protocol_run_id. Asserts app.venue_id to the type''s branch. Audited coaching.coach_price.';

revoke all on function app.set_coach_price_internal(uuid, uuid, bigint, uuid) from public, anon, authenticated;

-- ===========================================================================
-- DB-04: app.set_coach_price (re-issued from 0282:1328)
-- ===========================================================================

-- 0290 (DB-04): the coach lock before the link is checked and the coach's
-- status read again, so an unlink or a retirement in flight is waited for.
create or replace function app.set_coach_price(p_coach_id uuid, p_lesson_type_id uuid, p_price_iqd bigint)
returns jsonb
language plpgsql security definer set search_path = public as $set_coach_price_0290$
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

  -- Level H first (DB-04): set_coach_lesson_types and set_coach_status hold
  -- the same key, so the link and the status below are the committed ones.
  perform app.lock_coach(v_c.id);
  if not exists (select 1 from coaches c where c.id = v_c.id and c.status <> 'retired') then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not exists (select 1 from coach_lesson_types ct
                  where ct.coach_id = v_c.id and ct.lesson_type_id = v_t.id) then
    raise exception 'LESSON_TYPE_NOT_OFFERED' using errcode = 'P0001';
  end if;

  perform app.set_coach_price_internal(v_c.id, v_t.id, p_price_iqd, null);
  return jsonb_build_object('coach_id', v_c.id, 'lesson_type_id', v_t.id, 'price_iqd', p_price_iqd);
end $set_coach_price_0290$;

comment on function app.set_coach_price(uuid, uuid, bigint) is
  '0282 (db.md §4.6.4; C-5, C-17, D-8), 0290 (DB-04). The owner sets (or with NULL removes) a coach''s own price for a lesson type they teach; a manager goes through the price-or-promotion protocol (coach_price). Refusals: FORBIDDEN (role); COACH_NOT_FOUND (unknown or retired); LESSON_TYPE_NOT_FOUND; FORBIDDEN (branch); PRICE_VIA_PROTOCOL detail price (a manager, drafts included); INVALID_ARGUMENT p_price_iqd (<= 0, over 100,000,000, or below the sessions of a course); then under the coach lock COACH_NOT_FOUND (retired meanwhile) and LESSON_TYPE_NOT_OFFERED. Returns {coach_id, lesson_type_id, price_iqd}.';

revoke all on function app.set_coach_price(uuid, uuid, bigint) from public, anon;
grant execute on function app.set_coach_price(uuid, uuid, bigint) to authenticated;

-- ===========================================================================
-- DB-02: app.coach_hours_write (re-issued from 0282:1447)
-- ===========================================================================

-- The shared writer of set_coach_hours and set_my_coach_hours: under the
-- coach lock, a window that overlaps one of the coach's windows at another
-- branch on its weekday is HOURS_OVERLAP detail its index (R73); then the
-- coach's rows at the branch are replaced. Lessons already booked outside
-- the new hours stay. 0290 (DB-02): the branch is checked again under the
-- lock, and only hours at another active, not-closed branch of the coach
-- count as an overlap.
create or replace function app.coach_hours_write(p_coach_id uuid, p_venue uuid, p_windows jsonb, p_staff_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $coach_hours_write_0290$
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

  -- DB-02: set_coach_branches drops a branch under the same key.
  if not exists (select 1 from coach_branches b
                  where b.coach_id = p_coach_id and b.venue_id = p_venue and b.active) then
    raise exception 'COACH_NOT_AT_BRANCH' using errcode = 'P0001';
  end if;

  for v_x in
    select w.i
      from jsonb_to_recordset(v_w) as w(i int, weekday int, start_time time, end_time time)
     where exists (select 1 from coach_hours h
                     join coach_branches hb on hb.coach_id = h.coach_id and hb.venue_id = h.venue_id
                                           and hb.active
                     join venues ve on ve.id = h.venue_id and ve.status <> 'closed'
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
end $coach_hours_write_0290$;

comment on function app.coach_hours_write(uuid, uuid, jsonb, uuid) is
  '0282 (db.md §4.6.5; R73), 0290 (DB-02). Internal: replaces a coach''s weekly windows at one branch (set_by staff with p_staff_id, else coach). COACH_NOT_AT_BRANCH without an active branch row (checked again under the coach lock); app.coach_windows_parse''s HOURS_INVALID and HOURS_OVERLAP; under the coach lock, HOURS_OVERLAP detail the index of a window overlapping the coach''s window at another branch on that weekday, counting only branches where the coach is active and that are not closed. Audited coaching.hours. Returns {coach_id, venue_id, windows, hours} (the same list under both names).';

revoke all on function app.coach_hours_write(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

-- ===========================================================================
-- DB-06: app.coach_time_off_add (re-issued from 0282:1604)
-- ===========================================================================

-- The shared writer of add_coach_time_off and add_my_time_off. 0290 (DB-06):
-- the same period added again by the same person is the row already there
-- (duplicate true): add_my_time_off is retried after a dropped connection.
create or replace function app.coach_time_off_add(p_coach_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
                                                  p_reason text, p_staff_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $coach_time_off_add_0290$
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

  -- DB-06: a retry. Exactly the same live period, set by the same person.
  select * into v_t
    from coach_time_off t
   where t.coach_id = p_coach_id
     and t.cancelled_at is null
     and t.period = tstzrange(p_starts_at, p_ends_at, '[)')
     and t.set_by = case when p_staff_id is null then 'coach' else 'staff' end
     and t.set_by_staff_id is not distinct from p_staff_id
   order by t.id
   limit 1;
  if found then
    return jsonb_build_object('id', v_t.id, 'starts_at', lower(v_t.period), 'ends_at', upper(v_t.period),
                              'reason', v_t.reason, 'set_by', v_t.set_by, 'duplicate', true);
  end if;

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
                            'reason', v_t.reason, 'set_by', v_t.set_by, 'duplicate', false);
end $coach_time_off_add_0290$;

comment on function app.coach_time_off_add(uuid, timestamptz, timestamptz, text, uuid) is
  '0282 (db.md §4.6.5), 0290 (DB-06). Internal: one time-off period of a coach (set_by staff with p_staff_id, else coach). INVALID_ARGUMENT p_starts_at | p_ends_at (start >= end, end <= now, over 366 days) | p_reason (over 200); under the coach lock a live period of the coach with exactly these bounds set by the same person is returned with duplicate true (no second row or audit row); else TIME_OFF_HAS_LESSONS detail how many held or scheduled lessons of the coach overlap; HOURS_OVERLAP detail time_off when it overlaps a live period (coach_time_off_no_overlap). Audited coaching.time_off (no reason text). Returns {id, starts_at, ends_at, reason, set_by, duplicate}.';

revoke all on function app.coach_time_off_add(uuid, timestamptz, timestamptz, text, uuid) from public, anon, authenticated;

-- ===========================================================================
-- DB-04: app.price_promo_apply_internal (re-issued from 0285:700)
-- ===========================================================================

-- 0290 (DB-04): a coach_price change takes the coach lock before the lesson
-- type row (coach first, the bookings' order), so an unlink of the coach and
-- the type is waited for and then seen by the target check
-- (PRICE_TARGET_CHANGED hint coach_price), and a price never outlives it.
create or replace function app.price_promo_apply_internal(p_run_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $price_promo_apply_internal_0290$
declare
  v_run    protocol_runs%rowtype;
  v_p      jsonb;
  v_n      jsonb;
  v_change text;
  v_item   menu_items%rowtype;
  v_v      menu_item_variants%rowtype;
  v_m      modifiers%rowtype;
  v_el     jsonb;
  v_f      jsonb;
  v_sort   int;
  v_value  int;
  v_pct    int;
  v_counts jsonb;
  v_a      int := 0;
  v_b      int := 0;
  v_r      int := 0;
  v_kind   text;
  v_ok_by  uuid;
begin
  select * into v_run from protocol_runs where id = p_run_id for update;
  if not found or v_run.kind <> 'price_promo' then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_run.status not in ('active', 'scheduled') then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', hint = v_run.status || ' -> done';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);
  -- A lesson change locks its type first (0285): the target check below then
  -- reads the shape and figures this apply writes over, and a manager's save
  -- of the same type (upsert_lesson_type reads it for update) waits and then
  -- sees the new price. 0290 (DB-04): a coach_price change takes the coach
  -- lock before the type row.
  v_p := app.price_promo_record(v_run.id, 'propose');
  if v_p->>'change' = 'coach_price' and v_p->>'coach_id' is not null then
    perform app.lock_coach((v_p->>'coach_id')::uuid);
  end if;
  if v_p->>'change' in ('lesson_price', 'lesson_launch', 'coach_price') then
    perform 1 from lesson_types lt where lt.id = (v_p->>'lesson_type_id')::uuid for update;
  end if;
  perform app.price_promo_check_targets(v_run.id);

  v_p := app.price_promo_record(v_run.id, 'propose');
  v_n := app.price_promo_record(v_run.id, 'numbers');
  v_change := v_p->>'change';

  if v_change in ('price', 'shop_launch') then
    select * into v_item from menu_items where id = (v_p->>'menu_item_id')::uuid for update;
    -- Each approved size at its new price, keeping its name, default and order.
    for v_el in select e from jsonb_array_elements(coalesce(v_n->'prices', v_p->'prices')) e loop
      select * into v_v from menu_item_variants where id = (v_el->>'variant_id')::uuid;
      perform app.upsert_variant_internal(v_item.id, v_v.name_en, v_v.name_ar, (v_el->>'price_iqd')::bigint,
                                          v_v.id, v_v.is_default, v_v.sort_order);
      v_a := v_a + 1;
    end loop;
    -- New sizes after the last one, never the default. Their recipe is added
    -- in Stock ▸ Recipes, as for any new size.
    select coalesce(max(v.sort_order), -1) + 1 into v_sort from menu_item_variants v where v.item_id = v_item.id;
    for v_el in select e from jsonb_array_elements(coalesce(v_n->'new_sizes', v_p->'new_sizes', '[]'::jsonb)) e loop
      perform app.upsert_variant_internal(v_item.id,
                                          coalesce(v_el->>'name_en', v_el->>'name_ar'),
                                          coalesce(v_el->>'name_ar', v_el->>'name_en'),
                                          (v_el->>'price_iqd')::bigint, null, false, v_sort);
      v_sort := v_sort + 1;
      v_b := v_b + 1;
    end loop;
    -- Renamed sizes (#9), from the proposal (numbers never carries names):
    -- the row is kept, so its recipe is, and its price as it stands after the
    -- loop above, which is the new one when this run prices it too. A shop
    -- size's retail stock row takes the name upsert_retail_variant would give
    -- it (0145:205-206).
    select c.kind into v_kind from menu_categories c where c.id = v_item.category_id;
    for v_el in select e from jsonb_array_elements(coalesce(v_p->'renames', '[]'::jsonb)) e loop
      select * into v_v from menu_item_variants where id = (v_el->>'variant_id')::uuid for update;
      perform app.upsert_variant_internal(v_item.id, v_el->>'name_en', v_el->>'name_ar', v_v.price_iqd,
                                          v_v.id, v_v.is_default, v_v.sort_order);
      if v_kind = 'shop' then
        update ingredients
           set name_en = left(btrim(v_item.name_en || ' ' || (v_el->>'name_en')), 200),
               name_ar = left(btrim(v_item.name_ar || ' ' || (v_el->>'name_ar')), 200)
         where variant_id = v_v.id and kind = 'retail';
      end if;
      v_r := v_r + 1;
    end loop;
    -- The product goes on sale: the internal stamps launched_at.
    if v_change = 'shop_launch' then
      perform app.upsert_menu_item_internal(v_item.category_id, v_item.name_en, v_item.name_ar, v_item.id,
                                            v_item.description_en, v_item.description_ar, v_item.sort_order,
                                            true, v_item.hook_en, v_item.hook_ar, v_item.highlight,
                                            v_item.serve_temp);
    end if;
    v_counts := jsonb_build_object('sizes', v_a, 'new_sizes', v_b, 'renamed', v_r);

  elsif v_change = 'addon_price' then
    -- A never-launched add-on goes on sale (the internal stamps it); a
    -- launched one keeps its switch as it is.
    for v_el in select e from jsonb_array_elements(coalesce(v_n->'addons', v_p->'addons')) e loop
      select * into v_m from modifiers where id = (v_el->>'modifier_id')::uuid for update;
      perform app.upsert_modifier_internal(v_m.group_id, v_m.name_en, v_m.name_ar, v_m.id,
                                           (v_el->>'price_delta_iqd')::bigint, v_m.sort_order,
                                           case when v_m.launched_at is not null or v_m.is_active
                                                then v_m.is_active else true end);
      v_a := v_a + 1;
      v_b := v_b + case when v_m.launched_at is null and not v_m.is_active then 1 else 0 end;
    end loop;
    -- Renamed add-ons (#9) keep their price as it now stands, their switch
    -- and their order.
    for v_el in select e from jsonb_array_elements(coalesce(v_p->'renames', '[]'::jsonb)) e loop
      select * into v_m from modifiers where id = (v_el->>'modifier_id')::uuid for update;
      perform app.upsert_modifier_internal(v_m.group_id, v_el->>'name_en', v_el->>'name_ar', v_m.id,
                                           v_m.price_delta_iqd, v_m.sort_order, v_m.is_active);
      v_r := v_r + 1;
    end loop;
    v_counts := jsonb_build_object('addons', v_a, 'launched', v_b, 'renamed', v_r);

  elsif v_change in ('promotion', 'promotion_edit') then
    v_f := v_p->'promotion';
    v_value := coalesce((v_n->>'promotion_value')::int, (v_f->>'value')::int);
    perform app.upsert_promotion_internal(
      coalesce(v_run.promotion_id, (v_p->>'promotion_id')::uuid),
      v_f->>'name_en', v_f->>'name_ar', v_f->>'type', v_value,
      (v_f->>'starts_at')::timestamptz, (v_f->>'ends_at')::timestamptz,
      array(select jsonb_array_elements_text(v_f->'weekdays')::int),
      (v_f->>'hour_from')::time, (v_f->>'hour_to')::time,
      v_f->'scope', v_f->'limits', (v_f->>'auto')::boolean,
      -- A new promotion's code is the record's, none when it has none; an
      -- edit keeps the stored code unless the record names one ('' clears).
      case when v_change = 'promotion' then coalesce(v_f->>'public_code', '') else v_f->>'public_code' end,
      (v_f->>'code_single_use')::boolean,
      -- An edit never switches a promotion on or off.
      case when v_change = 'promotion' then false
           else (select p.enabled from promotions p where p.id = (v_p->>'promotion_id')::uuid) end);
    if v_change = 'promotion' then
      perform app.set_promotion_enabled_internal(v_run.promotion_id, true);
    end if;
    v_counts := jsonb_build_object('value', v_value);

  elsif v_change = 'promotion_enable' then
    perform app.set_promotion_enabled_internal((v_p->>'promotion_id')::uuid, true);
    v_counts := '{}'::jsonb;

  elsif v_change = 'rate' then
    v_f := v_p->'rule';
    perform app.upsert_rate_rule_internal(
      v_f->>'name',
      array(select jsonb_array_elements_text(v_f->'days_of_week')::int),
      (v_f->>'start_time')::time, (v_f->>'end_time')::time,
      coalesce(v_n->'rule_prices', v_f->'prices'),
      (v_p->>'rule_id')::uuid, (v_f->>'court_id')::uuid, (v_f->>'priority')::int,
      (v_f->>'valid_from')::date, (v_f->>'valid_to')::date, (v_f->>'is_active')::boolean);
    v_counts := jsonb_build_object('durations',
                  (select count(*) from jsonb_object_keys(coalesce(v_n->'rule_prices', v_f->'prices'))));

  elsif v_change = 'featured_discount' then
    -- The item first, then the discount, then Featured mode when the
    -- approved discount is above 0: the discount that goes live is the
    -- approved one, on the approved item.
    v_pct := coalesce((v_n->>'discount_pct')::int, (v_p->>'discount_pct')::int);
    if lower(app.cafe_setting_text('featured_item_id')) is distinct from v_p->>'menu_item_id' then
      perform app.set_cafe_setting_internal('featured_item_id', v_p->'menu_item_id');
      v_a := v_a + 1;
    end if;
    perform app.set_cafe_setting_internal('featured_discount_pct', to_jsonb(v_pct));
    v_a := v_a + 1;
    if v_pct > 0 and app.cafe_setting_text('hero_mode') is distinct from 'featured' then
      perform app.set_cafe_setting_internal('hero_mode', '"featured"'::jsonb);
      v_a := v_a + 1;
    end if;
    v_counts := jsonb_build_object('settings', v_a);

  elsif v_change in ('lesson_price', 'lesson_launch') then
    -- The approved figures (the numbers', else the proposal's; a
    -- lesson_price carries only the ones it changes) through the internal,
    -- which validates as upsert_lesson_type does. lesson_launch also switches
    -- the type on, and the internal stamps launched_at. Lessons and courses
    -- already booked keep their snapshots.
    v_f := jsonb_strip_nulls(jsonb_build_object(
             'price_iqd',       coalesce(v_n->'price_iqd', v_p->'price_iqd'),
             'court_share_iqd', coalesce(v_n->'court_share_iqd', v_p->'court_share_iqd')));
    if v_change = 'lesson_launch' then
      v_f := v_f || jsonb_build_object('is_active', true);
    end if;
    perform app.upsert_lesson_type_internal(v_run.venue_id, (v_p->>'lesson_type_id')::uuid, v_f);
    v_counts := jsonb_build_object('lesson_types', 1)
                || case when v_change = 'lesson_launch' then jsonb_build_object('launched', 1) else '{}'::jsonb end;

  elsif v_change = 'coach_price' then
    -- The coach's own price, or none (the type's price applies again), with
    -- the run that approved it.
    perform app.set_coach_price_internal((v_p->>'coach_id')::uuid, (v_p->>'lesson_type_id')::uuid,
                                         coalesce((v_n->>'price_iqd')::bigint, (v_p->>'price_iqd')::bigint),
                                         v_run.id);
    v_counts := jsonb_build_object('coach_prices', 1);
  end if;

  -- The owner who approved the numbers authorises every discount the
  -- promotion gives from now on: apply_best_promotion writes
  -- promotions.created_by as tab_adjustments.authorized_by, and day close
  -- names that person (0067:800-809). Never the proposer, who may be a
  -- marketing account with no discount authority.
  if v_change in ('promotion', 'promotion_edit', 'promotion_enable') then
    select x.decided_by into v_ok_by
      from protocol_submissions x
      join protocol_run_steps s on s.id = x.run_step_id
     where x.run_id = v_run.id and s.step_key = 'numbers'
       and x.decision in ('approve', 'auto')
     order by x.round desc, x.decided_at desc, x.id desc
     limit 1;
    update promotions set created_by = v_ok_by
     where id = coalesce(v_run.promotion_id, (v_p->>'promotion_id')::uuid)
       and created_by is distinct from v_ok_by;
  end if;

  update protocol_runs set status = 'done', finished_at = now() where id = v_run.id;

  perform app.write_audit(
    case when v_change in ('promotion', 'promotion_edit', 'promotion_enable')
         then 'protocol.promo.apply' else 'protocol.price.apply' end,
    'protocol_run', v_run.id::text,
    jsonb_build_object('status', v_run.status),
    jsonb_build_object('run_id', v_run.id, 'change', v_change, 'counts', v_counts)
    || case when v_ok_by is not null then jsonb_build_object('authorized_by', v_ok_by) else '{}'::jsonb end);

  return jsonb_build_object('run_id', v_run.id, 'change', v_change, 'counts', v_counts)
         || case when v_ok_by is not null then jsonb_build_object('authorized_by', v_ok_by) else '{}'::jsonb end;
end $price_promo_apply_internal_0290$;

comment on function app.price_promo_apply_internal(uuid) is
  'price_promo (§2.13). Internal: applies an active (pass hook) or scheduled (cron) price or promotion change: app.venue_id set to the run''s venue, a coach_price change''s coach lock (0290, DB-04: coach first, then the type), a lesson change''s type row locked (price_promo_lessons), app.price_promo_check_targets, then the approved figures (numbers, else the proposal''s) through the internals: price (sizes, new sizes after the last, then the proposal''s renames, each size keeping its row, recipe and current price, a shop size''s retail stock row renamed with it), shop_launch (sizes, then the product switched on and stamped launched), addon_price (a never-launched add-on switched on and stamped, a launched one keeps its switch; then the renames, each keeping its price, switch and order), promotion (the draft updated, then switched on), promotion_edit (the approved fields and value, the switch kept), promotion_enable, rate (the rule and its prices), featured_discount (the item when it moves, the discount, then Featured mode when the discount is above 0), lesson_price (the type''s price and court share it changes, app.upsert_lesson_type_internal), lesson_launch (the same, switched on and stamped launched), coach_price (app.set_coach_price_internal with the run''s id; a null price removes the coach''s own). The three promotion kinds then name the owner who approved the numbers as the promotion''s created_by, which apply_best_promotion records as every redemption''s authorized_by (0067). The run is done. Audit protocol.price.apply or protocol.promo.apply {run_id, change, counts (price and shop_launch: sizes, new_sizes, renamed; addon_price: addons, launched, renamed; lesson_price: lesson_types; lesson_launch: lesson_types, launched; coach_price: coach_prices), authorized_by (promotion kinds)}; returns the same.';

revoke all on function app.price_promo_apply_internal(uuid) from public, anon, authenticated;

-- ===========================================================================
-- DB-03: app.delete_my_account (re-issued from 0289:57)
-- ===========================================================================
create or replace function app.delete_my_account(p_confirm text default null)
returns jsonb
language plpgsql security definer set search_path = public as $delete_my_account_0290$
declare
  v_uid          uuid := auth.uid();
  v_profile      profiles%rowtype;
  v_apple        boolean;
  v_reservations int;
  v_series       int;
  v_notes        int;
  v_flags        int;
  v_outbox       int;
  v_seats        int;
  v_requests     int;
  v_blocks       int;
  v_links        int;
  v_enrolments   int;
  v_photos       int;
  v_coach        int;
  v_time_off     int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  -- An anonymous café session has no account to delete: handle_new_user (0004)
  -- returns early for is_anonymous, so no profiles row was ever created.
  --
  -- This guard is also what keeps check-rpc-authz.mjs safe. That sweep calls
  -- EVERY RPC granted to `authenticated` with NULL arguments as a real
  -- anonymous guest. Without a refusal on its first line, the authorization
  -- gate would delete the account it probes with, on every run.
  select * into v_profile from profiles where id = v_uid;
  if not found then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  -- Staff are deactivated, never deleted: staff.id -> auth.users is ON DELETE
  -- RESTRICT (0004), and audit_log.actor_id, staff.created_by and
  -- reservations.created_by_staff_id all point at them. Without this the call
  -- would reach the delete and fail there with a raw 23503.
  if exists (select 1 from staff where id = v_uid) then
    raise exception 'FORBIDDEN' using errcode = 'P0001',
      detail = 'staff accounts are deactivated, not deleted';
  end if;

  if v_profile.deleted_at is not null then
    raise exception 'ALREADY_DELETED' using errcode = 'P0001';
  end if;

  -- Irreversible, and reachable by anything holding the guest's JWT. The
  -- explicit token means a stray retry or an injected fetch cannot spend the
  -- account by calling a bare zero-argument RPC.
  if p_confirm is distinct from 'DELETE' then
    raise exception 'CONFIRMATION_REQUIRED' using errcode = 'P0001',
      hint = 'call with p_confirm => ''DELETE''';
  end if;

  -- Apple requires POST https://appleid.apple.com/auth/revoke when an account
  -- offering Sign in with Apple is deleted. The .p8 key does not exist yet
  -- (blocked on Apple Developer enrolment), so the obligation is RECORDED
  -- rather than silently skipped — the deletion itself must not be held hostage
  -- to a missing credential.
  select exists (select 1 from auth.identities
                  where user_id = v_uid and provider = 'apple')
    into v_apple;

  -- --- the anonymisation ----------------------------------------------------
  --
  -- Everything below removes a column that names or reaches a PERSON. Columns
  -- carrying business value — times, prices, courts, statuses, totals — are
  -- deliberately untouched, which is the entire point of retaining the row.

  -- The profile itself. expo_push_token is cleared here (SEC-21: cleared on
  -- deletion), which is also the only remaining way to reach the device.
  -- 0264: the two name parts and the three gender columns (0256) go too.
  -- profiles_sync_names empties them on the tombstone anyway; naming them
  -- here keeps the erasure readable in one place (the three gender columns
  -- together, as profiles_gender_stamp requires).
  update profiles
     set full_name       = 'Deleted account',
         phone           = null,
         expo_push_token = null,
         given_name      = null,
         family_name     = null,
         gender          = null,
         gender_set_at   = null,
         gender_set_by   = null,
         deleted_at      = now()
   where id = v_uid;

  -- Denormalised identity on the booking rows. THIS IS THE HALF THAT IS EASY TO
  -- MISS: reservations and reservation_series each carry their OWN guest_name
  -- and guest_phone beside guest_id, and nothing constrains the two to be
  -- mutually exclusive — app.confirm_booking writes
  -- `guest_name = coalesce(p_guest_name, guest_name)` whatever guest_id holds,
  -- and app.create_series takes p_guest_name the same way.
  --
  -- No client ships that argument TODAY: the mobile app calls confirm_booking
  -- with p_hold_id alone, so an app-made booking leaves both columns null, and
  -- only the test suite currently passes a name alongside a guest_id. The desk
  -- surface that would do it for a walk-in with an account is the obvious next
  -- feature. Scrubbing here is therefore mostly forward defence — but it is the
  -- difference between a deletion that stays complete and one that silently
  -- stops being complete the day that screen is built, which is exactly the
  -- kind of regression nobody re-audits.
  update reservations
     set guest_name = null, guest_phone = null, notes = null, device_id = null
   where guest_id = v_uid;
  get diagnostics v_reservations = row_count;

  update reservation_series
     set guest_name = null, guest_phone = null, notes = null
   where guest_id = v_uid;
  get diagnostics v_series = row_count;

  -- Records ABOUT the person, with no aggregate value: staff free text and
  -- labels, and queued notifications addressed to a device that is now
  -- unreachable. These used to CASCADE from profiles; now that the profile row
  -- survives, they have to be removed explicitly or they would outlive it.
  delete from customer_notes where customer_id = v_uid;
  get diagnostics v_notes = row_count;

  delete from customer_flags where customer_id = v_uid;
  get diagnostics v_flags = row_count;

  -- --- open matches (0264; db.md §4.9, R25, R29) ----------------------------
  --
  -- The seats and requests stay: they are the matches' history, and the sweep
  -- (0263) moves the live ones. What goes is what describes the person. Every
  -- seat that names the player (account seats, the friend seats they hold,
  -- linked desk seats) loses the gender it was taken with; a seat with a
  -- guest_id never holds a typed name or phone (match_seats_kind), and both are
  -- named anyway so the erasure reads the same as the booking rows above.
  -- Written outside the branch mutex on purpose (db.md §2.1): no match state
  -- reads these columns. Only rows that still hold something are touched, so
  -- a player's finished seats are not locked for nothing.
  update match_seats
     set guest_name = null, guest_phone = null, gender = null
   where guest_id = v_uid
     and (guest_name is not null or guest_phone is not null or gender is not null);
  get diagnostics v_seats = row_count;

  -- The genders the player declared for friends (R29).
  update match_requests
     set friend_genders = null
   where guest_id = v_uid
     and friend_genders is not null;
  get diagnostics v_requests = row_count;

  -- A block is a list of people kept by a person: both directions go (the
  -- blocker's own list, and the entries that name this account).
  delete from match_blocks where blocker_id = v_uid or blocked_id = v_uid;
  get diagnostics v_blocks = row_count;

  -- --- coaching (0289; db.md §4.10, CD-12, C-21, C-29, R43, R44, R63) -------
  --
  -- Written outside every coach lock on purpose (db.md §2.4 rule 7): no
  -- coaching state reads these columns, and lesson_sweep (0286) cancels the
  -- live enrolments and a retired coach's lessons within a minute, with
  -- refunds and pushes.

  -- A pending link (C-21): a coach or the desk typed a phone that matched this
  -- account and nobody confirmed it. It goes as "Not me" takes it: guest_id
  -- NULL, silently, the coach's typed student kept as typed, so the roster
  -- never learns that the phone had matched an account (R10, R44).
  update lesson_enrolments
     set guest_id = null, updated_at = now()
   where guest_id = v_uid
     and booked_by_kind <> 'guest'
     and link_confirmed_at is null;
  get diagnostics v_links = row_count;

  -- The account's own enrolments and confirmed links: a typed name keeps a
  -- fixed marker (lesson_enrolments_typed requires one on a coach- or
  -- desk-booked row; NULL would let a reader fall back to the account), the
  -- typed phone and the friend names go (SEC-20: guest_name anonymise,
  -- guest_phone scrub, friend_names empty). Only rows that still hold
  -- something are touched.
  update lesson_enrolments
     set guest_name   = case when booked_by_kind = 'guest' then null else 'Deleted account' end,
         guest_phone  = null,
         friend_names = '{}'::text[],
         updated_at   = now()
   where guest_id = v_uid
     and (guest_phone is not null
          or cardinality(friend_names) > 0
          or (booked_by_kind <> 'guest' and guest_name is distinct from 'Deleted account')
          or (booked_by_kind = 'guest' and guest_name is not null));
  get diagnostics v_enrolments = row_count;

  -- 0290 (DB-03): the account's coach rows, locked (profile, then coach; no
  -- coach mutex). A coach_update holding the row is waited for, so the photo
  -- queued below is the one it saved, and a coach_update that comes after
  -- sees the row retired.
  perform 1 from coaches c where c.profile_id = v_uid for update;

  -- R63, C-29: a deleted coach is retired (R45), bios and photo emptied; the
  -- display names stay on the statements the venue paid and never reach a
  -- guest surface (retired coaches are hidden everywhere).
  -- R43: the photo folder of each row this clears is queued for removal from
  -- menu-media (the old path, returned by the update itself); a service path
  -- removes coaches/<folder>/* within a day (app.coach_photo_purge_due,
  -- app.coach_photo_purged, 0282).
  with old as (
    select c.id, c.photo_path from coaches c where c.profile_id = v_uid
  ), cleared as (
    update coaches c
       set status     = 'retired',
           retired_at = coalesce(c.retired_at, now()),
           bio_en     = '',
           bio_ar     = '',
           photo_path = null,
           updated_at = now()
      from old
     where c.id = old.id
       and (c.status <> 'retired' or c.bio_en <> '' or c.bio_ar <> '' or c.photo_path is not null)
    returning c.id, old.photo_path as old_photo
  ), queued as (
    insert into coach_photo_purges (coach_id, folder)
    select x.id, substring(x.old_photo from '^(coaches/[0-9a-f-]{36})/')
      from cleared x
     where x.old_photo is not null
    returning 1
  )
  select (select count(*) from cleared), (select count(*) from queued)
    into v_coach, v_photos;

  -- R49: a coach's time-off reasons are user content, emptied (NOT NULL text).
  update coach_time_off
     set reason = ''
   where coach_id in (select c.id from coaches c where c.profile_id = v_uid)
     and reason <> '';
  get diagnostics v_time_off = row_count;

  -- The queued notifications, after the match rows: a mutex holder ending a
  -- match writes its seats and requests first and then, through the
  -- match_events push trigger, deletes that match's queued reminders
  -- (app.match_sync_reminders). Taking the outbox rows last keeps this body in
  -- the same order, so it never holds a reminder row while it waits for a
  -- seat such a body holds (a 40P01 that would fail the deletion or swallow
  -- the reminder clean-up of a cancelled match).
  delete from notification_outbox where profile_id = v_uid;
  get diagnostics v_outbox = row_count;

  -- DF-20 (money.md §5.11, R13), the last data write: after the tombstone
  -- (ticket_refund_deleted picks deleted payers) and after every reservations
  -- write. Each purchase with nothing reserved, in use or restorable is cashed
  -- out now, one Qi refund of the price paid; a purchase whose ticket another
  -- body holds is skipped, never waited for. No match lock (R25): a purchase
  -- still tied to a match is refunded by the sweep once the match lets it go.
  -- A deletion never fails on a refund: an error is a warning, and the sweep's
  -- ticket_refund_deleted(null) retries.
  begin
    perform app.ticket_refund_deleted(v_uid);
  exception when others then
    raise warning 'delete_my_account: ticket refunds left for the sweep: % (%)', sqlerrm, sqlstate;
  end;

  -- The audit row is written BEFORE the auth user goes, while auth.uid() still
  -- resolves for write_audit's actor_id.
  --
  -- It deliberately carries NO before-image. to_jsonb(profile) would write the
  -- full_name and phone this function exists to erase into an append-only table
  -- that manager and owner can read — reintroducing the data one row further
  -- down. What is recorded is the SHAPE of the deletion: enough to prove it
  -- happened and what it touched, nothing that identifies who.
  perform app.write_audit(
    'account.delete', 'profiles', v_uid::text,
    jsonb_build_object(
      'had_phone',      v_profile.phone is not null,
      'had_push_token', v_profile.expo_push_token is not null,
      'created_at',     v_profile.created_at),
    jsonb_build_object(
      'reservations_anonymised',    v_reservations,
      'series_anonymised',          v_series,
      'customer_notes_deleted',     v_notes,
      'customer_flags_deleted',     v_flags,
      'outbox_deleted',             v_outbox,
      'match_seats_scrubbed',       v_seats,
      'match_requests_scrubbed',    v_requests,
      'match_blocks_deleted',       v_blocks,
      'lesson_enrolments_scrubbed', v_enrolments,
      'lesson_links_dropped',       v_links,
      'coach_retired',              v_coach > 0,
      'coach_photo_queued',         v_photos,
      'coach_time_off_scrubbed',    v_time_off,
      'apple_revoke_pending',       v_apple),
    'guest_request');

  -- The global sign-out, and the destruction of the identity itself.
  --
  -- auth.sessions CASCADEs from auth.users and auth.refresh_tokens CASCADEs from
  -- auth.sessions, so every token ever issued to this account dies with this one
  -- statement — a refresh token captured an hour ago can no longer mint a JWT.
  -- It also takes auth.identities (the Apple / Google link) and the email, phone
  -- and raw_user_meta_data, which is where full_name and phone were duplicated.
  --
  -- The on_auth_user_deleted trigger fires here and does nothing: deleted_at was
  -- stamped above, so the tombstone is left standing.
  delete from auth.users where id = v_uid;

  return jsonb_build_object(
    'deleted',              true,
    'profile_id',           v_uid,
    'apple_revoke_pending', v_apple);
end $delete_my_account_0290$;

comment on function app.delete_my_account(text) is
  '0290 (DB-03), 0289, from 0264 (0077; db.md §4.9 of open matches, §4.10 of coaching; DF-20, CD-12, R25, R29, R43, R44, R63). Store-mandated in-app account deletion. Destroys the auth user (which cascades every session, refresh token and identity — this IS the global sign-out) and leaves profiles as an anonymised tombstone (name parts and gender emptied too) so reservations.guest_id and the venue statistics keep a parent. Open matches: the player''s seats and requests lose gender and friend_genders, every block by or of the player is deleted, and every ticket purchase with nothing reserved, in use or restorable is refunded at once (app.ticket_refund_deleted, one Qi refund each). Coaching: a pending typed-phone link to the account is dropped silently, as "Not me" (C-21); the account''s other enrolments lose typed phones and friend names, a typed name becoming ''Deleted account''; the account''s coach profile is retired, its bios emptied, its photo folder queued for removal (coach_photo_purges, R43) and its time-off reasons emptied, the display names kept for the statements (C-29); since 0290 the coach rows are locked (profile, then coach) and the folder queued is the one of the row actually cleared. Takes no match lock, coach mutex or court lock (R25, D9): the sweeps (0263, 0286) leave or cancel the live matches, enrolments and a retired coach''s lessons, with refunds (account_deleted, coach_retired) and pushes; meanwhile other players see "Former player". Refuses an anonymous session (ACCOUNT_REQUIRED), a staff account (FORBIDDEN — staff are deactivated), an account already deleted (ALREADY_DELETED) and any call without p_confirm => ''DELETE''. Apple''s /auth/revoke is NOT called: no .p8 key exists yet, so the audit row records apple_revoke_pending instead.';

revoke all on function app.delete_my_account(text) from public, anon, authenticated;
grant execute on function app.delete_my_account(text) to authenticated;

-- ===========================================================================
-- DB-02: the hours already stranded (one-off data step)
-- ===========================================================================
-- Hours of a coach at a branch where the coach has no active coach_branches
-- row (a branch dropped before 0290) go, one branch at a time under that
-- branch's app.venue_id, as the writers above now delete them.
do $coach_hours_stranded_0290$
declare
  v_v uuid;
  v_n int;
  v_total int := 0;
begin
  for v_v in
    select distinct h.venue_id
      from coach_hours h
     where not exists (select 1 from coach_branches b
                        where b.coach_id = h.coach_id and b.venue_id = h.venue_id and b.active)
     order by h.venue_id
  loop
    perform set_config('app.venue_id', v_v::text, true);
    delete from coach_hours h
     where h.venue_id = v_v
       and not exists (select 1 from coach_branches b
                        where b.coach_id = h.coach_id and b.venue_id = h.venue_id and b.active);
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;
  perform set_config('app.venue_id', '', true);
  raise notice '0290: % stranded coach_hours rows deleted', v_total;
end $coach_hours_stranded_0290$;
