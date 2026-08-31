import { describe, expect, it } from 'vitest';
import { iqd } from '@touch/core';
import type { CourtSlots, Slot } from '@touch/core';
import {
  mergeAcrossCourts,
  openNowInfo,
  assembleDayGrid,
  groupByStart,
  listBookableDates,
  type AvailabilityRow,
  type CourtRow,
  type RateRulePriceRow,
  type RateRuleRow,
} from '../assemble';

// ── mergeAcrossCourts (design 2026-08-31: one timeline, capacity per start) ──

const TZ = 'Asia/Baghdad'; // UTC+3, no DST

const court: CourtRow = {
  id: 'court-1',
  name_en: 'Court 1',
  name_ar: 'ملعب 1',
  description_en: null,
  description_ar: null,
  indoor: true,
  photo_path: null,
  duration_options: [60, 90],
  sort_order: 0,
};

// 2026-09-01 is a Tuesday (dow 2).
const DATE = '2026-09-01';
const settings = {
  timezone: TZ,
  opening_hours: { tue: [['09:00', '12:00']] },
  closed_dates: [] as string[],
};

const rules: RateRuleRow[] = [
  {
    id: 'rule-all',
    court_id: null,
    days_of_week: [0, 1, 2, 3, 4, 5, 6],
    start_time: '00:00:00',
    end_time: '23:59:00',
    priority: 0,
    valid_from: null,
    valid_to: null,
    is_active: true,
  },
];
const prices: RateRulePriceRow[] = [
  { rule_id: 'rule-all', duration_min: 60, price_iqd: 40_000 },
  { rule_id: 'rule-all', duration_min: 90, price_iqd: 55_000 },
];

/** Venue-local wall time -> UTC ISO (Baghdad is UTC+3). */
const baghdad = (hhmm: string) => new Date(`${DATE}T${hhmm}:00+03:00`);

// "Now" well before opening so nothing is 'past'.
const NOW = new Date(`${DATE}T05:00:00+03:00`);

describe('assembleDayGrid', () => {
  it('builds priced free slots inside opening hours', () => {
    const grid = assembleDayGrid({
      date: DATE,
      settings,
      courts: [court],
      availability: [],
      rules,
      prices,
      now: NOW,
    });
    expect(grid).toHaveLength(1);
    const slots = grid[0]!.slots;
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.state === 'free')).toBe(true);
    const sixty = slots.find((s) => s.durationMin === 60);
    const ninety = slots.find((s) => s.durationMin === 90);
    expect(sixty?.priceIqd).toBe(40_000);
    expect(ninety?.priceIqd).toBe(55_000);
    // 09:00 window start, half-open: a 90-min slot at 11:00 would end 12:30 — excluded.
    const lateNinety = slots.find(
      (s) => s.durationMin === 90 && s.startAt.getTime() === baghdad('11:00').getTime(),
    );
    expect(lateNinety).toBeUndefined();
  });

  it('marks booked / held / blocked from court_availability rows', () => {
    const availability: AvailabilityRow[] = [
      { court_id: 'court-1', start_at: baghdad('09:00').toISOString(), end_at: baghdad('10:00').toISOString(), kind: 'booking' },
      { court_id: 'court-1', start_at: baghdad('10:00').toISOString(), end_at: baghdad('11:00').toISOString(), kind: 'hold' },
      { court_id: 'court-1', start_at: baghdad('11:00').toISOString(), end_at: baghdad('12:00').toISOString(), kind: 'maintenance' },
    ];
    const grid = assembleDayGrid({
      date: DATE,
      settings,
      courts: [court],
      availability,
      rules,
      prices,
      now: NOW,
    });
    const slots = grid[0]!.slots;
    const at = (hhmm: string, dur: number) =>
      slots.find((s) => s.durationMin === dur && s.startAt.getTime() === baghdad(hhmm).getTime());
    expect(at('09:00', 60)?.state).toBe('booked');
    expect(at('10:00', 60)?.state).toBe('held');
    expect(at('11:00', 60)?.state).toBe('blocked');
    // Overlap: a 90-min slot at 09:30 collides with the 10:00 hold.
    expect(at('09:30', 90)?.state).toBe('booked'); // 09:30-11:00 also overlaps the 09:00 booking
  });

  it('returns empty slots for a closed date', () => {
    const grid = assembleDayGrid({
      date: DATE,
      settings: { ...settings, closed_dates: [DATE] },
      courts: [court],
      availability: [],
      rules,
      prices,
      now: NOW,
    });
    expect(grid[0]!.slots).toHaveLength(0);
  });

  it('prices with null when no rule matches the duration', () => {
    const grid = assembleDayGrid({
      date: DATE,
      settings,
      courts: [court],
      availability: [],
      rules,
      prices: prices.filter((p) => p.duration_min !== 90),
      now: NOW,
    });
    const ninety = grid[0]!.slots.find((s) => s.durationMin === 90);
    expect(ninety?.priceIqd).toBeNull();
  });
});

describe('groupByStart', () => {
  it('groups slots by start time and paints free when any duration is free', () => {
    const grid = assembleDayGrid({
      date: DATE,
      settings,
      courts: [court],
      availability: [
        // 90-min slots starting 09:00 are blocked by a booking 10:00-10:30;
        // the 60-min 09:00 slot stays free.
        { court_id: 'court-1', start_at: baghdad('10:00').toISOString(), end_at: baghdad('10:30').toISOString(), kind: 'booking' },
      ],
      rules,
      prices,
      now: NOW,
    });
    const cells = groupByStart(grid[0]!.slots);
    const nineCell = cells.find((c) => c.startAt.getTime() === baghdad('09:00').getTime());
    expect(nineCell?.state).toBe('free');
    expect(nineCell?.options.find((o) => o.durationMin === 60)?.state).toBe('free');
    expect(nineCell?.options.find((o) => o.durationMin === 90)?.state).toBe('booked');
  });
});

describe('listBookableDates', () => {
  it('returns today + 14 venue-local dates', () => {
    const dates = listBookableDates(new Date('2026-09-01T22:30:00Z'), TZ); // 01:30 next day in Baghdad
    expect(dates).toHaveLength(15);
    expect(dates[0]).toBe('2026-09-02'); // venue-local "today"
    expect(dates[14]).toBe('2026-09-16');
  });
});

function slot(startIso: string, durationMin: number, state: Slot['state'], priceIqd: number | null): Slot {
  const startAt = new Date(startIso);
  return {
    startAt,
    endAt: new Date(startAt.getTime() + durationMin * 60_000),
    durationMin,
    state,
    priceIqd: priceIqd == null ? null : iqd(priceIqd),
  };
}

const T10 = '2026-09-01T07:00:00.000Z'; // 10:00 Baghdad
const T11 = '2026-09-01T08:00:00.000Z';

describe('mergeAcrossCourts', () => {
  const twoCourts: CourtSlots[] = [
    { courtId: 'c1', slots: [slot(T10, 60, 'free', 30_000), slot(T11, 60, 'booked', 25_000)] },
    { courtId: 'c2', slots: [slot(T10, 60, 'free', 25_000), slot(T11, 60, 'held', 25_000)] },
  ];

  it('counts free courts and targets the cheapest one', () => {
    const cells = mergeAcrossCourts(twoCourts, 60);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatchObject({ state: 'free', freeCount: 2, capacity: 2, courtId: 'c2', priceIqd: 25_000 });
  });

  it('resolves a fully-busy start to the most explanatory state', () => {
    const cells = mergeAcrossCourts(twoCourts, 60);
    // booked + held -> held wins over booked
    expect(cells[1]).toMatchObject({ state: 'held', freeCount: 0, courtId: null, priceIqd: null });
  });

  it('any free court keeps the start bookable even when the other is blocked', () => {
    const grid: CourtSlots[] = [
      { courtId: 'c1', slots: [slot(T10, 60, 'blocked', null)] },
      { courtId: 'c2', slots: [slot(T10, 60, 'free', 25_000)] },
    ];
    expect(mergeAcrossCourts(grid, 60)[0]).toMatchObject({ state: 'free', freeCount: 1, courtId: 'c2' });
  });

  it('filters to the selected duration only', () => {
    const grid: CourtSlots[] = [
      { courtId: 'c1', slots: [slot(T10, 60, 'free', 25_000), slot(T10, 90, 'free', 37_500)] },
    ];
    const cells = mergeAcrossCourts(grid, 90);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ priceIqd: 37_500, capacity: 1 });
  });

  it('degraded horizon overrides every non-past state, past stays past', () => {
    const grid: CourtSlots[] = [
      { courtId: 'c1', slots: [slot(T10, 60, 'past', null), slot(T11, 60, 'free', 25_000)] },
    ];
    const horizonEnd = new Date('2026-09-02T00:00:00Z');
    const cells = mergeAcrossCourts(grid, 60, horizonEnd);
    expect(cells[0]?.state).toBe('past');
    expect(cells[1]?.state).toBe('horizon');
  });
});

describe('openNowInfo', () => {
  const overnight = {
    timezone: TZ,
    // Trades 09:00 -> 02:00: the tail lives on the NEXT calendar day.
    opening_hours: {
      tue: [['00:00', '02:00'], ['09:00', '24:00']],
      wed: [['00:00', '02:00'], ['09:00', '24:00']],
    },
    closed_dates: [] as string[],
  };

  it('is open mid-evening with the folded label', () => {
    const info = openNowInfo(overnight, new Date('2026-09-01T18:00:00.000Z')); // 21:00 Baghdad Tue
    expect(info).toMatchObject({ open: true, label: '09:00–02:00' });
  });

  it('is open during the post-midnight tail', () => {
    const info = openNowInfo(overnight, new Date('2026-09-01T22:30:00.000Z')); // 01:30 Baghdad Wed
    expect(info?.open).toBe(true);
  });

  it('is closed in the dead band and on closed dates', () => {
    const dead = openNowInfo(overnight, new Date('2026-09-01T03:00:00.000Z')); // 06:00 Baghdad Tue
    expect(dead?.open).toBe(false);
    const closed = openNowInfo(
      { ...overnight, closed_dates: ['2026-09-01'] },
      new Date('2026-09-01T18:00:00.000Z'),
    );
    expect(closed?.open).toBe(false);
  });
});
