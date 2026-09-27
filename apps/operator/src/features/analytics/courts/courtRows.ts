/**
 * Per-court bar charts plot at most `CHART_COURTS` bars: the highest values,
 * plus the court the filter selected if it fell outside them. The chart's
 * table twin and CSV keep every court, and the card says the chart is cut.
 */
export const CHART_COURTS = 12;

export function topRows<T extends { value: number; highlight?: boolean }>(rows: readonly T[], limit = CHART_COURTS): T[] {
  if (rows.length <= limit) return [...rows];
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, limit);
  const selected = sorted.slice(limit).find((r) => r.highlight);
  return selected ? [...top.slice(0, limit - 1), selected] : top;
}
