/**
 * The data hook behind `/analytics/courts`: `useQueries` over the five
 * courts RPCs for the CURRENT window plus the four that carry a comparison
 * for the COMPARE window (guests has its own weekly series and is fetched
 * once). Mirrors useAnalyticsData: nothing runs until the cafe settings
 * settle (the business-day start hour decides which day "today" is), the
 * refresh interval is a per-device preference, and raw payloads go through
 * shape.ts then derive.ts once per data change.
 *
 * `firstLoad` and `refreshing` are separate on purpose: the skeleton shows
 * only the first time, a refetch keeps the previous render dimmed in place.
 */
import { useCallback, useMemo } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
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
import { useCafeSettings } from '../../../lib/settings';
import type { AnalyticsSearch } from '../search';
import { REFRESH_KEY, REFRESH_OPTIONS, usePageVisible, useStoredNumber } from '../useAnalyticsData';
import { courtsRpc, type CourtsRpcName } from './api';
import { deriveCourts, type DerivedCourts, type RawCourts } from './derive';
import * as S from './shape';

const KEY = ['analytics', 'courts'] as const;
const acceptRefresh = (n: number) => (REFRESH_OPTIONS as readonly number[]).includes(n);

export interface CourtsState {
  settingsLoading: boolean;
  settingsError: unknown;
  /** No data yet: show skeletons. */
  firstLoad: boolean;
  /** Data is on screen and a refetch is in flight: dim, do not collapse. */
  refreshing: boolean;
  error: unknown;
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
  refreshMinutes: number;
  setRefreshMinutes: (n: number) => void;
  autoRefreshActive: boolean;
  raw: RawCourts | null;
  derived: DerivedCourts | null;
  state: CourtsState;
  refetchAll: () => void;
}

interface Spec {
  name: CourtsRpcName;
  range: DateRange;
}

export function useCourtsData(search: AnalyticsSearch, _locale: Locale, copy: CourtPatternsCopy): CourtsData {
  const queryClient = useQueryClient();
  const settings = useCafeSettings();
  const ready = settings.isSuccess || settings.isError;
  const startHour = normalizeBusinessDayStart(settings.settings.analytics_business_day_start_hour);
  const [refreshMinutes, setRefreshMinutes] = useStoredNumber(REFRESH_KEY, 0, acceptRefresh);
  const visible = usePageVisible();

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

  const autoRefreshActive = ready && live && refreshMinutes > 0 && visible;
  const refetchInterval: number | false = autoRefreshActive ? refreshMinutes * 60_000 : false;

  const specs: Spec[] = [
    { name: 'analytics_courts_summary', range },
    { name: 'analytics_courts_demand', range },
    { name: 'analytics_courts_endings', range },
    { name: 'analytics_courts_guests', range },
    { name: 'analytics_courts_cafe', range },
    { name: 'analytics_courts_summary', range: compareRange },
    { name: 'analytics_courts_demand', range: compareRange },
    { name: 'analytics_courts_endings', range: compareRange },
    { name: 'analytics_courts_cafe', range: compareRange },
  ];

  const queries = useQueries({
    queries: specs.map((spec) => ({
      queryKey: [...KEY, spec.name, spec.range.from, spec.range.to, courtId ?? ''],
      queryFn: () => courtsRpc(spec.name, { from: spec.range.from, to: spec.range.to, courtId: courtId ?? undefined }),
      enabled: ready,
      staleTime: 30_000,
      refetchInterval,
    })),
  });

  const firstLoad = !ready || queries.some((q) => q.isPending);
  const refreshing = !firstLoad && queries.some((q) => q.isFetching);
  const error: unknown = queries.find((q) => q.isError)?.error ?? null;
  const stamp = queries.map((q) => q.dataUpdatedAt).join(',');

  const raw = useMemo<RawCourts | null>(() => {
    if (firstLoad || error) return null;
    const parts = queries.map((q) => q.data as Json);
    return {
      range,
      compareRange,
      compareBasis,
      todayISO,
      courtId,
      summary: S.parseCourtsSummary(parts[0]),
      demand: S.parseCourtsDemand(parts[1]),
      endings: S.parseCourtsEndings(parts[2]),
      guests: S.parseCourtsGuests(parts[3]),
      cafe: S.parseCourtsCafe(parts[4]),
      summaryPrev: S.parseCourtsSummary(parts[5]),
      demandPrev: S.parseCourtsDemand(parts[6]),
      endingsPrev: S.parseCourtsEndings(parts[7]),
      cafePrev: S.parseCourtsCafe(parts[8]),
    };
    // `stamp` stands in for the query data identities (stable per fetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstLoad, error, stamp, range, compareRange, compareBasis, todayISO, courtId]);

  const derived = useMemo(() => (raw ? deriveCourts(raw, copy) : null), [raw, copy]);

  const refetchAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [...KEY] });
  }, [queryClient]);

  return {
    preset,
    range,
    compareBasis,
    compareRange,
    todayISO,
    live,
    startHour,
    courtId,
    refreshMinutes,
    setRefreshMinutes,
    autoRefreshActive,
    raw,
    derived,
    state: {
      settingsLoading: !ready,
      settingsError: settings.isError ? settings.error : null,
      firstLoad,
      refreshing,
      error,
    },
    refetchAll,
  };
}
