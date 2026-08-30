'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { makeT, type Locale } from '@touch/i18n';
import { SheetShell } from '../ItemSheet/SheetShell';
import { useSheetDrag } from '../ItemSheet/drag';
import type { GuestOrder } from '@/hooks/cafe/orders';
import { OrderCard } from './OrderCard';

/**
 * The session's orders as a bottom sheet: live orders expanded with their
 * 3-step bar, everything older (served > 10 min, cancelled) collapsed under
 * "Earlier".
 *
 * Drag-to-close is armed on the header only (`useSheetDrag`) — the list below
 * it must stay scrollable on iOS. The sheet goes through SheetShell like every
 * other one, so it gets the exit animation, Escape, the focus trap and the
 * backdrop fade rather than a hand-rolled scrim that vanished on the spot.
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
  /** SheetShell's deferred close, so the Close button and the drag play the exit. */
  const dismiss = useRef<(() => void) | null>(null);
  const close = useCallback(() => {
    if (dismiss.current) dismiss.current();
    else onClose();
  }, [onClose]);
  /**
   * True when this closing came from the swipe, so the sheet fades out from
   * where the finger left it instead of replaying the slide. The sheet stays
   * mounted between openings (it only returns null), so the flag has to be
   * cleared on the way IN or a later tap-close would inherit it.
   */
  const [dragClosed, setDragClosed] = useState(false);
  useEffect(() => {
    if (open) setDragClosed(false);
  }, [open]);
  const drag = useSheetDrag(headerRef, () => {
    setDragClosed(true);
    close();
  });
  const tr = makeT(locale);
  if (!open) return null;

  return (
    <SheetShell
      label={tr('cafe.yourOrders')}
      onClose={onClose}
      closeRef={dismiss}
      className="tp-sheet"
      style={drag.style}
      backdropStyle={drag.backdropStyle}
      dragged={dragClosed}
    >
      <div className="tp-sheet__header" ref={headerRef}>
        <div className="tp-sheet__grip" aria-hidden="true" />
        <div className="tp-sheet__row">
          <h2>{tr('cafe.yourOrders')}</h2>
          <button type="button" className="tp-btn tp-btn--ghost" onClick={close}>
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
    </SheetShell>
  );
}
