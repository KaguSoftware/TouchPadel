import { describe, expect, it } from 'vitest';
import {
  LEAD_BUCKETS,
  NOTICE_BUCKETS,
  TIMING_BUCKETS,
  VISIT_BUCKETS,
  parseCourtsCafe,
  parseCourtsDemand,
  parseCourtsEndings,
  parseCourtsGuests,
  parseCourtsSummary,
} from './shape';
import { COURT_A, COURT_B, ITEM_LATTE, ITEM_WATER, cafeJson, demandJson, endingsJson, guestsJson, summaryJson } from './fixtures';

// The five parsers are the only place the snake_case RPC payloads are read.
// Each one is pure and defensive: garbage becomes zeros or empty, a rate the
// server left null (denominator 0) stays null so the UI prints a dash.

const GARBAGE: unknown[] = [null, undefined, 'nope', 42, [], [1, 'a'], { kpis: 'x', per_court: 'y', heatmap: [1, 'a', null, {}] }];

describe('parseCourtsSummary', () => {
  it('maps the fixture to exact camelCase objects', () => {
    const s = parseCourtsSummary(summaryJson);
    expect(s.range).toEqual({ from: '2026-09-01', to: '2026-09-07' });
    expect(s.courtsCount).toBe(2);
    expect(s.openMinutes).toBe(11760);
    expect(s.kpis).toEqual({
      bookings: 48,
      bookedMinutes: 3600,
      occupancyPct: 30.6,
      revenueIqd: 1200000,
      revPerOpenHourIqd: 6122,
      pricePerBookedHourIqd: 20000,
      cancellations: 12,
      noShows: 4,
      bookedTotal: 64,
      cancellationRatePct: 18.8,
      noShowRatePct: 6.3,
      mobileBookings: 30,
      deskBookings: 18,
      holdsExpired: 5,
      bookingDays: 7,
    });
    expect(s.perCourt).toEqual([
      {
        courtId: COURT_A,
        nameEn: 'Court A',
        nameAr: 'ملعب أ',
        isActive: true,
        bookings: 18,
        bookedMinutes: 1350,
        openMinutes: 5880,
        occupancyPct: 23,
        revenueIqd: 450000,
        revPerOpenHourIqd: 4592,
        cancellations: 9,
        noShows: 2,
        bookedTotal: 29,
        cancellationRatePct: 31,
        noShowRatePct: 6.9,
        mobileBookings: 12,
        deskBookings: 6,
        avgDurationMin: 75,
        playersKnown: 12,
        playersAvg: 3.4,
      },
      {
        courtId: COURT_B,
        nameEn: 'Court B',
        nameAr: 'ملعب ب',
        // Absent on the wire: defaults to active.
        isActive: true,
        bookings: 30,
        bookedMinutes: 2250,
        openMinutes: 5880,
        occupancyPct: 38.3,
        revenueIqd: 750000,
        revPerOpenHourIqd: 7653,
        cancellations: 3,
        noShows: 2,
        bookedTotal: 35,
        cancellationRatePct: 8.6,
        noShowRatePct: 5.7,
        mobileBookings: 18,
        deskBookings: 12,
        avgDurationMin: 75,
        playersKnown: 0,
        playersAvg: null,
      },
    ]);
    expect(s.byDay).toHaveLength(7);
    expect(s.byDay[0]).toEqual({ date: '2026-09-01', closed: false, bookings: 6, bookedMinutes: 450, revenueIqd: 150000, cancellations: 2, noShows: 0 });
    expect(s.byDay[3]).toEqual({ date: '2026-09-04', closed: false, bookings: 9, bookedMinutes: 675, revenueIqd: 225000, cancellations: 1, noShows: 1 });
    expect(s.heatmap).toEqual([
      { dow: 1, hour: 18, openMinutes: 120, openDays: 1, bookedMinutes: 30, bookings: 1, revenueIqd: 10000, cancellations: 0, noShows: 0, holdsExpired: 0 },
      { dow: 1, hour: 19, openMinutes: 120, openDays: 1, bookedMinutes: 60, bookings: 1, revenueIqd: 20000, cancellations: 0, noShows: 0, holdsExpired: 0 },
      { dow: 2, hour: 3, openMinutes: 0, openDays: 0, bookedMinutes: 0, bookings: 0, revenueIqd: 0, cancellations: 0, noShows: 0, holdsExpired: 0 },
      { dow: 5, hour: 18, openMinutes: 120, openDays: 1, bookedMinutes: 60, bookings: 1, revenueIqd: 20000, cancellations: 1, noShows: 0, holdsExpired: 1 },
      { dow: 5, hour: 20, openMinutes: 120, openDays: 1, bookedMinutes: 120, bookings: 2, revenueIqd: 40000, cancellations: 0, noShows: 1, holdsExpired: 2 },
    ]);
  });

  it.each(GARBAGE)('never throws on garbage input (%j) and returns zeros and empty arrays', (input) => {
    const s = parseCourtsSummary(input);
    expect(s.range).toEqual({ from: '', to: '' });
    expect(s.courtsCount).toBe(0);
    expect(s.openMinutes).toBe(0);
    expect(s.kpis.bookings).toBe(0);
    expect(s.kpis.revenueIqd).toBe(0);
    expect(s.kpis.occupancyPct).toBeNull();
    expect(s.perCourt).toEqual([]);
    expect(s.byDay).toEqual([]);
    // A heatmap of garbage rows yields zero rows, never a throw.
    for (const cell of s.heatmap) expect(cell).toEqual({ dow: 0, hour: 0, openMinutes: 0, openDays: 0, bookedMinutes: 0, bookings: 0, revenueIqd: 0, cancellations: 0, noShows: 0, holdsExpired: 0 });
  });

  it('keeps a null rate null and never turns it into 0', () => {
    const s = parseCourtsSummary({
      kpis: { bookings: 3, occupancy_pct: null, rev_per_open_hour_iqd: undefined, cancellation_rate_pct: 'abc', no_show_rate_pct: '12.5' },
      per_court: [{ court_id: COURT_A, occupancy_pct: null, players_avg: null, avg_duration_min: 'x' }],
    });
    expect(s.kpis.bookings).toBe(3);
    expect(s.kpis.occupancyPct).toBeNull();
    expect(s.kpis.revPerOpenHourIqd).toBeNull();
    expect(s.kpis.cancellationRatePct).toBeNull();
    // A numeric string is still a number.
    expect(s.kpis.noShowRatePct).toBe(12.5);
    expect(s.perCourt[0]?.occupancyPct).toBeNull();
    expect(s.perCourt[0]?.playersAvg).toBeNull();
    expect(s.perCourt[0]?.avgDurationMin).toBeNull();
    // A count that is missing or unreadable is 0, never NaN.
    expect(s.perCourt[0]?.bookings).toBe(0);
  });

  it('reads numeric strings and string booleans the way PostgREST may serialise them', () => {
    const s = parseCourtsSummary({ courts_count: '2', open_minutes: '600', by_day: [{ business_date: '2026-09-01', closed: 'true', bookings: '4' }], per_court: [{ court_id: COURT_A, is_active: 'true' }, { court_id: COURT_B, is_active: false }] });
    expect(s.courtsCount).toBe(2);
    expect(s.openMinutes).toBe(600);
    expect(s.byDay[0]).toMatchObject({ closed: true, bookings: 4 });
    expect(s.perCourt.map((c) => c.isActive)).toEqual([true, false]);
  });
});

describe('parseCourtsDemand', () => {
  it('maps the fixture to exact camelCase objects', () => {
    const d = parseCourtsDemand(demandJson);
    expect(d.durations).toEqual([
      { durationMin: 60, bookings: 28, bookedMinutes: 1680, revenueIqd: 600000, revenuePerHourIqd: 21429 },
      { durationMin: 90, bookings: 20, bookedMinutes: 1800, revenueIqd: 600000, revenuePerHourIqd: 20000 },
    ]);
    expect(d.leadTime.medianMin).toBe(360);
    expect(d.createdHour).toEqual([{ hour: 20, bookings: 10 }]);
    expect(d.createdDow).toEqual([{ dow: 4, bookings: 12 }]);
    expect(d.holdFunnel).toEqual({ holdsEnded: 5, converted: 25, pending: 1, conversionPct: 83.3 });
    expect(d.players.known).toBe(20);
    expect(d.players.unknown).toBe(28);
    expect(d.players.avg).toBe(3.4);
    expect(d.playersByCourt).toEqual([
      { courtId: COURT_A, players: 4, bookings: 12 },
      { courtId: COURT_B, players: null, bookings: 30 },
    ]);
    expect(d.series).toEqual({ seriesBookings: 8, singleBookings: 40, seriesPct: 16.7, seriesRevenueIqd: 200000 });
  });

  it('returns the lead buckets in fixed order with zeros for the missing ones', () => {
    const d = parseCourtsDemand(demandJson);
    expect(d.leadTime.buckets.map((b) => b.bucket)).toEqual([...LEAD_BUCKETS]);
    expect(d.leadTime.buckets).toEqual([
      { bucket: 'lt2h', bookings: 5, mobile: 2, desk: 3 },
      { bucket: '2_6h', bookings: 0, mobile: 0, desk: 0 },
      { bucket: '6_24h', bookings: 20, mobile: 14, desk: 6 },
      { bucket: '1_3d', bookings: 15, mobile: 10, desk: 5 },
      { bucket: '3_7d', bookings: 0, mobile: 0, desk: 0 },
      { bucket: '7d_plus', bookings: 0, mobile: 0, desk: 0 },
    ]);
  });

  it('sorts players rows ascending with the unknown row last', () => {
    const d = parseCourtsDemand(demandJson);
    expect(d.players.rows.map((r) => r.players)).toEqual([2, 4, null]);
    expect(d.players.rows[2]).toEqual({ players: null, bookings: 28, revenueIqd: 700000, avgDurationMin: 75, mobile: 18, desk: 10 });
  });

  it('deduplicates sources, keeping the first row per channel', () => {
    const d = parseCourtsDemand(demandJson);
    expect(d.sources).toEqual([
      { source: 'mobile', bookings: 30, revenueIqd: 750000, cancellations: 8, noShows: 3, avgDurationMin: 72 },
      { source: 'desk', bookings: 18, revenueIqd: 450000, cancellations: 4, noShows: 1, avgDurationMin: 80 },
    ]);
    // Anything that is not 'mobile' is the desk.
    expect(parseCourtsDemand({ sources: [{ source: 'walk-in' }] }).sources).toEqual([{ source: 'desk', bookings: 0, revenueIqd: 0, cancellations: 0, noShows: 0, avgDurationMin: null }]);
  });

  it.each(GARBAGE)('never throws on garbage input (%j)', (input) => {
    const d = parseCourtsDemand(input);
    expect(d.durations).toEqual([]);
    expect(d.leadTime.medianMin).toBeNull();
    expect(d.leadTime.buckets).toHaveLength(LEAD_BUCKETS.length);
    expect(d.leadTime.buckets.every((b) => b.bookings === 0 && b.mobile === 0 && b.desk === 0)).toBe(true);
    expect(d.createdHour).toEqual([]);
    expect(d.createdDow).toEqual([]);
    expect(d.sources).toEqual([]);
    expect(d.holdFunnel).toEqual({ holdsEnded: 0, converted: 0, pending: 0, conversionPct: null });
    expect(d.players).toEqual({ known: 0, unknown: 0, avg: null, rows: [] });
    expect(d.playersByCourt).toEqual([]);
    expect(d.series).toEqual({ seriesBookings: 0, singleBookings: 0, seriesPct: null, seriesRevenueIqd: 0 });
  });
});

describe('parseCourtsEndings', () => {
  it('maps the fixture to exact camelCase objects', () => {
    const e = parseCourtsEndings(endingsJson);
    expect(e.cancellations.total).toBe(12);
    expect(e.cancellations.revenueIqd).toBe(300000);
    expect(e.cancellations.lateRevenueIqd).toBe(50000);
    expect(e.cancellations.medianNoticeMin).toBe(180);
    expect(e.cancellations.byHour).toEqual([{ key: '20', n: 6, bookingsTotal: 24 }]);
    expect(e.cancellations.byDow).toEqual([{ key: '5', n: 5, bookingsTotal: 18 }]);
    expect(e.cancellations.bySource).toEqual([
      { key: 'mobile', n: 8, bookingsTotal: 41 },
      { key: 'desk', n: 4, bookingsTotal: 23 },
    ]);
    expect(e.cancellations.byDuration).toEqual([{ key: '60', n: 7, bookingsTotal: 35 }]);
    expect(e.cancellations.byLeadTime).toEqual([{ key: 'lt2h', n: 2, bookingsTotal: 7 }]);
    expect(e.cancellations.bySeries).toEqual([{ key: 'single', n: 10, bookingsTotal: 52 }]);
    expect(e.cancellations.byType).toEqual([
      { key: 'new', n: 7, bookingsTotal: 30 },
      { key: 'returning', n: 3, bookingsTotal: 24 },
      { key: 'unidentified', n: 2, bookingsTotal: 10 },
    ]);
    expect(e.cancellations.byPlayers).toEqual([]);
    expect(e.noShows.total).toBe(4);
    expect(e.noShows.revenueIqd).toBe(100000);
    // No-shows have no notice or actor: the cancellation-only fields are empty, not missing.
    expect(e.noShows.lateRevenueIqd).toBe(0);
    expect(e.noShows.medianNoticeMin).toBeNull();
    expect(e.noShows.byActor).toEqual([]);
    expect(e.noShows.byNotice.every((n) => n.n === 0)).toBe(true);
    expect(e.noShows.byPlayers).toEqual([
      { key: '4', n: 2, bookingsTotal: 12 },
      { key: '', n: 2, bookingsTotal: 28 },
    ]);
  });

  it('keys by_court rows by the court id and carries both names', () => {
    const e = parseCourtsEndings(endingsJson);
    expect(e.cancellations.byCourt).toEqual([
      { key: COURT_A, n: 9, bookingsTotal: 29, courtId: COURT_A, nameEn: 'Court A', nameAr: 'ملعب أ' },
      { key: COURT_B, n: 3, bookingsTotal: 35, courtId: COURT_B, nameEn: 'Court B', nameAr: 'ملعب ب' },
    ]);
    // A row that carries both keeps its own key.
    const own = parseCourtsEndings({ cancellations: { by_court: [{ key: 'k', court_id: COURT_A, name_en: 'A', name_ar: 'أ', n: 1, bookings_total: 2 }] } });
    expect(own.cancellations.byCourt[0]).toEqual({ key: 'k', n: 1, bookingsTotal: 2, courtId: COURT_A, nameEn: 'A', nameAr: 'أ' });
    // A plain segment never grows court fields.
    expect(Object.keys(e.cancellations.byHour[0]!)).toEqual(['key', 'n', 'bookingsTotal']);
  });

  it('returns the notice buckets in fixed order with zeros for the missing ones', () => {
    const e = parseCourtsEndings(endingsJson);
    expect(e.cancellations.byNotice.map((b) => b.bucket)).toEqual([...NOTICE_BUCKETS]);
    expect(e.cancellations.byNotice).toEqual([
      { bucket: 'after_start', n: 1 },
      { bucket: 'lt2h', n: 5 },
      { bucket: '2_6h', n: 0 },
      { bucket: '6_24h', n: 0 },
      { bucket: '1_3d', n: 3 },
      { bucket: '3d_plus', n: 0 },
    ]);
  });

  it('folds an unknown actor into unknown', () => {
    const e = parseCourtsEndings(endingsJson);
    expect(e.cancellations.byActor).toEqual([
      { actor: 'guest', n: 8 },
      { actor: 'staff', n: 3 },
      { actor: 'unknown', n: 1 },
    ]);
  });

  it.each(GARBAGE)('never throws on garbage input (%j)', (input) => {
    const e = parseCourtsEndings(input);
    for (const g of [e.cancellations, e.noShows]) {
      expect(g.total).toBe(0);
      expect(g.revenueIqd).toBe(0);
      expect(g.lateRevenueIqd).toBe(0);
      expect(g.medianNoticeMin).toBeNull();
      expect(g.byHour).toEqual([]);
      expect(g.byCourt).toEqual([]);
      expect(g.byActor).toEqual([]);
      expect(g.byPlayers).toEqual([]);
      expect(g.byNotice).toEqual(NOTICE_BUCKETS.map((bucket) => ({ bucket, n: 0 })));
    }
  });
});

describe('parseCourtsGuests', () => {
  it('maps the fixture to an exact camelCase object', () => {
    expect(parseCourtsGuests(guestsJson)).toEqual({
      lookbackDays: 180,
      regularWindowDays: 90,
      lapseDays: 28,
      identifiedBookings: 40,
      unidentifiedBookings: 8,
      identities: 22,
      returningBookings: 26,
      newBookings: 14,
      returningPct: 65,
      visitBuckets: [
        { bucket: '1', identities: 10, bookings: 10 },
        { bucket: '2_3', identities: 8, bookings: 12 },
        { bucket: '4_6', identities: 4, bookings: 18 },
        { bucket: '7_plus', identities: 0, bookings: 0 },
      ],
      regulars: 6,
      lapsingRegulars: 1,
      regularsBookingsPct: 45,
      regularsFixedSlotPct: null,
      byWeek: [
        { weekStart: '2026-08-31', newIdentities: 5, returningIdentities: 12, bookings: 30 },
        { weekStart: '2026-09-07', newIdentities: 2, returningIdentities: 6, bookings: 18 },
      ],
    });
  });

  it('returns the visit buckets in fixed order', () => {
    expect(parseCourtsGuests(guestsJson).visitBuckets.map((b) => b.bucket)).toEqual([...VISIT_BUCKETS]);
  });

  it.each(GARBAGE)('never throws on garbage input (%j) and falls back to the documented windows', (input) => {
    const g = parseCourtsGuests(input);
    expect(g.lookbackDays).toBe(180);
    expect(g.regularWindowDays).toBe(90);
    expect(g.lapseDays).toBe(28);
    expect(g.identities).toBe(0);
    expect(g.returningPct).toBeNull();
    expect(g.regularsBookingsPct).toBeNull();
    expect(g.regularsFixedSlotPct).toBeNull();
    expect(g.visitBuckets).toEqual(VISIT_BUCKETS.map((bucket) => ({ bucket, identities: 0, bookings: 0 })));
    expect(g.byWeek).toEqual([]);
  });
});

describe('parseCourtsCafe', () => {
  it('maps the fixture to exact camelCase objects', () => {
    const c = parseCourtsCafe(cafeJson);
    expect(c.attach).toEqual({
      liveBookings: 48,
      linkedBookings: 15,
      attachPct: 31.3,
      settledLinked: 14,
      cafeIqd: 420000,
      cafePerLinkedIqd: 28000,
      cafePerBookingIqd: 8750,
      courtIqd: 1200000,
      bookedMinutes: 3600,
      openMinutes: 11760,
      combinedPerBookedHourIqd: 27000,
      combinedPerOpenHourIqd: 8265,
    });
    expect(c.perCourt).toEqual([
      {
        courtId: COURT_A,
        nameEn: 'Court A',
        nameAr: 'ملعب أ',
        liveBookings: 18,
        linkedBookings: 9,
        attachPct: 50,
        settledLinked: 9,
        cafeIqd: 270000,
        cafePerLinkedIqd: 30000,
        cafePerBookingIqd: 15000,
        courtIqd: 450000,
        bookedMinutes: 1350,
        openMinutes: 5880,
        combinedPerBookedHourIqd: 32000,
        combinedPerOpenHourIqd: 7347,
      },
      {
        courtId: COURT_B,
        nameEn: 'Court B',
        nameAr: 'ملعب ب',
        liveBookings: 30,
        linkedBookings: 6,
        attachPct: 20,
        settledLinked: 5,
        cafeIqd: 150000,
        cafePerLinkedIqd: 25000,
        cafePerBookingIqd: 5000,
        courtIqd: 750000,
        bookedMinutes: 2250,
        openMinutes: 5880,
        combinedPerBookedHourIqd: 24000,
        combinedPerOpenHourIqd: 9184,
      },
    ]);
    expect(c.topItems).toEqual([
      { courtId: COURT_A, itemId: ITEM_LATTE, nameEn: 'Latte', nameAr: 'لاتيه', qty: 14, revenueIqd: 70000, linkedOrdersWithItem: 6 },
      { courtId: COURT_B, itemId: ITEM_WATER, nameEn: 'Water', nameAr: 'ماء', qty: 9, revenueIqd: 9000, linkedOrdersWithItem: 4 },
    ]);
    expect(c.items).toEqual([
      { itemId: ITEM_LATTE, nameEn: 'Latte', nameAr: 'لاتيه', linkedOrdersWithItem: 6, allOrdersWithItem: 20 },
      { itemId: ITEM_WATER, nameEn: 'Water', nameAr: 'ماء', linkedOrdersWithItem: 4, allOrdersWithItem: 60 },
    ]);
    expect(c.linkedOrdersTotal).toBe(15);
    expect(c.allOrdersTotal).toBe(100);
    expect(c.orderTiming.medianOffsetMin).toBe(12);
    expect(c.attachCells).toEqual([
      { dow: 5, hour: 20, liveBookings: 2, linkedBookings: 1 },
      { dow: 1, hour: 18, liveBookings: 1, linkedBookings: 0 },
    ]);
    // Sorted: known group sizes ascending, unknown last; durations ascending.
    expect(c.byPlayers).toEqual([
      { players: 4, bookings: 12, linked: 6, cafeIqd: 180000 },
      { players: null, bookings: 28, linked: 6, cafeIqd: 150000 },
    ]);
    expect(c.byDuration).toEqual([
      { durationMin: 60, bookings: 28, linked: 7, cafeIqd: 180000 },
      { durationMin: 90, bookings: 20, linked: 8, cafeIqd: 240000 },
    ]);
  });

  it('returns the timing buckets in fixed order with zeros for the missing ones', () => {
    const c = parseCourtsCafe(cafeJson);
    expect(c.orderTiming.buckets.map((b) => b.bucket)).toEqual([...TIMING_BUCKETS]);
    expect(c.orderTiming.buckets).toEqual([
      { bucket: 'before_30plus', orders: 0, revenueIqd: 0 },
      { bucket: 'before_0_30', orders: 3, revenueIqd: 60000 },
      { bucket: 'first_half', orders: 8, revenueIqd: 200000 },
      { bucket: 'second_half', orders: 0, revenueIqd: 0 },
      { bucket: 'after_0_30', orders: 2, revenueIqd: 40000 },
      { bucket: 'after_30plus', orders: 0, revenueIqd: 0 },
    ]);
  });

  it('keeps a null attach rate null when nothing was linked', () => {
    const c = parseCourtsCafe({ attach: { live_bookings: 0, linked_bookings: 0, attach_pct: null, cafe_per_linked_iqd: null } });
    expect(c.attach.attachPct).toBeNull();
    expect(c.attach.cafePerLinkedIqd).toBeNull();
    expect(c.attach.cafePerBookingIqd).toBeNull();
    expect(c.attach.liveBookings).toBe(0);
  });

  it.each(GARBAGE)('never throws on garbage input (%j)', (input) => {
    const c = parseCourtsCafe(input);
    expect(c.attach.liveBookings).toBe(0);
    expect(c.attach.attachPct).toBeNull();
    expect(c.perCourt).toEqual([]);
    expect(c.topItems).toEqual([]);
    expect(c.items).toEqual([]);
    expect(c.linkedOrdersTotal).toBe(0);
    expect(c.allOrdersTotal).toBe(0);
    expect(c.orderTiming.medianOffsetMin).toBeNull();
    expect(c.orderTiming.buckets).toEqual(TIMING_BUCKETS.map((bucket) => ({ bucket, orders: 0, revenueIqd: 0 })));
    expect(c.attachCells).toEqual([]);
    expect(c.byPlayers).toEqual([]);
    expect(c.byDuration).toEqual([]);
  });
});
