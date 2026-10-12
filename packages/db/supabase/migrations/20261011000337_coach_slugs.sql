set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0337 coach_slugs — a coach's share link names the coach (owner, 2026-10-11):
-- https://www.touch-padel.com/<locale>/c/omar-karim instead of /c/<coaches.id>.
--
--   * coaches.slug: made from display_name_en when the coach is made
--     (omar-karim; a second Omar Karim gets omar-karim-2), and changed only
--     when a manager or the owner edits it (app.coach_update). Renaming the
--     coach keeps the slug, so a shared link keeps working; an edited slug's
--     old name stops working (owner: no history of old names). The id link
--     /c/<coaches.id> keeps working for good.
--   * 2..48 of a-z, 0-9 and dashes, starting with a letter or digit, and never
--     shaped like a coach id, so a link's last segment is one or the other.
--   * Unique: 0338, the index in its own file.
--   * coaching_public, coach_profile and coaches_admin carry it;
--     app.coach_id_for_slug turns a link's slug into the coach's id (anon).
--
-- covered by packages/db/tests/coaching-coach-slug.test.ts
-- ===========================================================================

alter table coaches add column if not exists slug text;

comment on column coaches.slug is
  '0337. The name in the coach''s share link (/c/<slug>): made from display_name_en at insert (trigger coaches_slug), edited only through app.coach_update. Unique (0338, coaches_slug_key). Public by design: coaching_public and coach_profile carry it.';

-- The share link's name, or false. Granted to every writing role because the
-- CHECK below names it (the 0116 → 0121 lesson).
create or replace function app.coach_slug_ok(p_slug text) returns boolean
language sql immutable set search_path = public as $coach_slug_ok_0337$
  select p_slug is not null
     and p_slug ~ '^[a-z0-9][a-z0-9-]{1,47}$'
     and p_slug !~ '^[0-9a-f]{8}-[0-9a-f]{4}-'
$coach_slug_ok_0337$;

comment on function app.coach_slug_ok(text) is
  '0337. True when p_slug can be a coach''s share link name: 2..48 of a-z, 0-9 and dashes, starting with a letter or digit, and not shaped like a coaches.id.';

revoke all on function app.coach_slug_ok(text) from public;
grant execute on function app.coach_slug_ok(text) to anon, authenticated, service_role;

-- The first free slug for a name: its latin letters and digits, dashes
-- between the words, at most 40 long; "coach" when nothing is left (a name
-- with no latin letter). Taken: -2, -3, … p_self is the coach being named, so
-- its own slug never counts as taken.
create or replace function app.coach_slug_free(p_name text, p_self uuid) returns text
language plpgsql stable security definer set search_path = public as $coach_slug_free_0337$
declare
  v_base text;
  v_try  text;
  v_n    int := 1;
begin
  v_base := btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', '-', 'g'), '-');
  v_base := btrim(left(v_base, 40), '-');
  if not app.coach_slug_ok(v_base) then
    v_base := 'coach';
  end if;
  v_try := v_base;
  while exists (select 1 from coaches c where c.slug = v_try and c.id is distinct from p_self) loop
    v_n := v_n + 1;
    v_try := v_base || '-' || v_n;
  end loop;
  return v_try;
end $coach_slug_free_0337$;

comment on function app.coach_slug_free(text, uuid) is
  '0337. Internal: the first slug free for a coach named p_name (latin letters and digits of the name, dashes between words, at most 40; "coach" when none), with -2, -3, … when taken by another coach than p_self.';

revoke all on function app.coach_slug_free(text, uuid) from public, anon, authenticated;

-- A new coach with no slug gets one from the English name; a slug written
-- (coach_update) is lowercased and must be free. Named so it sorts after
-- coaches_sanitise (the name is clean by then) and before zz_branch_guard.
create or replace function app.trg_coach_slug() returns trigger
language plpgsql security definer set search_path = public as $trg_coach_slug_0337$
begin
  if new.slug is null then
    new.slug := app.coach_slug_free(new.display_name_en, new.id);
    return new;
  end if;
  new.slug := lower(btrim(new.slug));
  if not app.coach_slug_ok(new.slug) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'slug';
  end if;
  if exists (select 1 from coaches c where c.slug = new.slug and c.id <> new.id) then
    raise exception 'COACH_SLUG_TAKEN' using errcode = 'P0001';
  end if;
  return new;
end $trg_coach_slug_0337$;

revoke all on function app.trg_coach_slug() from public, anon, authenticated;

drop trigger if exists coaches_slug on coaches;
create trigger coaches_slug before insert or update of slug on coaches
  for each row execute function app.trg_coach_slug();

-- Every coach today, oldest first, so the first of two same-named coaches
-- keeps the plain name.
do $backfill_coach_slugs_0337$
declare
  r record;
begin
  for r in select c.id from coaches c where c.slug is null order by c.created_at, c.id loop
    update coaches set slug = null where id = r.id;
  end loop;
end $backfill_coach_slugs_0337$;

alter table coaches drop constraint if exists coaches_slug_chk;
alter table coaches
  add constraint coaches_slug_chk check (app.coach_slug_ok(slug))
  not valid;

do $validate_coaches_slug_0337$
begin
  if exists (select 1 from pg_constraint
              where conname = 'coaches_slug_chk'
                and conrelid = 'public.coaches'::regclass
                and not convalidated) then
    alter table coaches validate constraint coaches_slug_chk;
  end if;
end $validate_coaches_slug_0337$;

-- ===========================================================================
-- app.coach_id_for_slug: a share link's slug → the coach's id
-- ===========================================================================

-- The phone opens /c/<slug> through this, then reads the coach by id as it
-- always did (coach_profile answers COACH_NOT_FOUND and a paused coach as
-- before). NULL when no coach that accepted going public and is not retired
-- has the slug. Never raises.
create or replace function app.coach_id_for_slug(p_slug text) returns uuid
language sql stable security definer set search_path = public as $coach_id_for_slug_0337$
  select c.id
    from coaches c
   where c.slug = lower(btrim(p_slug))
     and c.status <> 'retired'
     and c.public_accepted_at is not null
$coach_id_for_slug_0337$;

comment on function app.coach_id_for_slug(text) is
  '0337. Anon and authenticated, public by design (a share link names the coach). The id of the coach whose slug p_slug is (lowercased and trimmed), or NULL when none, or the coach is retired or has not accepted going public. Never raises.';

revoke all on function app.coach_id_for_slug(text) from public;
grant execute on function app.coach_id_for_slug(text) to anon, authenticated;

-- ===========================================================================
-- app.coaching_public, app.coach_profile (re-issued from 0334, which keeps levels): + slug
-- ===========================================================================

create or replace function app.coaching_public(p_venue_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $coaching_public_0337$
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
                   'slug', co.slug,
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
end $coaching_public_0337$;

comment on function app.coaching_public(uuid) is
  '0283 (db.md §4.7.9, guest.md §4.3; X1, C-11, R16, R61, R76), 0334 (levels), 0337 (each coach carries slug, the name in its share link). Anon and authenticated, public by design; never raises. {off: true} when the named branch has coaching off, is closed or unknown, or (p_venue_id NULL) no open branch has coaching on. Else {off: false, branches[{venue_id, name_en, name_ar, timezone, payment_mode, prices_public, cancellation_window_hours}], coaches[{id, display_name_en, display_name_ar, slug, bio_en, bio_ar, photo_path, sort_order, levels (0334: a subset of beginner, intermediate, advanced; [] = every level), venue_ids, offers[{lesson_type_id, venue_id, price_iqd}]}] (active coaches who accepted going public, with an active branch row), lesson_types[{id, venue_id, kind, name_*, description_*, duration_min, max_places, min_places, sessions_count, price_iqd, sort_order}] (on sale, taught by a listed coach), sessions[] (app.lesson_read_sessions), server_now}. Prices are always sent; the website drops them while prices_public is false. No student, phone, profile id or court id.';

revoke all on function app.coaching_public(uuid) from public;
grant execute on function app.coaching_public(uuid) to anon, authenticated;

create or replace function app.coach_profile(p_coach_id uuid, p_venue_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $coach_profile_0337$
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
    'slug', v_co.slug,
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
end $coach_profile_0337$;

comment on function app.coach_profile(uuid, uuid) is
  '0283 (db.md §4.7.9, guest.md §4.3; X2, R17, R61, R76), 0334 (levels), 0337 (the card carries slug). Anon and authenticated, public by design. INVALID_ARGUMENT (p_coach_id NULL); COACH_NOT_FOUND (unknown, retired, or not yet accepted). p_venue_id NULL: {off: true} when the coach is active at no open branch with coaching on, else {off: false, coach: {id, display_name_*, slug, bio_*, photo_path, status, levels (0334: a subset of beginner, intermediate, advanced; [] = every level), venue_ids}, venue: null, bookable, offers: [], sessions: [], server_now}. A named branch: {off: true} when it is closed, unknown or has coaching off; COACH_NOT_AT_BRANCH when the coach is not active there; else the card, venue {venue_id, name_*, timezone, phone (the branch''s), payment_mode, prices_public, cancellation_window_hours}, bookable, offers[{lesson_type_id, kind, name_*, description_*, duration_min, max_places, min_places, sessions_count, cutoff_hours, price_iqd (lesson_price_for)}] and sessions[] (app.lesson_read_sessions). A paused coach answers status paused, bookable false, no offers and no sessions (R76). No profile id, student or court.';

revoke all on function app.coach_profile(uuid, uuid) from public;
grant execute on function app.coach_profile(uuid, uuid) to anon, authenticated;

-- ===========================================================================
-- app.coaches_admin, app.coach_update (re-issued from 0334, which keeps levels): + slug
-- ===========================================================================

create or replace function app.coaches_admin(p_venue_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $coaches_admin_0337$
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
                   'slug', c.slug,
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
end $coaches_admin_0337$;

comment on function app.coaches_admin(uuid) is
  '0282 (db.md §4.6.3; X19, R46, R57), 0290 (DB-02: hours_elsewhere only at active, not-closed branches), 0334 (levels), 0337 (each coach carries slug). Manager and owner, at the branch (default: the caller''s resolved branch). {venue_id, coaching_enabled, server_now, coaches: [{coach_id, profile_id, full_name, phone, account_deleted, display_name_*, slug, bio_*, photo_path, status, public_accepted_at, retired_at, sort_order, levels (a subset of beginner, intermediate, advanced; [] = every level), venue_ids, active_here, lesson_type_ids, prices, hours, hours_set_by, hours_set_by_name, hours_updated_at, hours_elsewhere, time_off, upcoming_lessons, open_courses}], lesson_types: [{lesson_type_id, kind, name_*, description_*, duration_min, price_iqd, court_share_iqd, max_places, min_places, cutoff_hours, sessions_count, is_active, launched_at, sort_order, coach_ids, pending_run}]} for every coach with a coach_branches row at the branch and every type of the branch. hours_elsewhere lists the coach''s windows at the other branches where the coach is active and that are not closed. The profile''s name and phone are staff data, never public. FORBIDDEN by role, then by branch.';

revoke all on function app.coaches_admin(uuid) from public, anon;
grant execute on function app.coaches_admin(uuid) to authenticated;

create or replace function app.coach_update(p_coach_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $coach_update_0337$
declare
  v_allowed text[] := array['display_name_en', 'display_name_ar', 'slug', 'bio_en', 'bio_ar', 'photo_path', 'sort_order',
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
  -- 0337: the share link's name. Lowercased and trimmed; taken by another
  -- coach is COACH_SLUG_TAKEN (the coach lock above holds a second edit of
  -- this coach; the unique index answers two coaches racing for one name).
  if p_patch ? 'slug' then
    v_text := case when jsonb_typeof(p_patch->'slug') = 'string'
                   then lower(btrim(p_patch->>'slug')) end;
    if not app.coach_slug_ok(v_text) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'slug';
    end if;
    if exists (select 1 from coaches c where c.slug = v_text and c.id <> v_c.id) then
      raise exception 'COACH_SLUG_TAKEN' using errcode = 'P0001';
    end if;
    v_new.slug := v_text;
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
         slug = v_new.slug,
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
                                             'slug', v_c.slug,
                                             'photo_path', v_c.photo_path, 'sort_order', v_c.sort_order,
                                             'levels', to_jsonb(v_c.levels),
                                             'bio_changed', false),
                          jsonb_build_object('display_name_en', v_new.display_name_en,
                                             'display_name_ar', v_new.display_name_ar,
                                             'slug', v_new.slug,
                                             'photo_path', v_new.photo_path, 'sort_order', v_new.sort_order,
                                             'levels', to_jsonb(v_new.levels),
                                             'bio_changed', v_new.bio_en is distinct from v_c.bio_en
                                                            or v_new.bio_ar is distinct from v_c.bio_ar));
  return jsonb_build_object(
    'coach_id', v_new.id,
    'status', v_new.status,
    'display_name_en', v_new.display_name_en,
    'display_name_ar', v_new.display_name_ar,
    'slug', v_new.slug,
    'bio_en', v_new.bio_en,
    'bio_ar', v_new.bio_ar,
    'photo_path', v_new.photo_path,
    'sort_order', v_new.sort_order,
    'levels', to_jsonb(v_new.levels),
    'public_accepted_at', v_new.public_accepted_at,
    'updated_at', v_new.updated_at);
end $coach_update_0337$;

comment on function app.coach_update(uuid, jsonb) is
  '0282 (db.md §4.6.3; C-7, R43), 0290 (DB-03), 0334 (levels), 0337 (slug: the share link''s name, lowercased; INVALID_ARGUMENT slug when it is not 2..48 of a-z, 0-9 and dashes starting with a letter or digit, or looks like a coach id; COACH_SLUG_TAKEN when another coach has it). Manager (a coach in scope) and owner: patch a coach''s display_name_en, display_name_ar (1..60), slug, bio_en, bio_ar (<= 1000), photo_path (NULL clears; coaches/<fresh uuid>/<file>, R43), sort_order and levels (an array of beginner | intermediate | advanced, stored in that order, each once; [] = every level). Under the coach lock with the row FOR UPDATE, so a retirement or account deletion committed first is never written over. A replaced photo''s old folder is queued in coach_photo_purges. Refusals: FORBIDDEN (role); COACH_NOT_FOUND; FORBIDDEN (scope); INVALID_ARGUMENT p_patch | the key | retired. Audited coaching.coach.update (names, slug, photo, order, levels and whether a bio changed). Returns the coach''s card {coach_id, status, display_name_*, slug, bio_*, photo_path, sort_order, levels, public_accepted_at, updated_at}.';

revoke all on function app.coach_update(uuid, jsonb) from public, anon;
grant execute on function app.coach_update(uuid, jsonb) to authenticated;
