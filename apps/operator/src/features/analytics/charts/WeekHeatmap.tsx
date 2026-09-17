/**
 * Day × hour heatmap as a CSS grid (no Recharts: a 7×24 matrix of coloured
 * cells is cheaper and sharper as DOM). Sequential ramp, one hue; the busiest
 * cell is the ramp's own darkest step, never a second colour. Generic over the
 * measure: guest views, till orders, court occupancy and attach rate all plot
 * through it, the caller names the unit and formats the value.
 *
 * Hover layer: the cell under the pointer (or the focused cell) prints its
 * reading on a reserved line under the grid, so the layout never jumps and a
 * screen reader hears the same text. Cells the venue is closed for (`open:
 * false`) are hatched, not blank, so "nothing booked" and "not open" stay
 * different. Every value is also in the card's table twin, so nothing is
 * gated on hovering.
 */
import { useState, type CSSProperties } from 'react';
import { useLocale } from '../../../lib/i18n';
import { weekdayName } from '../copy';
import type { Formatters } from '../format';
import { GRID, HEAT_RAMP, heatColor } from './colors';

export interface HeatValue {
  dow: number;
  hour: number;
  value: number;
  /** `false` hatches the cell (venue closed); default open. */
  open?: boolean;
  /** Under the sample floor: painted muted, never the peak, and read out with `label`. */
  thin?: boolean;
  /** Readout text for a thin cell ("3 of 7") in place of the formatted value. */
  label?: string;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DOWS = [0, 1, 2, 3, 4, 5, 6];

const closedGround: CSSProperties = {
  background: 'repeating-linear-gradient(135deg, var(--tp-surface-2) 0 3px, var(--tp-surface) 3px 6px)',
};

export function WeekHeatmap({
  cells,
  f,
  format,
  unit,
  hint,
}: {
  cells: readonly HeatValue[];
  f: Formatters;
  /** Formats one cell's value for the readout ("12 bookings", "82%"). */
  format: (value: number) => string;
  /** What is being measured, for the accessible summary. */
  unit: string;
  /** Idle readout text (what hovering will reveal). */
  hint: string;
}) {
  const { tr } = useLocale();
  const byKey = new Map(cells.map((c) => [`${c.dow}:${c.hour}`, c]));
  const max = cells.reduce((m, c) => Math.max(m, c.open === false || c.thin ? 0 : c.value), 0);
  const [active, setActive] = useState<string | null>(null);
  const activeCell = active ? byKey.get(active) : undefined;
  const activeParts = active?.split(':').map(Number) ?? [];
  const activeDow = activeParts[0] ?? 0;
  const activeHour = activeParts[1] ?? 0;

  const readout = active
    ? `${weekdayName(tr, activeDow)} ${f.hour(activeHour)} · ${
        activeCell?.open === false
          ? tr('ws.analytics.heatmap.closed')
          : activeCell?.thin
            ? (activeCell.label ?? format(activeCell.value))
            : `${format(activeCell?.value ?? 0)}${max > 0 ? ` · ${tr('ws.analytics.heatmap.ofPeak', { pct: f.pct(((activeCell?.value ?? 0) / max) * 100) })}` : ''}`
      }`
    : hint;

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <div dir="ltr" style={{ overflowX: 'auto' }} onPointerLeave={() => setActive(null)}>
        <div
          role="img"
          aria-label={`${unit}: ${cells.length} ${tr('ws.analytics.heatmap.cells')}`}
          style={{ display: 'grid', gridTemplateColumns: `max-content repeat(24, minmax(0, 1fr))`, gap: '1px', minInlineSize: '42rem' }}
        >
          <span />
          {HOURS.map((h) => (
            <span key={h} style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', textAlign: 'center' }}>
              {h % 3 === 0 ? h : ''}
            </span>
          ))}
          {DOWS.map((dow) => (
            <Row
              key={dow}
              dow={dow}
              label={f.weekday(dow)}
              byKey={byKey}
              max={max}
              active={active}
              onActive={setActive}
            />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-3)', minBlockSize: '1.25rem' }}>
        <span aria-live="polite" style={{ fontSize: 'var(--tp-fs-xs)', color: active ? 'var(--tp-fg)' : 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
          {readout}
        </span>
        <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          <span style={{ marginInlineEnd: 'var(--tp-sp-1)' }}>{tr('ws.analytics.heatmap.less')}</span>
          {HEAT_RAMP.map((c) => (
            <span key={c} style={{ inlineSize: '0.75rem', blockSize: '0.6rem', background: c, border: `1px solid ${GRID}`, borderRadius: '2px' }} />
          ))}
          <span style={{ marginInlineStart: 'var(--tp-sp-1)' }}>{tr('ws.analytics.heatmap.more')}</span>
        </span>
      </div>
    </div>
  );
}

function Row({
  dow,
  label,
  byKey,
  max,
  active,
  onActive,
}: {
  dow: number;
  label: string;
  byKey: Map<string, HeatValue>;
  max: number;
  active: string | null;
  onActive: (key: string | null) => void;
}) {
  return (
    <>
      <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', lineHeight: '1.1rem', paddingInlineEnd: 'var(--tp-sp-2)', whiteSpace: 'nowrap' }}>{label}</span>
      {HOURS.map((hour) => {
        const key = `${dow}:${hour}`;
        const cell = byKey.get(key);
        const closed = cell?.open === false;
        const thin = Boolean(cell?.thin);
        const value = closed ? 0 : (cell?.value ?? 0);
        const peak = !thin && max > 0 && value === max;
        const isActive = active === key;
        return (
          <span
            key={hour}
            data-dow={dow}
            data-hour={hour}
            data-thin={thin ? 'true' : undefined}
            onPointerEnter={() => onActive(key)}
            style={{
              blockSize: '1.1rem',
              ...(closed
                ? closedGround
                : { background: peak ? HEAT_RAMP[HEAT_RAMP.length - 1] : heatColor(max > 0 ? Math.min(1, value / max) : 0) }),
              opacity: thin ? 0.35 : undefined,
              border: `1px solid ${isActive ? 'var(--tp-accent)' : GRID}`,
              borderRadius: '2px',
              boxShadow: isActive ? '0 0 0 1px var(--tp-accent)' : undefined,
            }}
          />
        );
      })}
    </>
  );
}
