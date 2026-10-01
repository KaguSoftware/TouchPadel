'use client';

import { useEffect, useRef, useState } from 'react';
import { createResilientChannel, type RealtimeClientLike } from '@touch/core';
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
 * It runs before every (re)join.
 *
 * Self-recovering (@touch/core createResilientChannel, the operator hub's
 * model). The channel had no recovery at all: a guest whose phone slept, or
 * whose socket dropped, kept a stale order status until the next page load.
 * Now a dropped channel is rebuilt after a short jittered delay, and the
 * owner re-reads (`onRecover`) whenever events may have been missed: the
 * channel came back, the tab became visible again, or the network returned.
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
  /** Events may have been missed (reconnected, tab visible again, back online): re-read. */
  onRecover?(): void;
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
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!supabase || !sessionId) {
      setConnected(false);
      return;
    }
    const channel = createResilientChannel(supabase as unknown as RealtimeClientLike, {
      topic: `session:${sessionId}`,
      isPrivate: true,
      events: ['order_status', 'waiter_call_status'],
      onMessage: (event, payload) => {
        if (event === 'order_status') {
          const p = payload as Partial<OrderStatusPayload> | undefined;
          if (p?.order_id && p.status) {
            handlersRef.current.onOrderStatus?.({ order_id: p.order_id, status: p.status });
          }
        } else if (event === 'waiter_call_status') {
          const p = payload as Partial<WaiterCallStatusPayload> | undefined;
          if (p?.call_id && p.status) {
            handlersRef.current.onWaiterCallStatus?.(p as WaiterCallStatusPayload);
          }
        }
      },
      onRecover: () => handlersRef.current.onRecover?.(),
      onStatus: (status) => setConnected(status === 'live'),
      beforeSubscribe: () => supabase.realtime.setAuth(),
    });
    const resume = () => channel.resume();
    const onVisible = () => {
      if (document.visibilityState === 'visible') resume();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', resume);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', resume);
      setConnected(false);
      void channel.close();
    };
  }, [supabase, sessionId]);

  return { connected };
}
