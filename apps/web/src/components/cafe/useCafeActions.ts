'use client';

import { useCallback } from 'react';
import type { Locale } from '@touch/i18n';
import { makeT } from '@touch/i18n';
import type { MenuItem } from '@/lib/menu';
import type { BasketLine } from '@/lib/cafe/basket';
import { track, type ItemSource } from '@/lib/analytics/track';
import { buzz, tap } from '@/lib/haptics';
import type { UseBasket } from '@/hooks/cafe/useBasket';
import type { UseMenu } from '@/hooks/cafe/useMenu';
import type { UseOrders } from '@/hooks/cafe/useOrders';
import type { UseTableSession } from '@/hooks/cafe/useTableSession';
import type { UseWaiterCall, WaiterReason } from '@/hooks/cafe/useWaiterCall';
import type { UseToasts } from '@/hooks/cafe/useToasts';
import type { BrowserSupabase } from '@/lib/supabase/client';
import { submitGuestOrder } from './submitGuestOrder';

/**
 * Every guest ACTION (open item, add, remove, send, call a waiter) with its
 * analytics event, haptic and toast. Extracted from `CafeApp` so the
 * orchestrator is state + layout: this file is where "what happens when the
 * guest taps" lives, and the only place RPC outcomes are translated into UI.
 */
export interface CafeActionsDeps {
  locale: Locale;
  supabase: BrowserSupabase | null;
  table: UseTableSession;
  menu: UseMenu;
  basket: UseBasket;
  orders: UseOrders;
  waiter: UseWaiterCall;
  toasts: UseToasts;
  sourceRef: React.MutableRefObject<ItemSource>;
  setSheetItem(item: MenuItem | null): void;
  setBasketOpen(open: boolean): void;
  setWaiterOpen(open: boolean): void;
  setQrRequired(reason: 'order' | 'waiter' | null): void;
  setSending(sending: boolean): void;
  setTutorialOpen(open: boolean): void;
}

export function useCafeActions(d: CafeActionsDeps) {
  const tr = makeT(d.locale);
  const { basket, table, menu, orders, waiter, toasts, supabase } = d;

  const openItem = useCallback(
    (item: MenuItem, source: ItemSource) => {
      tap();
      d.sourceRef.current = source;
      d.setSheetItem(item);
    },
    [d],
  );

  const requireQr = useCallback(
    (reason: 'order' | 'waiter') => {
      d.setQrRequired(reason);
      track.qrRequiredShown({ action: reason });
    },
    [d],
  );

  const itemViewed = useCallback(
    (item: MenuItem) =>
      track.itemViewed({
        item_id: item.id,
        item_name: item.name_en,
        category_id: item.category_id,
        price_iqd: item.variants[0]?.price_iqd ?? 0,
        discount_pct: item.discountPct,
        source: d.sourceRef.current,
        has_photo: Boolean(item.photo_url),
      }),
    [d.sourceRef],
  );

  const addLine = useCallback(
    (line: BasketLine) => {
      basket.add(line);
      d.setSheetItem(null);
      tap();
      toasts.show(tr('cafe.addedToBasket'));
      track.itemAddedToBasket({
        item_id: line.itemId,
        item_name: line.item_name_en,
        variant_id: line.variantId,
        price_iqd: line.unit_price_iqd,
        qty: line.qty,
        modifiers_count: line.modifiers.length,
        has_note: Boolean(line.notes),
        discount_pct: line.discount_pct,
      });
    },
    [basket, toasts, tr, d],
  );

  const removeLine = useCallback(
    (key: string) => {
      const line = basket.lines.find((l) => l.key === key);
      basket.remove(key);
      if (line) {
        track.itemRemovedFromBasket({
          item_id: line.itemId,
          item_name: line.item_name_en,
          qty: line.qty,
        });
      }
    },
    [basket],
  );

  /** After a stale-basket refusal (or any menu refresh): re-price, then say so. */
  const refreshAndReconcile = useCallback(async () => {
    await menu.refresh();
    for (const key of basket.reconcile(menu.menu, menu.settings)) toasts.show(tr(`cafe.${key}`));
  }, [menu, basket, toasts, tr]);

  const submit = useCallback(async () => {
    if (basket.lines.length === 0) return;
    if (!table.session || !supabase) {
      d.setBasketOpen(false);
      requireQr('order');
      return;
    }
    d.setSending(true);
    const result = await submitGuestOrder(
      supabase,
      basket.lines,
      basket.note,
      basket.idemKey.current(),
    );
    d.setSending(false);

    if (result.kind === 'ok') {
      track.orderSubmitted({
        order_id: result.orderId,
        total_iqd: basket.total,
        subtotal_iqd: basket.subtotal,
        discount_total_iqd: basket.discountTotal,
        item_count: basket.count,
        line_count: basket.lines.length,
        has_note: basket.note.trim() !== '',
      });
      basket.clear();
      d.setBasketOpen(false);
      buzz();
      toasts.show(tr('cafe.sentToWaiter'));
      void orders.reload();
      table.touched();
      return;
    }

    track.orderFailed({ error_type: result.kind === 'expired' ? 'SESSION_EXPIRED' : result.code });
    if (result.kind === 'expired') {
      table.markExpired();
      toasts.show(tr('errors.sessionTableExpired'), 'error');
      return;
    }
    toasts.show(tr(result.messageKey), 'error');
    // ITEM_UNAVAILABLE / MODIFIER_* mean the menu moved under the guest.
    if (result.kind === 'stale') void refreshAndReconcile();
  }, [basket, table, supabase, orders, toasts, tr, requireQr, refreshAndReconcile, d]);

  const raiseCall = useCallback(
    async (reason: WaiterReason) => {
      const result = await waiter.raise(reason);
      if (result.ok) {
        buzz();
        track.waiterCalled({ kind: reason });
        table.touched();
        return;
      }
      if (result.kind === 'expired') {
        d.setWaiterOpen(false);
        table.markExpired();
        toasts.show(tr('errors.sessionTableExpired'), 'error');
        return;
      }
      // ALREADY_NOTIFIED / CALL_COOLDOWN are reassurance, not failure.
      toasts.show(tr(result.messageKey), result.kind === 'cooldown' ? 'info' : 'error');
      if (result.kind === 'cooldown') d.setWaiterOpen(false);
    },
    [waiter, table, toasts, tr, d],
  );

  const bellTapped = useCallback(() => {
    tap();
    d.setTutorialOpen(false);
    if (!table.session) {
      requireQr('waiter');
      return;
    }
    if (!table.bellEnabled) {
      toasts.show(tr('cafe.bellDisabled'));
      return;
    }
    waiter.reset();
    d.setWaiterOpen(true);
  }, [table.session, table.bellEnabled, waiter, toasts, tr, requireQr, d]);

  const itemAbandoned = useCallback(
    (item: MenuItem, dwellMs: number) =>
      track.itemViewAbandoned({ item_id: item.id, item_name: item.name_en, dwell_ms: dwellMs }),
    [],
  );

  return {
    openItem,
    requireQr,
    itemViewed,
    itemAbandoned,
    addLine,
    removeLine,
    submit,
    raiseCall,
    bellTapped,
    refreshAndReconcile,
  };
}
