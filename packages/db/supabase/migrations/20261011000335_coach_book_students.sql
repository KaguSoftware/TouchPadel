set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0335 coach_book_students — coach mode's "Book for a student", K4 (owner,
-- 2026-10-11). A coach books a private lesson for up to four people: the
-- student, whose phone is now required (it is how the lesson reaches the
-- student's own account, C-21), and up to three more, each with a name and
-- an optional phone. A coach can book a past student again from a list of
-- names; the phone comes from the past booking and is never shown (R54).
--
--   Schema  lesson_enrolments.friend_phones text[]: the friends' phones, by
--           position against friend_names ('' for none). At most one per
--           friend name (CHECK lesson_enrolments_friend_phones). A BEFORE
--           UPDATE trigger empties it whenever friend_names is emptied, so
--           every scrub that already clears friend_names (the 365-day typed
--           purge, 0286 lesson_typed_purge; account deletion, 0290
--           delete_my_account) clears these phones too, with no re-issue.
--           Read by nothing yet; not assistant-readable (no
--           assistant_readable_columns row).
--   RPC     app.coach_book_private (0291:626) re-issued with three optional
--           inputs after the seven it had: p_friend_names, p_friend_phones,
--           p_saved_student. The 7-argument version is dropped; a 7-argument
--           call resolves to this one through the defaults. Changes:
--             * p_student_phone is required (INVALID_ARGUMENT detail
--               p_student_phone), unless p_saved_student names one of the
--               coach's own past coach bookings with a phone, whose phone is
--               then used (INVALID_ARGUMENT detail p_saved_student when it
--               names anything else);
--             * friends as lesson_book_private takes them (each 1..40 after
--               app.safe_line, at most least(party_size - 1, 3)), each phone
--               '' or a number guest_phone's rule accepts, at most one per
--               name (INVALID_ARGUMENT detail p_friend_names /
--               p_friend_phones);
--             * the insert carries friend_names and friend_phones.
--           Everything else is 0291's body verbatim.
--   RPC     New app.coach_saved_students(): the caller's past students for
--           "Book again", one per phone (app.phone_digits), newest booking
--           first, at most 50: {students [{key, name, lessons, last_at}]}.
--           key is the newest such enrolment's id, the value
--           coach_book_private's p_saved_student takes. Never a phone, a
--           profile or whether a phone matched an account (R10, R54).
--
-- covered by packages/db/tests/coaching-coach-students.test.ts

-- ===========================================================================
-- Schema: lesson_enrolments.friend_phones
-- ===========================================================================

alter table lesson_enrolments add column if not exists friend_phones text[] not null default '{}';

comment on column lesson_enrolments.friend_phones is
  '0335. The phones a coach typed for a private lesson''s other students, by position against friend_names ('''' for none; at most one per name). Emptied with friend_names by every scrub (trigger lesson_enrolments_friend_phones_scrub): the 365-day typed purge (CD-8) and account deletion. Shown to nobody yet.';

alter table lesson_enrolments drop constraint if exists lesson_enrolments_friend_phones;
alter table lesson_enrolments
  add constraint lesson_enrolments_friend_phones
  check (cardinality(friend_phones) <= cardinality(friend_names)
         and char_length(array_to_string(friend_phones, '')) <= 96)
  not valid;

do $validate_friend_phones_0335$
begin
  if exists (select 1 from pg_constraint
              where conname = 'lesson_enrolments_friend_phones'
                and conrelid = 'public.lesson_enrolments'::regclass
                and not convalidated) then
    alter table lesson_enrolments validate constraint lesson_enrolments_friend_phones;
  end if;
end $validate_friend_phones_0335$;

create or replace function app.trg_lesson_enrolments_friend_phones_scrub() returns trigger
language plpgsql set search_path = public as $trg_lesson_enrolments_friend_phones_scrub_0335$
begin
  if cardinality(new.friend_names) = 0 then
    new.friend_phones := '{}'::text[];
  end if;
  return new;
end $trg_lesson_enrolments_friend_phones_scrub_0335$;

comment on function app.trg_lesson_enrolments_friend_phones_scrub() is
  '0335. BEFORE UPDATE OF friend_names on lesson_enrolments: an emptied friend_names empties friend_phones, so the typed purge and account deletion clear the friends'' phones with their names.';

revoke all on function app.trg_lesson_enrolments_friend_phones_scrub() from public, anon, authenticated;

drop trigger if exists lesson_enrolments_friend_phones_scrub on lesson_enrolments;
create trigger lesson_enrolments_friend_phones_scrub
  before update of friend_names on lesson_enrolments
  for each row execute function app.trg_lesson_enrolments_friend_phones_scrub();

-- ===========================================================================
-- app.coach_book_private (re-issued from 0291:626)
-- ===========================================================================

drop function if exists app.coach_book_private(uuid, uuid, timestamptz, text, text, int, text);

create or replace function app.coach_book_private(
  p_lesson_type_id  uuid,
  p_venue_id        uuid,
  p_start_at        timestamptz,
  p_student_name    text,
  p_student_phone   text,
  p_party_size      int,
  p_idempotency_key text,
  p_friend_names    text[] default '{}',
  p_friend_phones   text[] default '{}',
  p_saved_student   uuid   default null
) returns jsonb
language plpgsql security definer set search_path = public as $coach_book_private_0335$
declare
  v_c       coaches%rowtype;
  v_name    text := app.safe_line(p_student_name);
  v_phone   text := nullif(app.safe_line(p_student_phone), '');
  v_e       lesson_enrolments%rowtype;
  v_t       lesson_types%rowtype;
  v_rules   jsonb;
  v_end     timestamptz;
  v_period  tstzrange;
  v_price   bigint;
  v_locked  uuid[];
  v_l       lessons%rowtype;
  v_gid     uuid;
  v_count   int;
  v_f       text;
  v_friends text[] := '{}';
  v_fphones text[] := '{}';
  v_i       int;
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
  -- 0335: a past student booked again brings their phone with them; the
  -- coach never sees it (R54).
  if p_saved_student is not null then
    select e.guest_phone into v_f
      from lesson_enrolments e
     where e.id = p_saved_student
       and e.booked_by_kind = 'coach' and e.booked_by_profile_id = v_c.profile_id
       and e.guest_phone is not null;
    if v_f is null then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_saved_student';
    end if;
    v_phone := coalesce(v_phone, v_f);
    v_f := null;
  end if;
  -- 0335: the phone is required.
  if v_phone is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_student_phone';
  end if;
  if app.phone_canon(v_phone) is null or coalesce(app.phone_digits(v_phone), '') !~ '^[0-9]{7,15}$' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_student_phone';
  end if;
  if p_party_size is null or p_party_size not between 1 and 4 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_party_size';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;
  -- 0335: the other students, as lesson_book_private takes friends.
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
  if cardinality(coalesce(p_friend_phones, '{}'::text[])) > cardinality(v_friends) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_friend_phones';
  end if;
  for v_i in 1 .. cardinality(coalesce(p_friend_phones, '{}'::text[])) loop
    v_f := coalesce(app.safe_line(p_friend_phones[v_i]), '');
    if v_f <> '' and (app.phone_canon(v_f) is null
                      or coalesce(app.phone_digits(v_f), '') !~ '^[0-9]{7,15}$') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_friend_phones';
    end if;
    v_fphones := v_fphones || v_f;
  end loop;
  if v_fphones <> '{}'::text[] and array_to_string(v_fphones, '') = '' then
    v_fphones := '{}';
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
    insert into lesson_enrolments (venue_id, lesson_id, guest_id, guest_name, guest_phone, party_size,
                                   friend_names, friend_phones, booked_by_kind,
                                   booked_by_profile_id, price_iqd, payment_mode, status, idempotency_key)
    values (p_venue_id, v_l.id, v_gid, v_name, v_phone, p_party_size, v_friends, v_fphones, 'coach',
            v_c.profile_id, v_price, 'desk', 'booked', p_idempotency_key)
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
end $coach_book_private_0335$;

comment on function app.coach_book_private(uuid, uuid, timestamptz, text, text, int, text, text[], text[], uuid) is
  '0283, 0291, 0335 (db.md §4.7.4; C-8, C-21, C-24, CD-1, CD-9, R10, R15, R44, R54, R56). Coach: book a private lesson for a student (name 1..80, phone required since 0335, party 1..4) and up to three more (p_friend_names, each 1..40, at most party_size - 1; p_friend_phones by position, '''' or a valid number, at most one per name), desk-paid. p_saved_student (0335): one of the caller''s own past coach bookings with a phone (app.coach_saved_students'' key), whose phone is used when p_student_phone is empty; never returned. coach_self; INVALID_ARGUMENT (detail p_student_phone when missing or invalid, p_saved_student, p_friend_names, p_friend_phones, ...); lock_principal(coach_students), replay, COACH_ADD_LIMIT detail day (30 coach adds in 24 h); LESSON_TYPE_NOT_FOUND (a private type at p_venue_id), COACH_NOT_AT_BRANCH, COACHING_OFF, COACH_INACTIVE, LESSON_TYPE_INACTIVE, LESSON_TYPE_NOT_OFFERED, PARTY_TOO_LARGE; SLOT_NOT_ON_GRID, SLOT_IN_PAST, CLOSED_DATE, OUTSIDE_HOURS, DEGRADED_LOCKOUT; COACH_UNAVAILABLE; under the coach lock the replay, app.lesson_assert_coach_bookable (0291, DB-08: COACH_INACTIVE, NOT_A_COACH, LESSON_TYPE_NOT_OFFERED, LESSON_TYPE_INACTIVE; the price read again), COACH_ADD_LIMIT detail live (coach_max_open_private upcoming coach-booked private lessons at the branch), COACH_BUSY; every court; NO_COURT_FREE. A typed phone matching a verified account links it pending (C-21); the answer, the work and the refusals are the same either way (R10). Events booked and added; audit coaching.lesson.book. Returns {duplicate, lesson_id, enrolment_id, start_at, end_at, court_id, court_name_en, court_name_ar, price_iqd, ...}.';

revoke all on function app.coach_book_private(uuid, uuid, timestamptz, text, text, int, text, text[], text[], uuid) from public, anon;
grant execute on function app.coach_book_private(uuid, uuid, timestamptz, text, text, int, text, text[], text[], uuid) to authenticated;

-- ===========================================================================
-- app.coach_saved_students (new)
-- ===========================================================================

create or replace function app.coach_saved_students() returns jsonb
language plpgsql security definer set search_path = public as $coach_saved_students_0335$
declare
  v_c coaches%rowtype;
begin
  v_c := app.coach_self();
  return jsonb_build_object('students', coalesce((
    select jsonb_agg(jsonb_build_object('key', s.id, 'name', s.guest_name, 'lessons', s.lessons,
                                        'last_at', s.created_at)
                     order by s.created_at desc, s.start_at desc)
      from (
        -- The newest booking per phone (made last, then the later lesson),
        -- then the 50 newest of those.
        select d.*
          from (
            select distinct on (app.phone_digits(e.guest_phone))
                   e.id, e.guest_name, e.created_at, l.start_at,
                   count(*) over (partition by app.phone_digits(e.guest_phone)) as lessons
              from lesson_enrolments e
              join lessons l on l.id = e.lesson_id
             where e.booked_by_kind = 'coach'
               and e.booked_by_profile_id = v_c.profile_id
               and e.guest_phone is not null
               and e.guest_name is not null
             order by app.phone_digits(e.guest_phone), e.created_at desc, l.start_at desc
          ) d
         order by d.created_at desc, d.start_at desc
         limit 50
      ) s
  ), '[]'::jsonb));
end $coach_saved_students_0335$;

comment on function app.coach_saved_students() is
  '0335 (C-8, R10, R44, R54). Coach (coach_self first; NOT_A_COACH for a retired coach): the caller''s past students for "Book again" in coach mode, one per phone (app.phone_digits) from their own coach bookings that still hold a phone (the 365-day purge clears it, CD-8), newest first, at most 50. {students [{key (the newest such enrolment''s id: coach_book_private''s p_saved_student), name (as typed on it), lessons (how many of the coach''s bookings carry that phone), last_at}]}. Never a phone, a profile id or whether a phone matched an account.';

revoke all on function app.coach_saved_students() from public, anon;
grant execute on function app.coach_saved_students() to authenticated;
