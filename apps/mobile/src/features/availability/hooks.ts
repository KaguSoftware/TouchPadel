import { useEffect, useMemo, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { addBreadcrumb, captureMessage } from '../../lib/telemetry';
import { useAuth } from '../auth/context';
import {
  fetchCourts,
  fetchDayAvailability,
  fetchRatePrices,
  fetchRateRules,
  fetchVenueSettings,
} from './api';
import { assembleTradingNight, DEFAULT_TZ, type VenueSettingsPublic } from './assemble';
import type { CourtSlots } from '@touch/core';

export const availabilityKeys = {
  settings: ['venue-settings'] as const,
  courts: ['courts'] as const,
  rates: ['rate-rules'] as const,
  ratePrices: ['rate-rule-prices'] as const,
  day: (date: string) => ['availability', date] as const,
};

export function useVenueSettings() {
  return useQuery({
    queryKey: availabilityKeys.settings,
    queryFn: () => fetchVenueSettings(supabase),
    staleTime: 5 * 60_000,
  });
}

export function useCourts() {
  return useQuery({
    queryKey: availabilityKeys.courts,
    queryFn: () => fetchCourts(supabase),
    staleTime: 5 * 60_000,
  });
}

export function useRateRules() {
  return useQuery({
    queryKey: availabilityKeys.rates,
    queryFn: () => fetchRateRules(supabase),
    staleTime: 5 * 60_000,
  });
}

export function useRatePrices() {
  return useQuery({
    queryKey: availabilityKeys.ratePrices,
    queryFn: () => fetchRatePrices(supabase),
    staleTime: 5 * 60_000,
  });
}

export interface DayGrid {
  /**
   * Per-court slots for the TRADING NIGHT the date names — its own hours plus
   * the post-midnight tail stored on the next calendar date (09:00 → 02:00 on
   * Touch; assembleTradingNight) — TIME-AGNOSTIC: nothing here is marked `past`.
   * `mergeAcrossCourts(grid, duration, horizon, now)` applies the clock, so the
   * expensive assembly (hundreds of ICU calls) runs only when data changes and
   * the minute tick is an O(n) pass.
   */
  grid: CourtSlots[];
  settings: VenueSettingsPublic | undefined;
  isLoading: boolean;
  isError: boolean;
  /** First failing query's error — screens map it, never assume "network". */
  error: unknown;
  isRefetching: boolean;
  refetch: () => void;
}

/** Epoch: with this as `now` no slot is past and no hold is expired at build time. */
const NO_CLOCK = new Date(0);

/**
 * Assembled trading nights, keyed by date and validated by REFERENCE against
 * the five queries that build them.
 *
 * `assembleTradingNight` is pure but not cheap: two `buildSlotGrid` passes with
 * a rate lookup per slot per court, and every one of those resolves the venue's
 * wall clock through Intl — a few hundred `formatToParts` calls per date. The
 * `useMemo` below only ever holds the LAST date, so moving between day chips
 * rebuilt from scratch every time, synchronously, on the tap — including for
 * dates whose rows were already sitting in the react-query cache. On the Book
 * tab that lands on the same JS thread the 3D court draws its rally from, and
 * the court visibly hitches (owner, 2026-09-08: picking between dates
 * "glitches and is not running smoothly").
 *
 * react-query hands back a stable reference until data actually changes, so
 * identity across all five inputs is a sound key: a refetch that returns new
 * rows misses and rebuilds, one that changes nothing hits. Module-level, so the
 * Book tab's sheet and the standalone Availability screen share one copy, and
 * capped at a little over one entry per day chip on the strip.
 */
const GRID_CACHE_MAX = 8;
interface GridCacheEntry {
  inputs: readonly unknown[];
  grid: CourtSlots[];
}
const gridCache = new Map<string, GridCacheEntry>();

/** Assembled, priced grid for one venue-local trading night. */
export function useDayGrid(date: string): DayGrid {
  const settings = useVenueSettings();
  const courts = useCourts();
  const rules = useRateRules();
  const prices = useRatePrices();
  const tz = settings.data?.timezone ?? DEFAULT_TZ;

  const availability = useQuery({
    queryKey: availabilityKeys.day(date),
    queryFn: () => fetchDayAvailability(supabase, date, tz),
    enabled: settings.isSuccess,
    staleTime: 15_000,
    refetchInterval: 60_000, // holds expire server-side; keep the grid honest
  });

  const grid = useMemo<CourtSlots[]>(() => {
    if (!settings.data || !courts.data || !rules.data || !prices.data || !availability.data) {
      return [];
    }
    const inputs = [
      settings.data,
      courts.data,
      rules.data,
      prices.data,
      availability.data,
    ] as const;
    const cached = gridCache.get(date);
    if (cached && inputs.every((input, i) => cached.inputs[i] === input)) return cached.grid;
    const built = assembleTradingNight({
      date,
      settings: settings.data,
      courts: courts.data,
      availability: availability.data,
      rules: rules.data,
      prices: prices.data,
      now: NO_CLOCK,
    });
    // Delete before set so insertion order stays a true least-recently-BUILT
    // order and the eviction below takes the right entry.
    gridCache.delete(date);
    gridCache.set(date, { inputs, grid: built });
    while (gridCache.size > GRID_CACHE_MAX) {
      const oldest = gridCache.keys().next().value;
      if (oldest === undefined) break;
      gridCache.delete(oldest);
    }
    return built;
  }, [date, settings.data, courts.data, rules.data, prices.data, availability.data]);

  const queries = [settings, courts, rules, prices, availability];
  return {
    grid,
    settings: settings.data,
    isLoading: queries.some((q) => q.isLoading),
    isError: queries.some((q) => q.isError),
    error: queries.find((q) => q.isError)?.error ?? null,
    isRefetching: queries.some((q) => q.isRefetching),
    // Retry every query that can set isError. This used to refetch ONLY
    // `availability` while isError was `some()` over all five — so if courts,
    // rates or settings failed, the Retry button did nothing, forever.
    refetch: () => {
      void Promise.all(queries.map((q) => q.refetch()));
    },
  };
}

/**
 * Warm the day chips either side of the selection, so tapping one is a cache
 * read instead of a round trip.
 *
 * Only ever `prefetchQuery` on the SAME key `useDayGrid` reads, so a tap that
 * lands mid-flight joins the in-flight request rather than starting a second
 * one, and a warm date never refetches (staleTime is respected).
 *
 * Deferred behind `InteractionManager`: on the Book tab this shares its JS
 * thread with the court's GL loop, and a prefetch fired during the sheet's
 * opening spring costs exactly the frames the animation needs. `runAfterInteractions`
 * puts the fetch after the transition instead of inside it.
 *
 * Neighbours only (± PREFETCH_RADIUS), not the whole strip: seven dates at once
 * is seven queries and seven assemblies for chips most guests never tap, and the
 * strip re-derives every minute — the tick would re-arm the whole fan-out.
 */
const PREFETCH_RADIUS = 1;

export function usePrefetchAdjacentDays(dates: readonly string[], date: string): void {
  const queryClient = useQueryClient();
  const settings = useVenueSettings();
  const tz = settings.data?.timezone ?? DEFAULT_TZ;
  const ready = settings.isSuccess;
  const index = dates.indexOf(date);
  // Derive the neighbours as a STRING, so the effect below re-runs when the
  // dates to warm actually change and not on every minute tick that hands back
  // an equal-but-new `dates` array.
  const neighbours =
    index === -1
      ? ''
      : dates
          .slice(Math.max(0, index - PREFETCH_RADIUS), index + PREFETCH_RADIUS + 1)
          .filter((d) => d !== date)
          .join(',');

  useEffect(() => {
    if (!ready || neighbours === '') return;
    let cancelled = false;
    const handle = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      for (const d of neighbours.split(',')) {
        void queryClient.prefetchQuery({
          queryKey: availabilityKeys.day(d),
          queryFn: () => fetchDayAvailability(supabase, d, tz),
          staleTime: 15_000,
        });
      }
    });
    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, [neighbours, ready, tz, queryClient]);
}

/** The one live 'courts' channel, shared by every mounted consumer (see useCourtsBroadcast). */
interface SharedChannel {
  token: string;
  channel: RealtimeChannel;
  consumers: number;
  removed: boolean;
}
let sharedCourts: SharedChannel | null = null;

function dropSharedCourts(s: SharedChannel): void {
  if (s.removed) return;
  s.removed = true;
  void supabase.removeChannel(s.channel);
  if (sharedCourts === s) sharedCourts = null;
}

/**
 * Live grid refresh: 'courts' broadcast-from-database topic (0022). Private
 * channel — realtime auth is set on sign-in (AuthProvider) and refreshed here
 * before subscribing. Payload is slot-taken/freed only; we just invalidate.
 * Re-subscribes when the session appears or changes (it used to read the
 * session once at mount, so signing in on the screen never subscribed).
 *
 * REFERENCE-COUNTED, one channel per token: supabase-js hands back the SAME
 * channel object for a topic that already exists and `removeChannel` leaves
 * it for everyone, so two mounted consumers (the Book tab's booking sheet
 * under a pushed Availability or Review screen, the Bookings tab under either)
 * used to share one subscription that whichever unmounted first silently
 * killed for the survivor — which then only saw the 60 s poll.
 */
export function useCourtsBroadcast(): void {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const token = session?.access_token ?? null;
  const invalidate = useRef(() => {
    void queryClient.invalidateQueries({ queryKey: ['availability'] });
    void queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
    void queryClient.invalidateQueries({ queryKey: ['reservation'] });
  });

  useEffect(() => {
    if (!token) return;
    // A rotated token retires the old channel NOW, so `channel('courts')`
    // below creates a fresh one instead of returning the stale instance.
    if (sharedCourts && sharedCourts.token !== token) dropSharedCourts(sharedCourts);
    if (!sharedCourts) {
      supabase.realtime.setAuth(token);
      const channel = supabase
        .channel('courts', { config: { private: true } })
        .on('broadcast', { event: 'slot_changed' }, () => invalidate.current())
        .subscribe((status) => {
          // A CHANNEL_ERROR/TIMED_OUT used to vanish silently, leaving the grid
          // quietly stale with no signal to the user or to telemetry.
          if (status === 'SUBSCRIBED') addBreadcrumb('realtime.courts.subscribed');
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
            captureMessage('realtime.courts.' + status, 'warning');
        });
      sharedCourts = { token, channel, consumers: 0, removed: false };
    }
    const mine = sharedCourts;
    mine.consumers += 1;
    return () => {
      mine.consumers -= 1;
      if (mine.consumers === 0) dropSharedCourts(mine);
    };
  }, [token]);
}

/**
 * Proactive degraded-mode signal for the design's amber banners (courts /
 * availability / bookings). `app.is_degraded()` is granted to anon (0008), so
 * signed-out browsing gets the banner too. The refusal path in booking/errors
 * remains the authority — this only warns BEFORE the tap.
 *
 * NOTE: it reports the VENUE's till connectivity, never this phone's. A stale
 * dev till heartbeat on the hosted project kept this true for every guest
 * until migration 0057 — the banner was faithfully reporting it.
 */
export function useIsDegraded(): boolean {
  const query = useQuery({
    queryKey: ['is-degraded'],
    queryFn: async () => {
      const { data, error } = await supabase.schema('app').rpc('is_degraded');
      if (error) throw error;
      return data === true;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    // A failed probe must never take the booking UI down with it.
    retry: 1,
  });
  return query.data === true;
}
