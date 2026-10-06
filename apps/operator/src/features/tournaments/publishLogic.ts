/**
 * "Publish as tournament" (docs/design/tournaments/build-contracts-2026-10-03.md
 * §1.6 publish, plan §5.1 "Publish"). PURE: the dialog renders the draft and
 * sends `p_settings`.
 *
 * The run's plan (`protocol_runs.data`, the TournamentPlanRecord) gives the
 * name, class, fee, capacity, courts and, for type 1 and type 3, the format;
 * those are read-only here. The desk sets the rest. Every field is checked
 * here the way the server checks it, so a `settings:<key>` refusal is rare,
 * and when it comes it lands on its field.
 */
import { localParts, wallTimeToUtc } from '@touch/core';
import {
  TOUR_CATEGORIES,
  TOUR_FORMATS,
  TOUR_LIMITS,
  type TourCategory,
  type TourFormat,
} from '@touch/core/tournaments';

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** What the plan says, as the dialog shows it. */
export interface PlanFacts {
  nameEn: string;
  nameAr: string;
  tournamentClass: string | null;
  /** The plan's own format when it is one a tournament plays (type 1 / type 3). */
  format: TourFormat | null;
  /** The plan named a format a tournament does not play (knockout, league). */
  formatUnplayable: boolean;
  capacityUnit: 'players' | 'pairs' | null;
  capacityCount: number | null;
  /** `least(count, 64)`: what `max_entries` becomes. */
  maxEntries: number;
  feeIqd: number;
  /** The plan's windows: one per court of each range. */
  windows: { courtId: string; from: string; to: string }[];
  /** The earliest window start: the cut-off must be before it. */
  firstStart: string | null;
}

export function readPlanFacts(data: unknown): PlanFacts {
  const d = obj(data);
  const cap = obj(d.capacity);
  const unit = cap.unit === 'players' || cap.unit === 'pairs' ? cap.unit : null;
  const count =
    typeof cap.count === 'number' && Number.isFinite(cap.count) ? Math.trunc(cap.count) : null;
  const rawFormat = str(d.format);
  const format =
    rawFormat && (TOUR_FORMATS as readonly string[]).includes(rawFormat)
      ? (rawFormat as TourFormat)
      : null;
  const fee =
    typeof d.entry_fee_iqd === 'number' && Number.isFinite(d.entry_fee_iqd)
      ? Math.max(0, Math.trunc(d.entry_fee_iqd))
      : 0;
  const windows: PlanFacts['windows'] = [];
  for (const r of Array.isArray(d.ranges) ? d.ranges.map(obj) : []) {
    const from = str(r.from);
    const to = str(r.to);
    if (!from || !to) continue;
    for (const c of Array.isArray(r.court_ids) ? r.court_ids : []) {
      if (typeof c === 'string' && c !== '') windows.push({ courtId: c, from, to });
    }
  }
  const starts = windows.map((w) => Date.parse(w.from)).filter(Number.isFinite);
  return {
    nameEn: str(d.name_en) ?? '',
    nameAr: str(d.name_ar) ?? '',
    tournamentClass: str(d.class),
    format,
    formatUnplayable: rawFormat !== null && format === null,
    capacityUnit: unit,
    capacityCount: count,
    maxEntries: Math.min(count ?? 0, TOUR_LIMITS.entriesMax),
    feeIqd: fee,
    windows,
    firstStart: starts.length > 0 ? new Date(Math.min(...starts)).toISOString() : null,
  };
}

/**
 * The refusal the plan itself already earns, before any field (§1.9): pairs,
 * fewer than 4 players, a format the tournament cannot play. Null when the
 * plan can be published.
 */
export function planBlocker(f: PlanFacts): 'capacity_unit' | 'capacity_count' | 'format' | null {
  if (f.capacityUnit !== 'players') return 'capacity_unit';
  if ((f.capacityCount ?? 0) < TOUR_LIMITS.entriesMin) return 'capacity_count';
  if (f.formatUnplayable) return 'format';
  return null;
}

export interface PublishDraft {
  format: TourFormat | '';
  category: TourCategory;
  pointsTarget: string;
  rounds: string;
  minEntries: string;
  waitlistMax: string;
  /** The cut-off's venue-local date and time ('YYYY-MM-DD', 'HH:MM'). */
  cutoffDate: string;
  cutoffTime: string;
  prizeEn: string;
  prizeAr: string;
}

export type PublishField = keyof PublishDraft;
export type PublishFieldError =
  | { kind: 'required' }
  | { kind: 'range'; min: number; max: number }
  | { kind: 'cutoffPast' }
  | { kind: 'cutoffLate' }
  | { kind: 'tooLong'; max: number };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The opening draft: the plan's format, open category, 24 points, Mexicano
 * rounds left for the desk, the minimum at 4, 8
 * waitlist places, and the cut-off two hours before the first block in the
 * venue's zone (the server only needs it no later than the start).
 */
export function draftFromPlan(f: PlanFacts, tz: string): PublishDraft {
  let cutoffDate = '';
  let cutoffTime = '';
  if (f.firstStart) {
    const p = localParts(new Date(Date.parse(f.firstStart) - 2 * 3600_000), tz);
    cutoffDate = p.date;
    cutoffTime = `${String(Math.floor(p.minutesOfDay / 60)).padStart(2, '0')}:${String(p.minutesOfDay % 60).padStart(2, '0')}`;
  }
  return {
    format: f.format ?? '',
    category: 'open',
    pointsTarget: String(TOUR_LIMITS.pointsTargetDefault),
    rounds: '',
    minEntries: String(TOUR_LIMITS.entriesMin),
    waitlistMax: String(TOUR_LIMITS.waitlistDefault),
    cutoffDate,
    cutoffTime,
    prizeEn: '',
    prizeAr: '',
  };
}

function intIn(text: string, min: number, max: number): number | 'required' | 'range' {
  const t = text.trim();
  if (t === '') return 'required';
  if (!/^\d+$/.test(t)) return 'range';
  const n = Number(t);
  return n < min || n > max ? 'range' : n;
}

/** The cut-off as a UTC instant, or null when the date or time is not complete. */
export function cutoffInstant(
  draft: Pick<PublishDraft, 'cutoffDate' | 'cutoffTime'>,
  tz: string,
): Date | null {
  const m = HHMM.exec(draft.cutoffTime);
  if (!DATE.test(draft.cutoffDate) || !m) return null;
  return wallTimeToUtc(draft.cutoffDate, Number(m[1]) * 60 + Number(m[2]), tz);
}

/** Every field's problem, the server's rules (§1.6 settings keys). */
export function publishErrors(
  draft: PublishDraft,
  f: PlanFacts,
  tz: string,
  nowMs: number,
): Partial<Record<PublishField, PublishFieldError>> {
  const out: Partial<Record<PublishField, PublishFieldError>> = {};
  if (draft.format === '') out.format = { kind: 'required' };
  if (!(TOUR_CATEGORIES as readonly string[]).includes(draft.category))
    out.category = { kind: 'required' };
  const pt = intIn(draft.pointsTarget, TOUR_LIMITS.pointsTargetMin, TOUR_LIMITS.pointsTargetMax);
  if (pt === 'required') out.pointsTarget = { kind: 'required' };
  else if (pt === 'range')
    out.pointsTarget = {
      kind: 'range',
      min: TOUR_LIMITS.pointsTargetMin,
      max: TOUR_LIMITS.pointsTargetMax,
    };
  if (draft.format === 'mexicano') {
    const r = intIn(draft.rounds, 1, TOUR_LIMITS.roundsMax);
    if (r === 'required') out.rounds = { kind: 'required' };
    else if (r === 'range') out.rounds = { kind: 'range', min: 1, max: TOUR_LIMITS.roundsMax };
  }
  const maxMin = Math.max(TOUR_LIMITS.entriesMin, f.maxEntries);
  const me = intIn(draft.minEntries, TOUR_LIMITS.entriesMin, maxMin);
  if (me === 'required') out.minEntries = { kind: 'required' };
  else if (me === 'range')
    out.minEntries = { kind: 'range', min: TOUR_LIMITS.entriesMin, max: maxMin };
  const wl = intIn(draft.waitlistMax, 0, TOUR_LIMITS.waitlistMax);
  if (wl === 'required') out.waitlistMax = { kind: 'required' };
  else if (wl === 'range')
    out.waitlistMax = { kind: 'range', min: 0, max: TOUR_LIMITS.waitlistMax };
  const cut = cutoffInstant(draft, tz);
  if (!cut) out.cutoffDate = { kind: 'required' };
  else if (cut.getTime() <= nowMs) out.cutoffDate = { kind: 'cutoffPast' };
  else if (f.firstStart && cut.getTime() > Date.parse(f.firstStart))
    out.cutoffDate = { kind: 'cutoffLate' };
  if (draft.prizeEn.trim().length > TOUR_LIMITS.prizeMax)
    out.prizeEn = { kind: 'tooLong', max: TOUR_LIMITS.prizeMax };
  if (draft.prizeAr.trim().length > TOUR_LIMITS.prizeMax)
    out.prizeAr = { kind: 'tooLong', max: TOUR_LIMITS.prizeMax };
  return out;
}

/**
 * `p_settings` for a valid draft. Every key is sent; `rounds` only for
 * Mexicano (an Americano's rounds are set by its first schedule), the prizes
 * as null when blank.
 */
export function publishSettings(draft: PublishDraft, tz: string): Record<string, unknown> {
  const cut = cutoffInstant(draft, tz);
  return {
    format: draft.format,
    category: draft.category,
    points_target: Number(draft.pointsTarget.trim()),
    ...(draft.format === 'mexicano' ? { rounds: Number(draft.rounds.trim()) } : {}),
    min_entries: Number(draft.minEntries.trim()),
    waitlist_max: Number(draft.waitlistMax.trim()),
    registration_closes_at: cut ? cut.toISOString() : null,
    prize_en: draft.prizeEn.trim() || null,
    prize_ar: draft.prizeAr.trim() || null,
  };
}

/** The field a `settings:<key>` refusal names. */
export function fieldOfSetting(key: string | null): PublishField | null {
  switch (key) {
    case 'format':
      return 'format';
    case 'category':
      return 'category';
    case 'points_target':
      return 'pointsTarget';
    case 'rounds':
      return 'rounds';
    case 'min_entries':
      return 'minEntries';
    case 'waitlist_max':
      return 'waitlistMax';
    case 'registration_closes_at':
      return 'cutoffDate';
    case 'prize_en':
      return 'prizeEn';
    case 'prize_ar':
      return 'prizeAr';
    default:
      return null;
  }
}

/** Whether a run gets "Publish as tournament": a done tournament run, for a role that publishes. */
export function canOfferPublish(
  run: { kind: string; status: string },
  publishes: boolean,
): boolean {
  return publishes && run.kind === 'tournament' && run.status === 'done';
}
