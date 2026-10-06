/**
 * Pure rules of the lesson screen (docs/design/coaching/operator.md §5.10,
 * §5.17): the header's actions, the course strip, the roster's sign-up lines
 * and optimistic marks, the cancel prompts' consequence lines, Reschedule's
 * 30-minute starts and cut-off mirror (R8, R32, R47, R66), Move court's free
 * courts (R7), Add student's field mirrors, and the refunds-due rows with the
 * blocked online refund's record checks (R36, R62, R75). No React, no fetches.
 *
 * The server is the wall (§5.1): every action follows the payload's `can`,
 * every figure is the server's, and clock mirrors run on `server_now`. These
 * mirrors only keep the desk from pressing what the server will refuse; the
 * server refuses it anyway.
 */
import { looksLikeCardNumber } from '@touch/core';
import { AppRpcError } from '../../lib/appRpc';
import type { ReservationRow } from '../desk/deskTypes';
import { slotTaken } from '../desk/deskLogic';
import type {
  CourseSession,
  Enrolment,
  LessonCourse,
  LessonDetail,
  LessonInfo,
  LessonKind,
  RefundDueItem,
  RefundDuePayment,
} from './lessonPayloads';
import type { Tr } from './lessonLogic';
import type { CoachingCaps } from './useCoaching';

// ---------------------------------------------------------------------------
// Header (§5.10.1)
// ---------------------------------------------------------------------------

/** Why a header control is disabled; null when it is enabled. */
export type HeaderBlock = 'offline' | 'held';

export interface HeaderAction {
  enabled: boolean;
  reason: HeaderBlock | null;
}

export interface LessonHeaderActions {
  moveCourt: HeaderAction | null;
  reschedule: HeaderAction | null;
  cancelLesson: HeaderAction | null;
  cancelCourse: HeaderAction | null;
}

/**
 * The header's write buttons: shown by the lesson's `can` and `runLessons`,
 * disabled offline (CD-6). A held lesson (a private lesson waiting for the
 * guest's online payment) shows Reschedule and Move court disabled with the
 * reason (R32): the server's `can` is false for both, so they are shown here
 * on the status alone.
 */
export function lessonHeaderActions(
  lesson: Pick<LessonInfo, 'status' | 'kind' | 'can' | 'course'>,
  caps: Pick<CoachingCaps, 'runLessons'>,
  reachable: boolean,
): LessonHeaderActions {
  if (!caps.runLessons) {
    return { moveCourt: null, reschedule: null, cancelLesson: null, cancelCourse: null };
  }
  const live: HeaderAction = reachable
    ? { enabled: true, reason: null }
    : { enabled: false, reason: 'offline' };
  const held = lesson.status === 'held';
  const heldAction: HeaderAction = { enabled: false, reason: 'held' };
  const course = lesson.kind === 'course' || lesson.course !== null;
  return {
    moveCourt: lesson.can.move_court ? live : held ? heldAction : null,
    reschedule: lesson.can.reschedule ? live : held ? heldAction : null,
    // A course session is never cancelled alone (C-19): the course is.
    cancelLesson: !course && lesson.can.cancel ? live : null,
    cancelCourse: course && lesson.can.cancel_course ? live : null,
  };
}

/** C-24: a private lesson the coach booked with a sign-up still owing. */
export function coachBookedUnpaid(
  lesson: Pick<LessonInfo, 'kind' | 'booked_by_kind'>,
  enrolments: readonly Pick<Enrolment, 'status' | 'money'>[],
): boolean {
  if (lesson.kind !== 'private' || lesson.booked_by_kind !== 'coach') return false;
  return enrolments.some((e) => e.status === 'booked' && (e.money.take_iqd ?? 0) > 0);
}

/** The places line's figures: a group session's, or the course's for a course session. */
export function placesOf(
  lesson: Pick<LessonInfo, 'kind' | 'places_taken' | 'max_places' | 'course'>,
): { taken: number; total: number } | null {
  if (lesson.kind === 'private') return null;
  const taken = lesson.course?.places_taken ?? lesson.places_taken;
  const total = lesson.course?.max_places ?? lesson.max_places;
  return taken === null || total === null ? null : { taken, total };
}

// ---------------------------------------------------------------------------
// Course strip (§5.10.3)
// ---------------------------------------------------------------------------

export interface StripChip {
  session: CourseSession;
  current: boolean;
}

/** One chip per session, in session order; the lesson on screen pressed. */
export function courseStrip(course: LessonCourse | null, lessonId: string): StripChip[] {
  if (!course) return [];
  return course.sessions.map((session) => ({ session, current: session.lesson_id === lessonId }));
}

/**
 * Where a late sign-up joins (§5.10.7): the next session still to start, and
 * how many sessions it pays for from there. Counts only, read off the course's
 * own sessions; the price is the server's (C-15), shown once the roster
 * refetches. Null when no session is left to start.
 */
export function joinsFrom(
  course: LessonCourse | null,
  nowMs: number,
): { sessionNo: number; sessions: number } | null {
  if (!course) return null;
  const ahead = course.sessions.filter(
    (s) => s.status === 'scheduled' && Date.parse(s.start_at) > nowMs && s.session_no !== null,
  );
  const first = ahead[0];
  if (!first || first.session_no === null) return null;
  return { sessionNo: first.session_no, sessions: ahead.length };
}

// ---------------------------------------------------------------------------
// Roster (§5.10.4–§5.10.6)
// ---------------------------------------------------------------------------

/** A course sign-up's range "sessions {from}–{to}", and whether it joined late (C-15). */
export function courseSignUpRange(
  e: Pick<Enrolment, 'scope' | 'first_session_no' | 'sessions_covered'>,
  course: Pick<LessonCourse, 'sessions_count'> | null,
): { from: number; to: number; late: boolean } | null {
  if (e.scope !== 'course') return null;
  const from = e.first_session_no ?? 1;
  const to =
    e.sessions_covered !== null ? from + e.sessions_covered - 1 : (course?.sessions_count ?? null);
  if (to === null) return null;
  return { from, to, late: from > 1 };
}

/** The party beyond the booker ("+2"), or null for one person. */
export function partyExtra(e: Pick<Enrolment, 'party_size'>): number | null {
  const party = e.party_size ?? 1;
  return party > 1 ? party - 1 : null;
}

export type AttendanceMark = 'attended' | 'no_show' | 'clear';

/**
 * The detail as the desk expects it right after a mark (§5.10.6, the
 * ReservationActionsDialog / MatchPlayersPanel optimistic pattern): the
 * sign-up's attendance flipped, and its mark buttons off until the server's
 * answer brings the real ones back.
 */
export function optimisticAttendance(
  detail: LessonDetail,
  enrolmentId: string,
  mark: AttendanceMark,
  nowIso: string,
): LessonDetail {
  return {
    ...detail,
    enrolments: detail.enrolments.map((e) =>
      e.enrolment_id === enrolmentId
        ? {
            ...e,
            attendance:
              mark === 'clear' ? null : { status: mark, marked_at: nowIso, marked_by_name: null },
            can: { ...e.can, mark_attended: false, mark_no_show: false, unmark: false },
          }
        : e,
    ),
  };
}

// ---------------------------------------------------------------------------
// Cancels (§5.10.8)
// ---------------------------------------------------------------------------

export type EnrolmentCancelLine =
  | { id: 'deskPaid'; amount: number }
  | { id: 'online' }
  | { id: 'courseSignUp' }
  | { id: 'nothingPaid' }
  | { id: 'begunKept' }
  | { id: 'privateBooker' };

/**
 * What cancelling one sign-up does to its money, from the server's figures
 * (§5.10.8): nothing paid; a course sign-up (the sessions not held go back);
 * a non-course sign-up once the session has begun (`begun`: `server_now` at
 * or past `start_at`), whose money is kept, so no refund is promised (OP-15);
 * online money (back to the card); desk money (a refund due a manager makes
 * at the till). Cancelling a private lesson's booker cancels the lesson too
 * (`staff_cancel`; after DB-07 a started private lesson is not cancellable).
 * No strike is mentioned: a staff cancel never strikes (CD-2).
 */
export function enrolmentCancelLines(
  e: Pick<Enrolment, 'scope' | 'money'>,
  kind: LessonKind,
  begun = false,
): EnrolmentCancelLine[] {
  const desk = e.money.desk_paid_iqd ?? 0;
  const online = e.money.online_paid_iqd ?? 0;
  const lines: EnrolmentCancelLine[] = [];
  if (desk <= 0 && online <= 0) lines.push({ id: 'nothingPaid' });
  else if (e.scope === 'course') lines.push({ id: 'courseSignUp' });
  else if (begun) lines.push({ id: 'begunKept' });
  else {
    if (online > 0) lines.push({ id: 'online' });
    if (desk > 0) lines.push({ id: 'deskPaid', amount: desk });
  }
  if (kind === 'private') lines.push({ id: 'privateBooker' });
  return lines;
}

/** The students a lesson cancel tells: the live sign-ups (a private booker's party counts as one). */
export function liveStudents(enrolments: readonly Pick<Enrolment, 'status'>[]): number {
  return enrolments.filter((e) => e.status === 'booked' || e.status === 'held').length;
}

// ---------------------------------------------------------------------------
// Reschedule (§5.10.9, R8, R32, R47, R66)
// ---------------------------------------------------------------------------

/** Lessons start on the hour or at half past (SLOT_NOT_ON_GRID). */
export const LESSON_GRID_MIN = 30;

export interface StartOption {
  /** Minutes past the night's local midnight (may run past 24:00 into the night's tail). */
  minutes: number;
  /** The instant, ISO. */
  iso: string;
}

/**
 * The 30-minute starts a lesson may move to on one trading night: from the
 * night's opening to its close less the lesson's length (the length stays,
 * R8), later than now (`server_now`, SLOT_IN_PAST). `span` is the night's
 * trading span (`tradingSpan`, minutes past its local midnight; the close may
 * run past 24:00); null when the hours are not known, which offers the whole
 * calendar day. A closed night offers nothing (CLOSED_DATE).
 */
export function rescheduleStarts(opts: {
  span: { startMin: number; endMin: number } | null;
  durationMin: number;
  nowMs: number;
  closed?: boolean;
  toUtc: (minutesOfDay: number) => Date;
}): StartOption[] {
  if (opts.closed) return [];
  const startMin = opts.span ? opts.span.startMin : 0;
  const endMin = opts.span ? opts.span.endMin : 24 * 60;
  const out: StartOption[] = [];
  const first = Math.ceil(startMin / LESSON_GRID_MIN) * LESSON_GRID_MIN;
  for (let m = first; m + opts.durationMin <= endMin; m += LESSON_GRID_MIN) {
    const at = opts.toUtc(m);
    if (at.getTime() > opts.nowMs) out.push({ minutes: m, iso: at.toISOString() });
  }
  return out;
}

/**
 * The cut-off mirror for a new start (R47, R66): a session whose cut-off is
 * still ahead (unjudged) carries it with the start, so a new start whose
 * cut-off would already have passed is refused (`LESSON_CLOSED` `cutoff`).
 * A session already judged (its cut-off behind) may move anywhere. A course's
 * cut-off is session 1's. Null when no cut-off applies; otherwise the new
 * cut-off and whether it has passed.
 */
export function rescheduleCutoff(
  lesson: Pick<LessonInfo, 'start_at' | 'cutoff_at' | 'kind' | 'course'>,
  newStartIso: string,
  nowMs: number,
): { cutoffAt: string; passed: boolean } | null {
  if (lesson.kind === 'private' || !lesson.cutoff_at) return null;
  if (lesson.course && lesson.course.session_no !== null && lesson.course.session_no !== 1) {
    return null;
  }
  const cutoff = Date.parse(lesson.cutoff_at);
  const start = Date.parse(lesson.start_at);
  const next = Date.parse(newStartIso);
  if ([cutoff, start, next].some(Number.isNaN)) return null;
  // Already judged (R66): it keeps its stamp and may move anywhere.
  if (cutoff <= nowMs) return null;
  const at = next - (start - cutoff);
  return { cutoffAt: new Date(at).toISOString(), passed: at <= nowMs };
}

export type RescheduleBlock = 'offline' | 'pickStart' | 'sameStart' | 'cutoffPassed';

/** Why Reschedule cannot be sent yet, in the order the dialog says it. */
export function rescheduleBlock(opts: {
  reachable: boolean;
  startIso: string | null;
  currentStartIso: string;
  cutoff: { passed: boolean } | null;
}): RescheduleBlock | null {
  if (!opts.reachable) return 'offline';
  if (!opts.startIso) return 'pickStart';
  if (Date.parse(opts.startIso) === Date.parse(opts.currentStartIso)) return 'sameStart';
  if (opts.cutoff?.passed) return 'cutoffPassed';
  return null;
}

// ---------------------------------------------------------------------------
// Move court (§5.10.9, R7)
// ---------------------------------------------------------------------------

export interface CourtChoice<C> {
  court: C;
  /** The court the lesson is on now: shown, never offered. */
  current: boolean;
  /** Free for the lesson's whole period on the night's rows. */
  free: boolean;
}

/**
 * The branch's courts for the same times (R7): each free or taken on the
 * night's rows (`slotTaken`, the lesson's own court row ignored), the current
 * one marked. The server is the control (NO_COURT_FREE); this only keeps the
 * desk from offering a court it already knows is taken.
 */
export function moveCourtChoices<C extends { id: string; sort_order?: number }>(
  courts: readonly C[],
  reservations: readonly Pick<
    ReservationRow,
    'id' | 'court_id' | 'status' | 'start_at' | 'end_at'
  >[],
  lesson: Pick<LessonInfo, 'court_id' | 'reservation_id' | 'start_at' | 'end_at'>,
): CourtChoice<C>[] {
  const startMs = Date.parse(lesson.start_at);
  const endMs = Date.parse(lesson.end_at);
  return [...courts]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((court) => {
      const current = court.id === lesson.court_id;
      const free =
        !current &&
        !slotTaken(reservations, court.id, startMs, endMs, lesson.reservation_id ?? undefined);
      return { court, current, free };
    });
}

// ---------------------------------------------------------------------------
// Add student (§5.10.7)
// ---------------------------------------------------------------------------

/** desk_add_student's typed name (1..80 after cleaning) and phone (optional, 7..15 digits). */
export const STUDENT_NAME_MAX = 80;
export const STUDENT_PHONE_MIN_DIGITS = 7;
export const STUDENT_PHONE_MAX_DIGITS = 15;

export type StudentBlock = 'offline' | 'needsStudent' | 'nameTooLong' | 'phoneInvalid';

export function studentPhoneInvalid(phone: string): boolean {
  const trimmed = phone.trim();
  if (trimmed === '') return false;
  const digits = trimmed.replace(/\D/g, '').length;
  return digits < STUDENT_PHONE_MIN_DIGITS || digits > STUDENT_PHONE_MAX_DIGITS;
}

/** Why Add cannot be sent yet: a picked customer, or a typed name (and a valid phone if given). */
export function addStudentBlock(opts: {
  reachable: boolean;
  customerPicked: boolean;
  name: string;
  phone: string;
}): StudentBlock | null {
  if (!opts.reachable) return 'offline';
  if (opts.customerPicked) return null;
  if (opts.name.trim() === '') return 'needsStudent';
  if (opts.name.trim().length > STUDENT_NAME_MAX) return 'nameTooLong';
  if (studentPhoneInvalid(opts.phone)) return 'phoneInvalid';
  return null;
}

/** The typed field a desk_add_student refusal belongs on: INVALID_ARGUMENT `p_name` / `p_phone`. */
export function studentFieldOf(error: unknown): 'name' | 'phone' | null {
  if (!(error instanceof AppRpcError) || error.code !== 'INVALID_ARGUMENT') return null;
  const d = (error.details ?? error.hint ?? '').trim();
  if (d === 'p_name' || d === 'p_guest_name') return 'name';
  if (d === 'p_phone' || d === 'p_guest_phone') return 'phone';
  return null;
}

/** desk_add_student's target: the lesson for a group session, the course for a course session. */
export function addStudentTarget(lesson: Pick<LessonInfo, 'id' | 'kind' | 'course'>): {
  p_lesson_id: string | null;
  p_course_id: string | null;
} {
  // Both are sent, the other one null: app.desk_add_student has no defaults, and PostgREST
  // finds a function by the names of the arguments it is given.
  if (lesson.course) return { p_lesson_id: null, p_course_id: lesson.course.course_id };
  return { p_lesson_id: lesson.id, p_course_id: null };
}

// ---------------------------------------------------------------------------
// Refunds due (§5.10.10, §5.17, R36, R62, R75)
// ---------------------------------------------------------------------------

/** The student a refunds-due item names (R44: as recorded), else "Student". */
export function refundLabel(item: Pick<RefundDueItem, 'label'>, tr: Tr): string {
  return item.label?.trim() || tr('ws.coaching.refunds.student');
}

/** "cash" / "card" inside a refunds line; an unknown method prints raw. */
export function methodWord(method: string | null, tr: Tr): string {
  if (method === 'cash' || method === 'card') return tr(`ws.coaching.refunds.method.${method}`);
  return method ?? '—';
}

/** A guest leaving a course: the due is for the sessions still to come (C-23, R62). */
export function isCourseLeave(item: Pick<RefundDueItem, 'course_id' | 'cancel_kind'>): boolean {
  return (
    item.course_id !== null &&
    (item.cancel_kind === 'guest_late' || item.cancel_kind === 'guest_free')
  );
}

/** The payments a refunds-due item can be refunded from at the desk: something left on them. */
export function refundablePayments(item: Pick<RefundDueItem, 'payments'>): RefundDuePayment[] {
  return item.payments.filter((p) => (p.refundable_iqd ?? 0) > 0 || p.refundable_iqd === null);
}

/**
 * The till's RefundDialog payment for a refunds-due payment (§5.10.10): its
 * id, method and amount, with what already went back as one refund row, so
 * the dialog's remainder is the server's `refundable_iqd`.
 */
export function refundDialogPayment(p: RefundDuePayment): {
  id: string;
  method: string;
  amount_iqd: number;
  refunds: { amount_iqd: number }[];
} {
  const amount = p.amount_iqd ?? 0;
  const refunded =
    p.refunded_iqd ?? (p.refundable_iqd !== null ? Math.max(0, amount - p.refundable_iqd) : 0);
  return {
    id: p.payment_id,
    method: p.method ?? 'cash',
    amount_iqd: amount,
    refunds: refunded > 0 ? [{ amount_iqd: refunded }] : [],
  };
}

/** The desk part of an item's due (R36 caps a refund at it unless goodwill). */
export function deskDueOf(item: Pick<RefundDueItem, 'refund_due_desk_iqd'>): number {
  return Math.max(0, item.refund_due_desk_iqd ?? 0);
}

/** Owed back on an online payment that already has its one refund (R75); 0 when none. */
export function onlineBlockedOf(item: Pick<RefundDueItem, 'online_blocked_iqd'>): number {
  return Math.max(0, item.online_blocked_iqd ?? 0);
}

/** Sum of the desk dues of a list (the lesson screen panel's own header figure). */
export function deskDueTotal(items: readonly Pick<RefundDueItem, 'refund_due_desk_iqd'>[]): number {
  return items.reduce((sum, i) => sum + deskDueOf(i), 0);
}

export const BLOCKED_REFERENCE_MAX = 80;
/**
 * R49 / R74: the one card guard (@touch/core, the server's app.looks_like_card
 * twin): Arabic-Indic and Extended Arabic-Indic digits count, and spaces, dots
 * and dashes are taken out (OP-04).
 */
export { looksLikeCardNumber };

export type BlockedAmountError = 'required' | 'tooHigh';
export type BlockedReferenceError = 'required' | 'tooLong' | 'cardNumber';

/**
 * The handback record's checks (R75): an amount of 1 up to what is blocked
 * online (never more), and a reference 1..80 that is not a card number.
 */
export function blockedRefundErrors(opts: {
  amount: number | null;
  max: number;
  reference: string;
}): { amount: BlockedAmountError | null; reference: BlockedReferenceError | null } {
  const ref = opts.reference.trim();
  const amount: BlockedAmountError | null =
    opts.amount === null || opts.amount <= 0
      ? 'required'
      : opts.amount > opts.max
        ? 'tooHigh'
        : null;
  const reference: BlockedReferenceError | null =
    ref === ''
      ? 'required'
      : ref.length > BLOCKED_REFERENCE_MAX
        ? 'tooLong'
        : looksLikeCardNumber(ref)
          ? 'cardNumber'
          : null;
  return { amount, reference };
}
