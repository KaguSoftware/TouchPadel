/**
 * Coaching on the guest's phone, decided in PURE code (no RN / expo / supabase
 * imports, so vitest runs it under plain node).
 *
 * Binding shapes: `packages/core/src/coaching/shapes.ts` (`COACHING_SHAPES`,
 * R41, R81) and docs/design/coaching/guest.md §4.3. Every parser below reads
 * exactly the keys its shape lists, top level and nested, and nothing else:
 * `__tests__/logic.test.ts` runs each one over a recording proxy and holds the
 * keys it read equal to the shape. A server may add keys; it never renames or
 * drops one, and a missing one falls back here rather than throwing.
 *
 * THE RULE THIS FILE KEEPS (guest.md §4.0 rule 4): the phone never computes a
 * price, a pro-rata share, a coach share, a permission, a cancel policy, a
 * refund preview or a refusal. It renders what the server sent (`price_iqd`,
 * `late_join`, `cancel.*`, `can.*`) and parses every enum defensively: an
 * unknown value falls back and never throws (the `parseDepositStatus`
 * pattern). The helpers only arrange what the server already decided: which
 * night a start belongs to, which branch a screen reads, which payment choice
 * a branch's mode offers.
 */
import {
  addDays,
  dayOfWeekOfDate,
  isOvernightTail,
  localParts,
  parseHHMM,
  pickLocale,
  wallTimeToUtc,
  type OpeningHours,
} from '@touch/core';
import type { Locale } from '@touch/i18n';
import type { MergedCell } from '../availability/assemble';
import { tradingNightOf } from '../matches/logic';

// ── Server vocabulary (build contracts §1.3) ────────────────────────────────

export const LESSON_KINDS = ['private', 'group', 'course'] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

/** A group session or a course: what `classes` and `class/[id]` list. */
export type ClassLessonKind = Exclude<LessonKind, 'private'>;

export const ENROLMENT_STATUSES = ['held', 'booked', 'cancelled', 'expired'] as const;
export type EnrolmentStatus = (typeof ENROLMENT_STATUSES)[number];

export const LESSON_STATUSES = ['held', 'scheduled', 'completed', 'cancelled', 'expired'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

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
export type CancelKind = (typeof CANCEL_KINDS)[number];

/** A branch's `lesson_payment_mode` (CD-1). */
export const LESSON_PAYMENT_MODES = ['desk', 'online_optional', 'online_required'] as const;
export type LessonPaymentMode = (typeof LESSON_PAYMENT_MODES)[number];

/** How one enrolment is paid. */
export const ENROLMENT_PAYMENT_MODES = ['desk', 'online'] as const;
export type PaymentChoice = (typeof ENROLMENT_PAYMENT_MODES)[number];

export const BOOKED_BY = ['guest', 'coach', 'staff'] as const;
export type BookedBy = (typeof BOOKED_BY)[number];

export const ATTENDANCE = ['attended', 'no_show'] as const;
export type Attendance = (typeof ATTENDANCE)[number];

export const OFFER_STATUSES = ['open', 'full', 'closed', 'cancelled'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const REFUND_STATUSES = ['pending', 'refunded', 'failed'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const CANCEL_POLICIES = ['free', 'late', 'none'] as const;
export type CancelPolicy = (typeof CANCEL_POLICIES)[number];

export const COACH_STATUSES = ['active', 'paused'] as const;
export type CoachStatusValue = (typeof COACH_STATUSES)[number];

/** Desk and coach cancel reasons (§1.3); sent as `<code>` or `<code>: <note>`. */
export const CANCEL_REASONS = [
  'customer_request',
  'coach_unavailable',
  'court_needed',
  'staff_error',
  'duplicate',
  'other',
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/** The longest window `coach_slots` answers (X3: `p_to - p_from ≤ 14 days`). */
export const SLOT_WINDOW_DAYS = 14;

export const DEFAULT_TZ = 'Asia/Baghdad';

// ── Parsing primitives ──────────────────────────────────────────────────────

type Json = Record<string, unknown>;

const obj = (v: unknown): Json =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const objOrNull = (v: unknown): Json | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const bool = (v: unknown): boolean => v === true;

/** An integer (count or IQD amount), whether jsonb sent a number or PostgREST a numeric string. */
function int(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;

const strings = (v: unknown): string[] =>
  arr(v).filter((x): x is string => typeof x === 'string' && !!x);

/** A branch mode this build does not know reads as the desk: the one mode that never asks for money online. */
const modeOf = (v: unknown): LessonPaymentMode => oneOf(LESSON_PAYMENT_MODES, v) ?? 'desk';

// ── app.coaching_public (X1; anon and authenticated) ────────────────────────

export interface PublicBranch {
  venueId: string;
  nameEn: string;
  nameAr: string;
  timezone: string;
  paymentMode: LessonPaymentMode;
  /** The web's price switch (C-11). The phone shows prices whatever it says. */
  pricesPublic: boolean;
  cancellationWindowHours: number | null;
}

export interface CoachOffer {
  lessonTypeId: string;
  venueId: string;
  /** `lesson_price_for(coach, type)`: the per-coach price, else the type's. */
  priceIqd: number | null;
}

export interface PublicCoach {
  /** `coaches.id`, never a profile id (R43). */
  id: string;
  displayNameEn: string;
  displayNameAr: string;
  bioEn: string;
  bioAr: string;
  photoPath: string | null;
  sortOrder: number;
  venueIds: string[];
  offers: CoachOffer[];
}

export interface PublicLessonType {
  id: string;
  venueId: string;
  /** Null for a kind this build does not know: the screens leave it out. */
  kind: LessonKind | null;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  durationMin: number;
  maxPlaces: number;
  minPlaces: number;
  sessionsCount: number | null;
  priceIqd: number | null;
  sortOrder: number;
}

/** A group session or a course with places, as the public reads list them. */
export interface SessionListing {
  kind: ClassLessonKind;
  lessonId: string | null;
  courseId: string | null;
  venueId: string;
  coachId: string;
  lessonTypeId: string;
  titleEn: string;
  titleAr: string;
  /** A group session's start; a course's next session. */
  startAt: string;
  endAt: string;
  sessionsCount: number | null;
  sessionsLeft: number | null;
  placesLeft: number;
  maxPlaces: number;
  signupClosesAt: string | null;
  cutoffAt: string | null;
  /** What a guest pays now: the place, or a running course's sessions not yet started (0294, DB-28). */
  priceIqd: number | null;
  /** The place's or the whole course's price (0294, DB-28). */
  fullPriceIqd: number | null;
}

export interface CoachingPublic {
  /** Coaching is off (or the branch closed / unknown): no other field is meaningful. */
  off: boolean;
  branches: PublicBranch[];
  coaches: PublicCoach[];
  lessonTypes: PublicLessonType[];
  sessions: SessionListing[];
  serverNow: string | null;
}

function parseOffer(raw: unknown): CoachOffer | null {
  const o = obj(raw);
  const lessonTypeId = str(o.lesson_type_id);
  const venueId = str(o.venue_id);
  if (!lessonTypeId || !venueId) return null;
  return { lessonTypeId, venueId, priceIqd: int(o.price_iqd) };
}

/** `coaching_public.sessions[]` and `coach_profile.sessions[]` (SESSION_LISTING). */
function parseSessionListing(raw: unknown): SessionListing | null {
  const o = obj(raw);
  const lessonId = str(o.lesson_id);
  const courseId = str(o.course_id);
  const venueId = str(o.venue_id);
  const coachId = str(o.coach_id);
  const lessonTypeId = str(o.lesson_type_id);
  const startAt = str(o.start_at);
  // A kind this build does not know is read from the id it carries.
  const kind = oneOf(['group', 'course'] as const, o.kind) ?? (courseId ? 'course' : 'group');
  const id = kind === 'course' ? courseId : lessonId;
  if (!id || !venueId || !coachId || !lessonTypeId || !startAt) return null;
  return {
    kind,
    lessonId,
    courseId,
    venueId,
    coachId,
    lessonTypeId,
    titleEn: text(o.title_en),
    titleAr: text(o.title_ar),
    startAt,
    endAt: str(o.end_at) ?? startAt,
    sessionsCount: int(o.sessions_count),
    sessionsLeft: int(o.sessions_left),
    placesLeft: Math.max(0, int(o.places_left) ?? 0),
    maxPlaces: Math.max(0, int(o.max_places) ?? 0),
    signupClosesAt: str(o.signup_closes_at),
    cutoffAt: str(o.cutoff_at),
    priceIqd: int(o.price_iqd),
    fullPriceIqd: int(o.full_price_iqd),
  };
}

function parseSessions(v: unknown): SessionListing[] {
  return arr(v)
    .map(parseSessionListing)
    .filter((s): s is SessionListing => s !== null);
}

export function parseCoachingPublic(json: unknown): CoachingPublic {
  const o = obj(json);
  const off = bool(o.off);
  const branches: PublicBranch[] = [];
  for (const raw of arr(o.branches)) {
    const b = obj(raw);
    const venueId = str(b.venue_id);
    if (!venueId) continue;
    branches.push({
      venueId,
      nameEn: text(b.name_en),
      nameAr: text(b.name_ar),
      timezone: str(b.timezone) ?? DEFAULT_TZ,
      paymentMode: modeOf(b.payment_mode),
      pricesPublic: bool(b.prices_public),
      cancellationWindowHours: int(b.cancellation_window_hours),
    });
  }
  const coaches: PublicCoach[] = [];
  for (const raw of arr(o.coaches)) {
    const c = obj(raw);
    const id = str(c.id);
    if (!id) continue;
    coaches.push({
      id,
      displayNameEn: text(c.display_name_en),
      displayNameAr: text(c.display_name_ar),
      bioEn: text(c.bio_en),
      bioAr: text(c.bio_ar),
      photoPath: str(c.photo_path),
      sortOrder: int(c.sort_order) ?? 0,
      venueIds: strings(c.venue_ids),
      offers: arr(c.offers)
        .map(parseOffer)
        .filter((x): x is CoachOffer => x !== null),
    });
  }
  const lessonTypes: PublicLessonType[] = [];
  for (const raw of arr(o.lesson_types)) {
    const t = obj(raw);
    const id = str(t.id);
    const venueId = str(t.venue_id);
    if (!id || !venueId) continue;
    lessonTypes.push({
      id,
      venueId,
      kind: oneOf(LESSON_KINDS, t.kind),
      nameEn: text(t.name_en),
      nameAr: text(t.name_ar),
      descriptionEn: text(t.description_en),
      descriptionAr: text(t.description_ar),
      durationMin: Math.max(0, int(t.duration_min) ?? 0),
      maxPlaces: Math.max(1, int(t.max_places) ?? 1),
      minPlaces: Math.max(1, int(t.min_places) ?? 1),
      sessionsCount: int(t.sessions_count),
      priceIqd: int(t.price_iqd),
      sortOrder: int(t.sort_order) ?? 0,
    });
  }
  return {
    off,
    branches,
    coaches,
    lessonTypes,
    sessions: parseSessions(o.sessions),
    serverNow: str(o.server_now),
  };
}

// ── app.coach_profile (X2, R17) ─────────────────────────────────────────────

export interface ProfileCoach {
  id: string;
  displayNameEn: string;
  displayNameAr: string;
  bioEn: string;
  bioAr: string;
  photoPath: string | null;
  /** `paused`: answered by a direct link, with no offers (R76). */
  status: CoachStatusValue;
  venueIds: string[];
}

export interface ProfileVenue {
  venueId: string;
  nameEn: string;
  nameAr: string;
  timezone: string;
  phone: string | null;
  paymentMode: LessonPaymentMode;
  pricesPublic: boolean;
  cancellationWindowHours: number | null;
}

export interface ProfileOffer {
  lessonTypeId: string;
  kind: LessonKind | null;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  durationMin: number;
  maxPlaces: number;
  minPlaces: number;
  sessionsCount: number | null;
  cutoffHours: number;
  priceIqd: number | null;
}

export interface CoachProfile {
  off: boolean;
  coach: ProfileCoach | null;
  /** Null for the link's read with no branch (R17): pick one and read again. */
  venue: ProfileVenue | null;
  offers: ProfileOffer[];
  sessions: SessionListing[];
  serverNow: string | null;
}

export function parseCoachProfile(json: unknown): CoachProfile {
  const o = obj(json);
  const c = objOrNull(o.coach);
  const coachId = c ? str(c.id) : null;
  const v = objOrNull(o.venue);
  const venueId = v ? str(v.venue_id) : null;
  const offers: ProfileOffer[] = [];
  for (const raw of arr(o.offers)) {
    const f = obj(raw);
    const lessonTypeId = str(f.lesson_type_id);
    if (!lessonTypeId) continue;
    offers.push({
      lessonTypeId,
      kind: oneOf(LESSON_KINDS, f.kind),
      nameEn: text(f.name_en),
      nameAr: text(f.name_ar),
      descriptionEn: text(f.description_en),
      descriptionAr: text(f.description_ar),
      durationMin: Math.max(0, int(f.duration_min) ?? 0),
      maxPlaces: Math.max(1, int(f.max_places) ?? 1),
      minPlaces: Math.max(1, int(f.min_places) ?? 1),
      sessionsCount: int(f.sessions_count),
      cutoffHours: Math.max(0, int(f.cutoff_hours) ?? 0),
      priceIqd: int(f.price_iqd),
    });
  }
  return {
    off: bool(o.off),
    coach:
      c && coachId
        ? {
            id: coachId,
            displayNameEn: text(c.display_name_en),
            displayNameAr: text(c.display_name_ar),
            bioEn: text(c.bio_en),
            bioAr: text(c.bio_ar),
            photoPath: str(c.photo_path),
            // An unknown status reads as paused: never a grid by accident.
            status: oneOf(COACH_STATUSES, c.status) ?? 'paused',
            venueIds: strings(c.venue_ids),
          }
        : null,
    venue:
      v && venueId
        ? {
            venueId,
            nameEn: text(v.name_en),
            nameAr: text(v.name_ar),
            timezone: str(v.timezone) ?? DEFAULT_TZ,
            phone: str(v.phone),
            paymentMode: modeOf(v.payment_mode),
            pricesPublic: bool(v.prices_public),
            cancellationWindowHours: int(v.cancellation_window_hours),
          }
        : null,
    offers,
    sessions: parseSessions(o.sessions),
    serverNow: str(o.server_now),
  };
}

// ── app.coach_slots (X3) ────────────────────────────────────────────────────

export interface LessonStart {
  startAt: string;
  endAt: string;
}

export interface CoachSlots {
  off: boolean;
  venueId: string | null;
  lessonTypeId: string | null;
  durationMin: number;
  /** False for a paused coach (R51): no starts, and the screen says why. */
  bookable: boolean;
  starts: LessonStart[];
}

export function parseCoachSlots(json: unknown): CoachSlots {
  const o = obj(json);
  const starts: LessonStart[] = [];
  for (const raw of arr(o.starts)) {
    const s = obj(raw);
    const startAt = str(s.start_at);
    if (!startAt || !Number.isFinite(Date.parse(startAt))) continue;
    starts.push({ startAt, endAt: str(s.end_at) ?? startAt });
  }
  return {
    off: bool(o.off),
    venueId: str(o.venue_id),
    lessonTypeId: str(o.lesson_type_id),
    durationMin: Math.max(0, int(o.duration_min) ?? 0),
    bookable: bool(o.bookable),
    starts,
  };
}

// ── app.lesson_offer (X4) ───────────────────────────────────────────────────

export interface CoachCard {
  id: string;
  displayNameEn: string;
  displayNameAr: string;
  photoPath: string | null;
}

function parseCoachCard(v: unknown): CoachCard | null {
  const c = objOrNull(v);
  const id = c ? str(c.id) : null;
  if (!c || !id) return null;
  return {
    id,
    displayNameEn: text(c.display_name_en),
    displayNameAr: text(c.display_name_ar),
    photoPath: str(c.photo_path),
  };
}

export interface OfferSession {
  lessonId: string;
  sessionNo: number;
  startAt: string;
  endAt: string;
  status: 'scheduled' | 'completed' | 'cancelled' | null;
  started: boolean;
}

export interface LessonOffer {
  /**
   * `{off: true}`: coaching is off at the offer's branch (0283, 0294); the
   * rest of the answer is empty, and the class screen shows the off notice
   * instead of a closed offer (MB-12).
   */
  off: boolean;
  kind: ClassLessonKind;
  lessonId: string | null;
  courseId: string | null;
  venueId: string | null;
  timezone: string;
  phone: string | null;
  coach: CoachCard | null;
  type: {
    id: string;
    nameEn: string;
    nameAr: string;
    descriptionEn: string;
    descriptionAr: string;
    durationMin: number;
  } | null;
  titleEn: string;
  titleAr: string;
  startAt: string | null;
  endAt: string | null;
  /** A course's sessions; empty for a group session. */
  sessions: OfferSession[];
  /** The server's; an unknown status reads as closed (no Join on a guess). */
  status: OfferStatus;
  placesLeft: number;
  maxPlaces: number;
  minPlaces: number;
  placesTaken: number;
  cutoffAt: string | null;
  signupClosesAt: string | null;
  /** The caller's price: a place, the course, or its late-join share (never computed here). */
  priceIqd: number | null;
  fullPriceIqd: number | null;
  lateJoin: { sessionsLeft: number; sessionsCount: number } | null;
  paymentMode: LessonPaymentMode;
  cancellationWindowHours: number | null;
  /** The caller's own live place; confirmNeeded: a coach- or desk-added place still to confirm (C-21, 0294 DB-33). */
  mine: { enrolmentId: string; status: 'held' | 'booked'; confirmNeeded: boolean } | null;
  serverNow: string | null;
}

export function parseLessonOffer(json: unknown): LessonOffer {
  const o = obj(json);
  const lessonId = str(o.lesson_id);
  const courseId = str(o.course_id);
  const t = objOrNull(o.type);
  const typeId = t ? str(t.id) : null;
  const late = objOrNull(o.late_join);
  const mine = objOrNull(o.mine);
  const mineId = mine ? str(mine.enrolment_id) : null;
  const sessions: OfferSession[] = [];
  for (const raw of arr(o.sessions)) {
    const s = obj(raw);
    const id = str(s.lesson_id);
    const startAt = str(s.start_at);
    if (!id || !startAt) continue;
    sessions.push({
      lessonId: id,
      sessionNo: int(s.session_no) ?? sessions.length + 1,
      startAt,
      endAt: str(s.end_at) ?? startAt,
      status: oneOf(['scheduled', 'completed', 'cancelled'] as const, s.status),
      started: bool(s.started),
    });
  }
  return {
    off: bool(o.off),
    kind: oneOf(['group', 'course'] as const, o.kind) ?? (courseId ? 'course' : 'group'),
    lessonId,
    courseId,
    venueId: str(o.venue_id),
    timezone: str(o.timezone) ?? DEFAULT_TZ,
    phone: str(o.phone),
    coach: parseCoachCard(o.coach),
    type:
      t && typeId
        ? {
            id: typeId,
            nameEn: text(t.name_en),
            nameAr: text(t.name_ar),
            descriptionEn: text(t.description_en),
            descriptionAr: text(t.description_ar),
            durationMin: Math.max(0, int(t.duration_min) ?? 0),
          }
        : null,
    titleEn: text(o.title_en),
    titleAr: text(o.title_ar),
    startAt: str(o.start_at),
    endAt: str(o.end_at),
    sessions,
    status: oneOf(OFFER_STATUSES, o.status) ?? 'closed',
    placesLeft: Math.max(0, int(o.places_left) ?? 0),
    maxPlaces: Math.max(0, int(o.max_places) ?? 0),
    minPlaces: Math.max(0, int(o.min_places) ?? 0),
    placesTaken: Math.max(0, int(o.places_taken) ?? 0),
    cutoffAt: str(o.cutoff_at),
    signupClosesAt: str(o.signup_closes_at),
    priceIqd: int(o.price_iqd),
    fullPriceIqd: int(o.full_price_iqd),
    lateJoin: late
      ? {
          sessionsLeft: Math.max(0, int(late.sessions_left) ?? 0),
          sessionsCount: Math.max(0, int(late.sessions_count) ?? 0),
        }
      : null,
    paymentMode: modeOf(o.payment_mode),
    cancellationWindowHours: int(o.cancellation_window_hours),
    mine:
      mine && mineId
        ? {
            enrolmentId: mineId,
            status: mine.status === 'held' ? 'held' : 'booked',
            confirmNeeded: mine.confirm_needed === true,
          }
        : null,
    serverNow: str(o.server_now),
  };
}

// ── Guest write results (X5, X6) ────────────────────────────────────────────

export interface LessonWrite {
  enrolmentId: string;
  lessonId: string | null;
  courseId: string | null;
  /**
   * The ENROLMENT's: `booked` for the desk, `held` for Qi (never the lesson's
   * `scheduled`). A replay of a spent key answers the enrolment as it is now,
   * `cancelled` or `expired` included (MB-10: never read as "Booked").
   */
  status: EnrolmentStatus;
  holdExpiresAt: string | null;
  paymentMode: PaymentChoice;
  priceIqd: number | null;
  duplicate: boolean;
  /** `lesson_book_private` only. */
  startAt: string | null;
  endAt: string | null;
  courtNameEn: string | null;
  courtNameAr: string | null;
  venueId: string | null;
  /** `lesson_join` and `course_join` only. */
  placesLeft: number | null;
}

export type LessonWriteRpc = 'lesson_book_private' | 'lesson_join' | 'course_join';

/**
 * A booking or joining answer, read by the keys of ITS shape (each RPC answers
 * a different set). Throws without an enrolment: there is nothing to open.
 */
export function parseLessonWrite(json: unknown, rpc: LessonWriteRpc): LessonWrite {
  const o = obj(json);
  const enrolmentId = str(o.enrolment_id);
  if (!enrolmentId) throw new Error('MALFORMED_LESSON_WRITE');
  const common = {
    enrolmentId,
    status: oneOf(ENROLMENT_STATUSES, o.status) ?? ('booked' as const),
    holdExpiresAt: str(o.hold_expires_at),
    paymentMode: oneOf(ENROLMENT_PAYMENT_MODES, o.payment_mode) ?? 'desk',
    priceIqd: int(o.price_iqd),
    duplicate: bool(o.duplicate),
  };
  if (rpc === 'lesson_book_private') {
    return {
      ...common,
      lessonId: str(o.lesson_id),
      courseId: null,
      startAt: str(o.start_at),
      endAt: str(o.end_at),
      courtNameEn: str(o.court_name_en),
      courtNameAr: str(o.court_name_ar),
      venueId: str(o.venue_id),
      placesLeft: null,
    };
  }
  const placesLeft = int(o.places_left);
  return {
    ...common,
    lessonId: rpc === 'lesson_join' ? str(o.lesson_id) : null,
    courseId: rpc === 'course_join' ? str(o.course_id) : null,
    startAt: null,
    endAt: null,
    courtNameEn: null,
    courtNameAr: null,
    venueId: null,
    placesLeft,
  };
}

/**
 * A replay of a key whose enrolment has since been cancelled or has expired
 * (MB-10): the server answers `duplicate` with the dead enrolment, which is
 * not a booking.
 */
export function isSpentReplay(w: Pick<LessonWrite, 'duplicate' | 'status'>): boolean {
  return w.duplicate && (w.status === 'cancelled' || w.status === 'expired');
}

/**
 * Runs a keyed guest write, and once more with a fresh key when the first
 * answer is a spent replay (MB-10): `forget` clears the intent's key, so
 * `run` mints a new one. A second spent answer (it cannot happen with a fresh
 * key) is refused as IDEMPOTENCY_CONFLICT, never shown as "Booked".
 */
export async function writeOnceMore(
  run: () => Promise<LessonWrite>,
  forget: () => void,
): Promise<LessonWrite> {
  const first = await run();
  if (!isSpentReplay(first)) return first;
  forget();
  const second = await run();
  if (isSpentReplay(second)) throw new Error('IDEMPOTENCY_CONFLICT');
  return second;
}

export interface CancelResult {
  enrolmentId: string | null;
  status: EnrolmentStatus | null;
  cancelKind: CancelKind | null;
  refundsStarted: number;
  strike: boolean;
  refundIqd: number;
  keptIqd: number;
  duplicate: boolean;
}

export function parseCancelResult(json: unknown): CancelResult {
  const o = obj(json);
  return {
    enrolmentId: str(o.enrolment_id),
    status: oneOf(ENROLMENT_STATUSES, o.status),
    cancelKind: oneOf(CANCEL_KINDS, o.cancel_kind),
    refundsStarted: Math.max(0, int(o.refunds_started) ?? 0),
    strike: bool(o.strike),
    refundIqd: Math.max(0, int(o.refund_iqd) ?? 0),
    keptIqd: Math.max(0, int(o.kept_iqd) ?? 0),
    duplicate: bool(o.duplicate),
  };
}

/** `lesson_link_confirm` (R44): `{enrolment_id, linked, duplicate}`. */
export interface LinkConfirmResult {
  enrolmentId: string | null;
  linked: boolean;
  duplicate: boolean;
}

export function parseLinkConfirm(json: unknown): LinkConfirmResult {
  const o = obj(json);
  return { enrolmentId: str(o.enrolment_id), linked: bool(o.linked), duplicate: bool(o.duplicate) };
}

// ── app.my_lessons / app.my_lesson (X7, X8) ─────────────────────────────────

export interface MyLessonRow {
  enrolmentId: string;
  kind: LessonKind | null;
  lessonId: string | null;
  courseId: string | null;
  venueId: string | null;
  coach: CoachCard | null;
  typeNameEn: string;
  typeNameAr: string;
  titleEn: string;
  titleAr: string;
  /** The next session (upcoming) or the last one (past). */
  startAt: string;
  endAt: string;
  sessionNo: number | null;
  sessionsCount: number | null;
  firstSessionNo: number | null;
  sessionsCovered: number | null;
  status: EnrolmentStatus | null;
  cancelKind: CancelKind | null;
  lessonStatus: LessonStatus | null;
  attendance: Attendance | null;
  bookedBy: BookedBy;
  /** C-21: linked by a typed phone, not yet confirmed. */
  confirmNeeded: boolean;
  /** R8: moved after this enrolment was made. */
  rescheduled: boolean;
  partySize: number;
  paymentMode: PaymentChoice;
  priceIqd: number | null;
  paidOnlineIqd: number;
  owedIqd: number;
  refund: { status: RefundStatus | null; amountIqd: number } | null;
  placesTaken: number;
  minPlaces: number;
  cutoffAt: string | null;
  pendingPayment: { requestId: string; deadlineAt: string | null } | null;
  holdExpiresAt: string | null;
}

function parseRow(o: Json): MyLessonRow | null {
  const enrolmentId = str(o.enrolment_id);
  const startAt = str(o.start_at);
  if (!enrolmentId || !startAt) return null;
  const refund = objOrNull(o.refund);
  const pending = objOrNull(o.pending_payment);
  const requestId = pending ? str(pending.request_id) : null;
  return {
    enrolmentId,
    kind: oneOf(LESSON_KINDS, o.kind),
    lessonId: str(o.lesson_id),
    courseId: str(o.course_id),
    venueId: str(o.venue_id),
    coach: parseCoachCard(o.coach),
    typeNameEn: text(o.type_name_en),
    typeNameAr: text(o.type_name_ar),
    titleEn: text(o.title_en),
    titleAr: text(o.title_ar),
    startAt,
    endAt: str(o.end_at) ?? startAt,
    sessionNo: int(o.session_no),
    sessionsCount: int(o.sessions_count),
    firstSessionNo: int(o.first_session_no),
    sessionsCovered: int(o.sessions_covered),
    status: oneOf(ENROLMENT_STATUSES, o.status),
    cancelKind: oneOf(CANCEL_KINDS, o.cancel_kind),
    lessonStatus: oneOf(LESSON_STATUSES, o.lesson_status),
    attendance: oneOf(ATTENDANCE, o.attendance),
    // An unknown booker is the guest themself: the strictest reading of a cancel.
    bookedBy: oneOf(BOOKED_BY, o.booked_by) ?? 'guest',
    confirmNeeded: bool(o.confirm_needed),
    rescheduled: bool(o.rescheduled),
    partySize: Math.max(1, int(o.party_size) ?? 1),
    paymentMode: oneOf(ENROLMENT_PAYMENT_MODES, o.payment_mode) ?? 'desk',
    priceIqd: int(o.price_iqd),
    paidOnlineIqd: Math.max(0, int(o.paid_online_iqd) ?? 0),
    owedIqd: Math.max(0, int(o.owed_iqd) ?? 0),
    refund: refund
      ? {
          status: oneOf(REFUND_STATUSES, refund.status),
          amountIqd: Math.max(0, int(refund.amount_iqd) ?? 0),
        }
      : null,
    placesTaken: Math.max(0, int(o.places_taken) ?? 0),
    minPlaces: Math.max(0, int(o.min_places) ?? 0),
    cutoffAt: str(o.cutoff_at),
    pendingPayment:
      pending && requestId ? { requestId, deadlineAt: str(pending.deadline_at) } : null,
    holdExpiresAt: str(o.hold_expires_at),
  };
}

export function parseMyLessons(json: unknown): MyLessonRow[] {
  const out: MyLessonRow[] = [];
  for (const raw of arr(json)) {
    const row = parseRow(obj(raw));
    if (row) out.push(row);
  }
  return out;
}

export interface MyLessonSession {
  lessonId: string;
  sessionNo: number;
  startAt: string;
  endAt: string;
  status: LessonStatus | null;
  rescheduled: boolean;
  attendance: Attendance | null;
}

/** The server's answer for a cancel now (C-9, CD-2, R8, R62), computed as if the cancel ran. */
export interface CancelPreview {
  policy: CancelPolicy;
  freeUntil: string | null;
  freeBecause: 'rescheduled' | null;
  refundIqd: number;
  keptIqd: number;
  countsLate: boolean;
  refundSessions: number | null;
  keptSessions: number | null;
  nextStartAt: string | null;
}

export interface MyLesson extends MyLessonRow {
  friendNames: string[];
  courtNameEn: string | null;
  courtNameAr: string | null;
  sessions: MyLessonSession[];
  cancel: CancelPreview;
  can: { cancel: boolean; pay: boolean; confirm: boolean };
  branchPhone: string | null;
  timezone: string;
  serverNow: string | null;
}

export function parseMyLesson(json: unknown): MyLesson {
  const o = obj(json);
  const row = parseRow(o);
  if (!row) throw new Error('MALFORMED_MY_LESSON');
  const c = obj(o.cancel);
  const can = obj(o.can);
  const sessions: MyLessonSession[] = [];
  for (const raw of arr(o.sessions)) {
    const s = obj(raw);
    const lessonId = str(s.lesson_id);
    const startAt = str(s.start_at);
    if (!lessonId || !startAt) continue;
    sessions.push({
      lessonId,
      sessionNo: int(s.session_no) ?? sessions.length + 1,
      startAt,
      endAt: str(s.end_at) ?? startAt,
      status: oneOf(LESSON_STATUSES, s.status),
      rescheduled: bool(s.rescheduled),
      attendance: oneOf(ATTENDANCE, s.attendance),
    });
  }
  const confirm = bool(can.confirm);
  return {
    ...row,
    friendNames: strings(o.friend_names),
    courtNameEn: str(o.court_name_en),
    courtNameAr: str(o.court_name_ar),
    sessions,
    cancel: {
      // Unknown reads as `none`: the phone never offers a cancel it cannot word.
      policy: oneOf(CANCEL_POLICIES, c.policy) ?? 'none',
      freeUntil: str(c.free_until),
      freeBecause: c.free_because === 'rescheduled' ? 'rescheduled' : null,
      refundIqd: Math.max(0, int(c.refund_iqd) ?? 0),
      keptIqd: Math.max(0, int(c.kept_iqd) ?? 0),
      countsLate: bool(c.counts_late),
      refundSessions: int(c.refund_sessions),
      keptSessions: int(c.kept_sessions),
      nextStartAt: str(c.next_start_at),
    },
    // While a link waits for "Is this you?" nothing else is offered (§4.3).
    can: { cancel: !confirm && bool(can.cancel), pay: !confirm && bool(can.pay), confirm },
    branchPhone: str(o.branch_phone),
    timezone: str(o.timezone) ?? DEFAULT_TZ,
    serverNow: str(o.server_now),
  };
}

// ── The edge `lesson-begin` (money.md §6.7) ─────────────────────────────────

export interface LessonBegin {
  /** The attempt's request_id: what `deposit-status` and the pointer follow. */
  ref: string;
  formUrl: string;
  amountIqd: number | null;
  deadlineAt: string | null;
  status: string | null;
  /** A live attempt answered again (a double tap, "Finish payment" again). */
  reused: boolean;
  enrolmentId: string | null;
}

export function parseLessonBegin(json: unknown): LessonBegin {
  const o = obj(json);
  const ref = str(o.request_id);
  const formUrl = str(o.form_url);
  if (!ref || !formUrl) throw new Error('MALFORMED_LESSON_BEGIN');
  return {
    ref,
    formUrl,
    amountIqd: int(o.amount_iqd),
    deadlineAt: str(o.deadline_at),
    status: str(o.status),
    reused: bool(o.reused),
    enrolmentId: str(o.enrolment_id),
  };
}

// ── Gating (guest.md §4.7.5) ────────────────────────────────────────────────

/** The three branch knobs the phone reads from `venue_settings_public` (0277). */
export interface CoachingBranchSettings {
  coaching_enabled?: boolean | null;
  lesson_payment_mode?: string | null;
  lesson_prices_public?: boolean | null;
}

/** The branch has coaching switched on (rule 7: off means no guest work at all). */
export function coachingEnabled(settings: CoachingBranchSettings | null | undefined): boolean {
  return settings?.coaching_enabled === true;
}

/** Some open branch has coaching on: Bookings reads `my_lessons`, Profile shows "My lessons". */
export function anyCoaching(
  branches: readonly { coaching_enabled?: boolean | null }[] | null | undefined,
): boolean {
  return (branches ?? []).some((b) => b.coaching_enabled === true);
}

// ── Payment choice (guest.md §4.9.1 step 3) ─────────────────────────────────

/** What a branch's mode offers: the desk, both, or Qi only. */
export function paymentChoices(mode: LessonPaymentMode): PaymentChoice[] {
  switch (mode) {
    case 'online_optional':
      return ['desk', 'online'];
    case 'online_required':
      return ['online'];
    default:
      return ['desk'];
  }
}

/** The choice a form starts on: the desk unless the branch requires Qi. */
export function defaultPaymentChoice(mode: LessonPaymentMode): PaymentChoice {
  return mode === 'online_required' ? 'online' : 'desk';
}

/** A choice the branch no longer offers (the mode changed under the form) falls back to its default. */
export function effectiveChoice(mode: LessonPaymentMode, picked: PaymentChoice): PaymentChoice {
  return paymentChoices(mode).includes(picked) ? picked : defaultPaymentChoice(mode);
}

// ── Intents (guest.md §4.7.4) ───────────────────────────────────────────────

export function privateIntent(args: {
  coachId: string;
  lessonTypeId: string;
  startAt: string;
  partySize: number;
  mode: PaymentChoice;
}): string {
  return `private:${args.coachId}|${args.lessonTypeId}|${args.startAt}|${args.partySize}|${args.mode}`;
}

export function joinIntent(lessonId: string, mode: PaymentChoice): string {
  return `join:${lessonId}|${mode}`;
}

export function courseJoinIntent(courseId: string, mode: PaymentChoice): string {
  return `course:${courseId}|${mode}`;
}

/** Friends' names as the server takes them: trimmed, empty ones dropped, at most `party − 1`, each ≤ 40. */
export function friendNamesFor(names: readonly string[], partySize: number): string[] {
  return names
    .slice(0, Math.max(0, partySize - 1))
    .map((n) => n.trim().slice(0, 40))
    .filter((n) => n.length > 0);
}

// ── The private grid (guest.md §4.8.3) ──────────────────────────────────────

/**
 * The `coach_slots` window: from the start of the strip's first night,
 * venue-local, to exactly 14 days on. The strings change once a day, so a
 * query keyed on them stays stable.
 */
export function lessonWindow(
  now: Date,
  tz: string,
  firstDate?: string | null,
): { from: string; to: string } {
  const date = firstDate ?? localParts(now, tz).date;
  const start = wallTimeToUtc(date, 0, tz);
  const end = new Date(start.getTime() + SLOT_WINDOW_DAYS * 86_400_000);
  return { from: start.toISOString(), to: end.toISOString() };
}

type NightSettings = { timezone?: string | null; opening_hours?: unknown };

const NIGHT_DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * When trading night `date` ends: the end of the next calendar day's overnight
 * tail (a 16:00–02:00 branch: 02:00 the next day), else the midnight after it.
 */
export function nightEndsAt(date: string, tz: string, openingHours: unknown): Date {
  const next = addDays(date, 1);
  const key = NIGHT_DAY_KEYS[dayOfWeekOfDate(next)];
  const hours = openingHours as OpeningHours | null | undefined;
  const tail = key ? (hours?.[key] ?? []).find(isOvernightTail) : undefined;
  return wallTimeToUtc(next, tail ? parseHHMM(tail[1]) : 0, tz);
}

/**
 * The strip's nights whose WHOLE trading night fits the `coach_slots` window
 * (MB-16): with an overnight tail the last night would end past the window's
 * 14 days and show its evening without its post-midnight starts, so it is
 * dropped instead of shown cut short.
 */
export function nightsInWindow(
  strip: readonly string[],
  windowTo: string,
  tz: string,
  openingHours: unknown,
): string[] {
  const end = Date.parse(windowTo);
  return strip.filter((d) => nightEndsAt(d, tz, openingHours).getTime() <= end);
}

/** The starts grouped by trading night ('YYYY-MM-DD'): a 00:30 start is the night before's. */
export function slotsByNight(
  starts: readonly LessonStart[],
  settings: NightSettings,
): Map<string, LessonStart[]> {
  const out = new Map<string, LessonStart[]>();
  for (const s of starts) {
    const night = tradingNightOf(s.startAt, settings);
    const list = out.get(night);
    if (list) list.push(s);
    else out.set(night, [s]);
  }
  return out;
}

/**
 * One night's cells: one free `MergedCell` per start not yet begun, in time
 * order. The server already crossed the coach's hours with the courts, so
 * every start it sent is bookable; there is nothing to grey out. `courtId` is
 * null (a lesson takes any free court, C-10).
 */
export function lessonCells(
  starts: readonly LessonStart[],
  night: string,
  settings: NightSettings,
  now: Date,
  priceIqd: number | null,
): MergedCell[] {
  const nowMs = now.getTime();
  return starts
    .filter((s) => tradingNightOf(s.startAt, settings) === night && Date.parse(s.startAt) > nowMs)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .map((s) => ({
      startAt: new Date(s.startAt),
      state: 'free' as const,
      freeCount: 1,
      capacity: 1,
      priceIqd,
      courtId: null,
    }));
}

// ── Display helpers ─────────────────────────────────────────────────────────

export function displayCoachName(
  coach: { displayNameEn: string; displayNameAr: string } | null | undefined,
  locale: Locale,
): string {
  if (!coach) return '';
  return pickLocale({ en: coach.displayNameEn || null, ar: coach.displayNameAr || null }, locale);
}

/** A bilingual pair in the guest's language, falling back to the other one. */
export function pick(
  en: string | null | undefined,
  ar: string | null | undefined,
  locale: Locale,
): string {
  return pickLocale({ en: en || null, ar: ar || null }, locale);
}

/** A course's title, else its lesson type's name (`my_lessons`, `lesson_offer`). */
export function lessonTitle(
  row: { titleEn: string; titleAr: string; typeNameEn?: string; typeNameAr?: string },
  locale: Locale,
): string {
  return pick(row.titleEn, row.titleAr, locale) || pick(row.typeNameEn, row.typeNameAr, locale);
}

/** `coaches/<uuid>/<file>` in `menu-media`: a fresh random folder, never a profile or coach id (R43). */
export const COACH_PHOTO_RE = /^coaches\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,80}$/;

/**
 * The public URL of a coach's photo, or null for anything but a
 * `coaches/<uuid>/<file>` path (R43): a path from anywhere else in the bucket
 * is never rendered.
 */
export function coachPhotoUrl(
  path: string | null | undefined,
  base: string | null | undefined = process.env.EXPO_PUBLIC_SUPABASE_URL,
): string | null {
  if (typeof path !== 'string' || !COACH_PHOTO_RE.test(path) || path.includes('..')) return null;
  if (typeof base !== 'string' || !/^https?:\/\//.test(base)) return null;
  return `${base.replace(/\/+$/, '')}/storage/v1/object/public/menu-media/${path}`;
}

/** The first letter of a coach's name for the photo-less avatar ('' when none). */
export function coachInitial(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toLocaleUpperCase() : '';
}

/** The kinds a coach teaches at a branch, in the fixed order private, group, course. */
export function kindsTaught(
  coach: Pick<PublicCoach, 'offers'>,
  types: readonly PublicLessonType[],
  venueId: string,
): LessonKind[] {
  const kinds = new Set<LessonKind>();
  for (const offer of coach.offers) {
    if (offer.venueId !== venueId) continue;
    const type = types.find((t) => t.id === offer.lessonTypeId);
    if (type?.kind) kinds.add(type.kind);
  }
  return LESSON_KINDS.filter((k) => kinds.has(k));
}

/** The lowest price a coach is offered at a branch ("From {price}"), or null. */
export function lowestOfferPrice(
  coach: Pick<PublicCoach, 'offers'>,
  venueId: string,
): number | null {
  let low: number | null = null;
  for (const offer of coach.offers) {
    if (offer.venueId !== venueId || offer.priceIqd === null) continue;
    if (low === null || offer.priceIqd < low) low = offer.priceIqd;
  }
  return low;
}

/** The coaches teaching at a branch, in the venue's order. */
export function coachesAt(pub: Pick<CoachingPublic, 'coaches'>, venueId: string): PublicCoach[] {
  return pub.coaches
    .filter((c) => c.venueIds.includes(venueId) || c.offers.some((o) => o.venueId === venueId))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export type ClassFilter = 'all' | 'group' | 'course';

/** One `classes` row: a session with its coach and type joined in. */
export interface ClassRowData {
  session: SessionListing;
  coach: PublicCoach | null;
  type: PublicLessonType | null;
}

/** The branch's group sessions and courses with places, soonest first, filtered. */
export function classRows(
  pub: Pick<CoachingPublic, 'coaches' | 'lessonTypes' | 'sessions'>,
  venueId: string,
  filter: ClassFilter,
): ClassRowData[] {
  return pub.sessions
    .filter((s) => s.venueId === venueId && s.placesLeft > 0)
    .filter((s) => filter === 'all' || s.kind === filter)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .map((session) => ({
      session,
      coach: pub.coaches.find((c) => c.id === session.coachId) ?? null,
      type: pub.lessonTypes.find((t) => t.id === session.lessonTypeId) ?? null,
    }));
}

/** The id a class row opens, and its kind in `class/[id]?kind=`. */
export function classTarget(s: Pick<SessionListing, 'kind' | 'lessonId' | 'courseId'>): {
  id: string;
  kind: 'session' | 'course';
} | null {
  const id = s.kind === 'course' ? s.courseId : s.lessonId;
  return id ? { id, kind: s.kind === 'course' ? 'course' : 'session' } : null;
}

/**
 * The branch a coach screen reads (§4.8.3): the param, else the guest's when
 * the coach teaches there, else the coach's first. For this screen only: it
 * never writes the stored branch.
 */
export function coachBranch(
  param: string | null | undefined,
  guestVenueId: string | null,
  coachVenueIds: readonly string[],
): string | null {
  if (param) return param;
  if (guestVenueId && coachVenueIds.includes(guestVenueId)) return guestVenueId;
  return coachVenueIds[0] ?? guestVenueId ?? null;
}

/** A held enrolment whose payment window is still open. */
export function holdLive(
  row: Pick<MyLessonRow, 'status' | 'holdExpiresAt'>,
  nowMs: number,
): boolean {
  if (row.status !== 'held') return false;
  const at = row.holdExpiresAt ? Date.parse(row.holdExpiresAt) : NaN;
  return Number.isFinite(at) && at > nowMs;
}
