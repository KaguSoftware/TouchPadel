set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0294 coaching_reads — the coaching post-build review, the reads (plan
-- "Coaching: make it bulletproof" §1, items DB-27 to DB-34). 0273–0289 are
-- not edited: every function below is re-issued from its latest body (0283,
-- 0174), verbatim except for the change named; dollar tags _0294. No
-- signature changes; every function keeps its grants (create or replace),
-- re-stated below.
--
--   DB-27 app.coach_slots: a start is kept when it is at or after p_from and
--         after now() (was: after greatest(p_from, now())), so the desk,
--         which asks one local day at a time from 00:00, is offered 00:00.
--         greatest(p_from, now()) stays the series start.
--   DB-28 app.lesson_read_sessions: every session row carries price_iqd and
--         full_price_iqd. A group session: the lesson's own price (the
--         coach's price when it was created). A course: full_price_iqd the
--         course price, price_iqd what lesson_offer charges now (the course
--         price before it starts; course_late_join_price from the first
--         session not yet started once it runs, 0283:5408).
--   DB-29 New internal app.hold_is_live(reservations): false only for a
--         pending hold that app.expire_stale_holds / app.match_expire_holds
--         (0291) would expire now — past its TTL, or an orphan (no guest,
--         no lesson) — with no online payment open within ten minutes of
--         its deadline. app.coach_slots counts a court row through it, so a
--         lapsed hold whose payment is still open blocks the start (the
--         booking body would keep it too), and an orphan hold does not.
--   DB-30 app.coach_slots: the protected-horizon cut while the branch trades
--         offline applies to guests and to the coach asking about
--         themselves (coach_book_private refuses those starts,
--         DEGRADED_LOCKOUT); staff of the type's branch stay exempt. The
--         coach keeps the switch, consent and horizon exemptions.
--   DB-31 app.desk_lesson_detail: each enrolment's money carries
--         refund_due_desk_iqd and refund_blocked_iqd (the engine's); its
--         can.cancel on a private lesson is now() < start_at, as
--         desk_cancel_enrolment refuses a started private lesson (0291,
--         DB-07).
--   DB-32 app.desk_lessons: paid_online counts booked places with online
--         money left after refunds (a cancelled or refunded place, or a held
--         one, is not paid); new awaiting (held places) and paid_places
--         (booked places with desk or online money left after refunds).
--   DB-33 app.my_lesson: a pending link (C-21) whose place is no longer live
--         (not held or booked, or its lesson, or a course place's last
--         covered session, has ended: lesson_link_confirm's rule, 0291
--         DB-13) is ENROLMENT_NOT_FOUND; can.pay also needs the first
--         covered session not to have started. app.lesson_offer's mine
--         includes the caller's unconfirmed place, with confirm_needed.
--   DB-34 app.tournament_feasibility: per court of each range, besides
--         bookings and guests, lessons (live lesson court rows and live held
--         lessons' holds) and students (distinct live enrolments of those
--         lessons).
--
-- Locks: none. Every function here is a read (stable); hold_is_live takes
-- no lock and writes nothing.

-- ===========================================================================
-- DB-29: app.hold_is_live (new)
-- ===========================================================================

-- Whether a reservation row still takes its court as far as the hold sweep
-- is concerned. It matches the expire_stale_holds / match_expire_holds pair
-- (0291): whoever changes their WHERE changes this in the same file.
create or replace function app.hold_is_live(p_r reservations) returns boolean
language sql stable security definer set search_path = public as $hold_is_live_0294$
  select not (p_r.kind = 'hold'
              and p_r.status = 'pending'
              and (coalesce(p_r.hold_expires_at < now(), false)
                   or (p_r.guest_id is null and p_r.lesson_id is null))
              and not exists (select 1 from booking_payments bp
                               where bp.hold_id = p_r.id
                                 and bp.status in ('created', 'pending')
                                 and bp.deadline_at > now() - interval '10 minutes'))
$hold_is_live_0294$;

comment on function app.hold_is_live(reservations) is
  '0294 (DB-29). Internal. False only for a pending hold that app.expire_stale_holds and app.match_expire_holds would expire now: past its TTL, or an orphan (no guest and no lesson), with no online payment (booking_payments.hold_id) created or pending within ten minutes of its deadline. True for every other row; callers filter the status. Whoever changes that pair''s WHERE changes this in the same file.';

revoke all on function app.hold_is_live(reservations) from public, anon, authenticated;

-- ===========================================================================
-- DB-28: app.lesson_read_sessions (re-issued from 0283:4712)
-- ===========================================================================

create or replace function app.lesson_read_sessions(p_venues uuid[], p_coach_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $lesson_read_sessions_0294$
begin
  return coalesce((
    select jsonb_agg(x.j order by x.start_at, x.sort_id)
      from (select s.start_at, s.sort_id, s.j
              from (select l.start_at, l.id::text as sort_id,
                           jsonb_build_object(
                             'kind', 'group',
                             'lesson_id', l.id,
                             'course_id', null,
                             'venue_id', l.venue_id,
                             'coach_id', l.coach_id,
                             'lesson_type_id', l.lesson_type_id,
                             'title_en', null,
                             'title_ar', null,
                             'start_at', l.start_at,
                             'end_at', l.end_at,
                             'sessions_count', null,
                             'sessions_left', null,
                             'places_left', l.max_places - p.taken,
                             'max_places', l.max_places,
                             'signup_closes_at', l.start_at,
                             'cutoff_at', l.cutoff_at,
                             -- 0294 (DB-28): the place's price (the coach's
                             -- own when the session was created).
                             'price_iqd', l.price_iqd,
                             'full_price_iqd', l.price_iqd) as j
                      from lessons l
                      join coaches co on co.id = l.coach_id
                      cross join lateral (select app.lesson_places_taken(l.id) as taken) p
                     where l.venue_id = any (p_venues)
                       and (p_coach_id is null or l.coach_id = p_coach_id)
                       and l.kind = 'group'
                       and l.status = 'scheduled'
                       and l.start_at > now()
                       and l.start_at < now() + interval '30 days'
                       and co.status = 'active'
                       and co.public_accepted_at is not null
                       and exists (select 1 from coach_branches cb
                                    where cb.coach_id = l.coach_id and cb.venue_id = l.venue_id and cb.active)
                       and p.taken < l.max_places
                    union all
                    select n.start_at, c.id::text,
                           jsonb_build_object(
                             'kind', 'course',
                             'lesson_id', null,
                             'course_id', c.id,
                             'venue_id', c.venue_id,
                             'coach_id', c.coach_id,
                             'lesson_type_id', c.lesson_type_id,
                             'title_en', c.title_en,
                             'title_ar', c.title_ar,
                             'start_at', n.start_at,
                             'end_at', n.end_at,
                             'sessions_count', c.sessions_count,
                             'sessions_left', n.left_n,
                             'places_left', c.max_places - p.taken,
                             'max_places', c.max_places,
                             'signup_closes_at', c.signup_closes_at,
                             'cutoff_at', c.cutoff_at,
                             -- 0294 (DB-28): lesson_offer's price now
                             -- (0283:5408): the course price before it
                             -- starts, the sessions not yet started once it
                             -- runs (C-15).
                             'price_iqd', case when n.first_n is null then c.price_iqd
                                               else app.course_late_join_price(c.price_iqd, c.sessions_count::int,
                                                                               n.first_n) end,
                             'full_price_iqd', c.price_iqd)
                      from courses c
                      join coaches co on co.id = c.coach_id
                      cross join lateral (
                        select l.start_at, l.end_at,
                               (select count(*) from lessons l2
                                 where l2.course_id = c.id and l2.status = 'scheduled'
                                   and l2.start_at > now())::int as left_n,
                               (select min(l2.session_no) from lessons l2
                                 where l2.course_id = c.id and l2.status = 'scheduled'
                                   and l2.start_at > now())::int as first_n
                          from lessons l
                         where l.course_id = c.id and l.status = 'scheduled' and l.start_at > now()
                         order by l.start_at, l.session_no
                         limit 1) n
                      cross join lateral (select app.course_places_taken(c.id) as taken) p
                     where c.venue_id = any (p_venues)
                       and (p_coach_id is null or c.coach_id = p_coach_id)
                       and c.status in ('open', 'running')
                       and now() < c.signup_closes_at
                       and n.start_at < now() + interval '60 days'
                       and co.status = 'active'
                       and co.public_accepted_at is not null
                       and exists (select 1 from coach_branches cb
                                    where cb.coach_id = c.coach_id and cb.venue_id = c.venue_id and cb.active)
                       and p.taken < c.max_places) s
             order by s.start_at, s.sort_id
             limit 50) x), '[]'::jsonb);
end $lesson_read_sessions_0294$;

comment on function app.lesson_read_sessions(uuid[], uuid) is
  '0283, 0294 (DB-28). Internal. The listing of coaching_public and coach_profile (X1, X2 sessions[]): group sessions (scheduled, starting within 30 days, a place left) and courses (open or running, sign-up open, next session within 60 days, a place left) of active coaches who accepted going public (R16, R61) with an active branch row, at the given branches (and of one coach when given). {kind, lesson_id, course_id, venue_id, coach_id, lesson_type_id, title_en, title_ar, start_at, end_at (a course: its next session), sessions_count, sessions_left, places_left, max_places, signup_closes_at, cutoff_at, price_iqd, full_price_iqd}, soonest first, at most 50. price_iqd is what a guest pays now (lesson_offer''s price): a group session''s own price; a course''s price before it starts, else course_late_join_price from its first session not yet started. full_price_iqd is the session''s or the course''s price. No student, no court, no count by name.';

revoke all on function app.lesson_read_sessions(uuid[], uuid) from public, anon, authenticated;

-- ===========================================================================
-- DB-27, DB-29, DB-30: app.coach_slots (re-issued from 0283:5148)
-- ===========================================================================

create or replace function app.coach_slots(p_coach_id uuid, p_lesson_type_id uuid, p_from timestamptz,
                                           p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $coach_slots_0294$
declare
  v_t        lesson_types%rowtype;
  v_co       coaches%rowtype;
  v_vs       venue_settings%rowtype;
  v_venue    uuid;
  v_staff    boolean;
  v_self     boolean;
  v_tz       text;
  v_dur      interval;
  v_lo       timestamptz;
  v_horizon  timestamptz;
  v_protect  timestamptz;
  v_bookable boolean;
  v_starts   jsonb;
begin
  if p_coach_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_coach_id';
  elsif p_lesson_type_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_type_id';
  elsif p_from is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_from';
  elsif p_to is null or p_to <= p_from or p_to - p_from > interval '14 days' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_to';
  end if;

  select * into v_t from lesson_types where id = p_lesson_type_id and kind = 'private';
  if not found then
    raise exception 'LESSON_TYPE_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_venue := v_t.venue_id;
  select * into v_co from coaches where id = p_coach_id;
  -- Staff of the type's branch (R51) and the coach asking about themselves
  -- (coach mode, before the public consent and with coaching off) read it
  -- whatever the switch and the consent, with no horizon; the offline cut
  -- spares staff only (0294, DB-30).
  v_self := coalesce(v_co.id is not null and v_co.profile_id = auth.uid(), false);
  v_staff := v_self or app.is_staff_at(v_venue, 'court_desk', 'manager', 'owner');

  if v_co.id is null or v_co.status = 'retired' or (v_co.public_accepted_at is null and not v_staff) then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_vs from venue_settings where venue_id = v_venue;
  if not v_staff
     and (not (v_venue = any (app.open_venue_ids())) or not coalesce(v_vs.coaching_enabled, false)) then
    return jsonb_build_object('off', true);
  end if;

  -- Bookable at all: an active coach (paused answers no starts, R51, R76),
  -- active at the branch, teaching the type, the type on sale with a price.
  v_bookable := v_co.status = 'active'
    and exists (select 1 from coach_branches cb
                 where cb.coach_id = v_co.id and cb.venue_id = v_venue and cb.active)
    and exists (select 1 from coach_lesson_types clt
                 where clt.coach_id = v_co.id and clt.lesson_type_id = v_t.id)
    and v_t.is_active
    and app.lesson_price_for(v_co.id, v_t.id) is not null;
  if not coalesce(v_bookable, false) then
    return jsonb_build_object(
      'off', false, 'venue_id', v_venue, 'coach_id', v_co.id, 'lesson_type_id', v_t.id,
      'duration_min', v_t.duration_min, 'bookable', false, 'starts', '[]'::jsonb, 'server_now', now());
  end if;

  v_tz := coalesce(v_vs.timezone, 'Asia/Baghdad');
  v_dur := make_interval(mins => v_t.duration_min::int);
  -- The series start; 0294 (DB-27): the filter below keeps p_from itself.
  v_lo := greatest(p_from, now());
  if not v_staff and coalesce(v_vs.max_booking_horizon_days, 0) > 0 then
    v_horizon := now() + make_interval(days => v_vs.max_booking_horizon_days);
  end if;
  -- 0294 (DB-30): the offline cut binds the coach asking about themselves
  -- too (coach_book_private refuses those starts, DEGRADED_LOCKOUT); only
  -- staff of the type's branch stage inside it.
  if app.is_degraded(v_venue)
     and (v_self or not app.is_staff_at(v_venue, 'court_desk', 'manager', 'owner')) then
    v_protect := now() + make_interval(hours => coalesce(v_vs.protected_horizon_hours, 48));
  end if;

  -- At most 14 x 48 candidates, cheapest test first; the opening-hours test
  -- (an exception block per row) runs on what is left.
  with cand as materialized (
    select g.s as start_at, g.s + v_dur as end_at
      from (select (l at time zone v_tz) as s
              from generate_series(date_trunc('hour', v_lo at time zone v_tz),
                                   p_to at time zone v_tz,
                                   interval '30 minutes') l) g
     where g.s >= p_from          -- 0294 (DB-27): a local 00:00 p_from is a start
       and g.s > now()
       and g.s + v_dur <= p_to
       and (v_horizon is null or g.s <= v_horizon)
       and (v_protect is null or g.s >= v_protect)
       and app.lesson_on_grid(g.s, v_venue)
  ), free_coach as materialized (
    select c.start_at, c.end_at
      from cand c
     where app.coach_available(v_co.id, v_venue, tstzrange(c.start_at, c.end_at, '[)'))
  ), free_court as materialized (
    select f.start_at, f.end_at
      from free_coach f
     where exists (select 1
                     from courts ct
                    where ct.venue_id = v_venue
                      and ct.is_active
                      and not exists (select 1 from reservations r
                                       where r.court_id = ct.id
                                         and r.status in ('pending', 'confirmed', 'arrived')
                                         -- 0294 (DB-29): live as the sweep sees it
                                         -- (an open payment keeps a lapsed hold;
                                         -- an orphan hold is gone).
                                         and app.hold_is_live(r)
                                         and r.period && tstzrange(f.start_at, f.end_at, '[)'))
                      and not app.match_court_claimed(ct.id, tstzrange(f.start_at, f.end_at, '[)')))
  )
  select coalesce(jsonb_agg(jsonb_build_object('start_at', o.start_at, 'end_at', o.end_at)
                            order by o.start_at), '[]'::jsonb)
    into v_starts
    from free_court o
   where app.lesson_bookable(v_venue, o.start_at, o.end_at) is null;

  return jsonb_build_object(
    'off', false, 'venue_id', v_venue, 'coach_id', v_co.id, 'lesson_type_id', v_t.id,
    'duration_min', v_t.duration_min, 'bookable', true, 'starts', v_starts, 'server_now', now());
end $coach_slots_0294$;

comment on function app.coach_slots(uuid, uuid, timestamptz, timestamptz) is
  '0283, 0294 (db.md §4.7.9, guest.md §4.3; X3, C-2, C-20, R51, R61, R76, R77; DB-27, DB-29, DB-30). Anon and authenticated, public by design. INVALID_ARGUMENT (a NULL, p_to <= p_from, a window over 14 days); LESSON_TYPE_NOT_FOUND (not a private type); COACH_NOT_FOUND (unknown, retired, or not accepted unless the caller is staff at the type''s branch or the coach themselves). {off: true} while the branch is closed or has coaching off, except to staff of the type''s branch (R51) and to the coach asking about themselves (coach mode). Else {off: false, venue_id, coach_id, lesson_type_id, duration_min, bookable, starts[{start_at, end_at}], server_now}: bookable false with no starts for a paused coach, a coach not active at the branch or not teaching the type, a type off sale or unpriced. Starts are the 30-minute grid starts at or after p_from and after now() ending by p_to (so a local 00:00 p_from is offered), within max_booking_horizon_days (not to staff or the coach themselves), outside the protected horizon while the branch trades offline (guests and the coach themselves; staff of the branch are exempt), inside opening hours (lesson_bookable), with the coach available (coach_available) and an active court with no live row over the period (app.hold_is_live: a hold while its TTL runs or an online payment on it is open, never an orphan) that no waiting match claims. No court ids, names or money.';

revoke all on function app.coach_slots(uuid, uuid, timestamptz, timestamptz) from public;
grant execute on function app.coach_slots(uuid, uuid, timestamptz, timestamptz) to anon, authenticated;

-- ===========================================================================
-- DB-33: app.lesson_offer (re-issued from 0283:5273)
-- ===========================================================================

create or replace function app.lesson_offer(p_lesson_id uuid default null, p_course_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $lesson_offer_0294$
declare
  v_uid      uuid := auth.uid();
  v_l        lessons%rowtype;
  v_c        courses%rowtype;
  v_co       coaches%rowtype;
  v_t        lesson_types%rowtype;
  v_v        venues%rowtype;
  v_vs       venue_settings%rowtype;
  v_next     lessons%rowtype;
  v_venue    uuid;
  v_coach    uuid;
  v_type     uuid;
  v_taken    int;
  v_max      int;
  v_status   text;
  v_first    int;
  v_left     int;
  v_price    bigint;
  v_mine     jsonb;
  v_sessions jsonb;
begin
  if num_nonnulls(p_lesson_id, p_course_id) <> 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_id';
  end if;
  if p_lesson_id is not null then
    -- A private lesson, or a course session's own id, is not an offer.
    select * into v_l from lessons where id = p_lesson_id and kind = 'group';
    if found then
      v_venue := v_l.venue_id;
      v_coach := v_l.coach_id;
      v_type := v_l.lesson_type_id;
    end if;
  else
    select * into v_c from courses where id = p_course_id;
    if found then
      v_venue := v_c.venue_id;
      v_coach := v_c.coach_id;
      v_type := v_c.lesson_type_id;
    end if;
  end if;
  if v_venue is not null then
    select * into v_co from coaches where id = v_coach;
  end if;
  -- A closed branch, or a coach who is paused, retired or not accepted (R16,
  -- R61, R76): not found.
  if v_venue is null
     or not (v_venue = any (app.open_venue_ids()))
     or v_co.status is distinct from 'active'
     or v_co.public_accepted_at is null then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_vs from venue_settings where venue_id = v_venue;
  if not coalesce(v_vs.coaching_enabled, false) then
    return jsonb_build_object('off', true);
  end if;
  select * into v_v from venues where id = v_venue;
  select * into v_t from lesson_types where id = v_type;

  if v_l.id is not null then
    -- A group session.
    v_taken := app.lesson_places_taken(v_l.id);
    v_max := v_l.max_places;
    v_status := case
                  when v_l.status in ('cancelled', 'expired') then 'cancelled'
                  when v_l.status <> 'scheduled' or now() >= v_l.start_at then 'closed'
                  when v_taken >= v_max then 'full'
                  else 'open'
                end;
    if v_uid is not null then
      -- 0294 (DB-33): a coach- or desk-added place still to confirm (C-21)
      -- is the caller's too, marked confirm_needed; a confirmed one first.
      select jsonb_build_object('enrolment_id', e.id, 'status', e.status,
                                'confirm_needed', e.link_confirmed_at is null)
        into v_mine
        from lesson_enrolments e
       where e.lesson_id = v_l.id
         and e.guest_id = v_uid
         and e.status in ('held', 'booked')
       order by (e.link_confirmed_at is not null) desc, e.created_at desc
       limit 1;
    end if;
    return jsonb_build_object(
      'kind', 'group',
      'lesson_id', v_l.id,
      'venue_id', v_venue,
      'timezone', coalesce(v_vs.timezone, v_v.timezone),
      'phone', coalesce(v_vs.phone, v_v.phone),
      'coach', app.lesson_read_coach_card(v_co.id),
      'type', jsonb_build_object('id', v_t.id, 'name_en', v_t.name_en, 'name_ar', v_t.name_ar,
                                 'description_en', v_t.description_en, 'description_ar', v_t.description_ar,
                                 'duration_min', v_t.duration_min),
      'title_en', null,
      'title_ar', null,
      'start_at', v_l.start_at,
      'end_at', v_l.end_at,
      'status', v_status,
      'places_left', greatest(v_max - v_taken, 0),
      'max_places', v_max,
      'min_places', v_l.min_places,
      'places_taken', v_taken,
      'cutoff_at', v_l.cutoff_at,
      'signup_closes_at', v_l.start_at,
      'price_iqd', v_l.price_iqd,
      'full_price_iqd', v_l.price_iqd,
      'late_join', null,
      'payment_mode', v_vs.lesson_payment_mode,
      'cancellation_window_hours', v_vs.cancellation_window_hours,
      'mine', v_mine,
      'server_now', now());
  end if;

  -- A course: the sessions not yet started price a late join (C-15).
  v_taken := app.course_places_taken(v_c.id);
  v_max := v_c.max_places;
  select min(l.session_no)::int, count(*)::int
    into v_first, v_left
    from lessons l
   where l.course_id = v_c.id and l.status = 'scheduled' and l.start_at > now();
  select * into v_next
    from lessons l
   where l.course_id = v_c.id and l.status = 'scheduled' and l.start_at > now()
   order by l.start_at, l.session_no
   limit 1;
  if v_next.id is null then
    select * into v_next from lessons l where l.course_id = v_c.id order by l.session_no desc limit 1;
  end if;
  v_status := case
                when v_c.status = 'cancelled' then 'cancelled'
                when v_c.status not in ('open', 'running') or now() >= v_c.signup_closes_at
                     or coalesce(v_left, 0) = 0 then 'closed'
                when v_taken >= v_max then 'full'
                else 'open'
              end;
  v_price := case when v_first is null then v_c.price_iqd
                  else app.course_late_join_price(v_c.price_iqd, v_c.sessions_count::int, v_first) end;
  select coalesce(jsonb_agg(jsonb_build_object(
           'lesson_id', l.id,
           'session_no', l.session_no,
           'start_at', l.start_at,
           'end_at', l.end_at,
           'status', l.status,
           'started', now() >= l.start_at)
           order by l.session_no), '[]'::jsonb)
    into v_sessions
    from lessons l
   where l.course_id = v_c.id;
  if v_uid is not null then
    -- 0294 (DB-33): as for a group session, an unconfirmed place too.
    select jsonb_build_object('enrolment_id', e.id, 'status', e.status,
                              'confirm_needed', e.link_confirmed_at is null)
      into v_mine
      from lesson_enrolments e
     where e.course_id = v_c.id
       and e.guest_id = v_uid
       and e.status in ('held', 'booked')
     order by (e.link_confirmed_at is not null) desc, e.created_at desc
     limit 1;
  end if;

  return jsonb_build_object(
    'kind', 'course',
    'course_id', v_c.id,
    'venue_id', v_venue,
    'timezone', coalesce(v_vs.timezone, v_v.timezone),
    'phone', coalesce(v_vs.phone, v_v.phone),
    'coach', app.lesson_read_coach_card(v_co.id),
    'type', jsonb_build_object('id', v_t.id, 'name_en', v_t.name_en, 'name_ar', v_t.name_ar,
                               'description_en', v_t.description_en, 'description_ar', v_t.description_ar,
                               'duration_min', v_t.duration_min),
    'title_en', v_c.title_en,
    'title_ar', v_c.title_ar,
    'start_at', v_next.start_at,
    'end_at', v_next.end_at,
    'sessions', v_sessions,
    'status', v_status,
    'places_left', greatest(v_max - v_taken, 0),
    'max_places', v_max,
    'min_places', v_c.min_places,
    'places_taken', v_taken,
    'cutoff_at', v_c.cutoff_at,
    'signup_closes_at', v_c.signup_closes_at,
    'price_iqd', v_price,
    'full_price_iqd', v_c.price_iqd,
    'late_join', case when v_first is not null and v_first > 1
                      then jsonb_build_object('sessions_left', v_left, 'sessions_count', v_c.sessions_count)
                 end,
    'payment_mode', v_vs.lesson_payment_mode,
    'cancellation_window_hours', v_vs.cancellation_window_hours,
    'mine', v_mine,
    'server_now', now());
end $lesson_offer_0294$;

comment on function app.lesson_offer(uuid, uuid) is
  '0283, 0294 (db.md §4.7.9, guest.md §4.3; X4, C-15, C-21, R16, R61, R76; DB-33). Anon and authenticated, public by design. INVALID_ARGUMENT unless exactly one id; LESSON_NOT_FOUND (unknown, a private lesson or a course session''s id, a closed branch, a coach paused, retired or not accepted); {off: true} while the branch has coaching off. Else {kind (group | course), lesson_id | course_id, venue_id, timezone, phone (the branch''s), coach {id, display_name_*, photo_path}, type {id, name_*, description_*, duration_min}, title_*, start_at, end_at (a course: its next session), sessions[{lesson_id, session_no, start_at, end_at, status, started}] (course), status (open | full | closed | cancelled: closed after a group''s start or a course''s last start), places_left, max_places, min_places, places_taken (a count), cutoff_at, signup_closes_at, price_iqd (the caller''s price now: the place, the course, or its sessions not yet started, course_late_join_price), full_price_iqd, late_join {sessions_left, sessions_count} | null, payment_mode, cancellation_window_hours, mine {enrolment_id, status, confirm_needed} | null (the caller''s own live enrolment, held or booked; signed in only; 0294: an unconfirmed coach- or desk-added place too, confirm_needed true, a confirmed one first), server_now}. No student, phone or profile id.';

revoke all on function app.lesson_offer(uuid, uuid) from public;
grant execute on function app.lesson_offer(uuid, uuid) to anon, authenticated;

-- ===========================================================================
-- DB-33: app.my_lesson (re-issued from 0283:5531)
-- ===========================================================================

create or replace function app.my_lesson(p_enrolment_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $my_lesson_0294$
declare
  v_p          profiles%rowtype := app.lesson_guest(false);
  v_e          lesson_enrolments%rowtype;
  v_v          venues%rowtype;
  v_vs         venue_settings%rowtype;
  v_ref        lessons%rowtype;
  v_last       lessons%rowtype;
  v_row        jsonb;
  v_m          jsonb;
  v_window     interval;
  v_can_cancel boolean;
  v_can_pay    boolean;
  v_policy     text := 'none';
  v_kind       text;
  v_free_until timestamptz;
  v_because    text;
  v_refund     bigint;
  v_kept       bigint;
  v_rs         int;
  v_ks         int;
  v_court_id   uuid;
  v_court_en   text;
  v_court_ar   text;
  v_sessions   jsonb;
begin
  if p_enrolment_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_enrolment_id';
  end if;
  select * into v_e from lesson_enrolments where id = p_enrolment_id and guest_id = v_p.id;
  if not found then
    raise exception 'ENROLMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_row := app.lesson_read_my_row(v_e.id);
  select * into v_v from venues where id = v_e.venue_id;
  select * into v_vs from venue_settings where venue_id = v_e.venue_id;

  -- A pending link (C-21): the card only, and "is this you?".
  if v_e.link_confirmed_at is null then
    -- 0294 (DB-33): only while the place is live, as lesson_link_confirm
    -- judges it (0291, DB-13): held or booked, and its lesson (a course
    -- place: its last covered session) not yet ended. A place the coach
    -- removed, or one that is over, is not the caller's to confirm.
    if v_e.status not in ('held', 'booked')
       or (v_e.lesson_id is not null
           and exists (select 1 from lessons l where l.id = v_e.lesson_id and l.end_at <= now()))
       or (v_e.course_id is not null
           and not exists (select 1 from lessons s
                            where s.course_id = v_e.course_id and s.end_at > now()
                              and s.session_no between v_e.first_session_no
                                                   and v_e.first_session_no + v_e.sessions_covered - 1)) then
      raise exception 'ENROLMENT_NOT_FOUND' using errcode = 'P0001';
    end if;
    return v_row || jsonb_build_object(
      'friend_names', '[]'::jsonb,
      'court_name_en', null,
      'court_name_ar', null,
      'cancel', jsonb_build_object('policy', 'none', 'free_until', null, 'free_because', null,
                                   'refund_iqd', null, 'kept_iqd', null, 'counts_late', false,
                                   'refund_sessions', null, 'kept_sessions', null, 'next_start_at', null),
      'can', jsonb_build_object('cancel', false, 'pay', false, 'confirm', true),
      'branch_phone', coalesce(v_vs.phone, v_v.phone),
      'timezone', coalesce(v_vs.timezone, v_v.timezone),
      'server_now', now());
  end if;

  v_window := make_interval(hours => coalesce(v_vs.cancellation_window_hours, 12));
  select * into v_last
    from app.lesson_read_covered(v_e.id) x
   order by x.start_at desc, x.session_no desc nulls last
   limit 1;
  -- The cancel's reference: the lesson, or the guest's own next covered
  -- session not yet started (C-23).
  if v_e.lesson_id is not null then
    select * into v_ref from lessons where id = v_e.lesson_id;
  else
    select * into v_ref
      from app.lesson_read_covered(v_e.id) x
     where x.status = 'scheduled' and x.start_at > now()
     order by x.start_at, x.session_no
     limit 1;
  end if;

  -- lesson_cancel_mine's refusals: not held or booked; the lesson started (a
  -- course enrolment: its last covered session started).
  v_can_cancel := v_e.status in ('held', 'booked')
                  and v_ref.id is not null
                  and v_last.id is not null
                  and now() < v_last.start_at
                  and v_ref.status in ('held', 'scheduled');
  -- 0294 (DB-33, DB-35): and the first covered session not yet started, so
  -- a held place is never paid for a lesson already under way.
  v_can_pay := v_e.status = 'held' and coalesce(v_e.hold_expires_at > now(), false)
               and coalesce((select min(x.start_at) from app.lesson_read_covered(v_e.id) x) > now(), false);
  v_m := app.lesson_enrolment_money(v_e.id);

  if coalesce(v_can_cancel, false) then
    if v_e.status = 'held' then
      v_policy := 'free';
      v_kind := 'guest_free';
    elsif v_ref.rescheduled_at is not null and v_ref.rescheduled_at > v_e.created_at then
      -- R8: moved after this place was taken: free until the new start.
      v_policy := 'free';
      v_kind := 'guest_free';
      v_because := 'rescheduled';
      v_free_until := v_ref.start_at;
    elsif now() < v_ref.start_at - v_window then
      v_policy := 'free';
      v_kind := 'guest_free';
      v_free_until := v_ref.start_at - v_window;
    else
      v_policy := 'late';
      v_kind := 'guest_late';
    end if;
    v_refund := (v_m #>> array['if_cancelled', v_kind, 'refund_iqd'])::bigint;
    v_kept := (v_m #>> array['if_cancelled', v_kind, 'kept_iqd'])::bigint;
    if v_e.course_id is not null then
      -- C-23, R62: a free leave keeps the sessions already begun; a late
      -- leave also keeps every session starting inside the window (the
      -- guest's own next one among them).
      select count(*) filter (where (v_kind = 'guest_free' and x.start_at < now())
                                 or (v_kind = 'guest_late' and x.start_at < now() + v_window))::int,
             count(*) filter (where not ((v_kind = 'guest_free' and x.start_at < now())
                                         or (v_kind = 'guest_late' and x.start_at < now() + v_window)))::int
        into v_ks, v_rs
        from app.lesson_read_covered(v_e.id) x
       where x.status <> 'cancelled';
    end if;
  else
    v_can_cancel := false;
  end if;

  -- The court once the lesson is scheduled (the row's own session).
  if (v_row->>'lesson_status') in ('scheduled', 'completed') then
    select ct.name_en, ct.name_ar
      into v_court_en, v_court_ar
      from reservations r
      join courts ct on ct.id = r.court_id
     where r.lesson_id = coalesce(v_e.lesson_id,
                                  (select x.id from app.lesson_read_covered(v_e.id) x
                                    where x.start_at = (v_row->>'start_at')::timestamptz
                                    order by x.session_no limit 1))
       and r.kind = 'lesson'
     order by (r.status in ('pending', 'confirmed', 'arrived', 'completed')) desc, r.created_at desc
     limit 1;
  end if;

  if v_e.course_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'lesson_id', x.id,
             'session_no', x.session_no,
             'start_at', x.start_at,
             'end_at', x.end_at,
             'status', x.status,
             'rescheduled', coalesce(x.rescheduled_at > v_e.created_at, false),
             'attendance', (select a.status from lesson_attendance a
                             where a.lesson_id = x.id and a.enrolment_id = v_e.id))
             order by x.session_no), '[]'::jsonb)
      into v_sessions
      from app.lesson_read_covered(v_e.id) x;
  end if;

  return v_row || jsonb_build_object(
    'friend_names', to_jsonb(v_e.friend_names),
    'court_name_en', v_court_en,
    'court_name_ar', v_court_ar,
    'cancel', jsonb_build_object(
      'policy', v_policy,
      'free_until', v_free_until,
      'free_because', v_because,
      'refund_iqd', v_refund,
      'kept_iqd', v_kept,
      'counts_late', v_e.booked_by_kind = 'guest',
      'refund_sessions', v_rs,
      'kept_sessions', v_ks,
      'next_start_at', case when v_e.course_id is not null then v_ref.start_at end),
    'can', jsonb_build_object('cancel', v_can_cancel, 'pay', v_can_pay, 'confirm', false),
    'branch_phone', coalesce(v_vs.phone, v_v.phone),
    'timezone', coalesce(v_vs.timezone, v_v.timezone),
    'server_now', now())
  || case when v_sessions is null then '{}'::jsonb else jsonb_build_object('sessions', v_sessions) end;
end $my_lesson_0294$;

comment on function app.my_lesson(uuid) is
  '0283, 0294 (db.md §4.7.9, guest.md §4.3; X8, C-9, C-21, C-23, CD-2, R8, R62; DB-33). Guest: ENROLMENT_NOT_FOUND unless the enrolment names the caller in guest_id, and (0294) for a pending link whose place is no longer live (not held or booked, or its lesson, or a course place''s last covered session, has ended: lesson_link_confirm''s rule). The my_lessons row plus friend_names, court_name_* (once scheduled), sessions[{lesson_id, session_no, start_at, end_at, status, rescheduled, attendance}] (a course: the covered sessions), cancel {policy free | late | none, free_until, free_because (rescheduled | null), refund_iqd, kept_iqd (Money''s if_cancelled for the kind lesson_cancel_mine would apply), counts_late (a late cancel strikes: the guest booked it, CD-2), refund_sessions, kept_sessions, next_start_at (a course)}, can {cancel, pay (held, its hold still running, and, 0294, its first covered session not yet started), confirm}, branch_phone, timezone, server_now. A pending link answers the card only: no friend names, no court, can {cancel: false, pay: false, confirm: true}. Never another student.';

revoke all on function app.my_lesson(uuid) from public, anon;
grant execute on function app.my_lesson(uuid) to authenticated;

-- ===========================================================================
-- DB-32: app.desk_lessons (re-issued from 0283:5951)
-- ===========================================================================

create or replace function app.desk_lessons(p_venue_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $desk_lessons_0294$
declare
  v_venue   uuid;
  v_vs      venue_settings%rowtype;
  v_coaches jsonb;
  v_types   jsonb;
  v_lessons jsonb;
begin
  if not app.is_staff('cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_from';
  elsif p_to is null or p_to <= p_from or p_to - p_from > interval '7 days' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_to';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_vs from venue_settings where venue_id = v_venue;

  -- Active and paused coaches at the branch, accepted or not (R61).
  select coalesce(jsonb_agg(jsonb_build_object(
           'coach_id', co.id,
           'display_name_en', co.display_name_en,
           'display_name_ar', co.display_name_ar,
           'status', co.status,
           'photo_path', co.photo_path,
           'public_accepted', co.public_accepted_at is not null,
           'lesson_type_ids', coalesce((select jsonb_agg(t.id order by t.sort_order, t.id)
                                          from coach_lesson_types clt
                                          join lesson_types t on t.id = clt.lesson_type_id
                                         where clt.coach_id = co.id and t.venue_id = v_venue), '[]'::jsonb),
           'prices', coalesce((select jsonb_agg(jsonb_build_object(
                                        'lesson_type_id', t.id,
                                        'price_iqd', app.lesson_price_for(co.id, t.id))
                                        order by t.sort_order, t.id)
                                 from coach_lesson_types clt
                                 join lesson_types t on t.id = clt.lesson_type_id
                                where clt.coach_id = co.id and t.venue_id = v_venue), '[]'::jsonb))
           order by co.sort_order, co.display_name_en, co.id), '[]'::jsonb)
    into v_coaches
    from coaches co
   where co.status in ('active', 'paused')
     and exists (select 1 from coach_branches cb
                  where cb.coach_id = co.id and cb.venue_id = v_venue and cb.active);

  -- On sale only.
  select coalesce(jsonb_agg(jsonb_build_object(
           'lesson_type_id', t.id,
           'kind', t.kind,
           'name_en', t.name_en,
           'name_ar', t.name_ar,
           'duration_min', t.duration_min,
           'price_iqd', t.price_iqd,
           'max_places', t.max_places,
           'min_places', t.min_places,
           'cutoff_hours', t.cutoff_hours,
           'sessions_count', t.sessions_count)
           order by t.sort_order, t.name_en, t.id), '[]'::jsonb)
    into v_types
    from lesson_types t
   where t.venue_id = v_venue
     and t.is_active;

  -- The lessons starting in the window, held, scheduled or completed. The
  -- reservation is the live court row (kind lesson) or a held lesson's hold
  -- row. label: a private lesson's booker as recorded (R44). owing: booked
  -- desk places with something left to take (lesson_fee_remaining).
  select coalesce(jsonb_agg(x.j order by x.start_at, x.id), '[]'::jsonb)
    into v_lessons
    from (select l.id, l.start_at,
                 jsonb_build_object(
                   'lesson_id', l.id,
                   'reservation_id', r.id,
                   'court_id', r.court_id,
                   'court_name_en', ct.name_en,
                   'court_name_ar', ct.name_ar,
                   'kind', l.kind,
                   'status', l.status,
                   'start_at', l.start_at,
                   'end_at', l.end_at,
                   'hold_expires_at', l.hold_expires_at,
                   'booked_by_kind', l.booked_by_kind,
                   'coach_id', l.coach_id,
                   'coach_name_en', co.display_name_en,
                   'coach_name_ar', co.display_name_ar,
                   'lesson_type_id', l.lesson_type_id,
                   'type_name_en', t.name_en,
                   'type_name_ar', t.name_ar,
                   'course', case when c.id is null then null
                                  else jsonb_build_object('course_id', c.id, 'title_en', c.title_en,
                                                          'title_ar', c.title_ar, 'session_no', l.session_no,
                                                          'sessions_count', c.sessions_count) end,
                   'label', b.label,
                   'party_size', b.party_size,
                   'places_taken', case when c.id is not null then app.course_places_taken(c.id)
                                        else app.lesson_places_taken(l.id) end,
                   'max_places', l.max_places,
                   'min_places', l.min_places,
                   'cutoff_at', l.cutoff_at,
                   'enrolments', m.enrolments,
                   'owing', m.owing,
                   'owing_iqd', m.owing_iqd,
                   'paid_online', m.paid_online,
                   'awaiting', m.awaiting,
                   'paid_places', m.paid_places) as j
            from lessons l
            join coaches co on co.id = l.coach_id
            join lesson_types t on t.id = l.lesson_type_id
            left join courses c on c.id = l.course_id
            left join lateral (select r2.id, r2.court_id
                                 from reservations r2
                                where r2.lesson_id = l.id
                                order by (r2.status in ('pending', 'confirmed', 'arrived')) desc,
                                         (r2.kind = 'lesson') desc, r2.created_at desc
                                limit 1) r on true
            left join courts ct on ct.id = r.court_id
            left join lateral (select case when e.booked_by_kind = 'guest' then p.full_name
                                           else e.guest_name end as label,
                                      e.party_size
                                 from lesson_enrolments e
                                 left join profiles p on p.id = e.guest_id and e.booked_by_kind = 'guest'
                                where l.kind = 'private'
                                  and e.lesson_id = l.id
                                order by (e.status in ('held', 'booked')) desc, e.created_at desc
                                limit 1) b on true
            cross join lateral (
              select count(*) filter (where f.status in ('held', 'booked'))::int as enrolments,
                     count(*) filter (where f.status = 'booked' and f.payment_mode = 'desk' and f.take > 0)::int as owing,
                     coalesce(sum(f.take) filter (where f.status = 'booked' and f.payment_mode = 'desk'
                                                    and f.take > 0), 0)::bigint as owing_iqd,
                     -- 0294 (DB-32): booked places only, money net of
                     -- refunds; a held place is awaiting, never paid.
                     count(*) filter (where f.status = 'booked' and f.online > 0)::int as paid_online,
                     count(*) filter (where f.status = 'held')::int as awaiting,
                     count(*) filter (where f.status = 'booked' and (f.desk > 0 or f.online > 0))::int as paid_places
                from (select e.status, e.payment_mode,
                             case when e.status = 'booked' and e.payment_mode = 'desk'
                                  then coalesce(app.lesson_fee_remaining(e.id, null), 0) else 0 end as take,
                             coalesce((em.m->>'online_paid_iqd')::bigint, 0)
                               - coalesce((em.m->>'online_refunded_iqd')::bigint, 0) as online,
                             coalesce((em.m->>'desk_paid_iqd')::bigint, 0)
                               - coalesce((em.m->>'desk_refunded_iqd')::bigint, 0) as desk
                        from app.lesson_read_covering(l.id) e
                        cross join lateral (select case when e.status = 'booked'
                                                        then app.lesson_enrolment_money(e.id) end as m) em) f) m
           where l.venue_id = v_venue
             and l.status in ('held', 'scheduled', 'completed')
             and l.start_at >= p_from
             and l.start_at < p_to) x;

  return jsonb_build_object(
    'venue_id', v_venue,
    'coaching_enabled', coalesce(v_vs.coaching_enabled, false),
    'lesson_payment_mode', v_vs.lesson_payment_mode,
    'server_now', now(),
    'coaches', v_coaches,
    'lesson_types', v_types,
    'lessons', v_lessons);
end $desk_lessons_0294$;

comment on function app.desk_lessons(uuid, timestamptz, timestamptz) is
  '0283, 0294 (db.md §4.7.9, operator.md §5.6.1; X16, R20, R44, R51, R57, C-24; DB-32). Cashier, court desk, manager, owner (the role first): FORBIDDEN; INVALID_ARGUMENT (a NULL, p_to <= p_from, a window over 7 days); FORBIDDEN unless staff at the branch (p_venue_id, default the resolved branch). {venue_id, coaching_enabled, lesson_payment_mode, server_now, coaches[{coach_id, display_name_*, status, photo_path, public_accepted, lesson_type_ids, prices[{lesson_type_id, price_iqd}]}] (active and paused coaches at the branch, accepted or not), lesson_types[{lesson_type_id, kind, name_*, duration_min, price_iqd, max_places, min_places, cutoff_hours, sessions_count}] (on sale), lessons[{lesson_id, reservation_id, court_id, court_name_*, kind, status, start_at, end_at, hold_expires_at, booked_by_kind, coach_id, coach_name_*, lesson_type_id, type_name_*, course {course_id, title_*, session_no, sessions_count} | null, label (a private lesson''s booker as recorded, R44), party_size, places_taken, max_places, min_places, cutoff_at, enrolments (held or booked), owing, owing_iqd, paid_online, awaiting, paid_places}]} for the lessons held, scheduled or completed starting in the window. 0294 (DB-32): paid_online counts booked places with online money left after refunds; awaiting the held places; paid_places the booked places with desk or online money left after refunds. Answers whether coaching is on or off.';

revoke all on function app.desk_lessons(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function app.desk_lessons(uuid, timestamptz, timestamptz) to authenticated;

-- ===========================================================================
-- DB-31: app.desk_lesson_detail (re-issued from 0283:6115)
-- ===========================================================================

create or replace function app.desk_lesson_detail(p_lesson_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $desk_lesson_detail_0294$
declare
  v_l          lessons%rowtype;
  v_c          courses%rowtype;
  v_co         coaches%rowtype;
  v_t          lesson_types%rowtype;
  v_r          reservations%rowtype;
  v_court      courts%rowtype;
  v_desk       boolean;
  v_taken      int;
  v_max        int;
  v_course_end timestamptz;
  v_marks      boolean;
  v_day_open   boolean;
  v_created_by text;
  v_course     jsonb;
  v_enrolments jsonb;
  v_events     jsonb;
begin
  if not app.is_staff('cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_lesson_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_id';
  end if;
  select * into v_l from lessons where id = p_lesson_id;
  if not found or not (v_l.venue_id = any (app.visible_venue_ids())) then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_l.venue_id, 'cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  -- Who may act on the lesson itself (the desk writes are court_desk and up).
  v_desk := app.is_staff_at(v_l.venue_id, 'court_desk', 'manager', 'owner');

  if v_l.course_id is not null then
    select * into v_c from courses where id = v_l.course_id;
    select max(x.end_at) into v_course_end from lessons x where x.course_id = v_c.id;
  end if;
  select * into v_co from coaches where id = v_l.coach_id;
  select * into v_t from lesson_types where id = v_l.lesson_type_id;
  select * into v_r
    from reservations r
   where r.lesson_id = v_l.id
   order by (r.status in ('pending', 'confirmed', 'arrived')) desc, (r.kind = 'lesson') desc, r.created_at desc
   limit 1;
  if v_r.id is not null then
    select * into v_court from courts where id = v_r.court_id;
  end if;
  v_taken := case when v_c.id is not null then app.course_places_taken(v_c.id)
                  else app.lesson_places_taken(v_l.id) end;
  v_max := coalesce(v_c.max_places, v_l.max_places);
  v_marks := v_l.status in ('scheduled', 'completed')
             and now() >= v_l.start_at
             and now() < v_l.start_at + interval '24 hours';
  v_day_open := exists (select 1 from day_sessions d where d.venue_id = v_l.venue_id and d.status = 'open');
  v_created_by := case v_l.booked_by_kind
                    when 'staff' then (select s.display_name from staff s
                                        where s.id = coalesce(v_l.created_by_staff_id, v_c.created_by_staff_id))
                    when 'coach' then v_co.display_name_en
                    else (select p.full_name from profiles p where p.id = v_l.created_by_profile_id)
                  end;

  if v_c.id is not null then
    v_course := jsonb_build_object(
      'course_id', v_c.id,
      'title_en', v_c.title_en,
      'title_ar', v_c.title_ar,
      'status', v_c.status,
      'cancel_reason', v_c.cancel_reason,
      'session_no', v_l.session_no,
      'sessions_count', v_c.sessions_count,
      'signup_closes_at', v_c.signup_closes_at,
      'places_taken', v_taken,
      'max_places', v_c.max_places,
      'sessions', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'lesson_id', x.id,
                 'session_no', x.session_no,
                 'start_at', x.start_at,
                 'end_at', x.end_at,
                 'status', x.status,
                 'court_name_en', k.name_en,
                 'court_name_ar', k.name_ar)
                 order by x.session_no)
          from lessons x
          left join lateral (select ct.name_en, ct.name_ar
                               from reservations r
                               join courts ct on ct.id = r.court_id
                              where r.lesson_id = x.id
                              order by (r.status in ('pending', 'confirmed', 'arrived', 'completed')) desc,
                                       r.created_at desc
                              limit 1) k on true
         where x.course_id = v_c.id), '[]'::jsonb));
  end if;

  -- The places of this session, every status. Names (C-21, R44): a guest's
  -- own booking by the account; a coach- or desk-booked one as recorded on
  -- the enrolment (typed, or the picked customer's at booking), never
  -- re-read from a linked profile (typed true). customer_id only for a
  -- guest's own booking, a picked customer or a confirmed link: an
  -- unconfirmed match reads like a walk-in. Staff see phones (C-16 limits
  -- coaches, not staff).
  select coalesce(jsonb_agg(z.j order by z.created_at, z.id), '[]'::jsonb)
    into v_enrolments
    from (select e.id, e.created_at,
                 jsonb_build_object(
                   'enrolment_id', e.id,
                   'scope', case when e.course_id is not null then 'course' else 'lesson' end,
                   'status', e.status,
                   'cancel_kind', e.cancel_kind,
                   'cancelled_at', e.cancelled_at,
                   'customer_id', case when e.link_confirmed_at is not null then e.guest_id end,
                   'full_name', case when e.booked_by_kind = 'guest' then p.full_name else e.guest_name end,
                   'phone', case when e.booked_by_kind = 'guest' then p.phone else e.guest_phone end,
                   'typed', e.booked_by_kind <> 'guest',
                   'flags', case when e.link_confirmed_at is not null and e.guest_id is not null
                                 then app.customer_flags_json(e.guest_id) else '[]'::jsonb end,
                   'party_size', e.party_size,
                   'friend_names', to_jsonb(e.friend_names),
                   'first_session_no', e.first_session_no,
                   'sessions_covered', e.sessions_covered,
                   'booked_by_kind', e.booked_by_kind,
                   'booked_by_name', case e.booked_by_kind
                                       when 'staff' then (select s.display_name from staff s
                                                           where s.id = e.booked_by_staff_id)
                                       when 'coach' then v_co.display_name_en
                                       else p.full_name
                                     end,
                   'payment_mode', e.payment_mode,
                   'created_at', e.created_at,
                   'attendance', case when mm.att is null then null
                                      else jsonb_build_object(
                                             'status', mm.att,
                                             'marked_at', mm.att_at,
                                             'marked_by_name', case mm.att_kind
                                                                 when 'staff' then (select s.display_name from staff s
                                                                                     where s.id = mm.att_staff)
                                                                 else v_co.display_name_en
                                                               end) end,
                   'money', jsonb_build_object(
                     'price_iqd', e.price_iqd,
                     'owed_iqd', (mm.m->>'owed_iqd')::bigint,
                     'desk_paid_iqd', (mm.m->>'desk_paid_iqd')::bigint,
                     'online_paid_iqd', (mm.m->>'online_paid_iqd')::bigint,
                     'refunded_iqd', coalesce((mm.m->>'desk_refunded_iqd')::bigint, 0)
                                     + coalesce((mm.m->>'online_refunded_iqd')::bigint, 0),
                     'kept_iqd', (mm.m->>'kept_iqd')::bigint,
                     'refund_due_iqd', (mm.m->>'refund_due_iqd')::bigint,
                     -- 0294 (DB-31): the parts of refund_due that go back at
                     -- the desk and that no channel can return (R75).
                     'refund_due_desk_iqd', (mm.m->>'refund_due_desk_iqd')::bigint,
                     'refund_blocked_iqd', (mm.m->>'refund_blocked_iqd')::bigint,
                     'take_iqd', mm.take),
                   'can', jsonb_build_object(
                     'take_payment', e.status = 'booked' and e.payment_mode = 'desk'
                                     and coalesce(mm.take, 0) > 0 and v_l.status <> 'cancelled',
                     'cancel', v_desk and e.status in ('held', 'booked')
                               -- 0294 (DB-31): a private lesson's place until
                               -- the start (desk_cancel_enrolment, 0291 DB-07).
                               and now() < case when e.course_id is not null then v_course_end
                                                when v_l.kind = 'private' then v_l.start_at
                                                else v_l.end_at end,
                     'mark_attended', v_desk and v_marks and e.status = 'booked'
                                      and coalesce(mm.att, '') <> 'attended',
                     'mark_no_show', v_desk and v_marks and e.status = 'booked'
                                     and coalesce(mm.att, '') <> 'no_show',
                     'unmark', v_desk and v_marks and mm.att is not null)) as j
            from app.lesson_read_covering(v_l.id) e
            left join profiles p on p.id = e.guest_id and e.booked_by_kind = 'guest'
            cross join lateral (
              select app.lesson_enrolment_money(e.id) as m,
                     coalesce(app.lesson_fee_remaining(e.id, null), 0) as take,
                     a.status as att, a.marked_at as att_at, a.marked_by_kind as att_kind,
                     a.marked_by_staff_id as att_staff
                from (select 1) one
                left join lesson_attendance a on a.lesson_id = v_l.id and a.enrolment_id = e.id) mm) z;

  -- The last 50 events of the session (and of its course), newest first.
  select coalesce(jsonb_agg(z.j order by z.at desc, z.id desc), '[]'::jsonb)
    into v_events
    from (select ev.id, ev.at,
                 jsonb_build_object(
                   'at', ev.at,
                   'type', ev.type,
                   'actor', ev.actor,
                   'actor_name', case ev.actor
                                   when 'staff' then (select s.display_name from staff s
                                                       where s.id = ev.actor_staff_id)
                                   when 'coach' then (select x.display_name_en from coaches x
                                                       where x.profile_id = ev.actor_profile_id)
                                   when 'guest' then (select p.full_name from profiles p
                                                       where p.id = ev.actor_profile_id)
                                 end,
                   'enrolment_id', ev.enrolment_id,
                   'code', ev.code,
                   'late', case when jsonb_typeof(ev.data->'late') = 'boolean'
                                then (ev.data->>'late')::boolean else false end) as j
            from lesson_events ev
           where ev.lesson_id = v_l.id
              or (v_l.course_id is not null and ev.course_id = v_l.course_id and ev.lesson_id is null)
           order by ev.at desc, ev.id desc
           limit 50) z;

  return jsonb_build_object(
    'lesson', jsonb_build_object(
      'id', v_l.id,
      'venue_id', v_l.venue_id,
      'kind', v_l.kind,
      'status', v_l.status,
      'cancel_reason', v_l.cancel_reason,
      'start_at', v_l.start_at,
      'end_at', v_l.end_at,
      'duration_min', (extract(epoch from (v_l.end_at - v_l.start_at)) / 60)::int,
      'rescheduled_at', v_l.rescheduled_at,
      'booked_by_kind', v_l.booked_by_kind,
      'coach', jsonb_build_object('coach_id', v_co.id, 'display_name_en', v_co.display_name_en,
                                  'display_name_ar', v_co.display_name_ar, 'status', v_co.status),
      'lesson_type', jsonb_build_object('lesson_type_id', v_t.id, 'name_en', v_t.name_en, 'name_ar', v_t.name_ar),
      'course', v_course,
      'reservation_id', v_r.id,
      'reservation_status', v_r.status,
      'court_id', v_r.court_id,
      'court_name_en', v_court.name_en,
      'court_name_ar', v_court.name_ar,
      'price_iqd', coalesce(v_l.price_iqd, v_c.price_iqd),
      'court_share_iqd', v_l.court_share_iqd,
      'max_places', v_max,
      'min_places', coalesce(v_c.min_places, v_l.min_places),
      'places_taken', v_taken,
      'cutoff_at', v_l.cutoff_at,
      'hold_expires_at', v_l.hold_expires_at,
      'created_by_name', v_created_by,
      'server_now', now(),
      'day_open', v_day_open,
      'can', jsonb_build_object(
        'add_student', coalesce(v_desk and v_l.status = 'scheduled' and v_taken < v_max
                                and case v_l.kind
                                      when 'group' then now() < v_l.end_at
                                      when 'course' then v_c.status in ('open', 'running')
                                                         and now() < v_c.signup_closes_at
                                      else false
                                    end, false),
        'cancel', coalesce(v_desk and v_l.kind in ('private', 'group') and v_l.status in ('held', 'scheduled')
                           and now() < v_l.start_at, false),
        'cancel_course', coalesce(v_desk and v_l.kind = 'course' and v_c.status in ('open', 'running')
                                  and exists (select 1 from lessons x
                                               where x.course_id = v_c.id and x.status = 'scheduled'
                                                 and x.start_at > now()), false),
        'reschedule', coalesce(v_desk and v_l.status = 'scheduled' and now() < v_l.start_at, false),
        'move_court', coalesce(v_desk and v_l.status = 'scheduled' and now() < v_l.end_at, false))),
    'enrolments', v_enrolments,
    'events', v_events);
end $desk_lesson_detail_0294$;

comment on function app.desk_lesson_detail(uuid) is
  '0283, 0294 (db.md §4.7.9, operator.md §5.6.2; X17, C-21, R44, R57, R75; DB-31). Cashier, court desk, manager, owner (the role first): FORBIDDEN; INVALID_ARGUMENT (NULL); LESSON_NOT_FOUND (unknown, or outside app.visible_venue_ids()); VENUE_MISMATCH (visible but not staff there). {lesson {id, venue_id, kind, status, cancel_reason, start_at, end_at, duration_min, rescheduled_at, booked_by_kind, coach {coach_id, display_name_*, status}, lesson_type {lesson_type_id, name_*}, course {course_id, title_*, status, cancel_reason, session_no, sessions_count, signup_closes_at, places_taken, max_places, sessions[{lesson_id, session_no, start_at, end_at, status, court_name_*}]} | null, reservation_id, reservation_status, court_id, court_name_*, price_iqd, court_share_iqd, max_places, min_places, places_taken, cutoff_at, hold_expires_at, created_by_name, server_now, day_open, can {add_student, cancel, cancel_course, reschedule, move_court}}, enrolments[{enrolment_id, scope, status, cancel_kind, cancelled_at, customer_id, full_name, phone, typed, flags, party_size, friend_names, first_session_no, sessions_covered, booked_by_kind, booked_by_name, payment_mode, created_at, attendance {status, marked_at, marked_by_name} | null, money {price_iqd, owed_iqd, desk_paid_iqd, online_paid_iqd, refunded_iqd, kept_iqd, refund_due_iqd, refund_due_desk_iqd, refund_blocked_iqd (0294: the engine''s parts of refund_due owed at the desk and blocked), take_iqd (lesson_fee_remaining)}, can {take_payment, cancel (0294: a private lesson''s place until its start, a group place until the end, a course place until the course''s last end), mark_attended, mark_no_show, unmark}}], events[{at, type, actor, actor_name, enrolment_id, code, late}] (the last 50, newest first)}. A coach- or desk-booked student shows the name and phone recorded on the enrolment (typed true), never a linked profile''s; customer_id only for a guest''s own booking, a picked customer or a confirmed link (R44, C-21).';

revoke all on function app.desk_lesson_detail(uuid) from public, anon;
grant execute on function app.desk_lesson_detail(uuid) to authenticated;

-- ===========================================================================
-- DB-34: app.tournament_feasibility (re-issued from 0174:842)
-- ===========================================================================

create or replace function app.tournament_feasibility(p_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $tournament_feasibility_0294$
declare
  v_run  protocol_runs%rowtype;
  v_plan jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_run from protocol_runs where id = p_run_id;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) or v_run.kind <> 'tournament'
     or not app.is_staff_at(v_run.venue_id, 'manager', 'owner') then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_plan := case when jsonb_typeof(v_run.data->'ranges') = 'array' then v_run.data
                 else (select x.record
                         from protocol_submissions x
                         join protocol_run_steps s on s.id = x.run_step_id
                        where s.run_id = v_run.id and s.step_key = 'plan'
                          and x.withdrawn_at is null and x.superseded_at is null
                        order by x.submitted_at desc, x.id
                        limit 1) end;

  return jsonb_build_object('ranges', coalesce((
    select jsonb_agg(jsonb_build_object(
             'court_id',      c.id,
             'court_name_en', c.name_en,
             'court_name_ar', c.name_ar,
             'from',          g.e->'from',
             'to',            g.e->'to',
             'bookings',      (select count(*)
                                 from reservations r
                                where r.court_id = c.id and r.kind = 'booking'
                                  and r.status in ('pending', 'confirmed', 'arrived')
                                  and r.period && tstzrange((g.e->>'from')::timestamptz, (g.e->>'to')::timestamptz, '[)')),
             'guests',        (select count(distinct coalesce(r.guest_id::text, nullif(btrim(r.guest_phone), ''), r.id::text))
                                 from reservations r
                                where r.court_id = c.id and r.kind = 'booking'
                                  and r.status in ('pending', 'confirmed', 'arrived')
                                  and r.period && tstzrange((g.e->>'from')::timestamptz, (g.e->>'to')::timestamptz, '[)')),
             -- 0294 (DB-34): the lessons in the way (a lesson's live court
             -- row, or a held lesson's hold while live) and their students
             -- (distinct live enrolments: booked, or held while the hold
             -- runs or an online payment is open, as lesson_places_taken).
             'lessons',       (select count(distinct r.lesson_id)
                                 from reservations r
                                where r.court_id = c.id and r.lesson_id is not null
                                  and r.kind in ('lesson', 'hold')
                                  and r.status in ('pending', 'confirmed', 'arrived')
                                  and app.hold_is_live(r)
                                  and r.period && tstzrange((g.e->>'from')::timestamptz, (g.e->>'to')::timestamptz, '[)')),
             'students',      (select count(distinct e.id)
                                 from reservations r
                                 cross join lateral app.lesson_read_covering(r.lesson_id) e
                                where r.court_id = c.id and r.lesson_id is not null
                                  and r.kind in ('lesson', 'hold')
                                  and r.status in ('pending', 'confirmed', 'arrived')
                                  and app.hold_is_live(r)
                                  and r.period && tstzrange((g.e->>'from')::timestamptz, (g.e->>'to')::timestamptz, '[)')
                                  and (e.status = 'booked'
                                       or (e.status = 'held'
                                           and (e.hold_expires_at > now()
                                                or exists (select 1 from booking_payments bp
                                                            where bp.lesson_enrolment_id = e.id
                                                              and bp.purpose = 'lesson'
                                                              and bp.status in ('created', 'pending')
                                                              and bp.deadline_at > now() - interval '10 minutes'))))))
           order by g.o, x.o)
      from jsonb_array_elements(case when jsonb_typeof(v_plan->'ranges') = 'array'
                                     then v_plan->'ranges' else '[]'::jsonb end) with ordinality as g(e, o)
      cross join lateral jsonb_array_elements_text(g.e->'court_ids') with ordinality as x(id, o)
      join courts c on c.id::text = x.id), '[]'::jsonb));
end $tournament_feasibility_0294$;

comment on function app.tournament_feasibility(uuid) is
  'event_court_blocks (§2.11), 0294 (DB-34, coaching db.md §4.5.1). MGMT at the run''s venue: {ranges: [{court_id, court_name_en, court_name_ar, from, to, bookings, guests, lessons, students}]}, one row per court of each plan range, with the live bookings overlapping the window and the distinct guests holding them, and the lessons overlapping it (a live lesson court row, or a held lesson''s hold while app.hold_is_live) and the distinct live enrolments of those lessons (booked, or held while live). PROTOCOL_NOT_FOUND.';

revoke all on function app.tournament_feasibility(uuid) from public, anon;
grant execute on function app.tournament_feasibility(uuid) to authenticated;
