import { describe, expect, it } from 'vitest';
import {
  allowedMarks,
  arrivalsDue,
  blockRangeInvalid,
  canMoveReservation,
  courtAvailability,
  durationsFitting,
  groupByStart,
  isOverrideRefusal,
  isVisible,
  nameFromQuery,
  nightSummary,
  packLanes,
  phoneDigitCount,
  phoneFromQuery,
  rowIndexOf,
  sanitizeName,
  sanitizePhone,
  slotTaken,
  sortByStartDesc,
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

describe('sortByStartDesc', () => {
  it('puts the latest start first and keeps courts in order within a start', () => {
    const sorted = sortByStartDesc([
      row({ id: 'early', start_at: '2026-09-03T13:00:00.000Z' }),
      row({ id: 'b', court_id: 'c2' }),
      row({ id: 'late', start_at: '2026-09-03T17:00:00.000Z' }),
      row({ id: 'a', court_id: 'c1' }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['late', 'a', 'b', 'early']);
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

describe('arrivalsDue', () => {
  const now = '2026-09-03T15:10:00.000Z';
  const horizon = '2026-09-03T16:10:00.000Z';
  it('splits confirmed bookings into late (started, not arrived) and due within the horizon', () => {
    const out = arrivalsDue(
      [
        row({ id: 'late' }), // 15:00–16:00, started ten minutes ago
        row({ id: 'soon', start_at: '2026-09-03T16:00:00.000Z', end_at: '2026-09-03T17:00:00.000Z' }),
        row({ id: 'here', status: 'arrived' }),
        row({ id: 'far', start_at: '2026-09-03T19:00:00.000Z', end_at: '2026-09-03T20:00:00.000Z' }),
        row({ id: 'over', start_at: '2026-09-03T13:00:00.000Z', end_at: '2026-09-03T14:00:00.000Z' }),
        row({ id: 'block', kind: 'maintenance' }),
      ],
      now,
      horizon,
    );
    expect(out.late.map((r) => r.id)).toEqual(['late']);
    // Guests already here are done, not due: they are not on the to-do list.
    expect(out.soon.map((r) => r.id)).toEqual(['soon']);
  });
});

describe('nightSummary', () => {
  it('counts bookings only, arrivals (completed included) and confirmed bookings still to start', () => {
    const now = '2026-09-03T15:30:00.000Z';
    expect(
      nightSummary(
        [
          row({ id: 'a', status: 'arrived' }),
          row({ id: 'b', status: 'completed' }),
          row({ id: 'c', start_at: '2026-09-03T18:00:00.000Z' }),
          row({ id: 'd' }), // started, not here
          row({ id: 'm', kind: 'maintenance' }),
        ],
        now,
      ),
    ).toEqual({ bookings: 4, arrived: 2, toCome: 1 });
  });
});

describe('slotTaken', () => {
  const at = (iso: string) => Date.parse(iso);
  const rows = [row({ id: 'r1' }), row({ id: 'gone', status: 'cancelled', start_at: '2026-09-03T17:00:00.000Z', end_at: '2026-09-03T18:00:00.000Z' })];
  it('reports an overlap on the same court with a reservation that holds it', () => {
    expect(slotTaken(rows, 'c1', at('2026-09-03T15:30:00Z'), at('2026-09-03T16:30:00Z'))).toBe(true);
    // Touching ends do not overlap.
    expect(slotTaken(rows, 'c1', at('2026-09-03T16:00:00Z'), at('2026-09-03T17:00:00Z'))).toBe(false);
    expect(slotTaken(rows, 'c2', at('2026-09-03T15:30:00Z'), at('2026-09-03T16:30:00Z'))).toBe(false);
  });
  it('ignores cancelled rows and the reservation being edited', () => {
    expect(slotTaken(rows, 'c1', at('2026-09-03T17:00:00Z'), at('2026-09-03T18:00:00Z'))).toBe(false);
    expect(slotTaken(rows, 'c1', at('2026-09-03T15:30:00Z'), at('2026-09-03T16:30:00Z'), 'r1')).toBe(false);
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

describe('packLanes', () => {
  const at = (h: number, m = 0) => `2026-09-03T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;

  it('gives a court with no overlap one full-width lane each', () => {
    const got = packLanes([
      row({ id: 'a', start_at: at(15), end_at: at(16) }),
      row({ id: 'b', start_at: at(16), end_at: at(17) }),
    ]);
    expect(got.get('a')).toEqual({ lane: 0, lanes: 1 });
    expect(got.get('b')).toEqual({ lane: 0, lanes: 1 });
  });

  it('puts two overlapping bookings side by side', () => {
    // The screenshot's case: 21:00-22:00 under 21:30-22:30.
    const got = packLanes([
      row({ id: 'a', start_at: at(21), end_at: at(22) }),
      row({ id: 'b', start_at: at(21, 30), end_at: at(22, 30) }),
    ]);
    expect(got.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(got.get('b')).toEqual({ lane: 1, lanes: 2 });
  });

  it('gives a triple booking three lanes', () => {
    const got = packLanes([
      row({ id: 'a', start_at: at(20), end_at: at(22) }),
      row({ id: 'b', start_at: at(20, 30), end_at: at(21, 30) }),
      row({ id: 'c', start_at: at(21), end_at: at(23) }),
    ]);
    expect(got.get('a')).toEqual({ lane: 0, lanes: 3 });
    expect(got.get('b')).toEqual({ lane: 1, lanes: 3 });
    expect(got.get('c')).toEqual({ lane: 2, lanes: 3 });
  });

  it('reuses a lane once it is free inside one cluster', () => {
    const got = packLanes([
      row({ id: 'a', start_at: at(20), end_at: at(21) }),
      row({ id: 'b', start_at: at(20, 30), end_at: at(22) }),
      row({ id: 'c', start_at: at(21), end_at: at(22) }),
    ]);
    // c starts when a ends, so it takes a's lane rather than opening a third.
    expect(got.get('c')?.lane).toBe(0);
    expect(got.get('c')?.lanes).toBe(2);
  });

  it('keeps a lone booking full width when another hour is double-booked', () => {
    const got = packLanes([
      row({ id: 'lone', start_at: at(18), end_at: at(19) }),
      row({ id: 'a', start_at: at(21), end_at: at(22) }),
      row({ id: 'b', start_at: at(21, 30), end_at: at(22, 30) }),
    ]);
    expect(got.get('lone')).toEqual({ lane: 0, lanes: 1 });
    expect(got.get('a')?.lanes).toBe(2);
  });

  it('does not overlap rows that merely touch', () => {
    const got = packLanes([
      row({ id: 'a', start_at: at(15), end_at: at(16) }),
      row({ id: 'b', start_at: at(16), end_at: at(17) }),
      row({ id: 'c', start_at: at(17), end_at: at(18) }),
    ]);
    expect([...got.values()].every((l) => l.lanes === 1)).toBe(true);
  });

  it('is stable whatever order the rows arrive in', () => {
    const rows = [
      row({ id: 'a', start_at: at(21), end_at: at(22) }),
      row({ id: 'b', start_at: at(21, 30), end_at: at(22, 30) }),
    ];
    expect(packLanes(rows)).toEqual(packLanes([...rows].reverse()));
  });
});

describe('durationsFitting', () => {
  const CLOSE = 26 * 60; // 02:00, the night after a 17:00 open.

  it('offers every length in the middle of the night', () => {
    expect(durationsFitting([60, 90, 120], 20 * 60, CLOSE)).toEqual([60, 90, 120]);
  });

  it('offers only the half hour that fits in the last slot', () => {
    // 01:30 with a 02:00 close: the 60 that used to write 01:30-02:30 is gone.
    expect(durationsFitting([30, 60, 90], 25.5 * 60, CLOSE)).toEqual([30]);
  });

  it('offers nothing when the shortest game would run past the close', () => {
    // A court selling 60 upwards has nothing to sell in the last half hour;
    // the dialog blocks rather than booking an overrun.
    expect(durationsFitting([60, 90], 25.5 * 60, CLOSE)).toEqual([]);
  });

  it('keeps a length that ends exactly at the close', () => {
    expect(durationsFitting([60, 90], 25 * 60, CLOSE)).toEqual([60]);
  });

  it('drops the lengths that overrun and keeps the rest', () => {
    expect(durationsFitting([60, 90, 120], 24 * 60, CLOSE)).toEqual([60, 90, 120]);
    expect(durationsFitting([60, 90, 120], 24.5 * 60, CLOSE)).toEqual([60, 90]);
  });



  it('sorts a court list that is stored out of order', () => {
    expect(durationsFitting([120, 60, 90], 20 * 60, CLOSE)).toEqual([60, 90, 120]);
  });
});

describe('rowIndexOf', () => {
  // A night trading 09:00 -> 02:00, drawn in 30-minute rows.
  const OPEN = 9 * 60;
  const SLOT = 30;
  const ROW_COUNT = Math.ceil((26 * 60 - OPEN) / SLOT);
  // Midnight of the calendar date, in a zone with no offset so the test states
  // the wall clock it means.
  const dayStart = Date.UTC(2026, 8, 23);
  const at = (h: number, m = 0) => new Date(dayStart + (h * 60 + m) * 60_000).toISOString();
  const row = (iso: string) => rowIndexOf(iso, dayStart, OPEN, SLOT);

  it('puts the opening slot in the first row', () => {
    expect(row(at(9))).toBe(0);
  });

  it('counts rows forward through the evening', () => {
    expect(row(at(12, 30))).toBe(7);
    expect(row(at(16))).toBe(14);
  });

  it('places the after-midnight tail at the BOTTOM of the night, not the top', () => {
    // The regression: measured against midnight these are negative, and the
    // caller's Math.max(0, ...) clamped them onto the 09:00 row, painting the
    // block over the morning and pushing the free slots under it out of line
    // with the time gutter.
    expect(row(at(0, 30))).toBe(31);
    expect(row(at(1, 30))).toBe(33);
    expect(row(at(0, 30))).toBeLessThan(ROW_COUNT);
  });

  it('reports a start past the close as off the grid rather than clamping it', () => {
    // 03:34, the block from the bug report: not on this night's grid at all,
    // so the caller filters it out instead of drawing it at 09:00.
    expect(row(at(3, 34))).toBeGreaterThanOrEqual(ROW_COUNT);
  });

  it('keeps a start inside a row in that row', () => {
    expect(row(at(9, 29))).toBe(0);
    expect(row(at(9, 30))).toBe(1);
  });
});

describe('canMoveReservation', () => {
  // The fixture runs 15:00-16:00 UTC on 2026-09-03.
  const during = new Date('2026-09-03T15:30:00.000Z').getTime();
  const before = new Date('2026-09-03T14:00:00.000Z').getTime();
  const after = new Date('2026-09-03T18:00:00.000Z').getTime();

  it('refuses a checked-in booking whose slot has started', () => {
    const r = row({ id: 'playing', status: 'arrived' });
    expect(canMoveReservation(r, during)).toBe(false);
    expect(canMoveReservation(r, after)).toBe(false);
  });

  it('allows an early check-in that has not started yet', () => {
    // The desk checks guests in before the hour; until the slot starts there
    // is still nothing being played, so the time may still change.
    expect(canMoveReservation(row({ id: 'early', status: 'arrived' }), before)).toBe(true);
  });

  it('allows a confirmed booking whether or not its slot has passed', () => {
    const r = row({ id: 'noshow-pending', status: 'confirmed' });
    expect(canMoveReservation(r, before)).toBe(true);
    expect(canMoveReservation(r, during)).toBe(true);
    expect(canMoveReservation(r, after)).toBe(true);
  });

  it('allows a pending hold-turned-booking and refuses terminal statuses', () => {
    expect(canMoveReservation(row({ id: 'p', status: 'pending' }), during)).toBe(true);
    for (const status of ['completed', 'cancelled', 'no_show', 'expired']) {
      expect(canMoveReservation(row({ id: status, status }), before)).toBe(false);
    }
  });

  it('refuses anything that is not a booking', () => {
    expect(canMoveReservation(row({ id: 'h', kind: 'hold', status: 'pending' }), before)).toBe(false);
    expect(canMoveReservation(row({ id: 'm', kind: 'maintenance', status: 'confirmed' }), before)).toBe(
      false,
    );
  });

  it('turns exactly at the start instant', () => {
    const start = new Date('2026-09-03T15:00:00.000Z').getTime();
    const r = row({ id: 'edge', status: 'arrived' });
    expect(canMoveReservation(r, start)).toBe(true);
    expect(canMoveReservation(r, start + 1)).toBe(false);
  });
});

describe('blockRangeInvalid', () => {
  it('refuses an end before the start', () => {
    // The reported case: 09:00 -> 08:00 used to become a 23-hour block.
    expect(blockRangeInvalid(9 * 60, 8 * 60)).toBe(true);
    expect(blockRangeInvalid(22 * 60, 2 * 60)).toBe(true);
  });

  it('refuses a zero-length block', () => {
    expect(blockRangeInvalid(9 * 60, 9 * 60)).toBe(true);
  });

  it('accepts a forward range', () => {
    expect(blockRangeInvalid(9 * 60, 11 * 60)).toBe(false);
    expect(blockRangeInvalid(0, 30)).toBe(false);
    expect(blockRangeInvalid(0, 24 * 60)).toBe(false);
  });

  it('does not judge a half-filled form', () => {
    // Missing is the required-field error; two messages under one empty box
    // would be the screen contradicting itself.
    expect(blockRangeInvalid(null, 8 * 60)).toBe(false);
    expect(blockRangeInvalid(9 * 60, null)).toBe(false);
    expect(blockRangeInvalid(null, null)).toBe(false);
  });
});
