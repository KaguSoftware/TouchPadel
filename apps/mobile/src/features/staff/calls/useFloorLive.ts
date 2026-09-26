/**
 * The waiter's calls, live: the private `floor` topic (0022, 0033's
 * `rt_waiter_call`, event `waiter_call`), which 0194 opened to the waiter.
 * Each event only says "a call changed"; the list is re-read, so the payload
 * (call id, table id, reason, status, time) is never shown or trusted.
 *
 * REFERENCE-COUNTED, one channel per token, like the courts channel
 * (features/availability/hooks.ts `useCourtsBroadcast`): Today stays mounted
 * under the calls page, and supabase-js hands back the SAME channel object for
 * a topic that already exists, so a channel per hook would be removed from
 * under the survivor by whichever unmounted first.
 *
 * The 30 s refetch on the calls query stays the safety net while the channel
 * is down; the page says so (`status !== 'live'`).
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';
import { addBreadcrumb, captureMessage } from '../../../lib/telemetry';
import { useAuth } from '../../auth/context';
import { staffKeys } from '../keys';

export type FloorStatus = 'connecting' | 'live' | 'down';

interface SharedFloor {
  token: string;
  channel: RealtimeChannel;
  consumers: number;
  removed: boolean;
  status: FloorStatus;
  onEvent: Set<() => void>;
  onStatus: Set<(s: FloorStatus) => void>;
}

let shared: SharedFloor | null = null;

function drop(s: SharedFloor): void {
  if (s.removed) return;
  s.removed = true;
  void supabase.removeChannel(s.channel);
  if (shared === s) shared = null;
}

function setStatus(s: SharedFloor, next: FloorStatus): void {
  s.status = next;
  for (const cb of s.onStatus) cb(next);
}

/** Subscribes while `enabled`; returns whether the list is live. */
export function useFloorLive(enabled: boolean): FloorStatus {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  // A page mounted while the channel is already up starts from its state.
  const [status, setLocal] = useState<FloorStatus>(() => shared?.status ?? 'connecting');

  useEffect(() => {
    if (!enabled || !token) return;
    // A rotated token retires the old channel now, so `channel('floor')`
    // below creates a fresh one instead of returning the stale instance.
    if (shared && shared.token !== token) drop(shared);
    if (!shared) {
      supabase.realtime.setAuth(token);
      const entry: SharedFloor = {
        token,
        channel: null as unknown as RealtimeChannel,
        consumers: 0,
        removed: false,
        status: 'connecting',
        onEvent: new Set(),
        onStatus: new Set(),
      };
      entry.channel = supabase
        .channel('floor', { config: { private: true } })
        .on('broadcast', { event: 'waiter_call' }, () => {
          for (const cb of entry.onEvent) cb();
        })
        .subscribe((state) => {
          if (state === 'SUBSCRIBED') {
            addBreadcrumb('realtime.floor.subscribed');
            // Back after a drop: whatever changed meanwhile is re-read.
            if (entry.status === 'down') for (const cb of entry.onEvent) cb();
            setStatus(entry, 'live');
          } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
            if (state !== 'CLOSED') captureMessage(`realtime.floor.${state}`, 'warning');
            setStatus(entry, 'down');
          }
        }) as RealtimeChannel;
      shared = entry;
    }
    const mine = shared;
    const invalidate = () => void queryClient.invalidateQueries({ queryKey: staffKeys.callsRoot });
    mine.onEvent.add(invalidate);
    mine.onStatus.add(setLocal);
    mine.consumers += 1;
    return () => {
      mine.onEvent.delete(invalidate);
      mine.onStatus.delete(setLocal);
      mine.consumers -= 1;
      if (mine.consumers === 0) drop(mine);
    };
  }, [enabled, token, queryClient]);

  return status;
}
