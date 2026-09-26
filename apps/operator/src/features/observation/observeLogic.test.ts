import { describe, it, expect } from 'vitest';
import type { ReservationRow } from '../desk/deskTypes';
import {
  courtDaySummary,
  didNotHappen,
  schedulePlacement,
  splitTabs,
  tablesNow,
  tillDaySummary,
  type TabBoardRow,
} from './observeLogic';

const NOW = Date.parse('2026-09-13T17:00:00Z'); // 20:00 Baghdad

function res(over: Partial<ReservationRow>): ReservationRow {
  return {
    id: Math.random().toString(36).slice(2),
    court_id: 'c1',
    kind: 'booking',
    status: 'confirmed',
    start_at: '2026-09-13T18:00:00Z',
    end_at: '2026-09-13T19:30:00Z',
    guest_id: null,
    guest_name: 'Guest',
    guest_phone: null,
    price_iqd: 30000,
    hold_expires_at: null,
    notes: null,
    ...over,
  };
}

function tab(over: Partial<TabBoardRow>): TabBoardRow {
  return {
    id: Math.random().toString(36).slice(2),
    label: 'Table 1',
    table: '1',
    court: null,
    guest: null,
    status: 'open',
    openedAt: '2026-09-13T15:00:00Z',
    settledAt: null,
    total: 10000,
    stamped: false,
    web: false,
    ...over,
  };
}

describe('courtDaySummary', () => {
  it('separates bookings that stand from those that did not', () => {
    const s = courtDaySummary(
      [
        res({ status: 'completed', start_at: '2026-09-13T13:00:00Z', end_at: '2026-09-13T14:00:00Z' }),
        res({ status: 'arrived', start_at: '2026-09-13T16:30:00Z' }),
        res({ status: 'confirmed' }),
        res({ status: 'no_show', price_iqd: 99999 }),
        res({ status: 'cancelled', price_iqd: 99999 }),
        res({ kind: 'maintenance', status: 'confirmed', price_iqd: null }),
      ],
      NOW,
    );
    expect(s).toMatchObject({ booked: 3, arrived: 2, upcoming: 1, noShows: 1, cancelled: 1, blocks: 1 });
    // No-shows and cancellations never add to the value booked.
    expect(s.bookedIqd).toBe(90000);
    // 13:00–14:00, 16:30–19:30 and 18:00–19:30 UTC.
    expect(s.bookedMinutes).toBe(60 + 180 + 90);
  });

  it('does not count a booking that started without arriving as upcoming', () => {
    const s = courtDaySummary([res({ status: 'confirmed', start_at: '2026-09-13T16:00:00Z' })], NOW);
    expect(s.booked).toBe(1);
    expect(s.upcoming).toBe(0);
  });

  it('lists what did not happen in start order', () => {
    const list = didNotHappen([
      res({ status: 'no_show', start_at: '2026-09-13T20:00:00Z' }),
      res({ status: 'confirmed' }),
      res({ status: 'cancelled', start_at: '2026-09-13T10:00:00Z' }),
    ]);
    expect(list.map((r) => r.status)).toEqual(['cancelled', 'no_show']);
  });
});

describe('schedulePlacement', () => {
  const dayStart = Date.parse('2026-09-12T21:00:00Z'); // midnight Baghdad, 13 Sep

  it('places a booking as a fraction of the night', () => {
    // Open 09:00 (540), close 02:00 (1560): a 1020-minute night.
    const p = schedulePlacement({ start_at: '2026-09-13T15:00:00Z', end_at: '2026-09-13T16:00:00Z' }, dayStart, 540, 1020);
    // 18:00 local is 540 minutes after opening.
    expect(p!.top).toBeCloseTo(540 / 1020);
    expect(p!.height).toBeCloseTo(60 / 1020);
  });

  it('clamps a booking that starts before opening and drops one outside the night', () => {
    const early = schedulePlacement({ start_at: '2026-09-13T05:00:00Z', end_at: '2026-09-13T06:30:00Z' }, dayStart, 540, 1020);
    expect(early).toEqual({ top: 0, height: 30 / 1020 });
    expect(schedulePlacement({ start_at: '2026-09-13T03:00:00Z', end_at: '2026-09-13T04:00:00Z' }, dayStart, 540, 1020)).toBeNull();
  });
});

describe('tills', () => {
  it('sums what the floor carries apart from what was settled', () => {
    const s = tillDaySummary([
      tab({ status: 'open', total: 12000 }),
      tab({ status: 'awaiting_payment', total: 8000 }),
      tab({ status: 'settled', total: 25000, stamped: true }),
      tab({ status: 'void', total: 0 }),
    ]);
    expect(s).toEqual({ active: 2, awaiting: 1, settled: 1, voided: 1, runningIqd: 20000, settledIqd: 25000 });
  });

  it('orders active tabs by longest open and closed tabs by latest', () => {
    const { active, inactive } = splitTabs([
      tab({ id: 'late', openedAt: '2026-09-13T16:00:00Z' }),
      tab({ id: 'early', openedAt: '2026-09-13T12:00:00Z' }),
      tab({ id: 's1', status: 'settled', settledAt: '2026-09-13T14:00:00Z' }),
      tab({ id: 's2', status: 'settled', settledAt: '2026-09-13T16:30:00Z' }),
    ]);
    expect(active.map((r) => r.id)).toEqual(['early', 'late']);
    expect(inactive.map((r) => r.id)).toEqual(['s2', 's1']);
  });

  it('marks tables occupied only by active tabs, in floor order', () => {
    const tables = tablesNow(
      [{ table_number: '10' }, { table_number: '2' }, { table_number: '1' }],
      [tab({ table: '2', total: 5000 }), tab({ table: '1', status: 'settled' })],
    );
    expect(tables.map((t) => t.tableNumber)).toEqual(['1', '2', '10']);
    expect(tables[0]!.tabs).toHaveLength(0);
    expect(tables[1]!.runningIqd).toBe(5000);
  });
});
