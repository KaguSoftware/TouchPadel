/**
 * A table cell's figure with a thin bar under it, so a column of rates reads
 * as a ranking before a single number is read (the court table's occupancy).
 * The bar is decoration of the printed figure, never the figure itself; the
 * track is a light step of the same ramp (dataviz meter). The bar grows from
 * the cell's start edge, so it follows the page's direction.
 */
import type { ReactNode } from 'react';
import { useChartColors } from './colors';

export function InlineMeter({ pct, children, emphasis = false }: { pct: number | null; children: ReactNode; emphasis?: boolean }) {
  const { HEAT_RAMP, HIGHLIGHT, BAR_MUTED } = useChartColors();
  const width = pct == null || !Number.isFinite(pct) ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <span style={{ display: 'inline-grid', gap: 3, minInlineSize: '4.5rem', justifyItems: 'end' }}>
      <span>{children}</span>
      <span aria-hidden="true" style={{ display: 'block', inlineSize: '100%', blockSize: 4, borderRadius: 2, background: HEAT_RAMP[1], overflow: 'hidden' }}>
        <span style={{ display: 'block', inlineSize: `${width}%`, blockSize: '100%', borderRadius: 2, background: emphasis ? HIGHLIGHT : BAR_MUTED }} />
      </span>
    </span>
  );
}
