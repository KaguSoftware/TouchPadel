/**
 * Which rail rows and family tabs the signed-in person may open: their page
 * access (canAccess: role, second jobs, pages the owner blocked) and, for a
 * tab with a condition, the condition. Online deposits and open matches are
 * hidden while online payments are paused, exactly as their panels were
 * before they became tabs (features/deposits/useOnlinePaymentsLive.ts: fails
 * closed).
 */
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { appRpc } from './appRpc';
import { useAuth, canAccess } from './auth';
import { ONLINE_PAYMENTS_LIVE_KEY, readOnlinePaymentsLive } from '../features/deposits/useOnlinePaymentsLive';
import type { NavTab } from './workspaces';

/**
 * `(tab) => may this person open it here`. `enabled` false skips the online
 * payments read (the till, the desk and the kitchen have no conditional tabs)
 * and treats every conditional tab as closed.
 */
export function useTabOpen(enabled = true): (tab: NavTab) => boolean {
  const { staff } = useAuth();
  const live = useQuery({
    queryKey: ONLINE_PAYMENTS_LIVE_KEY,
    queryFn: async () => readOnlinePaymentsLive(await appRpc('online_payments_live')),
    staleTime: 5 * 60_000,
    enabled,
  });
  const paymentsLive = enabled && live.data === true;
  return useCallback(
    (tab: NavTab) => canAccess(staff, tab.to) && (tab.when !== 'onlinePaymentsLive' || paymentsLive),
    [staff, paymentsLive],
  );
}
