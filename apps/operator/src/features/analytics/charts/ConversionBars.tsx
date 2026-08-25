/**
 * Price-band conversion. Conversion is CAPPED at 100 % on purpose: views come
 * from the QR menu, sales from the till, so an item bought by a guest who never
 * scanned would otherwise show >100 %. Those sales are surfaced honestly as the
 * "sold without a view" chip instead of being hidden in an impossible bar.
 */
import { useState } from 'react';
import type { PriceBandSales } from '@touch/core';
import { pickLocale } from '@touch/core';
import { useLocale } from '../../../lib/i18n';
import { Chip } from '../cards/CardShell';
import type { Formatters } from '../format';
import { BLUE } from './colors';

export function ConversionBars({ bands, f }: { bands: readonly PriceBandSales[]; f: Formatters }) {
  const { tr, locale } = useLocale();
  const [open, setOpen] = useState<number | null>(null);
  const label = (b: PriceBandSales) =>
    b.maxIqd === null ? `${f.num(b.minIqd)}+` : `${f.num(b.minIqd)}–${f.num(b.maxIqd - 1)}`;

  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
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
              fontSize: '0.82rem',
            }}
            aria-expanded={open === band.band}
          >
            <span>{label(band)}</span>
            <span style={{ color: 'var(--tp-muted-fg)' }}>
              {f.pct(band.convPctCapped)} · {f.num(band.views)} {tr('analytics.conversion.views').toLowerCase()}
            </span>
          </button>
          <div style={{ background: 'var(--tp-surface)', borderRadius: '0.25rem', blockSize: '0.9rem', marginBlockStart: '0.2rem' }}>
            <div style={{ inlineSize: `${Math.min(100, band.convPctCapped)}%`, blockSize: '100%', background: BLUE, borderRadius: '0.25rem' }} />
          </div>
          {band.soldWithoutView > 0 && (
            <div style={{ marginBlockStart: '0.25rem' }}>
              <Chip tone="warn">
                {tr('analytics.conversion.soldWithoutView')}: {f.num(band.soldWithoutView)}
              </Chip>
            </div>
          )}
          {open === band.band && (
            <ul style={{ margin: '0.4rem 0 0', paddingInlineStart: '1rem', fontSize: '0.78rem', color: 'var(--tp-muted-fg)' }}>
              {band.items.slice(0, 8).map((item) => (
                <li key={item.id}>
                  {pickLocale({ en: item.nameEn, ar: item.nameAr }, locale) || item.id} — {f.num(item.views)} /{' '}
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
