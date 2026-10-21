/**
 * The arithmetic behind the hand-drawn SVG charts (Donut, RingMeter,
 * Sparkline, the heatmap's totals), kept out of the components so a node
 * test can pin it. Angles are radians, 0 at twelve o'clock, clockwise: a
 * ring reads the same in both directions, so nothing here mirrors for RTL.
 */

export interface Slice {
  key: string;
  value: number;
}

export interface Arc {
  key: string;
  value: number;
  /** 0..100, of the whole ring. */
  share: number;
  start: number;
  end: number;
}

const TAU = Math.PI * 2;

/**
 * The slices laid round the ring in the given order. Negative and zero values
 * take no arc (a refund cannot be a slice). `gap` is the empty angle left
 * between neighbours, the 2px surface gap dataviz asks for; a lone slice
 * closes the ring with no gap at all.
 */
export function layoutArcs(slices: readonly Slice[], gap = 0.035): Arc[] {
  const live = slices.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const total = live.reduce((sum, s) => sum + s.value, 0);
  if (total <= 0) return [];
  const pad = live.length > 1 ? gap : 0;
  const usable = TAU - pad * live.length;
  let at = pad / 2;
  return live.map((s) => {
    const sweep = (s.value / total) * usable;
    const arc = { key: s.key, value: s.value, share: (s.value / total) * 100, start: at, end: at + sweep };
    at += sweep + pad;
    return arc;
  });
}

function point(cx: number, cy: number, r: number, angle: number): string {
  return `${round(cx + r * Math.sin(angle))} ${round(cy - r * Math.cos(angle))}`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * One ring segment between two radii. A segment that is the whole ring is
 * drawn as two halves, because an SVG arc whose ends meet draws nothing.
 */
export function arcPath(cx: number, cy: number, inner: number, outer: number, start: number, end: number): string {
  if (end - start >= TAU - 1e-6) {
    const mid = start + Math.PI;
    return `${arcPath(cx, cy, inner, outer, start, mid)} ${arcPath(cx, cy, inner, outer, mid, start + TAU)}`;
  }
  const large = end - start > Math.PI ? 1 : 0;
  return [
    `M ${point(cx, cy, outer, start)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${point(cx, cy, outer, end)}`,
    `L ${point(cx, cy, inner, end)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${point(cx, cy, inner, start)}`,
    'Z',
  ].join(' ');
}

/** A 0..100 rate as the sweep of a meter ring, clamped so 140% never laps it. */
export function meterSweep(pct: number | null | undefined): number {
  if (pct == null || !Number.isFinite(pct) || pct <= 0) return 0;
  return (Math.min(100, pct) / 100) * TAU;
}

export interface SparkPoint {
  x: number;
  y: number;
}

/**
 * A series as points in a `width` × `height` box. The floor is zero, not the
 * series minimum, so a quiet week never draws as a cliff; `pad` keeps the
 * line's ends and its 2px stroke inside the box.
 */
export function sparkPoints(values: readonly number[], width: number, height: number, pad = 3): SparkPoint[] {
  if (values.length === 0) return [];
  const max = Math.max(0, ...values.map((v) => (Number.isFinite(v) ? v : 0)));
  const span = height - pad * 2;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  return values.map((v, i) => ({
    x: round(values.length > 1 ? pad + i * step : width / 2),
    y: round(max > 0 ? pad + span - (Math.max(0, Number.isFinite(v) ? v : 0) / max) * span : pad + span),
  }));
}

/** The line through the points, and the same line closed down to the floor for the area under it. */
export function sparkPaths(points: readonly SparkPoint[], height: number): { line: string; area: string } {
  if (points.length === 0) return { line: '', area: '' };
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return { line, area: `${line} L ${last.x} ${height} L ${first.x} ${height} Z` };
}

/** The index of the point nearest an x position: what the pointer is over. */
export function nearestIndex(points: readonly SparkPoint[], x: number): number {
  let best = 0;
  for (let i = 1; i < points.length; i++) {
    if (Math.abs(points[i]!.x - x) < Math.abs(points[best]!.x - x)) best = i;
  }
  return best;
}

export interface HeatTotals {
  /** One per hour, 0..23; null when no open cell fell in that hour. */
  hours: (number | null)[];
  /** One per weekday, 0 = Sunday; null when the day had no open cell. */
  days: (number | null)[];
}

/**
 * Row and column totals of a week grid, for measures that add up (bookings,
 * revenue, orders). Closed cells and cells under the sample floor add
 * nothing; an hour or day with no open cell at all is null, not 0, so the
 * margin can tell "closed" from "nothing sold". Rates do not add: a rate's
 * margins come from the server's own roll-up (byHour, byDow), not from here.
 */
export function sumTotals(cells: readonly { dow: number; hour: number; value: number; open?: boolean; thin?: boolean }[]): HeatTotals {
  const hours: (number | null)[] = Array.from({ length: 24 }, () => null);
  const days: (number | null)[] = Array.from({ length: 7 }, () => null);
  for (const c of cells) {
    if (c.open === false || c.thin || c.hour < 0 || c.hour > 23 || c.dow < 0 || c.dow > 6) continue;
    const v = Number.isFinite(c.value) ? c.value : 0;
    hours[c.hour] = (hours[c.hour] ?? 0) + v;
    days[c.dow] = (days[c.dow] ?? 0) + v;
  }
  return { hours, days };
}
