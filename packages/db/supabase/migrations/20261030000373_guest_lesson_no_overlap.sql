set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0373 guest_lesson_no_overlap (Sait, 2026-10-30: "you can make 2 coach lessons
-- at the same time, that shouldn't be allowed").
--
-- lessons_coach_no_overlap (0278) already keeps one coach to one live lesson at
-- a time. Nothing kept one GUEST to one: a guest could hold two lessons, with
-- two coaches, over the same hour. A trigger on lesson_enrolments refuses a
-- held or booked enrolment whose sessions overlap another live enrolment of
-- the same person. It sits on the table, not in the booking
-- bodies, so guest, coach, desk and course paths all pass through it with no
-- function re-issued. A typed student is the same person by phone number; a
-- coach cannot be enrolled in a lesson that overlaps one they teach.

create or replace function app.trg_lesson_enrolments_guest_no_overlap() returns trigger
language plpgsql security definer set search_path = public as $trg_lesson_enrolments_guest_no_overlap_0373$
declare
  v_phone text := nullif(app.phone_digits(new.guest_phone), '');
begin
  if new.status not in ('held', 'booked') or (new.guest_id is null and v_phone is null) then
    return new;
  end if;
  -- The sessions this enrolment covers (a course: those from its first session on).
  if exists (
    select 1
      from lessons a
     where a.status in ('held', 'scheduled')
       and (a.id = new.lesson_id
            or (new.course_id is not null and a.course_id = new.course_id
                and a.session_no >= coalesce(new.first_session_no, 1)
                and (new.sessions_covered is null
                     or a.session_no < coalesce(new.first_session_no, 1) + new.sessions_covered)))
       and (
         -- another live enrolment of the same person: the account, or the same phone
         exists (
           select 1
             from lesson_enrolments e
             join lessons b
               on (b.id = e.lesson_id
                   or (e.course_id is not null and b.course_id = e.course_id
                       and b.session_no >= coalesce(e.first_session_no, 1)
                       and (e.sessions_covered is null
                            or b.session_no < coalesce(e.first_session_no, 1) + e.sessions_covered)))
              and b.status in ('held', 'scheduled')
            where e.id <> new.id and e.status in ('held', 'booked')
              and ((new.guest_id is not null and e.guest_id = new.guest_id)
                   or (v_phone is not null and app.phone_digits(e.guest_phone) = v_phone))
              and a.id <> b.id and a.period && b.period)
         -- a lesson this person teaches (a coach is a guest of the app)
         or (new.guest_id is not null and exists (
           select 1
             from lessons t
             join coaches c on c.id = t.coach_id and c.profile_id = new.guest_id
            where t.status in ('held', 'scheduled')
              and a.id <> t.id and a.period && t.period))
       )
  ) then
    raise exception 'GUEST_BUSY' using errcode = 'P0001';
  end if;
  return new;
end $trg_lesson_enrolments_guest_no_overlap_0373$;

comment on function app.trg_lesson_enrolments_guest_no_overlap() is
  '0373. BEFORE INSERT OR UPDATE OF status, lesson_id, course_id on lesson_enrolments: GUEST_BUSY when a held or booked enrolment has a held or scheduled session overlapping (a) a session of another held or booked enrolment of the same person, the account or, for a typed student, the same phone number (a course counts the sessions it covers), or (b) a session the account itself teaches as a coach.';

revoke all on function app.trg_lesson_enrolments_guest_no_overlap() from public, anon, authenticated;

drop trigger if exists lesson_enrolments_guest_no_overlap on lesson_enrolments;
create trigger lesson_enrolments_guest_no_overlap
  before insert or update of status, lesson_id, course_id on lesson_enrolments
  for each row execute function app.trg_lesson_enrolments_guest_no_overlap();
