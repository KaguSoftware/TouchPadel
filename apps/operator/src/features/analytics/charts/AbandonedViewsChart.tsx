/**
 * "Looked, not bought" — per item, the abandoned views split by how long the
 * guest stayed on the item (5–10 s / 10–20 s / 20 s+). Day-level suppression is
 * already applied by `abandonedViewsNet`, so every bar here is a view on a day
 * the item did NOT sell.
 */
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AbandonedView } from '@touch/core';
import { pickLocale } from '@touch/core';
import { useLocale } from '../../../lib/i18n';
import type { Formatters } from '../format';
import { DWELL, GRID, MUTED } from './colors';

export function AbandonedViewsChart({ rows, f }: { rows: readonly AbandonedView[]; f: Formatters }) {
  const { tr, dir, locale } = useLocale();
  const data = rows.slice(0, 8).map((r) => ({
    label: pickLocale({ en: r.nameEn, ar: r.nameAr }, locale) || r.id,
    short: r.b5to10,
    medium: r.b10to20,
    long: r.b20plus,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: MUTED }} stroke={GRID} tickFormatter={(v: number) => f.num(v)} />
        <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11, fill: MUTED }} stroke={GRID} interval={0} />
        <Tooltip wrapperStyle={{ direction: dir }} contentStyle={{ fontSize: '0.8rem' }} formatter={(value) => f.num(Number(value))} />
        <Legend wrapperStyle={{ fontSize: '0.78rem', direction: dir }} />
        <Bar dataKey="short" stackId="d" name={tr('analytics.cards.dwellShort')} fill={DWELL[0]} />
        <Bar dataKey="medium" stackId="d" name={tr('analytics.cards.dwellMedium')} fill={DWELL[1]} />
        <Bar dataKey="long" stackId="d" name={tr('analytics.cards.dwellLong')} fill={DWELL[2]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
