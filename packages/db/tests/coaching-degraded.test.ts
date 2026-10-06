/**
 * Degraded mode on lessons (plan "Coaching: make it bulletproof" TG-05; build contracts R15,
 * docs/design/coaching/db.md §4.7). In one rolled-back transaction (coaching-core-harness.ts),
 * branch v trades offline (the owner's offline switch on, its till's heartbeat stale, a day
 * open) and branch w does not:
 *
 *   * every guest and coach path at v (lesson_book_private, lesson_join, course_join,
 *     coach_book_private, coach_create_group, coach_create_course, coach_add_student,
 *     coach_reschedule_session) is DEGRADED_LOCKOUT inside the protected horizon and lands
 *     outside it;
 *   * the desk paths (book, group, course, add, reschedule) and the cancels (guest, coach, desk)
 *     still work inside it;
 *   * branch w is unaffected.
 *
 * The SUCCESS-while-offline branch (O8: refund_pending, reason venue_offline) is
 * coaching-sweep.test.ts's DB-35 case. Plus a source-text pin: the latest body of each R15
 * function calls assert_not_degraded_for, and the coach creates and reschedule pass the
 * degraded flag their internal body tests.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, scenario, X, type Results } from './stores-harness';
import { at, data, E, failed, FROM, R, SETUP } from './coaching-core-harness';
import { latestBody } from './coaching-source';

const up = await stackAvailable();
const docker = up && dockerReachable();

/** Inside the 48-hour protected horizon (day 1) and outside it (day 3). */
const IN = (h: number) => at(1, h);
const OUT = (h: number) => at(3, h);
const COURSE_AT = (day: number, h: number) =>
  `array[${at(day, h)}, ${at(day + 7, h)}, ${at(day + 14, h)}, ${at(day + 21, h)}]::timestamptz[]`;

const GUEST_BOOK = (label: string, who: string, type: string, when: string) =>
  E(
    label,
    who,
    `select app.lesson_book_private({{c1}}, {{${type}}}, ${when}, 1, '{}'::text[], 'desk', 30000, 'k-${label}')`,
  );

describe.skipIf(!docker)('DEGRADED_LOCKOUT on lesson paths (TG-05, rolled back)', () => {
  let r: Results;
  const guestPaths = ['g_book', 'g_join', 'g_course'] as const;
  const coachPaths = ['c_book', 'c_group', 'c_course', 'c_add', 'c_resched'] as const;

  beforeAll(() => {
    r = scenario('ctg05', [
      SETUP,
      `select pg_temp.branch('v');`,
      `select pg_temp.branch('w');`,
      `select pg_temp.guest('g1');`,
      ...['s1', 's2', 's3', 's4'].map((g) => `select pg_temp.guest('${g}');`),
      `select pg_temp.coach('c1', 'g1', 'v');`,
      `select pg_temp.at_branch('c1', 'w');`,
      `select pg_temp.lt('lt_p', 'private', 'v');`,
      `select pg_temp.lt('lt_g', 'group', 'v');`,
      `select pg_temp.lt('lt_c', 'course', 'v');`,
      `select pg_temp.lt('lt_pw', 'private', 'w');`,
      ...['lt_p', 'lt_g', 'lt_c', 'lt_pw'].map((t) => `select pg_temp.teach('c1', '${t}');`),

      // v trades offline: the switch on, its till quiet for ten minutes, a day open.
      X(`update venue_settings set offline_mode_enabled = true, protected_horizon_hours = 48
          where venue_id = {{v}}::uuid`),
      X(`insert into stations (id, venue_id, is_till, mode)
         values ('TILL-CTG05-' || upper(left({{v}}, 8)), {{v}}::uuid, true, 'till')`),
      X(`insert into device_heartbeats (device_id, venue_id, is_till, last_seen_at)
         values ('TILL-CTG05-' || upper(left({{v}}, 8)), {{v}}::uuid, true, now() - interval '10 minutes')`),
      X(`insert into day_sessions (venue_id, business_date, status, opened_by, opening_float_iqd)
         values ({{v}}::uuid, date '4999-12-31', 'open', {{manager}}::uuid, 0)`),
      R(
        'degraded',
        `select jsonb_build_object('v', app.is_degraded({{v}}::uuid), 'w', app.is_degraded({{w}}::uuid))`,
      ),

      // The desk stages inside the horizon: a group, a course, a private lesson.
      E(
        'd_group_in',
        'desk',
        `select app.desk_create_group({{c1}}, {{lt_g}}, ${IN(2)}, 'k-d_group_in')`,
      ),
      FROM('grp_in', 'd_group_in', 'lesson_id'),
      E(
        'd_group_out',
        'desk',
        `select app.desk_create_group({{c1}}, {{lt_g}}, ${OUT(2)}, 'k-d_group_out')`,
      ),
      FROM('grp_out', 'd_group_out', 'lesson_id'),
      E(
        'd_course_in',
        'desk',
        `select app.desk_create_course({{c1}}, {{lt_c}}, ${COURSE_AT(1, 4)}, '', '', 'k-d_course_in')`,
      ),
      FROM('crs_in', 'd_course_in', 'course_id'),
      E(
        'd_course_out',
        'desk',
        `select app.desk_create_course({{c1}}, {{lt_c}}, ${COURSE_AT(3, 4)}, '', '', 'k-d_course_out')`,
      ),
      FROM('crs_out', 'd_course_out', 'course_id'),
      E(
        'd_book_in',
        'desk',
        `select app.desk_book_lesson({{c1}}, {{lt_p}}, ${IN(6)}, null, 'Walk In', null, 1, 'k-d_book_in')`,
      ),
      FROM('d_book_in_l', 'd_book_in', 'lesson_id'),
      E(
        'd_add_in',
        'desk',
        `select app.desk_add_student({{grp_in}}, null, null, 'Walk In', null, 'k-d_add_in')`,
      ),
      E('d_resched_in', 'desk', `select app.desk_reschedule_session({{d_book_in_l}}, ${IN(8)})`),

      // Guests: inside refused, outside lands.
      GUEST_BOOK('g_book_in', 's1', 'lt_p', IN(10)),
      GUEST_BOOK('g_book_out', 's1', 'lt_p', OUT(10)),
      FROM('g_book_out_e', 'g_book_out', 'enrolment_id'),
      E('g_join_in', 's2', `select app.lesson_join({{grp_in}}, 'desk', 15000, 'k-g_join_in')`),
      E('g_join_out', 's2', `select app.lesson_join({{grp_out}}, 'desk', 15000, 'k-g_join_out')`),
      E('g_course_in', 's3', `select app.course_join({{crs_in}}, 'desk', 80000, 'k-g_course_in')`),
      E(
        'g_course_out',
        's3',
        `select app.course_join({{crs_out}}, 'desk', 80000, 'k-g_course_out')`,
      ),

      // The coach: inside refused, outside lands.
      E(
        'c_book_in',
        'g1',
        `select app.coach_book_private({{lt_p}}, {{v}}, ${IN(12)}, 'Student', null, 1, 'k-c_book_in')`,
      ),
      E(
        'c_book_out',
        'g1',
        `select app.coach_book_private({{lt_p}}, {{v}}, ${OUT(12)}, 'Student', null, 1, 'k-c_book_out')`,
      ),
      FROM('c_book_out_l', 'c_book_out', 'lesson_id'),
      E(
        'c_group_in',
        'g1',
        `select app.coach_create_group({{lt_g}}, {{v}}, ${IN(14)}, 'k-c_group_in')`,
      ),
      E(
        'c_group_out',
        'g1',
        `select app.coach_create_group({{lt_g}}, {{v}}, ${OUT(14)}, 'k-c_group_out')`,
      ),
      E(
        'c_course_in',
        'g1',
        `select app.coach_create_course({{lt_c}}, {{v}}, ${COURSE_AT(1, 16)}, '', '', 'k-c_course_in')`,
      ),
      E(
        'c_course_out',
        'g1',
        `select app.coach_create_course({{lt_c}}, {{v}}, ${COURSE_AT(3, 16)}, '', '', 'k-c_course_out')`,
      ),
      E(
        'c_add_in',
        'g1',
        `select app.coach_add_student({{grp_in}}, null, 'Typed', null, 'k-c_add_in')`,
      ),
      E(
        'c_add_out',
        'g1',
        `select app.coach_add_student({{grp_out}}, null, 'Typed', null, 'k-c_add_out')`,
      ),
      E('c_resched_in', 'g1', `select app.coach_reschedule_session({{c_book_out_l}}, ${IN(18)})`),
      E('c_resched_out', 'g1', `select app.coach_reschedule_session({{c_book_out_l}}, ${OUT(18)})`),

      // Cancels still work inside the horizon (and outside).
      E('x_guest_cancel', 's1', `select app.lesson_cancel_mine({{g_book_out_e}})`),
      E(
        'x_coach_cancel',
        'g1',
        `select app.coach_cancel_lesson({{c_book_out_l}}, 'coach_unavailable')`,
      ),
      E('x_desk_cancel', 'desk', `select app.desk_cancel_lesson({{d_book_in_l}}, 'staff_error')`),

      // w trades normally: inside its horizon too.
      GUEST_BOOK('w_guest_in', 's4', 'lt_pw', IN(20)),
      E(
        'w_coach_in',
        'g1',
        `select app.coach_book_private({{lt_pw}}, {{w}}, ${IN(22)}, 'Student', null, 1, 'k-w_coach_in')`,
      ),
    ]);
  });

  it('v is degraded, w is not', () => {
    expect(data(r, 'degraded')).toEqual({ v: true, w: false });
  });

  it('every guest and coach path is DEGRADED_LOCKOUT inside the horizon and lands outside it', () => {
    for (const p of [...guestPaths, ...coachPaths]) {
      expect(failed(r, `${p}_in`).code, `${p}_in`).toBe('DEGRADED_LOCKOUT');
      data(r, `${p}_out`);
    }
  });

  it('the desk paths and the cancels still work inside the horizon', () => {
    for (const label of [
      'd_group_in',
      'd_course_in',
      'd_book_in',
      'd_add_in',
      'd_resched_in',
      'x_guest_cancel',
      'x_coach_cancel',
      'x_desk_cancel',
    ])
      data(r, label);
  });

  it('the other branch is unaffected', () => {
    data(r, 'w_guest_in');
    data(r, 'w_coach_in');
  });
});

describe('every R15 path tests degraded mode (TG-05, source)', () => {
  it.each([
    'lesson_book_private',
    'lesson_join',
    'course_join',
    'coach_book_private',
    'coach_add_student',
  ])('%s calls assert_not_degraded_for', (fn) => {
    expect(latestBody(fn).body).toMatch(/app\.assert_not_degraded_for\s*\(/);
  });

  it.each([
    ['coach_create_group', 'lesson_group_create_internal'],
    ['coach_create_course', 'lesson_course_create_internal'],
    ['coach_reschedule_session', 'lesson_reschedule_internal'],
  ])('%s passes the degraded flag, and %s tests it', (fn, inner) => {
    const call = new RegExp(`app\\.${inner}\\s*\\(([\\s\\S]*?)\\);`).exec(latestBody(fn).body);
    expect(call, fn).not.toBeNull();
    expect(call![1]!.trim()).toMatch(/,\s*true$/);
    expect(latestBody(inner).body).toMatch(
      /if coalesce\(p_degraded, false\) then\s+perform app\.assert_not_degraded_for\(/,
    );
  });
});
