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
  /** Courts tab only: narrow every court figure to one court (a uuid). Carried across tabs, applied on Courts. */
  court?: string;
}

/** app.analytics_bounds refuses a span over 400 days; refuse it here so the owner never sees the raw error. */
export const MAX_RANGE_DAYS = 400;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function spanDays(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

const PRESETS: readonly RangePreset[] = ['today', '7d', '30d', '90d', 'custom'];
const BASES: readonly CompareBasis[] = ['prev', '4w', '52w'];

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function validateSearch(raw: Record<string, unknown>): AnalyticsSearch {
  const rangeRaw = str(raw.range);
  const from = str(raw.from);
  const to = str(raw.to);
  const cmpRaw = str(raw.cmp);
  const court = str(raw.court);

  let range: RangePreset = PRESETS.includes(rangeRaw as RangePreset) ? (rangeRaw as RangePreset) : '30d';
  const out: AnalyticsSearch = { range };

  if (range === 'custom') {
    if (isIsoDate(from) && isIsoDate(to) && from <= to && spanDays(from, to) <= MAX_RANGE_DAYS) {
      out.from = from;
      out.to = to;
    } else {
      // A custom range without two valid, ordered dates inside the server's
      // 400-day cap is meaningless — fall back.
      range = '30d';
      out.range = range;
    }
  }
  if (cmpRaw && BASES.includes(cmpRaw as CompareBasis)) out.cmp = cmpRaw as CompareBasis;
  if (court && UUID.test(court)) out.court = court.toLowerCase();
  return out;
}
