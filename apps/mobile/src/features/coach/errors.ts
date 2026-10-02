/**
 * Coach-mode refusals on the phone (docs/design/coaching/guest.md §4.10,
 * §4.13; build contracts R52, R73: every code and detail a coach can meet has
 * its own sentence). PURE.
 *
 * The coach's lines live in `coaching.coach.errors.*` and are read here by
 * code and detail before the shared catalogue (`mapErrorToKey`,
 * features/booking/errors.ts) answers everything else: degraded mode, a
 * dropped connection, a closed date, an idempotency conflict. A code the
 * catalogue does not know yet still reaches its line here, because the code
 * is read straight off the refusal (a PostgREST error whose message is the
 * code and whose `details` is the detail).
 */
import { countPhrase, type Locale, type MessageKey, type TParams } from '@touch/i18n';
import { mapErrorToKey, rpcErrorCode, rpcErrorDetail } from '../booking/errors';
import { errorMessageOf, isTransportError } from '../../lib/network';
import { startIndexOf } from './logic';

type T = (key: MessageKey, params?: TParams) => string;

const CODE_RE = /^[A-Z][A-Z0-9_]{2,}$/;

/** The refusal's code: the message itself when it is one, else a known code inside it. */
export function coachErrorCode(err: unknown): string | null {
  const message = errorMessageOf(err)?.trim() ?? null;
  if (message && CODE_RE.test(message)) return message;
  return rpcErrorCode(message);
}

/** NOT_A_COACH from any coach-mode call: coach_me is re-read and RequireCoach re-gates (§4.10). */
export function isNotACoach(err: unknown): boolean {
  return coachErrorCode(err) === 'NOT_A_COACH';
}

/**
 * Whether a keyed write's idempotency key survives the failure (guest.md
 * §4.7.4): only a transport failure, where the write may have landed. Any
 * refusal created nothing with that key.
 */
export function keepsIntentKey(err: unknown): boolean {
  return isTransportError(err);
}

/** The plain line of each code a coach can meet (detail-free). */
const CODE_LINES: Record<string, MessageKey> = {
  NOT_A_COACH: 'coaching.coach.errors.notCoach',
  COACHING_OFF: 'coaching.coach.errors.off',
  COACH_INACTIVE: 'coaching.coach.errors.inactive',
  COACH_NOT_FOUND: 'coaching.coach.errors.notCoach',
  COACH_NOT_AT_BRANCH: 'coaching.coach.errors.notAtBranch',
  LESSON_TYPE_NOT_FOUND: 'coaching.coach.errors.typeNotFound',
  LESSON_TYPE_INACTIVE: 'coaching.coach.errors.typeInactive',
  LESSON_TYPE_NOT_OFFERED: 'coaching.coach.errors.typeNotOffered',
  COACH_UNAVAILABLE: 'coaching.coach.errors.unavailable',
  COACH_BUSY: 'coaching.coach.errors.busy',
  NO_COURT_FREE: 'coaching.coach.errors.noCourt',
  SLOT_NOT_ON_GRID: 'coaching.coach.errors.notOnGrid',
  SLOT_IN_PAST: 'coaching.coach.errors.inPast',
  PARTY_TOO_LARGE: 'coaching.coach.errors.partyTooLarge',
  LESSON_FULL: 'coaching.coach.errors.full',
  LESSON_CLOSED: 'coaching.coach.errors.closed',
  LESSON_NOT_FOUND: 'coaching.coach.errors.lessonNotFound',
  ENROLMENT_NOT_FOUND: 'coaching.coach.errors.enrolmentNotFound',
  LESSON_NOT_CANCELLABLE: 'coaching.coach.errors.notCancellable',
  HOURS_INVALID: 'coaching.coach.errors.hoursInvalid',
  HOURS_OVERLAP: 'coaching.coach.errors.hoursOverlap',
  TIME_OFF_HAS_LESSONS: 'coaching.coach.errors.timeOffHasLessons',
  COURSE_STARTS_INVALID: 'coaching.coach.errors.courseStartsInvalid',
  SESSION_NOT_MOVABLE: 'coaching.coach.errors.sessionNotMovable',
  COACH_ADD_LIMIT: 'coaching.coach.errors.addLimit',
};

/** Code · detail lines (guest.md §4.10 "Details"). */
const DETAIL_LINES: Record<string, Record<string, MessageKey>> = {
  LESSON_CLOSED: { cutoff: 'coaching.coach.errors.closedCutoff' },
  LESSON_NOT_CANCELLABLE: {
    private: 'coaching.coach.errors.notCancellablePrivate',
    course_session: 'coaching.coach.errors.notCancellableSession',
  },
  SESSION_NOT_MOVABLE: { order: 'coaching.coach.errors.notMovableOrder' },
  INVALID_TRANSITION: {
    held: 'coaching.coach.errors.heldNotMovable',
    not_started: 'coaching.coach.errors.markNotStarted',
    marks_closed: 'coaching.coach.errors.marksClosed',
    not_booked: 'coaching.coach.errors.markNotBooked',
    cancelled: 'coaching.coach.errors.markCancelled',
  },
  COURSE_STARTS_INVALID: {
    count: 'coaching.coach.errors.startsCount',
    order: 'coaching.coach.errors.startsOrder',
    span: 'coaching.coach.errors.startsSpan',
  },
  HOURS_OVERLAP: { time_off: 'coaching.coach.errors.timeOffOverlap' },
  INVALID_ARGUMENT: { p_id: 'coaching.coach.errors.timeOffGone' },
};

/** The codes `coach_create_course` raises per start with detail `i` (1-based; db.md §4.7.4). */
const PER_START = new Set([
  'SLOT_NOT_ON_GRID',
  'SLOT_IN_PAST',
  'CLOSED_DATE',
  'OUTSIDE_HOURS',
  'COACH_UNAVAILABLE',
  'COACH_BUSY',
  'NO_COURT_FREE',
]);

export interface CoachErrorContext {
  locale: Locale;
  /** R56: the coach's cap of upcoming coach-booked private lessons, for `COACH_ADD_LIMIT` `live`. */
  privateCap?: number | null;
  /** The call names starts by index (`coach_create_course`): a per-start detail gets "Session {n}: …". */
  perStart?: boolean;
}

/** The base line of a refusal, without the per-start prefix. */
function baseLine(
  code: string | null,
  detail: string | null,
  err: unknown,
  t: T,
  ctx: CoachErrorContext,
): string {
  if (code) {
    const byDetail = detail ? DETAIL_LINES[code]?.[detail] : undefined;
    if (byDetail) return t(byDetail);
    if (code === 'TIME_OFF_HAS_LESSONS' && detail && /^\d+$/.test(detail) && Number(detail) > 0) {
      return t('coaching.coach.errors.timeOffHasLessonsCount', {
        lessons: countPhrase('coaching.coach.count.lessons', Number(detail), ctx.locale),
      });
    }
    if (code === 'PARTY_TOO_LARGE' && detail && /^\d+$/.test(detail) && Number(detail) > 0) {
      return t('coaching.coach.errors.partyTooLargeMax', {
        people: countPhrase('coaching.coach.count.people', Number(detail), ctx.locale),
      });
    }
    if (code === 'COACH_ADD_LIMIT' && detail === 'live') {
      return ctx.privateCap != null && ctx.privateCap > 0
        ? t('coaching.coach.errors.addLimitLive', { cap: String(ctx.privateCap) })
        : t('coaching.coach.errors.addLimitLiveShort');
    }
    const plain = CODE_LINES[code];
    if (plain) return t(plain);
  }
  return t(mapErrorToKey(err));
}

/** The sentence a coach reads for any coach-mode failure. */
export function coachErrorText(err: unknown, t: T, ctx: CoachErrorContext): string {
  const code = coachErrorCode(err);
  const detail = rpcErrorDetail(err);
  const line = baseLine(code, detail, err, t, ctx);
  if (ctx.perStart && code && PER_START.has(code)) {
    const n = startIndexOf(detail);
    if (n !== null) return t('coaching.coach.errors.sessionPrefix', { n: String(n), line });
  }
  return line;
}
