/**
 * Price bands, one card: per list-price band, two proportional bars — the
 * QR-menu views (guest attention) and the units the till actually sold — and
 * the "sold without a view" chip where units outran views. Views come from
 * the QR menu and sales from the till (a guest who never scanned still buys),
 * so the two bars are shown side by side and never divided into an
 * impossible percentage; the capped conversion prints beside them. Works
 * without guest analytics: the views bar is simply empty.
 */
import { useState } from 'react';
import type { PriceBandSales } from '@touch/core';
import { pickLocale } from '@touch/core';
import { useLocale } from '../../../lib/i18n';
import type { Formatters } from '../format';
import { useChartColors } from './colors';
import { StatusBadge } from '../../../components/kit';

export function bandLabel(f: Formatters, b: { minIqd: number; maxIqd: number | null }): string {
  return b.maxIqd === null ? `${f.num(b.minIqd)}+` : `${f.num(b.minIqd)}–${f.num(b.maxIqd - 1)}`;
}

export function PriceBandBars({ bands, f, hasViews }: { bands: readonly PriceBandSales[]; f: Formatters; hasViews: boolean }) {
  const { BAR_MUTED, BLUE } = useChartColors();
  const { tr, locale } = useLocale();
  const [open, setOpen] = useState<number | null>(null);
  const maxViews = Math.max(1, ...bands.map((b) => b.views));
  const maxSold = Math.max(1, ...bands.map((b) => b.sold));
  const bar = (share: number, fill: string) => (
    <div style={{ background: 'var(--tp-surface)', borderRadius: '0.25rem', blockSize: '0.6rem' }}>
      <div style={{ inlineSize: `${Math.round(Math.min(1, share) * 100)}%`, blockSize: '100%', background: fill, borderRadius: '0.25rem' }} />
    </div>
  );
  return (
    <div style={{ display: 'grid', gap: '0.7rem' }}>
      {bands.map((band) => (
        <div key={band.band}>
          <button
            type="button"
            onClick={() => setOpen(open === band.band ? null : band.band)}
            style={{
              display: 'flex',
              inlineSize: '100%',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: '0.5rem',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'var(--tp-fg)',
              fontSize: 'var(--tp-fs-sm)',
            }}
            aria-expanded={open === band.band}
          >
            <span>{bandLabel(f, band)}</span>
            <span style={{ color: 'var(--tp-muted-fg)' }}>
              {hasViews && `${f.num(band.views)} ${tr('analytics.conversion.views').toLowerCase()} · `}
              {f.num(band.sold)} {tr('analytics.cards.quantity').toLowerCase()}
              {hasViews && band.views > 0 && ` · ${f.pct(band.convPctCapped)}`}
            </span>
          </button>
          <div style={{ display: 'grid', gap: '0.2rem', marginBlockStart: '0.2rem' }}>
            {hasViews && bar(band.views / maxViews, BAR_MUTED)}
            {bar(band.sold / maxSold, BLUE)}
          </div>
          {hasViews && band.soldWithoutView > 0 && (
            <div style={{ marginBlockStart: '0.25rem' }}>
              <StatusBadge size="sm" tone="warn" label={`${tr('analytics.conversion.soldWithoutView')}: ${f.num(band.soldWithoutView)}`} />
            </div>
          )}
          {open === band.band && (
            <ul style={{ margin: '0.4rem 0 0', paddingInlineStart: '1rem', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              {band.items.slice(0, 8).map((item) => (
                <li key={item.id}>
                  {pickLocale({ en: item.nameEn, ar: item.nameAr }, locale) || item.id} — {hasViews ? `${f.num(item.views)} / ` : ''}
                  {f.num(item.sold)}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
