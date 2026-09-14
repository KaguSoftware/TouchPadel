/**
 * Build the courts `data` block the `analytics-insights` edge function reads
 * (scope 'courts'). The model sees the SAME aggregates the cards render, with
 * display names for courts and items and nothing that identifies a guest:
 * counts, rates and money only.
 */
import { pickLocale, toFindingBasis, type Locale } from '@touch/core';
import { weekdayName, type Tr } from '../copy';
import type { CourtsInsightsData, PatternCandidateWire } from '../../../lib/analyticsApi';
import type { DerivedCourts, RawCourts } from './derive';

const TOP = 12;

export function buildCourtsInsightsData(
  raw: RawCourts,
  derived: DerivedCourts,
  locale: Locale,
  tr: Tr,
  extras: { priorInsights?: string[]; rejections: string[]; patterns?: PatternCandidateWire[] } = { rejections: [] },
): CourtsInsightsData {
  const courtName = (id: string) => {
    const c = derived.courtNames.get(id);
    return c ? pickLocale({ en: c.nameEn, ar: c.nameAr }, locale) || id : id;
  };
  const itemName = (id: string) => {
    const i = derived.itemNames.get(id);
    return i ? pickLocale({ en: i.nameEn, ar: i.nameAr }, locale) || id : id;
  };
  const k = raw.summary.kpis;
  const kp = raw.summaryPrev?.kpis;
  const cafeByCourt = new Map(raw.cafe.perCourt.map((c) => [c.courtId, c]));
  const openCells = derived.cells.filter((c) => c.openMinutes > 0 && c.occupancyPct != null);
  const cell = (c: (typeof openCells)[number]) => ({
    weekday: weekdayName(tr, c.dow),
    hour: c.hour,
    occupancy_pct: c.occupancyPct,
    bookings: c.bookings,
    open_days: c.openDays,
  });
  const byOcc = [...openCells].sort((a, b) => (b.occupancyPct ?? 0) - (a.occupancyPct ?? 0));
  const seg = (rows: readonly { key: string; n: number; bookingsTotal: number }[], label: (k: string) => string) =>
    rows
      .filter((s) => s.bookingsTotal >= 8)
      .map((s) => ({ label: label(s.key), n: s.n, bookings_total: s.bookingsTotal, rate_pct: s.bookingsTotal > 0 ? Math.round((s.n / s.bookingsTotal) * 1000) / 10 : null }))
      .sort((a, b) => (b.rate_pct ?? 0) - (a.rate_pct ?? 0))
      .slice(0, 8);
  const e = raw.endings;
  const g = raw.guests;
  const cafe = raw.cafe;

  return {
    kpis: {
      bookings: k.bookings,
      booked_minutes: k.bookedMinutes,
      occupancy_pct: k.occupancyPct,
      revenue_iqd: k.revenueIqd,
      rev_per_open_hour_iqd: k.revPerOpenHourIqd,
      cancellations: k.cancellations,
      no_shows: k.noShows,
      booked_total: k.bookedTotal,
      cancellation_rate_pct: k.cancellationRatePct,
      no_show_rate_pct: k.noShowRatePct,
      mobile_bookings: k.mobileBookings,
      desk_bookings: k.deskBookings,
      holds_expired: k.holdsExpired,
      booking_days: k.bookingDays,
      courts_count: raw.summary.courtsCount,
    },
    compare: kp
      ? {
          from: raw.compareRange.from,
          to: raw.compareRange.to,
          basis: raw.compareBasis,
          reliable: derived.compareReliable,
          kpis: {
            bookings: kp.bookings,
            booked_minutes: kp.bookedMinutes,
            occupancy_pct: kp.occupancyPct,
            revenue_iqd: kp.revenueIqd,
            cancellations: kp.cancellations,
            no_shows: kp.noShows,
            cancellation_rate_pct: kp.cancellationRatePct,
            no_show_rate_pct: kp.noShowRatePct,
          },
          deltas: Object.fromEntries(Object.entries(derived.deltas).map(([key, d]) => [key, d.delta])),
        }
      : undefined,
    coverage: { days: derived.coverage.days, days_with_data: derived.coverage.daysWithData, ratio: derived.coverage.ratio },
    basis: (() => {
      const b = toFindingBasis(derived.basis);
      return { salesDays: b.salesDays, weekdayCounts: [...b.weekdayCounts] };
    })(),
    per_court: raw.summary.perCourt.slice(0, TOP).map((c) => {
      const cc = cafeByCourt.get(c.courtId);
      return {
        name: courtName(c.courtId),
        bookings: c.bookings,
        occupancy_pct: c.occupancyPct,
        revenue_iqd: c.revenueIqd,
        rev_per_open_hour_iqd: c.revPerOpenHourIqd,
        cancellations: c.cancellations,
        no_shows: c.noShows,
        attach_pct: cc?.attachPct ?? null,
        cafe_per_linked_iqd: cc?.cafePerLinkedIqd ?? null,
      };
    }),
    by_day: raw.summary.byDay.map((d) => ({ business_date: d.date, bookings: d.bookings, revenue_iqd: d.revenueIqd, cancellations: d.cancellations, no_shows: d.noShows })),
    heatmap_top: byOcc.slice(0, TOP).map(cell),
    heatmap_bottom: byOcc.slice(-TOP).reverse().map(cell),
    demand: {
      durations: raw.demand.durations.map((d) => ({ duration_min: d.durationMin, bookings: d.bookings, revenue_per_hour_iqd: d.revenuePerHourIqd })),
      lead_time: { median_min: raw.demand.leadTime.medianMin, buckets: raw.demand.leadTime.buckets.map((b) => ({ bucket: b.bucket, bookings: b.bookings, mobile: b.mobile, desk: b.desk })) },
      sources: raw.demand.sources.map((s) => ({ source: s.source, bookings: s.bookings, revenue_iqd: s.revenueIqd, cancellations: s.cancellations, no_shows: s.noShows })),
      hold_funnel: { ...raw.demand.holdFunnel },
      players: { known: raw.demand.players.known, unknown: raw.demand.players.unknown, avg: raw.demand.players.avg, rows: raw.demand.players.rows.map((p) => ({ players: p.players, bookings: p.bookings })) },
      series: { ...raw.demand.series },
    },
    endings: {
      cancellations: {
        total: e.cancellations.total,
        rate_pct: k.cancellationRatePct,
        late_revenue_iqd: e.cancellations.lateRevenueIqd,
        median_notice_min: e.cancellations.medianNoticeMin,
        by_notice: e.cancellations.byNotice.map((n) => ({ bucket: n.bucket, n: n.n })),
        by_actor: e.cancellations.byActor.map((a) => ({ actor: a.actor, n: a.n })),
        top_segments: [
          ...seg(e.cancellations.byHour, (x) => `${x}:00`),
          ...seg(e.cancellations.byDow, (x) => weekdayName(tr, Number(x))),
          ...seg(e.cancellations.byCourt, courtName),
          ...seg(e.cancellations.bySource, (x) => x),
          ...seg(e.cancellations.byLeadTime, (x) => x),
          ...seg(e.cancellations.byType, (x) => x),
        ]
          .sort((a, b) => (b.rate_pct ?? 0) - (a.rate_pct ?? 0))
          .slice(0, 8),
      },
      no_shows: {
        total: e.noShows.total,
        rate_pct: k.noShowRatePct,
        top_segments: [
          ...seg(e.noShows.byHour, (x) => `${x}:00`),
          ...seg(e.noShows.byDow, (x) => weekdayName(tr, Number(x))),
          ...seg(e.noShows.byCourt, courtName),
          ...seg(e.noShows.bySource, (x) => x),
          ...seg(e.noShows.byLeadTime, (x) => x),
          ...seg(e.noShows.byType, (x) => x),
        ]
          .sort((a, b) => (b.rate_pct ?? 0) - (a.rate_pct ?? 0))
          .slice(0, 8),
      },
    },
    guests: g
      ? {
          identities: g.identities,
          returning_pct: g.returningPct,
          visit_buckets: g.visitBuckets.map((b) => ({ bucket: b.bucket, identities: b.identities, bookings: b.bookings })),
          regulars: g.regulars,
          lapsing_regulars: g.lapsingRegulars,
          regulars_bookings_pct: g.regularsBookingsPct,
        }
      : null,
    cafe:
      cafe.attach.liveBookings > 0
        ? {
            attach_pct: cafe.attach.attachPct,
            cafe_per_booking_iqd: cafe.attach.cafePerBookingIqd,
            cafe_per_linked_iqd: cafe.attach.cafePerLinkedIqd,
            per_court: cafe.perCourt.slice(0, TOP).map((c) => ({ name: courtName(c.courtId), attach_pct: c.attachPct, cafe_per_linked_iqd: c.cafePerLinkedIqd, linked_bookings: c.linkedBookings, live_bookings: c.liveBookings })),
            top_items_per_court: cafe.perCourt.slice(0, TOP).map((c) => ({
              court: courtName(c.courtId),
              items: cafe.topItems
                .filter((i) => i.courtId === c.courtId)
                .slice(0, 3)
                .map((i) => ({ name: itemName(i.itemId), qty: i.qty, revenue_iqd: i.revenueIqd })),
            })),
            order_timing: { median_offset_min: cafe.orderTiming.medianOffsetMin, buckets: cafe.orderTiming.buckets.map((b) => ({ bucket: b.bucket, orders: b.orders })) },
            value_per_court_hour: cafe.perCourt.slice(0, TOP).map((c) => ({ name: courtName(c.courtId), combined_per_booked_hour_iqd: c.combinedPerBookedHourIqd, combined_per_open_hour_iqd: c.combinedPerOpenHourIqd })),
          }
        : null,
    patterns: extras.patterns,
    prior_insights: extras.priorInsights,
    rejections: extras.rejections,
    excluded_names: [],
  };
}
