import { countPhrase, formatIQD, makeT, type Locale } from '@touch/i18n';
import { publicMediaUrl } from './media';
import { inviteWhen } from './site/matchInvite';
import { parseCoachId } from './site/coachLink';

/**
 * The pure half of the website's coaching pages (docs/design/coaching/guest.md §4.14.1): the
 * `/{locale}/coaching` page, the `/{locale}/c/<id>` "Open in the app" page and the landing's
 * coaches strip all read `app.coaching_public` through `parseCoachingPublic`.
 *
 * - **Only the read contract's fields** (`COACHING_SHAPES.coaching_public` in
 *   `@touch/core/coaching`, R41): each row is copied field by field, so a key the server ever
 *   adds cannot reach the markup by accident. `coaching.test.ts` holds every row's keys equal to
 *   the shapes list.
 * - **Prices behind the switch** (C-11): `offers[].price_iqd` and `lesson_types[].price_iqd` are
 *   sent whatever `prices_public` says (presentation, not secrecy). This parser sets every price
 *   of a branch whose `prices_public` is false to null, so no component can print one.
 * - **Only public coaches**: the server sends only active coaches who accepted the public profile
 *   (C-22, R61); paused (R76), retired (R63) and not-yet-accepted coaches, and their sessions,
 *   never reach it. The parser also drops a session whose coach is not in the list.
 * - Every `id` / `coach_id` is a `coaches.id`, never a profile id (R43). A coach id that is not a
 *   uuid drops its coach (it builds the `/c/<id>` link).
 *
 * Every enum is parsed with a fallback (an unknown kind drops its row), every missing field
 * falls back, nothing throws. Null only for an answer that is not an object at all.
 */

export type LessonKind = 'private' | 'group' | 'course';
export type SessionKind = 'group' | 'course';
export type LessonPaymentMode = 'desk' | 'online_optional' | 'online_required';

export const LESSON_KINDS: readonly LessonKind[] = ['private', 'group', 'course'];

export interface CoachingBranch {
  venue_id: string;
  name_en: string;
  name_ar: string;
  timezone: string;
  payment_mode: LessonPaymentMode;
  prices_public: boolean;
  cancellation_window_hours: number;
}

export interface CoachOffer {
  lesson_type_id: string;
  venue_id: string;
  /** Null when the branch hides its prices (C-11) or the type has none yet. */
  price_iqd: number | null;
}

export interface PublicCoach {
  id: string;
  display_name_en: string;
  display_name_ar: string;
  bio_en: string;
  bio_ar: string;
  photo_path: string | null;
  sort_order: number;
  venue_ids: string[];
  offers: CoachOffer[];
}

export interface PublicLessonType {
  id: string;
  venue_id: string;
  kind: LessonKind;
  name_en: string;
  name_ar: string;
  description_en: string;
  description_ar: string;
  duration_min: number;
  max_places: number;
  min_places: number;
  sessions_count: number | null;
  /** Null when the branch hides its prices (C-11). */
  price_iqd: number | null;
  sort_order: number;
}

export interface PublicSession {
  kind: SessionKind;
  lesson_id: string | null;
  course_id: string | null;
  venue_id: string;
  coach_id: string;
  lesson_type_id: string;
  title_en: string;
  title_ar: string;
  /** Group: the session. Course: its next session. */
  start_at: string;
  end_at: string;
  sessions_count: number | null;
  sessions_left: number | null;
  places_left: number;
  max_places: number;
  signup_closes_at: string | null;
  cutoff_at: string | null;
}

export interface PublicCoaching {
  /** `{off: true}`: coaching is off everywhere the read asked about; every list is empty. */
  off: boolean;
  branches: CoachingBranch[];
  coaches: PublicCoach[];
  lesson_types: PublicLessonType[];
  sessions: PublicSession[];
  server_now: string | null;
}

/** What a page renders: some coaches, none, coaching switched off, or a failed read. */
export type CoachingStatus = 'ok' | 'empty' | 'off' | 'error';

export interface CoachingRead {
  status: CoachingStatus;
  /** Set for `ok` and `empty`; null for `off` and `error`. */
  coaching: PublicCoaching | null;
}

// ---------------------------------------------------------------------------------------------
// Parsing

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const rows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const id = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

/** A whole, non-negative number, else null. */
const whole = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

/** A price the page could print: a whole number of IQD above zero. */
const price = (value: unknown): number | null => {
  const n = whole(value);
  return n !== null && n > 0 ? n : null;
};

const instant = (value: unknown): string | null =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;

const PAYMENT_MODES: readonly string[] = ['desk', 'online_optional', 'online_required'];

function parseBranch(row: Record<string, unknown>): CoachingBranch | null {
  const venueId = id(row.venue_id);
  if (!venueId) return null;
  return {
    venue_id: venueId,
    name_en: text(row.name_en),
    name_ar: text(row.name_ar),
    timezone: text(row.timezone),
    payment_mode: PAYMENT_MODES.includes(text(row.payment_mode))
      ? (row.payment_mode as LessonPaymentMode)
      : 'desk',
    // Anything but an explicit true hides the prices (the switch defaults off, C-11).
    prices_public: row.prices_public === true,
    cancellation_window_hours: whole(row.cancellation_window_hours) ?? 0,
  };
}

function parseLessonType(
  row: Record<string, unknown>,
  showsPrices: (venueId: string) => boolean,
): PublicLessonType | null {
  const typeId = id(row.id);
  const venueId = id(row.venue_id);
  const kind = text(row.kind);
  const duration = whole(row.duration_min);
  if (!typeId || !venueId || !(LESSON_KINDS as readonly string[]).includes(kind) || !duration) {
    return null;
  }
  return {
    id: typeId,
    venue_id: venueId,
    kind: kind as LessonKind,
    name_en: text(row.name_en),
    name_ar: text(row.name_ar),
    description_en: text(row.description_en),
    description_ar: text(row.description_ar),
    duration_min: duration,
    max_places: whole(row.max_places) ?? 1,
    min_places: whole(row.min_places) ?? 1,
    sessions_count: kind === 'course' ? whole(row.sessions_count) : null,
    price_iqd: showsPrices(venueId) ? price(row.price_iqd) : null,
    sort_order: whole(row.sort_order) ?? 0,
  };
}

function parseOffer(
  row: Record<string, unknown>,
  showsPrices: (venueId: string) => boolean,
): CoachOffer | null {
  const typeId = id(row.lesson_type_id);
  const venueId = id(row.venue_id);
  if (!typeId || !venueId) return null;
  return {
    lesson_type_id: typeId,
    venue_id: venueId,
    price_iqd: showsPrices(venueId) ? price(row.price_iqd) : null,
  };
}

function parseCoach(
  row: Record<string, unknown>,
  showsPrices: (venueId: string) => boolean,
): PublicCoach | null {
  const coachId = parseCoachId(text(row.id));
  if (!coachId) return null;
  const nameEn = text(row.display_name_en);
  const nameAr = text(row.display_name_ar);
  if (!nameEn && !nameAr) return null;
  return {
    id: coachId,
    display_name_en: nameEn,
    display_name_ar: nameAr,
    bio_en: text(row.bio_en),
    bio_ar: text(row.bio_ar),
    photo_path: id(row.photo_path),
    sort_order: whole(row.sort_order) ?? 0,
    venue_ids: Array.isArray(row.venue_ids)
      ? row.venue_ids.filter((v): v is string => id(v) !== null)
      : [],
    offers: rows(row.offers)
      .map((offer) => parseOffer(offer, showsPrices))
      .filter((offer): offer is CoachOffer => offer !== null),
  };
}

function parseSession(row: Record<string, unknown>): PublicSession | null {
  const kind = text(row.kind);
  const lessonId = id(row.lesson_id);
  const courseId = id(row.course_id);
  const venueId = id(row.venue_id);
  const coachId = parseCoachId(text(row.coach_id));
  const typeId = id(row.lesson_type_id);
  const startAt = instant(row.start_at);
  const placesLeft = whole(row.places_left);
  if (
    (kind !== 'group' && kind !== 'course') ||
    (kind === 'group' ? !lessonId : !courseId) ||
    !venueId ||
    !coachId ||
    !typeId ||
    !startAt ||
    !placesLeft
  ) {
    return null;
  }
  return {
    kind,
    lesson_id: lessonId,
    course_id: courseId,
    venue_id: venueId,
    coach_id: coachId,
    lesson_type_id: typeId,
    title_en: text(row.title_en),
    title_ar: text(row.title_ar),
    start_at: startAt,
    end_at: instant(row.end_at) ?? startAt,
    sessions_count: whole(row.sessions_count),
    sessions_left: whole(row.sessions_left),
    places_left: placesLeft,
    max_places: whole(row.max_places) ?? placesLeft,
    signup_closes_at: instant(row.signup_closes_at),
    cutoff_at: instant(row.cutoff_at),
  };
}

const bySortThen =
  <T extends { sort_order: number }>(name: (row: T) => string) =>
  (a: T, b: T) =>
    a.sort_order - b.sort_order || name(a).localeCompare(name(b));

/** `app.coaching_public`'s jsonb (guest.md §4.3) as the page's model; null when unreadable. */
export function parseCoachingPublic(raw: unknown): PublicCoaching | null {
  if (!isRecord(raw)) return null;
  const serverNow = instant(raw.server_now);
  if (raw.off === true) {
    return {
      off: true,
      branches: [],
      coaches: [],
      lesson_types: [],
      sessions: [],
      server_now: serverNow,
    };
  }
  const branches = rows(raw.branches)
    .map(parseBranch)
    .filter((b): b is CoachingBranch => b !== null);
  const publicPrices = new Set(branches.filter((b) => b.prices_public).map((b) => b.venue_id));
  const showsPrices = (venueId: string) => publicPrices.has(venueId);

  const coaches = rows(raw.coaches)
    .map((row) => parseCoach(row, showsPrices))
    .filter((c): c is PublicCoach => c !== null)
    .sort(bySortThen((c) => c.display_name_en));
  const coachIds = new Set(coaches.map((c) => c.id));

  const lessonTypes = rows(raw.lesson_types)
    .map((row) => parseLessonType(row, showsPrices))
    .filter((t): t is PublicLessonType => t !== null)
    .sort(bySortThen((t) => t.name_en));

  const sessions = rows(raw.sessions)
    .map(parseSession)
    .filter((s): s is PublicSession => s !== null && coachIds.has(s.coach_id))
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));

  return {
    off: false,
    branches,
    coaches,
    lesson_types: lessonTypes,
    sessions,
    server_now: serverNow,
  };
}

/** `off` while coaching is off; `empty` with it on and no public coach; `ok` otherwise. */
export function coachingStatus(coaching: PublicCoaching): CoachingStatus {
  if (coaching.off) return 'off';
  return coaching.coaches.length > 0 ? 'ok' : 'empty';
}

// ---------------------------------------------------------------------------------------------
// Joins

/** The branches that have at least one public coach, in the server's order. */
export function coachingBranches(coaching: PublicCoaching): CoachingBranch[] {
  return coaching.branches.filter((b) =>
    coaching.coaches.some((c) => c.venue_ids.includes(b.venue_id)),
  );
}

export function coachesAt(coaching: PublicCoaching, venueId: string): PublicCoach[] {
  return coaching.coaches.filter((c) => c.venue_ids.includes(venueId));
}

export function coachById(coaching: PublicCoaching, coachId: string): PublicCoach | null {
  return coaching.coaches.find((c) => c.id === coachId) ?? null;
}

export function typesAt(coaching: PublicCoaching, venueId: string): PublicLessonType[] {
  return coaching.lesson_types.filter((t) => t.venue_id === venueId);
}

export function sessionsAt(coaching: PublicCoaching, venueId: string): PublicSession[] {
  return coaching.sessions.filter((s) => s.venue_id === venueId);
}

/** A lesson type a coach teaches, with that coach's price for it (null when hidden). */
export interface CoachLessonType {
  type: PublicLessonType;
  price_iqd: number | null;
}

/**
 * The lesson types a coach teaches, at one branch or (`venueId` null) at every branch they
 * teach at, in the lesson types' order. The price is the coach's own (`offers[].price_iqd`,
 * `lesson_price_for`), which the parser has already dropped where the branch hides prices.
 */
export function coachTypes(
  coaching: PublicCoaching,
  coach: PublicCoach,
  venueId: string | null = null,
): CoachLessonType[] {
  const offers = coach.offers.filter((o) => venueId === null || o.venue_id === venueId);
  return coaching.lesson_types.flatMap((type) => {
    const offer = offers.find((o) => o.lesson_type_id === type.id && o.venue_id === type.venue_id);
    return offer ? [{ type, price_iqd: offer.price_iqd }] : [];
  });
}

/** The lowest price a coach teaches at (at one branch, or anywhere), null when none is shown. */
export function coachFromPrice(
  coaching: PublicCoaching,
  coach: PublicCoach,
  venueId: string | null = null,
): number | null {
  const prices = coachTypes(coaching, coach, venueId)
    .map((t) => t.price_iqd)
    .filter((p): p is number => p !== null);
  return prices.length > 0 ? Math.min(...prices) : null;
}

// ---------------------------------------------------------------------------------------------
// Words

/** The Arabic text on an Arabic page when there is one, else the English (never a blank). */
export function localText(locale: Locale, en: string, ar: string): string {
  return locale === 'ar' && ar.trim() !== '' ? ar : en || ar;
}

/** The coach's public name in the page's language. */
export function coachName(coach: PublicCoach, locale: Locale): string {
  return localText(locale, coach.display_name_en, coach.display_name_ar);
}

/** The coach's bio in the page's language ('' when they have none). */
export function coachBio(coach: PublicCoach, locale: Locale): string {
  return localText(locale, coach.bio_en, coach.bio_ar).trim();
}

/** The first letter of the coach's name, for the photo placeholder. */
export function coachInitial(coach: PublicCoach, locale: Locale): string {
  return Array.from(coachName(coach, locale).trim())[0]?.toLocaleUpperCase() ?? '';
}

const PHOTO_PATH = /^coaches\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,80}$/;

/**
 * The public URL of a coach's photo: `menu-media/coaches/<uuid>/<file>` only (R43), never any
 * other folder of the bucket. Null without a photo, for any other path, or without the env.
 */
export function coachPhotoUrl(path: string | null | undefined): string | null {
  if (!path || !PHOTO_PATH.test(path) || path.includes('..')) return null;
  return publicMediaUrl(path);
}

/** "60 min · up to 4 people", "90 min · 8 places", "8 sessions · 60 min each". */
export function lessonTypeLine(type: PublicLessonType, locale: Locale): string {
  const tr = makeT(locale);
  const duration = countPhrase('coaching.common.count.minutes', type.duration_min, locale);
  if (type.kind === 'private') {
    return tr('coaching.web.privateLine', {
      duration,
      people: countPhrase('coaching.common.count.people', type.max_places, locale),
    });
  }
  if (type.kind === 'group') {
    return tr('coaching.web.groupLine', {
      duration,
      places: countPhrase('coaching.common.count.places', type.max_places, locale),
    });
  }
  return tr('coaching.web.courseLine', {
    duration,
    sessions: countPhrase('coaching.common.count.sessions', type.sessions_count ?? 0, locale),
  });
}

/** "30,000 IQD a lesson" / "a place" / "for the course"; null when the price is hidden. */
export function lessonPrice(
  kind: LessonKind,
  priceIqd: number | null,
  locale: Locale,
): string | null {
  if (priceIqd === null) return null;
  const key =
    kind === 'private'
      ? 'coaching.web.pricePrivate'
      : kind === 'group'
        ? 'coaching.web.pricePlace'
        : 'coaching.web.priceCourse';
  return makeT(locale)(key, { price: formatIQD(priceIqd, locale) });
}

/**
 * When a listed session is, in the branch's own timezone: "Thu 2 Oct 2026 · 7:30 PM" for a
 * group session; "Starts 2 Oct 2026 · 8 sessions" for a course not yet started, "Next session
 * 9 Oct 2026 · 5 sessions left" for one under way (C-15). Null for a date it cannot read.
 */
export function sessionWhen(
  session: PublicSession,
  timezone: string,
  locale: Locale,
): string | null {
  const parts = inviteWhen(session.start_at, timezone, locale);
  if (!parts) return null;
  const tr = makeT(locale);
  if (session.kind === 'group') return tr('coaching.web.when', parts);
  const count = session.sessions_count;
  const left = session.sessions_left;
  if (count !== null && left !== null && left < count) {
    return tr('coaching.web.courseNext', {
      date: parts.date,
      sessionsLeft: countPhrase('coaching.common.count.sessionsLeft', left, locale),
    });
  }
  return tr('coaching.web.courseStarts', {
    date: parts.date,
    sessions: countPhrase('coaching.common.count.sessions', count ?? left ?? 0, locale),
  });
}

/**
 * The price shown on a listed session: a group session's place, or a course's whole price
 * before it starts. A course under way is priced by the app (the late-join share, C-15), so it
 * shows none. Null when hidden.
 */
export function sessionPrice(
  session: PublicSession,
  type: PublicLessonType | null,
  locale: Locale,
): string | null {
  if (!type) return null;
  const started =
    session.kind === 'course' &&
    session.sessions_count !== null &&
    session.sessions_left !== null &&
    session.sessions_left < session.sessions_count;
  return started ? null : lessonPrice(session.kind, type.price_iqd, locale);
}

/** A session's name: its own title when it has one, else its lesson type's name. */
export function sessionTitle(
  session: PublicSession,
  type: PublicLessonType | null,
  locale: Locale,
): string {
  const own = localText(locale, session.title_en, session.title_ar).trim();
  if (own) return own;
  return type ? localText(locale, type.name_en, type.name_ar) : '';
}
