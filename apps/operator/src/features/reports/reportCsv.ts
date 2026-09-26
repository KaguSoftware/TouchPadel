/**
 * The reports' CSV filename rule: `<report>_<from>_<to>[_<filter>…].csv`, so
 * a file on disk says what it holds. The CSV itself is the analytics exporter
 * (UTF-8 BOM, Latin digits), fed by ReportParts' `tableCsv`.
 */
import type { Period } from '../../components/kit';

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
