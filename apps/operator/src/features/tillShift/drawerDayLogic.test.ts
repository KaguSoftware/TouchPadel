import { describe, expect, it } from 'vitest';
import type { ListShift, OutsideRow } from './tillShiftLogic';
import { activityParts, canStepForward, summariseDay } from './drawerDayLogic';

function shift(over: Partial<ListShift> = {}): ListShift {
  return {
    id: 's1',
    day_session_id: 'd1',
    business_date: '2026-10-07',
    station_id: 'TILL-1',
    staff_id: 'p1',
    staff_name: 'Ali',
    opened_at: '2026-10-07T13:00:00Z',
    closed_at: '2026-10-07T17:00:00Z',
    closed_via: 'own_pin',
    closed_by_name: 'Ali',
    authorized_by_name: null,
    opening_float_iqd: 50000,
    handover_difference_iqd: null,
    cash_payments_iqd: 120000,
    cash_refunds_iqd: 10000,
    cash_expected_iqd: 160000,
    cash_counted_iqd: 155000,
    cash_variance_iqd: -5000,
    card_payments_iqd: 30000,
    card_refunds_iqd: 0,
    payment_count: 9,
    refund_count: 1,
    drawer_open_count: 0,
    open_note: null,
    close_note: null,
    ...over,
  };
}

const none: OutsideRow[] = [];

describe('summariseDay', () => {
  it('adds the stamped figures and sums the counted shifts', () => {
    const s = summariseDay({
      shifts: [shift(), shift({ id: 's2', cash_payments_iqd: 80000, cash_refunds_iqd: 0, cash_counted_iqd: 135000, cash_variance_iqd: 5000, card_payments_iqd: 0 })],
      outside: none,
    });
    expect(s).toMatchObject({ shifts: 2, open: 0, counted: 2, cashTaken: 200000, cashRefunded: 10000, cardTaken: 30000, countedIqd: 290000, varianceIqd: 0 });
  });
  it('counts an open shift as open and adds its figures but not a count', () => {
    const s = summariseDay({ shifts: [shift({ id: 's3', closed_at: null, closed_via: null, cash_counted_iqd: null, cash_variance_iqd: null })], outside: none });
    expect(s).toMatchObject({ open: 1, counted: 0, countedIqd: 0, varianceIqd: 0, cashTaken: 120000 });
  });
  it('leaves a shift ended with the day out of the counts', () => {
    const s = summariseDay({ shifts: [shift({ closed_via: 'day_close', cash_counted_iqd: null, cash_variance_iqd: null })], outside: none });
    expect(s.counted).toBe(0);
    expect(s.shifts).toBe(1);
  });
  it('adds money taken with no shift open', () => {
    const outside: OutsideRow[] = [
      { day_session_id: 'd1', business_date: '2026-10-07', station_id: 'DESK', cash_payments_iqd: 7000, cash_refunds_iqd: 2000, card_payments_iqd: 0, card_refunds_iqd: 0, payment_count: 1, refund_count: 1 },
    ];
    expect(summariseDay({ shifts: [], outside })).toMatchObject({ outsideCashIn: 7000, outsideCashOut: 2000 });
  });
});

describe('canStepForward', () => {
  it('goes forward only before the latest day', () => {
    expect(canStepForward('2026-10-06', '2026-10-07')).toBe(true);
    expect(canStepForward('2026-10-07', '2026-10-07')).toBe(false);
    expect(canStepForward(null, '2026-10-07')).toBe(false);
    expect(canStepForward('2026-10-06', null)).toBe(false);
  });
});

describe('activityParts', () => {
  it('names only what happened', () => {
    expect(activityParts({ payment_count: 9, refund_count: 0, drawer_open_count: 2 })).toEqual([
      { key: 'payments', count: 9 },
      { key: 'drawerOpens', count: 2 },
    ]);
  });
});
