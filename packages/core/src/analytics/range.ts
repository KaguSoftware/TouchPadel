/**
 * Date ranges for the analytics page: presets, comparison windows, coverage.
 *
 * Every date here is a venue-local BUSINESS date ('YYYY-MM-DD') — see ./businessDay.ts. The
 * arithmetic is calendar arithmetic on those strings (anchored at UTC noon so it can never
 * slip a day), and the only place the clock and timezone enter is `businessTodayISO`.
 */
import { businessDayOf } from './businessDay';

export type DateRange = { from: string; to: string };

export type RangePreset = 'today' | '7d' | '30d' | '90d' | 'custom';

export const RANGE_PRESETS: readonly RangePreset[] = ['today', '7d', '30d', '90d', 'custom'];

/**
 * What "compared to" means (owner, 2026-10-22): the same dates a month earlier, the same dates a
 * year earlier, or a window the owner picks. The old choices ("previous period", "4 weeks
 * earlier", "52 weeks earlier") read as jargon, and a 28-day shift of a 30- or 90-day range
 * overlapped the range itself, counting the shared days on both sides.
 *
 * A month or a year back is calendar arithmetic on each end: a day the earlier month does not
 * have is clamped to its last day (31 Oct → 30 Sept, 29 Feb → 28 Feb). A range longer than a
 * month still overlaps "last month"; the header names both windows, so the owner sees it.
 */
export type CompareBasis = 'month' | 'year' | 'custom';

export const COMPARE_BASES: readonly CompareBasis[] = ['month', 'year', 'custom'];

/** The months each fixed basis looks back. */
export const COMPARE_BASIS_MONTHS: Record<Exclude<CompareBasis, 'custom'>, number> = {
  month: 1,
  year: 12,
};

/**
 * Below this share of covered days a range total is missing enough of the period that
 * comparing it to another one is fiction — deltas get muted rather than shown as movement.
 */
export const RELIABLE_COVERAGE = 0.9;

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed, real calendar date ('2026-02-30' is not). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const ms = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** Milliseconds of UTC noon on a date; throws on malformed input. */
function noon(date: string): number {
  if (!isIsoDate(date)) throw new RangeError(`expected 'YYYY-MM-DD', got '${String(date)}'`);
  return Date.parse(`${date}T12:00:00Z`);
}

function fromNoon(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' shifted by `days` (negative = earlier). */
export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError(`days must be an integer, got ${days}`);
  return fromNoon(noon(date) + days * DAY_MS);
}

/**
 * The CURRENT business day for the venue: at 01:30 with a 06:00 boundary the cafe is still
 * on last night's shift, so "today" must mean the previous calendar date — otherwise the
 * preset shows an empty page while service is running.
 */
export function businessTodayISO(now: Date, startHour: number, tz: string): string {
  return businessDayOf(now, startHour, tz);
}

/**
 * True while the range still reaches the current business day — its numbers can still
 * change, so auto-refresh makes sense. A finished window never changes.
 */
export function isLiveRange(range: DateRange, todayISO: string): boolean {
  return range.to >= todayISO;
}

/** Inclusive day count of a range (0 when `to` precedes `from`). */
export function rangeLength(range: DateRange): number {
  const n = Math.round((noon(range.to) - noon(range.from)) / DAY_MS) + 1;
  return n > 0 ? n : 0;
}

/** Every 'YYYY-MM-DD' in an inclusive range, oldest first. */
export function datesInRange(range: DateRange): string[] {
  const out: string[] = [];
  const end = noon(range.to);
  for (let t = noon(range.from); t <= end; t += DAY_MS) out.push(fromNoon(t));
  return out;
}

/**
 * 'YYYY-MM-DD' moved by whole calendar months (negative = earlier), the day clamped to the last
 * day of the target month.
 */
export function addMonths(date: string, months: number): string {
  if (!Number.isInteger(months)) throw new RangeError(`months must be an integer, got ${months}`);
  const d = new Date(noon(date));
  const index = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12;
  const last = new Date(Date.UTC(year, month + 1, 0, 12)).getUTCDate();
  return fromNoon(Date.UTC(year, month, Math.min(d.getUTCDate(), last), 12));
}

/** The same span shifted back a whole number of days, length preserved. */
export function shiftRange(range: DateRange, days: number): DateRange {
  return { from: addDays(range.from, -days), to: addDays(range.to, -days) };
}

/**
 * The window of equal length immediately before `range`: last 7 days → the 7 days before
 * those, today → yesterday.
 */
export function previousRange(range: DateRange): DateRange {
  const length = rangeLength(range);
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
}

const PRESET_SPAN: Record<Exclude<RangePreset, 'custom'>, number> = {
  today: 0,
  '7d': 6,
  '30d': 29,
  '90d': 89,
};

/**
 * Resolve a range from (URL) search params. A valid `custom` `from`/`to` wins (swapped if
 * reversed); otherwise a preset ending on `todayISO`, defaulting to the last 30 days.
 */
export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  todayISO: string,
): { preset: RangePreset; range: DateRange } {
  if (params.range === 'custom' && isIsoDate(params.from) && isIsoDate(params.to)) {
    const [from, to] = params.from <= params.to ? [params.from, params.to] : [params.to, params.from];
    return { preset: 'custom', range: { from, to } };
  }
  const preset: Exclude<RangePreset, 'custom'> =
    params.range === 'today' || params.range === '7d' || params.range === '90d'
      ? params.range
      : '30d';
  return { preset, range: { from: addDays(todayISO, -PRESET_SPAN[preset]), to: todayISO } };
}

/**
 * Resolve the comparison window for `range` from the `cmp` param. 'year' → the same dates a year
 * earlier; 'custom' → the owner's own `custom` window when it is two real, ordered dates;
 * anything else (absent, an old 'prev' / '4w' / '52w' link, a custom choice without its dates)
 * → the same dates a month earlier.
 */
export function resolveCompare(
  cmp: string | undefined,
  range: DateRange,
  custom?: { from?: string; to?: string },
): { basis: CompareBasis; range: DateRange } {
  if (cmp === 'custom' && isIsoDate(custom?.from) && isIsoDate(custom?.to) && custom.from <= custom.to) {
    return { basis: 'custom', range: { from: custom.from, to: custom.to } };
  }
  const basis: Exclude<CompareBasis, 'custom'> = cmp === 'year' ? 'year' : 'month';
  const months = COMPARE_BASIS_MONTHS[basis];
  return { basis, range: { from: addMonths(range.from, -months), to: addMonths(range.to, -months) } };
}

/**
 * The comparison as the server stores it (`analytics_insights.compare_basis`, the
 * analytics-insights function's `compare_basis`): 'month', 'year', or 'custom:<from>:<to>', so
 * two custom windows never share a stored set of findings (0353).
 */
export function compareTag(compare: { basis: CompareBasis; range: DateRange }): string {
  return compare.basis === 'custom' ? `custom:${compare.range.from}:${compare.range.to}` : compare.basis;
}

/**
 * How much of the picked range actually has sales recorded. A closed day reads as zero, so a
 * range total silently under-reports and a period-over-period percentage compares two
 * different numbers of days; consumers must be able to say so instead of showing a decline.
 */
export type SalesCoverage = {
  /** Days in the picked range. */
  days: number;
  /** Days with at least one sale recorded. */
  daysWithData: number;
  /** Dates with nothing recorded, oldest first. */
  missing: string[];
  /** 0–1. */
  ratio: number;
};

/** Coverage of `range` given the dates that DO have sales. */
export function salesCoverage(range: DateRange, datesWithData: Iterable<string>): SalesCoverage {
  const have = new Set(datesWithData);
  const all = datesInRange(range);
  const missing = all.filter((d) => !have.has(d));
  const daysWithData = all.length - missing.length;
  return {
    days: all.length,
    daysWithData,
    missing,
    ratio: all.length > 0 ? daysWithData / all.length : 0,
  };
}

/**
 * The part of a range engagement (PostHog) data can cover. Tracking started on a known date
 * (`cafe_settings.analytics_engagement_floor`); a range that predates it is clipped, and a
 * clipped comparison window must never be compared against an unclipped one.
 */
export type EngagementWindow = {
  from: string;
  to: string;
  /** Inclusive day count of the usable window; 0 when empty. */
  days: number;
  /** `range.from` predates the floor — the usable window is shorter than asked. */
  clipped: boolean;
  /** The entire range predates the floor — no engagement data at all. */
  empty: boolean;
};

/** `floorISO === null` means "no floor known" — the whole range is usable. */
export function engagementWindow(range: DateRange, floorISO: string | null): EngagementWindow {
  const clipped = floorISO !== null && range.from < floorISO;
  const from = clipped ? floorISO : range.from;
  const empty = from > range.to;
  return {
    from,
    to: range.to,
    days: empty ? 0 : rangeLength({ from, to: range.to }),
    clipped,
    empty,
  };
}

/**
 * Two engagement windows can only be compared when both hold data over the SAME number of
 * tracked days — a clipped baseline understates every previous count.
 */
export function engagementComparable(now: EngagementWindow, prev: EngagementWindow): boolean {
  return !now.empty && !prev.empty && now.days === prev.days;
}
