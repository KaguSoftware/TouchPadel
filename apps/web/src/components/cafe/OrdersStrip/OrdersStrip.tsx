'use client';

import { makeT, type Locale } from '@touch/i18n';
import type { GuestOrder } from '@/hooks/cafe/orders';

/**
 * The live-orders pill under the category rail. Rendered ONLY when the session
 * has orders in flight — a guest who has not ordered yet must not see an empty
 * "your orders" affordance. Tapping opens the orders sheet.
 */
export function OrdersStrip({
  locale,
  live,
  onOpen,
}: {
  locale: Locale;
  live: GuestOrder[];
  onOpen(): void;
}) {
  if (live.length === 0) return null;
  const tr = makeT(locale);
  const label =
    live.length === 1 ? tr('cafe.orders.liveOne') : tr('cafe.orders.liveMany', { count: live.length });
  return (
    <button type="button" className="tp-orders-strip" onClick={onOpen}>
      <span className="tp-orders-strip__dot" aria-hidden="true" />
      {label}
    </button>
  );
}
