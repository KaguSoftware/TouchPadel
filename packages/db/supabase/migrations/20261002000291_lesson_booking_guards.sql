set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0291 lesson_booking_guards — the coaching post-build review, booking
-- guards (plan "Coaching: make it bulletproof" §1, items DB-07 to DB-14).
-- 0273–0289 are not edited: every function below is re-issued from its
-- latest body, verbatim except for the change named; dollar tags _0291.
--
--   DB-07 app.desk_cancel_enrolment (0283:3545): the place of a private
--         lesson that has started is LESSON_NOT_CANCELLABLE detail started
--         (cancelling it cancelled the lesson, so a lesson in progress or
--         already attended was cancelled and its money refunded). A group
--         sign-up keeps the end_at rule. desk_lesson_detail's can.cancel
--         follows in 0294 (DB-31).
--   DB-08 New app.lesson_assert_coach_bookable(coach, type, by), called after
--         lock_coach and the replay in app.desk_book_lesson (0283:3091),
--         app.coach_book_private (0283:2117), app.lesson_group_create_internal
--         (0283:1824) and app.lesson_course_create_internal (0283:1900): the
--         coach's status (retired COACH_NOT_FOUND for staff, NOT_A_COACH for
--         the coach; paused COACH_INACTIVE), the type link
--         (LESSON_TYPE_NOT_OFFERED), the type's is_active and the price
--         (app.lesson_price_for) are read again under the lock, and that
--         price is the one inserted.
--   DB-09 app.lesson_reschedule_internal (0283:2771): the course-session
--         order check and R47's cut-off run in both passes, so pass 2 reads
--         them again under the coach lock.
--   DB-10 app.match_expire_holds (0280:634) saves app.venue_id, sets it to
--         p_venue for its update and restores it (the 0263 pattern), so a
--         staff member who coaches at a branch where they are not staff is
--         no longer refused VENUE_MISMATCH by zz_branch_guard on a lapsed
--         hold there. Its twin app.expire_stale_holds (0280:602) is
--         re-issued unchanged in the same file (the twin rule).
--   DB-11 app.lesson_create_internal (0283:352) takes the branch row FOR KEY
--         SHARE first and refuses a branch that is not open
--         (COACH_NOT_AT_BRANCH). The key share conflicts with close_branch's
--         FOR UPDATE, so whichever comes second sees the other's result.
--         app.lesson_lock_branch_courts (0283:110), which every creating body
--         calls before it, takes the same key share right after the courts,
--         so the row is first locked before match_expire_holds' reservation
--         rows (the rank the lock walker needs; see "Locks" below).
--   DB-12 app.lesson_mark_internal (0283:2930): a course place cancelled by
--         its course's cancel (course_cancelled) stays markable on a session
--         that started before that cancel; the lesson status and the 24-hour
--         window still apply.
--   DB-13 app.lesson_link_confirm (0283:1715): "yes" on a place that is no
--         longer live (not held or booked, or its lesson, or a course
--         place's last covered session, has ended) is INVALID_TRANSITION
--         detail status. "Not me" is always allowed.
--   DB-14 app.coach_cancel_course (0283:2690): the duplicate answer carries
--         sessions_cancelled 0, as desk_cancel_course's does.
--
-- Locks: one new ranked lock, the branch's venues row FOR KEY SHARE, taken
-- after the coach mutex and the courts and before any reservations row
-- (scripts/lib/lock-order.mjs ranks venues between court_advisory and
-- reservations, once per sequence: a lesson body only ever touches one
-- branch, so lesson_create_internal's second key share is a re-grant).
-- open_branch and close_branch take the row FOR UPDATE and nothing ranked
-- after it. The booking sequence is now coach_advisory -> court_advisory ->
-- venues -> reservations -> match_venue_advisory -> match_tickets; the moves
-- and deposit_apply's lesson arm take the key share too.
--
-- Same signatures and grants (the new helper is internal, revoked from
-- every client role): the rls-matrix rows, the allowlist and the assistant
-- coverage stay as they are. No new error code.

-- ===========================================================================
-- DB-08: app.lesson_assert_coach_bookable (new)
-- ===========================================================================

-- The coach, the type and the price read again under app.lock_coach (db.md
-- §4.7.4). set_coach_status, set_coach_lesson_types and set_coach_price
-- change them under the same lock, so a booking queued behind one of them
-- must not go on with what it read before the lock: a retired coach's new
-- lesson was only swept away a minute later, and a paused coach's stayed.
-- Called after lock_coach and the replay by the four creation bodies that
-- read the coach before the lock (desk_book_lesson, coach_book_private and
-- the group and course internals). Returns the price to insert.
create or replace function app.lesson_assert_coach_bookable(p_coach_id uuid, p_lesson_type_id uuid, p_by text)
returns bigint
language plpgsql security definer set search_path = public as $lesson_assert_coach_bookable_0291$
declare
  v_status text;
  v_active boolean;
  v_price  bigint;
begin
  select c.status into v_status from coaches c where c.id = p_coach_id;
  if v_status is null or v_status = 'retired' then
    if p_by = 'coach' then
      raise exception 'NOT_A_COACH' using errcode = 'P0001';
    end if;
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_status = 'paused' then
    raise exception 'COACH_INACTIVE' using errcode = 'P0001';
  end if;
  select t.is_active into v_active from lesson_types t where t.id = p_lesson_type_id;
  if not coalesce(v_active, false) then
    raise exception 'LESSON_TYPE_INACTIVE' using errcode = 'P0001';
  end if;
  if not exists (select 1 from coach_lesson_types ct
                  where ct.coach_id = p_coach_id and ct.lesson_type_id = p_lesson_type_id) then
    raise exception 'LESSON_TYPE_NOT_OFFERED' using errcode = 'P0001';
  end if;
  v_price := app.lesson_price_for(p_coach_id, p_lesson_type_id);
  if v_price is null then
    raise exception 'LESSON_TYPE_INACTIVE' using errcode = 'P0001';
  end if;
  return v_price;
end $lesson_assert_coach_bookable_0291$;

comment on function app.lesson_assert_coach_bookable(uuid, uuid, text) is
  '0291 (db.md §4.7.4; DB-08). Internal; the caller holds lock_coach and has run its replay. Reads the coach, the type and the price again: a retired or unknown coach is NOT_A_COACH for p_by coach and COACH_NOT_FOUND otherwise; paused COACH_INACTIVE; an inactive type LESSON_TYPE_INACTIVE; a type the coach no longer teaches LESSON_TYPE_NOT_OFFERED; no price LESSON_TYPE_INACTIVE. Returns app.lesson_price_for(coach, type), the price the caller inserts.';

revoke all on function app.lesson_assert_coach_bookable(uuid, uuid, text) from public, anon, authenticated;

-- ===========================================================================
-- DB-11: app.lesson_create_internal (re-issued from 0283:352)
-- ===========================================================================

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
language plpgsql security definer set search_path = public as $lesson_create_internal_0291$
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
  -- 0291 (DB-11): the branch row FOR KEY SHARE, open. It conflicts with
  -- close_branch's FOR UPDATE, so whichever comes second sees the other's
  -- result: a lesson never lands at a branch that has just closed.
  perform 1 from venues where id = v_t.venue_id and status = 'open' for key share;
  if not found then
    raise exception 'COACH_NOT_AT_BRANCH' using errcode = 'P0001';
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
end $lesson_create_internal_0291$;

comment on function app.lesson_create_internal(uuid, uuid, timestamptz, uuid, smallint, bigint, boolean, text, uuid, uuid, text, uuid[]) is
  '0283 (db.md §4.7.2, §3.4), 0291 (DB-11). Internal. Takes the branch row FOR KEY SHARE and refuses a branch that is not open (COACH_NOT_AT_BRANCH; the key share waits for a close_branch in flight, so a lesson never lands at a branch that has just closed). Inserts one lesson (held with hold_expires_at = now() + deposit_window_seconds when p_held, else scheduled) with its snapshots, and its court row on a court picked from p_locked (kind hold pending while held, else kind lesson confirmed; guest_id NULL, guest_name Lesson, no price). The caller holds lock_coach and the courts and has expired stale holds over the period. NO_COURT_FREE when no locked court is free (or on reservations_no_overlap); COACH_BUSY on lessons_coach_no_overlap. Writes no event.';

revoke all on function app.lesson_create_internal(uuid, uuid, timestamptz, uuid, smallint, bigint, boolean, text, uuid, uuid, text, uuid[])
  from public, anon, authenticated;

-- ===========================================================================
-- DB-11: app.lesson_lock_branch_courts (re-issued from 0283:110)
-- ===========================================================================
-- The branch row's key share is taken here first, right after the courts and
-- before match_expire_holds' reservation rows: every body that creates a
-- lesson calls this before app.lesson_create_internal, whose own key share
-- (and status check) is then a re-grant of the same row. Taken only in
-- lesson_create_internal, after the stale holds, the lock walker reads the
-- reservations trigger it expands under match_expire_holds' update as
-- match_tickets before venues. No status check here: the move bodies and
-- Money's deposit_apply lesson arm call it too, and a move or a payment at a
-- closing branch is not refused by this file.
create or replace function app.lesson_lock_branch_courts(p_venue uuid) returns uuid[]
language plpgsql security definer set search_path = public as $lesson_lock_branch_courts_0291$
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
  -- 0291 (DB-11): the branch row, FOR KEY SHARE (close_branch takes it FOR UPDATE).
  perform 1 from venues where id = p_venue for key share;
  return v_ids;
end $lesson_lock_branch_courts_0291$;

comment on function app.lesson_lock_branch_courts(uuid) is
  '0283 (db.md §2.2; R34), 0291 (DB-11). Internal. app.lock_court on every active court of the branch in id order, then the branch row FOR KEY SHARE (it waits for a close_branch in flight; app.lesson_create_internal refuses a branch that is not open); returns the court ids it locked. The booking and move bodies, and Money''s deposit_apply lesson arm, take it after the coach lock and pick a court only from the set.';

revoke all on function app.lesson_lock_branch_courts(uuid) from public, anon, authenticated;

-- ===========================================================================
-- DB-10: app.expire_stale_holds (re-issued from 0280:602) and its twin app.match_expire_holds (0280:634)
-- ===========================================================================
-- The twin rule: whoever re-issues one re-issues the other in the same file.
-- expire_stale_holds is re-issued unchanged (DB-10 is about the coaching
-- bodies' calls to match_expire_holds); create or replace keeps 0268's
-- grants on both.

create or replace function app.expire_stale_holds(
  p_court_id uuid default null,
  p_period   tstzrange default null
) returns int
language plpgsql security definer set search_path = public as $expire_stale_holds_0291$
declare v_count int;
begin
  update reservations
     set status = 'expired'
   where id in (
     select r.id from reservations r
      where r.kind = 'hold' and r.status = 'pending'
        and (r.hold_expires_at < now() or (r.guest_id is null and r.lesson_id is null))   -- 0071 (SEC-07): orphans too;
                                                                                          -- 0280 (R25): a lesson's court hold is no orphan
        and (p_court_id is null or r.court_id = p_court_id)
        and (p_period is null or r.period && p_period)
        and not exists (select 1 from booking_payments bp
                         where bp.hold_id = r.id
                           and bp.status in ('created', 'pending')
                           and bp.deadline_at > now() - interval '10 minutes')
      order by r.id
      for update of r
   );
  get diagnostics v_count = row_count;
  return v_count;
end $expire_stale_holds_0291$;

comment on function app.expire_stale_holds(uuid, tstzrange) is
  '0071: expires holds past their TTL AND orphan holds (guest_id is null), which no caller can release through app.release_hold and which would otherwise occupy the court until TTL. 0242: skips a hold whose online payment is still open, until ten minutes after that payment''s deadline. 0268: only expires — strikes are settled by the tp_hold_strikes cron (app.hold_strikes_settle) in a transaction of their own — and is no longer granted to clients. 0280 (R25): a pending hold that names a lesson (reservations.lesson_id, a private lesson''s court hold while its Qi payment is open) is not an orphan: it expires by its TTL like any hold, and its open payment holds it as a deposit''s does.';

-- match_expire_holds: 0291 (DB-10) asserts the branch it expires at. A
-- coaching body calls it before any set_config of its own, so a staff member
-- who coaches at a branch where they are not staff met zz_branch_guard's
-- VENUE_MISMATCH on a lapsed hold there. app.venue_id is saved, set to
-- p_venue for the update and restored after it (the 0263
-- trg_reservation_match pattern), so the caller's own assertion is unchanged.
create or replace function app.match_expire_holds(p_venue uuid, p_period tstzrange) returns int
language plpgsql security definer set search_path = public as $match_expire_holds_0291$
declare
  v_count int;
  v_saved text := current_setting('app.venue_id', true);
begin
  perform set_config('app.venue_id', p_venue::text, true);
  update reservations
     set status = 'expired'
   where id in (
     select r.id from reservations r
      where r.kind = 'hold' and r.status = 'pending'
        and (r.hold_expires_at < now() or (r.guest_id is null and r.lesson_id is null))   -- 0071 (SEC-07): orphans too;
                                                                                          -- 0280 (R25): a lesson's court hold is no orphan
        and r.venue_id = p_venue
        and (p_period is null or r.period && p_period)
        and not exists (select 1 from booking_payments bp
                         where bp.hold_id = r.id
                           and bp.status in ('created', 'pending')
                           and bp.deadline_at > now() - interval '10 minutes')
      order by r.id
      for update of r
   );
  get diagnostics v_count = row_count;
  perform set_config('app.venue_id', coalesce(v_saved, ''), true);
  return v_count;
end $match_expire_holds_0291$;

comment on function app.match_expire_holds(uuid, tstzrange) is
  '0260. Internal. The branch-scoped twin of app.expire_stale_holds (0242, 0252): expires the branch''s stale and orphan holds overlapping p_period in ONE id-ordered statement, skipping a hold whose online payment is still open. Settles no hold-ladder strike: like expire_stale_holds with arguments, it leaves a lapse to the guest''s next hold_slot or to tp_hold_sweep (0252). Whoever re-issues expire_stale_holds re-issues this in the same file (a test pins the two to the same rows). 0280 (R25): like expire_stale_holds, a pending hold that names a lesson is not an orphan; it expires by its TTL. 0291 (DB-10): sets app.venue_id to p_venue for the update and restores the caller''s value after it, so a coaching body that has not asserted its branch yet (a staff member coaching at a branch where they are not staff) is not refused VENUE_MISMATCH by zz_branch_guard.';

-- ===========================================================================
-- DB-13: app.lesson_link_confirm (re-issued from 0283:1715)
-- ===========================================================================

create or replace function app.lesson_link_confirm(p_enrolment_id uuid, p_yes boolean) returns jsonb
language plpgsql security definer set search_path = public as $lesson_link_confirm_0291$
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
  -- 0291 (DB-13): "yes" links a live place only: held or booked, and its
  -- lesson (a course place: its last covered session) not yet ended. "Not
  -- me" is always allowed.
  if p_yes
     and (v_e.status not in ('held', 'booked')
          or (v_e.lesson_id is not null
              and exists (select 1 from lessons l where l.id = v_e.lesson_id and l.end_at <= now()))
          or (v_e.course_id is not null
              and not exists (select 1 from lessons s
                               where s.course_id = v_e.course_id and s.end_at > now()
                                 and s.session_no between v_e.first_session_no
                                                      and v_e.first_session_no + v_e.sessions_covered - 1))) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'status';
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
end $lesson_link_confirm_0291$;

comment on function app.lesson_link_confirm(uuid, boolean) is
  '0283 (db.md §4.7.5; C-21, R44). Guest: answer "Is this you?" for a place a coach or the desk added from a phone that matched the caller''s verified phone. lesson_guest(false); INVALID_ARGUMENT p_enrolment_id | p_yes; ENROLMENT_NOT_FOUND unless the place names the caller and was not booked by them; already confirmed: yes -> {duplicate: true}, no -> INVALID_TRANSITION detail confirmed (cancel it instead). Under the coach lock: 0291 (DB-13) yes on a place that is no longer live (not held or booked, or its lesson, or a course place''s last covered session, has ended) -> INVALID_TRANSITION detail status, while no is always allowed; yes stamps link_confirmed_at; no sets guest_id NULL (a walk-in again). No lesson_events row, no push (the coach is never told); audited coaching.link.confirm | decline with ids only. Returns {enrolment_id, linked, duplicate}.';

revoke all on function app.lesson_link_confirm(uuid, boolean) from public, anon;
grant execute on function app.lesson_link_confirm(uuid, boolean) to authenticated;

-- ===========================================================================
-- DB-08: app.lesson_group_create_internal (re-issued from 0283:1824)
-- ===========================================================================

create or replace function app.lesson_group_create_internal(p_coach_id uuid, p_lesson_type_id uuid,
                                                            p_start_at timestamptz, p_by text, p_profile_id uuid,
                                                            p_staff_id uuid, p_key text, p_degraded boolean)
returns jsonb
language plpgsql security definer set search_path = public as $lesson_group_create_internal_0291$
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
  -- 0291 (DB-08): the coach, the type link and the price again, under the lock.
  v_price := app.lesson_assert_coach_bookable(p_coach_id, v_t.id, p_by);
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
end $lesson_group_create_internal_0291$;

comment on function app.lesson_group_create_internal(uuid, uuid, timestamptz, text, uuid, uuid, text, boolean) is
  '0283 (db.md §4.7.4; C-13, R9, R15, R47), 0291 (DB-08). Internal: the shared body of coach_create_group and desk_create_group after their guards and type checks. SLOT_NOT_ON_GRID, SLOT_IN_PAST, CLOSED_DATE, OUTSIDE_HOURS; LESSON_CLOSED detail cutoff (start - cutoff_hours <= now); DEGRADED_LOCKOUT when p_degraded (the coach); COACH_UNAVAILABLE; under the coach lock the replay, then app.lesson_assert_coach_bookable (COACH_NOT_FOUND or NOT_A_COACH for a coach retired meanwhile, COACH_INACTIVE, LESSON_TYPE_NOT_OFFERED, LESSON_TYPE_INACTIVE; the price read again), and COACH_BUSY / COACH_UNAVAILABLE; every court; app.lesson_create_internal (the price read under the lock, key on the lesson). Event booked {court_id, lesson_id}; audit coaching.lesson.book. Returns app.lesson_group_answer.';

revoke all on function app.lesson_group_create_internal(uuid, uuid, timestamptz, text, uuid, uuid, text, boolean)
  from public, anon, authenticated;

-- ===========================================================================
-- DB-08: app.lesson_course_create_internal (re-issued from 0283:1900)
-- ===========================================================================

create or replace function app.lesson_course_create_internal(p_coach_id uuid, p_lesson_type_id uuid,
                                                             p_starts timestamptz[], p_title_en text, p_title_ar text,
                                                             p_by text, p_profile_id uuid, p_staff_id uuid,
                                                             p_key text, p_degraded boolean)
returns jsonb
language plpgsql security definer set search_path = public as $lesson_course_create_internal_0291$
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
  -- 0291 (DB-08): the coach, the type link and the price again, under the lock.
  v_price := app.lesson_assert_coach_bookable(p_coach_id, v_t.id, p_by);
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
end $lesson_course_create_internal_0291$;

comment on function app.lesson_course_create_internal(uuid, uuid, timestamptz[], text, text, text, uuid, uuid, text, boolean) is
  '0283 (db.md §4.7.4; C-13, C-15, C-19, R15, R47, X31), 0291 (DB-08: after the replay under the coach lock, app.lesson_assert_coach_bookable checks the coach, the type link and the type again and reads the price the course row takes). Internal: the shared body of coach_create_course and desk_create_course, all or nothing. COURSE_STARTS_INVALID detail count (cardinality <> sessions_count, a NULL start) | order (not strictly increasing, or a session ending after the next starts) | span (over 366 days); per start i (1-based) SLOT_NOT_ON_GRID, SLOT_IN_PAST, CLOSED_DATE, OUTSIDE_HOURS, COACH_UNAVAILABLE detail i; LESSON_CLOSED detail cutoff (start 1 - cutoff_hours <= now); DEGRADED_LOCKOUT when p_degraded; under the coach lock the replay and per start COACH_BUSY detail i; every court; the course row (price = app.lesson_price_for, snapshots, cutoff_at, signup_closes_at = the last start), then one session per start (NO_COURT_FREE / COACH_BUSY re-raised with detail i, the whole call rolled back). Event booked on the course; audit coaching.course.create. Returns app.lesson_course_answer (X13).';

revoke all on function app.lesson_course_create_internal(uuid, uuid, timestamptz[], text, text, text, uuid, uuid, text, boolean)
  from public, anon, authenticated;

-- ===========================================================================
-- DB-08: app.coach_book_private (re-issued from 0283:2117)
-- ===========================================================================

create or replace function app.coach_book_private(
  p_lesson_type_id  uuid,
  p_venue_id        uuid,
  p_start_at        timestamptz,
  p_student_name    text,
  p_student_phone   text,
  p_party_size      int,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = public as $coach_book_private_0291$
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
  -- 0291 (DB-08): the coach's status (paused COACH_INACTIVE, retired
  -- NOT_A_COACH), the type link and the price again, under the lock.
  v_price := app.lesson_assert_coach_bookable(v_c.id, v_t.id, 'coach');
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
end $coach_book_private_0291$;

comment on function app.coach_book_private(uuid, uuid, timestamptz, text, text, int, text) is
  '0283, 0291 (db.md §4.7.4; C-8, C-21, C-24, CD-1, CD-9, R10, R15, R44, R56). Coach: book a private lesson for a student (name 1..80, optional phone, party 1..4), desk-paid. coach_self; INVALID_ARGUMENT; lock_principal(coach_students), replay, COACH_ADD_LIMIT detail day (30 coach adds in 24 h); LESSON_TYPE_NOT_FOUND (a private type at p_venue_id), COACH_NOT_AT_BRANCH, COACHING_OFF, COACH_INACTIVE, LESSON_TYPE_INACTIVE, LESSON_TYPE_NOT_OFFERED, PARTY_TOO_LARGE; SLOT_NOT_ON_GRID, SLOT_IN_PAST, CLOSED_DATE, OUTSIDE_HOURS, DEGRADED_LOCKOUT; COACH_UNAVAILABLE; under the coach lock the replay, app.lesson_assert_coach_bookable (0291, DB-08: COACH_INACTIVE, NOT_A_COACH, LESSON_TYPE_NOT_OFFERED, LESSON_TYPE_INACTIVE; the price read again), COACH_ADD_LIMIT detail live (coach_max_open_private upcoming coach-booked private lessons at the branch), COACH_BUSY; every court; NO_COURT_FREE. A typed phone matching a verified account links it pending (C-21); the answer, the work and the refusals are the same either way (R10). Events booked and added; audit coaching.lesson.book. Returns {duplicate, lesson_id, enrolment_id, start_at, end_at, court_id, court_name_en, court_name_ar, price_iqd, ...}.';

revoke all on function app.coach_book_private(uuid, uuid, timestamptz, text, text, int, text) from public, anon;
grant execute on function app.coach_book_private(uuid, uuid, timestamptz, text, text, int, text) to authenticated;

-- ===========================================================================
-- DB-14: app.coach_cancel_course (re-issued from 0283:2690)
-- ===========================================================================

create or replace function app.coach_cancel_course(p_course_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $coach_cancel_course_0291$
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
      -- 0291 (DB-14): the duplicate carries sessions_cancelled, as desk_cancel_course's does.
      return jsonb_build_object('ok', true, 'duplicate', true, 'course_id', v_co.id, 'status', v_co.status,
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

  v_r := app.course_cancel_internal(v_co.id, 'coach_cancel', 'coach', v_c.profile_id, null);
  perform app.write_audit('coaching.course.cancel', 'courses', v_co.id::text, null,
                          jsonb_build_object('course_id', v_co.id, 'by', 'coach', 'reason', v_code,
                                             'sessions_cancelled', v_r->'sessions_cancelled',
                                             'enrolments', v_r->'enrolments'),
                          p_reason);
  return jsonb_build_object('ok', true, 'duplicate', false, 'course_id', v_co.id, 'status', 'cancelled',
                            'sessions_cancelled', v_r->'sessions_cancelled', 'enrolments', v_r->'enrolments');
end $coach_cancel_course_0291$;

comment on function app.coach_cancel_course(uuid, text) is
  '0283 (db.md §4.7.7; C-19). Coach: cancel the rest of one of the caller''s courses (sessions not yet started; one refund per payment, R28). coach_self; INVALID_ARGUMENT p_reason; LESSON_NOT_FOUND; LESSON_NOT_CANCELLABLE status (not open or running) | ended (no session left to start); already cancelled by the coach -> {duplicate: true, sessions_cancelled: 0} (0291, DB-14); app.course_cancel_internal. Audit coaching.course.cancel. Returns {ok, duplicate, course_id, status, sessions_cancelled, enrolments}.';

revoke all on function app.coach_cancel_course(uuid, text) from public, anon;
grant execute on function app.coach_cancel_course(uuid, text) to authenticated;

-- ===========================================================================
-- DB-09: app.lesson_reschedule_internal (re-issued from 0283:2771)
-- ===========================================================================

create or replace function app.lesson_reschedule_internal(p_lesson_id uuid, p_start_at timestamptz, p_actor text,
                                                          p_profile_id uuid, p_staff_id uuid, p_degraded boolean)
returns jsonb
language plpgsql security definer set search_path = public as $lesson_reschedule_internal_0291$
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
    end if;
    -- 0291 (DB-09): steps 4 and 5 run in both passes, so pass 2 reads the
    -- neighbours and the cut-off again under the coach lock (two moves of
    -- neighbouring sessions each checked the other's old time).
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
    if v_pass = 1 then
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
end $lesson_reschedule_internal_0291$;

comment on function app.lesson_reschedule_internal(uuid, timestamptz, text, uuid, uuid, boolean) is
  '0283, 0291 (db.md §4.7.6; R8, R32, R33, R47, R66). Internal: the shared body of coach_reschedule_session and desk_reschedule_session. INVALID_TRANSITION detail held; SESSION_NOT_MOVABLE ended | started; the same start -> {duplicate: true}; SLOT_NOT_ON_GRID, SLOT_IN_PAST, CLOSED_DATE, OUTSIDE_HOURS; DEGRADED_LOCKOUT when p_degraded; SESSION_NOT_MOVABLE order (a course session stays between its live neighbours); LESSON_CLOSED cutoff (an unjudged cut-off only, R66); COACH_UNAVAILABLE; under the coach lock (0291, DB-09) the order and the cut-off read again, then COACH_BUSY (itself left out); every court, the lesson''s court row FOR UPDATE, stale holds; its own court when free, else app.lesson_pick_court (NO_COURT_FREE). Stamps rescheduled_at; an unjudged cut-off follows the start (a course''s from session 1, on the course and every session); the last session''s start becomes signup_closes_at. Event rescheduled {from_start_at, to_start_at, court_id}; audit coaching.reschedule. Returns {duplicate, lesson_id, start_at, end_at, rescheduled_at, court_id, court_name_en, court_name_ar}.';

revoke all on function app.lesson_reschedule_internal(uuid, timestamptz, text, uuid, uuid, boolean)
  from public, anon, authenticated;

-- ===========================================================================
-- DB-12: app.lesson_mark_internal (re-issued from 0283:2930)
-- ===========================================================================

create or replace function app.lesson_mark_internal(p_lesson_id uuid, p_enrolment_id uuid, p_status text,
                                                    p_actor text, p_profile_id uuid, p_staff_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $lesson_mark_internal_0291$
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
    -- 0291 (DB-12): a course place the course's cancel ended stays markable on
    -- every session that started before that cancel (the session in progress
    -- runs to its end, C-19); the lesson status and the 24-hour window still apply.
    if v_e.status <> 'booked'
       and not (v_e.status = 'cancelled' and v_e.cancel_kind = 'course_cancelled' and v_e.course_id is not null
                and v_l.start_at < v_e.cancelled_at) then
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
end $lesson_mark_internal_0291$;

comment on function app.lesson_mark_internal(uuid, uuid, text, text, uuid, uuid) is
  '0283, 0291 (db.md §4.7.8, §3.5; CD-2, CD-11, R31). Internal: the shared body of coach_mark_attendance and desk_mark_attendance. ENROLMENT_NOT_FOUND (not of this lesson, nor of its course covering the session); INVALID_TRANSITION not_started | marks_closed (24 h after the start) | not_booked (0291, DB-12: a course place the course''s cancel ended is still markable on a session that started before that cancel) | cancelled; under the coach lock again; the same mark -> {duplicate: true}. Upserts (or for clear deletes) the lesson_attendance row; no_show records a strike through app.lesson_strike_record (a place the guest booked only); attended or clear after a no-show deletes the unsettled strike row SKIP LOCKED. Event attended | no_show | unmarked; audit coaching.attendance. Returns {duplicate, lesson_id, enrolment_id, attendance, status}.';

revoke all on function app.lesson_mark_internal(uuid, uuid, text, text, uuid, uuid) from public, anon, authenticated;

-- ===========================================================================
-- DB-08: app.desk_book_lesson (re-issued from 0283:3091)
-- ===========================================================================

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
language plpgsql security definer set search_path = public as $desk_book_lesson_0291$
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
  -- 0291 (DB-08): the coach's status, the type link and the price again, under the lock.
  v_price := app.lesson_assert_coach_bookable(v_c.id, v_t.id, 'staff');
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
end $desk_book_lesson_0291$;

comment on function app.desk_book_lesson(uuid, uuid, timestamptz, uuid, text, text, int, text) is
  '0283, 0291 (db.md §4.7.4; C-8, C-21, D-12, R44, R56, R57, R68, X29). Desk (court_desk, manager, owner): book a private lesson for a picked customer (p_customer_id: linked at once, the profile''s name and phone copied) or a typed student (p_name, optional p_phone: a verified match links pending). FORBIDDEN (role first); INVALID_ARGUMENT (exactly one of p_customer_id and p_name; name, phone, party, key); LESSON_TYPE_NOT_FOUND (a private type at a visible branch); VENUE_MISMATCH; CUSTOMER_NOT_FOUND; replay; COACH_NOT_FOUND, COACH_NOT_AT_BRANCH, COACH_INACTIVE, LESSON_TYPE_INACTIVE, LESSON_TYPE_NOT_OFFERED, PARTY_TOO_LARGE, ALREADY_ENROLLED detail coach; SLOT_NOT_ON_GRID, SLOT_IN_PAST, CLOSED_DATE, OUTSIDE_HOURS; COACH_UNAVAILABLE; under the coach lock the replay, app.lesson_assert_coach_bookable (0291, DB-08: COACH_NOT_FOUND, COACH_INACTIVE, LESSON_TYPE_NOT_OFFERED, LESSON_TYPE_INACTIVE; the price read again) and COACH_BUSY; every court; NO_COURT_FREE. Never COACHING_OFF, BEYOND_HORIZON or DEGRADED_LOCKOUT. Events booked and added; audit coaching.lesson.book. Returns (X29) {duplicate, lesson_id, enrolment_id, court_id, court_name_en, court_name_ar, start_at, end_at, price_iqd, ...}.';

revoke all on function app.desk_book_lesson(uuid, uuid, timestamptz, uuid, text, text, int, text) from public, anon;
grant execute on function app.desk_book_lesson(uuid, uuid, timestamptz, uuid, text, text, int, text) to authenticated;

-- ===========================================================================
-- DB-07: app.desk_cancel_enrolment (re-issued from 0283:3545)
-- ===========================================================================

create or replace function app.desk_cancel_enrolment(p_enrolment_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $desk_cancel_enrolment_0291$
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
    -- 0291 (DB-07): cancelling a private lesson's booker cancels the lesson
    -- itself, so once it has started it is refused, as desk_cancel_lesson is
    -- (the money stays; a group sign-up keeps the end_at rule above).
    if v_e.lesson_id is not null
       and exists (select 1 from lessons l
                    where l.id = v_e.lesson_id and l.kind = 'private' and l.start_at <= now()) then
      raise exception 'LESSON_NOT_CANCELLABLE' using errcode = 'P0001', detail = 'started';
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
end $desk_cancel_enrolment_0291$;

comment on function app.desk_cancel_enrolment(uuid, text) is
  '0283, 0291 (db.md §4.7.7; C-9, CD-2, X29). Desk: cancel one place (a private lesson goes with it as staff_cancel). FORBIDDEN (role first); INVALID_ARGUMENT p_reason; ENROLMENT_NOT_FOUND (unknown, not visible); VENUE_MISMATCH; already cancelled by staff -> {duplicate: true}; LESSON_NOT_CANCELLABLE status | ended (the lesson, or the course''s last covered session, has ended) | started (0291, DB-07: a private lesson once it has started, since its booker''s cancel cancels the lesson); under the coach lock again; app.enrolment_cancel_internal(kind staff): online money refunded through Money''s engine, never a strike. Audit coaching.student.remove. Returns (X29) {duplicate, enrolment_id, status, lesson_cancelled, refunds_started, refund_due_iqd (desk money now due back), online_refund (the amount the online refund started)}.';

revoke all on function app.desk_cancel_enrolment(uuid, text) from public, anon;
grant execute on function app.desk_cancel_enrolment(uuid, text) to authenticated;
