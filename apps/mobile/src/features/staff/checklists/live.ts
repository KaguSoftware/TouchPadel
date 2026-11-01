/**
 * The checklists, live (Ameen, 2026-10-31: "use websockets, which are
 * implemented across the system").
 *
 * One broadcast-from-database topic (migration 0375 §4), private and per
 * branch, joined over the shared, self-recovering channel machinery the courts
 * grid and the leaderboard use (availability/courtsChannel.ts):
 *
 *   checklists:<venue> 'changed': a line was ticked or unticked, a copy was
 *                      opened, or the owner saved or archived a list (a new
 *                      line reaches the copy open now, 0375 §1).
 *
 * The event only says "something changed"; its payload is never read. The
 * phone re-reads `my_checklists_today` (Today's badge, Work alerts, the
 * checklist page) and the past lists, so what shows is always the server's
 * answer. A channel that drops comes back and re-reads; returning to the app
 * re-reads. Readable by any active staff member at the branch
 * (touchpadel_rt_checklists).
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeClientLike } from '@touch/core';
import { supabase } from '../../../lib/supabase';
import { addBreadcrumb, captureMessage } from '../../../lib/telemetry';
import { useAuth } from '../../auth/context';
import { createCourtsChannels } from '../../availability/courtsChannel';
import { staffKeys } from '../keys';

/** The branch's checklists topic (0375). */
export function checklistsTopic(venueId: string): string {
  return `checklists:${venueId}`;
}

function onAppForeground(cb: () => void): () => void {
  let last = AppState.currentState as AppStateStatus;
  const sub = AppState.addEventListener('change', (next) => {
    if (next === 'active' && last !== 'active') cb();
    last = next;
  });
  return () => sub.remove();
}

const channels = createCourtsChannels({
  client: supabase as unknown as RealtimeClientLike,
  setAuth: (token) => supabase.realtime.setAuth(token),
  onForeground: onAppForeground,
  events: ['changed'],
  onStatus: (_topic, status) => {
    if (status === 'live') addBreadcrumb('realtime.checklists.subscribed');
    else if (status === 'disconnected') captureMessage('realtime.checklists.disconnected', 'warning');
  },
});

/** Joins the branch's checklists topic while mounted, signed in and at a venue. */
export function useChecklistsLive(venueId: string | null | undefined): void {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const signedIn = token !== null;
  const tokenRef = useRef(token);
  // A burst (a list saved syncs every open copy) is one re-read, not one per copy.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const venueRef = useRef(venueId);
  useEffect(() => {
    venueRef.current = venueId;
  }, [venueId]);
  const reread = useRef(() => {
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      const venue = venueRef.current;
      if (!venue) return;
      void queryClient.invalidateQueries({ queryKey: staffKeys.checklists(venue) });
      void queryClient.invalidateQueries({ queryKey: staffKeys.checklistHistory(venue) });
    }, 250);
  });

  useEffect(() => {
    tokenRef.current = token;
    if (token) channels.setToken(token);
  }, [token]);

  useEffect(() => {
    const current = tokenRef.current;
    if (!venueId || !current) return;
    const listener = { onSlot: () => reread.current(), onRecover: () => reread.current() };
    return channels.join(checklistsTopic(venueId), current, listener);
  }, [venueId, signedIn]);

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );
}
