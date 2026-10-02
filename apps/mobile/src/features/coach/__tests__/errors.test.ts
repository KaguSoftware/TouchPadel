import { describe, expect, it } from 'vitest';
import { countPhrase, makeT, type Locale, type MessageKey } from '@touch/i18n';
import {
  coachErrorCode,
  coachErrorText,
  isNotACoach,
  isSlotRefusal,
  keepsIntentKey,
  refreshAfterRefusal,
} from '../errors';

/**
 * docs/design/coaching/guest.md §4.10 (R52, R73): every code and detail a
 * coach can meet has its own sentence, read off the refusal (a PostgREST error
 * whose message is the code and whose `details` is the detail), in both
 * languages.
 */
const pg = (message: string, details?: string) => ({
  code: 'P0001',
  message,
  details: details ?? '',
});

describe.each<Locale>(['en', 'ar'])('coachErrorText in %s', (locale) => {
  const t = makeT(locale);
  const text = (err: unknown, extra: { privateCap?: number; perStart?: boolean } = {}) =>
    coachErrorText(err, t, { locale, ...extra });

  const rows: [string, string | undefined, MessageKey][] = [
    ['NOT_A_COACH', undefined, 'coaching.coach.errors.notCoach'],
    ['COACHING_OFF', undefined, 'coaching.coach.errors.off'],
    ['COACH_INACTIVE', undefined, 'coaching.coach.errors.inactive'],
    ['COACH_NOT_AT_BRANCH', undefined, 'coaching.coach.errors.notAtBranch'],
    ['LESSON_TYPE_NOT_OFFERED', undefined, 'coaching.coach.errors.typeNotOffered'],
    ['COACH_UNAVAILABLE', undefined, 'coaching.coach.errors.unavailable'],
    ['COACH_BUSY', undefined, 'coaching.coach.errors.busy'],
    ['NO_COURT_FREE', undefined, 'coaching.coach.errors.noCourt'],
    ['SLOT_NOT_ON_GRID', undefined, 'coaching.coach.errors.notOnGrid'],
    ['LESSON_FULL', undefined, 'coaching.coach.errors.full'],
    ['LESSON_CLOSED', undefined, 'coaching.coach.errors.closed'],
    ['LESSON_CLOSED', 'cutoff', 'coaching.coach.errors.closedCutoff'],
    ['LESSON_NOT_FOUND', undefined, 'coaching.coach.errors.lessonNotFound'],
    ['LESSON_NOT_CANCELLABLE', 'private', 'coaching.coach.errors.notCancellablePrivate'],
    ['LESSON_NOT_CANCELLABLE', 'course_session', 'coaching.coach.errors.notCancellableSession'],
    ['LESSON_NOT_CANCELLABLE', 'started', 'coaching.coach.errors.notCancellable'],
    ['SESSION_NOT_MOVABLE', 'order', 'coaching.coach.errors.notMovableOrder'],
    ['SESSION_NOT_MOVABLE', 'started', 'coaching.coach.errors.sessionNotMovable'],
    ['INVALID_TRANSITION', 'held', 'coaching.coach.errors.heldNotMovable'],
    ['INVALID_TRANSITION', 'not_started', 'coaching.coach.errors.markNotStarted'],
    ['INVALID_TRANSITION', 'marks_closed', 'coaching.coach.errors.marksClosed'],
    ['INVALID_TRANSITION', 'not_booked', 'coaching.coach.errors.markNotBooked'],
    ['INVALID_TRANSITION', 'cancelled', 'coaching.coach.errors.markCancelled'],
    ['COURSE_STARTS_INVALID', 'count', 'coaching.coach.errors.startsCount'],
    ['COURSE_STARTS_INVALID', 'order', 'coaching.coach.errors.startsOrder'],
    ['COURSE_STARTS_INVALID', 'span', 'coaching.coach.errors.startsSpan'],
    ['HOURS_INVALID', '2', 'coaching.coach.errors.hoursInvalid'],
    ['HOURS_OVERLAP', '1:3', 'coaching.coach.errors.hoursOverlap'],
    ['HOURS_OVERLAP', 'time_off', 'coaching.coach.errors.timeOffOverlap'],
    ['TIME_OFF_HAS_LESSONS', undefined, 'coaching.coach.errors.timeOffHasLessons'],
    ['COACH_ADD_LIMIT', 'day', 'coaching.coach.errors.addLimit'],
    ['INVALID_ARGUMENT', 'p_id', 'coaching.coach.errors.timeOffGone'],
  ];

  it.each(rows)('%s · %s', (code, detail, key) => {
    expect(text(pg(code, detail))).toBe(t(key));
  });

  it('counts the lessons in the way of time off, and the people a lesson takes', () => {
    expect(text(pg('TIME_OFF_HAS_LESSONS', '3'))).toBe(
      t('coaching.coach.errors.timeOffHasLessonsCount', {
        lessons: countPhrase('coaching.coach.count.lessons', 3, locale),
      }),
    );
    expect(text(pg('PARTY_TOO_LARGE', '4'))).toBe(
      t('coaching.coach.errors.partyTooLargeMax', {
        people: countPhrase('coaching.coach.count.people', 4, locale),
      }),
    );
  });

  it('names the private cap on COACH_ADD_LIMIT · live (R56)', () => {
    expect(text(pg('COACH_ADD_LIMIT', 'live'), { privateCap: 10 })).toBe(
      t('coaching.coach.errors.addLimitLive', { cap: '10' }),
    );
    expect(text(pg('COACH_ADD_LIMIT', 'live'))).toBe(t('coaching.coach.errors.addLimitLiveShort'));
  });

  it('prefixes a course creation’s per-start refusal with its session', () => {
    expect(text(pg('COACH_BUSY', '3'), { perStart: true })).toBe(
      t('coaching.coach.errors.sessionPrefix', { n: '3', line: t('coaching.coach.errors.busy') }),
    );
    expect(text(pg('CLOSED_DATE', '2'), { perStart: true })).toBe(
      t('coaching.coach.errors.sessionPrefix', { n: '2', line: t('booking.closedDate') }),
    );
    expect(text(pg('COACH_BUSY', '3'))).toBe(t('coaching.coach.errors.busy'));
  });

  it('leaves everything else to the shared catalogue', () => {
    expect(text(pg('DEGRADED_LOCKOUT'))).toBe(t('degraded.bookingRefusedShort'));
    expect(text(new TypeError('Network request failed'))).toBe(t('errors.network'));
  });
});

describe('the refusal helpers', () => {
  it('reads the code off the message', () => {
    expect(coachErrorCode(pg('HOURS_OVERLAP', '0'))).toBe('HOURS_OVERLAP');
    expect(coachErrorCode({ message: 'something broke' })).toBeNull();
  });

  it('knows NOT_A_COACH, which re-gates coach mode', () => {
    expect(isNotACoach(pg('NOT_A_COACH'))).toBe(true);
    expect(isNotACoach(pg('LESSON_NOT_FOUND'))).toBe(false);
  });

  it('keeps an idempotency key across a transport failure only (guest.md §4.7.4)', () => {
    expect(keepsIntentKey(new TypeError('Network request failed'))).toBe(true);
    expect(keepsIntentKey(pg('COACH_BUSY'))).toBe(false);
  });

  it('re-reads what a refusal shows to be stale (MB-06, MB-08)', () => {
    const none = { me: false, slots: false, all: false };
    for (const code of ['COACH_BUSY', 'NO_COURT_FREE', 'COACH_UNAVAILABLE']) {
      expect(refreshAfterRefusal(pg(code))).toEqual({ ...none, slots: true });
      expect(isSlotRefusal(pg(code))).toBe(true);
    }
    for (const code of ['NOT_A_COACH', 'COACH_INACTIVE', 'COACHING_OFF']) {
      expect(refreshAfterRefusal(pg(code))).toEqual({ ...none, me: true });
      expect(isSlotRefusal(pg(code))).toBe(false);
    }
    expect(refreshAfterRefusal(pg('HOURS_OVERLAP', 'time_off'))).toEqual({ ...none, all: true });
    expect(refreshAfterRefusal(pg('LESSON_FULL'))).toEqual(none);
    expect(refreshAfterRefusal(new TypeError('Network request failed'))).toEqual(none);
  });
});
