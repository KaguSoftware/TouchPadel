import {useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { addBreadcrumb, captureMessage } from '../../lib/telemetry';
import {
  fetchCourts,
  fetchDayAvailability,
  fetchRatePrices,
  fetchRateRules,
  fetchVenueSettings,
} from './api';
import { assembleDayGrid, DEFAULT_TZ, type VenueSettingsPublic } from './assemble';
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
  grid: CourtSlots[];
  settings: VenueSettingsPublic | undefined;
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  refetch: () => void;
}

/** Assembled, priced grid for one venue-local day. */
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

  // `now` decides which slots render as `past`. It used to be `new Date()`
  // inside this useMemo, whose deps contain no clock — so the boundary froze at
  // the last data change and a slot starting in five minutes still showed as
  // free half an hour later. Tick it on the same cadence as the grid refetch.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const grid = useMemo<CourtSlots[]>(() => {
    if (!settings.data || !courts.data || !rules.data || !prices.data || !availability.data) {
      return [];
    }
    return assembleDayGrid({
      date,
      settings: settings.data,
      courts: courts.data,
      availability: availability.data,
      rules: rules.data,
      prices: prices.data,
      now,
    });
  }, [date, settings.data, courts.data, rules.data, prices.data, availability.data, now]);

  const queries = [settings, courts, rules, prices, availability];
  return {
    grid,
    settings: settings.data,
    isLoading: queries.some((q) => q.isLoading),
    isError: queries.some((q) => q.isError),
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
 */
export function useCourtsBroadcast(): void {
  const queryClient = useQueryClient();
  const invalidate = useRef(() => {
    void queryClient.invalidateQueries({ queryKey: ['availability'] });
    void queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
  });

  useEffect(() => {
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void supabase.auth.getSession().then(({ data }) => {
      if (disposed || !data.session) return;
      supabase.realtime.setAuth(data.session.access_token);
      channel = supabase
        .channel('courts', { config: { private: true } })
        .on('broadcast', { event: 'slot_changed' }, () => invalidate.current())
        .subscribe((status) => {
          // A CHANNEL_ERROR/TIMED_OUT used to vanish silently, leaving the grid
          // quietly stale with no signal to the user or to telemetry.
          if (status === 'SUBSCRIBED') addBreadcrumb('realtime.courts.subscribed');
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')
            captureMessage('realtime.courts.' + status, 'warning');
        });
    });
    return () => {
      disposed = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, []);
}

/**
 * Proactive degraded-mode signal for the design's amber banners (courts /
 * availability / bookings). `app.is_degraded()` is granted to anon (0008), so
 * signed-out browsing gets the banner too. The refusal path in booking/errors
 * remains the authority — this only warns BEFORE the tap.
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
