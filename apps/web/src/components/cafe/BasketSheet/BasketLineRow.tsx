'use client';

import { formatIQD, type Locale } from '@touch/i18n';
import { lineTotal, type BasketLine } from '@/lib/cafe/basket';
import { QTY_MAX, QTY_MIN } from './constants';

/**
 * One basket line: `qty × name · variant`, one sub-line per extra, the italic
 * item note, the −/+ stepper and remove (UpperDeck CartDrawer L170-229).
 */
export function BasketLineRow({
  locale,
  line,
  removeLabel,
  qtyLabel,
  onSetQty,
  onRemove,
}: {
  locale: Locale;
  line: BasketLine;
  removeLabel: string;
  qtyLabel: string;
  onSetQty(key: string, qty: number): void;
  onRemove(key: string): void;
}) {
  const ar = locale === 'ar';
  const variantName = ar ? line.variant_name_ar : line.variant_name_en;
  return (
    <div className="tp-basket-line">
      <div className="tp-basket-line__body">
        <div className="tp-basket-line__name">
          {line.qty} × {ar ? line.item_name_ar : line.item_name_en}
          {variantName && <span className="tp-basket-line__sub"> · {variantName}</span>}
        </div>
        {line.modifiers.map((m) => (
          <div key={m.modifierId} className="tp-basket-line__sub">
            + {m.qty > 1 ? `${m.qty} × ` : ''}
            {ar ? m.name_ar : m.name_en}
            {m.price_delta_iqd > 0 ? ` · ${formatIQD(m.price_delta_iqd * m.qty, locale)}` : ''}
          </div>
        ))}
        {line.notes && <div className="tp-basket-line__note">“{line.notes}”</div>}
        <div className="tp-basket-line__controls">
          <div className="tp-qty" aria-label={qtyLabel}>
            <button
              type="button"
              aria-label="−"
              onClick={() => onSetQty(line.key, Math.max(QTY_MIN, line.qty - 1))}
            >
              −
            </button>
            <span>{line.qty}</span>
            <button
              type="button"
              aria-label="+"
              onClick={() => onSetQty(line.key, Math.min(QTY_MAX, line.qty + 1))}
            >
              +
            </button>
          </div>
          <button type="button" className="tp-basket-line__remove" onClick={() => onRemove(line.key)}>
            {removeLabel}
          </button>
        </div>
      </div>
      <div className="tp-basket-line__total">{formatIQD(lineTotal(line), locale)}</div>
    </div>
  );
}
