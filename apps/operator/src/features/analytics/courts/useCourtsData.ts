/**
 * The data hook behind `/analytics/courts`: `useQueries` over the five
 * courts RPCs for the CURRENT window plus the four that carry a comparison
 * for the COMPARE window (guests has its own weekly series and is fetched
 * once). Mirrors useAnalyticsData: nothing runs until the cafe settings
 * settle (the business-day start hour decides which day "today" is), raw
 * payloads go through shape.ts then derive.ts once per data change, and
 * every query is NAMED so a section declares the ones it needs and
 * `stateFor` answers for those alone: one failing RPC breaks one section.
 *
 * `raw` parses whatever has arrived (the parsers yield empties for
 * `undefined`), so the sections whose queries landed render while the rest
 * load; `firstLoad` is the page-level skeleton gate (nothing at all yet).
 */
import { useCallback, useMemo } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  businessTodayISO,
  isLiveRange,
  normalizeBusinessDayStart,
  resolveCompare,
  resolveRange,
  type CompareBasis,
  type CourtPatternsCopy,
  type DateRange,
  type RangePreset,
} from '@touch/core';
import type { Json } from '@touch/db';
import { VENUE_TZ, type Locale } from '@touch/i18n';
import { fetchRejections, fetchStoredInsights, fetchStoredPatterns } from '../../../lib/analyticsApi';
import { useCafeSettings } from '../../../lib/settings';
import type { CardState } from '../cards/CardShell';
import type { AnalyticsSearch } from '../search';
import { cardStateOf, type QueryStatus, type StoredSets } from '../useAnalyticsData';
import { courtsRpc, type CourtsRpcName } from './api';
import { deriveCourts, type DerivedCourts, type RawCourts } from './derive';
import * as S from './shape';

export const COURTS_KEY = ['analytics', 'courts'] as const;

/** The nine queries by name: the five current-window RPCs and the four compare-window ones. */
export type CourtsQueryKey = CourtsRpcName | `${Exclude<CourtsRpcName, 'analytics_courts_guests'>}Prev`;

export interface CourtsState {
  settingsLoading: boolean;
  settingsError: unknown;
  /** Nothing has arrived yet: show skeletons. */
  firstLoad: boolean;
  /** Data is on screen and a refetch is in flight: dim, do not collapse. */
  refreshing: boolean;
  /** The first error among the nine queries (the "all" aggregate the Insights and Patterns cards read). */
  error: unknown;
  /** Any query still pending (the "all" aggregate). */
  loading: boolean;
  /** Per-query status, by name. */
  queries: Record<CourtsQueryKey, QueryStatus>;
}

export interface CourtsData {
  preset: RangePreset;
  range: DateRange;
  compareBasis: CompareBasis;
  compareRange: DateRange;
  todayISO: string;
  live: boolean;
  startHour: number;
  courtId: string | null;
  raw: RawCourts | null;
  derived: DerivedCourts | null;
  state: CourtsState;
  /** The stored AI sets for this window, scope 'courts'. */
  stored: StoredSets;
  /** The card state for a section that needs these queries. */
  stateFor: (keys: readonly CourtsQueryKey[]) => CardState;
  errorFor: (keys: readonly CourtsQueryKey[]) => unknown;
  refetchAll: () => void;
}

interface Spec {
  key: CourtsQueryKey;
  name: CourtsRpcName;
  range: DateRange;
}

export function useCourtsData(search: AnalyticsSearch, locale: Locale, copy: CourtPatternsCopy): CourtsData {
  const queryClient = useQueryClient();
  const settings = useCafeSettings();
  const ready = settings.isSuccess || settings.isError;
  const startHour = normalizeBusinessDayStart(settings.settings.analytics_business_day_start_hour);

  const todayISO = businessTodayISO(new Date(), startHour, VENUE_TZ);
  const resolved = useMemo(
    () => resolveRange({ range: search.range, from: search.from, to: search.to }, todayISO),
    [search.range, search.from, search.to, todayISO],
  );
  const range = resolved.range;
  const preset = resolved.preset;
  const compareBasis: CompareBasis = search.cmp ?? 'prev';
  const compareRange = useMemo(() => resolveCompare(compareBasis, range).range, [compareBasis, range]);
  const live = isLiveRange(range, todayISO);
  const courtId = search.court ?? null;

  const specs: Spec[] = [
    { key: 'analytics_courts_summary', name: 'analytics_courts_summary', range },
    { key: 'analytics_courts_demand', name: 'analytics_courts_demand', range },
    { key: 'analytics_courts_endings', name: 'analytics_courts_endings', range },
    { key: 'analytics_courts_guests', name: 'analytics_courts_guests', range },
    { key: 'analytics_courts_cafe', name: 'analytics_courts_cafe', range },
    { key: 'analytics_courts_summaryPrev', name: 'analytics_courts_summary', range: compareRange },
    { key: 'analytics_courts_demandPrev', name: 'analytics_courts_demand', range: compareRange },
    { key: 'analytics_courts_endingsPrev', name: 'analytics_courts_endings', range: compareRange },
    { key: 'analytics_courts_cafePrev', name: 'analytics_courts_cafe', range: compareRange },
  ];

  const queries = useQueries({
    queries: specs.map((spec) => ({
      // The venue-wide summary key (courtId '') is the one useVenueRevenue subscribes to.
      queryKey: [...COURTS_KEY, spec.name, spec.range.from, spec.range.to, courtId ?? ''],
      queryFn: () => courtsRpc(spec.name, { from: spec.range.from, to: spec.range.to, courtId: courtId ?? undefined }),
      enabled: ready,
      staleTime: 30_000,
    })),
  });

  const statusOf = (i: number): QueryStatus => (!ready || queries[i]!.isPending ? 'loading' : queries[i]!.isError ? 'error' : 'ready');
  const status = Object.fromEntries(specs.map((s, i) => [s.key, statusOf(i)])) as Record<CourtsQueryKey, QueryStatus>;
  const anyData = ready && queries.some((q) => q.data !== undefined);
  const firstLoad = !anyData && (!ready || queries.every((q) => q.isPending));
  const loading = !ready || queries.some((q) => q.isPending);
  const refreshing = anyData && queries.some((q) => q.isFetching && !q.isPending);
  const error: unknown = queries.find((q) => q.isError)?.error ?? null;
  const stamp = queries.map((q) => q.dataUpdatedAt).join(',');

  const raw = useMemo<RawCourts | null>(() => {
    if (!anyData) return null;
    const parts = queries.map((q) => q.data as Json | undefined);
    const has = (i: number) => parts[i] !== undefined;
    return {
      range,
      compareRange,
      compareBasis,
      todayISO,
      courtId,
      summary: S.parseCourtsSummary(parts[0]),
      demand: S.parseCourtsDemand(parts[1]),
      endings: S.parseCourtsEndings(parts[2]),
      guests: has(3) ? S.parseCourtsGuests(parts[3]) : null,
      cafe: S.parseCourtsCafe(parts[4]),
      summaryPrev: has(5) ? S.parseCourtsSummary(parts[5]) : null,
      demandPrev: has(6) ? S.parseCourtsDemand(parts[6]) : null,
      endingsPrev: has(7) ? S.parseCourtsEndings(parts[7]) : null,
      cafePrev: has(8) ? S.parseCourtsCafe(parts[8]) : null,
    };
    // `stamp` stands in for the query data identities (stable per fetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyData, stamp, range, compareRange, compareBasis, todayISO, courtId]);

  const derived = useMemo(() => (raw ? deriveCourts(raw, copy) : null), [raw, copy]);

  const { from, to } = range;
  const storedInsights = useQuery({
    queryKey: [...COURTS_KEY, 'storedInsights', from, to, compareBasis, locale],
    queryFn: () => fetchStoredInsights(from, to, compareBasis, locale, 'courts'),
    enabled: ready,
    staleTime: 30_000,
  });
  const storedPatterns = useQuery({
    queryKey: [...COURTS_KEY, 'storedPatterns', from, to, locale],
    queryFn: () => fetchStoredPatterns(from, to, locale, 'courts'),
    enabled: ready,
    staleTime: 30_000,
  });
  const rejections = useQuery({
    queryKey: ['analytics', 'rejections'],
    queryFn: fetchRejections,
    enabled: ready,
    staleTime: 30_000,
  });

  const refetchAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [...COURTS_KEY] });
  }, [queryClient]);

  const reloadStored = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [...COURTS_KEY, 'storedInsights'] });
    void queryClient.invalidateQueries({ queryKey: [...COURTS_KEY, 'storedPatterns'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics', 'rejections'] });
  }, [queryClient]);

  const stateFor = (keys: readonly CourtsQueryKey[]): CardState => cardStateOf(keys.map((k) => status[k]), null);
  const errorFor = (keys: readonly CourtsQueryKey[]): unknown => {
    for (const k of keys) {
      const q = queries[specs.findIndex((s) => s.key === k)];
      if (q?.isError) return q.error;
    }
    return null;
  };

  return {
    preset,
    range,
    compareBasis,
    compareRange,
    todayISO,
    live,
    startHour,
    courtId,
    raw,
    derived,
    state: {
      settingsLoading: !ready,
      settingsError: settings.isError ? settings.error : null,
      firstLoad,
      refreshing,
      error,
      loading,
      queries: status,
    },
    stored: {
      insights: storedInsights.data ?? [],
      patterns: storedPatterns.data ?? null,
      rejections: rejections.data ?? [],
      loading: storedInsights.isPending || storedPatterns.isPending || rejections.isPending,
      reload: reloadStored,
    },
    stateFor,
    errorFor,
    refetchAll,
  };
}
