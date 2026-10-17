/**
 * Venue revenue for the pulse row of BOTH tabs: cafe net revenue (the daily
 * sales rows, settle-day basis) plus padel revenue, which is court revenue
 * (live bookings, slot-day basis) plus Touch Shop sales (0346, settle-day
 * basis), venue-wide even when the Courts tab is filtered to one court.
 * Since 0346 the daily sales rows leave shop tabs out, so a shop sale counts
 * once, as padel.
 *
 * The three queries use the tabs' own keys — `['analytics','dailySales',from,to]`,
 * `['analytics','courts','analytics_courts_summary',from,to,'']` and
 * `['analytics','courts','analytics_shop',from,to]` — so react-query dedupes
 * them against the tab that is already fetching the same window: no second
 * round-trip for a figure the page already has.
 */
import { useQuery } from '@tanstack/react-query';
import type { DateRange } from '@touch/core';
import type { Json } from '@touch/db';
import { analyticsRpc } from '../../lib/analyticsApi';
import { useCafeSettings } from '../../lib/settings';
import type { CardState } from './cards/CardShell';
import { courtsRpc } from './courts/api';
import { parseCourtsSummary } from './courts/shape';
import { parseShop } from './courts/shop';
import { useShopWindow } from './courts/useShopData';
import { parseDailySales } from './shape';
import { sumBy } from './derive';

export interface VenueRevenueFigures {
  cafeIqd: number;
  courtsIqd: number;
  shopIqd: number;
  /** Court bookings plus the shop. */
  padelIqd: number;
  venueIqd: number;
}

export interface VenueRevenue {
  current: VenueRevenueFigures | null;
  previous: VenueRevenueFigures | null;
  state: CardState;
  error: unknown;
}

function useWindow(range: DateRange, enabled: boolean) {
  const cafe = useQuery({
    queryKey: ['analytics', 'dailySales', range.from, range.to],
    queryFn: () => analyticsRpc.dailySales(range.from, range.to),
    enabled,
    staleTime: 30_000,
  });
  const courts = useQuery({
    queryKey: ['analytics', 'courts', 'analytics_courts_summary', range.from, range.to, ''],
    queryFn: () => courtsRpc('analytics_courts_summary', { from: range.from, to: range.to }),
    enabled,
    staleTime: 30_000,
  });
  const shop = useShopWindow(range, enabled);
  const figures: VenueRevenueFigures | null =
    cafe.data !== undefined && courts.data !== undefined && shop.data !== undefined
      ? (() => {
          const cafeIqd = sumBy(parseDailySales(cafe.data as Json), (d) => d.revenueIqd);
          const courtsIqd = parseCourtsSummary(courts.data as Json).kpis.revenueIqd;
          const shopIqd = parseShop(shop.data as Json).kpis.netIqd;
          const padelIqd = courtsIqd + shopIqd;
          return { cafeIqd, courtsIqd, shopIqd, padelIqd, venueIqd: cafeIqd + padelIqd };
        })()
      : null;
  const pending = cafe.isPending || courts.isPending || shop.isPending;
  const failed = cafe.isError || courts.isError || shop.isError;
  const state: CardState = !enabled || pending ? 'loading' : failed ? 'error' : 'ready';
  return { figures, state, error: cafe.error ?? courts.error ?? shop.error ?? null };
}

export function useVenueRevenue(range: DateRange, compareRange: DateRange): VenueRevenue {
  const settings = useCafeSettings();
  const ready = settings.isSuccess || settings.isError;
  const now = useWindow(range, ready);
  const prev = useWindow(compareRange, ready);
  return {
    current: now.figures,
    previous: prev.figures,
    // The tile is unavailable only when the CURRENT window failed; a failed
    // baseline just mutes the delta.
    state: now.state,
    error: now.error,
  };
}
