'use client';

import { formatIQD, makeT, type Locale } from '@touch/i18n';

/**
 * Basket entry point in the top bar: a count chip plus the running total.
 * Empty basket = disabled (there is nothing to review yet) but still rendered,
 * so the control does not appear and disappear as the guest shops.
 */
export function BasketButton({
  locale,
  count,
  total,
  onOpen,
}: {
  locale: Locale;
  count: number;
  total: number;
  onOpen(): void;
}) {
  const tr = makeT(locale);
  return (
    <button
      type="button"
      className="tp-btn tp-btn--onblue tp-basket-btn"
      disabled={count === 0}
      onClick={onOpen}
      aria-label={tr('cafe.viewBasket', { count })}
    >
      <span className="tp-basket-btn__count" aria-hidden="true">
        {count}
      </span>
      <span className="tp-basket-btn__total">{formatIQD(total, locale)}</span>
    </button>
  );
}
