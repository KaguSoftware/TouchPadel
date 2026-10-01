import { describe, expect, it } from 'vitest';
import { makeT } from '@touch/i18n';
import { parseMyLessons, type MyLessonRow } from '../logic';
import { lessonStateOf, moneyLineOf, stateLine, type LessonState } from '../state';
import { myLessonRowFixture } from '../../../test/coachingFixtures';

/** Every row of guest.md §4.8.9, in order: the first match wins. */
const NOW = new Date('2026-10-05T12:00:00Z');
const HOUR = 3_600_000;
const at = (h: number) => new Date(NOW.getTime() + h * HOUR).toISOString();

function row(over: Record<string, unknown>): MyLessonRow {
  return parseMyLessons([
    myLessonRowFixture({ start_at: at(48), end_at: at(49), ...over }, NOW),
  ])[0]!;
}

const cases: [string, Record<string, unknown>, LessonState][] = [
  [
    '0 confirm_needed wins over everything',
    { confirm_needed: true, status: 'held', hold_expires_at: at(1) },
    'confirmNeeded',
  ],
  ['1 held, hold live', { status: 'held', hold_expires_at: at(0.2) }, 'awaitingPayment'],
  ['2 held, hold lapsed', { status: 'held', hold_expires_at: at(-0.1) }, 'paymentLapsing'],
  [
    '3 group under its minimum before the cut-off',
    { kind: 'group', places_taken: 2, min_places: 4, cutoff_at: at(10) },
    'needsMore',
  ],
  [
    '4 a running course',
    {
      kind: 'course',
      session_no: 3,
      sessions_count: 8,
      places_taken: 5,
      min_places: 3,
      cutoff_at: at(-100),
    },
    'courseRunning',
  ],
  ['5 moved after booking, not started', { rescheduled: true }, 'moved'],
  ['6 booked, not started', {}, 'booked'],
  ['7 attended', { start_at: at(-3), end_at: at(-2), attendance: 'attended' }, 'attended'],
  ['8 no-show', { start_at: at(-3), end_at: at(-2), attendance: 'no_show' }, 'noShow'],
  [
    '9 completed, unmarked',
    { start_at: at(-3), end_at: at(-2), lesson_status: 'completed' },
    'done',
  ],
  ['10 on now', { start_at: at(-0.5), end_at: at(0.5) }, 'now'],
  [
    '11 left a course (free)',
    { kind: 'course', status: 'cancelled', cancel_kind: 'guest_free' },
    'leftCourse',
  ],
  [
    '11 left a course (late)',
    { kind: 'course', status: 'cancelled', cancel_kind: 'guest_late' },
    'leftCourse',
  ],
  ['12 cancelled free', { status: 'cancelled', cancel_kind: 'guest_free' }, 'cancelledFree'],
  ['13 cancelled late', { status: 'cancelled', cancel_kind: 'guest_late' }, 'cancelledLate'],
  ['14 by the coach', { status: 'cancelled', cancel_kind: 'coach' }, 'cancelledByCoach'],
  ['15 by the venue', { status: 'cancelled', cancel_kind: 'staff' }, 'cancelledByVenue'],
  ['16 under-filled', { status: 'cancelled', cancel_kind: 'under_filled' }, 'underFilled'],
  [
    '17 course cancelled',
    { status: 'cancelled', cancel_kind: 'course_cancelled' },
    'courseCancelled',
  ],
  ['18 expired', { status: 'expired' }, 'paymentExpired'],
  ['19 anything else', { status: 'mystery' }, 'unknown'],
];

describe('lessonStateOf (§4.8.9)', () => {
  it.each(cases)('%s', (_name, over, expected) => {
    expect(lessonStateOf(row(over), NOW).state).toBe(expected);
  });

  it('a group above its minimum, or past its cut-off, is simply booked', () => {
    expect(
      lessonStateOf(row({ kind: 'group', places_taken: 4, min_places: 4, cutoff_at: at(10) }), NOW)
        .state,
    ).toBe('booked');
    expect(
      lessonStateOf(row({ kind: 'group', places_taken: 1, min_places: 4, cutoff_at: at(-1) }), NOW)
        .state,
    ).toBe('booked');
  });

  it('carries what its line needs', () => {
    expect(lessonStateOf(row({ status: 'held', hold_expires_at: at(0.2) }), NOW).at).toBe(at(0.2));
    const more = lessonStateOf(
      row({ kind: 'group', places_taken: 2, min_places: 4, cutoff_at: at(10) }),
      NOW,
    );
    expect(more.people).toBe(4);
    const course = lessonStateOf(
      row({
        kind: 'course',
        session_no: 3,
        sessions_count: 8,
        places_taken: 5,
        min_places: 3,
        cutoff_at: at(-100),
      }),
      NOW,
    );
    expect([course.n, course.total]).toEqual([3, 8]);
  });
});

describe('the lines', () => {
  it('reads the state in both languages, counts LTR-isolated', () => {
    for (const locale of ['en', 'ar'] as const) {
      const t = makeT(locale);
      const s = lessonStateOf(
        row({ kind: 'group', places_taken: 2, min_places: 4, cutoff_at: at(10) }),
        NOW,
      );
      const line = stateLine(s, { t, locale, tz: 'Asia/Baghdad', now: NOW });
      expect(line).not.toContain('{');
      expect(line).toContain('\u2066'); // the count's LTR isolate
    }
  });

  it('the money line: what is owed at the desk, else paid online; refunds and kept after a cancel', () => {
    const t = makeT('en');
    const booked = row({});
    expect(moneyLineOf(booked, lessonStateOf(booked, NOW), { t, locale: 'en' })).toContain(
      'at the desk',
    );
    const online = row({ payment_mode: 'online', owed_iqd: 0, paid_online_iqd: 30000 });
    expect(moneyLineOf(online, lessonStateOf(online, NOW), { t, locale: 'en' })).toBe(
      'Paid online',
    );
    const refunded = row({
      status: 'cancelled',
      cancel_kind: 'coach',
      refund: { status: 'pending', amount_iqd: 30000 },
    });
    expect(moneyLineOf(refunded, lessonStateOf(refunded, NOW), { t, locale: 'en' })).toContain(
      'refunded to your card',
    );
    const nothing = row({ status: 'cancelled', cancel_kind: 'guest_free', refund: null });
    expect(moneyLineOf(nothing, lessonStateOf(nothing, NOW), { t, locale: 'en' })).toBeNull();
  });
});
