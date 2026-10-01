/**
 * Pure rules behind every lesson surface on the operator
 * (docs/design/coaching/operator.md §5.8–§5.11, §5.19, §5.21). No React, no
 * fetches.
 *
 * The server is the wall (§5.1): a row's buttons follow the `can` objects of
 * app.desk_lesson_detail, every figure is the server's, and clock mirrors use
 * the payload's `server_now`, never the station clock alone. What lives here is
 * the reading of those answers (what a tile is called, which money line a
 * sign-up shows, which buttons it offers, what a refusal's detail means), each
 * tested against the table it mirrors.
 *
 * Words: the keys this module returns live in the assembly's own groups
 * (`ws.coaching.common / banner / events / count / errors / offline`).
 */
import {
  countPhrase,
  formatIQD,
  formatNumber,
  formatTime,
  isolate,
  isolateLtr,
  type Locale,
  type MessageKey,
  type TParams,
} from '@touch/i18n';
import { AppRpcError } from '../../lib/appRpc';
import { errorToMessageKey } from '../../lib/errors';
import type { ReservationRow } from '../desk/deskTypes';
import type {
  DeskLesson,
  DeskLessons,
  Enrolment,
  LessonEvent,
  LessonInfo,
  LessonKind,
  RefundDueItem,
  RefundsDue,
} from './lessonPayloads';

export type Tr = (key: MessageKey, params?: TParams) => string;

// ---------------------------------------------------------------------------
// The court row a lesson holds (§5.8)
// ---------------------------------------------------------------------------

/**
 * `reservations.guest_name` of a lesson's court row: the DB literal written by
 * the lesson creators (0280, build contracts §1.2). Must equal it byte for byte.
 */
export const LESSON_RESERVATION_NAME = 'Lesson';

/** A lesson's court row read straight from `reservations`: kind 'lesson', or the literal with no account. */
export function isLessonLiteral(
  r:
    | (Pick<ReservationRow, 'guest_name'> & { guest_id?: string | null; kind?: string })
    | null
    | undefined,
): boolean {
  if (!r) return false;
  if (r.kind === 'lesson') return true;
  return r.guest_id === null && r.guest_name === LESSON_RESERVATION_NAME && r.kind !== 'booking';
}

/** desk_lessons rows by the reservation they hold (a lesson's court row, or a held lesson's hold row). */
export function lessonsByReservation(
  envelope: DeskLessons | null | undefined,
): Map<string, DeskLesson> {
  const map = new Map<string, DeskLesson>();
  for (const lesson of envelope?.lessons ?? []) {
    if (lesson.reservation_id) map.set(lesson.reservation_id, lesson);
  }
  return map;
}

/**
 * The lesson a calendar row draws, if any: a `lesson` row, or a `hold` row
 * that is a held lesson's (§5.8: "a hold row whose id is a held lesson's
 * reservation_id also draws as that lesson").
 */
export function lessonOfRow(
  r: Pick<ReservationRow, 'id' | 'kind'>,
  byReservation: ReadonlyMap<string, DeskLesson> | null | undefined,
): DeskLesson | null {
  if (r.kind !== 'lesson' && r.kind !== 'hold') return null;
  return byReservation?.get(r.id) ?? null;
}

/** True when a calendar row is a lesson's (its own kind, or a held lesson's hold). */
export function isLessonRow(
  r: Pick<ReservationRow, 'id' | 'kind'>,
  byReservation?: ReadonlyMap<string, DeskLesson> | null,
): boolean {
  return r.kind === 'lesson' || (r.kind === 'hold' && !!byReservation?.has(r.id));
}

// ---------------------------------------------------------------------------
// Names (§5.8, R44)
// ---------------------------------------------------------------------------

function pick(
  locale: Locale,
  en: string | null | undefined,
  ar: string | null | undefined,
): string {
  const a = (locale === 'ar' ? ar : en) ?? '';
  return a.trim() !== '' ? a : ((locale === 'ar' ? en : ar) ?? '');
}

export function coachNameOf(
  l: Pick<DeskLesson, 'coach_name_en' | 'coach_name_ar'>,
  locale: Locale,
): string {
  return pick(locale, l.coach_name_en, l.coach_name_ar);
}

export function typeNameOf(
  l: Pick<DeskLesson, 'type_name_en' | 'type_name_ar'>,
  locale: Locale,
): string {
  return pick(locale, l.type_name_en, l.type_name_ar);
}

export function courtNameOf(
  l: { court_name_en: string | null; court_name_ar: string | null },
  locale: Locale,
): string {
  return pick(locale, l.court_name_en, l.court_name_ar);
}

/**
 * A course's title in the screen's language, else the lesson type's name
 * (§5.8 "{title, else type}"): both titles are optional, and a title typed in
 * one language only is not shown in the other.
 */
export function courseTitleOf(
  course: { title_en: string; title_ar: string } | null | undefined,
  typeName: string,
  locale: Locale,
): string {
  const title = course ? (locale === 'ar' ? course.title_ar : course.title_en) : '';
  return title.trim() !== '' ? title : typeName;
}

/**
 * The name a lesson shows on a tile, a Today row, the observation board and
 * the actions dialog (§5.8): private "{coach} · {booker}" (the booker's name
 * as recorded, R44), group "{coach} · {type}", course "{coach} · {title, else
 * type} · Session 2". With no lesson row (offline, or the read failed) the
 * word "Lesson" in the screen's language.
 */
export function lessonLabel(lesson: DeskLesson | null | undefined, locale: Locale, tr: Tr): string {
  if (!lesson) return tr('ws.coaching.common.lesson');
  const coach = coachNameOf(lesson, locale);
  const type = typeNameOf(lesson, locale) || tr(`ws.coaching.common.kind.${lesson.kind}`);
  const pair = (a: string, b: string) => tr('ws.coaching.common.label.pair', { a, b });
  if (!coach) {
    if (lesson.kind === 'private' && lesson.label) return pair(type, isolate(lesson.label));
    return type;
  }
  if (lesson.kind === 'private') {
    return pair(isolate(coach), lesson.label ? isolate(lesson.label) : type);
  }
  if (lesson.kind === 'group') return pair(isolate(coach), type);
  const title = courseTitleOf(lesson.course, type, locale);
  const n = lesson.course?.session_no;
  if (n === null || n === undefined) return pair(isolate(coach), title);
  return tr('ws.coaching.common.label.courseSession', {
    coach: isolate(coach),
    title,
    n: formatNumber(n, locale),
  });
}

// ---------------------------------------------------------------------------
// Places, pay and tags (§5.8, §5.11, C-14, C-24)
// ---------------------------------------------------------------------------

export type PlacesChip =
  { kind: 'places'; taken: number; total: number } | { kind: 'party'; extra: number };

/** A group session's or course's "4/6"; a private lesson with a party "+2"; else nothing. */
export function lessonPlacesChip(
  lesson: Pick<DeskLesson, 'kind' | 'places_taken' | 'max_places' | 'party_size'>,
): PlacesChip | null {
  if (lesson.kind === 'private') {
    const party = lesson.party_size ?? 1;
    return party > 1 ? { kind: 'party', extra: party - 1 } : null;
  }
  if (lesson.places_taken === null || lesson.max_places === null) return null;
  return { kind: 'places', taken: lesson.places_taken, total: lesson.max_places };
}

/** The chip's visible text ("4/6", "+2"), isolated left-to-right. */
export function placesChipText(chip: PlacesChip, locale: Locale): string {
  return chip.kind === 'places'
    ? isolateLtr(`${formatNumber(chip.taken, locale)}/${formatNumber(chip.total, locale)}`)
    : isolateLtr(`+${formatNumber(chip.extra, locale)}`);
}

/** The chip's accessible name ("Group session · 4 of 6 places"). */
export function placesChipAria(chip: PlacesChip, kind: LessonKind, locale: Locale, tr: Tr): string {
  if (chip.kind === 'party')
    return tr('ws.coaching.common.partyAria', { extra: formatNumber(chip.extra, locale) });
  return tr('ws.coaching.common.placesAria', {
    kind: tr(`ws.coaching.common.kind.${kind}`),
    taken: formatNumber(chip.taken, locale),
    total: formatNumber(chip.total, locale),
  });
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * "Now" for a payload: its `server_now` plus the time since it was fetched
 * (`elapsedMs`), so a screen left open does not wait for the next poll; the
 * station clock only when the payload carries no `server_now` (§5.1).
 */
export function nowOf(
  serverNow: string | null | undefined,
  elapsedMs = 0,
  fallback: number = Date.now(),
): number {
  const t = ms(serverNow);
  return t === null ? fallback : t + elapsedMs;
}

export interface LessonPayState {
  /** What the pay cell says. */
  pay: 'owing' | 'allPaid' | 'online' | 'none';
  /** Booked desk sign-ups with something left to take. */
  owing: number;
  owingIqd: number | null;
  /** "To pay" turns warn once the lesson has started (§5.11). */
  warn: boolean;
  /** C-24: a private lesson the coach booked that still owes, flagged from the moment it is booked. */
  coachUnpaid: boolean;
}

export function lessonPayState(
  lesson: Pick<
    DeskLesson,
    'kind' | 'start_at' | 'owing' | 'owing_iqd' | 'paid_online' | 'enrolments' | 'booked_by_kind'
  >,
  nowMs: number,
): LessonPayState {
  const owing = lesson.owing ?? 0;
  const started = (ms(lesson.start_at) ?? Infinity) <= nowMs;
  const coachUnpaid = lesson.kind === 'private' && lesson.booked_by_kind === 'coach' && owing > 0;
  if (owing > 0)
    return { pay: 'owing', owing, owingIqd: lesson.owing_iqd, warn: started, coachUnpaid };
  const online = lesson.paid_online ?? 0;
  const enrolments = lesson.enrolments ?? 0;
  if (online > 0 && enrolments > 0 && online >= enrolments) {
    return { pay: 'online', owing: 0, owingIqd: lesson.owing_iqd, warn: false, coachUnpaid };
  }
  if (enrolments > 0)
    return { pay: 'allPaid', owing: 0, owingIqd: lesson.owing_iqd, warn: false, coachUnpaid };
  return { pay: 'none', owing: 0, owingIqd: lesson.owing_iqd, warn: false, coachUnpaid };
}

export interface CutoffState {
  /** Students still needed. */
  short: number;
  cutoffAt: string;
}

/**
 * C-14: a group session or course below its minimum before its cut-off:
 * "Needs 2 more by 18:00 or it is cancelled". Null once the cut-off has passed
 * (the sweep decides), for a private lesson, or when it is full enough.
 */
export function cutoffState(
  lesson: {
    kind: LessonKind;
    status: string;
    min_places: number | null;
    places_taken: number | null;
    cutoff_at: string | null;
  },
  nowMs: number,
): CutoffState | null {
  if (lesson.kind === 'private' || lesson.status !== 'scheduled') return null;
  if (lesson.min_places === null || lesson.places_taken === null || !lesson.cutoff_at) return null;
  const cutoff = ms(lesson.cutoff_at);
  if (cutoff === null || nowMs >= cutoff) return null;
  const short = lesson.min_places - lesson.places_taken;
  return short > 0 ? { short, cutoffAt: lesson.cutoff_at } : null;
}

export type LessonTag =
  | { id: 'needsMore'; short: number; cutoffAt: string }
  | { id: 'awaitingOnline' }
  | { id: 'startsIn'; minutes: number }
  | { id: 'coachUnpaid' };

/** The tags a Today row carries (§5.11), in the order they show. */
export function lessonTags(lesson: DeskLesson, nowMs: number, soonMinutes = 60): LessonTag[] {
  const tags: LessonTag[] = [];
  const cut = cutoffState(lesson, nowMs);
  if (cut) tags.push({ id: 'needsMore', short: cut.short, cutoffAt: cut.cutoffAt });
  if (lesson.status === 'held') tags.push({ id: 'awaitingOnline' });
  const start = ms(lesson.start_at);
  if (
    start !== null &&
    lesson.status === 'scheduled' &&
    start > nowMs &&
    start - nowMs <= soonMinutes * 60_000
  ) {
    tags.push({ id: 'startsIn', minutes: Math.max(1, Math.ceil((start - nowMs) / 60_000)) });
  }
  if (lessonPayState(lesson, nowMs).coachUnpaid) tags.push({ id: 'coachUnpaid' });
  return tags;
}

// ---------------------------------------------------------------------------
// Status words (§5.20)
// ---------------------------------------------------------------------------

const LESSON_STATUS_WORDS = ['held', 'scheduled', 'completed', 'cancelled', 'expired'] as const;
const COURSE_STATUS_WORDS = ['open', 'running', 'completed', 'cancelled'] as const;
const ENROLMENT_STATUS_WORDS = ['held', 'booked', 'cancelled', 'expired'] as const;
const COACH_STATUS_WORDS = ['active', 'paused', 'retired'] as const;
const STATEMENT_STATUS_WORDS = ['draft', 'approved', 'paid', 'void'] as const;

function within<T extends string>(words: readonly T[], v: string): v is T {
  return (words as readonly string[]).includes(v);
}

export function lessonStatusKey(status: string): MessageKey | null {
  return within(LESSON_STATUS_WORDS, status) ? `ws.coaching.common.status.${status}` : null;
}
export function courseStatusKey(status: string): MessageKey | null {
  return within(COURSE_STATUS_WORDS, status) ? `ws.coaching.common.courseStatus.${status}` : null;
}
export function enrolmentStatusKey(status: string): MessageKey | null {
  return within(ENROLMENT_STATUS_WORDS, status)
    ? `ws.coaching.common.enrolmentStatus.${status}`
    : null;
}
export function coachStatusKey(status: string): MessageKey | null {
  return within(COACH_STATUS_WORDS, status) ? `ws.coaching.common.coachStatus.${status}` : null;
}
export function statementStatusKey(status: string): MessageKey | null {
  return within(STATEMENT_STATUS_WORDS, status)
    ? `ws.coaching.common.statementStatus.${status}`
    : null;
}
export function kindKey(kind: LessonKind): MessageKey {
  return `ws.coaching.common.kind.${kind}`;
}

// ---------------------------------------------------------------------------
// The lesson screen's banner (§5.10.2)
// ---------------------------------------------------------------------------

export type BannerTone = 'info' | 'success' | 'warn' | 'refused' | 'neutral';

export type LessonBanner =
  | { id: 'held'; tone: 'info'; key: MessageKey; at: string | null }
  | { id: 'underMin'; tone: 'warn'; key: MessageKey; short: number; at: string }
  | { id: 'scheduled'; tone: 'info'; key: MessageKey }
  | { id: 'completed'; tone: 'success'; key: MessageKey }
  | { id: 'cancelled'; tone: 'refused'; key: MessageKey; reason: string | null }
  | { id: 'expired'; tone: 'neutral'; key: MessageKey }
  | { id: 'unknown'; tone: 'neutral'; status: string };

const CANCEL_BANNERS = [
  'guest_cancel',
  'coach_cancel',
  'staff_cancel',
  'under_filled',
  'payment_expired',
  'account_deleted',
  'coach_retired',
] as const;

/** Which banner a lesson shows, by status and cancel reason (§5.10.2). */
export function lessonBannerKey(
  lesson: Pick<
    LessonInfo,
    | 'kind'
    | 'status'
    | 'cancel_reason'
    | 'hold_expires_at'
    | 'min_places'
    | 'places_taken'
    | 'cutoff_at'
  >,
  nowMs: number,
): LessonBanner {
  switch (lesson.status) {
    case 'held':
      return {
        id: 'held',
        tone: 'info',
        key: 'ws.coaching.banner.held',
        at: lesson.hold_expires_at,
      };
    case 'scheduled': {
      const cut = cutoffState(lesson, nowMs);
      if (cut)
        return {
          id: 'underMin',
          tone: 'warn',
          key: 'ws.coaching.banner.underMin',
          short: cut.short,
          at: cut.cutoffAt,
        };
      return { id: 'scheduled', tone: 'info', key: 'ws.coaching.banner.scheduled' };
    }
    case 'completed':
      return { id: 'completed', tone: 'success', key: 'ws.coaching.banner.completed' };
    case 'cancelled': {
      const reason = lesson.cancel_reason;
      const key: MessageKey =
        reason && within(CANCEL_BANNERS, reason)
          ? `ws.coaching.banner.cancelled.${reason}`
          : 'ws.coaching.banner.cancelled.other';
      return { id: 'cancelled', tone: 'refused', key, reason };
    }
    case 'expired':
      return { id: 'expired', tone: 'neutral', key: 'ws.coaching.banner.expired' };
    default:
      return { id: 'unknown', tone: 'neutral', status: lesson.status };
  }
}

/** The banner's sentence, worded (times in the branch's zone). */
export function lessonBannerText(
  banner: LessonBanner,
  lesson: Pick<LessonInfo, 'court_name_en' | 'court_name_ar'>,
  opts: { tr: Tr; locale: Locale; tz?: string },
): string {
  const { tr, locale, tz } = opts;
  const time = (iso: string | null) => (iso ? formatTime(new Date(iso), locale, tz) : '—');
  switch (banner.id) {
    case 'held':
      return tr(banner.key, { time: time(banner.at) });
    case 'underMin':
      return tr(banner.key, {
        students: formatNumber(banner.short, locale),
        time: time(banner.at),
      });
    case 'scheduled':
      return tr(banner.key, { court: isolate(courtNameOf(lesson, locale) || '—') });
    case 'unknown':
      return banner.status;
    default:
      return tr(banner.key);
  }
}

/** Desk money waiting to go back across the roster (the banner's added line, §5.10.2). */
export function deskRefundDue(enrolments: readonly Enrolment[]): number {
  return enrolments.reduce((sum, e) => sum + Math.max(0, e.money.refund_due_iqd ?? 0), 0);
}

// ---------------------------------------------------------------------------
// History (§5.10.11)
// ---------------------------------------------------------------------------

export const LESSON_EVENT_TYPES = [
  'booked',
  'held',
  'paid_online',
  'expired',
  'joined',
  'added',
  'cancelled',
  'enrolment_cancelled',
  'rescheduled',
  'court_moved',
  'under_filled',
  'completed',
  'attended',
  'no_show',
  'unmarked',
  'settled',
  'refunded',
] as const;
export type LessonEventType = (typeof LESSON_EVENT_TYPES)[number];

/** The history sentence's key; `late` (R26) turns `under_filled` into "nothing was cancelled". */
export function eventKey(type: string, late = false): MessageKey | null {
  if (!within(LESSON_EVENT_TYPES, type)) return null;
  if (type === 'under_filled' && late) return 'ws.coaching.events.under_filled_late';
  return `ws.coaching.events.${type}`;
}

/** The words for a cancel code a history line carries (`<code>` or `<code>: <note>`). */
export function cancelCodeText(code: string | null | undefined, tr: Tr): string {
  if (!code) return '—';
  const bare = code.split(':')[0]!.trim();
  const known = [
    'customer_request',
    'coach_unavailable',
    'court_needed',
    'staff_error',
    'duplicate',
    'other',
    ...CANCEL_BANNERS,
  ] as const;
  return within(known, bare) ? tr(`ws.coaching.common.cancelCode.${bare}`) : bare;
}

/** One history row: the type's sentence, "· {actor}" appended; system events read "automatic". */
export function eventSentence(e: LessonEvent, tr: Tr): string {
  const key = eventKey(e.type, e.late);
  const text = key ? tr(key, { code: cancelCodeText(e.code, tr) }) : e.type;
  const actor = e.actor_name
    ? isolate(e.actor_name)
    : e.actor === null || e.actor === 'system'
      ? tr('ws.coaching.events.automatic')
      : null;
  return actor ? `${text} · ${actor}` : text;
}

// ---------------------------------------------------------------------------
// The roster (§5.10.4, R44, C-21)
// ---------------------------------------------------------------------------

/** A sign-up's name: the recorded one (R44), else "Walk-in". */
export function rosterName(e: Pick<Enrolment, 'full_name'>, tr: Tr): string {
  const name = e.full_name?.trim();
  return name ? name : tr('ws.coaching.common.walkIn');
}

/** No customer behind the row: a walk-in, or a phone match not yet confirmed (C-21). */
export function isWalkIn(e: Pick<Enrolment, 'customer_id'>): boolean {
  return !e.customer_id;
}

/** "Added at the desk by {name}" and its siblings. */
export function bookedByKey(e: Pick<Enrolment, 'booked_by_kind' | 'booked_by_name'>): {
  key: MessageKey;
  name: string | null;
} | null {
  switch (e.booked_by_kind) {
    case 'guest':
      return { key: 'ws.coaching.common.bookedBy.guest', name: null };
    case 'coach':
      return { key: 'ws.coaching.common.bookedBy.coach', name: null };
    case 'staff':
      return e.booked_by_name
        ? { key: 'ws.coaching.common.bookedBy.staffBy', name: e.booked_by_name }
        : { key: 'ws.coaching.common.bookedBy.staff', name: null };
    default:
      return null;
  }
}

export interface MoneyLine {
  id:
    | 'awaitingOnline'
    | 'paidAtDesk'
    | 'paidOnline'
    | 'toPayAtDesk'
    | 'refunded'
    | 'keptLate'
    | 'keptCourseLeave'
    | 'refundDue';
  key: MessageKey;
  amount: number | null;
  tone: 'neutral' | 'info' | 'success' | 'warn';
}

/**
 * A sign-up's money line (§5.10.4), every figure the server's: what was paid
 * and how, what is still to take, what went back, what was kept, what is due
 * back. Empty when nothing was paid and nothing is owed.
 */
export function enrolmentLine(
  e: Pick<Enrolment, 'status' | 'scope' | 'cancel_kind' | 'payment_mode' | 'money'>,
): MoneyLine[] {
  const m = e.money;
  const lines: MoneyLine[] = [];
  const pos = (v: number | null) => v !== null && v > 0;
  if (e.status === 'held') {
    lines.push({
      id: 'awaitingOnline',
      key: 'ws.coaching.common.money.awaitingOnline',
      amount: null,
      tone: 'info',
    });
  }
  if (pos(m.desk_paid_iqd)) {
    lines.push({
      id: 'paidAtDesk',
      key: 'ws.coaching.common.money.paidAtDesk',
      amount: m.desk_paid_iqd,
      tone: 'success',
    });
  }
  if (pos(m.online_paid_iqd)) {
    lines.push({
      id: 'paidOnline',
      key: 'ws.coaching.common.money.paidOnline',
      amount: m.online_paid_iqd,
      tone: 'success',
    });
  }
  if (e.status === 'booked' && pos(m.take_iqd)) {
    lines.push({
      id: 'toPayAtDesk',
      key: 'ws.coaching.common.money.toPayAtDesk',
      amount: m.take_iqd,
      tone: 'warn',
    });
  }
  if (pos(m.refunded_iqd)) {
    lines.push({
      id: 'refunded',
      key: 'ws.coaching.common.money.refunded',
      amount: m.refunded_iqd,
      tone: 'neutral',
    });
  }
  if (pos(m.kept_iqd)) {
    const courseLeave = e.scope === 'course' && e.cancel_kind === 'guest_late';
    lines.push({
      id: courseLeave ? 'keptCourseLeave' : 'keptLate',
      key: courseLeave
        ? 'ws.coaching.common.money.keptCourseLeave'
        : 'ws.coaching.common.money.keptLate',
      amount: m.kept_iqd,
      tone: 'neutral',
    });
  }
  if (pos(m.refund_due_iqd)) {
    lines.push({
      id: 'refundDue',
      key: 'ws.coaching.common.money.refundDue',
      amount: m.refund_due_iqd,
      tone: 'warn',
    });
  }
  return lines;
}

/** One money line, worded. */
export function moneyLineText(line: MoneyLine, tr: Tr, locale: Locale): string {
  return tr(
    line.key,
    line.amount === null ? undefined : { amount: formatIQD(line.amount, locale) },
  );
}

export interface LessonCaps {
  runLessons: boolean;
  takeLessonPayment: boolean;
}

/** Why a row control is disabled; null when it is enabled. */
export type RowBlock = 'offline' | 'notStarted' | 'marksClosed';

export interface RowAction {
  enabled: boolean;
  reason: RowBlock | null;
}

export interface EnrolmentActions {
  takePayment: RowAction | null;
  cancel: RowAction | null;
  markAttended: RowAction | null;
  markNoShow: RowAction | null;
  unmark: RowAction | null;
  /** Only with a customer behind the row (never for an unconfirmed phone match, C-21). */
  openCustomer: boolean;
}

/** CD-11: no-show marks close this long after the start. */
export const MARKS_CLOSE_MS = 24 * 60 * 60_000;

/**
 * The buttons a roster row offers (§5.10.4–§5.10.8): the row's `can`, the
 * capability, and the station's reach. A control the row's `can` refuses is
 * hidden, except No-show on a booked sign-up, which shows disabled with its
 * reason before the start and after the 24-hour window (§5.10.6). Every
 * coaching write is disabled offline (CD-6, §5.5).
 */
export function enrolmentActionsOf(
  e: Pick<Enrolment, 'status' | 'payment_mode' | 'customer_id' | 'attendance' | 'can'>,
  lesson: Pick<LessonInfo, 'status' | 'start_at' | 'server_now'>,
  reachable: boolean,
  caps: LessonCaps,
  elapsedMs = 0,
): EnrolmentActions {
  const live: RowAction = reachable
    ? { enabled: true, reason: null }
    : { enabled: false, reason: 'offline' };
  const takePayment =
    caps.takeLessonPayment && e.can.take_payment && e.payment_mode !== 'online' ? live : null;
  const cancel = caps.runLessons && e.can.cancel ? live : null;
  const markAttended = caps.runLessons && e.can.mark_attended ? live : null;
  const unmark = caps.runLessons && e.can.unmark ? live : null;

  let markNoShow: RowAction | null = null;
  if (caps.runLessons) {
    if (e.can.mark_no_show) {
      markNoShow = live;
    } else if (
      e.status === 'booked' &&
      !e.attendance &&
      (lesson.status === 'scheduled' || lesson.status === 'completed')
    ) {
      const now = nowOf(lesson.server_now, elapsedMs);
      const start = ms(lesson.start_at);
      if (start !== null && now < start) markNoShow = { enabled: false, reason: 'notStarted' };
      else if (start !== null && now > start + MARKS_CLOSE_MS)
        markNoShow = { enabled: false, reason: 'marksClosed' };
    }
  }
  return { takePayment, cancel, markAttended, markNoShow, unmark, openCustomer: !!e.customer_id };
}

/** The sign-ups still live (booked or held) first, then the earlier ones, as the roster lists them. */
export function rosterGroups<T extends Pick<Enrolment, 'status'>>(
  enrolments: readonly T[],
): { live: T[]; earlier: T[] } {
  const live = enrolments.filter((e) => e.status === 'booked' || e.status === 'held');
  const earlier = enrolments.filter((e) => e.status !== 'booked' && e.status !== 'held');
  return { live, earlier };
}

/** The roster footer's "To pay 2 · 60,000": live desk sign-ups with something to take. */
export function rosterOwing(enrolments: readonly Enrolment[]): { count: number; amount: number } {
  let count = 0;
  let amount = 0;
  for (const e of enrolments) {
    const take = e.money.take_iqd ?? 0;
    if (e.status === 'booked' && take > 0) {
      count += 1;
      amount += take;
    }
  }
  return { count, amount };
}

// ---------------------------------------------------------------------------
// Refunds due (§5.10.10, §5.17)
// ---------------------------------------------------------------------------

/** The refunds-due items that belong to this lesson, or to its course. */
export function refundsForLesson(
  refunds: RefundsDue | null | undefined,
  lesson: Pick<LessonInfo, 'id' | 'course'>,
): RefundDueItem[] {
  const courseId = lesson.course?.course_id ?? null;
  return (refunds?.items ?? []).filter(
    (i) => i.lesson_id === lesson.id || (courseId !== null && i.course_id === courseId),
  );
}

// ---------------------------------------------------------------------------
// Cancels (§5.10.8, §1.3)
// ---------------------------------------------------------------------------

/** The desk and coach cancel reasons (§1.3), in prompt order. */
export const COACHING_CANCEL_CODES = [
  'customer_request',
  'coach_unavailable',
  'court_needed',
  'staff_error',
  'duplicate',
  'other',
] as const;
export type CoachingCancelCode = (typeof COACHING_CANCEL_CODES)[number];

/** The reason form (§5.7): `<code>` or `<code>: <note>`, the note capped at 200 characters. */
export function reasonForm(code: string, note?: string | null): string {
  const n = (note ?? '').trim().slice(0, 200);
  return n ? `${code}: ${n}` : code;
}

// ---------------------------------------------------------------------------
// Refusals (§5.19)
// ---------------------------------------------------------------------------

/** The codes whose numeric detail is a course session number (course create). */
const SESSION_DETAIL_CODES = new Set([
  'NO_COURT_FREE',
  'COACH_BUSY',
  'COACH_UNAVAILABLE',
  'SLOT_NOT_ON_GRID',
  'SLOT_IN_PAST',
  'CLOSED_DATE',
  'OUTSIDE_HOURS',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CoachingErrorKey {
  key: MessageKey;
  /** The server's code (`AppRpcError.code`), or null for a non-server error. */
  code: string | null;
  /** The detail the key was picked for (`details`, else `hint`). */
  detail: string | null;
  /** A course create refused for one session: its number ("Session 3: …"). */
  sessionNo: number | null;
}

/** Where a refusal came from, for the details that mean different things on different screens. */
export interface CoachingErrorContext {
  /** Statements: INVALID_ARGUMENT `p_reason` is the card-number guard (R49). */
  scope?: 'statement' | 'settings' | 'lesson' | 'admin';
}

function detailOf(error: AppRpcError): string | null {
  const d = (error.details ?? '').trim();
  if (d) return d;
  const h = (error.hint ?? '').trim();
  return h || null;
}

/**
 * A refusal's line (§5.19 "Details"): a `ws.coaching.errors.*` key when this
 * lane knows the code and detail, else the shared catalogue's line
 * (`errorToMessageKey`). A course create's per-session refusal keeps the
 * base line and carries the session number for the "Session {n}:" prefix.
 */
export function coachingErrorKey(error: unknown, ctx: CoachingErrorContext = {}): CoachingErrorKey {
  const base = errorToMessageKey(error);
  if (!(error instanceof AppRpcError))
    return { key: base, code: null, detail: null, sessionNo: null };
  const code = error.code;
  const detail = detailOf(error);
  const out = (key: MessageKey): CoachingErrorKey => ({ key, code, detail, sessionNo: null });
  const d = detail ?? '';

  if (SESSION_DETAIL_CODES.has(code) && /^\d+$/.test(d)) {
    return { key: base, code, detail, sessionNo: Number(d) };
  }
  switch (code) {
    case 'COURSE_STARTS_INVALID':
      if (d === 'count' || d === 'order' || d === 'span')
        return out(`ws.coaching.errors.courseStarts.${d}`);
      break;
    case 'LESSON_CLOSED':
      if (d === 'cutoff') return out('ws.coaching.errors.cutoffPassed');
      break;
    case 'LESSON_NOT_CANCELLABLE':
      if (
        d === 'status' ||
        d === 'started' ||
        d === 'ended' ||
        d === 'course_session' ||
        d === 'private'
      ) {
        return out(`ws.coaching.errors.notCancellable.${d}`);
      }
      break;
    case 'SESSION_NOT_MOVABLE':
      if (d === 'ended' || d === 'started' || d === 'order')
        return out(`ws.coaching.errors.notMovable.${d}`);
      break;
    case 'INVALID_TRANSITION':
      if (d === 'held') return out('ws.coaching.errors.heldWaiting');
      if (d === 'ended') return out('ws.coaching.errors.courtEnded');
      if (d === 'paid') return out('ws.coaching.errors.voidPaid');
      if (d === 'not_started' || d === 'marks_closed' || d === 'not_booked' || d === 'cancelled') {
        return out(`ws.coaching.errors.attendance.${d}`);
      }
      break;
    case 'LESSON_NOT_PAYABLE':
      if (
        d === 'held' ||
        d === 'expired' ||
        d === 'cancelled' ||
        d === 'lesson_cancelled' ||
        d === 'no_show' ||
        d === 'nothing_owed'
      ) {
        return out(`ws.coaching.errors.notPayable.${d}`);
      }
      break;
    case 'HOURS_INVALID':
      if (/^\d+(:\d)?$/.test(d)) return out('ws.coaching.errors.hoursInvalid');
      break;
    case 'HOURS_OVERLAP':
      if (d === 'time_off') return out('ws.coaching.errors.hoursOverlapTimeOff');
      if (/^\d+(:\d)?$/.test(d)) return out('ws.coaching.errors.hoursOverlap');
      break;
    case 'TIME_OFF_HAS_LESSONS':
      return out('ws.coaching.errors.timeOffHasLessons');
    case 'PRICE_VIA_PROTOCOL':
      if (d === 'shape') return out('ws.coaching.errors.lessonShapeViaProtocol');
      if (d === 'price' || ctx.scope === 'admin')
        return out('ws.coaching.errors.lessonPriceViaProtocol');
      break;
    case 'LAUNCH_VIA_PROTOCOL':
      if (ctx.scope === 'admin') return out('ws.coaching.errors.lessonPriceViaProtocol');
      break;
    case 'PRICE_TARGET_CHANGED':
      if (d === 'lesson_type' || d === 'coach_price')
        return out(`ws.coaching.errors.priceTargetChanged.${d}`);
      break;
    case 'ONLINE_PAYMENT_OFF':
      if (d === 'provider' || d === 'terms') return out(`ws.coaching.errors.onlineOff.${d}`);
      break;
    case 'BRANCH_HAS_BOOKINGS':
      if (d === 'coaching_money') return out('ws.coaching.errors.coachingMoney');
      if (d === 'coach_lessons' || UUID.test(d)) return out('ws.coaching.errors.branchHasLessons');
      break;
    case 'FORBIDDEN':
      if (d === 'own_statement') return out('ws.coaching.errors.ownStatement');
      break;
    case 'STATEMENT_NOT_DRAFT':
      if (d === 'live_draft') return out('ws.coaching.errors.liveDraft');
      break;
    case 'STATEMENT_NOT_APPROVED':
      if (d === 'negative') return out('ws.coaching.errors.negativeStatement');
      break;
    case 'INVALID_ARGUMENT':
      if (d === 'p_reference' || (d === 'p_reason' && ctx.scope === 'statement'))
        return out('ws.coaching.errors.cardNumber');
      break;
    case 'PAYMENT_STATE':
      if (d === 'lesson_live') return out('ws.coaching.errors.lessonLive');
      break;
    case 'LESSON_VIA_COACHING': {
      const via = d === 'court_only' ? 'move' : d === 'confirm' ? 'held' : d;
      if (
        via === 'cancel' ||
        via === 'mark' ||
        via === 'extend' ||
        via === 'move' ||
        via === 'create' ||
        via === 'tab' ||
        via === 'held'
      ) {
        return out(`ws.coaching.errors.viaCoaching.${via}`);
      }
      break;
    }
    case 'ALREADY_ENROLLED':
      if (d === 'coach') return out('ws.coaching.errors.coachEnrolled');
      break;
  }
  return out(base);
}

/** What a refusal's line needs filled in, from the screen that met it. */
export interface CoachingErrorParams {
  /** "{sessions}": the course's session count as a counted phrase. */
  sessions?: string;
  /** "{day}" for an hours refusal: the weekday name of the clashing window. */
  day?: string;
  /** "{branch}" for set_coach_branches. */
  branch?: string;
  /** "{amount}" for a below-zero statement. */
  amount?: string;
  /** "{name}" and "{lessons}" for a time-off refusal. */
  name?: string;
  lessons?: string;
}

/** A refusal, worded: its line, with the "Session {n}:" prefix when it names a session. */
export function coachingErrorText(
  error: unknown,
  tr: Tr,
  params: CoachingErrorParams = {},
  ctx: CoachingErrorContext = {},
): string {
  const picked = coachingErrorKey(error, ctx);
  const filled: TParams = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined) filled[k] = v;
  const line = tr(picked.key, filled);
  if (picked.sessionNo === null) return line;
  return tr('ws.coaching.errors.sessionPrefix', { n: String(picked.sessionNo), line });
}

/** The session number a course-create refusal names, or null. */
export function refusedSessionNo(error: unknown): number | null {
  return coachingErrorKey(error).sessionNo;
}

/** A counted phrase helper for the `{sessions}` / `{lessons}` / `{students}` holes. */
export function countOf(
  noun: 'lessons' | 'students' | 'places' | 'sessions' | 'coaches',
  count: number,
  locale: Locale,
): string {
  return countPhrase(`ws.coaching.count.${noun}`, count, locale);
}
