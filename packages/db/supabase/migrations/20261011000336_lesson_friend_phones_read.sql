set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0336 lesson_friend_phones_read — the other students' phones a coach typed
-- (0335, lesson_enrolments.friend_phones) reach the two screens that show a
-- lesson's students. Both functions are re-issued from their latest bodies,
-- verbatim except for the one key named; dollar tags _0335.
--
--   app.coach_lesson (0283:5784): roster[].friend_phones, by position against
--     friend_names ('' for none), under the student's own phone rule: empty
--     from end_at + 7 days (R54) and while the place is held (P13).
--   app.desk_lesson_detail (0294:903): enrolments[].friend_phones, as typed,
--     beside the student's phone the desk already sees (R44).
--
-- covered by packages/db/tests/coaching-coach-students.test.ts

-- ===========================================================================
-- app.coach_lesson (re-issued from 0283:5784)
-- ===========================================================================

create or replace function app.coach_lesson(p_lesson_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $coach_lesson_0336$
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
           -- 0336: the other students' phones (0335), by position, under the
           -- student's own rule (R54, P13).
           'friend_phones', case
                              when now() >= v_phone_until or e.status = 'held' then '[]'::jsonb
                              else to_jsonb(e.friend_phones)
                            end,
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
end $coach_lesson_0336$;

comment on function app.coach_lesson(uuid) is
  '0283, 0336 (db.md §4.7.9, guest.md §4.3; X11, C-16, CD-3, R44, R45, R54). Coach (coach_self first; NOT_A_COACH for a retired coach): INVALID_ARGUMENT (NULL); LESSON_NOT_FOUND unless the lesson is the caller''s. {lesson {id, venue_id, kind, course_id, session_no, sessions_count, type_name_*, title_*, start_at, end_at, status, cancel_reason, court_name_*, max_places, min_places, places_taken, cutoff_at}, course {id, status, sessions[{lesson_id, session_no, start_at, end_at, status}]} | null, roster[{enrolment_id, name, phone, party_size, friend_names, friend_phones (0336: the other students'' phones by position, '''' for none; empty under the phone''s rule), booked_by, payment_mode, status, attendance}] (held and booked places covering the session), can {add, remove, cancel, cancel_course, reschedule, mark}, mark_until (start + 24 h), server_now}. A coach- or staff-booked student shows the name and phone as typed, never the linked profile''s (R44); a guest''s own booking shows the account''s. The phone is NULL from end_at + 7 days (R54) and while the place is held. Never money, a profile id, or whether a typed phone matched.';

revoke all on function app.coach_lesson(uuid) from public, anon;
grant execute on function app.coach_lesson(uuid) to authenticated;

-- ===========================================================================
-- app.desk_lesson_detail (re-issued from 0294:903)
-- ===========================================================================

create or replace function app.desk_lesson_detail(p_lesson_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $desk_lesson_detail_0336$
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
                   'friend_phones', to_jsonb(e.friend_phones),  -- 0336: by position, as typed (0335)
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
end $desk_lesson_detail_0336$;

comment on function app.desk_lesson_detail(uuid) is
  '0283, 0294, 0336 (db.md §4.7.9, operator.md §5.6.2; X17, C-21, R44, R57, R75; DB-31). Cashier, court desk, manager, owner (the role first): FORBIDDEN; INVALID_ARGUMENT (NULL); LESSON_NOT_FOUND (unknown, or outside app.visible_venue_ids()); VENUE_MISMATCH (visible but not staff there). {lesson {id, venue_id, kind, status, cancel_reason, start_at, end_at, duration_min, rescheduled_at, booked_by_kind, coach {coach_id, display_name_*, status}, lesson_type {lesson_type_id, name_*}, course {course_id, title_*, status, cancel_reason, session_no, sessions_count, signup_closes_at, places_taken, max_places, sessions[{lesson_id, session_no, start_at, end_at, status, court_name_*}]} | null, reservation_id, reservation_status, court_id, court_name_*, price_iqd, court_share_iqd, max_places, min_places, places_taken, cutoff_at, hold_expires_at, created_by_name, server_now, day_open, can {add_student, cancel, cancel_course, reschedule, move_court}}, enrolments[{enrolment_id, scope, status, cancel_kind, cancelled_at, customer_id, full_name, phone, typed, flags, party_size, friend_names, friend_phones (0336: by position, '''' for none), first_session_no, sessions_covered, booked_by_kind, booked_by_name, payment_mode, created_at, attendance {status, marked_at, marked_by_name} | null, money {price_iqd, owed_iqd, desk_paid_iqd, online_paid_iqd, refunded_iqd, kept_iqd, refund_due_iqd, refund_due_desk_iqd, refund_blocked_iqd (0294: the engine''s parts of refund_due owed at the desk and blocked), take_iqd (lesson_fee_remaining)}, can {take_payment, cancel (0294: a private lesson''s place until its start, a group place until the end, a course place until the course''s last end), mark_attended, mark_no_show, unmark}}], events[{at, type, actor, actor_name, enrolment_id, code, late}] (the last 50, newest first)}. A coach- or desk-booked student shows the name and phone recorded on the enrolment (typed true), never a linked profile''s; customer_id only for a guest''s own booking, a picked customer or a confirmed link (R44, C-21).';

revoke all on function app.desk_lesson_detail(uuid) from public, anon;
grant execute on function app.desk_lesson_detail(uuid) to authenticated;

comment on column lesson_enrolments.friend_phones is
  '0335, 0336. The phones a coach typed for a private lesson''s other students, by position against friend_names ('''' for none; at most one per name). Shown to the coach in coach_lesson under the student''s phone rule (until end_at + 7 days, R54) and to the desk in desk_lesson_detail. Emptied with friend_names by every scrub (trigger lesson_enrolments_friend_phones_scrub): the 365-day typed purge (CD-8) and account deletion.';
