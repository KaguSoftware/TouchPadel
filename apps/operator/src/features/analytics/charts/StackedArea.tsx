/**
 * Two or three series that add up to a whole, over time, as stacked areas
 * (guests by week: new on returning). Where StackedBars cuts the weeks into
 * separate columns, the areas show the whole and its make-up moving together.
 * Hues are the validated trio in fixed order, as on StackedBars, so a series
 * keeps its colour across the page; a legend is always present (identity is
 * never colour alone), and the tooltip reads every series of the week.
 * Straight segments: a curve would draw weeks that never happened.
 */
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLocale } from '../../../lib/i18n';
import { useChartColors } from './colors';
import type { StackedRow, StackedSeries } from './StackedBars';

export function StackedArea({
  rows,
  series,
  format,
  interval = 0,
}: {
  rows: readonly StackedRow[];
  /** At most three; order fixes the hue. */
  series: readonly StackedSeries[];
  format: (n: number) => string;
  interval?: number;
}) {
  const { AXIS, GRID, SERIES, SURFACE } = useChartColors();
  const { dir } = useLocale();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={[...rows]} margin={{ top: 8, right: 24, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} interval={interval} />
        <YAxis tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} tickFormatter={format} width={44} allowDecimals={false} />
        <Tooltip
          cursor={{ stroke: GRID }}
          wrapperStyle={{ direction: dir }}
          contentStyle={{ fontSize: 'var(--tp-fs-sm)' }}
          formatter={(value, name) => [format(Number(value)), String(name)] as [string, string]}
        />
        <Legend wrapperStyle={{ fontSize: 'var(--tp-fs-xs)', direction: dir }} />
        {series.slice(0, 3).map((s, i) => (
          <Area
            key={s.key}
            type="linear"
            dataKey={s.key}
            name={s.name}
            stackId="stack"
            stroke={SERIES[i] ?? SERIES[0]}
            strokeWidth={2}
            fill={SERIES[i] ?? SERIES[0]}
            fillOpacity={0.35}
            activeDot={{ r: 3.5, stroke: SURFACE, strokeWidth: 2 }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
