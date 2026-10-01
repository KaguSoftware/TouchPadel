set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0278 coaching_tables — coaching, lanes DB and Money in one file
-- (docs/design/coaching/db.md §4.3, money.md §4; build contracts §1.1, §1.2,
-- §1.4, §1.5, R1, R6, R22, R24, R26, R30, R32, R43, R44, R49, R61, R64, R74,
-- R75).
--
-- DB:
--   1. coaches                (chain)   a guest profile promoted to coach
--   2. coach_branches         (branch)  where a coach teaches
--   3. coach_time_off         (chain)   a coach's time off, at every branch
--   4. coach_hours            (branch)  weekly windows, one local day each
--   5. lesson_types           (branch)  private / group / course, the venue's prices
--   6. coach_lesson_types     (branch)  the types a coach teaches
--   7. coach_prices           (branch)  a per-coach price (owner or protocol)
--   8. courses                (branch)  a fixed run of sessions, one sign-up
--   9. lessons                (branch)  one session on one court
--  10. lesson_enrolments      (branch)  a place in a lesson or a course
--  11. lesson_attendance      (branch)  attended / no_show per session
--  12. lesson_strikes         (branch)  the strike ledger hold_strikes_settle reads
--  13. lesson_events          (branch, append-only) every move
--  14. coach_statements       (branch)  a coach's month (Money is the only writer)
--  15. coach_statement_lines  (branch)  one line per lesson (R24), frozen once
--                                       approved, paid or void (R22)
--  16. coach_photo_purges     (chain)   photo folders to remove (R43)
--  17. reservations: lesson_id, the lesson-row CHECKs, the hold rule widened
--      for a lesson's court hold (R1), the branch guard re-created
-- Money:
--  18. tabs: lesson_enrolment_id, lesson_iqd, tabs_lesson_shape (R22); the
--      branch guard re-created
--  19. booking_payments: lesson_enrolment_id, the anchor and reason_by_purpose
--      re-created for purpose 'lesson'; the branch guard re-created
-- Both:
--  20. guards, sanitisers, the append-only and frozen triggers
--  21. RLS on, no policy, no client grant: every read and write goes through a
--      definer body (0282 onward)
--  22. menu-media/coaches/ for managers and the owner (C-7, R43)
--  23. app.lock_coach / app.try_lock_coach (R6: 0281 calls them), the coach
--      mutex ranked after match_money_advisory (scripts/lib/lock-order.mjs)
--  24. comments and the assistant's readable columns
--
-- Every CHECK on a new table is inline in its create table; every CHECK or FK
-- on an existing table is NOT VALID with a validate guarded on conname and
-- conrelid. No index here beyond primary keys, unique columns and the two
-- exclusion constraints: every other index is 0279. Nothing writes a coaching
-- row before 0282.

-- ===========================================================================
-- 1. coaches (chain-wide: no venue_id, no guard)
-- ===========================================================================
create table if not exists coaches (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null unique references profiles(id),
  display_name_en     text not null,
  display_name_ar     text not null,
  bio_en              text not null default '',
  bio_ar              text not null default '',
  photo_path          text,
  status              text not null default 'active',
  sort_order          int  not null default 0,
  public_accepted_at  timestamptz,                     -- C-22, R61
  created_by_staff_id uuid references staff(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  retired_at          timestamptz,
  constraint coaches_status  check (status in ('active', 'paused', 'retired')),
  constraint coaches_names   check (char_length(display_name_en) between 1 and 60
                                    and char_length(display_name_ar) between 1 and 60),
  constraint coaches_bios    check (char_length(bio_en) <= 1000 and char_length(bio_ar) <= 1000),
  constraint coaches_photo   check (photo_path is null
                                    or photo_path ~ '^coaches/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'),
  constraint coaches_retired check ((status = 'retired') = (retired_at is not null))
);

-- ===========================================================================
-- 2. coach_branches (branch)
-- ===========================================================================
create table if not exists coach_branches (
  coach_id   uuid not null references coaches(id),
  venue_id   uuid not null references venues(id),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (coach_id, venue_id)
);

-- ===========================================================================
-- 3. coach_time_off (chain-wide)
-- ===========================================================================
create table if not exists coach_time_off (
  id              uuid primary key default gen_random_uuid(),
  coach_id        uuid not null references coaches(id),
  period          tstzrange not null,
  reason          text not null default '',
  set_by          text not null,
  set_by_staff_id uuid references staff(id),
  created_at      timestamptz not null default now(),
  cancelled_at    timestamptz,
  constraint coach_time_off_period check (not isempty(period) and not lower_inf(period)
                                          and not upper_inf(period) and lower_inc(period)
                                          and not upper_inc(period)),
  constraint coach_time_off_reason check (char_length(reason) <= 200),
  constraint coach_time_off_set_by check (set_by in ('coach', 'staff')
                                          and (set_by = 'staff') = (set_by_staff_id is not null)),
  -- btree_gist lives in schema extensions (0069): the operator class is named.
  constraint coach_time_off_no_overlap exclude using gist
    (coach_id extensions.gist_uuid_ops with =, period with &&) where (cancelled_at is null)
);

-- ===========================================================================
-- 4. coach_hours (branch)
-- ===========================================================================
create table if not exists coach_hours (
  id              uuid primary key default gen_random_uuid(),
  coach_id        uuid not null references coaches(id),
  venue_id        uuid not null references venues(id),
  weekday         smallint not null,
  start_time      time not null,
  end_time        time not null,
  set_by          text not null,
  set_by_staff_id uuid references staff(id),
  updated_at      timestamptz not null default now(),
  constraint coach_hours_weekday check (weekday between 0 and 6),
  constraint coach_hours_window  check (start_time < end_time and end_time <= time '24:00'
                                        and extract(second from start_time) = 0
                                        and extract(second from end_time) = 0
                                        and extract(minute from start_time)::int % 30 = 0
                                        and extract(minute from end_time)::int % 30 = 0),
  constraint coach_hours_set_by  check (set_by in ('coach', 'staff')
                                        and (set_by = 'staff') = (set_by_staff_id is not null))
);

-- ===========================================================================
-- 5. lesson_types (branch)
-- ===========================================================================
create table if not exists lesson_types (
  id                  uuid primary key default gen_random_uuid(),
  venue_id            uuid not null references venues(id),
  kind                text not null,
  name_en             text not null,
  name_ar             text not null,
  description_en      text not null default '',
  description_ar      text not null default '',
  duration_min        smallint not null,
  price_iqd           iqd,
  court_share_iqd     iqd not null default 0,
  max_places          smallint not null,
  min_places          smallint not null default 1,
  cutoff_hours        smallint not null default 0,
  sessions_count      smallint,
  is_active           boolean not null default false,
  launched_at         timestamptz,
  sort_order          int not null default 0,
  created_by_staff_id uuid references staff(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint lesson_types_kind     check (kind in ('private', 'group', 'course')),
  constraint lesson_types_text     check (char_length(name_en) between 1 and 60
                                          and char_length(name_ar) between 1 and 60
                                          and char_length(description_en) <= 500
                                          and char_length(description_ar) <= 500),
  constraint lesson_types_duration check (duration_min between 30 and 240 and duration_min % 30 = 0),
  constraint lesson_types_places   check (
    (kind = 'private' and max_places between 1 and 4 and min_places = 1 and cutoff_hours = 0)
    or (kind in ('group', 'course') and max_places between 2 and 16
        and min_places between 1 and max_places and cutoff_hours between 0 and 168)),
  constraint lesson_types_sessions check ((kind = 'course') = (sessions_count is not null)
                                          and (sessions_count is null or sessions_count between 2 and 52)),
  constraint lesson_types_launch   check ((price_iqd is not null or launched_at is null)
                                          and (not is_active or launched_at is not null)),
  constraint lesson_types_price    check ((price_iqd is null or price_iqd > 0)
                                          and (kind <> 'course' or price_iqd is null
                                               or price_iqd >= sessions_count)),
  constraint lesson_types_cutoff   check (kind = 'private' or min_places = 1 or cutoff_hours >= 1)  -- R26
);

-- ===========================================================================
-- 6. coach_lesson_types, 7. coach_prices (branch)
-- ===========================================================================
create table if not exists coach_lesson_types (
  coach_id       uuid not null references coaches(id),
  lesson_type_id uuid not null references lesson_types(id),
  venue_id       uuid not null references venues(id),
  created_at     timestamptz not null default now(),
  primary key (coach_id, lesson_type_id)
);

create table if not exists coach_prices (
  coach_id        uuid not null references coaches(id),
  lesson_type_id  uuid not null references lesson_types(id),
  venue_id        uuid not null references venues(id),
  price_iqd       iqd not null,
  set_at          timestamptz not null default now(),
  protocol_run_id uuid references protocol_runs(id),
  primary key (coach_id, lesson_type_id),
  constraint coach_prices_positive check (price_iqd > 0)
);

-- ===========================================================================
-- 8. courses (branch)
-- ===========================================================================
create table if not exists courses (
  id                    uuid primary key default gen_random_uuid(),
  venue_id              uuid not null references venues(id),
  coach_id              uuid not null references coaches(id),
  lesson_type_id        uuid not null references lesson_types(id),
  title_en              text not null default '',
  title_ar              text not null default '',
  price_iqd             iqd not null,
  court_share_iqd       iqd not null,
  coach_share_bp        int not null,
  sessions_count        smallint not null,
  max_places            smallint not null,
  min_places            smallint not null,
  cutoff_at             timestamptz not null,
  cutoff_checked_at     timestamptz,                   -- R22, R26
  signup_closes_at      timestamptz not null,
  status                text not null default 'open',
  cancel_reason         text,
  created_by_kind       text not null,
  created_by_profile_id uuid references profiles(id),
  created_by_staff_id   uuid references staff(id),
  idempotency_key       text unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  cancelled_at          timestamptz,
  constraint courses_status     check (status in ('open', 'running', 'completed', 'cancelled')),
  constraint courses_cancel     check ((status = 'cancelled') = (cancelled_at is not null)
                                       and (status = 'cancelled') = (cancel_reason is not null)
                                       and (cancel_reason is null or cancel_reason in
                                         ('guest_cancel', 'coach_cancel', 'staff_cancel', 'under_filled',
                                          'payment_expired', 'account_deleted', 'coach_retired'))),
  constraint courses_titles     check (char_length(title_en) <= 80 and char_length(title_ar) <= 80),
  constraint courses_numbers    check (price_iqd > 0 and price_iqd >= sessions_count
                                       and coach_share_bp between 0 and 10000
                                       and sessions_count between 2 and 52
                                       and max_places between 2 and 16
                                       and min_places between 1 and max_places
                                       and cutoff_at <= signup_closes_at),
  constraint courses_created_by check ((created_by_kind = 'coach' and created_by_profile_id is not null
                                        and created_by_staff_id is null)
                                       or (created_by_kind = 'staff' and created_by_staff_id is not null)),
  constraint courses_idem       check (idempotency_key is null
                                       or char_length(idempotency_key) between 1 and 200)
);

-- ===========================================================================
-- 9. lessons (branch; one session on one court)
-- ===========================================================================
create table if not exists lessons (
  id                    uuid primary key default gen_random_uuid(),
  venue_id              uuid not null references venues(id),
  coach_id              uuid not null references coaches(id),
  lesson_type_id        uuid not null references lesson_types(id),
  kind                  text not null,
  course_id             uuid references courses(id),
  session_no            smallint,
  start_at              timestamptz not null,
  end_at                timestamptz not null,
  period                tstzrange generated always as (tstzrange(start_at, end_at, '[)')) stored,
  price_iqd             iqd,
  court_share_iqd       iqd not null,
  coach_share_bp        int not null,
  max_places            smallint not null,
  min_places            smallint not null,
  cutoff_at             timestamptz,
  cutoff_checked_at     timestamptz,                   -- R22, R26
  status                text not null default 'scheduled',
  hold_expires_at       timestamptz,
  booked_by_kind        text not null,
  created_by_profile_id uuid references profiles(id),
  created_by_staff_id   uuid references staff(id),
  cancel_reason         text,
  cancelled_at          timestamptz,
  completed_at          timestamptz,
  rescheduled_at        timestamptz,                   -- R8, R32
  idempotency_key       text unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint lessons_kind          check (kind in ('private', 'group', 'course')),
  constraint lessons_course        check ((kind = 'course') = (course_id is not null)
                                          and (course_id is null) = (session_no is null)
                                          and (session_no is null or session_no between 1 and 52)),
  constraint lessons_price         check ((kind = 'course') = (price_iqd is null)),
  constraint lessons_time          check (end_at > start_at and end_at - start_at <= interval '240 minutes'),
  constraint lessons_cutoff        check ((kind = 'private') = (cutoff_at is null)),
  constraint lessons_places        check (max_places between 1 and 16 and min_places between 1 and max_places),
  constraint lessons_status        check (status in ('held', 'scheduled', 'completed', 'cancelled', 'expired')),
  constraint lessons_hold          check ((status = 'held') = (hold_expires_at is not null)
                                          and (status <> 'held' or kind = 'private')),
  constraint lessons_ended         check ((status in ('cancelled', 'expired')) = (cancelled_at is not null)
                                          and (status in ('cancelled', 'expired')) = (cancel_reason is not null)
                                          and (status = 'completed') = (completed_at is not null)
                                          and (status <> 'expired' or cancel_reason = 'payment_expired')),
  constraint lessons_cancel_reason check (cancel_reason is null or cancel_reason in
                                          ('guest_cancel', 'coach_cancel', 'staff_cancel', 'under_filled',
                                           'payment_expired', 'account_deleted', 'coach_retired')),
  constraint lessons_booked_by     check ((booked_by_kind in ('guest', 'coach') and created_by_profile_id is not null
                                           and created_by_staff_id is null)
                                          or (booked_by_kind = 'staff' and created_by_staff_id is not null)),
  constraint lessons_idem          check (idempotency_key is null or char_length(idempotency_key) between 1 and 200),
  -- One coach, one live lesson at a time, at every branch (the coach key is
  -- branch-free; coach_available is the check, this the backstop).
  constraint lessons_coach_no_overlap exclude using gist
    (coach_id extensions.gist_uuid_ops with =, period with &&) where (status in ('held', 'scheduled'))
);

-- ===========================================================================
-- 10. lesson_enrolments (branch)
-- ===========================================================================
create table if not exists lesson_enrolments (
  id                   uuid primary key default gen_random_uuid(),
  venue_id             uuid not null references venues(id),
  lesson_id            uuid references lessons(id),
  course_id            uuid references courses(id),
  guest_id             uuid references profiles(id),
  guest_name           text,
  guest_phone          text,
  party_size           smallint not null default 1,
  friend_names         text[] not null default '{}',
  booked_by_kind       text not null,
  booked_by_profile_id uuid references profiles(id),
  booked_by_staff_id   uuid references staff(id),
  price_iqd            iqd not null,
  first_session_no     smallint,
  sessions_covered     smallint,
  payment_mode         text not null,
  status               text not null default 'booked',
  hold_expires_at      timestamptz,
  cancel_kind          text,
  cancelled_at         timestamptz,
  link_confirmed_at    timestamptz,                   -- C-21, R44
  refunded_outside_iqd iqd not null default 0,        -- R75
  idempotency_key      text unique,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint lesson_enrolments_target    check (num_nonnulls(lesson_id, course_id) = 1),
  constraint lesson_enrolments_who       check (guest_id is not null or guest_name is not null),
  constraint lesson_enrolments_typed     check (booked_by_kind = 'guest' or guest_name is not null),
  constraint lesson_enrolments_link      check ((link_confirmed_at is null or guest_id is not null)
                                                and (booked_by_kind <> 'guest' or link_confirmed_at is not null)),
  constraint lesson_enrolments_name      check (guest_name is null or char_length(guest_name) between 1 and 80),
  -- app.phone_digits, not app.phone_canon, which has no grant (R11).
  constraint lesson_enrolments_phone     check (guest_phone is null
                                                or coalesce(app.phone_digits(guest_phone), '') ~ '^[0-9]{7,15}$'),
  constraint lesson_enrolments_party     check (party_size between 1 and 4
                                                and (course_id is null or party_size = 1)),
  constraint lesson_enrolments_friends   check (cardinality(friend_names) <= 3
                                                and cardinality(friend_names) <= party_size - 1
                                                and char_length(array_to_string(friend_names, '')) <= 120),
  constraint lesson_enrolments_booked_by check (
    (booked_by_kind = 'guest' and guest_id is not null and booked_by_profile_id = guest_id
       and booked_by_staff_id is null)
    or (booked_by_kind = 'coach' and booked_by_profile_id is not null and booked_by_staff_id is null)
    or (booked_by_kind = 'staff' and booked_by_staff_id is not null)),
  constraint lesson_enrolments_course    check ((course_id is not null) = (first_session_no is not null)
                                                and (first_session_no is null) = (sessions_covered is null)
                                                and (sessions_covered is null or sessions_covered >= 1)),
  constraint lesson_enrolments_payment   check (payment_mode in ('desk', 'online')
                                                and (booked_by_kind = 'guest' or payment_mode = 'desk')),
  constraint lesson_enrolments_status    check (status in ('held', 'booked', 'cancelled', 'expired')),
  constraint lesson_enrolments_hold      check ((status = 'held') = (hold_expires_at is not null)
                                                and (status <> 'held' or payment_mode = 'online')),
  constraint lesson_enrolments_ended     check ((status in ('cancelled', 'expired'))
                                                  = (cancelled_at is not null and cancel_kind is not null)
                                                and (status <> 'expired' or cancel_kind = 'expired')),
  constraint lesson_enrolments_cancel_kind check (cancel_kind is null or cancel_kind in
    ('guest_free', 'guest_late', 'coach', 'staff', 'under_filled', 'expired', 'account_deleted',
     'course_cancelled')),
  constraint lesson_enrolments_idem      check (idempotency_key is null
                                                or char_length(idempotency_key) between 1 and 200)
);

-- ===========================================================================
-- 11. lesson_attendance, 12. lesson_strikes, 13. lesson_events (branch)
-- ===========================================================================
create table if not exists lesson_attendance (
  lesson_id            uuid not null references lessons(id),
  enrolment_id         uuid not null references lesson_enrolments(id),
  venue_id             uuid not null references venues(id),
  status               text not null,
  marked_by_kind       text not null,
  marked_by_profile_id uuid references profiles(id),
  marked_by_staff_id   uuid references staff(id),
  marked_at            timestamptz not null default now(),
  primary key (lesson_id, enrolment_id),
  constraint lesson_attendance_status check (status in ('attended', 'no_show')),
  constraint lesson_attendance_by     check ((marked_by_kind = 'coach' and marked_by_profile_id is not null
                                            and marked_by_staff_id is null)
                                           or (marked_by_kind = 'staff' and marked_by_staff_id is not null))
);

create table if not exists lesson_strikes (
  enrolment_id uuid not null references lesson_enrolments(id),
  lesson_id    uuid not null references lessons(id),
  venue_id     uuid not null references venues(id),
  guest_id     uuid not null references profiles(id),
  kind         text not null,
  struck_at    timestamptz not null default now(),
  settled_at   timestamptz,
  counted      boolean,
  primary key (enrolment_id, lesson_id),
  constraint lesson_strikes_kind    check (kind in ('late_cancel', 'no_show', 'lapsed_hold')),   -- R30
  constraint lesson_strikes_settled check ((settled_at is null) = (counted is null))
);

create table if not exists lesson_events (
  id               bigint generated always as identity primary key,
  venue_id         uuid not null references venues(id),
  lesson_id        uuid references lessons(id),
  course_id        uuid references courses(id),
  enrolment_id     uuid references lesson_enrolments(id),
  type             text not null,
  actor            text not null,
  actor_profile_id uuid references profiles(id),
  actor_staff_id   uuid references staff(id),
  code             text,
  data             jsonb not null default '{}'::jsonb,
  at               timestamptz not null default now(),
  constraint lesson_events_type   check (type in ('booked', 'held', 'paid_online', 'expired', 'joined',
                                       'added', 'cancelled', 'enrolment_cancelled', 'rescheduled',
                                       'court_moved', 'under_filled', 'completed', 'attended', 'no_show',
                                       'unmarked', 'settled', 'refunded')),
  constraint lesson_events_target check (num_nonnulls(lesson_id, course_id) >= 1),
  constraint lesson_events_actor  check ((actor in ('guest', 'coach') and actor_profile_id is not null
                                          and actor_staff_id is null)
                                         or (actor = 'staff' and actor_staff_id is not null)
                                         or (actor = 'system' and actor_profile_id is null
                                             and actor_staff_id is null)),
  constraint lesson_events_code   check (code is null or char_length(code) <= 40),
  constraint lesson_events_data   check (jsonb_typeof(data) = 'object')
);

-- ===========================================================================
-- 14. coach_statements, 15. coach_statement_lines (branch; DB writes the DDL,
--     Money is the only writer, 0287)
-- ===========================================================================
create table if not exists coach_statements (
  id              uuid primary key default gen_random_uuid(),
  coach_id        uuid not null references coaches(id),
  venue_id        uuid not null references venues(id),
  month           date not null,
  status          text not null default 'draft',
  lessons_count   int  not null default 0,
  collected_iqd   iqd  not null default 0,
  court_share_iqd iqd  not null default 0,
  coach_iqd       iqd_signed not null default 0,
  adjustments_iqd iqd_signed not null default 0,
  drafted_at      timestamptz not null default now(),
  refreshed_at    timestamptz,
  approved_by     uuid references staff(id),
  approved_at     timestamptz,
  paid_by         uuid references staff(id),
  paid_at         timestamptz,
  paid_reference  text,
  voided_by       uuid references staff(id),
  voided_at       timestamptz,
  void_reason     text,
  constraint coach_statements_month   check (extract(day from month) = 1),
  constraint coach_statements_status  check (status in ('draft', 'approved', 'paid', 'void')),
  constraint coach_statements_count   check (lessons_count >= 0),
  constraint coach_statements_stamps  check ((approved_at is null) = (approved_by is null)
                                             and (paid_at is null) = (paid_by is null)
                                             and (status not in ('approved', 'paid') or approved_at is not null)
                                             and (status <> 'paid' or (paid_at is not null and paid_reference is not null))
                                             and (status = 'void') = (voided_at is not null and voided_by is not null
                                                                      and void_reason is not null)),
  constraint coach_statements_text    check ((paid_reference is null or char_length(paid_reference) between 1 and 80)
                                             and (void_reason is null or char_length(void_reason) between 1 and 200)),
  -- R49, R74: a card or account number never lands in a free-text field. A
  -- run of 12 or more digits once spaces and hyphens are removed backs
  -- Money's INVALID_ARGUMENT (hint digits).
  constraint coach_statements_no_card check (
    regexp_replace(coalesce(paid_reference, ''), '[[:space:]-]', '', 'g') !~ '[0-9]{12}'
    and regexp_replace(coalesce(void_reason, ''), '[[:space:]-]', '', 'g') !~ '[0-9]{12}')
);

create table if not exists coach_statement_lines (
  id              uuid primary key default gen_random_uuid(),
  statement_id    uuid not null references coach_statements(id),
  venue_id        uuid not null references venues(id),
  lesson_id       uuid not null references lessons(id),            -- R24: every line, adjustments too
  collected_iqd   iqd_signed not null default 0,
  court_share_iqd iqd_signed not null default 0,
  share_bp        int not null,
  coach_iqd       iqd_signed not null,
  is_adjustment   boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint coach_statement_lines_bp   check (share_bp between 0 and 10000),
  constraint coach_statement_lines_sign check (is_adjustment                                     -- R22
                                               or (collected_iqd >= 0 and court_share_iqd >= 0 and coach_iqd >= 0))
);

-- ===========================================================================
-- 16. coach_photo_purges (chain-wide; R43)
-- ===========================================================================
create table if not exists coach_photo_purges (
  id        uuid primary key default gen_random_uuid(),
  coach_id  uuid not null references coaches(id),
  folder    text not null,
  queued_at timestamptz not null default now(),
  purged_at timestamptz,
  constraint coach_photo_purges_folder check (folder ~ '^coaches/[0-9a-f-]{36}$')
);

-- ===========================================================================
-- 17. reservations: a lesson's court row (DB)
-- ===========================================================================
-- A lesson's court row is kind 'lesson' (a booked or desk-paid session) or,
-- for a private lesson paid online while its payment is open, a 'hold' row;
-- either names its lesson, has guest_id NULL and guest_name exactly 'Lesson',
-- and carries no money: lesson money lives on enrolments, and no court figure
-- that sums reservations.price_iqd can count it (D-17). A nullable column
-- without a default is a catalog change only.
alter table reservations add column if not exists lesson_id uuid;

-- The 0071 hold rule (reservations_live_hold_has_guest), widened for a
-- lesson's court hold (R1): a live hold carries a guest or names its lesson.
-- 0280 narrows the orphan rule of expire_stale_holds and match_expire_holds to
-- match (R25). Dropped and re-added NOT VALID, then validated below.
alter table reservations drop constraint if exists reservations_live_hold_has_guest;

do $reservations_lesson_0278$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'reservations_lesson_id_fkey'
                    and conrelid = 'public.reservations'::regclass) then
    alter table reservations add constraint reservations_lesson_id_fkey
      foreign key (lesson_id) references lessons(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'reservations_lesson_link'
                    and conrelid = 'public.reservations'::regclass) then
    alter table reservations add constraint reservations_lesson_link
      check (kind <> 'lesson' or lesson_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'reservations_lesson_kind'
                    and conrelid = 'public.reservations'::regclass) then
    alter table reservations add constraint reservations_lesson_kind
      check (lesson_id is null or kind in ('lesson', 'hold')) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'reservations_lesson_row'
                    and conrelid = 'public.reservations'::regclass) then
    alter table reservations add constraint reservations_lesson_row
      check (lesson_id is null
             or (guest_id is null and guest_name = 'Lesson' and guest_phone is null and price_iqd is null
                 and rate_rule_id is null and series_id is null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'reservations_live_hold_has_guest'
                    and conrelid = 'public.reservations'::regclass) then
    alter table reservations add constraint reservations_live_hold_has_guest
      check (kind <> 'hold' or status <> 'pending' or guest_id is not null or lesson_id is not null) not valid;
  end if;
end $reservations_lesson_0278$;

do $reservations_lesson_validate_0278$
declare
  v_name text;
begin
  foreach v_name in array array['reservations_lesson_id_fkey', 'reservations_lesson_link',
                                'reservations_lesson_kind', 'reservations_lesson_row',
                                'reservations_live_hold_has_guest'] loop
    if exists (select 1 from pg_constraint
                where conname = v_name
                  and conrelid = 'public.reservations'::regclass
                  and not convalidated) then
      execute format('alter table reservations validate constraint %I', v_name);
    end if;
  end loop;
end $reservations_lesson_validate_0278$;

-- ===========================================================================
-- 18. tabs: a lesson's desk money (Money, money.md §4.1)
-- ===========================================================================
-- bigint, not the iqd domain: adding a column of a domain with a CHECK
-- rewrites the whole table, and tabs is the till's table (the 0258
-- court_cap_iqd precedent). The named CHECK below is the domain's rule. A
-- constant default is a fast default: no rewrite.
alter table tabs add column if not exists lesson_enrolment_id uuid;
alter table tabs add column if not exists lesson_iqd bigint not null default 0;

do $tabs_lesson_0278$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'tabs_lesson_enrolment_fkey'
                    and conrelid = 'public.tabs'::regclass) then
    alter table tabs add constraint tabs_lesson_enrolment_fkey
      foreign key (lesson_enrolment_id) references lesson_enrolments(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'tabs_lesson_iqd_nonneg'
                    and conrelid = 'public.tabs'::regclass) then
    alter table tabs add constraint tabs_lesson_iqd_nonneg check (lesson_iqd >= 0) not valid;
  end if;
  -- CM-1, R22: a lesson tab is the enrolment's own bill: no table, no booking,
  -- no court cap; every other tab carries no lesson money.
  if not exists (select 1 from pg_constraint
                  where conname = 'tabs_lesson_shape'
                    and conrelid = 'public.tabs'::regclass) then
    alter table tabs add constraint tabs_lesson_shape check (
          (kind = 'lesson') = (lesson_enrolment_id is not null)
      and (kind <> 'lesson' or (reservation_id is null and table_id is null and court_cap_iqd is null))
      and (kind = 'lesson' or lesson_iqd = 0)) not valid;
  end if;
end $tabs_lesson_0278$;

do $tabs_lesson_validate_0278$
declare
  v_name text;
begin
  foreach v_name in array array['tabs_lesson_enrolment_fkey', 'tabs_lesson_iqd_nonneg', 'tabs_lesson_shape'] loop
    if exists (select 1 from pg_constraint
                where conname = v_name
                  and conrelid = 'public.tabs'::regclass
                  and not convalidated) then
      execute format('alter table tabs validate constraint %I', v_name);
    end if;
  end loop;
end $tabs_lesson_validate_0278$;

comment on column tabs.lesson_enrolment_id is
  '0278. The lesson enrolment a kind ''lesson'' tab takes desk money for (one payment, settled in the same call by app.lesson_settle). NULL on every other tab.';
comment on column tabs.lesson_iqd is
  '0278. The lesson line stamped at settlement (app.settle_tab, from compute_tab_totals): what the enrolment still owed. Outside the tax base like the court line (CD-4). 0 on every other tab.';

-- ===========================================================================
-- 19. booking_payments: a lesson paid online (Money, money.md §4.2)
-- ===========================================================================
alter table booking_payments add column if not exists lesson_enrolment_id uuid;

-- The anchor (0258:579-583) and the refund reasons by purpose (0258:596-599),
-- re-created with the lesson shape. A lesson row names its branch and its
-- enrolment, has no booking (reservation_id NULL, R22) and no ticket count;
-- hold_id is the court hold of a private lesson, else NULL. Deposit and
-- ticket shapes are unchanged.
alter table booking_payments drop constraint if exists booking_payments_anchor;
alter table booking_payments drop constraint if exists booking_payments_reason_by_purpose;

do $booking_payments_lesson_0278$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'booking_payments_lesson_enrolment_fkey'
                    and conrelid = 'public.booking_payments'::regclass) then
    alter table booking_payments add constraint booking_payments_lesson_enrolment_fkey
      foreign key (lesson_enrolment_id) references lesson_enrolments(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'booking_payments_anchor'
                    and conrelid = 'public.booking_payments'::regclass) then
    alter table booking_payments add constraint booking_payments_anchor check (
         (purpose = 'deposit' and venue_id is not null and hold_id is not null
                              and reservation_id is not null and ticket_count is null
                              and lesson_enrolment_id is null)
      or (purpose = 'ticket'  and venue_id is null and hold_id is null
                              and reservation_id is null and ticket_count between 1 and 3
                              and lesson_enrolment_id is null)
      or (purpose = 'lesson'  and venue_id is not null and lesson_enrolment_id is not null
                              and reservation_id is null and ticket_count is null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'booking_payments_reason_by_purpose'
                    and conrelid = 'public.booking_payments'::regclass) then
    alter table booking_payments add constraint booking_payments_reason_by_purpose check (
      refund_reason is null
      or (purpose = 'ticket'  and refund_reason in ('ticket_cashout', 'account_deleted', 'amount_mismatch'))
      or (purpose = 'deposit' and refund_reason not in ('ticket_cashout', 'account_deleted',
                                                        'coach_cancel', 'under_filled'))
      or (purpose = 'lesson'  and refund_reason in ('guest_cancel', 'staff_cancel', 'coach_cancel',
                                                    'under_filled', 'slot_lost', 'venue_offline',
                                                    'amount_mismatch', 'duplicate_success',
                                                    'account_deleted', 'staff_refund'))) not valid;
  end if;
end $booking_payments_lesson_0278$;

do $booking_payments_lesson_validate_0278$
declare
  v_name text;
begin
  foreach v_name in array array['booking_payments_lesson_enrolment_fkey', 'booking_payments_anchor',
                                'booking_payments_reason_by_purpose'] loop
    if exists (select 1 from pg_constraint
                where conname = v_name
                  and conrelid = 'public.booking_payments'::regclass
                  and not convalidated) then
      execute format('alter table booking_payments validate constraint %I', v_name);
    end if;
  end loop;
end $booking_payments_lesson_validate_0278$;

comment on table booking_payments is
  '0241, tickets since 0258, lessons since 0278. One online payment attempt (Qi Card hosted page): a deposit on a court booking (purpose deposit: venue_id, hold_id and reservation_id set), a purchase of open-match tickets (purpose ticket: a chain row, venue_id, hold_id and reservation_id NULL, ticket_count 1..3, amount = ticket_count x quoted_price_iqd), or a lesson place paid online (purpose lesson, 0284: venue_id and lesson_enrolment_id set, reservation_id NULL, hold_id the court hold of a private lesson). Written only by the app.deposit_*, app.ticket_* and app.lesson_* functions; request_id is what Qi gets, provider_payment_id what Qi answered. reservation_id is the booking a deposit is for (it moves when a swept hold is re-created as a booking); hold_id is where the attempt began and never changes. Not a till payment: no recorded_by, no day, not in the cash count.';
comment on column booking_payments.lesson_enrolment_id is
  '0278. The lesson enrolment a purpose ''lesson'' payment is for; NULL otherwise.';

-- ===========================================================================
-- 20. Guards, sanitisers, the append-only and frozen triggers
-- ===========================================================================

-- Links name rows of the same branch; staff write only where a definer body
-- asserted app.venue_id (0230). The chain-wide tables (coaches,
-- coach_time_off, coach_photo_purges) carry none, and a chain-wide parent is
-- never a link pair (row_venue would read a venue_id it does not have).
drop trigger if exists zz_branch_guard on public.coach_branches;
create trigger zz_branch_guard before insert or update or delete on public.coach_branches
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.coach_hours;
create trigger zz_branch_guard before insert or update or delete on public.coach_hours
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.lesson_types;
create trigger zz_branch_guard before insert or update or delete on public.lesson_types
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.coach_lesson_types;
create trigger zz_branch_guard before insert or update or delete on public.coach_lesson_types
  for each row execute function app.trg_branch_guard('scoped', 'lesson_types', 'lesson_type_id');
drop trigger if exists zz_branch_guard on public.coach_prices;
create trigger zz_branch_guard before insert or update or delete on public.coach_prices
  for each row execute function app.trg_branch_guard('scoped', 'lesson_types', 'lesson_type_id', 'protocol_runs', 'protocol_run_id');
drop trigger if exists zz_branch_guard on public.courses;
create trigger zz_branch_guard before insert or update or delete on public.courses
  for each row execute function app.trg_branch_guard('scoped', 'lesson_types', 'lesson_type_id');
drop trigger if exists zz_branch_guard on public.lessons;
create trigger zz_branch_guard before insert or update or delete on public.lessons
  for each row execute function app.trg_branch_guard('scoped', 'lesson_types', 'lesson_type_id', 'courses', 'course_id');
drop trigger if exists zz_branch_guard on public.lesson_enrolments;
create trigger zz_branch_guard before insert or update or delete on public.lesson_enrolments
  for each row execute function app.trg_branch_guard('scoped', 'lessons', 'lesson_id', 'courses', 'course_id');
drop trigger if exists zz_branch_guard on public.lesson_attendance;
create trigger zz_branch_guard before insert or update or delete on public.lesson_attendance
  for each row execute function app.trg_branch_guard('scoped', 'lessons', 'lesson_id', 'lesson_enrolments', 'enrolment_id');
drop trigger if exists zz_branch_guard on public.lesson_strikes;
create trigger zz_branch_guard before insert or update or delete on public.lesson_strikes
  for each row execute function app.trg_branch_guard('scoped', 'lessons', 'lesson_id', 'lesson_enrolments', 'enrolment_id');
drop trigger if exists zz_branch_guard on public.lesson_events;
create trigger zz_branch_guard before insert or update or delete on public.lesson_events
  for each row execute function app.trg_branch_guard('scoped', 'lessons', 'lesson_id', 'courses', 'course_id', 'lesson_enrolments', 'enrolment_id');
drop trigger if exists zz_branch_guard on public.coach_statements;
create trigger zz_branch_guard before insert or update or delete on public.coach_statements
  for each row execute function app.trg_branch_guard('scoped');
drop trigger if exists zz_branch_guard on public.coach_statement_lines;
create trigger zz_branch_guard before insert or update or delete on public.coach_statement_lines
  for each row execute function app.trg_branch_guard('scoped', 'coach_statements', 'statement_id', 'lessons', 'lesson_id');

-- The three changed tables, re-created from 0230:187-189, 0230:196-198 and
-- 0241:99-101 with the new link pair appended.
drop trigger if exists zz_branch_guard on public.reservations;
create trigger zz_branch_guard before insert or update or delete on public.reservations
  for each row execute function app.trg_branch_guard('scoped', 'rate_rules', 'rate_rule_id', 'reservation_series', 'series_id', 'protocol_runs', 'protocol_run_id', 'lessons', 'lesson_id');
drop trigger if exists zz_branch_guard on public.tabs;
create trigger zz_branch_guard before insert or update or delete on public.tabs
  for each row execute function app.trg_branch_guard('scoped', 'cafe_tables', 'table_id', 'day_sessions', 'day_session_id', 'tabs', 'merged_into_tab_id', 'lesson_enrolments', 'lesson_enrolment_id');
drop trigger if exists zz_branch_guard on public.booking_payments;
create trigger zz_branch_guard before insert or update or delete on public.booking_payments
  for each row execute function app.trg_branch_guard('scoped', 'reservations', 'reservation_id', 'reservations', 'hold_id', 'lesson_enrolments', 'lesson_enrolment_id');

-- Sanitisers (the 0080 shape): every one BEFORE, row level, named so it sorts
-- before zz_branch_guard. app.safe_line and app.safe_text never return NULL
-- for a non-NULL input, so a NOT NULL column survives them.
create or replace function app.trg_sanitise_coach() returns trigger
language plpgsql security definer set search_path = public as $trg_sanitise_coach_0278$
begin
  new.display_name_en := app.safe_line(new.display_name_en);
  new.display_name_ar := app.safe_line(new.display_name_ar);
  new.bio_en := coalesce(app.safe_text(new.bio_en), '');
  new.bio_ar := coalesce(app.safe_text(new.bio_ar), '');
  return new;
end $trg_sanitise_coach_0278$;

create or replace function app.trg_sanitise_lesson_type() returns trigger
language plpgsql security definer set search_path = public as $trg_sanitise_lesson_type_0278$
begin
  new.name_en := app.safe_line(new.name_en);
  new.name_ar := app.safe_line(new.name_ar);
  new.description_en := coalesce(app.safe_text(new.description_en), '');
  new.description_ar := coalesce(app.safe_text(new.description_ar), '');
  return new;
end $trg_sanitise_lesson_type_0278$;

create or replace function app.trg_sanitise_course() returns trigger
language plpgsql security definer set search_path = public as $trg_sanitise_course_0278$
begin
  new.title_en := coalesce(app.safe_line(new.title_en), '');
  new.title_ar := coalesce(app.safe_line(new.title_ar), '');
  return new;
end $trg_sanitise_course_0278$;

create or replace function app.trg_sanitise_coach_time_off() returns trigger
language plpgsql security definer set search_path = public as $trg_sanitise_coach_time_off_0278$
begin
  new.reason := coalesce(app.safe_line(new.reason), '');
  return new;
end $trg_sanitise_coach_time_off_0278$;

-- A typed name or phone made only of control characters becomes NULL; each
-- friend name is cleaned, empties are dropped and the order is kept.
create or replace function app.trg_sanitise_lesson_enrolment() returns trigger
language plpgsql security definer set search_path = public as $trg_sanitise_lesson_enrolment_0278$
begin
  new.guest_name  := nullif(app.safe_line(new.guest_name), '');
  new.guest_phone := nullif(app.safe_line(new.guest_phone), '');
  new.friend_names := array(
    select s.name
      from (select app.safe_line(f.name) as name, f.ord
              from unnest(new.friend_names) with ordinality as f(name, ord)) s
     where s.name is not null and s.name <> ''
     order by s.ord);
  return new;
end $trg_sanitise_lesson_enrolment_0278$;

create or replace function app.trg_sanitise_coach_statement() returns trigger
language plpgsql security definer set search_path = public as $trg_sanitise_coach_statement_0278$
begin
  new.paid_reference := nullif(app.safe_line(new.paid_reference), '');
  new.void_reason    := nullif(app.safe_line(new.void_reason), '');
  return new;
end $trg_sanitise_coach_statement_0278$;

-- R22: the lines of an approved, paid or void statement never change. Money
-- that moves later is an adjustment line on the next draft (CM-9).
create or replace function app.trg_coach_statement_lines_frozen() returns trigger
language plpgsql security definer set search_path = public as $trg_coach_statement_lines_frozen_0278$
declare
  v_status text;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    select s.status into v_status from coach_statements s where s.id = new.statement_id;
    if v_status in ('approved', 'paid', 'void') then
      raise exception 'STATEMENT_NOT_DRAFT' using errcode = 'P0001', detail = v_status;
    end if;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    select s.status into v_status from coach_statements s where s.id = old.statement_id;
    if v_status in ('approved', 'paid', 'void') then
      raise exception 'STATEMENT_NOT_DRAFT' using errcode = 'P0001', detail = v_status;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $trg_coach_statement_lines_frozen_0278$;

revoke all on function app.trg_sanitise_coach() from public, anon, authenticated;
revoke all on function app.trg_sanitise_lesson_type() from public, anon, authenticated;
revoke all on function app.trg_sanitise_course() from public, anon, authenticated;
revoke all on function app.trg_sanitise_coach_time_off() from public, anon, authenticated;
revoke all on function app.trg_sanitise_lesson_enrolment() from public, anon, authenticated;
revoke all on function app.trg_sanitise_coach_statement() from public, anon, authenticated;
revoke all on function app.trg_coach_statement_lines_frozen() from public, anon, authenticated;

drop trigger if exists coaches_sanitise on coaches;
create trigger coaches_sanitise
  before insert or update of display_name_en, display_name_ar, bio_en, bio_ar on coaches
  for each row execute function app.trg_sanitise_coach();
drop trigger if exists lesson_types_sanitise on lesson_types;
create trigger lesson_types_sanitise
  before insert or update of name_en, name_ar, description_en, description_ar on lesson_types
  for each row execute function app.trg_sanitise_lesson_type();
drop trigger if exists courses_sanitise on courses;
create trigger courses_sanitise
  before insert or update of title_en, title_ar on courses
  for each row execute function app.trg_sanitise_course();
drop trigger if exists coach_time_off_sanitise on coach_time_off;
create trigger coach_time_off_sanitise
  before insert or update of reason on coach_time_off
  for each row execute function app.trg_sanitise_coach_time_off();
drop trigger if exists lesson_enrolments_sanitise on lesson_enrolments;
create trigger lesson_enrolments_sanitise
  before insert or update of guest_name, guest_phone, friend_names on lesson_enrolments
  for each row execute function app.trg_sanitise_lesson_enrolment();
drop trigger if exists coach_statements_sanitise on coach_statements;
create trigger coach_statements_sanitise
  before insert or update of paid_reference, void_reason on coach_statements
  for each row execute function app.trg_sanitise_coach_statement();

-- Append-only (0241:128-131, 0258:412-415).
drop trigger if exists lesson_events_append_only on lesson_events;
create trigger lesson_events_append_only
  before update or delete or truncate on lesson_events
  for each statement execute function app.forbid_mutation();

drop trigger if exists coach_statement_lines_frozen on coach_statement_lines;
create trigger coach_statement_lines_frozen
  before insert or update or delete on coach_statement_lines
  for each row execute function app.trg_coach_statement_lines_frozen();

-- ===========================================================================
-- 21. RLS on, no policy, no client grant (0241:93-97, 0258:439-465): every
--     read and write goes through a definer body. The service role bypasses
--     RLS.
-- ===========================================================================
alter table coaches enable row level security;
revoke all on coaches from anon, authenticated;
grant all on coaches to service_role;
alter table coach_branches enable row level security;
revoke all on coach_branches from anon, authenticated;
grant all on coach_branches to service_role;
alter table coach_time_off enable row level security;
revoke all on coach_time_off from anon, authenticated;
grant all on coach_time_off to service_role;
alter table coach_hours enable row level security;
revoke all on coach_hours from anon, authenticated;
grant all on coach_hours to service_role;
alter table lesson_types enable row level security;
revoke all on lesson_types from anon, authenticated;
grant all on lesson_types to service_role;
alter table coach_lesson_types enable row level security;
revoke all on coach_lesson_types from anon, authenticated;
grant all on coach_lesson_types to service_role;
alter table coach_prices enable row level security;
revoke all on coach_prices from anon, authenticated;
grant all on coach_prices to service_role;
alter table courses enable row level security;
revoke all on courses from anon, authenticated;
grant all on courses to service_role;
alter table lessons enable row level security;
revoke all on lessons from anon, authenticated;
grant all on lessons to service_role;
alter table lesson_enrolments enable row level security;
revoke all on lesson_enrolments from anon, authenticated;
grant all on lesson_enrolments to service_role;
alter table lesson_attendance enable row level security;
revoke all on lesson_attendance from anon, authenticated;
grant all on lesson_attendance to service_role;
alter table lesson_strikes enable row level security;
revoke all on lesson_strikes from anon, authenticated;
grant all on lesson_strikes to service_role;
alter table lesson_events enable row level security;
revoke all on lesson_events from anon, authenticated;
grant all on lesson_events to service_role;
alter table coach_statements enable row level security;
revoke all on coach_statements from anon, authenticated;
grant all on coach_statements to service_role;
alter table coach_statement_lines enable row level security;
revoke all on coach_statement_lines from anon, authenticated;
grant all on coach_statement_lines to service_role;
alter table coach_photo_purges enable row level security;
revoke all on coach_photo_purges from anon, authenticated;
grant all on coach_photo_purges to service_role;

-- ===========================================================================
-- 22. Storage: menu-media/coaches/ (C-7, R43)
-- ===========================================================================
-- menu_media_staff_insert re-created from its latest body (0234:452-454) with
-- 'coaches' appended to the folder list, keeping the 0234 InitPlan form.
-- Managers and the owner upload a coach's photo to coaches/<fresh uuid>/ (never
-- a profile or coach id, R43); the read, update and delete policies already
-- cover the bucket (0234:448-459). A DO block that degrades to a NOTICE where
-- the migration role may not touch storage.objects (the 0062 shape): check
-- storage.objects after a hosted push (packages/db/CLAUDE.md).
do $menu_media_coaches_0278$
begin
  begin
    drop policy if exists menu_media_staff_insert on storage.objects;
    create policy menu_media_staff_insert on storage.objects as permissive for insert to authenticated
      with check (((bucket_id = 'menu-media'::text)
                   AND ( SELECT app.is_staff(VARIADIC ARRAY['manager'::staff_role, 'owner'::staff_role]) AS is_staff)
                   AND ((storage.foldername(name))[1] = ANY (ARRAY['items'::text, 'categories'::text, 'hero'::text,
                                                                   'courts'::text, 'coaches'::text]))));
  exception when insufficient_privilege then
    raise notice 'cannot recreate menu_media_staff_insert as % - add the coaches folder via Dashboard > Storage > Policies',
      current_user;
  end;
end $menu_media_coaches_0278$;

-- ===========================================================================
-- 23. The coach mutex (R6; created here because Money's 0281 calls it)
-- ===========================================================================
-- Hashed as 0042 hashes the court key. Ranked coach_advisory, after
-- match_money_advisory and before tabs (scripts/lib/lock-order.mjs), taken at
-- most once per sequence: no path takes two coaches' keys, and a lesson's
-- coach never changes. Every change to lessons, courses, lesson_enrolments,
-- lesson_attendance and coach_statements happens under it.
create or replace function app.lock_coach(p_coach_id uuid) returns void
language plpgsql security definer set search_path = public as $lock_coach_0278$
begin
  if p_coach_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('app.coaches:' || p_coach_id::text, 0));
  end if;
end $lock_coach_0278$;

comment on function app.lock_coach(uuid) is
  '0278. Internal (R6). The coach mutex: pg_advisory_xact_lock on ''app.coaches:''||coach (0042 hashing). Ranked after match_money_advisory and before tabs (coach_advisory in scripts/lib/lock-order.mjs), once per sequence. Every booking, cancel, mark, reschedule, settle and statement write of a coach''s lessons takes it first; a court key is only ever taken after it.';

revoke all on function app.lock_coach(uuid) from public, anon, authenticated;

-- Never waits (the sweep's later coaches, db.md §2.3 level S).
create or replace function app.try_lock_coach(p_coach_id uuid) returns boolean
language plpgsql security definer set search_path = public as $try_lock_coach_0278$
begin
  if p_coach_id is null then
    return false;
  end if;
  return pg_try_advisory_xact_lock(hashtextextended('app.coaches:' || p_coach_id::text, 0));
end $try_lock_coach_0278$;

comment on function app.try_lock_coach(uuid) is
  '0278. Internal (R6). The coach mutex without waiting (pg_try_advisory_xact_lock on the app.lock_coach key): true holds it until commit, false holds nothing. Only lesson_sweep calls it, for every coach after its first, so the sweep never waits on a second coach (db.md §2.4). Never emitted by the lock gate: it cannot wait.';

revoke all on function app.try_lock_coach(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 24. Comments and the assistant's readable columns
-- ===========================================================================
comment on table coaches is
  '0278. Chain-wide. A guest profile a manager promoted to coach (C-7): the public display names (EN, AR), bio and photo, set only by managers. The profile''s own name and phone are never public. active | paused (hidden from guests, keeps its lessons) | retired. Not listed in any public read until the coach accepts going public (public_accepted_at, C-22). Written only by the coaching definer bodies (0282 onward).';
comment on column coaches.profile_id is
  '0278. The coach''s own guest profile (one coach row per profile); never in a public payload (R43).';
comment on column coaches.display_name_en is
  '0278. The coach''s public name in English, chosen by the venue (1..60). Kept on a deleted coach for the statements the venue paid (C-29).';
comment on column coaches.display_name_ar is
  '0278. The coach''s public name in Arabic, chosen by the venue (1..60). Kept on a deleted coach for the statements the venue paid (C-29).';
comment on column coaches.bio_en is
  '0278. The coach''s public bio in English, written by a manager (0..1000); emptied on deletion.';
comment on column coaches.bio_ar is
  '0278. The coach''s public bio in Arabic, written by a manager (0..1000); emptied on deletion.';
comment on column coaches.photo_path is
  '0278. The coach''s photo in the menu-media bucket, coaches/<random uuid>/<file> (R43); NULL for none. Queued for removal on retirement or deletion.';
comment on column coaches.status is
  '0278. active | paused (not bookable and hidden from guests, keeps its lessons; coach mode works) | retired (coach mode shows approved and paid statements only).';
comment on column coaches.public_accepted_at is
  '0278. When the coach accepted that their profile is public on the app and the website (C-22, R61); NULL until then, and no public read lists them.';

comment on table coach_branches is
  '0278. The branches a coach teaches at; bookable there while active. Deactivating a branch keeps its lessons.';

comment on table coach_time_off is
  '0278. Chain-wide. A coach''s time off, at every branch: no lesson can be offered or booked inside it. Set by the coach or a manager; cancelled_at ends it. Live periods of one coach never overlap (coach_time_off_no_overlap).';
comment on column coach_time_off.reason is
  '0278. The coach''s note on their time off (0..200), never shown to guests; emptied on the coach''s deletion.';

comment on table coach_hours is
  '0278. A coach''s weekly hours at one branch: one window inside one local day (weekday 0 = Sunday in the branch time zone; end_time may be 24:00), on :00 or :30 (CD-10, D-18). The writers refuse overlapping windows of one coach on one weekday at any branch (HOURS_OVERLAP).';

comment on table lesson_types is
  '0278. What a branch sells as lessons: private (party 1..4, one price for the lesson), group (one price per place) or course (one price for the whole run of sessions_count sessions). The venue sets prices (C-5); a launched type''s price changes only through the owner''s price-or-promotion protocol (C-17). court_share_iqd is the fixed court share per session (C-6). min_places and cutoff_hours decide an under-filled cancel (C-14, R26).';
comment on column lesson_types.price_iqd is
  '0278. Private: the whole lesson; group: one place; course: the whole course for one person. NULL only on a draft (never launched).';
comment on column lesson_types.court_share_iqd is
  '0278. The fixed court share per session taken off collected money before the coach''s share (C-6).';
comment on column lesson_types.launched_at is
  '0278. When the type was first offered for sale (through the protocol for a manager); NULL on a draft, whose fields are edited directly.';

comment on table coach_lesson_types is
  '0278. Which lesson types a coach teaches at the type''s branch.';

comment on table coach_prices is
  '0278. A per-coach price for one lesson type (C-5), overriding the type''s price. Written only by set_coach_price_internal: by the owner directly or through the price-or-promotion protocol (protocol_run_id).';

comment on table courses is
  '0278. A fixed run of sessions (its lessons, session_no 1..sessions_count), one sign-up, one price per person (C-1). Snapshots of the type''s price, court share and places and of the branch''s coach_share_bp at creation. open | running (session 1 started) | completed | cancelled. Sign-up closes when the last session starts (signup_closes_at, C-15).';
comment on column courses.cutoff_at is
  '0278. Session 1''s start less the type''s cutoff_hours: below min_places at this time the course is cancelled under_filled (C-14).';
comment on column courses.cutoff_checked_at is
  '0278. When the sweep judged the cut-off; a judged course is never judged again (R26).';
comment on column courses.title_en is
  '0278. A course title a coach or the desk wrote (0..80).';
comment on column courses.title_ar is
  '0278. A course title a coach or the desk wrote, in Arabic (0..80).';

comment on table lessons is
  '0278. One lesson session on one court: a private lesson, a group session, or one session of a course. Snapshots of the price (NULL for a course session), court share, places and coach_share_bp at creation. held (a private lesson awaiting its Qi payment) | scheduled | completed | cancelled | expired. Its court row is a reservations row of kind lesson (or hold while held) naming it. One coach has at most one live lesson at a time at every branch (lessons_coach_no_overlap).';
comment on column lessons.cutoff_at is
  '0278. Group: start less cutoff_hours; course session: its course''s cut-off; private: NULL.';
comment on column lessons.cutoff_checked_at is
  '0278. When the sweep judged a group session''s cut-off (R26); cleared by a reschedule whose new cut-off is still ahead (R32).';
comment on column lessons.rescheduled_at is
  '0278. When the lesson last moved in time (R8, R32); a guest who booked before it may cancel free until the new start.';
comment on column lessons.coach_share_bp is
  '0278. The branch''s coach_share_bp when the lesson was created (CD-5).';

comment on table lesson_enrolments is
  '0278. A place in a lesson (private or group session) or in a course. Booked by the guest, by the coach for their own student (C-8) or at the desk. A coach- or desk-typed name and phone are kept as typed and shown to staff and the coach (R44); a typed phone links an account only on a verified match, pending until that person confirms (link_confirmed_at, C-21). held (awaiting Qi) | booked | cancelled | expired.';
comment on column lesson_enrolments.guest_name is
  '0278. The student a coach or the desk named (1..80); NULL on a guest''s own booking. Replaced by a fixed marker 365 days after the lesson (CD-8).';
comment on column lesson_enrolments.guest_phone is
  '0278. A student''s number typed by a coach or the desk; shown to the coach until 7 days after the session (CD-3, R54); purged after 365 days (CD-8).';
comment on column lesson_enrolments.friend_names is
  '0278. The friends a guest brings to a private lesson (at most 3, party_size - 1).';
comment on column lesson_enrolments.price_iqd is
  '0278. What this place owes: the private lesson, one group place, the whole course, or the pro-rata share of a late course join (C-15).';
comment on column lesson_enrolments.link_confirmed_at is
  '0278. When the account a typed phone matched confirmed "this is me" (C-21, R44). NULL with guest_id set = a pending link; set at insert for a guest''s own booking and for a customer the desk picked.';
comment on column lesson_enrolments.refunded_outside_iqd is
  '0278. Money handed back outside the till when Qi could not take a second refund on the payment (R75, lesson_blocked_refund_record); counted as refunded, never a payments or refunds row.';

comment on table lesson_attendance is
  '0278. A mark per session and enrolment, open from the start to 24 hours after it (CD-11): attended or no_show. Clearing deletes the row.';

comment on table lesson_strikes is
  '0278. The lesson strike ledger: a late cancel, a no-show or a lapsed online hold of an enrolment the guest booked themselves (CD-2, R30). Never applied inside a coach or court lock: hold_strikes_settle applies it to the hold ladder under the principal lock (§1.4).';

comment on table lesson_events is
  '0278. Append-only: every move of a lesson, course or enrolment, who made it (guest, coach, staff or system) and a short code. data carries ids, times, counts, codes and flags only, never a name or a phone. The push fan-out reads it (0283).';

comment on table coach_statements is
  '0278. A coach''s monthly statement at one branch (C-12): 60 % (coach_share_bp) of the collected lesson money less the court share, drafted monthly, approved by the branch manager, marked paid with a reference. draft | approved | paid | void. Money about a named person: never readable by the owner assistant or any LLM (C-28). Written only by Money''s statement functions (0287).';
comment on column coach_statements.paid_reference is
  '0278. The receipt or transfer number of the coach payment (1..80); never a card or account number (R49, R74).';

comment on table coach_statement_lines is
  '0278. One line per lesson per statement (R24); is_adjustment marks a lesson that already has lines on an approved or paid statement. Frozen once its statement is approved, paid or void (R22). Never readable by the owner assistant or any LLM (C-28).';

comment on table coach_photo_purges is
  '0278. Chain-wide. Coach photo folders queued for removal from menu-media on retirement or deletion (R43); a service path removes coaches/<folder>/* within a day and stamps purged_at.';

comment on column reservations.lesson_id is
  '0278. The lesson a court row is for: kind lesson, or a hold while a private lesson''s online payment is open. Such a row has guest_id NULL, guest_name ''Lesson'' and no price; it is changed only through the coaching RPCs.';

-- The owner's assistant may read the catalogue-like coaching tables by
-- table_read (0109), without the profile link, the bios, the photo or the
-- consent stamp. Enrolments, attendance, strikes, events and time off (student
-- identity, a coach's reasons) and the statements (a coach's pay, C-28) get
-- no row at all. The 0207 statement, limited to these columns (ON CONFLICT DO
-- NOTHING adds only what is new).
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name,
       c.column_name,
       'table',
       c.data_type <> 'jsonb',
       c.data_type,
       c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name in ('coaches', 'coach_branches', 'coach_hours', 'lesson_types', 'coach_lesson_types',
                        'coach_prices', 'courses', 'lessons')
   and c.column_name not in ('profile_id', 'created_by_profile_id', 'bio_en', 'bio_ar', 'photo_path',
                             'public_accepted_at')
on conflict (table_name, column_name) do nothing;
