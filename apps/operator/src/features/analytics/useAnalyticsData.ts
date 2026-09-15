/**
 * The single data hook behind `/analytics/cafe` (operator-slice.md §5.1–5.2).
 *
 *  - `useQueries` over the jsonb `app.analytics_*` RPCs for the CURRENT and the
 *    COMPARE window (one uniform `Json` result type keeps the tuple typed).
 *    Every query is NAMED (`SqlKey`), and the hook exposes its status per
 *    name: a card declares the queries it needs and `stateFor` answers for
 *    those alone, so one failing RPC breaks one card, not the page.
 *  - PostHog goes through ONE batched edge round-trip per window inside a single
 *    react-query entry: the batch response is keyed BY QUERY NAME, so the compare
 *    window cannot share the same envelope — it is a second batch in the same
 *    queryFn, never a second react-query subscription.
 *  - Nothing is enabled until `useCafeSettings()` SETTLES (success or failure):
 *    its business-day start hour decides which calendar day "today" is, and so
 *    the whole range; on failure the migration defaults are used, never a stall.
 *  - Raw payloads -> `shape.ts` -> `derive.ts`, memoised once per data change.
 *    `raw` parses whatever has arrived (every parser yields an empty shape for
 *    `undefined`), so the cards whose queries landed render while the rest load.
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
  type DateRange,
  type RangePreset,
} from '@touch/core';
import type { Json } from '@touch/db';
import { VENUE_TZ, type Locale } from '@touch/i18n';
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
import type { CardState } from './cards/CardShell';
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

/** Deep pool: the conversion table and the momentum join both want more than the top 10. */
const TOP_LIMIT = 80;

export const ANALYTICS_KEY = 'analytics';

/** The named SQL queries of the cafe tab; the query keys below are `[ANALYTICS_KEY, <name>, from, to]`. */
export type SqlKey = 'dailySales' | 'dailySalesPrev' | 'soldItems' | 'bestSellers' | 'boughtTogether' | 'itemMargins' | 'promo' | 'menuSnapshot' | 'hourly';
export const SQL_KEYS: readonly SqlKey[] = ['dailySales', 'dailySalesPrev', 'soldItems', 'bestSellers', 'boughtTogether', 'itemMargins', 'promo', 'menuSnapshot', 'hourly'];

export type QueryStatus = 'loading' | 'ready' | 'error';

/** The named PostHog templates the dashboard needs for the selected window. */
function currentWindowQueries(range: DateRange): PosthogQuery[] {
  const names: PosthogQueryName[] = [
    'daily_engagement',
    'top_viewed_items',
    'top_carted_items',
    'abandoned_by_dwell',
    'funnel',
    'basket_to_call',
    'week_heatmap',
    'promo_engagement',
    'item_views_with_price',
    'session_stats',
    'category_popularity',
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
    heatmap: S.parseHeatmap(r.week_heatmap),
    promo: S.parsePromoEngagement(r.promo_engagement),
    itemViewsWithPrice: S.parseItemViewsWithPrice(r.item_views_with_price),
    sessionStats: S.parseSessionStats(r.session_stats),
    categoryPopularity: S.parseCategoryPopularity(r.category_popularity),
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
  /** Any SQL query still pending (the "all" aggregate the Insights and Patterns cards read). */
  salesLoading: boolean;
  /** The first SQL error, if any (the "all" aggregate). */
  salesError: unknown;
  engagement: EngagementStatus;
  engagementError: unknown;
  /** Per-query status, by name. */
  sql: Record<SqlKey, QueryStatus>;
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
  raw: RawAnalytics | null;
  derived: Derived | null;
  state: AnalyticsState;
  stored: StoredSets;
  /** The card state for a card that needs these queries (and, with `eng`, the PostHog batch). */
  stateFor: (keys: readonly SqlKey[], eng?: boolean) => CardState;
  /** The first error among these queries. */
  errorFor: (keys: readonly SqlKey[]) => unknown;
  refetchAll: () => void;
}

/** Card state from a set of query statuses plus the optional engagement status. */
export function cardStateOf(statuses: readonly QueryStatus[], engagement: EngagementStatus | null): CardState {
  if (engagement === 'loading') return 'loading';
  if (statuses.some((s) => s === 'loading')) return 'loading';
  if (engagement === 'unconfigured') return 'unconfigured';
  if (engagement === 'error') return 'error';
  if (statuses.some((s) => s === 'error')) return 'error';
  return 'ready';
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

  const { from, to } = range;
  const prevFrom = compareRange.from;
  const prevTo = compareRange.to;

  // The exact keys matter: useVenueRevenue subscribes to ['analytics','dailySales',from,to]
  // and react-query dedupes the two subscriptions into one fetch.
  const sqlSpecs: { name: SqlKey; key: (string | number)[]; fn: () => Promise<Json> }[] = [
    { name: 'dailySales', key: ['dailySales', from, to], fn: () => analyticsRpc.dailySales(from, to) },
    { name: 'dailySalesPrev', key: ['dailySales', prevFrom, prevTo], fn: () => analyticsRpc.dailySales(prevFrom, prevTo) },
    { name: 'soldItems', key: ['soldItems', from, to], fn: () => analyticsRpc.soldItems(from, to) },
    { name: 'bestSellers', key: ['bestSellers', from, to], fn: () => analyticsRpc.bestSellers(from, to, 20) },
    { name: 'boughtTogether', key: ['boughtTogether', from, to], fn: () => analyticsRpc.boughtTogether(from, to) },
    { name: 'itemMargins', key: ['itemMargins', from, to], fn: () => analyticsRpc.itemMargins(from, to) },
    { name: 'promo', key: ['promo', from, to], fn: () => analyticsRpc.promo(from, to) },
    { name: 'menuSnapshot', key: ['menuSnapshot'], fn: () => analyticsRpc.menuSnapshot() },
    { name: 'hourly', key: ['hourly', from, to], fn: () => analyticsRpc.hourly(from, to) },
  ];

  const sql = useQueries({
    queries: sqlSpecs.map((spec) => ({
      queryKey: [ANALYTICS_KEY, ...spec.key],
      queryFn: spec.fn,
      enabled: ready,
      staleTime: 30_000,
    })),
  });

  const posthog = useQuery<PosthogPayload>({
    queryKey: [ANALYTICS_KEY, 'posthog', from, to, prevFrom, prevTo, startHour],
    enabled: ready,
    staleTime: 30_000,
    retry: false,
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
    queryKey: [ANALYTICS_KEY, 'storedInsights', 'cafe', from, to, compareBasis, locale],
    queryFn: () => fetchStoredInsights(from, to, compareBasis, locale, 'cafe'),
    enabled: ready,
    staleTime: 30_000,
  });
  const storedPatterns = useQuery({
    queryKey: [ANALYTICS_KEY, 'storedPatterns', 'cafe', from, to, locale],
    queryFn: () => fetchStoredPatterns(from, to, locale, 'cafe'),
    enabled: ready,
    staleTime: 30_000,
  });
  const rejections = useQuery({
    queryKey: [ANALYTICS_KEY, 'rejections'],
    queryFn: fetchRejections,
    enabled: ready,
    staleTime: 30_000,
  });

  const statusOf = (i: number): QueryStatus => (!ready || sql[i]!.isPending ? 'loading' : sql[i]!.isError ? 'error' : 'ready');
  const sqlStatus = Object.fromEntries(sqlSpecs.map((s, i) => [s.name, statusOf(i)])) as Record<SqlKey, QueryStatus>;
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
  const anyData = ready && sql.some((q) => q.data !== undefined);

  const raw = useMemo<RawAnalytics | null>(() => {
    if (!anyData) return null;
    const parts = sql.map((q) => q.data as Json | undefined);
    return {
      preset,
      range,
      compareBasis,
      compareRange,
      todayISO,
      excludedIds,
      daily: S.parseDailySales(parts[0]),
      dailyPrev: S.parseDailySales(parts[1]),
      soldByDay: S.parseSoldItems(parts[2]),
      bestSellers: S.parseBestSellers(parts[3]),
      boughtTogether: S.parseBoughtTogether(parts[4]),
      margins: S.parseItemMargins(parts[5]),
      promoSales: S.parsePromoSales(parts[6]),
      menu: S.parseMenuSnapshot(parts[7]),
      hourly: S.parseHourly(parts[8]),
      engagementStatus: engagement,
      floor: posthogData?.floor ?? settingFloor,
      posthog: posthogData?.configured ? posthogData.now : null,
      posthogPrev: posthogData?.configured ? posthogData.prev : null,
    };
    // `sqlStamp`/`phStamp` stand in for the query data identities (stable per fetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyData, sqlStamp, phStamp, posthogData, engagement, excludedIds, settingFloor, preset, range, compareBasis, compareRange, todayISO]);

  const derived = useMemo(() => (raw ? derive(raw) : null), [raw]);

  const refetchAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [ANALYTICS_KEY] });
  }, [queryClient]);

  const reloadStored = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [ANALYTICS_KEY, 'storedInsights'] });
    void queryClient.invalidateQueries({ queryKey: [ANALYTICS_KEY, 'storedPatterns'] });
    void queryClient.invalidateQueries({ queryKey: [ANALYTICS_KEY, 'rejections'] });
  }, [queryClient]);

  const stateFor = (keys: readonly SqlKey[], eng = false): CardState =>
    cardStateOf(
      keys.map((k) => sqlStatus[k]),
      eng ? engagement : null,
    );
  const errorFor = (keys: readonly SqlKey[]): unknown => {
    for (const k of keys) {
      const q = sql[sqlSpecs.findIndex((s) => s.name === k)];
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
    excludedIds,
    raw,
    derived,
    state: {
      settingsLoading: !ready,
      settingsError: settings.isError ? settings.error : null,
      salesLoading,
      salesError,
      engagement,
      engagementError: engagement === 'error' ? posthog.error : null,
      sql: sqlStatus,
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
