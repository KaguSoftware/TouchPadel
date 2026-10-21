/**
 * Two (or three) labelled figures side by side in one card: the form for a
 * handful of related headline numbers that would be a one-bar chart each.
 * Proportional figures (not tabular) because they stand alone.
 *
 * `meter` puts a ring before them when the figures are the parts of one
 * whole (returning of all known guests, resold of the late cancellations):
 * the share the sentence names, as a picture. A two-part split is a meter,
 * never a two-slice pie (dataviz). Under the twenty-booking floor there is no
 * ring: the figures print "n of N" there, and a ring would read as a rate.
 */
import type { ReactNode } from 'react';
import { MIN_RATE_DENOM } from '@touch/core';
import type { MessageKey } from '@touch/i18n';
import { useLocale } from '../../../../lib/i18n';
import { CardShell, type CardState } from '../../cards/CardShell';
import { RingMeter } from '../../charts/Donut';

export interface StatItem {
  label: string;
  value: string;
  /** Muted line under the value: state (a sample, a share). */
  sub?: string;
}

export function StatPair({
  title,
  tip,
  state,
  refreshing,
  items,
  note,
  emptyKey,
  meter,
  pct,
}: {
  title: string;
  tip?: ReactNode;
  state: CardState;
  refreshing?: boolean;
  items: readonly StatItem[];
  note?: ReactNode;
  emptyKey?: MessageKey;
  /** The share the ring shows, 0..100, and what it is a share of. Null draws no ring. */
  meter?: { pct: number | null; label: string; of: number } | null;
  /** Percent formatter for the ring's centre. */
  pct?: (n: number) => string;
}) {
  const { tr } = useLocale();
  const ring = meter && meter.pct != null && meter.of >= MIN_RATE_DENOM && pct;
  return (
    <CardShell title={title} tip={tip} state={state} refreshing={refreshing} note={note} emptyKey={emptyKey} skeletonLines={2}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-4)' }}>
      {ring && <RingMeter pct={meter.pct} size={76} center={pct(meter.pct!)} label={tr('ws.analytics.viz.meter', { label: meter.label, pct: pct(meter.pct!) })} />}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, gap: 'var(--tp-sp-3)', flex: '1 1 0', minInlineSize: 0 }}>
        {items.map((it) => (
          <div key={it.label} style={{ minInlineSize: 0 }}>
            <span style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
            <strong style={{ display: 'block', fontSize: 'var(--tp-fs-xl)', lineHeight: 1.3 }}>{it.value}</strong>
            {it.sub && <span style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{it.sub}</span>}
          </div>
        ))}
      </div>
      </div>
    </CardShell>
  );
}
