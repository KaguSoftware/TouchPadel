/**
 * The waiter's calls, live: the private per-branch `floor:<venue_id>` topic
 * (0224; the building-wide `floor` topic of 0022/0033 is being retired), event
 * `waiter_call` from `rt_waiter_call`, readable by a waiter AT that branch
 * (touchpadel_rt_staff_topics, 0224). The branch is the one the phone works at
 * (StaffStatusProvider), so a waiter hears only their own branch's calls.
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
import { useStaffStatus } from '../StaffStatusProvider';
import { staffKeys } from '../keys';

export type FloorStatus = 'connecting' | 'live' | 'down';

interface SharedFloor {
  token: string;
  topic: string;
  channel: RealtimeChannel;
  consumers: number;
  removed: boolean;
  status: FloorStatus;
  onEvent: Set<() => void>;
  onStatus: Set<(s: FloorStatus) => void>;
}

/** The live channel per topic (one branch at a time in practice; keyed so a switch never reuses the old one). */
const shared = new Map<string, SharedFloor>();

/** The branch's floor topic (0224). */
export function floorTopic(venueId: string): string {
  return `floor:${venueId}`;
}

/**
 * Topics whose channel is still leaving: `channel(topic)` hands back a channel
 * still LEAVING after `removeChannel`, and `subscribe()` on it does nothing, so
 * a new channel on a topic waits for the old one's removal (the operator's
 * lib/realtime.ts rule). A quick branch switch back, or a token rotation, used
 * to land on a dead channel.
 */
const leaving = new Map<string, Promise<unknown>>();

function drop(s: SharedFloor): void {
  if (s.removed) return;
  s.removed = true;
  const done = supabase.removeChannel(s.channel).catch(() => undefined);
  leaving.set(s.topic, done);
  void done.then(() => {
    if (leaving.get(s.topic) === done) leaving.delete(s.topic);
  });
  if (shared.get(s.topic) === s) shared.delete(s.topic);
}

function setStatus(s: SharedFloor, next: FloorStatus): void {
  s.status = next;
  for (const cb of s.onStatus) cb(next);
}

/** Subscribes while `enabled` and the phone has a venue; returns whether the list is live. */
export function useFloorLive(enabled: boolean): FloorStatus {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { venueId } = useStaffStatus();
  const token = session?.access_token ?? null;
  const topic = venueId ? floorTopic(venueId) : null;
  // A page mounted while the channel is already up starts from its state.
  const [status, setLocal] = useState<FloorStatus>(
    () => (topic ? shared.get(topic)?.status : undefined) ?? 'connecting',
  );

  useEffect(() => {
    if (!enabled || !token || !topic) return;
    let cancelled = false;
    let joined: { mine: SharedFloor; invalidate: () => void } | null = null;
    const join = (): void => {
      if (cancelled) return;
      // A rotated token retires the old channel now, so the channel below is a
      // fresh one instead of the stale instance.
      const existing = shared.get(topic);
      if (existing && existing.token !== token) drop(existing);
      if (!shared.get(topic)) {
        const pending = leaving.get(topic);
        if (pending) {
          void pending.then(join);
          return;
        }
      }
      const mine = entryFor(topic, token);
      const invalidate = () =>
        void queryClient.invalidateQueries({ queryKey: staffKeys.callsRoot });
      mine.onEvent.add(invalidate);
      mine.onStatus.add(setLocal);
      mine.consumers += 1;
      joined = { mine, invalidate };
    };
    join();
    return () => {
      cancelled = true;
      if (!joined) return;
      const { mine, invalidate } = joined;
      mine.onEvent.delete(invalidate);
      mine.onStatus.delete(setLocal);
      mine.consumers -= 1;
      if (mine.consumers === 0) drop(mine);
    };
  }, [enabled, token, topic, queryClient]);

  return status;
}

/** The shared floor channel for a topic, created (and subscribed) when there is none. */
function entryFor(topic: string, token: string): SharedFloor {
  let entry = shared.get(topic);
  if (!entry) {
    supabase.realtime.setAuth(token);
    const created: SharedFloor = {
      token,
      topic,
      channel: null as unknown as RealtimeChannel,
      consumers: 0,
      removed: false,
      status: 'connecting',
      onEvent: new Set(),
      onStatus: new Set(),
    };
    created.channel = supabase
      .channel(topic, { config: { private: true } })
      .on('broadcast', { event: 'waiter_call' }, () => {
        for (const cb of created.onEvent) cb();
      })
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') {
          addBreadcrumb('realtime.floor.subscribed');
          // Back after a drop: whatever changed meanwhile is re-read.
          if (created.status === 'down') for (const cb of created.onEvent) cb();
          setStatus(created, 'live');
        } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
          if (state !== 'CLOSED') captureMessage(`realtime.floor.${state}`, 'warning');
          setStatus(created, 'down');
        }
      }) as RealtimeChannel;
    shared.set(topic, created);
    entry = created;
  }
  return entry;
}
