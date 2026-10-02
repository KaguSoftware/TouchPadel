/**
 * Coaching refusals on the phone (docs/design/coaching/guest.md §4.9, §4.10).
 * PURE.
 *
 * The phone's line for every coaching code a guest or a coach can meet, and
 * the detail sentences (R52, X31), keyed `coaching.common.errors.<name>`.
 * `lessonErrorText` reads them before the catalogue (`mapErrorToKey`), as
 * `matchErrorText` does for open matches. The catalogue itself
 * (packages/i18n/src/errors.ts) is the database lane's: until it carries the
 * coaching codes, `errorCode` cannot name them, so this file recognises them
 * by their own spelling (`lessonErrorCode`). Once the catalogue has them the
 * two readings agree, and the same lines can move into `MOBILE_OVERRIDES`.
 *
 * It also says which way a refusal sends the guest (the profile, the terms,
 * back to the grid, the refusal banner) and whether the booking key survives
 * it (§4.7.4).
 */
import {
  countPhrase,
  formatIQD,
  isolate,
  isolateLtr,
  type Locale,
  type MessageKey,
  type TParams,
} from '@touch/i18n';
import { isDegradedRefusal, mapErrorToKey, rpcErrorCode, rpcErrorDetail } from '../booking/errors';
import { parsePriceChanged } from '../matches/errors';
import { errorMessageOf, isTransportError } from '../../lib/network';

type T = (key: MessageKey, params?: TParams) => string;

/** Every coaching code of §1.10 a guest or a coach meets (§4.10's table), with its phone line. */
export const COACHING_CODE_KEYS = {
  COACHING_OFF: 'coaching.common.errors.off',
  COACH_NOT_FOUND: 'coaching.common.errors.coachNotFound',
  COACH_INACTIVE: 'coaching.common.errors.coachInactive',
  COACH_NOT_AT_BRANCH: 'coaching.common.errors.coachNotAtBranch',
  LESSON_TYPE_NOT_FOUND: 'coaching.common.errors.typeNotFound',
  LESSON_TYPE_INACTIVE: 'coaching.common.errors.typeInactive',
  LESSON_TYPE_NOT_OFFERED: 'coaching.common.errors.typeNotOffered',
  COACH_UNAVAILABLE: 'coaching.common.errors.coachUnavailable',
  COACH_BUSY: 'coaching.common.errors.coachBusy',
  NO_COURT_FREE: 'coaching.common.errors.noCourt',
  SLOT_NOT_ON_GRID: 'coaching.common.errors.notOnGrid',
  PARTY_TOO_LARGE: 'coaching.common.errors.partyTooLarge',
  LESSON_FULL: 'coaching.common.errors.full',
  LESSON_CLOSED: 'coaching.common.errors.closed',
  ALREADY_ENROLLED: 'coaching.common.errors.alreadyEnrolled',
  LESSON_NOT_FOUND: 'coaching.common.errors.notFound',
  ENROLMENT_NOT_FOUND: 'coaching.common.errors.enrolmentNotFound',
  LESSON_NOT_CANCELLABLE: 'coaching.common.errors.notCancellable',
  LESSON_NOT_PAYABLE: 'coaching.common.errors.notPayable',
  ONLINE_PAYMENT_REQUIRED: 'coaching.common.errors.onlineRequired',
  ONLINE_PAYMENT_OFF: 'coaching.common.errors.onlineOff',
  NOT_A_COACH: 'coaching.common.errors.notCoach',
  HOURS_INVALID: 'coaching.common.errors.hoursInvalid',
  HOURS_OVERLAP: 'coaching.common.errors.hoursOverlap',
  TIME_OFF_HAS_LESSONS: 'coaching.common.errors.timeOffHasLessons',
  COURSE_STARTS_INVALID: 'coaching.common.errors.courseStartsInvalid',
  SESSION_NOT_MOVABLE: 'coaching.common.errors.sessionNotMovable',
  COACH_ADD_LIMIT: 'coaching.common.errors.addLimit',
} as const satisfies Record<string, MessageKey>;

export type CoachingCode = keyof typeof COACHING_CODE_KEYS;

/**
 * Codes §4.10 drops: the phone never meets them (rule 3 of db §4.7.1 answers a
 * guest or a coach with not-found codes), so they keep the catalogue's
 * operator line and get no phone line here (R52).
 */
export const PHONE_DROPS = [
  'ALREADY_COACH',
  'LESSON_VIA_COACHING',
  'LESSON_OWED_CHANGED',
  'LESSON_TAB_NO_GOODS',
  'PRICE_VIA_PROTOCOL',
  'LAUNCH_VIA_PROTOCOL',
  'STATEMENT_NOT_DRAFT',
  'STATEMENT_NOT_APPROVED',
  'STATEMENT_REFERENCE_REQUIRED',
  'PIN_GRANT_REQUIRED',
  'BRANCH_HAS_BOOKINGS',
  'NOT_STEP_ACTOR',
  'PRICE_TARGET_CHANGED',
  'VENUE_MISMATCH',
] as const;

const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

export function isCoachingCode(value: unknown): value is CoachingCode {
  return typeof value === 'string' && has(COACHING_CODE_KEYS, value);
}

/** A whole upper-snake word (the catalogue's CODE_WORD). */
const CODE_WORD = /\b[A-Z][A-Z0-9_]*[A-Z0-9]\b/g;

/**
 * The code a refusal names: a coaching code by its exact spelling (the
 * PostgREST message, an edge body's `error`), else the catalogue's reading,
 * else a coaching code word inside a longer message. Null for none.
 */
export function lessonErrorCode(err: unknown): string | null {
  const message = errorMessageOf(err);
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : null;
  for (const v of [code, message]) {
    if (isCoachingCode(typeof v === 'string' ? v.trim() : v)) return (v as string).trim();
  }
  const known = rpcErrorCode(message);
  if (known) return known;
  for (const word of message?.match(CODE_WORD) ?? []) if (isCoachingCode(word)) return word;
  return null;
}

/** The coaching codes that come back per course start, with the start's 1-based index as detail. */
const PER_START = new Set([
  'SLOT_NOT_ON_GRID',
  'SLOT_IN_PAST',
  'CLOSED_DATE',
  'OUTSIDE_HOURS',
  'COACH_UNAVAILABLE',
  'COACH_BUSY',
  'NO_COURT_FREE',
]);

/** `<code> · <detail>` → its own sentence (§4.10 Details; an unknown detail falls back to the code's line). */
const DETAIL_KEYS: Readonly<Record<string, Readonly<Record<string, MessageKey>>>> = {
  ALREADY_ENROLLED: { coach: 'coaching.common.errors.alreadyEnrolledCoach' },
  LESSON_CLOSED: { cutoff: 'coaching.common.errors.closedCutoff' },
  LESSON_NOT_CANCELLABLE: {
    private: 'coaching.common.errors.notCancellablePrivate',
    course_session: 'coaching.common.errors.notCancellableSession',
  },
  SESSION_NOT_MOVABLE: { order: 'coaching.common.errors.notMovableOrder' },
  INVALID_TRANSITION: {
    held: 'coaching.common.errors.heldNotMovable',
    not_started: 'coaching.common.errors.markNotStarted',
    marks_closed: 'coaching.common.errors.marksClosed',
    not_booked: 'coaching.common.errors.markNotBooked',
    cancelled: 'coaching.common.errors.markCancelled',
  },
  COURSE_STARTS_INVALID: {
    count: 'coaching.common.errors.startsCount',
    order: 'coaching.common.errors.startsOrder',
    span: 'coaching.common.errors.startsSpan',
  },
  HOURS_OVERLAP: { time_off: 'coaching.common.errors.timeOffOverlap' },
  LESSON_NOT_PAYABLE: {
    booked: 'coaching.common.errors.notPayableBooked',
    desk: 'coaching.common.errors.notPayableDesk',
    free: 'coaching.common.errors.notPayableFree',
  },
};

export interface LessonErrorContext {
  locale: Locale;
  /** The branch's phone: DEGRADED_LOCKOUT then reads `degraded.bookingRefused`. */
  phone?: string | null;
  /** The coach's open-private cap, for COACH_ADD_LIMIT `live` (R56). */
  cap?: number | null;
  /**
   * The account has already accepted this build's terms: TERMS_REQUIRED then
   * means the server's lessons terms are newer than the app's, and reads
   * "update the app" (§4.9.6).
   */
  termsCurrent?: boolean;
}

/** The line a code reads on its own: the coaching line, else the catalogue's. */
function codeLine(code: string | null, err: unknown, t: T): string {
  if (isCoachingCode(code)) return t(COACHING_CODE_KEYS[code]);
  return t(mapErrorToKey(code ? { message: code } : err));
}

/**
 * The line a coaching refusal reads (§4.10), detail first, then the screen
 * overrides (TERMS_REQUIRED, DEGRADED_LOCKOUT), then the coaching line, then
 * the catalogue.
 */
export function lessonErrorText(err: unknown, t: T, ctx: LessonErrorContext): string {
  const code = lessonErrorCode(err);
  const detail = rpcErrorDetail(err);
  if (code && detail) {
    const key = DETAIL_KEYS[code]?.[detail];
    if (key) return t(key);
    const n = /^\d+$/.test(detail) ? Number(detail) : null;
    if (code === 'PARTY_TOO_LARGE' && n !== null) {
      return t('coaching.common.errors.partyTooLargeMax', {
        people: countPhrase('coaching.common.count.people', n, ctx.locale),
      });
    }
    if (code === 'TIME_OFF_HAS_LESSONS' && n !== null) {
      return t('coaching.common.errors.timeOffHasLessonsCount', {
        lessons: countPhrase('coaching.common.count.lessons', n, ctx.locale),
      });
    }
    if (code === 'COACH_ADD_LIMIT' && detail === 'live' && typeof ctx.cap === 'number') {
      return t('coaching.common.errors.addLimitLive', { cap: isolateLtr(String(ctx.cap)) });
    }
    if (PER_START.has(code) && n !== null && n >= 1) {
      return t('coaching.common.errors.sessionPrefix', {
        n: isolateLtr(String(n)),
        line: codeLine(code, err, t),
      });
    }
    if (code === 'PRICE_CHANGED') {
      const price = parsePriceChanged(detail)?.currentIqd;
      if (typeof price === 'number') {
        return t('coaching.common.errors.priceChangedTo', {
          price: isolate(formatIQD(price, ctx.locale)),
        });
      }
    }
  }
  if (code === 'TERMS_REQUIRED') {
    return t(
      ctx.termsCurrent
        ? 'coaching.common.errors.updateApp'
        : 'coaching.common.errors.termsRequired',
    );
  }
  if (isDegradedRefusal(errorMessageOf(err)) && ctx.phone) {
    return t('degraded.bookingRefused', { phone: isolate(ctx.phone) });
  }
  return codeLine(code, err, t);
}

// ── Where a refusal sends the guest ─────────────────────────────────────────

/**
 * What `lesson-review` does with a `lesson_book_private` refusal (§4.9.1 step 7):
 *  phone         /complete-profile?returnTo=back (key kept)
 *  terms         the terms gate (§4.9.6) (key kept)
 *  priceChanged  the server's price inline, the profile refetched (key kept)
 *  backToGrid    toast, the slots refetched, back to the grid
 *  party         inline under the stepper, the stepper clamped to the detail
 *  mode          the branch settings refetched, the choice re-rendered
 *  banner        the refusal banner, primary hidden
 *  degraded      `degraded.bookingRefused` with the branch phone
 *  inline        the refusal's copy on the form
 */
export type BookRefusal =
  | 'phone'
  | 'terms'
  | 'priceChanged'
  | 'backToGrid'
  | 'party'
  | 'mode'
  | 'banner'
  | 'degraded'
  | 'inline';

const BACK_TO_GRID = new Set([
  'COACH_BUSY',
  'NO_COURT_FREE',
  'COACH_UNAVAILABLE',
  'SLOT_IN_PAST',
  'BEYOND_HORIZON',
  'SLOT_NOT_ON_GRID',
  'CLOSED_DATE',
  'OUTSIDE_HOURS',
]);

const BANNER = new Set([
  'COACHING_OFF',
  'COACH_INACTIVE',
  'COACH_NOT_FOUND',
  'COACH_NOT_AT_BRANCH',
  'LESSON_TYPE_INACTIVE',
  'LESSON_TYPE_NOT_OFFERED',
  'LESSON_TYPE_NOT_FOUND',
]);

export function bookRefusalOf(code: string | null, detail: string | null = null): BookRefusal {
  switch (code) {
    case 'PHONE_REQUIRED':
      return 'phone';
    case 'TERMS_REQUIRED':
      return 'terms';
    case 'PRICE_CHANGED':
      return 'priceChanged';
    case 'PARTY_TOO_LARGE':
      return 'party';
    case 'ONLINE_PAYMENT_REQUIRED':
    case 'ONLINE_PAYMENT_OFF':
      return 'mode';
    case 'DEGRADED_LOCKOUT':
      return 'degraded';
    case 'ALREADY_ENROLLED':
      return detail === 'coach' ? 'banner' : 'inline';
    default:
      if (code !== null && BACK_TO_GRID.has(code)) return 'backToGrid';
      if (code !== null && BANNER.has(code)) return 'banner';
      return 'inline';
  }
}

/**
 * What `class/[id]` does with a `lesson_join` / `course_join` refusal (§4.9.2):
 * as a booking for the gate, the terms, the price, the payment modes and the
 * degraded mode; plus
 *  notFound  the not-found layout
 *  refetch   the offer read again: its status line, or "See your booking", replaces the primary
 *  banner    the switch is off, or the guest is this lesson's coach (R56)
 */
export type JoinRefusal =
  | 'phone'
  | 'terms'
  | 'priceChanged'
  | 'mode'
  | 'degraded'
  | 'notFound'
  | 'refetch'
  | 'banner'
  | 'inline';

export function joinRefusalOf(code: string | null, detail: string | null = null): JoinRefusal {
  switch (code) {
    case 'PHONE_REQUIRED':
      return 'phone';
    case 'TERMS_REQUIRED':
      return 'terms';
    case 'PRICE_CHANGED':
      return 'priceChanged';
    case 'ONLINE_PAYMENT_REQUIRED':
    case 'ONLINE_PAYMENT_OFF':
      return 'mode';
    case 'DEGRADED_LOCKOUT':
      return 'degraded';
    case 'LESSON_NOT_FOUND':
      return 'notFound';
    case 'LESSON_FULL':
    case 'LESSON_CLOSED':
      return 'refetch';
    case 'ALREADY_ENROLLED':
      return detail === 'coach' ? 'banner' : 'refetch';
    case 'COACHING_OFF':
      return 'banner';
    default:
      return 'inline';
  }
}

/** The refusals the guest fixes and retries: a refused call created nothing, so the key is unspent (§4.7.4). */
const KEEPS_KEY = new Set(['PHONE_REQUIRED', 'TERMS_REQUIRED', 'PRICE_CHANGED']);

/**
 * Whether a failed booking or join keeps its idempotency key: yes for the
 * refusals the guest fixes, and for a request that never came back (the retry
 * must carry the same key, or a booking that committed would be made twice);
 * no for any other refusal, which ends the intent.
 */
export function keepsLessonKey(err: unknown): boolean {
  if (isTransportError(err)) return true;
  const code = lessonErrorCode(err);
  return code !== null && KEEPS_KEY.has(code);
}

/**
 * What a refused `lesson-begin` does (§4.9.3):
 *  phone       /complete-profile?returnTo=back
 *  notPayable  its detail's line and a refetch of the lesson
 *  off         its line and "Call {branch}" (ONLINE_PAYMENT_OFF, COACHING_OFF)
 *  degraded    `degraded.bookingRefused`
 *  inline      the deposit's or the catalogue's line
 */
export type LessonBeginRefusal = 'phone' | 'notPayable' | 'off' | 'degraded' | 'inline';

export function lessonBeginRefusalOf(err: unknown): LessonBeginRefusal {
  switch (lessonErrorCode(err)) {
    case 'PHONE_REQUIRED':
      return 'phone';
    case 'LESSON_NOT_PAYABLE':
      return 'notPayable';
    case 'ONLINE_PAYMENT_OFF':
    case 'COACHING_OFF':
      return 'off';
    case 'DEGRADED_LOCKOUT':
      return 'degraded';
    default:
      return 'inline';
  }
}
