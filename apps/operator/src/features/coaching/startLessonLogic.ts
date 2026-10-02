/**
 * New lesson's rules (docs/design/coaching/operator.md §5.9, §5.21), pure:
 * which kinds, lesson types and coaches the dialog offers, which start it
 * pre-selects, the mirrors of the server's start checks, and the arguments
 * each create RPC gets. No React, no fetches.
 *
 * Every rule here is a mirror; desk_book_lesson, desk_create_group and
 * desk_create_course decide (§5.7). The mirrors exist so the desk sees why
 * before pressing Create, not after:
 *  - every lesson start sits on the 30-minute grid (C-20, R9;
 *    `@touch/core` coaching/grid.ts, the twin of app.lesson_on_grid);
 *  - a private lesson takes only a start `coach_slots` offers (C-2, R77): the
 *    coach is free and a court is (the court itself is picked by the server,
 *    C-10);
 *  - a group session, and a course's first session, whose cut-off has
 *    already passed on the server's clock is refused (R47, LESSON_CLOSED
 *    `cutoff`);
 *  - a course's starts are one per session, each after the one before ends,
 *    all within a year (COURSE_STARTS_INVALID `count` / `order` / `span`),
 *    each on the grid and not in the past.
 *
 * Clock: `nowMs` is always the payload's (desk_lessons.server_now plus the
 * time since it was read, lessonLogic.nowOf), never the station's alone (§5.1).
 */
import {
  addDays,
  ceilToLessonGrid,
  isOnLessonGrid,
  LESSON_GRID_MINUTES,
  localParts,
  wallTimeToUtc,
  weeklyLessonStarts,
} from '@touch/core';
import {
  LESSON_KINDS,
  type DeskCoach,
  type DeskLessonType,
  type LessonKind,
} from './lessonPayloads';

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

// ---------------------------------------------------------------------------
// What is on offer
// ---------------------------------------------------------------------------

/** The kinds with at least one lesson type on sale in the envelope, in C-1 order. */
export function kindsOnSale(types: readonly Pick<DeskLessonType, 'kind'>[]): LessonKind[] {
  return LESSON_KINDS.filter((k) => types.some((t) => t.kind === k));
}

/** The envelope's lesson types of one kind, in the server's order. */
export function typesOfKind(
  types: readonly DeskLessonType[],
  kind: LessonKind | null,
): DeskLessonType[] {
  return kind ? types.filter((t) => t.kind === kind) : [];
}

export interface CoachChoice {
  coach: DeskCoach;
  /** Listed, disabled: "Paused: not taking lessons" (§5.9). */
  paused: boolean;
}

/**
 * The coaches who teach this type at the branch (`lesson_type_ids`), active
 * ones first. A paused coach is listed so the desk sees why they are missing,
 * but cannot be picked; a retired one is never in the envelope.
 */
export function coachesFor(
  typeId: string | null | undefined,
  coaches: readonly DeskCoach[],
): CoachChoice[] {
  if (!typeId) return [];
  const teaching = coaches
    .filter((c) => c.status !== 'retired' && c.lesson_type_ids.includes(typeId))
    .map((coach) => ({ coach, paused: coach.status === 'paused' }));
  return [...teaching.filter((c) => !c.paused), ...teaching.filter((c) => c.paused)];
}

/**
 * The price the desk quotes: the coach's own (`coaches[].prices`, the
 * server's lesson_price_for) once a coach is picked, else the type's. Null
 * when the server did not say ("—", never a made-up zero).
 */
export function priceFor(
  type: Pick<DeskLessonType, 'lesson_type_id' | 'price_iqd'> | null | undefined,
  coach: Pick<DeskCoach, 'prices'> | null | undefined,
): number | null {
  if (!type) return null;
  const own = coach?.prices.find((p) => p.lesson_type_id === type.lesson_type_id);
  if (own && own.price_iqd !== null) return own.price_iqd;
  return type.price_iqd;
}

// ---------------------------------------------------------------------------
// Local dates and the grid
// ---------------------------------------------------------------------------

/** A local date and wall-clock time ('YYYY-MM-DD', 'HH:MM'). */
export interface LocalStart {
  date: string;
  time: string;
}

/** Minutes past midnight as 'HH:MM'. */
export function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The instant of a local date and 'HH:MM' in the branch's zone, or null when either is malformed. */
export function startOf(date: string, time: string, tz: string): string | null {
  const m = TIME.exec(time);
  if (!m || !DATE.test(date)) return null;
  try {
    return wallTimeToUtc(date, Number(m[1]) * 60 + Number(m[2]), tz).toISOString();
  } catch {
    return null;
  }
}

/** The local date and 'HH:MM' of an instant in the branch's zone. */
export function localStartOf(iso: string, tz: string): LocalStart {
  const p = localParts(new Date(iso), tz);
  return { date: p.date, time: hhmm(p.minutesOfDay) };
}

/**
 * Where the dialog opens: the pressed time when it is on the grid, else the
 * next grid start after it (a night whose rows begin at :15 still offers
 * :30), as a local date and time.
 */
export function initialStart(pressed: Date, tz: string): LocalStart {
  return localStartOf(ceilToLessonGrid(pressed, tz).toISOString(), tz);
}

/** Every grid start of one local day, 00:00 to 23:30, with its instant (the group and course time pickers). */
export function gridStarts(date: string, tz: string): { time: string; startAt: string }[] {
  const out: { time: string; startAt: string }[] = [];
  for (let m = 0; m < 24 * 60; m += LESSON_GRID_MINUTES) {
    const startAt = startOf(date, hhmm(m), tz);
    if (startAt && isOnLessonGrid(new Date(startAt), tz)) out.push({ time: hhmm(m), startAt });
  }
  return out;
}

/** [from, to) of one local day: what one coach_slots call covers (§5.6.3, one local day per call). */
export function localDayWindow(
  date: string,
  tz: string,
): { fromIso: string; toIso: string } | null {
  if (!DATE.test(date)) return null;
  return {
    fromIso: wallTimeToUtc(date, 0, tz).toISOString(),
    toIso: wallTimeToUtc(addDays(date, 1), 0, tz).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Private: the coach's free starts
// ---------------------------------------------------------------------------

export type SlotChoice =
  /** No free start that day: "No free time for {coach} that day." */
  | { state: 'none' }
  /** The pressed time is one of the coach's free starts: pre-selected. */
  | { state: 'pressed'; startAt: string }
  /** A time was pressed and it is not free: "{coach} isn't free at {time}. Pick one of these times." */
  | { state: 'notFree' }
  /** Nothing pressed: pick one. */
  | { state: 'pick' };

/** What the private start chips open on (§5.9). Instants are compared, not strings. */
export function slotChoice(
  starts: readonly { start_at: string }[],
  pressed: string | null | undefined,
): SlotChoice {
  if (starts.length === 0) return { state: 'none' };
  const p = ms(pressed);
  if (p === null) return { state: 'pick' };
  const hit = starts.find((s) => ms(s.start_at) === p);
  return hit ? { state: 'pressed', startAt: hit.start_at } : { state: 'notFree' };
}

// ---------------------------------------------------------------------------
// The cut-off at creation (R47)
// ---------------------------------------------------------------------------

/** When sign-up closes for a start: `cutoffHours` before it (C-14). Null with no cut-off. */
export function cutoffAtOf(
  startAt: string | null | undefined,
  cutoffHours: number | null | undefined,
): string | null {
  const s = ms(startAt);
  if (s === null || cutoffHours === null || cutoffHours === undefined || cutoffHours <= 0)
    return null;
  return new Date(s - cutoffHours * 3_600_000).toISOString();
}

/**
 * R47's mirror: a group session (a course: session 1) whose cut-off has
 * already passed on the server's clock would be refused LESSON_CLOSED
 * `cutoff`. At the cut-off counts as passed.
 */
export function cutoffPassed(
  startAt: string | null | undefined,
  cutoffHours: number | null | undefined,
  serverNowMs: number,
): boolean {
  const at = ms(cutoffAtOf(startAt, cutoffHours));
  return at !== null && at <= serverNowMs;
}

// ---------------------------------------------------------------------------
// Course starts
// ---------------------------------------------------------------------------

/**
 * A course's sessions, one a week at the same local time as the first
 * (`weeklyLessonStarts`, which keeps the wall clock across a daylight-saving
 * change), as editable local rows. Empty for a malformed first start or count.
 */
export function weeklyStarts(
  firstDate: string,
  time: string,
  count: number,
  tz: string,
): LocalStart[] {
  const first = startOf(firstDate, time, tz);
  if (!first || !Number.isInteger(count) || count < 1) return [];
  return weeklyLessonStarts(new Date(first), count, tz).map((d) =>
    localStartOf(d.toISOString(), tz),
  );
}

/** COURSE_STARTS_INVALID's details (§5.19), mirrored on the whole list. */
export type CourseFormError = 'count' | 'order' | 'span';
/** What is wrong with one session's row. */
export type StartRowError = 'missing' | 'grid' | 'past' | 'cutoff' | 'order';

export interface StartsCheck {
  form: CourseFormError | null;
  /** One entry per row, null when the row is fine. */
  rows: (StartRowError | null)[];
}

export interface StartsContext {
  /** The type's `sessions_count`. */
  count: number | null;
  /** The type's `duration_min`: a session must start after the one before ends. */
  durationMin: number | null;
  /** Session 1 takes the cut-off check (R47). */
  cutoffHours: number | null;
  tz: string;
  nowMs: number;
}

/** A year after an instant, by the calendar (the server's "all within a year"). */
function yearAfter(t: number): number {
  const d = new Date(t);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.getTime();
}

/**
 * The course list's mirror of the server's checks: `count` (one start per
 * session), `order` (each after the one before ends), `span` (within a year),
 * and per row: on the grid, not in the past, and for session 1 the cut-off.
 */
export function startsErrors(rows: readonly LocalStart[], ctx: StartsContext): StartsCheck {
  const starts = rows.map((r) => startOf(r.date, r.time, ctx.tz));
  const out: (StartRowError | null)[] = starts.map(() => null);
  let form: CourseFormError | null =
    ctx.count !== null && rows.length !== ctx.count ? 'count' : null;
  starts.forEach((s, i) => {
    if (s === null) {
      out[i] = 'missing';
      return;
    }
    if (!isOnLessonGrid(new Date(s), ctx.tz)) out[i] = 'grid';
    else if (Date.parse(s) <= ctx.nowMs) out[i] = 'past';
    else if (i === 0 && cutoffPassed(s, ctx.cutoffHours, ctx.nowMs)) out[i] = 'cutoff';
  });
  const length = Math.max(0, ctx.durationMin ?? 0) * 60_000;
  for (let i = 1; i < starts.length; i++) {
    const a = ms(starts[i - 1]);
    const b = ms(starts[i]);
    if (a === null || b === null) continue;
    if (b < a + length || b <= a) {
      if (out[i] === null) out[i] = 'order';
      form ??= 'order';
    }
  }
  const first = ms(starts[0]);
  const last = ms(starts[starts.length - 1]);
  if (first !== null && last !== null && last > yearAfter(first)) form ??= 'span';
  return { form, rows: out };
}

// ---------------------------------------------------------------------------
// The draft, what blocks Create, and the RPC arguments
// ---------------------------------------------------------------------------

export interface StartDraft {
  kind: LessonKind | null;
  typeId: string | null;
  coachId: string | null;
  /** Private: the chosen free start; group: the chosen grid start (ISO). */
  startAt: string | null;
  /** Course: one row per session. */
  rows: LocalStart[];
  titleEn: string;
  titleAr: string;
  /** Private: a picked customer, else the typed student. */
  customerId: string | null;
  guestName: string;
  guestPhone: string;
  /** Private: the booker plus who comes with them (1..max_places). */
  partySize: number;
}

/** Why Create is disabled, in the order the dialog says them. */
export type StartBlock =
  | 'kind'
  | 'type'
  | 'coach'
  | 'coachPaused'
  | 'start'
  | 'grid'
  | 'past'
  | 'cutoff'
  | 'starts'
  | 'student'
  | 'party'
  | 'title';

export interface StartDraftContext {
  types: readonly DeskLessonType[];
  coaches: readonly DeskCoach[];
  tz: string;
  nowMs: number;
}

/** A course title's bound (`lesson_courses` title, 0..80). */
export const COURSE_TITLE_MAX = 80;

/** Everything that blocks Create now. Empty: the server is asked. */
export function startDraftErrors(draft: StartDraft, ctx: StartDraftContext): StartBlock[] {
  const out: StartBlock[] = [];
  if (!draft.kind) return ['kind'];
  const type = ctx.types.find((t) => t.lesson_type_id === draft.typeId && t.kind === draft.kind);
  if (!type) return ['type'];
  const coach = ctx.coaches.find((c) => c.coach_id === draft.coachId);
  if (!coach || !coach.lesson_type_ids.includes(type.lesson_type_id)) out.push('coach');
  else if (coach.status === 'paused') out.push('coachPaused');

  if (draft.kind === 'course') {
    const check = startsErrors(draft.rows, {
      count: type.sessions_count,
      durationMin: type.duration_min,
      cutoffHours: type.cutoff_hours,
      tz: ctx.tz,
      nowMs: ctx.nowMs,
    });
    if (check.form || check.rows.some((r) => r !== null)) out.push('starts');
    if (
      draft.titleEn.trim().length > COURSE_TITLE_MAX ||
      draft.titleAr.trim().length > COURSE_TITLE_MAX
    )
      out.push('title');
    return out;
  }

  const start = ms(draft.startAt);
  if (start === null) out.push('start');
  else if (!isOnLessonGrid(new Date(start), ctx.tz)) out.push('grid');
  else if (start <= ctx.nowMs) out.push('past');
  else if (draft.kind === 'group' && cutoffPassed(draft.startAt, type.cutoff_hours, ctx.nowMs))
    out.push('cutoff');

  if (draft.kind === 'private') {
    if (!draft.customerId && draft.guestName.trim() === '') out.push('student');
    const max = type.max_places ?? 1;
    if (!Number.isInteger(draft.partySize) || draft.partySize < 1 || draft.partySize > max)
      out.push('party');
  }
  return out;
}

/** The arguments of the create RPC for the draft's kind (§1.7, §5.7), with the dialog's key. */
export function startArgs(
  kind: LessonKind,
  draft: StartDraft,
  idempotencyKey: string,
  tz: string,
): Record<string, unknown> {
  const base = {
    p_coach_id: draft.coachId,
    p_lesson_type_id: draft.typeId,
    p_idempotency_key: idempotencyKey,
  };
  if (kind === 'course') {
    return {
      ...base,
      p_starts: draft.rows.map((r) => startOf(r.date, r.time, tz)),
      // '' when blank: the guest then sees the lesson type's name (§5.9).
      p_title_en: draft.titleEn.trim(),
      p_title_ar: draft.titleAr.trim(),
    };
  }
  if (kind === 'group') return { ...base, p_start_at: draft.startAt };
  const phone = draft.guestPhone.trim();
  return {
    ...base,
    p_start_at: draft.startAt,
    p_party_size: draft.partySize,
    // A picked customer, or the student typed at the desk (C-21: kept as typed). All three are
    // sent, the unused ones null: the function has no defaults, and PostgREST finds it by the
    // names of the arguments it is given.
    p_customer_id: draft.customerId ?? null,
    p_name: draft.customerId ? null : draft.guestName.trim(),
    p_phone: draft.customerId ? null : phone || null,
  };
}
