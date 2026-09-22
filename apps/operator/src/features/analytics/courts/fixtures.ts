/**
 * Shared fixtures for the courts analytics tests: the snake_case JSON the five
 * `app.analytics_courts_*` RPCs return (migrations 0093 + 0097), small but
 * shaped like production. Two courts, a seven-day window and its compare
 * window, a closed heat cell and a 90-minute booking split across two cells
 * (heat-cell open minutes are VENUE-WIDE: both courts, 120 each),
 * lead / notice / visit / timing buckets with some keys missing (the parsers
 * fill the fixed order), and a cafe
 * payload with one variant where no tab was ever linked to a booking.
 *
 * Test-only: nothing here is imported by the app.
 */
import type { CourtsRpcName } from './api';

export const COURT_A = '11111111-1111-4111-8111-111111111111';
export const COURT_B = '22222222-2222-4222-8222-222222222222';
export const ITEM_LATTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const ITEM_WATER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

export const RANGE = { from: '2026-09-01', to: '2026-09-07' } as const;
export const COMPARE_RANGE = { from: '2026-08-25', to: '2026-08-31' } as const;

type Json = Record<string, unknown>;

function days(from: number, count: number, bookingsPerDay: number): Json[] {
  return Array.from({ length: count }, (_, i) => {
    const bookings = i < bookingsPerDay ? 6 + i : 0;
    return {
      business_date: `2026-${from === 9 ? '09' : '08'}-${String((from === 9 ? 1 : 25) + i).padStart(2, '0')}`,
      closed: false,
      bookings,
      booked_minutes: bookings * 75,
      revenue_iqd: bookings * 25000,
      cancellations: i === 0 ? 2 : 1,
      no_shows: i === 3 ? 1 : 0,
    };
  });
}

/** analytics_courts_summary for the current window. */
export const summaryJson: Json = {
  range: { from: RANGE.from, to: RANGE.to },
  courts_count: 2,
  open_minutes: 11760,
  kpis: {
    bookings: 48,
    booked_minutes: 3600,
    occupancy_pct: 30.6,
    revenue_iqd: 1200000,
    rev_per_open_hour_iqd: 6122,
    price_per_booked_hour_iqd: 20000,
    cancellations: 12,
    no_shows: 4,
    booked_total: 64,
    cancellation_rate_pct: 18.8,
    no_show_rate_pct: 6.3,
    mobile_bookings: 30,
    desk_bookings: 18,
    holds_expired: 5,
    booking_days: 7,
  },
  per_court: [
    {
      court_id: COURT_A,
      name_en: 'Court A',
      name_ar: 'ملعب أ',
      is_active: true,
      bookings: 18,
      booked_minutes: 1350,
      open_minutes: 5880,
      occupancy_pct: 23,
      revenue_iqd: 450000,
      rev_per_open_hour_iqd: 4592,
      cancellations: 9,
      no_shows: 2,
      booked_total: 29,
      cancellation_rate_pct: 31,
      no_show_rate_pct: 6.9,
      mobile_bookings: 12,
      desk_bookings: 6,
      avg_duration_min: 75,
    },
    {
      // `is_active` deliberately absent: the parser defaults it to true.
      court_id: COURT_B,
      name_en: 'Court B',
      name_ar: 'ملعب ب',
      bookings: 30,
      booked_minutes: 2250,
      open_minutes: 5880,
      occupancy_pct: 38.3,
      revenue_iqd: 750000,
      rev_per_open_hour_iqd: 7653,
      cancellations: 3,
      no_shows: 2,
      booked_total: 35,
      cancellation_rate_pct: 8.6,
      no_show_rate_pct: 5.7,
      mobile_bookings: 18,
      desk_bookings: 12,
      avg_duration_min: 75,
    },
  ],
  by_day: days(9, 7, 7),
  heatmap: [
    // A 90-minute booking from 18:30: 30 minutes in the 18:00 cell, 60 in the 19:00 cell.
    { dow: 1, hour: 18, open_minutes: 240, open_days: 1, booked_minutes: 30, bookings: 1, revenue_iqd: 10000, cancellations: 0, no_shows: 0, holds_expired: 0 },
    { dow: 1, hour: 19, open_minutes: 240, open_days: 1, booked_minutes: 60, bookings: 1, revenue_iqd: 20000, cancellations: 0, no_shows: 0, holds_expired: 0 },
    // Closed cell: no open minutes, so no occupancy.
    { dow: 2, hour: 3, open_minutes: 0, open_days: 0, booked_minutes: 0, bookings: 0, revenue_iqd: 0, cancellations: 0, no_shows: 0, holds_expired: 0 },
    { dow: 5, hour: 18, open_minutes: 240, open_days: 1, booked_minutes: 60, bookings: 1, revenue_iqd: 20000, cancellations: 1, no_shows: 0, holds_expired: 1 },
    { dow: 5, hour: 20, open_minutes: 240, open_days: 1, booked_minutes: 120, bookings: 2, revenue_iqd: 40000, cancellations: 0, no_shows: 1, holds_expired: 2 },
  ],
};

/** analytics_courts_summary for the compare window: every day has bookings, so it is a reliable baseline. */
export const summaryPrevJson: Json = {
  ...summaryJson,
  range: { from: COMPARE_RANGE.from, to: COMPARE_RANGE.to },
  kpis: {
    bookings: 40,
    booked_minutes: 3000,
    occupancy_pct: 25.5,
    revenue_iqd: 1000000,
    rev_per_open_hour_iqd: 5102,
    price_per_booked_hour_iqd: 20000,
    cancellations: 10,
    no_shows: 0,
    booked_total: 50,
    cancellation_rate_pct: 20,
    no_show_rate_pct: 5,
    mobile_bookings: 25,
    desk_bookings: 15,
    holds_expired: 2,
    booking_days: 7,
  },
  by_day: days(8, 7, 7),
};

/** The compare window with bookings on only three of its seven days: below the coverage gate. */
export const summaryPrevSparseJson: Json = { ...summaryPrevJson, by_day: days(8, 7, 3) };

/** analytics_courts_demand. */
export const demandJson: Json = {
  // Out of order on purpose: the parser sorts by duration.
  durations: [
    { duration_min: 90, bookings: 20, booked_minutes: 1800, revenue_iqd: 600000, revenue_per_hour_iqd: 20000 },
    { duration_min: 60, bookings: 28, booked_minutes: 1680, revenue_iqd: 600000, revenue_per_hour_iqd: 21429 },
  ],
  lead_time: {
    median_min: 360,
    // 2_6h, 3_7d and 7d_plus are missing: the parser fills them with zeros in the fixed order.
    buckets: [
      { bucket: '6_24h', bookings: 20, mobile: 14, desk: 6 },
      { bucket: 'lt2h', bookings: 5, mobile: 2, desk: 3 },
      { bucket: '1_3d', bookings: 15, mobile: 10, desk: 5 },
    ],
  },
  created_hour: [{ hour: 20, bookings: 10 }],
  created_dow: [{ dow: 4, bookings: 12 }],
  sources: [
    { source: 'mobile', bookings: 30, revenue_iqd: 750000, cancellations: 8, no_shows: 3, avg_duration_min: 72 },
    { source: 'desk', bookings: 18, revenue_iqd: 450000, cancellations: 4, no_shows: 1, avg_duration_min: 80 },
    // A duplicate row: the parser keeps the first mobile row only.
    { source: 'mobile', bookings: 999, revenue_iqd: 1, cancellations: 0, no_shows: 0, avg_duration_min: null },
  ],
  hold_funnel: { holds_ended: 5, converted: 25, pending: 1, conversion_pct: 83.3 },
  series: { series_bookings: 8, single_bookings: 40, series_pct: 16.7, series_revenue_iqd: 200000 },
};

/** analytics_courts_endings. Court A cancels 9 of 29 against 12 of 64 overall: an ending cluster. */
export const endingsJson: Json = {
  // A 4-hour policy: the buckets carry their edges and the policy line.
  policy_window_min: 240,
  cancellations: {
    total: 12,
    revenue_iqd: 300000,
    late_revenue_iqd: 50000,
    median_notice_min: 180,
    by_notice: [
      { bucket: 'after_start', lo_min: null, hi_min: 0, n: 1, policy_edge: false },
      { bucket: '0_120', lo_min: 0, hi_min: 120, n: 5, policy_edge: false },
      { bucket: '120_240', lo_min: 120, hi_min: 240, n: 0, policy_edge: false },
      { bucket: '240_360', lo_min: 240, hi_min: 360, n: 0, policy_edge: true },
      { bucket: '360_1440', lo_min: 360, hi_min: 1440, n: 0, policy_edge: false },
      { bucket: '1440_4320', lo_min: 1440, hi_min: 4320, n: 3, policy_edge: false },
      { bucket: '4320_plus', lo_min: 4320, hi_min: null, n: 3, policy_edge: false },
    ],
    cancelled_in_period: { n: 10, revenue_iqd: 250000 },
    // Six late cancellations: four slots were booked again, two stayed empty.
    resold: { cancelled: 6, resold_n: 4, recovered_iqd: 80000, empty_n: 2, lost_iqd: 40000 },
    // 'system' is not a known actor and comes back as 'unknown'.
    by_actor: [
      { actor: 'guest', n: 8 },
      { actor: 'staff', n: 3 },
      { actor: 'system', n: 1 },
    ],
    by_hour: [{ key: '20', n: 6, bookings_total: 24 }],
    by_dow: [{ key: '5', n: 5, bookings_total: 18 }],
    // by_court rows carry the court instead of a key: the parser keys them by court_id.
    by_court: [
      { court_id: COURT_A, name_en: 'Court A', name_ar: 'ملعب أ', n: 9, bookings_total: 29 },
      { court_id: COURT_B, name_en: 'Court B', name_ar: 'ملعب ب', n: 3, bookings_total: 35 },
    ],
    by_source: [
      { key: 'mobile', n: 8, bookings_total: 41 },
      { key: 'desk', n: 4, bookings_total: 23 },
    ],
    by_duration: [{ key: '60', n: 7, bookings_total: 35 }],
    by_lead_time: [{ key: 'lt2h', n: 2, bookings_total: 7 }],
    by_series: [{ key: 'single', n: 10, bookings_total: 52 }],
    by_type: [
      { key: 'new', n: 7, bookings_total: 30 },
      { key: 'returning', n: 3, bookings_total: 24 },
      { key: 'unidentified', n: 2, bookings_total: 10 },
    ],
  },
  no_shows: {
    total: 4,
    revenue_iqd: 100000,
    by_hour: [{ key: '21', n: 2, bookings_total: 15 }],
    by_dow: [{ key: '6', n: 2, bookings_total: 12 }],
    by_court: [
      { court_id: COURT_A, name_en: 'Court A', name_ar: 'ملعب أ', n: 2, bookings_total: 29 },
      { court_id: COURT_B, name_en: 'Court B', name_ar: 'ملعب ب', n: 2, bookings_total: 35 },
    ],
    by_source: [
      { key: 'mobile', n: 3, bookings_total: 41 },
      { key: 'desk', n: 1, bookings_total: 23 },
    ],
    by_duration: [{ key: '90', n: 3, bookings_total: 29 }],
    by_lead_time: [{ key: '7d_plus', n: 2, bookings_total: 9 }],
    by_series: [{ key: 'series', n: 1, bookings_total: 12 }],
    by_type: [{ key: 'new', n: 3, bookings_total: 30 }],
  },
};

/** analytics_courts_guests: anonymous counts only. */
export const guestsJson: Json = {
  lookback_days: 180,
  regular_window_days: 90,
  lapse_days: 28,
  identified_bookings: 40,
  unidentified_bookings: 8,
  identities: 22,
  returning_bookings: 26,
  new_bookings: 14,
  returning_pct: 65,
  // 7_plus missing and the rest out of order.
  visit_buckets: [
    { bucket: '1', identities: 10, bookings: 10 },
    { bucket: '4_6', identities: 4, bookings: 18 },
    { bucket: '2_3', identities: 8, bookings: 12 },
  ],
  regulars: 6,
  lapsing_regulars: 1,
  regulars_bookings_pct: 45,
  regulars_fixed_slot_pct: null,
  by_week: [
    { week_start: '2026-08-31', new_identities: 5, returning_identities: 12, bookings: 30 },
    { week_start: '2026-09-07', new_identities: 2, returning_identities: 6, bookings: 18 },
  ],
};

const courtAAttach = {
  court_id: COURT_A,
  name_en: 'Court A',
  name_ar: 'ملعب أ',
  live_bookings: 18,
  linked_bookings: 9,
  attach_pct: 50,
  settled_linked: 9,
  cafe_iqd: 270000,
  cafe_gross_iqd: 290000,
  refunds_iqd: 20000,
  cafe_per_linked_iqd: 30000,
  cafe_per_booking_iqd: 15000,
  court_iqd: 450000,
  booked_minutes: 1350,
  open_minutes: 5880,
  combined_per_booked_hour_iqd: 32000,
  combined_per_open_hour_iqd: 7347,
};
const courtBAttach = {
  court_id: COURT_B,
  name_en: 'Court B',
  name_ar: 'ملعب ب',
  live_bookings: 30,
  linked_bookings: 6,
  attach_pct: 20,
  settled_linked: 5,
  cafe_iqd: 150000,
  cafe_gross_iqd: 160000,
  refunds_iqd: 10000,
  cafe_per_linked_iqd: 25000,
  cafe_per_booking_iqd: 5000,
  court_iqd: 750000,
  booked_minutes: 2250,
  open_minutes: 5880,
  combined_per_booked_hour_iqd: 24000,
  combined_per_open_hour_iqd: 9184,
};

/** analytics_courts_cafe. */
export const cafeJson: Json = {
  attach: {
    live_bookings: 48,
    linked_bookings: 15,
    attach_pct: 31.3,
    settled_linked: 14,
    cafe_iqd: 420000,
    cafe_gross_iqd: 450000,
    refunds_iqd: 30000,
    cafe_per_linked_iqd: 28000,
    cafe_per_booking_iqd: 8750,
    court_iqd: 1200000,
    booked_minutes: 3600,
    open_minutes: 11760,
    combined_per_booked_hour_iqd: 27000,
    combined_per_open_hour_iqd: 8265,
  },
  per_court: [courtAAttach, courtBAttach],
  top_items: [
    { court_id: COURT_A, item_id: ITEM_LATTE, name_en: 'Latte', name_ar: 'لاتيه', qty: 14, revenue_iqd: 70000, linked_orders_with_item: 6 },
    { court_id: COURT_B, item_id: ITEM_WATER, name_en: 'Water', name_ar: 'ماء', qty: 9, revenue_iqd: 9000, linked_orders_with_item: 4 },
  ],
  items: [
    { item_id: ITEM_LATTE, name_en: 'Latte', name_ar: 'لاتيه', linked_orders_with_item: 6, all_orders_with_item: 20 },
    { item_id: ITEM_WATER, name_en: 'Water', name_ar: 'ماء', linked_orders_with_item: 4, all_orders_with_item: 60 },
  ],
  linked_orders_total: 15,
  all_orders_total: 100,
  order_timing: {
    median_offset_min: 12,
    // before_30plus, second_half and after_30plus missing: zero-filled in the fixed order.
    buckets: [
      { bucket: 'first_half', orders: 8, revenue_iqd: 200000 },
      { bucket: 'before_0_30', orders: 3, revenue_iqd: 60000 },
      { bucket: 'after_0_30', orders: 2, revenue_iqd: 40000 },
    ],
  },
  attach_cells: [
    { dow: 5, hour: 20, live_bookings: 2, linked_bookings: 1 },
    { dow: 1, hour: 18, live_bookings: 1, linked_bookings: 0 },
  ],
  by_duration: [
    { duration_min: 90, bookings: 20, linked: 8, cafe_iqd: 240000 },
    { duration_min: 60, bookings: 28, linked: 7, cafe_iqd: 180000 },
  ],
};

/** The compare window's cafe payload: the same shape with a lower attach rate. */
export const cafePrevJson: Json = {
  ...cafeJson,
  attach: { ...(cafeJson.attach as Json), live_bookings: 40, linked_bookings: 10, attach_pct: 25 },
};

/** A venue whose till has never linked a tab to a booking. */
export const cafeNoLinksJson: Json = {
  ...cafeJson,
  attach: {
    ...(cafeJson.attach as Json),
    linked_bookings: 0,
    attach_pct: 0,
    settled_linked: 0,
    cafe_iqd: 0,
    cafe_gross_iqd: 0,
    refunds_iqd: 0,
    cafe_per_linked_iqd: null,
    cafe_per_booking_iqd: 0,
  },
  per_court: [courtAAttach, courtBAttach].map((c) => ({ ...c, linked_bookings: 0, attach_pct: 0, settled_linked: 0, cafe_iqd: 0, cafe_gross_iqd: 0, refunds_iqd: 0, cafe_per_linked_iqd: null, cafe_per_booking_iqd: 0 })),
  top_items: [],
  items: [],
  linked_orders_total: 0,
  order_timing: { median_offset_min: null, buckets: [] },
  attach_cells: [
    { dow: 5, hour: 20, live_bookings: 2, linked_bookings: 0 },
    { dow: 1, hour: 18, live_bookings: 1, linked_bookings: 0 },
  ],
  by_duration: [],
};

/** The payload each RPC returns for a window, as the tab's data hook would receive it. */
export function fixtureFor(name: CourtsRpcName, window: 'current' | 'compare' = 'current', cafe: Json = cafeJson): Json {
  switch (name) {
    case 'analytics_courts_summary':
      return window === 'current' ? summaryJson : summaryPrevJson;
    case 'analytics_courts_demand':
      return demandJson;
    case 'analytics_courts_endings':
      return endingsJson;
    case 'analytics_courts_guests':
      return guestsJson;
    case 'analytics_courts_cafe':
      return window === 'current' ? cafe : cafePrevJson;
  }
}
