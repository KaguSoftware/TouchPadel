import { describe, expect, it } from 'vitest';
import { makeT } from '@touch/i18n';
import { wallTimeToUtc } from '@touch/core';
import { AppRpcError } from '../../lib/appRpc';
import {
  addStudentBlock,
  addStudentTarget,
  blockedRefundErrors,
  coachBookedUnpaid,
  courseSignUpRange,
  courseStrip,
  deskDueOf,
  deskDueTotal,
  enrolmentCancelLines,
  isCourseLeave,
  joinsFrom,
  lessonHeaderActions,
  liveStudents,
  looksLikeCardNumber,
  methodWord,
  moveCourtChoices,
  onlineBlockedOf,
  optimisticAttendance,
  partyExtra,
  placesOf,
  refundDialogPayment,
  refundLabel,
  refundablePayments,
  rescheduleBlock,
  rescheduleCutoff,
  rescheduleStarts,
  studentFieldOf,
  studentPhoneInvalid,
} from './lessonScreenLogic';
import type {
  CourseSession,
  Enrolment,
  LessonCourse,
  LessonDetail,
  LessonInfo,
  RefundDueItem,
  RefundDuePayment,
} from './lessonPayloads';

// The lesson screen's pure rules (operator.md §5.10, §5.17, §5.21).

const en = makeT('en');
const TZ = 'Asia/Baghdad';
const NOW = Date.parse('2026-10-01T12:00:00Z'); // 15:00 at the branch

const CAN_NONE = {
  add_student: false,
  cancel: false,
  cancel_course: false,
  reschedule: false,
  move_court: false,
};

function lesson(over: Partial<LessonInfo> = {}): LessonInfo {
  return {
    id: 'l1',
    venue_id: 'v1',
    kind: 'group',
    status: 'scheduled',
    cancel_reason: null,
    start_at: '2026-10-01T15:00:00.000Z',
    end_at: '2026-10-01T16:00:00.000Z',
    duration_min: 60,
    rescheduled_at: null,
    booked_by_kind: 'staff',
    coach: { coach_id: 'k1', display_name_en: 'Sara', display_name_ar: 'سارة', status: 'active' },
    lesson_type: { lesson_type_id: 't1', name_en: 'Beginners', name_ar: 'مبتدئين' },
    course: null,
    reservation_id: 'r1',
    reservation_status: 'confirmed',
    court_id: 'c1',
    court_name_en: 'Court 1',
    court_name_ar: 'الملعب 1',
    price_iqd: 15000,
    court_share_iqd: 5000,
    max_places: 6,
    min_places: 2,
    places_taken: 3,
    cutoff_at: '2026-10-01T13:00:00.000Z',
    hold_expires_at: null,
    created_by_name: 'Desk Ali',
    server_now: new Date(NOW).toISOString(),
    day_open: true,
    can: { ...CAN_NONE, add_student: true, cancel: true, reschedule: true, move_court: true },
    ...over,
  };
}

function session(no: number, over: Partial<CourseSession> = {}): CourseSession {
  const start = Date.parse('2026-10-01T15:00:00Z') + (no - 1) * 7 * 86_400_000;
  return {
    lesson_id: `s${no}`,
    session_no: no,
    start_at: new Date(start).toISOString(),
    end_at: new Date(start + 3_600_000).toISOString(),
    status: 'scheduled',
    court_name_en: 'Court 1',
    court_name_ar: 'الملعب 1',
    ...over,
  };
}

function course(over: Partial<LessonCourse> = {}): LessonCourse {
  return {
    course_id: 'co1',
    title_en: 'Autumn course',
    title_ar: '',
    status: 'running',
    cancel_reason: null,
    session_no: 2,
    sessions_count: 4,
    signup_closes_at: session(4).start_at,
    places_taken: 4,
    max_places: 8,
    sessions: [1, 2, 3, 4].map((n) => session(n)),
    ...over,
  };
}

function enrolment(over: Partial<Enrolment> = {}): Enrolment {
  return {
    enrolment_id: 'e1',
    scope: 'lesson',
    status: 'booked',
    cancel_kind: null,
    cancelled_at: null,
    customer_id: 'g1',
    full_name: 'Ali Hasan',
    phone: '0770 123 4567',
    typed: false,
    flags: [],
    party_size: 1,
    friend_names: [],
    first_session_no: null,
    sessions_covered: null,
    booked_by_kind: 'guest',
    booked_by_name: null,
    payment_mode: 'desk',
    created_at: null,
    attendance: null,
    money: {
      price_iqd: 15000,
      owed_iqd: 15000,
      desk_paid_iqd: 0,
      online_paid_iqd: 0,
      refunded_iqd: 0,
      kept_iqd: 0,
      refund_due_iqd: 0,
      take_iqd: 15000,
    },
    can: {
      take_payment: true,
      cancel: true,
      mark_attended: false,
      mark_no_show: false,
      unmark: false,
    },
    ...over,
  };
}

function payment(over: Partial<RefundDuePayment> = {}): RefundDuePayment {
  return {
    payment_id: 'p1',
    tab_id: 't1',
    method: 'cash',
    amount_iqd: 30000,
    refunded_iqd: 10000,
    refundable_iqd: 20000,
    created_at: null,
    ...over,
  };
}

function item(over: Partial<RefundDueItem> = {}): RefundDueItem {
  return {
    enrolment_id: 'e1',
    lesson_id: 'l1',
    course_id: null,
    kind: 'group',
    coach_id: 'k1',
    coach_name_en: 'Sara',
    coach_name_ar: 'سارة',
    type_name_en: 'Beginners',
    type_name_ar: 'مبتدئين',
    start_at: '2026-10-01T15:00:00.000Z',
    label: 'Ali Hasan',
    phone: '0770',
    cancel_kind: 'staff',
    cancelled_at: null,
    refund_due_iqd: 15000,
    refund_due_desk_iqd: 15000,
    online_blocked_iqd: 0,
    payments: [payment()],
    ...over,
  };
}

describe('lessonHeaderActions (§5.10.1)', () => {
  const caps = { runLessons: true };

  it('follows the lesson’s can: Move court, Reschedule and Cancel lesson', () => {
    const a = lessonHeaderActions(lesson(), caps, true);
    expect(a.moveCourt).toEqual({ enabled: true, reason: null });
    expect(a.reschedule).toEqual({ enabled: true, reason: null });
    expect(a.cancelLesson).toEqual({ enabled: true, reason: null });
    expect(a.cancelCourse).toBeNull();
  });

  it('a held lesson shows Reschedule and Move court disabled with the held reason (R32)', () => {
    const a = lessonHeaderActions(
      lesson({ kind: 'private', status: 'held', can: { ...CAN_NONE, cancel: true } }),
      caps,
      true,
    );
    expect(a.moveCourt).toEqual({ enabled: false, reason: 'held' });
    expect(a.reschedule).toEqual({ enabled: false, reason: 'held' });
    expect(a.cancelLesson).toEqual({ enabled: true, reason: null });
  });

  it('a course session offers Cancel the course, never Cancel lesson (C-19)', () => {
    const a = lessonHeaderActions(
      lesson({
        kind: 'course',
        course: course(),
        can: { ...CAN_NONE, cancel: true, cancel_course: true },
      }),
      caps,
      true,
    );
    expect(a.cancelLesson).toBeNull();
    expect(a.cancelCourse).toEqual({ enabled: true, reason: null });
  });

  it('offline disables every write with the reason; without runLessons nothing shows', () => {
    const off = lessonHeaderActions(lesson(), caps, false);
    expect(off.moveCourt).toEqual({ enabled: false, reason: 'offline' });
    expect(off.cancelLesson).toEqual({ enabled: false, reason: 'offline' });
    expect(lessonHeaderActions(lesson(), { runLessons: false }, true)).toEqual({
      moveCourt: null,
      reschedule: null,
      cancelLesson: null,
      cancelCourse: null,
    });
  });

  it('a can the server refuses hides the control', () => {
    const a = lessonHeaderActions(lesson({ status: 'completed', can: CAN_NONE }), caps, true);
    expect(a).toEqual({
      moveCourt: null,
      reschedule: null,
      cancelLesson: null,
      cancelCourse: null,
    });
  });
});

describe('the header lines', () => {
  it('C-24: a coach-booked private lesson with a sign-up still owing', () => {
    const priv = lesson({ kind: 'private', booked_by_kind: 'coach' });
    expect(coachBookedUnpaid(priv, [enrolment()])).toBe(true);
    expect(
      coachBookedUnpaid(priv, [enrolment({ money: { ...enrolment().money, take_iqd: 0 } })]),
    ).toBe(false);
    expect(
      coachBookedUnpaid(lesson({ kind: 'private', booked_by_kind: 'staff' }), [enrolment()]),
    ).toBe(false);
    expect(coachBookedUnpaid(lesson({ booked_by_kind: 'coach' }), [enrolment()])).toBe(false);
  });

  it('places: a group session’s own, a course session’s course, none for a private lesson', () => {
    expect(placesOf(lesson())).toEqual({ taken: 3, total: 6 });
    expect(placesOf(lesson({ kind: 'course', course: course() }))).toEqual({ taken: 4, total: 8 });
    expect(placesOf(lesson({ kind: 'private' }))).toBeNull();
    expect(placesOf(lesson({ places_taken: null }))).toBeNull();
  });
});

describe('course strip and late joins (§5.10.3, §5.10.7)', () => {
  it('one chip per session, the lesson on screen pressed', () => {
    const chips = courseStrip(course(), 's2');
    expect(chips.map((c) => [c.session.session_no, c.current])).toEqual([
      [1, false],
      [2, true],
      [3, false],
      [4, false],
    ]);
    expect(courseStrip(null, 'l1')).toEqual([]);
  });

  it('joins from the next session still to start, paying for the sessions from there', () => {
    // 15:00 now: session 1 starts at 18:00 today, so a sign-up joins from it.
    expect(joinsFrom(course(), NOW)).toEqual({ sessionNo: 1, sessions: 4 });
    // A week and a bit later: sessions 3 and 4 are left.
    expect(joinsFrom(course(), NOW + 8 * 86_400_000)).toEqual({ sessionNo: 3, sessions: 2 });
    // A cancelled session is not joined.
    const c = course({ sessions: [session(1), session(2, { status: 'cancelled' }), session(3)] });
    expect(joinsFrom(c, NOW + 86_400_000)).toEqual({ sessionNo: 3, sessions: 1 });
    expect(joinsFrom(c, NOW + 30 * 86_400_000)).toBeNull();
    expect(joinsFrom(null, NOW)).toBeNull();
  });
});

describe('roster lines (§5.10.4)', () => {
  it('a course sign-up reads its sessions, late when it joined after session 1', () => {
    const c = course();
    expect(
      courseSignUpRange(
        enrolment({ scope: 'course', first_session_no: 3, sessions_covered: 2 }),
        c,
      ),
    ).toEqual({ from: 3, to: 4, late: true });
    expect(
      courseSignUpRange(
        enrolment({ scope: 'course', first_session_no: 1, sessions_covered: null }),
        c,
      ),
    ).toEqual({ from: 1, to: 4, late: false });
    expect(courseSignUpRange(enrolment(), c)).toBeNull();
  });

  it('a private booker’s party beyond themselves', () => {
    expect(partyExtra(enrolment({ party_size: 3 }))).toBe(2);
    expect(partyExtra(enrolment({ party_size: 1 }))).toBeNull();
    expect(partyExtra(enrolment({ party_size: null }))).toBeNull();
  });

  it('optimistic marks flip the sign-up and switch its mark buttons off; clear removes the mark', () => {
    const detail: LessonDetail = {
      lesson: lesson(),
      enrolments: [
        enrolment({ can: { ...enrolment().can, mark_attended: true, mark_no_show: true } }),
        enrolment({ enrolment_id: 'e2' }),
      ],
      events: [],
    };
    const marked = optimisticAttendance(detail, 'e1', 'attended', '2026-10-01T15:05:00.000Z');
    expect(marked.enrolments[0]!.attendance).toEqual({
      status: 'attended',
      marked_at: '2026-10-01T15:05:00.000Z',
      marked_by_name: null,
    });
    expect(marked.enrolments[0]!.can).toMatchObject({
      mark_attended: false,
      mark_no_show: false,
      unmark: false,
      take_payment: true,
    });
    expect(marked.enrolments[1]).toBe(detail.enrolments[1]);
    expect(optimisticAttendance(marked, 'e1', 'clear', 'x').enrolments[0]!.attendance).toBeNull();
  });

  it('live students: booked and held sign-ups', () => {
    expect(
      liveStudents([
        enrolment(),
        enrolment({ status: 'held' }),
        enrolment({ status: 'cancelled' }),
      ]),
    ).toBe(2);
  });
});

describe('cancel consequence lines (§5.10.8)', () => {
  const money = (desk: number, online: number) => ({
    ...enrolment().money,
    desk_paid_iqd: desk,
    online_paid_iqd: online,
  });

  it('nothing paid, desk paid, online paid, a course sign-up', () => {
    expect(enrolmentCancelLines(enrolment(), 'group')).toEqual([{ id: 'nothingPaid' }]);
    expect(enrolmentCancelLines(enrolment({ money: money(15000, 0) }), 'group')).toEqual([
      { id: 'deskPaid', amount: 15000 },
    ]);
    expect(enrolmentCancelLines(enrolment({ money: money(0, 15000) }), 'group')).toEqual([
      { id: 'online' },
    ]);
    expect(
      enrolmentCancelLines(enrolment({ scope: 'course', money: money(60000, 0) }), 'course'),
    ).toEqual([{ id: 'courseSignUp' }]);
  });

  it('a private lesson’s booker cancels the lesson with it', () => {
    expect(enrolmentCancelLines(enrolment({ money: money(30000, 0) }), 'private')).toEqual([
      { id: 'deskPaid', amount: 30000 },
      { id: 'privateBooker' },
    ]);
  });
});

describe('Reschedule (§5.10.9, R8, R32, R47, R66)', () => {
  const toUtc = (m: number) => wallTimeToUtc('2026-10-01', m, TZ);

  it('30-minute starts from the opening to the close less the length, after now', () => {
    // Open 09:00 → 02:00; now 15:00 at the branch; a 60-minute lesson.
    const starts = rescheduleStarts({
      span: { startMin: 9 * 60, endMin: 26 * 60 },
      durationMin: 60,
      nowMs: NOW,
      toUtc,
    });
    expect(starts[0]!.minutes).toBe(15 * 60 + 30);
    expect(starts[starts.length - 1]!.minutes).toBe(25 * 60);
    expect(starts.every((s) => s.minutes % 30 === 0)).toBe(true);
    // 01:00 the next calendar day is still this night.
    expect(starts[starts.length - 1]!.iso).toBe('2026-10-01T22:00:00.000Z');
  });

  it('an opening off the grid starts on the next half hour; a closed night offers nothing; no hours offers the day', () => {
    const odd = rescheduleStarts({
      span: { startMin: 16 * 60 + 10, endMin: 18 * 60 },
      durationMin: 60,
      nowMs: NOW,
      toUtc,
    });
    expect(odd.map((s) => s.minutes)).toEqual([16 * 60 + 30, 17 * 60]);
    expect(
      rescheduleStarts({
        span: { startMin: 0, endMin: 24 * 60 },
        durationMin: 60,
        nowMs: NOW,
        closed: true,
        toUtc,
      }),
    ).toEqual([]);
    const day = rescheduleStarts({ span: null, durationMin: 60, nowMs: NOW, toUtc });
    expect(day[day.length - 1]!.minutes).toBe(23 * 60);
  });

  it('the cut-off moves with the start while it is unjudged (R47), and is refused once it would have passed', () => {
    // Start 18:00, cut-off 16:00 (two hours); now 15:00.
    const l = lesson();
    const later = rescheduleCutoff(l, '2026-10-01T17:00:00.000Z', NOW);
    expect(later).toEqual({ cutoffAt: '2026-10-01T15:00:00.000Z', passed: false });
    const tooSoon = rescheduleCutoff(l, '2026-10-01T13:30:00.000Z', NOW);
    expect(tooSoon).toEqual({ cutoffAt: '2026-10-01T11:30:00.000Z', passed: true });
    // At the cut-off exactly: passed.
    expect(rescheduleCutoff(l, '2026-10-01T14:00:00.000Z', NOW)?.passed).toBe(true);
  });

  it('a judged session (its cut-off behind), a private lesson and a course’s later session move freely (R66)', () => {
    expect(
      rescheduleCutoff(
        lesson({ cutoff_at: '2026-10-01T11:00:00.000Z' }),
        '2026-10-01T13:00:00.000Z',
        NOW,
      ),
    ).toBeNull();
    expect(
      rescheduleCutoff(
        lesson({ kind: 'private', cutoff_at: null }),
        '2026-10-01T13:00:00.000Z',
        NOW,
      ),
    ).toBeNull();
    expect(
      rescheduleCutoff(
        lesson({ kind: 'course', course: course({ session_no: 2 }) }),
        '2026-10-01T13:00:00.000Z',
        NOW,
      ),
    ).toBeNull();
    expect(
      rescheduleCutoff(
        lesson({ kind: 'course', course: course({ session_no: 1 }) }),
        '2026-10-01T13:30:00.000Z',
        NOW,
      )?.passed,
    ).toBe(true);
  });

  it('why Reschedule waits: offline, no start, the same start, a passed cut-off', () => {
    const current = '2026-10-01T15:00:00.000Z';
    expect(
      rescheduleBlock({ reachable: false, startIso: null, currentStartIso: current, cutoff: null }),
    ).toBe('offline');
    expect(
      rescheduleBlock({ reachable: true, startIso: null, currentStartIso: current, cutoff: null }),
    ).toBe('pickStart');
    expect(
      rescheduleBlock({
        reachable: true,
        startIso: current,
        currentStartIso: current,
        cutoff: null,
      }),
    ).toBe('sameStart');
    expect(
      rescheduleBlock({
        reachable: true,
        startIso: '2026-10-01T16:00:00.000Z',
        currentStartIso: current,
        cutoff: { passed: true },
      }),
    ).toBe('cutoffPassed');
    expect(
      rescheduleBlock({
        reachable: true,
        startIso: '2026-10-01T16:00:00.000Z',
        currentStartIso: current,
        cutoff: { passed: false },
      }),
    ).toBeNull();
  });
});

describe('Move court (§5.10.9, R7)', () => {
  const courts = [
    { id: 'c2', name_en: 'Court 2', name_ar: 'الملعب 2', sort_order: 2 },
    { id: 'c1', name_en: 'Court 1', name_ar: 'الملعب 1', sort_order: 1 },
    { id: 'c3', name_en: 'Court 3', name_ar: 'الملعب 3', sort_order: 3 },
  ];
  const row = (id: string, court: string, start: string, end: string, status = 'confirmed') => ({
    id,
    court_id: court,
    status,
    start_at: start,
    end_at: end,
  });

  it('the current court shown and never offered; a court taken for any part of the period is taken', () => {
    const rows = [
      row('r1', 'c1', '2026-10-01T15:00:00.000Z', '2026-10-01T16:00:00.000Z'),
      row('r2', 'c2', '2026-10-01T15:30:00.000Z', '2026-10-01T17:00:00.000Z'),
      row('r3', 'c3', '2026-10-01T16:00:00.000Z', '2026-10-01T17:00:00.000Z'),
    ];
    const choices = moveCourtChoices(courts, rows, lesson());
    expect(choices.map((c) => [c.court.id, c.current, c.free])).toEqual([
      ['c1', true, false],
      ['c2', false, false],
      ['c3', false, true],
    ]);
  });

  it('a cancelled row does not take a court', () => {
    const rows = [
      row('r2', 'c2', '2026-10-01T15:00:00.000Z', '2026-10-01T16:00:00.000Z', 'cancelled'),
    ];
    expect(moveCourtChoices(courts, rows, lesson()).find((c) => c.court.id === 'c2')!.free).toBe(
      true,
    );
  });
});

describe('Add student (§5.10.7)', () => {
  it('a picked customer, or a typed name with a valid phone if one is given', () => {
    expect(
      addStudentBlock({ reachable: true, customerPicked: true, name: '', phone: '' }),
    ).toBeNull();
    expect(addStudentBlock({ reachable: true, customerPicked: false, name: '  ', phone: '' })).toBe(
      'needsStudent',
    );
    expect(
      addStudentBlock({ reachable: true, customerPicked: false, name: 'x'.repeat(81), phone: '' }),
    ).toBe('nameTooLong');
    expect(
      addStudentBlock({ reachable: true, customerPicked: false, name: 'Bravo', phone: '0770 12' }),
    ).toBe('phoneInvalid');
    expect(
      addStudentBlock({
        reachable: true,
        customerPicked: false,
        name: 'Bravo',
        phone: '0770 123 4567',
      }),
    ).toBeNull();
    expect(addStudentBlock({ reachable: false, customerPicked: true, name: '', phone: '' })).toBe(
      'offline',
    );
    expect(studentPhoneInvalid('')).toBe(false);
    expect(studentPhoneInvalid('1234567890123456')).toBe(true);
  });

  it('INVALID_ARGUMENT p_name / p_phone land on their boxes', () => {
    expect(
      studentFieldOf(new AppRpcError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', undefined, 'p_name')),
    ).toBe('name');
    expect(
      studentFieldOf(new AppRpcError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', undefined, 'p_phone')),
    ).toBe('phone');
    expect(studentFieldOf(new AppRpcError('LESSON_FULL', 'LESSON_FULL'))).toBeNull();
  });

  it('a group session adds to the lesson; a course session signs up for the course', () => {
    // Both keys always (app.desk_add_student has no defaults), the other one null.
    expect(addStudentTarget(lesson())).toEqual({ p_lesson_id: 'l1', p_course_id: null });
    expect(addStudentTarget(lesson({ kind: 'course', course: course() }))).toEqual({
      p_lesson_id: null,
      p_course_id: 'co1',
    });
  });
});

describe('Refunds due (§5.10.10, §5.17, R36, R62, R75)', () => {
  it('a course leave is a guest leaving a course', () => {
    expect(isCourseLeave(item({ course_id: 'co1', cancel_kind: 'guest_late' }))).toBe(true);
    expect(isCourseLeave(item({ course_id: 'co1', cancel_kind: 'guest_free' }))).toBe(true);
    expect(isCourseLeave(item({ course_id: 'co1', cancel_kind: 'staff' }))).toBe(false);
    expect(isCourseLeave(item({ cancel_kind: 'guest_late' }))).toBe(false);
  });

  it('the till dialog’s payment carries what already went back, so its remainder is the server’s', () => {
    expect(refundDialogPayment(payment())).toEqual({
      id: 'p1',
      method: 'cash',
      amount_iqd: 30000,
      refunds: [{ amount_iqd: 10000 }],
    });
    expect(refundDialogPayment(payment({ refunded_iqd: 0 }))).toEqual({
      id: 'p1',
      method: 'cash',
      amount_iqd: 30000,
      refunds: [],
    });
    expect(
      refundDialogPayment(payment({ refunded_iqd: null, refundable_iqd: 25000 })).refunds,
    ).toEqual([{ amount_iqd: 5000 }]);
  });

  it('payments with nothing left are not offered; dues and blocked shares never go below zero', () => {
    expect(
      refundablePayments(
        item({ payments: [payment(), payment({ payment_id: 'p2', refundable_iqd: 0 })] }),
      ).map((p) => p.payment_id),
    ).toEqual(['p1']);
    expect(deskDueOf(item({ refund_due_desk_iqd: null }))).toBe(0);
    expect(onlineBlockedOf(item({ online_blocked_iqd: 7000 }))).toBe(7000);
    expect(deskDueTotal([item(), item({ refund_due_desk_iqd: 5000 })])).toBe(20000);
  });

  it('the student as recorded, else "Student"; the method word', () => {
    expect(refundLabel(item(), en)).toBe('Ali Hasan');
    expect(refundLabel(item({ label: ' ' }), en)).toBe('Student');
    expect(methodWord('card', en)).toBe('card');
    expect(methodWord('qi', en)).toBe('qi');
  });

  it('the handback record: an amount up to what is blocked, a reference 1..80 that is not a card', () => {
    expect(blockedRefundErrors({ amount: 7000, max: 7000, reference: 'TRX-55102' })).toEqual({
      amount: null,
      reference: null,
    });
    expect(blockedRefundErrors({ amount: 7001, max: 7000, reference: 'x' }).amount).toBe('tooHigh');
    expect(blockedRefundErrors({ amount: null, max: 7000, reference: 'x' }).amount).toBe(
      'required',
    );
    expect(blockedRefundErrors({ amount: 0, max: 7000, reference: 'x' }).amount).toBe('required');
    expect(blockedRefundErrors({ amount: 1, max: 7000, reference: ' ' }).reference).toBe(
      'required',
    );
    expect(blockedRefundErrors({ amount: 1, max: 7000, reference: 'r'.repeat(81) }).reference).toBe(
      'tooLong',
    );
    expect(
      blockedRefundErrors({ amount: 1, max: 7000, reference: '4111 1111 1111 1111' }).reference,
    ).toBe('cardNumber');
    expect(
      blockedRefundErrors({ amount: 1, max: 7000, reference: '4111.1111-1111' }).reference,
    ).toBe('cardNumber');
  });

  it('the card guard: a run of 12 digits once spaces, dots and hyphens are gone; 11 is fine', () => {
    expect(looksLikeCardNumber('123456789012')).toBe(true);
    expect(looksLikeCardNumber('1234 5678 9012')).toBe(true);
    expect(looksLikeCardNumber('12345678901')).toBe(false);
    expect(looksLikeCardNumber('REF 2026/10/01 #44')).toBe(false);
  });
});
