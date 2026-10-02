/**
 * Coach mode's pure pieces (docs/design/coaching/guest.md §4.7.2, §4.13): the
 * parsers of every coach read, and the small rules the screens check before a
 * call. PURE (vitest, plain node): no react-native, no expo, no supabase.
 *
 * THE PHONE COMPUTES NO MONEY, NO PERMISSION AND NO REFUSAL (guest.md §4.0
 * rule 4). It renders `can.*`, the statements' figures and the server's
 * refusals. The checks below only stop a form from sending what the server
 * would refuse anyway (an off-grid start, a window that ends before it
 * starts); the server's answer stays authoritative.
 *
 * Every parser reads the keys of `@touch/core`'s COACHING_SHAPES (R41, R81)
 * and parses every enum defensively: an unknown value falls back, a missing
 * field reads as its empty value, nothing throws (the `parseDepositStatus`
 * pattern).
 */
import {
  addDays,
  ceilToLessonGrid,
  isOnLessonGrid,
  localParts,
  parseHHMM,
  wallTimeToUtc,
  weeklyLessonStarts,
} from '@touch/core';

// ── Small readers ───────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const int = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
const intOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null;
const bool = (v: unknown): boolean => v === true;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T =>
  typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : fallback;

/** Picks the Arabic or English variant of a `_en` / `_ar` pair, falling back to the other. */
export function pickName(en: string, ar: string, locale: 'en' | 'ar'): string {
  return locale === 'ar' ? ar || en : en || ar;
}

// ── Enums ───────────────────────────────────────────────────────────────────

export const LESSON_KINDS = ['private', 'group', 'course'] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export const LESSON_STATUSES = ['held', 'scheduled', 'completed', 'cancelled', 'expired'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

export const ROSTER_STATUSES = ['held', 'booked'] as const;
export type RosterStatus = (typeof ROSTER_STATUSES)[number];

export const BOOKED_BY = ['guest', 'coach', 'staff'] as const;
export type BookedBy = (typeof BOOKED_BY)[number];

export const ATTENDANCE = ['attended', 'no_show'] as const;
export type Attendance = (typeof ATTENDANCE)[number];

/** What `coach_mark_attendance` takes: a mark, or `clear` to remove it (CD-11). */
export type AttendanceMark = Attendance | 'clear';

/** §1.3: the desk and coach cancel reasons the server accepts. */
export const CANCEL_REASON_CODES = [
  'customer_request',
  'coach_unavailable',
  'court_needed',
  'staff_error',
  'duplicate',
  'other',
] as const;
export type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number];

/** The reasons a coach picks from (guest.md §4.13.4): removing a student, cancelling a lesson. */
export const REMOVE_REASONS = [
  'customer_request',
  'duplicate',
  'other',
] as const satisfies readonly CancelReasonCode[];
export const CANCEL_REASONS = [
  'coach_unavailable',
  'customer_request',
  'other',
] as const satisfies readonly CancelReasonCode[];

/** The note a reason may carry (db.md §4.7.1 rule 10). */
export const REASON_NOTE_MAX = 200;

// ── coach_me (X9, R45, R56, R61) ────────────────────────────────────────────

export interface CoachBranch {
  venueId: string;
  nameEn: string;
  nameAr: string;
  timezone: string;
  coachingEnabled: boolean;
  /** R56: upcoming coach-booked private lessons at this branch (0282 `open_private`). */
  openPrivate: number;
  /** R56: this branch's `coach_max_open_private` (0282 `open_private_cap`, default 10). */
  openPrivateCap: number;
}

export interface CoachLessonType {
  id: string;
  venueId: string;
  kind: LessonKind;
  nameEn: string;
  nameAr: string;
  durationMin: number;
  maxPlaces: number;
  minPlaces: number;
  sessionsCount: number | null;
  cutoffHours: number;
  priceIqd: number | null;
  isActive: boolean;
}

/** An active or paused coach: everything coach mode works with. */
export interface CoachMe {
  id: string;
  status: 'active' | 'paused';
  displayNameEn: string;
  displayNameAr: string;
  bioEn: string;
  bioAr: string;
  photoPath: string | null;
  publicAccepted: boolean;
  branches: CoachBranch[];
  lessonTypes: CoachLessonType[];
  addsToday: number;
  addCap: number;
  /**
   * DISPLAY ONLY: every branch's `open_private` summed, and the lowest branch
   * cap. R56 counts per branch (0283), so a check reads
   * `privateCapAt(coach, venueId)` (MB-01).
   */
  privateOpen: number;
  privateCap: number;
}

/** A retired coach (C-25, R45): the card and nothing else. */
export interface CoachMeRetired {
  id: string;
  status: 'retired';
  displayNameEn: string;
  displayNameAr: string;
}

export type CoachMeCoach = CoachMe | CoachMeRetired;

export interface CoachMeRead {
  coach: CoachMeCoach | null;
  serverNow: string | null;
}

export const DEFAULT_TZ = 'Asia/Baghdad';

function parseBranch(raw: unknown): CoachBranch | null {
  if (!isObj(raw)) return null;
  const venueId = str(raw.venue_id);
  if (!venueId) return null;
  return {
    venueId,
    nameEn: str(raw.name_en),
    nameAr: str(raw.name_ar),
    timezone: str(raw.timezone) || DEFAULT_TZ,
    coachingEnabled: bool(raw.coaching_enabled),
    openPrivate: Math.max(0, int(raw.open_private)),
    openPrivateCap: Math.max(0, int(raw.open_private_cap, 10)),
  };
}

function parseLessonType(raw: unknown): CoachLessonType | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  // A kind this build does not know is left out: a form cannot offer what it
  // cannot describe, and the server would refuse the call anyway.
  if (!id || !(LESSON_KINDS as readonly unknown[]).includes(raw.kind)) return null;
  return {
    id,
    venueId: str(raw.venue_id),
    kind: raw.kind as LessonKind,
    nameEn: str(raw.name_en),
    nameAr: str(raw.name_ar),
    durationMin: int(raw.duration_min, 60),
    maxPlaces: Math.max(1, int(raw.max_places, 1)),
    minPlaces: Math.max(1, int(raw.min_places, 1)),
    sessionsCount: intOrNull(raw.sessions_count),
    cutoffHours: Math.max(0, int(raw.cutoff_hours)),
    priceIqd: intOrNull(raw.price_iqd),
    isActive: bool(raw.is_active),
  };
}

/** `coach_me()`: `{coach: null}` for a non-coach, the retired card, or the full coach. Never throws. */
export function parseCoachMe(raw: unknown): CoachMeRead {
  const o = isObj(raw) ? raw : {};
  const serverNow = strOrNull(o.server_now);
  const c = o.coach;
  if (!isObj(c) || !str(c.id)) return { coach: null, serverNow };
  const id = str(c.id);
  const displayNameEn = str(c.display_name_en);
  const displayNameAr = str(c.display_name_ar);
  if (c.status === 'retired') {
    return { coach: { id, status: 'retired', displayNameEn, displayNameAr }, serverNow };
  }
  return {
    coach: {
      id,
      // An unknown status reads as paused: coach mode still opens, and the
      // booking actions stay hidden (the server refuses them with COACH_INACTIVE).
      status: c.status === 'active' ? 'active' : 'paused',
      displayNameEn,
      displayNameAr,
      bioEn: str(c.bio_en),
      bioAr: str(c.bio_ar),
      photoPath: strOrNull(c.photo_path),
      publicAccepted: bool(c.public_accepted),
      branches: arr(c.branches).flatMap((b) => parseBranch(b) ?? []),
      lessonTypes: arr(c.lesson_types).flatMap((t) => parseLessonType(t) ?? []),
      addsToday: Math.max(0, int(c.adds_today)),
      addCap: Math.max(0, int(c.add_cap, 30)),
      privateOpen: Math.max(0, int(c.private_open)),
      privateCap: Math.max(0, int(c.private_cap, 10)),
    },
    serverNow,
  };
}

export function isRetired(coach: CoachMeCoach | null): coach is CoachMeRetired {
  return coach?.status === 'retired';
}

/** R45, P5: the coach's branches with coaching switched off (one banner line each). */
export function branchesOff(coach: CoachMe): CoachBranch[] {
  return coach.branches.filter((b) => !b.coachingEnabled);
}

/** The branches where a coach may book or create (coaching on, R45 rule 4). */
export function bookableBranches(coach: CoachMe): CoachBranch[] {
  return coach.branches.filter((b) => b.coachingEnabled);
}

/** The coach's active lesson types of one kind at one branch (guest.md §4.13.5, §4.13.6). */
export function typesFor(
  coach: CoachMe,
  venueId: string,
  kinds: readonly LessonKind[],
): CoachLessonType[] {
  return coach.lessonTypes.filter(
    (t) => t.venueId === venueId && t.isActive && kinds.includes(t.kind),
  );
}

/** New bookings and sessions are offered while active, and at a branch with coaching on (R16, R45). */
export function canBookOrCreate(coach: CoachMe): boolean {
  return coach.status === 'active' && bookableBranches(coach).length > 0;
}

/** CD-9: how many more students the coach may add today, or null while it is more than five. */
export function addsLeftToShow(coach: CoachMe): number | null {
  const left = Math.max(0, coach.addCap - coach.addsToday);
  return left <= 5 ? left : null;
}

/**
 * R56, C-24: the coach's upcoming coach-booked private lessons at one branch
 * and that branch's cap (the server counts per branch, 0283), or null for a
 * branch the coach is not at.
 */
export function privateCapAt(
  coach: CoachMe,
  venueId: string | null | undefined,
): { open: number; cap: number } | null {
  const b = venueId ? coach.branches.find((x) => x.venueId === venueId) : undefined;
  return b ? { open: b.openPrivate, cap: b.openPrivateCap } : null;
}

/** R56, C-24: the coach holds as many upcoming coach-booked private lessons at this branch as allowed. */
export function atPrivateCap(coach: CoachMe, venueId: string | null | undefined): boolean {
  const at = privateCapAt(coach, venueId);
  return at !== null && at.cap > 0 && at.open >= at.cap;
}

/** The branch's timezone, or the venue default. */
export function tzOf(coach: CoachMe | null, venueId: string | null | undefined): string {
  return (
    coach?.branches.find((b) => b.venueId === venueId)?.timezone ??
    coach?.branches[0]?.timezone ??
    DEFAULT_TZ
  );
}

// ── coach_schedule (X10) ────────────────────────────────────────────────────

export interface ScheduleLesson {
  lessonId: string;
  venueId: string;
  kind: LessonKind;
  courseId: string | null;
  sessionNo: number | null;
  sessionsCount: number | null;
  typeNameEn: string;
  typeNameAr: string;
  titleEn: string;
  titleAr: string;
  startAt: string;
  endAt: string;
  status: LessonStatus;
  placesTaken: number;
  maxPlaces: number;
  minPlaces: number;
  cutoffAt: string | null;
  courtNameEn: string;
  courtNameAr: string;
  unmarked: number;
}

export interface TimeOffBand {
  id: string;
  startsAt: string;
  endsAt: string;
}

export interface CoachSchedule {
  lessons: ScheduleLesson[];
  timeOff: TimeOffBand[];
  serverNow: string | null;
}

function parseScheduleLesson(raw: unknown): ScheduleLesson | null {
  if (!isObj(raw)) return null;
  const lessonId = str(raw.lesson_id);
  const startAt = str(raw.start_at);
  if (!lessonId || !startAt) return null;
  return {
    lessonId,
    venueId: str(raw.venue_id),
    kind: oneOf(raw.kind, LESSON_KINDS, 'private'),
    courseId: strOrNull(raw.course_id),
    sessionNo: intOrNull(raw.session_no),
    sessionsCount: intOrNull(raw.sessions_count),
    typeNameEn: str(raw.type_name_en),
    typeNameAr: str(raw.type_name_ar),
    titleEn: str(raw.title_en),
    titleAr: str(raw.title_ar),
    startAt,
    endAt: str(raw.end_at) || startAt,
    status: oneOf(raw.status, LESSON_STATUSES, 'scheduled'),
    placesTaken: Math.max(0, int(raw.places_taken)),
    maxPlaces: Math.max(0, int(raw.max_places)),
    minPlaces: Math.max(0, int(raw.min_places)),
    cutoffAt: strOrNull(raw.cutoff_at),
    courtNameEn: str(raw.court_name_en),
    courtNameAr: str(raw.court_name_ar),
    unmarked: Math.max(0, int(raw.unmarked)),
  };
}

function parseBand(raw: unknown): TimeOffBand | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const startsAt = str(raw.starts_at);
  const endsAt = str(raw.ends_at);
  return id && startsAt && endsAt ? { id, startsAt, endsAt } : null;
}

export function parseCoachSchedule(raw: unknown): CoachSchedule {
  const o = isObj(raw) ? raw : {};
  return {
    lessons: arr(o.lessons)
      .flatMap((l) => parseScheduleLesson(l) ?? [])
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
    timeOff: arr(o.time_off).flatMap((b) => parseBand(b) ?? []),
    serverNow: strOrNull(o.server_now),
  };
}

/**
 * Where a lesson's trading night begins, in local minutes: the venue trades
 * 09:00–02:00, so a lesson that starts before 06:00 belongs to the night
 * before (a 00:30 lesson is last night's), as the guest's grid groups it.
 */
export const NIGHT_CUT_MINUTES = 6 * 60;

/** The trading night an instant belongs to, 'YYYY-MM-DD' in `tz`. */
export function nightOf(at: Date, tz: string): string {
  const p = localParts(at, tz);
  return p.minutesOfDay < NIGHT_CUT_MINUTES ? addDays(p.date, -1) : p.date;
}

/**
 * The schedule window (guest.md §4.13.2): from the start of yesterday (so a
 * lesson that started within the last day can still be marked, CD-11) to the
 * start of the day fifteen days on. Whole local days, so the key is stable
 * for the day and a refocus does not mint a new query.
 */
export function scheduleWindow(now: Date, tz: string): { from: string; to: string } {
  const today = localParts(now, tz).date;
  return {
    from: wallTimeToUtc(addDays(today, -1), 0, tz).toISOString(),
    to: wallTimeToUtc(addDays(today, 15), 0, tz).toISOString(),
  };
}

export type ScheduleItem =
  | { type: 'lesson'; key: string; lesson: ScheduleLesson }
  | { type: 'timeOff'; key: string; band: TimeOffBand };

export interface ScheduleSection {
  /** The trading night, 'YYYY-MM-DD'. */
  night: string;
  /** 0 tonight, 1 tomorrow, otherwise later (or earlier, for yesterday's lessons still to mark). */
  offset: number;
  data: ScheduleItem[];
}

/**
 * The schedule as sections by trading night (guest.md §4.13.2): lessons at the
 * branch picked (null: every branch), soonest first, and time off as a band
 * on each night it touches. Yesterday's lessons stay only while one still has
 * students to mark and its marking window is open (start + 24 h, MB-09);
 * everything else that ended before tonight is left out.
 */
export function scheduleSections(
  schedule: CoachSchedule,
  opts: { now: Date; tz: string; venueId: string | null },
): ScheduleSection[] {
  const { now, tz, venueId } = opts;
  const tonight = nightOf(now, tz);
  const byNight = new Map<string, ScheduleItem[]>();
  const push = (night: string, item: ScheduleItem) => {
    const list = byNight.get(night) ?? [];
    list.push(item);
    byNight.set(night, list);
  };
  for (const lesson of schedule.lessons) {
    if (venueId && lesson.venueId !== venueId) continue;
    const night = nightOf(new Date(lesson.startAt), tz);
    // A past night's lesson stays only while it has students to mark AND its
    // marking window (start + 24 h, CD-11) is still open (MB-09).
    if (night < tonight && !(lesson.unmarked > 0 && canMarkNow({ startAt: lesson.startAt }, now)))
      continue;
    push(night, { type: 'lesson', key: `lesson.${lesson.lessonId}`, lesson });
  }
  for (const band of schedule.timeOff) {
    const start = Date.parse(band.startsAt);
    const end = Date.parse(band.endsAt);
    if (!(end > start)) continue;
    let night = nightOf(new Date(Math.max(start, now.getTime())), tz);
    const last = nightOf(new Date(end - 1), tz);
    for (let guard = 0; night <= last && guard < 31; guard++) {
      push(night, { type: 'timeOff', key: `time-off.${band.id}.${night}`, band });
      night = addDays(night, 1);
    }
  }
  const startOf = (item: ScheduleItem) =>
    item.type === 'lesson' ? Date.parse(item.lesson.startAt) : Date.parse(item.band.startsAt);
  return [...byNight.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([night, data]) => ({
      night,
      offset: dayDiff(tonight, night),
      data: data.sort((a, b) => startOf(a) - startOf(b)),
    }));
}

function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** "Below minimum" (guest.md §4.13.2): a group session or course short of its minimum before the cut-off. */
export function belowMinimum(
  lesson: Pick<ScheduleLesson, 'kind' | 'status' | 'placesTaken' | 'minPlaces' | 'cutoffAt'>,
  now: Date,
): boolean {
  if (lesson.kind === 'private' || lesson.status !== 'scheduled' || !lesson.cutoffAt) return false;
  return lesson.placesTaken < lesson.minPlaces && Date.parse(lesson.cutoffAt) > now.getTime();
}

// ── coach_hours_mine (db.md §4.6.5) ─────────────────────────────────────────

export interface HoursWindow {
  /** Null for a window added on the phone and not saved yet. */
  id: string | null;
  /** 0 = Sunday … 6 = Saturday, the stored numbering. */
  weekday: number;
  /** 'HH:MM' on the half-hour grid. */
  start: string;
  /** 'HH:MM', or '24:00' for "until midnight" (CD-10). */
  end: string;
  setBy: 'coach' | 'staff';
}

export interface HoursBranch {
  venueId: string;
  nameEn: string;
  nameAr: string;
  timezone: string;
  windows: HoursWindow[];
}

export interface TimeOffEntry {
  id: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  setBy: 'coach' | 'staff';
}

export interface CoachHours {
  branches: HoursBranch[];
  timeOff: TimeOffEntry[];
  serverNow: string | null;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$|^24:00$/;

/** 'HH:MM' from what the server stored (a `time` may come back as 'HH:MM:SS'). */
export function toHHMM(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = /^\d{2}:\d{2}:00$/.test(v) ? v.slice(0, 5) : v;
  return HHMM_RE.test(s) ? s : null;
}

function parseWindow(raw: unknown): HoursWindow | null {
  if (!isObj(raw)) return null;
  const weekday = intOrNull(raw.weekday);
  const start = toHHMM(raw.start_time);
  const end = toHHMM(raw.end_time);
  if (weekday === null || weekday < 0 || weekday > 6 || !start || !end) return null;
  return {
    id: strOrNull(raw.id),
    weekday,
    start,
    end,
    setBy: oneOf(raw.set_by, ['coach', 'staff'] as const, 'coach'),
  };
}

export function parseCoachHours(raw: unknown): CoachHours {
  const o = isObj(raw) ? raw : {};
  return {
    branches: arr(o.branches).flatMap((b) => {
      if (!isObj(b) || !str(b.venue_id)) return [];
      return [
        {
          venueId: str(b.venue_id),
          nameEn: str(b.name_en),
          nameAr: str(b.name_ar),
          timezone: str(b.timezone) || DEFAULT_TZ,
          windows: arr(b.windows).flatMap((w) => parseWindow(w) ?? []),
        },
      ];
    }),
    timeOff: arr(o.time_off).flatMap((t) => {
      if (!isObj(t)) return [];
      const id = str(t.id);
      const startsAt = str(t.starts_at);
      const endsAt = str(t.ends_at);
      if (!id || !startsAt || !endsAt) return [];
      return [
        {
          id,
          startsAt,
          endsAt,
          reason: str(t.reason),
          setBy: oneOf(t.set_by, ['coach', 'staff'] as const, 'coach'),
        },
      ];
    }),
    serverNow: strOrNull(o.server_now),
  };
}

/** Minutes of a window's 'HH:MM' ('24:00' is 1440). NaN for malformed text. */
export function minutesOf(hhmm: string): number {
  try {
    return parseHHMM(hhmm);
  } catch {
    return Number.NaN;
  }
}

/** Minutes → 'HH:MM' (1440 → '24:00'). */
export function hhmmOf(minutes: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(minutes)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** The seven weekdays, each with its windows by start time (Sunday = 0 first, the stored numbering). */
export function windowsByWeekday(windows: readonly HoursWindow[]): HoursWindow[][] {
  const days: HoursWindow[][] = [[], [], [], [], [], [], []];
  for (const w of windows) if (w.weekday >= 0 && w.weekday <= 6) days[w.weekday]!.push(w);
  for (const d of days) d.sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  return days;
}

/**
 * CD-10: a window that ends earlier than it starts runs past midnight; it is
 * stored as `start–24:00` on its day and `00:00–end` on the next. An end of
 * exactly '00:00' is "until midnight" and needs no second window.
 */
export function splitAcrossMidnight(
  weekday: number,
  start: string,
  end: string,
): { weekday: number; start: string; end: string }[] {
  const s = minutesOf(start);
  const e = minutesOf(end);
  if (!(e < s) || e === 1440) return [{ weekday, start, end }];
  const first = { weekday, start, end: '24:00' };
  if (e === 0) return [first];
  return [first, { weekday: (weekday + 1) % 7, start: '00:00', end }];
}

/** Two windows on the same weekday that share any minute (touching ends do not overlap). */
export function windowsOverlap(
  a: Pick<HoursWindow, 'weekday' | 'start' | 'end'>,
  b: Pick<HoursWindow, 'weekday' | 'start' | 'end'>,
): boolean {
  if (a.weekday !== b.weekday) return false;
  return minutesOf(a.start) < minutesOf(b.end) && minutesOf(b.start) < minutesOf(a.end);
}

/** A time on the lesson grid (:00 or :30) and within the day. */
function onGrid(hhmm: string): boolean {
  const m = minutesOf(hhmm);
  return Number.isFinite(m) && m % 30 === 0;
}

export type WindowsProblem =
  | { index: number; kind: 'invalid' }
  | { index: number; kind: 'overlap' }
  | { index: number; kind: 'overlapElsewhere'; venueId: string };

/**
 * The pre-checks before `set_my_coach_hours` (guest.md §4.13.3): each window
 * ends after it starts, on the grid, by midnight; no two of this branch's
 * windows overlap; none overlaps the coach's window at another branch on that
 * weekday (from the same read). The first problem, by the index the call
 * would send, or null. The server's HOURS_INVALID / HOURS_OVERLAP still decide.
 */
export function checkWindows(
  windows: readonly HoursWindow[],
  elsewhere: readonly { venueId: string; windows: readonly HoursWindow[] }[] = [],
): WindowsProblem | null {
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]!;
    const s = minutesOf(w.start);
    const e = minutesOf(w.end);
    if (!onGrid(w.start) || !onGrid(w.end) || !(s < e) || e > 1440)
      return { index: i, kind: 'invalid' };
  }
  for (let i = 0; i < windows.length; i++) {
    for (let j = 0; j < i; j++) {
      if (windowsOverlap(windows[i]!, windows[j]!)) return { index: i, kind: 'overlap' };
    }
    for (const other of elsewhere) {
      if (other.windows.some((o) => windowsOverlap(windows[i]!, o))) {
        return { index: i, kind: 'overlapElsewhere', venueId: other.venueId };
      }
    }
  }
  return null;
}

/**
 * The windows as `set_my_coach_hours` takes them. The read's names are
 * `start_time` / `end_time` and guest.md §4.3 names the write `{weekday,
 * start, end}`; db.md §4.6.5 reads `{weekday, start_time, end_time}`. Both
 * spellings are sent, so either reader finds its keys (an integration note).
 */
export function toWindowsJson(
  windows: readonly Pick<HoursWindow, 'weekday' | 'start' | 'end'>[],
): { weekday: number; start: string; end: string; start_time: string; end_time: string }[] {
  return windows.map((w) => ({
    weekday: w.weekday,
    start: w.start,
    end: w.end,
    start_time: w.start,
    end_time: w.end,
  }));
}

/** Two window lists that would save the same set (ids and who set them aside). */
export function sameWindows(a: readonly HoursWindow[], b: readonly HoursWindow[]): boolean {
  const key = (ws: readonly HoursWindow[]) =>
    ws
      .map((w) => `${w.weekday}|${w.start}|${w.end}`)
      .sort()
      .join(',');
  return key(a) === key(b);
}

/**
 * An `HOURS_INVALID` / `HOURS_OVERLAP` detail as the window index it names
 * (R73: the 0-based index, or `"<index>:<weekday>"`), or null (`p_windows`,
 * `time_off`, anything else).
 */
export function windowIndexOf(detail: string | null): number | null {
  const m = detail ? /^(\d+)(?::\d+)?$/.exec(detail.trim()) : null;
  return m ? Number(m[1]) : null;
}

/** A per-start refusal's detail (`coach_create_course`, 1-based `i`), or null. */
export function startIndexOf(detail: string | null): number | null {
  const m = detail ? /^(\d+)$/.exec(detail.trim()) : null;
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** The longest time off the server takes (db.md §4.6.5). */
export const TIME_OFF_MAX_DAYS = 366;
export const TIME_OFF_REASON_MAX = 200;

/** The time-off form's pre-check, or null when it may be sent. */
export function timeOffProblem(
  start: Date,
  end: Date,
  now: Date,
): 'order' | 'past' | 'long' | null {
  if (!(end.getTime() > start.getTime())) return 'order';
  if (end.getTime() <= now.getTime()) return 'past';
  if (end.getTime() - start.getTime() > TIME_OFF_MAX_DAYS * 86_400_000) return 'long';
  return null;
}

// ── Starts: the grid, the cut-off, a course's weeks (C-20, R9, R47, GL-6) ────

/**
 * Snaps a picked instant onto the lesson grid of `tz` (C-20, R9): the nearest
 * :00 or :30, local. Android's clock has no 30-minute step, so its answer is
 * snapped; iOS's `minuteInterval={30}` already lands on the grid.
 */
export function snapToGrid(at: Date, tz: string): Date {
  const p = localParts(at, tz);
  const rounded = Math.round((p.minutesOfDay + p.seconds / 60) / 30) * 30;
  return wallTimeToUtc(p.date, rounded, tz);
}

/** R47: the start is inside its cut-off (start − cutoff ≤ now), so creation would be refused. */
export function insideCutoff(start: Date, cutoffHours: number, now: Date): boolean {
  return start.getTime() - Math.max(0, cutoffHours) * 3_600_000 <= now.getTime();
}

/** The first grid start outside the type's cut-off (and after now): the creation form's default. */
export function defaultStart(now: Date, cutoffHours: number, tz: string): Date {
  return ceilToLessonGrid(new Date(now.getTime() + Math.max(0, cutoffHours) * 3_600_000 + 1), tz);
}

/** The creation and reschedule pre-check: on the grid, in the future, outside the cut-off. */
export function startProblem(
  start: Date,
  opts: { tz: string; now: Date; cutoffHours?: number | null },
): 'grid' | 'past' | 'cutoff' | null {
  if (!isOnLessonGrid(start, opts.tz)) return 'grid';
  if (start.getTime() <= opts.now.getTime()) return 'past';
  if (
    opts.cutoffHours != null &&
    opts.cutoffHours > 0 &&
    insideCutoff(start, opts.cutoffHours, opts.now)
  ) {
    return 'cutoff';
  }
  return null;
}

/** GL-6: a course's starts, one a week at the first start's local time (the core twin). */
export function weeklyStarts(first: Date, count: number, tz: string): Date[] {
  if (!Number.isInteger(count) || count < 1) return [];
  return weeklyLessonStarts(first, count, tz);
}

// ── coach_lesson (X11; C-16, CD-3, CD-11, R44, R54) ─────────────────────────

export interface RosterEntry {
  enrolmentId: string;
  /** As the server sends it: typed for a coach- or desk-booked row (R44). */
  name: string;
  /** Null after `end_at + 7 days` (R54), while held (P13), or for a student with none. */
  phone: string | null;
  partySize: number;
  friendNames: string[];
  bookedBy: BookedBy;
  paymentMode: 'desk' | 'online';
  status: RosterStatus;
  attendance: Attendance | null;
}

export interface CoachLessonCan {
  add: boolean;
  remove: boolean;
  cancel: boolean;
  cancelCourse: boolean;
  reschedule: boolean;
  mark: boolean;
}

export interface CourseSession {
  lessonId: string;
  sessionNo: number;
  startAt: string;
  endAt: string;
  status: LessonStatus;
}

export interface CoachLessonDetail {
  lesson: {
    id: string;
    venueId: string;
    kind: LessonKind;
    courseId: string | null;
    sessionNo: number | null;
    sessionsCount: number | null;
    typeNameEn: string;
    typeNameAr: string;
    titleEn: string;
    titleAr: string;
    startAt: string;
    endAt: string;
    status: LessonStatus;
    cancelReason: string | null;
    courtNameEn: string;
    courtNameAr: string;
    maxPlaces: number;
    minPlaces: number;
    placesTaken: number;
    cutoffAt: string | null;
  };
  course: { id: string; status: string; sessions: CourseSession[] } | null;
  roster: RosterEntry[];
  can: CoachLessonCan;
  markUntil: string | null;
  serverNow: string | null;
}

const NO_CAN: CoachLessonCan = {
  add: false,
  remove: false,
  cancel: false,
  cancelCourse: false,
  reschedule: false,
  mark: false,
};

function parseRosterEntry(raw: unknown): RosterEntry | null {
  if (!isObj(raw)) return null;
  const enrolmentId = str(raw.enrolment_id);
  if (!enrolmentId) return null;
  const status = oneOf(raw.status, ROSTER_STATUSES, 'booked');
  return {
    enrolmentId,
    name: str(raw.name),
    // P13: a held row never shows a phone, whatever arrived.
    phone: status === 'held' ? null : strOrNull(raw.phone),
    partySize: Math.max(1, int(raw.party_size, 1)),
    friendNames: arr(raw.friend_names).filter(
      (n): n is string => typeof n === 'string' && n.length > 0,
    ),
    bookedBy: oneOf(raw.booked_by, BOOKED_BY, 'guest'),
    paymentMode: oneOf(raw.payment_mode, ['desk', 'online'] as const, 'desk'),
    status,
    attendance: (ATTENDANCE as readonly unknown[]).includes(raw.attendance)
      ? (raw.attendance as Attendance)
      : null,
  };
}

/** `coach_lesson(id)`, or null when the answer carries no lesson. */
export function parseCoachLesson(raw: unknown): CoachLessonDetail | null {
  if (!isObj(raw) || !isObj(raw.lesson) || !str(raw.lesson.id)) return null;
  const l = raw.lesson;
  const startAt = str(l.start_at);
  const course =
    isObj(raw.course) && str(raw.course.id)
      ? {
          id: str(raw.course.id),
          status: str(raw.course.status),
          sessions: arr(raw.course.sessions)
            .flatMap((s): CourseSession[] => {
              if (!isObj(s) || !str(s.lesson_id)) return [];
              return [
                {
                  lessonId: str(s.lesson_id),
                  sessionNo: int(s.session_no, 0),
                  startAt: str(s.start_at),
                  endAt: str(s.end_at),
                  status: oneOf(s.status, LESSON_STATUSES, 'scheduled'),
                },
              ];
            })
            .sort((a, b) => a.sessionNo - b.sessionNo),
        }
      : null;
  const can = isObj(raw.can)
    ? {
        add: bool(raw.can.add),
        remove: bool(raw.can.remove),
        cancel: bool(raw.can.cancel),
        cancelCourse: bool(raw.can.cancel_course),
        reschedule: bool(raw.can.reschedule),
        mark: bool(raw.can.mark),
      }
    : NO_CAN;
  return {
    lesson: {
      id: str(l.id),
      venueId: str(l.venue_id),
      kind: oneOf(l.kind, LESSON_KINDS, 'private'),
      courseId: strOrNull(l.course_id),
      sessionNo: intOrNull(l.session_no),
      sessionsCount: intOrNull(l.sessions_count),
      typeNameEn: str(l.type_name_en),
      typeNameAr: str(l.type_name_ar),
      titleEn: str(l.title_en),
      titleAr: str(l.title_ar),
      startAt,
      endAt: str(l.end_at) || startAt,
      status: oneOf(l.status, LESSON_STATUSES, 'scheduled'),
      cancelReason: strOrNull(l.cancel_reason),
      courtNameEn: str(l.court_name_en),
      courtNameAr: str(l.court_name_ar),
      maxPlaces: Math.max(0, int(l.max_places)),
      minPlaces: Math.max(0, int(l.min_places)),
      placesTaken: Math.max(0, int(l.places_taken)),
      cutoffAt: strOrNull(l.cutoff_at),
    },
    course,
    roster: arr(raw.roster).flatMap((r) => parseRosterEntry(r) ?? []),
    can,
    markUntil: strOrNull(raw.mark_until),
    serverNow: strOrNull(raw.server_now),
  };
}

/** CD-11: the marks are open from the start until `mark_until` (start + 24 h). */
export function canMarkNow(
  lesson: { startAt: string; markUntil?: string | null },
  now: Date,
): boolean {
  const start = Date.parse(lesson.startAt);
  if (!Number.isFinite(start)) return false;
  const until = lesson.markUntil ? Date.parse(lesson.markUntil) : start + 24 * 3_600_000;
  return now.getTime() >= start && now.getTime() < until;
}

/** What the attendance control shows: hidden before the start, editable in the window, read-only after. */
export function markMode(
  detail: Pick<CoachLessonDetail, 'can' | 'markUntil'> & { lesson: { startAt: string } },
  now: Date,
): 'hidden' | 'edit' | 'readonly' {
  const start = Date.parse(detail.lesson.startAt);
  if (!Number.isFinite(start) || now.getTime() < start) return 'hidden';
  return detail.can.mark &&
    canMarkNow({ startAt: detail.lesson.startAt, markUntil: detail.markUntil }, now)
    ? 'edit'
    : 'readonly';
}

/** §1.3, db.md §4.7.1 rule 10: `<code>` or `<code>: <note>`, the note trimmed and capped. */
export function reasonValue(code: CancelReasonCode, note: string): string {
  const n = note.trim().replace(/\s+/g, ' ').slice(0, REASON_NOTE_MAX);
  return n ? `${code}: ${n}` : code;
}

/** Which session of a course the reschedule pre-check treats as the cut-off session (R47). */
export function judgesCutoff(lesson: { kind: LessonKind; sessionNo: number | null }): boolean {
  return lesson.kind === 'group' || (lesson.kind === 'course' && lesson.sessionNo === 1);
}

// ── my_coach_statements (X12; C-12, CM-12, R45) ─────────────────────────────

export interface StatementLine {
  lessonId: string;
  startAt: string;
  kind: LessonKind;
  typeNameEn: string;
  typeNameAr: string;
  collectedIqd: number;
  courtShareIqd: number;
  /** The line's own rate in basis points; null when the server sends none (an adjustment). */
  shareBp: number | null;
  coachIqd: number;
  isAdjustment: boolean;
}

export interface CoachStatement {
  id: string;
  venueId: string;
  venueNameEn: string;
  venueNameAr: string;
  /** 'YYYY-MM-01'. */
  month: string;
  status: 'approved' | 'paid';
  lessonsCount: number;
  collectedIqd: number;
  courtShareIqd: number;
  coachIqd: number;
  adjustmentsIqd: number;
  /** The statement's total (coach's share plus adjustments), when the server sends it. */
  totalIqd: number | null;
  /**
   * The month's one rate in basis points, or null when the server sends none
   * (mixed rates, adjustments only): never a made-up default (MB-02).
   */
  shareBp: number | null;
  approvedAt: string | null;
  paidAt: string | null;
  paidReference: string | null;
  /** Only with a month asked for. */
  lines: StatementLine[] | null;
}

export interface MonthEstimate {
  venueId: string;
  lessons: number;
  collectedIqd: number;
  coachIqd: number;
}

export interface CoachStatements {
  /** 'YYYY-MM-01', newest first. */
  months: string[];
  statements: CoachStatement[];
  currentMonth: MonthEstimate[];
}

const MONTH_RE = /^\d{4}-\d{2}-01$/;

/** A month as `my_coach_statements` names it ('YYYY-MM-01'), from a date or month string. */
export function monthOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.slice(0, 10);
  if (MONTH_RE.test(s)) return s;
  return /^\d{4}-\d{2}/.test(v) ? `${v.slice(0, 7)}-01` : null;
}

/**
 * `my_coach_statements(p_month)`. Drafts and void statements are never shown
 * (CM-12): anything but `approved` or `paid` is dropped, whatever arrived.
 */
export function parseCoachStatements(raw: unknown): CoachStatements {
  const o = isObj(raw) ? raw : {};
  const months = arr(o.months).flatMap((m) => monthOf(m) ?? []);
  const statements = arr(o.statements).flatMap((s): CoachStatement[] => {
    if (!isObj(s) || !str(s.id)) return [];
    if (s.status !== 'approved' && s.status !== 'paid') return [];
    return [
      {
        id: str(s.id),
        venueId: str(s.venue_id),
        venueNameEn: str(s.venue_name_en),
        venueNameAr: str(s.venue_name_ar),
        month: monthOf(s.month) ?? '',
        status: s.status,
        lessonsCount: Math.max(0, int(s.lessons_count)),
        collectedIqd: int(s.collected_iqd),
        courtShareIqd: int(s.court_share_iqd),
        coachIqd: int(s.coach_iqd),
        adjustmentsIqd: int(s.adjustments_iqd),
        totalIqd: intOrNull(s.total_iqd),
        shareBp: intOrNull(s.share_bp),
        approvedAt: strOrNull(s.approved_at),
        paidAt: strOrNull(s.paid_at),
        paidReference: strOrNull(s.paid_reference),
        lines: Array.isArray(s.lines)
          ? s.lines.flatMap((l): StatementLine[] => {
              if (!isObj(l) || !str(l.lesson_id)) return [];
              return [
                {
                  lessonId: str(l.lesson_id),
                  startAt: str(l.start_at),
                  kind: oneOf(l.kind, LESSON_KINDS, 'private'),
                  typeNameEn: str(l.type_name_en),
                  typeNameAr: str(l.type_name_ar),
                  collectedIqd: int(l.collected_iqd),
                  courtShareIqd: int(l.court_share_iqd),
                  shareBp: intOrNull(l.share_bp),
                  coachIqd: int(l.coach_iqd),
                  isAdjustment: bool(l.is_adjustment),
                },
              ];
            })
          : null,
      },
    ];
  });
  const currentMonth = arr(o.current_month).flatMap((m): MonthEstimate[] => {
    if (!isObj(m)) return [];
    return [
      {
        venueId: str(m.venue_id),
        lessons: Math.max(0, int(m.lessons)),
        collectedIqd: int(m.collected_iqd),
        coachIqd: int(m.coach_iqd),
      },
    ];
  });
  return { months, statements, currentMonth };
}

/** The coach's share as a percentage for "Coach's share (60%)" (6000 bp → 60). */
export function sharePercent(shareBp: number): number {
  return Math.round(shareBp) / 100;
}

// ── coach_slots (X3; private types only, R77) ───────────────────────────────

export interface CoachSlots {
  /** Coaching is off at the type's branch. */
  off: boolean;
  /** False for a paused coach (R51): no starts. */
  bookable: boolean;
  durationMin: number;
  starts: { startAt: string; endAt: string }[];
}

export function parseCoachSlots(raw: unknown): CoachSlots {
  const o = isObj(raw) ? raw : {};
  if (o.off === true) return { off: true, bookable: false, durationMin: 0, starts: [] };
  return {
    off: false,
    bookable: o.bookable !== false,
    durationMin: int(o.duration_min, 60),
    starts: arr(o.starts)
      .flatMap((s) => {
        if (!isObj(s)) return [];
        const startAt = str(s.start_at);
        return startAt && Number.isFinite(Date.parse(startAt))
          ? [{ startAt, endAt: str(s.end_at) }]
          : [];
      })
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
  };
}

/** The slot window `coach_slots` takes (at most 14 days): whole local days from today. */
export function slotsWindow(now: Date, tz: string): { from: string; to: string } {
  const today = localParts(now, tz).date;
  return {
    from: wallTimeToUtc(today, 0, tz).toISOString(),
    to: wallTimeToUtc(addDays(today, 14), 0, tz).toISOString(),
  };
}

/** The starts grouped by trading night, nights in order (the book screen's day strip). */
export function slotsByNight(slots: CoachSlots, tz: string): { night: string; starts: string[] }[] {
  const map = new Map<string, string[]>();
  for (const s of slots.starts) {
    const night = nightOf(new Date(s.startAt), tz);
    map.set(night, [...(map.get(night) ?? []), s.startAt]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([night, starts]) => ({ night, starts }));
}

// ── Photos (R43) ────────────────────────────────────────────────────────────

const PHOTO_RE = /^coaches\/[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,80}$/;

/**
 * The public URL of a coach photo in the `menu-media` bucket, or null: only a
 * `coaches/<uuid>/<file>` path is ever turned into a URL (R43).
 */
export function coachPhotoUrl(
  path: string | null | undefined,
  supabaseUrl: string | null | undefined,
): string | null {
  if (!path || !PHOTO_RE.test(path) || !supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/menu-media/${path}`;
}

// ── Write results (X13) ─────────────────────────────────────────────────────

const dup = (o: Obj) => bool(o.duplicate);

export function parseBookResult(raw: unknown): {
  lessonId: string | null;
  enrolmentId: string | null;
  duplicate: boolean;
} {
  const o = isObj(raw) ? raw : {};
  return {
    lessonId: strOrNull(o.lesson_id),
    enrolmentId: strOrNull(o.enrolment_id),
    duplicate: dup(o),
  };
}

export function parseGroupCreated(raw: unknown): { lessonId: string | null; duplicate: boolean } {
  const o = isObj(raw) ? raw : {};
  return { lessonId: strOrNull(o.lesson_id), duplicate: dup(o) };
}

export function parseCourseCreated(raw: unknown): {
  courseId: string | null;
  lessonIds: string[];
  duplicate: boolean;
} {
  const o = isObj(raw) ? raw : {};
  let lessonIds = arr(o.lesson_ids).filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  if (lessonIds.length === 0) {
    lessonIds = arr(o.sessions)
      .flatMap((s) =>
        isObj(s) && str(s.lesson_id) ? [{ no: int(s.session_no), id: str(s.lesson_id) }] : [],
      )
      .sort((a, b) => a.no - b.no)
      .map((s) => s.id);
  }
  return { courseId: strOrNull(o.course_id), lessonIds, duplicate: dup(o) };
}

export function parseAddResult(raw: unknown): {
  enrolmentId: string | null;
  placesLeft: number | null;
  duplicate: boolean;
} {
  const o = isObj(raw) ? raw : {};
  return {
    enrolmentId: strOrNull(o.enrolment_id),
    placesLeft: intOrNull(o.places_left),
    duplicate: dup(o),
  };
}

export function parseRescheduled(raw: unknown): {
  lessonId: string | null;
  startAt: string | null;
  duplicate: boolean;
} {
  const o = isObj(raw) ? raw : {};
  return { lessonId: strOrNull(o.lesson_id), startAt: strOrNull(o.start_at), duplicate: dup(o) };
}

// ── Idempotency intents (guest.md §4.7.4) ───────────────────────────────────

/**
 * `coach_book_private`: every argument sent is in the intent (the composed
 * phone too, MB-07), so a changed form sends a new key and a replay after a
 * dropped connection never answers for an older request.
 */
export function coachBookIntent(a: {
  typeId: string;
  venueId: string;
  startAt: string;
  party: number;
  name: string;
  phone: string | null;
}): string {
  return `coach-book:${a.typeId}|${a.venueId}|${a.startAt}|${a.party}|${a.name.trim()}|${a.phone ?? ''}`;
}

export function groupIntent(a: { typeId: string; venueId: string; startAt: string }): string {
  return `group:${a.typeId}|${a.venueId}|${a.startAt}`;
}

/** `coach_create_course`: the starts and the trimmed titles as sent (MB-07). */
export function courseIntent(a: {
  typeId: string;
  venueId: string;
  starts: readonly string[];
  titleEn: string;
  titleAr: string;
}): string {
  return `course-new:${a.typeId}|${a.venueId}|${a.starts.join(',')}|${a.titleEn.trim()}|${a.titleAr.trim()}`;
}

export function addIntent(a: { targetId: string; name: string; phone: string | null }): string {
  return `add:${a.targetId}|${a.name.trim()}|${a.phone ?? ''}`;
}

/** The student name the server takes (1..80 after cleaning, db.md §4.7.4). */
export const STUDENT_NAME_MAX = 80;
export const COURSE_TITLE_MAX = 80;

export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}
