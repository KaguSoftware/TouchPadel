/**
 * Sales per business day as a line with a faint area under it, the busiest
 * day labelled (2026-10-19: a month of columns read like a comb; the shop's
 * day chart made the same move). `revenue: null` days are real gaps (the cafe
 * was closed / nothing recorded): the line breaks there rather than dropping
 * to zero, which would read as "open but sold nothing". Paired with
 * EngagementTrendChart under one card; `syncId` moves both crosshairs
 * together, which is how the old dual-axis chart's one job (reading sales
 * against views on the same day) survives with one axis per plot.
 */
import type { TrendDay } from './EngagementTrendChart';
import { useLocale } from '../../../lib/i18n';
import type { Formatters } from '../format';
import { TrendArea } from './TrendArea';

export const TREND_SYNC_ID = 'cafeTrend';

export function SalesTrendChart({ rows, f }: { rows: readonly TrendDay[]; f: Formatters }) {
  const { tr } = useLocale();
  return (
    <TrendArea
      rows={rows.map((r) => ({ label: f.date(r.date), value: r.revenue }))}
      format={(n) => f.compact(n)}
      tooltipFormat={(n) => f.money(n)}
      name={tr('analytics.cards.revenue')}
      interval="preserveStartEnd"
      minTickGap={16}
      syncId={TREND_SYNC_ID}
      axisWidth={52}
    />
  );
}
