/**
 * The shared harness of the 0280 read and push suites (coaching-reads.test.ts,
 * lesson-push.test.ts): on top of the 0261 match harness (one rolled-back
 * psql transaction, pg_temp.e running a call as a kept principal, pg_temp.guest
 * making a guest who may play), a coaching branch made inside it:
 *
 *   * pg_temp.cbranch()  an open branch 'v' (Asia/Baghdad, open all day,
 *     coaching on, desk mode, a branch phone), three courts c1..c3, the seeded
 *     court desk, manager and cashier working there, and three launched lesson
 *     types: tp (private, 60 min, up to 4, 30,000), tg (group, 60 min, 2..4
 *     places, 2 h cut-off, 15,000 a place) and tc (course, 4 sessions of 60
 *     min, 2..4 places, 2 h cut-off, 60,000 a person);
 *   * pg_temp.coach(name, p)  a guest profile (with a push token) promoted to
 *     coach at 'v' and teaching the three types, hours 00:00-24:00 every day;
 *     p: status (active | paused | retired), accepted (default true), guest
 *     (pg_temp.guest overrides). Kept as co_<name>; the profile as <name>;
 *   * pg_temp.lt(days, hours)  a branch-local time: midnight `days` days from
 *     today plus `hours` (so pg_temp.lt(2, 10) is 10:00 the day after
 *     tomorrow, on the 30-minute grid);
 *   * pg_temp.plant_lesson / plant_course / plant_enrolment  rows planted as
 *     postgres where no RPC can reach the state (an ended lesson, a held
 *     place, Money's online states), each satisfying every 0275 CHECK.
 *
 * Every fixture write clears request.jwt.claims first (0230: a fixture write
 * is not a staff write).
 */
import { KEEP } from './stores-harness';

export const TZ = 'Asia/Baghdad';
export const BRANCH_PHONE = '+9647800000280';

export const COACH_SETUP = String.raw`
create function pg_temp.lt(p_days int, p_hours numeric) returns timestamptz language sql as $f$
  select (date_trunc('day', now() at time zone '${TZ}') + make_interval(days => p_days)
          + p_hours * interval '1 hour') at time zone '${TZ}'
$f$;

create function pg_temp.cbranch() returns void language plpgsql as $f$
declare v uuid; c uuid; i int; t uuid;
  v_all constant jsonb := '[["00:00","24:00"]]';
begin
  perform set_config('request.jwt.claims', '', true);
  insert into venues (slug, name_en, name_ar, timezone, is_active)
  values ('c280-' || substr(md5(random()::text), 1, 8), 'C280 branch', 'فرع ٢٨٠', '${TZ}', true)
  returning id into v;
  insert into venue_settings (venue_id, venue_name, timezone, phone, opening_hours, coaching_enabled,
                              lesson_payment_mode, cancellation_window_hours)
  values (v, 'C280 branch', '${TZ}', '${BRANCH_PHONE}',
          jsonb_build_object('mon', v_all, 'tue', v_all, 'wed', v_all, 'thu', v_all,
                             'fri', v_all, 'sat', v_all, 'sun', v_all),
          true, 'desk', 12);
  insert into pg_temp.vars values ('v', v::text);
  for i in 1 .. 3 loop
    insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
    values (v, 'C280 court ' || i, 'ملعب ' || i, '{60,90,120}', i, true) returning id into c;
    insert into pg_temp.vars values ('c' || i, c::text);
  end loop;
  insert into staff_venues (staff_id, venue_id, role)
  values (pg_temp.var('desk')::uuid, v, 'court_desk'),
         (pg_temp.var('manager')::uuid, v, 'manager'),
         (pg_temp.var('cashier')::uuid, v, 'cashier');
  insert into lesson_types (venue_id, kind, name_en, name_ar, duration_min, price_iqd, court_share_iqd,
                            max_places, min_places, cutoff_hours, sessions_count, is_active, launched_at,
                            sort_order)
  values (v, 'private', 'C280 private', 'خاصة', 60, 30000, 5000, 4, 1, 0, null, true, now(), 1)
  returning id into t;
  insert into pg_temp.vars values ('tp', t::text);
  insert into lesson_types (venue_id, kind, name_en, name_ar, duration_min, price_iqd, court_share_iqd,
                            max_places, min_places, cutoff_hours, sessions_count, is_active, launched_at,
                            sort_order)
  values (v, 'group', 'C280 group', 'جماعية', 60, 15000, 5000, 4, 2, 2, null, true, now(), 2)
  returning id into t;
  insert into pg_temp.vars values ('tg', t::text);
  insert into lesson_types (venue_id, kind, name_en, name_ar, duration_min, price_iqd, court_share_iqd,
                            max_places, min_places, cutoff_hours, sessions_count, is_active, launched_at,
                            sort_order)
  values (v, 'course', 'C280 course', 'دورة', 60, 60000, 5000, 4, 2, 2, 4, true, now(), 3)
  returning id into t;
  insert into pg_temp.vars values ('tc', t::text);
end $f$;

-- A coach at the branch: a guest profile (push token on) promoted, teaching
-- every type of the branch, available all day every day.
create function pg_temp.coach(p_name text, p jsonb default '{}') returns uuid language plpgsql as $f$
declare
  v_prof uuid;
  v uuid;
  v_status text := coalesce(p->>'status', 'active');
begin
  v_prof := pg_temp.guest(p_name, '{"push":"ExponentPushToken[c280]"}'::jsonb || coalesce(p->'guest', '{}'::jsonb));
  perform set_config('request.jwt.claims', '', true);
  insert into coaches (profile_id, display_name_en, display_name_ar, bio_en, bio_ar, status,
                       public_accepted_at, retired_at, sort_order)
  values (v_prof, 'Coach ' || p_name, 'المدرّب ' || p_name, 'Bio of ' || p_name, 'نبذة', v_status,
          case when coalesce((p->>'accepted')::boolean, true) then now() end,
          case when v_status = 'retired' then now() end,
          coalesce((p->>'sort')::int, 0))
  returning id into v;
  insert into coach_branches (coach_id, venue_id, active) values (v, pg_temp.var('v')::uuid, true);
  insert into coach_hours (coach_id, venue_id, weekday, start_time, end_time, set_by)
  select v, pg_temp.var('v')::uuid, d, '00:00', '24:00', 'coach' from generate_series(0, 6) d;
  insert into coach_lesson_types (coach_id, lesson_type_id, venue_id)
  select v, t.id, t.venue_id from lesson_types t where t.venue_id = pg_temp.var('v')::uuid;
  insert into pg_temp.vars values ('co_' || p_name, v::text);
  return v;
end $f$;

-- A lesson planted with its court row. p: coach (a kept coach id name, e.g.
-- co_ca), kind (private | group), start (timestamptz), minutes (60), court
-- (a kept court name), status (scheduled | held | completed | cancelled),
-- booked_by (guest | coach | staff), by (a kept profile or staff name).
create function pg_temp.plant_lesson(p_name text, p jsonb) returns uuid language plpgsql as $f$
declare
  v_kind   text := coalesce(p->>'kind', 'private');
  v_type   uuid := pg_temp.var(case v_kind when 'group' then 'tg' else 'tp' end)::uuid;
  v_start  timestamptz := (p->>'start')::timestamptz;
  v_end    timestamptz := v_start + make_interval(mins => coalesce((p->>'minutes')::int, 60));
  v_status text := coalesce(p->>'status', 'scheduled');
  v_by     text := coalesce(p->>'booked_by', 'coach');
  v_who    uuid := pg_temp.var(coalesce(p->>'by', 'desk'))::uuid;
  v_coach  uuid := pg_temp.var(p->>'coach')::uuid;
  v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  if v_by <> 'staff' and p->>'by' is null then
    v_who := (select co.profile_id from coaches co where co.id = v_coach);
  end if;
  insert into lessons (venue_id, coach_id, lesson_type_id, kind, start_at, end_at, price_iqd, court_share_iqd,
                       coach_share_bp, max_places, min_places, cutoff_at, status, hold_expires_at,
                       booked_by_kind, created_by_profile_id, created_by_staff_id, cancel_reason, cancelled_at,
                       completed_at)
  values (pg_temp.var('v')::uuid, v_coach, v_type, v_kind, v_start, v_end,
          case v_kind when 'group' then 15000 else 30000 end, 5000, 6000,
          4, case v_kind when 'group' then 2 else 1 end,
          case v_kind when 'group' then v_start - interval '2 hours' end,
          v_status,
          case when v_status = 'held' then now() + interval '10 minutes' end,
          v_by,
          case when v_by <> 'staff' then v_who end,
          case when v_by = 'staff' then v_who end,
          case when v_status = 'cancelled' then 'staff_cancel' end,
          case when v_status = 'cancelled' then now() end,
          case when v_status = 'completed' then v_end end)
  returning id into v;
  insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_name, source, lesson_id,
                            hold_expires_at)
  values (pg_temp.var('v')::uuid, pg_temp.var(coalesce(p->>'court', 'c1'))::uuid,
          (case when v_status = 'held' then 'hold' else 'lesson' end)::reservation_kind,
          (case v_status when 'held' then 'pending' when 'completed' then 'completed'
                         when 'cancelled' then 'cancelled' else 'confirmed' end)::reservation_status,
          v_start, v_end, 'Lesson', 'desk', v,
          case when v_status = 'held' then now() + interval '10 minutes' end);
  insert into pg_temp.vars values (p_name, v::text);
  return v;
end $f$;

-- A course planted with its sessions, a day apart from p.start at the same
-- time, on court c3. p: coach, start, sessions (4), status (open).
create function pg_temp.plant_course(p_name text, p jsonb) returns uuid language plpgsql as $f$
declare
  v_coach uuid := pg_temp.var(p->>'coach')::uuid;
  v_start timestamptz := (p->>'start')::timestamptz;
  v_n     int := coalesce((p->>'sessions')::int, 4);
  v_prof  uuid;
  v uuid; l uuid; i int;
begin
  perform set_config('request.jwt.claims', '', true);
  select co.profile_id into v_prof from coaches co where co.id = v_coach;
  insert into courses (venue_id, coach_id, lesson_type_id, title_en, title_ar, price_iqd, court_share_iqd,
                       coach_share_bp, sessions_count, max_places, min_places, cutoff_at, signup_closes_at,
                       status, created_by_kind, created_by_profile_id)
  values (pg_temp.var('v')::uuid, v_coach, pg_temp.var('tc')::uuid, 'C280 course title', 'عنوان الدورة',
          60000, 5000, 6000, v_n, 4, 2, v_start - interval '2 hours',
          v_start + make_interval(days => v_n - 1), coalesce(p->>'status', 'open'), 'coach', v_prof)
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text);
  for i in 1 .. v_n loop
    insert into lessons (venue_id, coach_id, lesson_type_id, kind, course_id, session_no, start_at, end_at,
                         price_iqd, court_share_iqd, coach_share_bp, max_places, min_places, cutoff_at, status,
                         booked_by_kind, created_by_profile_id)
    values (pg_temp.var('v')::uuid, v_coach, pg_temp.var('tc')::uuid, 'course', v, i,
            v_start + make_interval(days => i - 1), v_start + make_interval(days => i - 1, mins => 60),
            null, 5000, 6000, 4, 2, v_start - interval '2 hours', 'scheduled', 'coach', v_prof)
    returning id into l;
    insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_name, source, lesson_id)
    values (pg_temp.var('v')::uuid, pg_temp.var('c3')::uuid, 'lesson', 'confirmed',
            v_start + make_interval(days => i - 1), v_start + make_interval(days => i - 1, mins => 60),
            'Lesson', 'desk', l);
    insert into pg_temp.vars values (p_name || '_s' || i, l::text);
  end loop;
  return v;
end $f$;

-- An enrolment planted. p: lesson or course (kept names), guest (a kept
-- profile name; a guest's own booking unless booked_by says otherwise),
-- booked_by (guest | coach | staff), name, phone (typed), linked (true: the
-- link confirmed; false: pending), status (booked | held | cancelled |
-- expired), payment_mode (desk | online), first (course first_session_no),
-- covered (sessions_covered), party, friends (a JSON array of names),
-- cancel_kind.
create function pg_temp.plant_enrolment(p_name text, p jsonb) returns uuid language plpgsql as $f$
declare
  v_lesson uuid := case when p ? 'lesson' then pg_temp.var(p->>'lesson')::uuid end;
  v_course uuid := case when p ? 'course' then pg_temp.var(p->>'course')::uuid end;
  v_guest  uuid := case when p ? 'guest' then pg_temp.var(p->>'guest')::uuid end;
  v_by     text := coalesce(p->>'booked_by', 'guest');
  v_status text := coalesce(p->>'status', 'booked');
  v_mode   text := coalesce(p->>'payment_mode', 'desk');
  v_coach_prof uuid;
  v uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  select co.profile_id into v_coach_prof
    from coaches co
   where co.id = coalesce((select l.coach_id from lessons l where l.id = v_lesson),
                          (select c.coach_id from courses c where c.id = v_course));
  insert into lesson_enrolments (venue_id, lesson_id, course_id, guest_id, guest_name, guest_phone, party_size,
                                 friend_names, booked_by_kind, booked_by_profile_id, booked_by_staff_id,
                                 price_iqd, first_session_no, sessions_covered, payment_mode, status,
                                 hold_expires_at, cancel_kind, cancelled_at, link_confirmed_at)
  values (pg_temp.var('v')::uuid, v_lesson, v_course, v_guest,
          case when v_by <> 'guest' then coalesce(p->>'name', 'Typed Student') end,
          case when v_by <> 'guest' then p->>'phone' end,
          coalesce((p->>'party')::int, 1),
          coalesce(array(select jsonb_array_elements_text(p->'friends')), '{}'::text[]),
          v_by,
          case v_by when 'guest' then v_guest when 'coach' then v_coach_prof end,
          case when v_by = 'staff' then pg_temp.var('desk')::uuid end,
          coalesce((p->>'price')::bigint, case when v_course is not null then 60000 else 30000 end),
          case when v_course is not null then coalesce((p->>'first')::int, 1) end,
          case when v_course is not null then coalesce((p->>'covered')::int, 4) end,
          v_mode, v_status,
          case when v_status = 'held' then now() + interval '10 minutes' end,
          case when v_status in ('cancelled', 'expired') then coalesce(p->>'cancel_kind',
                 case when v_status = 'expired' then 'expired' else 'staff' end) end,
          case when v_status in ('cancelled', 'expired') then now() end,
          case when v_by = 'guest' or (v_guest is not null and coalesce((p->>'linked')::boolean, false))
               then now() end)
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text);
  return v;
end $f$;
`;

/** A branch-local time: midnight `days` days from today plus `hours`. */
export const LT = (days: number, hours: number) => `pg_temp.lt(${days}, ${hours})`;
/** Keep the value at JSON path `path` (comma-separated) of a recorded result. */
export const KEPT = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);
/** A unique typed phone per run, so no committed account elsewhere matches it by chance. */
export const randomPhone = () =>
  `+96477${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

/** Every profiles.id-shaped and phone-shaped leak in a JSON value (R43, R58 G2). */
export function leaks(value: unknown, ids: readonly string[], phones: readonly string[]): string[] {
  const text = JSON.stringify(value);
  const out: string[] = [];
  for (const id of ids) if (text.includes(id)) out.push(`id ${id}`);
  for (const phone of phones) {
    const tail = phone.replace(/\D/g, '').slice(-9);
    if (
      tail &&
      text
        .replace(/\D/g, ' ')
        .split(/\s+/)
        .some((run) => run.endsWith(tail))
    )
      out.push(`phone ${phone}`);
  }
  return out;
}

/**
 * Phone-shaped strings anywhere in a JSON value, by path: after removing
 * spaces and hyphens, 7 to 15 digits with an optional +, and not an ISO date.
 * `allow` lists values that may appear (the branch's own phone).
 */
export function phoneShaped(value: unknown, allow: readonly string[] = [], path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => phoneShaped(v, allow, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      phoneShaped(v, allow, `${path}.${k}`),
    );
  }
  if (typeof value === 'string' && !allow.includes(value) && !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const squashed = value.replace(/[\s-]/g, '');
    if (/^\+?\d{7,15}$/.test(squashed)) return [`${path}=${value}`];
  }
  return [];
}

/** Keys at any depth that name a person or a court (R43): profile ids, guest names and phones, court ids. */
export function personKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => personKeys(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      ...(/^(guest_id|profile_id|customer_id|guest_name|guest_phone|full_name|court_id|friend_names|name)$/.test(
        k,
      )
        ? [`${path}.${k}`]
        : []),
      ...personKeys(v, `${path}.${k}`),
    ]);
  }
  return [];
}
