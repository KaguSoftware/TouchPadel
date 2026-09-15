/**
 * The ONE contract between the analytics page and the AI layer: the payload the
 * operator builds from the numbers the cards render, the floors every claim must
 * clear, and the finding shape the model returns. The page and the model read the
 * same numbers because they share this file.
 *
 * ZERO IMPORTS ON PURPOSE. Like ./insightsText.ts this file is shipped as a byte
 * copy to the Deno edge function (`functions/_shared/insightsContract.ts`, parity
 * tested), so it must not reach into the rest of `@touch/core`, Node builtins, or
 * any package. Other core modules (`courtsBasis.ts`) import their floors FROM here.
 *
 * Wire names are snake_case: the payload is JSON the model reads as-is, and the
 * prompt names these keys. Money is integer IQD; a rate is a percentage or null
 * when its denominator sits under its floor.
 */

// ---------------------------------------------------------------------------
// Floors — the honesty gates the cards, the miners, the prompts and the
// templated fallback all share. Change one here and every reader moves.
// ---------------------------------------------------------------------------

/** A rate is shown as a percentage only on at least this many booked slots; below it, "n of N". */
export const MIN_RATE_DENOM = 20;
/** A heatmap cell needs this many open days before its occupancy means anything. */
export const MIN_CELL_OPEN_DAYS = 4;
/** Guest buckets (returning / new / regulars) need this many identities to be read as a mix. */
export const MIN_IDENTITIES = 15;
/** A court or slot needs this many live bookings before its cafe attach rate is compared. */
export const MIN_ATTACH_BOOKINGS = 10;
/** Players-per-booking averages need this share of bookings with a known player count. */
export const MIN_PLAYERS_KNOWN_SHARE = 0.5;
/** An ending cluster (cancellations, no-shows) needs this many endings in the segment. */
export const MIN_ENDING_N = 8;
/** A cafe item claim needs this many units sold. */
export const MIN_ITEM_UNITS = 5;
/** A cafe engagement claim needs this many item views. */
export const MIN_ITEM_VIEWS = 5;

// ---------------------------------------------------------------------------
// Findings and pattern candidates as they cross the wire
// ---------------------------------------------------------------------------

export type InsightConfidence = 'high' | 'medium' | 'low';
/** Which tab's data a request or a stored set belongs to. */
export type InsightsScope = 'cafe' | 'courts';
export type InsightKind =
  | 'profit'
  | 'conversion'
  | 'pricing'
  | 'movement'
  | 'structural'
  | 'occupancy'
  | 'reliability'
  | 'demand'
  | 'attach'
  | 'summary';
export type InsightMetrics = Record<string, number | string>;

/** One finding, whether the model wrote it or the fallback templated it. */
export interface InsightWire {
  text: string;
  kind: InsightKind;
  subjects: string[];
  metrics: InsightMetrics;
  confidence: InsightConfidence;
  /**
   * The count the finding rests on (units, bookings, open days, orders): the
   * second ranking key after confidence, and printed by the card. null when the
   * model named none.
   */
  sample: number | null;
  /** revalidate: 'ongoing' (still true) | 'new'; other modes: 'new'. */
  status?: 'ongoing' | 'new';
}

/** A deterministic pattern candidate as the judge reads it (core `PatternCandidate` is a superset). */
export interface PatternCandidateWire {
  id: string;
  kind: string;
  subjects: string[];
  metrics: InsightMetrics;
  confidence: InsightConfidence;
  sampleLabel: string;
  desc?: string;
  hint?: string;
  fallbackText: string;
}

/** A candidate the judge kept, with its sentence. */
export interface JudgedPatternWire {
  id: string;
  text: string;
  kind: string;
  subjects: string[];
  metrics: InsightMetrics;
  confidence: InsightConfidence;
  sampleLabel: string;
}

/** The slice of the data basis the confidence gate reads (`FindingBasis` in ./insightsText.ts). */
export interface FindingBasisWire {
  salesDays: number;
  weekdayCounts: { day: number; days: number }[];
}

// ---------------------------------------------------------------------------
// Cafe payload
// ---------------------------------------------------------------------------

export interface CafeKpisWire {
  /** Cafe net revenue on the settle day. */
  total_sales_iqd: number;
  tabs: number;
  orders: number;
  items_qty: number;
  cash_iqd: number;
  card_iqd: number;
  discount_iqd: number;
  refunds_iqd: number;
  /** Stock written off, at cost. */
  waste_iqd: number;
  /** Cafe revenue before refunds. */
  cafe_gross_iqd: number;
  /** Cafe revenue before refunds over orders, rounded; 0 with no orders. */
  avg_order_value_iqd: number;
  qr_orders: number;
  till_orders: number;
  qr_share_pct: number | null;
  sessions: number;
  views: number;
  median_seconds: number;
  waiter_calls: number;
  basket_to_call_pct: number;
}

export interface CafeDailyWire {
  date: string;
  revenue_iqd: number;
  tabs: number;
  orders: number;
  items_qty: number;
  discount_iqd: number;
  refunds_iqd: number;
  /** Stock written off, at cost. */
  waste_iqd: number;
  waiter_calls: number;
}

export interface CafeBestSellerWire {
  name: string;
  qty: number;
  revenue_iqd: number;
  share_pct: number;
}

export interface CafeMarginItemWire {
  name: string;
  qty: number;
  revenue_iqd: number;
  has_cost: boolean;
  cost_iqd: number | null;
  margin_iqd: number | null;
  margin_pct: number | null;
  quadrant: string | null;
  losing_money: boolean;
}

export interface CafeMarginsWire {
  cost_basis: string;
  coverage: { revenue_with_cost_pct: number; items_with_cost: number; items_total: number };
  margin_pct: number | null;
  profit_iqd: number | null;
  avg_unit_margin_iqd: number | null;
  items: CafeMarginItemWire[];
}

export interface CafePairWire {
  a: string;
  b: string;
  /** Orders containing both. */
  both: number;
  /** Of orders with `a`, the share that also had `b`. */
  confidence_pct: number;
  lift: number | null;
}

export interface CafePriceBandWire {
  min_iqd: number;
  max_iqd: number | null;
  views: number;
  sold: number;
  conv_pct: number;
  sold_without_view: number;
}

export interface CafePromoWire {
  qty: number;
  list_revenue_iqd: number;
  revenue_iqd: number;
  discount_iqd: number;
  orders: number;
}

export interface CafeItemConversionWire {
  name: string;
  views: number;
  carts: number;
  sold: number;
  conv_pct: number;
}

export interface CafeAbandonedWire {
  name: string;
  total: number;
  dwell_under_10s: number;
  dwell_10_20s: number;
  dwell_over_20s: number;
}

export interface CafeEngagementWire {
  funnel: { step: string; sessions: number }[];
  /** Top 25 by views: looked at against sold. */
  item_conversion: CafeItemConversionWire[];
  /** Looked but did not order, by dwell bucket. */
  abandoned: CafeAbandonedWire[];
}

export interface CafeCompareKpisWire {
  total_sales_iqd: number;
  tabs: number;
  orders: number;
  items_qty: number;
  cash_iqd: number;
  card_iqd: number;
  discount_iqd: number;
  refunds_iqd: number;
  /** Stock written off, at cost. */
  waste_iqd: number;
  cafe_gross_iqd: number;
  avg_order_value_iqd: number;
  waiter_calls: number;
}

export interface CafeCompareWire {
  from: string;
  to: string;
  basis: string;
  reliable: boolean;
  /** The comparison window's own figures. */
  kpis: CafeCompareKpisWire;
  /** Signed % change per pulse figure; null where either side is under a floor. */
  deltas: Record<string, number | null>;
}

export interface CafeCoverageWire {
  days: number;
  days_with_data: number;
  ratio: number;
  cost_revenue_pct: number;
}

/** The `data` block of a cafe insights request. */
export interface CafeInsightsPayload {
  kpis: CafeKpisWire;
  daily: CafeDailyWire[];
  best_sellers: CafeBestSellerWire[];
  margins: CafeMarginsWire | null;
  bought_together: CafePairWire[];
  price_bands: CafePriceBandWire[];
  promo: CafePromoWire | null;
  /** Absent when guest analytics are not configured. */
  engagement?: CafeEngagementWire;
  prior_insights?: string[];
  rejections: string[];
  patterns?: PatternCandidateWire[];
  basis: FindingBasisWire | null;
  excluded_names: string[];
  compare?: CafeCompareWire;
  coverage?: CafeCoverageWire;
}

// ---------------------------------------------------------------------------
// Courts payload — aggregates and display names only, never an identifier
// ---------------------------------------------------------------------------

export interface CourtsKpisWire {
  bookings: number;
  booked_minutes: number;
  occupancy_pct: number | null;
  revenue_iqd: number;
  rev_per_open_hour_iqd: number | null;
  price_per_booked_hour_iqd: number | null;
  cancellations: number;
  no_shows: number;
  booked_total: number;
  cancellation_rate_pct: number | null;
  no_show_rate_pct: number | null;
  mobile_bookings: number;
  desk_bookings: number;
  holds_expired: number;
  booking_days: number;
  courts_count: number;
}

export interface CourtsCompareKpisWire {
  bookings: number;
  booked_minutes: number;
  occupancy_pct: number | null;
  revenue_iqd: number;
  cancellations: number;
  no_shows: number;
  cancellation_rate_pct: number | null;
  no_show_rate_pct: number | null;
}

export interface CourtsCompareWire {
  from: string;
  to: string;
  basis: string;
  reliable: boolean;
  kpis: CourtsCompareKpisWire;
  deltas: Record<string, number | null>;
}

export interface CourtsCoverageWire {
  days: number;
  days_with_data: number;
  ratio: number;
}

export interface CourtRowWire {
  name: string;
  bookings: number;
  occupancy_pct: number | null;
  revenue_iqd: number;
  rev_per_open_hour_iqd: number | null;
  cancellations: number;
  no_shows: number;
  attach_pct: number | null;
  cafe_per_linked_iqd: number | null;
}

export interface CourtsDayWire {
  business_date: string;
  bookings: number;
  revenue_iqd: number;
  cancellations: number;
  no_shows: number;
}

/** One weekday-by-hour cell of OPEN time; `weekday` is the JS index (0 = Sunday). */
export interface HeatCellWire {
  weekday: number;
  weekday_label: string;
  hour: number;
  occupancy_pct: number | null;
  bookings: number;
  open_days: number;
}

export interface CourtsDemandWire {
  durations: { duration_min: number; bookings: number; revenue_per_hour_iqd: number | null }[];
  lead_time: { median_min: number | null; buckets: { bucket: string; bookings: number; mobile: number; desk: number }[] };
  sources: { source: string; bookings: number; revenue_iqd: number; cancellations: number; no_shows: number }[];
  hold_funnel: { holds_ended: number; converted: number; pending: number; conversion_pct: number | null };
  players: { known: number; unknown: number; avg: number | null; rows: { players: number | null; bookings: number }[] };
  series: { series_bookings: number; single_bookings: number; series_pct: number | null; series_revenue_iqd: number };
}

/** A segment where endings cluster; `rate_pct` is null under MIN_RATE_DENOM booked slots. */
export interface EndingSegmentWire {
  dim: string;
  label: string;
  n: number;
  bookings_total: number;
  rate_pct: number | null;
}

export interface CourtsEndingsWire {
  cancellations: {
    total: number;
    rate_pct: number | null;
    late_revenue_iqd: number;
    median_notice_min: number | null;
    by_notice: { bucket: string; n: number }[];
    by_actor: { actor: string; n: number }[];
    top_segments: EndingSegmentWire[];
  };
  no_shows: {
    total: number;
    rate_pct: number | null;
    top_segments: EndingSegmentWire[];
  };
}

export interface CourtsGuestsWire {
  identities: number;
  returning_pct: number | null;
  visit_buckets: { bucket: string; identities: number; bookings: number }[];
  regulars: number;
  lapsing_regulars: number;
  regulars_bookings_pct: number | null;
}

export interface CourtsCafeWire {
  attach_pct: number | null;
  cafe_per_booking_iqd: number | null;
  cafe_per_linked_iqd: number | null;
  per_court: { name: string; attach_pct: number | null; cafe_per_linked_iqd: number | null; linked_bookings: number; live_bookings: number }[];
  top_items_per_court: { court: string; items: { name: string; qty: number; revenue_iqd: number }[] }[];
  order_timing: { median_offset_min: number | null; buckets: { bucket: string; orders: number }[] };
  value_per_court_hour: { name: string; combined_per_booked_hour_iqd: number | null; combined_per_open_hour_iqd: number | null }[];
}

/** The `data` block of a courts insights request. */
export interface CourtsInsightsPayload {
  kpis: CourtsKpisWire;
  compare?: CourtsCompareWire;
  coverage?: CourtsCoverageWire;
  basis: FindingBasisWire | null;
  per_court: CourtRowWire[];
  by_day: CourtsDayWire[];
  heatmap_top: HeatCellWire[];
  heatmap_bottom: HeatCellWire[];
  demand: CourtsDemandWire;
  endings: CourtsEndingsWire;
  guests: CourtsGuestsWire | null;
  cafe: CourtsCafeWire | null;
  patterns?: PatternCandidateWire[];
  prior_insights?: string[];
  rejections: string[];
  excluded_names: string[];
}
