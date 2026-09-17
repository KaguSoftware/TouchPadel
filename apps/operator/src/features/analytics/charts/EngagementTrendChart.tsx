/**
 * Menu views and waiter calls per business day: two lines on ONE count axis,
 * synced with SalesTrendChart above it. Two series, so the legend is always
 * present; the hues are the fixed second and third of the validated trio.
 *
 * `showViews` is false when guest-menu data did not arrive: the views line
 * used to lie flat at zero then, which reads as "nobody opened the menu".
 * Waiter calls come from the till, so they still plot.
 */
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SalesVsEngagementDay } from '@touch/core';
import { useLocale } from '../../../lib/i18n';
import type { Formatters } from '../format';
import { AXIS, GRID, SERIES_2, SERIES_3 } from './colors';
import { TREND_SYNC_ID } from './SalesTrendChart';

export function EngagementTrendChart({ rows, f, showViews = true }: { rows: readonly SalesVsEngagementDay[]; f: Formatters; showViews?: boolean }) {
  const { tr, dir } = useLocale();
  const data = rows.map((r) => ({ label: f.date(r.date), views: r.views, waiterCalls: r.waiterCalls }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} syncId={TREND_SYNC_ID} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} minTickGap={16} />
        <YAxis tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} tickFormatter={(v: number) => f.compact(v)} width={52} />
        <Tooltip
          cursor={{ stroke: GRID }}
          wrapperStyle={{ direction: dir }}
          contentStyle={{ fontSize: 'var(--tp-fs-sm)' }}
          formatter={(value, name) => [f.num(Number(value)), String(name)] as [string, string]}
        />
        <Legend wrapperStyle={{ fontSize: 'var(--tp-fs-xs)', direction: dir }} />
        {showViews && <Line type="linear" dataKey="views" name={tr('analytics.cards.viewsSeries')} stroke={SERIES_2} dot={{ r: 2 }} strokeWidth={2} />}
        {/* Straight segments with a dot per day: a smoothed curve drew values between days that never happened. */}
        <Line type="linear" dataKey="waiterCalls" name={tr('analytics.cards.callsSeries')} stroke={SERIES_3} dot={{ r: 2 }} strokeWidth={1.5} />
      </LineChart>
    </ResponsiveContainer>
  );
}
