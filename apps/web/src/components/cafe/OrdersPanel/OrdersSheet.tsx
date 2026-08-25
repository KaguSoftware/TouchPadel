'use client';

import { useRef } from 'react';
import { makeT, type Locale } from '@touch/i18n';
import { useSheetDrag } from '@/hooks/cafe/useSheetDrag';
import type { GuestOrder } from '@/hooks/cafe/orders';
import { OrderCard } from './OrderCard';

/**
 * The session's orders as a bottom sheet: live orders expanded with their
 * 3-step bar, everything older (served > 10 min, cancelled) collapsed under
 * "Earlier".
 *
 * Drag-to-close is armed on the header only (`useSheetDrag`) — the list below
 * it must stay scrollable on iOS.
 */
export function OrdersSheet({
  locale,
  open,
  live,
  earlier,
  onClose,
}: {
  locale: Locale;
  open: boolean;
  live: GuestOrder[];
  earlier: GuestOrder[];
  onClose(): void;
}) {
  const headerRef = useRef<HTMLDivElement | null>(null);
  const { style } = useSheetDrag(headerRef, onClose);
  const tr = makeT(locale);
  if (!open) return null;

  return (
    <>
      <div className="tp-sheet-backdrop" onClick={onClose} />
      <div
        className="tp-sheet"
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={tr('cafe.yourOrders')}
      >
        <div className="tp-sheet__header" ref={headerRef}>
          <div className="tp-sheet__grip" aria-hidden="true" />
          <div className="tp-sheet__row">
            <h2>{tr('cafe.yourOrders')}</h2>
            <button type="button" className="tp-btn tp-btn--ghost" onClick={onClose}>
              {tr('common.close')}
            </button>
          </div>
        </div>

        {live.length === 0 && earlier.length === 0 && (
          <p className="tp-basket-empty">{tr('cafe.orders.emptyTitle')}</p>
        )}

        {live.map((order) => (
          <OrderCard key={order.id} locale={locale} order={order} />
        ))}

        {earlier.length > 0 && (
          <section className="tp-orders__earlier">
            <h3 className="tp-eyebrow">{tr('cafe.orders.earlier')}</h3>
            {earlier.map((order) => (
              <OrderCard key={order.id} locale={locale} order={order} />
            ))}
          </section>
        )}
      </div>
    </>
  );
}
