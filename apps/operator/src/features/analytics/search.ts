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

  let range: RangePreset = PRESETS.includes(rangeRaw as RangePreset) ? (rangeRaw as RangePreset) : '30d';
  const out: AnalyticsSearch = { range };

  if (range === 'custom') {
    if (isIsoDate(from) && isIsoDate(to)) {
      out.from = from;
      out.to = to;
    } else {
      // A custom range without two valid dates is meaningless — fall back.
      range = '30d';
      out.range = range;
    }
  }
  if (cmpRaw && BASES.includes(cmpRaw as CompareBasis)) out.cmp = cmpRaw as CompareBasis;
  return out;
}
