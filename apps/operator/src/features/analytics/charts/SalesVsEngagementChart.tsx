/**
 * Sales bars against menu views + waiter calls (dual axis). `revenue: null` days
 * are real gaps (the café was closed / nothing was recorded) — Recharts skips a
 * null bar rather than drawing a zero, which would read as "open but sold nothing".
 */
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SalesVsEngagementDay } from '@touch/core';
import { useLocale } from '../../../lib/i18n';
import type { Formatters } from '../format';
import { BLUE, BROWN, GRID, MUTED } from './colors';

export function SalesVsEngagementChart({ rows, f }: { rows: readonly SalesVsEngagementDay[]; f: Formatters }) {
  const { tr, dir } = useLocale();
  const data = rows.map((r) => ({ ...r, label: f.date(r.date) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: MUTED }} stroke={GRID} minTickGap={16} />
        <YAxis yAxisId="money" tick={{ fontSize: 11, fill: MUTED }} stroke={GRID} tickFormatter={(v: number) => f.compact(v)} />
        <YAxis yAxisId="count" orientation="right" tick={{ fontSize: 11, fill: MUTED }} stroke={GRID} tickFormatter={(v: number) => f.compact(v)} />
        <Tooltip
          wrapperStyle={{ direction: dir }}
          contentStyle={{ fontSize: '0.8rem' }}
          formatter={(value, name) => [name === tr('analytics.cards.revenue') ? f.money(Number(value)) : f.num(Number(value)), String(name)] as [string, string]}
        />
        <Legend wrapperStyle={{ fontSize: '0.78rem', direction: dir }} />
        <Bar yAxisId="money" dataKey="revenue" name={tr('analytics.cards.revenue')} fill={BLUE} radius={[2, 2, 0, 0]} />
        <Line yAxisId="count" type="monotone" dataKey="views" name={tr('analytics.cards.viewsSeries')} stroke={BROWN} dot={false} strokeWidth={2} />
        <Line yAxisId="count" type="monotone" dataKey="waiterCalls" name={tr('analytics.cards.callsSeries')} stroke={MUTED} dot={false} strokeWidth={1.5} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
