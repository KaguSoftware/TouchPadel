/**
 * Cross-branch and cross-coach writes (plan "Coaching: make it bulletproof" TG-06; build
 * contracts C-26, R42; docs/design/coaching/db.md §4.8). In one rolled-back transaction
 * (coaching-core-harness.ts):
 *
 *   * a branch x where the seeded desk and manager do not work (pg_temp.branch(..., p_staff
 *     false)), with a private lesson, a group session with a guest's place and a course on it:
 *     every desk write on those rows (cancel lesson, course and place, mark, court move,
 *     reschedule, add to the session and to the course, settle) is LESSON_NOT_FOUND or
 *     ENROLMENT_NOT_FOUND, and nothing on the branch changes; desk_lesson_detail is
 *     LESSON_NOT_FOUND and customer_lessons shows the guest's place at the desk's own branch only;
 *   * coach c2 cancelling coach c1's lesson or course, or removing c1's student, is refused and
 *     changes nothing.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, scenario, type Results } from './stores-harness';
import { at, data, E, failed, FROM, R, SETUP } from './coaching-core-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

/** Every lesson, course and enrolment of a branch, in a stable order, as jsonb. */
const SNAPSHOT = (label: string, venue: string) =>
  R(
    label,
    `select jsonb_build_object(
       'lessons', (select jsonb_agg(to_jsonb(l) order by l.id) from lessons l where l.venue_id = {{${venue}}}::uuid),
       'courses', (select jsonb_agg(to_jsonb(c) order by c.id) from courses c where c.venue_id = {{${venue}}}::uuid),
       'enrolments', (select jsonb_agg(to_jsonb(e) order by e.id) from lesson_enrolments e
                       where e.venue_id = {{${venue}}}::uuid),
       'courts', (select jsonb_agg(to_jsonb(r) order by r.id) from reservations r
                   where r.venue_id = {{${venue}}}::uuid),
       'attendance', (select count(*) from lesson_attendance a where a.venue_id = {{${venue}}}::uuid))`,
  );

const DESK_WRITES: ReadonlyArray<readonly [string, string, string]> = [
  ['d_cancel_lesson', `select app.desk_cancel_lesson({{xp_l}}, 'staff_error')`, 'LESSON_NOT_FOUND'],
  ['d_cancel_group', `select app.desk_cancel_lesson({{xg_l}}, 'staff_error')`, 'LESSON_NOT_FOUND'],
  [
    'd_cancel_course',
    `select app.desk_cancel_course({{xk_id}}, 'staff_error')`,
    'LESSON_NOT_FOUND',
  ],
  [
    'd_cancel_place',
    `select app.desk_cancel_enrolment({{xj_e}}, 'customer_request')`,
    'ENROLMENT_NOT_FOUND',
  ],
  ['d_mark', `select app.desk_mark_attendance({{xg_l}}, {{xj_e}}, 'attended')`, 'LESSON_NOT_FOUND'],
  ['d_move_court', `select app.desk_move_lesson_court({{xp_l}}, {{x_c2}})`, 'LESSON_NOT_FOUND'],
  ['d_reschedule', `select app.desk_reschedule_session({{xp_l}}, ${at(4, 6)})`, 'LESSON_NOT_FOUND'],
  [
    'd_add_session',
    `select app.desk_add_student({{xg_l}}, null, null, 'Walk X', null, 'k-d_add_session')`,
    'LESSON_NOT_FOUND',
  ],
  [
    'd_add_course',
    `select app.desk_add_student(null, {{xk_id}}, null, 'Walk X', null, 'k-d_add_course')`,
    'LESSON_NOT_FOUND',
  ],
  [
    'd_settle',
    `select app.lesson_settle({{xj_e}}, 'cash', 15000, 15000, 'k-d_settle', null)`,
    'ENROLMENT_NOT_FOUND',
  ],
];

const COACH_WRITES: ReadonlyArray<readonly [string, string, string]> = [
  [
    'c_cancel_lesson',
    `select app.coach_cancel_lesson({{vp_l}}, 'coach_unavailable')`,
    'LESSON_NOT_FOUND',
  ],
  [
    'c_cancel_course',
    `select app.coach_cancel_course({{vk_id}}, 'coach_unavailable')`,
    'LESSON_NOT_FOUND',
  ],
  ['c_remove', `select app.coach_remove_student({{vj_e}}, 'other')`, 'ENROLMENT_NOT_FOUND'],
];

describe.skipIf(!docker)(
  'cross-branch and cross-coach writes are scoped (TG-06, rolled back)',
  () => {
    let r: Results;

    beforeAll(() => {
      r = scenario('ctg06', [
        SETUP,
        `select pg_temp.branch('v');`,
        `select pg_temp.branch('x', true, false);`,
        `select pg_temp.guest('g1');`,
        `select pg_temp.guest('g2');`,
        `select pg_temp.guest('s1');`,
        `select pg_temp.coach('c1', 'g1', 'v');`,
        `select pg_temp.at_branch('c1', 'x');`,
        `select pg_temp.coach('c2', 'g2', 'v');`,
        ...['v', 'x'].flatMap((b) => [
          `select pg_temp.lt('${b}_p', 'private', '${b}');`,
          `select pg_temp.lt('${b}_g', 'group', '${b}');`,
          `select pg_temp.lt('${b}_c', 'course', '${b}');`,
          `select pg_temp.teach('c1', '${b}_p');`,
          `select pg_temp.teach('c1', '${b}_g');`,
          `select pg_temp.teach('c1', '${b}_c');`,
        ]),

        // At x, made by the coach (the desk cannot reach the branch).
        E(
          'xp',
          'g1',
          `select app.coach_book_private({{x_p}}, {{x}}, ${at(3)}, 'Student X', null, 1, 'k-xp')`,
        ),
        FROM('xp_l', 'xp', 'lesson_id'),
        E('xg', 'g1', `select app.coach_create_group({{x_g}}, {{x}}, ${at(3, 2)}, 'k-xg')`),
        FROM('xg_l', 'xg', 'lesson_id'),
        E('xj', 's1', `select app.lesson_join({{xg_l}}, 'desk', 15000, 'k-xj')`),
        FROM('xj_e', 'xj', 'enrolment_id'),
        E(
          'xk',
          'g1',
          `select app.coach_create_course({{x_c}}, {{x}},
           array[${at(5)}, ${at(6)}, ${at(7)}, ${at(8)}]::timestamptz[], '', '', 'k-xk')`,
        ),
        FROM('xk_id', 'xk', 'course_id'),
        // At v, the desk's own branch: c1's rows for coach c2 to reach for, and s1's place there.
        E(
          'vp',
          'g1',
          `select app.coach_book_private({{v_p}}, {{v}}, ${at(10)}, 'Student V', null, 1, 'k-vp')`,
        ),
        FROM('vp_l', 'vp', 'lesson_id'),
        FROM('vp_e', 'vp', 'enrolment_id'),
        E('vg', 'g1', `select app.coach_create_group({{v_g}}, {{v}}, ${at(10, 2)}, 'k-vg')`),
        FROM('vg_l', 'vg', 'lesson_id'),
        E('vj', 's1', `select app.lesson_join({{vg_l}}, 'desk', 15000, 'k-vj')`),
        FROM('vj_e', 'vj', 'enrolment_id'),
        E(
          'vk',
          'g1',
          `select app.coach_create_course({{v_c}}, {{v}},
           array[${at(12)}, ${at(13)}, ${at(14)}, ${at(15)}]::timestamptz[], '', '', 'k-vk')`,
        ),
        FROM('vk_id', 'vk', 'course_id'),

        SNAPSHOT('x_before', 'x'),
        ...DESK_WRITES.map(([label, sql]) => E(label, 'desk', sql)),
        ...DESK_WRITES.map(([label, sql]) => E(`m_${label}`, 'manager', sql)),
        E('d_detail', 'desk', `select app.desk_lesson_detail({{xg_l}})`),
        E('d_customer', 'desk', `select app.customer_lessons({{s1}})`),
        SNAPSHOT('x_after', 'x'),

        SNAPSHOT('v_before', 'v'),
        ...COACH_WRITES.map(([label, sql]) => E(label, 'g2', sql)),
        SNAPSHOT('v_after', 'v'),
        // The control: the same writes by the coach whose rows they are.
        E('own_remove', 'g1', `select app.coach_remove_student({{vj_e}}, 'other')`),
        E('own_cancel', 'g1', `select app.coach_cancel_lesson({{vp_l}}, 'coach_unavailable')`),
      ]);
    });

    it('the rows were made at x', () => {
      for (const label of ['xp', 'xg', 'xj', 'xk', 'vp', 'vg', 'vj', 'vk']) data(r, label);
    });

    it('every desk write on another branch is not found, for the desk and the manager, and x is unchanged', () => {
      for (const [label, , want] of DESK_WRITES) {
        expect(failed(r, label).code, label).toBe(want);
        expect(failed(r, `m_${label}`).code, `m_${label}`).toBe(want);
      }
      expect(data(r, 'x_after')).toEqual(data(r, 'x_before'));
    });

    it('the reads hide it: desk_lesson_detail is LESSON_NOT_FOUND; customer_lessons shows only the desk branch', () => {
      expect(failed(r, 'd_detail').code).toBe('LESSON_NOT_FOUND');
      const c = data<{ counts: Json; lessons: Json[] }>(r, 'd_customer');
      expect(c.lessons.map((l) => l.enrolment_id)).toEqual([data<Json>(r, 'vj').enrolment_id]);
      expect(c.counts).toMatchObject({ lessons: 1 });
    });

    it("coach c2 cannot cancel coach c1's lesson or course or remove c1's student; c1 can", () => {
      for (const [label, , want] of COACH_WRITES) expect(failed(r, label).code, label).toBe(want);
      expect(data(r, 'v_after')).toEqual(data(r, 'v_before'));
      data(r, 'own_remove');
      data(r, 'own_cancel');
    });
  },
);
