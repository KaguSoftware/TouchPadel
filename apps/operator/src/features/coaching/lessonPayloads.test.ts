import { describe, expect, it } from 'vitest';
import {
  COACHING_SHAPES,
  missingKeys,
  type CoachingShape,
  type CoachingShapeName,
} from '@touch/core';
import {
  firstSessionId,
  readAddedStudent,
  readBookedLesson,
  readCancelledCourse,
  readCancelledEnrolment,
  readCancelledLesson,
  readCoachStatusSet,
  readCoachesAdmin,
  readCoachingSettings,
  readCreatedCourse,
  readCreatedGroup,
  readCustomerLessons,
  readDeskLessons,
  readLessonDetail,
  readLessonSettled,
  readLessonsReport,
  readRefundsDue,
  readRescheduled,
  readSlots,
  readStatementApproved,
  readStatementDetail,
  readStatementPaid,
  readStatementRefreshed,
  readStatements,
} from './lessonPayloads';

// R41 / R81: every parser reads exactly its COACHING_SHAPES list. The fixtures
// are built from the lists themselves, so a key renamed in shapes.ts (or here)
// fails this file, not a screen.

const ID = '00000000-0000-4000-8000-000000000001';
const AT = '2026-10-01T10:00:00.000Z';

const BOOLEAN_KEYS = new Set([
  'coaching_enabled',
  'lesson_prices_public',
  'online_payments_available',
  'bookable',
  'off',
  'duplicate',
  'typed',
  'late',
  'stale',
  'account_deleted',
  'is_active',
  'is_adjustment',
  'created',
  'day_open',
  'add_student',
  'cancel',
  'cancel_course',
  'reschedule',
  'move_court',
  'take_payment',
  'mark_attended',
  'mark_no_show',
  'unmark',
  'refresh',
  'approve',
  'void',
  'mark_paid',
]);

/** A plausible value for a leaf key, by its name. */
function leaf(key: string): unknown {
  if (BOOLEAN_KEYS.has(key)) return true;
  if (key === 'kind') return 'group';
  if (key === 'status' || key === 'lesson_status') return 'scheduled';
  if (key === 'enrolment_status') return 'booked';
  if (key === 'scope') return 'lesson';
  if (key === 'lesson_payment_mode') return 'desk';
  if (key === 'month' || key === 'current_month') return '2026-09-01';
  if (key === 'reason') return 'not_drafted';
  if (key === 'weekday') return 0;
  if (key === 'start_time') return '09:00';
  if (key === 'end_time') return '13:00';
  if (key === 'date' || key === 'from' || key === 'to') return '2026-10-01';
  if (key === 'flags' || key === 'friend_names' || key === 'columns') return [];
  if (key === 'attendance') return 'attended';
  if (key === 'change') return 'lesson_price';
  if (/_at$/.test(key) || key === 'at' || key === 'server_now') return AT;
  if (/(_ids|Ids)$/.test(key)) return [ID];
  if (/(_id|Id)$/.test(key) || key === 'id') return ID;
  if (/(_iqd|Iqd)$/.test(key)) return 1000;
  if (
    /(_en|En|_ar|Ar)$/.test(key) ||
    /name|label|title|reference|phone|code|actor|type$|method/i.test(key)
  )
    return 'x';
  return 2;
}

/** An answer carrying every key of `shape`, nested objects and one-element arrays included. */
function fixtureOf(shape: CoachingShape): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const key of shape.keys) root[key] = leaf(key);
  for (const group of shape.oneOf ?? []) for (const key of group) root[key] = leaf(key);
  const specs = Object.entries(shape.nested ?? {}).sort(
    ([a], [b]) => a.split('.').length - b.split('.').length,
  );
  for (const [spec, keys] of specs) {
    let targets: Record<string, unknown>[] = [root];
    for (const segment of spec.split('.')) {
      const isArray = segment.endsWith('[]');
      const name = isArray ? segment.slice(0, -2) : segment;
      targets = targets.map((t) => {
        if (isArray) {
          if (!Array.isArray(t[name])) t[name] = [{}];
          return (t[name] as Record<string, unknown>[])[0]!;
        }
        if (typeof t[name] !== 'object' || t[name] === null || Array.isArray(t[name])) t[name] = {};
        return t[name] as Record<string, unknown>;
      });
    }
    for (const target of targets) {
      for (const key of keys)
        if (!(key in target) || typeof target[key] !== 'object')
          target[key] = target[key] ?? leaf(key);
    }
  }
  return root;
}

/** Keys an answer carries beyond its shape (top level and every nested path the shape names). */
function extraKeys(value: unknown, shape: CoachingShape): string[] {
  const problems: string[] = [];
  const check = (obj: unknown, keys: readonly string[], path: string) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const k of Object.keys(obj)) if (!keys.includes(k)) problems.push(`${path}.${k}`);
  };
  check(value, [...shape.keys, ...(shape.oneOf ?? []).flat()], '$');
  for (const [spec, keys] of Object.entries(shape.nested ?? {})) {
    let targets: unknown[] = [value];
    for (const segment of spec.split('.')) {
      const isArray = segment.endsWith('[]');
      const name = isArray ? segment.slice(0, -2) : segment;
      targets = targets.flatMap((t) => {
        const v = t && typeof t === 'object' ? (t as Record<string, unknown>)[name] : undefined;
        if (v === null || v === undefined) return [];
        return isArray ? (Array.isArray(v) ? v : []) : [v];
      });
    }
    for (const t of targets) check(t, keys, spec);
  }
  return problems;
}

const PARSERS: [CoachingShapeName, (raw: unknown) => unknown][] = [
  ['desk_lessons', readDeskLessons],
  ['desk_lesson_detail', readLessonDetail],
  ['customer_lessons', readCustomerLessons],
  ['coaches_admin', readCoachesAdmin],
  ['coaching_settings', readCoachingSettings],
  ['set_coaching_settings', readCoachingSettings],
  ['coach_slots', readSlots],
  ['lesson_refunds_due', readRefundsDue],
  ['report_coach_statements', readStatements],
  ['coach_statement_detail', readStatementDetail],
  ['report_lessons', readLessonsReport],
  ['desk_book_lesson', readBookedLesson],
  ['desk_create_group', readCreatedGroup],
  ['desk_create_course', readCreatedCourse],
  ['desk_add_student', readAddedStudent],
  ['desk_cancel_enrolment', readCancelledEnrolment],
  ['desk_cancel_lesson', readCancelledLesson],
  ['desk_cancel_course', readCancelledCourse],
  ['desk_reschedule_session', readRescheduled],
  ['lesson_settle', readLessonSettled],
  ['set_coach_status', readCoachStatusSet],
  ['coach_statement_refresh', readStatementRefreshed],
  ['coach_statement_approve', readStatementApproved],
  ['coach_statement_mark_paid', readStatementPaid],
];

describe('coaching parsers read exactly their COACHING_SHAPES lists (R41, R81)', () => {
  for (const [name, parse] of PARSERS) {
    const shape = COACHING_SHAPES[name];
    it(`${name}: the fixture is complete`, () => {
      expect(missingKeys(fixtureOf(shape), shape)).toEqual([]);
    });
    it(`${name}: the parsed answer carries every listed key`, () => {
      expect(missingKeys(parse(fixtureOf(shape)), shape)).toEqual([]);
    });
    it(`${name}: the parsed answer invents no key of its own`, () => {
      expect(extraKeys(parse(fixtureOf(shape)), shape)).toEqual([]);
    });
  }
});

describe('defensive reads', () => {
  it('never throws on junk and never makes up a figure', () => {
    for (const [, parse] of PARSERS) {
      expect(() => parse(null)).not.toThrow();
      expect(() => parse('nope')).not.toThrow();
      expect(() => parse([1, 2])).not.toThrow();
    }
    const env = readDeskLessons({
      lessons: [{ lesson_id: 'l', kind: 'group', start_at: AT, end_at: AT }],
    });
    expect(env.lessons[0]!.owing_iqd).toBeNull();
    expect(env.lessons[0]!.places_taken).toBeNull();
    expect(env.coaching_enabled).toBe(false);
  });

  it('drops a lesson row with no kind it knows, keeps the rest', () => {
    const env = readDeskLessons({
      lessons: [
        { lesson_id: 'a', kind: 'private', start_at: AT, end_at: AT },
        { lesson_id: 'b', kind: 'clinic', start_at: AT, end_at: AT },
      ],
    });
    expect(env.lessons.map((l) => l.lesson_id)).toEqual(['a']);
  });

  it('reads a numeric sent as text, and paid_online as a count or a flag', () => {
    const env = readDeskLessons({
      lessons: [
        {
          lesson_id: 'a',
          kind: 'group',
          start_at: AT,
          end_at: AT,
          owing_iqd: '30000',
          paid_online: true,
        },
        { lesson_id: 'b', kind: 'group', start_at: AT, end_at: AT, paid_online: 3 },
      ],
    });
    expect(env.lessons[0]!.owing_iqd).toBe(30000);
    expect(env.lessons[0]!.paid_online).toBe(1);
    expect(env.lessons[1]!.paid_online).toBe(3);
  });

  it('answers null for a detail with no readable lesson (the "not at this branch" screen)', () => {
    expect(readLessonDetail({ lesson: null })).toBeNull();
    expect(
      readLessonDetail({ lesson: { id: 'x', kind: 'nope', start_at: AT, end_at: AT } }),
    ).toBeNull();
    expect(readStatementDetail({ statement: {} })).toBeNull();
  });

  it('keeps a typed (recorded) name and a null customer for an unconfirmed match (R44, C-21)', () => {
    const d = readLessonDetail({
      lesson: { id: 'l', kind: 'group', start_at: AT, end_at: AT },
      enrolments: [{ enrolment_id: 'e', full_name: 'Typed Name', typed: true, customer_id: null }],
    });
    expect(d!.enrolments[0]!.full_name).toBe('Typed Name');
    expect(d!.enrolments[0]!.typed).toBe(true);
    expect(d!.enrolments[0]!.customer_id).toBeNull();
  });

  it('reads a payment mode it does not know as the desk default', () => {
    expect(readCoachingSettings({ lesson_payment_mode: 'crypto' }).lesson_payment_mode).toBe(
      'desk',
    );
    expect(
      readCoachingSettings({ lesson_payment_mode: 'online_required' }).lesson_payment_mode,
    ).toBe('online_required');
  });

  it("orders a course's sessions by number", () => {
    const d = readLessonDetail({
      lesson: {
        id: 'l',
        kind: 'course',
        start_at: AT,
        end_at: AT,
        course: {
          course_id: 'c',
          sessions: [
            { lesson_id: 's2', session_no: 2, start_at: AT, end_at: AT },
            { lesson_id: 's1', session_no: 1, start_at: AT, end_at: AT },
          ],
        },
      },
    });
    expect(d!.lesson.course!.sessions.map((s) => s.lesson_id)).toEqual(['s1', 's2']);
  });

  it("finds a created course's first session", () => {
    expect(
      firstSessionId(
        readCreatedCourse({
          lesson_ids: ['b', 'a'],
          sessions: [
            { session_no: 2, lesson_id: 'b' },
            { session_no: 1, lesson_id: 'a' },
          ],
        }),
      ),
    ).toBe('a');
    expect(firstSessionId(readCreatedCourse({ lesson_ids: ['z'] }))).toBe('z');
    expect(firstSessionId(readCreatedCourse({}))).toBeNull();
  });
});
