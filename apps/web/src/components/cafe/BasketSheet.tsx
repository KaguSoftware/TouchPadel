'use client';

import { useMemo } from 'react';
import { makeT, formatIQD, type Locale } from '@touch/i18n';
import { basketTotal, lineTotal, type BasketLine } from '@/lib/cafe/basket';

/** Basket review sheet — lines, remove, total, submit (blocked while degraded). */
export function BasketSheet({
  lines,
  locale,
  degraded,
  sending,
  onRemove,
  onSubmit,
  onClose,
}: {
  lines: BasketLine[];
  locale: Locale;
  degraded: boolean;
  sending: boolean;
  onRemove: (key: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  const tr = useMemo(() => makeT(locale), [locale]);
  const ar = locale === 'ar';

  return (
    <>
      <div className="tp-sheet-backdrop" onClick={onClose} />
      <div className="tp-sheet" role="dialog" aria-modal="true" aria-label={tr('cafe.basket')}>
        <div className="tp-sheet__row">
          <h2>{tr('cafe.basket')}</h2>
          <button className="tp-btn tp-btn--ghost" onClick={onClose}>
            {tr('common.close')}
          </button>
        </div>

        {lines.length === 0 && <p className="tp-banner tp-banner--info">{tr('cafe.basketEmpty')}</p>}

        {lines.map((line) => (
          <div key={line.key} className="tp-sheet__row" style={{ borderBlockEnd: '1px solid var(--tp-border)' }}>
            <div style={{ minInlineSize: 0 }}>
              <div style={{ fontWeight: 700 }}>
                {line.qty} × {ar ? line.item_name_ar : line.item_name_en}
                {(ar ? line.variant_name_ar : line.variant_name_en) && (
                  <span className="tp-menu-item__price-size">
                    {' '}
                    · {ar ? line.variant_name_ar : line.variant_name_en}
                  </span>
                )}
              </div>
              {line.modifiers.length > 0 && (
                <div className="tp-menu-item__desc">
                  {line.modifiers
                    .map((m) => (m.qty > 1 ? `${m.qty} × ` : '') + (ar ? m.name_ar : m.name_en))
                    .join('، '.trim())}
                </div>
              )}
              {line.notes && <div className="tp-menu-item__desc">“{line.notes}”</div>}
              <button
                className="tp-btn tp-btn--ghost"
                style={{ minBlockSize: '1.8rem', paddingBlock: '0.1rem', fontSize: '0.8rem' }}
                onClick={() => onRemove(line.key)}
              >
                {tr('cafe.remove')}
              </button>
            </div>
            <div style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              {formatIQD(lineTotal(line), locale)}
            </div>
          </div>
        ))}

        <div className="tp-sheet__row" style={{ fontWeight: 800, fontSize: '1.05rem' }}>
          <span>{tr('common.total')}</span>
          <span>{formatIQD(basketTotal(lines), locale)}</span>
        </div>

        {degraded && (
          <p className="tp-banner tp-banner--warn" role="status">
            {tr('degraded.orderingRefused')}
          </p>
        )}
        {/* SOW: ordering is NOT paying. */}
        <p className="tp-banner tp-banner--info">{tr('cafe.payAtDesk')}</p>

        <button
          className="tp-btn tp-btn--primary tp-btn--block"
          disabled={lines.length === 0 || degraded || sending}
          onClick={onSubmit}
        >
          {sending ? tr('cafe.sending') : tr('cafe.placeOrder')}
        </button>
      </div>
    </>
  );
}
