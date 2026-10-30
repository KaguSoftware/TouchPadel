/**
 * The leaderboard, live (Majed, 2026-10-22: "it uses websockets, like the whole system").
 *
 * Two broadcast-from-database topics (migration 0364 §9), both private, joined over the shared,
 * self-recovering channel machinery the courts grid uses (availability/courtsChannel.ts):
 *
 *   ranks              'board': points were written, or a rule or a level changed.
 *   ranks:<profile id> 'result': a result this guest is on was reported, confirmed, turned down
 *                      or voided (their "confirm a score" card, their games).
 *
 * Each event only says "something changed"; the payload is never read. The phone re-reads
 * `ranks_board` and `my_ranks`, so what shows is always the server's answer. A channel that drops
 * comes back and re-reads; returning to the app re-reads. Signed out, nothing is joined and the
 * board's 30 s stale time is the refresh.
 */
import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeClientLike } from '@touch/core';
import { supabase } from '../../lib/supabase';
import { addBreadcrumb, captureMessage } from '../../lib/telemetry';
import { useAuth } from '../auth/context';
import { createCourtsChannels } from '../availability/courtsChannel';
import { ranksKeys } from './keys';

/** The board's topic, one for the whole business (points are business-wide, like loyalty's). */
export const RANKS_BOARD_TOPIC = 'ranks';
/** A guest's own results topic. */
export function ranksPlayerTopic(profileId: string): string {
  return `ranks:${profileId}`;
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
  events: ['board', 'result'],
  onStatus: (topic, status) => {
    if (status === 'live') addBreadcrumb('realtime.ranks.subscribed', { topic: topic.split(':')[0] });
    else if (status === 'disconnected') captureMessage('realtime.ranks.disconnected', 'warning');
  },
});

/** Joins the board and the guest's own topic while mounted and signed in. */
export function useRanksLive(): void {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const userId = session && !session.user.is_anonymous ? session.user.id : null;
  const tokenRef = useRef(token);
  // A burst (a confirm writes four ledger rows) is one re-read, not four.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reread = useRef(() => {
    if (pending.current) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      void queryClient.invalidateQueries({ queryKey: ranksKeys.board });
      void queryClient.invalidateQueries({ queryKey: ranksKeys.mine });
    }, 250);
  });

  useEffect(() => {
    tokenRef.current = token;
    if (token) channels.setToken(token);
  }, [token]);

  useEffect(() => {
    const current = tokenRef.current;
    if (!userId || !current) return;
    const listener = { onSlot: () => reread.current(), onRecover: () => reread.current() };
    const leaveBoard = channels.join(RANKS_BOARD_TOPIC, current, listener);
    const leaveMine = channels.join(ranksPlayerTopic(userId), current, listener);
    return () => {
      leaveBoard();
      leaveMine();
    };
  }, [userId]);

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );
}
