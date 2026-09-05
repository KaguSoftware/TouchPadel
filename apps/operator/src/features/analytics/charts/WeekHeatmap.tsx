/**
 * Day × hour heatmap as a CSS grid (no Recharts — a 7×24 matrix of coloured
 * cells is cheaper and sharper as DOM). Sequential white → blue ramp; the single
 * busiest cell is brown so the eye lands on it immediately.
 */
import { useLocale } from '../../../lib/i18n';
import { weekdayName } from '../copy';
import type { HeatCell } from '../shape';
import type { Formatters } from '../format';
import { GRID, HEAT_RAMP, heatColor } from './colors';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DOWS = [0, 1, 2, 3, 4, 5, 6];

export function WeekHeatmap({ cells, f }: { cells: readonly HeatCell[]; f: Formatters }) {
  const { tr } = useLocale();
  const byKey = new Map(cells.map((c) => [`${c.dow}:${c.hour}`, c.views]));
  const max = cells.reduce((m, c) => Math.max(m, c.views), 0);

  return (
    <div dir="ltr" style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `3rem repeat(24, minmax(0, 1fr))`, gap: '1px', minInlineSize: '42rem' }}>
        <span />
        {HOURS.map((h) => (
          <span key={h} style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', textAlign: 'center' }}>
            {h % 3 === 0 ? h : ''}
          </span>
        ))}
        {DOWS.map((dow) => (
          <Row key={dow} dow={dow} label={weekdayName(tr, dow).slice(0, 3)} byKey={byKey} max={max} f={f} />
        ))}
      </div>
    </div>
  );
}

function Row({
  dow,
  label,
  byKey,
  max,
  f,
}: {
  dow: number;
  label: string;
  byKey: Map<string, number>;
  max: number;
  f: Formatters;
}) {
  return (
    <>
      <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', lineHeight: '1.1rem' }}>{label}</span>
      {HOURS.map((hour) => {
        const views = byKey.get(`${dow}:${hour}`) ?? 0;
        const peak = max > 0 && views === max;
        return (
          <span
            key={hour}
            title={`${label} ${f.hour(hour)} — ${f.num(views)}`}
            style={{
              blockSize: '1.1rem',
              // The peak is the ramp's own darkest step, not a second hue: a sequential
              // encoding says 'most' by depth, and a different colour there would read
              // as a different category.
              background: peak ? HEAT_RAMP[HEAT_RAMP.length - 1] : heatColor(max > 0 ? views / max : 0),
              border: `1px solid ${GRID}`,
              borderRadius: '2px',
            }}
          />
        );
      })}
    </>
  );
}
