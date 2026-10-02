/**
 * The shared harness of the coaching core suites (coaching-admin.test.ts,
 * coaching-booking.test.ts; docs/design/coaching/db.md §7): one psql
 * transaction that is rolled back (the stores-harness scenario), a branch made
 * inside it (open, coaching on, open all day, two courts, the seeded manager
 * and desk working there), guests who may book (a phone, accepted terms; an
 * optional VERIFIED phone on auth.users for the R10 match), coaches (accepted
 * by default, active at the branch, hours 00:00-24:00 every day) and launched
 * lesson types, and a call runner that sets auth.uid() the way PostgREST
 * would.
 *
 * Rows are planted as postgres with the claims cleared (a fixture write, not a
 * staff write: zz_branch_guard, 0230). Every call runs through the real RPCs.
 * now() is the transaction's start, so a time that must lie in the past is
 * planted by moving a row after it was booked.
 */
import { expect } from 'vitest';
import { KEEP, Q, type Results } from './stores-harness';

export const SETUP = String.raw`
create function pg_temp.var(p_name text) returns text language sql as $f$
  select val from pg_temp.vars where name = p_name
$f$;

-- e() runs one statement as postgres with auth.uid() = the id kept under p_who
-- (NULL: no session) and records {ok, data} or {ok: false, code, detail, hint}.
-- Each call starts with app.venue_id cleared, as a PostgREST request starts a
-- transaction of its own: a branch one body asserted (set_config(..., true))
-- must not leak into the next call's resolve_venue / visible_venue_ids.
create function pg_temp.e(p_label text, p_who text, p_sql text) returns void language plpgsql as $f$
declare v_res jsonb; v_msg text; v_detail text; v_hint text; v_uid text;
begin
  v_uid := case when p_who is null then null else coalesce(pg_temp.var(p_who), p_who) end;
  perform set_config('app.venue_id', '', true);
  perform set_config('request.jwt.claims',
    case when v_uid is null then '' else jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text end, true);
  begin
    execute pg_temp.sub(p_sql) into v_res;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v_res));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'detail', nullif(v_detail, ''),
                                        'hint', nullif(v_hint, '')));
  end;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.venue_id', '', true);
end $f$;

create function pg_temp.at(p_days int, p_hours int default 0, p_minutes int default 0) returns timestamptz
language sql as $f$
  select date_trunc('hour', now()) + make_interval(days => p_days, hours => p_hours, mins => p_minutes)
$f$;

-- A branch of its own: open, coaching on (p_coaching), open all day, two
-- courts; the seeded manager and desk work there unless p_staff is false.
create function pg_temp.branch(p_name text, p_coaching boolean default true, p_staff boolean default true)
returns uuid language plpgsql as $f$
declare v uuid; c1 uuid; c2 uuid;
  v_all constant jsonb := '[["00:00","24:00"]]';
begin
  perform set_config('request.jwt.claims', '', true);
  insert into venues (slug, name_en, name_ar, timezone, is_active)
  values ('c280-' || p_name || '-' || substr(md5(random()::text), 1, 8), 'C280 ' || p_name, 'فرع ' || p_name,
          'Asia/Baghdad', true)
  returning id into v;
  insert into venue_settings (venue_id, venue_name, opening_hours, coaching_enabled)
  values (v, 'C280 ' || p_name,
          jsonb_build_object('mon', v_all, 'tue', v_all, 'wed', v_all, 'thu', v_all, 'fri', v_all,
                             'sat', v_all, 'sun', v_all),
          p_coaching);
  insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
  values (v, 'C280 ' || p_name || ' court 1', 'ملعب ١', '{60,90,120}', 1, true) returning id into c1;
  insert into courts (venue_id, name_en, name_ar, duration_options, sort_order, is_active)
  values (v, 'C280 ' || p_name || ' court 2', 'ملعب ٢', '{60,90,120}', 2, true) returning id into c2;
  if p_staff then
    insert into staff_venues (staff_id, venue_id, role)
    values (pg_temp.var('manager')::uuid, v, 'manager'), (pg_temp.var('desk')::uuid, v, 'court_desk')
    on conflict do nothing;
  end if;
  insert into pg_temp.vars values (p_name, v::text), (p_name || '_c1', c1::text), (p_name || '_c2', c2::text)
  on conflict (name) do update set val = excluded.val;
  return v;
end $f$;

-- A guest who may book: a phone and accepted terms. p: phone, terms (null
-- unsets), verified (a phone confirmed on auth.users: the R10 identity).
create function pg_temp.guest(p_name text, p jsonb default '{}') returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
  q jsonb := jsonb_build_object('phone', '+9647700000000', 'terms', '2026-09-23') || p;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, raw_user_meta_data, aud, role, phone, phone_confirmed_at)
  values (v, 'c280-' || p_name || '-' || v || '@test.touch.local',
          jsonb_build_object('full_name', 'Test ' || p_name), 'authenticated', 'authenticated',
          q->>'verified', case when q ? 'verified' then now() end);
  update profiles set phone = q->>'phone', terms_version = q->>'terms' where id = v;
  insert into pg_temp.vars values (p_name, v::text) on conflict (name) do update set val = excluded.val;
  return v;
end $f$;

-- A coach on the guest profile p_guest: accepted (p accepted false: not yet,
-- R61), active at branch p_venue with hours 00:00-24:00 every day.
create function pg_temp.coach(p_name text, p_guest text, p_venue text default 'v', p jsonb default '{}')
returns uuid language plpgsql as $f$
declare v uuid; ven uuid := pg_temp.var(p_venue)::uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into coaches (profile_id, display_name_en, display_name_ar, status, public_accepted_at)
  values (pg_temp.var(p_guest)::uuid, 'Coach ' || p_name, 'المدرّب ' || p_name, coalesce(p->>'status', 'active'),
          case when coalesce((p->>'accepted')::boolean, true) then now() end)
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text) on conflict (name) do update set val = excluded.val;
  perform pg_temp.at_branch(p_name, p_venue);
  return v;
end $f$;

-- The coach active at one more branch, hours 00:00-24:00 every day there.
create function pg_temp.at_branch(p_coach text, p_venue text) returns void language plpgsql as $f$
declare c uuid := pg_temp.var(p_coach)::uuid; ven uuid := pg_temp.var(p_venue)::uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into coach_branches (coach_id, venue_id, active) values (c, ven, true)
  on conflict (coach_id, venue_id) do update set active = true;
  delete from coach_hours where coach_id = c and venue_id = ven;
  insert into coach_hours (coach_id, venue_id, weekday, start_time, end_time, set_by)
  select c, ven, d, time '00:00', time '24:00', 'coach' from generate_series(0, 6) d;
end $f$;

-- A launched, active lesson type at branch p_venue: private 60 min 30,000 for
-- up to 2; group 60 min 15,000 a place, 3 places, minimum 2, cut-off 2 h;
-- course 4 sessions of 60 min, 80,000, 3 places, minimum 2, cut-off 2 h.
-- p overrides any column.
create function pg_temp.lt(p_name text, p_kind text, p_venue text default 'v', p jsonb default '{}')
returns uuid language plpgsql as $f$
declare v uuid; r lesson_types;
begin
  perform set_config('request.jwt.claims', '', true);
  r := jsonb_populate_record(null::lesson_types, jsonb_build_object(
         'venue_id', pg_temp.var(p_venue), 'kind', p_kind, 'name_en', 'C280 ' || p_name,
         'name_ar', 'حصة ' || p_name, 'description_en', '', 'description_ar', '', 'duration_min', 60,
         'price_iqd', case p_kind when 'private' then 30000 when 'group' then 15000 else 80000 end,
         'court_share_iqd', 5000,
         'max_places', case p_kind when 'private' then 2 else 3 end,
         'min_places', case p_kind when 'private' then 1 else 2 end,
         'cutoff_hours', case p_kind when 'private' then 0 else 2 end,
         'sessions_count', case when p_kind = 'course' then 4 end,
         'is_active', true, 'launched_at', now(), 'sort_order', 0) || p);
  insert into lesson_types (venue_id, kind, name_en, name_ar, description_en, description_ar, duration_min, price_iqd,
                            court_share_iqd, max_places, min_places, cutoff_hours, sessions_count, is_active,
                            launched_at, sort_order)
  values (r.venue_id, r.kind, r.name_en, r.name_ar, r.description_en, r.description_ar, r.duration_min, r.price_iqd,
          r.court_share_iqd, r.max_places, r.min_places, r.cutoff_hours, r.sessions_count, r.is_active,
          r.launched_at, r.sort_order)
  returning id into v;
  insert into pg_temp.vars values (p_name, v::text) on conflict (name) do update set val = excluded.val;
  return v;
end $f$;

create function pg_temp.teach(p_coach text, p_type text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  insert into coach_lesson_types (coach_id, lesson_type_id, venue_id)
  select pg_temp.var(p_coach)::uuid, t.id, t.venue_id from lesson_types t where t.id = pg_temp.var(p_type)::uuid
  on conflict do nothing;
end $f$;

-- A live firm booking on a court (a kept name), for the court-full cases.
create function pg_temp.booking(p_court text, p_start timestamptz, p_minutes int default 60) returns uuid
language plpgsql as $f$
declare v uuid; c uuid := pg_temp.var(p_court)::uuid;
begin
  perform set_config('request.jwt.claims', '', true);
  insert into reservations (venue_id, court_id, kind, status, start_at, end_at, guest_name, source)
  values ((select x.venue_id from courts x where x.id = c), c, 'booking', 'confirmed', p_start,
          p_start + make_interval(mins => p_minutes), 'C280 fixture', 'desk')
  returning id into v;
  return v;
end $f$;

-- Online lesson payment possible at a branch (R50: a lessons terms version is
-- live and the guests accepted it).
create function pg_temp.online(p_venue text) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  update platform_settings set lesson_terms_version = '2026-09-01' where id;
  update venue_settings set lesson_payment_mode = 'online_optional' where venue_id = pg_temp.var(p_venue)::uuid;
end $f$;

-- One lesson's state for the assertions.
create function pg_temp.lesson_state(p_lesson uuid) returns jsonb language sql as $f$
  select jsonb_build_object(
    'status', l.status, 'cancel_reason', l.cancel_reason, 'kind', l.kind,
    'rescheduled', l.rescheduled_at is not null, 'cutoff_at', l.cutoff_at, 'start_at', l.start_at,
    'court_rows', (select jsonb_agg(jsonb_build_object('kind', r.kind, 'status', r.status, 'guest_id', r.guest_id,
                                                       'guest_name', r.guest_name, 'price_iqd', r.price_iqd)
                                    order by r.created_at)
                     from reservations r where r.lesson_id = l.id),
    'events', (select jsonb_agg(e.type || coalesce(':' || e.code, '') order by e.id)
                 from lesson_events e where e.lesson_id = l.id))
    from lessons l where l.id = p_lesson
$f$;
`;

/** Capture as postgres with auth.uid() = the kept id `who` (null: no session). */
export const E = (label: string, who: string | null, sql: string) =>
  `select pg_temp.e('${label}', ${who === null ? 'null' : `'${who}'`}, $q$${sql}$q$);`;

/** Keep a value under `name` (a fixture). */
export const K = (name: string, sql: string) => KEEP(name, sql);

/** A read as postgres, recorded under `label`. */
export const R = (label: string, sql: string) => Q(label, sql);

/** A time `days` days, `hours` hours and `minutes` minutes past the current hour (on the :00 grid). */
export const at = (days: number, hours = 0, minutes = 0) =>
  `pg_temp.at(${days}, ${hours}, ${minutes})`;

/** Keep the value at `path` of a recorded call's data under `name`. */
export const FROM = (name: string, label: string, path: string) =>
  KEEP(name, `select res #>> '{data,${path}}' from pg_temp.out where label = '${label}'`);

export function failed(
  r: Results,
  label: string,
): { code: string; detail: string | null; hint: string | null } {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail, got ${JSON.stringify(o!.data)}`).toBe(false);
  return {
    code: o!.code!,
    detail: (o!.detail ?? null) as string | null,
    hint: (o!.hint ?? null) as string | null,
  };
}

export function data<T = Record<string, unknown>>(r: Results, label: string): T {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.detail ?? ''} ${o!.hint ?? ''}`).toBe(true);
  return o!.data as T;
}

/** The refusal as CODE, or CODE:detail when it carries one. */
export function code(r: Results, label: string): string {
  const f = failed(r, label);
  return f.detail ? `${f.code}:${f.detail}` : f.code;
}
