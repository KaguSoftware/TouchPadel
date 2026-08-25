/**
 * Broadcast-from-database subscriptions (0022_realtime.sql).
 * Topics: 'kds' (private), 'courts' (private, any authenticated), 'floor'
 * (private, staff), 'menu' (public). Private topics require realtime auth —
 * supabase.realtime.setAuth(token) runs in AuthProvider on session change.
 *
 * Connection state is exposed as `status`; on CHANNEL_ERROR / TIMED_OUT /
 * CLOSED the channel is torn down and recreated after a jittered 4–7 s delay
 * while still mounted (mirrors UpperDeck §3.5). Polling refetchIntervals in
 * the callers remain the safety net while disconnected.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { supabase } from './supabase';

export type BroadcastStatus = 'connecting' | 'live' | 'disconnected';

export const RECONNECT_MIN_MS = 4_000;
export const RECONNECT_MAX_MS = 7_000;

export interface BroadcastOptions {
  topic: string;
  /** Private topics are authorized by RLS on realtime.messages. */
  isPrivate: boolean;
  /** Broadcast event names to listen for ('*' matches all). */
  events?: readonly string[];
  enabled?: boolean;
  onEvent?: (event: string, payload: unknown) => void;
  onStatus?: (status: BroadcastStatus) => void;
  /** Query keys invalidated on every received event. */
  invalidateKeys?: readonly QueryKey[];
}

export interface BroadcastResult {
  status: BroadcastStatus;
}

/**
 * Subscribe to a broadcast topic and invalidate the given queries whenever a
 * message lands — the broadcast is a cache-bust hint; data reloads from tables.
 * Returns the live connection status (callers may ignore it).
 */
export function useBroadcast(options: BroadcastOptions): BroadcastResult {
  const queryClient = useQueryClient();
  const {
    topic,
    isPrivate,
    events = ['*'],
    enabled = true,
    onEvent,
    onStatus,
    invalidateKeys = [],
  } = options;
  // Key the effect on serialized inputs so callers can pass fresh literals.
  const eventsKey = events.join(',');
  const keysKey = JSON.stringify(invalidateKeys);
  const [status, setStatus] = useState<BroadcastStatus>(enabled ? 'connecting' : 'disconnected');

  // Latest callbacks without re-subscribing when the caller passes new closures.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const update = (s: BroadcastStatus) => {
      if (!mounted) return;
      setStatus((prev) => (prev === s ? prev : s));
      onStatusRef.current?.(s);
    };

    const teardown = () => {
      if (channel) {
        void supabase.removeChannel(channel);
        channel = null;
      }
    };

    const scheduleReconnect = () => {
      if (!mounted || retry) return;
      const delay = RECONNECT_MIN_MS + Math.random() * (RECONNECT_MAX_MS - RECONNECT_MIN_MS);
      retry = setTimeout(() => {
        retry = null;
        if (!mounted) return;
        teardown();
        connect();
      }, delay);
    };

    const connect = () => {
      update('connecting');
      const ch = supabase.channel(topic, { config: { private: isPrivate } });
      channel = ch;
      for (const event of eventsKey.split(',')) {
        ch.on('broadcast', { event }, (message) => {
          onEventRef.current?.(message.event, message.payload);
          for (const key of JSON.parse(keysKey) as QueryKey[]) {
            void queryClient.invalidateQueries({ queryKey: key });
          }
        });
      }
      ch.subscribe((state) => {
        if (!mounted || ch !== channel) return;
        if (state === 'SUBSCRIBED') {
          update('live');
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
          update('disconnected');
          scheduleReconnect();
        }
      });
    };

    connect();
    return () => {
      mounted = false;
      if (retry) clearTimeout(retry);
      teardown();
    };
  }, [topic, isPrivate, eventsKey, keysKey, enabled, queryClient]);

  return { status };
}
