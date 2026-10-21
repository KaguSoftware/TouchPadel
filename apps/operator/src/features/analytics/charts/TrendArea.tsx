/**
 * One measure over the days of the period as a line with a faint area under
 * it (dataviz: "area for a single series"), where a column per day turned a
 * month into a comb. The busiest day is marked and labelled, the one direct
 * label the chart carries; a crosshair tooltip reads any other day. Same
 * chrome as the other Recharts charts on the page (CountBars, StackedBars).
 *
 * Straight segments, not a smoothed curve: a curve draws values between days
 * that never happened. A null day (closed, nothing recorded) is a gap in the
 * line, never a zero, so "closed" and "open but sold nothing" stay apart.
 * `syncId` moves its crosshair with another chart's (the café trend's
 * engagement lines under it).
 */
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLocale } from '../../../lib/i18n';
import { useChartColors } from './colors';

export interface TrendRow {
  label: string;
  value: number | null;
}

export function TrendArea({
  rows,
  format,
  name,
  interval = 0,
  minTickGap,
  syncId,
  axisWidth = 44,
  tooltipFormat,
}: {
  rows: readonly TrendRow[];
  /** Axis ticks and the peak label (compact). */
  format: (n: number) => string;
  name: string;
  interval?: number | 'preserveStartEnd';
  minTickGap?: number;
  syncId?: string;
  axisWidth?: number;
  /** The tooltip's value, when it reads better in full (money) than the compact tick. */
  tooltipFormat?: (n: number) => string;
}) {
  const { AXIS, GRID, SERIES_1, SURFACE } = useChartColors();
  const { dir } = useLocale();
  const peak = rows.reduce<{ label: string; value: number } | null>((best, r) => (r.value != null && r.value > 0 && (!best || r.value > best.value) ? { label: r.label, value: r.value } : best), null);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={[...rows]} syncId={syncId} margin={{ top: 18, right: 12, bottom: 4, left: 4 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} interval={interval} minTickGap={minTickGap} />
        <YAxis tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} tickFormatter={format} width={axisWidth} />
        <Tooltip
          cursor={{ stroke: SERIES_1, strokeOpacity: 0.35 }}
          wrapperStyle={{ direction: dir }}
          contentStyle={{ fontSize: 'var(--tp-fs-sm)' }}
          formatter={(value) => [(tooltipFormat ?? format)(Number(value)), name] as [string, string]}
        />
        <Area
          type="linear"
          dataKey="value"
          name={name}
          stroke={SERIES_1}
          strokeWidth={2}
          fill={SERIES_1}
          fillOpacity={0.12}
          connectNulls={false}
          activeDot={{ r: 4, stroke: SURFACE, strokeWidth: 2 }}
          // A day between two gaps has no segment to draw, so it gets a dot or it would vanish.
          dot={(p: { cx?: number; cy?: number; index?: number }) => {
            const i = p.index ?? 0;
            const lone = rows[i]?.value != null && rows[i - 1]?.value == null && rows[i + 1]?.value == null;
            return lone && p.cx != null && p.cy != null ? <circle key={i} cx={p.cx} cy={p.cy} r={3} fill={SERIES_1} /> : <g key={i} />;
          }}
        />
        {peak && (
          <ReferenceDot
            x={peak.label}
            y={peak.value}
            r={4}
            fill={SERIES_1}
            stroke={SURFACE}
            strokeWidth={2}
            label={{ value: format(peak.value), position: 'top', fontSize: 11, fill: AXIS }}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
