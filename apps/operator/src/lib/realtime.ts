/**
 * Broadcast-from-database subscriptions (0022_realtime.sql).
 * Topics: 'kds' (private), 'courts' (private, any authenticated), 'floor'
 * (private, staff), 'menu' (public). Private topics require realtime auth —
 * supabase.realtime.setAuth(token) runs in AuthProvider on session change.
 *
 * ONE channel per topic, shared by every mounted subscriber and reference
 * counted. realtime-js keys channels by topic: `channel(topic)` hands back any
 * channel already listed under it, including one still LEAVING after
 * `removeChannel` (which awaits the server's leave before it unlists it), and
 * `subscribe()` on that channel does nothing. With a channel per hook, a
 * screen change that unmounted one `courts` subscriber and mounted another got
 * the dying channel, never went live, and stopped hearing events with no
 * error; two screens on one topic shared a channel whichever unmounted first
 * then removed from under the other. So the hub owns the channel, and a new
 * one is only created once the old one's removal has finished.
 *
 * On CHANNEL_ERROR / TIMED_OUT / CLOSED the channel is removed and recreated
 * after a jittered 4–7 s delay while anyone is still subscribed (mirrors
 * UpperDeck §3.5). A channel that comes back tells its subscribers it
 * RECOVERED, so they re-read whatever they missed while it was down; the
 * callers' polling refetchIntervals stay the safety net meanwhile.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { supabase } from './supabase';

export type BroadcastStatus = 'connecting' | 'live' | 'disconnected';

export const RECONNECT_MIN_MS = 4_000;
export const RECONNECT_MAX_MS = 7_000;

/** The slice of the Supabase client the hub uses (a fake in tests). */
export interface RealtimeClient {
  channel(topic: string, opts: { config: { private: boolean } }): RealtimeChannelLike;
  removeChannel(channel: RealtimeChannelLike): Promise<unknown>;
}
export interface RealtimeChannelLike {
  on(type: 'broadcast', filter: { event: string }, cb: (message: { event: string; payload?: unknown }) => void): unknown;
  subscribe(cb: (state: string) => void): unknown;
}

export interface Subscriber {
  /** Event names to hear; '*' hears all. */
  events: ReadonlySet<string>;
  onMessage(event: string, payload: unknown): void;
  /** `recovered`: live again after being down, so events may have been missed. */
  onStatus(status: BroadcastStatus, recovered: boolean): void;
}

interface Entry {
  subs: Set<Subscriber>;
  channel: RealtimeChannelLike | null;
  status: BroadcastStatus;
  wasLive: boolean;
  retry: ReturnType<typeof setTimeout> | null;
  /** Settles once the previous channel on this topic is fully removed. */
  removing: Promise<unknown>;
}

export function createBroadcastHub(client: RealtimeClient, random: () => number = Math.random) {
  const entries = new Map<string, Entry>();
  /** A topic's last channel still being removed, for the next subscriber to wait on. */
  const leaving = new Map<string, Promise<unknown>>();
  const key = (topic: string, isPrivate: boolean) => `${isPrivate ? 'p' : 'o'}:${topic}`;

  const notify = (e: Entry, s: BroadcastStatus, recovered = false) => {
    e.status = s;
    for (const sub of e.subs) sub.onStatus(s, recovered);
  };

  const drop = (e: Entry) => {
    if (!e.channel) return;
    const ch = e.channel;
    e.channel = null;
    e.removing = e.removing.then(() => client.removeChannel(ch)).catch(() => undefined);
  };

  const connect = (topic: string, isPrivate: boolean, e: Entry) => {
    notify(e, 'connecting');
    void e.removing.then(() => {
      // Everyone left while the old channel was going: nothing to join.
      if (e.subs.size === 0 || entries.get(key(topic, isPrivate)) !== e || e.channel) return;
      const ch = client.channel(topic, { config: { private: isPrivate } });
      e.channel = ch;
      ch.on('broadcast', { event: '*' }, (m) => {
        if (ch !== e.channel) return;
        for (const sub of [...e.subs]) {
          if (sub.events.has('*') || sub.events.has(m.event)) sub.onMessage(m.event, m.payload);
        }
      });
      ch.subscribe((state) => {
        if (ch !== e.channel) return;
        if (state === 'SUBSCRIBED') {
          const recovered = e.wasLive;
          e.wasLive = true;
          notify(e, 'live', recovered);
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
          notify(e, 'disconnected');
          if (e.retry) return;
          const delay = RECONNECT_MIN_MS + random() * (RECONNECT_MAX_MS - RECONNECT_MIN_MS);
          e.retry = setTimeout(() => {
            e.retry = null;
            if (e.subs.size === 0) return;
            drop(e);
            connect(topic, isPrivate, e);
          }, delay);
        }
      });
    });
  };

  /** Joins `topic`; returns the leave. The channel goes when its last subscriber does. */
  function subscribe(topic: string, isPrivate: boolean, sub: Subscriber): () => void {
    const k = key(topic, isPrivate);
    let e = entries.get(k);
    if (!e) {
      e = { subs: new Set(), channel: null, status: 'connecting', wasLive: false, retry: null, removing: leaving.get(k) ?? Promise.resolve() };
      entries.set(k, e);
      e.subs.add(sub);
      connect(topic, isPrivate, e);
    } else {
      e.subs.add(sub);
      sub.onStatus(e.status, false);
    }
    const entry = e;
    return () => {
      if (!entry.subs.delete(sub) || entry.subs.size > 0) return;
      if (entry.retry) clearTimeout(entry.retry);
      entry.retry = null;
      drop(entry);
      entries.delete(k);
      leaving.set(k, entry.removing);
    };
  }

  return { subscribe };
}

const hub = createBroadcastHub(supabase as unknown as RealtimeClient);

export interface BroadcastOptions {
  topic: string;
  /** Private topics are authorized by RLS on realtime.messages. */
  isPrivate: boolean;
  /** Broadcast event names to listen for ('*' matches all). */
  events?: readonly string[];
  enabled?: boolean;
  onEvent?: (event: string, payload: unknown) => void;
  onStatus?: (status: BroadcastStatus) => void;
  /** Query keys invalidated on every received event, and when the channel recovers. */
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
    const invalidate = () => {
      for (const key of JSON.parse(keysKey) as QueryKey[]) void queryClient.invalidateQueries({ queryKey: key });
    };
    const leave = hub.subscribe(topic, isPrivate, {
      events: new Set(eventsKey.split(',')),
      onMessage: (event, payload) => {
        if (!mounted) return;
        onEventRef.current?.(event, payload);
        invalidate();
      },
      onStatus: (s, recovered) => {
        if (!mounted) return;
        setStatus((prev) => (prev === s ? prev : s));
        onStatusRef.current?.(s);
        if (recovered) invalidate();
      },
    });
    return () => {
      mounted = false;
      leave();
    };
  }, [topic, isPrivate, eventsKey, keysKey, enabled, queryClient]);

  return { status };
}
