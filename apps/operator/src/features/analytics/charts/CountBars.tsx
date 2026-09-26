/**
 * Generic vertical bars: one series, the peak emphasised. Hours, weekdays,
 * durations, lead-time buckets, visit buckets, losses by hour all use
 * this so every "which one is biggest" chart on the page reads the same way.
 * Emphasis is one accent + grey (dataviz: no rainbow on nominal categories);
 * a single series needs no legend, the card title names the measure.
 */
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useLocale } from '../../../lib/i18n';
import { useChartColors } from './colors';

export interface CountBarRow {
  label: string;
  value: number;
  /** Force emphasis (defaults to the maximum value). */
  highlight?: boolean;
  /** Under the sample floor: painted muted and never the peak. */
  thin?: boolean;
}

export function CountBars({
  rows,
  format,
  name,
  tickFontSize = 11,
  interval = 0,
  emphasise = 'max',
}: {
  rows: readonly CountBarRow[];
  format: (n: number) => string;
  /** Series name in the tooltip. */
  name: string;
  tickFontSize?: number;
  /** Recharts XAxis interval: 0 prints every label, 1 every other one. */
  interval?: number;
  /** 'max' emphasises the peak, 'rows' trusts each row's `highlight`, 'none' paints one colour. */
  emphasise?: 'max' | 'rows' | 'none';
}) {
  const { AXIS, BAR_CURSOR, BAR_MUTED, GRID, HIGHLIGHT } = useChartColors();
  const { dir } = useLocale();
  const max = rows.reduce((m, r) => (r.thin ? m : Math.max(m, r.value)), 0);
  const data = rows.map((r) => ({
    label: r.label,
    value: r.value,
    thin: Boolean(r.thin),
    peak: r.thin ? false : emphasise === 'rows' ? Boolean(r.highlight) : emphasise === 'max' ? max > 0 && r.value === max : false,
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 4 }} barCategoryGap="25%">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: tickFontSize, fill: AXIS }} stroke={GRID} interval={interval} />
        <YAxis tick={{ fontSize: 11, fill: AXIS }} stroke={GRID} tickFormatter={format} width={44} />
        <Tooltip
          cursor={{ fill: BAR_CURSOR }}
          wrapperStyle={{ direction: dir }}
          contentStyle={{ fontSize: 'var(--tp-fs-sm)' }}
          formatter={(value) => [format(Number(value)), name] as [string, string]}
        />
        <Bar dataKey="value" name={name} radius={[2, 2, 0, 0]} maxBarSize={24}>
          {data.map((d, i) => (
            <Cell key={`${d.label}-${i}`} fill={d.thin ? BAR_MUTED : emphasise === 'none' ? HIGHLIGHT : d.peak ? HIGHLIGHT : BAR_MUTED} fillOpacity={d.thin ? 0.35 : 1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
