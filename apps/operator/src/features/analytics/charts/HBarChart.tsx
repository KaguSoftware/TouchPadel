/**
 * Generic horizontal bar chart (best sellers, table activity, category
 * popularity). Long item names get a wide category axis; the value formatter is
 * injected so money and counts read the same as everywhere else on the page.
 */
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLocale } from '../../../lib/i18n';
import { AXIS, BAR_MUTED, GRID, HIGHLIGHT } from './colors';

export interface HBarRow {
  label: string;
  value: number;
  /** Highlighted in brown (the peak / the featured row). */
  highlight?: boolean;
}

export function HBarChart({
  rows,
  format,
  axisWidth = 130,
  name,
}: {
  rows: readonly HBarRow[];
  format: (n: number) => string;
  axisWidth?: number;
  name: string;
}) {
  const { dir } = useLocale();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={[...rows]} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} tickFormatter={format} />
        <YAxis type="category" dataKey="label" width={axisWidth} tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} interval={0} />
        <Tooltip
          wrapperStyle={{ direction: dir }}
          contentStyle={{ fontSize: 'var(--tp-fs-sm)' }}
          formatter={(value) => [format(Number(value)), name] as [string, string]}
        />
        <Bar dataKey="value" name={name} radius={[0, 2, 2, 0]}>
          {rows.map((row, i) => (
            <Cell key={`${row.label}-${i}`} fill={row.highlight ? HIGHLIGHT : BAR_MUTED} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
