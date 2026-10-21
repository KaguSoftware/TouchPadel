/**
 * A figure's days as a small line under it: the shape of the period, not its
 * values (the tile's number is the value, the drill and the CSV are the
 * rows). Accent line, a faint area under it, the last day marked with a dot
 * in a surface ring (dataviz marks: 2px line, ringed end-marker). The floor
 * is zero, so a quiet week never draws as a cliff.
 *
 * Pointing at it prints that day's reading in the tile's corner; the box never
 * moves, so nothing jumps. The paths stretch to the tile through a fixed
 * viewBox with non-scaling strokes, and the dots are HTML placed by
 * percentage, so they stay round at any width. Time runs left to right in
 * both languages, as on every other time axis on the page.
 */
import { useState, type PointerEvent } from 'react';
import { nearestIndex, sparkPaths, sparkPoints } from './geometry';
import { useLocale } from '../../../lib/i18n';
import { useChartColors } from './colors';

const W = 240;

export interface SparkSeries {
  values: readonly number[];
  /** One per value: the day it is ("Tue 14 Oct"), or the month on a by-month line. */
  labels: readonly string[];
  format: (n: number) => string;
  /** A point is a month, not a day (monthSeries). */
  byMonth?: boolean;
}

export function Sparkline({ series, height = 36, label }: { series: SparkSeries; height?: number; label: string }) {
  const { SERIES_1, SURFACE } = useChartColors();
  // The box is dir=ltr (time runs left to right); the reading goes to the corner
  // away from the tile's figure, which sits at the page's start side.
  const { dir } = useLocale();
  const [at, setAt] = useState<number | null>(null);
  const points = sparkPoints(series.values, W, height);
  if (points.length < 2) return null;
  const { line, area } = sparkPaths(points, height);
  const last = points.length - 1;
  const shown = at ?? last;
  const dot = points[shown]!;
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    setAt(nearestIndex(points, ((e.clientX - box.left) / box.width) * W));
  };
  const peak = Math.max(...series.values);
  return (
    <div
      dir="ltr"
      role="img"
      aria-label={`${label}: ${series.labels[0] ?? ''} – ${series.labels[last] ?? ''}, ${series.format(series.values[last] ?? 0)} · max ${series.format(peak)}`}
      onPointerMove={move}
      onPointerLeave={() => setAt(null)}
      style={{ position: 'relative', blockSize: height, inlineSize: '100%', marginBlockStart: 'var(--tp-sp-1)', cursor: 'crosshair' }}
    >
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
        <path d={area} fill={SERIES_1} fillOpacity={0.12} />
        <path d={line} fill="none" stroke={SERIES_1} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {at != null && <line x1={dot.x} x2={dot.x} y1={0} y2={height} stroke={SERIES_1} strokeOpacity={0.35} strokeWidth={1} vectorEffect="non-scaling-stroke" />}
      </svg>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          insetInlineStart: `${(dot.x / W) * 100}%`,
          insetBlockStart: `${(dot.y / height) * 100}%`,
          inlineSize: 8,
          blockSize: 8,
          marginInlineStart: -4,
          marginBlockStart: -4,
          borderRadius: '50%',
          background: SERIES_1,
          boxShadow: `0 0 0 2px ${SURFACE}`,
          pointerEvents: 'none',
        }}
      />
      {at != null && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            insetBlockEnd: '100%',
            ...(dir === 'rtl' ? { insetInlineStart: 0 } : { insetInlineEnd: 0 }),
            marginBlockEnd: 2,
            fontSize: 'var(--tp-fs-xs)',
            fontWeight: 600,
            color: 'var(--tp-fg)',
            whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums',
            pointerEvents: 'none',
          }}
        >
          {series.labels[at]} · {series.format(series.values[at] ?? 0)}
        </span>
      )}
    </div>
  );
}
