'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BrowserSupabase } from '@/lib/supabase/client';
import {
  mergeStatus,
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
  /** last reload failure, if the list on screen may be stale */
  loadError: string | null;
  orders: GuestOrder[];
  live: GuestOrder[];
  earlier: GuestOrder[];
  reload(): Promise<void>;
  /** apply an `order_status` broadcast (reloads when the order is unknown) */
  applyStatus(orderId: string, status: GuestOrderStatus): void;
}

export function useOrders(supabase: BrowserSupabase | null, sessionId: string | null): UseOrders {
  const [orders, setOrders] = useState<GuestOrder[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The 10-minute "served" rule needs a clock, not just new data.
  const [tick, setTick] = useState(() => Date.now());

  const reload = useCallback(async (): Promise<void> => {
    if (!supabase || !sessionId) {
      setOrders([]);
      return;
    }
    const { data, error } = await supabase
      .from('orders')
      .select(
        `id, status, placed_at,
         order_items ( id, qty, line_total_iqd, voided,
           menu_items ( name_en, name_ar ),
           menu_item_variants ( name_en, name_ar ) )`,
      )
      .eq('guest_session_id', sessionId)
      .order('placed_at', { ascending: false });
    // A PostgREST error used to be indistinguishable from "no orders": the old
    // `if (!data) return` silently kept whatever was on screen, so a guest
    // whose reload failed saw a stale list with no hint anything was wrong.
    if (error) {
      setLoadError(error.message);
      return;
    }
    setLoadError(null);
    if (!data) return;
    const now = new Date().toISOString();
    setOrders((prev) => {
      const previous = new Map(prev.map((o) => [o.id, o]));
      return data.map((o) => {
        // A reload can race a broadcast we already applied; never go backwards.
        const seen = previous.get(o.id);
        const status = seen
          ? mergeStatus(seen.status, o.status as GuestOrderStatus)
          : (o.status as GuestOrderStatus);
        return {
          id: o.id,
          status,
          placed_at: o.placed_at,
          served_at: status === 'served' ? (seen?.served_at ?? now) : null,
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
        };
      });
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
        return prev.map((o) => {
          if (o.id !== orderId) return o;
          // Broadcasts are unordered and at-least-once: a re-delivered
          // `preparing` after `ready` must not walk the progress bar back.
          const merged = mergeStatus(o.status, status);
          return {
            ...o,
            status: merged,
            served_at:
              merged === 'served' ? (o.served_at ?? new Date().toISOString()) : null,
          };
        });
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

  return { orders, live, earlier, reload, applyStatus, loadError };
}
