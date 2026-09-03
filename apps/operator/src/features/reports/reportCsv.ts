/**
 * CSV shaping for the reports and the management panel — reuses the
 * analytics exporter (UTF-8 BOM, Latin digits) and adds the filename rule:
 * `<report>_<from>_<to>[_<filter>…].csv`, so a file on disk says what it holds.
 */
import { toCsv, type CsvCell } from '../analytics/csv';
import type { NormalizedColumn, ReportRow } from './reportTypes';
import type { Period } from '../../components/kit';

function cell(value: unknown): CsvCell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return JSON.stringify(value);
}

/** Header row from the localised labels, data rows raw, totals appended last when present. */
export function reportCsv(
  columns: readonly NormalizedColumn[],
  rows: readonly ReportRow[],
  totals: ReportRow | null | undefined,
  labelOf: (c: NormalizedColumn) => string,
  totalsLabel: string,
): string {
  const headers = columns.map(labelOf);
  const body: CsvCell[][] = rows.map((r) => columns.map((c) => cell(r[c.key])));
  if (totals && Object.keys(totals).length > 0) {
    body.push(columns.map((c, i) => (i === 0 && totals[c.key] == null ? totalsLabel : cell(totals[c.key]))));
  }
  return toCsv(headers, body);
}

const SAFE = /[^a-z0-9-]+/gi;

/** `courts_2026-09-01_2026-09-30_view-byHour_court-1a2b3c4d.csv` */
export function reportFilename(base: string, period: Period, filters: Record<string, string | undefined | null>): string {
  const parts = [base, period.from, period.to];
  for (const [k, v] of Object.entries(filters)) {
    if (!v) continue;
    const short = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(v) ? v.slice(0, 8) : v;
    parts.push(`${k}-${short.replace(SAFE, '')}`);
  }
  return `${parts.join('_')}.csv`;
}
