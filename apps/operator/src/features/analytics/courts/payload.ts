/**
 * Build the courts `data` block the `analytics-insights` edge function reads
 * (scope 'courts'). The model sees the SAME aggregates the cards render, with
 * display names for courts and items and nothing that identifies a guest:
 * counts, rates and money only. The shape is `CourtsInsightsPayload` from
 * @touch/core, byte-shared with the edge function.
 */
import { MIN_RATE_DENOM, pickLocale, toFindingBasis, type Locale } from '@touch/core';
import { weekdayName, type Tr } from '../copy';
import type { CourtsInsightsPayload, EndingSegmentWire, PatternCandidateWire } from '../../../lib/analyticsApi';
import type { DerivedCourts, RawCourts } from './derive';

const TOP = 12;

export function buildCourtsInsightsData(
  raw: RawCourts,
  derived: DerivedCourts,
  locale: Locale,
  tr: Tr,
  extras: { priorInsights?: string[]; rejections: string[]; patterns?: PatternCandidateWire[] } = { rejections: [] },
): CourtsInsightsPayload {
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
  // `weekday` is the JS index the fallback and the model can sort by; `weekday_label` is what they print.
  const cell = (c: (typeof openCells)[number]) => ({
    weekday: c.dow,
    weekday_label: weekdayName(tr, c.dow),
    hour: c.hour,
    occupancy_pct: c.occupancyPct,
    bookings: c.bookings,
    open_days: c.openDays,
  });
  const byOcc = [...openCells].sort((a, b) => (b.occupancyPct ?? 0) - (a.occupancyPct ?? 0));
  // A segment's rate is a percentage only over MIN_RATE_DENOM booked slots — the
  // same floor the Losses cards apply; under it the segment is not evidence.
  const seg = (dim: string, rows: readonly { key: string; n: number; bookingsTotal: number }[], label: (k: string) => string): EndingSegmentWire[] =>
    rows
      .filter((s) => s.bookingsTotal >= MIN_RATE_DENOM)
      .map((s) => ({
        dim,
        label: label(s.key),
        n: s.n,
        bookings_total: s.bookingsTotal,
        rate_pct: s.bookingsTotal > 0 ? Math.round((s.n / s.bookingsTotal) * 1000) / 10 : null,
      }));
  const topSegments = (g: RawCourts['endings']['cancellations']): EndingSegmentWire[] =>
    [
      ...seg('hour', g.byHour, (x) => `${x}:00`),
      ...seg('weekday', g.byDow, (x) => weekdayName(tr, Number(x))),
      ...seg('court', g.byCourt, courtName),
      ...seg('source', g.bySource, (x) => x),
      ...seg('lead_time', g.byLeadTime, (x) => x),
      ...seg('guest_type', g.byType, (x) => x),
    ]
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
      price_per_booked_hour_iqd: k.pricePerBookedHourIqd,
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
      hold_funnel: {
        holds_ended: raw.demand.holdFunnel.holdsEnded,
        converted: raw.demand.holdFunnel.converted,
        pending: raw.demand.holdFunnel.pending,
        conversion_pct: raw.demand.holdFunnel.conversionPct,
      },
      series: {
        series_bookings: raw.demand.series.seriesBookings,
        single_bookings: raw.demand.series.singleBookings,
        series_pct: raw.demand.series.seriesPct,
        series_revenue_iqd: raw.demand.series.seriesRevenueIqd,
      },
    },
    endings: {
      cancellations: {
        total: e.cancellations.total,
        rate_pct: k.cancellationRatePct,
        late_revenue_iqd: e.cancellations.lateRevenueIqd,
        median_notice_min: e.cancellations.medianNoticeMin,
        by_notice: e.cancellations.byNotice.map((n) => ({ bucket: n.bucket, n: n.n })),
        by_actor: e.cancellations.byActor.map((a) => ({ actor: a.actor, n: a.n })),
        top_segments: topSegments(e.cancellations),
      },
      no_shows: {
        total: e.noShows.total,
        rate_pct: k.noShowRatePct,
        top_segments: topSegments(e.noShows),
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
