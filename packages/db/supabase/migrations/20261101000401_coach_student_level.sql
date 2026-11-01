-- 0401 coach_student_level — a coach sees and sets the level of a student whose
-- account link they confirmed (launch finding F-70, Majed 2026-11-01), and only
-- that student.
--
--   1. app.coach_lesson (re-issued from 0336): each roster entry gains `level`
--      {claimed, confirmed, confirmed_role, confirmed_at, note}, read by a
--      separate join on profiles by the enrolment's guest_id, ONLY when
--      link_confirmed_at and guest_id are both set (a guest's own booking
--      always is, by lesson_enrolments' CHECK); NULL otherwise. Never the
--      profile id, and nothing for an unlinked place, so a typed phone still
--      says nothing about whether it matched an account (R44).
--   2. app.coach_set_student_level(p_enrolment_id, p_level, p_note): a coach
--      (app.coach_self(false), else FORBIDDEN) judges the level of a place on
--      one of their own lessons or courses (else REF_NOT_FOUND, "not yours is
--      not found") whose account link is confirmed (else LEVEL_NOT_LINKED).
--      The same rules as staff_set_customer_level: new | beginner |
--      intermediate | advanced (INVALID_PLAY_PROFILE), a one-line note of at
--      most 120 characters, NULL clears and takes no note (INVALID_ARGUMENT),
--      the same level and note answer duplicate, audit
--      customer.level_confirmed, stamped role 'coach'. Returns
--      {enrolment_id, level_confirmed, level_confirmed_at,
--      level_confirmed_role, level_note, duplicate}: the shape of
--      staff_set_customer_level with the enrolment in place of the profile id.
--   3. app.staff_set_customer_level (re-issued from 0368) loses its coach
--      branch: a coach could set ANY customer's level by profile id. Court
--      desk, manager and owner only; coaches use (2).
--
-- covered by packages/db/tests/coach-student-level.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The roster carries a linked student's level.
-- ---------------------------------------------------------------------------
create or replace function app.coach_lesson(p_lesson_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $coach_lesson_0401$
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
                           where a.lesson_id = v_l.id and a.enrolment_id = e.id),
           -- 0401 (F-70): the student's level, only once the account link is
           -- confirmed (a guest's own booking always is); never the profile id,
           -- and nothing at all for an unlinked place, so a typed phone still
           -- says nothing about whether it matched an account.
           'level', case when lp.id is null then null
                         else jsonb_build_object(
                                'claimed',        lp.play_level,
                                'confirmed',      lp.level_confirmed,
                                'confirmed_role', lp.level_confirmed_role,
                                'confirmed_at',   lp.level_confirmed_at,
                                'note',           lp.level_note)
                    end)
           order by e.created_at, e.id), '[]'::jsonb)
    into v_roster
    from app.lesson_read_covering(v_l.id) e
    left join profiles p on p.id = e.guest_id and e.booked_by_kind = 'guest'
    left join profiles lp on lp.id = e.guest_id
                         and e.guest_id is not null
                         and e.link_confirmed_at is not null
                         and lp.deleted_at is null
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
end $coach_lesson_0401$;

comment on function app.coach_lesson(uuid) is
  '0283, 0336, 0401 (db.md §4.7.9, guest.md §4.3; X11, C-16, CD-3, R44, R45, R54; F-70). Coach (coach_self first; NOT_A_COACH for a retired coach): INVALID_ARGUMENT (NULL); LESSON_NOT_FOUND unless the lesson is the caller''s. {lesson {id, venue_id, kind, course_id, session_no, sessions_count, type_name_*, title_*, start_at, end_at, status, cancel_reason, court_name_*, max_places, min_places, places_taken, cutoff_at}, course {id, status, sessions[{lesson_id, session_no, start_at, end_at, status}]} | null, roster[{enrolment_id, name, phone, party_size, friend_names, friend_phones (0336: the other students'' phones by position, '''' for none; empty under the phone''s rule), booked_by, payment_mode, status, attendance, level (0401: {claimed, confirmed, confirmed_role, confirmed_at, note} once the account link is confirmed, else NULL)}] (held and booked places covering the session), can {add, remove, cancel, cancel_course, reschedule, mark}, mark_until (start + 24 h), server_now}. A coach- or staff-booked student shows the name and phone as typed, never the linked profile''s (R44); a guest''s own booking shows the account''s. The phone is NULL from end_at + 7 days (R54) and while the place is held. Never money, a profile id, or whether a typed phone matched.';

revoke all on function app.coach_lesson(uuid) from public, anon;
grant execute on function app.coach_lesson(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The coach sets a linked student's level, by enrolment.
-- ---------------------------------------------------------------------------
create or replace function app.coach_set_student_level(p_enrolment_id uuid,
                                                       p_level        text,
                                                       p_note         text default null)
returns jsonb
language plpgsql security definer set search_path = public as $coach_set_student_level_0401$
declare
  v_uid  uuid := auth.uid();
  v_co   coaches%rowtype;
  v_e    lesson_enrolments%rowtype;
  v_p    profiles%rowtype;
  v_note text;
  v_at   timestamptz;
begin
  v_co := app.coach_self(false);
  if v_co.id is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Not yours is not found: a place on one of the caller's lessons or courses.
  if p_enrolment_id is not null then
    select e.* into v_e
      from lesson_enrolments e
     where e.id = p_enrolment_id
       and (exists (select 1 from lessons l where l.id = e.lesson_id and l.coach_id = v_co.id)
            or exists (select 1 from courses c where c.id = e.course_id and c.coach_id = v_co.id));
  end if;
  if v_e.id is null then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'enrolment';
  end if;
  if v_e.link_confirmed_at is null or v_e.guest_id is null then
    raise exception 'LEVEL_NOT_LINKED' using errcode = 'P0001';
  end if;

  if p_level is not null and p_level not in ('new', 'beginner', 'intermediate', 'advanced') then
    raise exception 'INVALID_PLAY_PROFILE' using errcode = 'P0001', detail = 'p_level', hint = 'p_level';
  end if;
  v_note := nullif(left(coalesce(app.safe_line(p_note), ''), 120), '');
  if p_level is null and v_note is not null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_note';
  end if;

  select * into v_p from profiles where id = v_e.guest_id;
  if v_p.id is null or v_p.deleted_at is not null then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'enrolment';
  end if;
  if v_p.level_confirmed is not distinct from p_level
     and v_p.level_note is not distinct from v_note then
    return jsonb_build_object('enrolment_id', v_e.id, 'level_confirmed', v_p.level_confirmed,
                              'level_confirmed_at', v_p.level_confirmed_at,
                              'level_confirmed_role', v_p.level_confirmed_role,
                              'level_note', v_p.level_note, 'duplicate', true);
  end if;

  -- profiles_level_confirmed_stamp: the judgment is one block, or all NULL.
  update profiles
     set level_confirmed      = p_level,
         level_confirmed_at   = case when p_level is null then null else now() end,
         level_confirmed_by   = case when p_level is null then null else v_uid end,
         level_confirmed_role = case when p_level is null then null else 'coach' end,
         level_note           = case when p_level is null then null else v_note end
   where id = v_p.id
  returning level_confirmed_at into v_at;

  perform app.write_audit('customer.level_confirmed', 'profiles', v_p.id::text,
                          jsonb_build_object('level_confirmed', v_p.level_confirmed,
                                             'role', v_p.level_confirmed_role),
                          jsonb_build_object('level_confirmed', p_level, 'role',
                                             case when p_level is null then null else 'coach' end,
                                             'claimed', v_p.play_level,
                                             'cleared', p_level is null,
                                             'enrolment_id', v_e.id));

  return jsonb_build_object('enrolment_id', v_e.id, 'level_confirmed', p_level,
                            'level_confirmed_at', v_at,
                            'level_confirmed_role', case when p_level is null then null else 'coach' end,
                            'level_note', case when p_level is null then null else v_note end,
                            'duplicate', false);
end $coach_set_student_level_0401$;

comment on function app.coach_set_student_level(uuid, text, text) is
  '0401 (F-70). A coach (app.coach_self, else FORBIDDEN) confirms the real level (new | beginner | intermediate | advanced) of a student on one of their own lessons or courses (REF_NOT_FOUND hint enrolment otherwise) whose account link is confirmed (LEVEL_NOT_LINKED otherwise), with an optional one-line note (<= 120); p_level NULL clears the judgment and takes no note. INVALID_PLAY_PROFILE detail p_level; INVALID_ARGUMENT detail p_note; the same level and note -> duplicate. Stamps role coach; audit customer.level_confirmed. Returns {enrolment_id, level_confirmed, level_confirmed_at, level_confirmed_role, level_note, duplicate}; never the profile id.';

revoke all on function app.coach_set_student_level(uuid, text, text) from public, anon;
grant execute on function app.coach_set_student_level(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. staff_set_customer_level: the court desk, managers and the owner only.
-- ---------------------------------------------------------------------------
create or replace function app.staff_set_customer_level(p_customer_id uuid,
                                                        p_level       text,
                                                        p_note        text default null)
returns jsonb
language plpgsql security definer set search_path = public as $staff_set_customer_level_0401$
declare
  v_uid  uuid := auth.uid();
  v_role text;
  v_p    profiles%rowtype;
  v_note text;
  v_at   timestamptz;
begin
  -- Who may judge: the owner, a manager, the court desk. 0401 (F-70): no
  -- longer a coach here: by a profile id a coach could set ANY customer's
  -- level. A coach judges their own linked students through
  -- app.coach_set_student_level, by enrolment.
  if app.is_staff('owner') then
    v_role := 'owner';
  elsif app.is_staff('manager') then
    v_role := 'manager';
  elsif app.is_staff('court_desk') then
    v_role := 'court_desk';
  else
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_level is not null and p_level not in ('new', 'beginner', 'intermediate', 'advanced') then
    raise exception 'INVALID_PLAY_PROFILE' using errcode = 'P0001', detail = 'p_level', hint = 'p_level';
  end if;
  v_note := nullif(left(coalesce(app.safe_line(p_note), ''), 120), '');
  if p_level is null and v_note is not null then
    -- Clearing the judgment takes no note: there would be nothing to hang it on.
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_note';
  end if;

  if p_customer_id is not null then
    select * into v_p from profiles where id = p_customer_id;
  end if;
  if v_p.id is null or v_p.deleted_at is not null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_p.level_confirmed is not distinct from p_level
     and v_p.level_note is not distinct from v_note then
    return jsonb_build_object('customer_id', v_p.id, 'level_confirmed', v_p.level_confirmed,
                              'level_confirmed_at', v_p.level_confirmed_at,
                              'level_confirmed_role', v_p.level_confirmed_role,
                              'level_note', v_p.level_note, 'duplicate', true);
  end if;

  -- profiles_level_confirmed_stamp: the judgment is one block, or all NULL.
  update profiles
     set level_confirmed      = p_level,
         level_confirmed_at   = case when p_level is null then null else now() end,
         level_confirmed_by   = case when p_level is null then null else v_uid end,
         level_confirmed_role = case when p_level is null then null else v_role end,
         level_note           = case when p_level is null then null else v_note end
   where id = v_p.id
  returning level_confirmed_at into v_at;

  -- The level is not personal information the way a gender or a band is: it is
  -- the club's own judgment about a player, so the audit row carries it.
  perform app.write_audit('customer.level_confirmed', 'profiles', v_p.id::text,
                          jsonb_build_object('level_confirmed', v_p.level_confirmed,
                                             'role', v_p.level_confirmed_role),
                          jsonb_build_object('level_confirmed', p_level, 'role',
                                             case when p_level is null then null else v_role end,
                                             'claimed', v_p.play_level,
                                             'cleared', p_level is null));

  return jsonb_build_object('customer_id', v_p.id, 'level_confirmed', p_level,
                            'level_confirmed_at', v_at,
                            'level_confirmed_role', case when p_level is null then null else v_role end,
                            'level_note', case when p_level is null then null else v_note end,
                            'duplicate', false);
end $staff_set_customer_level_0401$;

comment on function app.staff_set_customer_level(uuid, text, text) is
  '0368, 0401 (customers contracts §1.1; F-70). Court desk, manager or owner (a coach no longer: coaches judge their own linked students through app.coach_set_student_level): confirms a customer''s real level (new | beginner | intermediate | advanced) with an optional one-line note, stamping who judged and their role; p_level NULL clears the judgment back to the claimed play_level and takes no note. FORBIDDEN; INVALID_PLAY_PROFILE detail p_level; INVALID_ARGUMENT detail p_note (a note with no level); CUSTOMER_NOT_FOUND (unknown or deleted); the same level and note -> duplicate. Audit customer.level_confirmed with the level, the role and the claim. Returns {customer_id, level_confirmed, level_confirmed_at, level_confirmed_role, level_note, duplicate}.';

revoke all on function app.staff_set_customer_level(uuid, text, text) from public, anon;
grant execute on function app.staff_set_customer_level(uuid, text, text) to authenticated;
