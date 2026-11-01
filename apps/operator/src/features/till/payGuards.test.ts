import { describe, expect, it } from 'vitest';
import { chargeToBookingShown, needsUnsentConfirm, payPressTarget } from './payGuards';

describe('till pay-row rules (F-32)', () => {
  it('Cash, Card or Split with unsent basket lines asks first, then goes where it was pressed', () => {
    expect(needsUnsentConfirm(0)).toBe(false);
    expect(needsUnsentConfirm(undefined)).toBe(false);
    expect(needsUnsentConfirm(2)).toBe(true);
    expect(payPressTarget({ kind: 'pay', method: 'card' } as const, 0)).toEqual({ kind: 'pay', method: 'card' });
    expect(payPressTarget({ kind: 'pay', method: 'cash' } as const, 3)).toEqual({ kind: 'unsent', then: { kind: 'pay', method: 'cash' } });
    expect(payPressTarget({ kind: 'split' } as const, 1)).toEqual({ kind: 'unsent', then: { kind: 'split' } });
  });

  it('"Charge to booking" only on an unsettled tab with no booking, for someone who can see the bookings', () => {
    expect(chargeToBookingShown({ settled: false, hasBooking: false, bookingsVisible: true })).toBe(true);
    expect(chargeToBookingShown({ settled: true, hasBooking: false, bookingsVisible: true })).toBe(false);
    expect(chargeToBookingShown({ settled: false, hasBooking: true, bookingsVisible: true })).toBe(false);
    expect(chargeToBookingShown({ settled: false, hasBooking: false, bookingsVisible: false })).toBe(false);
  });
});
