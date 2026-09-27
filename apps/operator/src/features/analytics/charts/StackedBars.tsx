/**
 * Stacked columns for two or three series that are the SUBJECT of the chart
 * (mobile vs desk, cancelled vs no-show, court fee vs cafe). Hues come from the
 * validated categorical trio in fixed order, so a series keeps its colour
 * whatever the filter shows; a legend is always present because the identity
 * channel must never be colour alone. A 1px surface stroke stands in for the
 * 2px gap between segments that dataviz asks for.
 */
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLocale } from '../../../lib/i18n';
import { useChartColors } from './colors';

export interface StackedSeries {
  key: string;
  name: string;
}

export type StackedRow = { label: string } & Record<string, number | string | boolean>;

export function StackedBars({
  rows,
  series,
  format,
  tickFontSize = 11,
  interval = 0,
  thinKey,
}: {
  rows: readonly StackedRow[];
  /** At most three; order fixes the hue. */
  series: readonly StackedSeries[];
  format: (n: number) => string;
  tickFontSize?: number;
  interval?: number;
  /** A boolean row field: rows where it is true are painted muted (a thin sample, not a small value). */
  thinKey?: string;
}) {
  const { AXIS, BAR_CURSOR, GRID, SERIES, SURFACE } = useChartColors();
  const { dir } = useLocale();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={[...rows]} margin={{ top: 4, right: 8, bottom: 4, left: 4 }} barCategoryGap="25%">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: tickFontSize, fill: AXIS }} stroke={GRID} interval={interval} />
        <YAxis tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} tickFormatter={format} width={44} />
        <Tooltip
          cursor={{ fill: BAR_CURSOR }}
          wrapperStyle={{ direction: dir }}
          contentStyle={{ fontSize: 'var(--tp-fs-sm)' }}
          formatter={(value, name) => [format(Number(value)), String(name)] as [string, string]}
        />
        <Legend wrapperStyle={{ fontSize: 'var(--tp-fs-xs)', direction: dir }} />
        {series.slice(0, 3).map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stackId="stack"
            fill={SERIES[i] ?? SERIES[0]}
            stroke={SURFACE}
            strokeWidth={1}
            maxBarSize={24}
            radius={i === series.length - 1 ? [2, 2, 0, 0] : undefined}
          >
            {rows.map((r, j) => (
              <Cell key={`${s.key}-${j}`} fillOpacity={thinKey && r[thinKey] === true ? 0.35 : 1} />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
