'use client';

import { useEffect, useRef, useState } from 'react';
import type { BrowserSupabase } from '@/lib/supabase/client';
import type { GuestOrderStatus } from './orders';
import type { WaiterCallStatus } from './waiter';

/**
 * THE single realtime channel for a bound guest session (`session:{id}`,
 * private — the 0022 policy `touchpadel_rt_guest_session` authorises the topic
 * while the session is live). Two hooks used to open their own channel; one
 * subscription now fans out to both:
 *   • `order_status`      → useOrders   (0022)
 *   • `waiter_call_status`→ useWaiterCall (0033 — replaced the 20 s poll)
 *
 * `realtime.setAuth()` MUST run before subscribing: a private topic is
 * authorised from the socket's access token, which is not attached until then.
 */
export interface OrderStatusPayload {
  order_id: string;
  status: GuestOrderStatus;
}

export interface WaiterCallStatusPayload {
  call_id: string;
  status: WaiterCallStatus;
  reason?: string;
  raised_at?: string;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
}

export interface SessionChannelHandlers {
  onOrderStatus?(payload: OrderStatusPayload): void;
  onWaiterCallStatus?(payload: WaiterCallStatusPayload): void;
}

export function useSessionChannel(
  supabase: BrowserSupabase | null,
  sessionId: string | null,
  handlers: SessionChannelHandlers,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  // Handlers change on every CafeApp render; keep them in a ref so the channel
  // is subscribed exactly once per session (StrictMode-safe).
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!supabase || !sessionId) {
      setConnected(false);
      return;
    }
    let cancelled = false;
    void supabase.realtime.setAuth();
    const channel = supabase
      .channel(`session:${sessionId}`, { config: { private: true } })
      .on('broadcast', { event: 'order_status' }, (msg) => {
        const p = msg.payload as Partial<OrderStatusPayload>;
        if (p?.order_id && p.status) {
          handlersRef.current.onOrderStatus?.({ order_id: p.order_id, status: p.status });
        }
      })
      .on('broadcast', { event: 'waiter_call_status' }, (msg) => {
        const p = msg.payload as Partial<WaiterCallStatusPayload>;
        if (p?.call_id && p.status) {
          handlersRef.current.onWaiterCallStatus?.(p as WaiterCallStatusPayload);
        }
      })
      .subscribe((status) => {
        if (!cancelled) setConnected(status === 'SUBSCRIBED');
      });
    return () => {
      cancelled = true;
      setConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [supabase, sessionId]);

  return { connected };
}
