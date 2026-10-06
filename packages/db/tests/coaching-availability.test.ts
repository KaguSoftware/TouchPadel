/**
 * Coach availability (plan "Coaching: make it bulletproof" TG-01; docs/design/coaching/db.md
 * §4.7.2, build contracts CD-10 as amended by D3, R16). Every other harness gives its coaches
 * hours 00:00-24:00 every day, so the hours and time-off half of `lesson_coach_free` was never
 * reached. Here, in one rolled-back transaction (coaching-core-harness.ts), a coach at an
 * Asia/Baghdad branch works Saturdays only, 09:00-12:00 and 18:00-24:00 local, with one live
 * time off (18:00-19:00) and one cancelled (20:00-21:00):
 *
 *   * app.coach_in_hours, directly: 23:00-24:00 and 09:00-10:00 are in; a period that crosses a
 *     window's end or sits in the gap is out; 01:00 Saturday local is out; 01:00 Sunday local
 *     (22:00 Saturday UTC, inside the evening window read in UTC) is out, so the weekday is the
 *     branch's; inside the live time off is out, inside the cancelled one is in;
 *   * COACH_UNAVAILABLE from every creation path (a guest's, the desk's and the coach's private
 *     booking, the desk's and the coach's group and course, the desk's and the coach's
 *     reschedule), and a booking inside a window still lands;
 *   * coach_slots offers exactly the starts inside the windows, less the time off;
 *   * the branch's own refusals, one each: OUTSIDE_HOURS, CLOSED_DATE, SLOT_IN_PAST.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, scenario, X, type Results } from './stores-harness';
import { at, data, E, failed, FROM, R, SETUP } from './coaching-core-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

/** Saturday `week` weeks on (1: the next week's), `hours` past its local midnight, as timestamptz. */
const SAT_FN = String.raw`
create function pg_temp.sat(p_week int, p_hours numeric) returns timestamptz language sql as $f$
  select (date_trunc('week', now() at time zone 'Asia/Baghdad') + make_interval(days => 5 + 7 * p_week)
          + p_hours * interval '1 hour') at time zone 'Asia/Baghdad'
$f$;
`;
const sat = (hours: number, week = 1) => `pg_temp.sat(${week}, ${hours})`;
const IN_HOURS = (label: string, from: string, to: string) =>
  R(
    label,
    `select to_jsonb(app.coach_in_hours({{c1}}::uuid, {{v}}::uuid, tstzrange(${from}, ${to}, '[)')))`,
  );
const DESK_BOOK = (label: string, coach: string, type: string, when: string) =>
  E(
    label,
    'desk',
    `select app.desk_book_lesson({{${coach}}}, {{${type}}}, ${when}, null, 'Walk In', null, 1, 'k-${label}')`,
  );
const COURSE_STARTS = `array[${sat(9)}, ${sat(13, 2)}, ${sat(9, 3)}, ${sat(9, 4)}]::timestamptz[]`;

describe.skipIf(!docker)('coach hours and time off (TG-01, rolled back)', () => {
  let r: Results;

  beforeAll(() => {
    r = scenario('ctg01', [
      SETUP,
      SAT_FN,
      `select pg_temp.branch('v');`,
      `select pg_temp.branch('w');`,
      `select pg_temp.guest('g1');`,
      `select pg_temp.guest('g2');`,
      `select pg_temp.guest('s1');`,
      `select pg_temp.coach('c1', 'g1', 'v');`,
      `select pg_temp.coach('c2', 'g2', 'w');`,
      `select pg_temp.lt('lt_p', 'private', 'v');`,
      `select pg_temp.lt('lt_g', 'group', 'v');`,
      `select pg_temp.lt('lt_c', 'course', 'v');`,
      `select pg_temp.lt('lt_pw', 'private', 'w');`,
      ...['lt_p', 'lt_g', 'lt_c'].map((t) => `select pg_temp.teach('c1', '${t}');`),
      `select pg_temp.teach('c2', 'lt_pw');`,
      // c1 works Saturdays (dow 6) only: 09:00-12:00 and 18:00-24:00 local.
      X(`delete from coach_hours where coach_id = {{c1}}::uuid`),
      X(`insert into coach_hours (coach_id, venue_id, weekday, start_time, end_time, set_by)
         values ({{c1}}::uuid, {{v}}::uuid, 6, '09:00', '12:00', 'coach'),
                ({{c1}}::uuid, {{v}}::uuid, 6, '18:00', '24:00', 'coach')`),
      X(`insert into coach_time_off (coach_id, period, reason, set_by)
         values ({{c1}}::uuid, tstzrange(${sat(18)}, ${sat(19)}, '[)'), 'live', 'coach')`),
      X(`insert into coach_time_off (coach_id, period, reason, set_by, cancelled_at)
         values ({{c1}}::uuid, tstzrange(${sat(20)}, ${sat(21)}, '[)'), 'cancelled', 'coach', now())`),

      // ── coach_in_hours ──────────────────────────────────────────────────
      IN_HOURS('h_23', sat(23), sat(24)),
      IN_HOURS('h_9', sat(9), sat(10)),
      IN_HOURS('h_cross_end', sat(11.5), sat(12.5)),
      IN_HOURS('h_cross_gap', sat(11), sat(19)),
      IN_HOURS('h_gap', sat(13), sat(14)),
      IN_HOURS('h_sat_1am', sat(1), sat(2)),
      IN_HOURS('h_sun_1am', sat(25), sat(26)),
      IN_HOURS('h_off_live', sat(18), sat(19)),
      IN_HOURS('h_off_cancelled', sat(20), sat(21)),
      R('sun_1am_utc', `select to_jsonb(to_char(${sat(25)} at time zone 'UTC', 'Dy HH24:MI'))`),

      // ── coach_slots, before anything is booked ───────────────────────────
      E('slots', null, `select app.coach_slots({{c1}}, {{lt_p}}, ${sat(0)}, ${sat(24)})`),
      R(
        'slots_expect',
        `select jsonb_agg(to_jsonb(pg_temp.sat(1, h)) order by h)
           from unnest(array[9, 9.5, 10, 10.5, 11, 19, 19.5, 20, 20.5, 21, 21.5, 22, 22.5, 23]::numeric[]) h`,
      ),

      // ── COACH_UNAVAILABLE on every creation path, in the 12:00-18:00 gap ──
      E(
        'u_guest',
        's1',
        `select app.lesson_book_private({{c1}}, {{lt_p}}, ${sat(13)}, 1, '{}'::text[], 'desk', 30000, 'k-u_guest')`,
      ),
      DESK_BOOK('u_desk', 'c1', 'lt_p', sat(13)),
      E(
        'u_coach',
        'g1',
        `select app.coach_book_private({{lt_p}}, {{v}}, ${sat(13)}, 'Student', null, 1, 'k-u_coach')`,
      ),
      E(
        'u_desk_group',
        'desk',
        `select app.desk_create_group({{c1}}, {{lt_g}}, ${sat(13)}, 'k-u_dg')`,
      ),
      E(
        'u_coach_group',
        'g1',
        `select app.coach_create_group({{lt_g}}, {{v}}, ${sat(13)}, 'k-u_cg')`,
      ),
      E(
        'u_desk_course',
        'desk',
        `select app.desk_create_course({{c1}}, {{lt_c}}, ${COURSE_STARTS}, '', '', 'k-u_dc')`,
      ),
      E(
        'u_coach_course',
        'g1',
        `select app.coach_create_course({{lt_c}}, {{v}}, ${COURSE_STARTS}, '', '', 'k-u_cc')`,
      ),
      DESK_BOOK('u_time_off', 'c1', 'lt_p', sat(18)),
      DESK_BOOK('ok_cancelled_off', 'c1', 'lt_p', sat(20)),
      DESK_BOOK('ok_9', 'c1', 'lt_p', sat(9)),
      FROM('ok_9_lesson', 'ok_9', 'lesson_id'),
      E(
        'u_desk_resched',
        'desk',
        `select app.desk_reschedule_session({{ok_9_lesson}}, ${sat(13)})`,
      ),
      E(
        'u_coach_resched',
        'g1',
        `select app.coach_reschedule_session({{ok_9_lesson}}, ${sat(13)})`,
      ),
      R(
        'ok_9_start',
        `select to_jsonb(start_at = ${sat(9)}) from lessons where id = {{ok_9_lesson}}::uuid`,
      ),
      R(
        'c1_lessons',
        `select to_jsonb(count(*)) from lessons where coach_id = {{c1}}::uuid and status in ('held', 'scheduled')`,
      ),

      // ── the branch's own refusals, at w (coach c2 works all day) ──────────
      X(`update venue_settings
            set opening_hours = jsonb_set(opening_hours, '{sat}', '[["10:00","22:00"]]'::jsonb),
                closed_dates = array[(${sat(0, 2)} at time zone 'Asia/Baghdad')::date]
          where venue_id = {{w}}::uuid`),
      DESK_BOOK('outside', 'c2', 'lt_pw', sat(9)),
      DESK_BOOK('closed', 'c2', 'lt_pw', sat(12, 2)),
      DESK_BOOK('past', 'c2', 'lt_pw', at(0, -1)),
      DESK_BOOK('w_ok', 'c2', 'lt_pw', sat(12)),
    ]);
  });

  it('coach_in_hours: inside a window, not across one, not in a gap, the branch weekday, time off', () => {
    expect(data(r, 'h_23')).toBe(true);
    expect(data(r, 'h_9')).toBe(true);
    expect(data(r, 'h_cross_end')).toBe(false);
    expect(data(r, 'h_cross_gap')).toBe(false);
    expect(data(r, 'h_gap')).toBe(false);
    expect(data(r, 'h_sat_1am')).toBe(false);
    // 01:00 Sunday local is 22:00 Saturday UTC: inside 18-24 if the weekday were read in UTC.
    expect(data(r, 'sun_1am_utc')).toBe('Sat 22:00');
    expect(data(r, 'h_sun_1am')).toBe(false);
    expect(data(r, 'h_off_live')).toBe(false);
    expect(data(r, 'h_off_cancelled')).toBe(true);
  });

  it('coach_slots offers the window starts, less the live time off and the starts that run past a window', () => {
    const s = data<{ bookable: boolean; starts: Json[] }>(r, 'slots');
    expect(s.bookable).toBe(true);
    expect(s.starts.map((x) => x.start_at)).toEqual(data(r, 'slots_expect'));
  });

  it('COACH_UNAVAILABLE from the guest, desk and coach bookings, the group and course creates and both reschedules', () => {
    for (const label of [
      'u_guest',
      'u_desk',
      'u_coach',
      'u_desk_group',
      'u_coach_group',
      'u_desk_course',
      'u_coach_course',
      'u_time_off',
      'u_desk_resched',
      'u_coach_resched',
    ])
      expect(failed(r, label).code, label).toBe('COACH_UNAVAILABLE');
    // A course names the session that does not fit.
    expect(failed(r, 'u_desk_course').detail).toBe('2');
    expect(failed(r, 'u_coach_course').detail).toBe('2');
    // Inside a window, and inside the cancelled time off, a booking lands.
    expect(data(r, 'ok_9')).toMatchObject({ duplicate: false });
    expect(data(r, 'ok_cancelled_off')).toMatchObject({ duplicate: false });
    expect(data(r, 'ok_9_start')).toBe(true);
    expect(data(r, 'c1_lessons')).toBe(2);
  });

  it('the branch refuses on its own: OUTSIDE_HOURS, CLOSED_DATE, SLOT_IN_PAST', () => {
    expect(failed(r, 'outside').code).toBe('OUTSIDE_HOURS');
    expect(failed(r, 'closed').code).toBe('CLOSED_DATE');
    expect(failed(r, 'past').code).toBe('SLOT_IN_PAST');
    expect(data(r, 'w_ok')).toMatchObject({ duplicate: false });
  });
});
