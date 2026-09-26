/**
 * Pure helpers for the recurring-series screens. The server generates the
 * occurrences (preview_series) and decides what clashes; this file only
 * shapes a draft into RPC arguments and tracks the desk's resolutions.
 */
import { shiftIsoDate } from '../weekLogic';
import type { SeriesOccurrence, SeriesOccurrencePreview, SeriesPattern, SeriesResolution } from '../deskTypes';

export interface SeriesDraft {
  courtId: string;
  pattern: SeriesPattern;
  /** 0 = Sunday, matching Postgres dow and the build plan. */
  weekdays: number[];
  startTime: string; // HH:MM
  durationMin: number;
  startsOn: string; // YYYY-MM-DD
  endMode: 'weeks' | 'date';
  weeks: number;
  endsOn: string; // YYYY-MM-DD
}

export type DraftProblem = 'weekdays' | 'weeks' | 'end' | 'court' | 'time' | 'past' | null;

/**
 * The first thing wrong with a draft, or null when it can be previewed.
 *
 * `today` is the venue's own date (todayInTz), not the machine's: a series is
 * weeks of courts and there is nothing to book in a week that has been and
 * gone. Optional, because the check is only as good as the caller's clock —
 * omit it and the date is not judged at all.
 */
export function draftProblem(d: SeriesDraft, today?: string): DraftProblem {
  if (!d.courtId) return 'court';
  if (!/^\d{2}:\d{2}$/.test(d.startTime)) return 'time';
  if (d.pattern === 'weekdays' && d.weekdays.length === 0) return 'weekdays';
  if (today !== undefined && d.startsOn < today) return 'past';
  if (d.endMode === 'weeks' && (!Number.isInteger(d.weeks) || d.weeks < 1)) return 'weeks';
  if (d.endMode === 'date' && d.endsOn <= d.startsOn) return 'end';
  return null;
}

/** Days between two sessions of a pattern. `weekdays` steps a day at a time. */
function stepDays(pattern: SeriesPattern): number {
  return pattern === 'fortnightly' ? 14 : 7;
}

/**
 * The inclusive last date the series runs to.
 *
 * The number the clerk types is a count of SESSIONS, and this turns it into the
 * range the server enumerates: the first session plus N-1 more, one step apart.
 *
 * It used to mean calendar span, with the interval applied independently inside
 * it — so "every 2 weeks" with 2 asked for a 13-day range, the 14-day step
 * cleared it in one jump, and the desk got ONE booking after asking for two
 * (reported 2026-09-22). Weekly is unchanged by the switch, because N weekly
 * sessions and N weeks of span describe the same range.
 *
 * `weekdays` keeps meaning calendar weeks: with three weekdays ticked a week
 * holds three sessions, so a session count could not name a range on its own.
 */
export function resolvedEndsOn(d: SeriesDraft): string {
  if (d.endMode === 'date') return d.endsOn;
  const n = Math.max(1, d.weeks);
  if (d.pattern === 'weekdays') return shiftIsoDate(d.startsOn, n * 7 - 1);
  return shiftIsoDate(d.startsOn, (n - 1) * stepDays(d.pattern));
}

/** RPC arguments shared by preview_series and create_series (build plan §4 0066). */
export function seriesRpcArgs(d: SeriesDraft): {
  p_court_id: string;
  p_pattern: SeriesPattern;
  p_weekdays: number[];
  p_start_time: string;
  p_duration_min: number;
  p_starts_on: string;
  p_ends_on: string;
} {
  const weekdays =
    d.pattern === 'weekdays'
      ? [...new Set(d.weekdays)].sort((a, b) => a - b)
      : [new Date(`${d.startsOn}T12:00:00Z`).getUTCDay()];
  return {
    p_court_id: d.courtId,
    p_pattern: d.pattern,
    p_weekdays: weekdays,
    p_start_time: d.startTime,
    p_duration_min: d.durationMin,
    p_starts_on: d.startsOn,
    p_ends_on: resolvedEndsOn(d),
  };
}

/** A stable fingerprint so a preview can be marked stale when the draft moves. */
export function draftKey(d: SeriesDraft): string {
  return JSON.stringify(seriesRpcArgs(d));
}

export interface ResolutionMap {
  [date: string]: SeriesResolution;
}

/** Dates that clash and have no resolution yet — submission must stay disabled while any remain. */
export function unresolvedDates(occurrences: readonly SeriesOccurrencePreview[], resolutions: ResolutionMap): string[] {
  return occurrences.filter((o) => o.conflict !== null && resolutions[o.date] === undefined).map((o) => o.date);
}

export function conflictCount(occurrences: readonly SeriesOccurrencePreview[]): number {
  return occurrences.filter((o) => o.conflict !== null).length;
}

/** How many sessions create_series would book: every date, less the clashes resolved by skipping. */
export function bookableCount(occurrences: readonly SeriesOccurrencePreview[], resolutions: ResolutionMap): number {
  return occurrences.filter((o) => !(o.conflict !== null && resolutions[o.date]?.action === 'skip')).length;
}

/** Resolutions as the RPC wants them, only for dates that still clash. */
export function resolutionsForRpc(occurrences: readonly SeriesOccurrencePreview[], resolutions: ResolutionMap): SeriesResolution[] {
  return occurrences
    .filter((o) => o.conflict !== null)
    .map((o) => resolutions[o.date])
    .filter((r): r is SeriesResolution => r !== undefined);
}

/** Drop resolutions for dates the new preview no longer lists as clashes. */
export function pruneResolutions(occurrences: readonly SeriesOccurrencePreview[], resolutions: ResolutionMap): ResolutionMap {
  const clashing = new Set(occurrences.filter((o) => o.conflict !== null).map((o) => o.date));
  const next: ResolutionMap = {};
  for (const [date, r] of Object.entries(resolutions)) if (clashing.has(date)) next[date] = r;
  return next;
}

export interface OccurrenceSummary {
  total: number;
  played: number;
  upcoming: number;
  cancelled: number;
}

/** Counts for the series detail header. "Upcoming" = live and not played. */
export function summarizeOccurrences(occ: readonly SeriesOccurrence[]): OccurrenceSummary {
  let played = 0;
  let cancelled = 0;
  let upcoming = 0;
  for (const o of occ) {
    if (o.played) played += 1;
    else if (o.status === 'cancelled' || o.status === 'no_show' || o.status === 'expired') cancelled += 1;
    else upcoming += 1;
  }
  return { total: occ.length, played, upcoming, cancelled };
}

/** A played occurrence is untouchable; so is one already cancelled. */
export function occurrenceEditable(o: SeriesOccurrence): boolean {
  return !o.played && (o.status === 'pending' || o.status === 'confirmed' || o.status === 'arrived');
}

/** How many occurrences a cancel with this scope would touch (never the played ones). */
export function cancelScopeCount(occ: readonly SeriesOccurrence[], scope: 'future' | 'all', nowIso: string): number {
  return occ.filter((o) => {
    if (!occurrenceEditable(o)) return false;
    if (scope === 'all') return true;
    return o.start_at > nowIso;
  }).length;
}
