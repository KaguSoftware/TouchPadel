import { describe, expect, it } from 'vitest';
import {
  assembleDayGrid,
  groupByStart,
  listBookableDates,
  type AvailabilityRow,
  type CourtRow,
  type RateRulePriceRow,
  type RateRuleRow,
} from '../assemble';

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
