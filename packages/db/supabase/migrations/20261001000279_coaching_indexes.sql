set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0279 coaching_indexes — coaching, lane DB with Money's named indexes
-- (docs/design/coaching/db.md §4.4, money.md §4; build contracts §1.1, §1.2,
-- R22, R24, R60). Only `create [unique] index if not exists`.
--
-- Plain CREATE INDEX, not CONCURRENTLY: every coaching table is new and empty
-- (0278), and the six partial indexes on the three hot tables (reservations,
-- tabs, booking_payments) have predicates that match no row today
-- (lesson_id / lesson_enrolment_id is NULL on every existing row, so each
-- index is empty), though each still takes SHARE for one scan of its table
-- under lock_timeout 3s. The waiver is in the commit message:
--   MIGRATION-RISK-ACCEPTED: new and empty tables, plus partial indexes on
--   reservations, tabs and booking_payments whose predicates match no row today
-- and `MIGRATION_RISK_ACCEPTED=... node scripts/check-migrations.mjs` is run
-- before the push (CI reads the waiver only from a pull request body). The push
-- goes outside trading hours; if it cannot, the six hot-table indexes move to
-- files of their own as CREATE INDEX CONCURRENTLY, one per file, and every
-- later ordinal shifts (R60).
--
-- The partial uniques on the hot tables add `<column> is not null` to §1.2's
-- predicates (R22): the index stays empty for every non-lesson row and no
-- uniqueness changes (NULLs are distinct).

-- ── coaches' branches, hours, time off ──────────────────────────────────────
create index if not exists coach_branches_venue
  on coach_branches (venue_id) where active;
create index if not exists coach_hours_coach
  on coach_hours (coach_id, weekday);
create index if not exists coach_hours_venue
  on coach_hours (venue_id, coach_id);
create index if not exists coach_time_off_coach
  on coach_time_off (coach_id, upper(period)) where cancelled_at is null;

-- ── lesson types and per-coach prices ──────────────────────────────────────
create index if not exists lesson_types_venue
  on lesson_types (venue_id, sort_order);
create index if not exists coach_lesson_types_type
  on coach_lesson_types (lesson_type_id);
create index if not exists coach_prices_type
  on coach_prices (lesson_type_id);

-- ── courses ────────────────────────────────────────────────────────────────
create index if not exists courses_coach
  on courses (coach_id, status);
create index if not exists courses_venue_live
  on courses (venue_id, signup_closes_at) where status in ('open', 'running');
create index if not exists courses_cutoff_due
  on courses (cutoff_at) where status = 'open' and cutoff_checked_at is null;

-- ── lessons ────────────────────────────────────────────────────────────────
create index if not exists lessons_coach_start
  on lessons (coach_id, start_at);
create index if not exists lessons_venue_start
  on lessons (venue_id, start_at);
create unique index if not exists lessons_course_session
  on lessons (course_id, session_no) where course_id is not null;
create index if not exists lessons_held_due
  on lessons (hold_expires_at) where status = 'held';
create index if not exists lessons_cutoff_due
  on lessons (cutoff_at) where status = 'scheduled' and kind = 'group' and cutoff_checked_at is null;
create index if not exists lessons_end_due
  on lessons (end_at) where status = 'scheduled';
create index if not exists lessons_type
  on lessons (lesson_type_id);

-- ── enrolments ─────────────────────────────────────────────────────────────
create index if not exists lesson_enrolments_lesson
  on lesson_enrolments (lesson_id) where lesson_id is not null;
create index if not exists lesson_enrolments_course
  on lesson_enrolments (course_id) where course_id is not null;
create index if not exists lesson_enrolments_guest
  on lesson_enrolments (guest_id, created_at desc) where guest_id is not null;
create unique index if not exists lesson_enrolments_one_live_lesson
  on lesson_enrolments (lesson_id, guest_id)
  where guest_id is not null and lesson_id is not null and status in ('held', 'booked');
create unique index if not exists lesson_enrolments_one_live_course
  on lesson_enrolments (course_id, guest_id)
  where guest_id is not null and course_id is not null and status in ('held', 'booked');
create index if not exists lesson_enrolments_held_due
  on lesson_enrolments (hold_expires_at) where status = 'held';
-- The CD-9 count of a coach's adds today.
create index if not exists lesson_enrolments_coach_adds
  on lesson_enrolments (booked_by_profile_id, created_at) where booked_by_kind = 'coach';
-- The CD-8 purge (R44: a fixed marker, never NULL).
create index if not exists lesson_enrolments_purge_due
  on lesson_enrolments (created_at)
  where guest_phone is not null or cardinality(friend_names) > 0
     or (booked_by_kind <> 'guest' and guest_name <> 'Walk-in');

-- ── attendance, strikes, events ────────────────────────────────────────────
create index if not exists lesson_attendance_enrolment
  on lesson_attendance (enrolment_id);
create index if not exists lesson_strikes_unsettled
  on lesson_strikes (struck_at) where settled_at is null;
create index if not exists lesson_strikes_guest
  on lesson_strikes (guest_id);
create index if not exists lesson_events_lesson
  on lesson_events (lesson_id, at) where lesson_id is not null;
create index if not exists lesson_events_course
  on lesson_events (course_id, at) where course_id is not null;
create index if not exists lesson_events_venue
  on lesson_events (venue_id, at);

-- ── statements (Money's named ones included, R24) ──────────────────────────
create unique index if not exists coach_statements_one_live
  on coach_statements (coach_id, venue_id, month) where status <> 'void';
create index if not exists coach_statements_venue
  on coach_statements (venue_id, month);
create index if not exists coach_statement_lines_statement
  on coach_statement_lines (statement_id);
create unique index if not exists coach_statement_lines_one_per_lesson
  on coach_statement_lines (statement_id, lesson_id);
create index if not exists coach_statement_lines_lesson
  on coach_statement_lines (lesson_id);

-- ── the photo purge queue (R43) ────────────────────────────────────────────
create index if not exists coach_photo_purges_due
  on coach_photo_purges (queued_at) where purged_at is null;

-- ── the three hot tables: empty partial indexes (R22, R60) ─────────────────
-- At most one live court row per lesson (§1.2).
create unique index if not exists reservations_one_live_per_lesson
  on reservations (lesson_id)
  where lesson_id is not null and status in ('pending', 'confirmed', 'arrived');
create index if not exists reservations_lesson
  on reservations (lesson_id) where lesson_id is not null;
-- At most one live lesson tab per enrolment (Money's name, §1.2).
create unique index if not exists tabs_one_live_per_enrolment
  on tabs (lesson_enrolment_id)
  where lesson_enrolment_id is not null and status in ('open', 'awaiting_payment');
create index if not exists tabs_by_lesson_enrolment
  on tabs (lesson_enrolment_id) where lesson_enrolment_id is not null;
-- At most one live online attempt per enrolment (Money's name, §1.2).
create unique index if not exists booking_payments_one_active_lesson
  on booking_payments (lesson_enrolment_id)
  where lesson_enrolment_id is not null and purpose = 'lesson' and status in ('created', 'pending');
create index if not exists booking_payments_by_lesson_enrolment
  on booking_payments (lesson_enrolment_id) where lesson_enrolment_id is not null;
