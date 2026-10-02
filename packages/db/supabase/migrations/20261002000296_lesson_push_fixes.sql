set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0296 lesson_push_fixes — the coaching post-build review, the lesson push
-- fan-out (plan "Coaching: make it bulletproof" §1, items DB-42 to DB-44;
-- guest.md §4.5.1, §4.5.4; money.md §6.4 step 7). 0273–0289 are not edited:
-- every function below is re-issued from its latest body (0283), verbatim
-- except for the change named and marked 0296; dollar tags _0296.
--
--   DB-42 Pushes for a second session moved, or the same session moved
--         again, within 15 minutes were deduped away: the guest's dedupe was
--         l:<enrolment>:<key>, one per course enrolment, and the coach's
--         l:<lesson>:<key>. Both helpers take an optional p_suffix appended
--         to the dedupe; the trigger passes :<lesson>:<to_start_at> for
--         rescheduled (lesson.rescheduled, coach.rescheduled_by_staff) and
--         :<lesson>:<to_court_id> for court_moved (lesson.court_moved,
--         coach.court_moved; the event's id when the data has no court). A
--         second move pushes; an identical replay of the same move does not.
--         An expired event that carries data.reason (0295, DB-35: the guest
--         paid, the place could not be given, the money goes back whole) no
--         longer sends lesson.payment_expired: the guest did not lapse.
--   DB-43 A late Qi success that revives an expired place (paid_online with
--         data.revived true, 0295) also sends lesson.booked to the guest: the
--         payment screen that X15 relies on is long closed, and the guest was
--         last told payment_expired.
--   DB-44 coach.new_student and coach.student_cancelled deduped on the
--         places count, so A joins, A cancels, B joins inside 15 minutes lost
--         B's push. lesson_read_push_coach takes p_enrolment_id: the dedupe
--         becomes l:<lesson>:<key>:<enrolment>, falling back to the count
--         when no enrolment is named. The trigger passes new.enrolment_id on
--         every coach.new_student and coach.student_cancelled call.
--
-- Signature changes: app.lesson_read_push_guest(uuid, text, uuid) becomes
-- (uuid, text, uuid, text) and app.lesson_read_push_coach(uuid, text, jsonb)
-- becomes (uuid, text, jsonb, uuid, text): the old ones are dropped by exact
-- signature and the new ones created with the same revoke (internal, granted
-- to nobody; the trigger is their only caller). No lock, no new error code,
-- no new title key, no change to app.lesson_notify.

-- ===========================================================================
-- DB-42: app.lesson_read_push_guest (re-issued from 0283:4429, new p_suffix)
-- ===========================================================================

drop function if exists app.lesson_read_push_guest(uuid, text, uuid);

-- A guest push about one enrolment, deduped per enrolment and key (guest.md
-- §4.5.1: l:<p_ref>:<title_key>), plus p_suffix when the caller names the
-- change (0296, DB-42: a move names its session and its new start or court,
-- so a course's second moved session, or a second move, still pushes).
-- Nothing without a lesson to name.
create or replace function app.lesson_read_push_guest(p_enrolment_id uuid, p_title_key text, p_lesson_id uuid,
                                                      p_suffix text default null)
returns int
language plpgsql security definer set search_path = public as $lesson_read_push_guest_0296$
begin
  if p_enrolment_id is null or p_lesson_id is null then
    return 0;
  end if;
  return app.lesson_notify(p_enrolment_id, p_title_key,
                           'l:' || p_enrolment_id::text || ':' || p_title_key || coalesce(p_suffix, ''),
                           jsonb_build_object('lesson_id', p_lesson_id::text));
end $lesson_read_push_guest_0296$;

comment on function app.lesson_read_push_guest(uuid, text, uuid, text) is
  '0283, 0296 (Guest part; DB-42). Internal: app.lesson_notify for one enrolment (route lesson) with params {lesson_id} and the dedupe l:<enrolment>:<title_key><p_suffix> (the trigger passes :<lesson>:<to_start_at> for lesson.rescheduled and :<lesson>:<to_court_id> for lesson.court_moved, none otherwise); 0 when either id is NULL. Called only by the lesson_events_notify trigger.';

revoke all on function app.lesson_read_push_guest(uuid, text, uuid, text) from public, anon, authenticated;

-- ===========================================================================
-- DB-42, DB-44: app.lesson_read_push_coach (re-issued from 0283:4449, new
-- p_enrolment_id and p_suffix)
-- ===========================================================================

drop function if exists app.lesson_read_push_coach(uuid, text, jsonb);

-- A coach push about one lesson (route coach_lesson). coach.new_student and
-- coach.student_cancelled add the enrolment to the dedupe (0296, DB-44: the
-- places count let A joins, A cancels, B joins swallow B's push), or the
-- count when no enrolment is named, so each change pushes and a retry does
-- not. p_suffix names a move (0296, DB-42).
create or replace function app.lesson_read_push_coach(p_lesson_id uuid, p_title_key text, p_places jsonb default '{}',
                                                      p_enrolment_id uuid default null,
                                                      p_suffix text default null)
returns int
language plpgsql security definer set search_path = public as $lesson_read_push_coach_0296$
begin
  if p_lesson_id is null then
    return 0;
  end if;
  return app.lesson_notify(
    p_lesson_id, p_title_key,
    'l:' || p_lesson_id::text || ':' || p_title_key
      || case when p_title_key in ('coach.new_student', 'coach.student_cancelled')
              then ':' || coalesce(p_enrolment_id::text, p_places->>'places_taken', '-')
              else '' end
      || coalesce(p_suffix, ''),
    coalesce(p_places, '{}'::jsonb));
end $lesson_read_push_coach_0296$;

comment on function app.lesson_read_push_coach(uuid, text, jsonb, uuid, text) is
  '0283, 0296 (Guest part; DB-42, DB-44). Internal: app.lesson_notify for the coach of one lesson (route coach_lesson) with params {places_taken, places_total} or {}; the dedupe is l:<lesson>:<title_key>, plus :<enrolment> (else :<places_taken>) for coach.new_student and coach.student_cancelled, plus p_suffix (the trigger passes :<lesson>:<to_start_at> for coach.rescheduled_by_staff and :<lesson>:<to_court_id> for coach.court_moved). Called only by the lesson_events_notify trigger.';

revoke all on function app.lesson_read_push_coach(uuid, text, jsonb, uuid, text) from public, anon, authenticated;

-- ===========================================================================
-- DB-42, DB-43, DB-44: app.trg_lesson_events_notify (re-issued from 0283:4488)
-- ===========================================================================

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
--   a move's suffix :<lesson>:<to_start_at> (rescheduled) or
--                   :<lesson>:<to_court_id> (court_moved) on both sides'
--                   dedupe (0296, DB-42)
create or replace function app.trg_lesson_events_notify() returns trigger
language plpgsql security definer set search_path = public as $trg_lesson_events_notify_0296$
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
  v_suffix  text;
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
        perform app.lesson_read_push_coach(v_ref, 'coach.new_student', v_places, new.enrolment_id);
      elsif new.enrolment_id is null and new.actor = 'staff' and v_kind in ('group', 'course') then
        -- The venue scheduled a group session or a course for the coach.
        perform app.lesson_read_push_coach(v_ref, 'coach.session_added', '{}'::jsonb);
      end if;
      -- Otherwise silent: the coach's own creation, and the lesson row of a
      -- coach- or desk-booked private lesson (its added event follows).

    elsif new.type = 'joined' then
      -- A held join waits for paid_online.
      if v_e.status = 'booked' then
        perform app.lesson_read_push_coach(v_ref, 'coach.new_student', v_places, new.enrolment_id);
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
        perform app.lesson_read_push_coach(v_ref, 'coach.new_student', v_places, new.enrolment_id);
      end if;

    elsif new.type = 'paid_online' then
      -- The guest's payment screen is open: only the coach is told (X15).
      -- 0296 (DB-43): a late success that revived an expired place
      -- (data.revived, 0295) tells the guest too: that screen is long
      -- closed and the guest was last told payment_expired.
      if jsonb_typeof(new.data->'revived') = 'boolean' and (new.data->>'revived')::boolean then
        perform app.lesson_read_push_guest(v_e.id, 'lesson.booked', v_glesson);
      end if;
      perform app.lesson_read_push_coach(v_ref, 'coach.new_student', v_places, new.enrolment_id);

    elsif new.type = 'expired' then
      -- 0296 (DB-42 with 0295's DB-35): an expired event with data.reason is
      -- a paid place refunded whole (slot_lost, venue_offline), not a lapse:
      -- no payment_expired. lesson_hold_expire writes no reason.
      if nullif(new.data->>'reason', '') is null then
        perform app.lesson_read_push_guest(v_e.id, 'lesson.payment_expired', v_glesson);
      end if;

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
          perform app.lesson_read_push_coach(v_ref, 'coach.student_cancelled', v_places, new.enrolment_id);
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
          perform app.lesson_read_push_coach(v_ref, 'coach.student_cancelled', v_places, new.enrolment_id);
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
      -- 0296 (DB-42): the move names its session and its new start.
      v_suffix := ':' || coalesce(new.lesson_id::text, '-') || ':'
                  || coalesce(nullif(new.data->>'to_start_at', ''), new.id::text);
      if new.lesson_id is not null then
        for v_s in
          select c.id from app.lesson_read_covering(new.lesson_id) c
           where c.status = 'booked' order by c.id
        loop
          perform app.lesson_read_push_guest(v_s, 'lesson.rescheduled', new.lesson_id, v_suffix);
        end loop;
      end if;
      if new.actor = 'staff' then
        perform app.lesson_read_push_coach(v_ref, 'coach.rescheduled_by_staff', '{}'::jsonb, null, v_suffix);
      end if;

    elsif new.type = 'court_moved' then
      -- 0296 (DB-42): the move names its session and its new court
      -- (desk_move_lesson_court's data.to_court_id), else the event.
      v_suffix := ':' || coalesce(new.lesson_id::text, '-') || ':'
                  || coalesce(nullif(new.data->>'to_court_id', ''), new.id::text);
      if new.lesson_id is not null then
        for v_s in
          select c.id from app.lesson_read_covering(new.lesson_id) c
           where c.status = 'booked' order by c.id
        loop
          perform app.lesson_read_push_guest(v_s, 'lesson.court_moved', new.lesson_id, v_suffix);
        end loop;
      end if;
      perform app.lesson_read_push_coach(v_ref, 'coach.court_moved', '{}'::jsonb, null, v_suffix);
    end if;
    -- held, completed, attended, no_show, unmarked, settled, refunded: silent
    -- (the trigger's WHEN leaves them out).
  exception when others then
    raise warning 'trg_lesson_events_notify: %', sqlerrm;
  end;
  return null;
end $trg_lesson_events_notify_0296$;

comment on function app.trg_lesson_events_notify() is
  '0283, 0296 (lane Guest, guest.md §4.5.4; R40, R44, R78; DB-42..DB-44). Trigger lesson_events_notify: the only queuer of every lesson.* and coach.* key but the two statement keys. booked: coach.new_student (a guest''s private booking) or coach.session_added (the desk scheduled a group session or course); joined (booked): coach.new_student + places; added: lesson.added_by_coach (an unconfirmed link, due now() + 5 s) or lesson.booked (a desk-picked customer), and coach.new_student + places when the desk added; paid_online: coach.new_student + places, and lesson.booked to the guest when data.revived (a late success revived an expired place, 0296 DB-43); expired: lesson.payment_expired, none when data.reason names a refund (0295 DB-35, 0296); enrolment_cancelled by code: guest_free | guest_late | account_deleted -> coach.student_cancelled + places when it was booked; coach -> lesson.cancelled_by_coach; staff -> lesson.cancelled_by_staff (+ coach.student_cancelled while the group session or course is live); under_filled -> lesson.under_filled; course_cancelled -> by the course''s cancel_reason; cancelled staff_cancel: coach.lesson_cancelled_by_staff; under_filled (not late): coach.under_filled; rescheduled: lesson.rescheduled to each student covering it (+ coach.rescheduled_by_staff when the desk moved it); court_moved: lesson.court_moved to each student and coach.court_moved. coach.new_student and coach.student_cancelled dedupe per enrolment (DB-44); a move''s pushes dedupe per session and new start or court (DB-42). Everything else is silent. Never fails the write.';

revoke all on function app.trg_lesson_events_notify() from public, anon, authenticated;
