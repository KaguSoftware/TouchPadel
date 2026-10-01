import { iqd, sumIqd, MoneyError, type IQD } from '../money/iqd';
import { splitEvenly } from '../money/split';

/**
 * Coaching money twins (docs/design/coaching/money.md §5.1, §5.2, §7.1; build contracts §1.11).
 *
 * Each function here has a SQL twin in migration 0278 and the database's parity tests pin them
 * together over awkward amounts, so the arithmetic must stay exactly the SQL's:
 *
 *   lessonCoachShare     ↔ app.lesson_coach_share(bigint, bigint, int)
 *   allocateCourseMoney  ↔ app.iqd_split(bigint, int)            (R2, R60: the twin of splitEvenly)
 *   courseLateJoinPrice  ↔ app.course_late_join_price(bigint, int, int)
 *   courseLeaveRefund    ↔ lesson_enrolment_money's refund_due for a guest_late course leave (R62)
 *
 * Integer IQD only (./money/iqd.ts): no float ever carries money. The clients never price with
 * these (guest.md §4 rule 4, operator.md §5.1): they render the server's figures. The twins exist
 * so the server's numbers can be proven, and for tests.
 */

/** Basis points in one whole: coach_share_bp 6000 is 60 % (CD-5). */
export const BASIS_POINTS = 10_000;

function shareBpOf(shareBp: number): number {
  if (!Number.isInteger(shareBp) || shareBp < 0 || shareBp > BASIS_POINTS) {
    throw new MoneyError(
      'INVALID_ARGUMENT',
      `share_bp must be an integer in 0..${BASIS_POINTS}, got ${String(shareBp)}`,
    );
  }
  return shareBp;
}

/**
 * C-6, CD-5: what the coach earns on one lesson (one session).
 *
 *   floor(shareBp × max(0, collected − courtShare) / 10000)
 *
 * `collectedIqd` is the money the venue kept on that session (money.md §7.1 `collected_L`), and
 * `courtShareIqd` is the lesson's snapshotted court share. A lesson that collected no more than its
 * court share earns the coach 0. The product is taken in BigInt so it is exact for every safe
 * integer, as the SQL twin's bigint division is.
 */
export function lessonCoachShare(
  collectedIqd: number,
  courtShareIqd: number,
  shareBp: number,
): IQD {
  const collected = iqd(collectedIqd);
  const courtShare = iqd(courtShareIqd);
  const bp = shareBpOf(shareBp);
  const base = Math.max(0, collected - courtShare);
  return iqd(Number((BigInt(bp) * BigInt(base)) / BigInt(BASIS_POINTS)));
}

/**
 * CM-4: the money kept on one enrolment, spread evenly over the sessions it pays for: largest
 * remainder, the first sessions get the extra dinar. This is `splitEvenly` (and `app.iqd_split`)
 * under the name the statement code uses; Σ allocation === keptIqd, exactly.
 */
export function allocateCourseMoney(keptIqd: number, sessions: number): IQD[] {
  return splitEvenly(keptIqd, sessions);
}

/**
 * C-15: the price of a course joined late, from session `firstSessionNo` (1-based) on: the course
 * price split evenly over its sessions, summed over the sessions from `firstSessionNo` to the last
 * (the suffix of the split; money.md §5.1 `where i >= p_first_session_no`).
 *
 * `firstSessionNo` 1 is the whole price. A number past the last session prices nothing (0), as the
 * SQL twin's `coalesce(sum, 0)` does; sign-up closes when the last session starts (C-15), so the
 * server never asks. A session number below 1 is refused.
 *
 * Why a late joiner pays per session exactly what a full member pays: every suffix of an even split
 * is the even split of its own sum (money.md §5.1), so
 * `splitEvenly(courseLateJoinPrice(P, N, f), N − f + 1)[i] === splitEvenly(P, N)[f − 1 + i]`.
 */
export function courseLateJoinPrice(
  coursePriceIqd: number,
  sessionsCount: number,
  firstSessionNo: number,
): IQD {
  const shares = splitEvenly(coursePriceIqd, sessionsCount);
  if (!Number.isInteger(firstSessionNo) || firstSessionNo < 1) {
    throw new MoneyError(
      'INVALID_ARGUMENT',
      `first session number must be an integer >= 1, got ${String(firstSessionNo)}`,
    );
  }
  return sumIqd(shares.slice(firstSessionNo - 1));
}

/** One covered session of a course enrolment, as `courseLeaveRefund` reads it. */
export interface CourseLeaveSession {
  /** The enrolment's share of this session: `splitEvenly(price, sessionsCovered)[i]`. */
  shareIqd: number;
  startAt: Date;
  /** When the venue cancelled this session (it is cancelled now); null while it is not. */
  cancelledAt: Date | null;
}

const HOUR_MS = 3_600_000;

function instantOf(value: Date, name: string): number {
  const ms = value instanceof Date ? value.getTime() : NaN;
  if (!Number.isFinite(ms)) {
    throw new MoneyError('INVALID_ARGUMENT', `${name} must be a valid Date`);
  }
  return ms;
}

/**
 * C-23, R62: what a late course leave (`guest_late`) refunds, assuming nothing was refunded yet.
 *
 * `sessions` are the enrolment's covered sessions (any order) with its own shares. With
 * `N` = the guest's next covered session at `leftAt` (the first by start time that starts at or
 * after `leftAt` and was not cancelled by then), a session is **kept** when it is not cancelled
 * and either starts before `leftAt + windowHours` (begun, or inside the cancellation window) or is
 * `N`. The refund is Σ the shares of every other session (money.md §5.2, the engine's
 * `guest_late`/course row: `L.status <> 'cancelled' and (L.start_at < e.cancelled_at + W or L =
 * N_e)`).
 *
 * This is the late rule only. The database decides the kind (C-23: late when `N` is inside the
 * window); a free leave (`guest_free`) refunds `N` too, by the engine's other row. A venue cancel of
 * a kept session after the leave (its `cancelledAt` later than `leftAt`) takes it out of the kept
 * set, so the result grows by its share: that part is what `lesson_refunds_due` lists as
 * `online_blocked_iqd` when the row's one refund has already gone (CM-5, R75).
 */
export function courseLeaveRefund(
  sessions: readonly CourseLeaveSession[],
  leftAt: Date,
  windowHours: number,
): IQD {
  const left = instantOf(leftAt, 'leftAt');
  if (!Number.isInteger(windowHours) || windowHours < 0) {
    throw new MoneyError(
      'INVALID_ARGUMENT',
      `windowHours must be a non-negative integer, got ${String(windowHours)}`,
    );
  }
  const windowEnd = left + windowHours * HOUR_MS;

  const rows = sessions.map((s, i) => ({
    index: i,
    share: iqd(s.shareIqd),
    start: instantOf(s.startAt, `sessions[${i}].startAt`),
    cancelled:
      s.cancelledAt === null ? null : instantOf(s.cancelledAt, `sessions[${i}].cancelledAt`),
  }));

  let next: (typeof rows)[number] | undefined;
  for (const r of rows) {
    if (r.start < left) continue;
    if (r.cancelled !== null && r.cancelled <= left) continue; // cancelled before the leave
    if (next === undefined || r.start < next.start) next = r;
  }

  const refunded: number[] = [];
  for (const r of rows) {
    const kept = r.cancelled === null && (r.start < windowEnd || r === next);
    if (!kept) refunded.push(r.share);
  }
  return sumIqd(refunded);
}
