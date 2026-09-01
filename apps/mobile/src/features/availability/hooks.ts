import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
    return assembleTradingNight({
      date,
      settings: settings.data,
      courts: courts.data,
      availability: availability.data,
      rules: rules.data,
      prices: prices.data,
      now: NO_CLOCK,
    });
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
 * Live grid refresh: 'courts' broadcast-from-database topic (0022). Private
 * channel — realtime auth is set on sign-in (AuthProvider) and refreshed here
 * before subscribing. Payload is slot-taken/freed only; we just invalidate.
 * Re-subscribes when the session appears or changes (it used to read the
 * session once at mount, so signing in on the screen never subscribed).
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
    return () => {
      void supabase.removeChannel(channel);
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
