/**
 * Coaching rules the core suites never reached (plan "Coaching: make it bulletproof"), each in a
 * rolled-back transaction of its own (coaching-core-harness.ts):
 *
 *   * TG-07, sign-up and join closing (C-15, R39, R48): course_join and both adds past
 *     signup_closes_at, on a cancelled course and on a completed one are LESSON_CLOSED;
 *     lesson_join on a started, a cancelled and a completed group session is LESSON_CLOSED; a
 *     coach's and the desk's add still land after the start and before the end, and are
 *     LESSON_CLOSED after it; no refusal changes an enrolment count;
 *   * TG-08, reschedule collisions (R32, R34, R66, D-24): COACH_BUSY, NO_COURT_FREE and
 *     COACH_UNAVAILABLE; the lesson keeps its court when it is free at the new time and is moved
 *     to the other court when not; SESSION_NOT_MOVABLE started and ended; INVALID_TRANSITION held;
 *     a session whose cut-off was judged moves inside its old cut-off and keeps the stamp, while an
 *     unjudged one is LESSON_CLOSED cutoff;
 *   * TG-11, the attendance window and corrections (CD-11, CD-2, R31): 25 hours after the start
 *     is marks_closed, 23 hours is still markable; clear removes the no-show and its strike and a
 *     second clear is a duplicate; an attended correction keeps a strike already settled; the
 *     not_booked and cancelled refusals; a course place outside its session range is
 *     ENROLMENT_NOT_FOUND.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { stackAvailable } from './helpers';
import { dockerReachable, scenario, X, type Results } from './stores-harness';
import { at, code, data, E, failed, FROM, K, R, SETUP } from './coaching-core-harness';

const up = await stackAvailable();
const docker = up && dockerReachable();

type Json = Record<string, unknown>;

const COURSE = (label: string, coach: string, type: string, day: number) =>
  E(
    label,
    'desk',
    `select app.desk_create_course({{${coach}}}, {{${type}}},
       array[${at(day)}, ${at(day + 1)}, ${at(day + 2)}, ${at(day + 3)}]::timestamptz[], '', '', 'k-${label}')`,
  );
const GROUP = (label: string, coach: string, when: string) =>
  E(label, 'desk', `select app.desk_create_group({{${coach}}}, {{lt_g}}, ${when}, 'k-${label}')`);
const DESK_BOOK = (label: string, coach: string, when: string) =>
  E(
    label,
    'desk',
    `select app.desk_book_lesson({{${coach}}}, {{lt_p}}, ${when}, null, 'Walk In', null, 1, 'k-${label}')`,
  );
const GUEST_BOOK = (label: string, who: string, when: string, mode = 'desk') =>
  E(
    label,
    who,
    `select app.lesson_book_private({{c1}}, {{lt_p}}, ${when}, 1, '{}'::text[], '${mode}', 30000, 'k-${label}')`,
  );
/** Move a lesson so it started `startMin` minutes ago and runs `minutes` (a group keeps a cut-off 2 h before). */
const STARTED = (lesson: string, startMin: number, minutes = 60) =>
  X(`update lessons
        set start_at = now() - interval '${startMin} minutes',
            end_at = now() - interval '${startMin} minutes' + interval '${minutes} minutes',
            cutoff_at = case when kind = 'private' then null
                             else now() - interval '${startMin} minutes' - interval '2 hours' end
      where id = {{${lesson}}}::uuid`);
const ADDS = (prefix: string, lesson: string | null, course: string | null) => {
  const l = lesson ? `{{${lesson}}}` : 'null';
  const c = course ? `{{${course}}}` : 'null';
  return [
    E(
      `${prefix}_coach_add`,
      'g1',
      `select app.coach_add_student(${l}, ${c}, 'Typed ${prefix}', null, 'k-${prefix}-ca')`,
    ),
    E(
      `${prefix}_desk_add`,
      'desk',
      `select app.desk_add_student(${l}, ${c}, null, 'Walk ${prefix}', null, 'k-${prefix}-da')`,
    ),
  ];
};

// ── TG-07 ────────────────────────────────────────────────────────────────

describe.skipIf(!docker)('sign-up and join closing rules (TG-07, rolled back)', () => {
  let r: Results;
  const COUNTS = (label: string) =>
    R(
      label,
      `select jsonb_object_agg(k, n) from (
         select 'k_signup' k, count(*) n from lesson_enrolments where course_id = {{k_signup_id}}::uuid
         union all select 'k_cancel', count(*) from lesson_enrolments where course_id = {{k_cancel_id}}::uuid
         union all select 'k_done', count(*) from lesson_enrolments where course_id = {{k_done_id}}::uuid
         union all select 'g_started', count(*) from lesson_enrolments where lesson_id = {{g_started_id}}::uuid
         union all select 'g_ended', count(*) from lesson_enrolments where lesson_id = {{g_ended_id}}::uuid
         union all select 'g_cancel', count(*) from lesson_enrolments where lesson_id = {{g_cancel_id}}::uuid
         union all select 'g_done', count(*) from lesson_enrolments where lesson_id = {{g_done_id}}::uuid) x`,
    );

  beforeAll(() => {
    r = scenario('ctg07', [
      SETUP,
      `select pg_temp.branch('v');`,
      `select pg_temp.guest('g1');`,
      `select pg_temp.guest('s1');`,
      `select pg_temp.coach('c1', 'g1', 'v');`,
      `select pg_temp.lt('lt_g', 'group', 'v');`,
      `select pg_temp.lt('lt_c', 'course', 'v');`,
      `select pg_temp.teach('c1', 'lt_g');`,
      `select pg_temp.teach('c1', 'lt_c');`,
      COURSE('k_signup', 'c1', 'lt_c', 3),
      FROM('k_signup_id', 'k_signup', 'course_id'),
      COURSE('k_cancel', 'c1', 'lt_c', 8),
      FROM('k_cancel_id', 'k_cancel', 'course_id'),
      COURSE('k_done', 'c1', 'lt_c', 13),
      FROM('k_done_id', 'k_done', 'course_id'),
      GROUP('g_started', 'c1', at(1)),
      FROM('g_started_id', 'g_started', 'lesson_id'),
      GROUP('g_ended', 'c1', at(1, 2)),
      FROM('g_ended_id', 'g_ended', 'lesson_id'),
      GROUP('g_cancel', 'c1', at(1, 4)),
      FROM('g_cancel_id', 'g_cancel', 'lesson_id'),
      GROUP('g_done', 'c1', at(1, 6)),
      FROM('g_done_id', 'g_done', 'lesson_id'),

      // Sign-up closed (the last start passed), a cancelled course, a completed one.
      X(`update courses set cutoff_at = now() - interval '2 hours', signup_closes_at = now() - interval '1 minute'
          where id = {{k_signup_id}}::uuid`),
      E('k_cancel_do', 'desk', `select app.desk_cancel_course({{k_cancel_id}}, 'staff_error')`),
      X(`update courses set status = 'completed' where id = {{k_done_id}}::uuid`),
      // A session under way, one over, one cancelled, one completed.
      STARTED('g_started_id', 30),
      STARTED('g_ended_id', 120),
      E('g_cancel_do', 'desk', `select app.desk_cancel_lesson({{g_cancel_id}}, 'court_needed')`),
      X(
        `update lessons set status = 'completed', completed_at = now() where id = {{g_done_id}}::uuid`,
      ),
      COUNTS('before'),

      ...['k_signup', 'k_cancel', 'k_done'].flatMap((k) => [
        E(`${k}_join`, 's1', `select app.course_join({{${k}_id}}, 'desk', 80000, 'k-${k}-join')`),
        ...ADDS(k, null, `${k}_id`),
      ]),
      ...['g_started', 'g_ended', 'g_cancel', 'g_done'].map((g) =>
        E(`${g}_join`, 's1', `select app.lesson_join({{${g}_id}}, 'desk', 15000, 'k-${g}-join')`),
      ),
      ...ADDS('g_ended', 'g_ended_id', null),
      ...ADDS('g_cancel', 'g_cancel_id', null),
      ...ADDS('g_done', 'g_done_id', null),
      COUNTS('after_refusals'),
      // R39: adds still land while the session runs.
      ...ADDS('g_started', 'g_started_id', null),
      COUNTS('after_adds'),
    ]);
  });

  it('a course past sign-up, cancelled or completed: course_join and both adds are LESSON_CLOSED', () => {
    for (const k of ['k_signup', 'k_cancel', 'k_done'])
      for (const s of ['join', 'coach_add', 'desk_add'])
        expect(failed(r, `${k}_${s}`).code, `${k}_${s}`).toBe('LESSON_CLOSED');
  });

  it('lesson_join on a started, cancelled or completed session is LESSON_CLOSED; adds after the end too', () => {
    for (const g of ['g_started', 'g_ended', 'g_cancel', 'g_done'])
      expect(failed(r, `${g}_join`).code, g).toBe('LESSON_CLOSED');
    for (const g of ['g_ended', 'g_cancel', 'g_done'])
      for (const s of ['coach_add', 'desk_add'])
        expect(failed(r, `${g}_${s}`).code, `${g}_${s}`).toBe('LESSON_CLOSED');
  });

  it('R39: the coach and the desk add after the start and before the end', () => {
    expect(data(r, 'g_started_coach_add')).toMatchObject({ duplicate: false, places_left: 2 });
    expect(data(r, 'g_started_desk_add')).toMatchObject({ duplicate: false, places_left: 1 });
  });

  it('no refusal changes an enrolment count', () => {
    const before = data<Record<string, number>>(r, 'before');
    expect(data(r, 'after_refusals')).toEqual(before);
    expect(data(r, 'after_adds')).toEqual({ ...before, g_started: before.g_started! + 2 });
  });
});

// ── TG-08 ────────────────────────────────────────────────────────────────

describe.skipIf(!docker)('reschedule collisions (TG-08, rolled back)', () => {
  let r: Results;

  beforeAll(() => {
    r = scenario('ctg08', [
      SETUP,
      `select pg_temp.branch('v');`,
      `select pg_temp.guest('g1');`,
      `select pg_temp.guest('g2');`,
      `select pg_temp.guest('g3');`,
      `select pg_temp.guest('s1');`,
      `select pg_temp.coach('c1', 'g1', 'v');`,
      `select pg_temp.coach('c2', 'g2', 'v');`,
      `select pg_temp.coach('c3', 'g3', 'v');`,
      `select pg_temp.lt('lt_p', 'private', 'v');`,
      `select pg_temp.lt('lt_g', 'group', 'v');`,
      ...['c1', 'c2', 'c3'].flatMap((c) => [
        `select pg_temp.teach('${c}', 'lt_p');`,
        `select pg_temp.teach('${c}', 'lt_g');`,
      ]),

      // c1: the lesson L that moves, and another lesson of the same coach.
      DESK_BOOK('L', 'c1', at(2)),
      FROM('L_id', 'L', 'lesson_id'),
      FROM('L_court', 'L', 'court_id'),
      R('L_court_r', `select to_jsonb({{L_court}}::text)`),
      DESK_BOOK('busy', 'c1', at(2, 4)),
      E('m_busy', 'desk', `select app.desk_reschedule_session({{L_id}}, ${at(2, 4)})`),
      `select pg_temp.booking('v_c1', ${at(3)});`,
      `select pg_temp.booking('v_c2', ${at(3)});`,
      E('m_full', 'desk', `select app.desk_reschedule_session({{L_id}}, ${at(3)})`),
      X(`insert into coach_time_off (coach_id, period, reason, set_by)
         values ({{c1}}::uuid, tstzrange(${at(5)}, ${at(6)}, '[)'), 'away', 'coach')`),
      E('m_away', 'desk', `select app.desk_reschedule_session({{L_id}}, ${at(5)})`),
      R(
        'L_after_refusals',
        `select to_jsonb(start_at = ${at(2)}) from lessons where id = {{L_id}}::uuid`,
      ),
      E('m_keep', 'desk', `select app.desk_reschedule_session({{L_id}}, ${at(2, 8)})`),
      // L's own court is taken at the next time: the other court.
      `select pg_temp.booking('L_court', ${at(4)});`,
      E('m_repick', 'g1', `select app.coach_reschedule_session({{L_id}}, ${at(4)})`),
      R(
        'L_rows',
        `select jsonb_agg(jsonb_build_object('court', court_id, 'start_ok', start_at = ${at(4)}))
           from reservations where lesson_id = {{L_id}}::uuid and status in ('pending', 'confirmed', 'arrived')`,
      ),

      // c3: started and ended.
      DESK_BOOK('S', 'c3', at(6)),
      FROM('S_id', 'S', 'lesson_id'),
      STARTED('S_id', 10),
      E('m_started', 'desk', `select app.desk_reschedule_session({{S_id}}, ${at(7)})`),
      DESK_BOOK('Ec', 'c3', at(6, 2)),
      FROM('Ec_id', 'Ec', 'lesson_id'),
      E('Ec_cancel', 'desk', `select app.desk_cancel_lesson({{Ec_id}}, 'staff_error')`),
      E('m_ended', 'desk', `select app.desk_reschedule_session({{Ec_id}}, ${at(7, 2)})`),
      DESK_BOOK('Ed', 'c3', at(6, 4)),
      FROM('Ed_id', 'Ed', 'lesson_id'),
      X(`update lessons set status = 'completed', completed_at = now() where id = {{Ed_id}}::uuid`),
      E('m_completed', 'g3', `select app.coach_reschedule_session({{Ed_id}}, ${at(7, 4)})`),

      // c1, held online.
      `select pg_temp.online('v');`,
      GUEST_BOOK('H', 's1', at(8), 'online'),
      FROM('H_id', 'H', 'lesson_id'),
      E('m_held', 'desk', `select app.desk_reschedule_session({{H_id}}, ${at(8, 2)})`),

      // c2: a judged cut-off moves inside its old cut-off and keeps the stamp; an unjudged one may not.
      GROUP('G1', 'c2', at(1)),
      FROM('G1_id', 'G1', 'lesson_id'),
      X(
        `update lessons set cutoff_checked_at = now() - interval '1 minute' where id = {{G1_id}}::uuid`,
      ),
      R('G1_cutoff', `select to_jsonb(cutoff_at) from lessons where id = {{G1_id}}::uuid`),
      E('m_judged', 'desk', `select app.desk_reschedule_session({{G1_id}}, ${at(0, 1)})`),
      R(
        'G1_after',
        `select jsonb_build_object('checked', cutoff_checked_at = now() - interval '1 minute',
                                  'cutoff', cutoff_at, 'start_ok', start_at = ${at(0, 1)})
           from lessons where id = {{G1_id}}::uuid`,
      ),
      GROUP('G2', 'c2', at(1, 4)),
      FROM('G2_id', 'G2', 'lesson_id'),
      E('m_unjudged', 'desk', `select app.desk_reschedule_session({{G2_id}}, ${at(0, 2)})`),
    ]);
  });

  it('COACH_BUSY, NO_COURT_FREE and COACH_UNAVAILABLE leave the lesson where it was', () => {
    expect(failed(r, 'm_busy').code).toBe('COACH_BUSY');
    expect(failed(r, 'm_full').code).toBe('NO_COURT_FREE');
    expect(failed(r, 'm_away').code).toBe('COACH_UNAVAILABLE');
    expect(data(r, 'L_after_refusals')).toBe(true);
  });

  it('the court is kept when it is free at the new time and re-picked when it is not', () => {
    const court = data(r, 'L_court_r');
    expect(data<Json>(r, 'm_keep')).toMatchObject({ duplicate: false, court_id: court });
    const moved = data<Json>(r, 'm_repick');
    expect(moved.duplicate).toBe(false);
    expect(moved.court_id).not.toBe(court);
    expect(data(r, 'L_rows')).toEqual([{ court: moved.court_id, start_ok: true }]);
  });

  it('SESSION_NOT_MOVABLE started and ended; INVALID_TRANSITION held', () => {
    expect(code(r, 'm_started')).toBe('SESSION_NOT_MOVABLE:started');
    expect(code(r, 'm_ended')).toBe('SESSION_NOT_MOVABLE:ended');
    expect(code(r, 'm_completed')).toBe('SESSION_NOT_MOVABLE:ended');
    expect(data<Json>(r, 'H')).toMatchObject({ status: 'held' });
    expect(code(r, 'm_held')).toBe('INVALID_TRANSITION:held');
  });

  it('R66: a judged cut-off keeps its stamp and its time; an unjudged one is LESSON_CLOSED cutoff', () => {
    expect(data<Json>(r, 'm_judged')).toMatchObject({ duplicate: false });
    expect(data(r, 'G1_after')).toEqual({
      checked: true,
      cutoff: data(r, 'G1_cutoff'),
      start_ok: true,
    });
    expect(code(r, 'm_unjudged')).toBe('LESSON_CLOSED:cutoff');
  });
});

// ── TG-11 ────────────────────────────────────────────────────────────────

describe.skipIf(!docker)('the attendance window and corrections (TG-11, rolled back)', () => {
  let r: Results;
  const MARK = (label: string, lesson: string, enrolment: string, status: string) =>
    E(
      label,
      'desk',
      `select app.desk_mark_attendance({{${lesson}}}, {{${enrolment}}}, '${status}')`,
    );
  const STRIKE = (label: string, enrolment: string) =>
    R(
      label,
      `select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'settled', settled_at is not null)), '[]'::jsonb)
         from lesson_strikes where enrolment_id = {{${enrolment}}}::uuid`,
    );

  beforeAll(() => {
    r = scenario('ctg11', [
      SETUP,
      `select pg_temp.branch('v');`,
      X(`update venue_settings set cancellation_window_hours = 12 where venue_id = {{v}}::uuid`),
      `select pg_temp.guest('g1');`,
      ...['s1', 's2', 's3', 's4', 's5', 's6'].map((g) => `select pg_temp.guest('${g}');`),
      `select pg_temp.coach('c1', 'g1', 'v');`,
      `select pg_temp.lt('lt_p', 'private', 'v');`,
      `select pg_temp.lt('lt_g', 'group', 'v');`,
      `select pg_temp.lt('lt_c', 'course', 'v');`,
      ...['lt_p', 'lt_g', 'lt_c'].map((t) => `select pg_temp.teach('c1', '${t}');`),

      // The window: 25 hours after the start is closed, 23 hours is open.
      GUEST_BOOK('A', 's1', at(2)),
      FROM('A_l', 'A', 'lesson_id'),
      FROM('A_e', 'A', 'enrolment_id'),
      STARTED('A_l', 25 * 60),
      MARK('a_closed', 'A_l', 'A_e', 'attended'),
      GUEST_BOOK('B', 's2', at(2, 2)),
      FROM('B_l', 'B', 'lesson_id'),
      FROM('B_e', 'B', 'enrolment_id'),
      STARTED('B_l', 23 * 60),
      MARK('b_no_show', 'B_l', 'B_e', 'no_show'),
      STRIKE('b_strike', 'B_e'),
      MARK('b_clear', 'B_l', 'B_e', 'clear'),
      STRIKE('b_strike_after', 'B_e'),
      R(
        'b_row',
        `select to_jsonb(count(*)) from lesson_attendance where enrolment_id = {{B_e}}::uuid`,
      ),
      MARK('b_clear_again', 'B_l', 'B_e', 'clear'),

      // A settled strike survives an attended correction.
      GUEST_BOOK('C', 's3', at(2, 4)),
      FROM('C_l', 'C', 'lesson_id'),
      FROM('C_e', 'C', 'enrolment_id'),
      STARTED('C_l', 120),
      MARK('c_no_show', 'C_l', 'C_e', 'no_show'),
      X(
        `update lesson_strikes set settled_at = now(), counted = true where enrolment_id = {{C_e}}::uuid`,
      ),
      MARK('c_attended', 'C_l', 'C_e', 'attended'),
      STRIKE('c_strike', 'C_e'),

      // not_booked: a place cancelled on a session that still runs.
      GROUP('G', 'c1', at(2, 8)),
      FROM('G_l', 'G', 'lesson_id'),
      E('g_s4', 's4', `select app.lesson_join({{G_l}}, 'desk', 15000, 'k-g_s4')`),
      E('g_s5', 's5', `select app.lesson_join({{G_l}}, 'desk', 15000, 'k-g_s5')`),
      FROM('g_s4_e', 'g_s4', 'enrolment_id'),
      E('g_s4_cancel', 's4', `select app.lesson_cancel_mine({{g_s4_e}})`),
      STARTED('G_l', 60),
      MARK('g_not_booked', 'G_l', 'g_s4_e', 'attended'),

      // A course: the place of s6 covers sessions 1-4; a late joiner's covers 3-4 only.
      COURSE('K', 'c1', 'lt_c', 3),
      FROM('K_id', 'K', 'course_id'),
      E('k_s6', 's6', `select app.course_join({{K_id}}, 'desk', 80000, 'k-k_s6')`),
      FROM('k_s6_e', 'k_s6', 'enrolment_id'),
      K(
        'K_s1_id',
        `select id::text from lessons where course_id = {{K_id}}::uuid and session_no = 1`,
      ),
      X(`insert into lesson_enrolments (venue_id, course_id, guest_name, booked_by_kind, booked_by_staff_id,
                                        price_iqd, first_session_no, sessions_covered, payment_mode, status)
         values ({{v}}::uuid, {{K_id}}::uuid, 'Late joiner', 'staff', {{desk}}::uuid, 40000, 3, 2, 'desk', 'booked')`),
      K(
        'K_late_e',
        `select id::text from lesson_enrolments where course_id = {{K_id}}::uuid and first_session_no = 3`,
      ),
      STARTED('K_s1_id', 180),
      MARK('k_outside', 'K_s1_id', 'K_late_e', 'attended'),
      MARK('k_inside', 'K_s1_id', 'k_s6_e', 'attended'),
      // cancelled: a booked place on a session that is no longer live.
      X(`update lessons set status = 'cancelled', cancel_reason = 'staff_cancel', cancelled_at = now()
          where id = {{K_s1_id}}::uuid`),
      MARK('k_cancelled', 'K_s1_id', 'k_s6_e', 'no_show'),
    ]);
  });

  it('start − 25 h is marks_closed; − 23 h is markable', () => {
    expect(code(r, 'a_closed')).toBe('INVALID_TRANSITION:marks_closed');
    expect(data<Json>(r, 'b_no_show')).toMatchObject({ attendance: 'no_show', duplicate: false });
  });

  it('clear removes the no-show and its strike; a second clear is a duplicate', () => {
    expect(data(r, 'b_strike')).toEqual([{ kind: 'no_show', settled: false }]);
    expect(data<Json>(r, 'b_clear')).toMatchObject({ attendance: null, duplicate: false });
    expect(data(r, 'b_strike_after')).toEqual([]);
    expect(data(r, 'b_row')).toBe(0);
    expect(data<Json>(r, 'b_clear_again')).toMatchObject({ attendance: null, duplicate: true });
  });

  it('an attended correction keeps a strike already settled', () => {
    expect(data<Json>(r, 'c_attended')).toMatchObject({ attendance: 'attended', duplicate: false });
    expect(data(r, 'c_strike')).toEqual([{ kind: 'no_show', settled: true }]);
  });

  it('not_booked and cancelled refusals; a course place outside its range is ENROLMENT_NOT_FOUND', () => {
    expect(code(r, 'g_not_booked')).toBe('INVALID_TRANSITION:not_booked');
    expect(failed(r, 'k_outside').code).toBe('ENROLMENT_NOT_FOUND');
    expect(data<Json>(r, 'k_inside')).toMatchObject({ attendance: 'attended' });
    expect(code(r, 'k_cancelled')).toBe('INVALID_TRANSITION:cancelled');
  });
});
