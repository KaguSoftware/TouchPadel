import { describe, expect, it } from 'vitest';
import { iqd } from '../money/iqd';
import { parseHHMM, wallTimeToUtc } from '../time/tz';
import { buildSlotGrid, type BuildSlotGridArgs, type Slot } from './slotGrid';

const TZ = 'Asia/Baghdad'; // UTC+3
const DATE = '2026-09-07'; // a Monday
const COURT = { id: 'court-1', durationOptions: [60] };

const at = (hhmm: string, date = DATE): Date => wallTimeToUtc(date, parseHHMM(hhmm), TZ);

function base(overrides: Partial<BuildSlotGridArgs> = {}): BuildSlotGridArgs {
  return {
    date: DATE,
    openingHours: { mon: [['09:00', '23:00']] },
    courts: [COURT],
    now: at('00:00'), // before opening: nothing is 'past'
    tz: TZ,
    slotIncrementMin: 60,
    ...overrides,
  };
}

function slotStarting(slots: Slot[], hhmm: string, durationMin = 60): Slot {
  const s = slots.find(
    (x) => x.startAt.getTime() === at(hhmm).getTime() && x.durationMin === durationMin,
  );
  if (!s) throw new Error(`no slot at ${hhmm}/${durationMin}`);
  return s;
}

describe('buildSlotGrid — grid generation', () => {
  it('generates hourly slots inside opening hours, all free', () => {
    const [grid] = buildSlotGrid(base());
    expect(grid?.courtId).toBe('court-1');
    expect(grid?.slots).toHaveLength(14); // 09:00..22:00 starts
    expect(grid?.slots.every((s) => s.state === 'free')).toBe(true);
    const first = grid?.slots[0];
    expect(first?.startAt.toISOString()).toBe('2026-09-07T06:00:00.000Z'); // 09:00 Baghdad
    expect(first?.endAt.toISOString()).toBe('2026-09-07T07:00:00.000Z');
  });

  it('slots must FIT inside the window (no 22:30+90 slot before a 23:00 close)', () => {
    const [grid] = buildSlotGrid(
      base({ courts: [{ id: 'court-1', durationOptions: [60, 90] }], slotIncrementMin: 30 }),
    );
    const late90 = grid?.slots.filter((s) => s.durationMin === 90 && s.startAt >= at('21:31'));
    expect(late90).toHaveLength(0); // last 90-min start is 21:30
    const last60 = grid?.slots.filter((s) => s.durationMin === 60).at(-1);
    expect(last60?.startAt.getTime()).toBe(at('22:00').getTime());
  });

  it('a closed date yields no slots', () => {
    const [grid] = buildSlotGrid(base({ closedDates: ['2026-09-01', DATE] }));
    expect(grid?.slots).toHaveLength(0);
  });

  it('a day with no opening-hours entry yields no slots', () => {
    const [grid] = buildSlotGrid(base({ openingHours: { tue: [['09:00', '23:00']] } }));
    expect(grid?.slots).toHaveLength(0);
  });

  it('throws on midnight-crossing opening windows (documented unsupported)', () => {
    expect(() => buildSlotGrid(base({ openingHours: { mon: [['22:00', '02:00']] } }))).toThrowError(
      /midnight-crossing/,
    );
  });

  it('supports split windows (e.g. siesta close)', () => {
    const [grid] = buildSlotGrid(
      base({
        openingHours: {
          mon: [
            ['09:00', '12:00'],
            ['16:00', '20:00'],
          ],
        },
      }),
    );
    expect(grid?.slots.map((s) => s.startAt.getTime())).not.toContain(at('13:00').getTime());
    expect(grid?.slots).toHaveLength(3 + 4);
  });
});

describe('buildSlotGrid — states', () => {
  it('marks bookings booked; half-open adjacency leaves neighbours free', () => {
    const [grid] = buildSlotGrid(
      base({
        reservations: [
          {
            courtId: 'court-1',
            kind: 'booking',
            status: 'confirmed',
            startAt: at('18:00'),
            endAt: at('19:00'),
          },
        ],
      }),
    );
    const slots = grid?.slots ?? [];
    expect(slotStarting(slots, '17:00').state).toBe('free');
    expect(slotStarting(slots, '18:00').state).toBe('booked');
    expect(slotStarting(slots, '19:00').state).toBe('free'); // [18,19) does not touch [19,20)
  });

  it('non-blocking statuses (cancelled/no_show/expired/completed) free the slot', () => {
    for (const status of ['cancelled', 'no_show', 'expired', 'completed']) {
      const [grid] = buildSlotGrid(
        base({
          reservations: [
            {
              courtId: 'court-1',
              kind: 'booking',
              status,
              startAt: at('18:00'),
              endAt: at('19:00'),
            },
          ],
        }),
      );
      expect(slotStarting(grid?.slots ?? [], '18:00').state).toBe('free');
    }
  });

  it('maintenance blocks, and outranks a (data-anomaly) overlapping booking', () => {
    const [grid] = buildSlotGrid(
      base({
        reservations: [
          {
            courtId: 'court-1',
            kind: 'maintenance',
            status: 'confirmed',
            startAt: at('10:00'),
            endAt: at('12:00'),
          },
          {
            courtId: 'court-1',
            kind: 'booking',
            status: 'confirmed',
            startAt: at('11:00'),
            endAt: at('12:00'),
          },
        ],
      }),
    );
    expect(slotStarting(grid?.slots ?? [], '10:00').state).toBe('blocked');
    expect(slotStarting(grid?.slots ?? [], '11:00').state).toBe('blocked');
  });

  it('live holds show held; expired holds count as FREE', () => {
    const now = at('12:00');
    const [grid] = buildSlotGrid(
      base({
        now,
        holds: [
          {
            courtId: 'court-1',
            startAt: at('14:00'),
            endAt: at('15:00'),
            holdExpiresAt: new Date(now.getTime() + 300_000), // live
          },
          {
            courtId: 'court-1',
            startAt: at('16:00'),
            endAt: at('17:00'),
            holdExpiresAt: new Date(now.getTime() - 1), // expired
          },
        ],
      }),
    );
    const slots = grid?.slots ?? [];
    expect(slotStarting(slots, '14:00').state).toBe('held');
    expect(slotStarting(slots, '16:00').state).toBe('free');
  });

  it('a hold expiring EXACTLY at now is expired (half-open)', () => {
    const now = at('12:00');
    const [grid] = buildSlotGrid(
      base({
        now,
        holds: [
          { courtId: 'court-1', startAt: at('14:00'), endAt: at('15:00'), holdExpiresAt: now },
        ],
      }),
    );
    expect(slotStarting(grid?.slots ?? [], '14:00').state).toBe('free');
  });

  it('hold rows passed through `reservations` (kind=hold) behave the same', () => {
    const now = at('12:00');
    const [grid] = buildSlotGrid(
      base({
        now,
        reservations: [
          {
            courtId: 'court-1',
            kind: 'hold',
            status: 'pending',
            startAt: at('14:00'),
            endAt: at('15:00'),
            holdExpiresAt: new Date(now.getTime() + 60_000),
          },
          {
            courtId: 'court-1',
            kind: 'hold',
            status: 'pending',
            startAt: at('16:00'),
            endAt: at('17:00'),
            holdExpiresAt: new Date(now.getTime() - 60_000),
          },
        ],
      }),
    );
    const slots = grid?.slots ?? [];
    expect(slotStarting(slots, '14:00').state).toBe('held');
    expect(slotStarting(slots, '16:00').state).toBe('free');
  });

  it('started slots are past; a running booking still shows booked', () => {
    const now = at('12:30');
    const [grid] = buildSlotGrid(
      base({
        now,
        reservations: [
          {
            courtId: 'court-1',
            kind: 'booking',
            status: 'arrived',
            startAt: at('12:00'),
            endAt: at('13:00'),
          },
        ],
      }),
    );
    const slots = grid?.slots ?? [];
    expect(slotStarting(slots, '09:00').state).toBe('past');
    expect(slotStarting(slots, '11:00').state).toBe('past');
    expect(slotStarting(slots, '12:00').state).toBe('booked'); // running now
    expect(slotStarting(slots, '13:00').state).toBe('free');
  });

  it('reservations on another court do not leak', () => {
    const [gridA, gridB] = buildSlotGrid(
      base({
        courts: [COURT, { id: 'court-2', durationOptions: [60] }],
        reservations: [
          {
            courtId: 'court-2',
            kind: 'booking',
            status: 'confirmed',
            startAt: at('18:00'),
            endAt: at('19:00'),
          },
        ],
      }),
    );
    expect(slotStarting(gridA?.slots ?? [], '18:00').state).toBe('free');
    expect(slotStarting(gridB?.slots ?? [], '18:00').state).toBe('booked');
  });

  it('prices slots via the hook; null without it', () => {
    const [priced] = buildSlotGrid(
      base({ price: (_courtId, _startAt, durationMin) => iqd(durationMin * 1000) }),
    );
    expect(slotStarting(priced?.slots ?? [], '09:00').priceIqd).toBe(60000);
    const [unpriced] = buildSlotGrid(base());
    expect(slotStarting(unpriced?.slots ?? [], '09:00').priceIqd).toBeNull();
  });
});
