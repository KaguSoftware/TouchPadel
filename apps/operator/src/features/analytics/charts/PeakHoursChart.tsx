/**
 * 24 bars, one per venue hour. The peak hour is brown so "when is it busiest"
 * is answerable at a glance without reading the axis.
 */
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLocale } from '../../../lib/i18n';
import type { PeakHourRow } from '../shape';
import type { Formatters } from '../format';
import { AXIS, BAR_MUTED, GRID, HIGHLIGHT } from './colors';

export function PeakHoursChart({ rows, f }: { rows: readonly PeakHourRow[]; f: Formatters }) {
  const { tr, dir } = useLocale();
  const max = rows.reduce((m, r) => Math.max(m, r.views), 0);
  const data = rows.map((r) => ({ label: f.hour(r.hour), views: r.views, peak: max > 0 && r.views === max }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: AXIS }} stroke={GRID} interval={1} />
        <YAxis tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} tickFormatter={(v: number) => f.compact(v)} />
        <Tooltip
          wrapperStyle={{ direction: dir }}
          contentStyle={{ fontSize: 'var(--tp-fs-sm)' }}
          formatter={(value) => [f.num(Number(value)), tr('analytics.cards.viewsSeries')] as [string, string]}
        />
        <Bar dataKey="views" name={tr('analytics.cards.viewsSeries')} radius={[2, 2, 0, 0]}>
          {data.map((d) => (
            <Cell key={d.label} fill={d.peak ? HIGHLIGHT : BAR_MUTED} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
