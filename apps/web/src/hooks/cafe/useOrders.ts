'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BrowserSupabase } from '@/lib/supabase/client';
import {
  ordersPartition,
  type GuestOrder,
  type GuestOrderStatus,
} from './orders';

/**
 * The session's own orders (RLS lets a guest read only their own — 0015).
 * Status arrives live on `session:{id}` (`useSessionChannel` → `applyStatus`);
 * `reload()` covers the first paint, a submit, and any broadcast for an order
 * we have not seen yet.
 */
const PARTITION_TICK_MS = 60_000;

export interface UseOrders {
  orders: GuestOrder[];
  live: GuestOrder[];
  earlier: GuestOrder[];
  reload(): Promise<void>;
  /** apply an `order_status` broadcast (reloads when the order is unknown) */
  applyStatus(orderId: string, status: GuestOrderStatus): void;
}

export function useOrders(supabase: BrowserSupabase | null, sessionId: string | null): UseOrders {
  const [orders, setOrders] = useState<GuestOrder[]>([]);
  // The 10-minute "served" rule needs a clock, not just new data.
  const [tick, setTick] = useState(() => Date.now());

  const reload = useCallback(async (): Promise<void> => {
    if (!supabase || !sessionId) {
      setOrders([]);
      return;
    }
    const { data } = await supabase
      .from('orders')
      .select(
        `id, status, placed_at,
         order_items ( id, qty, line_total_iqd, voided,
           menu_items ( name_en, name_ar ),
           menu_item_variants ( name_en, name_ar ) )`,
      )
      .eq('guest_session_id', sessionId)
      .order('placed_at', { ascending: false });
    if (!data) return;
    const now = new Date().toISOString();
    setOrders((prev) => {
      const servedAt = new Map(prev.map((o) => [o.id, o.served_at ?? null]));
      return data.map((o) => ({
        id: o.id,
        status: o.status as GuestOrderStatus,
        placed_at: o.placed_at,
        served_at:
          o.status === 'served' ? (servedAt.get(o.id) ?? now) : null,
        items: (o.order_items ?? []).map((oi) => ({
          id: oi.id,
          qty: oi.qty,
          line_total_iqd: oi.line_total_iqd,
          voided: oi.voided ?? false,
          name_en: oi.menu_items?.name_en ?? '',
          name_ar: oi.menu_items?.name_ar ?? '',
          variant_en: oi.menu_item_variants?.name_en ?? '',
          variant_ar: oi.menu_item_variants?.name_ar ?? '',
        })),
      }));
    });
    setTick(Date.now());
  }, [supabase, sessionId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const applyStatus = useCallback(
    (orderId: string, status: GuestOrderStatus) => {
      let known = false;
      setOrders((prev) => {
        known = prev.some((o) => o.id === orderId);
        if (!known) return prev;
        return prev.map((o) =>
          o.id === orderId
            ? {
                ...o,
                status,
                served_at:
                  status === 'served' ? (o.served_at ?? new Date().toISOString()) : null,
              }
            : o,
        );
      });
      // A brand-new order (or one placed on another device) needs its lines.
      if (!known) void reload();
    },
    [reload],
  );

  // Re-partition on a slow clock so a served order slides to "Earlier" on time.
  useEffect(() => {
    if (orders.length === 0) return;
    const id = setInterval(() => setTick(Date.now()), PARTITION_TICK_MS);
    return () => clearInterval(id);
  }, [orders.length]);

  const { live, earlier } = useMemo(() => ordersPartition(orders, tick), [orders, tick]);

  return { orders, live, earlier, reload, applyStatus };
}
