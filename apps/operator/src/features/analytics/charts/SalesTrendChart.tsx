/**
 * Sales per business day as columns. `revenue: null` days are real gaps (the
 * cafe was closed / nothing recorded): Recharts skips a null bar rather than
 * drawing a zero, which would read as "open but sold nothing". Paired with
 * EngagementTrendChart under one card; `syncId` moves both crosshairs
 * together, which is how the old dual-axis chart's one job (reading sales
 * against views on the same day) survives with one axis per plot.
 */
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SalesVsEngagementDay } from '@touch/core';
import { useLocale } from '../../../lib/i18n';
import type { Formatters } from '../format';
import { useChartColors } from './colors';

export const TREND_SYNC_ID = 'cafeTrend';

export function SalesTrendChart({ rows, f }: { rows: readonly SalesVsEngagementDay[]; f: Formatters }) {
  const { AXIS, BAR_CURSOR, GRID, SERIES_1 } = useChartColors();
  const { tr, dir } = useLocale();
  const data = rows.map((r) => ({ label: f.date(r.date), revenue: r.revenue }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} syncId={TREND_SYNC_ID} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} minTickGap={16} />
        <YAxis tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} tickFormatter={(v: number) => f.compact(v)} width={52} />
        <Tooltip
          cursor={{ fill: BAR_CURSOR }}
          wrapperStyle={{ direction: dir }}
          contentStyle={{ fontSize: 'var(--tp-fs-sm)' }}
          formatter={(value) => [f.money(Number(value)), tr('analytics.cards.revenue')] as [string, string]}
        />
        <Bar dataKey="revenue" name={tr('analytics.cards.revenue')} fill={SERIES_1} radius={[2, 2, 0, 0]} maxBarSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
}
