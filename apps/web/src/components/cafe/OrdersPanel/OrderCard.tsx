'use client';

import { formatIQD, formatTime, makeT, type Locale, type MessageKey } from '@touch/i18n';
import {
  ORDER_STEPS,
  orderStepIndex,
  orderTotal,
  type GuestOrder,
  type GuestOrderStatus,
} from '@/hooks/cafe/orders';

const STATUS_KEY: Record<GuestOrderStatus, MessageKey> = {
  sent: 'cafe.statusReceived',
  preparing: 'cafe.statusPreparing',
  ready: 'cafe.statusReady',
  served: 'cafe.statusDelivered',
  voided: 'cafe.statusCancelled',
};

/**
 * One order card: the 3-step bar (Received → Preparing → Ready), the current
 * status and the order's lines. A VOIDED order is muted and shows the
 * "ask staff" hint instead of a progress bar — the guest must never think a
 * cancelled order is still coming.
 */
export function OrderCard({ locale, order }: { locale: Locale; order: GuestOrder }) {
  const tr = makeT(locale);
  const ar = locale === 'ar';
  const voided = order.status === 'voided';
  const stepIndex = orderStepIndex(order.status);
  const lines = order.items.filter((i) => !i.voided);

  return (
    <article className="tp-order" data-voided={voided ? 'true' : undefined}>
      <div className="tp-order__head">
        <span>
          {tr('cafe.orderRef')} · {formatTime(new Date(order.placed_at), locale)}
        </span>
        <span>{formatIQD(orderTotal(order), locale)}</span>
      </div>
      {!voided && (
        <div className="tp-steps" aria-hidden="true">
          {ORDER_STEPS.map((s, i) => (
            <span key={s} data-on={i < stepIndex ? 'true' : 'false'} />
          ))}
        </div>
      )}
      <div className="tp-order__status" role="status">
        {tr(STATUS_KEY[order.status])}
      </div>
      {voided && <div className="tp-order__lines">{tr('cafe.orders.cancelledHint')}</div>}
      {lines.length > 0 && (
        <div className="tp-order__lines">
          {lines
            .map((i) => `${i.qty} × ${ar ? i.name_ar : i.name_en}`)
            .join(ar ? '، ' : ', ')}
        </div>
      )}
    </article>
  );
}
