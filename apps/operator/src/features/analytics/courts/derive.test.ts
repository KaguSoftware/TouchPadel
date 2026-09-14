import { describe, expect, it, vi } from 'vitest';
import { RELIABLE_COVERAGE, pctDelta } from '@touch/core';
import { makeT } from '@touch/i18n';
import { makeFormatters } from '../format';
import { courtPatternsCopy } from './copy';
import { deriveCourts, singleBookings, type RawCourts } from './derive';
import { parseCourtsCafe, parseCourtsDemand, parseCourtsEndings, parseCourtsGuests, parseCourtsSummary } from './shape';
import { COMPARE_RANGE, COURT_A, RANGE, cafeJson, cafePrevJson, demandJson, endingsJson, guestsJson, summaryJson, summaryPrevJson, summaryPrevSparseJson } from './fixtures';

// The derivation only compares and arranges what the server returned: the
// deltas (with the cafe tab's reliability gate), the occupancy cells, the
// hour and weekday roll-ups, the thin-sample basis and the mined patterns.

const tr = makeT('en');
const f = makeFormatters('en');
const copy = courtPatternsCopy(tr, f, 'en', new Map());

function raw(over: Partial<RawCourts> = {}): RawCourts {
  return {
    range: RANGE,
    compareRange: COMPARE_RANGE,
    compareBasis: 'prev',
    todayISO: '2026-09-14',
    courtId: null,
    summary: parseCourtsSummary(summaryJson),
    demand: parseCourtsDemand(demandJson),
    endings: parseCourtsEndings(endingsJson),
    guests: parseCourtsGuests(guestsJson),
    cafe: parseCourtsCafe(cafeJson),
    summaryPrev: parseCourtsSummary(summaryPrevJson),
    demandPrev: parseCourtsDemand(demandJson),
    endingsPrev: parseCourtsEndings(endingsJson),
    cafePrev: parseCourtsCafe(cafePrevJson),
    ...over,
  };
}

describe('deriveCourts: comparison', () => {
  it('is reliable when both windows are covered and reports pct deltas for counts and money, whole-point deltas for rates', () => {
    const d = deriveCourts(raw(), copy);
    expect(d.coverage.ratio).toBe(1);
    expect(d.coveragePrev.ratio).toBe(1);
    expect(d.compareReliable).toBe(true);

    // Counts and money: signed percentage change via pctDelta.
    expect(d.deltas.bookings).toEqual({ delta: pctDelta(48, 40), current: 48, previous: 40 });
    expect(d.deltas.bookings.delta).toBe(20);
    expect(d.deltas.bookedHours).toEqual({ delta: pctDelta(60, 50), current: 60, previous: 50 });
    expect(d.deltas.revenue).toEqual({ delta: pctDelta(1200000, 1000000), current: 1200000, previous: 1000000 });
    expect(d.deltas.revPerOpenHour).toEqual({ delta: pctDelta(6122, 5102), current: 6122, previous: 5102 });

    // Rates: signed whole POINTS, never a percentage of a percentage.
    expect(d.deltas.occupancy).toEqual({ delta: 5, current: 30.6, previous: 25.5 });
    expect(d.deltas.cancellationRate).toEqual({ delta: -1, current: 18.8, previous: 20 });
    expect(d.deltas.noShowRate).toEqual({ delta: 1, current: 6.3, previous: 5 });
    expect(d.deltas.attachRate).toEqual({ delta: 6, current: 31.3, previous: 25 });
  });

  it('rounds a rate delta to whole points so the tile and its tone agree', () => {
    // 25.8 against 25.5 is a 0.3-point move: the tile prints "0%", so the delta must be 0, not a positive sliver painted green.
    const cur = parseCourtsSummary({ ...summaryJson, kpis: { ...(summaryJson.kpis as object), occupancy_pct: 25.8 } });
    const d = deriveCourts(raw({ summary: cur }), copy);
    expect(d.deltas.occupancy.delta).toBe(0);
    expect(Number.isInteger(d.deltas.cancellationRate.delta)).toBe(true);
  });

  it('mutes every delta when the compare window has too many empty days, keeping both figures', () => {
    const d = deriveCourts(raw({ summaryPrev: parseCourtsSummary(summaryPrevSparseJson) }), copy);
    expect(d.coveragePrev.daysWithData).toBe(3);
    expect(d.coveragePrev.ratio).toBeLessThan(RELIABLE_COVERAGE);
    expect(d.compareReliable).toBe(false);
    for (const key of Object.keys(d.deltas) as (keyof typeof d.deltas)[]) expect(d.deltas[key].delta).toBeNull();
    // The figures behind the muted delta still travel so the tile can show "48 vs 40".
    expect(d.deltas.bookings).toEqual({ delta: null, current: 48, previous: 40 });
    expect(d.deltas.occupancy).toEqual({ delta: null, current: 30.6, previous: 25.5 });
  });

  it('mutes the comparison when the current window itself is gappy', () => {
    const gappy = parseCourtsSummary({ ...summaryJson, by_day: (summaryJson.by_day as unknown[]).slice(0, 2) });
    const d = deriveCourts(raw({ summary: gappy }), copy);
    expect(d.coverage.daysWithData).toBe(2);
    expect(d.compareReliable).toBe(false);
    expect(d.deltas.revenue.delta).toBeNull();
  });

  it('has no baseline at all without a compare payload', () => {
    const d = deriveCourts(raw({ summaryPrev: null, cafePrev: null }), copy);
    expect(d.compareReliable).toBe(false);
    expect(d.deltas.bookings).toEqual({ delta: null, current: 48, previous: null });
    expect(d.deltas.attachRate).toEqual({ delta: null, current: 31.3, previous: null });
  });

  it('keeps a null rate null through the delta, never 0', () => {
    const cur = parseCourtsSummary({ ...summaryJson, kpis: { ...(summaryJson.kpis as object), occupancy_pct: null, rev_per_open_hour_iqd: null } });
    const d = deriveCourts(raw({ summary: cur }), copy);
    expect(d.deltas.occupancy).toEqual({ delta: null, current: null, previous: 25.5 });
    // Money with no current figure compares from 0 (a count), with the previous kept.
    expect(d.deltas.revPerOpenHour).toEqual({ delta: pctDelta(0, 5102), current: 0, previous: 5102 });
  });
});

describe('deriveCourts: opening hours and cells', () => {
  it('flags noOpeningHours only when the venue has no open minutes', () => {
    expect(deriveCourts(raw(), copy).noOpeningHours).toBe(false);
    const none = parseCourtsSummary({ ...summaryJson, open_minutes: 0 });
    expect(deriveCourts(raw({ summary: none }), copy).noOpeningHours).toBe(true);
  });

  it('computes occupancy per cell over every court and leaves a closed cell null', () => {
    // A cell's open minutes are ONE court's; the fixture venue has two courts.
    const d = deriveCourts(raw(), copy);
    expect(d.cells).toEqual([
      { dow: 1, hour: 18, occupancyPct: 12.5, bookings: 1, bookedMinutes: 30, openMinutes: 120, openDays: 1, revenueIqd: 10000 },
      { dow: 1, hour: 19, occupancyPct: 25, bookings: 1, bookedMinutes: 60, openMinutes: 120, openDays: 1, revenueIqd: 20000 },
      { dow: 2, hour: 3, occupancyPct: null, bookings: 0, bookedMinutes: 0, openMinutes: 0, openDays: 0, revenueIqd: 0 },
      { dow: 5, hour: 18, occupancyPct: 25, bookings: 1, bookedMinutes: 60, openMinutes: 120, openDays: 1, revenueIqd: 20000 },
      { dow: 5, hour: 20, occupancyPct: 50, bookings: 2, bookedMinutes: 120, openMinutes: 120, openDays: 1, revenueIqd: 40000 },
    ]);
  });

  it('uses a single court as the denominator when the court filter is on', () => {
    const d = deriveCourts(raw({ courtId: 'court-a' }), copy);
    expect(d.cells[0]?.occupancyPct).toBe(25);
    expect(d.cells[4]?.occupancyPct).toBe(100);
  });

  it('rounds cell occupancy to one decimal', () => {
    const s = parseCourtsSummary({ ...summaryJson, heatmap: [{ dow: 0, hour: 9, open_minutes: 180, open_days: 3, booked_minutes: 100, bookings: 2 }] });
    expect(deriveCourts(raw({ summary: s }), copy).cells[0]?.occupancyPct).toBe(27.8);
  });

  it('rolls the cells up by hour and by weekday, summing minutes and bookings', () => {
    const d = deriveCourts(raw(), copy);
    expect(d.byHour).toHaveLength(24);
    expect(d.byHour.map((h) => h.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    // 18:00 holds the first half of the split booking on Monday plus Friday's hour.
    // openMinutes here is venue-wide: each cell's minutes times the two courts.
    expect(d.byHour[18]).toEqual({ hour: 18, bookings: 2, bookedMinutes: 90, openMinutes: 480, occupancyPct: 18.8 });
    expect(d.byHour[19]).toEqual({ hour: 19, bookings: 1, bookedMinutes: 60, openMinutes: 240, occupancyPct: 25 });
    expect(d.byHour[20]).toEqual({ hour: 20, bookings: 2, bookedMinutes: 120, openMinutes: 240, occupancyPct: 50 });
    // The closed 03:00 cell and every hour without a cell have no denominator.
    expect(d.byHour[3]).toEqual({ hour: 3, bookings: 0, bookedMinutes: 0, openMinutes: 0, occupancyPct: null });
    expect(d.byHour[12]?.occupancyPct).toBeNull();

    expect(d.byDow).toHaveLength(7);
    expect(d.byDow[1]).toEqual({ dow: 1, bookings: 2, bookedMinutes: 90, openMinutes: 480, occupancyPct: 18.8 });
    expect(d.byDow[5]).toEqual({ dow: 5, bookings: 3, bookedMinutes: 180, openMinutes: 480, occupancyPct: 37.5 });
    expect(d.byDow[2]).toEqual({ dow: 2, bookings: 0, bookedMinutes: 0, openMinutes: 0, occupancyPct: null });
    expect(d.byDow[0]?.bookings).toBe(0);
  });

  it('ignores a cell outside the hour or weekday grid instead of throwing', () => {
    const s = parseCourtsSummary({ ...summaryJson, heatmap: [{ dow: 9, hour: 24, open_minutes: 60, booked_minutes: 60, bookings: 1 }] });
    const d = deriveCourts(raw({ summary: s }), copy);
    expect(d.byHour.every((h) => h.bookings === 0)).toBe(true);
    expect(d.byDow.every((w) => w.bookings === 0)).toBe(true);
    // The cell itself is still listed for the heatmap to decide what to do with it.
    expect(d.cells).toHaveLength(1);
  });
});

describe('deriveCourts: basis, names and patterns', () => {
  it('builds the thin-sample basis from the days with bookings', () => {
    const d = deriveCourts(raw(), copy);
    expect(d.basis.rangeDays).toBe(7);
    expect(d.basis.bookingDays).toBe(7);
    expect(d.basis.bookings).toBe(48);
    expect(d.basis.bookedTotal).toBe(64);
    expect(d.basis.identities).toBe(22);
    expect(d.basis.linkedBookings).toBe(15);
    // Seven days is under the ten-day floor: the tab reads rates as counts.
    expect(d.thin).toBe(true);
    expect(d.thinWeekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('treats a missing guests payload as zero identities', () => {
    const d = deriveCourts(raw({ guests: null }), copy);
    expect(d.basis.identities).toBe(0);
    expect(d.patterns.some((p) => p.kind === 'lapsing')).toBe(false);
  });

  it('collects court and item names for the cards', () => {
    const d = deriveCourts(raw(), copy);
    expect(d.courtNames.get(COURT_A)).toEqual({ nameEn: 'Court A', nameAr: 'ملعب أ' });
    expect(d.courtNames.size).toBe(2);
    expect(d.itemNames.size).toBe(2);
    expect(d.itemNames.get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toEqual({ nameEn: 'Latte', nameAr: 'لاتيه' });
  });

  it('returns an array of patterns whose court subjects read as court names', () => {
    const d = deriveCourts(raw(), copy);
    expect(Array.isArray(d.patterns)).toBe(true);
    // Court A cancels 9 of 29 against 12 of 64 overall: 1.66x the base rate, over the 25-slot floor.
    const cluster = d.patterns.find((p) => p.kind === 'ending-cluster');
    expect(cluster).toBeDefined();
    expect(cluster?.subjectIds).toEqual([COURT_A]);
    expect(cluster?.subjects).toEqual(['Court A']);
    expect(cluster?.fallbackText).toContain('Court A');
    expect(cluster?.fallbackText).not.toContain(COURT_A);
    expect(cluster?.fallbackText).toContain('9 of 29');
    expect(cluster?.sampleLabel).toBe('29 bookings');
    expect(cluster?.confidence).toBe('medium');
  });

  it('hands the miner a copy whose byCourt segment resolves ids to names and delegates the rest', () => {
    const segment = vi.fn(copy.segment);
    const d = deriveCourts(raw(), { ...copy, segment });
    // The court cluster is worded from the name map, never from the raw id.
    expect(d.patterns.filter((p) => p.kind === 'ending-cluster').every((p) => !p.fallbackText.includes(COURT_A))).toBe(true);
    // Any dimension the wrapper did not intercept still reaches the caller's copy unchanged.
    for (const call of segment.mock.calls) expect(call[0]).not.toBe('byCourt');
  });

  it('mines nothing from an empty venue and never throws', () => {
    const empty = raw({
      summary: parseCourtsSummary({}),
      demand: parseCourtsDemand({}),
      endings: parseCourtsEndings({}),
      guests: parseCourtsGuests({}),
      cafe: parseCourtsCafe({}),
      summaryPrev: null,
      demandPrev: null,
      endingsPrev: null,
      cafePrev: null,
    });
    const d = deriveCourts(empty, copy);
    expect(d.patterns).toEqual([]);
    expect(d.noOpeningHours).toBe(true);
    expect(d.cells).toEqual([]);
    expect(d.basis.bookingDays).toBe(0);
    expect(d.coverage.ratio).toBe(0);
    expect(d.compareReliable).toBe(false);
  });
});

describe('singleBookings', () => {
  it('reads the non-series count from the demand payload', () => {
    expect(singleBookings(parseCourtsDemand(demandJson))).toBe(40);
    expect(singleBookings(parseCourtsDemand({}))).toBe(0);
  });
});
