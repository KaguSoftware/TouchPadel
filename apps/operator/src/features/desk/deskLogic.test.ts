import { describe, expect, it } from 'vitest';
import {
  allowedMarks,
  arrivals,
  courtAvailability,
  groupByStart,
  isOverrideRefusal,
  isVisible,
  nameFromQuery,
  paymentStatusFor,
  phoneDigitCount,
  phoneFromQuery,
  sanitizeName,
  sanitizePhone,
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
    expect(
      paymentStatusFor(row({ id: 'm', kind: 'maintenance' }), [
        { reservation_id: 'm', status: 'settled' },
      ]),
    ).toBe('unknown');
  });
});

describe('isVisible', () => {
  const now = Date.parse('2026-09-03T15:30:00Z');
  it('hides cancelled, expired, no-show and lapsed holds', () => {
    expect(isVisible(row({ id: 'a', status: 'cancelled' }), now)).toBe(false);
    expect(isVisible(row({ id: 'b', status: 'no_show' }), now)).toBe(false);
    expect(
      isVisible(
        row({ id: 'c', kind: 'hold', status: 'pending', hold_expires_at: '2026-09-03T15:00:00Z' }),
        now,
      ),
    ).toBe(false);
    expect(
      isVisible(
        row({ id: 'd', kind: 'hold', status: 'pending', hold_expires_at: '2026-09-03T16:00:00Z' }),
        now,
      ),
    ).toBe(true);
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
    expect(groups.map((g) => g.startAt)).toEqual([
      '2026-09-03T15:00:00.000Z',
      '2026-09-03T17:00:00.000Z',
    ]);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('courtAvailability', () => {
  const now = '2026-09-03T15:30:00.000Z';
  it('reports a court busy while a blocking reservation spans now', () => {
    const [c1] = courtAvailability(['c1'], [row({ id: 'r1' })], now);
    expect(c1).toMatchObject({
      state: 'busy',
      untilAt: '2026-09-03T16:00:00.000Z',
      reservationId: 'r1',
    });
  });
  it('reports free with the next start, ignoring cancelled rows and other courts', () => {
    const rows = [
      row({ id: 'gone', status: 'cancelled' }),
      row({ id: 'other', court_id: 'c2' }),
      row({ id: 'next', start_at: '2026-09-03T18:00:00.000Z', end_at: '2026-09-03T19:00:00.000Z' }),
      row({
        id: 'later',
        start_at: '2026-09-03T20:00:00.000Z',
        end_at: '2026-09-03T21:00:00.000Z',
      }),
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
  it('withholds no_show and completed before the booking starts (0071 / SEC-11)', () => {
    // Both statuses leave the reservation exclusion set, so writing either on a
    // future booking frees a paid slot for resale. The server refuses them with
    // RESERVATION_NOT_STARTED; the desk must not offer the button.
    const now = new Date('2026-09-06T12:00:00.000Z');
    const future = '2026-09-06T18:00:00.000Z';
    const started = '2026-09-06T11:00:00.000Z';

    expect(allowedMarks('confirmed', future, now)).toEqual(['arrived']);
    expect(allowedMarks('confirmed', started, now)).toEqual(['arrived', 'completed', 'no_show']);
    expect(allowedMarks('arrived', future, now)).toEqual([]);
    expect(allowedMarks('arrived', started, now)).toEqual(['completed']);

    // Exactly at start_at the booking HAS started: the guard is `now < start_at`.
    expect(allowedMarks('confirmed', now.toISOString(), now)).toEqual([
      'arrived',
      'completed',
      'no_show',
    ]);
  });
  it('classifies rule refusals apart from failures', () => {
    expect(isOverrideRefusal('NOT_MOVABLE')).toBe(true);
    expect(isOverrideRefusal('FORBIDDEN')).toBe(true);
    expect(isOverrideRefusal('RESERVATION_NOT_STARTED')).toBe(true);
    expect(isOverrideRefusal('SLOT_TAKEN')).toBe(false);
    expect(isOverrideRefusal(undefined)).toBe(false);
  });
});

describe('sanitizePhone', () => {
  it('drops letters, keeps the punctuation a number is written with', () => {
    expect(sanitizePhone('+964 (770) 123-4567')).toBe('+964 (770) 123-4567');
    expect(sanitizePhone('077abc0123456')).toBe('0770123456');
    expect(sanitizePhone('Ahmed')).toBe('');
  });

  it('folds Arabic-Indic and Persian digits to the ASCII the API stores', () => {
    expect(sanitizePhone('٠٧٧٠١٢٣٤٥٦')).toBe('0770123456');
    expect(sanitizePhone('۰۷۷۹')).toBe('0779');
  });

  it('counts only the digits', () => {
    expect(phoneDigitCount('+964 (770) 123-4567')).toBe(13);
    expect(phoneDigitCount('')).toBe(0);
    expect(phoneDigitCount('++ -- ()')).toBe(0);
  });
});

describe('sanitizeName', () => {
  it('takes the digits out and leaves the name alone', () => {
    expect(sanitizeName('Ahmed Al-Rawi')).toBe('Ahmed Al-Rawi');
    expect(sanitizeName("O'Neill")).toBe("O'Neill");
    expect(sanitizeName('أحمد الراوي')).toBe('أحمد الراوي');
    expect(sanitizeName('Ahmed 0770123456')).toBe('Ahmed ');
  });

  it('catches Arabic-Indic and Persian digits too', () => {
    expect(sanitizeName('أحمد ٠٧٧٠')).toBe('أحمد ');
    expect(sanitizeName('۰۷')).toBe('');
  });
});

describe('splitting a customer search between the name and phone boxes', () => {
  it('sends a name to one box and nothing to the other', () => {
    expect(nameFromQuery('Ahmed Al-Rawi')).toBe('Ahmed Al-Rawi');
    // The hyphen in "Al-Rawi" is legal phone punctuation; it is not a number.
    expect(phoneFromQuery('Ahmed Al-Rawi')).toBe('');
  });

  it('sends a number to one box and nothing to the other', () => {
    expect(phoneFromQuery('0770 123 4567')).toBe('0770 123 4567');
    // The spaces between the groups are all that survives sanitizing.
    expect(nameFromQuery('0770 123 4567')).toBe('');
    expect(phoneFromQuery('+964 770 123 4567')).toBe('+964 770 123 4567');
  });

  it('splits a query that holds both', () => {
    expect(nameFromQuery('Ahmed 0770123456')).toBe('Ahmed');
    expect(phoneFromQuery('Ahmed 0770123456')).toBe('0770123456');
    expect(phoneFromQuery('Al-Rawi 0770123456')).toBe('0770123456');
  });

  it('reads Arabic either way round', () => {
    expect(nameFromQuery('أحمد')).toBe('أحمد');
    expect(phoneFromQuery('أحمد')).toBe('');
    expect(phoneFromQuery('٠٧٧٠١٢٣')).toBe('0770123');
  });

  it('gives both boxes nothing for a query that is neither', () => {
    expect(nameFromQuery('   ')).toBe('');
    expect(phoneFromQuery('   ')).toBe('');
    expect(nameFromQuery('--')).toBe('');
    expect(phoneFromQuery('--')).toBe('');
  });
});
