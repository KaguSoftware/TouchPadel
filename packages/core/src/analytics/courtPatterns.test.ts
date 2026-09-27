import { describe, expect, it } from 'vitest';
import {
  COURT_SAMPLE_TIERS,
  type CourtPatternsInput,
  DEFAULT_COURT_PATTERNS_COPY_EN,
  type HeatCellRow,
  MAX_COURT_PATTERN_LEVEL,
  mineCourtPatterns,
} from './courtPatterns';
import { buildCourtsBasis } from './courtsBasis';

const courtNames = new Map([
  ['c1', { nameEn: 'Court 1', nameAr: 'ملعب 1' }],
  ['c2', { nameEn: 'Court 2', nameAr: 'ملعب 2' }],
]);
const itemNames = new Map([
  ['w', { nameEn: 'Water', nameAr: 'ماء' }],
  ['e', { nameEn: 'Energy drink', nameAr: 'مشروب طاقة' }],
]);

const basis = buildCourtsBasis({
  range: { from: '2026-09-01', to: '2026-09-30' },
  bookingDates: Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`),
  bookings: 300,
  bookedTotal: 340,
  identities: 60,
  linkedBookings: 120,
});

/** A cell open 60 min on `openDays` days at `occupancy` (0..1); 2 courts -> 120 open minutes per day. */
function cell(dow: number, hour: number, occupancy: number, openDays = 4, extra: Partial<HeatCellRow> = {}): HeatCellRow {
  const openMinutes = 120 * openDays;
  return {
    dow,
    hour,
    openMinutes,
    openDays,
    bookedMinutes: Math.round(openMinutes * occupancy),
    bookings: Math.round((openMinutes * occupancy) / 60),
    revenueIqd: 0,
    cancellations: 0,
    noShows: 0,
    ...extra,
  };
}

/** Every weekday, hours 18..21, at a flat occupancy. */
function flatWeek(occupancy: number, openDays = 4): HeatCellRow[] {
  const out: HeatCellRow[] = [];
  for (let dow = 0; dow < 7; dow++) for (let hour = 18; hour <= 21; hour++) out.push(cell(dow, hour, occupancy, openDays));
  return out;
}

const empty: CourtPatternsInput = {
  heatmap: [],
  courtsCount: 2,
  perCourt: [],
  endings: { cancellations: {}, noShows: {}, cancellationsTotal: 0, noShowsTotal: 0, bookedTotal: 0 },
  basis,
  courtNames,
  itemNames,
};

describe('dead-slot', () => {
  it('merges adjacent dead hours on one weekday into a run, relative to the venue hour average', () => {
    // Venue runs 60% at 18..21 everywhere except Monday 19:00 and 20:00, which are near-empty.
    const heatmap = flatWeek(0.6).map((c) => (c.dow === 1 && (c.hour === 19 || c.hour === 20) ? cell(1, c.hour, 0.1) : c));
    const out = mineCourtPatterns({ ...empty, heatmap }, 0);
    expect(out.map((c) => c.kind)).toEqual(['dead-slot']);
    expect(out[0]).toMatchObject({
      id: 'dead-slot:h:19-21|wd:1',
      subjects: ['Monday', '19:00-21:00'],
      subjectIds: [],
      confidence: 'medium',
      sampleSize: 4,
      sampleLabel: '4 open days',
    });
    expect(out[0]!.metrics).toMatchObject({ weekday: 1, hourFrom: 19, hourTo: 21, hours: 2, occupancyPct: 10, openDays: 4 });
    // Venue average at those hours: 6 weekdays at 60% + Monday at 10%, minutes-weighted.
    expect(out[0]!.metrics.houseHourPct).toBeCloseTo(52.9, 1);
    expect(out[0]!.fallbackText).toMatch(/^Monday 19:00-21:00 runs at 10% occupancy while the venue averages 52.9%/);
  });

  it('does not call a quiet hour dead when the whole venue is quiet then (absolute rule needs 6 open days)', () => {
    const heatmap = flatWeek(0.12, 4);
    expect(mineCourtPatterns({ ...empty, heatmap }, 0)).toEqual([]);
    // Same occupancy over 6 open days: the absolute rule fires (and every cell is one run per weekday).
    const long = mineCourtPatterns({ ...empty, heatmap: flatWeek(0.08, 6) }, 0);
    expect(long).toHaveLength(7);
    expect(long.every((c) => c.kind === 'dead-slot' && c.metrics.hours === 4)).toBe(true);
  });
});

describe('saturated-slot', () => {
  it('flags a full run and boosts it when app holds expired there', () => {
    const heatmap = flatWeek(0.5).map((c) =>
      c.dow === 5 && c.hour >= 20 ? cell(5, c.hour, 0.95, 8, { holdsExpired: c.hour === 20 ? 2 : 1 }) : c,
    );
    const out = mineCourtPatterns({ ...empty, heatmap }, 0);
    expect(out.map((c) => c.kind)).toEqual(['saturated-slot']);
    expect(out[0]).toMatchObject({
      id: 'saturated-slot:h:20-22|wd:5',
      subjects: ['Friday', '20:00-22:00'],
      confidence: 'high',
      sampleSize: 8,
      strength: 1,
    });
    expect(out[0]!.metrics).toMatchObject({ occupancyPct: 95, holdsExpired: 3, hours: 2, revenueIqd: 0 });
    expect(out[0]!.fallbackText).toContain('3 app holds expired');

    const calm = mineCourtPatterns({ ...empty, heatmap: heatmap.map((c) => ({ ...c, holdsExpired: 0 })) }, 0);
    expect(calm[0]!.strength).toBeLessThan(1);
    expect(calm[0]!.fallbackText).not.toContain('holds expired');
  });
});

describe('shift', () => {
  it('reads share movement per weekday and per hour against the comparison heatmap', () => {
    // 40 bookings both sides. Now: Friday 20 of them; before: Friday 10 (Saturday picks up the rest).
    const mk = (fri: number, sat: number): HeatCellRow[] => [
      cell(5, 20, 0.5, 4, { bookings: fri }),
      cell(6, 20, 0.5, 4, { bookings: sat }),
      cell(3, 18, 0.5, 4, { bookings: 10 }),
    ];
    const out = mineCourtPatterns({ ...empty, heatmap: mk(20, 10), compareHeatmap: mk(10, 20) }, 0);
    expect(out.map((c) => c.id)).toEqual(['shift:wd:5', 'shift:wd:6']);
    expect(out[0]).toMatchObject({
      kind: 'shift',
      subjects: ['Friday'],
      subjectIds: [],
      confidence: 'medium',
      sampleSize: 40,
      sampleLabel: '40 / 40 bookings',
    });
    expect(out[0]!.metrics).toMatchObject({ dimension: 'weekday', key: 5, sharePct: 50, prevSharePct: 25, deltaPts: 25, direction: 'up' });
    expect(out[1]!.metrics).toMatchObject({ direction: 'down', deltaPts: -25 });
    expect(out[0]!.fallbackText).toMatch(/^Friday now carries 50% of bookings, up from 25%/);
    // The hour dimension did not move (every booking is at 18:00 or 20:00 on both sides in the same split).
    expect(out.some((c) => c.id.startsWith('shift:h:'))).toBe(false);
  });

  it('mines nothing without a comparison heatmap or with too few bookings on one side', () => {
    const heatmap = [cell(5, 20, 0.5, 4, { bookings: 40 })];
    expect(mineCourtPatterns({ ...empty, heatmap }, 0)).toEqual([]);
    expect(mineCourtPatterns({ ...empty, heatmap, compareHeatmap: [cell(6, 20, 0.5, 4, { bookings: 12 })] }, 0)).toEqual([]);
  });
});

describe('ending-cluster', () => {
  const endings: CourtPatternsInput['endings'] = {
    cancellations: {
      byHour: [{ key: '22', n: 10, bookingsTotal: 30 }],
      bySource: [{ key: 'mobile', n: 20, bookingsTotal: 200 }],
    },
    noShows: { byCourt: [{ key: 'c2', n: 8, bookingsTotal: 40 }] },
    cancellationsTotal: 30,
    noShowsTotal: 15,
    bookedTotal: 300,
  };

  it('flags segments whose rate is well above the base rate, per ending and dimension', () => {
    const out = mineCourtPatterns({ ...empty, endings }, 0);
    expect(out.map((c) => c.id)).toEqual(['ending-cluster:byCourt:c2|no-shows', 'ending-cluster:byHour:22|cancellations']);
    const late = out.find((c) => c.id.includes('byHour'))!;
    expect(late).toMatchObject({ kind: 'ending-cluster', subjects: ['22:00'], subjectIds: [], confidence: 'medium', sampleSize: 30 });
    expect(late.metrics).toMatchObject({ ending: 'cancellations', dimension: 'byHour', key: '22', n: 10, bookingsTotal: 30, segRatePct: 33.3, baseRatePct: 10, ratio: 3.3 });
    expect(late.fallbackText).toBe('22:00 cancels at 33.3% (10 of 30) against 10% overall. Cancellations cluster there.');
    const court = out.find((c) => c.id.includes('byCourt'))!;
    expect(court).toMatchObject({ subjects: ['Court 2'], subjectIds: ['c2'], confidence: 'medium' });
    expect(court.metrics).toMatchObject({ ending: 'no-shows', ratio: 4 });
    expect(court.fallbackText).toMatch(/^Court 2 no-shows at 20%/);
    // 'mobile' cancels at exactly the base rate: not a cluster.
    expect(out.some((c) => c.id.includes('bySource'))).toBe(false);
  });
});

describe('lapsing', () => {
  it('counts lapsing regulars without naming anyone', () => {
    const out = mineCourtPatterns({ ...empty, guests: { regulars: 20, lapsingRegulars: 6, identities: 60 } }, 0);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'lapsing:regulars',
      kind: 'lapsing',
      subjects: ['Regulars'],
      subjectIds: [],
      metrics: { regulars: 20, lapsingRegulars: 6, lapsingPct: 30 },
      confidence: 'high',
      sampleLabel: '20 regulars',
    });
    expect(out[0]!.fallbackText).toBe('6 of 20 regulars (30%) have not booked in the last 28 days. Worth a nudge before they are gone.');
    expect(mineCourtPatterns({ ...empty, guests: { regulars: 20, lapsingRegulars: 3, identities: 60 } }, 0)).toEqual([]);
  });
});

describe('attach-gap', () => {
  const cafe: NonNullable<CourtPatternsInput['cafe']> = {
    attachPct: 40,
    liveBookings: 100,
    linkedBookings: 40,
    perCourt: [
      { courtId: 'c1', liveBookings: 50, linkedBookings: 30 },
      { courtId: 'c2', liveBookings: 50, linkedBookings: 10 },
    ],
    attachCells: [
      { dow: 5, hour: 21, liveBookings: 12, linkedBookings: 1 },
      { dow: 2, hour: 18, liveBookings: 8, linkedBookings: 0 },
    ],
    items: [],
    linkedOrdersTotal: 0,
    allOrdersTotal: 0,
  };

  it('flags a low-attach court and slot, and the high-attach court, against the venue rate', () => {
    const out = mineCourtPatterns({ ...empty, cafe }, 0);
    expect(out.map((c) => c.id)).toEqual(['attach-gap:court:c2', 'attach-gap:court:c1', 'attach-gap:h:21|wd:5']);
    expect(out[0]).toMatchObject({ kind: 'attach-gap', subjects: ['Court 2'], subjectIds: ['c2'], confidence: 'high', sampleSize: 50 });
    expect(out[0]!.metrics).toMatchObject({ scope: 'court', direction: 'low', attachPct: 20, venueAttachPct: 40, ratio: 0.5, liveBookings: 50, linkedBookings: 10 });
    expect(out[0]!.fallbackText).toMatch(/^Court 2 attaches a cafe tab on 20% of bookings vs 40% venue-wide \(50 bookings\)/);
    expect(out[1]!.metrics).toMatchObject({ direction: 'high', ratio: 1.5 });
    expect(out[2]).toMatchObject({ subjects: ['Friday', '21:00'], subjectIds: [], confidence: 'medium', sampleSize: 12 });
    expect(out[2]!.metrics).toMatchObject({ scope: 'cell', direction: 'low', weekday: 5, hour: 21, attachPct: 8.3 });
    expect(out[2]!.fallbackText).toMatch(/^Friday 21:00 attaches/);
    // The Tuesday cell has 8 live bookings: under the floor at level 0.
  });

  it('mines nothing when the venue barely attaches at all', () => {
    expect(mineCourtPatterns({ ...empty, cafe: { ...cafe, linkedBookings: 10, attachPct: 10 } }, 0)).toEqual([]);
  });
});

describe('court-basket', () => {
  it('lifts an item over-represented in court-linked orders', () => {
    const cafe: NonNullable<CourtPatternsInput['cafe']> = {
      attachPct: null,
      liveBookings: 0,
      linkedBookings: 0,
      perCourt: [],
      attachCells: [],
      items: [
        { itemId: 'e', linkedOrdersWithItem: 12, allOrdersWithItem: 20 },
        { itemId: 'w', linkedOrdersWithItem: 20, allOrdersWithItem: 100 },
      ],
      linkedOrdersTotal: 40,
      allOrdersTotal: 200,
    };
    const out = mineCourtPatterns({ ...empty, cafe }, 0);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'court-basket:e',
      kind: 'court-basket',
      subjects: ['Energy drink'],
      subjectIds: ['e'],
      metrics: { lift: 3, linkedOrdersWithItem: 12, linkedOrdersTotal: 40, allOrdersWithItem: 20, allOrdersTotal: 200, linkedSharePct: 30, allSharePct: 10 },
      confidence: 'high',
      sampleLabel: '12 / 40 linked orders',
    });
    expect(out[0]!.fallbackText).toBe('Energy drink shows up in 12 of 40 court-linked orders, 3x its share of all orders. A court-side item to place near the booking flow.');
  });
});

describe('thin samples, ranking, widening, locale', () => {
  it('yields nothing or only low-tier candidates on a thin sample', () => {
    // Three open days: below the cell floor at level 0, so nothing; at level 2 the same slot reads low.
    const heatmap = flatWeek(0.6, 3).map((c) => (c.dow === 1 && c.hour === 19 ? cell(1, 19, 0.05, 3) : c));
    expect(mineCourtPatterns({ ...empty, heatmap }, 0)).toEqual([]);
    const loose = mineCourtPatterns({ ...empty, heatmap, guests: { regulars: 4, lapsingRegulars: 2, identities: 9 } }, 2);
    expect(loose.length).toBeGreaterThan(0);
    expect(loose.every((c) => c.confidence === 'low')).toBe(true);
  });

  it('finds at level 2 what level 0 does not, and clamps the level', () => {
    expect(MAX_COURT_PATTERN_LEVEL).toBe(3);
    // 6 of 18 = 33% vs 10% base: ratio 3.3 but n and total sit under the level-0 floors (MIN_ENDING_N 8, MIN_RATE_DENOM 20).
    const endings: CourtPatternsInput['endings'] = {
      cancellations: { byDow: [{ key: '0', n: 6, bookingsTotal: 18 }] },
      noShows: {},
      cancellationsTotal: 30,
      noShowsTotal: 0,
      bookedTotal: 300,
    };
    expect(mineCourtPatterns({ ...empty, endings }, 0)).toEqual([]);
    const wide = mineCourtPatterns({ ...empty, endings }, 2);
    expect(wide.map((c) => c.id)).toEqual(['ending-cluster:byDow:0|cancellations']);
    expect(wide[0]).toMatchObject({ subjects: ['Sunday'], confidence: 'low' });
    expect(mineCourtPatterns({ ...empty, endings }, 99 as 2).map((c) => c.id)).toEqual(wide.map((c) => c.id));
  });

  it('ranks by tier first, then score, then id, and dedupes ids', () => {
    // A high-tier lapsing count, a medium dead slot, and a low-tier basket.
    const heatmap = flatWeek(0.6).map((c) => (c.dow === 1 && c.hour === 19 ? cell(1, 19, 0.1) : c));
    const out = mineCourtPatterns(
      {
        ...empty,
        heatmap,
        guests: { regulars: 20, lapsingRegulars: 6, identities: 60 },
        cafe: {
          attachPct: null,
          liveBookings: 0,
          linkedBookings: 0,
          perCourt: [],
          attachCells: [],
          items: [{ itemId: 'e', linkedOrdersWithItem: 4, allOrdersWithItem: 5 }],
          linkedOrdersTotal: 10,
          allOrdersTotal: 100,
        },
      },
      1,
    );
    expect(out.map((c) => [c.kind, c.confidence])).toEqual([
      ['lapsing', 'high'],
      ['dead-slot', 'medium'],
      ['court-basket', 'low'],
    ]);
    expect(new Set(out.map((c) => c.id)).size).toBe(out.length);
    expect(COURT_SAMPLE_TIERS.basketSupport).toEqual([5, 12]);
  });

  it('renders subjects and fallback text in Arabic with an ar copy', () => {
    const cafe: NonNullable<CourtPatternsInput['cafe']> = {
      attachPct: null,
      liveBookings: 0,
      linkedBookings: 0,
      perCourt: [],
      attachCells: [],
      items: [{ itemId: 'e', linkedOrdersWithItem: 12, allOrdersWithItem: 20 }],
      linkedOrdersTotal: 40,
      allOrdersTotal: 200,
    };
    const out = mineCourtPatterns({ ...empty, cafe }, 0, { ...DEFAULT_COURT_PATTERNS_COPY_EN, locale: 'ar' });
    expect(out[0]!.subjects).toEqual(['مشروب طاقة']);
    expect(out[0]!.fallbackText).toContain('مشروب طاقة');
    // Unknown ids fall back to the id itself.
    const unknown = mineCourtPatterns({ ...empty, cafe: { ...cafe, items: [{ itemId: 'zz', linkedOrdersWithItem: 12, allOrdersWithItem: 20 }] } }, 0);
    expect(unknown[0]!.subjects).toEqual(['zz']);
  });
});
