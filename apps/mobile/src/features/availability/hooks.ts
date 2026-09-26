import { useCallback, useEffect, useMemo, useRef } from 'react';
import { InteractionManager } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { addBreadcrumb, captureMessage } from '../../lib/telemetry';
import { useAuth } from '../auth/context';
import {
  fetchCourts,
  fetchAvailabilityWindow,
  fetchRatePrices,
  fetchRateRules,
  fetchVenueSettings,
} from './api';
import {
  assembleTradingNight,
  DEFAULT_TZ,
  type AvailabilityRow,
  type CourtRow,
  type RateRulePriceRow,
  type RateRuleRow,
  type VenueSettingsPublic,
} from './assemble';
import type { CourtSlots } from '@touch/core';

export const availabilityKeys = {
  settings: ['venue-settings'] as const,
  courts: ['courts'] as const,
  rates: ['rate-rules'] as const,
  ratePrices: ['rate-rule-prices'] as const,
  /**
   * Busy ranges for the WHOLE day strip, fetched once (api.fetchAvailabilityWindow).
   * Still under the 'availability' prefix, which is what every invalidation
   * in the app — the hold/confirm/cancel mutations, the realtime broadcast —
   * targets.
   */
  window: (from: string, to: string) => ['availability', 'window', from, to] as const,
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

/** The five query results one trading night is assembled from. */
interface GridSources {
  settings: VenueSettingsPublic | undefined;
  courts: CourtRow[] | undefined;
  rules: RateRuleRow[] | undefined;
  prices: RateRulePriceRow[] | undefined;
  availability: AvailabilityRow[] | undefined;
}

/**
 * The assembled trading night for `date`, from cache when the five inputs are
 * the same OBJECTS as last time and built (and cached) otherwise. Pure apart
 * from the cache, and safe to call for a date nothing is rendering — which is
 * exactly what `usePrefetchAdjacentDays` does with it.
 */
function buildDayGrid(date: string, src: GridSources): CourtSlots[] {
  const { settings, courts, rules, prices, availability } = src;
  if (!settings || !courts || !rules || !prices || !availability) return EMPTY_GRID;
  const inputs = [settings, courts, rules, prices, availability] as const;
  const cached = gridCache.get(date);
  if (cached && inputs.every((input, i) => cached.inputs[i] === input)) return cached.grid;
  const built = assembleTradingNight({
    date,
    settings,
    courts,
    availability,
    rules,
    prices,
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
}

/** One shared empty grid, so "not loaded yet" is a stable reference. */
const EMPTY_GRID: CourtSlots[] = [];

/**
 * Assembled, priced grid for one venue-local trading night.
 *
 * `strip` is the whole set of dates on offer: the busy ranges behind ALL of
 * them come down in one request (see api.fetchAvailabilityWindow), so moving
 * between day chips is an assembly and never a round trip. Only `date` decides
 * which night is built.
 */
export function useDayGrid(date: string, strip: readonly string[]): DayGrid {
  const settings = useVenueSettings();
  const courts = useCourts();
  const rules = useRateRules();
  const prices = useRatePrices();
  const tz = settings.data?.timezone ?? DEFAULT_TZ;

  // A strip that has not arrived yet (venue hours still loading) falls back to
  // the selected date alone, so the first paint is never blocked on it.
  const from = strip[0] ?? date;
  const to = strip[strip.length - 1] ?? date;
  const availability = useQuery({
    queryKey: availabilityKeys.window(from, to),
    queryFn: () => fetchAvailabilityWindow(supabase, from, to, tz),
    enabled: settings.isSuccess,
    staleTime: 15_000,
    refetchInterval: 60_000, // holds expire server-side; keep the grid honest
  });

  const grid = useMemo<CourtSlots[]>(
    () =>
      buildDayGrid(date, {
        settings: settings.data,
        courts: courts.data,
        rules: rules.data,
        prices: prices.data,
        availability: availability.data,
      }),
    [date, settings.data, courts.data, rules.data, prices.data, availability.data],
  );

  const queries = [settings, courts, rules, prices, availability];
  // Retry every query that can set isError. This used to refetch ONLY
  // `availability` while isError was `some()` over all five — so if courts,
  // rates or settings failed, the Retry button did nothing, forever.
  //
  // Through a ref so the callback keeps ONE identity for the life of the hook.
  // Its callers hand it to memoised children (SlotCell, the error state's Retry
  // button); a fresh function every render — which is what react-query's own
  // `refetch` is, and what this used to build on top of it — would re-render
  // them all for nothing.
  const live = useRef(queries);
  // Written after the commit, not during the render: a concurrent render that
  // React throws away must not leave this pointing at query objects nothing is
  // subscribed to.
  useEffect(() => {
    live.current = queries;
  });
  const refetch = useCallback(() => {
    void Promise.all(live.current.map((q) => q.refetch()));
  }, []);

  return {
    grid,
    settings: settings.data,
    isLoading: queries.some((q) => q.isLoading),
    isError: queries.some((q) => q.isError),
    error: queries.find((q) => q.isError)?.error ?? null,
    isRefetching: queries.some((q) => q.isRefetching),
    refetch,
  };
}

/**
 * Build every day chip's grid ahead of the tap.
 *
 * The FETCH is no longer the question — `useDayGrid` brings the whole strip's
 * busy ranges down in one request — so what is left on a day chip is the
 * assembly: two `buildSlotGrid` passes with a priced lookup per slot per court,
 * which is the expensive half and used to land on the tap. Building them here
 * puts each one in the same module cache `useDayGrid` reads, and the tap that
 * follows does no work at all.
 *
 * The WHOLE strip now, not just the neighbours. That used to be an argument
 * against — seven dates meant seven queries as well as seven assemblies — and
 * with one shared request behind them the queries are gone and only the builds
 * remain. Guests move along the strip, not just next door.
 *
 * Deferred behind `InteractionManager`, and one build per turn of the event
 * loop: `runAfterInteractions` puts them after whatever is animating, and the
 * spacing keeps seven of them from landing in one tick — this shares a JS
 * thread with the court's rally loop, and a tick is a frame.
 */
export function useWarmDayGrids(dates: readonly string[], date: string): void {
  const queryClient = useQueryClient();
  const settings = useVenueSettings();
  const ready = settings.isSuccess;
  // The selection is built by the render that needs it, so it is skipped here;
  // it also leads the list so a re-selection does not re-do the others first.
  //
  // Derived as a STRING, so the effect below re-runs when the dates to warm
  // actually change and not on every minute tick that hands back an
  // equal-but-new `dates` array.
  const pending = dates.filter((d) => d !== date).join(',');
  // The window the strip's rows were fetched under — the same key useDayGrid built.
  const from = dates[0] ?? date;
  const to = dates[dates.length - 1] ?? date;

  useEffect(() => {
    if (!ready || pending === '') return;
    let cancelled = false;
    const handle = InteractionManager.runAfterInteractions(async () => {
      for (const d of pending.split(',')) {
        if (cancelled) return;
        buildDayGrid(d, {
          settings: queryClient.getQueryData(availabilityKeys.settings),
          courts: queryClient.getQueryData(availabilityKeys.courts),
          rules: queryClient.getQueryData(availabilityKeys.rates),
          prices: queryClient.getQueryData(availabilityKeys.ratePrices),
          availability: queryClient.getQueryData(availabilityKeys.window(from, to)),
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });
    return () => {
      cancelled = true;
      handle.cancel();
    };
  }, [pending, from, to, ready, queryClient]);
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
