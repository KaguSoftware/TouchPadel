import { describe, expect, it } from 'vitest';
import { makeT, type MessageKey } from '@touch/i18n';
import {
  COACHING_CODE_KEYS,
  PHONE_DROPS,
  bookRefusalOf,
  isCoachingCode,
  joinRefusalOf,
  keepsLessonKey,
  lessonBeginRefusalOf,
  lessonErrorCode,
  lessonErrorText,
} from '../errors';
import { DepositEdgeError } from '../../deposit/logic';

const en = makeT('en');
const ar = makeT('ar');
/** A PostgREST refusal: the code is the message, the detail its `details`. */
const refusal = (code: string, details?: string) => ({
  message: code,
  code: 'P0001',
  details: details ?? null,
});

describe('lessonErrorCode', () => {
  it('names a coaching code by its exact spelling, from an RPC or an edge refusal', () => {
    expect(lessonErrorCode(refusal('COACH_BUSY'))).toBe('COACH_BUSY');
    expect(lessonErrorCode(new DepositEdgeError('LESSON_NOT_PAYABLE', 409, 'desk'))).toBe(
      'LESSON_NOT_PAYABLE',
    );
    expect(lessonErrorCode({ message: 'ERROR: NO_COURT_FREE at line 3' })).toBe('NO_COURT_FREE');
  });

  it('falls back to the catalogue’s codes', () => {
    expect(lessonErrorCode(refusal('PHONE_REQUIRED'))).toBe('PHONE_REQUIRED');
    expect(lessonErrorCode(refusal('nothing here'))).toBeNull();
  });
});

describe('the phone’s lines (§4.10)', () => {
  it('has a line in both languages for every code a guest or a coach meets', () => {
    for (const [code, key] of Object.entries(COACHING_CODE_KEYS)) {
      expect(en(key), code).not.toBe(key);
      expect(ar(key), code).not.toBe(key);
      expect(lessonErrorText(refusal(code), en, { locale: 'en' }), code).toBe(en(key));
    }
  });

  it('gives no phone line to a code §4.10 drops (R52)', () => {
    for (const code of PHONE_DROPS) expect(isCoachingCode(code), code).toBe(false);
  });

  const details: [string, string, MessageKey][] = [
    ['ALREADY_ENROLLED', 'coach', 'coaching.common.errors.alreadyEnrolledCoach'],
    ['LESSON_CLOSED', 'cutoff', 'coaching.common.errors.closedCutoff'],
    ['LESSON_NOT_CANCELLABLE', 'private', 'coaching.common.errors.notCancellablePrivate'],
    ['LESSON_NOT_CANCELLABLE', 'course_session', 'coaching.common.errors.notCancellableSession'],
    ['LESSON_NOT_CANCELLABLE', 'started', 'coaching.common.errors.notCancellable'],
    ['SESSION_NOT_MOVABLE', 'order', 'coaching.common.errors.notMovableOrder'],
    ['SESSION_NOT_MOVABLE', 'started', 'coaching.common.errors.sessionNotMovable'],
    ['INVALID_TRANSITION', 'held', 'coaching.common.errors.heldNotMovable'],
    ['INVALID_TRANSITION', 'not_started', 'coaching.common.errors.markNotStarted'],
    ['INVALID_TRANSITION', 'marks_closed', 'coaching.common.errors.marksClosed'],
    ['INVALID_TRANSITION', 'not_booked', 'coaching.common.errors.markNotBooked'],
    ['INVALID_TRANSITION', 'cancelled', 'coaching.common.errors.markCancelled'],
    ['COURSE_STARTS_INVALID', 'count', 'coaching.common.errors.startsCount'],
    ['COURSE_STARTS_INVALID', 'order', 'coaching.common.errors.startsOrder'],
    ['COURSE_STARTS_INVALID', 'span', 'coaching.common.errors.startsSpan'],
    ['HOURS_OVERLAP', 'time_off', 'coaching.common.errors.timeOffOverlap'],
    ['LESSON_NOT_PAYABLE', 'booked', 'coaching.common.errors.notPayableBooked'],
    ['LESSON_NOT_PAYABLE', 'desk', 'coaching.common.errors.notPayableDesk'],
    ['LESSON_NOT_PAYABLE', 'free', 'coaching.common.errors.notPayableFree'],
    ['LESSON_NOT_PAYABLE', 'cancelled', 'coaching.common.errors.notPayable'],
    ['LESSON_NOT_PAYABLE', 'expired', 'coaching.common.errors.notPayable'],
    ['COACH_ADD_LIMIT', 'today', 'coaching.common.errors.addLimit'],
  ];

  it.each(details)('%s · %s', (code, detail, key) => {
    expect(lessonErrorText(refusal(code, detail), en, { locale: 'en' })).toBe(en(key));
  });

  it('reads a detail from an edge refusal too', () => {
    const err = new DepositEdgeError('LESSON_NOT_PAYABLE', 409, 'desk');
    expect(lessonErrorText(err, en, { locale: 'en' })).toBe(
      en('coaching.common.errors.notPayableDesk'),
    );
  });

  it('counted details: the party’s maximum, the lessons in the way, the live cap', () => {
    /** The text without its bidi isolates (counts are LTR-isolated). */
    const plain = (s: string) => s.replace(/[\u2066-\u2069]/g, '');
    expect(plain(lessonErrorText(refusal('PARTY_TOO_LARGE', '4'), en, { locale: 'en' }))).toContain(
      '4 people',
    );
    expect(
      plain(lessonErrorText(refusal('TIME_OFF_HAS_LESSONS', '2'), en, { locale: 'en' })),
    ).toContain('2 lessons');
    expect(
      plain(lessonErrorText(refusal('COACH_ADD_LIMIT', 'live'), en, { locale: 'en', cap: 10 })),
    ).toContain('10');
    // Without the cap known, the daily line.
    expect(lessonErrorText(refusal('COACH_ADD_LIMIT', 'live'), en, { locale: 'en' })).toBe(
      en('coaching.common.errors.addLimit'),
    );
  });

  it('a per-start refusal of a new course names its session (1-based)', () => {
    const text = lessonErrorText(refusal('COACH_BUSY', '2'), en, { locale: 'en' });
    expect(text).toContain(en('coaching.common.errors.coachBusy'));
    expect(text.startsWith('Session')).toBe(true);
    // A catalogue code too, with its own line.
    expect(
      lessonErrorText(refusal('SLOT_IN_PAST', '3'), en, { locale: 'en' }).startsWith('Session'),
    ).toBe(true);
  });

  it('PRICE_CHANGED reads the new price', () => {
    const text = lessonErrorText(
      refusal('PRICE_CHANGED', '{"quoted_iqd":30000,"current_iqd":35000}'),
      en,
      {
        locale: 'en',
      },
    );
    expect(text).toContain('35,000');
  });

  it('TERMS_REQUIRED: accept the terms, or update the app when they are already accepted (§4.9.6)', () => {
    expect(lessonErrorText(refusal('TERMS_REQUIRED'), en, { locale: 'en' })).toBe(
      en('coaching.common.errors.termsRequired'),
    );
    expect(
      lessonErrorText(refusal('TERMS_REQUIRED'), en, { locale: 'en', termsCurrent: true }),
    ).toBe(en('coaching.common.errors.updateApp'));
  });

  it('DEGRADED_LOCKOUT names the branch phone when known', () => {
    expect(
      lessonErrorText(refusal('DEGRADED_LOCKOUT'), en, { locale: 'en', phone: '+9647700000000' }),
    ).toContain('9647700000000');
  });

  it('a catalogue code reads the catalogue (mapErrorToKey)', () => {
    expect(lessonErrorText(refusal('HOLD_COOLDOWN'), en, { locale: 'en' })).toBe(
      en('errors.generic'),
    );
  });
});

describe('where a booking refusal sends the guest (§4.9.1)', () => {
  it.each([
    ['PHONE_REQUIRED', null, 'phone'],
    ['TERMS_REQUIRED', null, 'terms'],
    ['PRICE_CHANGED', null, 'priceChanged'],
    ['COACH_BUSY', null, 'backToGrid'],
    ['NO_COURT_FREE', null, 'backToGrid'],
    ['COACH_UNAVAILABLE', null, 'backToGrid'],
    ['SLOT_IN_PAST', null, 'backToGrid'],
    ['BEYOND_HORIZON', null, 'backToGrid'],
    ['SLOT_NOT_ON_GRID', null, 'backToGrid'],
    ['CLOSED_DATE', null, 'backToGrid'],
    ['OUTSIDE_HOURS', null, 'backToGrid'],
    ['PARTY_TOO_LARGE', '4', 'party'],
    ['ONLINE_PAYMENT_REQUIRED', null, 'mode'],
    ['ONLINE_PAYMENT_OFF', null, 'mode'],
    ['COACHING_OFF', null, 'banner'],
    ['COACH_INACTIVE', null, 'banner'],
    ['COACH_NOT_FOUND', null, 'banner'],
    ['COACH_NOT_AT_BRANCH', null, 'banner'],
    ['LESSON_TYPE_INACTIVE', null, 'banner'],
    ['LESSON_TYPE_NOT_OFFERED', null, 'banner'],
    ['LESSON_TYPE_NOT_FOUND', null, 'banner'],
    ['ALREADY_ENROLLED', 'coach', 'banner'],
    ['DEGRADED_LOCKOUT', null, 'degraded'],
    ['HOLD_QUOTA_EXCEEDED', null, 'inline'],
    ['IDEMPOTENCY_CONFLICT', null, 'inline'],
  ] as const)('%s → %s', (code, detail, expected) => {
    expect(bookRefusalOf(code, detail)).toBe(expected);
  });
});

describe('where a join refusal sends the guest (§4.9.2)', () => {
  it.each([
    ['PHONE_REQUIRED', null, 'phone'],
    ['TERMS_REQUIRED', null, 'terms'],
    ['PRICE_CHANGED', null, 'priceChanged'],
    ['ONLINE_PAYMENT_OFF', null, 'mode'],
    ['DEGRADED_LOCKOUT', null, 'degraded'],
    ['LESSON_NOT_FOUND', null, 'notFound'],
    ['LESSON_FULL', null, 'refetch'],
    ['LESSON_CLOSED', null, 'refetch'],
    ['ALREADY_ENROLLED', null, 'refetch'],
    ['ALREADY_ENROLLED', 'coach', 'banner'],
    ['COACHING_OFF', null, 'banner'],
    ['BOOKING_SUSPENDED', null, 'inline'],
  ] as const)('%s · %s → %s', (code, detail, expected) => {
    expect(joinRefusalOf(code, detail)).toBe(expected);
  });
});

describe('the booking key (§4.7.4)', () => {
  it('survives the refusals the guest fixes and a dropped connection', () => {
    expect(keepsLessonKey(refusal('PHONE_REQUIRED'))).toBe(true);
    expect(keepsLessonKey(refusal('TERMS_REQUIRED'))).toBe(true);
    expect(keepsLessonKey(refusal('PRICE_CHANGED'))).toBe(true);
    expect(keepsLessonKey(new TypeError('Network request failed'))).toBe(true);
  });

  it('is spent on any other refusal', () => {
    for (const code of ['COACH_BUSY', 'IDEMPOTENCY_CONFLICT', 'LESSON_FULL', 'PARTY_TOO_LARGE']) {
      expect(keepsLessonKey(refusal(code)), code).toBe(false);
    }
  });
});

describe('a refused lesson-begin (§4.9.3)', () => {
  it.each([
    ['PHONE_REQUIRED', 'phone'],
    ['LESSON_NOT_PAYABLE', 'notPayable'],
    ['ONLINE_PAYMENT_OFF', 'off'],
    ['COACHING_OFF', 'off'],
    ['DEGRADED_LOCKOUT', 'degraded'],
    ['TOO_MANY_ATTEMPTS', 'inline'],
    ['PROVIDER_UNAVAILABLE', 'inline'],
  ] as const)('%s → %s', (code, expected) => {
    expect(lessonBeginRefusalOf(new DepositEdgeError(code, 409))).toBe(expected);
  });
});
