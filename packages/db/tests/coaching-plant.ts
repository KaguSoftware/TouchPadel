/**
 * The coaching planting helpers (one module for the suites that plant rows as postgres).
 *
 * - `PLANT_BRANCH`: 0277 / 0278 (coaching-guards, coaching-desk-money), on a branch of its own
 *   (matches-harness SETUP). Its pg_temp functions are keyed by kept names (pg_temp.vars).
 * - `PLANT`: 0283–0286 (coaching-sweep, -statements, -reports, -deletion), on venue A, with ids
 *   returned as text.
 *
 * The two sets define pg_temp functions of the same names with different signatures, so a
 * scenario loads one of them, never both.
 */
/*
 * PLANT (0283–0286):
 * The planting helpers of the coaching sweep, statement, report and deletion suites
 * (coaching-sweep, coaching-statements, coaching-reports, coaching-deletion .test.ts; migrations
 * 0283–0286). Every case is one rolled-back psql transaction (stores-harness `scenario`): rows are
 * planted as postgres with the JWT claims cleared (0230: a fixture write, not a staff write), and
 * staff, coach and guest calls run as `authenticated` with the caller's claims (`T`).
 *
 * `now()` is the transaction's start for the whole scenario, so every time below is relative to it.
 * Months are branch-local (CM-16): `pg_temp.mon(-1)` is the first of last month in venue A's time
 * zone, `pg_temp.at(-1, 10, 18)` is 18:00 local on the 10th of last month.
 *
 * Money is planted as online payments (one `booking_payments` row per enrolment): the engine
 * (0278's `lesson_enrolment_money`) treats desk and online money alike for what the venue keeps,
 * and an online row needs no day, till or tab. The report suite plants desk money where a figure
 * is desk-only.
 *
 * May merge into the build's `coaching-harness.ts` (db.md §7) once that file exists.
 */
import { SEED_STAFF_IDS, VENUE_A_ID } from './helpers';
import { KEEP } from './stores-harness';

export const PLANT = String.raw`
-- Run one statement as postgres (claims cleared) and record its jsonb answer or its refusal.
create function pg_temp.e(p_label text, p_sql text) returns void language plpgsql as $f$
declare v_res jsonb; v_msg text; v_detail text; v_hint text;
begin
  perform set_config('request.jwt.claims', '', true);
  begin
    execute pg_temp.sub(p_sql) into v_res;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v_res));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'detail', nullif(v_detail, ''),
                                        'hint', nullif(v_hint, '')));
  end;
end $f$;

create function pg_temp.ins(p_table text, p_row jsonb) returns text language plpgsql as $f$
declare v_cols text; v_out text;
begin
  perform set_config('request.jwt.claims', '', true);
  select string_agg(quote_ident(k), ', ') into v_cols from jsonb_object_keys(p_row) k;
  execute format('insert into public.%I as x (%s) select %s from jsonb_populate_record(null::public.%I, $1) '
                 'returning to_jsonb(x) ->> ''id''', p_table, v_cols, v_cols, p_table)
    into v_out using p_row;
  return v_out;
end $f$;

-- A guest account: an auth user, whose profile 0004's handle_new_user creates.
create function pg_temp.guest(p_name text) returns text language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'cf283-' || p_name || '-' || v || '@test.touch.local',
          jsonb_build_object('full_name', 'Test ' || p_name), 'authenticated', 'authenticated');
  return v::text;
end $f$;

create function pg_temp.tz() returns text language sql as $f$
  select coalesce((select v.timezone from venues v where v.id = '${VENUE_A_ID}'), 'Asia/Baghdad')
$f$;
-- The first of a branch-local month, p_months from this one.
create function pg_temp.mon(p_months int) returns date language sql as $f$
  select (date_trunc('month', (now() at time zone pg_temp.tz())::date) + make_interval(months => p_months))::date
$f$;
-- p_hour:00 local on day p_day of that month.
create function pg_temp.at(p_months int, p_day int, p_hour int) returns timestamptz language sql as $f$
  select ((pg_temp.mon(p_months) + (p_day - 1))::timestamp + make_interval(hours => p_hour)) at time zone pg_temp.tz()
$f$;

create function pg_temp.coach(p_profile text, p jsonb default '{}') returns text language plpgsql as $f$
declare v text;
begin
  v := pg_temp.ins('coaches', jsonb_build_object('profile_id', p_profile,
         'display_name_en', 'Coach ' || left(p_profile, 6), 'display_name_ar', 'المدرّب ' || left(p_profile, 6),
         'public_accepted_at', now()) || p);
  perform pg_temp.ins('coach_branches', jsonb_build_object('coach_id', v, 'venue_id', '${VENUE_A_ID}'));
  return v;
end $f$;

create function pg_temp.ltype(p jsonb default '{}') returns text language sql as $f$
  select pg_temp.ins('lesson_types', jsonb_build_object('venue_id', '${VENUE_A_ID}', 'kind', 'private',
           'name_en', 'Private', 'name_ar', 'حصة خاصة', 'duration_min', 60, 'price_iqd', 40000,
           'court_share_iqd', 10000, 'max_places', 4, 'min_places', 1, 'cutoff_hours', 0,
           'launched_at', now(), 'is_active', true) || p)
$f$;

-- A lesson (a private lesson unless p says otherwise), booked at the desk.
create function pg_temp.lesson(p jsonb) returns text language sql as $f$
  select pg_temp.ins('lessons', jsonb_build_object('venue_id', '${VENUE_A_ID}', 'kind', 'private',
           'price_iqd', 40000, 'court_share_iqd', 10000, 'coach_share_bp', 6000, 'max_places', 4,
           'min_places', 1, 'booked_by_kind', 'staff', 'created_by_staff_id', '${SEED_STAFF_IDS.court_desk}') || p)
$f$;

-- A lesson's live court row (kind lesson), as lesson_create_internal writes it (db.md §3.4).
create function pg_temp.courtrow(p_lesson text, p_court text, p_status text default 'confirmed')
returns text language sql as $f$
  select pg_temp.ins('reservations', jsonb_build_object('venue_id', l.venue_id, 'court_id', p_court,
           'kind', 'lesson', 'status', p_status, 'start_at', l.start_at, 'end_at', l.end_at,
           'source', 'desk', 'guest_name', 'Lesson', 'lesson_id', l.id))
    from lessons l where l.id = p_lesson::uuid
$f$;

-- An enrolment a guest booked and paid online (the R30 shape: guest-booked, linked).
create function pg_temp.genrol(p_guest text, p jsonb) returns text language sql as $f$
  select pg_temp.ins('lesson_enrolments', jsonb_build_object('venue_id', '${VENUE_A_ID}',
           'guest_id', p_guest, 'booked_by_kind', 'guest', 'booked_by_profile_id', p_guest,
           'link_confirmed_at', now(), 'price_iqd', 40000, 'payment_mode', 'online', 'status', 'booked') || p)
$f$;

-- An enrolment a coach booked for a typed student (desk payment, C-8).
create function pg_temp.cenrol(p_coach_profile text, p jsonb) returns text language sql as $f$
  select pg_temp.ins('lesson_enrolments', jsonb_build_object('venue_id', '${VENUE_A_ID}',
           'guest_name', 'Typed Student', 'guest_phone', '07700000001', 'booked_by_kind', 'coach',
           'booked_by_profile_id', p_coach_profile, 'price_iqd', 40000, 'payment_mode', 'desk',
           'status', 'booked') || p)
$f$;

-- One succeeded Qi payment for the whole of an enrolment's price (or p_amount).
create function pg_temp.paid(p_enrolment text, p_amount bigint default null, p jsonb default '{}')
returns text language sql as $f$
  select pg_temp.ins('booking_payments', jsonb_build_object(
           'purpose', 'lesson', 'provider', 'fake', 'sandbox', false, 'request_id', gen_random_uuid(),
           'amount_iqd', coalesce(p_amount, e.price_iqd), 'quoted_price_iqd', coalesce(p_amount, e.price_iqd),
           'status', 'succeeded', 'locale', 'en', 'deadline_at', now() - interval '60 days',
           'succeeded_at', now() - interval '60 days', 'guest_id', e.guest_id,
           'venue_id', e.venue_id, 'lesson_enrolment_id', e.id) || p)
    from lesson_enrolments e where e.id = p_enrolment::uuid
$f$;

-- A refund of p_amount on a lesson payment, done (a manager's goodwill refund once final, CM-5).
create function pg_temp.refunded(p_payment text, p_amount bigint, p_at timestamptz default null)
returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  update booking_payments
     set status = 'refunded', refund_amount_iqd = p_amount, refund_reason = 'staff_refund',
         refund_requested_at = coalesce(p_at, now()), refunded_at = coalesce(p_at, now())
   where id = p_payment::uuid;
end $f$;

create function pg_temp.mark(p_lesson text, p_enrolment text, p_status text) returns void language plpgsql as $f$
begin
  perform pg_temp.ins('lesson_attendance', jsonb_build_object('lesson_id', p_lesson, 'enrolment_id', p_enrolment,
           'venue_id', '${VENUE_A_ID}', 'status', p_status, 'marked_by_kind', 'staff',
           'marked_by_staff_id', '${SEED_STAFF_IDS.court_desk}'));
end $f$;

create function pg_temp.grant_pin(p_caller text) returns void language plpgsql as $f$
begin
  insert into app.pin_grants (caller_id, authorizer_id) values (p_caller::uuid, '${SEED_STAFF_IDS.manager}');
end $f$;
`;

/** A court of venue A for the court rows. */
export const COURT = (name: string) =>
  KEEP(
    name,
    `insert into courts (name_en, name_ar, venue_id)
              values ('CF283 ${name}', 'ملعب ${name}', '${VENUE_A_ID}') returning id`,
  );

/** As postgres: the statement's jsonb answer, or its refusal (code, detail, hint). */
export const E = (label: string, sql: string) => `select pg_temp.e('${label}', $q$${sql}$q$);`;

/** A guest account kept under `name` (its profile id; T() can act as it). */
export const GUEST = (name: string) => KEEP(name, `select pg_temp.guest('${name}')`);

/*
 * PLANT_BRANCH (0277 / 0278):
 * Planting helpers for the 0277 / 0278 coaching suites (coaching-guards.test.ts,
 * coaching-desk-money.test.ts). No coaching RPC can create a lesson before
 * lesson_booking (0280), so these suites plant coaches, lesson types, lessons
 * (with their court rows), courses, enrolments and online payments as postgres
 * inside one rolled-back transaction (the stores-harness scenario), on a branch
 * of its own (matches-harness SETUP: pg_temp.branch(), two courts c1 and c2,
 * open all day, guests who may play). Load order in a scenario body:
 *
 *   [SETUP (matches-harness), PLANT, 'select pg_temp.branch();', 'select pg_temp.staff();',
 *    'select pg_temp.coaching();', ...]
 *
 * pg_temp.staff() files the seeded desk, cashier and manager at the branch too
 * and names it in app.venue_id for the whole transaction (the station of a
 * branch till would). Every fixture write runs with request.jwt.claims cleared
 * (pg_temp.x / pg_temp.keep), so zz_branch_guard (0230) treats it as a fixture.
 *
 * app.lesson_event is DB's (0280). When the suite runs on a stack that stops
 * at 0278, PLANT defines a stand-in with the contracted signature (build
 * contracts db.md §10.1: (uuid, uuid, uuid, uuid, text, text, uuid default
 * null, uuid default null, text default null, jsonb default '{}') returns
 * bigint, one insert) inside the transaction, rolled back with it; on a full
 * stack the real one is used.
 */

export const PLANT_BRANCH = String.raw`
do $c278_event_stub$
begin
  if to_regprocedure('app.lesson_event(uuid, uuid, uuid, uuid, text, text, uuid, uuid, text, jsonb)') is null then
    execute $stub$
      create function app.lesson_event(p_venue_id uuid, p_lesson_id uuid, p_course_id uuid, p_enrolment_id uuid,
                                       p_type text, p_actor text, p_actor_profile_id uuid default null,
                                       p_actor_staff_id uuid default null, p_code text default null,
                                       p_data jsonb default '{}') returns bigint
      language sql security definer set search_path = public as $body$
        insert into lesson_events (venue_id, lesson_id, course_id, enrolment_id, type, actor, actor_profile_id,
                                   actor_staff_id, code, data)
        values (p_venue_id, p_lesson_id, p_course_id, p_enrolment_id, p_type, p_actor, p_actor_profile_id,
                p_actor_staff_id, p_code, coalesce(p_data, '{}'::jsonb))
        returning id
      $body$
    $stub$;
  end if;
end $c278_event_stub$;

-- The seeded desk, cashier and manager work at the branch too (the owner works
-- everywhere); app.venue_id names it for the whole transaction.
create function pg_temp.staff() returns void language plpgsql as $f$
begin
  insert into staff_venues (staff_id, venue_id, role)
  select s.id, pg_temp.var('v')::uuid, s.role
    from staff s
   where s.id in (pg_temp.var('desk')::uuid, pg_temp.var('cashier')::uuid, pg_temp.var('manager')::uuid)
  on conflict do nothing;
  perform set_config('app.venue_id', pg_temp.var('v'), true);
end $f$;

-- An open day of the branch, p_back days before today's business date, kept as p_name.
create function pg_temp.day(p_name text, p_back int default 0, p_float bigint default 0) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd)
  values (pg_temp.var('v')::uuid, app.venue_business_date(pg_temp.var('v')::uuid, now()) - p_back, 'open',
          pg_temp.var('manager')::uuid, p_float)
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text);
  return v;
end $f$;

-- A coach: the guest kept as p_guest promoted, accepted, teaching at the branch.
create function pg_temp.coach(p_name text, p_guest text) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into coaches (profile_id, display_name_en, display_name_ar, public_accepted_at)
  values (pg_temp.var(p_guest)::uuid, 'C278 ' || p_name, 'مدرّب ' || p_name, now())
  returning id into v;
  insert into coach_branches (coach_id, venue_id) values (v, pg_temp.var('v')::uuid);
  insert into pg_temp.vars values (p_name, v::text);
  return v;
end $f$;

-- A launched lesson type of the branch (60 minutes; private: up to 4, group and
-- course: 2..8 with a 2-hour cut-off; a course of p_sessions).
create function pg_temp.ltype(p_name text, p_kind text, p_price bigint, p_share bigint, p_sessions int default null)
returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into lesson_types (venue_id, kind, name_en, name_ar, duration_min, price_iqd, court_share_iqd,
                            max_places, min_places, cutoff_hours, sessions_count, is_active, launched_at)
  values (pg_temp.var('v')::uuid, p_kind, 'C278 ' || p_name, 'حصة ' || p_name, 60, p_price, p_share,
          case when p_kind = 'private' then 4 else 8 end, case when p_kind = 'private' then 1 else 2 end,
          case when p_kind = 'private' then 0 else 2 end,
          case when p_kind = 'course' then coalesce(p_sessions, 4) end, true, now())
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text);
  return v;
end $f$;

-- The coach 'coach' (profile gc) and three types: lt_private 40,000 (court share
-- 10,000), lt_group 15,000 a place (10,000), lt_course 100,001 for 4 sessions
-- (8,000), the money.md §10 figures.
create function pg_temp.coaching() returns void language plpgsql as $f$
begin
  perform pg_temp.guest('gc');
  perform pg_temp.coach('coach', 'gc');
  perform pg_temp.ltype('lt_private', 'private', 40000, 10000);
  perform pg_temp.ltype('lt_group', 'group', 15000, 10000);
  perform pg_temp.ltype('lt_course', 'course', 100001, 8000, 4);
end $f$;

-- One lesson of the type kept as p_type on court p_court at p_start, with its
-- court row (kind lesson, or a hold while held), kept as p_name and
-- p_name || '_res'. p: status (scheduled | held | completed | cancelled), dur
-- (60), price_iqd (the type's), cancel_reason (staff_cancel), coach (coach).
create function pg_temp.lesson(p_name text, p_type text, p_court text, p_start timestamptz, p jsonb default '{}')
returns uuid language plpgsql as $f$
declare
  v_status text := coalesce(p->>'status', 'scheduled');
  v_dur    int  := coalesce((p->>'dur')::int, 60);
  v_l uuid;
  v_r uuid;
begin
  insert into lessons (venue_id, coach_id, lesson_type_id, kind, start_at, end_at, price_iqd, court_share_iqd,
                       coach_share_bp, max_places, min_places, cutoff_at, status, hold_expires_at,
                       booked_by_kind, created_by_staff_id, cancel_reason, cancelled_at, completed_at)
  select pg_temp.var('v')::uuid, pg_temp.var(coalesce(p->>'coach', 'coach'))::uuid, lt.id, lt.kind, p_start,
         p_start + make_interval(mins => v_dur), coalesce((p->>'price_iqd')::bigint, lt.price_iqd),
         lt.court_share_iqd, 6000, lt.max_places, lt.min_places,
         case when lt.kind = 'private' then null else p_start - interval '2 hours' end,
         v_status, case when v_status = 'held' then now() + interval '10 minutes' end,
         'staff', pg_temp.var('desk')::uuid,
         case when v_status = 'cancelled' then coalesce(p->>'cancel_reason', 'staff_cancel') end,
         case when v_status = 'cancelled' then now() end,
         case when v_status = 'completed' then now() end
    from lesson_types lt
   where lt.id = pg_temp.var(p_type)::uuid
  returning id into v_l;
  insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_name, source, lesson_id,
                            hold_expires_at, created_by_staff_id, cancelled_at, cancellation_reason, cancelled_by)
  values (pg_temp.var('v')::uuid, pg_temp.var(p_court)::uuid,
          (case when v_status = 'held' then 'hold' else 'lesson' end)::reservation_kind,
          (case v_status when 'held' then 'pending' when 'scheduled' then 'confirmed'
                         when 'completed' then 'completed' else 'cancelled' end)::reservation_status,
          p_start, p_start + make_interval(mins => v_dur), 'Lesson', 'desk', v_l,
          case when v_status = 'held' then now() + interval '10 minutes' end, pg_temp.var('desk')::uuid,
          case when v_status in ('completed', 'cancelled') then now() end,
          case when v_status = 'cancelled' then coalesce(p->>'cancel_reason', 'staff_cancel') end,
          case when v_status = 'cancelled' then 'staff' end::cancellation_actor)
  returning id into v_r;
  insert into pg_temp.vars values (p_name, v_l::text), (p_name || '_res', v_r::text);
  return v_l;
end $f$;

-- A course of the type kept as p_type, its sessions (60 minutes on court c1)
-- starting at p_starts, kept as p_name and p_name || '_s' || i (courts rows
-- p_name || '_s' || i || '_res'). p: price_iqd (100,001), court_share_iqd
-- (8,000), status (open).
create function pg_temp.course(p_name text, p_type text, p_starts timestamptz[], p jsonb default '{}')
returns uuid language plpgsql as $f$
declare
  v_n int := cardinality(p_starts);
  v_c uuid;
  v_l uuid;
  v_r uuid;
  i   int;
begin
  insert into courses (venue_id, coach_id, lesson_type_id, price_iqd, court_share_iqd, coach_share_bp,
                       sessions_count, max_places, min_places, cutoff_at, signup_closes_at, status,
                       created_by_kind, created_by_staff_id)
  values (pg_temp.var('v')::uuid, pg_temp.var('coach')::uuid, pg_temp.var(p_type)::uuid,
          coalesce((p->>'price_iqd')::bigint, 100001), coalesce((p->>'court_share_iqd')::bigint, 8000), 6000,
          v_n, 8, 2, p_starts[1] - interval '2 hours', p_starts[v_n], coalesce(p->>'status', 'open'),
          'staff', pg_temp.var('desk')::uuid)
  returning id into v_c;
  insert into pg_temp.vars values (p_name, v_c::text);
  for i in 1 .. v_n loop
    insert into lessons (venue_id, coach_id, lesson_type_id, kind, course_id, session_no, start_at, end_at,
                         price_iqd, court_share_iqd, coach_share_bp, max_places, min_places, cutoff_at, status,
                         booked_by_kind, created_by_staff_id)
    values (pg_temp.var('v')::uuid, pg_temp.var('coach')::uuid, pg_temp.var(p_type)::uuid, 'course', v_c, i,
            p_starts[i], p_starts[i] + interval '60 minutes', null,
            coalesce((p->>'court_share_iqd')::bigint, 8000), 6000, 8, 2, p_starts[1] - interval '2 hours',
            'scheduled', 'staff', pg_temp.var('desk')::uuid)
    returning id into v_l;
    insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_name, source, lesson_id,
                              created_by_staff_id)
    values (pg_temp.var('v')::uuid, pg_temp.var('c1')::uuid, 'lesson', 'confirmed', p_starts[i],
            p_starts[i] + interval '60 minutes', 'Lesson', 'desk', v_l, pg_temp.var('desk')::uuid)
    returning id into v_r;
    insert into pg_temp.vars values (p_name || '_s' || i, v_l::text), (p_name || '_s' || i || '_res', v_r::text);
  end loop;
  return v_c;
end $f$;

-- An enrolment of the lesson or course kept as p_of, kept as p_name. p: guest
-- (a kept guest: their own booking, linked) else typed by the desk (name,
-- phone); mode (desk | online); status (booked | held | cancelled | expired);
-- cancel_kind; cancelled_at; price_iqd (the lesson's, or the course's from
-- session first: course_late_join_price); first (1); covered (to the last session).
create function pg_temp.enrol(p_name text, p_of text, p jsonb default '{}') returns uuid language plpgsql as $f$
declare
  v_of     uuid := pg_temp.var(p_of)::uuid;
  v_course courses%rowtype;
  v_lesson lessons%rowtype;
  v_guest  uuid := case when p ? 'guest' then pg_temp.var(p->>'guest')::uuid end;
  v_status text := coalesce(p->>'status', 'booked');
  v_first  int;
  v_cov    int;
  v_price  bigint;
  v        uuid;
begin
  select * into v_course from courses where id = v_of;
  if v_course.id is null then
    select * into v_lesson from lessons where id = v_of;
    v_price := coalesce((p->>'price_iqd')::bigint, v_lesson.price_iqd);
  else
    v_first := coalesce((p->>'first')::int, 1);
    v_cov := coalesce((p->>'covered')::int, v_course.sessions_count - v_first + 1);
    v_price := coalesce((p->>'price_iqd')::bigint,
                        app.course_late_join_price(v_course.price_iqd, v_course.sessions_count, v_first));
  end if;
  insert into lesson_enrolments (venue_id, lesson_id, course_id, guest_id, guest_name, guest_phone, party_size,
                                 booked_by_kind, booked_by_profile_id, booked_by_staff_id, price_iqd,
                                 first_session_no, sessions_covered, payment_mode, status, hold_expires_at,
                                 cancel_kind, cancelled_at, link_confirmed_at)
  values (pg_temp.var('v')::uuid, v_lesson.id, v_course.id, v_guest,
          case when v_guest is null then coalesce(p->>'name', 'Walk-in ' || p_name) end,
          case when v_guest is null then p->>'phone' end,
          coalesce((p->>'party')::int, 1),
          case when v_guest is null then 'staff' else 'guest' end,
          v_guest, case when v_guest is null then pg_temp.var('desk')::uuid end, v_price,
          v_first, v_cov, coalesce(p->>'mode', 'desk'), v_status,
          case when v_status = 'held' then now() + interval '10 minutes' end,
          case when v_status in ('cancelled', 'expired')
               then coalesce(p->>'cancel_kind', case when v_status = 'expired' then 'expired' else 'staff' end) end,
          case when v_status in ('cancelled', 'expired') then coalesce((p->>'cancelled_at')::timestamptz, now()) end,
          case when v_guest is not null then now() end)
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text);
  return v;
end $f$;

-- A Qi payment of the enrolment kept as p_enrol (purpose lesson), kept as
-- p_name. p: status (succeeded), sandbox (false), hold (a kept court hold).
create function pg_temp.online(p_name text, p_enrol text, p_amount bigint, p jsonb default '{}') returns uuid
language plpgsql as $f$
declare
  v_e    lesson_enrolments%rowtype;
  v_stat text := coalesce(p->>'status', 'succeeded');
  v      uuid;
begin
  select * into v_e from lesson_enrolments where id = pg_temp.var(p_enrol)::uuid;
  insert into booking_payments (venue_id, guest_id, purpose, provider, sandbox, request_id, amount_iqd,
                                quoted_price_iqd, status, succeeded_at, deadline_at, lesson_enrolment_id, hold_id)
  values (v_e.venue_id, v_e.guest_id, 'lesson', 'fake', coalesce((p->>'sandbox')::boolean, false),
          gen_random_uuid(), p_amount, p_amount, v_stat,
          case when v_stat = 'succeeded' then now() end, now() + interval '15 minutes', v_e.id,
          case when p ? 'hold' then pg_temp.var(p->>'hold')::uuid end)
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text);
  return v;
end $f$;

-- What DB's cancel internals (0280) leave behind, without them: the lesson
-- cancelled with p_reason and its court row out of the live set (a hold
-- expired, a lesson row cancelled); an enrolment cancelled as p_kind at p_at.
create function pg_temp.cancel_lesson(p_lesson text, p_reason text) returns void language plpgsql as $f$
begin
  update lessons
     set status = 'cancelled', cancel_reason = p_reason, cancelled_at = now(), hold_expires_at = null
   where id = pg_temp.var(p_lesson)::uuid;
  update reservations
     set status = case when kind = 'hold' then 'expired'::reservation_status else 'cancelled'::reservation_status end,
         cancelled_at = now(), cancellation_reason = p_reason, cancelled_by = 'staff'
   where lesson_id = pg_temp.var(p_lesson)::uuid and status in ('pending', 'confirmed', 'arrived');
end $f$;

create function pg_temp.cancel_enrol(p_enrol text, p_kind text, p_at timestamptz default null) returns void
language sql as $f$
  update lesson_enrolments
     set status = 'cancelled', cancel_kind = p_kind, cancelled_at = coalesce(p_at, now()), hold_expires_at = null
   where id = pg_temp.var(p_enrol)::uuid
$f$;

create function pg_temp.mark(p_lesson text, p_enrol text, p_status text) returns void language sql as $f$
  insert into lesson_attendance (lesson_id, enrolment_id, venue_id, status, marked_by_kind, marked_by_staff_id)
  values (pg_temp.var(p_lesson)::uuid, pg_temp.var(p_enrol)::uuid, pg_temp.var('v')::uuid, p_status, 'staff',
          pg_temp.var('desk')::uuid)
$f$;

-- The engine's answer for a kept enrolment.
create function pg_temp.money(p_enrol text) returns jsonb language sql as $f$
  select app.lesson_enrolment_money(pg_temp.var(p_enrol)::uuid)
$f$;
`;

/** The seeded manager PIN (supabase/seed.sql, DEV_PINS.manager). */
export const MANAGER_PIN = '380517';

/** A start `days` days and `hours` hours past the current hour (SQL). */
export const at = (days: number, hours = 0) =>
  `(date_trunc('hour', now()) + interval '${days} days ${hours} hours')`;

/** A start `hours` hours before the current hour (SQL; started). */
export const ago = (hours: number) => `(date_trunc('hour', now()) - interval '${hours} hours')`;
