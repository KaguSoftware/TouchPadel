/**
 * Every guest lesson state (docs/design/coaching/guest.md §4.8.9): one line
 * per enrolment, for My lessons, the Bookings section and the lesson screen.
 * PURE (vitest).
 *
 * The first matching row of the table wins. The state is decided from the
 * server's fields only (`status`, `cancel_kind`, `lesson_status`,
 * `attendance`, the hold's end, the places and the cut-off); the phone never
 * infers a cancel or a payment the server did not report. The money line is a
 * separate line (`moneyLineOf`), never part of the state.
 */
import {
  countPhrase,
  formatDate,
  formatTime,
  isolate,
  isolateLtr,
  formatIQD,
  type Locale,
  type MessageKey,
  type TParams,
} from '@touch/i18n';
import type { MyLessonRow } from './logic';

export type LessonState =
  | 'confirmNeeded'
  | 'awaitingPayment'
  | 'paymentLapsing'
  | 'needsMore'
  | 'courseRunning'
  | 'moved'
  | 'booked'
  | 'attended'
  | 'noShow'
  | 'done'
  | 'now'
  | 'leftCourse'
  | 'cancelledFree'
  | 'cancelledLate'
  | 'cancelledByCoach'
  | 'cancelledByVenue'
  | 'underFilled'
  | 'courseCancelled'
  | 'paymentExpired'
  | 'unknown';

export type StateInput = Pick<
  MyLessonRow,
  | 'confirmNeeded'
  | 'status'
  | 'kind'
  | 'holdExpiresAt'
  | 'placesTaken'
  | 'minPlaces'
  | 'cutoffAt'
  | 'sessionNo'
  | 'sessionsCount'
  | 'rescheduled'
  | 'startAt'
  | 'endAt'
  | 'attendance'
  | 'lessonStatus'
  | 'cancelKind'
>;

export interface LessonStateInfo {
  state: LessonState;
  /** The instant a `{time}` reads: the hold's end, the cut-off, or the moved start. */
  at: string | null;
  /** `needsMore`: the minimum, for `{people}`. */
  people: number | null;
  /** `courseRunning`: the next session's number and the course's count. */
  n: number | null;
  total: number | null;
}

const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

function info(
  state: LessonState,
  extra: Partial<Omit<LessonStateInfo, 'state'>> = {},
): LessonStateInfo {
  return { state, at: null, people: null, n: null, total: null, ...extra };
}

/** §4.8.9, row by row. `now` on the server's clock when the screen has it. */
export function lessonStateOf(row: StateInput, now: Date): LessonStateInfo {
  const t = now.getTime();
  const start = ms(row.startAt);
  const end = ms(row.endAt);

  // 0. C-21: a typed phone linked this account; nothing else shows until "Yes".
  if (row.confirmNeeded) return info('confirmNeeded');

  if (row.status === 'held') {
    const hold = ms(row.holdExpiresAt);
    // 1. The payment window is open. 2. It ended; the sweep has not run yet.
    return Number.isFinite(hold) && hold > t
      ? info('awaitingPayment', { at: row.holdExpiresAt })
      : info('paymentLapsing');
  }

  if (row.status === 'booked') {
    const cutoff = ms(row.cutoffAt);
    const before = Number.isFinite(start) && t < start;
    // 3. A group or course still under its minimum, before the cut-off (C-14).
    if (
      (row.kind === 'group' || row.kind === 'course') &&
      Number.isFinite(cutoff) &&
      t < cutoff &&
      row.placesTaken < row.minPlaces
    ) {
      return info('needsMore', { at: row.cutoffAt, people: row.minPlaces });
    }
    // 4. A course under way: the row names the guest's next session.
    if (row.kind === 'course' && before && row.sessionNo !== null && row.sessionNo > 1) {
      return info('courseRunning', { n: row.sessionNo, total: row.sessionsCount });
    }
    // 5. Moved after booking (R8), not started. 6. Booked, not started.
    if (before && row.rescheduled) return info('moved', { at: row.startAt });
    if (before) return info('booked');
    // 7, 8. Marked by the coach or the desk.
    if (row.attendance === 'attended') return info('attended');
    if (row.attendance === 'no_show') return info('noShow');
    // 9. Over and unmarked. 10. Under way.
    if (row.lessonStatus === 'completed' || (Number.isFinite(end) && t >= end)) return info('done');
    if (Number.isFinite(start) && t >= start) return info('now');
    return info('unknown');
  }

  if (row.status === 'cancelled') {
    switch (row.cancelKind) {
      case 'guest_free':
      case 'guest_late':
        // 11. Leaving a course reads the same free or late (C-23).
        if (row.kind === 'course') return info('leftCourse');
        // 12, 13.
        return info(row.cancelKind === 'guest_free' ? 'cancelledFree' : 'cancelledLate');
      case 'coach':
        return info('cancelledByCoach');
      case 'staff':
        return info('cancelledByVenue');
      case 'under_filled':
        return info('underFilled');
      case 'course_cancelled':
        return info('courseCancelled');
      case 'expired':
        return info('paymentExpired');
      default:
        return info('unknown');
    }
  }

  // 18. The Qi window lapsed and the place was released.
  if (row.status === 'expired') return info('paymentExpired');
  return info('unknown');
}

type T = (key: MessageKey, params?: TParams) => string;

const STATE_KEYS: Record<LessonState, MessageKey> = {
  confirmNeeded: 'coaching.common.states.confirmNeeded',
  awaitingPayment: 'coaching.common.states.awaitingPayment',
  paymentLapsing: 'coaching.common.states.paymentLapsing',
  needsMore: 'coaching.common.states.needsMore',
  courseRunning: 'coaching.common.states.courseRunning',
  moved: 'coaching.common.states.moved',
  booked: 'coaching.common.states.booked',
  attended: 'coaching.common.states.attended',
  noShow: 'coaching.common.states.noShow',
  done: 'coaching.common.states.done',
  now: 'coaching.common.states.now',
  leftCourse: 'coaching.common.states.leftCourse',
  cancelledFree: 'coaching.common.states.cancelledFree',
  cancelledLate: 'coaching.common.states.cancelledLate',
  cancelledByCoach: 'coaching.common.states.cancelledByCoach',
  cancelledByVenue: 'coaching.common.states.cancelledByVenue',
  underFilled: 'coaching.common.states.underFilled',
  courseCancelled: 'coaching.common.states.courseCancelled',
  paymentExpired: 'coaching.common.states.paymentExpired',
  unknown: 'coaching.common.states.unknown',
};

export function stateKey(state: LessonState): MessageKey {
  return STATE_KEYS[state];
}

/** A time the state reads: today's as a time, another day's with its date. */
function whenOf(iso: string | null, now: Date, locale: Locale, tz: string): string {
  const at = iso ? new Date(iso) : null;
  if (!at || !Number.isFinite(at.getTime())) return '';
  const sameDay = formatDate(at, locale, tz) === formatDate(now, locale, tz);
  return sameDay
    ? formatTime(at, locale, tz)
    : `${formatDate(at, locale, tz)} ${formatTime(at, locale, tz)}`;
}

/** The state's line, its counted phrases and times filled in (`{count}` LTR-isolated, Latin digits). */
export function stateLine(
  s: LessonStateInfo,
  ctx: { t: T; locale: Locale; tz: string; now: Date },
): string {
  const { t, locale, tz, now } = ctx;
  switch (s.state) {
    case 'awaitingPayment':
    case 'moved':
      return t(stateKey(s.state), { time: whenOf(s.at, now, locale, tz) });
    case 'needsMore':
      return t(stateKey(s.state), {
        people: countPhrase('coaching.common.count.people', s.people ?? 0, locale),
        time: whenOf(s.at, now, locale, tz),
      });
    case 'courseRunning':
      return t(stateKey(s.state), {
        n: isolateLtr(String(s.n ?? 0)),
        total: isolateLtr(String(s.total ?? 0)),
      });
    default:
      return t(stateKey(s.state));
  }
}

/**
 * The money line under a state (§4.8.9): rows 5 and 6 say what is left for the
 * desk or that it was paid online; rows 11–17 what came back and what was
 * kept. Null when there is nothing to say. Every figure is the server's.
 */
export function moneyLineOf(
  row: Pick<MyLessonRow, 'paymentMode' | 'owedIqd' | 'paidOnlineIqd' | 'refund'> & {
    keptIqd?: number;
  },
  s: LessonStateInfo,
  ctx: { t: T; locale: Locale },
): string | null {
  const { t, locale } = ctx;
  const money = (n: number) => isolate(formatIQD(n, locale));
  if (
    s.state === 'booked' ||
    s.state === 'moved' ||
    s.state === 'needsMore' ||
    s.state === 'courseRunning'
  ) {
    if (row.owedIqd > 0) return t('coaching.common.money.payAtDesk', { owed: money(row.owedIqd) });
    if (row.paymentMode === 'online' && row.paidOnlineIqd > 0)
      return t('coaching.common.money.paidOnline');
    return null;
  }
  const cancelled: readonly LessonState[] = [
    'leftCourse',
    'cancelledFree',
    'cancelledLate',
    'cancelledByCoach',
    'cancelledByVenue',
    'underFilled',
    'courseCancelled',
  ];
  if (!cancelled.includes(s.state)) return null;
  const parts: string[] = [];
  if (row.refund && row.refund.amountIqd > 0) {
    parts.push(t('coaching.common.money.refunded', { amount: money(row.refund.amountIqd) }));
  }
  if ((row.keptIqd ?? 0) > 0)
    parts.push(t('coaching.common.money.kept', { kept: money(row.keptIqd ?? 0) }));
  return parts.length > 0 ? parts.join(' · ') : null;
}
