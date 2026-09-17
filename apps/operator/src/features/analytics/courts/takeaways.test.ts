import { describe, expect, it } from 'vitest';
import { makeT } from '@touch/i18n';
import { makeFormatters } from '../format';
import { courtPatternsCopy } from './copy';
import { deriveCourts, smallCourtSample, type RawCourts } from './derive';
import { parseCourtsCafe, parseCourtsDemand, parseCourtsEndings, parseCourtsGuests, parseCourtsSummary } from './shape';
import { COMPARE_RANGE, RANGE, cafeJson, cafeNoLinksJson, cafePrevJson, demandJson, endingsJson, guestsJson, summaryJson, summaryPrevJson } from './fixtures';
import { cafeTakeaway, courtsTakeaway, guestsTakeaway, lossesTakeaway, shapeTakeaway, whenTakeaway } from './takeaways';
import { topRows } from './courtRows';

// Each section's answer is a sentence built from the payload the section plots,
// in counts, and absent when there is nothing to say.

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

/** The fixture summary with every heat cell open on `days` days. */
function openedOn(days: number): RawCourts {
  const r = raw();
  return { ...r, summary: { ...r.summary, heatmap: r.summary.heatmap.map((c) => ({ ...c, openDays: c.openMinutes > 0 ? days : 0 })) } };
}

describe('court section sentences', () => {
  it('names the fullest hour only when that hour was open on more than one day', () => {
    const once = raw();
    expect(whenTakeaway(once, deriveCourts(once, copy), tr, f)).toBe('Busiest weekday: Friday (38%); quietest: Monday (19%).');
    const often = openedOn(4);
    expect(whenTakeaway(often, deriveCourts(often, copy), tr, f)).toBe(
      'Fullest hour: Friday 20:00, 50% booked across the 4 days it was open. Busiest weekday: Friday (38%); quietest: Monday (19%).',
    );
  });

  it('warns that one booking moves the shares when the period has fewer than twenty', () => {
    const r = raw();
    const thin = { ...r, summary: { ...r.summary, kpis: { ...r.summary.kpis, bookings: 7 } } };
    expect(whenTakeaway(thin, deriveCourts(r, copy), tr, f)).toMatch(/Bookings in this period: only 7,/);
  });

  it('says nothing about when courts fill without bookings or without opening hours', () => {
    const r = raw();
    const d = deriveCourts(r, copy);
    expect(whenTakeaway({ ...r, summary: { ...r.summary, kpis: { ...r.summary.kpis, bookings: 0 } } }, d, tr, f)).toBeNull();
    expect(whenTakeaway(r, { ...d, noOpeningHours: true }, tr, f)).toBeNull();
  });

  it('compares the courts by occupancy, or by bookings when there are no opening hours', () => {
    const r = raw();
    const d = deriveCourts(r, copy);
    expect(courtsTakeaway(r, d, tr, f, 'en')).toBe('Court B was the fullest court at 38%; Court A the emptiest at 23%.');
    expect(courtsTakeaway(r, { ...d, noOpeningHours: true }, tr, f, 'en')).toMatch(/took the most bookings/);
    // One court (the filter) has nothing to compare.
    expect(courtsTakeaway({ ...r, summary: { ...r.summary, perCourt: r.summary.perCourt.slice(0, 1) } }, d, tr, f, 'en')).toBeNull();
  });

  it('counts the losses out of everything booked and says what became of the late cancellations', () => {
    expect(lossesTakeaway(raw(), tr, f)).toBe(
      '12 cancelled and 4 did not show, out of 64 bookings. 6 were cancelled with less than 4 h notice: 4 of those slots were booked again and 2 stayed empty.',
    );
  });

  it('prints shares as counts, never as a percentage a small sample cannot carry', () => {
    expect(shapeTakeaway(raw(), tr, f)).toBe('Most common length: 60 min, 28 of 48 bookings. Half are booked less than 6 h before they start. Booked in the app: 30 of 48.');
    expect(guestsTakeaway(raw(), tr, f)).toBe('Bookings by returning guests: 26 of the 40 with a known guest. Regulars: 6; gone quiet (no booking in four weeks): 1.');
    expect(cafeTakeaway(raw(), tr, f)).toBe('Bookings that bought from the cafe: 15 of 48. Each of those spent 28,000 IQD at the cafe on average.');
  });

  it('says once that no booking has a linked tab', () => {
    expect(cafeTakeaway(raw({ cafe: parseCourtsCafe(cafeNoLinksJson) }), tr, f)).toBe('None of the 48 bookings has a cafe tab linked to it yet.');
  });
});

describe('topRows', () => {
  it('keeps every row up to the limit, then the highest, with the selected court kept in view', () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ label: `C${i}`, value: i, highlight: i === 0 }));
    expect(topRows(rows.slice(0, 5))).toHaveLength(5);
    const top = topRows(rows);
    expect(top).toHaveLength(12);
    expect(top[0]!.label).toBe('C14');
    expect(top.at(-1)!.label).toBe('C0');
  });
});

describe('smallCourtSample', () => {
  it('holds back percentage changes only when BOTH windows have fewer than twenty bookings', () => {
    const r = raw();
    const withBookings = (n: number, prev: number): RawCourts => ({
      ...r,
      summary: { ...r.summary, kpis: { ...r.summary.kpis, bookings: n } },
      summaryPrev: { ...r.summaryPrev!, kpis: { ...r.summaryPrev!.kpis, bookings: prev } },
    });
    expect(smallCourtSample(withBookings(1, 5))).toBe(true);
    expect(smallCourtSample(withBookings(1, 40))).toBe(false);
    expect(smallCourtSample(withBookings(48, 5))).toBe(false);
    expect(smallCourtSample({ ...r, summaryPrev: null })).toBe(false);
  });
});
