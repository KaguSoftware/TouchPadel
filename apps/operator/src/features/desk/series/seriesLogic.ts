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

export type DraftProblem = 'weekdays' | 'weeks' | 'end' | 'court' | 'time' | null;

/** The first thing wrong with a draft, or null when it can be previewed. */
export function draftProblem(d: SeriesDraft): DraftProblem {
  if (!d.courtId) return 'court';
  if (!/^\d{2}:\d{2}$/.test(d.startTime)) return 'time';
  if (d.pattern === 'weekdays' && d.weekdays.length === 0) return 'weekdays';
  if (d.endMode === 'weeks' && (!Number.isInteger(d.weeks) || d.weeks < 1)) return 'weeks';
  if (d.endMode === 'date' && d.endsOn <= d.startsOn) return 'end';
  return null;
}

/**
 * The inclusive last date the series runs to. "N weeks" means N weekly
 * cycles from the first date: 1 week = the first date only through the day
 * before its next weekly repeat.
 */
export function resolvedEndsOn(d: SeriesDraft): string {
  if (d.endMode === 'date') return d.endsOn;
  return shiftIsoDate(d.startsOn, Math.max(1, d.weeks) * 7 - 1);
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
