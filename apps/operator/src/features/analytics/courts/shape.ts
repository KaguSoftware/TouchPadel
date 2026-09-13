/**
 * Shape the five `app.analytics_courts_*` payloads (migration 0093) into typed
 * camelCase objects. Pure and defensive: garbage becomes zeros or empty, a
 * rate the server left null (denominator 0) stays null so the UI prints a
 * dash and never a misleading 0%. Unit-tested.
 */
import type { HeatCellRow } from '@touch/core';

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const bool = (v: unknown): boolean => v === true || v === 'true';
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

// ---------------------------------------------------------------------------
// analytics_courts_summary
// ---------------------------------------------------------------------------
export interface CourtsKpis {
  bookings: number;
  bookedMinutes: number;
  occupancyPct: number | null;
  revenueIqd: number;
  revPerOpenHourIqd: number | null;
  pricePerBookedHourIqd: number | null;
  cancellations: number;
  noShows: number;
  bookedTotal: number;
  cancellationRatePct: number | null;
  noShowRatePct: number | null;
  mobileBookings: number;
  deskBookings: number;
  holdsExpired: number;
  bookingDays: number;
}

export interface CourtRow {
  courtId: string;
  nameEn: string;
  nameAr: string;
  isActive: boolean;
  bookings: number;
  bookedMinutes: number;
  openMinutes: number;
  occupancyPct: number | null;
  revenueIqd: number;
  revPerOpenHourIqd: number | null;
  cancellations: number;
  noShows: number;
  bookedTotal: number;
  cancellationRatePct: number | null;
  noShowRatePct: number | null;
  mobileBookings: number;
  deskBookings: number;
  avgDurationMin: number | null;
  playersKnown: number;
  playersAvg: number | null;
}

export interface CourtsDay {
  date: string;
  closed: boolean;
  bookings: number;
  bookedMinutes: number;
  revenueIqd: number;
  cancellations: number;
  noShows: number;
}

/** A heat cell as the miner wants it (`HeatCellRow`), with the hold count. */
export type CourtsHeatCell = HeatCellRow & { holdsExpired: number };

export interface CourtsSummary {
  range: { from: string; to: string };
  courtsCount: number;
  openMinutes: number;
  kpis: CourtsKpis;
  perCourt: CourtRow[];
  byDay: CourtsDay[];
  heatmap: CourtsHeatCell[];
}

export function parseCourtsSummary(json: unknown): CourtsSummary {
  const o = obj(json);
  const k = obj(o.kpis);
  const range = obj(o.range);
  return {
    range: { from: str(range.from), to: str(range.to) },
    courtsCount: num(o.courts_count),
    openMinutes: num(o.open_minutes),
    kpis: {
      bookings: num(k.bookings),
      bookedMinutes: num(k.booked_minutes),
      occupancyPct: numOrNull(k.occupancy_pct),
      revenueIqd: num(k.revenue_iqd),
      revPerOpenHourIqd: numOrNull(k.rev_per_open_hour_iqd),
      pricePerBookedHourIqd: numOrNull(k.price_per_booked_hour_iqd),
      cancellations: num(k.cancellations),
      noShows: num(k.no_shows),
      bookedTotal: num(k.booked_total),
      cancellationRatePct: numOrNull(k.cancellation_rate_pct),
      noShowRatePct: numOrNull(k.no_show_rate_pct),
      mobileBookings: num(k.mobile_bookings),
      deskBookings: num(k.desk_bookings),
      holdsExpired: num(k.holds_expired),
      bookingDays: num(k.booking_days),
    },
    perCourt: arr(o.per_court).map((r) => {
      const c = obj(r);
      return {
        courtId: str(c.court_id),
        nameEn: str(c.name_en),
        nameAr: str(c.name_ar),
        isActive: c.is_active === undefined ? true : bool(c.is_active),
        bookings: num(c.bookings),
        bookedMinutes: num(c.booked_minutes),
        openMinutes: num(c.open_minutes),
        occupancyPct: numOrNull(c.occupancy_pct),
        revenueIqd: num(c.revenue_iqd),
        revPerOpenHourIqd: numOrNull(c.rev_per_open_hour_iqd),
        cancellations: num(c.cancellations),
        noShows: num(c.no_shows),
        bookedTotal: num(c.booked_total),
        cancellationRatePct: numOrNull(c.cancellation_rate_pct),
        noShowRatePct: numOrNull(c.no_show_rate_pct),
        mobileBookings: num(c.mobile_bookings),
        deskBookings: num(c.desk_bookings),
        avgDurationMin: numOrNull(c.avg_duration_min),
        playersKnown: num(c.players_known),
        playersAvg: numOrNull(c.players_avg),
      };
    }),
    byDay: arr(o.by_day).map((r) => {
      const d = obj(r);
      return {
        date: str(d.business_date),
        closed: bool(d.closed),
        bookings: num(d.bookings),
        bookedMinutes: num(d.booked_minutes),
        revenueIqd: num(d.revenue_iqd),
        cancellations: num(d.cancellations),
        noShows: num(d.no_shows),
      };
    }),
    heatmap: arr(o.heatmap).map((r) => {
      const c = obj(r);
      return {
        dow: num(c.dow),
        hour: num(c.hour),
        openMinutes: num(c.open_minutes),
        openDays: num(c.open_days),
        bookedMinutes: num(c.booked_minutes),
        bookings: num(c.bookings),
        revenueIqd: num(c.revenue_iqd),
        cancellations: num(c.cancellations),
        noShows: num(c.no_shows),
        holdsExpired: num(c.holds_expired),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// analytics_courts_demand
// ---------------------------------------------------------------------------
export type LeadBucketKey = 'lt2h' | '2_6h' | '6_24h' | '1_3d' | '3_7d' | '7d_plus';
export const LEAD_BUCKETS: readonly LeadBucketKey[] = ['lt2h', '2_6h', '6_24h', '1_3d', '3_7d', '7d_plus'];

export interface DurationRow {
  durationMin: number;
  bookings: number;
  bookedMinutes: number;
  revenueIqd: number;
  revenuePerHourIqd: number | null;
}
export interface LeadBucket {
  bucket: LeadBucketKey;
  bookings: number;
  mobile: number;
  desk: number;
}
export interface SourceRow {
  source: 'mobile' | 'desk';
  bookings: number;
  revenueIqd: number;
  cancellations: number;
  noShows: number;
  avgDurationMin: number | null;
}
export interface PlayersRow {
  /** null = unknown (older bookings, or nothing picked). */
  players: number | null;
  bookings: number;
  revenueIqd: number;
  avgDurationMin: number | null;
  mobile: number;
  desk: number;
}
export interface CourtsDemand {
  durations: DurationRow[];
  leadTime: { medianMin: number | null; buckets: LeadBucket[] };
  createdHour: { hour: number; bookings: number }[];
  createdDow: { dow: number; bookings: number }[];
  sources: SourceRow[];
  holdFunnel: { holdsEnded: number; converted: number; pending: number; conversionPct: number | null };
  players: { known: number; unknown: number; avg: number | null; rows: PlayersRow[] };
  playersByCourt: { courtId: string; players: number | null; bookings: number }[];
  series: { seriesBookings: number; singleBookings: number; seriesPct: number | null; seriesRevenueIqd: number };
}

export function parseCourtsDemand(json: unknown): CourtsDemand {
  const o = obj(json);
  const lead = obj(o.lead_time);
  const funnel = obj(o.hold_funnel);
  const players = obj(o.players);
  const series = obj(o.series);
  const leadRows = arr(lead.buckets).map((r) => {
    const b = obj(r);
    return { bucket: str(b.bucket) as LeadBucketKey, bookings: num(b.bookings), mobile: num(b.mobile), desk: num(b.desk) };
  });
  return {
    durations: arr(o.durations)
      .map((r) => {
        const d = obj(r);
        return { durationMin: num(d.duration_min), bookings: num(d.bookings), bookedMinutes: num(d.booked_minutes), revenueIqd: num(d.revenue_iqd), revenuePerHourIqd: numOrNull(d.revenue_per_hour_iqd) };
      })
      .sort((a, b) => a.durationMin - b.durationMin),
    leadTime: {
      medianMin: numOrNull(lead.median_min),
      // Fixed order with zeros kept, whatever the server sent.
      buckets: LEAD_BUCKETS.map((bucket) => leadRows.find((r) => r.bucket === bucket) ?? { bucket, bookings: 0, mobile: 0, desk: 0 }),
    },
    createdHour: arr(o.created_hour).map((r) => ({ hour: num(obj(r).hour), bookings: num(obj(r).bookings) })),
    createdDow: arr(o.created_dow).map((r) => ({ dow: num(obj(r).dow), bookings: num(obj(r).bookings) })),
    sources: arr(o.sources)
      .map((r) => {
        const s = obj(r);
        return {
          source: (str(s.source) === 'mobile' ? 'mobile' : 'desk') as 'mobile' | 'desk',
          bookings: num(s.bookings),
          revenueIqd: num(s.revenue_iqd),
          cancellations: num(s.cancellations),
          noShows: num(s.no_shows),
          avgDurationMin: numOrNull(s.avg_duration_min),
        };
      })
      .filter((s, i, all) => all.findIndex((x) => x.source === s.source) === i),
    holdFunnel: {
      holdsEnded: num(funnel.holds_ended),
      converted: num(funnel.converted),
      pending: num(funnel.pending),
      conversionPct: numOrNull(funnel.conversion_pct),
    },
    players: {
      known: num(players.known),
      unknown: num(players.unknown),
      avg: numOrNull(players.avg),
      rows: arr(players.rows)
        .map((r) => {
          const p = obj(r);
          return { players: numOrNull(p.players), bookings: num(p.bookings), revenueIqd: num(p.revenue_iqd), avgDurationMin: numOrNull(p.avg_duration_min), mobile: num(p.mobile), desk: num(p.desk) };
        })
        .sort((a, b) => (a.players ?? 99) - (b.players ?? 99)),
    },
    playersByCourt: arr(o.players_by_court).map((r) => ({ courtId: str(obj(r).court_id), players: numOrNull(obj(r).players), bookings: num(obj(r).bookings) })),
    series: {
      seriesBookings: num(series.series_bookings),
      singleBookings: num(series.single_bookings),
      seriesPct: numOrNull(series.series_pct),
      seriesRevenueIqd: num(series.series_revenue_iqd),
    },
  };
}

// ---------------------------------------------------------------------------
// analytics_courts_endings
// ---------------------------------------------------------------------------
export type NoticeBucketKey = 'after_start' | 'lt2h' | '2_6h' | '6_24h' | '1_3d' | '3d_plus';
export const NOTICE_BUCKETS: readonly NoticeBucketKey[] = ['after_start', 'lt2h', '2_6h', '6_24h', '1_3d', '3d_plus'];

export interface Segment {
  key: string;
  n: number;
  bookingsTotal: number;
  /** by_court rows only. */
  courtId?: string;
  nameEn?: string;
  nameAr?: string;
}
export interface EndingGroup {
  total: number;
  revenueIqd: number;
  byHour: Segment[];
  byDow: Segment[];
  byCourt: Segment[];
  bySource: Segment[];
  byDuration: Segment[];
  byLeadTime: Segment[];
  bySeries: Segment[];
  byType: Segment[];
  /** Cancellations only. */
  lateRevenueIqd: number;
  medianNoticeMin: number | null;
  byNotice: { bucket: NoticeBucketKey; n: number }[];
  byActor: { actor: 'guest' | 'staff' | 'unknown'; n: number }[];
  /** No-shows only. */
  byPlayers: Segment[];
}
export interface CourtsEndings {
  cancellations: EndingGroup;
  noShows: EndingGroup;
}

function segments(v: unknown): Segment[] {
  return arr(v).map((r) => {
    const s = obj(r);
    const out: Segment = { key: str(s.key), n: num(s.n), bookingsTotal: num(s.bookings_total) };
    if (s.court_id !== undefined) {
      out.courtId = str(s.court_id);
      out.nameEn = str(s.name_en);
      out.nameAr = str(s.name_ar);
      if (!out.key) out.key = out.courtId;
    }
    return out;
  });
}

function endingGroup(v: unknown): EndingGroup {
  const g = obj(v);
  const notice = arr(g.by_notice).map((r) => ({ bucket: str(obj(r).bucket) as NoticeBucketKey, n: num(obj(r).n) }));
  return {
    total: num(g.total),
    revenueIqd: num(g.revenue_iqd),
    byHour: segments(g.by_hour),
    byDow: segments(g.by_dow),
    byCourt: segments(g.by_court),
    bySource: segments(g.by_source),
    byDuration: segments(g.by_duration),
    byLeadTime: segments(g.by_lead_time),
    bySeries: segments(g.by_series),
    byType: segments(g.by_type),
    lateRevenueIqd: num(g.late_revenue_iqd),
    medianNoticeMin: numOrNull(g.median_notice_min),
    byNotice: NOTICE_BUCKETS.map((bucket) => notice.find((n) => n.bucket === bucket) ?? { bucket, n: 0 }),
    byActor: arr(g.by_actor).map((r) => {
      const a = str(obj(r).actor);
      return { actor: (a === 'guest' || a === 'staff' ? a : 'unknown') as 'guest' | 'staff' | 'unknown', n: num(obj(r).n) };
    }),
    byPlayers: segments(g.by_players),
  };
}

export function parseCourtsEndings(json: unknown): CourtsEndings {
  const o = obj(json);
  return { cancellations: endingGroup(o.cancellations), noShows: endingGroup(o.no_shows) };
}

// ---------------------------------------------------------------------------
// analytics_courts_guests (anonymous aggregates only)
// ---------------------------------------------------------------------------
export type VisitBucketKey = '1' | '2_3' | '4_6' | '7_plus';
export const VISIT_BUCKETS: readonly VisitBucketKey[] = ['1', '2_3', '4_6', '7_plus'];

export interface CourtsGuests {
  lookbackDays: number;
  regularWindowDays: number;
  lapseDays: number;
  identifiedBookings: number;
  unidentifiedBookings: number;
  identities: number;
  returningBookings: number;
  newBookings: number;
  returningPct: number | null;
  visitBuckets: { bucket: VisitBucketKey; identities: number; bookings: number }[];
  regulars: number;
  lapsingRegulars: number;
  regularsBookingsPct: number | null;
  regularsFixedSlotPct: number | null;
  byWeek: { weekStart: string; newIdentities: number; returningIdentities: number; bookings: number }[];
}

export function parseCourtsGuests(json: unknown): CourtsGuests {
  const o = obj(json);
  const buckets = arr(o.visit_buckets).map((r) => ({ bucket: str(obj(r).bucket) as VisitBucketKey, identities: num(obj(r).identities), bookings: num(obj(r).bookings) }));
  return {
    lookbackDays: num(o.lookback_days) || 180,
    regularWindowDays: num(o.regular_window_days) || 90,
    lapseDays: num(o.lapse_days) || 28,
    identifiedBookings: num(o.identified_bookings),
    unidentifiedBookings: num(o.unidentified_bookings),
    identities: num(o.identities),
    returningBookings: num(o.returning_bookings),
    newBookings: num(o.new_bookings),
    returningPct: numOrNull(o.returning_pct),
    visitBuckets: VISIT_BUCKETS.map((bucket) => buckets.find((b) => b.bucket === bucket) ?? { bucket, identities: 0, bookings: 0 }),
    regulars: num(o.regulars),
    lapsingRegulars: num(o.lapsing_regulars),
    regularsBookingsPct: numOrNull(o.regulars_bookings_pct),
    regularsFixedSlotPct: numOrNull(o.regulars_fixed_slot_pct),
    byWeek: arr(o.by_week).map((r) => {
      const w = obj(r);
      return { weekStart: str(w.week_start), newIdentities: num(w.new_identities), returningIdentities: num(w.returning_identities), bookings: num(w.bookings) };
    }),
  };
}

// ---------------------------------------------------------------------------
// analytics_courts_cafe
// ---------------------------------------------------------------------------
export type TimingBucketKey = 'before_30plus' | 'before_0_30' | 'first_half' | 'second_half' | 'after_0_30' | 'after_30plus';
export const TIMING_BUCKETS: readonly TimingBucketKey[] = ['before_30plus', 'before_0_30', 'first_half', 'second_half', 'after_0_30', 'after_30plus'];

export interface AttachBlock {
  liveBookings: number;
  linkedBookings: number;
  attachPct: number | null;
  settledLinked: number;
  cafeIqd: number;
  cafePerLinkedIqd: number | null;
  cafePerBookingIqd: number | null;
  courtIqd: number;
  bookedMinutes: number;
  openMinutes: number;
  combinedPerBookedHourIqd: number | null;
  combinedPerOpenHourIqd: number | null;
}
export interface CourtAttachRow extends AttachBlock {
  courtId: string;
  nameEn: string;
  nameAr: string;
}
export interface CourtItemRow {
  courtId: string;
  itemId: string;
  nameEn: string;
  nameAr: string;
  qty: number;
  revenueIqd: number;
  linkedOrdersWithItem: number;
}
export interface CourtsCafe {
  attach: AttachBlock;
  perCourt: CourtAttachRow[];
  topItems: CourtItemRow[];
  items: { itemId: string; nameEn: string; nameAr: string; linkedOrdersWithItem: number; allOrdersWithItem: number }[];
  linkedOrdersTotal: number;
  allOrdersTotal: number;
  orderTiming: { medianOffsetMin: number | null; buckets: { bucket: TimingBucketKey; orders: number; revenueIqd: number }[] };
  attachCells: { dow: number; hour: number; liveBookings: number; linkedBookings: number }[];
  byPlayers: { players: number | null; bookings: number; linked: number; cafeIqd: number }[];
  byDuration: { durationMin: number; bookings: number; linked: number; cafeIqd: number }[];
}

function attachBlock(v: unknown): AttachBlock {
  const a = obj(v);
  return {
    liveBookings: num(a.live_bookings),
    linkedBookings: num(a.linked_bookings),
    attachPct: numOrNull(a.attach_pct),
    settledLinked: num(a.settled_linked),
    cafeIqd: num(a.cafe_iqd),
    cafePerLinkedIqd: numOrNull(a.cafe_per_linked_iqd),
    cafePerBookingIqd: numOrNull(a.cafe_per_booking_iqd),
    courtIqd: num(a.court_iqd),
    bookedMinutes: num(a.booked_minutes),
    openMinutes: num(a.open_minutes),
    combinedPerBookedHourIqd: numOrNull(a.combined_per_booked_hour_iqd),
    combinedPerOpenHourIqd: numOrNull(a.combined_per_open_hour_iqd),
  };
}

export function parseCourtsCafe(json: unknown): CourtsCafe {
  const o = obj(json);
  const timing = obj(o.order_timing);
  const timingRows = arr(timing.buckets).map((r) => ({ bucket: str(obj(r).bucket) as TimingBucketKey, orders: num(obj(r).orders), revenueIqd: num(obj(r).revenue_iqd) }));
  return {
    attach: attachBlock(o.attach),
    perCourt: arr(o.per_court).map((r) => {
      const c = obj(r);
      return { ...attachBlock(c), courtId: str(c.court_id), nameEn: str(c.name_en), nameAr: str(c.name_ar) };
    }),
    topItems: arr(o.top_items).map((r) => {
      const t = obj(r);
      return { courtId: str(t.court_id), itemId: str(t.item_id), nameEn: str(t.name_en), nameAr: str(t.name_ar), qty: num(t.qty), revenueIqd: num(t.revenue_iqd), linkedOrdersWithItem: num(t.linked_orders_with_item) };
    }),
    items: arr(o.items).map((r) => {
      const t = obj(r);
      return { itemId: str(t.item_id), nameEn: str(t.name_en), nameAr: str(t.name_ar), linkedOrdersWithItem: num(t.linked_orders_with_item), allOrdersWithItem: num(t.all_orders_with_item) };
    }),
    linkedOrdersTotal: num(o.linked_orders_total),
    allOrdersTotal: num(o.all_orders_total),
    orderTiming: {
      medianOffsetMin: numOrNull(timing.median_offset_min),
      buckets: TIMING_BUCKETS.map((bucket) => timingRows.find((t) => t.bucket === bucket) ?? { bucket, orders: 0, revenueIqd: 0 }),
    },
    attachCells: arr(o.attach_cells).map((r) => ({ dow: num(obj(r).dow), hour: num(obj(r).hour), liveBookings: num(obj(r).live_bookings), linkedBookings: num(obj(r).linked_bookings) })),
    byPlayers: arr(o.by_players)
      .map((r) => ({ players: numOrNull(obj(r).players), bookings: num(obj(r).bookings), linked: num(obj(r).linked), cafeIqd: num(obj(r).cafe_iqd) }))
      .sort((a, b) => (a.players ?? 99) - (b.players ?? 99)),
    byDuration: arr(o.by_duration)
      .map((r) => ({ durationMin: num(obj(r).duration_min), bookings: num(obj(r).bookings), linked: num(obj(r).linked), cafeIqd: num(obj(r).cafe_iqd) }))
      .sort((a, b) => a.durationMin - b.durationMin),
  };
}
