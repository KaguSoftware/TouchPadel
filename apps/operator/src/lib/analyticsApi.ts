/**
 * Typed analytics API for the operator (operator-slice.md §6, adapted to the
 * REAL edge contracts in packages/db/supabase/functions/analytics-{posthog,insights}
 * and the app.analytics_* RPCs of migration 0034).
 *
 *  - PostHog: ONE batched round-trip per window; the function names the HogQL
 *    templates, the renderer never sees a query string.
 *  - Insights: stateless LLM layer — the operator gathers data, POSTs it, and
 *    persists the answer itself through the owner's save_* / reject_* RPCs.
 *  - SQL: jsonb-returning `app.analytics_*` (owner|manager; business day and
 *    exclusions applied server-side from cafe_settings).
 */
import type { CafeInsightsPayload, CourtsInsightsPayload, InsightWire, InsightsScope, JudgedPatternWire, PatternCandidateWire } from '@touch/core';
import type { Json } from '@touch/db';
import { appRpc } from './appRpc';
import { callEdge, type CallEdgeOptions } from './edge';
import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// analytics-posthog
// ---------------------------------------------------------------------------
export const POSTHOG_QUERY_NAMES = [
  'ping',
  'daily_engagement',
  'top_viewed_items',
  'top_carted_items',
  'abandoned_by_dwell',
  'funnel',
  'basket_to_call',
  'locale_split',
  'table_activity',
  'week_heatmap',
  'peak_hours',
  'promo_engagement',
  'item_views_with_price',
  'session_stats',
  'category_popularity',
  'locale_preferences',
] as const;
export type PosthogQueryName = (typeof POSTHOG_QUERY_NAMES)[number];

export interface PosthogQuery {
  name: PosthogQueryName;
  from: string;
  to: string;
  params?: { limit?: number };
}

export interface PosthogQueryResult {
  columns: string[];
  rows: unknown[][];
  error?: string;
}

export interface PosthogBatchRequest {
  queries: PosthogQuery[];
  business_day_start_hour?: number;
}

export interface PosthogBatchResponse {
  configured: boolean;
  floor: string | null;
  results: Partial<Record<PosthogQueryName, PosthogQueryResult>>;
}

/** One batched PostHog call (≤ 32 named queries, unique names). */
export function posthogQueries(
  queries: PosthogQuery[],
  businessDayStartHour: number,
  opts?: CallEdgeOptions,
): Promise<PosthogBatchResponse> {
  const body: PosthogBatchRequest = { queries, business_day_start_hour: businessDayStartHour };
  return callEdge<PosthogBatchRequest, PosthogBatchResponse>('analytics-posthog', body, opts);
}

// ---------------------------------------------------------------------------
// analytics-insights — the contract lives in @touch/core (insightsContract.ts,
// byte-shared with the edge function); this file re-exports it under the
// names the operator has always used, so the page and the model read one type.
// ---------------------------------------------------------------------------
export type {
  CafeInsightsPayload,
  CourtsInsightsPayload,
  EndingSegmentWire,
  InsightConfidence,
  InsightKind,
  InsightsScope,
  InsightWire,
  JudgedPatternWire,
  PatternCandidateWire,
} from '@touch/core';
export type InsightsMode = 'insights' | 'patterns' | 'revalidate' | 'replace_rejected';
/** One finding as the card shows it and the table stores it. */
export type Insight = InsightWire;
/** A candidate the judge kept, with its sentence. */
export type JudgedPattern = JudgedPatternWire;
/** The cafe tab's `data` block. */
export type InsightsData = CafeInsightsPayload;
/** The courts tab's `data` block: aggregates and display names only, never an identifier. */
export type CourtsInsightsData = CourtsInsightsPayload;
/** `patterns` mode reads only the candidates and the owner's rejections; the edge treats every other block as empty. */
export interface PatternsOnlyData {
  rejections: string[];
  patterns: PatternCandidateWire[];
}

export type JsonRow = Record<string, unknown>;

export interface InsightsRequest {
  mode: InsightsMode;
  lang: 'ar' | 'en';
  range_from: string;
  range_to: string;
  compare_basis: 'prev' | '4w' | '52w';
  /** Defaults to 'cafe' on the server, so older clients keep working. */
  scope?: InsightsScope;
  data: InsightsData | CourtsInsightsData | PatternsOnlyData;
}

export interface InsightsResponse {
  degraded: boolean;
  model: string | null;
  insights: Insight[];
  resolved?: string[];
  patterns?: JudgedPattern[];
}

/** LLM calls are never cached client-side — each is a deliberate owner action. */
export function insights(request: InsightsRequest, opts?: CallEdgeOptions): Promise<InsightsResponse> {
  return callEdge<InsightsRequest, InsightsResponse>('analytics-insights', request, { ttlMs: 0, ...opts });
}

// ---------------------------------------------------------------------------
// SQL RPCs (jsonb) — raw JSON out; features/analytics/shape.ts types the rows.
// ---------------------------------------------------------------------------
export type SalesBasis = 'settled' | 'served';

export const analyticsRpc = {
  dailySales: (from: string, to: string) =>
    appRpc<Json>('analytics_daily_sales', { p_from: from, p_to: to }),
  soldItems: (from: string, to: string, basis: SalesBasis = 'settled') =>
    appRpc<Json>('analytics_sold_items', { p_from: from, p_to: to, p_basis: basis }),
  bestSellers: (from: string, to: string, limit = 20, basis: SalesBasis = 'settled') =>
    appRpc<Json>('analytics_best_sellers', { p_from: from, p_to: to, p_limit: limit, p_basis: basis }),
  boughtTogether: (from: string, to: string, limit = 30, minSupport = 2) =>
    appRpc<Json>('analytics_bought_together', {
      p_from: from,
      p_to: to,
      p_limit: limit,
      p_min_support: minSupport,
      p_scope: 'order',
    }),
  itemMargins: (from: string, to: string, basis: SalesBasis = 'settled') =>
    appRpc<Json>('analytics_item_margins', { p_from: from, p_to: to, p_basis: basis }),
  priceBands: (from: string, to: string, basis: SalesBasis = 'settled') =>
    appRpc<Json>('analytics_price_bands', { p_from: from, p_to: to, p_basis: basis }),
  hourly: (from: string, to: string) => appRpc<Json>('analytics_hourly', { p_from: from, p_to: to }),
  promo: (from: string, to: string) => appRpc<Json>('analytics_promo', { p_from: from, p_to: to }),
  menuSnapshot: () => appRpc<Json>('analytics_menu_snapshot', {}),

  /** `courtId` (0098): the Courts tab's filter; null = the venue-wide set. Only with scope 'courts'. */
  saveInsights: (args: {
    from: string;
    to: string;
    basis: 'prev' | '4w' | '52w';
    locale: 'ar' | 'en';
    scope: InsightsScope;
    courtId?: string | null;
    insights: Insight[];
  }) =>
    appRpc<string>('save_analytics_insights', {
      p_range_from: args.from,
      p_range_to: args.to,
      p_compare_basis: args.basis,
      p_locale: args.locale,
      p_scope: args.scope,
      p_court_id: args.courtId ?? null,
      p_insights: args.insights,
    }),
  savePatterns: (args: { from: string; to: string; locale: 'ar' | 'en'; scope: InsightsScope; courtId?: string | null; patterns: JudgedPattern[] }) =>
    appRpc<string>('save_analytics_patterns', {
      p_range_from: args.from,
      p_range_to: args.to,
      p_locale: args.locale,
      p_scope: args.scope,
      p_court_id: args.courtId ?? null,
      p_patterns: args.patterns,
    }),
  rejectInsight: (text: string, reason?: string) =>
    appRpc<string>('reject_insight', { p_text: text, p_reason: reason ?? null }),
  unrejectInsight: (id: string) => appRpc<undefined>('unreject_insight', { p_id: id }),
};

// ---------------------------------------------------------------------------
// LLM tables (owner RLS reads)
// ---------------------------------------------------------------------------
export interface StoredInsightsRow {
  id: string;
  created_at: string;
  range_from: string;
  range_to: string;
  compare_basis: string;
  locale: string;
  insights: Insight[];
}

export interface StoredPatternsRow {
  id: string;
  created_at: string;
  range_from: string;
  range_to: string;
  locale: string;
  patterns: JudgedPattern[];
}

export interface RejectionRow {
  id: string;
  created_at: string;
  text: string;
  text_key: string;
  reason: string | null;
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** A stored set belongs to one court or to the venue (court_id NULL); a court's set never shows venue-wide, nor the reverse. */
export async function fetchStoredInsights(
  from: string,
  to: string,
  basis: string,
  locale: string,
  scope: InsightsScope = 'cafe',
  courtId: string | null = null,
  limit = 6,
): Promise<StoredInsightsRow[]> {
  const q = supabase
    .from('analytics_insights')
    .select('id, created_at, range_from, range_to, compare_basis, locale, insights')
    .eq('range_from', from)
    .eq('range_to', to)
    .eq('compare_basis', basis)
    .eq('locale', locale)
    .eq('scope', scope);
  const { data, error } = await (courtId ? q.eq('court_id', courtId) : q.is('court_id', null))
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ ...r, insights: asArray<Insight>(r.insights) }));
}

export async function fetchStoredPatterns(
  from: string,
  to: string,
  locale: string,
  scope: InsightsScope = 'cafe',
  courtId: string | null = null,
): Promise<StoredPatternsRow | null> {
  const q = supabase
    .from('analytics_patterns')
    .select('id, created_at, range_from, range_to, locale, patterns')
    .eq('range_from', from)
    .eq('range_to', to)
    .eq('locale', locale)
    .eq('scope', scope);
  const { data, error } = await (courtId ? q.eq('court_id', courtId) : q.is('court_id', null))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { ...data, patterns: asArray<JudgedPattern>(data.patterns) } : null;
}

export async function fetchRejections(): Promise<RejectionRow[]> {
  const { data, error } = await supabase
    .from('analytics_insight_rejections')
    .select('id, created_at, text, text_key, reason')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return data ?? [];
}
