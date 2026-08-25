/**
 * The single data hook behind `/analytics` (operator-slice.md §5.1–5.2).
 *
 *  - `useQueries` over the jsonb `app.analytics_*` RPCs for the CURRENT and the
 *    COMPARE window (one uniform `Json` result type keeps the tuple typed).
 *  - PostHog goes through ONE batched edge round-trip per window inside a single
 *    react-query entry: the batch response is keyed BY QUERY NAME, so the compare
 *    window cannot share the same envelope — it is a second batch in the same
 *    queryFn, never a second react-query subscription.
 *  - Nothing is enabled until `useCafeSettings()` SETTLES (success or failure):
 *    its business-day start hour decides which calendar day "today" is, and so
 *    the whole range; on failure the migration defaults are used, never a stall.
 *  - Raw payloads -> `shape.ts` -> `derive.ts`, memoised once per data change.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  businessTodayISO,
  isLiveRange,
  normalizeBusinessDayStart,
  resolveCompare,
  resolveRange,
  type CompareBasis,
  type DateRange,
  type RangePreset,
} from '@touch/core';
import type { Json } from '@touch/db';
import type { Locale } from '@touch/i18n';
import { EdgeError } from '../../lib/edge';
import {
  analyticsRpc,
  fetchRejections,
  fetchStoredInsights,
  fetchStoredPatterns,
  posthogQueries,
  type PosthogBatchResponse,
  type PosthogQuery,
  type PosthogQueryName,
  type RejectionRow,
  type StoredInsightsRow,
  type StoredPatternsRow,
} from '../../lib/analyticsApi';
import { useCafeSettings } from '../../lib/settings';
import type { AnalyticsSearch } from './search';
import {
  derive,
  type Derived,
  type EngagementStatus,
  type PosthogCompareWindow,
  type PosthogWindow,
  type RawAnalytics,
} from './derive';
import * as S from './shape';

export const VENUE_TZ = 'Asia/Baghdad';
export const COVERS_KEY = 'tp-analytics-covers-mult';
export const REFRESH_KEY = 'tp-analytics-refresh';
export const REFRESH_OPTIONS = [0, 1, 2, 5] as const;
export const DEFAULT_COVERS_MULTIPLIER = 2;
/** Deep pool: the conversion table and the momentum join both want more than the top 10. */
const TOP_LIMIT = 80;

const ANALYTICS_KEY = 'analytics';

function readNumber(key: string, fallback: number, accept: (n: number) => boolean): number {
  try {
    const raw = localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && accept(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

/** Number kept in localStorage; a private-mode failure simply falls back. */
export function useStoredNumber(key: string, fallback: number, accept: (n: number) => boolean) {
  const [value, setValue] = useState(() => readNumber(key, fallback, accept));
  const set = useCallback(
    (next: number) => {
      if (!accept(next)) return;
      setValue(next);
      try {
        localStorage.setItem(key, String(next));
      } catch {
        /* ignore - the choice just does not survive a reload */
      }
    },
    [key, accept],
  );
  return [value, set] as const;
}

/** `document.hidden`, so auto-refresh can stop while the tab is in the background. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => (typeof document === 'undefined' ? true : !document.hidden));
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

const acceptCovers = (n: number) => n >= 1 && n <= 10;
const acceptRefresh = (n: number) => (REFRESH_OPTIONS as readonly number[]).includes(n);

/** The named PostHog templates the dashboard needs for the selected window. */
function currentWindowQueries(range: DateRange): PosthogQuery[] {
  const names: PosthogQueryName[] = [
    'daily_engagement',
    'top_viewed_items',
    'top_carted_items',
    'abandoned_by_dwell',
    'funnel',
    'basket_to_call',
    'table_activity',
    'week_heatmap',
    'peak_hours',
    'promo_engagement',
    'item_views_with_price',
    'session_stats',
    'category_popularity',
    'locale_preferences',
  ];
  const deep: ReadonlySet<PosthogQueryName> = new Set<PosthogQueryName>([
    'top_viewed_items',
    'top_carted_items',
    'item_views_with_price',
  ]);
  return names.map((name) => ({
    name,
    from: range.from,
    to: range.to,
    ...(deep.has(name) ? { params: { limit: TOP_LIMIT } } : {}),
  }));
}

/** Only what the deltas need - the compare window never renders a chart of its own. */
function compareWindowQueries(range: DateRange): PosthogQuery[] {
  return [
    { name: 'session_stats', from: range.from, to: range.to },
    { name: 'daily_engagement', from: range.from, to: range.to },
    { name: 'basket_to_call', from: range.from, to: range.to },
    { name: 'top_viewed_items', from: range.from, to: range.to, params: { limit: TOP_LIMIT } },
  ];
}

interface PosthogPayload {
  configured: boolean;
  floor: string | null;
  now: PosthogWindow;
  prev: PosthogCompareWindow;
}

function toWindow(res: PosthogBatchResponse): PosthogWindow {
  const r = res.results;
  return {
    dailyEngagement: S.parseDailyEngagement(r.daily_engagement),
    topViewed: S.parseTopViewed(r.top_viewed_items),
    topCarted: S.parseTopCarted(r.top_carted_items),
    abandoned: S.parseAbandoned(r.abandoned_by_dwell),
    funnel: S.parseFunnel(r.funnel),
    basketToCall: S.parseBasketToCall(r.basket_to_call),
    tableActivity: S.parseTableActivity(r.table_activity),
    heatmap: S.parseHeatmap(r.week_heatmap),
    peakHours: S.parsePeakHours(r.peak_hours),
    promo: S.parsePromoEngagement(r.promo_engagement),
    itemViewsWithPrice: S.parseItemViewsWithPrice(r.item_views_with_price),
    sessionStats: S.parseSessionStats(r.session_stats),
    categoryPopularity: S.parseCategoryPopularity(r.category_popularity),
    localePreferences: S.parseLocalePreferences(r.locale_preferences),
  };
}

function emptyCompare(): PosthogCompareWindow {
  return {
    topViewed: [],
    sessionStats: { visitors: 0, visits: 0, sessions: 0, medianSeconds: 0 },
    dailyEngagement: [],
    basketToCall: { baskets: 0, called: 0, ordered: 0, converted: 0, pct: 0 },
  };
}

export interface AnalyticsState {
  /** Cafe settings still loading - nothing is queried yet. */
  settingsLoading: boolean;
  /** The café-settings read failed; defaults are in use. */
  settingsError: unknown;
  salesLoading: boolean;
  salesError: unknown;
  engagement: EngagementStatus;
  engagementError: unknown;
}

export interface StoredSets {
  insights: StoredInsightsRow[];
  patterns: StoredPatternsRow | null;
  rejections: RejectionRow[];
  loading: boolean;
  reload: () => void;
}

export interface AnalyticsData {
  preset: RangePreset;
  range: DateRange;
  compareBasis: CompareBasis;
  compareRange: DateRange;
  todayISO: string;
  live: boolean;
  startHour: number;
  excludedIds: readonly string[];
  coversMultiplier: number;
  setCoversMultiplier: (n: number) => void;
  refreshMinutes: number;
  setRefreshMinutes: (n: number) => void;
  autoRefreshActive: boolean;
  raw: RawAnalytics | null;
  derived: Derived | null;
  state: AnalyticsState;
  stored: StoredSets;
  refetchAll: () => void;
}

export function useAnalyticsData(search: AnalyticsSearch, locale: Locale): AnalyticsData {
  const queryClient = useQueryClient();
  const settings = useCafeSettings();
  // SETTLED, not "succeeded": a café-settings read that fails (RLS, a table that
  // is not deployed yet) must not leave the whole dashboard in a permanent
  // skeleton. `useCafeSettings` already hands back the migration defaults, so we
  // proceed with a 04:00 business day and no exclusions and say so in the deck.
  const ready = settings.isSuccess || settings.isError;
  const startHour = normalizeBusinessDayStart(settings.settings.analytics_business_day_start_hour);
  const excludedIds = settings.settings.analytics_excluded_item_ids;
  const settingFloor = settings.settings.analytics_engagement_floor;

  const [coversMultiplier, setCoversMultiplier] = useStoredNumber(COVERS_KEY, DEFAULT_COVERS_MULTIPLIER, acceptCovers);
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

  const autoRefreshActive = ready && live && refreshMinutes > 0 && visible;
  const refetchInterval: number | false = autoRefreshActive ? refreshMinutes * 60_000 : false;

  const { from, to } = range;
  const prevFrom = compareRange.from;
  const prevTo = compareRange.to;

  const sqlSpecs: { key: (string | number)[]; fn: () => Promise<Json> }[] = [
    { key: ['dailySales', from, to], fn: () => analyticsRpc.dailySales(from, to) },
    { key: ['dailySalesPrev', prevFrom, prevTo], fn: () => analyticsRpc.dailySales(prevFrom, prevTo) },
    { key: ['soldItems', from, to], fn: () => analyticsRpc.soldItems(from, to) },
    { key: ['bestSellers', from, to], fn: () => analyticsRpc.bestSellers(from, to, 20) },
    { key: ['boughtTogether', from, to], fn: () => analyticsRpc.boughtTogether(from, to) },
    { key: ['itemMargins', from, to], fn: () => analyticsRpc.itemMargins(from, to) },
    { key: ['promo', from, to], fn: () => analyticsRpc.promo(from, to) },
    { key: ['menuSnapshot'], fn: () => analyticsRpc.menuSnapshot() },
  ];

  const sql = useQueries({
    queries: sqlSpecs.map((spec) => ({
      queryKey: [ANALYTICS_KEY, ...spec.key],
      queryFn: spec.fn,
      enabled: ready,
      staleTime: 30_000,
      refetchInterval,
    })),
  });

  const posthog = useQuery<PosthogPayload>({
    queryKey: [ANALYTICS_KEY, 'posthog', from, to, prevFrom, prevTo, startHour],
    enabled: ready,
    staleTime: 30_000,
    retry: false,
    refetchInterval,
    queryFn: async () => {
      const now = await posthogQueries(currentWindowQueries(range), startHour);
      if (!now.configured) {
        return { configured: false, floor: now.floor, now: toWindow(now), prev: emptyCompare() };
      }
      const prevRes = await posthogQueries(compareWindowQueries(compareRange), startHour);
      const prevWin = toWindow(prevRes);
      return {
        configured: true,
        floor: now.floor,
        now: toWindow(now),
        prev: {
          topViewed: prevWin.topViewed,
          sessionStats: prevWin.sessionStats,
          dailyEngagement: prevWin.dailyEngagement,
          basketToCall: prevWin.basketToCall,
        },
      };
    },
  });

  const storedInsights = useQuery({
    queryKey: [ANALYTICS_KEY, 'storedInsights', from, to, compareBasis, locale],
    queryFn: () => fetchStoredInsights(from, to, compareBasis, locale),
    enabled: ready,
    staleTime: 30_000,
  });
  const storedPatterns = useQuery({
    queryKey: [ANALYTICS_KEY, 'storedPatterns', from, to, locale],
    queryFn: () => fetchStoredPatterns(from, to, locale),
    enabled: ready,
    staleTime: 30_000,
  });
  const rejections = useQuery({
    queryKey: [ANALYTICS_KEY, 'rejections'],
    queryFn: fetchRejections,
    enabled: ready,
    staleTime: 30_000,
  });

  const salesLoading = !ready || sql.some((q) => q.isPending);
  const salesError: unknown = sql.find((q) => q.isError)?.error ?? null;

  let engagement: EngagementStatus = 'loading';
  if (posthog.isError) {
    engagement =
      posthog.error instanceof EdgeError && posthog.error.code === 'NOT_CONFIGURED' ? 'unconfigured' : 'error';
  } else if (posthog.data) {
    engagement = posthog.data.configured ? 'ready' : 'unconfigured';
  }

  const sqlStamp = sql.map((q) => q.dataUpdatedAt).join(',');
  const phStamp = posthog.dataUpdatedAt;
  const posthogData = posthog.data;

  const raw = useMemo<RawAnalytics | null>(() => {
    if (salesLoading || salesError) return null;
    const parts = sql.map((q) => q.data as Json);
    return {
      preset,
      range,
      compareBasis,
      compareRange,
      todayISO,
      coversMultiplier,
      excludedIds,
      daily: S.parseDailySales(parts[0]),
      dailyPrev: S.parseDailySales(parts[1]),
      soldByDay: S.parseSoldItems(parts[2]),
      bestSellers: S.parseBestSellers(parts[3]),
      boughtTogether: S.parseBoughtTogether(parts[4]),
      margins: S.parseItemMargins(parts[5]),
      promoSales: S.parsePromoSales(parts[6]),
      menu: S.parseMenuSnapshot(parts[7]),
      engagementStatus: engagement,
      floor: posthogData?.floor ?? settingFloor,
      posthog: posthogData?.configured ? posthogData.now : null,
      posthogPrev: posthogData?.configured ? posthogData.prev : null,
    };
    // `sqlStamp`/`phStamp` stand in for the query data identities (stable per fetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    salesLoading,
    salesError,
    sqlStamp,
    phStamp,
    posthogData,
    engagement,
    coversMultiplier,
    excludedIds,
    settingFloor,
    preset,
    range,
    compareBasis,
    compareRange,
    todayISO,
  ]);

  const derived = useMemo(() => (raw ? derive(raw) : null), [raw]);

  const refetchAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [ANALYTICS_KEY] });
  }, [queryClient]);

  const reloadStored = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [ANALYTICS_KEY, 'storedInsights'] });
    void queryClient.invalidateQueries({ queryKey: [ANALYTICS_KEY, 'storedPatterns'] });
    void queryClient.invalidateQueries({ queryKey: [ANALYTICS_KEY, 'rejections'] });
  }, [queryClient]);

  return {
    preset,
    range,
    compareBasis,
    compareRange,
    todayISO,
    live,
    startHour,
    excludedIds,
    coversMultiplier,
    setCoversMultiplier,
    refreshMinutes,
    setRefreshMinutes,
    autoRefreshActive,
    raw,
    derived,
    state: {
      settingsLoading: !ready,
      settingsError: settings.isError ? settings.error : null,
      salesLoading,
      salesError,
      engagement,
      engagementError: engagement === 'error' ? posthog.error : null,
    },
    stored: {
      insights: storedInsights.data ?? [],
      patterns: storedPatterns.data ?? null,
      rejections: rejections.data ?? [],
      loading: storedInsights.isPending || storedPatterns.isPending || rejections.isPending,
      reload: reloadStored,
    },
    refetchAll,
  };
}
