/**
 * Builders for a chart's table/CSV twin (ChartCard `twin`), so every chart on
 * both tabs hands the same rows to the table view and the download.
 */
import type { ChartTwin } from './ChartCard';

export function barTwin(
  rows: readonly { label: string; value: number | null }[],
  labelHeader: string,
  valueHeader: string,
  file: string,
): ChartTwin {
  return {
    columns: [
      { key: 'label', label: labelHeader },
      { key: 'value', label: valueHeader, numeric: true },
    ],
    rows: rows.map((r) => ({ label: r.label, value: r.value })),
    file,
  };
}

export function seriesTwin(
  rows: readonly ({ label: string } & Record<string, number | string | null | undefined>)[],
  labelHeader: string,
  series: readonly { key: string; name: string }[],
  file: string,
): ChartTwin {
  return {
    columns: [{ key: 'label', label: labelHeader }, ...series.map((s) => ({ key: s.key, label: s.name, numeric: true }))],
    rows: rows.map((r) => ({ ...r })),
    file,
  };
}

export function heatTwin(
  cells: readonly { day: string; hour: string; value: number | null }[],
  dayHeader: string,
  hourHeader: string,
  valueHeader: string,
  file: string,
): ChartTwin {
  return {
    columns: [
      { key: 'day', label: dayHeader },
      { key: 'hour', label: hourHeader },
      { key: 'value', label: valueHeader, numeric: true },
    ],
    rows: cells.map((c) => ({ day: c.day, hour: c.hour, value: c.value })),
    file,
  };
}
