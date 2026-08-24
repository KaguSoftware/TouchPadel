'use client';

import { useMemo } from 'react';
import { makeT, formatIQD, formatTime, type Locale, type MessageKey } from '@touch/i18n';

export interface GuestOrderItem {
  id: string;
  qty: number;
  line_total_iqd: number;
  name_en: string;
  name_ar: string;
  variant_en: string;
  variant_ar: string;
}

export interface GuestOrder {
  id: string;
  status: 'sent' | 'preparing' | 'ready' | 'served' | 'voided';
  placed_at: string;
  items: GuestOrderItem[];
}

const STATUS_KEY: Record<GuestOrder['status'], MessageKey> = {
  sent: 'cafe.statusReceived',
  preparing: 'cafe.statusPreparing',
  ready: 'cafe.statusReady',
  served: 'cafe.statusDelivered',
  voided: 'cafe.statusCancelled',
};

const STEPS: GuestOrder['status'][] = ['sent', 'preparing', 'ready'];

/** Live status cards for the session's own orders (sent → preparing → ready). */
export function OrdersPanel({ orders, locale }: { orders: GuestOrder[]; locale: Locale }) {
  const tr = useMemo(() => makeT(locale), [locale]);
  const ar = locale === 'ar';
  if (orders.length === 0) return null;

  return (
    <section aria-label={tr('cafe.yourOrders')} style={{ marginBlockStart: '0.75rem' }}>
      <h2 style={{ fontSize: '1.1rem', fontFamily: 'var(--tp-font-display)' }}>
        {tr('cafe.yourOrders')}
      </h2>
      {orders.map((order) => {
        const stepIndex =
          order.status === 'served' ? STEPS.length : STEPS.indexOf(order.status) + 1;
        const total = order.items.reduce((sum, i) => sum + i.line_total_iqd, 0);
        return (
          <article key={order.id} className="tp-order">
            <div className="tp-order__head">
              <span>
                {tr('cafe.orderRef')} · {formatTime(new Date(order.placed_at), locale)}
              </span>
              <span>{formatIQD(total, locale)}</span>
            </div>
            {order.status !== 'voided' && (
              <div className="tp-steps" aria-hidden="true">
                {STEPS.map((s, i) => (
                  <span key={s} data-on={i < stepIndex} />
                ))}
              </div>
            )}
            <div className="tp-order__status" role="status">
              {tr(STATUS_KEY[order.status])}
            </div>
            <div className="tp-order__lines">
              {order.items
                .map((i) => `${i.qty} × ${ar ? i.name_ar : i.name_en}`)
                .join(ar ? '، ' : ', ')}
            </div>
          </article>
        );
      })}
    </section>
  );
}
