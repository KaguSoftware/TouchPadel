import { describe, expect, it } from 'vitest';
import {
  allowedMarks,
  arrivals,
  courtAvailability,
  groupByStart,
  isOverrideRefusal,
  isVisible,
  paymentStatusFor,
  toBookingStatus,
} from './deskLogic';
import type { ReservationRow } from './deskTypes';

function row(over: Partial<ReservationRow> & { id: string }): ReservationRow {
  return {
    court_id: 'c1',
    kind: 'booking',
    status: 'confirmed',
    start_at: '2026-09-03T15:00:00.000Z',
    end_at: '2026-09-03T16:00:00.000Z',
    guest_id: null,
    guest_name: 'Guest',
    guest_phone: null,
    price_iqd: 30000,
    hold_expires_at: null,
    notes: null,
    ...over,
  };
}

describe('toBookingStatus', () => {
  it('passes the seven known statuses through and leaves unknown strings alone', () => {
    expect(toBookingStatus('no_show')).toBe('no_show');
    expect(toBookingStatus('weird')).toBe('weird');
  });
});

describe('paymentStatusFor', () => {
  const r = row({ id: 'r1' });
  it('is unknown when the tab list has not loaded, when nothing is priced, or when no tab charges it', () => {
    expect(paymentStatusFor(r, undefined)).toBe('unknown');
    expect(paymentStatusFor(row({ id: 'r1', price_iqd: null }), [])).toBe('unknown');
    expect(paymentStatusFor(r, [{ reservation_id: 'other', status: 'settled' }])).toBe('unknown');
  });
  it('is paid only when a settled tab charges the booking', () => {
    expect(paymentStatusFor(r, [{ reservation_id: 'r1', status: 'settled' }])).toBe('paid');
    expect(paymentStatusFor(r, [{ reservation_id: 'r1', status: 'open' }])).toBe('unpaid');
    // A voided tab does not count as a charge.
    expect(paymentStatusFor(r, [{ reservation_id: 'r1', status: 'void' }])).toBe('unknown');
  });
  it('never reports payment for blocks and holds', () => {
    expect(paymentStatusFor(row({ id: 'm', kind: 'maintenance' }), [{ reservation_id: 'm', status: 'settled' }])).toBe('unknown');
  });
});

describe('isVisible', () => {
  const now = Date.parse('2026-09-03T15:30:00Z');
  it('hides cancelled, expired, no-show and lapsed holds', () => {
    expect(isVisible(row({ id: 'a', status: 'cancelled' }), now)).toBe(false);
    expect(isVisible(row({ id: 'b', status: 'no_show' }), now)).toBe(false);
    expect(isVisible(row({ id: 'c', kind: 'hold', status: 'pending', hold_expires_at: '2026-09-03T15:00:00Z' }), now)).toBe(false);
    expect(isVisible(row({ id: 'd', kind: 'hold', status: 'pending', hold_expires_at: '2026-09-03T16:00:00Z' }), now)).toBe(true);
    expect(isVisible(row({ id: 'e' }), now)).toBe(true);
  });
});

describe('groupByStart', () => {
  it('groups rows that start at the same instant, ordered by start then court', () => {
    const groups = groupByStart([
      row({ id: 'late', start_at: '2026-09-03T17:00:00.000Z' }),
      row({ id: 'b', court_id: 'c2' }),
      row({ id: 'a', court_id: 'c1' }),
    ]);
    expect(groups.map((g) => g.startAt)).toEqual(['2026-09-03T15:00:00.000Z', '2026-09-03T17:00:00.000Z']);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('courtAvailability', () => {
  const now = '2026-09-03T15:30:00.000Z';
  it('reports a court busy while a blocking reservation spans now', () => {
    const [c1] = courtAvailability(['c1'], [row({ id: 'r1' })], now);
    expect(c1).toMatchObject({ state: 'busy', untilAt: '2026-09-03T16:00:00.000Z', reservationId: 'r1' });
  });
  it('reports free with the next start, ignoring cancelled rows and other courts', () => {
    const rows = [
      row({ id: 'gone', status: 'cancelled' }),
      row({ id: 'other', court_id: 'c2' }),
      row({ id: 'next', start_at: '2026-09-03T18:00:00.000Z', end_at: '2026-09-03T19:00:00.000Z' }),
      row({ id: 'later', start_at: '2026-09-03T20:00:00.000Z', end_at: '2026-09-03T21:00:00.000Z' }),
    ];
    const [c1, c3] = courtAvailability(['c1', 'c3'], rows, now);
    expect(c1).toEqual({ courtId: 'c1', state: 'free', nextStartAt: '2026-09-03T18:00:00.000Z' });
    expect(c3).toEqual({ courtId: 'c3', state: 'free', nextStartAt: null });
  });
  it('carries the kind so a block reads as blocked, not booked', () => {
    const [c1] = courtAvailability(['c1'], [row({ id: 'm', kind: 'maintenance' })], now);
    expect(c1).toMatchObject({ state: 'busy', kind: 'maintenance' });
  });
});

describe('arrivals', () => {
  const now = '2026-09-03T14:30:00.000Z';
  const horizon = '2026-09-03T15:30:00.000Z';
  it('lists confirmed bookings starting within the horizon plus everyone already arrived', () => {
    const out = arrivals(
      [
        row({ id: 'soon' }), // 15:00, within the hour
        row({ id: 'here', status: 'arrived', start_at: '2026-09-03T12:00:00.000Z' }),
        row({ id: 'far', start_at: '2026-09-03T19:00:00.000Z' }),
        row({ id: 'past', start_at: '2026-09-03T13:00:00.000Z' }),
        row({ id: 'block', kind: 'maintenance' }),
        row({ id: 'done', status: 'completed' }),
      ],
      now,
      horizon,
    );
    expect(out.map((r) => r.id)).toEqual(['here', 'soon']);
  });
});

describe('allowedMarks / isOverrideRefusal', () => {
  it('mirrors mark_reservation transitions', () => {
    expect(allowedMarks('confirmed')).toEqual(['arrived', 'completed', 'no_show']);
    expect(allowedMarks('arrived')).toEqual(['completed']);
    expect(allowedMarks('completed')).toEqual([]);
    expect(allowedMarks('pending')).toEqual([]);
  });
  it('classifies rule refusals apart from failures', () => {
    expect(isOverrideRefusal('NOT_MOVABLE')).toBe(true);
    expect(isOverrideRefusal('FORBIDDEN')).toBe(true);
    expect(isOverrideRefusal('SLOT_TAKEN')).toBe(false);
    expect(isOverrideRefusal(undefined)).toBe(false);
  });
});
