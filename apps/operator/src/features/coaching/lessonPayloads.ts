/**
 * The coaching reads and write results the operator parses
 * (docs/design/coaching/operator.md §5.6–§5.7), typed and parsed defensively.
 * Pure; no React.
 *
 * R41 / R81: `packages/core/src/coaching/shapes.ts` (`COACHING_SHAPES`) is
 * binding for every key name. Each parser below carries exactly the keys of
 * its shape entry onto its typed result, under the same names, so a renamed
 * key fails `lessonPayloads.test.ts` (fixtures are built from the lists).
 *
 * The `reportPayloads.ts` style: a missing or mistyped key is null (a figure
 * the screen prints as "—"), an empty list, or false for a `can` flag, never a
 * made-up zero and never a throw. The server builds every figure (§5.1: no
 * money is computed on a staff screen).
 *
 * Shapes not yet in `COACHING_SHAPES` (R81: added by the sub-step that builds
 * those RPCs) are read here from the keys `operator.md` §5.7 names:
 * `coach_promote`, `set_coach_branches`, `set_coach_lesson_types`,
 * `add_coach_time_off`, `desk_mark_attendance`, `coach_statement_void`.
 */
import type { CustomerFlag } from '../desk/deskTypes';

type Raw = Record<string, unknown>;

export function obj(v: unknown): Raw | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null;
}
export function list(v: unknown): Raw[] {
  return Array.isArray(v) ? v.map(obj).filter((r): r is Raw => r !== null) : [];
}
export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  // bigint columns come back as JSON numbers, but a numeric may arrive as text.
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}
export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
/** A `can` flag or a server boolean: only a real `true` is true. */
export function flag(v: unknown): boolean {
  return v === true;
}
/** A server boolean that may be absent: true, false, or null when not there. */
function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}
export function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function flags(v: unknown): CustomerFlag[] {
  return list(v).flatMap((f) => {
    const type = str(f.type);
    return type ? [{ type, label: str(f.label) }] : [];
  });
}
/** A count the server may send as a number or as a flag (`paid_online`). */
function countOrFlag(v: unknown): number | null {
  if (v === true) return 1;
  if (v === false) return 0;
  return num(v);
}

// ---------------------------------------------------------------------------
// Vocabularies (build contracts §1.3)
// ---------------------------------------------------------------------------

export const LESSON_KINDS = ['private', 'group', 'course'] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export function lessonKindOf(v: unknown): LessonKind | null {
  return (LESSON_KINDS as readonly unknown[]).includes(v) ? (v as LessonKind) : null;
}

export const LESSON_STATUSES = ['held', 'scheduled', 'completed', 'cancelled', 'expired'] as const;
export const COURSE_STATUSES = ['open', 'running', 'completed', 'cancelled'] as const;
export const ENROLMENT_STATUSES = ['held', 'booked', 'cancelled', 'expired'] as const;
export const COACH_STATUSES = ['active', 'paused', 'retired'] as const;
export const STATEMENT_STATUSES = ['draft', 'approved', 'paid', 'void'] as const;
export const LESSON_CANCEL_REASONS = [
  'guest_cancel',
  'coach_cancel',
  'staff_cancel',
  'under_filled',
  'payment_expired',
  'account_deleted',
  'coach_retired',
] as const;
export const CANCEL_KINDS = [
  'guest_free',
  'guest_late',
  'coach',
  'staff',
  'under_filled',
  'expired',
  'account_deleted',
  'course_cancelled',
] as const;
/** Who booked: the guest in the app, the coach in coach mode, or the desk. */
export const BOOKED_BY_KINDS = ['guest', 'coach', 'staff'] as const;

// ---------------------------------------------------------------------------
// app.desk_lessons(p_venue_id, p_from, p_to) → envelope (§5.6.1, X16, R20)
// ---------------------------------------------------------------------------

export interface PriceRow {
  lesson_type_id: string;
  price_iqd: number | null;
}

function priceRows(v: unknown): PriceRow[] {
  return list(v).flatMap((p) => {
    const id = str(p.lesson_type_id);
    return id ? [{ lesson_type_id: id, price_iqd: num(p.price_iqd) }] : [];
  });
}

export interface DeskCoach {
  coach_id: string;
  display_name_en: string;
  display_name_ar: string;
  /** active or paused (a paused coach is listed disabled in New lesson). */
  status: string;
  photo_path: string | null;
  lesson_type_ids: string[];
  /** `lesson_price_for`: the coach's own price, else the type's. */
  prices: PriceRow[];
}

export interface DeskLessonType {
  lesson_type_id: string;
  kind: LessonKind;
  name_en: string;
  name_ar: string;
  duration_min: number | null;
  price_iqd: number | null;
  max_places: number | null;
  min_places: number | null;
  cutoff_hours: number | null;
  sessions_count: number | null;
}

export interface DeskLessonCourse {
  course_id: string;
  title_en: string;
  title_ar: string;
  session_no: number | null;
  sessions_count: number | null;
}

export interface DeskLesson {
  lesson_id: string;
  /** The lesson's live court row (`kind 'lesson'`), or the `hold` row of a private lesson awaiting Qi. */
  reservation_id: string | null;
  court_id: string | null;
  court_name_en: string | null;
  court_name_ar: string | null;
  kind: LessonKind;
  status: string;
  start_at: string;
  end_at: string;
  hold_expires_at: string | null;
  /** guest, coach or staff: drives the C-24 "booked by the coach · unpaid" flag. */
  booked_by_kind: string | null;
  coach_id: string | null;
  coach_name_en: string | null;
  coach_name_ar: string | null;
  lesson_type_id: string | null;
  type_name_en: string | null;
  type_name_ar: string | null;
  course: DeskLessonCourse | null;
  /** Private: the booker's name as recorded (R44); else null. */
  label: string | null;
  /** Private: the booker's party; else null. */
  party_size: number | null;
  places_taken: number | null;
  max_places: number | null;
  min_places: number | null;
  cutoff_at: string | null;
  enrolments: number | null;
  /** Booked desk enrolments with something still to take. */
  owing: number | null;
  owing_iqd: number | null;
  /** Booked enrolments with online money left after refunds (0294, DB-32). */
  paid_online: number | null;
  /** Held places, waiting on a payment (0294, DB-32). */
  awaiting: number | null;
  /** Booked places with desk or online money left after refunds (0294, DB-32). */
  paid_places: number | null;
}

export interface DeskLessons {
  coaching_enabled: boolean;
  lesson_payment_mode: string | null;
  server_now: string | null;
  coaches: DeskCoach[];
  lesson_types: DeskLessonType[];
  lessons: DeskLesson[];
}

function readDeskCoach(c: Raw): DeskCoach | null {
  const id = str(c.coach_id);
  if (!id) return null;
  return {
    coach_id: id,
    display_name_en: str(c.display_name_en) ?? '',
    display_name_ar: str(c.display_name_ar) ?? str(c.display_name_en) ?? '',
    status: str(c.status) ?? 'active',
    photo_path: str(c.photo_path),
    lesson_type_ids: strs(c.lesson_type_ids),
    prices: priceRows(c.prices),
  };
}

function readDeskLessonType(t: Raw): DeskLessonType | null {
  const id = str(t.lesson_type_id);
  const kind = lessonKindOf(t.kind);
  if (!id || !kind) return null;
  return {
    lesson_type_id: id,
    kind,
    name_en: str(t.name_en) ?? '',
    name_ar: str(t.name_ar) ?? str(t.name_en) ?? '',
    duration_min: num(t.duration_min),
    price_iqd: num(t.price_iqd),
    max_places: num(t.max_places),
    min_places: num(t.min_places),
    cutoff_hours: num(t.cutoff_hours),
    sessions_count: num(t.sessions_count),
  };
}

function readDeskLessonCourse(v: unknown): DeskLessonCourse | null {
  const c = obj(v);
  const id = c ? str(c.course_id) : null;
  if (!c || !id) return null;
  return {
    course_id: id,
    title_en: str(c.title_en) ?? '',
    title_ar: str(c.title_ar) ?? '',
    session_no: num(c.session_no),
    sessions_count: num(c.sessions_count),
  };
}

export function readDeskLesson(r: Raw): DeskLesson | null {
  const id = str(r.lesson_id);
  const kind = lessonKindOf(r.kind);
  const start = str(r.start_at);
  const end = str(r.end_at);
  if (!id || !kind || !start || !end) return null;
  return {
    lesson_id: id,
    reservation_id: str(r.reservation_id),
    court_id: str(r.court_id),
    court_name_en: str(r.court_name_en),
    court_name_ar: str(r.court_name_ar),
    kind,
    status: str(r.status) ?? 'scheduled',
    start_at: start,
    end_at: end,
    hold_expires_at: str(r.hold_expires_at),
    booked_by_kind: str(r.booked_by_kind),
    coach_id: str(r.coach_id),
    coach_name_en: str(r.coach_name_en),
    coach_name_ar: str(r.coach_name_ar),
    lesson_type_id: str(r.lesson_type_id),
    type_name_en: str(r.type_name_en),
    type_name_ar: str(r.type_name_ar),
    course: readDeskLessonCourse(r.course),
    label: str(r.label),
    party_size: num(r.party_size),
    places_taken: num(r.places_taken),
    max_places: num(r.max_places),
    min_places: num(r.min_places),
    cutoff_at: str(r.cutoff_at),
    enrolments: num(r.enrolments),
    owing: num(r.owing),
    owing_iqd: num(r.owing_iqd),
    paid_online: countOrFlag(r.paid_online),
    awaiting: num(r.awaiting),
    paid_places: num(r.paid_places),
  };
}

export function readDeskLessons(raw: unknown): DeskLessons {
  const e = obj(raw) ?? {};
  return {
    coaching_enabled: flag(e.coaching_enabled),
    lesson_payment_mode: str(e.lesson_payment_mode),
    server_now: str(e.server_now),
    coaches: list(e.coaches)
      .map(readDeskCoach)
      .filter((c): c is DeskCoach => c !== null),
    lesson_types: list(e.lesson_types)
      .map(readDeskLessonType)
      .filter((t): t is DeskLessonType => t !== null),
    lessons: list(e.lessons)
      .map(readDeskLesson)
      .filter((l): l is DeskLesson => l !== null),
  };
}

// ---------------------------------------------------------------------------
// app.desk_lesson_detail(p_lesson_id) (§5.6.2, X17, R44)
// ---------------------------------------------------------------------------

export interface LessonCan {
  add_student: boolean;
  cancel: boolean;
  cancel_course: boolean;
  reschedule: boolean;
  move_court: boolean;
}

export interface LessonCoachRef {
  coach_id: string;
  display_name_en: string;
  display_name_ar: string;
  status: string;
}

export interface LessonTypeRef {
  lesson_type_id: string;
  name_en: string;
  name_ar: string;
}

export interface CourseSession {
  lesson_id: string;
  session_no: number | null;
  start_at: string;
  end_at: string;
  status: string;
  court_name_en: string | null;
  court_name_ar: string | null;
}

export interface LessonCourse {
  course_id: string;
  title_en: string;
  title_ar: string;
  status: string;
  cancel_reason: string | null;
  session_no: number | null;
  sessions_count: number | null;
  signup_closes_at: string | null;
  places_taken: number | null;
  max_places: number | null;
  sessions: CourseSession[];
}

export interface LessonInfo {
  id: string;
  venue_id: string | null;
  kind: LessonKind;
  status: string;
  cancel_reason: string | null;
  start_at: string;
  end_at: string;
  duration_min: number | null;
  rescheduled_at: string | null;
  booked_by_kind: string | null;
  coach: LessonCoachRef | null;
  lesson_type: LessonTypeRef | null;
  course: LessonCourse | null;
  reservation_id: string | null;
  reservation_status: string | null;
  court_id: string | null;
  court_name_en: string | null;
  court_name_ar: string | null;
  price_iqd: number | null;
  court_share_iqd: number | null;
  max_places: number | null;
  min_places: number | null;
  places_taken: number | null;
  cutoff_at: string | null;
  hold_expires_at: string | null;
  created_by_name: string | null;
  server_now: string | null;
  day_open: boolean | null;
  can: LessonCan;
}

export interface EnrolmentAttendance {
  /** attended or no_show. */
  status: string;
  marked_at: string | null;
  marked_by_name: string | null;
}

/** `lesson_enrolment_money` plus `take_iqd` (what Take payment collects). Every figure the server's. */
export interface EnrolmentMoney {
  price_iqd: number | null;
  owed_iqd: number | null;
  desk_paid_iqd: number | null;
  online_paid_iqd: number | null;
  refunded_iqd: number | null;
  kept_iqd: number | null;
  refund_due_iqd: number | null;
  /** The part of refund_due owed back at the desk (0294, DB-31). */
  refund_due_desk_iqd: number | null;
  /** The part no channel can return: handed back outside the till (R75; 0294, DB-31). */
  refund_blocked_iqd: number | null;
  take_iqd: number | null;
}

export interface EnrolmentCan {
  take_payment: boolean;
  cancel: boolean;
  mark_attended: boolean;
  mark_no_show: boolean;
  unmark: boolean;
}

export interface Enrolment {
  enrolment_id: string;
  /** 'lesson' (this session's) or 'course' (a course sign-up shown on every session). */
  scope: string;
  status: string;
  cancel_kind: string | null;
  cancelled_at: string | null;
  /** Null for a walk-in and for an unconfirmed phone match (C-21): never an Open customer then. */
  customer_id: string | null;
  /** The recorded name for a coach- or desk-booked row (R44), the profile's for a guest-booked one. */
  full_name: string | null;
  phone: string | null;
  /** True when the row shows a recorded (typed) name rather than the profile's. */
  typed: boolean;
  flags: CustomerFlag[];
  party_size: number | null;
  friend_names: string[];
  first_session_no: number | null;
  sessions_covered: number | null;
  booked_by_kind: string | null;
  booked_by_name: string | null;
  payment_mode: string | null;
  created_at: string | null;
  attendance: EnrolmentAttendance | null;
  money: EnrolmentMoney;
  can: EnrolmentCan;
}

export interface LessonEvent {
  at: string;
  type: string;
  actor: string | null;
  actor_name: string | null;
  enrolment_id: string | null;
  code: string | null;
  /** An `under_filled` judged after the start (R26): nothing was cancelled. */
  late: boolean;
}

export interface LessonDetail {
  lesson: LessonInfo;
  enrolments: Enrolment[];
  events: LessonEvent[];
}

function readCoachRef(v: unknown): LessonCoachRef | null {
  const c = obj(v);
  const id = c ? str(c.coach_id) : null;
  if (!c || !id) return null;
  return {
    coach_id: id,
    display_name_en: str(c.display_name_en) ?? '',
    display_name_ar: str(c.display_name_ar) ?? str(c.display_name_en) ?? '',
    status: str(c.status) ?? 'active',
  };
}

function readTypeRef(v: unknown): LessonTypeRef | null {
  const t = obj(v);
  const id = t ? str(t.lesson_type_id) : null;
  if (!t || !id) return null;
  return {
    lesson_type_id: id,
    name_en: str(t.name_en) ?? '',
    name_ar: str(t.name_ar) ?? str(t.name_en) ?? '',
  };
}

function readCourseSession(s: Raw): CourseSession | null {
  const id = str(s.lesson_id);
  const start = str(s.start_at);
  const end = str(s.end_at);
  if (!id || !start || !end) return null;
  return {
    lesson_id: id,
    session_no: num(s.session_no),
    start_at: start,
    end_at: end,
    status: str(s.status) ?? 'scheduled',
    court_name_en: str(s.court_name_en),
    court_name_ar: str(s.court_name_ar),
  };
}

function readLessonCourse(v: unknown): LessonCourse | null {
  const c = obj(v);
  const id = c ? str(c.course_id) : null;
  if (!c || !id) return null;
  return {
    course_id: id,
    title_en: str(c.title_en) ?? '',
    title_ar: str(c.title_ar) ?? '',
    status: str(c.status) ?? 'open',
    cancel_reason: str(c.cancel_reason),
    session_no: num(c.session_no),
    sessions_count: num(c.sessions_count),
    signup_closes_at: str(c.signup_closes_at),
    places_taken: num(c.places_taken),
    max_places: num(c.max_places),
    sessions: list(c.sessions)
      .map(readCourseSession)
      .filter((s): s is CourseSession => s !== null)
      .sort((a, b) => (a.session_no ?? 0) - (b.session_no ?? 0)),
  };
}

function readLessonCan(v: unknown): LessonCan {
  const c = obj(v) ?? {};
  return {
    add_student: flag(c.add_student),
    cancel: flag(c.cancel),
    cancel_course: flag(c.cancel_course),
    reschedule: flag(c.reschedule),
    move_court: flag(c.move_court),
  };
}

export function readEnrolmentMoney(v: unknown): EnrolmentMoney {
  const m = obj(v) ?? {};
  return {
    price_iqd: num(m.price_iqd),
    owed_iqd: num(m.owed_iqd),
    desk_paid_iqd: num(m.desk_paid_iqd),
    online_paid_iqd: num(m.online_paid_iqd),
    refunded_iqd: num(m.refunded_iqd),
    kept_iqd: num(m.kept_iqd),
    refund_due_iqd: num(m.refund_due_iqd),
    refund_due_desk_iqd: num(m.refund_due_desk_iqd),
    refund_blocked_iqd: num(m.refund_blocked_iqd),
    take_iqd: num(m.take_iqd),
  };
}

function readEnrolmentCan(v: unknown): EnrolmentCan {
  const c = obj(v) ?? {};
  return {
    take_payment: flag(c.take_payment),
    cancel: flag(c.cancel),
    mark_attended: flag(c.mark_attended),
    mark_no_show: flag(c.mark_no_show),
    unmark: flag(c.unmark),
  };
}

function readAttendance(v: unknown): EnrolmentAttendance | null {
  const a = obj(v);
  const status = a ? str(a.status) : null;
  if (!a || !status) return null;
  return { status, marked_at: str(a.marked_at), marked_by_name: str(a.marked_by_name) };
}

export function readEnrolment(e: Raw): Enrolment | null {
  const id = str(e.enrolment_id);
  if (!id) return null;
  return {
    enrolment_id: id,
    scope: str(e.scope) ?? 'lesson',
    status: str(e.status) ?? 'booked',
    cancel_kind: str(e.cancel_kind),
    cancelled_at: str(e.cancelled_at),
    customer_id: str(e.customer_id),
    full_name: str(e.full_name),
    phone: str(e.phone),
    typed: flag(e.typed),
    flags: flags(e.flags),
    party_size: num(e.party_size),
    friend_names: strs(e.friend_names),
    first_session_no: num(e.first_session_no),
    sessions_covered: num(e.sessions_covered),
    booked_by_kind: str(e.booked_by_kind),
    booked_by_name: str(e.booked_by_name),
    payment_mode: str(e.payment_mode),
    created_at: str(e.created_at),
    attendance: readAttendance(e.attendance),
    money: readEnrolmentMoney(e.money),
    can: readEnrolmentCan(e.can),
  };
}

function readLessonEvent(e: Raw): LessonEvent | null {
  const at = str(e.at);
  const type = str(e.type);
  if (!at || !type) return null;
  return {
    at,
    type,
    actor: str(e.actor),
    actor_name: str(e.actor_name),
    enrolment_id: str(e.enrolment_id),
    code: str(e.code),
    late: flag(e.late),
  };
}

/** Null when the payload has no readable lesson (the screen's "not at this branch"). */
export function readLessonDetail(raw: unknown): LessonDetail | null {
  const d = obj(raw);
  const l = d ? obj(d.lesson) : null;
  if (!d || !l) return null;
  const id = str(l.id);
  const kind = lessonKindOf(l.kind);
  const start = str(l.start_at);
  const end = str(l.end_at);
  if (!id || !kind || !start || !end) return null;
  const lesson: LessonInfo = {
    id,
    venue_id: str(l.venue_id),
    kind,
    status: str(l.status) ?? 'scheduled',
    cancel_reason: str(l.cancel_reason),
    start_at: start,
    end_at: end,
    duration_min: num(l.duration_min),
    rescheduled_at: str(l.rescheduled_at),
    booked_by_kind: str(l.booked_by_kind),
    coach: readCoachRef(l.coach),
    lesson_type: readTypeRef(l.lesson_type),
    course: readLessonCourse(l.course),
    reservation_id: str(l.reservation_id),
    reservation_status: str(l.reservation_status),
    court_id: str(l.court_id),
    court_name_en: str(l.court_name_en),
    court_name_ar: str(l.court_name_ar),
    price_iqd: num(l.price_iqd),
    court_share_iqd: num(l.court_share_iqd),
    max_places: num(l.max_places),
    min_places: num(l.min_places),
    places_taken: num(l.places_taken),
    cutoff_at: str(l.cutoff_at),
    hold_expires_at: str(l.hold_expires_at),
    created_by_name: str(l.created_by_name),
    server_now: str(l.server_now),
    day_open: bool(l.day_open),
    can: readLessonCan(l.can),
  };
  return {
    lesson,
    enrolments: list(d.enrolments)
      .map(readEnrolment)
      .filter((e): e is Enrolment => e !== null),
    events: list(d.events)
      .map(readLessonEvent)
      .filter((e): e is LessonEvent => e !== null),
  };
}

// ---------------------------------------------------------------------------
// app.customer_lessons(p_customer_id) (§5.6.3, X18)
// ---------------------------------------------------------------------------

export interface CustomerCoach {
  coach_id: string;
  status: string;
  display_name_en: string;
  display_name_ar: string;
  venue_ids: string[];
}

export interface CustomerLessonMoney {
  owed_iqd: number | null;
  desk_paid_iqd: number | null;
  online_paid_iqd: number | null;
  refund_due_iqd: number | null;
  take_iqd: number | null;
}

export interface CustomerLesson {
  enrolment_id: string;
  lesson_id: string | null;
  course_id: string | null;
  venue_id: string | null;
  kind: LessonKind;
  start_at: string;
  end_at: string | null;
  /** The lesson's status. */
  status: string;
  enrolment_status: string;
  /** attended, no_show, or null. */
  attendance: string | null;
  type_name_en: string | null;
  type_name_ar: string | null;
  coach_name_en: string | null;
  coach_name_ar: string | null;
  course_title_en: string | null;
  course_title_ar: string | null;
  payment_mode: string | null;
  money: CustomerLessonMoney;
}

export interface CustomerLessons {
  coach: CustomerCoach | null;
  counts: { lessons: number | null; no_shows: number | null };
  lesson_strikes_30d: number | null;
  lessons: CustomerLesson[];
}

function readCustomerLesson(r: Raw): CustomerLesson | null {
  const id = str(r.enrolment_id);
  const kind = lessonKindOf(r.kind);
  const start = str(r.start_at);
  if (!id || !kind || !start) return null;
  const m = obj(r.money) ?? {};
  // `attendance` may come as the bare status or as an object carrying one.
  const att = typeof r.attendance === 'string' ? r.attendance : str(obj(r.attendance)?.status);
  return {
    enrolment_id: id,
    lesson_id: str(r.lesson_id),
    course_id: str(r.course_id),
    venue_id: str(r.venue_id),
    kind,
    start_at: start,
    end_at: str(r.end_at),
    status: str(r.status) ?? 'scheduled',
    enrolment_status: str(r.enrolment_status) ?? 'booked',
    attendance: att,
    type_name_en: str(r.type_name_en),
    type_name_ar: str(r.type_name_ar),
    coach_name_en: str(r.coach_name_en),
    coach_name_ar: str(r.coach_name_ar),
    course_title_en: str(r.course_title_en),
    course_title_ar: str(r.course_title_ar),
    payment_mode: str(r.payment_mode),
    money: {
      owed_iqd: num(m.owed_iqd),
      desk_paid_iqd: num(m.desk_paid_iqd),
      online_paid_iqd: num(m.online_paid_iqd),
      refund_due_iqd: num(m.refund_due_iqd),
      take_iqd: num(m.take_iqd),
    },
  };
}

export function readCustomerLessons(raw: unknown): CustomerLessons {
  const d = obj(raw) ?? {};
  const c = obj(d.coach);
  const coachId = c ? str(c.coach_id) : null;
  const counts = obj(d.counts) ?? {};
  return {
    coach:
      c && coachId
        ? {
            coach_id: coachId,
            status: str(c.status) ?? 'active',
            display_name_en: str(c.display_name_en) ?? '',
            display_name_ar: str(c.display_name_ar) ?? str(c.display_name_en) ?? '',
            venue_ids: strs(c.venue_ids),
          }
        : null,
    counts: { lessons: num(counts.lessons), no_shows: num(counts.no_shows) },
    lesson_strikes_30d: num(d.lesson_strikes_30d),
    lessons: list(d.lessons)
      .map(readCustomerLesson)
      .filter((l): l is CustomerLesson => l !== null),
  };
}

// ---------------------------------------------------------------------------
// app.coaches_admin(p_venue_id) (§5.6.3, X19)
// ---------------------------------------------------------------------------

export interface HoursWindow {
  /** 0..6, Sunday = 0 (the branch's local weekday). */
  weekday: number;
  /** 'HH:MM' or 'HH:MM:SS'; an end may be '24:00'. */
  start_time: string;
  end_time: string;
}

export interface HoursElsewhere extends HoursWindow {
  venue_id: string;
  venue_name_en: string;
  venue_name_ar: string;
}

export interface TimeOff {
  id: string;
  starts_at: string;
  ends_at: string;
  reason: string;
  /** coach or staff. */
  set_by: string | null;
  set_by_name: string | null;
}

export interface AdminCoach {
  coach_id: string;
  profile_id: string | null;
  /** The account's name (staff only, never public). */
  full_name: string | null;
  phone: string | null;
  account_deleted: boolean;
  display_name_en: string;
  display_name_ar: string;
  bio_en: string;
  bio_ar: string;
  photo_path: string | null;
  status: string;
  /** Null while the coach has not accepted a public profile (C-22, R61). */
  public_accepted_at: string | null;
  sort_order: number | null;
  venue_ids: string[];
  /**
   * Active at this branch. False for a coach whose branch was switched off:
   * still listed, not taught here (OP-06). Missing reads as true.
   */
  active_here: boolean;
  /** The types this coach teaches at this branch. */
  lesson_type_ids: string[];
  /** The coach's own prices at this branch. */
  prices: PriceRow[];
  hours: HoursWindow[];
  hours_set_by: string | null;
  hours_set_by_name: string | null;
  hours_updated_at: string | null;
  hours_elsewhere: HoursElsewhere[];
  time_off: TimeOff[];
  upcoming_lessons: number | null;
  open_courses: number | null;
}

export interface PendingRun {
  run_id: string;
  change: string | null;
}

export interface AdminLessonType {
  lesson_type_id: string;
  kind: LessonKind;
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
  duration_min: number | null;
  price_iqd: number | null;
  court_share_iqd: number | null;
  max_places: number | null;
  min_places: number | null;
  cutoff_hours: number | null;
  sessions_count: number | null;
  is_active: boolean;
  launched_at: string | null;
  sort_order: number | null;
  coach_ids: string[];
  pending_run: PendingRun | null;
}

export interface CoachesAdmin {
  coaching_enabled: boolean;
  server_now: string | null;
  coaches: AdminCoach[];
  lesson_types: AdminLessonType[];
}

function readWindow(w: Raw): HoursWindow | null {
  const weekday = num(w.weekday);
  const start = str(w.start_time);
  const end = str(w.end_time);
  if (weekday === null || !start || !end) return null;
  return { weekday, start_time: start, end_time: end };
}

function readAdminCoach(c: Raw): AdminCoach | null {
  const id = str(c.coach_id);
  if (!id) return null;
  return {
    coach_id: id,
    profile_id: str(c.profile_id),
    full_name: str(c.full_name),
    phone: str(c.phone),
    account_deleted: flag(c.account_deleted),
    display_name_en: str(c.display_name_en) ?? '',
    display_name_ar: str(c.display_name_ar) ?? '',
    bio_en: str(c.bio_en) ?? '',
    bio_ar: str(c.bio_ar) ?? '',
    photo_path: str(c.photo_path),
    status: str(c.status) ?? 'active',
    public_accepted_at: str(c.public_accepted_at),
    sort_order: num(c.sort_order),
    venue_ids: strs(c.venue_ids),
    active_here: c.active_here !== false,
    lesson_type_ids: strs(c.lesson_type_ids),
    prices: priceRows(c.prices),
    hours: list(c.hours)
      .map(readWindow)
      .filter((w): w is HoursWindow => w !== null),
    hours_set_by: str(c.hours_set_by),
    hours_set_by_name: str(c.hours_set_by_name),
    hours_updated_at: str(c.hours_updated_at),
    hours_elsewhere: list(c.hours_elsewhere).flatMap((h) => {
      const w = readWindow(h);
      const venue = str(h.venue_id);
      return w && venue
        ? [
            {
              ...w,
              venue_id: venue,
              venue_name_en: str(h.venue_name_en) ?? '',
              venue_name_ar: str(h.venue_name_ar) ?? '',
            },
          ]
        : [];
    }),
    time_off: list(c.time_off).flatMap((t) => {
      const tid = str(t.id);
      const from = str(t.starts_at);
      const to = str(t.ends_at);
      return tid && from && to
        ? [
            {
              id: tid,
              starts_at: from,
              ends_at: to,
              reason: str(t.reason) ?? '',
              set_by: str(t.set_by),
              set_by_name: str(t.set_by_name),
            },
          ]
        : [];
    }),
    upcoming_lessons: num(c.upcoming_lessons),
    open_courses: num(c.open_courses),
  };
}

function readAdminLessonType(t: Raw): AdminLessonType | null {
  const id = str(t.lesson_type_id);
  const kind = lessonKindOf(t.kind);
  if (!id || !kind) return null;
  const run = obj(t.pending_run);
  const runId = run ? str(run.run_id) : null;
  return {
    lesson_type_id: id,
    kind,
    name_en: str(t.name_en) ?? '',
    name_ar: str(t.name_ar) ?? '',
    description_en: str(t.description_en) ?? '',
    description_ar: str(t.description_ar) ?? '',
    duration_min: num(t.duration_min),
    price_iqd: num(t.price_iqd),
    court_share_iqd: num(t.court_share_iqd),
    max_places: num(t.max_places),
    min_places: num(t.min_places),
    cutoff_hours: num(t.cutoff_hours),
    sessions_count: num(t.sessions_count),
    is_active: flag(t.is_active),
    launched_at: str(t.launched_at),
    sort_order: num(t.sort_order),
    coach_ids: strs(t.coach_ids),
    pending_run: run && runId ? { run_id: runId, change: str(run.change) } : null,
  };
}

export function readCoachesAdmin(raw: unknown): CoachesAdmin {
  const d = obj(raw) ?? {};
  return {
    coaching_enabled: flag(d.coaching_enabled),
    server_now: str(d.server_now),
    coaches: list(d.coaches)
      .map(readAdminCoach)
      .filter((c): c is AdminCoach => c !== null),
    lesson_types: list(d.lesson_types)
      .map(readAdminLessonType)
      .filter((t): t is AdminLessonType => t !== null),
  };
}

// ---------------------------------------------------------------------------
// app.coaching_settings / app.set_coaching_settings (§5.6.3, X20, R50, R56, R67)
// ---------------------------------------------------------------------------

export const LESSON_PAYMENT_MODES = ['desk', 'online_optional', 'online_required'] as const;
export type LessonPaymentMode = (typeof LESSON_PAYMENT_MODES)[number];

export interface CoachingSettings {
  venue_id: string | null;
  coaching_enabled: boolean;
  lesson_payment_mode: LessonPaymentMode;
  coach_share_bp: number | null;
  lesson_prices_public: boolean;
  coach_max_open_private: number | null;
  /**
   * R67: true once the lessons terms version is set (an online mode can be
   * chosen). A missing Qi provider is answered later by `lesson-begin`.
   */
  online_payments_available: boolean;
}

export function readCoachingSettings(raw: unknown): CoachingSettings {
  const s = obj(raw) ?? {};
  const mode = str(s.lesson_payment_mode);
  return {
    venue_id: str(s.venue_id),
    coaching_enabled: flag(s.coaching_enabled),
    lesson_payment_mode: (LESSON_PAYMENT_MODES as readonly (string | null)[]).includes(mode)
      ? (mode as LessonPaymentMode)
      : 'desk',
    coach_share_bp: num(s.coach_share_bp),
    lesson_prices_public: flag(s.lesson_prices_public),
    coach_max_open_private: num(s.coach_max_open_private),
    online_payments_available: flag(s.online_payments_available),
  };
}

// ---------------------------------------------------------------------------
// app.coach_slots(p_coach_id, p_lesson_type_id, p_from, p_to) (§5.6.3, X3, R51)
// ---------------------------------------------------------------------------

export interface CoachSlots {
  off: boolean;
  venue_id: string | null;
  lesson_type_id: string | null;
  duration_min: number | null;
  bookable: boolean;
  starts: { start_at: string; end_at: string }[];
}

export function readSlots(raw: unknown): CoachSlots {
  const s = obj(raw) ?? {};
  return {
    off: flag(s.off),
    venue_id: str(s.venue_id),
    lesson_type_id: str(s.lesson_type_id),
    duration_min: num(s.duration_min),
    bookable: flag(s.bookable),
    starts: list(s.starts).flatMap((x) => {
      const from = str(x.start_at);
      const to = str(x.end_at);
      return from && to ? [{ start_at: from, end_at: to }] : [];
    }),
  };
}

// ---------------------------------------------------------------------------
// app.lesson_refunds_due(p_venue_id) (§5.6.3, X21, R36, R62, R75)
// ---------------------------------------------------------------------------

export interface RefundDuePayment {
  payment_id: string;
  tab_id: string | null;
  method: string | null;
  amount_iqd: number | null;
  refunded_iqd: number | null;
  refundable_iqd: number | null;
  created_at: string | null;
}

export interface RefundDueItem {
  enrolment_id: string;
  lesson_id: string | null;
  course_id: string | null;
  kind: LessonKind | null;
  coach_id: string | null;
  coach_name_en: string | null;
  coach_name_ar: string | null;
  type_name_en: string | null;
  type_name_ar: string | null;
  start_at: string | null;
  /** The student as recorded (R44). */
  label: string | null;
  phone: string | null;
  cancel_kind: string | null;
  cancelled_at: string | null;
  refund_due_iqd: number | null;
  /** What the desk refunds (R36 caps a refund at this unless goodwill). */
  refund_due_desk_iqd: number | null;
  /** Owed back on an online payment that already has its one refund (R75). */
  online_blocked_iqd: number | null;
  payments: RefundDuePayment[];
}

export interface RefundsDue {
  venue_id: string | null;
  total_iqd: number | null;
  items: RefundDueItem[];
}

export function readRefundsDue(raw: unknown): RefundsDue {
  const d = obj(raw) ?? {};
  return {
    venue_id: str(d.venue_id),
    total_iqd: num(d.total_iqd),
    items: list(d.items).flatMap((i) => {
      const id = str(i.enrolment_id);
      if (!id) return [];
      return [
        {
          enrolment_id: id,
          lesson_id: str(i.lesson_id),
          course_id: str(i.course_id),
          kind: lessonKindOf(i.kind),
          coach_id: str(i.coach_id),
          coach_name_en: str(i.coach_name_en),
          coach_name_ar: str(i.coach_name_ar),
          type_name_en: str(i.type_name_en),
          type_name_ar: str(i.type_name_ar),
          start_at: str(i.start_at),
          label: str(i.label),
          phone: str(i.phone),
          cancel_kind: str(i.cancel_kind),
          cancelled_at: str(i.cancelled_at),
          refund_due_iqd: num(i.refund_due_iqd),
          refund_due_desk_iqd: num(i.refund_due_desk_iqd),
          online_blocked_iqd: num(i.online_blocked_iqd),
          payments: list(i.payments).flatMap((p) => {
            const pid = str(p.payment_id);
            return pid
              ? [
                  {
                    payment_id: pid,
                    tab_id: str(p.tab_id),
                    method: str(p.method),
                    amount_iqd: num(p.amount_iqd),
                    refunded_iqd: num(p.refunded_iqd),
                    refundable_iqd: num(p.refundable_iqd),
                    created_at: str(p.created_at),
                  },
                ]
              : [];
          }),
        },
      ];
    }),
  };
}

// ---------------------------------------------------------------------------
// app.report_coach_statements(p_month) and app.coach_statement_detail (§5.6.3, X22, X23)
// ---------------------------------------------------------------------------

export interface StatementRow {
  statement_id: string;
  coach_id: string | null;
  coach_name_en: string | null;
  coach_name_ar: string | null;
  venue_id: string | null;
  venue_name_en: string | null;
  venue_name_ar: string | null;
  /** The statement's month, 'YYYY-MM-01' (OP-02: the dialog names it from here). */
  month: string | null;
  status: string;
  lessons_count: number | null;
  collected_iqd: number | null;
  court_share_iqd: number | null;
  coach_iqd: number | null;
  /** Signed. */
  adjustments_iqd: number | null;
  total_iqd: number | null;
  payable_iqd: number | null;
  drafted_at: string | null;
  refreshed_at: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  paid_at: string | null;
  paid_by_name: string | null;
  paid_reference: string | null;
  voided_at: string | null;
  void_reason: string | null;
}

export interface MissingStatement {
  coach_id: string | null;
  coach_name_en: string | null;
  coach_name_ar: string | null;
  venue_id: string | null;
  /** 'older_draft', 'newer_draft' (0293, DB-24) or 'not_drafted'. */
  reason: string | null;
  /** The month of the draft in the way (older_draft, newer_draft); null for not_drafted. */
  blocking_month: string | null;
  blocking_statement_id: string | null;
}

export interface StatementTotals {
  statements: number | null;
  collected_iqd: number | null;
  court_share_iqd: number | null;
  coach_iqd: number | null;
  adjustments_iqd: number | null;
  total_iqd: number | null;
  payable_iqd: number | null;
  approved_unpaid_iqd: number | null;
  unpaid_iqd: number | null;
  paid_iqd: number | null;
}

export interface CoachStatements {
  /** 'YYYY-MM-01'. */
  month: string | null;
  current_month: string | null;
  server_now: string | null;
  statements: StatementRow[];
  missing: MissingStatement[];
  totals: StatementTotals;
}

export function readStatementRow(r: Raw): StatementRow | null {
  const id = str(r.statement_id);
  if (!id) return null;
  return {
    statement_id: id,
    coach_id: str(r.coach_id),
    coach_name_en: str(r.coach_name_en),
    coach_name_ar: str(r.coach_name_ar),
    venue_id: str(r.venue_id),
    venue_name_en: str(r.venue_name_en),
    venue_name_ar: str(r.venue_name_ar),
    month: str(r.month),
    status: str(r.status) ?? 'draft',
    lessons_count: num(r.lessons_count),
    collected_iqd: num(r.collected_iqd),
    court_share_iqd: num(r.court_share_iqd),
    coach_iqd: num(r.coach_iqd),
    adjustments_iqd: num(r.adjustments_iqd),
    total_iqd: num(r.total_iqd),
    payable_iqd: num(r.payable_iqd),
    drafted_at: str(r.drafted_at),
    refreshed_at: str(r.refreshed_at),
    approved_at: str(r.approved_at),
    approved_by_name: str(r.approved_by_name),
    paid_at: str(r.paid_at),
    paid_by_name: str(r.paid_by_name),
    paid_reference: str(r.paid_reference),
    voided_at: str(r.voided_at),
    void_reason: str(r.void_reason),
  };
}

export function readStatements(raw: unknown): CoachStatements {
  const d = obj(raw) ?? {};
  const t = obj(d.totals) ?? {};
  return {
    month: str(d.month),
    current_month: str(d.current_month),
    server_now: str(d.server_now),
    statements: list(d.statements)
      .map(readStatementRow)
      .filter((s): s is StatementRow => s !== null),
    missing: list(d.missing).map((m) => ({
      coach_id: str(m.coach_id),
      coach_name_en: str(m.coach_name_en),
      coach_name_ar: str(m.coach_name_ar),
      venue_id: str(m.venue_id),
      reason: str(m.reason),
      blocking_month: str(m.blocking_month),
      blocking_statement_id: str(m.blocking_statement_id),
    })),
    totals: {
      statements: num(t.statements),
      collected_iqd: num(t.collected_iqd),
      court_share_iqd: num(t.court_share_iqd),
      coach_iqd: num(t.coach_iqd),
      adjustments_iqd: num(t.adjustments_iqd),
      total_iqd: num(t.total_iqd),
      payable_iqd: num(t.payable_iqd),
      approved_unpaid_iqd: num(t.approved_unpaid_iqd),
      unpaid_iqd: num(t.unpaid_iqd),
      paid_iqd: num(t.paid_iqd),
    },
  };
}

export interface StatementLine {
  line_id: string;
  lesson_id: string | null;
  start_at: string | null;
  kind: LessonKind | null;
  type_name_en: string | null;
  type_name_ar: string | null;
  course_id: string | null;
  course_title_en: string | null;
  course_title_ar: string | null;
  session_no: number | null;
  lesson_status: string | null;
  is_adjustment: boolean;
  collected_iqd: number | null;
  court_share_iqd: number | null;
  share_bp: number | null;
  coach_iqd: number | null;
  enrolments: number | null;
  attended: number | null;
  no_shows: number | null;
}

export interface StatementCan {
  refresh: boolean;
  approve: boolean;
  void: boolean;
  mark_paid: boolean;
}

/** R72: a coach-booked lesson the student didn't come to; the label is the recorded one. */
export interface CoachBookedNoShow {
  lesson_id: string;
  start_at: string | null;
  student_label: string | null;
}

export interface StatementDetail {
  statement: StatementRow;
  /** Lessons changed since this draft was counted. */
  stale: boolean;
  /** All false on the caller's own statement (CM-11). */
  can: StatementCan;
  coach_booked_no_shows: CoachBookedNoShow[];
  lines: StatementLine[];
}

export function readStatementDetail(raw: unknown): StatementDetail | null {
  const d = obj(raw);
  const s = d ? obj(d.statement) : null;
  const statement = s ? readStatementRow(s) : null;
  if (!d || !statement) return null;
  const c = obj(d.can) ?? {};
  return {
    statement,
    stale: flag(d.stale),
    can: {
      refresh: flag(c.refresh),
      approve: flag(c.approve),
      void: flag(c.void),
      mark_paid: flag(c.mark_paid),
    },
    coach_booked_no_shows: list(d.coach_booked_no_shows).flatMap((n) => {
      const id = str(n.lesson_id);
      return id
        ? [{ lesson_id: id, start_at: str(n.start_at), student_label: str(n.student_label) }]
        : [];
    }),
    lines: list(d.lines).flatMap((l) => {
      const id = str(l.line_id);
      if (!id) return [];
      return [
        {
          line_id: id,
          lesson_id: str(l.lesson_id),
          start_at: str(l.start_at),
          kind: lessonKindOf(l.kind),
          type_name_en: str(l.type_name_en),
          type_name_ar: str(l.type_name_ar),
          course_id: str(l.course_id),
          course_title_en: str(l.course_title_en),
          course_title_ar: str(l.course_title_ar),
          session_no: num(l.session_no),
          lesson_status: str(l.lesson_status),
          is_adjustment: flag(l.is_adjustment),
          collected_iqd: num(l.collected_iqd),
          court_share_iqd: num(l.court_share_iqd),
          share_bp: num(l.share_bp),
          coach_iqd: num(l.coach_iqd),
          enrolments: num(l.enrolments),
          attended: num(l.attended),
          no_shows: num(l.no_shows),
        },
      ];
    }),
  };
}

// ---------------------------------------------------------------------------
// app.report_lessons(p_from, p_to) (§5.6.3, X24)
// ---------------------------------------------------------------------------

export const LESSON_REPORT_TOTALS = [
  'lessons',
  'private',
  'group',
  'courseSessions',
  'cancelled',
  'underFilled',
  'expired',
  'enrolments',
  'places',
  'placesTaken',
  'fillRatePct',
  'attended',
  'noShows',
  'lateCancels',
  'collectedIqd',
  'courtShareIqd',
  'coachShareIqd',
  'venueShareIqd',
  'deskIqd',
  'onlineIqd',
  'refundsIqd',
  'lessonRevenueIqd',
  'sandboxExcluded',
] as const;
export type LessonReportTotal = (typeof LESSON_REPORT_TOTALS)[number];

export interface LessonsReport {
  period: { from: string | null; to: string | null };
  totals: Record<LessonReportTotal, number | null>;
  byCoach: {
    coachId: string | null;
    coachNameEn: string | null;
    coachNameAr: string | null;
    lessons: number | null;
    enrolments: number | null;
    collectedIqd: number | null;
    coachShareIqd: number | null;
  }[];
  byType: {
    lessonTypeId: string | null;
    nameEn: string | null;
    nameAr: string | null;
    kind: LessonKind | null;
    lessons: number | null;
    enrolments: number | null;
    collectedIqd: number | null;
  }[];
  byDay: {
    date: string | null;
    lessons: number | null;
    collectedIqd: number | null;
    coachShareIqd: number | null;
  }[];
  /** The server's column order for the exports, as sent. */
  columns: unknown;
}

export function readLessonsReport(raw: unknown): LessonsReport {
  const d = obj(raw) ?? {};
  const p = obj(d.period) ?? {};
  const t = obj(d.totals) ?? {};
  const totals = {} as Record<LessonReportTotal, number | null>;
  for (const key of LESSON_REPORT_TOTALS) totals[key] = num(t[key]);
  return {
    period: { from: str(p.from), to: str(p.to) },
    totals,
    byCoach: list(d.byCoach).map((r) => ({
      coachId: str(r.coachId),
      coachNameEn: str(r.coachNameEn),
      coachNameAr: str(r.coachNameAr),
      lessons: num(r.lessons),
      enrolments: num(r.enrolments),
      collectedIqd: num(r.collectedIqd),
      coachShareIqd: num(r.coachShareIqd),
    })),
    byType: list(d.byType).map((r) => ({
      lessonTypeId: str(r.lessonTypeId),
      nameEn: str(r.nameEn),
      nameAr: str(r.nameAr),
      kind: lessonKindOf(r.kind),
      lessons: num(r.lessons),
      enrolments: num(r.enrolments),
      collectedIqd: num(r.collectedIqd),
    })),
    byDay: list(d.byDay).map((r) => ({
      date: str(r.date),
      lessons: num(r.lessons),
      collectedIqd: num(r.collectedIqd),
      coachShareIqd: num(r.coachShareIqd),
    })),
    columns: d.columns ?? null,
  };
}

// ---------------------------------------------------------------------------
// Write results (§5.7; X13, X29)
// ---------------------------------------------------------------------------

/** app.desk_book_lesson. */
export interface BookedLesson {
  duplicate: boolean;
  lesson_id: string | null;
  enrolment_id: string | null;
  court_id: string | null;
  court_name_en: string | null;
  court_name_ar: string | null;
  start_at: string | null;
  end_at: string | null;
  price_iqd: number | null;
}

export function readBookedLesson(raw: unknown): BookedLesson {
  const r = obj(raw) ?? {};
  return {
    duplicate: flag(r.duplicate),
    lesson_id: str(r.lesson_id),
    enrolment_id: str(r.enrolment_id),
    court_id: str(r.court_id),
    court_name_en: str(r.court_name_en),
    court_name_ar: str(r.court_name_ar),
    start_at: str(r.start_at),
    end_at: str(r.end_at),
    price_iqd: num(r.price_iqd),
  };
}

/** app.desk_create_group. */
export interface CreatedGroup {
  duplicate: boolean;
  lesson_id: string | null;
  start_at: string | null;
  end_at: string | null;
  cutoff_at: string | null;
  court_id: string | null;
  court_name_en: string | null;
  court_name_ar: string | null;
  price_iqd: number | null;
  max_places: number | null;
  min_places: number | null;
}

export function readCreatedGroup(raw: unknown): CreatedGroup {
  const r = obj(raw) ?? {};
  return {
    duplicate: flag(r.duplicate),
    lesson_id: str(r.lesson_id),
    start_at: str(r.start_at),
    end_at: str(r.end_at),
    cutoff_at: str(r.cutoff_at),
    court_id: str(r.court_id),
    court_name_en: str(r.court_name_en),
    court_name_ar: str(r.court_name_ar),
    price_iqd: num(r.price_iqd),
    max_places: num(r.max_places),
    min_places: num(r.min_places),
  };
}

/** app.desk_create_course (X13: both `lesson_ids` and `sessions`). */
export interface CreatedCourse {
  duplicate: boolean;
  course_id: string | null;
  lesson_ids: string[];
  sessions: {
    session_no: number | null;
    lesson_id: string;
    start_at: string | null;
    end_at: string | null;
    court_name_en: string | null;
    court_name_ar: string | null;
  }[];
  price_iqd: number | null;
  cutoff_at: string | null;
  signup_closes_at: string | null;
}

export function readCreatedCourse(raw: unknown): CreatedCourse {
  const r = obj(raw) ?? {};
  return {
    duplicate: flag(r.duplicate),
    course_id: str(r.course_id),
    lesson_ids: strs(r.lesson_ids),
    sessions: list(r.sessions).flatMap((s) => {
      const id = str(s.lesson_id);
      return id
        ? [
            {
              session_no: num(s.session_no),
              lesson_id: id,
              start_at: str(s.start_at),
              end_at: str(s.end_at),
              court_name_en: str(s.court_name_en),
              court_name_ar: str(s.court_name_ar),
            },
          ]
        : [];
    }),
    price_iqd: num(r.price_iqd),
    cutoff_at: str(r.cutoff_at),
    signup_closes_at: str(r.signup_closes_at),
  };
}

/** The first session of a created course: `sessions[]` by number, else `lesson_ids[0]`. */
export function firstSessionId(c: CreatedCourse): string | null {
  const sorted = [...c.sessions].sort((a, b) => (a.session_no ?? 0) - (b.session_no ?? 0));
  return sorted[0]?.lesson_id ?? c.lesson_ids[0] ?? null;
}

/** app.desk_add_student. */
export interface AddedStudent {
  duplicate: boolean;
  enrolment_id: string | null;
  price_iqd: number | null;
  places_left: number | null;
}

export function readAddedStudent(raw: unknown): AddedStudent {
  const r = obj(raw) ?? {};
  return {
    duplicate: flag(r.duplicate),
    enrolment_id: str(r.enrolment_id),
    price_iqd: num(r.price_iqd),
    places_left: num(r.places_left),
  };
}

/** app.desk_cancel_enrolment. */
export interface CancelledEnrolment {
  enrolment_id: string | null;
  status: string | null;
  refund_due_iqd: number | null;
  /** True (or an amount) when an online refund was started. */
  online_refund: unknown;
}

export function readCancelledEnrolment(raw: unknown): CancelledEnrolment {
  const r = obj(raw) ?? {};
  return {
    enrolment_id: str(r.enrolment_id),
    status: str(r.status),
    refund_due_iqd: num(r.refund_due_iqd),
    online_refund: r.online_refund ?? null,
  };
}

/** app.desk_cancel_lesson. */
export function readCancelledLesson(raw: unknown): {
  lesson_id: string | null;
  status: string | null;
} {
  const r = obj(raw) ?? {};
  return { lesson_id: str(r.lesson_id), status: str(r.status) };
}

/** app.desk_cancel_course. */
export function readCancelledCourse(raw: unknown): {
  course_id: string | null;
  status: string | null;
  sessions_cancelled: number | null;
} {
  const r = obj(raw) ?? {};
  return {
    course_id: str(r.course_id),
    status: str(r.status),
    sessions_cancelled: num(r.sessions_cancelled),
  };
}

/** app.desk_reschedule_session. */
export interface Rescheduled {
  lesson_id: string | null;
  start_at: string | null;
  end_at: string | null;
  court_id: string | null;
  court_name_en: string | null;
  court_name_ar: string | null;
}

export function readRescheduled(raw: unknown): Rescheduled {
  const r = obj(raw) ?? {};
  return {
    lesson_id: str(r.lesson_id),
    start_at: str(r.start_at),
    end_at: str(r.end_at),
    court_id: str(r.court_id),
    court_name_en: str(r.court_name_en),
    court_name_ar: str(r.court_name_ar),
  };
}

/** app.lesson_settle. */
export interface LessonSettled {
  duplicate: boolean;
  payment_id: string | null;
  amount_iqd: number | null;
  change_iqd: number | null;
}

export function readLessonSettled(raw: unknown): LessonSettled {
  const r = obj(raw) ?? {};
  return {
    duplicate: flag(r.duplicate),
    payment_id: str(r.payment_id),
    amount_iqd: num(r.amount_iqd),
    change_iqd: num(r.change_iqd),
  };
}

/** app.set_coach_status (X29). */
export interface CoachStatusSet {
  coach_id: string | null;
  status: string | null;
  lessons_cancelled: number | null;
  courses_cancelled: number | null;
  duplicate: boolean;
}

export function readCoachStatusSet(raw: unknown): CoachStatusSet {
  const r = obj(raw) ?? {};
  return {
    coach_id: str(r.coach_id),
    status: str(r.status),
    lessons_cancelled: num(r.lessons_cancelled),
    courses_cancelled: num(r.courses_cancelled),
    duplicate: flag(r.duplicate),
  };
}

/** app.coach_promote (not yet in COACHING_SHAPES, R81): `coach_id`. */
export function readPromoted(raw: unknown): { coach_id: string | null } {
  const r = obj(raw) ?? {};
  return { coach_id: str(r.coach_id) ?? str(r.id) };
}

/** app.coach_statement_refresh. */
export function readStatementRefreshed(raw: unknown): {
  statement_id: string | null;
  status: string | null;
  created: boolean;
} {
  const r = obj(raw) ?? {};
  return { statement_id: str(r.statement_id), status: str(r.status), created: flag(r.created) };
}

/** app.coach_statement_approve. */
export function readStatementApproved(raw: unknown): {
  statement_id: string | null;
  status: string | null;
  next_statement_id: string | null;
} {
  const r = obj(raw) ?? {};
  return {
    statement_id: str(r.statement_id),
    status: str(r.status),
    next_statement_id: str(r.next_statement_id),
  };
}

/** app.coach_statement_mark_paid. */
export function readStatementPaid(raw: unknown): {
  duplicate: boolean;
  statement_id: string | null;
  status: string | null;
  paid_at: string | null;
  total_iqd: number | null;
} {
  const r = obj(raw) ?? {};
  return {
    duplicate: flag(r.duplicate),
    statement_id: str(r.statement_id),
    status: str(r.status),
    paid_at: str(r.paid_at),
    total_iqd: num(r.total_iqd),
  };
}
