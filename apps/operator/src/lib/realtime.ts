/**
 * Broadcast-from-database subscriptions (0022_realtime.sql).
 * Topics: 'kds' (private), 'courts' (private, any authenticated), 'floor'
 * (private, staff), 'menu' (public). Private topics require realtime auth —
 * supabase.realtime.setAuth(token) runs in AuthProvider on session change.
 */
import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { supabase } from './supabase';

export interface BroadcastOptions {
  topic: string;
  /** Private topics are authorized by RLS on realtime.messages. */
  isPrivate: boolean;
  /** Broadcast event names to listen for ('*' matches all). */
  events?: readonly string[];
  enabled?: boolean;
  onEvent?: (event: string, payload: unknown) => void;
  /** Query keys invalidated on every received event. */
  invalidateKeys?: readonly QueryKey[];
}

/**
 * Subscribe to a broadcast topic and invalidate the given queries whenever a
 * message lands — the broadcast is a cache-bust hint; data reloads from tables.
 */
export function useBroadcast(options: BroadcastOptions): void {
  const queryClient = useQueryClient();
  const {
    topic,
    isPrivate,
    events = ['*'],
    enabled = true,
    onEvent,
    invalidateKeys = [],
  } = options;
  // Key the effect on serialized inputs so callers can pass fresh literals.
  const eventsKey = events.join(',');
  const keysKey = JSON.stringify(invalidateKeys);

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase.channel(topic, { config: { private: isPrivate } });
    for (const event of eventsKey.split(',')) {
      channel.on('broadcast', { event }, (message) => {
        onEvent?.(message.event, message.payload);
        for (const key of JSON.parse(keysKey) as QueryKey[]) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      });
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, isPrivate, eventsKey, keysKey, enabled, queryClient]);
}
