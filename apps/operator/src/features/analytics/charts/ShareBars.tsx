/**
 * One row split into shares (order timing, source split, who cancelled). Plain
 * DOM: a 100% bar is cheaper and sharper than an SVG. Segments use ordered
 * steps of the sequential ramp because the buckets are ORDERED (before, during,
 * after), so lightness carries the order and the legend carries the identity.
 * A segment is labelled inline only when it is wide enough to hold the label;
 * every value is always in the legend, so nothing is gated on hover.
 */
import { useChartColors } from './colors';

export interface ShareSegment {
  key: string;
  label: string;
  value: number;
}

export function ShareBars({
  segments,
  format,
  pct,
}: {
  segments: readonly ShareSegment[];
  format: (n: number) => string;
  /** Percent formatter (already localised). */
  pct: (n: number) => string;
}) {
  const { HEAT_RAMP } = useChartColors();
  // Six ramp steps for up to six segments; the sixth repeats so a seventh segment stays legible.
  const STEPS = [HEAT_RAMP[1], HEAT_RAMP[2], HEAT_RAMP[3], HEAT_RAMP[4], HEAT_RAMP[5], HEAT_RAMP[5]] as const;
  const total = segments.reduce((s, seg) => s + Math.max(0, seg.value), 0);
  const shares = segments.map((seg, i) => ({
    ...seg,
    share: total > 0 ? (Math.max(0, seg.value) / total) * 100 : 0,
    fill: STEPS[Math.min(i, STEPS.length - 1)]!,
    ink: i >= 3 ? 'var(--tp-brand-white)' : 'var(--tp-fg)',
  }));
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <div
        dir="ltr"
        role="img"
        aria-label={shares.map((s) => `${s.label} ${pct(s.share)}`).join(', ')}
        style={{ display: 'flex', blockSize: '1.75rem', borderRadius: 'var(--tp-radius-sm)', overflow: 'hidden', gap: '2px' }}
      >
        {shares.map((s) =>
          s.share > 0 ? (
            <div
              key={s.key}
              style={{
                flex: `${s.share} 0 0`,
                background: s.fill,
                color: s.ink,
                fontSize: 'var(--tp-fs-xs)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minInlineSize: 0,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
              }}
            >
              {s.share >= 8 ? pct(s.share) : ''}
            </div>
          ) : null,
        )}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', columnGap: 'var(--tp-sp-4)', rowGap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
        {shares.map((s) => (
          <li key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}>
            <span aria-hidden="true" style={{ inlineSize: '0.6rem', blockSize: '0.6rem', borderRadius: '2px', background: s.fill, display: 'inline-block' }} />
            <span>{s.label}</span>
            <strong style={{ color: 'var(--tp-fg)', fontVariantNumeric: 'tabular-nums' }}>{format(s.value)}</strong>
            <span>{pct(s.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
