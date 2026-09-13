/**
 * Pure derivation over the parsed courts payloads: the comparison deltas
 * (with the same reliability gate the cafe tab uses), the occupancy cells
 * behind the heatmap, the hour and weekday roll-ups, the thin-sample basis
 * the cards read their guards from, and the deterministic patterns mined in
 * @touch/core. The server does every money and time sum; this file only
 * compares and arranges what it returned (PRODUCT.md principle 3).
 */
import {
  RELIABLE_COVERAGE,
  buildCourtsBasis,
  pickLocale,
  isThinCourtsPeriod,
  mineCourtPatterns,
  pctDelta,
  salesCoverage,
  thinCourtWeekdays,
  type CompareBasis,
  type CourtPatternCandidate,
  type CourtPatternsCopy,
  type CourtsBasis,
  type DateRange,
  type SalesCoverage,
} from '@touch/core';
import type { CourtsCafe, CourtsDemand, CourtsEndings, CourtsGuests, CourtsHeatCell, CourtsSummary } from './shape';

export interface RawCourts {
  range: DateRange;
  compareRange: DateRange;
  compareBasis: CompareBasis;
  todayISO: string;
  courtId: string | null;
  summary: CourtsSummary;
  demand: CourtsDemand;
  endings: CourtsEndings;
  guests: CourtsGuests | null;
  cafe: CourtsCafe;
  summaryPrev: CourtsSummary | null;
  demandPrev: CourtsDemand | null;
  endingsPrev: CourtsEndings | null;
  cafePrev: CourtsCafe | null;
}

export type CourtKpiKey =
  | 'bookings'
  | 'bookedHours'
  | 'occupancy'
  | 'revenue'
  | 'revPerOpenHour'
  | 'cancellationRate'
  | 'noShowRate'
  | 'attachRate';

export interface KpiDelta {
  /** Signed % change for counts and money; signed POINTS for rates. null when there is no baseline. */
  delta: number | null;
  current: number | null;
  previous: number | null;
}

export interface HourRollup {
  hour: number;
  bookings: number;
  bookedMinutes: number;
  openMinutes: number;
  occupancyPct: number | null;
}

export interface DowRollup {
  dow: number;
  bookings: number;
  bookedMinutes: number;
  openMinutes: number;
  occupancyPct: number | null;
}

export interface OccupancyCell {
  dow: number;
  hour: number;
  /** null when the cell is closed (no open minutes). */
  occupancyPct: number | null;
  bookings: number;
  bookedMinutes: number;
  openMinutes: number;
  openDays: number;
  revenueIqd: number;
}

export interface DerivedCourts {
  basis: CourtsBasis;
  thin: boolean;
  thinWeekdays: number[];
  coverage: SalesCoverage;
  coveragePrev: SalesCoverage;
  /** The compare window had bookings on enough of its days for a delta to mean anything. */
  compareReliable: boolean;
  /** No opening hours configured: occupancy has no denominator. */
  noOpeningHours: boolean;
  deltas: Record<CourtKpiKey, KpiDelta>;
  cells: OccupancyCell[];
  byHour: HourRollup[];
  byDow: DowRollup[];
  patterns: CourtPatternCandidate[];
  courtNames: Map<string, { nameEn: string; nameAr: string }>;
  itemNames: Map<string, { nameEn: string; nameAr: string }>;
}

function pct(booked: number, open: number): number | null {
  return open > 0 ? Math.round((booked / open) * 1000) / 10 : null;
}

function pointDelta(cur: number | null, prev: number | null): number | null {
  return cur == null || prev == null ? null : Math.round((cur - prev) * 10) / 10;
}

function cells(heat: readonly CourtsHeatCell[]): OccupancyCell[] {
  return heat.map((c) => ({
    dow: c.dow,
    hour: c.hour,
    occupancyPct: pct(c.bookedMinutes, c.openMinutes),
    bookings: c.bookings,
    bookedMinutes: c.bookedMinutes,
    openMinutes: c.openMinutes,
    openDays: c.openDays,
    revenueIqd: c.revenueIqd,
  }));
}

function rollupBy<K extends 'hour' | 'dow'>(heat: readonly CourtsHeatCell[], key: K, size: number) {
  const out = Array.from({ length: size }, (_, i) => ({ [key]: i, bookings: 0, bookedMinutes: 0, openMinutes: 0 }) as Record<K, number> & {
    bookings: number;
    bookedMinutes: number;
    openMinutes: number;
  });
  for (const c of heat) {
    const row = out[c[key]];
    if (!row) continue;
    row.bookings += c.bookings;
    row.bookedMinutes += c.bookedMinutes;
    row.openMinutes += c.openMinutes;
  }
  return out.map((r) => ({ ...r, occupancyPct: pct(r.bookedMinutes, r.openMinutes) }));
}

export function deriveCourts(raw: RawCourts, copy: CourtPatternsCopy): DerivedCourts {
  const { summary, endings, guests, cafe, summaryPrev, cafePrev } = raw;
  const k = summary.kpis;
  const kp = summaryPrev?.kpis ?? null;

  const bookingDates = summary.byDay.filter((d) => d.bookings > 0).map((d) => d.date);
  const bookingDatesPrev = (summaryPrev?.byDay ?? []).filter((d) => d.bookings > 0).map((d) => d.date);
  const coverage = salesCoverage(raw.range, bookingDates);
  const coveragePrev = salesCoverage(raw.compareRange, bookingDatesPrev);
  const compareReliable = summaryPrev !== null && coveragePrev.ratio >= RELIABLE_COVERAGE && coverage.ratio >= RELIABLE_COVERAGE;

  const basis = buildCourtsBasis({
    range: raw.range,
    bookingDates,
    bookings: k.bookings,
    bookedTotal: k.bookedTotal,
    identities: guests?.identities ?? 0,
    linkedBookings: cafe.attach.linkedBookings,
  });

  const courtNames = new Map(summary.perCourt.map((c) => [c.courtId, { nameEn: c.nameEn, nameAr: c.nameAr }]));
  const itemNames = new Map<string, { nameEn: string; nameAr: string }>();
  for (const i of cafe.items) itemNames.set(i.itemId, { nameEn: i.nameEn, nameAr: i.nameAr });
  for (const i of cafe.topItems) if (!itemNames.has(i.itemId)) itemNames.set(i.itemId, { nameEn: i.nameEn, nameAr: i.nameAr });

  const money = (cur: number, prev: number | null | undefined): KpiDelta => ({
    delta: compareReliable && prev != null ? pctDelta(cur, prev) : null,
    current: cur,
    previous: prev ?? null,
  });
  const rate = (cur: number | null, prev: number | null | undefined): KpiDelta => ({
    delta: compareReliable ? pointDelta(cur, prev ?? null) : null,
    current: cur,
    previous: prev ?? null,
  });

  const deltas: Record<CourtKpiKey, KpiDelta> = {
    bookings: money(k.bookings, kp?.bookings),
    bookedHours: money(k.bookedMinutes / 60, kp ? kp.bookedMinutes / 60 : null),
    occupancy: rate(k.occupancyPct, kp?.occupancyPct),
    revenue: money(k.revenueIqd, kp?.revenueIqd),
    revPerOpenHour: money(k.revPerOpenHourIqd ?? 0, kp?.revPerOpenHourIqd),
    cancellationRate: rate(k.cancellationRatePct, kp?.cancellationRatePct),
    noShowRate: rate(k.noShowRatePct, kp?.noShowRatePct),
    attachRate: rate(cafe.attach.attachPct, cafePrev?.attach.attachPct),
  };

  const segs = (g: CourtsEndings['cancellations']) => ({
    byHour: g.byHour,
    byDow: g.byDow,
    byCourt: g.byCourt.map((s) => ({ key: s.courtId ?? s.key, n: s.n, bookingsTotal: s.bookingsTotal })),
    bySource: g.bySource,
    byDuration: g.byDuration,
    byLeadTime: g.byLeadTime,
    byType: g.byType,
  });

  // Court subjects in the miner's sentences read as names, not ids: the copy
  // adapter is built before any data exists, so the name map is grafted here.
  const namedCopy: CourtPatternsCopy = {
    ...copy,
    segment: (dimension, key) => {
      if (dimension !== 'byCourt') return copy.segment(dimension, key);
      const c = courtNames.get(key);
      return c ? pickLocale({ en: c.nameEn, ar: c.nameAr }, copy.locale) || key : key;
    },
  };

  const patterns = mineCourtPatterns(
    {
      heatmap: summary.heatmap,
      compareHeatmap: summaryPrev?.heatmap ?? null,
      courtsCount: summary.courtsCount,
      perCourt: summary.perCourt.map((c) => ({ courtId: c.courtId, bookings: c.bookings, bookedTotal: c.bookedTotal, cancellations: c.cancellations, noShows: c.noShows })),
      endings: {
        cancellations: { ...segs(endings.cancellations), byNotice: endings.cancellations.byNotice.map((n) => ({ key: n.bucket, n: n.n, bookingsTotal: endings.cancellations.total })) },
        noShows: segs(endings.noShows),
        cancellationsTotal: endings.cancellations.total,
        noShowsTotal: endings.noShows.total,
        bookedTotal: k.bookedTotal,
      },
      guests: guests ? { regulars: guests.regulars, lapsingRegulars: guests.lapsingRegulars, identities: guests.identities } : null,
      cafe: {
        attachPct: cafe.attach.attachPct,
        liveBookings: cafe.attach.liveBookings,
        linkedBookings: cafe.attach.linkedBookings,
        perCourt: cafe.perCourt.map((c) => ({ courtId: c.courtId, liveBookings: c.liveBookings, linkedBookings: c.linkedBookings })),
        attachCells: cafe.attachCells,
        items: cafe.items,
        linkedOrdersTotal: cafe.linkedOrdersTotal,
        allOrdersTotal: cafe.allOrdersTotal,
      },
      basis,
      courtNames,
      itemNames,
    },
    0,
    namedCopy,
  );

  return {
    basis,
    thin: isThinCourtsPeriod(basis),
    thinWeekdays: thinCourtWeekdays(basis),
    coverage,
    coveragePrev,
    compareReliable,
    noOpeningHours: summary.openMinutes === 0,
    deltas,
    cells: cells(summary.heatmap),
    byHour: rollupBy(summary.heatmap, 'hour', 24),
    byDow: rollupBy(summary.heatmap, 'dow', 7),
    patterns,
    courtNames,
    itemNames,
  };
}

/** Bookings that were not series occurrences, for the demand cards' "n of N" notes. */
export function singleBookings(demand: CourtsDemand): number {
  return demand.series.singleBookings;
}
