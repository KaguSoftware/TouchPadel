set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0283 lesson_booking, part a: the core writes — coaching, lane DB
-- (docs/design/coaching/db.md §4.7.1–§4.7.8; build contracts §1.1, §1.4,
-- §1.5, §1.6, §1.7, C-1, C-2, C-8, C-9, C-10, C-13, C-14, C-15, C-19, C-20,
-- C-21, C-23, C-24, C-25, CD-1, CD-2, CD-3, CD-9, CD-11, R6, R8, R9, R10,
-- R15, R16, R25, R26, R28, R30, R32, R33, R34, R38, R39, R44, R45, R47, R48,
-- R50, R56, R57, R61, R64, R66, R68, R69, R70, R73).
--
-- Part b (the reads: coaching_public, coach_profile, coach_slots,
-- lesson_offer, my_lessons, my_lesson, coach_schedule, coach_lesson,
-- desk_lessons, desk_lesson_detail, customer_lessons; and Guest's
-- lesson_notify, lesson_sync_reminders, the reminder triggers and the
-- lesson_events_notify trigger) is concatenated after this file into the one
-- 0283 migration. Nothing here calls lesson_notify or lesson_sync_reminders
-- (R40): every push follows a lesson_events row written here, and every
-- reminder follows row state.
--
--   1. Internals (revoked from public, anon, authenticated): lesson_guest,
--      the court set and pick (R34), places, the verified-phone match (R10,
--      R44), lesson_event, lesson_create_internal, lesson_court_release
--      (R25, R64), the three cancel internals (R28), and the shared checks
--      and answers the RPCs below use.
--   2. Guest writes (app.lesson_guest first): lesson_book_private,
--      lesson_join, course_join, lesson_cancel_mine, lesson_link_confirm.
--   3. Coach writes (app.coach_self first): coach_accept_public,
--      coach_book_private, coach_create_group, coach_create_course,
--      coach_add_student, coach_remove_student, coach_mark_attendance,
--      coach_cancel_lesson, coach_cancel_course, coach_reschedule_session.
--   4. Desk writes (court_desk, manager, owner; the role first, R57):
--      desk_book_lesson, desk_create_group, desk_create_course,
--      desk_add_student, desk_cancel_enrolment, desk_cancel_lesson,
--      desk_cancel_course, desk_reschedule_session, desk_move_lesson_court,
--      desk_mark_attendance.
--   5. set_coach_status (manager, owner; R16, R45): retiring cancels the
--      coach's upcoming lessons and courses as coach_retired and is never
--      refused.
--
-- Locks (db.md §2.3; the gate's ORDER puts coach_advisory after
-- match_money_advisory and before tabs):
--   B book    [lock_principal -> ladder settle -> hold cap] -> lock_coach ->
--             lesson_lock_branch_courts (every active court, id order) ->
--             match_expire_holds -> inserts
--   M move    lock_coach -> lesson_lock_branch_courts -> the lesson's court
--             row FOR UPDATE -> match_expire_holds -> writes (R33)
--   J join    [lock_principal -> ladder -> cap] -> lock_coach -> inserts
--   C cancel  lock_coach -> status-only reservation writes (a held lesson's
--             hold row only through lesson_court_release's SKIP LOCKED
--             statement, R25, R64) -> Money's lesson_refund_start
--   H         lock_coach (lesson_link_confirm)
-- No cancel, removal, mark or retirement takes a court lock or a waiting FOR
-- UPDATE on reservations (R6, R33, R64), and no strike is applied here: a
-- lesson_strikes row is recorded and hold_strikes_settle applies it later
-- (§1.4).
--
-- Functions of other coaching files called here (bound late, by name; no
-- lesson row can exist before this file, and the stack is reset with every
-- file):
--   0277 app.coaching_rules, app.lesson_terms_ok
--   0278 app.lock_coach
--   0280 app.match_expire_holds (re-issued: a lesson's hold is no orphan, R25)
--   0281 (Money) app.lesson_refund_start(uuid, text) returns int,
--        app.course_late_join_price(bigint, int, int) returns bigint,
--        app.lesson_enrolment_money(uuid) returns jsonb
--   0282 app.coach_self, app.coach_in_hours, app.coach_available,
--        app.lesson_on_grid, app.lesson_bookable, app.lesson_price_for,
--        app.coach_staff_scope
--   0286 app.lesson_strike_record(uuid, uuid, text) returns void

-- ===========================================================================
-- 1. Internals (db.md §4.7.2)
-- ===========================================================================

-- The coaching twin of app.match_guest (0260:245): the first statement of
-- every guest RPC. No ban, no gender. The online paths add the lessons-terms
-- check once the payment mode is known (R50, app.lesson_guest_payment).
create or replace function app.lesson_guest(p_act boolean) returns profiles
language plpgsql stable security definer set search_path = public as $lesson_guest_0283$
declare
  v_uid uuid := auth.uid();
  v_p   profiles%rowtype;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v_p from profiles where id = v_uid;
  if not found or v_p.deleted_at is not null then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  if coalesce(p_act, false) then
    if nullif(btrim(coalesce(v_p.phone, '')), '') is null then
      raise exception 'PHONE_REQUIRED' using errcode = 'P0001';
    end if;
    if v_p.terms_version is null then
      raise exception 'TERMS_REQUIRED' using errcode = 'P0001';
    end if;
  end if;
  return v_p;
end $lesson_guest_0283$;

comment on function app.lesson_guest(boolean) is
  '0283 (db.md §4.7.2). Internal: the first statement of every guest coaching RPC. AUTH_REQUIRED without a session; ACCOUNT_REQUIRED without a live profile; with p_act (booking, joining) PHONE_REQUIRED (no phone) and TERMS_REQUIRED (no accepted terms). Returns the caller''s profile.';

revoke all on function app.lesson_guest(boolean) from public, anon, authenticated;

-- R34: app.lock_court on every active court of the branch, in id order (the
-- match_lock_courts loop, 0260:112), returning the set it locked: a court is
-- only ever picked from it.
create or replace function app.lesson_lock_branch_courts(p_venue uuid) returns uuid[]
language plpgsql security definer set search_path = public as $lesson_lock_branch_courts_0283$
declare
  v_court record;
  v_ids   uuid[] := '{}'::uuid[];
begin
  for v_court in
    select c.id from courts c where c.venue_id = p_venue and c.is_active order by c.id
  loop
    perform app.lock_court(v_court.id);
    v_ids := v_ids || v_court.id;
  end loop;
  return v_ids;
end $lesson_lock_branch_courts_0283$;

comment on function app.lesson_lock_branch_courts(uuid) is
  '0283 (db.md §2.2; R34). Internal. app.lock_court on every active court of the branch in id order; returns the ids it locked. The booking and move bodies, and Money''s deposit_apply lesson arm, take it after the coach lock and pick a court only from the set.';

revoke all on function app.lesson_lock_branch_courts(uuid) from public, anon, authenticated;

-- R34: a court of p_locked, still active, with no live row of any kind over
-- the period (holds included) and not claimed by a waiting open match (R22
-- of open matches), by sort order then id; NULL when none. A pure read: the
-- caller holds those courts and has expired stale holds.
create or replace function app.lesson_pick_court(p_venue uuid, p_period tstzrange, p_locked uuid[]) returns uuid
language sql stable security definer set search_path = public as $lesson_pick_court_0283$
  select c.id
    from courts c
   where c.venue_id = p_venue
     and c.is_active
     and c.id = any (coalesce(p_locked, '{}'::uuid[]))
     and not exists (select 1 from reservations r
                      where r.court_id = c.id
                        and r.status in ('pending', 'confirmed', 'arrived')
                        and r.period && p_period)
     and not app.match_court_claimed(c.id, p_period)
   order by c.sort_order, c.id
   limit 1
$lesson_pick_court_0283$;

comment on function app.lesson_pick_court(uuid, tstzrange, uuid[]) is
  '0283 (db.md §4.7.2; R34). Internal, a pure read. The court a lesson takes: one of p_locked (the set the caller locked), still active at branch p_venue, with no live reservation of any kind over p_period and not claimed by a waiting open match (app.match_court_claimed), lowest sort_order then id; NULL when none. Courts'' duration_options are booking lengths and are not read. Money''s late-success re-pick passes its own locked set.';

revoke all on function app.lesson_pick_court(uuid, tstzrange, uuid[]) from public, anon, authenticated;

-- Places a lesson (or a course) has: booked, or held and still live (its
-- hold not lapsed, or an online payment open within the ten-minute grace of
-- expire_stale_holds, 0268:48-51). p_exclude_enrolment leaves one out (R29,
-- R70: Money's late success re-checks with itself excluded). The cut-off
-- counts booked places only (R38, the sweep).
create or replace function app.lesson_places_taken(p_lesson_id uuid, p_exclude_enrolment uuid default null)
returns int
language sql stable security definer set search_path = public as $lesson_places_taken_0283$
  select coalesce(sum(e.party_size), 0)::int
    from lesson_enrolments e
   where e.lesson_id = p_lesson_id
     and (p_exclude_enrolment is null or e.id <> p_exclude_enrolment)
     and (e.status = 'booked'
          or (e.status = 'held'
              and (e.hold_expires_at > now()
                   or exists (select 1 from booking_payments bp
                               where bp.lesson_enrolment_id = e.id
                                 and bp.purpose = 'lesson'
                                 and bp.status in ('created', 'pending')
                                 and bp.deadline_at > now() - interval '10 minutes'))))
$lesson_places_taken_0283$;

comment on function app.lesson_places_taken(uuid, uuid) is
  '0283 (db.md §4.7.2; R29, R70). Internal. The places of lesson p_lesson_id: sum(party_size) of its booked enrolments and its held ones still live (hold not lapsed, or an online payment open within ten minutes of its deadline), p_exclude_enrolment left out.';

revoke all on function app.lesson_places_taken(uuid, uuid) from public, anon, authenticated;

create or replace function app.course_places_taken(p_course_id uuid, p_exclude_enrolment uuid default null)
returns int
language sql stable security definer set search_path = public as $course_places_taken_0283$
  select coalesce(sum(e.party_size), 0)::int
    from lesson_enrolments e
   where e.course_id = p_course_id
     and (p_exclude_enrolment is null or e.id <> p_exclude_enrolment)
     and (e.status = 'booked'
          or (e.status = 'held'
              and (e.hold_expires_at > now()
                   or exists (select 1 from booking_payments bp
                               where bp.lesson_enrolment_id = e.id
                                 and bp.purpose = 'lesson'
                                 and bp.status in ('created', 'pending')
                                 and bp.deadline_at > now() - interval '10 minutes'))))
$course_places_taken_0283$;

comment on function app.course_places_taken(uuid, uuid) is
  '0283 (db.md §4.7.2; R29, R70). Internal. The places of course p_course_id, as app.lesson_places_taken counts a lesson''s: booked enrolments and live held ones, p_exclude_enrolment left out.';

revoke all on function app.course_places_taken(uuid, uuid) from public, anon, authenticated;

-- The BOOKED places only (db §5.2: an event's places_taken is the booked
-- places after the change), of a lesson or of a course.
create or replace function app.lesson_booked_places(p_lesson_id uuid, p_course_id uuid) returns int
language sql stable security definer set search_path = public as $lesson_booked_places_0283$
  select coalesce(sum(e.party_size), 0)::int
    from lesson_enrolments e
   where e.status = 'booked'
     and ((p_lesson_id is not null and e.lesson_id = p_lesson_id)
          or (p_course_id is not null and e.course_id = p_course_id))
$lesson_booked_places_0283$;

comment on function app.lesson_booked_places(uuid, uuid) is
  '0283 (db.md §5.2). Internal. sum(party_size) of the booked enrolments of a lesson (p_lesson_id) or of a course (p_course_id): the places_taken an event carries.';

revoke all on function app.lesson_booked_places(uuid, uuid) from public, anon, authenticated;

-- An event's {places_taken, places_total} (db §5.2): a group session's or a
-- course's booked places and max_places; '{}' for a private lesson.
create or replace function app.lesson_places_data(p_lesson_id uuid, p_course_id uuid) returns jsonb
language sql stable security definer set search_path = public as $lesson_places_data_0283$
  select case
    when p_course_id is not null then
      coalesce((select jsonb_build_object('places_taken', app.lesson_booked_places(null, co.id),
                                          'places_total', co.max_places)
                  from courses co where co.id = p_course_id), '{}'::jsonb)
    else
      coalesce((select case when l.kind = 'group'
                            then jsonb_build_object('places_taken', app.lesson_booked_places(l.id, null),
                                                    'places_total', l.max_places)
                            else '{}'::jsonb end
                  from lessons l where l.id = p_lesson_id), '{}'::jsonb)
  end
$lesson_places_data_0283$;

comment on function app.lesson_places_data(uuid, uuid) is
  '0283 (db.md §5.2). Internal. {places_taken, places_total} for an event of a group session or a course (booked places after the change, max_places); {} for a private lesson.';

revoke all on function app.lesson_places_data(uuid, uuid) from public, anon, authenticated;

-- The session a course-wide event or push names (db §5.2, guest.md §4.5.1):
-- the course's first session not yet started, live or just cancelled; with
-- none, its last.
create or replace function app.course_ref_lesson(p_course_id uuid) returns uuid
language sql stable security definer set search_path = public as $course_ref_lesson_0283$
  select coalesce(
    (select l.id from lessons l where l.course_id = p_course_id and l.start_at > now()
      order by l.session_no limit 1),
    (select l.id from lessons l where l.course_id = p_course_id order by l.session_no desc limit 1))
$course_ref_lesson_0283$;

comment on function app.course_ref_lesson(uuid) is
  '0283 (db.md §5.2). Internal. The session a course-wide event names in data.lesson_id: the course''s first session with start_at > now() (whatever its status), else its last.';

revoke all on function app.course_ref_lesson(uuid) from public, anon, authenticated;

-- R10, R44, C-21: a typed phone links an account only on an exact match of a
-- VERIFIED phone (auth.users.phone with phone_confirmed_at, the 0252
-- identity; never the typed profiles.phone), of a live profile, excluding
-- p_exclude_profile (the coach: no self-enrolment, R56). Exactly one match
-- -> its id; none or several -> NULL. The same work whatever the answer.
create or replace function app.lesson_link_by_phone(p_phone text, p_exclude_profile uuid) returns uuid
language sql stable security definer set search_path = public as $lesson_link_by_phone_0283$
  select case when count(*) = 1 then (array_agg(x.id))[1] end
    from (select u.id
            from auth.users u
            join profiles p on p.id = u.id and p.deleted_at is null
           where p_phone is not null
             and u.phone_confirmed_at is not null
             and app.phone_canon(u.phone) = app.phone_canon(p_phone)
             and u.id is distinct from p_exclude_profile
           limit 2) x
$lesson_link_by_phone_0283$;

comment on function app.lesson_link_by_phone(text, uuid) is
  '0283 (db.md §4.7.2; R10, R44, C-21). Internal. The live account whose VERIFIED phone (auth.users.phone with phone_confirmed_at) equals p_phone in canonical form, p_exclude_profile left out; NULL for no phone, no match or more than one. The link it makes is pending until that person confirms (lesson_link_confirm); no answer, timing class or refusal of a caller depends on it.';

revoke all on function app.lesson_link_by_phone(text, uuid) from public, anon, authenticated;

-- R42-style reason (§1.3): '<code>' or '<code>: <note>', the code one of six,
-- the note at most 200 characters. The code goes to lesson_events.code, the
-- whole reason only to the audit row.
create or replace function app.lesson_reason_code(p_reason text) returns text
language plpgsql immutable security definer set search_path = public as $lesson_reason_code_0283$
declare
  v_parts text[] := app.match_reason_parts(p_reason);
begin
  if v_parts[1] is null
     or v_parts[1] not in ('customer_request', 'coach_unavailable', 'court_needed', 'staff_error',
                           'duplicate', 'other')
     or char_length(coalesce(v_parts[2], '')) > 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reason';
  end if;
  return v_parts[1];
end $lesson_reason_code_0283$;

comment on function app.lesson_reason_code(text) is
  '0283 (db.md §4.7.1 rule 10). Internal. A coach or desk cancel reason, <code> or <code>: <note>: returns the code (customer_request | coach_unavailable | court_needed | staff_error | duplicate | other), or INVALID_ARGUMENT detail p_reason (an unknown code or a note over 200 characters).';

revoke all on function app.lesson_reason_code(text) from public, anon, authenticated;

-- One lesson_events row (db §5.2). The actor's ids follow the actor (the
-- lesson_events_actor CHECK): guest and coach carry a profile, staff a staff
-- id, system neither. Asserts the row's branch for zz_branch_guard.
create or replace function app.lesson_event(
  p_venue_id         uuid,
  p_lesson_id        uuid,
  p_course_id        uuid,
  p_enrolment_id     uuid,
  p_type             text,
  p_actor            text,
  p_actor_profile_id uuid default null,
  p_actor_staff_id   uuid default null,
  p_code             text default null,
  p_data             jsonb default '{}'::jsonb
) returns bigint
language plpgsql security definer set search_path = public as $lesson_event_0283$
declare
  v_id bigint;
begin
  perform set_config('app.venue_id', p_venue_id::text, true);
  insert into lesson_events (venue_id, lesson_id, course_id, enrolment_id, type, actor, actor_profile_id,
                             actor_staff_id, code, data)
  values (p_venue_id, p_lesson_id, p_course_id, p_enrolment_id, p_type, p_actor,
          case when p_actor in ('guest', 'coach') then p_actor_profile_id end,
          case when p_actor = 'staff' then p_actor_staff_id end,
          left(p_code, 40),
          coalesce(p_data, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $lesson_event_0283$;

comment on function app.lesson_event(uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, jsonb) is
  '0283 (db.md §4.7.2, §5.2). Internal. Appends one lesson_events row (the push fan-out''s input, R40): ids, times, counts, codes and flags only, never a name or a phone. Guest and coach actors carry their profile id, staff its staff id, system neither. Returns the event id.';

revoke all on function app.lesson_event(uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, jsonb)
  from public, anon, authenticated;

-- Creates one lesson and its court row. The caller holds lock_coach and the
-- courts p_locked, has run match_expire_holds over the period, and has
-- checked grid, hours and the coach. Snapshots (db.md §4.3.8): kind, court
-- share and places from the type (a course session: from its course);
-- price_iqd p_price_iqd (NULL for a course session); coach_share_bp from the
-- branch's rules (a course session: its course's); cut-off: group = start -
-- cutoff_hours, course = the course's, private NULL. A held lesson (a guest
-- paying online) holds its court with a kind 'hold' row naming the lesson
-- (R1); otherwise the row is kind 'lesson', confirmed. Always guest_id NULL,
-- guest_name 'Lesson', no money on the row (reservations_lesson_row). Writes
-- no event.
create or replace function app.lesson_create_internal(
  p_coach_id        uuid,
  p_lesson_type_id  uuid,
  p_start_at        timestamptz,
  p_course_id       uuid,
  p_session_no      smallint,
  p_price_iqd       bigint,
  p_held            boolean,
  p_booked_by_kind  text,
  p_profile_id      uuid,
  p_staff_id        uuid,
  p_idempotency_key text,
  p_locked          uuid[]
) returns lessons
language plpgsql security definer set search_path = public as $lesson_create_internal_0283$
declare
  v_t      lesson_types%rowtype;
  v_co     courses%rowtype;
  v_rules  jsonb;
  v_held   boolean := coalesce(p_held, false);
  v_end    timestamptz;
  v_period tstzrange;
  v_court  uuid;
  v_hold   timestamptz;
  v_l      lessons%rowtype;
begin
  select * into v_t from lesson_types where id = p_lesson_type_id;
  if v_t.id is null then
    raise exception 'LESSON_TYPE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_course_id is not null then
    select * into v_co from courses where id = p_course_id;
  end if;
  v_rules := app.coaching_rules(v_t.venue_id);
  v_end := p_start_at + make_interval(mins => v_t.duration_min);
  v_period := tstzrange(p_start_at, v_end, '[)');

  v_court := app.lesson_pick_court(v_t.venue_id, v_period, p_locked);
  if v_court is null then
    raise exception 'NO_COURT_FREE' using errcode = 'P0001';
  end if;
  if v_held then
    v_hold := now() + make_interval(secs => coalesce((v_rules->>'deposit_window_seconds')::int, 900));
  end if;

  perform set_config('app.venue_id', v_t.venue_id::text, true);
  begin
    insert into lessons (venue_id, coach_id, lesson_type_id, kind, course_id, session_no, start_at, end_at,
                         price_iqd, court_share_iqd, coach_share_bp, max_places, min_places, cutoff_at,
                         status, hold_expires_at, booked_by_kind, created_by_profile_id, created_by_staff_id,
                         idempotency_key)
    values (v_t.venue_id, p_coach_id, v_t.id, v_t.kind, p_course_id, p_session_no, p_start_at, v_end,
            case when v_t.kind = 'course' then null else p_price_iqd end,
            case when v_co.id is not null then v_co.court_share_iqd else v_t.court_share_iqd end,
            case when v_co.id is not null then v_co.coach_share_bp
                 else coalesce((v_rules->>'coach_share_bp')::int, 6000) end,
            case when v_co.id is not null then v_co.max_places else v_t.max_places end,
            case when v_co.id is not null then v_co.min_places else v_t.min_places end,
            case v_t.kind when 'private' then null
                          when 'group' then p_start_at - make_interval(hours => v_t.cutoff_hours)
                          else v_co.cutoff_at end,
            case when v_held then 'held' else 'scheduled' end,
            v_hold,
            p_booked_by_kind,
            case when p_booked_by_kind in ('guest', 'coach') then p_profile_id end,
            case when p_booked_by_kind = 'staff' then p_staff_id end,
            p_idempotency_key)
    returning * into v_l;
  exception when exclusion_violation then
    -- lessons_coach_no_overlap: the coach is teaching then, at some branch.
    raise exception 'COACH_BUSY' using errcode = 'P0001';
  end;

  begin
    insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_id, guest_name, source,
                              hold_expires_at, created_by_staff_id, lesson_id)
    values (v_t.venue_id, v_court,
            (case when v_held then 'hold' else 'lesson' end)::reservation_kind,
            (case when v_held then 'pending' else 'confirmed' end)::reservation_status,
            p_start_at, v_end, null, 'Lesson',
            (case when p_booked_by_kind = 'staff' then 'desk' else 'mobile' end)::reservation_source,
            v_hold,
            case when p_booked_by_kind = 'staff' then p_staff_id end,
            v_l.id);
  exception when exclusion_violation then
    -- reservations_no_overlap: the backstop of the pick.
    raise exception 'NO_COURT_FREE' using errcode = 'P0001';
  end;
  return v_l;
end $lesson_create_internal_0283$;

comment on function app.lesson_create_internal(uuid, uuid, timestamptz, uuid, smallint, bigint, boolean, text, uuid, uuid, text, uuid[]) is
  '0283 (db.md §4.7.2, §3.4). Internal. Inserts one lesson (held with hold_expires_at = now() + deposit_window_seconds when p_held, else scheduled) with its snapshots, and its court row on a court picked from p_locked (kind hold pending while held, else kind lesson confirmed; guest_id NULL, guest_name Lesson, no price). The caller holds lock_coach and the courts and has expired stale holds over the period. NO_COURT_FREE when no locked court is free (or on reservations_no_overlap); COACH_BUSY on lessons_coach_no_overlap. Writes no event.';

revoke all on function app.lesson_create_internal(uuid, uuid, timestamptz, uuid, smallint, bigint, boolean, text, uuid, uuid, text, uuid[])
  from public, anon, authenticated;

-- The only body of this lane that writes a lesson's court row on its way
-- out (R64). First R25's never-wait statement: a pending hold row naming the
-- lesson is expired whatever its hold_expires_at says, SKIP LOCKED (a hold
-- another transaction holds is being expired by it). Then, for cancelled or
-- completed, the kind 'lesson' row by a guarded status update (§3.4): no FOR
-- UPDATE, no court lock (R6, R33); it only leaves the live set. A cancelled
-- row carries the lesson's cancel_reason, so the caller writes the lesson's
-- status first. p_status 'expired' (Money's lesson_hold_expire) only expires
-- the hold row.
create or replace function app.lesson_court_release(p_lesson_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $lesson_court_release_0283$
declare
  v_l lessons%rowtype;
begin
  if p_status is null or p_status not in ('cancelled', 'completed', 'expired') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_status';
  end if;
  select * into v_l from lessons where id = p_lesson_id;
  if v_l.id is not null then
    perform set_config('app.venue_id', v_l.venue_id::text, true);
  end if;

  update reservations set status = 'expired'
   where id in (select r.id from reservations r
                 where r.lesson_id = p_lesson_id and r.kind = 'hold' and r.status = 'pending'
                 for update skip locked);

  if p_status = 'cancelled' then
    update reservations
       set status = 'cancelled',
           cancelled_at = coalesce(cancelled_at, now()),
           cancellation_reason = coalesce(v_l.cancel_reason, 'staff_cancel'),
           cancelled_by = (case when v_l.cancel_reason = 'guest_cancel' then 'guest' else 'staff' end)::cancellation_actor
     where lesson_id = p_lesson_id and kind = 'lesson' and status in ('pending', 'confirmed', 'arrived');
  elsif p_status = 'completed' then
    -- The mark_reservation convention (0262:3281-3289): completed rows carry a stamp.
    update reservations
       set status = 'completed', cancelled_at = coalesce(cancelled_at, now())
     where lesson_id = p_lesson_id and kind = 'lesson' and status in ('pending', 'confirmed', 'arrived');
  end if;
end $lesson_court_release_0283$;

comment on function app.lesson_court_release(uuid, text) is
  '0283 (db.md §2.3, §3.4, §4.7.2; R25, R33, R64). Internal. Ends a lesson''s court rows: the pending hold row naming the lesson is expired at once, whatever hold_expires_at says, through one UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) that never waits; then, for p_status cancelled or completed, the kind lesson row by a guarded status update (cancelled: cancellation_reason = the lesson''s cancel_reason, cancelled_by guest for guest_cancel else staff). No court lock, no waiting row lock. p_status expired touches the hold row only (Money''s lesson_hold_expire). The callers (cancel internals, the sweep, Money) write the lesson''s status first.';

revoke all on function app.lesson_court_release(uuid, text) from public, anon, authenticated;

-- Cancels one enrolment (db.md §4.7.2). The caller holds lock_coach. A live
-- private lesson goes with its enrolment (its reason from the kind). After
-- the status writes, Money's engine starts the online refund (R5, R28) for an
-- enrolment with an applied online row; Money derives the reason and the
-- amount (money.md §5.5: callers pass NULL). Events in Guest's order (guest.md
-- §4.3 item 2): enrolment_cancelled (code the kind; data reason, from,
-- refunds_started, places, lesson_id), then a cancelled private lesson's own
-- cancelled. Re-reads its row; {changed: false} when it is no longer live.
create or replace function app.enrolment_cancel_internal(p_enrolment_id uuid, p_kind text, p_actor text,
                                                         p_profile_id uuid, p_staff_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $enrolment_cancel_internal_0283$
declare
  v_e        lesson_enrolments%rowtype;
  v_l        lessons%rowtype;
  v_co       courses%rowtype;
  v_from     text;
  v_reason   text;
  v_lreason  text;
  v_lcancel  boolean := false;
  v_refunds  int := 0;
  v_data     jsonb;
begin
  if p_kind is null or p_kind not in ('guest_free', 'guest_late', 'coach', 'staff', 'under_filled',
                                      'account_deleted', 'course_cancelled') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_kind';
  end if;
  if p_actor is null or p_actor not in ('guest', 'coach', 'staff', 'system') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_actor';
  end if;

  select * into v_e from lesson_enrolments where id = p_enrolment_id;
  if v_e.id is null then
    raise exception 'ENROLMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_e.status not in ('held', 'booked') then
    return jsonb_build_object('enrolment_id', v_e.id, 'changed', false, 'status', v_e.status,
                              'cancel_kind', v_e.cancel_kind, 'lesson_cancelled', false, 'refunds_started', 0);
  end if;
  v_from := v_e.status;
  perform set_config('app.venue_id', v_e.venue_id::text, true);

  if v_e.lesson_id is not null then
    select * into v_l from lessons where id = v_e.lesson_id;
    if v_l.status in ('cancelled', 'expired') then
      -- The lesson carried this enrolment (lesson_cancel_internal).
      v_reason := v_l.cancel_reason;
    elsif v_l.kind = 'private' and v_l.status in ('held', 'scheduled') then
      v_lreason := case p_kind
                     when 'guest_free' then 'guest_cancel'
                     when 'guest_late' then 'guest_cancel'
                     when 'coach' then 'coach_cancel'
                     when 'staff' then 'staff_cancel'
                     when 'under_filled' then 'under_filled'
                     when 'account_deleted' then 'account_deleted'
                     else 'staff_cancel'
                   end;
      update lessons
         set status = 'cancelled', cancel_reason = v_lreason, cancelled_at = now(), hold_expires_at = null,
             updated_at = now()
       where id = v_l.id and status in ('held', 'scheduled');
      perform app.lesson_court_release(v_l.id, 'cancelled');
      v_lcancel := true;
    end if;
  elsif p_kind = 'course_cancelled' then
    select * into v_co from courses where id = v_e.course_id;
    v_reason := v_co.cancel_reason;
  end if;

  update lesson_enrolments
     set status = 'cancelled', cancel_kind = p_kind, cancelled_at = now(), hold_expires_at = null,
         updated_at = now()
   where id = v_e.id and status in ('held', 'booked');

  -- R28: after the status writes, for an enrolment with an applied online row.
  if exists (select 1 from booking_payments bp
              where bp.lesson_enrolment_id = v_e.id and bp.purpose = 'lesson'
                and bp.status in ('succeeded', 'refund_pending', 'refund_failed', 'refunded')) then
    v_refunds := coalesce(app.lesson_refund_start(v_e.id, null), 0);
  end if;

  v_data := jsonb_build_object('reason', v_reason,
                               'from', v_from,
                               'refunds_started', v_refunds,
                               'lesson_id', coalesce(v_e.lesson_id, app.course_ref_lesson(v_e.course_id)))
            || app.lesson_places_data(v_e.lesson_id, v_e.course_id);
  perform app.lesson_event(v_e.venue_id, v_e.lesson_id, v_e.course_id, v_e.id, 'enrolment_cancelled', p_actor,
                           p_profile_id, p_staff_id, p_kind, v_data);
  if v_lcancel then
    perform app.lesson_event(v_l.venue_id, v_l.id, null, null, 'cancelled', p_actor, p_profile_id, p_staff_id,
                             v_lreason, jsonb_build_object('enrolments', 1, 'via_course', false, 'lesson_id', v_l.id));
  end if;

  return jsonb_build_object('enrolment_id', v_e.id, 'changed', true, 'status', 'cancelled', 'cancel_kind', p_kind,
                            'lesson_cancelled', v_lcancel, 'refunds_started', v_refunds);
end $enrolment_cancel_internal_0283$;

comment on function app.enrolment_cancel_internal(uuid, text, text, uuid, uuid) is
  '0283 (db.md §4.7.2; R5, R28). Internal; the caller holds lock_coach. Cancels a held or booked enrolment with cancel_kind p_kind (a live private lesson goes with it: guest_cancel for the guest kinds, else coach_cancel, staff_cancel, under_filled or account_deleted), then calls Money''s lesson_refund_start(e, NULL) when it has an applied online row, then writes enrolment_cancelled (code p_kind; data reason = the lesson''s or course''s cancel_reason that carried it, from, refunds_started, places_taken, places_total, lesson_id) and a cancelled private lesson''s own cancelled event. No court lock; never a strike. Returns {enrolment_id, changed, status, cancel_kind, lesson_cancelled, refunds_started}; changed false when the enrolment was no longer live.';

revoke all on function app.enrolment_cancel_internal(uuid, text, text, uuid, uuid) from public, anon, authenticated;

-- Cancels one lesson (a private lesson, a group session, or a session of a
-- course being cancelled with its course). The caller holds lock_coach. The
-- lesson row, its court rows, every live enrolment (kind from the reason),
-- then Money's refund for every enrolment of the lesson cancelled before
-- (R28: a guest_late place of a session the venue now cancels), then the
-- lesson's own event: under_filled for under_filled, else cancelled.
create or replace function app.lesson_cancel_internal(p_lesson_id uuid, p_reason text, p_actor text,
                                                      p_profile_id uuid, p_staff_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $lesson_cancel_internal_0283$
declare
  v_l       lessons%rowtype;
  v_kind    text;
  v_e       record;
  v_r       jsonb;
  v_done    uuid[] := '{}'::uuid[];
  v_n       int := 0;
  v_refunds int := 0;
  v_taken   int;
begin
  if p_reason is null or p_reason not in ('guest_cancel', 'coach_cancel', 'staff_cancel', 'under_filled',
                                          'account_deleted', 'coach_retired') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reason';
  end if;
  if p_actor is null or p_actor not in ('guest', 'coach', 'staff', 'system') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_actor';
  end if;
  select * into v_l from lessons where id = p_lesson_id;
  if v_l.id is null then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_l.status not in ('held', 'scheduled') then
    return jsonb_build_object('lesson_id', v_l.id, 'changed', false, 'status', v_l.status, 'enrolments', 0,
                              'refunds_started', 0);
  end if;
  perform set_config('app.venue_id', v_l.venue_id::text, true);
  v_taken := app.lesson_booked_places(v_l.id, null);

  update lessons
     set status = 'cancelled', cancel_reason = p_reason, cancelled_at = now(), hold_expires_at = null,
         updated_at = now()
   where id = v_l.id and status in ('held', 'scheduled');
  perform app.lesson_court_release(v_l.id, 'cancelled');

  v_kind := case p_reason
              when 'coach_cancel' then 'coach'
              when 'coach_retired' then 'coach'
              when 'staff_cancel' then 'staff'
              when 'under_filled' then 'under_filled'
              when 'account_deleted' then 'account_deleted'
              else 'guest_free'
            end;
  for v_e in
    select e.id from lesson_enrolments e
     where e.lesson_id = v_l.id and e.status in ('held', 'booked')
     order by e.created_at, e.id
  loop
    v_r := app.enrolment_cancel_internal(v_e.id, v_kind, p_actor, p_profile_id, p_staff_id);
    v_done := v_done || v_e.id;
    v_n := v_n + 1;
    v_refunds := v_refunds + coalesce((v_r->>'refunds_started')::int, 0);
  end loop;

  -- R28: an enrolment already cancelled whose share the venue kept is
  -- refunded now that the venue cancels the session (Money decides how much).
  for v_e in
    select e.id from lesson_enrolments e
     where e.lesson_id = v_l.id and e.status = 'cancelled' and not (e.id = any (v_done))
       and exists (select 1 from booking_payments bp
                    where bp.lesson_enrolment_id = e.id and bp.purpose = 'lesson'
                      and bp.status in ('succeeded', 'refund_pending', 'refund_failed', 'refunded'))
     order by e.id
  loop
    v_refunds := v_refunds + coalesce(app.lesson_refund_start(v_e.id, null), 0);
  end loop;

  if p_reason = 'under_filled' then
    perform app.lesson_event(v_l.venue_id, v_l.id, v_l.course_id, null, 'under_filled', p_actor,
                             p_profile_id, p_staff_id, null,
                             jsonb_build_object('places_taken', v_taken, 'min_places', v_l.min_places,
                                                'late', false, 'lesson_id', v_l.id));
  else
    perform app.lesson_event(v_l.venue_id, v_l.id, v_l.course_id, null, 'cancelled', p_actor,
                             p_profile_id, p_staff_id, p_reason,
                             jsonb_build_object('enrolments', v_n, 'via_course', v_l.course_id is not null,
                                                'lesson_id', v_l.id));
  end if;
  return jsonb_build_object('lesson_id', v_l.id, 'changed', true, 'status', 'cancelled', 'enrolments', v_n,
                            'refunds_started', v_refunds);
end $lesson_cancel_internal_0283$;

comment on function app.lesson_cancel_internal(uuid, text, text, uuid, uuid) is
  '0283 (db.md §4.7.2; R5, R28). Internal; the caller holds lock_coach. Cancels a held or scheduled lesson with p_reason (guest_cancel | coach_cancel | staff_cancel | under_filled | account_deleted | coach_retired): the lesson row, its court rows (app.lesson_court_release), every live enrolment through app.enrolment_cancel_internal (coach_cancel and coach_retired -> coach, staff_cancel -> staff, under_filled, account_deleted), Money''s lesson_refund_start for every enrolment of the lesson cancelled earlier, then the lesson''s own event (under_filled {places_taken, min_places, late: false, lesson_id}, or cancelled code p_reason {enrolments, via_course, lesson_id}). No court lock. Returns {lesson_id, changed, status, enrolments, refunds_started}.';

revoke all on function app.lesson_cancel_internal(uuid, text, text, uuid, uuid) from public, anon, authenticated;

-- Cancels the rest of a course (C-19: never one session alone). The caller
-- holds lock_coach. Every session not yet started goes through
-- lesson_cancel_internal (a session in progress runs to its end); then the
-- course; then every live course enrolment (course_cancelled); then Money's
-- refund for course enrolments cancelled before; then the course's event
-- (Guest's order: the sessions, the enrolments, the course).
create or replace function app.course_cancel_internal(p_course_id uuid, p_reason text, p_actor text,
                                                      p_profile_id uuid, p_staff_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $course_cancel_internal_0283$
declare
  v_co       courses%rowtype;
  v_s        record;
  v_e        record;
  v_r        jsonb;
  v_done     uuid[] := '{}'::uuid[];
  v_sessions int := 0;
  v_n        int := 0;
  v_refunds  int := 0;
  v_taken    int;
begin
  if p_reason is null or p_reason not in ('coach_cancel', 'staff_cancel', 'under_filled', 'account_deleted',
                                          'coach_retired') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reason';
  end if;
  if p_actor is null or p_actor not in ('guest', 'coach', 'staff', 'system') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_actor';
  end if;
  select * into v_co from courses where id = p_course_id;
  if v_co.id is null then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_co.status not in ('open', 'running') then
    return jsonb_build_object('course_id', v_co.id, 'changed', false, 'status', v_co.status,
                              'sessions_cancelled', 0, 'enrolments', 0, 'refunds_started', 0);
  end if;
  perform set_config('app.venue_id', v_co.venue_id::text, true);
  v_taken := app.lesson_booked_places(null, v_co.id);

  for v_s in
    select l.id from lessons l
     where l.course_id = v_co.id and l.status in ('held', 'scheduled') and l.start_at > now()
     order by l.session_no
  loop
    perform app.lesson_cancel_internal(v_s.id, p_reason, p_actor, p_profile_id, p_staff_id);
    v_sessions := v_sessions + 1;
  end loop;

  update courses
     set status = 'cancelled', cancel_reason = p_reason, cancelled_at = now(), updated_at = now()
   where id = v_co.id and status in ('open', 'running');

  for v_e in
    select e.id from lesson_enrolments e
     where e.course_id = v_co.id and e.status in ('held', 'booked')
     order by e.created_at, e.id
  loop
    v_r := app.enrolment_cancel_internal(v_e.id, 'course_cancelled', p_actor, p_profile_id, p_staff_id);
    v_done := v_done || v_e.id;
    v_n := v_n + 1;
    v_refunds := v_refunds + coalesce((v_r->>'refunds_started')::int, 0);
  end loop;

  for v_e in
    select e.id from lesson_enrolments e
     where e.course_id = v_co.id and e.status = 'cancelled' and not (e.id = any (v_done))
       and exists (select 1 from booking_payments bp
                    where bp.lesson_enrolment_id = e.id and bp.purpose = 'lesson'
                      and bp.status in ('succeeded', 'refund_pending', 'refund_failed', 'refunded'))
     order by e.id
  loop
    v_refunds := v_refunds + coalesce(app.lesson_refund_start(v_e.id, null), 0);
  end loop;

  if p_reason = 'under_filled' then
    perform app.lesson_event(v_co.venue_id, null, v_co.id, null, 'under_filled', p_actor, p_profile_id, p_staff_id,
                             null, jsonb_build_object('places_taken', v_taken, 'min_places', v_co.min_places,
                                                      'late', false, 'lesson_id', app.course_ref_lesson(v_co.id)));
  else
    perform app.lesson_event(v_co.venue_id, null, v_co.id, null, 'cancelled', p_actor, p_profile_id, p_staff_id,
                             p_reason, jsonb_build_object('enrolments', v_n, 'via_course', false,
                                                          'sessions', v_sessions,
                                                          'lesson_id', app.course_ref_lesson(v_co.id)));
  end if;
  return jsonb_build_object('course_id', v_co.id, 'changed', true, 'status', 'cancelled',
                            'sessions_cancelled', v_sessions, 'enrolments', v_n, 'refunds_started', v_refunds);
end $course_cancel_internal_0283$;

comment on function app.course_cancel_internal(uuid, text, text, uuid, uuid) is
  '0283 (db.md §4.7.2; C-19, R5, R28). Internal; the caller holds lock_coach. Cancels the rest of an open or running course with p_reason (coach_cancel | staff_cancel | under_filled | account_deleted | coach_retired): every session not yet started through app.lesson_cancel_internal (a session in progress runs to its end), the course row, every live course enrolment as course_cancelled, Money''s lesson_refund_start for course enrolments cancelled earlier, then the course''s event (under_filled or cancelled; data.lesson_id = app.course_ref_lesson). Returns {course_id, changed, status, sessions_cancelled, enrolments, refunds_started}.';

revoke all on function app.course_cancel_internal(uuid, text, text, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared checks (db.md §4.7.1 rules 5, 6, 8)
-- ---------------------------------------------------------------------------

-- The hold ladder, exactly as hold_slot reads it (0269:119-136): the
-- caller's own lapsed holds and lesson strikes are settled first (D-4: one
-- ladder), then BOOKING_SUSPENDED or HOLD_COOLDOWN. The caller holds
-- lock_principal('hold_slot', guest) and no coach or court key (§1.4).
create or replace function app.lesson_guest_ladder(p_guest_id uuid) returns void
language plpgsql security definer set search_path = public as $lesson_guest_ladder_0283$
declare
  v_key      text;
  v_standing jsonb;
begin
  if (select ps.hold_strikes_since from platform_settings ps where ps.id) is null then
    return;
  end if;
  v_key := app.hold_standing_key(p_guest_id);
  perform app.hold_strikes_settle(app.hold_key_guests(v_key));
  select app.hold_standing_json(s) into v_standing from hold_standing s where s.key = v_key;
  if v_standing is not null then
    if v_standing->>'status' in ('banned', 'suspended') then
      raise exception 'BOOKING_SUSPENDED' using errcode = 'P0001',
        detail = coalesce(v_standing->>'blocked_until', ''),
        hint = 'this account may not book in the app';
    elsif v_standing->>'status' = 'cooldown' then
      raise exception 'HOLD_COOLDOWN' using errcode = 'P0001',
        detail = v_standing->>'blocked_until',
        hint = 'too many holds lapsed; try again later';
    end if;
  end if;
end $lesson_guest_ladder_0283$;

comment on function app.lesson_guest_ladder(uuid) is
  '0283 (db.md §4.7.3 step 4; D-4). Internal. When the hold ladder is on (platform_settings.hold_strikes_since), settles the guest''s lapsed holds and lesson strikes (app.hold_strikes_settle) and refuses BOOKING_SUSPENDED or HOLD_COOLDOWN exactly as hold_slot does. Called after lock_principal(''hold_slot'', guest), before any coach or court key.';

revoke all on function app.lesson_guest_ladder(uuid) from public, anon, authenticated;

-- Rule 8 (CD-1, R30, R50): the branch's payment mode, the lessons terms and
-- the per-guest hold cap, counted with court holds under the hold_slot key.
create or replace function app.lesson_guest_payment(p_guest profiles, p_venue uuid, p_payment_mode text)
returns void
language plpgsql stable security definer set search_path = public as $lesson_guest_payment_0283$
declare
  v_mode text;
  v_cap  int;
  v_live int;
begin
  v_mode := coalesce(app.coaching_rules(p_venue)->>'lesson_payment_mode', 'desk');
  if p_payment_mode = 'online' and v_mode = 'desk' then
    raise exception 'ONLINE_PAYMENT_OFF' using errcode = 'P0001';
  end if;
  if p_payment_mode = 'desk' and v_mode = 'online_required' then
    raise exception 'ONLINE_PAYMENT_REQUIRED' using errcode = 'P0001';
  end if;
  if p_payment_mode = 'online' then
    -- C-26, R50: online lesson money needs accepted terms with the lessons section.
    if not app.lesson_terms_ok(p_guest.terms_version) then
      raise exception 'TERMS_REQUIRED' using errcode = 'P0001', detail = 'lessons';
    end if;
    -- R30: live court holds plus live held enrolments against one cap.
    select ps.max_live_holds_per_guest into v_cap from platform_settings ps where ps.id;
    if coalesce(v_cap, 0) > 0 then
      select (select count(*) from reservations r
               where r.guest_id = p_guest.id and r.kind = 'hold' and r.status = 'pending'
                 and r.hold_expires_at > now())
           + (select count(*) from lesson_enrolments e
               where e.guest_id = p_guest.id and e.status = 'held' and e.hold_expires_at > now())
        into v_live;
      if v_live >= v_cap then
        raise exception 'HOLD_QUOTA_EXCEEDED' using errcode = 'P0001', detail = v_cap::text,
          hint = 'pay for or cancel a held booking first';
      end if;
    end if;
  end if;
end $lesson_guest_payment_0283$;

comment on function app.lesson_guest_payment(profiles, uuid, text) is
  '0283 (db.md §4.7.1 rule 8; CD-1, R30, R50). Internal. A guest''s payment mode against the branch''s lesson_payment_mode: online at a desk-only branch ONLINE_PAYMENT_OFF; desk at an online_required branch ONLINE_PAYMENT_REQUIRED. Online also needs app.lesson_terms_ok (TERMS_REQUIRED detail lessons) and stays under platform_settings.max_live_holds_per_guest counting live court holds plus live held enrolments (HOLD_QUOTA_EXCEEDED detail the cap).';

revoke all on function app.lesson_guest_payment(profiles, uuid, text) from public, anon, authenticated;

-- Rule 6 for coach and desk paths: SLOT_NOT_ON_GRID, SLOT_IN_PAST, then
-- CLOSED_DATE / OUTSIDE_HOURS (NO_COURT_FREE for a branch with no active
-- court), each with p_detail (a course's 1-based session number).
create or replace function app.lesson_check_start(p_venue uuid, p_start_at timestamptz, p_end_at timestamptz,
                                                  p_detail text default null)
returns void
language plpgsql stable security definer set search_path = public as $lesson_check_start_0283$
declare
  v_bk text;
begin
  if not app.lesson_on_grid(p_start_at, p_venue) then
    raise exception 'SLOT_NOT_ON_GRID' using errcode = 'P0001', detail = coalesce(p_detail, '');
  end if;
  if p_start_at <= now() then
    raise exception 'SLOT_IN_PAST' using errcode = 'P0001', detail = coalesce(p_detail, '');
  end if;
  v_bk := app.lesson_bookable(p_venue, p_start_at, p_end_at);
  if v_bk = 'CLOSED_DATE' then
    raise exception 'CLOSED_DATE' using errcode = 'P0001', detail = coalesce(p_detail, '');
  elsif v_bk = 'OUTSIDE_HOURS' then
    raise exception 'OUTSIDE_HOURS' using errcode = 'P0001', detail = coalesce(p_detail, '');
  elsif v_bk = 'NO_COURT_FREE' then
    raise exception 'NO_COURT_FREE' using errcode = 'P0001', detail = coalesce(p_detail, '');
  end if;
end $lesson_check_start_0283$;

comment on function app.lesson_check_start(uuid, timestamptz, timestamptz, text) is
  '0283 (db.md §4.7.1 rule 6; C-20, R9). Internal. A coach or desk lesson start: SLOT_NOT_ON_GRID (app.lesson_on_grid), SLOT_IN_PAST, CLOSED_DATE / OUTSIDE_HOURS / NO_COURT_FREE (app.lesson_bookable), each with p_detail.';

revoke all on function app.lesson_check_start(uuid, timestamptz, timestamptz, text) from public, anon, authenticated;

-- Under the coach lock: COACH_BUSY when another held or scheduled lesson of
-- the coach (p_except left out: a reschedule) overlaps the period, else
-- COACH_UNAVAILABLE when the coach is not in hours there.
create or replace function app.lesson_coach_free(p_coach_id uuid, p_venue uuid, p_period tstzrange, p_except uuid,
                                                 p_detail text default null)
returns void
language plpgsql stable security definer set search_path = public as $lesson_coach_free_0283$
begin
  if exists (select 1 from lessons l
              where l.coach_id = p_coach_id and l.status in ('held', 'scheduled')
                and l.period && p_period and l.id is distinct from p_except) then
    raise exception 'COACH_BUSY' using errcode = 'P0001', detail = coalesce(p_detail, '');
  end if;
  if not app.coach_in_hours(p_coach_id, p_venue, p_period) then
    raise exception 'COACH_UNAVAILABLE' using errcode = 'P0001', detail = coalesce(p_detail, '');
  end if;
end $lesson_coach_free_0283$;

comment on function app.lesson_coach_free(uuid, uuid, tstzrange, uuid, text) is
  '0283 (db.md §4.6.2, §4.7). Internal, read under the coach lock: COACH_BUSY when another held or scheduled lesson of the coach (at any branch, p_except left out) overlaps p_period; COACH_UNAVAILABLE when app.coach_in_hours is false. p_detail on both.';

revoke all on function app.lesson_coach_free(uuid, uuid, tstzrange, uuid, text) from public, anon, authenticated;

-- What joining a course costs now (C-15): the course's first session not yet
-- started is the first covered one; the price is the whole course before
-- session 1, else Money's course_late_join_price over the sessions left (the
-- iqd_split shares, R2, R60). NULL when no session is left to start.
create or replace function app.lesson_course_offer(p_course_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $lesson_course_offer_0283$
declare
  v_co courses%rowtype;
  v_l  lessons%rowtype;
begin
  select * into v_co from courses where id = p_course_id;
  if v_co.id is null then
    return null;
  end if;
  select * into v_l from lessons l
   where l.course_id = v_co.id and l.status = 'scheduled' and l.start_at > now()
   order by l.session_no limit 1;
  if v_l.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'first_session_no', v_l.session_no,
    'sessions_covered', v_co.sessions_count - v_l.session_no + 1,
    'price_iqd', case when v_l.session_no = 1 then v_co.price_iqd::bigint
                      else app.course_late_join_price(v_co.price_iqd::bigint, v_co.sessions_count::int,
                                                      v_l.session_no::int) end,
    'full_price_iqd', v_co.price_iqd,
    'first_lesson_id', v_l.id,
    'first_start_at', v_l.start_at,
    'first_end_at', v_l.end_at);
end $lesson_course_offer_0283$;

comment on function app.lesson_course_offer(uuid) is
  '0283 (db.md §4.7.3; C-15, R2, R60). Internal. A course place bought now: {first_session_no (the first session not yet started), sessions_covered (from it to the last), price_iqd (the whole course before session 1, else app.course_late_join_price), full_price_iqd, first_lesson_id, first_start_at, first_end_at}; NULL when no session is left to start.';

revoke all on function app.lesson_course_offer(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Answers (shapes per R41, R81: COACHING_SHAPES in packages/core)
-- ---------------------------------------------------------------------------

-- X5: the guest's book and join answer. status is the ENROLMENT's. No court
-- id, no name.
create or replace function app.lesson_booking_answer(p_enrolment_id uuid, p_duplicate boolean) returns jsonb
language sql stable security definer set search_path = public as $lesson_booking_answer_0283$
  select jsonb_build_object(
           'duplicate', coalesce(p_duplicate, false),
           'enrolment_id', e.id,
           'lesson_id', e.lesson_id,
           'course_id', e.course_id,
           'status', e.status,
           'hold_expires_at', e.hold_expires_at,
           'payment_mode', e.payment_mode,
           'price_iqd', e.price_iqd,
           'party_size', e.party_size,
           'first_session_no', e.first_session_no,
           'sessions_covered', e.sessions_covered,
           'start_at', s.start_at,
           'end_at', s.end_at,
           'court_name_en', ct.name_en,
           'court_name_ar', ct.name_ar,
           'venue_id', e.venue_id,
           'places_left', case
                            when e.course_id is not null then
                              greatest((select co.max_places from courses co where co.id = e.course_id)
                                       - app.course_places_taken(e.course_id), 0)
                            when s.kind = 'group' then greatest(s.max_places - app.lesson_places_taken(s.id), 0)
                          end)
    from lesson_enrolments e
    left join lateral (select l.* from lessons l
                        where l.id = e.lesson_id
                           or (e.lesson_id is null and l.course_id = e.course_id
                               and l.session_no = e.first_session_no)
                        limit 1) s on true
    left join lateral (select c.name_en, c.name_ar
                         from reservations r join courts c on c.id = r.court_id
                        where r.lesson_id = s.id and r.status in ('pending', 'confirmed', 'arrived')
                        limit 1) ct on true
   where e.id = p_enrolment_id
$lesson_booking_answer_0283$;

comment on function app.lesson_booking_answer(uuid, boolean) is
  '0283 (X5, R41). Internal. The guest''s book or join answer for one enrolment: {duplicate, enrolment_id, lesson_id, course_id, status (the enrolment''s), hold_expires_at, payment_mode, price_iqd, party_size, first_session_no, sessions_covered, start_at, end_at (the lesson, or the first covered session), court_name_en, court_name_ar, venue_id, places_left (group and course)}. No court id, no person.';

revoke all on function app.lesson_booking_answer(uuid, boolean) from public, anon, authenticated;

-- Rule 7 for guests: the key of an enrolment the caller booked for the same
-- target answers it again; anyone else's, or another target's, is
-- IDEMPOTENCY_CONFLICT. NULL when the key is new.
create or replace function app.lesson_guest_replay(p_key text, p_guest_id uuid, p_lesson_id uuid, p_course_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $lesson_guest_replay_0283$
declare
  v_e lesson_enrolments%rowtype;
begin
  select * into v_e from lesson_enrolments where idempotency_key = p_key;
  if v_e.id is null then
    return null;
  end if;
  if v_e.booked_by_kind <> 'guest' or v_e.booked_by_profile_id is distinct from p_guest_id
     or (p_lesson_id is not null and v_e.lesson_id is distinct from p_lesson_id)
     or (p_course_id is not null and v_e.course_id is distinct from p_course_id) then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
      hint = 'that key belongs to another booking';
  end if;
  return app.lesson_booking_answer(v_e.id, true);
end $lesson_guest_replay_0283$;

comment on function app.lesson_guest_replay(text, uuid, uuid, uuid) is
  '0283 (db.md §4.7.1 rule 7). Internal. NULL for a new key; the duplicate answer (app.lesson_booking_answer) for a key of an enrolment the same guest booked for the same lesson or course; IDEMPOTENCY_CONFLICT otherwise (the 0269 rule).';

revoke all on function app.lesson_guest_replay(text, uuid, uuid, uuid) from public, anon, authenticated;

-- A coach- or desk-booked private lesson (coach_book_private, X29
-- desk_book_lesson): the same keys whether or not a typed phone matched.
create or replace function app.lesson_private_answer(p_enrolment_id uuid, p_duplicate boolean) returns jsonb
language sql stable security definer set search_path = public as $lesson_private_answer_0283$
  select jsonb_build_object(
           'duplicate', coalesce(p_duplicate, false),
           'lesson_id', l.id,
           'enrolment_id', e.id,
           'status', l.status,
           'court_id', ct.court_id,
           'court_name_en', ct.name_en,
           'court_name_ar', ct.name_ar,
           'start_at', l.start_at,
           'end_at', l.end_at,
           'price_iqd', e.price_iqd,
           'party_size', e.party_size,
           'venue_id', l.venue_id)
    from lesson_enrolments e
    join lessons l on l.id = e.lesson_id
    left join lateral (select r.court_id, c.name_en, c.name_ar
                         from reservations r join courts c on c.id = r.court_id
                        where r.lesson_id = l.id and r.status in ('pending', 'confirmed', 'arrived')
                        limit 1) ct on true
   where e.id = p_enrolment_id
$lesson_private_answer_0283$;

comment on function app.lesson_private_answer(uuid, boolean) is
  '0283 (X29, R10, R41). Internal. A coach- or desk-booked private lesson: {duplicate, lesson_id, enrolment_id, status, court_id, court_name_en, court_name_ar, start_at, end_at, price_iqd, party_size, venue_id}; never whether a typed phone matched an account.';

revoke all on function app.lesson_private_answer(uuid, boolean) from public, anon, authenticated;

create or replace function app.lesson_group_answer(p_lesson_id uuid, p_duplicate boolean) returns jsonb
language sql stable security definer set search_path = public as $lesson_group_answer_0283$
  select jsonb_build_object(
           'duplicate', coalesce(p_duplicate, false),
           'lesson_id', l.id,
           'status', l.status,
           'start_at', l.start_at,
           'end_at', l.end_at,
           'cutoff_at', l.cutoff_at,
           'court_id', ct.court_id,
           'court_name_en', ct.name_en,
           'court_name_ar', ct.name_ar,
           'price_iqd', l.price_iqd,
           'max_places', l.max_places,
           'min_places', l.min_places,
           'venue_id', l.venue_id)
    from lessons l
    left join lateral (select r.court_id, c.name_en, c.name_ar
                         from reservations r join courts c on c.id = r.court_id
                        where r.lesson_id = l.id and r.status in ('pending', 'confirmed', 'arrived')
                        limit 1) ct on true
   where l.id = p_lesson_id
$lesson_group_answer_0283$;

comment on function app.lesson_group_answer(uuid, boolean) is
  '0283 (db.md §4.7.4, R41). Internal. A created group session: {duplicate, lesson_id, status, start_at, end_at, cutoff_at, court_id, court_name_en, court_name_ar, price_iqd, max_places, min_places, venue_id}.';

revoke all on function app.lesson_group_answer(uuid, boolean) from public, anon, authenticated;

-- X13: both lesson_ids and sessions.
create or replace function app.lesson_course_answer(p_course_id uuid, p_duplicate boolean) returns jsonb
language sql stable security definer set search_path = public as $lesson_course_answer_0283$
  select jsonb_build_object(
           'duplicate', coalesce(p_duplicate, false),
           'course_id', co.id,
           'status', co.status,
           'lesson_ids', coalesce((select jsonb_agg(l.id order by l.session_no)
                                     from lessons l where l.course_id = co.id), '[]'::jsonb),
           'sessions', coalesce((select jsonb_agg(jsonb_build_object(
                                          'session_no', l.session_no,
                                          'lesson_id', l.id,
                                          'start_at', l.start_at,
                                          'end_at', l.end_at,
                                          'court_id', ct.court_id,
                                          'court_name_en', ct.name_en,
                                          'court_name_ar', ct.name_ar)
                                        order by l.session_no)
                                   from lessons l
                                   left join lateral (select r.court_id, c.name_en, c.name_ar
                                                        from reservations r join courts c on c.id = r.court_id
                                                       where r.lesson_id = l.id
                                                         and r.status in ('pending', 'confirmed', 'arrived')
                                                       limit 1) ct on true
                                  where l.course_id = co.id), '[]'::jsonb),
           'price_iqd', co.price_iqd,
           'cutoff_at', co.cutoff_at,
           'signup_closes_at', co.signup_closes_at,
           'venue_id', co.venue_id)
    from courses co
   where co.id = p_course_id
$lesson_course_answer_0283$;

comment on function app.lesson_course_answer(uuid, boolean) is
  '0283 (X13, R41). Internal. A created course: {duplicate, course_id, status, lesson_ids, sessions: [{session_no, lesson_id, start_at, end_at, court_id, court_name_en, court_name_ar}], price_iqd, cutoff_at, signup_closes_at, venue_id}.';

revoke all on function app.lesson_course_answer(uuid, boolean) from public, anon, authenticated;

-- ===========================================================================
-- 2. Guest writes (db.md §4.7.3, §4.7.5, §4.7.7)
-- ===========================================================================

-- C-2: a private lesson, booked instantly. Level B with the guest's
-- principal lock (R30, R69), the ladder, then the coach and every court of
-- the branch.
create or replace function app.lesson_book_private(
  p_coach_id           uuid,
  p_lesson_type_id     uuid,
  p_start_at           timestamptz,
  p_party_size         int,
  p_friend_names       text[],
  p_payment_mode       text,
  p_expected_price_iqd bigint,
  p_idempotency_key    text
) returns jsonb
language plpgsql security definer set search_path = public as $lesson_book_private_0283$
declare
  v_p       profiles%rowtype;
  v_friends text[] := '{}'::text[];
  v_f       text;
  v_answer  jsonb;
  v_t       lesson_types%rowtype;
  v_c       coaches%rowtype;
  v_venue   uuid;
  v_rules   jsonb;
  v_end     timestamptz;
  v_period  tstzrange;
  v_bk      text;
  v_horizon int;
  v_price   bigint;
  v_online  boolean;
  v_locked  uuid[];
  v_l       lessons%rowtype;
  v_e       lesson_enrolments%rowtype;
  v_pass    int;
begin
  -- 1.
  v_p := app.lesson_guest(true);

  -- 2.
  if p_coach_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_coach_id';
  end if;
  if p_lesson_type_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_type_id';
  end if;
  if p_start_at is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_start_at';
  end if;
  if p_party_size is null or p_party_size < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_party_size';
  end if;
  if p_payment_mode is null or p_payment_mode not in ('desk', 'online') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_payment_mode';
  end if;
  if p_expected_price_iqd is null or p_expected_price_iqd < 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_expected_price_iqd';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;
  foreach v_f in array coalesce(p_friend_names, '{}'::text[]) loop
    v_f := app.safe_line(v_f);
    if v_f is null or char_length(v_f) not between 1 and 40 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_friend_names';
    end if;
    v_friends := v_friends || v_f;
  end loop;
  if cardinality(v_friends) > least(p_party_size - 1, 3) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_friend_names';
  end if;
  v_online := p_payment_mode = 'online';

  -- 3. One booking at a time per guest (R30, R69); then the replay.
  perform app.lock_principal('hold_slot', v_p.id);
  v_answer := app.lesson_guest_replay(p_idempotency_key, v_p.id, null, null);
  if v_answer is not null then
    return v_answer;
  end if;

  -- 4.
  perform app.lesson_guest_ladder(v_p.id);

  -- 5-11 once unlocked, then again under the coach lock.
  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform app.lock_coach(p_coach_id);
      v_answer := app.lesson_guest_replay(p_idempotency_key, v_p.id, null, null);
      if v_answer is not null then
        return v_answer;
      end if;
    end if;

    -- 5.
    select * into v_t from lesson_types where id = p_lesson_type_id;
    if v_t.id is null or v_t.kind <> 'private' then
      raise exception 'LESSON_TYPE_NOT_FOUND' using errcode = 'P0001';
    end if;
    select * into v_c from coaches where id = p_coach_id;
    -- R61: a coach who has not accepted going public is invisible to guests.
    if v_c.id is null or v_c.status = 'retired' or v_c.public_accepted_at is null then
      raise exception 'COACH_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_venue := v_t.venue_id;
    if not (v_venue = any (app.open_venue_ids()))
       or not exists (select 1 from coach_branches b
                       where b.coach_id = v_c.id and b.venue_id = v_venue and b.active) then
      raise exception 'COACH_NOT_AT_BRANCH' using errcode = 'P0001';
    end if;
    v_rules := app.coaching_rules(v_venue);
    if not coalesce((v_rules->>'coaching_enabled')::boolean, false) then
      raise exception 'COACHING_OFF' using errcode = 'P0001';
    end if;
    if v_c.status = 'paused' then
      raise exception 'COACH_INACTIVE' using errcode = 'P0001';
    end if;
    if not v_t.is_active then
      raise exception 'LESSON_TYPE_INACTIVE' using errcode = 'P0001';
    end if;
    if not exists (select 1 from coach_lesson_types ct
                    where ct.coach_id = v_c.id and ct.lesson_type_id = v_t.id) then
      raise exception 'LESSON_TYPE_NOT_OFFERED' using errcode = 'P0001';
    end if;
    -- C-24, R56: no self-enrolment.
    if v_c.profile_id = v_p.id then
      raise exception 'ALREADY_ENROLLED' using errcode = 'P0001', detail = 'coach';
    end if;

    -- 6.
    if p_party_size > v_t.max_places then
      raise exception 'PARTY_TOO_LARGE' using errcode = 'P0001', detail = v_t.max_places::text;
    end if;

    -- 7.
    perform app.lesson_guest_payment(v_p, v_venue, p_payment_mode);

    -- 8.
    v_end := p_start_at + make_interval(mins => v_t.duration_min);
    v_period := tstzrange(p_start_at, v_end, '[)');
    if not app.lesson_on_grid(p_start_at, v_venue) then
      raise exception 'SLOT_NOT_ON_GRID' using errcode = 'P0001';
    end if;
    v_horizon := (v_rules->>'max_booking_horizon_days')::int;
    if coalesce(v_horizon, 0) > 0 and p_start_at > now() + make_interval(days => v_horizon) then
      raise exception 'BEYOND_HORIZON' using errcode = 'P0001', detail = v_horizon::text,
        hint = 'that date is further ahead than the venue takes bookings';
    end if;
    v_bk := app.lesson_bookable(v_venue, p_start_at, v_end);
    if v_bk = 'CLOSED_DATE' then
      raise exception 'CLOSED_DATE' using errcode = 'P0001';
    elsif v_bk = 'OUTSIDE_HOURS' then
      raise exception 'OUTSIDE_HOURS' using errcode = 'P0001';
    elsif v_bk = 'NO_COURT_FREE' then
      raise exception 'NO_COURT_FREE' using errcode = 'P0001';
    end if;
    if p_start_at <= now() then
      raise exception 'SLOT_IN_PAST' using errcode = 'P0001';
    end if;
    -- R15.
    perform app.assert_not_degraded_for(p_start_at, v_venue);

    -- 9. Quote = charge.
    v_price := app.lesson_price_for(v_c.id, v_t.id);
    if v_price is null then
      raise exception 'LESSON_TYPE_INACTIVE' using errcode = 'P0001';
    end if;
    if v_price <> p_expected_price_iqd then
      raise exception 'PRICE_CHANGED' using errcode = 'P0001',
        detail = jsonb_build_object('quoted_iqd', p_expected_price_iqd, 'current_iqd', v_price)::text;
    end if;

    -- 10 (unlocked), 11 (under the coach lock).
    if v_pass = 1 then
      if not app.coach_in_hours(v_c.id, v_venue, v_period) then
        raise exception 'COACH_UNAVAILABLE' using errcode = 'P0001';
      end if;
    else
      perform app.lesson_coach_free(v_c.id, v_venue, v_period, null, null);
    end if;
  end loop;

  -- 12. Every court of the branch, id order (R34); stale holds over the period.
  v_locked := app.lesson_lock_branch_courts(v_venue);
  perform app.match_expire_holds(v_venue, v_period);

  -- 13, 14.
  begin
    v_l := app.lesson_create_internal(v_c.id, v_t.id, p_start_at, null, null, v_price, v_online, 'guest',
                                      v_p.id, null, null, v_locked);
    insert into lesson_enrolments (venue_id, lesson_id, guest_id, party_size, friend_names, booked_by_kind,
                                   booked_by_profile_id, price_iqd, payment_mode, status, hold_expires_at,
                                   link_confirmed_at, idempotency_key)
    values (v_venue, v_l.id, v_p.id, p_party_size, v_friends, 'guest', v_p.id, v_price, p_payment_mode,
            case when v_online then 'held' else 'booked' end, v_l.hold_expires_at, now(), p_idempotency_key)
    returning * into v_e;
  exception when unique_violation then
    v_answer := app.lesson_guest_replay(p_idempotency_key, v_p.id, null, null);
    if v_answer is not null then
      return v_answer;
    end if;
    raise;
  end;

  -- 15.
  perform app.lesson_event(v_venue, v_l.id, null, v_e.id, case when v_online then 'held' else 'booked' end,
                           'guest', v_p.id, null, null,
                           jsonb_build_object('court_id', (select r.court_id from reservations r
                                                            where r.lesson_id = v_l.id
                                                              and r.status in ('pending', 'confirmed')
                                                            limit 1),
                                              'party_size', p_party_size, 'lesson_id', v_l.id));
  return app.lesson_booking_answer(v_e.id, false);
end $lesson_book_private_0283$;

comment on function app.lesson_book_private(uuid, uuid, timestamptz, int, text[], text, bigint, text) is
  '0283 (db.md §4.7.3; C-1, C-2, C-20, R9, R15, R30, R50, R56, R61, R69). Guest: book a private lesson (party 1..4, at most party_size - 1 friend names) instantly at the type''s branch. Order: lesson_guest(true); INVALID_ARGUMENT; lock_principal(hold_slot) and the replay; the hold ladder (BOOKING_SUSPENDED, HOLD_COOLDOWN); LESSON_TYPE_NOT_FOUND, COACH_NOT_FOUND (unknown, retired, not accepted), COACH_NOT_AT_BRANCH, COACHING_OFF, COACH_INACTIVE, LESSON_TYPE_INACTIVE, LESSON_TYPE_NOT_OFFERED, ALREADY_ENROLLED detail coach; PARTY_TOO_LARGE; ONLINE_PAYMENT_OFF, ONLINE_PAYMENT_REQUIRED, TERMS_REQUIRED lessons, HOLD_QUOTA_EXCEEDED; SLOT_NOT_ON_GRID, BEYOND_HORIZON, CLOSED_DATE, OUTSIDE_HOURS, SLOT_IN_PAST, DEGRADED_LOCKOUT; PRICE_CHANGED; COACH_UNAVAILABLE; then under the coach lock the same again and COACH_BUSY; every court of the branch; NO_COURT_FREE. Desk mode books (scheduled, enrolment booked); online holds the court for the payment window (held). Event booked or held. Returns (X5) {duplicate, enrolment_id, lesson_id, status (the enrolment''s), hold_expires_at, payment_mode, price_iqd, start_at, end_at, court_name_en, court_name_ar, venue_id, ...}.';

revoke all on function app.lesson_book_private(uuid, uuid, timestamptz, int, text[], text, bigint, text) from public, anon;
grant execute on function app.lesson_book_private(uuid, uuid, timestamptz, int, text[], text, bigint, text) to authenticated;

-- A place in a group session (level J: no court write).
create or replace function app.lesson_join(p_lesson_id uuid, p_payment_mode text, p_expected_price_iqd bigint,
                                           p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $lesson_join_0283$
declare
  v_p      profiles%rowtype;
  v_answer jsonb;
  v_l      lessons%rowtype;
  v_c      coaches%rowtype;
  v_online boolean;
  v_hold   timestamptz;
  v_e      lesson_enrolments%rowtype;
  v_pass   int;
begin
  -- 1.
  v_p := app.lesson_guest(true);
  -- 2.
  if p_lesson_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_id';
  end if;
  if p_payment_mode is null or p_payment_mode not in ('desk', 'online') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_payment_mode';
  end if;
  if p_expected_price_iqd is null or p_expected_price_iqd < 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_expected_price_iqd';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;
  v_online := p_payment_mode = 'online';

  -- 3.
  perform app.lock_principal('hold_slot', v_p.id);
  v_answer := app.lesson_guest_replay(p_idempotency_key, v_p.id, p_lesson_id, null);
  if v_answer is not null then
    return v_answer;
  end if;
  -- 4.
  perform app.lesson_guest_ladder(v_p.id);

  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      -- 12. A lesson's coach never changes.
      perform app.lock_coach(v_l.coach_id);
      v_answer := app.lesson_guest_replay(p_idempotency_key, v_p.id, p_lesson_id, null);
      if v_answer is not null then
        return v_answer;
      end if;
    end if;

    -- 5.
    select * into v_l from lessons where id = p_lesson_id;
    if v_l.id is not null then
      select * into v_c from coaches where id = v_l.coach_id;
    end if;
    if v_l.id is null or v_l.kind <> 'group' or not (v_l.venue_id = any (app.open_venue_ids()))
       or v_c.status = 'retired' or v_c.public_accepted_at is null then
      raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
    end if;
    if not coalesce((app.coaching_rules(v_l.venue_id)->>'coaching_enabled')::boolean, false) then
      raise exception 'COACHING_OFF' using errcode = 'P0001';
    end if;
    if v_c.status = 'paused' then
      raise exception 'COACH_INACTIVE' using errcode = 'P0001';
    end if;
    -- 6.
    if v_l.status <> 'scheduled' or now() >= v_l.start_at then
      raise exception 'LESSON_CLOSED' using errcode = 'P0001';
    end if;
    -- 7. R56 first: the coach of the session.
    if v_c.profile_id = v_p.id then
      raise exception 'ALREADY_ENROLLED' using errcode = 'P0001', detail = 'coach';
    end if;
    if exists (select 1 from lesson_enrolments e
                where e.lesson_id = v_l.id and e.guest_id = v_p.id and e.status in ('held', 'booked')) then
      raise exception 'ALREADY_ENROLLED' using errcode = 'P0001';
    end if;
    -- 8.
    perform app.lesson_guest_payment(v_p, v_l.venue_id, p_payment_mode);
    -- 9.
    if v_l.price_iqd::bigint <> p_expected_price_iqd then
      raise exception 'PRICE_CHANGED' using errcode = 'P0001',
        detail = jsonb_build_object('quoted_iqd', p_expected_price_iqd, 'current_iqd', v_l.price_iqd)::text;
    end if;
    -- 10.
    perform app.assert_not_degraded_for(v_l.start_at, v_l.venue_id);
    -- 11.
    if app.lesson_places_taken(v_l.id) + 1 > v_l.max_places then
      raise exception 'LESSON_FULL' using errcode = 'P0001';
    end if;
  end loop;

  -- 13.
  if v_online then
    v_hold := now() + make_interval(secs => coalesce((app.coaching_rules(v_l.venue_id)->>'deposit_window_seconds')::int, 900));
  end if;
  perform set_config('app.venue_id', v_l.venue_id::text, true);
  begin
    insert into lesson_enrolments (venue_id, lesson_id, guest_id, party_size, booked_by_kind, booked_by_profile_id,
                                   price_iqd, payment_mode, status, hold_expires_at, link_confirmed_at,
                                   idempotency_key)
    values (v_l.venue_id, v_l.id, v_p.id, 1, 'guest', v_p.id, v_l.price_iqd, p_payment_mode,
            case when v_online then 'held' else 'booked' end, v_hold, now(), p_idempotency_key)
    returning * into v_e;
  exception when unique_violation then
    v_answer := app.lesson_guest_replay(p_idempotency_key, v_p.id, p_lesson_id, null);
    if v_answer is not null then
      return v_answer;
    end if;
    raise exception 'ALREADY_ENROLLED' using errcode = 'P0001';
  end;

  perform app.lesson_event(v_l.venue_id, v_l.id, null, v_e.id, 'joined', 'guest', v_p.id, null, null,
                           jsonb_build_object('lesson_id', v_l.id) || app.lesson_places_data(v_l.id, null));
  return app.lesson_booking_answer(v_e.id, false);
end $lesson_join_0283$;

comment on function app.lesson_join(uuid, text, bigint, text) is
  '0283 (db.md §4.7.3; C-1, R15, R30, R56, R61). Guest: one place in a group session. Order: lesson_guest(true); INVALID_ARGUMENT; lock_principal(hold_slot), replay; the ladder; LESSON_NOT_FOUND (unknown, not a group session, branch not open, coach retired or not accepted); COACHING_OFF; COACH_INACTIVE; LESSON_CLOSED (not scheduled, or started); ALREADY_ENROLLED (detail coach for the session''s coach); the payment mode, terms and hold cap; PRICE_CHANGED (lessons.price_iqd); DEGRADED_LOCKOUT; LESSON_FULL; then under the coach lock the same again. The enrolment is booked (desk) or held for the payment window (online). Event joined {places_taken, places_total, lesson_id}. Returns (X5) {duplicate, enrolment_id, lesson_id, status, hold_expires_at, payment_mode, price_iqd, places_left, ...}.';

revoke all on function app.lesson_join(uuid, text, bigint, text) from public, anon;
grant execute on function app.lesson_join(uuid, text, bigint, text) to authenticated;

-- A place in a course (C-15: a late joiner pays for the sessions not yet
-- started).
create or replace function app.course_join(p_course_id uuid, p_payment_mode text, p_expected_price_iqd bigint,
                                           p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $course_join_0283$
declare
  v_p      profiles%rowtype;
  v_answer jsonb;
  v_co     courses%rowtype;
  v_c      coaches%rowtype;
  v_offer  jsonb;
  v_online boolean;
  v_hold   timestamptz;
  v_e      lesson_enrolments%rowtype;
  v_pass   int;
begin
  v_p := app.lesson_guest(true);
  if p_course_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_course_id';
  end if;
  if p_payment_mode is null or p_payment_mode not in ('desk', 'online') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_payment_mode';
  end if;
  if p_expected_price_iqd is null or p_expected_price_iqd < 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_expected_price_iqd';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;
  v_online := p_payment_mode = 'online';

  perform app.lock_principal('hold_slot', v_p.id);
  v_answer := app.lesson_guest_replay(p_idempotency_key, v_p.id, null, p_course_id);
  if v_answer is not null then
    return v_answer;
  end if;
  perform app.lesson_guest_ladder(v_p.id);

  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform app.lock_coach(v_co.coach_id);
      v_answer := app.lesson_guest_replay(p_idempotency_key, v_p.id, null, p_course_id);
      if v_answer is not null then
        return v_answer;
      end if;
    end if;

    select * into v_co from courses where id = p_course_id;
    if v_co.id is not null then
      select * into v_c from coaches where id = v_co.coach_id;
    end if;
    if v_co.id is null or not (v_co.venue_id = any (app.open_venue_ids()))
       or v_c.status = 'retired' or v_c.public_accepted_at is null then
      raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
    end if;
    if not coalesce((app.coaching_rules(v_co.venue_id)->>'coaching_enabled')::boolean, false) then
      raise exception 'COACHING_OFF' using errcode = 'P0001';
    end if;
    if v_c.status = 'paused' then
      raise exception 'COACH_INACTIVE' using errcode = 'P0001';
    end if;
    v_offer := app.lesson_course_offer(v_co.id);
    if v_co.status not in ('open', 'running') or now() >= v_co.signup_closes_at or v_offer is null then
      raise exception 'LESSON_CLOSED' using errcode = 'P0001';
    end if;
    if v_c.profile_id = v_p.id then
      raise exception 'ALREADY_ENROLLED' using errcode = 'P0001', detail = 'coach';
    end if;
    if exists (select 1 from lesson_enrolments e
                where e.course_id = v_co.id and e.guest_id = v_p.id and e.status in ('held', 'booked')) then
      raise exception 'ALREADY_ENROLLED' using errcode = 'P0001';
    end if;
    perform app.lesson_guest_payment(v_p, v_co.venue_id, p_payment_mode);
    -- Under the lock too: a session may have started in between.
    if (v_offer->>'price_iqd')::bigint <> p_expected_price_iqd then
      raise exception 'PRICE_CHANGED' using errcode = 'P0001',
        detail = jsonb_build_object('quoted_iqd', p_expected_price_iqd,
                                    'current_iqd', (v_offer->>'price_iqd')::bigint)::text;
    end if;
    perform app.assert_not_degraded_for((v_offer->>'first_start_at')::timestamptz, v_co.venue_id);
    if app.course_places_taken(v_co.id) + 1 > v_co.max_places then
      raise exception 'LESSON_FULL' using errcode = 'P0001';
    end if;
  end loop;

  if v_online then
    v_hold := now() + make_interval(secs => coalesce((app.coaching_rules(v_co.venue_id)->>'deposit_window_seconds')::int, 900));
  end if;
  perform set_config('app.venue_id', v_co.venue_id::text, true);
  begin
    insert into lesson_enrolments (venue_id, course_id, guest_id, party_size, booked_by_kind, booked_by_profile_id,
                                   price_iqd, first_session_no, sessions_covered, payment_mode, status,
                                   hold_expires_at, link_confirmed_at, idempotency_key)
    values (v_co.venue_id, v_co.id, v_p.id, 1, 'guest', v_p.id, (v_offer->>'price_iqd')::bigint,
            (v_offer->>'first_session_no')::smallint, (v_offer->>'sessions_covered')::smallint, p_payment_mode,
            case when v_online then 'held' else 'booked' end, v_hold, now(), p_idempotency_key)
    returning * into v_e;
  exception when unique_violation then
    v_answer := app.lesson_guest_replay(p_idempotency_key, v_p.id, null, p_course_id);
    if v_answer is not null then
      return v_answer;
    end if;
    raise exception 'ALREADY_ENROLLED' using errcode = 'P0001';
  end;

  perform app.lesson_event(v_co.venue_id, null, v_co.id, v_e.id, 'joined', 'guest', v_p.id, null, null,
                           jsonb_build_object('lesson_id', (v_offer->>'first_lesson_id')::uuid)
                           || app.lesson_places_data(null, v_co.id));
  return app.lesson_booking_answer(v_e.id, false);
end $course_join_0283$;

comment on function app.course_join(uuid, text, bigint, text) is
  '0283 (db.md §4.7.3; C-1, C-15, R15, R30, R56, R61). Guest: one place in a course. As lesson_join, with LESSON_NOT_FOUND for an unknown course (branch not open, coach retired or not accepted) and LESSON_CLOSED when the course is not open or running, sign-up has closed (signup_closes_at) or no session is left to start. The price is the whole course before session 1, else Money''s course_late_join_price over the sessions not yet started (first_session_no, sessions_covered); it is computed again under the coach lock (PRICE_CHANGED). DEGRADED_LOCKOUT reads the first covered session. LESSON_FULL reads course_places_taken. Event joined on the course. Returns (X5) {duplicate, enrolment_id, course_id, status, hold_expires_at, payment_mode, price_iqd, places_left, ...}.';

revoke all on function app.course_join(uuid, text, bigint, text) from public, anon;
grant execute on function app.course_join(uuid, text, bigint, text) to authenticated;

-- C-9, C-23, R8: the guest cancels their own place. Free outside the
-- branch's cancellation window (judged for a course against the guest's own
-- next covered session), or after the venue rescheduled it, or while held;
-- late otherwise, with a strike for a place the guest booked (CD-2).
create or replace function app.lesson_cancel_mine(p_enrolment_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $lesson_cancel_mine_0283$
declare
  v_p       profiles%rowtype;
  v_e       lesson_enrolments%rowtype;
  v_coach   uuid;
  v_ref     lessons%rowtype;
  v_window  int;
  v_kind    text;
  v_r       jsonb;
  v_m       jsonb;
  v_strike  boolean := false;
begin
  -- 1.
  v_p := app.lesson_guest(false);
  -- 2.
  if p_enrolment_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_enrolment_id';
  end if;
  -- 3. Not yours is not found.
  select * into v_e from lesson_enrolments where id = p_enrolment_id;
  if v_e.id is null or v_e.guest_id is distinct from v_p.id then
    raise exception 'ENROLMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  select coalesce((select l.coach_id from lessons l where l.id = v_e.lesson_id),
                  (select co.coach_id from courses co where co.id = v_e.course_id))
    into v_coach;

  -- 4.
  perform app.lock_coach(v_coach);
  select * into v_e from lesson_enrolments where id = p_enrolment_id;
  if v_e.guest_id is distinct from v_p.id then
    raise exception 'ENROLMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_e.status = 'cancelled' then
    v_m := app.lesson_enrolment_money(v_e.id);
    return jsonb_build_object(
      'duplicate', true, 'enrolment_id', v_e.id, 'status', v_e.status, 'cancel_kind', v_e.cancel_kind,
      'refunds_started', 0,
      'strike', exists (select 1 from lesson_strikes s where s.enrolment_id = v_e.id and s.kind = 'late_cancel'),
      'refund_iqd', coalesce((v_m->>'online_refunded_iqd')::bigint, 0)
                    + coalesce((v_m->>'refund_due_online_iqd')::bigint, 0),
      'kept_iqd', coalesce((v_m->>'kept_iqd')::bigint, 0));
  end if;

  -- 5.
  if v_e.status not in ('held', 'booked') then
    raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'status';
  end if;
  if v_e.lesson_id is not null then
    select * into v_ref from lessons where id = v_e.lesson_id;
    if now() >= v_ref.start_at then
      raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'started';
    end if;
  else
    -- C-23: the guest's own next covered session not yet started.
    select * into v_ref from lessons l
     where l.course_id = v_e.course_id
       and l.session_no between v_e.first_session_no and v_e.first_session_no + v_e.sessions_covered - 1
       and l.status = 'scheduled' and l.start_at > now()
     order by l.start_at, l.session_no limit 1;
    if v_ref.id is null then
      raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'started';
    end if;
  end if;
  -- C-21: answer "Is this you?" first.
  if v_e.booked_by_kind <> 'guest' and v_e.link_confirmed_at is null then
    raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'link_pending';
  end if;

  -- 6.
  v_window := coalesce((app.coaching_rules(v_e.venue_id)->>'cancellation_window_hours')::int, 12);
  if v_e.status = 'held' then
    v_kind := 'guest_free';
  elsif now() < v_ref.start_at - make_interval(hours => v_window)
        or (v_ref.rescheduled_at is not null and v_ref.rescheduled_at > v_e.created_at) then
    v_kind := 'guest_free';
  else
    v_kind := 'guest_late';
  end if;

  -- 7.
  v_r := app.enrolment_cancel_internal(v_e.id, v_kind, 'guest', v_p.id, null);

  -- 8. Recorded, never applied here (§1.4): CD-2 inside lesson_strike_record.
  if v_kind = 'guest_late' then
    perform app.lesson_strike_record(v_e.id, v_ref.id, 'late_cancel');
    v_strike := exists (select 1 from lesson_strikes s where s.enrolment_id = v_e.id and s.lesson_id = v_ref.id);
  end if;

  v_m := app.lesson_enrolment_money(v_e.id);
  return jsonb_build_object(
    'duplicate', false,
    'enrolment_id', v_e.id,
    'status', 'cancelled',
    'cancel_kind', v_kind,
    'lesson_cancelled', coalesce((v_r->>'lesson_cancelled')::boolean, false),
    'refunds_started', coalesce((v_r->>'refunds_started')::int, 0),
    'strike', v_strike,
    'refund_iqd', coalesce((v_m->>'online_refunded_iqd')::bigint, 0)
                  + coalesce((v_m->>'refund_due_online_iqd')::bigint, 0),
    'kept_iqd', coalesce((v_m->>'kept_iqd')::bigint, 0));
end $lesson_cancel_mine_0283$;

comment on function app.lesson_cancel_mine(uuid) is
  '0283 (db.md §4.7.7; C-9, C-21, C-23, CD-2, R8, R62). Guest: cancel one''s own place (a private lesson goes with it). lesson_guest(false); INVALID_ARGUMENT; ENROLMENT_NOT_FOUND (not the caller''s); under the coach lock: already cancelled -> {duplicate: true, ...}; LESSON_NOT_CANCELLABLE status | started (the lesson; a course once its last covered session started) | link_pending (C-21). guest_free while held, outside the branch''s cancellation_window_hours of the lesson or of the guest''s own next covered session (C-23), or after a reschedule of it (R8); else guest_late, which records a late_cancel strike for a place the guest booked (CD-2, app.lesson_strike_record; applied later by hold_strikes_settle). Money''s engine refunds what is due online (R28, R62). Returns (X6) {duplicate, enrolment_id, status, cancel_kind, lesson_cancelled, refunds_started, strike, refund_iqd (online money going back), kept_iqd}.';

revoke all on function app.lesson_cancel_mine(uuid) from public, anon;
grant execute on function app.lesson_cancel_mine(uuid) to authenticated;

-- C-21, R44: "A coach added you to a lesson. Is this you?" Yes links the
-- place; Not me unlinks it silently. No event and no push either way (the
-- coach is never told); Guest's enrolment reminder trigger follows the row.
create or replace function app.lesson_link_confirm(p_enrolment_id uuid, p_yes boolean) returns jsonb
language plpgsql security definer set search_path = public as $lesson_link_confirm_0283$
declare
  v_p     profiles%rowtype;
  v_e     lesson_enrolments%rowtype;
  v_coach uuid;
begin
  v_p := app.lesson_guest(false);
  if p_enrolment_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_enrolment_id';
  end if;
  if p_yes is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_yes';
  end if;
  select * into v_e from lesson_enrolments where id = p_enrolment_id;
  if v_e.id is null or v_e.guest_id is distinct from v_p.id or v_e.booked_by_kind = 'guest' then
    raise exception 'ENROLMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_e.link_confirmed_at is not null then
    if p_yes then
      return jsonb_build_object('enrolment_id', v_e.id, 'linked', true, 'duplicate', true);
    end if;
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'confirmed';
  end if;

  select coalesce((select l.coach_id from lessons l where l.id = v_e.lesson_id),
                  (select co.coach_id from courses co where co.id = v_e.course_id))
    into v_coach;
  -- Level H.
  perform app.lock_coach(v_coach);
  select * into v_e from lesson_enrolments where id = p_enrolment_id;
  if v_e.guest_id is distinct from v_p.id then
    raise exception 'ENROLMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_e.link_confirmed_at is not null then
    if p_yes then
      return jsonb_build_object('enrolment_id', v_e.id, 'linked', true, 'duplicate', true);
    end if;
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'confirmed';
  end if;

  perform set_config('app.venue_id', v_e.venue_id::text, true);
  if p_yes then
    update lesson_enrolments set link_confirmed_at = now(), updated_at = now()
     where id = v_e.id and guest_id = v_p.id and link_confirmed_at is null;
    perform app.write_audit('coaching.link.confirm', 'lesson_enrolments', v_e.id::text, null,
                            jsonb_build_object('enrolment_id', v_e.id));
  else
    update lesson_enrolments set guest_id = null, updated_at = now()
     where id = v_e.id and guest_id = v_p.id and link_confirmed_at is null;
    perform app.write_audit('coaching.link.decline', 'lesson_enrolments', v_e.id::text, null,
                            jsonb_build_object('enrolment_id', v_e.id));
  end if;
  return jsonb_build_object('enrolment_id', v_e.id, 'linked', p_yes, 'duplicate', false);
end $lesson_link_confirm_0283$;

comment on function app.lesson_link_confirm(uuid, boolean) is
  '0283 (db.md §4.7.5; C-21, R44). Guest: answer "Is this you?" for a place a coach or the desk added from a phone that matched the caller''s verified phone. lesson_guest(false); INVALID_ARGUMENT p_enrolment_id | p_yes; ENROLMENT_NOT_FOUND unless the place names the caller and was not booked by them; already confirmed: yes -> {duplicate: true}, no -> INVALID_TRANSITION detail confirmed (cancel it instead). Under the coach lock: yes stamps link_confirmed_at; no sets guest_id NULL (a walk-in again). No lesson_events row, no push (the coach is never told); audited coaching.link.confirm | decline with ids only. Returns {enrolment_id, linked, duplicate}.';

revoke all on function app.lesson_link_confirm(uuid, boolean) from public, anon;
grant execute on function app.lesson_link_confirm(uuid, boolean) to authenticated;

-- ===========================================================================
-- 3. Coach and desk: shared creation internals (db.md §4.7.4, §4.7.5)
-- ===========================================================================

-- Rule 7 for a created group session (key on lessons) or course (key on
-- courses): the same creator answers again; anyone else, or another kind,
-- is IDEMPOTENCY_CONFLICT; NULL for a new key.
create or replace function app.lesson_create_replay(p_key text, p_kind text, p_by text, p_profile_id uuid,
                                                    p_staff_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $lesson_create_replay_0283$
declare
  v_l  lessons%rowtype;
  v_co courses%rowtype;
begin
  if p_kind = 'course' then
    select * into v_co from courses where idempotency_key = p_key;
    if v_co.id is null then
      return null;
    end if;
    if v_co.created_by_kind <> p_by
       or (p_by = 'coach' and v_co.created_by_profile_id is distinct from p_profile_id)
       or (p_by = 'staff' and v_co.created_by_staff_id is distinct from p_staff_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001', hint = 'that key belongs to another course';
    end if;
    return app.lesson_course_answer(v_co.id, true);
  end if;
  select * into v_l from lessons where idempotency_key = p_key;
  if v_l.id is null then
    return null;
  end if;
  if v_l.kind <> 'group' or v_l.booked_by_kind <> p_by
     or (p_by = 'coach' and v_l.created_by_profile_id is distinct from p_profile_id)
     or (p_by = 'staff' and v_l.created_by_staff_id is distinct from p_staff_id) then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001', hint = 'that key belongs to another lesson';
  end if;
  return app.lesson_group_answer(v_l.id, true);
end $lesson_create_replay_0283$;

comment on function app.lesson_create_replay(text, text, text, uuid, uuid) is
  '0283 (db.md §4.7.1 rule 7). Internal. The replay of a group session (lessons.idempotency_key) or course (courses.idempotency_key) creation: NULL for a new key, the duplicate answer for the same creator (coach profile or staff id), IDEMPOTENCY_CONFLICT otherwise.';

revoke all on function app.lesson_create_replay(text, text, text, uuid, uuid) from public, anon, authenticated;

-- A group session (C-13). The caller has passed its guard, the type (a group
-- type at the branch) and the coach checks. Level B: no principal; the
-- cut-off at creation (R47); the coach lock; every court; one lesson.
create or replace function app.lesson_group_create_internal(p_coach_id uuid, p_lesson_type_id uuid,
                                                            p_start_at timestamptz, p_by text, p_profile_id uuid,
                                                            p_staff_id uuid, p_key text, p_degraded boolean)
returns jsonb
language plpgsql security definer set search_path = public as $lesson_group_create_internal_0283$
declare
  v_t      lesson_types%rowtype;
  v_end    timestamptz;
  v_period tstzrange;
  v_price  bigint;
  v_answer jsonb;
  v_locked uuid[];
  v_l      lessons%rowtype;
begin
  select * into v_t from lesson_types where id = p_lesson_type_id;
  v_end := p_start_at + make_interval(mins => v_t.duration_min);
  v_period := tstzrange(p_start_at, v_end, '[)');

  perform app.lesson_check_start(v_t.venue_id, p_start_at, v_end, null);
  -- R47: never created only to be cancelled under-filled a minute later.
  if p_start_at - make_interval(hours => v_t.cutoff_hours) <= now() then
    raise exception 'LESSON_CLOSED' using errcode = 'P0001', detail = 'cutoff';
  end if;
  if coalesce(p_degraded, false) then
    perform app.assert_not_degraded_for(p_start_at, v_t.venue_id);
  end if;
  if not app.coach_in_hours(p_coach_id, v_t.venue_id, v_period) then
    raise exception 'COACH_UNAVAILABLE' using errcode = 'P0001';
  end if;
  v_price := app.lesson_price_for(p_coach_id, v_t.id);
  if v_price is null then
    raise exception 'LESSON_TYPE_INACTIVE' using errcode = 'P0001';
  end if;

  perform app.lock_coach(p_coach_id);
  v_answer := app.lesson_create_replay(p_key, 'group', p_by, p_profile_id, p_staff_id);
  if v_answer is not null then
    return v_answer;
  end if;
  perform app.lesson_coach_free(p_coach_id, v_t.venue_id, v_period, null, null);

  v_locked := app.lesson_lock_branch_courts(v_t.venue_id);
  perform app.match_expire_holds(v_t.venue_id, v_period);

  begin
    v_l := app.lesson_create_internal(p_coach_id, v_t.id, p_start_at, null, null, v_price, false, p_by,
                                      p_profile_id, p_staff_id, p_key, v_locked);
  exception when unique_violation then
    v_answer := app.lesson_create_replay(p_key, 'group', p_by, p_profile_id, p_staff_id);
    if v_answer is not null then
      return v_answer;
    end if;
    raise;
  end;

  perform app.lesson_event(v_l.venue_id, v_l.id, null, null, 'booked', p_by, p_profile_id, p_staff_id, null,
                           jsonb_build_object('court_id', (select r.court_id from reservations r
                                                            where r.lesson_id = v_l.id
                                                              and r.status in ('pending', 'confirmed')
                                                            limit 1),
                                              'lesson_id', v_l.id));
  perform app.write_audit('coaching.lesson.book', 'lessons', v_l.id::text, null,
                          jsonb_build_object('lesson_id', v_l.id, 'kind', 'group', 'coach_id', p_coach_id,
                                             'start_at', v_l.start_at, 'by', p_by));
  return app.lesson_group_answer(v_l.id, false);
end $lesson_group_create_internal_0283$;

comment on function app.lesson_group_create_internal(uuid, uuid, timestamptz, text, uuid, uuid, text, boolean) is
  '0283 (db.md §4.7.4; C-13, R9, R15, R47). Internal: the shared body of coach_create_group and desk_create_group after their guards and type checks. SLOT_NOT_ON_GRID, SLOT_IN_PAST, CLOSED_DATE, OUTSIDE_HOURS; LESSON_CLOSED detail cutoff (start - cutoff_hours <= now); DEGRADED_LOCKOUT when p_degraded (the coach); COACH_UNAVAILABLE; under the coach lock the replay and COACH_BUSY / COACH_UNAVAILABLE; every court; app.lesson_create_internal (price = app.lesson_price_for, key on the lesson). Event booked {court_id, lesson_id}; audit coaching.lesson.book. Returns app.lesson_group_answer.';

revoke all on function app.lesson_group_create_internal(uuid, uuid, timestamptz, text, uuid, uuid, text, boolean)
  from public, anon, authenticated;

-- A course (C-13, C-15, C-19), all or nothing. The caller has passed its
-- guard, the titles, the type (a course type at the branch) and the coach
-- checks. Per-start refusals carry the 1-based session number (X31).
create or replace function app.lesson_course_create_internal(p_coach_id uuid, p_lesson_type_id uuid,
                                                             p_starts timestamptz[], p_title_en text, p_title_ar text,
                                                             p_by text, p_profile_id uuid, p_staff_id uuid,
                                                             p_key text, p_degraded boolean)
returns jsonb
language plpgsql security definer set search_path = public as $lesson_course_create_internal_0283$
declare
  v_t      lesson_types%rowtype;
  v_rules  jsonb;
  v_n      int;
  v_i      int;
  v_dur    interval;
  v_s      timestamptz;
  v_price  bigint;
  v_answer jsonb;
  v_locked uuid[];
  v_co     courses%rowtype;
  v_l      lessons%rowtype;
begin
  select * into v_t from lesson_types where id = p_lesson_type_id;
  v_rules := app.coaching_rules(v_t.venue_id);
  v_dur := make_interval(mins => v_t.duration_min);

  -- 3.
  v_n := coalesce(cardinality(p_starts), 0);
  if v_n <> v_t.sessions_count or array_position(p_starts, null) is not null then
    raise exception 'COURSE_STARTS_INVALID' using errcode = 'P0001', detail = 'count';
  end if;
  for v_i in 2 .. v_n loop
    if p_starts[v_i] <= p_starts[v_i - 1] or p_starts[v_i - 1] + v_dur > p_starts[v_i] then
      raise exception 'COURSE_STARTS_INVALID' using errcode = 'P0001', detail = 'order';
    end if;
  end loop;
  if p_starts[v_n] - p_starts[1] > interval '366 days' then
    raise exception 'COURSE_STARTS_INVALID' using errcode = 'P0001', detail = 'span';
  end if;

  -- 4. Per start; then the cut-off of session 1 (R47); then degraded (the coach).
  for v_i in 1 .. v_n loop
    v_s := p_starts[v_i];
    perform app.lesson_check_start(v_t.venue_id, v_s, v_s + v_dur, v_i::text);
    if not app.coach_in_hours(p_coach_id, v_t.venue_id, tstzrange(v_s, v_s + v_dur, '[)')) then
      raise exception 'COACH_UNAVAILABLE' using errcode = 'P0001', detail = v_i::text;
    end if;
  end loop;
  if p_starts[1] - make_interval(hours => v_t.cutoff_hours) <= now() then
    raise exception 'LESSON_CLOSED' using errcode = 'P0001', detail = 'cutoff';
  end if;
  if coalesce(p_degraded, false) then
    perform app.assert_not_degraded_for(p_starts[1], v_t.venue_id);
  end if;
  v_price := app.lesson_price_for(p_coach_id, v_t.id);
  if v_price is null then
    raise exception 'LESSON_TYPE_INACTIVE' using errcode = 'P0001';
  end if;

  -- 5.
  perform app.lock_coach(p_coach_id);
  v_answer := app.lesson_create_replay(p_key, 'course', p_by, p_profile_id, p_staff_id);
  if v_answer is not null then
    return v_answer;
  end if;
  for v_i in 1 .. v_n loop
    v_s := p_starts[v_i];
    perform app.lesson_coach_free(p_coach_id, v_t.venue_id, tstzrange(v_s, v_s + v_dur, '[)'), null, v_i::text);
  end loop;

  -- 6. Every court; the stale holds of the whole run in one statement.
  v_locked := app.lesson_lock_branch_courts(v_t.venue_id);
  perform app.match_expire_holds(v_t.venue_id, tstzrange(p_starts[1], p_starts[v_n] + v_dur, '[)'));

  -- 7.
  perform set_config('app.venue_id', v_t.venue_id::text, true);
  begin
    insert into courses (venue_id, coach_id, lesson_type_id, title_en, title_ar, price_iqd, court_share_iqd,
                         coach_share_bp, sessions_count, max_places, min_places, cutoff_at, signup_closes_at,
                         status, created_by_kind, created_by_profile_id, created_by_staff_id, idempotency_key)
    values (v_t.venue_id, p_coach_id, v_t.id, coalesce(p_title_en, ''), coalesce(p_title_ar, ''), v_price,
            v_t.court_share_iqd, coalesce((v_rules->>'coach_share_bp')::int, 6000), v_t.sessions_count,
            v_t.max_places, v_t.min_places, p_starts[1] - make_interval(hours => v_t.cutoff_hours),
            p_starts[v_n], 'open', p_by,
            case when p_by = 'coach' then p_profile_id end,
            case when p_by = 'staff' then p_staff_id end,
            p_key)
    returning * into v_co;
  exception when unique_violation then
    v_answer := app.lesson_create_replay(p_key, 'course', p_by, p_profile_id, p_staff_id);
    if v_answer is not null then
      return v_answer;
    end if;
    raise;
  end;

  for v_i in 1 .. v_n loop
    begin
      v_l := app.lesson_create_internal(p_coach_id, v_t.id, p_starts[v_i], v_co.id, v_i::smallint, null, false,
                                        p_by, p_profile_id, p_staff_id, null, v_locked);
    exception when sqlstate 'P0001' then
      if sqlerrm = 'NO_COURT_FREE' then
        raise exception 'NO_COURT_FREE' using errcode = 'P0001', detail = v_i::text;
      elsif sqlerrm = 'COACH_BUSY' then
        raise exception 'COACH_BUSY' using errcode = 'P0001', detail = v_i::text;
      end if;
      raise;
    end;
  end loop;

  -- 8.
  perform app.lesson_event(v_co.venue_id, null, v_co.id, null, 'booked', p_by, p_profile_id, p_staff_id, null,
                           jsonb_build_object('sessions', v_n,
                                              'lesson_id', (select l.id from lessons l
                                                             where l.course_id = v_co.id and l.session_no = 1)));
  perform app.write_audit('coaching.course.create', 'courses', v_co.id::text, null,
                          jsonb_build_object('course_id', v_co.id, 'coach_id', p_coach_id, 'sessions', v_n,
                                             'first_start_at', p_starts[1], 'by', p_by));
  return app.lesson_course_answer(v_co.id, false);
end $lesson_course_create_internal_0283$;

comment on function app.lesson_course_create_internal(uuid, uuid, timestamptz[], text, text, text, uuid, uuid, text, boolean) is
  '0283 (db.md §4.7.4; C-13, C-15, C-19, R15, R47, X31). Internal: the shared body of coach_create_course and desk_create_course, all or nothing. COURSE_STARTS_INVALID detail count (cardinality <> sessions_count, a NULL start) | order (not strictly increasing, or a session ending after the next starts) | span (over 366 days); per start i (1-based) SLOT_NOT_ON_GRID, SLOT_IN_PAST, CLOSED_DATE, OUTSIDE_HOURS, COACH_UNAVAILABLE detail i; LESSON_CLOSED detail cutoff (start 1 - cutoff_hours <= now); DEGRADED_LOCKOUT when p_degraded; under the coach lock the replay and per start COACH_BUSY detail i; every court; the course row (price = app.lesson_price_for, snapshots, cutoff_at, signup_closes_at = the last start), then one session per start (NO_COURT_FREE / COACH_BUSY re-raised with detail i, the whole call rolled back). Event booked on the course; audit coaching.course.create. Returns app.lesson_course_answer (X13).';

revoke all on function app.lesson_course_create_internal(uuid, uuid, timestamptz[], text, text, text, uuid, uuid, text, boolean)
  from public, anon, authenticated;

-- A student added to a group session or a course by the coach (C-8) or the
-- desk. The caller holds lock_coach and has run every check. Price: the
-- session's place price, or the course's sessions not yet started (C-15).
-- Event added {places_taken, places_total, lesson_id}.
create or replace function app.lesson_student_add_internal(p_lesson_id uuid, p_course_id uuid, p_guest_id uuid,
                                                           p_link_confirmed boolean, p_name text, p_phone text,
                                                           p_by text, p_profile_id uuid, p_staff_id uuid,
                                                           p_key text)
returns lesson_enrolments
language plpgsql security definer set search_path = public as $lesson_student_add_internal_0283$
declare
  v_l     lessons%rowtype;
  v_co    courses%rowtype;
  v_offer jsonb;
  v_venue uuid;
  v_e     lesson_enrolments%rowtype;
begin
  if p_lesson_id is not null then
    select * into v_l from lessons where id = p_lesson_id;
    v_venue := v_l.venue_id;
  else
    select * into v_co from courses where id = p_course_id;
    v_venue := v_co.venue_id;
    v_offer := app.lesson_course_offer(v_co.id);
    if v_offer is null then
      raise exception 'LESSON_CLOSED' using errcode = 'P0001';
    end if;
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  insert into lesson_enrolments (venue_id, lesson_id, course_id, guest_id, guest_name, guest_phone, party_size,
                                 booked_by_kind, booked_by_profile_id, booked_by_staff_id, price_iqd,
                                 first_session_no, sessions_covered, payment_mode, status, link_confirmed_at,
                                 idempotency_key)
  values (v_venue, p_lesson_id, p_course_id, p_guest_id, p_name, p_phone, 1, p_by,
          case when p_by = 'coach' then p_profile_id end,
          case when p_by = 'staff' then p_staff_id end,
          case when p_lesson_id is not null then v_l.price_iqd::bigint else (v_offer->>'price_iqd')::bigint end,
          case when p_course_id is not null then (v_offer->>'first_session_no')::smallint end,
          case when p_course_id is not null then (v_offer->>'sessions_covered')::smallint end,
          'desk', 'booked',
          case when coalesce(p_link_confirmed, false) and p_guest_id is not null then now() end,
          p_key)
  returning * into v_e;
  perform app.lesson_event(v_venue, p_lesson_id, p_course_id, v_e.id, 'added', p_by, p_profile_id, p_staff_id, null,
                           jsonb_build_object('lesson_id', coalesce(p_lesson_id, (v_offer->>'first_lesson_id')::uuid))
                           || app.lesson_places_data(p_lesson_id, p_course_id));
  return v_e;
end $lesson_student_add_internal_0283$;

comment on function app.lesson_student_add_internal(uuid, uuid, uuid, boolean, text, text, text, uuid, uuid, text) is
  '0283 (db.md §4.7.5; C-8, C-15, C-21, R44). Internal; the caller holds lock_coach and has checked everything. Inserts a booked, desk-paid enrolment in a group session or a course for the coach (p_by coach) or the desk (staff): the typed name and phone, guest_id the matched or picked account, link_confirmed_at now() only for a desk-picked customer (p_link_confirmed), price the session''s place or the course''s sessions not yet started. Event added {places_taken, places_total, lesson_id}. Returns the enrolment.';

revoke all on function app.lesson_student_add_internal(uuid, uuid, uuid, boolean, text, text, text, uuid, uuid, text)
  from public, anon, authenticated;

-- ===========================================================================
-- 4. Coach writes (db.md §4.7.4–§4.7.8; app.coach_self first)
-- ===========================================================================

-- C-22, R61: "Your coach profile will be public on the app and the website".
create or replace function app.coach_accept_public() returns jsonb
language plpgsql security definer set search_path = public as $coach_accept_public_0283$
declare
  v_c  coaches%rowtype := app.coach_self();
  v_id uuid := v_c.id;
  v_at timestamptz;
begin
  if v_c.public_accepted_at is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'public_accepted_at', v_c.public_accepted_at);
  end if;
  update coaches set public_accepted_at = now(), updated_at = now()
   where id = v_id and public_accepted_at is null
  returning public_accepted_at into v_at;
  if v_at is null then
    select c.public_accepted_at into v_at from coaches c where c.id = v_id;
    return jsonb_build_object('ok', true, 'duplicate', true, 'public_accepted_at', v_at);
  end if;
  perform app.write_audit('coaching.coach.accept_public', 'coaches', v_id::text, null,
                          jsonb_build_object('coach_id', v_id, 'public_accepted_at', v_at));
  return jsonb_build_object('ok', true, 'duplicate', false, 'public_accepted_at', v_at);
end $coach_accept_public_0283$;

comment on function app.coach_accept_public() is
  '0283 (db.md §4.7.5; C-22, R61). Coach (app.coach_self first): accept that the coach profile is public on the app and the website (coaches.public_accepted_at). Until then no public read or guest listing shows the coach; desk- and coach-booked lessons work. Already accepted: {ok: true, duplicate: true, public_accepted_at}. Audited coaching.coach.accept_public. Returns {ok, duplicate, public_accepted_at}.';

revoke all on function app.coach_accept_public() from public, anon;
grant execute on function app.coach_accept_public() to authenticated;

-- C-8, C-24: a private lesson the coach books for a student (name, optional
-- phone). Desk-paid (CD-1). CD-9: 30 coach adds a day; R56: at most
-- coach_max_open_private upcoming coach-booked private lessons at the branch.
-- R10, C-21: a typed phone that matches a verified account links it, pending;
-- the answer is the same either way.
create or replace function app.coach_book_private(
  p_lesson_type_id  uuid,
  p_venue_id        uuid,
  p_start_at        timestamptz,
  p_student_name    text,
  p_student_phone   text,
  p_party_size      int,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $coach_book_private_0283$
declare
  v_c      coaches%rowtype;
  v_name   text := app.safe_line(p_student_name);
  v_phone  text := nullif(app.safe_line(p_student_phone), '');
  v_e      lesson_enrolments%rowtype;
  v_t      lesson_types%rowtype;
  v_rules  jsonb;
  v_end    timestamptz;
  v_period tstzrange;
  v_price  bigint;
  v_locked uuid[];
  v_l      lessons%rowtype;
  v_gid    uuid;
  v_count  int;
begin
  -- 1.
  v_c := app.coach_self();
  -- 2.
  if p_lesson_type_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_type_id';
  end if;
  if p_venue_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_venue_id';
  end if;
  if p_start_at is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_start_at';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 80 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_student_name';
  end if;
  if v_phone is not null
     and (app.phone_canon(v_phone) is null or coalesce(app.phone_digits(v_phone), '') !~ '^[0-9]{7,15}$') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_student_phone';
  end if;
  if p_party_size is null or p_party_size not between 1 and 4 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_party_size';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;

  -- 3. The coach's own principal (CD-9 counted under it); the replay first,
  -- so a retried booking never meets its own cap.
  perform app.lock_principal('coach_students', v_c.id);
  select * into v_e from lesson_enrolments where idempotency_key = p_idempotency_key;
  if v_e.id is not null then
    if v_e.booked_by_kind <> 'coach' or v_e.booked_by_profile_id is distinct from v_c.profile_id
       or v_e.lesson_id is null then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001', hint = 'that key belongs to another booking';
    end if;
    return app.lesson_private_answer(v_e.id, true);
  end if;
  select count(*) into v_count
    from lesson_enrolments e
   where e.booked_by_kind = 'coach' and e.booked_by_profile_id = v_c.profile_id
     and e.created_at > now() - interval '24 hours';
  if v_count >= 30 then
    raise exception 'COACH_ADD_LIMIT' using errcode = 'P0001', detail = 'day';
  end if;

  -- 4.
  select * into v_t from lesson_types where id = p_lesson_type_id and venue_id = p_venue_id;
  if v_t.id is null or v_t.kind <> 'private' then
    raise exception 'LESSON_TYPE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not (p_venue_id = any (app.open_venue_ids()))
     or not exists (select 1 from coach_branches b
                     where b.coach_id = v_c.id and b.venue_id = p_venue_id and b.active) then
    raise exception 'COACH_NOT_AT_BRANCH' using errcode = 'P0001';
  end if;
  v_rules := app.coaching_rules(p_venue_id);
  if not coalesce((v_rules->>'coaching_enabled')::boolean, false) then
    raise exception 'COACHING_OFF' using errcode = 'P0001';
  end if;
  if v_c.status = 'paused' then
    raise exception 'COACH_INACTIVE' using errcode = 'P0001';
  end if;
  if not v_t.is_active then
    raise exception 'LESSON_TYPE_INACTIVE' using errcode = 'P0001';
  end if;
  if not exists (select 1 from coach_lesson_types ct where ct.coach_id = v_c.id and ct.lesson_type_id = v_t.id) then
    raise exception 'LESSON_TYPE_NOT_OFFERED' using errcode = 'P0001';
  end if;
  if p_party_size > v_t.max_places then
    raise exception 'PARTY_TOO_LARGE' using errcode = 'P0001', detail = v_t.max_places::text;
  end if;

  -- 5. (No horizon for a coach.)
  v_end := p_start_at + make_interval(mins => v_t.duration_min);
  v_period := tstzrange(p_start_at, v_end, '[)');
  perform app.lesson_check_start(p_venue_id, p_start_at, v_end, null);
  perform app.assert_not_degraded_for(p_start_at, p_venue_id);
  -- 6.
  if not app.coach_in_hours(v_c.id, p_venue_id, v_period) then
    raise exception 'COACH_UNAVAILABLE' using errcode = 'P0001';
  end if;
  v_price := app.lesson_price_for(v_c.id, v_t.id);
  if v_price is null then
    raise exception 'LESSON_TYPE_INACTIVE' using errcode = 'P0001';
  end if;

  -- 7.
  perform app.lock_coach(v_c.id);
  select * into v_e from lesson_enrolments where idempotency_key = p_idempotency_key;
  if v_e.id is not null then
    if v_e.booked_by_kind <> 'coach' or v_e.booked_by_profile_id is distinct from v_c.profile_id
       or v_e.lesson_id is null then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001', hint = 'that key belongs to another booking';
    end if;
    return app.lesson_private_answer(v_e.id, true);
  end if;
  select * into v_c from coaches c where c.id = v_c.id;
  if v_c.status = 'paused' then
    raise exception 'COACH_INACTIVE' using errcode = 'P0001';
  end if;
  if v_c.status = 'retired' then
    raise exception 'NOT_A_COACH' using errcode = 'P0001';
  end if;
  -- C-24, R56: no court hoarding.
  select count(*) into v_count
    from lessons l
   where l.coach_id = v_c.id and l.venue_id = p_venue_id and l.kind = 'private' and l.booked_by_kind = 'coach'
     and l.status in ('held', 'scheduled') and l.start_at > now();
  if v_count >= coalesce((v_rules->>'coach_max_open_private')::int, 10) then
    raise exception 'COACH_ADD_LIMIT' using errcode = 'P0001', detail = 'live';
  end if;
  perform app.lesson_coach_free(v_c.id, p_venue_id, v_period, null, null);

  -- 8.
  v_locked := app.lesson_lock_branch_courts(p_venue_id);
  perform app.match_expire_holds(p_venue_id, v_period);

  -- 9, 10. The match (R10): the same work whatever it finds.
  v_gid := app.lesson_link_by_phone(v_phone, v_c.profile_id);
  begin
    v_l := app.lesson_create_internal(v_c.id, v_t.id, p_start_at, null, null, v_price, false, 'coach',
                                      v_c.profile_id, null, null, v_locked);
    perform set_config('app.venue_id', p_venue_id::text, true);
    insert into lesson_enrolments (venue_id, lesson_id, guest_id, guest_name, guest_phone, party_size, booked_by_kind,
                                   booked_by_profile_id, price_iqd, payment_mode, status, idempotency_key)
    values (p_venue_id, v_l.id, v_gid, v_name, v_phone, p_party_size, 'coach', v_c.profile_id, v_price, 'desk',
            'booked', p_idempotency_key)
    returning * into v_e;
  exception when unique_violation then
    select * into v_e from lesson_enrolments where idempotency_key = p_idempotency_key;
    if v_e.id is not null and v_e.booked_by_kind = 'coach' and v_e.booked_by_profile_id = v_c.profile_id
       and v_e.lesson_id is not null then
      return app.lesson_private_answer(v_e.id, true);
    end if;
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001', hint = 'that key belongs to another booking';
  end;

  -- 11.
  perform app.lesson_event(p_venue_id, v_l.id, null, v_e.id, 'booked', 'coach', v_c.profile_id, null, null,
                           jsonb_build_object('court_id', (select r.court_id from reservations r
                                                            where r.lesson_id = v_l.id
                                                              and r.status in ('pending', 'confirmed')
                                                            limit 1),
                                              'party_size', p_party_size, 'lesson_id', v_l.id));
  perform app.lesson_event(p_venue_id, v_l.id, null, v_e.id, 'added', 'coach', v_c.profile_id, null, null,
                           jsonb_build_object('lesson_id', v_l.id));
  perform app.write_audit('coaching.lesson.book', 'lessons', v_l.id::text, null,
                          jsonb_build_object('lesson_id', v_l.id, 'enrolment_id', v_e.id, 'kind', 'private',
                                             'by', 'coach', 'linked', v_gid is not null));
  return app.lesson_private_answer(v_e.id, false);
end $coach_book_private_0283$;

comment on function app.coach_book_private(uuid, uuid, timestamptz, text, text, int, text) is
  '0283 (db.md §4.7.4; C-8, C-21, C-24, CD-1, CD-9, R10, R15, R44, R56). Coach: book a private lesson for a student (name 1..80, optional phone, party 1..4), desk-paid. coach_self; INVALID_ARGUMENT; lock_principal(coach_students), replay, COACH_ADD_LIMIT detail day (30 coach adds in 24 h); LESSON_TYPE_NOT_FOUND (a private type at p_venue_id), COACH_NOT_AT_BRANCH, COACHING_OFF, COACH_INACTIVE, LESSON_TYPE_INACTIVE, LESSON_TYPE_NOT_OFFERED, PARTY_TOO_LARGE; SLOT_NOT_ON_GRID, SLOT_IN_PAST, CLOSED_DATE, OUTSIDE_HOURS, DEGRADED_LOCKOUT; COACH_UNAVAILABLE; under the coach lock the replay, COACH_ADD_LIMIT detail live (coach_max_open_private upcoming coach-booked private lessons at the branch), COACH_BUSY; every court; NO_COURT_FREE. A typed phone matching a verified account links it pending (C-21); the answer, the work and the refusals are the same either way (R10). Events booked and added; audit coaching.lesson.book. Returns {duplicate, lesson_id, enrolment_id, start_at, end_at, court_id, court_name_en, court_name_ar, price_iqd, ...}.';

revoke all on function app.coach_book_private(uuid, uuid, timestamptz, text, text, int, text) from public, anon;
grant execute on function app.coach_book_private(uuid, uuid, timestamptz, text, text, int, text) to authenticated;

create or replace function app.coach_create_group(p_lesson_type_id uuid, p_venue_id uuid, p_start_at timestamptz,
                                                  p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $coach_create_group_0283$
declare
  v_c      coaches%rowtype;
  v_t      lesson_types%rowtype;
  v_answer jsonb;
begin
  v_c := app.coach_self();
  if p_lesson_type_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_type_id';
  end if;
  if p_venue_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_venue_id';
  end if;
  if p_start_at is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_start_at';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;
  v_answer := app.lesson_create_replay(p_idempotency_key, 'group', 'coach', v_c.profile_id, null);
  if v_answer is not null then
    return v_answer;
  end if;

  select * into v_t from lesson_types where id = p_lesson_type_id and venue_id = p_venue_id;
  if v_t.id is null or v_t.kind <> 'group' then
    raise exception 'LESSON_TYPE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not (p_venue_id = any (app.open_venue_ids()))
     or not exists (select 1 from coach_branches b
                     where b.coach_id = v_c.id and b.venue_id = p_venue_id and b.active) then
    raise exception 'COACH_NOT_AT_BRANCH' using errcode = 'P0001';
  end if;
  if not coalesce((app.coaching_rules(p_venue_id)->>'coaching_enabled')::boolean, false) then
    raise exception 'COACHING_OFF' using errcode = 'P0001';
  end if;
  if v_c.status = 'paused' then
    raise exception 'COACH_INACTIVE' using errcode = 'P0001';
  end if;
  if not v_t.is_active then
    raise exception 'LESSON_TYPE_INACTIVE' using errcode = 'P0001';
  end if;
  if not exists (select 1 from coach_lesson_types ct where ct.coach_id = v_c.id and ct.lesson_type_id = v_t.id) then
    raise exception 'LESSON_TYPE_NOT_OFFERED' using errcode = 'P0001';
  end if;
  return app.lesson_group_create_internal(v_c.id, v_t.id, p_start_at, 'coach', v_c.profile_id, null,
                                          p_idempotency_key, true);
end $coach_create_group_0283$;

comment on function app.coach_create_group(uuid, uuid, timestamptz, text) is
  '0283 (db.md §4.7.4; C-13, R15, R47). Coach: create a group session at branch p_venue_id. coach_self; INVALID_ARGUMENT; replay (lessons.idempotency_key, created by the caller); LESSON_TYPE_NOT_FOUND (a group type at the branch), COACH_NOT_AT_BRANCH, COACHING_OFF, COACH_INACTIVE, LESSON_TYPE_INACTIVE, LESSON_TYPE_NOT_OFFERED; then app.lesson_group_create_internal (grid, past, hours, LESSON_CLOSED cutoff, DEGRADED_LOCKOUT, COACH_UNAVAILABLE, COACH_BUSY, NO_COURT_FREE). Returns {duplicate, lesson_id, start_at, end_at, cutoff_at, court_id, court_name_en, court_name_ar, price_iqd, max_places, min_places, ...}.';

revoke all on function app.coach_create_group(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function app.coach_create_group(uuid, uuid, timestamptz, text) to authenticated;

create or replace function app.coach_create_course(p_lesson_type_id uuid, p_venue_id uuid, p_starts timestamptz[],
                                                   p_title_en text, p_title_ar text, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $coach_create_course_0283$
declare
  v_c        coaches%rowtype;
  v_t        lesson_types%rowtype;
  v_title_en text := coalesce(app.safe_line(p_title_en), '');
  v_title_ar text := coalesce(app.safe_line(p_title_ar), '');
  v_answer   jsonb;
begin
  -- 1.
  v_c := app.coach_self();
  if p_lesson_type_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_type_id';
  end if;
  if p_venue_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_venue_id';
  end if;
  if char_length(v_title_en) > 80 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_title_en';
  end if;
  if char_length(v_title_ar) > 80 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_title_ar';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;
  v_answer := app.lesson_create_replay(p_idempotency_key, 'course', 'coach', v_c.profile_id, null);
  if v_answer is not null then
    return v_answer;
  end if;

  -- 2.
  select * into v_t from lesson_types where id = p_lesson_type_id and venue_id = p_venue_id;
  if v_t.id is null or v_t.kind <> 'course' then
    raise exception 'LESSON_TYPE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not (p_venue_id = any (app.open_venue_ids()))
     or not exists (select 1 from coach_branches b
                     where b.coach_id = v_c.id and b.venue_id = p_venue_id and b.active) then
    raise exception 'COACH_NOT_AT_BRANCH' using errcode = 'P0001';
  end if;
  if not coalesce((app.coaching_rules(p_venue_id)->>'coaching_enabled')::boolean, false) then
    raise exception 'COACHING_OFF' using errcode = 'P0001';
  end if;
  if v_c.status = 'paused' then
    raise exception 'COACH_INACTIVE' using errcode = 'P0001';
  end if;
  if not v_t.is_active then
    raise exception 'LESSON_TYPE_INACTIVE' using errcode = 'P0001';
  end if;
  if not exists (select 1 from coach_lesson_types ct where ct.coach_id = v_c.id and ct.lesson_type_id = v_t.id) then
    raise exception 'LESSON_TYPE_NOT_OFFERED' using errcode = 'P0001';
  end if;
  return app.lesson_course_create_internal(v_c.id, v_t.id, p_starts, v_title_en, v_title_ar, 'coach',
                                           v_c.profile_id, null, p_idempotency_key, true);
end $coach_create_course_0283$;

comment on function app.coach_create_course(uuid, uuid, timestamptz[], text, text, text) is
  '0283 (db.md §4.7.4; C-13, C-15, C-19, R15, R47, X13). Coach: create a course (one start per session, ascending; titles 0..80) at branch p_venue_id, all or nothing. coach_self; INVALID_ARGUMENT; replay (courses.idempotency_key); LESSON_TYPE_NOT_FOUND (a course type at the branch), COACH_NOT_AT_BRANCH, COACHING_OFF, COACH_INACTIVE, LESSON_TYPE_INACTIVE, LESSON_TYPE_NOT_OFFERED; then app.lesson_course_create_internal (COURSE_STARTS_INVALID count | order | span, per-start codes with the session number, LESSON_CLOSED cutoff, DEGRADED_LOCKOUT, COACH_BUSY, NO_COURT_FREE). Returns (X13) {duplicate, course_id, lesson_ids, sessions, price_iqd, cutoff_at, signup_closes_at, ...}.';

revoke all on function app.coach_create_course(uuid, uuid, timestamptz[], text, text, text) from public, anon;
grant execute on function app.coach_create_course(uuid, uuid, timestamptz[], text, text, text) to authenticated;

-- C-8, CD-9, R10, R39, R44, R48: the coach adds a student to their group
-- session (until its end: a walk-in during the session) or course (until
-- sign-up closes at the last start). No oracle: the answer, the work and
-- every refusal are the same whether or not the phone matched.
create or replace function app.coach_add_student(p_lesson_id uuid, p_course_id uuid, p_name text, p_phone text,
                                                 p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $coach_add_student_0283$
declare
  v_c      coaches%rowtype;
  v_name   text := app.safe_line(p_name);
  v_phone  text := nullif(app.safe_line(p_phone), '');
  v_e      lesson_enrolments%rowtype;
  v_l      lessons%rowtype;
  v_co     courses%rowtype;
  v_venue  uuid;
  v_offer  jsonb;
  v_gid    uuid;
  v_count  int;
  v_pass   int;
begin
  -- 1.
  v_c := app.coach_self();
  -- 2.
  if num_nonnulls(p_lesson_id, p_course_id) <> 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_id';
  end if;
  if v_name is null or char_length(v_name) not between 1 and 80 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_name';
  end if;
  if v_phone is not null
     and (app.phone_canon(v_phone) is null or coalesce(app.phone_digits(v_phone), '') !~ '^[0-9]{7,15}$') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_phone';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;

  -- 3. The replay first (a retried add never meets its own cap), then CD-9.
  perform app.lock_principal('coach_students', v_c.id);
  select * into v_e from lesson_enrolments where idempotency_key = p_idempotency_key;
  if v_e.id is not null then
    if v_e.booked_by_kind <> 'coach' or v_e.booked_by_profile_id is distinct from v_c.profile_id
       or v_e.lesson_id is distinct from p_lesson_id or v_e.course_id is distinct from p_course_id then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001', hint = 'that key belongs to another booking';
    end if;
    return jsonb_build_object('duplicate', true, 'enrolment_id', v_e.id,
                              'places_left', case when p_lesson_id is not null
                                               then greatest((select l.max_places from lessons l where l.id = p_lesson_id)
                                                             - app.lesson_places_taken(p_lesson_id), 0)
                                               else greatest((select co.max_places from courses co where co.id = p_course_id)
                                                             - app.course_places_taken(p_course_id), 0) end);
  end if;
  select count(*) into v_count
    from lesson_enrolments e
   where e.booked_by_kind = 'coach' and e.booked_by_profile_id = v_c.profile_id
     and e.created_at > now() - interval '24 hours';
  if v_count >= 30 then
    raise exception 'COACH_ADD_LIMIT' using errcode = 'P0001', detail = 'day';
  end if;

  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      -- 8.
      perform app.lock_coach(v_c.id);
      select * into v_e from lesson_enrolments where idempotency_key = p_idempotency_key;
      if v_e.id is not null then
        if v_e.booked_by_kind <> 'coach' or v_e.booked_by_profile_id is distinct from v_c.profile_id
           or v_e.lesson_id is distinct from p_lesson_id or v_e.course_id is distinct from p_course_id then
          raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001', hint = 'that key belongs to another booking';
        end if;
        return jsonb_build_object('duplicate', true, 'enrolment_id', v_e.id,
                                  'places_left', case when p_lesson_id is not null
                                                   then greatest(v_l.max_places - app.lesson_places_taken(v_l.id), 0)
                                                   else greatest(v_co.max_places - app.course_places_taken(v_co.id), 0) end);
      end if;
      select * into v_c from coaches c where c.id = v_c.id;
    end if;

    -- 4. Not the caller's, a private lesson or a course session: not found.
    if p_lesson_id is not null then
      select * into v_l from lessons l where l.id = p_lesson_id and l.coach_id = v_c.id;
      if v_l.id is null or v_l.kind <> 'group' or not (v_l.venue_id = any (app.open_venue_ids())) then
        raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
      end if;
      v_venue := v_l.venue_id;
    else
      select * into v_co from courses co where co.id = p_course_id and co.coach_id = v_c.id;
      if v_co.id is null or not (v_co.venue_id = any (app.open_venue_ids())) then
        raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
      end if;
      v_venue := v_co.venue_id;
    end if;
    -- 5.
    if not coalesce((app.coaching_rules(v_venue)->>'coaching_enabled')::boolean, false) then
      raise exception 'COACHING_OFF' using errcode = 'P0001';
    end if;
    if v_c.status <> 'active' then
      raise exception 'COACH_INACTIVE' using errcode = 'P0001';
    end if;
    -- 6. R39, R48.
    if p_lesson_id is not null then
      if v_l.status <> 'scheduled' or now() >= v_l.end_at then
        raise exception 'LESSON_CLOSED' using errcode = 'P0001';
      end if;
    else
      v_offer := app.lesson_course_offer(v_co.id);
      if v_co.status not in ('open', 'running') or now() >= v_co.signup_closes_at or v_offer is null then
        raise exception 'LESSON_CLOSED' using errcode = 'P0001';
      end if;
    end if;
    -- 7. R15.
    perform app.assert_not_degraded_for(coalesce(v_l.start_at, (v_offer->>'first_start_at')::timestamptz), v_venue);
    -- 8 (under the lock).
    if v_pass = 2 then
      if (p_lesson_id is not null and app.lesson_places_taken(v_l.id) + 1 > v_l.max_places)
         or (p_course_id is not null and app.course_places_taken(v_co.id) + 1 > v_co.max_places) then
        raise exception 'LESSON_FULL' using errcode = 'P0001';
      end if;
    end if;
  end loop;

  -- 9. The match (R10, R44); a profile already holding a live place here is
  -- simply not linked, never refused.
  v_gid := app.lesson_link_by_phone(v_phone, v_c.profile_id);
  if v_gid is not null
     and exists (select 1 from lesson_enrolments e
                  where e.guest_id = v_gid and e.status in ('held', 'booked')
                    and ((p_lesson_id is not null and e.lesson_id = p_lesson_id)
                         or (p_course_id is not null and e.course_id = p_course_id))) then
    v_gid := null;
  end if;

  -- 10, 11.
  begin
    v_e := app.lesson_student_add_internal(p_lesson_id, p_course_id, v_gid, false, v_name, v_phone, 'coach',
                                           v_c.profile_id, null, p_idempotency_key);
  exception when unique_violation then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001', hint = 'that key belongs to another booking';
  end;
  perform app.write_audit('coaching.student.add', 'lesson_enrolments', v_e.id::text, null,
                          jsonb_build_object('lesson_id', p_lesson_id, 'course_id', p_course_id,
                                             'enrolment_id', v_e.id, 'by', 'coach', 'linked', v_gid is not null));
  return jsonb_build_object('duplicate', false, 'enrolment_id', v_e.id,
                            'places_left', case when p_lesson_id is not null
                                             then greatest(v_l.max_places - app.lesson_places_taken(v_l.id), 0)
                                             else greatest(v_co.max_places - app.course_places_taken(v_co.id), 0) end);
end $coach_add_student_0283$;

comment on function app.coach_add_student(uuid, uuid, text, text, text) is
  '0283 (db.md §4.7.5; C-8, C-21, CD-9, R10, R15, R39, R44, R48). Coach: add a student (name 1..80, optional phone) to one of the caller''s group sessions (until it ends) or courses (until sign-up closes), desk-paid. coach_self; INVALID_ARGUMENT (exactly one of p_lesson_id, p_course_id; p_name; p_phone; key); lock_principal(coach_students), replay, COACH_ADD_LIMIT detail day; LESSON_NOT_FOUND (not the caller''s, a private lesson, a course session, a branch not open); COACHING_OFF; COACH_INACTIVE; LESSON_CLOSED; DEGRADED_LOCKOUT; under the coach lock the same again and LESSON_FULL. A typed phone matching a verified account (not the coach, not already holding a place here) links it pending (C-21). Event added; audit coaching.student.add (managers read linked; coaches cannot). Returns {duplicate, enrolment_id, places_left}: the same answer whether or not the phone matched.';

revoke all on function app.coach_add_student(uuid, uuid, text, text, text) from public, anon;
grant execute on function app.coach_add_student(uuid, uuid, text, text, text) to authenticated;

create or replace function app.coach_remove_student(p_enrolment_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $coach_remove_student_0283$
declare
  v_c    coaches%rowtype;
  v_code text;
  v_e    lesson_enrolments%rowtype;
  v_l    lessons%rowtype;
  v_pass int;
begin
  v_c := app.coach_self();
  v_code := app.lesson_reason_code(p_reason);
  if p_enrolment_id is null then
    raise exception 'ENROLMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform app.lock_coach(v_c.id);
    end if;
    select e.* into v_e
      from lesson_enrolments e
     where e.id = p_enrolment_id
       and (exists (select 1 from lessons l where l.id = e.lesson_id and l.coach_id = v_c.id)
            or exists (select 1 from courses co where co.id = e.course_id and co.coach_id = v_c.id));
    if v_e.id is null then
      raise exception 'ENROLMENT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_e.lesson_id is not null then
      select * into v_l from lessons where id = v_e.lesson_id;
      if v_l.kind = 'private' then
        raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'private';
      end if;
    end if;
    if v_e.status = 'cancelled' then
      return jsonb_build_object('ok', true, 'duplicate', true, 'enrolment_id', v_e.id, 'status', v_e.status);
    end if;
    if v_e.status not in ('held', 'booked') then
      raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'status';
    end if;
    if (v_e.lesson_id is not null and now() >= v_l.start_at)
       or (v_e.course_id is not null
           and not exists (select 1 from lessons s
                            where s.course_id = v_e.course_id and s.status = 'scheduled' and s.start_at > now()
                              and s.session_no between v_e.first_session_no
                                                   and v_e.first_session_no + v_e.sessions_covered - 1)) then
      raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'started';
    end if;
  end loop;

  perform app.enrolment_cancel_internal(v_e.id, 'coach', 'coach', v_c.profile_id, null);
  perform app.write_audit('coaching.student.remove', 'lesson_enrolments', v_e.id::text, null,
                          jsonb_build_object('enrolment_id', v_e.id, 'lesson_id', v_e.lesson_id,
                                             'course_id', v_e.course_id, 'reason', v_code),
                          p_reason);
  return jsonb_build_object('ok', true, 'duplicate', false, 'enrolment_id', v_e.id, 'status', 'cancelled');
end $coach_remove_student_0283$;

comment on function app.coach_remove_student(uuid, text) is
  '0283 (db.md §4.7.7; C-9). Coach: remove a student from one of the caller''s group sessions or courses (a coach cancel: refunds online money, never a strike, CD-2). coach_self; INVALID_ARGUMENT p_reason (<code> or <code>: <note>); ENROLMENT_NOT_FOUND (not in the caller''s lesson or course); LESSON_NOT_CANCELLABLE private (cancel the lesson instead) | status | started (a group session started; a course''s last covered session started); already cancelled -> {duplicate: true}; under the coach lock again; app.enrolment_cancel_internal(kind coach). Audit coaching.student.remove. Returns {ok, duplicate, enrolment_id, status}.';

revoke all on function app.coach_remove_student(uuid, text) from public, anon;
grant execute on function app.coach_remove_student(uuid, text) to authenticated;

create or replace function app.coach_cancel_lesson(p_lesson_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $coach_cancel_lesson_0283$
declare
  v_c    coaches%rowtype;
  v_code text;
  v_l    lessons%rowtype;
  v_r    jsonb;
  v_pass int;
begin
  v_c := app.coach_self();
  v_code := app.lesson_reason_code(p_reason);
  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform app.lock_coach(v_c.id);
    end if;
    select * into v_l from lessons l where l.id = p_lesson_id and l.coach_id = v_c.id;
    if v_l.id is null then
      raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
    end if;
    -- C-19: a course session moves or goes with its course.
    if v_l.course_id is not null then
      raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'course_session';
    end if;
    if v_l.status = 'cancelled' and v_l.cancel_reason = 'coach_cancel' then
      return jsonb_build_object('ok', true, 'duplicate', true, 'lesson_id', v_l.id, 'status', v_l.status);
    end if;
    if v_l.status not in ('held', 'scheduled') then
      raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'status';
    end if;
    if now() >= v_l.start_at then
      raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'started';
    end if;
  end loop;

  v_r := app.lesson_cancel_internal(v_l.id, 'coach_cancel', 'coach', v_c.profile_id, null);
  perform app.write_audit('coaching.lesson.cancel', 'lessons', v_l.id::text, null,
                          jsonb_build_object('lesson_id', v_l.id, 'by', 'coach', 'reason', v_code,
                                             'enrolments', v_r->'enrolments'),
                          p_reason);
  return jsonb_build_object('ok', true, 'duplicate', false, 'lesson_id', v_l.id, 'status', 'cancelled',
                            'enrolments', v_r->'enrolments', 'refunds_started', v_r->'refunds_started');
end $coach_cancel_lesson_0283$;

comment on function app.coach_cancel_lesson(uuid, text) is
  '0283 (db.md §4.7.7; C-9, C-19). Coach: cancel one of the caller''s private lessons or group sessions (coach_cancel: everyone refunded and told, never a strike). coach_self; INVALID_ARGUMENT p_reason; LESSON_NOT_FOUND (not the caller''s); LESSON_NOT_CANCELLABLE course_session (move it or cancel the course) | status | started; already cancelled by the coach -> {duplicate: true}; under the coach lock again; app.lesson_cancel_internal. Audit coaching.lesson.cancel. Returns {ok, duplicate, lesson_id, status, enrolments, refunds_started}.';

revoke all on function app.coach_cancel_lesson(uuid, text) from public, anon;
grant execute on function app.coach_cancel_lesson(uuid, text) to authenticated;

create or replace function app.coach_cancel_course(p_course_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $coach_cancel_course_0283$
declare
  v_c    coaches%rowtype;
  v_code text;
  v_co   courses%rowtype;
  v_r    jsonb;
  v_pass int;
begin
  v_c := app.coach_self();
  v_code := app.lesson_reason_code(p_reason);
  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform app.lock_coach(v_c.id);
    end if;
    select * into v_co from courses co where co.id = p_course_id and co.coach_id = v_c.id;
    if v_co.id is null then
      raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_co.status = 'cancelled' and v_co.cancel_reason = 'coach_cancel' then
      return jsonb_build_object('ok', true, 'duplicate', true, 'course_id', v_co.id, 'status', v_co.status);
    end if;
    if v_co.status not in ('open', 'running') then
      raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'status';
    end if;
    if not exists (select 1 from lessons s where s.course_id = v_co.id and s.status = 'scheduled'
                      and s.start_at > now()) then
      raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'ended';
    end if;
  end loop;

  v_r := app.course_cancel_internal(v_co.id, 'coach_cancel', 'coach', v_c.profile_id, null);
  perform app.write_audit('coaching.course.cancel', 'courses', v_co.id::text, null,
                          jsonb_build_object('course_id', v_co.id, 'by', 'coach', 'reason', v_code,
                                             'sessions_cancelled', v_r->'sessions_cancelled',
                                             'enrolments', v_r->'enrolments'),
                          p_reason);
  return jsonb_build_object('ok', true, 'duplicate', false, 'course_id', v_co.id, 'status', 'cancelled',
                            'sessions_cancelled', v_r->'sessions_cancelled', 'enrolments', v_r->'enrolments');
end $coach_cancel_course_0283$;

comment on function app.coach_cancel_course(uuid, text) is
  '0283 (db.md §4.7.7; C-19). Coach: cancel the rest of one of the caller''s courses (sessions not yet started; one refund per payment, R28). coach_self; INVALID_ARGUMENT p_reason; LESSON_NOT_FOUND; LESSON_NOT_CANCELLABLE status (not open or running) | ended (no session left to start); already cancelled by the coach -> {duplicate: true}; app.course_cancel_internal. Audit coaching.course.cancel. Returns {ok, duplicate, course_id, status, sessions_cancelled, enrolments}.';

revoke all on function app.coach_cancel_course(uuid, text) from public, anon;
grant execute on function app.coach_cancel_course(uuid, text) to authenticated;

-- The answer of a reschedule (RESCHEDULED) and of a court move.
create or replace function app.lesson_moved_answer(p_lesson_id uuid, p_duplicate boolean) returns jsonb
language sql stable security definer set search_path = public as $lesson_moved_answer_0283$
  select jsonb_build_object(
           'duplicate', coalesce(p_duplicate, false),
           'lesson_id', l.id,
           'start_at', l.start_at,
           'end_at', l.end_at,
           'rescheduled_at', l.rescheduled_at,
           'court_id', ct.court_id,
           'court_name_en', ct.name_en,
           'court_name_ar', ct.name_ar)
    from lessons l
    left join lateral (select r.court_id, c.name_en, c.name_ar
                         from reservations r join courts c on c.id = r.court_id
                        where r.lesson_id = l.id and r.status in ('pending', 'confirmed', 'arrived')
                        limit 1) ct on true
   where l.id = p_lesson_id
$lesson_moved_answer_0283$;

comment on function app.lesson_moved_answer(uuid, boolean) is
  '0283 (db.md §4.7.6, R41). Internal. {duplicate, lesson_id, start_at, end_at, rescheduled_at, court_id, court_name_en, court_name_ar} of a lesson after a reschedule or a court move.';

revoke all on function app.lesson_moved_answer(uuid, boolean) from public, anon, authenticated;

-- R8, R32, R47, R66: any kind moves in time while scheduled and not started,
-- on the grid, within the coach's hours, with no other lesson of the coach
-- over it (itself left out) and a court free. The caller has passed its guard
-- and found the lesson (theirs, or at a branch the staff member works at).
-- Level M: coach -> courts -> the lesson's court row FOR UPDATE -> stale
-- holds -> writes (R33). A course session keeps its order (the C-15 price
-- reads the session numbers). A judged cut-off keeps its stamp and the
-- session may move anywhere (R66, D-24); an unjudged one refuses a start
-- inside its cut-off (R47) and its cut-off follows the start (R32).
create or replace function app.lesson_reschedule_internal(p_lesson_id uuid, p_start_at timestamptz, p_actor text,
                                                          p_profile_id uuid, p_staff_id uuid, p_degraded boolean)
returns jsonb
language plpgsql security definer set search_path = public as $lesson_reschedule_internal_0283$
declare
  v_l      lessons%rowtype;
  v_co     courses%rowtype;
  v_prev   lessons%rowtype;
  v_next   lessons%rowtype;
  v_dur    interval;
  v_end    timestamptz;
  v_period tstzrange;
  v_from   timestamptz;
  v_locked uuid[];
  v_res    reservations%rowtype;
  v_court  uuid;
  v_delta  interval;
  v_pass   int;
begin
  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform app.lock_coach(v_l.coach_id);
    end if;
    select * into v_l from lessons where id = p_lesson_id;
    -- 2.
    if v_l.status = 'held' then
      raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'held';
    end if;
    if v_l.status <> 'scheduled' then
      raise exception 'SESSION_NOT_MOVABLE' using errcode = 'P0001', detail = 'ended';
    end if;
    if now() >= v_l.start_at then
      raise exception 'SESSION_NOT_MOVABLE' using errcode = 'P0001', detail = 'started';
    end if;
    if v_l.start_at = p_start_at then
      return app.lesson_moved_answer(v_l.id, true);
    end if;
    v_dur := v_l.end_at - v_l.start_at;
    v_end := p_start_at + v_dur;
    v_period := tstzrange(p_start_at, v_end, '[)');
    if v_l.course_id is not null then
      select * into v_co from courses where id = v_l.course_id;
    end if;

    if v_pass = 1 then
      -- 3.
      perform app.lesson_check_start(v_l.venue_id, p_start_at, v_end, null);
      if coalesce(p_degraded, false) then
        perform app.assert_not_degraded_for(p_start_at, v_l.venue_id);
      end if;
      -- 4. A course session keeps its place between its neighbours.
      if v_l.course_id is not null then
        select * into v_prev from lessons s
         where s.course_id = v_l.course_id and s.session_no < v_l.session_no and s.status <> 'cancelled'
         order by s.session_no desc limit 1;
        select * into v_next from lessons s
         where s.course_id = v_l.course_id and s.session_no > v_l.session_no and s.status <> 'cancelled'
         order by s.session_no limit 1;
        if (v_prev.id is not null and p_start_at < v_prev.end_at)
           or (v_next.id is not null and v_end > v_next.start_at) then
          raise exception 'SESSION_NOT_MOVABLE' using errcode = 'P0001', detail = 'order';
        end if;
      end if;
      -- 5. R47 on an unjudged cut-off only (R66).
      if v_l.kind = 'group' and v_l.cutoff_checked_at is null
         and p_start_at - (v_l.start_at - v_l.cutoff_at) <= now() then
        raise exception 'LESSON_CLOSED' using errcode = 'P0001', detail = 'cutoff';
      end if;
      if v_l.kind = 'course' and v_l.session_no = 1 and v_co.cutoff_checked_at is null
         and p_start_at - (v_l.start_at - v_co.cutoff_at) <= now() then
        raise exception 'LESSON_CLOSED' using errcode = 'P0001', detail = 'cutoff';
      end if;
      -- 6.
      if not app.coach_in_hours(v_l.coach_id, v_l.venue_id, v_period) then
        raise exception 'COACH_UNAVAILABLE' using errcode = 'P0001';
      end if;
    else
      -- 7. This lesson left out of the overlap test.
      perform app.lesson_coach_free(v_l.coach_id, v_l.venue_id, v_period, v_l.id, null);
    end if;
  end loop;

  -- 8. Courts, then the row, then stale holds (R33).
  v_locked := app.lesson_lock_branch_courts(v_l.venue_id);
  select r.* into v_res from reservations r
   where r.lesson_id = v_l.id and r.kind = 'lesson' and r.status in ('pending', 'confirmed', 'arrived')
   for update;
  perform app.match_expire_holds(v_l.venue_id, v_period);

  -- 9. Its own court when it is free then, else any locked court.
  if v_res.id is not null
     and v_res.court_id = any (v_locked)
     and not exists (select 1 from reservations r
                      where r.court_id = v_res.court_id and r.id <> v_res.id
                        and r.status in ('pending', 'confirmed', 'arrived') and r.period && v_period)
     and not app.match_court_claimed(v_res.court_id, v_period) then
    v_court := v_res.court_id;
  else
    v_court := app.lesson_pick_court(v_l.venue_id, v_period, v_locked);
  end if;
  if v_court is null then
    raise exception 'NO_COURT_FREE' using errcode = 'P0001';
  end if;

  -- 10.
  v_from := v_l.start_at;
  perform set_config('app.venue_id', v_l.venue_id::text, true);
  if v_res.id is not null then
    begin
      update reservations set court_id = v_court, start_at = p_start_at, end_at = v_end where id = v_res.id;
    exception when exclusion_violation then
      raise exception 'NO_COURT_FREE' using errcode = 'P0001';
    end;
  end if;
  begin
    update lessons set start_at = p_start_at, end_at = v_end, rescheduled_at = now(), updated_at = now()
     where id = v_l.id;
  exception when exclusion_violation then
    raise exception 'COACH_BUSY' using errcode = 'P0001';
  end;

  -- 11. The cut-off follows an unjudged session (R32, R66); the last start
  -- is when sign-up closes (C-15).
  if v_l.kind = 'group' and v_l.cutoff_checked_at is null then
    update lessons set cutoff_at = p_start_at - (v_l.start_at - v_l.cutoff_at) where id = v_l.id;
  elsif v_l.kind = 'course' then
    v_delta := p_start_at - v_l.start_at;
    if v_l.session_no = 1 and v_co.cutoff_checked_at is null then
      update courses set cutoff_at = cutoff_at + v_delta, updated_at = now() where id = v_co.id;
      update lessons set cutoff_at = cutoff_at + v_delta where course_id = v_co.id;
    end if;
    if v_l.session_no = v_co.sessions_count then
      update courses set signup_closes_at = p_start_at, updated_at = now() where id = v_co.id;
    end if;
  end if;

  -- 12.
  perform app.lesson_event(v_l.venue_id, v_l.id, v_l.course_id, null, 'rescheduled', p_actor, p_profile_id,
                           p_staff_id, null,
                           jsonb_build_object('from_start_at', v_from, 'to_start_at', p_start_at,
                                              'court_id', v_court, 'lesson_id', v_l.id));
  perform app.write_audit('coaching.reschedule', 'lessons', v_l.id::text,
                          jsonb_build_object('start_at', v_from, 'court_id', v_res.court_id),
                          jsonb_build_object('start_at', p_start_at, 'court_id', v_court, 'by', p_actor));
  return app.lesson_moved_answer(v_l.id, false);
end $lesson_reschedule_internal_0283$;

comment on function app.lesson_reschedule_internal(uuid, timestamptz, text, uuid, uuid, boolean) is
  '0283 (db.md §4.7.6; R8, R32, R33, R47, R66). Internal: the shared body of coach_reschedule_session and desk_reschedule_session. INVALID_TRANSITION detail held; SESSION_NOT_MOVABLE ended | started; the same start -> {duplicate: true}; SLOT_NOT_ON_GRID, SLOT_IN_PAST, CLOSED_DATE, OUTSIDE_HOURS; DEGRADED_LOCKOUT when p_degraded; SESSION_NOT_MOVABLE order (a course session stays between its live neighbours); LESSON_CLOSED cutoff (an unjudged cut-off only, R66); COACH_UNAVAILABLE; under the coach lock COACH_BUSY (itself left out); every court, the lesson''s court row FOR UPDATE, stale holds; its own court when free, else app.lesson_pick_court (NO_COURT_FREE). Stamps rescheduled_at; an unjudged cut-off follows the start (a course''s from session 1, on the course and every session); the last session''s start becomes signup_closes_at. Event rescheduled {from_start_at, to_start_at, court_id}; audit coaching.reschedule. Returns {duplicate, lesson_id, start_at, end_at, rescheduled_at, court_id, court_name_en, court_name_ar}.';

revoke all on function app.lesson_reschedule_internal(uuid, timestamptz, text, uuid, uuid, boolean)
  from public, anon, authenticated;

-- CD-11, CD-2, R31: a mark per session and enrolment, open from the start to
-- 24 hours after it. A no-show records a strike for a place the guest booked
-- (lesson_strike_record decides); attended or clear after a no-show deletes
-- the unsettled strike row without waiting (SKIP LOCKED: a row being settled
-- counts as settled and stays). The caller has passed its guard and found
-- the lesson.
create or replace function app.lesson_mark_internal(p_lesson_id uuid, p_enrolment_id uuid, p_status text,
                                                    p_actor text, p_profile_id uuid, p_staff_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $lesson_mark_internal_0283$
declare
  v_l    lessons%rowtype;
  v_e    lesson_enrolments%rowtype;
  v_cur  text;
  v_pass int;
begin
  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform app.lock_coach(v_l.coach_id);
    end if;
    select * into v_l from lessons where id = p_lesson_id;
    select e.* into v_e
      from lesson_enrolments e
     where e.id = p_enrolment_id
       and (e.lesson_id = v_l.id
            or (e.course_id is not null and e.course_id = v_l.course_id
                and v_l.session_no between e.first_session_no and e.first_session_no + e.sessions_covered - 1));
    if v_e.id is null then
      raise exception 'ENROLMENT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if now() < v_l.start_at then
      raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'not_started';
    end if;
    if now() >= v_l.start_at + interval '24 hours' then
      raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'marks_closed';
    end if;
    if v_e.status <> 'booked' then
      raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'not_booked';
    end if;
    if v_l.status not in ('scheduled', 'completed') then
      raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'cancelled';
    end if;
  end loop;

  select a.status into v_cur from lesson_attendance a where a.lesson_id = v_l.id and a.enrolment_id = v_e.id;
  if (p_status = 'clear' and v_cur is null) or v_cur = p_status then
    return jsonb_build_object('duplicate', true, 'lesson_id', v_l.id, 'enrolment_id', v_e.id,
                              'attendance', v_cur, 'status', v_cur);
  end if;

  perform set_config('app.venue_id', v_l.venue_id::text, true);
  if p_status = 'clear' then
    delete from lesson_attendance where lesson_id = v_l.id and enrolment_id = v_e.id;
  else
    insert into lesson_attendance (lesson_id, enrolment_id, venue_id, status, marked_by_kind, marked_by_profile_id,
                                   marked_by_staff_id, marked_at)
    values (v_l.id, v_e.id, v_l.venue_id, p_status, p_actor,
            case when p_actor = 'coach' then p_profile_id end,
            case when p_actor = 'staff' then p_staff_id end,
            now())
    on conflict (lesson_id, enrolment_id)
      do update set status = excluded.status, marked_by_kind = excluded.marked_by_kind,
                    marked_by_profile_id = excluded.marked_by_profile_id,
                    marked_by_staff_id = excluded.marked_by_staff_id, marked_at = excluded.marked_at;
  end if;

  if p_status = 'no_show' then
    perform app.lesson_strike_record(v_e.id, v_l.id, 'no_show');
  elsif v_cur = 'no_show' then
    -- R31: never waits on a strike row a settle holds.
    delete from lesson_strikes
     where ctid in (select s.ctid from lesson_strikes s
                     where s.enrolment_id = v_e.id and s.lesson_id = v_l.id and s.kind = 'no_show'
                       and s.settled_at is null
                     for update skip locked);
  end if;

  perform app.lesson_event(v_l.venue_id, v_l.id, v_l.course_id, v_e.id,
                           case p_status when 'attended' then 'attended' when 'no_show' then 'no_show'
                                         else 'unmarked' end,
                           p_actor, p_profile_id, p_staff_id);
  perform app.write_audit('coaching.attendance', 'lesson_attendance', v_l.id::text || ':' || v_e.id::text,
                          jsonb_build_object('status', v_cur),
                          jsonb_build_object('lesson_id', v_l.id, 'enrolment_id', v_e.id,
                                             'status', case when p_status = 'clear' then null else p_status end,
                                             'by', p_actor));
  return jsonb_build_object('duplicate', false, 'lesson_id', v_l.id, 'enrolment_id', v_e.id,
                            'attendance', case when p_status = 'clear' then null else p_status end,
                            'status', case when p_status = 'clear' then null else p_status end);
end $lesson_mark_internal_0283$;

comment on function app.lesson_mark_internal(uuid, uuid, text, text, uuid, uuid) is
  '0283 (db.md §4.7.8, §3.5; CD-2, CD-11, R31). Internal: the shared body of coach_mark_attendance and desk_mark_attendance. ENROLMENT_NOT_FOUND (not of this lesson, nor of its course covering the session); INVALID_TRANSITION not_started | marks_closed (24 h after the start) | not_booked | cancelled; under the coach lock again; the same mark -> {duplicate: true}. Upserts (or for clear deletes) the lesson_attendance row; no_show records a strike through app.lesson_strike_record (a place the guest booked only); attended or clear after a no-show deletes the unsettled strike row SKIP LOCKED. Event attended | no_show | unmarked; audit coaching.attendance. Returns {duplicate, lesson_id, enrolment_id, attendance, status}.';

revoke all on function app.lesson_mark_internal(uuid, uuid, text, text, uuid, uuid) from public, anon, authenticated;

create or replace function app.coach_mark_attendance(p_lesson_id uuid, p_enrolment_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = public as $coach_mark_attendance_0283$
declare
  v_c coaches%rowtype;
begin
  v_c := app.coach_self();
  if p_status is null or p_status not in ('attended', 'no_show', 'clear') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_status';
  end if;
  if not exists (select 1 from lessons l where l.id = p_lesson_id and l.coach_id = v_c.id) then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  return app.lesson_mark_internal(p_lesson_id, p_enrolment_id, p_status, 'coach', v_c.profile_id, null);
end $coach_mark_attendance_0283$;

comment on function app.coach_mark_attendance(uuid, uuid, text) is
  '0283 (db.md §4.7.8; CD-2, CD-11). Coach: mark a student of one of the caller''s sessions attended, no_show or clear. coach_self; INVALID_ARGUMENT p_status; LESSON_NOT_FOUND (not the caller''s); then app.lesson_mark_internal. Returns {duplicate, lesson_id, enrolment_id, attendance, status}.';

revoke all on function app.coach_mark_attendance(uuid, uuid, text) from public, anon;
grant execute on function app.coach_mark_attendance(uuid, uuid, text) to authenticated;

create or replace function app.coach_reschedule_session(p_lesson_id uuid, p_start_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $coach_reschedule_session_0283$
declare
  v_c coaches%rowtype;
begin
  v_c := app.coach_self();
  if p_lesson_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_id';
  end if;
  if p_start_at is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_start_at';
  end if;
  if not exists (select 1 from lessons l where l.id = p_lesson_id and l.coach_id = v_c.id) then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  return app.lesson_reschedule_internal(p_lesson_id, p_start_at, 'coach', v_c.profile_id, null, true);
end $coach_reschedule_session_0283$;

comment on function app.coach_reschedule_session(uuid, timestamptz) is
  '0283 (db.md §4.7.6; C-19, R8, R15, R32, R47, R66). Coach: move one of the caller''s lessons (any kind) to another start at the same branch. coach_self; INVALID_ARGUMENT; LESSON_NOT_FOUND (not the caller''s); then app.lesson_reschedule_internal with the degraded check (R15). Returns {duplicate, lesson_id, start_at, end_at, rescheduled_at, court_id, court_name_en, court_name_ar}.';

revoke all on function app.coach_reschedule_session(uuid, timestamptz) from public, anon;
grant execute on function app.coach_reschedule_session(uuid, timestamptz) to authenticated;

-- ===========================================================================
-- 5. Desk writes (db.md §4.7.4–§4.7.8; court_desk, manager, owner; R57)
--    A lesson, course or enrolment outside app.visible_venue_ids() is not
--    found; visible but not a branch the caller works at is VENUE_MISMATCH.
--    No COACHING_OFF (staging, D-12), no degraded check (as
--    staff_create_reservation), no horizon.
-- ===========================================================================

-- The desk's customer as a typed label (R44, R68): the profile's name and
-- phone copied into the enrolment's typed columns.
create or replace function app.lesson_customer_label(p_profile_id uuid) returns jsonb
language sql stable security definer set search_path = public as $lesson_customer_label_0283$
  select jsonb_build_object(
           'name', coalesce(nullif(left(app.safe_line(p.full_name), 80), ''), 'Guest'),
           'phone', case when coalesce(app.phone_digits(app.safe_line(p.phone)), '') ~ '^[0-9]{7,15}$'
                         then app.safe_line(p.phone) end)
    from profiles p
   where p.id = p_profile_id
$lesson_customer_label_0283$;

comment on function app.lesson_customer_label(uuid) is
  '0283 (R44, R68). Internal. {name, phone} of a customer the desk picked, as the enrolment''s typed columns keep them: the profile''s name (1..80, Guest when empty) and its phone when readable.';

revoke all on function app.lesson_customer_label(uuid) from public, anon, authenticated;

create or replace function app.desk_book_lesson(
  p_coach_id        uuid,
  p_lesson_type_id  uuid,
  p_start_at        timestamptz,
  p_customer_id     uuid,
  p_name            text,
  p_phone           text,
  p_party_size      int,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $desk_book_lesson_0283$
declare
  v_staff  uuid := auth.uid();
  v_name   text := app.safe_line(p_name);
  v_phone  text := nullif(app.safe_line(p_phone), '');
  v_label  jsonb;
  v_t      lesson_types%rowtype;
  v_c      coaches%rowtype;
  v_e      lesson_enrolments%rowtype;
  v_end    timestamptz;
  v_period tstzrange;
  v_price  bigint;
  v_locked uuid[];
  v_l      lessons%rowtype;
  v_gid    uuid;
begin
  -- R57: the role first.
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_coach_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_coach_id';
  end if;
  if p_lesson_type_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_type_id';
  end if;
  if p_start_at is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_start_at';
  end if;
  if num_nonnulls(p_customer_id, nullif(v_name, '')) <> 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_customer_id';
  end if;
  if p_customer_id is null and char_length(v_name) not between 1 and 80 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_name';
  end if;
  if p_customer_id is null and v_phone is not null
     and (app.phone_canon(v_phone) is null or coalesce(app.phone_digits(v_phone), '') !~ '^[0-9]{7,15}$') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_phone';
  end if;
  if p_party_size is null or p_party_size not between 1 and 4 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_party_size';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;

  select * into v_t from lesson_types where id = p_lesson_type_id;
  if v_t.id is null or v_t.kind <> 'private' or not (v_t.venue_id = any (app.visible_venue_ids())) then
    raise exception 'LESSON_TYPE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_t.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  if p_customer_id is not null then
    if not exists (select 1 from profiles p where p.id = p_customer_id and p.deleted_at is null) then
      raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_label := app.lesson_customer_label(p_customer_id);
  end if;

  -- The replay (rule 7: after the guard).
  select * into v_e from lesson_enrolments where idempotency_key = p_idempotency_key;
  if v_e.id is not null then
    if v_e.booked_by_kind <> 'staff' or v_e.booked_by_staff_id is distinct from v_staff or v_e.lesson_id is null then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001', hint = 'that key belongs to another booking';
    end if;
    return app.lesson_private_answer(v_e.id, true);
  end if;

  select * into v_c from coaches where id = p_coach_id;
  if v_c.id is null or v_c.status = 'retired' then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not exists (select 1 from coach_branches b where b.coach_id = v_c.id and b.venue_id = v_t.venue_id and b.active) then
    raise exception 'COACH_NOT_AT_BRANCH' using errcode = 'P0001';
  end if;
  if v_c.status = 'paused' then
    raise exception 'COACH_INACTIVE' using errcode = 'P0001';
  end if;
  if not v_t.is_active then
    raise exception 'LESSON_TYPE_INACTIVE' using errcode = 'P0001';
  end if;
  if not exists (select 1 from coach_lesson_types ct where ct.coach_id = v_c.id and ct.lesson_type_id = v_t.id) then
    raise exception 'LESSON_TYPE_NOT_OFFERED' using errcode = 'P0001';
  end if;
  if p_party_size > v_t.max_places then
    raise exception 'PARTY_TOO_LARGE' using errcode = 'P0001', detail = v_t.max_places::text;
  end if;
  -- R56.
  if p_customer_id is not null and p_customer_id = v_c.profile_id then
    raise exception 'ALREADY_ENROLLED' using errcode = 'P0001', detail = 'coach';
  end if;

  v_end := p_start_at + make_interval(mins => v_t.duration_min);
  v_period := tstzrange(p_start_at, v_end, '[)');
  perform app.lesson_check_start(v_t.venue_id, p_start_at, v_end, null);
  if not app.coach_in_hours(v_c.id, v_t.venue_id, v_period) then
    raise exception 'COACH_UNAVAILABLE' using errcode = 'P0001';
  end if;
  v_price := app.lesson_price_for(v_c.id, v_t.id);
  if v_price is null then
    raise exception 'LESSON_TYPE_INACTIVE' using errcode = 'P0001';
  end if;

  perform app.lock_coach(v_c.id);
  select * into v_e from lesson_enrolments where idempotency_key = p_idempotency_key;
  if v_e.id is not null then
    if v_e.booked_by_kind <> 'staff' or v_e.booked_by_staff_id is distinct from v_staff or v_e.lesson_id is null then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001', hint = 'that key belongs to another booking';
    end if;
    return app.lesson_private_answer(v_e.id, true);
  end if;
  perform app.lesson_coach_free(v_c.id, v_t.venue_id, v_period, null, null);

  v_locked := app.lesson_lock_branch_courts(v_t.venue_id);
  perform app.match_expire_holds(v_t.venue_id, v_period);

  -- R68: a picked customer is linked at once with their name and phone
  -- copied; a typed phone links pending, as a coach's (C-21).
  if p_customer_id is null then
    v_gid := app.lesson_link_by_phone(v_phone, v_c.profile_id);
  end if;
  begin
    v_l := app.lesson_create_internal(v_c.id, v_t.id, p_start_at, null, null, v_price, false, 'staff', null,
                                      v_staff, null, v_locked);
    perform set_config('app.venue_id', v_t.venue_id::text, true);
    insert into lesson_enrolments (venue_id, lesson_id, guest_id, guest_name, guest_phone, party_size, booked_by_kind,
                                   booked_by_staff_id, price_iqd, payment_mode, status, link_confirmed_at,
                                   idempotency_key)
    values (v_t.venue_id, v_l.id, coalesce(p_customer_id, v_gid),
            coalesce(v_label->>'name', v_name), case when p_customer_id is not null then v_label->>'phone' else v_phone end,
            p_party_size, 'staff', v_staff, v_price, 'desk', 'booked',
            case when p_customer_id is not null then now() end, p_idempotency_key)
    returning * into v_e;
  exception when unique_violation then
    select * into v_e from lesson_enrolments where idempotency_key = p_idempotency_key;
    if v_e.id is not null and v_e.booked_by_kind = 'staff' and v_e.booked_by_staff_id = v_staff
       and v_e.lesson_id is not null then
      return app.lesson_private_answer(v_e.id, true);
    end if;
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001', hint = 'that key belongs to another booking';
  end;

  perform app.lesson_event(v_t.venue_id, v_l.id, null, v_e.id, 'booked', 'staff', null, v_staff, null,
                           jsonb_build_object('court_id', (select r.court_id from reservations r
                                                            where r.lesson_id = v_l.id
                                                              and r.status in ('pending', 'confirmed')
                                                            limit 1),
                                              'party_size', p_party_size, 'lesson_id', v_l.id));
  perform app.lesson_event(v_t.venue_id, v_l.id, null, v_e.id, 'added', 'staff', null, v_staff, null,
                           jsonb_build_object('lesson_id', v_l.id));
  perform app.write_audit('coaching.lesson.book', 'lessons', v_l.id::text, null,
                          jsonb_build_object('lesson_id', v_l.id, 'enrolment_id', v_e.id, 'kind', 'private',
                                             'by', 'staff', 'customer_id', p_customer_id,
                                             'linked', v_gid is not null));
  return app.lesson_private_answer(v_e.id, false);
end $desk_book_lesson_0283$;

comment on function app.desk_book_lesson(uuid, uuid, timestamptz, uuid, text, text, int, text) is
  '0283 (db.md §4.7.4; C-8, C-21, D-12, R44, R56, R57, R68, X29). Desk (court_desk, manager, owner): book a private lesson for a picked customer (p_customer_id: linked at once, the profile''s name and phone copied) or a typed student (p_name, optional p_phone: a verified match links pending). FORBIDDEN (role first); INVALID_ARGUMENT (exactly one of p_customer_id and p_name; name, phone, party, key); LESSON_TYPE_NOT_FOUND (a private type at a visible branch); VENUE_MISMATCH; CUSTOMER_NOT_FOUND; replay; COACH_NOT_FOUND, COACH_NOT_AT_BRANCH, COACH_INACTIVE, LESSON_TYPE_INACTIVE, LESSON_TYPE_NOT_OFFERED, PARTY_TOO_LARGE, ALREADY_ENROLLED detail coach; SLOT_NOT_ON_GRID, SLOT_IN_PAST, CLOSED_DATE, OUTSIDE_HOURS; COACH_UNAVAILABLE; under the coach lock the replay and COACH_BUSY; every court; NO_COURT_FREE. Never COACHING_OFF, BEYOND_HORIZON or DEGRADED_LOCKOUT. Events booked and added; audit coaching.lesson.book. Returns (X29) {duplicate, lesson_id, enrolment_id, court_id, court_name_en, court_name_ar, start_at, end_at, price_iqd, ...}.';

revoke all on function app.desk_book_lesson(uuid, uuid, timestamptz, uuid, text, text, int, text) from public, anon;
grant execute on function app.desk_book_lesson(uuid, uuid, timestamptz, uuid, text, text, int, text) to authenticated;

create or replace function app.desk_create_group(p_coach_id uuid, p_lesson_type_id uuid, p_start_at timestamptz,
                                                 p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $desk_create_group_0283$
declare
  v_staff  uuid := auth.uid();
  v_t      lesson_types%rowtype;
  v_c      coaches%rowtype;
  v_answer jsonb;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_coach_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_coach_id';
  end if;
  if p_lesson_type_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_type_id';
  end if;
  if p_start_at is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_start_at';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;
  select * into v_t from lesson_types where id = p_lesson_type_id;
  if v_t.id is null or v_t.kind <> 'group' or not (v_t.venue_id = any (app.visible_venue_ids())) then
    raise exception 'LESSON_TYPE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_t.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  v_answer := app.lesson_create_replay(p_idempotency_key, 'group', 'staff', null, v_staff);
  if v_answer is not null then
    return v_answer;
  end if;
  select * into v_c from coaches where id = p_coach_id;
  if v_c.id is null or v_c.status = 'retired' then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not exists (select 1 from coach_branches b where b.coach_id = v_c.id and b.venue_id = v_t.venue_id and b.active) then
    raise exception 'COACH_NOT_AT_BRANCH' using errcode = 'P0001';
  end if;
  if v_c.status = 'paused' then
    raise exception 'COACH_INACTIVE' using errcode = 'P0001';
  end if;
  if not v_t.is_active then
    raise exception 'LESSON_TYPE_INACTIVE' using errcode = 'P0001';
  end if;
  if not exists (select 1 from coach_lesson_types ct where ct.coach_id = v_c.id and ct.lesson_type_id = v_t.id) then
    raise exception 'LESSON_TYPE_NOT_OFFERED' using errcode = 'P0001';
  end if;
  return app.lesson_group_create_internal(v_c.id, v_t.id, p_start_at, 'staff', null, v_staff, p_idempotency_key,
                                          false);
end $desk_create_group_0283$;

comment on function app.desk_create_group(uuid, uuid, timestamptz, text) is
  '0283 (db.md §4.7.4; C-13, D-12, R47, R57). Desk: create a group session for a coach. FORBIDDEN (role first); INVALID_ARGUMENT; LESSON_TYPE_NOT_FOUND (a group type at a visible branch); VENUE_MISMATCH; replay (created by the caller); COACH_NOT_FOUND, COACH_NOT_AT_BRANCH, COACH_INACTIVE, LESSON_TYPE_INACTIVE, LESSON_TYPE_NOT_OFFERED; then app.lesson_group_create_internal without the degraded check. Returns the group answer.';

revoke all on function app.desk_create_group(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function app.desk_create_group(uuid, uuid, timestamptz, text) to authenticated;

create or replace function app.desk_create_course(p_coach_id uuid, p_lesson_type_id uuid, p_starts timestamptz[],
                                                  p_title_en text, p_title_ar text, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $desk_create_course_0283$
declare
  v_staff    uuid := auth.uid();
  v_title_en text := coalesce(app.safe_line(p_title_en), '');
  v_title_ar text := coalesce(app.safe_line(p_title_ar), '');
  v_t        lesson_types%rowtype;
  v_c        coaches%rowtype;
  v_answer   jsonb;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_coach_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_coach_id';
  end if;
  if p_lesson_type_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_type_id';
  end if;
  if char_length(v_title_en) > 80 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_title_en';
  end if;
  if char_length(v_title_ar) > 80 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_title_ar';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;
  select * into v_t from lesson_types where id = p_lesson_type_id;
  if v_t.id is null or v_t.kind <> 'course' or not (v_t.venue_id = any (app.visible_venue_ids())) then
    raise exception 'LESSON_TYPE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_t.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  v_answer := app.lesson_create_replay(p_idempotency_key, 'course', 'staff', null, v_staff);
  if v_answer is not null then
    return v_answer;
  end if;
  select * into v_c from coaches where id = p_coach_id;
  if v_c.id is null or v_c.status = 'retired' then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not exists (select 1 from coach_branches b where b.coach_id = v_c.id and b.venue_id = v_t.venue_id and b.active) then
    raise exception 'COACH_NOT_AT_BRANCH' using errcode = 'P0001';
  end if;
  if v_c.status = 'paused' then
    raise exception 'COACH_INACTIVE' using errcode = 'P0001';
  end if;
  if not v_t.is_active then
    raise exception 'LESSON_TYPE_INACTIVE' using errcode = 'P0001';
  end if;
  if not exists (select 1 from coach_lesson_types ct where ct.coach_id = v_c.id and ct.lesson_type_id = v_t.id) then
    raise exception 'LESSON_TYPE_NOT_OFFERED' using errcode = 'P0001';
  end if;
  return app.lesson_course_create_internal(v_c.id, v_t.id, p_starts, v_title_en, v_title_ar, 'staff', null,
                                           v_staff, p_idempotency_key, false);
end $desk_create_course_0283$;

comment on function app.desk_create_course(uuid, uuid, timestamptz[], text, text, text) is
  '0283 (db.md §4.7.4; C-13, C-19, D-12, R47, R57, X13). Desk: create a course for a coach, all or nothing. FORBIDDEN (role first); INVALID_ARGUMENT (titles over 80, key); LESSON_TYPE_NOT_FOUND (a course type at a visible branch); VENUE_MISMATCH; replay; COACH_NOT_FOUND, COACH_NOT_AT_BRANCH, COACH_INACTIVE, LESSON_TYPE_INACTIVE, LESSON_TYPE_NOT_OFFERED; then app.lesson_course_create_internal without the degraded check. Returns (X13) the course answer.';

revoke all on function app.desk_create_course(uuid, uuid, timestamptz[], text, text, text) from public, anon;
grant execute on function app.desk_create_course(uuid, uuid, timestamptz[], text, text, text) to authenticated;

create or replace function app.desk_add_student(p_lesson_id uuid, p_course_id uuid, p_customer_id uuid, p_name text,
                                                p_phone text, p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path = public as $desk_add_student_0283$
declare
  v_staff  uuid := auth.uid();
  v_name   text := app.safe_line(p_name);
  v_phone  text := nullif(app.safe_line(p_phone), '');
  v_label  jsonb;
  v_l      lessons%rowtype;
  v_co     courses%rowtype;
  v_venue  uuid;
  v_coach  uuid;
  v_c      coaches%rowtype;
  v_e      lesson_enrolments%rowtype;
  v_gid    uuid;
  v_pass   int;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if num_nonnulls(p_lesson_id, p_course_id) <> 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_id';
  end if;
  if num_nonnulls(p_customer_id, nullif(v_name, '')) <> 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_customer_id';
  end if;
  if p_customer_id is null and char_length(v_name) not between 1 and 80 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_name';
  end if;
  if p_customer_id is null and v_phone is not null
     and (app.phone_canon(v_phone) is null or coalesce(app.phone_digits(v_phone), '') !~ '^[0-9]{7,15}$') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_phone';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;

  if p_lesson_id is not null then
    select * into v_l from lessons where id = p_lesson_id;
    if v_l.id is null or v_l.kind <> 'group' or not (v_l.venue_id = any (app.visible_venue_ids())) then
      raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_venue := v_l.venue_id;
    v_coach := v_l.coach_id;
  else
    select * into v_co from courses where id = p_course_id;
    if v_co.id is null or not (v_co.venue_id = any (app.visible_venue_ids())) then
      raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_venue := v_co.venue_id;
    v_coach := v_co.coach_id;
  end if;
  if not app.is_staff_at(v_venue, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  if p_customer_id is not null then
    if not exists (select 1 from profiles p where p.id = p_customer_id and p.deleted_at is null) then
      raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_label := app.lesson_customer_label(p_customer_id);
  end if;

  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform app.lock_coach(v_coach);
    end if;
    -- The replay (after the guard; again under the coach lock).
    select * into v_e from lesson_enrolments where idempotency_key = p_idempotency_key;
    if v_e.id is not null then
      if v_e.booked_by_kind <> 'staff' or v_e.booked_by_staff_id is distinct from v_staff
         or v_e.lesson_id is distinct from p_lesson_id or v_e.course_id is distinct from p_course_id then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001', hint = 'that key belongs to another booking';
      end if;
      return jsonb_build_object('duplicate', true, 'enrolment_id', v_e.id, 'price_iqd', v_e.price_iqd,
                                'places_left', case when p_lesson_id is not null
                                                 then greatest(v_l.max_places - app.lesson_places_taken(v_l.id), 0)
                                                 else greatest(v_co.max_places - app.course_places_taken(v_co.id), 0) end);
    end if;
    if p_lesson_id is not null then
      select * into v_l from lessons where id = p_lesson_id;
      if v_l.status <> 'scheduled' or now() >= v_l.end_at then
        raise exception 'LESSON_CLOSED' using errcode = 'P0001';
      end if;
    else
      select * into v_co from courses where id = p_course_id;
      if v_co.status not in ('open', 'running') or now() >= v_co.signup_closes_at
         or app.lesson_course_offer(v_co.id) is null then
        raise exception 'LESSON_CLOSED' using errcode = 'P0001';
      end if;
    end if;
    select * into v_c from coaches where id = v_coach;
    if v_c.status <> 'active' then
      raise exception 'COACH_INACTIVE' using errcode = 'P0001';
    end if;
    if v_pass = 2 then
      if (p_lesson_id is not null and app.lesson_places_taken(v_l.id) + 1 > v_l.max_places)
         or (p_course_id is not null and app.course_places_taken(v_co.id) + 1 > v_co.max_places) then
        raise exception 'LESSON_FULL' using errcode = 'P0001';
      end if;
    end if;
  end loop;

  -- A picked customer: staff may know (R56: detail coach for the coach).
  if p_customer_id is not null then
    if p_customer_id = v_c.profile_id then
      raise exception 'ALREADY_ENROLLED' using errcode = 'P0001', detail = 'coach';
    end if;
    if exists (select 1 from lesson_enrolments e
                where e.guest_id = p_customer_id and e.status in ('held', 'booked')
                  and ((p_lesson_id is not null and e.lesson_id = p_lesson_id)
                       or (p_course_id is not null and e.course_id = p_course_id))) then
      raise exception 'ALREADY_ENROLLED' using errcode = 'P0001';
    end if;
  else
    -- A typed phone links pending (R68), never a refusal.
    v_gid := app.lesson_link_by_phone(v_phone, v_c.profile_id);
    if v_gid is not null
       and exists (select 1 from lesson_enrolments e
                    where e.guest_id = v_gid and e.status in ('held', 'booked')
                      and ((p_lesson_id is not null and e.lesson_id = p_lesson_id)
                           or (p_course_id is not null and e.course_id = p_course_id))) then
      v_gid := null;
    end if;
  end if;

  begin
    v_e := app.lesson_student_add_internal(p_lesson_id, p_course_id, coalesce(p_customer_id, v_gid),
                                           p_customer_id is not null,
                                           coalesce(v_label->>'name', v_name),
                                           case when p_customer_id is not null then v_label->>'phone' else v_phone end,
                                           'staff', null, v_staff, p_idempotency_key);
  exception when unique_violation then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001', hint = 'that key belongs to another booking';
  end;
  perform app.write_audit('coaching.student.add', 'lesson_enrolments', v_e.id::text, null,
                          jsonb_build_object('lesson_id', p_lesson_id, 'course_id', p_course_id,
                                             'enrolment_id', v_e.id, 'by', 'staff', 'customer_id', p_customer_id,
                                             'linked', v_gid is not null));
  return jsonb_build_object('duplicate', false, 'enrolment_id', v_e.id, 'price_iqd', v_e.price_iqd,
                            'places_left', case when p_lesson_id is not null
                                             then greatest(v_l.max_places - app.lesson_places_taken(v_l.id), 0)
                                             else greatest(v_co.max_places - app.course_places_taken(v_co.id), 0) end);
end $desk_add_student_0283$;

comment on function app.desk_add_student(uuid, uuid, uuid, text, text, text) is
  '0283 (db.md §4.7.5; C-8, C-21, D-12, R39, R44, R48, R56, R57, R68, X29). Desk: add a picked customer (linked at once, name and phone copied) or a typed student (a verified phone match links pending) to a group session (until it ends) or a course (until sign-up closes), desk-paid. FORBIDDEN (role first); INVALID_ARGUMENT (one target; one of customer and name; name, phone, key); LESSON_NOT_FOUND (unknown, private, a course session, not visible); VENUE_MISMATCH; CUSTOMER_NOT_FOUND; replay; LESSON_CLOSED; COACH_INACTIVE; under the coach lock the same again and LESSON_FULL; ALREADY_ENROLLED (a picked customer already in; detail coach for the coach). No COACHING_OFF. Event added; audit coaching.student.add. Returns (X29) {duplicate, enrolment_id, price_iqd, places_left}.';

revoke all on function app.desk_add_student(uuid, uuid, uuid, text, text, text) from public, anon;
grant execute on function app.desk_add_student(uuid, uuid, uuid, text, text, text) to authenticated;

create or replace function app.desk_cancel_enrolment(p_enrolment_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $desk_cancel_enrolment_0283$
declare
  v_staff  uuid := auth.uid();
  v_code   text;
  v_e      lesson_enrolments%rowtype;
  v_coach  uuid;
  v_before jsonb;
  v_after  jsonb;
  v_r      jsonb;
  v_pass   int;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_code := app.lesson_reason_code(p_reason);
  select * into v_e from lesson_enrolments where id = p_enrolment_id;
  if v_e.id is null or not (v_e.venue_id = any (app.visible_venue_ids())) then
    raise exception 'ENROLMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_e.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  select coalesce((select l.coach_id from lessons l where l.id = v_e.lesson_id),
                  (select co.coach_id from courses co where co.id = v_e.course_id))
    into v_coach;

  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform app.lock_coach(v_coach);
      select * into v_e from lesson_enrolments where id = p_enrolment_id;
    end if;
    if v_e.status = 'cancelled' and v_e.cancel_kind = 'staff' then
      v_after := app.lesson_enrolment_money(v_e.id);
      return jsonb_build_object('duplicate', true, 'enrolment_id', v_e.id, 'status', v_e.status,
                                'refund_due_iqd', coalesce((v_after->>'refund_due_desk_iqd')::bigint, 0),
                                'online_refund', 0);
    end if;
    if v_e.status not in ('held', 'booked') then
      raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'status';
    end if;
    if (v_e.lesson_id is not null
        and exists (select 1 from lessons l where l.id = v_e.lesson_id and l.end_at <= now()))
       or (v_e.course_id is not null
           and not exists (select 1 from lessons s
                            where s.course_id = v_e.course_id and s.end_at > now()
                              and s.session_no between v_e.first_session_no
                                                   and v_e.first_session_no + v_e.sessions_covered - 1)) then
      raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'ended';
    end if;
  end loop;

  v_before := app.lesson_enrolment_money(v_e.id);
  v_r := app.enrolment_cancel_internal(v_e.id, 'staff', 'staff', null, v_staff);
  v_after := app.lesson_enrolment_money(v_e.id);
  perform app.write_audit('coaching.student.remove', 'lesson_enrolments', v_e.id::text, null,
                          jsonb_build_object('enrolment_id', v_e.id, 'lesson_id', v_e.lesson_id,
                                             'course_id', v_e.course_id, 'by', 'staff', 'reason', v_code,
                                             'lesson_cancelled', v_r->'lesson_cancelled'),
                          p_reason);
  return jsonb_build_object(
    'duplicate', false,
    'enrolment_id', v_e.id,
    'status', 'cancelled',
    'lesson_cancelled', coalesce((v_r->>'lesson_cancelled')::boolean, false),
    'refunds_started', coalesce((v_r->>'refunds_started')::int, 0),
    'refund_due_iqd', coalesce((v_after->>'refund_due_desk_iqd')::bigint, 0),
    'online_refund', greatest(coalesce((v_after->>'online_refunded_iqd')::bigint, 0)
                              - coalesce((v_before->>'online_refunded_iqd')::bigint, 0), 0));
end $desk_cancel_enrolment_0283$;

comment on function app.desk_cancel_enrolment(uuid, text) is
  '0283 (db.md §4.7.7; C-9, CD-2, X29). Desk: cancel one place (a private lesson goes with it as staff_cancel). FORBIDDEN (role first); INVALID_ARGUMENT p_reason; ENROLMENT_NOT_FOUND (unknown, not visible); VENUE_MISMATCH; already cancelled by staff -> {duplicate: true}; LESSON_NOT_CANCELLABLE status | ended (the lesson, or the course''s last covered session, has ended); under the coach lock again; app.enrolment_cancel_internal(kind staff): online money refunded through Money''s engine, never a strike. Audit coaching.student.remove. Returns (X29) {duplicate, enrolment_id, status, lesson_cancelled, refunds_started, refund_due_iqd (desk money now due back), online_refund (the amount the online refund started)}.';

revoke all on function app.desk_cancel_enrolment(uuid, text) from public, anon;
grant execute on function app.desk_cancel_enrolment(uuid, text) to authenticated;

create or replace function app.desk_cancel_lesson(p_lesson_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $desk_cancel_lesson_0283$
declare
  v_staff uuid := auth.uid();
  v_code  text;
  v_l     lessons%rowtype;
  v_r     jsonb;
  v_pass  int;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_code := app.lesson_reason_code(p_reason);
  select * into v_l from lessons where id = p_lesson_id;
  if v_l.id is null or not (v_l.venue_id = any (app.visible_venue_ids())) then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_l.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform app.lock_coach(v_l.coach_id);
      select * into v_l from lessons where id = p_lesson_id;
    end if;
    if v_l.course_id is not null then
      raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'course_session';
    end if;
    if v_l.status = 'cancelled' and v_l.cancel_reason = 'staff_cancel' then
      return jsonb_build_object('duplicate', true, 'lesson_id', v_l.id, 'status', v_l.status);
    end if;
    if v_l.status not in ('held', 'scheduled') then
      raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'status';
    end if;
    if now() >= v_l.start_at then
      raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'started';
    end if;
  end loop;

  v_r := app.lesson_cancel_internal(v_l.id, 'staff_cancel', 'staff', null, v_staff);
  perform app.write_audit('coaching.lesson.cancel', 'lessons', v_l.id::text, null,
                          jsonb_build_object('lesson_id', v_l.id, 'by', 'staff', 'reason', v_code,
                                             'enrolments', v_r->'enrolments'),
                          p_reason);
  return jsonb_build_object('duplicate', false, 'lesson_id', v_l.id, 'status', 'cancelled',
                            'enrolments', v_r->'enrolments', 'refunds_started', v_r->'refunds_started');
end $desk_cancel_lesson_0283$;

comment on function app.desk_cancel_lesson(uuid, text) is
  '0283 (db.md §4.7.7; C-9, C-19, X29). Desk: cancel a private lesson or a group session (staff_cancel). FORBIDDEN (role first); INVALID_ARGUMENT p_reason; LESSON_NOT_FOUND (unknown, not visible); VENUE_MISMATCH; LESSON_NOT_CANCELLABLE course_session | status | started; already cancelled by staff -> {duplicate: true}; under the coach lock; app.lesson_cancel_internal. Audit coaching.lesson.cancel. Returns {duplicate, lesson_id, status, enrolments, refunds_started}.';

revoke all on function app.desk_cancel_lesson(uuid, text) from public, anon;
grant execute on function app.desk_cancel_lesson(uuid, text) to authenticated;

create or replace function app.desk_cancel_course(p_course_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $desk_cancel_course_0283$
declare
  v_staff uuid := auth.uid();
  v_code  text;
  v_co    courses%rowtype;
  v_r     jsonb;
  v_pass  int;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_code := app.lesson_reason_code(p_reason);
  select * into v_co from courses where id = p_course_id;
  if v_co.id is null or not (v_co.venue_id = any (app.visible_venue_ids())) then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_co.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform app.lock_coach(v_co.coach_id);
      select * into v_co from courses where id = p_course_id;
    end if;
    if v_co.status = 'cancelled' and v_co.cancel_reason = 'staff_cancel' then
      return jsonb_build_object('duplicate', true, 'course_id', v_co.id, 'status', v_co.status,
                                'sessions_cancelled', 0);
    end if;
    if v_co.status not in ('open', 'running') then
      raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'status';
    end if;
    if not exists (select 1 from lessons s where s.course_id = v_co.id and s.status = 'scheduled'
                      and s.start_at > now()) then
      raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'ended';
    end if;
  end loop;

  v_r := app.course_cancel_internal(v_co.id, 'staff_cancel', 'staff', null, v_staff);
  perform app.write_audit('coaching.course.cancel', 'courses', v_co.id::text, null,
                          jsonb_build_object('course_id', v_co.id, 'by', 'staff', 'reason', v_code,
                                             'sessions_cancelled', v_r->'sessions_cancelled',
                                             'enrolments', v_r->'enrolments'),
                          p_reason);
  return jsonb_build_object('duplicate', false, 'course_id', v_co.id, 'status', 'cancelled',
                            'sessions_cancelled', v_r->'sessions_cancelled', 'enrolments', v_r->'enrolments');
end $desk_cancel_course_0283$;

comment on function app.desk_cancel_course(uuid, text) is
  '0283 (db.md §4.7.7; C-19, X29). Desk: cancel the rest of a course (staff_cancel; one refund per payment). FORBIDDEN (role first); INVALID_ARGUMENT p_reason; LESSON_NOT_FOUND (unknown, not visible); VENUE_MISMATCH; LESSON_NOT_CANCELLABLE status | ended; already cancelled by staff -> {duplicate: true}; app.course_cancel_internal. Audit coaching.course.cancel. Returns (X29) {duplicate, course_id, status, sessions_cancelled, enrolments}.';

revoke all on function app.desk_cancel_course(uuid, text) from public, anon;
grant execute on function app.desk_cancel_course(uuid, text) to authenticated;

create or replace function app.desk_reschedule_session(p_lesson_id uuid, p_start_at timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $desk_reschedule_session_0283$
declare
  v_l lessons%rowtype;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_lesson_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_id';
  end if;
  if p_start_at is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_start_at';
  end if;
  select * into v_l from lessons where id = p_lesson_id;
  if v_l.id is null or not (v_l.venue_id = any (app.visible_venue_ids())) then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_l.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  return app.lesson_reschedule_internal(p_lesson_id, p_start_at, 'staff', null, auth.uid(), false);
end $desk_reschedule_session_0283$;

comment on function app.desk_reschedule_session(uuid, timestamptz) is
  '0283 (db.md §4.7.6; R8, R32, R47, R66, X29). Desk: move any lesson to another start at its branch. FORBIDDEN (role first); INVALID_ARGUMENT; LESSON_NOT_FOUND (unknown, not visible); VENUE_MISMATCH; then app.lesson_reschedule_internal (no degraded check). Returns {duplicate, lesson_id, start_at, end_at, rescheduled_at, court_id, court_name_en, court_name_ar}.';

revoke all on function app.desk_reschedule_session(uuid, timestamptz) from public, anon;
grant execute on function app.desk_reschedule_session(uuid, timestamptz) to authenticated;

-- C-10, R7: the only way a lesson changes court (move_reservation refuses a
-- lesson row, 0280). Level M; same times, same branch; a running lesson may
-- move; not R22-guarded, like every move.
create or replace function app.desk_move_lesson_court(p_lesson_id uuid, p_court_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $desk_move_lesson_court_0283$
declare
  v_staff  uuid := auth.uid();
  v_l      lessons%rowtype;
  v_res    reservations%rowtype;
  v_locked uuid[];
  v_pass   int;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_lesson_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_id';
  end if;
  if p_court_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_court_id';
  end if;
  select * into v_l from lessons where id = p_lesson_id;
  if v_l.id is null or not (v_l.venue_id = any (app.visible_venue_ids())) then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_l.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform app.lock_coach(v_l.coach_id);
      select * into v_l from lessons where id = p_lesson_id;
    end if;
    if v_l.status = 'held' then
      raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'held';
    end if;
    if v_l.status <> 'scheduled' or now() >= v_l.end_at then
      raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'ended';
    end if;
    if not exists (select 1 from courts c where c.id = p_court_id and c.venue_id = v_l.venue_id and c.is_active) then
      raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if exists (select 1 from reservations r
                where r.lesson_id = v_l.id and r.kind = 'lesson' and r.court_id = p_court_id
                  and r.status in ('pending', 'confirmed', 'arrived')) then
      return app.lesson_moved_answer(v_l.id, true);
    end if;
  end loop;

  v_locked := app.lesson_lock_branch_courts(v_l.venue_id);
  select r.* into v_res from reservations r
   where r.lesson_id = v_l.id and r.kind = 'lesson' and r.status in ('pending', 'confirmed', 'arrived')
   for update;
  perform app.match_expire_holds(v_l.venue_id, v_l.period);
  -- R34: only a court this body locked.
  if not (p_court_id = any (v_locked)) then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_res.id is null then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'ended';
  end if;
  if exists (select 1 from reservations r
              where r.court_id = p_court_id and r.id <> v_res.id
                and r.status in ('pending', 'confirmed', 'arrived') and r.period && v_res.period) then
    raise exception 'NO_COURT_FREE' using errcode = 'P0001';
  end if;

  perform set_config('app.venue_id', v_l.venue_id::text, true);
  begin
    update reservations set court_id = p_court_id where id = v_res.id;
  exception when exclusion_violation then
    raise exception 'NO_COURT_FREE' using errcode = 'P0001';
  end;

  perform app.lesson_event(v_l.venue_id, v_l.id, v_l.course_id, null, 'court_moved', 'staff', null, v_staff, null,
                           jsonb_build_object('from_court_id', v_res.court_id, 'to_court_id', p_court_id,
                                              'lesson_id', v_l.id));
  perform app.write_audit('coaching.court_move', 'lessons', v_l.id::text,
                          jsonb_build_object('court_id', v_res.court_id),
                          jsonb_build_object('court_id', p_court_id));
  return app.lesson_moved_answer(v_l.id, false);
end $desk_move_lesson_court_0283$;

comment on function app.desk_move_lesson_court(uuid, uuid) is
  '0283 (db.md §4.7.6; C-10, R7, R33, R34, X31). Desk: move a lesson to another active court of its branch at the same times (a running lesson may move). FORBIDDEN (role first); INVALID_ARGUMENT; LESSON_NOT_FOUND (unknown, not visible); VENUE_MISMATCH; INVALID_TRANSITION held | ended; COURT_NOT_FOUND (not an active court of the branch); the same court -> {duplicate: true}; under the coach lock again; every court, the lesson''s court row FOR UPDATE, stale holds; COURT_NOT_FOUND unless locked (R34); NO_COURT_FREE (a live row there). Event court_moved {from_court_id, to_court_id}; audit coaching.court_move. Returns {duplicate, lesson_id, court_id, court_name_en, court_name_ar, start_at, end_at, rescheduled_at}.';

revoke all on function app.desk_move_lesson_court(uuid, uuid) from public, anon;
grant execute on function app.desk_move_lesson_court(uuid, uuid) to authenticated;

create or replace function app.desk_mark_attendance(p_lesson_id uuid, p_enrolment_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = public as $desk_mark_attendance_0283$
declare
  v_l lessons%rowtype;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_status is null or p_status not in ('attended', 'no_show', 'clear') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_status';
  end if;
  select * into v_l from lessons where id = p_lesson_id;
  if v_l.id is null or not (v_l.venue_id = any (app.visible_venue_ids())) then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_l.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  return app.lesson_mark_internal(p_lesson_id, p_enrolment_id, p_status, 'staff', null, auth.uid());
end $desk_mark_attendance_0283$;

comment on function app.desk_mark_attendance(uuid, uuid, text) is
  '0283 (db.md §4.7.8; CD-2, CD-11). Desk: mark a student attended, no_show or clear. FORBIDDEN (role first); INVALID_ARGUMENT p_status; LESSON_NOT_FOUND (unknown, not visible); VENUE_MISMATCH; then app.lesson_mark_internal. Returns {duplicate, lesson_id, enrolment_id, attendance, status}.';

revoke all on function app.desk_mark_attendance(uuid, uuid, text) from public, anon;
grant execute on function app.desk_mark_attendance(uuid, uuid, text) to authenticated;

-- ===========================================================================
-- 6. set_coach_status (db.md §4.7.7; R16, R45, C-25, R43)
-- ===========================================================================

-- active <-> paused changes the status only (a paused coach is hidden from
-- guests and books nothing new; their lessons run). Retiring is never
-- refused: every upcoming lesson that is not a course session, at every
-- branch, and every course with a session left to start are cancelled as
-- coach_retired (refunds and pushes, as any coach cancel); sessions in
-- progress run to their end; the photo folder is queued for removal and the
-- path cleared (R43). A retired coach comes back only through coach_promote.
create or replace function app.set_coach_status(p_coach_id uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $set_coach_status_0283$
declare
  v_staff   uuid := auth.uid();
  v_reason  text := nullif(app.safe_line(p_reason), '');
  v_c       coaches%rowtype;
  v_from    text;
  v_x       record;
  v_r       jsonb;
  v_lessons int := 0;
  v_courses int := 0;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_status is null or p_status not in ('active', 'paused', 'retired') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_status';
  end if;
  if char_length(coalesce(v_reason, '')) > 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reason';
  end if;
  if p_coach_id is not null then
    select * into v_c from coaches where id = p_coach_id;
  end if;
  if v_c.id is null then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.coach_staff_scope(v_c.id) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  perform app.lock_coach(v_c.id);
  select * into v_c from coaches where id = p_coach_id;
  if v_c.status = p_status then
    return jsonb_build_object('coach_id', v_c.id, 'status', v_c.status, 'lessons_cancelled', 0,
                              'courses_cancelled', 0, 'duplicate', true);
  end if;
  if v_c.status = 'retired' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'retired';
  end if;
  v_from := v_c.status;

  if p_status = 'retired' then
    for v_x in
      select l.id, l.venue_id from lessons l
       where l.coach_id = v_c.id and l.course_id is null
         and l.status in ('held', 'scheduled') and l.start_at > now()
       order by l.start_at, l.id
    loop
      perform set_config('app.venue_id', v_x.venue_id::text, true);
      v_r := app.lesson_cancel_internal(v_x.id, 'coach_retired', 'staff', null, v_staff);
      if coalesce((v_r->>'changed')::boolean, false) then
        v_lessons := v_lessons + 1;
      end if;
    end loop;
    for v_x in
      select co.id, co.venue_id from courses co
       where co.coach_id = v_c.id and co.status in ('open', 'running')
         and exists (select 1 from lessons s where s.course_id = co.id and s.status = 'scheduled'
                        and s.start_at > now())
       order by co.id
    loop
      perform set_config('app.venue_id', v_x.venue_id::text, true);
      v_r := app.course_cancel_internal(v_x.id, 'coach_retired', 'staff', null, v_staff);
      if coalesce((v_r->>'changed')::boolean, false) then
        v_courses := v_courses + 1;
      end if;
    end loop;

    -- R43: the photo folder is queued for removal before the path is cleared.
    if v_c.photo_path is not null then
      insert into coach_photo_purges (coach_id, folder)
      values (v_c.id, substring(v_c.photo_path from '^(coaches/[0-9a-f-]{36})/'));
    end if;
    update coaches
       set status = 'retired', retired_at = now(), photo_path = null, updated_at = now()
     where id = v_c.id;
  else
    update coaches set status = p_status, updated_at = now() where id = v_c.id;
  end if;

  perform app.write_audit('coaching.coach.status', 'coaches', v_c.id::text,
                          jsonb_build_object('status', v_from),
                          jsonb_build_object('status', p_status, 'lessons_cancelled', v_lessons,
                                             'courses_cancelled', v_courses),
                          v_reason);
  return jsonb_build_object('coach_id', v_c.id, 'status', p_status, 'lessons_cancelled', v_lessons,
                            'courses_cancelled', v_courses, 'duplicate', false);
end $set_coach_status_0283$;

comment on function app.set_coach_status(uuid, text, text) is
  '0283 (db.md §4.7.7; C-25, R16, R43, R45, X29). Manager (coach in scope) and owner: pause, resume or retire a coach. FORBIDDEN (role); INVALID_ARGUMENT p_status | p_reason (over 200); COACH_NOT_FOUND; FORBIDDEN (scope); under the coach lock: the same status -> {duplicate: true}; a retired coach comes back only through coach_promote (INVALID_TRANSITION detail retired). Retiring is never refused: every held or scheduled lesson of the coach not yet started that is not a course session, at every branch, through app.lesson_cancel_internal(coach_retired), every open or running course with a session left to start through app.course_cancel_internal(coach_retired); then retired_at, the photo folder queued in coach_photo_purges and photo_path NULL. Audit coaching.coach.status with the counts. Returns (X29) {coach_id, status, lessons_cancelled, courses_cancelled, duplicate}.';

revoke all on function app.set_coach_status(uuid, text, text) from public, anon;
grant execute on function app.set_coach_status(uuid, text, text) to authenticated;

-- ===========================================================================
-- 0283 lesson_booking, PART 2 (0283b): the coaching reads and the push fan-out
-- (docs/design/coaching/db.md §4.7.9, §4.7.10, §5.2; guest.md §4.3, §4.5;
-- operator.md §5.6; build contracts §1.5, §1.6, §1.7, §1.9, R12, R17, R18,
-- R20, R40, R41, R43, R44, R45, R51, R54, R58, R61, R76, R78, R81).
--
-- The verifier appends this part to 0283a (DB's bodies) to make one 0283
-- file: the `set lock_timeout` / `set statement_timeout` header is 0283a's.
-- Every function here is plpgsql unless it reads only tables, so a call to a
-- function of 0282, 0283a or Money's 0281 binds at run time.
--
--   1. Guest's push part (lane Guest, R18, R40):
--        app.lesson_notify            the one queue for the lesson family
--        app.lesson_sync_reminders    lesson.reminder upkeep; called only by
--                                     the two reminder triggers below
--        lessons_reminders, lesson_enrolments_reminders_ins/_upd
--                                     deferred constraint triggers (R78)
--        lesson_events_notify         AFTER INSERT on lesson_events: the
--                                     whole (type, code, actor, enrolment) ->
--                                     key mapping of guest.md §4.5.4
--   2. Helpers this part owns (lesson_read_*, internal)
--   3. Public reads (anon + authenticated, publicByDesign, R12):
--        coaching_public, coach_profile, coach_slots, lesson_offer
--   4. Guest reads: my_lessons, my_lesson (lesson_guest(false) first)
--   5. Coach reads: coach_schedule, coach_lesson (coach_self() first; a
--      retired coach is NOT_A_COACH, R45). coach_me is 0282's.
--   6. Desk reads: desk_lessons (R20 envelope), desk_lesson_detail,
--      customer_lessons (role first, R57)
--
-- Keys: every answer carries at least the keys of
-- packages/core/src/coaching/shapes.ts COACHING_SHAPES (R41, R81); a few
-- extra keys are added where a lane file names them.
--
-- Privacy (R43, R44, R54, R58): no public answer carries a profiles.id, a
-- student, a guest phone or a court id; the only phone is the branch's. A
-- coach- or staff-booked student is shown as typed, never by the linked
-- profile; a coach sees a phone until end_at + 7 days and never while the
-- place is held.
--
-- Pushes (R40): DB's and Money's bodies write lesson_events rows; the
-- lesson_events_notify trigger is the only queuer of every lesson.* and
-- coach.* key except coach.statement_ready and coach.statement_paid (Money's
-- approve and mark-paid call lesson_notify directly, 0287). No body here or in
-- 0283a calls lesson_sync_reminders: the reminder triggers follow row state.
--
-- Locks: nothing here takes a lock. The triggers read lessons, courses and
-- lesson_enrolments without FOR UPDATE and write only notification_outbox,
-- which is not in the lock ORDER.
--
-- Functions of other files called here (bound late, by name):
--   0277 app.coaching_rules (not called; settings read directly)
--   0281 (Money) app.lesson_enrolment_money, app.lesson_fee_remaining,
--        app.course_late_join_price
--   0282 app.coach_self, app.coach_available, app.lesson_on_grid,
--        app.lesson_bookable, app.lesson_price_for
--   0283a app.lesson_guest, app.lesson_places_taken, app.course_places_taken
--   existing: app.open_venue_ids, app.visible_venue_ids, app.is_staff,
--        app.is_staff_at, app.current_venue, app.is_degraded,
--        app.match_court_claimed, app.customer_flags_json, app.push_nudge

-- ===========================================================================
-- 1. Guest's push part (guest.md §4.5)
-- ===========================================================================

-- Enrolments covering one session: the lesson's own, or a course enrolment
-- whose covered session numbers include it. Any status; callers filter.
create or replace function app.lesson_read_covering(p_lesson_id uuid) returns setof lesson_enrolments
language sql stable security definer set search_path = public as $lesson_read_covering_0283$
  select e.* from lesson_enrolments e where e.lesson_id = p_lesson_id
  union all
  select e.*
    from lessons l
    join lesson_enrolments e on e.course_id = l.course_id
   where l.id = p_lesson_id
     and l.course_id is not null
     and l.session_no between e.first_session_no and e.first_session_no + e.sessions_covered - 1
$lesson_read_covering_0283$;

comment on function app.lesson_read_covering(uuid) is
  '0283 (Guest part). Internal. The enrolments covering one lesson session: enrolments of the lesson itself, or course enrolments whose covered sessions (first_session_no .. first_session_no + sessions_covered - 1) include it. Every status; callers filter.';

revoke all on function app.lesson_read_covering(uuid) from public, anon, authenticated;

-- The sessions one enrolment covers: its lesson, or its course's covered
-- session numbers. Any status; callers order and filter.
create or replace function app.lesson_read_covered(p_enrolment_id uuid) returns setof lessons
language sql stable security definer set search_path = public as $lesson_read_covered_0283$
  select l.*
    from lesson_enrolments e
    join lessons l on l.id = e.lesson_id
   where e.id = p_enrolment_id
  union all
  select l.*
    from lesson_enrolments e
    join lessons l on l.course_id = e.course_id
   where e.id = p_enrolment_id
     and e.course_id is not null
     and l.session_no between e.first_session_no and e.first_session_no + e.sessions_covered - 1
$lesson_read_covered_0283$;

comment on function app.lesson_read_covered(uuid) is
  '0283 (Guest part). Internal. The lesson sessions one enrolment covers: its lesson, or the sessions of its course numbered first_session_no .. first_session_no + sessions_covered - 1. Every status; callers filter and order.';

revoke all on function app.lesson_read_covered(uuid) from public, anon, authenticated;

-- A course's reference session for a course-wide push (guest.md §4.5.1): its
-- first session starting after now (live or just cancelled), else its last.
create or replace function app.lesson_read_course_ref(p_course_id uuid) returns uuid
language sql stable security definer set search_path = public as $lesson_read_course_ref_0283$
  select coalesce(
    (select l.id from lessons l
      where l.course_id = p_course_id and l.start_at > now()
      order by l.start_at, l.session_no limit 1),
    (select l.id from lessons l
      where l.course_id = p_course_id
      order by l.session_no desc limit 1))
$lesson_read_course_ref_0283$;

comment on function app.lesson_read_course_ref(uuid) is
  '0283 (Guest part). Internal. The lesson a course-wide push names (guest.md §4.5.1, db.md §5.2): the course''s first session starting after now, whatever its status, else its last session.';

revoke all on function app.lesson_read_course_ref(uuid) from public, anon, authenticated;

-- An enrolment's reference session for a guest push (guest.md §4.5.4): its
-- lesson, or its first covered session starting after now, else its last.
create or replace function app.lesson_read_enrolment_ref(p_enrolment_id uuid) returns uuid
language sql stable security definer set search_path = public as $lesson_read_enrolment_ref_0283$
  select coalesce(
    (select e.lesson_id from lesson_enrolments e where e.id = p_enrolment_id),
    (select c.id from app.lesson_read_covered(p_enrolment_id) c
      where c.start_at > now()
      order by c.start_at, c.session_no limit 1),
    (select c.id from app.lesson_read_covered(p_enrolment_id) c
      order by c.session_no desc nulls last, c.start_at desc limit 1))
$lesson_read_enrolment_ref_0283$;

comment on function app.lesson_read_enrolment_ref(uuid) is
  '0283 (Guest part). Internal. The lesson a guest push about one enrolment names in params.lesson_id: the enrolment''s lesson, or for a course enrolment its first covered session starting after now, else its last covered session.';

revoke all on function app.lesson_read_enrolment_ref(uuid) from public, anon, authenticated;

-- The one queue for the lesson push family (guest.md §4.5.1; R18, R40).
-- p_ref is the route's id and names the one recipient; the kind comes from
-- the title key (c_keys, the lesson subset of _shared/guest-push.json
-- title_keys, which tests/lesson-push.test.ts compares); the actor
-- (auth.uid()) is never told about their own act, except by a reminder; the
-- schedule follows the key.
create or replace function app.lesson_notify(
  p_ref       uuid,
  p_title_key text,
  p_dedupe    text default null,
  p_params    jsonb default '{}'
) returns int
language plpgsql security definer set search_path = public as $lesson_notify_0283$
declare
  c_keys constant jsonb := '{
    "lesson.booked": "lesson_update", "lesson.cancelled_by_coach": "lesson_update",
    "lesson.cancelled_by_staff": "lesson_update", "lesson.under_filled": "lesson_update",
    "lesson.rescheduled": "lesson_update", "lesson.court_moved": "lesson_update",
    "lesson.payment_expired": "lesson_update", "lesson.added_by_coach": "lesson_update",
    "lesson.reminder": "lesson_reminder",
    "coach.new_student": "coach_update", "coach.student_cancelled": "coach_update",
    "coach.lesson_cancelled_by_staff": "coach_update", "coach.under_filled": "coach_update",
    "coach.statement_ready": "coach_update", "coach.statement_paid": "coach_update",
    "coach.session_added": "coach_update", "coach.rescheduled_by_staff": "coach_update",
    "coach.court_moved": "coach_update"}';
  v_params  jsonb := coalesce(p_params, '{}'::jsonb);
  v_dedupe  text := nullif(btrim(p_dedupe), '');
  v_actor   uuid := auth.uid();
  v_kind    text;
  v_route   text;
  v_payload jsonb;
  v_to      uuid;
  v_due     timestamptz := now();
  v_due_now boolean := true;
  v_start   timestamptz;
  v_count   int := 0;
begin
  -- 1. A bad call is refused where a test can see it (outside the guard).
  if p_title_key is null or not (c_keys ? p_title_key) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'title_key';
  end if;
  if p_ref is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'p_ref';
  end if;
  if jsonb_typeof(v_params) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'params';
  end if;
  -- Params are closed: lesson_id (a uuid string) and places_taken,
  -- places_total (integers 0..64). No name and no amount can enter.
  if exists (select 1 from jsonb_each(v_params) x
              where not case
                          when x.key = 'lesson_id' then
                            jsonb_typeof(x.value) = 'string'
                            and (x.value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          when x.key in ('places_taken', 'places_total') then
                            jsonb_typeof(x.value) = 'number'
                            and case when x.value::text ~ '^[0-9]{1,2}$' then x.value::text::int <= 64
                                     else false end
                          else false
                        end) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'params';
  end if;
  if p_title_key like 'lesson.%' and not (v_params ? 'lesson_id') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'params';
  end if;

  -- 2. The kind from the key; the route from the key; the closed payload.
  v_kind := c_keys->>p_title_key;
  v_route := case
               when p_title_key like 'lesson.%' then 'lesson'
               when p_title_key in ('coach.statement_ready', 'coach.statement_paid') then 'coach_statements'
               else 'coach_lesson'
             end;
  v_payload := jsonb_build_object('route', v_route, 'id', p_ref::text, 'title_key', p_title_key,
                                  'params', v_params)
            || case when v_dedupe is null then '{}'::jsonb else jsonb_build_object('dedupe', v_dedupe) end;

  -- 3. A push never fails the write that queued it.
  begin
    -- The one recipient, by the route (guest.md §4.5.1 table).
    if p_title_key = 'lesson.added_by_coach' then
      -- Only an unconfirmed link (C-21, R44): a coach or the desk typed a
      -- phone that matched this account, and it has not answered yet.
      select e.guest_id into v_to
        from lesson_enrolments e
       where e.id = p_ref
         and e.booked_by_kind in ('coach', 'staff')
         and e.link_confirmed_at is null;
    elsif v_route = 'lesson' then
      -- Only a student: a guest's own booking or a confirmed link. An
      -- unconfirmed link gets nothing else, reminders included; a walk-in
      -- has no account.
      select e.guest_id into v_to
        from lesson_enrolments e
       where e.id = p_ref
         and (e.booked_by_kind = 'guest' or e.link_confirmed_at is not null);
    elsif v_route = 'coach_statements' then
      select co.profile_id into v_to
        from coach_statements s
        join coaches co on co.id = s.coach_id
       where s.id = p_ref;
    else
      select co.profile_id into v_to
        from lessons l
        join coaches co on co.id = l.coach_id
       where l.id = p_ref;
    end if;
    if v_to is null then
      return 0;
    end if;

    -- The schedule follows the key (CD-7, R44).
    if p_title_key = 'lesson.reminder' then
      select l.start_at - interval '3 hours' into v_start
        from lessons l
       where l.id = (v_params->>'lesson_id')::uuid;
      if v_start is null or v_start <= now() then
        return 0;
      end if;
      v_due := v_start;
      v_due_now := false;
    elsif p_title_key = 'lesson.added_by_coach' then
      -- Due a few seconds later and never nudged: a matched and an
      -- unmatched add do the same synchronous work (R44, R79).
      v_due := now() + interval '5 seconds';
      v_due_now := false;
    end if;

    insert into notification_outbox (profile_id, kind, payload, scheduled_for)
    select p.id, v_kind, v_payload, v_due
      from profiles p
     where p.id = v_to
       and p.deleted_at is null
       and p.expo_push_token is not null
       and (p_title_key = 'lesson.reminder' or p.id is distinct from v_actor)
       and (v_dedupe is null
            or not exists (select 1 from notification_outbox o
                            where o.profile_id = p.id
                              and o.payload->>'dedupe' = v_dedupe
                              and o.created_at > now() - interval '15 minutes'));
    get diagnostics v_count = row_count;

    -- 4. Only a row due now wakes send-push.
    if v_due_now and v_count > 0 then
      perform app.push_nudge();
    end if;
  exception when others then
    raise warning 'lesson_notify: %', sqlerrm;
    return 0;
  end;
  return v_count;
end $lesson_notify_0283$;

comment on function app.lesson_notify(uuid, text, text, jsonb) is
  '0283 (lane Guest, guest.md §4.5.1; R18, R40, R44). Internal: queues at most one notification_outbox row for a lesson-family title key, its kind taken from c_keys (the lesson subset of _shared/guest-push.json title_keys; tests/lesson-push.test.ts compares). p_ref is the route''s id and names the recipient: lesson.added_by_coach -> the enrolment''s account while its link is unconfirmed; every other lesson.* -> the enrolment''s account when it is a student (guest-booked or a confirmed link); coach.statement_* -> the statement''s coach; every other coach.* -> the lesson''s coach. Payload {route (lesson | coach_lesson | coach_statements), id, title_key, params} (+ dedupe); params closed to lesson_id, places_taken, places_total. lesson.reminder is due at the lesson''s start - 3 h (none when that is past); lesson.added_by_coach at now() + 5 s, never nudged; every other key now. Skips deleted and tokenless profiles, the actor (auth.uid(); a reminder never skips), and a recipient who had that dedupe in the last 15 minutes. INVALID_ARGUMENT (hint title_key, p_ref, params) for a bad call; a failing insert returns 0 with a warning. Returns the rows queued.';

revoke all on function app.lesson_notify(uuid, text, text, jsonb) from public, anon, authenticated;

-- lesson.reminder upkeep (guest.md §4.5.2): the lesson's unsent future
-- reminders go, then a scheduled lesson more than 3 hours out queues one per
-- student covering it. Never raises.
create or replace function app.lesson_sync_reminders(p_lesson_id uuid) returns void
language plpgsql security definer set search_path = public as $lesson_sync_reminders_0283$
declare
  v_l lessons%rowtype;
  v_e uuid;
begin
  begin
    -- The first four terms are notification_outbox_due's own (0024:32-33).
    delete from notification_outbox
     where kind = 'lesson_reminder'
       and sent_at is null
       and attempts < 5
       and scheduled_for > now()
       and payload->'params'->>'lesson_id' = p_lesson_id::text;
    select * into v_l from lessons where id = p_lesson_id;
    if found and v_l.status = 'scheduled' and v_l.start_at - interval '3 hours' > now() then
      for v_e in
        select c.id
          from app.lesson_read_covering(p_lesson_id) c
         where c.status = 'booked'
           and c.guest_id is not null
           and (c.booked_by_kind = 'guest' or c.link_confirmed_at is not null)
         order by c.id
      loop
        perform app.lesson_notify(v_e, 'lesson.reminder', null,
                                  jsonb_build_object('lesson_id', p_lesson_id::text));
      end loop;
    end if;
  exception when others then
    raise warning 'lesson_sync_reminders: %', sqlerrm;
  end;
end $lesson_sync_reminders_0283$;

comment on function app.lesson_sync_reminders(uuid) is
  '0283 (lane Guest, guest.md §4.5.2; CD-7, C-21, R18). Internal: deletes the lesson''s unsent future lesson_reminder rows, then, when the lesson is scheduled and starts more than 3 hours from now, queues lesson.reminder at start - 3 h for every student covering it (a booked enrolment with an account that the guest booked, or whose link was confirmed; a lesson enrolment or a course enrolment covering the session). Never raises. Its only callers are the reminder triggers (through app.lesson_read_sync_once).';

revoke all on function app.lesson_sync_reminders(uuid) from public, anon, authenticated;

-- Once per lesson per flush (concurrency review F21): the deferred triggers
-- fire at commit, when every row is final, and skip a lesson already synced
-- in that flush. The list is transaction-local and keyed by the statement
-- that flushes it, so a SET CONSTRAINTS ... IMMEDIATE mid-transaction (the
-- rolled-back test scenarios do it) starts a fresh list.
create or replace function app.lesson_read_sync_once(p_lesson_id uuid) returns void
language plpgsql security definer set search_path = public as $lesson_read_sync_once_0283$
declare
  v_stamp text := statement_timestamp()::text;
  v_raw   text := coalesce(current_setting('app.lesson_reminders_synced', true), '');
  v_list  text;
begin
  if p_lesson_id is null then
    return;
  end if;
  v_list := case when split_part(v_raw, '|', 1) = v_stamp then split_part(v_raw, '|', 2) else '' end;
  if position(p_lesson_id::text in v_list) > 0 then
    return;
  end if;
  perform set_config('app.lesson_reminders_synced', v_stamp || '|' || v_list || p_lesson_id::text || ',', true);
  perform app.lesson_sync_reminders(p_lesson_id);
end $lesson_read_sync_once_0283$;

comment on function app.lesson_read_sync_once(uuid) is
  '0283 (Guest part, guest.md §4.5.3, F21). Internal: app.lesson_sync_reminders for the lesson unless it was already synced in this flush (the transaction-local list app.lesson_reminders_synced, keyed by statement_timestamp()). Called only by the reminder triggers.';

revoke all on function app.lesson_read_sync_once(uuid) from public, anon, authenticated;

create or replace function app.trg_lesson_reminders() returns trigger
language plpgsql security definer set search_path = public as $trg_lesson_reminders_0283$
begin
  begin
    perform app.lesson_read_sync_once(new.id);
  exception when others then
    raise warning 'trg_lesson_reminders: %', sqlerrm;
  end;
  return null;
end $trg_lesson_reminders_0283$;

comment on function app.trg_lesson_reminders() is
  '0283 (lane Guest, guest.md §4.5.3; R18). Trigger lessons_reminders (deferred, after an update of start_at or status): resyncs the lesson''s reminders once per flush. A held lesson turning scheduled, a reschedule of any kind, a cancel, a completion. Never fails the write.';

revoke all on function app.trg_lesson_reminders() from public, anon, authenticated;

drop trigger if exists lessons_reminders on lessons;
create constraint trigger lessons_reminders
  after update of start_at, status on lessons
  deferrable initially deferred
  for each row
  when (old.start_at is distinct from new.start_at or old.status is distinct from new.status)
  execute function app.trg_lesson_reminders();

create or replace function app.trg_enrolment_reminders() returns trigger
language plpgsql security definer set search_path = public as $trg_enrolment_reminders_0283$
declare
  v_l uuid;
begin
  begin
    if new.lesson_id is not null then
      perform app.lesson_read_sync_once(new.lesson_id);
    elsif new.course_id is not null then
      -- A course enrolment resyncs each scheduled session it covers (at most 52).
      for v_l in
        select l.id
          from lessons l
         where l.course_id = new.course_id
           and l.status = 'scheduled'
           and l.session_no between new.first_session_no and new.first_session_no + new.sessions_covered - 1
         order by l.session_no
      loop
        perform app.lesson_read_sync_once(v_l);
      end loop;
    end if;
  exception when others then
    raise warning 'trg_enrolment_reminders: %', sqlerrm;
  end;
  return null;
end $trg_enrolment_reminders_0283$;

comment on function app.trg_enrolment_reminders() is
  '0283 (lane Guest, guest.md §4.5.3; C-21, R44, R78). Triggers lesson_enrolments_reminders_ins (a booked insert) and lesson_enrolments_reminders_upd (status, guest_id or link_confirmed_at changed), both deferred: a lesson enrolment resyncs its lesson, a course enrolment each scheduled session it covers, once per flush. A "Yes" to the link confirm adds the reminders; "Not me" leaves none. Never fails the write.';

revoke all on function app.trg_enrolment_reminders() from public, anon, authenticated;

drop trigger if exists lesson_enrolments_reminders_ins on lesson_enrolments;
create constraint trigger lesson_enrolments_reminders_ins
  after insert on lesson_enrolments
  deferrable initially deferred
  for each row
  when (new.status = 'booked')
  execute function app.trg_enrolment_reminders();

drop trigger if exists lesson_enrolments_reminders_upd on lesson_enrolments;
create constraint trigger lesson_enrolments_reminders_upd
  after update of status, guest_id, link_confirmed_at on lesson_enrolments
  deferrable initially deferred
  for each row
  when (old.status is distinct from new.status
        or old.guest_id is distinct from new.guest_id
        or old.link_confirmed_at is distinct from new.link_confirmed_at)
  execute function app.trg_enrolment_reminders();

-- A guest push about one enrolment, deduped per enrolment and key (guest.md
-- §4.5.1: l:<p_ref>:<title_key>). Nothing without a lesson to name.
create or replace function app.lesson_read_push_guest(p_enrolment_id uuid, p_title_key text, p_lesson_id uuid)
returns int
language plpgsql security definer set search_path = public as $lesson_read_push_guest_0283$
begin
  if p_enrolment_id is null or p_lesson_id is null then
    return 0;
  end if;
  return app.lesson_notify(p_enrolment_id, p_title_key,
                           'l:' || p_enrolment_id::text || ':' || p_title_key,
                           jsonb_build_object('lesson_id', p_lesson_id::text));
end $lesson_read_push_guest_0283$;

comment on function app.lesson_read_push_guest(uuid, text, uuid) is
  '0283 (Guest part). Internal: app.lesson_notify for one enrolment (route lesson) with params {lesson_id} and the dedupe l:<enrolment>:<title_key>; 0 when either id is NULL. Called only by the lesson_events_notify trigger.';

revoke all on function app.lesson_read_push_guest(uuid, text, uuid) from public, anon, authenticated;

-- A coach push about one lesson (route coach_lesson). coach.new_student and
-- coach.student_cancelled add the count to the dedupe, so each change pushes
-- and a retry does not.
create or replace function app.lesson_read_push_coach(p_lesson_id uuid, p_title_key text, p_places jsonb default '{}')
returns int
language plpgsql security definer set search_path = public as $lesson_read_push_coach_0283$
begin
  if p_lesson_id is null then
    return 0;
  end if;
  return app.lesson_notify(
    p_lesson_id, p_title_key,
    'l:' || p_lesson_id::text || ':' || p_title_key
      || case when p_title_key in ('coach.new_student', 'coach.student_cancelled')
              then ':' || coalesce(p_places->>'places_taken', '-')
              else '' end,
    coalesce(p_places, '{}'::jsonb));
end $lesson_read_push_coach_0283$;

comment on function app.lesson_read_push_coach(uuid, text, jsonb) is
  '0283 (Guest part). Internal: app.lesson_notify for the coach of one lesson (route coach_lesson) with params {places_taken, places_total} or {}; the dedupe is l:<lesson>:<title_key>, plus :<places_taken> for coach.new_student and coach.student_cancelled. Called only by the lesson_events_notify trigger.';

revoke all on function app.lesson_read_push_coach(uuid, text, jsonb) from public, anon, authenticated;

-- lesson_events -> pushes: the one fan-out (guest.md §4.5.4, R40). Fires
-- straight after the row is written, so it reads the state the writer left
-- just before the event (db.md §5.2: the event follows the rows it
-- describes). Terms:
--   the guest       the event's enrolment (lesson_notify applies the student
--                   and unconfirmed-link rules); params.lesson_id = the
--                   event's lesson, else the enrolment's next covered session
--                   starting after now, else its last
--   each student    every booked enrolment covering the event's lesson
--   the coach       p_ref = the event's lesson; for a course (any course
--                   event but a reschedule or a court move) the course's
--                   first session starting after now, live or just
--                   cancelled, else its last. One course-wide reference
--                   keeps a course's push single whether the writer names the
--                   course, a session, or both
--   + places        {places_taken, places_total}: booked places after the
--                   change and max_places of the group session or course; a
--                   private lesson sends neither
create or replace function app.trg_lesson_events_notify() returns trigger
language plpgsql security definer set search_path = public as $trg_lesson_events_notify_0283$
declare
  v_l       lessons%rowtype;
  v_c       courses%rowtype;
  v_e       lesson_enrolments%rowtype;
  v_kind    text;
  v_ref     uuid;
  v_glesson uuid;
  v_places  jsonb := '{}'::jsonb;
  v_taken   int;
  v_from    text;
  v_reason  text;
  v_key     text;
  v_late    boolean;
  v_live    boolean;
  v_s       uuid;
begin
  begin
    if new.lesson_id is not null then
      select * into v_l from lessons where id = new.lesson_id;
    end if;
    if new.course_id is not null then
      select * into v_c from courses where id = new.course_id;
    elsif v_l.course_id is not null then
      select * into v_c from courses where id = v_l.course_id;
    end if;
    if new.enrolment_id is not null then
      select * into v_e from lesson_enrolments where id = new.enrolment_id;
    end if;
    v_kind := case when v_c.id is not null then 'course' else v_l.kind end;

    -- The coach's reference session.
    if new.type in ('rescheduled', 'court_moved') or v_kind is distinct from 'course' then
      v_ref := new.lesson_id;
    else
      v_ref := app.lesson_read_course_ref(v_c.id);
    end if;
    -- The guest's lesson.
    v_glesson := coalesce(new.lesson_id,
                          case when v_e.id is not null then app.lesson_read_enrolment_ref(v_e.id) end,
                          v_ref);

    -- Booked places after the change; a private lesson sends none.
    if v_kind = 'course' then
      select coalesce(sum(x.party_size), 0)::int into v_taken
        from lesson_enrolments x where x.course_id = v_c.id and x.status = 'booked';
      v_places := jsonb_build_object('places_taken', least(v_taken, 64), 'places_total', v_c.max_places);
    elsif v_kind = 'group' then
      select coalesce(sum(x.party_size), 0)::int into v_taken
        from lesson_enrolments x where x.lesson_id = v_l.id and x.status = 'booked';
      v_places := jsonb_build_object('places_taken', least(v_taken, 64), 'places_total', v_l.max_places);
    end if;

    v_late := case when jsonb_typeof(new.data->'late') = 'boolean' then (new.data->>'late')::boolean
                   else false end;

    if new.type = 'booked' then
      if new.enrolment_id is not null and new.actor = 'guest' then
        -- A guest's desk-mode private booking.
        perform app.lesson_read_push_coach(v_ref, 'coach.new_student', v_places);
      elsif new.enrolment_id is null and new.actor = 'staff' and v_kind in ('group', 'course') then
        -- The venue scheduled a group session or a course for the coach.
        perform app.lesson_read_push_coach(v_ref, 'coach.session_added', '{}'::jsonb);
      end if;
      -- Otherwise silent: the coach's own creation, and the lesson row of a
      -- coach- or desk-booked private lesson (its added event follows).

    elsif new.type = 'joined' then
      -- A held join waits for paid_online.
      if v_e.status = 'booked' then
        perform app.lesson_read_push_coach(v_ref, 'coach.new_student', v_places);
      end if;

    elsif new.type = 'added' then
      if v_e.guest_id is not null and v_e.link_confirmed_at is null then
        -- A typed phone matched an account (C-21): "is this you?", due in
        -- five seconds (R44).
        perform app.lesson_read_push_guest(v_e.id, 'lesson.added_by_coach', v_glesson);
      elsif v_e.guest_id is not null then
        -- The desk picked the customer: a student at once.
        perform app.lesson_read_push_guest(v_e.id, 'lesson.booked', v_glesson);
      end if;
      if new.actor = 'staff' then
        perform app.lesson_read_push_coach(v_ref, 'coach.new_student', v_places);
      end if;

    elsif new.type = 'paid_online' then
      -- The guest's payment screen is open: only the coach is told.
      perform app.lesson_read_push_coach(v_ref, 'coach.new_student', v_places);

    elsif new.type = 'expired' then
      perform app.lesson_read_push_guest(v_e.id, 'lesson.payment_expired', v_glesson);

    elsif new.type = 'enrolment_cancelled' then
      -- data.from is the status before the cancel (guest.md §4.3 item 2);
      -- without it, a desk enrolment or one with a succeeded payment was booked.
      v_from := coalesce(nullif(new.data->>'from', ''),
                         case when v_e.payment_mode = 'desk'
                                or exists (select 1 from booking_payments bp
                                            where bp.lesson_enrolment_id = v_e.id
                                              and bp.purpose = 'lesson'
                                              and bp.succeeded_at is not null)
                              then 'booked' else 'held' end);
      if new.code in ('guest_free', 'guest_late', 'account_deleted') then
        if v_from = 'booked' then
          perform app.lesson_read_push_coach(v_ref, 'coach.student_cancelled', v_places);
        end if;
      elsif new.code = 'coach' then
        -- A removal, a coach cancel, a retirement.
        perform app.lesson_read_push_guest(v_e.id, 'lesson.cancelled_by_coach', v_glesson);
      elsif new.code = 'staff' then
        perform app.lesson_read_push_guest(v_e.id, 'lesson.cancelled_by_staff', v_glesson);
        -- One removal from a live group session or course tells the coach;
        -- a cancelled lesson tells the coach by its own event.
        v_live := case
                    when v_kind = 'course' then v_c.status in ('open', 'running')
                    when v_kind = 'group' then v_l.status = 'scheduled'
                    else false
                  end;
        if coalesce(v_live, false) then
          perform app.lesson_read_push_coach(v_ref, 'coach.student_cancelled', v_places);
        end if;
      elsif new.code = 'under_filled' then
        perform app.lesson_read_push_guest(v_e.id, 'lesson.under_filled', v_glesson);
      elsif new.code = 'course_cancelled' then
        v_reason := coalesce(v_c.cancel_reason, new.data->>'reason');
        v_key := case
                   when v_reason in ('coach_cancel', 'coach_retired') then 'lesson.cancelled_by_coach'
                   when v_reason = 'staff_cancel' then 'lesson.cancelled_by_staff'
                   when v_reason = 'under_filled' then 'lesson.under_filled'
                 end;
        if v_key is not null then
          perform app.lesson_read_push_guest(v_e.id, v_key, v_glesson);
        end if;
      end if;

    elsif new.type = 'cancelled' then
      -- Each enrolment's own event tells the students. The coach hears of a
      -- venue cancel once: a course's sessions and the course share one
      -- reference, so its dedupe keeps it single.
      if new.code = 'staff_cancel' then
        perform app.lesson_read_push_coach(v_ref, 'coach.lesson_cancelled_by_staff', '{}'::jsonb);
      end if;

    elsif new.type = 'under_filled' then
      -- Judged after the start (R26): nothing was cancelled, nobody is told.
      if not v_late then
        perform app.lesson_read_push_coach(v_ref, 'coach.under_filled', '{}'::jsonb);
      end if;

    elsif new.type = 'rescheduled' then
      if new.lesson_id is not null then
        for v_s in
          select c.id from app.lesson_read_covering(new.lesson_id) c
           where c.status = 'booked' order by c.id
        loop
          perform app.lesson_read_push_guest(v_s, 'lesson.rescheduled', new.lesson_id);
        end loop;
      end if;
      if new.actor = 'staff' then
        perform app.lesson_read_push_coach(v_ref, 'coach.rescheduled_by_staff', '{}'::jsonb);
      end if;

    elsif new.type = 'court_moved' then
      if new.lesson_id is not null then
        for v_s in
          select c.id from app.lesson_read_covering(new.lesson_id) c
           where c.status = 'booked' order by c.id
        loop
          perform app.lesson_read_push_guest(v_s, 'lesson.court_moved', new.lesson_id);
        end loop;
      end if;
      perform app.lesson_read_push_coach(v_ref, 'coach.court_moved', '{}'::jsonb);
    end if;
    -- held, completed, attended, no_show, unmarked, settled, refunded: silent
    -- (the trigger's WHEN leaves them out).
  exception when others then
    raise warning 'trg_lesson_events_notify: %', sqlerrm;
  end;
  return null;
end $trg_lesson_events_notify_0283$;

comment on function app.trg_lesson_events_notify() is
  '0283 (lane Guest, guest.md §4.5.4; R40, R44, R78). Trigger lesson_events_notify: the only queuer of every lesson.* and coach.* key but the two statement keys. booked: coach.new_student (a guest''s private booking) or coach.session_added (the desk scheduled a group session or course); joined (booked): coach.new_student + places; added: lesson.added_by_coach (an unconfirmed link, due now() + 5 s) or lesson.booked (a desk-picked customer), and coach.new_student + places when the desk added; paid_online: coach.new_student + places; expired: lesson.payment_expired; enrolment_cancelled by code: guest_free | guest_late | account_deleted -> coach.student_cancelled + places when it was booked; coach -> lesson.cancelled_by_coach; staff -> lesson.cancelled_by_staff (+ coach.student_cancelled while the group session or course is live); under_filled -> lesson.under_filled; course_cancelled -> by the course''s cancel_reason; cancelled staff_cancel: coach.lesson_cancelled_by_staff; under_filled (not late): coach.under_filled; rescheduled: lesson.rescheduled to each student covering it (+ coach.rescheduled_by_staff when the desk moved it); court_moved: lesson.court_moved to each student and coach.court_moved. Everything else is silent. Never fails the write.';

revoke all on function app.trg_lesson_events_notify() from public, anon, authenticated;

drop trigger if exists lesson_events_notify on lesson_events;
create trigger lesson_events_notify
  after insert on lesson_events
  for each row
  when (new.type in ('booked', 'joined', 'added', 'paid_online', 'expired', 'enrolment_cancelled',
                     'cancelled', 'under_filled', 'rescheduled', 'court_moved'))
  execute function app.trg_lesson_events_notify();

-- ===========================================================================
-- 2. Read helpers (internal)
-- ===========================================================================

-- A coach as a guest surface shows them (COACH_CARD): public display names
-- and photo, keyed by coaches.id (R43). A retired coach never reaches a guest
-- surface by name (R63): the names and photo read null.
create or replace function app.lesson_read_coach_card(p_coach_id uuid) returns jsonb
language sql stable security definer set search_path = public as $lesson_read_coach_card_0283$
  select jsonb_build_object(
           'id', c.id,
           'display_name_en', case when c.status = 'retired' then null else c.display_name_en end,
           'display_name_ar', case when c.status = 'retired' then null else c.display_name_ar end,
           'photo_path', case when c.status = 'retired' then null else c.photo_path end)
    from coaches c
   where c.id = p_coach_id
$lesson_read_coach_card_0283$;

comment on function app.lesson_read_coach_card(uuid) is
  '0283. Internal. {id, display_name_en, display_name_ar, photo_path} of one coach for a guest surface (id is coaches.id, never a profile id, R43); a retired coach''s names and photo read null (R63).';

revoke all on function app.lesson_read_coach_card(uuid) from public, anon, authenticated;

-- The open group sessions and courses of active, accepted coaches at the
-- given branches (X1, X2 sessions[]): group sessions scheduled, starting in
-- the next 30 days, a place left; courses open or running, sign-up open
-- (before the last start), the next session in the next 60 days, a place
-- left. Soonest first, at most 50. No student, no court.
create or replace function app.lesson_read_sessions(p_venues uuid[], p_coach_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $lesson_read_sessions_0283$
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
                             'cutoff_at', l.cutoff_at) as j
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
                             'cutoff_at', c.cutoff_at)
                      from courses c
                      join coaches co on co.id = c.coach_id
                      cross join lateral (
                        select l.start_at, l.end_at,
                               (select count(*) from lessons l2
                                 where l2.course_id = c.id and l2.status = 'scheduled'
                                   and l2.start_at > now())::int as left_n
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
end $lesson_read_sessions_0283$;

comment on function app.lesson_read_sessions(uuid[], uuid) is
  '0283. Internal. The listing of coaching_public and coach_profile (X1, X2 sessions[]): group sessions (scheduled, starting within 30 days, a place left) and courses (open or running, sign-up open, next session within 60 days, a place left) of active coaches who accepted going public (R16, R61) with an active branch row, at the given branches (and of one coach when given). {kind, lesson_id, course_id, venue_id, coach_id, lesson_type_id, title_en, title_ar, start_at, end_at (a course: its next session), sessions_count, sessions_left, places_left, max_places, signup_closes_at, cutoff_at}, soonest first, at most 50. No student, no court, no count by name.';

revoke all on function app.lesson_read_sessions(uuid[], uuid) from public, anon, authenticated;

-- One my_lessons row (X7, guest.md §4.3). The session it speaks of is the
-- next covered one not yet ended, else the last. A pending link (C-21) is the
-- card only: no friend names, no court, no money beyond price_iqd.
create or replace function app.lesson_read_my_row(p_enrolment_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $lesson_read_my_row_0283$
declare
  v_e       lesson_enrolments%rowtype;
  v_c       courses%rowtype;
  v_ref     lessons%rowtype;
  v_t       lesson_types%rowtype;
  v_pending boolean;
  v_m       jsonb;
  v_kind    text;
  v_taken   int;
  v_refund  jsonb;
  v_pay     jsonb;
begin
  select * into v_e from lesson_enrolments where id = p_enrolment_id;
  if not found then
    return null;
  end if;
  v_pending := v_e.guest_id is not null and v_e.link_confirmed_at is null;
  if v_e.course_id is not null then
    select * into v_c from courses where id = v_e.course_id;
  end if;
  select * into v_ref
    from app.lesson_read_covered(v_e.id) x
   where x.end_at > now()
   order by x.start_at, x.session_no
   limit 1;
  if v_ref.id is null then
    select * into v_ref
      from app.lesson_read_covered(v_e.id) x
     order by x.start_at desc, x.session_no desc nulls last
     limit 1;
  end if;
  v_kind := case when v_e.course_id is not null then 'course' else v_ref.kind end;
  select * into v_t from lesson_types where id = coalesce(v_c.lesson_type_id, v_ref.lesson_type_id);
  v_taken := case
               when v_kind = 'course' then app.course_places_taken(v_c.id)
               when v_kind = 'group' then app.lesson_places_taken(v_ref.id)
             end;
  if not v_pending then
    v_m := app.lesson_enrolment_money(v_e.id);
    select jsonb_build_object(
             'status', case bp.status when 'refund_pending' then 'pending'
                                      when 'refunded' then 'refunded'
                                      else 'failed' end,
             'amount_iqd', bp.refund_amount_iqd)
      into v_refund
      from booking_payments bp
     where bp.lesson_enrolment_id = v_e.id
       and bp.purpose = 'lesson'
       and bp.status in ('refund_pending', 'refunded', 'refund_failed')
     order by bp.refund_requested_at desc nulls last, bp.created_at desc
     limit 1;
    if v_e.status = 'held' then
      select jsonb_build_object('request_id', bp.request_id, 'deadline_at', bp.deadline_at)
        into v_pay
        from booking_payments bp
       where bp.lesson_enrolment_id = v_e.id
         and bp.purpose = 'lesson'
         and bp.status in ('created', 'pending')
         and bp.deadline_at > now()
       order by bp.created_at desc
       limit 1;
    end if;
  end if;

  return jsonb_build_object(
    'enrolment_id', v_e.id,
    'kind', v_kind,
    'lesson_id', v_e.lesson_id,
    'course_id', v_e.course_id,
    'venue_id', v_e.venue_id,
    'coach', app.lesson_read_coach_card(coalesce(v_c.coach_id, v_ref.coach_id)),
    'type_name_en', v_t.name_en,
    'type_name_ar', v_t.name_ar,
    'title_en', v_c.title_en,
    'title_ar', v_c.title_ar,
    'start_at', v_ref.start_at,
    'end_at', v_ref.end_at,
    'session_no', v_ref.session_no,
    'sessions_count', v_c.sessions_count,
    'first_session_no', v_e.first_session_no,
    'sessions_covered', v_e.sessions_covered,
    'status', v_e.status,
    'cancel_kind', v_e.cancel_kind,
    'lesson_status', v_ref.status,
    'attendance', (select a.status from lesson_attendance a
                    where a.lesson_id = v_ref.id and a.enrolment_id = v_e.id),
    'booked_by', v_e.booked_by_kind,
    'confirm_needed', v_pending,
    'rescheduled', coalesce(v_ref.rescheduled_at > v_e.created_at, false),
    'party_size', v_e.party_size,
    'payment_mode', v_e.payment_mode,
    'price_iqd', v_e.price_iqd,
    'paid_online_iqd', (v_m->>'online_paid_iqd')::bigint,
    'owed_iqd', (v_m->>'owed_iqd')::bigint,
    'refund', v_refund,
    'places_taken', v_taken,
    'min_places', coalesce(v_c.min_places, v_ref.min_places),
    'cutoff_at', coalesce(v_c.cutoff_at, v_ref.cutoff_at),
    'pending_payment', v_pay,
    'hold_expires_at', v_e.hold_expires_at);
end $lesson_read_my_row_0283$;

comment on function app.lesson_read_my_row(uuid) is
  '0283. Internal. One my_lessons row (X7, guest.md §4.3): the enrolment, its kind, coach card, type and title, the session it speaks of (the next covered one not yet ended, else the last), its status and attendance, booked_by, confirm_needed (C-21), rescheduled (R8), party, payment mode and price, the money from Money''s lesson_enrolment_money (paid_online_iqd, owed_iqd), the latest online refund, places and cut-off, the open payment of a held place. A pending link carries no money beyond price_iqd.';

revoke all on function app.lesson_read_my_row(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 3. Public reads (anon + authenticated, publicByDesign, R12)
-- ===========================================================================

-- The /coaching page and the phone's coaches and classes (X1). Never raises.
create or replace function app.coaching_public(p_venue_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $coaching_public_0283$
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
end $coaching_public_0283$;

comment on function app.coaching_public(uuid) is
  '0283 (db.md §4.7.9, guest.md §4.3; X1, C-11, R16, R61, R76). Anon and authenticated, public by design; never raises. {off: true} when the named branch has coaching off, is closed or unknown, or (p_venue_id NULL) no open branch has coaching on. Else {off: false, branches[{venue_id, name_en, name_ar, timezone, payment_mode, prices_public, cancellation_window_hours}], coaches[{id, display_name_en, display_name_ar, bio_en, bio_ar, photo_path, sort_order, venue_ids, offers[{lesson_type_id, venue_id, price_iqd}]}] (active coaches who accepted going public, with an active branch row), lesson_types[{id, venue_id, kind, name_*, description_*, duration_min, max_places, min_places, sessions_count, price_iqd, sort_order}] (on sale, taught by a listed coach), sessions[] (app.lesson_read_sessions), server_now}. Prices are always sent; the website drops them while prices_public is false. No student, phone, profile id or court id.';

revoke all on function app.coaching_public(uuid) from public;
grant execute on function app.coaching_public(uuid) to anon, authenticated;

-- One accepted coach's public card (X2, R17, R76). NULL branch: the card and
-- the open branches with coaching on where the coach is active (the /c/<id>
-- link names no branch).
create or replace function app.coach_profile(p_coach_id uuid, p_venue_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $coach_profile_0283$
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
end $coach_profile_0283$;

comment on function app.coach_profile(uuid, uuid) is
  '0283 (db.md §4.7.9, guest.md §4.3; X2, R17, R61, R76). Anon and authenticated, public by design. INVALID_ARGUMENT (p_coach_id NULL); COACH_NOT_FOUND (unknown, retired, or not yet accepted). p_venue_id NULL: {off: true} when the coach is active at no open branch with coaching on, else {off: false, coach: {id, display_name_*, bio_*, photo_path, status, venue_ids}, venue: null, bookable, offers: [], sessions: [], server_now}. A named branch: {off: true} when it is closed, unknown or has coaching off; COACH_NOT_AT_BRANCH when the coach is not active there; else the card, venue {venue_id, name_*, timezone, phone (the branch''s), payment_mode, prices_public, cancellation_window_hours}, bookable, offers[{lesson_type_id, kind, name_*, description_*, duration_min, max_places, min_places, sessions_count, cutoff_hours, price_iqd (lesson_price_for)}] and sessions[] (app.lesson_read_sessions). A paused coach answers status paused, bookable false, no offers and no sessions (R76). No profile id, student or court.';

revoke all on function app.coach_profile(uuid, uuid) from public;
grant execute on function app.coach_profile(uuid, uuid) to anon, authenticated;

-- Free 30-minute starts of one coach and one private type (X3, R51, R77):
-- on the branch's grid, after now and inside the window, within the horizon,
-- outside the protected horizon while the branch trades offline, inside its
-- opening hours, the coach free (hours, time off, no other live lesson) and
-- one active court with no live row over the period that no waiting open
-- match claims. Staff of the type's branch read it whatever the switch and
-- whatever the coach's consent, with no horizon and no offline cut (the desk
-- stages lessons, R51, D-12).
create or replace function app.coach_slots(p_coach_id uuid, p_lesson_type_id uuid, p_from timestamptz,
                                           p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $coach_slots_0283$
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
  -- whatever the switch and the consent, with no horizon and no offline cut.
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
  v_lo := greatest(p_from, now());
  if not v_staff and coalesce(v_vs.max_booking_horizon_days, 0) > 0 then
    v_horizon := now() + make_interval(days => v_vs.max_booking_horizon_days);
  end if;
  if not v_staff and app.is_degraded(v_venue) then
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
     where g.s > v_lo
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
                                         and (r.kind <> 'hold' or r.hold_expires_at > now())
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
end $coach_slots_0283$;

comment on function app.coach_slots(uuid, uuid, timestamptz, timestamptz) is
  '0283 (db.md §4.7.9, guest.md §4.3; X3, C-2, C-20, R51, R61, R76, R77). Anon and authenticated, public by design. INVALID_ARGUMENT (a NULL, p_to <= p_from, a window over 14 days); LESSON_TYPE_NOT_FOUND (not a private type); COACH_NOT_FOUND (unknown, retired, or not accepted unless the caller is staff at the type''s branch or the coach themselves). {off: true} while the branch is closed or has coaching off, except to staff of the type''s branch (R51) and to the coach asking about themselves (coach mode). Else {off: false, venue_id, coach_id, lesson_type_id, duration_min, bookable, starts[{start_at, end_at}], server_now}: bookable false with no starts for a paused coach, a coach not active at the branch or not teaching the type, a type off sale or unpriced. Starts are the 30-minute grid starts after max(p_from, now()) ending by p_to, within max_booking_horizon_days and outside the protected horizon while the branch trades offline (guests only: not staff, not the coach themselves), inside opening hours (lesson_bookable), with the coach available (coach_available) and an active court with no live row over the period (a hold while live) that no waiting match claims. No court ids, names or money.';

revoke all on function app.coach_slots(uuid, uuid, timestamptz, timestamptz) from public;
grant execute on function app.coach_slots(uuid, uuid, timestamptz, timestamptz) to anon, authenticated;

-- One group session or course as a guest sees it before joining (X4).
create or replace function app.lesson_offer(p_lesson_id uuid default null, p_course_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $lesson_offer_0283$
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
      select jsonb_build_object('enrolment_id', e.id, 'status', e.status)
        into v_mine
        from lesson_enrolments e
       where e.lesson_id = v_l.id
         and e.guest_id = v_uid
         and e.link_confirmed_at is not null
         and e.status in ('held', 'booked')
       order by e.created_at desc
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
    select jsonb_build_object('enrolment_id', e.id, 'status', e.status)
      into v_mine
      from lesson_enrolments e
     where e.course_id = v_c.id
       and e.guest_id = v_uid
       and e.link_confirmed_at is not null
       and e.status in ('held', 'booked')
     order by e.created_at desc
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
end $lesson_offer_0283$;

comment on function app.lesson_offer(uuid, uuid) is
  '0283 (db.md §4.7.9, guest.md §4.3; X4, C-15, R16, R61, R76). Anon and authenticated, public by design. INVALID_ARGUMENT unless exactly one id; LESSON_NOT_FOUND (unknown, a private lesson or a course session''s id, a closed branch, a coach paused, retired or not accepted); {off: true} while the branch has coaching off. Else {kind (group | course), lesson_id | course_id, venue_id, timezone, phone (the branch''s), coach {id, display_name_*, photo_path}, type {id, name_*, description_*, duration_min}, title_*, start_at, end_at (a course: its next session), sessions[{lesson_id, session_no, start_at, end_at, status, started}] (course), status (open | full | closed | cancelled: closed after a group''s start or a course''s last start), places_left, max_places, min_places, places_taken (a count), cutoff_at, signup_closes_at, price_iqd (the caller''s price now: the place, the course, or its sessions not yet started, course_late_join_price), full_price_iqd, late_join {sessions_left, sessions_count} | null, payment_mode, cancellation_window_hours, mine {enrolment_id, status} | null (the caller''s own live, confirmed enrolment; signed in only), server_now}. No student, phone or profile id.';

revoke all on function app.lesson_offer(uuid, uuid) from public;
grant execute on function app.lesson_offer(uuid, uuid) to anon, authenticated;

-- ===========================================================================
-- 4. Guest reads (lesson_guest(false) first)
-- ===========================================================================

-- The caller's lessons (X7): upcoming = held or booked and not ended, plus
-- anything ended in the last 24 h; past = booked and ended before that;
-- cancelled = cancelled or expired. A pending link (C-21) is listed in
-- upcoming only, as confirm_needed, while its lesson has not ended.
create or replace function app.my_lessons(p_scope text default 'upcoming') returns jsonb
language plpgsql stable security definer set search_path = public as $my_lessons_0283$
declare
  v_p     profiles%rowtype := app.lesson_guest(false);
  v_scope text := coalesce(p_scope, 'upcoming');
begin
  if v_scope not in ('upcoming', 'past', 'cancelled') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_scope';
  end if;
  return coalesce((
    select jsonb_agg(app.lesson_read_my_row(x.id) order by x.ord, x.id)
      from (select e.id,
                   row_number() over (
                     order by case when v_scope = 'upcoming' then coalesce(s.next_start, s.last_start) end asc,
                              case when v_scope = 'past' then s.last_start end desc,
                              case when v_scope = 'cancelled' then e.cancelled_at end desc,
                              e.id) as ord
              from lesson_enrolments e
              cross join lateral (
                select min(c.start_at) filter (where c.end_at > now()) as next_start,
                       max(c.start_at) as last_start,
                       max(c.end_at) as last_end
                  from app.lesson_read_covered(e.id) c) s
             where e.guest_id = v_p.id
               and case v_scope
                     when 'upcoming' then
                       e.status in ('held', 'booked')
                       and s.last_end > now() - interval '24 hours'
                       and (e.link_confirmed_at is not null or s.last_end > now())
                     when 'past' then
                       e.status = 'booked'
                       and e.link_confirmed_at is not null
                       and s.last_end <= now() - interval '24 hours'
                     else
                       e.status in ('cancelled', 'expired')
                       and e.link_confirmed_at is not null
                   end
             order by 2
             limit 100) x), '[]'::jsonb);
end $my_lessons_0283$;

comment on function app.my_lessons(text) is
  '0283 (db.md §4.7.9, guest.md §4.3; X7, C-21). Guest: the caller''s enrolments as flat rows (app.lesson_read_my_row: enrolment_id, kind, lesson_id, course_id, venue_id, coach card, type_name_*, title_*, start_at, end_at, session_no, sessions_count, first_session_no, sessions_covered, status, cancel_kind, lesson_status, attendance, booked_by, confirm_needed, rescheduled, party_size, payment_mode, price_iqd, paid_online_iqd, owed_iqd, refund, places_taken, min_places, cutoff_at, pending_payment, hold_expires_at). p_scope upcoming (held or booked, not ended or ended in the last 24 h; soonest first), past (booked, ended before that; latest first) or cancelled (cancelled or expired; latest first); at most 100. A pending link (a coach- or desk-typed phone that matched this account) is listed in upcoming only, until its lesson ends, with confirm_needed true and no money beyond price_iqd. INVALID_ARGUMENT for another scope. Never another student.';

revoke all on function app.my_lessons(text) from public, anon;
grant execute on function app.my_lessons(text) to authenticated;

-- One of the caller's enrolments (X8): the my_lessons row plus friend names,
-- the court, the covered sessions of a course, the server's cancel preview
-- (the rule lesson_cancel_mine applies, C-9, CD-2, R8, C-23, R62), what the
-- caller can do, and the branch's phone and time zone.
create or replace function app.my_lesson(p_enrolment_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $my_lesson_0283$
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
  v_can_pay := v_e.status = 'held' and coalesce(v_e.hold_expires_at > now(), false);
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
end $my_lesson_0283$;

comment on function app.my_lesson(uuid) is
  '0283 (db.md §4.7.9, guest.md §4.3; X8, C-9, C-21, C-23, CD-2, R8, R62). Guest: ENROLMENT_NOT_FOUND unless the enrolment names the caller in guest_id. The my_lessons row plus friend_names, court_name_* (once scheduled), sessions[{lesson_id, session_no, start_at, end_at, status, rescheduled, attendance}] (a course: the covered sessions), cancel {policy free | late | none, free_until, free_because (rescheduled | null), refund_iqd, kept_iqd (Money''s if_cancelled for the kind lesson_cancel_mine would apply), counts_late (a late cancel strikes: the guest booked it, CD-2), refund_sessions, kept_sessions, next_start_at (a course)}, can {cancel, pay, confirm}, branch_phone, timezone, server_now. A pending link answers the card only: no friend names, no court, can {cancel: false, pay: false, confirm: true}. Never another student.';

revoke all on function app.my_lesson(uuid) from public, anon;
grant execute on function app.my_lesson(uuid) to authenticated;

-- ===========================================================================
-- 5. Coach reads (coach_self() first; R45: a retired coach is NOT_A_COACH)
-- ===========================================================================

-- The coach's own lessons at every branch, and their time off (X10). No names.
create or replace function app.coach_schedule(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $coach_schedule_0283$
declare
  v_co coaches%rowtype := app.coach_self(true);
begin
  if p_from is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_from';
  elsif p_to is null or p_to <= p_from or p_to - p_from > interval '31 days' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_to';
  end if;

  return jsonb_build_object(
    'lessons', coalesce((
      select jsonb_agg(x.j order by x.start_at, x.id)
        from (select l.id, l.start_at,
                     jsonb_build_object(
                       'lesson_id', l.id,
                       'venue_id', l.venue_id,
                       'kind', l.kind,
                       'course_id', l.course_id,
                       'session_no', l.session_no,
                       'sessions_count', c.sessions_count,
                       'type_name_en', t.name_en,
                       'type_name_ar', t.name_ar,
                       'title_en', c.title_en,
                       'title_ar', c.title_ar,
                       'start_at', l.start_at,
                       'end_at', l.end_at,
                       'status', l.status,
                       'places_taken', case when l.course_id is not null then app.course_places_taken(l.course_id)
                                            else app.lesson_places_taken(l.id) end,
                       'max_places', l.max_places,
                       'min_places', l.min_places,
                       'cutoff_at', l.cutoff_at,
                       'court_name_en', k.name_en,
                       'court_name_ar', k.name_ar,
                       'unmarked', case
                                     when now() >= l.start_at and l.status in ('scheduled', 'completed') then
                                       (select count(*) from app.lesson_read_covering(l.id) e
                                         where e.status = 'booked'
                                           and not exists (select 1 from lesson_attendance a
                                                            where a.lesson_id = l.id and a.enrolment_id = e.id))::int
                                     else 0
                                   end) as j
                from lessons l
                join lesson_types t on t.id = l.lesson_type_id
                left join courses c on c.id = l.course_id
                left join lateral (select ct.name_en, ct.name_ar
                                     from reservations r
                                     join courts ct on ct.id = r.court_id
                                    where r.lesson_id = l.id
                                    order by (r.status in ('pending', 'confirmed', 'arrived', 'completed')) desc,
                                             r.created_at desc
                                    limit 1) k on true
               where l.coach_id = v_co.id
                 and l.start_at >= p_from
                 and l.start_at < p_to
                 and l.status <> 'expired') x), '[]'::jsonb),
    'time_off', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'starts_at', lower(o.period), 'ends_at', upper(o.period))
                       order by lower(o.period), o.id)
        from coach_time_off o
       where o.coach_id = v_co.id
         and o.cancelled_at is null
         and o.period && tstzrange(p_from, p_to, '[)')), '[]'::jsonb),
    'server_now', now());
end $coach_schedule_0283$;

comment on function app.coach_schedule(timestamptz, timestamptz) is
  '0283 (db.md §4.7.9, guest.md §4.3; X10, R45). Coach (coach_self first; NOT_A_COACH for a retired coach): INVALID_ARGUMENT (a NULL, p_to <= p_from, a window over 31 days). {lessons[{lesson_id, venue_id, kind, course_id, session_no, sessions_count, type_name_*, title_*, start_at, end_at, status, places_taken, max_places, min_places, cutoff_at, court_name_*, unmarked}] (the caller''s lessons at every branch starting in the window, every status but expired; unmarked = booked places with no attendance mark once started), time_off[{id, starts_at, ends_at}] (live, overlapping the window), server_now}. No names, phones or money.';

revoke all on function app.coach_schedule(timestamptz, timestamptz) from public, anon;
grant execute on function app.coach_schedule(timestamptz, timestamptz) to authenticated;

-- One of the coach's lessons with its roster (X11; C-16, CD-3, R44, R54).
create or replace function app.coach_lesson(p_lesson_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $coach_lesson_0283$
declare
  v_co            coaches%rowtype := app.coach_self(true);
  v_l             lessons%rowtype;
  v_c             courses%rowtype;
  v_t             lesson_types%rowtype;
  v_vs            venue_settings%rowtype;
  v_court_en      text;
  v_court_ar      text;
  v_taken         int;
  v_max           int;
  v_on            boolean;
  v_phone_until   timestamptz;
  v_roster        jsonb;
  v_course        jsonb;
  v_add           boolean;
  v_remove        boolean;
  v_cancel        boolean;
  v_cancel_course boolean;
  v_reschedule    boolean;
  v_mark          boolean;
begin
  if p_lesson_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_lesson_id';
  end if;
  -- Not yours is not found.
  select * into v_l from lessons where id = p_lesson_id and coach_id = v_co.id;
  if not found then
    raise exception 'LESSON_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_l.course_id is not null then
    select * into v_c from courses where id = v_l.course_id;
  end if;
  select * into v_t from lesson_types where id = v_l.lesson_type_id;
  select * into v_vs from venue_settings where venue_id = v_l.venue_id;
  select ct.name_en, ct.name_ar
    into v_court_en, v_court_ar
    from reservations r
    join courts ct on ct.id = r.court_id
   where r.lesson_id = v_l.id
   order by (r.status in ('pending', 'confirmed', 'arrived', 'completed')) desc, r.created_at desc
   limit 1;
  v_taken := case when v_c.id is not null then app.course_places_taken(v_c.id)
                  else app.lesson_places_taken(v_l.id) end;
  v_max := coalesce(v_c.max_places, v_l.max_places);
  v_on := coalesce(v_vs.coaching_enabled, false) and v_l.venue_id = any (app.open_venue_ids());
  v_phone_until := v_l.end_at + interval '7 days';

  -- The roster: live places covering this session. A coach- or staff-booked
  -- student as typed, linked or not, never the profile and never a fallback
  -- (R44; after the CD-8 purge the marker); a guest's own booking by the
  -- account. The phone goes at end_at + 7 days (R54) and is never shown
  -- while the place is held (P13). Nothing says whether a phone matched.
  select coalesce(jsonb_agg(jsonb_build_object(
           'enrolment_id', e.id,
           'name', case when e.booked_by_kind = 'guest' then p.full_name else e.guest_name end,
           'phone', case
                      when now() >= v_phone_until or e.status = 'held' then null
                      when e.booked_by_kind = 'guest' then p.phone
                      else e.guest_phone
                    end,
           'party_size', e.party_size,
           'friend_names', to_jsonb(e.friend_names),
           'booked_by', e.booked_by_kind,
           'payment_mode', e.payment_mode,
           'status', e.status,
           'attendance', (select a.status from lesson_attendance a
                           where a.lesson_id = v_l.id and a.enrolment_id = e.id))
           order by e.created_at, e.id), '[]'::jsonb)
    into v_roster
    from app.lesson_read_covering(v_l.id) e
    left join profiles p on p.id = e.guest_id and e.booked_by_kind = 'guest'
   where e.status in ('held', 'booked');

  if v_c.id is not null then
    select jsonb_build_object(
             'id', v_c.id,
             'status', v_c.status,
             'sessions', coalesce(jsonb_agg(jsonb_build_object(
                                    'lesson_id', x.id,
                                    'session_no', x.session_no,
                                    'start_at', x.start_at,
                                    'end_at', x.end_at,
                                    'status', x.status)
                                    order by x.session_no), '[]'::jsonb))
      into v_course
      from lessons x
     where x.course_id = v_c.id;
  end if;

  -- What coach mode may do (the coach RPCs' own refusals, mirrored).
  v_add := v_on
           and v_co.status = 'active'
           and v_l.status = 'scheduled'
           and v_taken < v_max
           and case v_l.kind
                 when 'group' then now() < v_l.end_at
                 when 'course' then v_c.status in ('open', 'running') and now() < v_c.signup_closes_at
                 else false
               end;
  v_remove := v_roster <> '[]'::jsonb
              and case v_l.kind
                    when 'group' then now() < v_l.start_at
                    when 'course' then now() < v_c.signup_closes_at
                    else false
                  end;
  v_cancel := v_l.kind in ('private', 'group')
              and v_l.status in ('held', 'scheduled')
              and now() < v_l.start_at;
  v_cancel_course := v_l.kind = 'course'
                     and v_c.status in ('open', 'running')
                     and exists (select 1 from lessons x
                                  where x.course_id = v_c.id and x.status = 'scheduled' and x.start_at > now());
  v_reschedule := v_l.status = 'scheduled' and now() < v_l.start_at;
  v_mark := v_l.status in ('scheduled', 'completed')
            and now() >= v_l.start_at
            and now() < v_l.start_at + interval '24 hours';

  return jsonb_build_object(
    'lesson', jsonb_build_object(
      'id', v_l.id,
      'venue_id', v_l.venue_id,
      'kind', v_l.kind,
      'course_id', v_l.course_id,
      'session_no', v_l.session_no,
      'sessions_count', v_c.sessions_count,
      'type_name_en', v_t.name_en,
      'type_name_ar', v_t.name_ar,
      'title_en', v_c.title_en,
      'title_ar', v_c.title_ar,
      'start_at', v_l.start_at,
      'end_at', v_l.end_at,
      'status', v_l.status,
      'cancel_reason', v_l.cancel_reason,
      'court_name_en', v_court_en,
      'court_name_ar', v_court_ar,
      'max_places', v_max,
      'min_places', coalesce(v_c.min_places, v_l.min_places),
      'places_taken', v_taken,
      'cutoff_at', v_l.cutoff_at),
    'course', v_course,
    'roster', v_roster,
    'can', jsonb_build_object(
      'add', coalesce(v_add, false),
      'remove', coalesce(v_remove, false),
      'cancel', coalesce(v_cancel, false),
      'cancel_course', coalesce(v_cancel_course, false),
      'reschedule', coalesce(v_reschedule, false),
      'mark', coalesce(v_mark, false)),
    'mark_until', v_l.start_at + interval '24 hours',
    'server_now', now());
end $coach_lesson_0283$;

comment on function app.coach_lesson(uuid) is
  '0283 (db.md §4.7.9, guest.md §4.3; X11, C-16, CD-3, R44, R45, R54). Coach (coach_self first; NOT_A_COACH for a retired coach): INVALID_ARGUMENT (NULL); LESSON_NOT_FOUND unless the lesson is the caller''s. {lesson {id, venue_id, kind, course_id, session_no, sessions_count, type_name_*, title_*, start_at, end_at, status, cancel_reason, court_name_*, max_places, min_places, places_taken, cutoff_at}, course {id, status, sessions[{lesson_id, session_no, start_at, end_at, status}]} | null, roster[{enrolment_id, name, phone, party_size, friend_names, booked_by, payment_mode, status, attendance}] (held and booked places covering the session), can {add, remove, cancel, cancel_course, reschedule, mark}, mark_until (start + 24 h), server_now}. A coach- or staff-booked student shows the name and phone as typed, never the linked profile''s (R44); a guest''s own booking shows the account''s. The phone is NULL from end_at + 7 days (R54) and while the place is held. Never money, a profile id, or whether a typed phone matched.';

revoke all on function app.coach_lesson(uuid) from public, anon;
grant execute on function app.coach_lesson(uuid) to authenticated;

-- ===========================================================================
-- 6. Desk reads (cashier, court_desk, manager, owner; the role first, R57)
-- ===========================================================================

-- The desk's lessons for a trading night, with the branch's settings and
-- catalogue (X16, R20: the desk never calls coaching_settings or
-- coaches_admin). Answers whether coaching is on or off (R51).
create or replace function app.desk_lessons(p_venue_id uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $desk_lessons_0283$
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
                   'paid_online', m.paid_online) as j
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
                     count(*) filter (where f.online > 0)::int as paid_online
                from (select e.status, e.payment_mode,
                             case when e.status = 'booked' and e.payment_mode = 'desk'
                                  then coalesce(app.lesson_fee_remaining(e.id, null), 0) else 0 end as take,
                             case when e.payment_mode = 'online'
                                  then coalesce((app.lesson_enrolment_money(e.id)->>'online_paid_iqd')::bigint, 0)
                                  else 0 end as online
                        from app.lesson_read_covering(l.id) e) f) m
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
end $desk_lessons_0283$;

comment on function app.desk_lessons(uuid, timestamptz, timestamptz) is
  '0283 (db.md §4.7.9, operator.md §5.6.1; X16, R20, R44, R51, R57, C-24). Cashier, court desk, manager, owner (the role first): FORBIDDEN; INVALID_ARGUMENT (a NULL, p_to <= p_from, a window over 7 days); FORBIDDEN unless staff at the branch (p_venue_id, default the resolved branch). {venue_id, coaching_enabled, lesson_payment_mode, server_now, coaches[{coach_id, display_name_*, status, photo_path, public_accepted, lesson_type_ids, prices[{lesson_type_id, price_iqd}]}] (active and paused coaches at the branch, accepted or not), lesson_types[{lesson_type_id, kind, name_*, duration_min, price_iqd, max_places, min_places, cutoff_hours, sessions_count}] (on sale), lessons[{lesson_id, reservation_id, court_id, court_name_*, kind, status, start_at, end_at, hold_expires_at, booked_by_kind, coach_id, coach_name_*, lesson_type_id, type_name_*, course {course_id, title_*, session_no, sessions_count} | null, label (a private lesson''s booker as recorded, R44), party_size, places_taken, max_places, min_places, cutoff_at, enrolments, owing, owing_iqd, paid_online}]} for the lessons held, scheduled or completed starting in the window. Answers whether coaching is on or off.';

revoke all on function app.desk_lessons(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function app.desk_lessons(uuid, timestamptz, timestamptz) to authenticated;

-- One lesson as the desk sees it (X17, operator.md §5.6.2). The can flags are
-- the server's word; the operator only mirrors them for offline and
-- capability.
create or replace function app.desk_lesson_detail(p_lesson_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $desk_lesson_detail_0283$
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
                     'take_iqd', mm.take),
                   'can', jsonb_build_object(
                     'take_payment', e.status = 'booked' and e.payment_mode = 'desk'
                                     and coalesce(mm.take, 0) > 0 and v_l.status <> 'cancelled',
                     'cancel', v_desk and e.status in ('held', 'booked')
                               and now() < case when e.course_id is not null then v_course_end else v_l.end_at end,
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
end $desk_lesson_detail_0283$;

comment on function app.desk_lesson_detail(uuid) is
  '0283 (db.md §4.7.9, operator.md §5.6.2; X17, C-21, R44, R57). Cashier, court desk, manager, owner (the role first): FORBIDDEN; INVALID_ARGUMENT (NULL); LESSON_NOT_FOUND (unknown, or outside app.visible_venue_ids()); VENUE_MISMATCH (visible but not staff there). {lesson {id, venue_id, kind, status, cancel_reason, start_at, end_at, duration_min, rescheduled_at, booked_by_kind, coach {coach_id, display_name_*, status}, lesson_type {lesson_type_id, name_*}, course {course_id, title_*, status, cancel_reason, session_no, sessions_count, signup_closes_at, places_taken, max_places, sessions[{lesson_id, session_no, start_at, end_at, status, court_name_*}]} | null, reservation_id, reservation_status, court_id, court_name_*, price_iqd, court_share_iqd, max_places, min_places, places_taken, cutoff_at, hold_expires_at, created_by_name, server_now, day_open, can {add_student, cancel, cancel_course, reschedule, move_court}}, enrolments[{enrolment_id, scope, status, cancel_kind, cancelled_at, customer_id, full_name, phone, typed, flags, party_size, friend_names, first_session_no, sessions_covered, booked_by_kind, booked_by_name, payment_mode, created_at, attendance {status, marked_at, marked_by_name} | null, money {price_iqd, owed_iqd, desk_paid_iqd, online_paid_iqd, refunded_iqd, kept_iqd, refund_due_iqd, take_iqd (lesson_fee_remaining)}, can {take_payment, cancel, mark_attended, mark_no_show, unmark}}], events[{at, type, actor, actor_name, enrolment_id, code, late}] (the last 50, newest first)}. A coach- or desk-booked student shows the name and phone recorded on the enrolment (typed true), never a linked profile''s; customer_id only for a guest''s own booking, a picked customer or a confirmed link (R44, C-21).';

revoke all on function app.desk_lesson_detail(uuid) from public, anon;
grant execute on function app.desk_lesson_detail(uuid) to authenticated;

-- A customer's lessons on the record (X18): only enrolments the customer
-- booked, was picked for at the desk, or confirmed (C-21: a pending link never
-- reaches a customer record), at the branches the caller sees; upcoming,
-- then the last 20.
create or replace function app.customer_lessons(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $customer_lessons_0283$
declare
  v_visible uuid[];
  v_co      coaches%rowtype;
  v_coach   jsonb;
  v_counts  jsonb;
  v_strikes int;
  v_lessons jsonb;
begin
  if not app.is_staff('cashier', 'court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_customer_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_customer_id';
  end if;
  if not exists (select 1 from profiles p where p.id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_visible := app.visible_venue_ids();

  select * into v_co from coaches where profile_id = p_customer_id;
  if v_co.id is not null then
    v_coach := jsonb_build_object(
      'coach_id', v_co.id,
      'status', v_co.status,
      'display_name_en', v_co.display_name_en,
      'display_name_ar', v_co.display_name_ar,
      'venue_ids', coalesce((select jsonb_agg(cb.venue_id order by cb.venue_id)
                               from coach_branches cb
                              where cb.coach_id = v_co.id and cb.active), '[]'::jsonb));
  end if;

  select jsonb_build_object(
           'lessons', count(*)::int,
           'no_shows', coalesce(sum((select count(*) from lesson_attendance a
                                      where a.enrolment_id = e.id and a.status = 'no_show')), 0)::int)
    into v_counts
    from lesson_enrolments e
   where e.guest_id = p_customer_id
     and e.link_confirmed_at is not null
     and e.venue_id = any (v_visible);

  select count(*)::int into v_strikes
    from lesson_strikes s
   where s.guest_id = p_customer_id
     and s.counted
     and s.struck_at > now() - interval '30 days';

  with mine as materialized (
    select e.id, e.status, e.course_id, e.venue_id, e.payment_mode,
           s.next_start, s.last_start, s.last_end,
           coalesce((select c.id from app.lesson_read_covered(e.id) c
                      where c.end_at > now() order by c.start_at, c.session_no limit 1),
                    (select c.id from app.lesson_read_covered(e.id) c
                      order by c.start_at desc, c.session_no desc nulls last limit 1)) as ref_id
      from lesson_enrolments e
      cross join lateral (
        select min(c.start_at) filter (where c.end_at > now()) as next_start,
               max(c.start_at) as last_start,
               max(c.end_at) as last_end
          from app.lesson_read_covered(e.id) c) s
     where e.guest_id = p_customer_id
       and e.link_confirmed_at is not null
       and e.venue_id = any (v_visible)
  ), picked as (
    (select m.*, 0 as grp, row_number() over (order by m.next_start, m.id) as ord
       from mine m
      where m.status in ('held', 'booked') and m.last_end > now()
      order by m.next_start, m.id
      limit 100)
    union all
    (select m.*, 1 as grp, row_number() over (order by m.last_start desc, m.id) as ord
       from mine m
      where not (m.status in ('held', 'booked') and m.last_end > now())
      order by m.last_start desc, m.id
      limit 20)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'enrolment_id', pk.id,
           'lesson_id', pk.ref_id,
           'course_id', pk.course_id,
           'venue_id', pk.venue_id,
           'kind', case when pk.course_id is not null then 'course' else l.kind end,
           'start_at', l.start_at,
           'end_at', l.end_at,
           'status', l.status,
           'enrolment_status', pk.status,
           'attendance', (select a.status from lesson_attendance a
                           where a.lesson_id = l.id and a.enrolment_id = pk.id),
           'type_name_en', t.name_en,
           'type_name_ar', t.name_ar,
           'coach_name_en', co.display_name_en,
           'coach_name_ar', co.display_name_ar,
           'course_title_en', c.title_en,
           'course_title_ar', c.title_ar,
           'payment_mode', pk.payment_mode,
           'money', jsonb_build_object(
             'owed_iqd', (mm.m->>'owed_iqd')::bigint,
             'desk_paid_iqd', (mm.m->>'desk_paid_iqd')::bigint,
             'online_paid_iqd', (mm.m->>'online_paid_iqd')::bigint,
             'refund_due_iqd', (mm.m->>'refund_due_iqd')::bigint,
             'take_iqd', mm.take))
           order by pk.grp, pk.ord), '[]'::jsonb)
    into v_lessons
    from picked pk
    join lessons l on l.id = pk.ref_id
    join lesson_types t on t.id = l.lesson_type_id
    join coaches co on co.id = l.coach_id
    left join courses c on c.id = pk.course_id
    cross join lateral (select app.lesson_enrolment_money(pk.id) as m,
                               coalesce(app.lesson_fee_remaining(pk.id, null), 0) as take) mm;

  return jsonb_build_object(
    'coach', v_coach,
    'counts', v_counts,
    'lesson_strikes_30d', v_strikes,
    'lessons', v_lessons);
end $customer_lessons_0283$;

comment on function app.customer_lessons(uuid) is
  '0283 (db.md §4.7.9, operator.md §5.6.3; X18, C-21, R44, R57). Cashier, court desk, manager, owner (the role first): FORBIDDEN; INVALID_ARGUMENT (NULL); CUSTOMER_NOT_FOUND. {coach {coach_id, status, display_name_*, venue_ids} | null (the customer''s own coach row), counts {lessons, no_shows}, lesson_strikes_30d (counted lesson strikes in 30 days; the ladder itself is guest_hold_standing), lessons[{enrolment_id, lesson_id (the session the row speaks of), course_id, venue_id, kind, start_at, end_at, status, enrolment_status, attendance, type_name_*, coach_name_*, course_title_*, payment_mode, money {owed_iqd, desk_paid_iqd, online_paid_iqd, refund_due_iqd, take_iqd}}] (upcoming first, then the last 20)}. Only enrolments the customer booked, was picked for at the desk, or confirmed (C-21), at the caller''s visible branches.';

revoke all on function app.customer_lessons(uuid) from public, anon;
grant execute on function app.customer_lessons(uuid) to authenticated;
