/**
 * staff_clock (0442): staff log arriving and leaving from their phone at the
 * club, against a weekly plan of shifts; lateness records itself.
 *
 *   * the checks, in order, each refusal answered as data and kept:
 *     NO_PLACE, NO_STATION, WRONG_DEVICE, LOCATION_STALE, MOCK_LOCATION,
 *     LOCATION_ROUGH, NOT_HERE, CODE_WRONG, ALREADY_IN, NOT_IN, and
 *     TOO_MANY_TRIES after 8 refusals in an hour;
 *   * the code is the desk station's own (HMAC-SHA1 TOTP, 30 s); a retired
 *     station's code is refused; re-issuing a key kills the old code;
 *   * lateness: an in is measured against the first shift not ended that
 *     starts within 3 hours; an out against the end of the block (touching
 *     shifts) the in matched; a gap between shifts costs nothing;
 *   * the day's staff_attendance row is the clock's (source clock) unless a
 *     manager recorded it (manual wins);
 *   * set hours: no overlap (Sunday night into Monday too), touching is fine,
 *     a shift's job must be one of the person's, 16 hours at most, a manager
 *     never sets their own;
 *   * who: the owner never logs; a guest or another branch's staff is
 *     FORBIDDEN; setup is the owner's (place) and managers' (station keys).
 *
 * HOW. As wages.test.ts: every scenario is ONE psql transaction that is
 * rolled back. now() is fixed inside a transaction, so shifts are planted
 * relative to it in the branch's timezone.
 */
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { stackAvailable, SEED_STAFF_IDS, VENUE_A_ID } from './helpers';

const up = await stackAvailable();
const CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? 'supabase_db_touchpadel';

function psql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}
function dockerReachable(): boolean {
  try {
    return psql('select 1') === '1';
  } catch {
    return false;
  }
}
const docker = up && dockerReachable();

const PRELUDE = `
create temp table out (seq serial, label text unique, res jsonb);
create temp table vars (name text primary key, val text);
insert into vars values
  ('owner', '${SEED_STAFF_IDS.owner}'), ('manager', '${SEED_STAFF_IDS.manager}'),
  ('venue', '${VENUE_A_ID}');

create function pg_temp.sub(p_sql text) returns text language plpgsql as $f$
declare r record; v text := p_sql;
begin
  for r in select name, val from pg_temp.vars order by length(name) desc loop
    v := replace(v, '{{' || r.name || '}}', quote_literal(r.val));
  end loop;
  if v ~ '\\{\\{[a-z0-9_]+\\}\\}' then raise exception 'unbound variable in: %', v; end if;
  return v;
end $f$;

create function pg_temp.run(p_label text, p_who text, p_sql text) returns void language plpgsql as $f$
declare v_uid text; v_sql text := pg_temp.sub(p_sql); v_res jsonb; v_msg text; v_hint text;
begin
  select val into v_uid from pg_temp.vars where name = p_who;
  if v_uid is null then raise exception 'unknown principal %', p_who; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute v_sql into v_res;
    reset role;
    insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v_res));
  exception when others then
    get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
    reset role;
    insert into pg_temp.out(label, res)
    values (p_label, jsonb_build_object('ok', false, 'code', v_msg, 'hint', nullif(v_hint, '')));
  end;
end $f$;

create function pg_temp.q(p_label text, p_sql text) returns void language plpgsql as $f$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', '', true);
  execute pg_temp.sub(p_sql) into v;
  insert into pg_temp.out(label, res) values (p_label, jsonb_build_object('ok', true, 'data', v));
end $f$;

create function pg_temp.keep(p_name text, p_sql text) returns void language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', '', true);
  execute pg_temp.sub(p_sql) into v;
  if v is null then raise exception 'keep %: no value', p_name; end if;
  insert into pg_temp.vars values (p_name, v) on conflict (name) do update set val = excluded.val;
end $f$;

create function pg_temp.mk(p_name text, p_role staff_role, p_extra staff_role[] default '{}') returns void
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (v, 'ck-' || p_name || '-' || v || '@test.touch.local', '{}', 'authenticated', 'authenticated');
  insert into staff (id, display_name, role, is_active, extra_roles) values (v, 'CK ' || p_name, p_role, true, p_extra);
  insert into staff_venues (staff_id, venue_id, role) values (v, '${VENUE_A_ID}', p_role) on conflict do nothing;
  insert into pg_temp.vars values (p_name, v::text);
end $f$;

-- A shift in the branch's local time, starting p_from_min minutes from now
-- and lasting p_len_min minutes.
create function pg_temp.shift(p_from_min int, p_len_min int, p_role text default null) returns jsonb
language sql as $f$
  select jsonb_build_object(
    'weekday', extract(isodow from (now() at time zone 'Asia/Baghdad') + make_interval(mins => p_from_min))::int,
    'starts_at', to_char((now() at time zone 'Asia/Baghdad') + make_interval(mins => p_from_min), 'HH24:MI'),
    'ends_at', to_char((now() at time zone 'Asia/Baghdad') + make_interval(mins => p_from_min + p_len_min), 'HH24:MI'),
    'role', p_role)
$f$;

-- An accepted "in" planted p_ago_min minutes ago, counted against today.
create function pg_temp.past_in(p_who text, p_ago_min int) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', '', true);
  insert into staff_clock_events (venue_id, staff_id, kind, status, at, work_date)
  select '${VENUE_A_ID}', val::uuid, 'in', 'accepted', now() - make_interval(mins => p_ago_min),
         ((now() - make_interval(mins => p_ago_min)) at time zone 'Asia/Baghdad')::date
    from pg_temp.vars where name = p_who;
end $f$;
`;

interface Outcome {
  ok: boolean;
  data?: unknown;
  code?: string;
  hint?: string | null;
}
type Results = Record<string, Outcome>;

function scenario(body: string[]): Results {
  const raw = psql(
    `begin;\n${PRELUDE}\n${body.join('\n')}\n` +
      `select label || E'\\t' || res::text from pg_temp.out order by seq;\nrollback;\n`,
  );
  const results: Results = {};
  for (const line of raw.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    results[line.slice(0, tab)] = JSON.parse(line.slice(tab + 1)) as Outcome;
  }
  return results;
}

const T = (label: string, who: string, sql: string) => `select pg_temp.run('${label}', '${who}', $q$${sql}$q$);`;
const Q = (label: string, sql: string) => `select pg_temp.q('${label}', $q$${sql}$q$);`;
const KEEP = (name: string, sql: string) => `select pg_temp.keep('${name}', $q$${sql}$q$);`;
const MK = (name: string, role: string, extra = '{}') => `select pg_temp.mk('${name}', '${role}', '${extra}');`;

function ok<D>(r: Results, label: string): D {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label}: ${o!.code ?? ''} ${o!.hint ?? ''}`).toBe(true);
  return o!.data as D;
}
function refused(r: Results, label: string): string {
  const o = r[label];
  expect(o, `no result for ${label}`).toBeDefined();
  expect(o!.ok, `${label} was expected to fail`).toBe(false);
  return o!.hint ? `${o!.code}:${o!.hint}` : o!.code!;
}
interface Punch {
  status: 'accepted' | 'refused';
  reason?: string;
  late_minutes?: number;
  early_minutes?: number;
  distance_m?: number;
  [k: string]: unknown;
}

// The club, a desk station and its key.
const CLUB = { lat: 33.3152, lng: 44.3661 };
const SETUP = [
  `select set_config('request.jwt.claims', '', true);`,
  `insert into stations (id, venue_id) values ('CKDESK1', '${VENUE_A_ID}');`,
  T('place', 'owner', `select app.set_clock_place({{venue}}, ${CLUB.lat}, ${CLUB.lng}, 120, 60)`),
  T('key', 'manager', `select app.issue_station_clock_key('CKDESK1')`),
];
/** The desk's code now, read as postgres from the stored key. */
const CODE = KEEP(
  'code',
  `select app.clock_code(secret, floor(extract(epoch from now()) / 30)::bigint) from station_clock_keys where station_id = 'CKDESK1'`,
);
interface PunchOpts {
  kind?: 'in' | 'out';
  code?: string;
  lat?: number;
  lng?: number;
  acc?: number;
  fixAgo?: string;
  mocked?: boolean;
  device?: string;
}
const punch = (label: string, who: string, o: PunchOpts = {}) =>
  T(
    label,
    who,
    `select app.clock_punch({{venue}}, '${o.kind ?? 'in'}', ${o.code ?? '{{code}}'}, ${o.lat ?? CLUB.lat + 0.0003},
       ${o.lng ?? CLUB.lng}, ${o.acc ?? 15}, now() - interval '${o.fixAgo ?? '5 seconds'}', ${o.mocked ?? false},
       '${o.device ?? 'device-phone-0001'}', 'android')`,
  );
const setShifts = (label: string, who: string, target: string, shifts: string) =>
  T(label, who, `select app.set_staff_shifts({{venue}}, {{${target}}}::uuid, ${shifts})`);

describe.skipIf(!docker)('staff clock (rolled-back transactions)', () => {
  it('the checks refuse in order, each refusal kept; an accepted in and out write the day', () => {
    const r = scenario([
      MK('waiter', 'waiter'),
      `select set_config('request.jwt.claims', '', true);`,
      `insert into stations (id, venue_id) values ('CKDESK1', '${VENUE_A_ID}');`,
      punch('no_place', 'waiter', { code: `'000000'` }),
      T('place', 'owner', `select app.set_clock_place({{venue}}, ${CLUB.lat}, ${CLUB.lng}, 120, 60)`),
      punch('no_station', 'waiter', { code: `'000000'` }),
      T('key', 'manager', `select app.issue_station_clock_key('CKDESK1')`),
      CODE,
      // Shift started 25 minutes ago, 4 hours long.
      setShifts('hours', 'manager', 'waiter', `jsonb_build_array(pg_temp.shift(-25, 240))`),
      punch('stale', 'waiter', { fixAgo: '5 minutes' }),
      punch('mocked', 'waiter', { mocked: true }),
      punch('rough', 'waiter', { acc: 200 }),
      punch('far', 'waiter', { lat: CLUB.lat + 0.05 }),
      punch('code_wrong', 'waiter', { code: `'123456'` }),
      punch('not_in', 'waiter', { kind: 'out' }),
      // Eight refusals would lock the next scan (TOO_MANY_TRIES): read them, then clear them.
      Q('kept_first', `select jsonb_agg(e.refusal order by e.ctid) from staff_clock_events e
                        where e.staff_id = {{waiter}}::uuid and e.status = 'refused'`),
      `delete from staff_clock_events where staff_id = (select val::uuid from pg_temp.vars where name = 'waiter');`,
      punch('in', 'waiter'),
      punch('again', 'waiter'),
      punch('other_phone', 'waiter', { kind: 'out', device: 'device-phone-9999' }),
      T('mine', 'waiter', `select app.my_clock({{venue}})`),
      punch('out', 'waiter', { kind: 'out' }),
      Q('day', `select to_jsonb(a) from staff_attendance a where a.staff_id = {{waiter}}::uuid`),
      Q('kept', `select jsonb_agg(e.refusal order by e.ctid) from staff_clock_events e
                  where e.staff_id = {{waiter}}::uuid and e.status = 'refused'`),
      T('board', 'manager', `select app.clock_day({{venue}})`),
    ]);
    expect(ok<Punch>(r, 'no_place')).toMatchObject({ status: 'refused', reason: 'NO_PLACE' });
    expect(ok<Punch>(r, 'no_station')).toMatchObject({ status: 'refused', reason: 'NO_STATION' });
    expect(ok<Punch>(r, 'stale').reason).toBe('LOCATION_STALE');
    expect(ok<Punch>(r, 'mocked').reason).toBe('MOCK_LOCATION');
    expect(ok<Punch>(r, 'rough')).toMatchObject({ reason: 'LOCATION_ROUGH', accuracy_m: 200, max_accuracy_m: 60 });
    const far = ok<Punch>(r, 'far');
    expect(far.reason).toBe('NOT_HERE');
    expect(far.distance_m).toBeGreaterThan(5000);
    expect(far.radius_m).toBe(120);
    expect(ok<Punch>(r, 'code_wrong').reason).toBe('CODE_WRONG');
    expect(ok<Punch>(r, 'not_in').reason).toBe('NOT_IN');
    const inn = ok<Punch>(r, 'in');
    expect(inn.status).toBe('accepted');
    expect(inn.late_minutes).toBe(25);
    expect(ok<Punch>(r, 'again').reason).toBe('ALREADY_IN');
    expect(ok<Punch>(r, 'other_phone').reason).toBe('WRONG_DEVICE');
    const mine = ok<{ state: string; ready: boolean; device_bound: boolean; current: unknown; shifts: unknown[] }>(r, 'mine');
    expect(mine).toMatchObject({ state: 'in', ready: true, device_bound: true });
    expect(mine.current).not.toBeNull();
    expect(mine.shifts).toHaveLength(1);
    const out = ok<Punch>(r, 'out');
    expect(out.status).toBe('accepted');
    // Shift ends 215 minutes from now.
    expect(out.early_minutes).toBe(215);
    expect(ok<Record<string, unknown>>(r, 'day')).toMatchObject({
      late_minutes: 25,
      early_leave_minutes: 215,
      source: 'clock',
      recorded_by: null,
    });
    expect(ok<string[]>(r, 'kept_first')).toEqual([
      'NO_PLACE', 'NO_STATION', 'LOCATION_STALE', 'MOCK_LOCATION', 'LOCATION_ROUGH', 'NOT_HERE',
      'CODE_WRONG', 'NOT_IN',
    ]);
    expect(ok<string[]>(r, 'kept')).toEqual(['ALREADY_IN', 'WRONG_DEVICE']);
    const board = ok<{ people: { display_name: string; events: unknown[]; attendance: { source: string } }[] }>(r, 'board');
    const row = board.people.find((p) => p.display_name === 'CK waiter');
    expect(row?.events).toHaveLength(4);
    expect(row?.attendance.source).toBe('clock');
  });

  it('eight refusals in an hour lock the person out', () => {
    const r = scenario([
      MK('waiter', 'waiter'),
      ...SETUP,
      ...Array.from({ length: 8 }, (_, i) => punch(`miss${i}`, 'waiter', { code: `'111111'` })),
      CODE,
      punch('locked', 'waiter'),
    ]);
    expect(ok<Punch>(r, 'miss7').reason).toBe('CODE_WRONG');
    expect(ok<Punch>(r, 'locked').reason).toBe('TOO_MANY_TRIES');
  });

  it('the code is the station key: retired or re-issued keys stop working', () => {
    const r = scenario([
      MK('waiter', 'waiter'),
      ...SETUP,
      CODE,
      KEEP('old', `select val from pg_temp.vars where name = 'code'`),
      T('reissue', 'manager', `select app.issue_station_clock_key('CKDESK1')`),
      punch('old_code', 'waiter', { code: '{{old}}' }),
      CODE,
      `select set_config('request.jwt.claims', '', true);`,
      `update stations set retired_at = now() where id = 'CKDESK1';`,
      punch('retired', 'waiter'),
      T('waiter_key', 'waiter', `select app.issue_station_clock_key('DEV1')`),
      T('setup', 'manager', `select app.clock_setup({{venue}})`),
    ]);
    const key = ok<{ secret: string; step_seconds: number; digits: number }>(r, 'key');
    expect(key.secret).toMatch(/^[0-9a-f]{40}$/);
    expect(ok<{ replaced: boolean }>(r, 'reissue').replaced).toBe(true);
    // A re-issue only matters if the code changed; equal codes are a 1-in-a-million coincidence.
    const oldCode = ok<Punch>(r, 'old_code');
    expect(['CODE_WRONG', undefined]).toContain(oldCode.reason);
    expect(ok<Punch>(r, 'retired').reason).toBe('NO_STATION');
    expect(refused(r, 'waiter_key')).toBe('FORBIDDEN');
    const setup = ok<{ place: { radius_m: number }; stations: { station_id: string }[]; can_edit_place: boolean }>(r, 'setup');
    expect(setup.place.radius_m).toBe(120);
    expect(setup.can_edit_place).toBe(false);
    expect(JSON.stringify(setup)).not.toContain(key.secret);
  });

  it('a gap between shifts costs nothing; touching shifts are one block', () => {
    const r = scenario([
      MK('gap', 'waiter'),
      MK('two', 'waiter', '{cashier}'),
      MK('back', 'waiter'),
      ...SETUP,
      CODE,
      // gap: shift 1 ended 10 minutes ago, shift 2 starts in 50.
      setShifts('gap_hours', 'manager', 'gap', `jsonb_build_array(pg_temp.shift(-250, 240), pg_temp.shift(50, 180))`),
      `select pg_temp.past_in('gap', 250);`,
      punch('gap_out', 'gap', { kind: 'out', device: 'device-gap-0001' }),
      // back: coming back in the gap is measured against shift 2, not late.
      setShifts('back_hours', 'manager', 'back', `jsonb_build_array(pg_temp.shift(-250, 240), pg_temp.shift(50, 180))`),
      punch('back_in', 'back', { device: 'device-back-0001' }),
      // two jobs, touching: waiter until 30 minutes from now, then cashier for 3 hours.
      setShifts('two_hours', 'manager', 'two',
        `jsonb_build_array(pg_temp.shift(-120, 150, 'waiter'), pg_temp.shift(30, 180, 'cashier'))`),
      `select pg_temp.past_in('two', 120);`,
      T('two_mine', 'two', `select app.my_clock({{venue}})`),
      punch('two_out', 'two', { kind: 'out', device: 'device-two-0001' }),
    ]);
    expect(ok<Punch>(r, 'gap_out')).toMatchObject({ status: 'accepted', early_minutes: 0 });
    expect(ok<Punch>(r, 'back_in')).toMatchObject({ status: 'accepted', late_minutes: 0 });
    const mine = ok<{ current: { role: string }; next: { role: string } }>(r, 'two_mine');
    expect(mine.current.role).toBe('waiter');
    expect(mine.next.role).toBe('cashier');
    // Leaving now skips the rest of the block: 30 + 180 minutes.
    expect(ok<Punch>(r, 'two_out').early_minutes).toBe(210);
  });

  it("a manager's record of the day wins over the clock", () => {
    const r = scenario([
      MK('waiter', 'waiter'),
      ...SETUP,
      CODE,
      setShifts('hours', 'manager', 'waiter', `jsonb_build_array(pg_temp.shift(-40, 240))`),
      KEEP('today', `select ((now() at time zone 'Asia/Baghdad') - interval '40 minutes')::date::text`),
      T('manual', 'manager', `select app.record_attendance({{waiter}}::uuid, {{today}}::date, 5, 0, 'traffic')`),
      punch('in', 'waiter'),
      Q('day', `select to_jsonb(a) from staff_attendance a where a.staff_id = {{waiter}}::uuid`),
      T('month', 'manager', `select app.attendance_month({{venue}})`),
    ]);
    expect(ok<Punch>(r, 'in').late_minutes).toBe(40);
    expect(ok<Record<string, unknown>>(r, 'day')).toMatchObject({ late_minutes: 5, source: 'manual' });
    const month = ok<{ people: { display_name: string; days: { source: string }[] }[] }>(r, 'month');
    expect(month.people.find((p) => p.display_name === 'CK waiter')?.days[0]?.source).toBe('manual');
  });

  it('set hours: overlap, job, length and who may set them', () => {
    const r = scenario([
      MK('waiter', 'waiter', '{cashier}'),
      MK('mgr2', 'manager'),
      setShifts('overlap', 'manager', 'waiter',
        `'[{"weekday":1,"starts_at":"10:00","ends_at":"14:00"},{"weekday":1,"starts_at":"13:00","ends_at":"18:00"}]'::jsonb`),
      setShifts('sunday_night', 'manager', 'waiter',
        `'[{"weekday":7,"starts_at":"22:00","ends_at":"03:00"},{"weekday":1,"starts_at":"02:00","ends_at":"06:00"}]'::jsonb`),
      setShifts('touching', 'manager', 'waiter',
        `'[{"weekday":1,"starts_at":"10:00","ends_at":"14:00","role":"waiter"},{"weekday":1,"starts_at":"14:00","ends_at":"18:00","role":"cashier"},{"weekday":1,"starts_at":"19:00","ends_at":"23:00"}]'::jsonb`),
      setShifts('not_their_job', 'manager', 'waiter', `'[{"weekday":2,"starts_at":"10:00","ends_at":"14:00","role":"chef"}]'::jsonb`),
      setShifts('too_long', 'manager', 'waiter', `'[{"weekday":2,"starts_at":"06:00","ends_at":"23:00"}]'::jsonb`),
      setShifts('own', 'mgr2', 'mgr2', `'[]'::jsonb`),
      setShifts('by_waiter', 'waiter', 'waiter', `'[]'::jsonb`),
      setShifts('owner_hours', 'owner', 'owner', `'[]'::jsonb`),
      T('read', 'manager', `select app.staff_shifts_get({{venue}}, {{waiter}}::uuid)`),
    ]);
    expect(refused(r, 'overlap')).toBe('INVALID_ARGUMENT:overlap');
    expect(refused(r, 'sunday_night')).toBe('INVALID_ARGUMENT:overlap');
    expect(ok<{ shifts: number }>(r, 'touching').shifts).toBe(3);
    expect(refused(r, 'not_their_job')).toBe('INVALID_ARGUMENT:role');
    expect(refused(r, 'too_long')).toBe('INVALID_ARGUMENT:shift_length');
    expect(refused(r, 'own')).toBe('FORBIDDEN:staff_id');
    expect(refused(r, 'by_waiter')).toBe('FORBIDDEN');
    expect(refused(r, 'owner_hours')).toBe('REF_NOT_FOUND:staff_id');
    const read = ok<{ roles: string[]; shifts: { role: string | null }[] }>(r, 'read');
    expect(read.roles).toEqual(['waiter', 'cashier']);
    expect(read.shifts.map((s) => s.role)).toEqual(['waiter', 'cashier', null]);
  });

  it('who: the owner never logs, others are refused, a manager resets a phone', () => {
    const r = scenario([
      MK('waiter', 'waiter'),
      ...SETUP,
      CODE,
      punch('owner_punch', 'owner'),
      T('owner_mine', 'owner', `select app.my_clock({{venue}})`),
      T('waiter_place', 'manager', `select app.set_clock_place({{venue}}, 1, 1, 120, 60)`),
      T('waiter_board', 'waiter', `select app.clock_day({{venue}})`),
      T('other_branch', 'waiter', `select app.my_clock('00000000-0000-4000-8000-00000000d4d4'::uuid)`),
      punch('in', 'waiter'),
      punch('new_phone', 'waiter', { kind: 'out', device: 'device-phone-2222' }),
      T('reset_self', 'manager', `select app.clock_reset_device({{venue}}, {{manager}}::uuid)`),
      T('reset', 'manager', `select app.clock_reset_device({{venue}}, {{waiter}}::uuid)`),
      punch('new_phone_ok', 'waiter', { kind: 'out', device: 'device-phone-2222' }),
      Q('wall', `select count(*)::text::jsonb from app.assistant_readable_columns
                  where table_name in ('staff_clock_events','staff_clock_places','station_clock_keys','staff_shifts','staff_clock_devices')`),
    ]);
    expect(refused(r, 'owner_punch')).toBe('FORBIDDEN');
    expect(refused(r, 'owner_mine')).toBe('FORBIDDEN');
    expect(refused(r, 'waiter_place')).toBe('FORBIDDEN');
    expect(refused(r, 'waiter_board')).toBe('FORBIDDEN');
    expect(refused(r, 'other_branch')).toBe('FORBIDDEN:venue_id');
    expect(ok<Punch>(r, 'in').status).toBe('accepted');
    expect(ok<Punch>(r, 'new_phone').reason).toBe('WRONG_DEVICE');
    expect(refused(r, 'reset_self')).toBe('REF_NOT_FOUND:staff_id');
    expect(ok<{ had_device: boolean }>(r, 'reset').had_device).toBe(true);
    expect(ok<Punch>(r, 'new_phone_ok').status).toBe('accepted');
    expect(ok<number>(r, 'wall')).toBe(0);
  });
});
