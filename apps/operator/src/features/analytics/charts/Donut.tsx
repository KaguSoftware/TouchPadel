/**
 * Part-to-whole at a glance: a ring of up to four slices, its total in the
 * middle and a legend beside it that carries every value and share, so no
 * figure is reachable only through colour or hover (dataviz: a donut is for
 * a handful of parts, never for comparing close values, and a two-part split
 * is a meter, not a pie; see RingMeter below).
 *
 * Hand-drawn SVG rather than Recharts: a ring is a few arcs (./geometry.ts),
 * and the hover state has to reach the legend and the centre, which a
 * Recharts tooltip cannot. Pointing at a slice or a legend row (or focusing
 * the row) lifts that slice, fades the rest, and the centre reads it out; the
 * fade is a hover state on the 160ms token, not motion.
 *
 * Colour follows the entity, never its rank: the caller passes each slice's
 * colour from the ring trio (RING_1..3 in charts/colors.ts, the same in both modes), with
 * RING_MUTED for the "other" or "unknown" slice.
 */
import { useState, type ReactNode } from 'react';
import { useLocale } from '../../../lib/i18n';
import { arcPath, layoutArcs, meterSweep } from './geometry';
import { useChartColors } from './colors';

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function Donut({
  slices,
  format,
  pct,
  total,
  caption,
  size = 132,
  label,
  layout = 'side',
}: {
  slices: readonly DonutSlice[];
  /** Formats a slice's value for the legend and the centre. */
  format: (n: number) => string;
  /** Percent formatter (already localised). */
  pct: (n: number) => string;
  /** The centre's figure while nothing is pointed at (the whole, formatted). */
  total: string;
  /** The muted line under the centre figure ("venue revenue"). */
  caption: string;
  size?: number;
  /** What the ring shows, for its accessible name. */
  label: string;
  /** 'side' puts the legend beside the ring; 'stack' under it, for a narrow card. */
  layout?: 'side' | 'stack';
}) {
  const { dir } = useLocale();
  const [active, setActive] = useState<string | null>(null);
  const arcs = layoutArcs(slices.map((s) => ({ key: s.key, value: s.value })));
  const byKey = new Map(arcs.map((a) => [a.key, a]));
  const sum = slices.reduce((n, s) => n + Math.max(0, s.value), 0);
  const shareOf = (s: DonutSlice) => (sum > 0 ? (Math.max(0, s.value) / sum) * 100 : 0);
  const lit = active ? slices.find((s) => s.key === active) : undefined;
  const c = size / 2;
  const outer = c - 2;
  const inner = outer * 0.68;
  const lift = 3;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: layout === 'stack' ? 'column' : 'row',
        alignItems: 'center',
        gap: layout === 'stack' ? 'var(--tp-sp-3)' : 'var(--tp-sp-5)',
        minInlineSize: 0,
      }}
      onPointerLeave={() => setActive(null)}
    >
      <div style={{ position: 'relative', inlineSize: size, blockSize: size, flex: '0 0 auto' }}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          role="img"
          aria-label={`${label}: ${slices.map((s) => `${s.label} ${format(s.value)}, ${pct(shareOf(s))}`).join('; ')}`}
          style={{ overflow: 'visible', display: 'block' }}
        >
          {arcs.length === 0 && <circle cx={c} cy={c} r={(outer + inner) / 2} fill="none" stroke="var(--tp-border)" strokeWidth={outer - inner} />}
          {slices.map((s) => {
            const a = byKey.get(s.key);
            if (!a) return null;
            const on = active === s.key;
            return (
              <path
                key={s.key}
                d={arcPath(c, c, on ? inner - 1 : inner, on ? outer + lift : outer, a.start, a.end)}
                fill={s.color}
                opacity={active && !on ? 0.3 : 1}
                onPointerEnter={() => setActive(s.key)}
                style={{ transition: 'opacity var(--tp-dur-fast) var(--tp-ease-out)', cursor: 'default' }}
              />
            );
          })}
        </svg>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeContent: 'center',
            textAlign: 'center',
            pointerEvents: 'none',
            paddingInline: size * 0.14,
          }}
        >
          <strong dir="auto" style={{ fontSize: size >= 120 ? 'var(--tp-fs-xl)' : 'var(--tp-fs-md)', lineHeight: 1.15, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--tp-font-numeric)' }}>
            {lit ? pct(shareOf(lit)) : total}
          </strong>
          <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lit ? lit.label : caption}
          </span>
        </div>
      </div>
      <ul dir={dir} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)', flex: '1 1 0', minInlineSize: 0, inlineSize: layout === 'stack' ? '100%' : undefined }}>
        {slices.map((s) => {
          const on = active === s.key;
          return (
            <li
              key={s.key}
              tabIndex={0}
              onPointerEnter={() => setActive(s.key)}
              onFocus={() => setActive(s.key)}
              onBlur={() => setActive(null)}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                alignItems: 'center',
                columnGap: 'var(--tp-sp-2)',
                paddingBlock: 'var(--tp-sp-1)',
                paddingInline: 'var(--tp-sp-2)',
                marginInline: 'calc(-1 * var(--tp-sp-2))',
                borderRadius: 'var(--tp-radius-sm)',
                background: on ? 'color-mix(in oklab, var(--tp-fg) 7%, transparent)' : undefined,
                opacity: active && !on ? 0.55 : 1,
                transition: 'opacity var(--tp-dur-fast) var(--tp-ease-out)',
                outlineOffset: 1,
              }}
            >
              <span aria-hidden="true" style={{ inlineSize: '0.7rem', blockSize: '0.7rem', borderRadius: '3px', background: s.color }} />
              <span style={{ fontSize: 'var(--tp-fs-sm)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 'var(--tp-sp-1-5)', fontVariantNumeric: 'tabular-nums' }}>
                <strong dir="auto" style={{ fontSize: 'var(--tp-fs-sm)', fontFamily: 'var(--tp-font-numeric)' }}>{format(s.value)}</strong>
                <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', minInlineSize: '2.6rem', textAlign: 'end' }}>{pct(shareOf(s))}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface MeterPart {
  /** 0..100 of the ring. Parts stack round it in order. */
  pct: number;
  color: string;
}

/**
 * A single rate as a ring: how full, how many came back, how much converted.
 * The track is a light step of the same ramp, so the unfilled part still
 * reads as the same measure (dataviz "meter"). `parts` stacks two or three
 * rates of one whole (cancelled, then no-show) on one track. The centre
 * carries the figure, so the ring never stands for a number on its own.
 */
export function RingMeter({
  pct,
  parts,
  size = 56,
  thickness,
  center,
  label,
  color,
}: {
  pct?: number | null;
  parts?: readonly MeterPart[];
  size?: number;
  thickness?: number;
  /** The figure in the middle; omitted for a ring too small to hold one. */
  center?: ReactNode;
  /** Accessible name ("Occupancy 42%"). */
  label: string;
  color?: string;
}) {
  const { RING_TRACK, RING_1 } = useChartColors();
  const c = size / 2;
  const t = thickness ?? Math.max(5, Math.round(size * 0.13));
  const outer = c - 1;
  const inner = outer - t;
  const stack = parts ?? [{ pct: pct ?? 0, color: color ?? RING_1 }];
  let at = 0;
  const arcs = stack.flatMap((p) => {
    const sweep = meterSweep(p.pct);
    const from = at;
    at = Math.min(Math.PI * 2, at + sweep);
    return sweep > 0 && at > from ? [{ d: arcPath(c, c, inner, outer, from, at), color: p.color }] : [];
  });
  return (
    <div role="img" aria-label={label} style={{ position: 'relative', inlineSize: size, blockSize: size, flex: '0 0 auto' }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" style={{ display: 'block' }}>
        <path d={arcPath(c, c, inner, outer, 0, Math.PI * 2)} fill={RING_TRACK} />
        {arcs.map((a, i) => (
          <path key={i} d={a.d} fill={a.color} />
        ))}
      </svg>
      {center != null && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeContent: 'center',
            fontSize: size >= 64 ? 'var(--tp-fs-md)' : 'var(--tp-fs-xs)',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            fontFamily: 'var(--tp-font-numeric)',
          }}
        >
          {center}
        </span>
      )}
    </div>
  );
}

/** A colour key inline in a sentence: the swatch beside the word it names. */
export function Swatch({ color }: { color: string }) {
  return <span aria-hidden="true" style={{ display: 'inline-block', inlineSize: '0.6rem', blockSize: '0.6rem', borderRadius: '2px', background: color, marginInlineEnd: '0.3em', verticalAlign: 'baseline' }} />;
}
