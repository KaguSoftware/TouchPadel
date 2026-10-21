/**
 * When court players order at the cafe, drawn against the booking itself:
 * six columns on one time line, the two "during" columns standing on a band
 * that IS the court time, with its start and end marked. The old 100% share
 * strip said the same numbers, but the reader had to rebuild "before, during,
 * after" from a legend; here the booking is the axis.
 *
 * The buckets are ORDERED, so the during columns take the accent and the
 * rest the muted bar colour (emphasis: the court time is the subject). Every
 * column prints its count and share, so nothing hides behind hover. Time runs
 * left to right in both languages, as on every other time axis on the page;
 * the labels under it stay in the page's language.
 */
import { useLocale } from '../../../lib/i18n';
import { useChartColors } from './colors';

export interface TimelineBucket {
  key: string;
  label: string;
  value: number;
  /** Inside the booking (first half, second half). */
  during: boolean;
}

export function BookingTimeline({ buckets, format, pct }: { buckets: readonly TimelineBucket[]; format: (n: number) => string; pct: (n: number) => string }) {
  const { tr } = useLocale();
  const { HIGHLIGHT, BAR_MUTED } = useChartColors();
  const total = buckets.reduce((n, b) => n + Math.max(0, b.value), 0);
  const max = buckets.reduce((m, b) => Math.max(m, b.value), 0);
  const firstDuring = buckets.findIndex((b) => b.during);
  const lastDuring = buckets.length - 1 - [...buckets].reverse().findIndex((b) => b.during);
  const cols = `repeat(${buckets.length}, minmax(0, 1fr))`;
  const share = (n: number) => (total > 0 ? (n / total) * 100 : 0);

  return (
    <div
      dir="ltr"
      role="img"
      aria-label={buckets.map((b) => `${b.label} ${format(b.value)} (${pct(share(b.value))})`).join(', ')}
      style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}
    >
      {/* The columns, bottom-aligned on the time line. */}
      <div style={{ display: 'grid', gridTemplateColumns: cols, columnGap: 'var(--tp-sp-2)', alignItems: 'end', blockSize: '8.5rem' }}>
        {buckets.map((b) => {
          const h = max > 0 ? Math.max(b.value > 0 ? 6 : 0, (b.value / max) * 100) : 0;
          return (
            <div key={b.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', blockSize: '100%', minInlineSize: 0 }}>
              <strong style={{ fontSize: 'var(--tp-fs-sm)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--tp-font-numeric)' }}>{format(b.value)}</strong>
              <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-1)', fontVariantNumeric: 'tabular-nums' }}>{pct(share(b.value))}</span>
              <span
                aria-hidden="true"
                style={{
                  inlineSize: 'min(100%, 2.5rem)',
                  // The tallest column takes the 6rem the readout above it leaves.
                  blockSize: `${(h * 0.06).toFixed(3)}rem`,
                  minBlockSize: b.value > 0 ? 4 : 0,
                  background: b.during ? HIGHLIGHT : BAR_MUTED,
                  borderStartStartRadius: 4,
                  borderStartEndRadius: 4,
                }}
              />
            </div>
          );
        })}
      </div>
      {/* The time line: the court time as a band under the during columns, its start and end ticked. */}
      <div style={{ display: 'grid', gridTemplateColumns: cols, columnGap: 'var(--tp-sp-2)', position: 'relative', blockSize: '1.6rem', alignItems: 'center' }}>
        <span aria-hidden="true" style={{ position: 'absolute', insetInline: 0, insetBlockStart: '50%', blockSize: 2, background: 'var(--tp-border-strong)' }} />
        {firstDuring >= 0 && (
          <span
            style={{
              gridColumn: `${firstDuring + 1} / ${lastDuring + 2}`,
              gridRow: 1,
              position: 'relative',
              blockSize: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 'var(--tp-radius-sm)',
              background: HIGHLIGHT,
              color: 'var(--tp-accent-contrast)',
              fontSize: 'var(--tp-fs-xs)',
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {tr('ws.analytics.viz.onCourt')}
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: cols, columnGap: 'var(--tp-sp-2)' }}>
        {buckets.map((b) => (
          <span key={b.key} dir="auto" style={{ fontSize: 'var(--tp-fs-xs)', color: b.during ? 'var(--tp-fg)' : 'var(--tp-muted-fg)', fontWeight: b.during ? 600 : 400, textAlign: 'center', lineHeight: 1.25 }}>
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}
