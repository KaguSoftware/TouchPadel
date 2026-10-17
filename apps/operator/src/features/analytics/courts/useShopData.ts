/**
 * The Touch Shop figures for the Courts tab: `app.analytics_shop` for the
 * current and the compare window. The key sits under COURTS_KEY, so the tab's
 * refetchAll reloads it with the court queries, and it is the key
 * useVenueRevenue subscribes to: react-query fetches each window once.
 *
 * The shop is not tied to a court, so the court filter never narrows it.
 */
import { useQuery } from '@tanstack/react-query';
import type { DateRange } from '@touch/core';
import type { Json } from '@touch/db';
import { useCafeSettings } from '../../../lib/settings';
import type { CardState } from '../cards/CardShell';
import { parseShop, shopRpc, type ShopSummary } from './shop';
import { COURTS_KEY } from './useCourtsData';

export const shopQueryKey = (range: DateRange) => [...COURTS_KEY, 'analytics_shop', range.from, range.to] as const;

export function useShopWindow(range: DateRange, enabled: boolean) {
  return useQuery({
    queryKey: shopQueryKey(range),
    queryFn: () => shopRpc(range),
    enabled,
    staleTime: 30_000,
  });
}

export interface ShopData {
  current: ShopSummary | null;
  previous: ShopSummary | null;
  /** The CURRENT window's state; a failed baseline only mutes the change. */
  state: CardState;
  refreshing: boolean;
  error: unknown;
}

export function useShopData(range: DateRange, compareRange: DateRange): ShopData {
  const settings = useCafeSettings();
  const ready = settings.isSuccess || settings.isError;
  const now = useShopWindow(range, ready);
  const prev = useShopWindow(compareRange, ready);
  const state: CardState = !ready || now.isPending ? 'loading' : now.isError ? 'error' : 'ready';
  return {
    current: now.data !== undefined ? parseShop(now.data as Json) : null,
    previous: prev.data !== undefined ? parseShop(prev.data as Json) : null,
    state,
    refreshing: now.data !== undefined && now.isFetching,
    error: now.error ?? null,
  };
}
