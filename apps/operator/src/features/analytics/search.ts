/**
 * `/analytics` search params — hand parser (no zod in the operator app).
 * Unknown values fall back to the 30-day preset; dates must be YYYY-MM-DD.
 */
import { isIsoDate, type CompareBasis, type RangePreset } from '@touch/core';

export interface AnalyticsSearch {
  range: RangePreset;
  from?: string;
  to?: string;
  cmp?: CompareBasis;
  /** cmp=custom only: the comparison window the owner picked. */
  cmpFrom?: string;
  cmpTo?: string;
  /** Courts tab only: narrow every court figure to one court (a uuid). Carried across tabs, applied on Courts. */
  court?: string;
}

/** app.analytics_bounds refuses a span over 400 days; refuse it here so the owner never sees the raw error. */
export const MAX_RANGE_DAYS = 400;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function spanDays(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

/**
 * F-37: a picked period longer than the server's 400 days. The pickers refuse
 * it on the spot with a message naming the limit (never a silent 30 days).
 */
export function rangeTooLong(from: string, to: string): boolean {
  return spanDays(from, to) > MAX_RANGE_DAYS;
}

/** The last MAX_RANGE_DAYS of a longer range, ending where it ended. */
export function clampRange(from: string, to: string): { from: string; to: string } {
  if (!rangeTooLong(from, to)) return { from, to };
  const start = new Date(Date.parse(`${to}T00:00:00Z`) - MAX_RANGE_DAYS * 86_400_000);
  return { from: start.toISOString().slice(0, 10), to };
}

const PRESETS: readonly RangePreset[] = ['today', '7d', '30d', '90d', 'custom'];
const BASES: readonly CompareBasis[] = ['month', 'year', 'custom'];

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function validateSearch(raw: Record<string, unknown>): AnalyticsSearch {
  const rangeRaw = str(raw.range);
  const from = str(raw.from);
  const to = str(raw.to);
  const cmpRaw = str(raw.cmp);
  const cmpFrom = str(raw.cmpFrom);
  const cmpTo = str(raw.cmpTo);
  const court = str(raw.court);

  let range: RangePreset = PRESETS.includes(rangeRaw as RangePreset) ? (rangeRaw as RangePreset) : '30d';
  const out: AnalyticsSearch = { range };

  if (range === 'custom') {
    if (isIsoDate(from) && isIsoDate(to) && from <= to) {
      // F-37: a link longer than the server's 400 days keeps its end and shows
      // its last 400 days (the bar shows those dates), never a silent 30 days.
      const kept = clampRange(from, to);
      out.from = kept.from;
      out.to = kept.to;
    } else {
      // A custom range without two valid, ordered dates is meaningless — fall back.
      range = '30d';
      out.range = range;
    }
  }
  if (cmpRaw && BASES.includes(cmpRaw as CompareBasis)) out.cmp = cmpRaw as CompareBasis;
  if (out.cmp === 'custom') {
    if (isIsoDate(cmpFrom) && isIsoDate(cmpTo) && cmpFrom <= cmpTo && spanDays(cmpFrom, cmpTo) <= MAX_RANGE_DAYS) {
      out.cmpFrom = cmpFrom;
      out.cmpTo = cmpTo;
    } else {
      // A custom comparison without its two dates is last month's (resolveCompare).
      delete out.cmp;
    }
  }
  if (court && UUID.test(court)) out.court = court.toLowerCase();
  return out;
}
