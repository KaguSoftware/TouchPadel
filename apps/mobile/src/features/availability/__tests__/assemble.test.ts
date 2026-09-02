import { describe, expect, it } from 'vitest';
import { iqd } from '@touch/core';
import type { CourtSlots, Slot } from '@touch/core';
import {
  firstUpcomingIndex,
  hasAnySlots,
  mergeAcrossCourts,
  openNowInfo,
  addDays,
  assembleDayGrid,
  assembleTradingNight,
  groupByStart,
  listBookableDates,
  protectedHorizonEnd,
  type AvailabilityRow,
  type MergedCell,
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

// ── protectedHorizonEnd: the client copy of app.assert_not_degraded_for ──────

describe('protectedHorizonEnd', () => {
  const now = new Date('2026-09-02T15:50:00Z');

  it('is now + protected_horizon_hours', () => {
    expect(protectedHorizonEnd(now, { protected_horizon_hours: 48 }).toISOString()).toBe(
      '2026-09-04T15:50:00.000Z',
    );
    expect(protectedHorizonEnd(now, { protected_horizon_hours: 12 }).toISOString()).toBe(
      '2026-09-03T03:50:00.000Z',
    );
  });

  it('falls back to the 48 h server default when the column is missing or invalid', () => {
    expect(protectedHorizonEnd(now).toISOString()).toBe('2026-09-04T15:50:00.000Z');
    expect(protectedHorizonEnd(now, null).toISOString()).toBe('2026-09-04T15:50:00.000Z');
    expect(protectedHorizonEnd(now, { protected_horizon_hours: null }).toISOString()).toBe(
      '2026-09-04T15:50:00.000Z',
    );
  });

  it('honours 0 as "no protected window" rather than defaulting', () => {
    expect(protectedHorizonEnd(now, { protected_horizon_hours: 0 }).getTime()).toBe(now.getTime());
  });

  it('covers the window the old "midnight after tomorrow" rule left uncovered', () => {
    // The regression: a slot on the third day chip, before the current
    // wall-clock time. Free under the old rule, refused by the server.
    const slotStart = new Date('2026-09-04T10:00:00Z');
    const oldRule = new Date('2026-09-04T00:00:00Z'); // midnight after tomorrow
    expect(slotStart.getTime() < oldRule.getTime()).toBe(false);
    expect(slotStart.getTime() < protectedHorizonEnd(now, { protected_horizon_hours: 48 }).getTime()).toBe(
      true,
    );
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

describe('mergeAcrossCourts with a clock', () => {
  const grid: CourtSlots[] = [
    { courtId: 'c1', slots: [slot(T10, 60, 'free', 30_000), slot(T11, 60, 'free', 30_000)] },
    { courtId: 'c2', slots: [slot(T10, 60, 'booked', 25_000), slot(T11, 60, 'held', 25_000)] },
  ];

  it('marks free/held starts before now as past, keeps booked as booked', () => {
    // The hook builds the grid without a clock so the expensive assembly runs
    // only when data changes; this pass is the per-minute work.
    const now = new Date('2026-09-01T07:30:00.000Z'); // 10:30 Baghdad
    const cells = mergeAcrossCourts(grid, 60, null, now);
    // 10:00: c1 free -> past, c2 booked -> stays booked => "booked" wins over past
    expect(cells[0]?.state).toBe('booked');
    // 11:00 is still ahead: free
    expect(cells[1]).toMatchObject({ state: 'free', freeCount: 1, courtId: 'c1' });
  });

  it('all-past when every option has started', () => {
    const now = new Date('2026-09-01T09:00:00.000Z'); // 12:00 Baghdad
    const onlyFree: CourtSlots[] = [{ courtId: 'c1', slots: [slot(T10, 60, 'free', 30_000)] }];
    expect(mergeAcrossCourts(onlyFree, 60, null, now)[0]?.state).toBe('past');
  });

  it('without a clock nothing is past (legacy behaviour)', () => {
    expect(mergeAcrossCourts(grid, 60)[1]?.state).toBe('free');
  });
});

describe('firstUpcomingIndex', () => {
  const cell = (state: MergedCell['state']): MergedCell => ({
    startAt: new Date(T10),
    state,
    freeCount: 0,
    capacity: 2,
    priceIqd: null,
    courtId: null,
  });

  it('skips the run of started times so the grid can open on tonight', () => {
    expect(firstUpcomingIndex([cell('past'), cell('past'), cell('free')])).toBe(2);
  });

  it('stops at a booked or blocked hour — those still explain the night', () => {
    expect(firstUpcomingIndex([cell('past'), cell('booked'), cell('free')])).toBe(1);
    expect(firstUpcomingIndex([cell('past'), cell('horizon')])).toBe(1);
  });

  it('is 0 on a day with nothing past (a future chip opens at the top)', () => {
    expect(firstUpcomingIndex([cell('free'), cell('free')])).toBe(0);
  });

  it('is 0 when the whole night has run out, and when there are no cells', () => {
    expect(firstUpcomingIndex([cell('past'), cell('past')])).toBe(0);
    expect(firstUpcomingIndex([])).toBe(0);
  });
});

describe('hasAnySlots', () => {
  it('is about slots, not courts', () => {
    // The closed-day check used to test grid.length (= number of courts), so a
    // duration with no priced slots read as "Venue closed".
    expect(hasAnySlots([{ courtId: 'c1', slots: [] }, { courtId: 'c2', slots: [] }])).toBe(false);
    expect(hasAnySlots([{ courtId: 'c1', slots: [slot(T10, 60, 'free', 1)] }])).toBe(true);
    expect(hasAnySlots([])).toBe(false);
  });
});

// ── Trading-night fold: a day chip is a night (09:00 → 02:00), not a calendar day ──

const OVERNIGHT = {
  timezone: TZ,
  // Trades 09:00 -> 02:00, stored as two windows on adjacent days (HANDOFF).
  opening_hours: {
    mon: [['00:00', '02:00'], ['09:00', '24:00']],
    tue: [['00:00', '02:00'], ['09:00', '24:00']],
    wed: [['00:00', '02:00'], ['09:00', '24:00']],
  },
  closed_dates: [] as string[],
};
const wedBaghdad = (hhmm: string) => new Date(`2026-09-02T${hhmm}:00+03:00`);

describe('assembleTradingNight', () => {
  const build = (settings = OVERNIGHT, availability: AvailabilityRow[] = []) =>
    assembleTradingNight({ date: DATE, settings, courts: [court], availability, rules, prices, now: NOW });
  const starts60 = (grid: CourtSlots[]) =>
    grid[0]!.slots.filter((s) => s.durationMin === 60).map((s) => s.startAt.toISOString());

  it("runs from 09:00 to the NEXT date's 01:00 and never shows the inherited 00:00 tail", () => {
    // Per calendar day this grid opened with Monday night's 00:00/00:30/01:00
    // and hid Tuesday night's at the top of Wednesday — the bug on the phone.
    const starts = starts60(build());
    expect(starts[0]).toBe(baghdad('09:00').toISOString());
    expect(starts[starts.length - 1]).toBe(wedBaghdad('01:00').toISOString());
    expect(starts).not.toContain(baghdad('00:00').toISOString());
    // In order: Tuesday 23:00 is followed by Wednesday 00:00.
    const at23 = starts.indexOf(baghdad('23:00').toISOString());
    expect(at23).toBeGreaterThan(0);
    expect(starts[at23 + 1]).toBe(wedBaghdad('00:00').toISOString());
  });

  it('prices and marks tail slots like any other (rows on the next date apply)', () => {
    const grid = build(OVERNIGHT, [
      { court_id: 'court-1', start_at: wedBaghdad('00:00').toISOString(), end_at: wedBaghdad('01:00').toISOString(), kind: 'booking' },
    ]);
    const at = (d: Date, dur: number) =>
      grid[0]!.slots.find((s) => s.durationMin === dur && s.startAt.getTime() === d.getTime());
    expect(at(wedBaghdad('00:00'), 60)?.state).toBe('booked');
    expect(at(wedBaghdad('01:00'), 60)).toMatchObject({ state: 'free', priceIqd: 40_000 });
  });

  it('drops the tail when the following date is closed (server guard is per calendar day)', () => {
    const starts = starts60(build({ ...OVERNIGHT, closed_dates: ['2026-09-02'] }));
    expect(starts[starts.length - 1]).toBe(baghdad('23:00').toISOString());
  });

  it('is exactly the day grid for same-day hours', () => {
    const args = { date: DATE, settings, courts: [court], availability: [], rules, prices, now: NOW };
    expect(assembleTradingNight(args)).toEqual(assembleDayGrid(args));
  });
});

describe('listBookableDates while last night is still trading', () => {
  const at0030Wed = new Date('2026-09-01T21:30:00Z'); // 00:30 Wed Baghdad

  it('leads with yesterday inside the tail and drops it after close', () => {
    const during = listBookableDates(at0030Wed, TZ, 6, OVERNIGHT);
    expect(during.slice(0, 2)).toEqual(['2026-09-01', '2026-09-02']);
    expect(during).toHaveLength(8);
    const after = listBookableDates(new Date('2026-09-02T00:00:00Z'), TZ, 6, OVERNIGHT); // 03:00 Wed
    expect(after[0]).toBe('2026-09-02');
    expect(after).toHaveLength(7);
  });

  it('does not lead with a closed yesterday, nor when today is closed', () => {
    expect(listBookableDates(at0030Wed, TZ, 6, { ...OVERNIGHT, closed_dates: ['2026-09-01'] })[0]).toBe('2026-09-02');
    expect(listBookableDates(at0030Wed, TZ, 6, { ...OVERNIGHT, closed_dates: ['2026-09-02'] })[0]).toBe('2026-09-02');
  });

  it('is unchanged without venue settings', () => {
    expect(listBookableDates(at0030Wed, TZ, 6)[0]).toBe('2026-09-02');
  });
});

describe('addDays', () => {
  it('crosses month and year ends in both directions', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
