import { describe, expect, it } from 'vitest';
import { isDegradedRefusal, mapErrorToKey, rpcErrorCode } from '../errors';
import {
  calendarDaysBetween,
  canCancel,
  dayPart,
  cancelActor,
  cancelActorLabel,
  cancelledBookings,
  endedNotice,
  enteredHistoryAt,
  isCourtFeePaid,
  isLiveHold,
  parseHoldResult,
  playedCount,
  playedGames,
  secondsUntil,
  splitBookings,
  startProximity,
  visiblePast,
  type BookingRow,
} from '../logic';

describe('error mapping', () => {
  it('maps RPC codes to i18n keys', () => {
    expect(mapErrorToKey(new Error('SLOT_TAKEN'))).toBe('booking.slotTaken');
    expect(mapErrorToKey(new Error('HOLD_EXPIRED'))).toBe('booking.holdExpired');
    expect(mapErrorToKey(new Error('CANCELLATION_WINDOW'))).toBe('booking.cancellationWindow');
    expect(mapErrorToKey(new Error('DEGRADED_LOCKOUT'))).toBe('degraded.bookingRefusedShort');
    expect(mapErrorToKey(new Error('AUTH_REQUIRED'))).toBe('auth.sessionExpired');
    expect(mapErrorToKey(new Error('NO_RATE'))).toBe('booking.noRate');
    expect(mapErrorToKey(new Error('PRICE_CHANGED'))).toBe('booking.priceChanged');
    expect(mapErrorToKey(new Error('SLOT_IN_PAST'))).toBe('booking.slotInPast');
    expect(mapErrorToKey(new Error('PIN_INVALID'))).toBe('auth.pinInvalid');
    // 0048/C1 + 0058 — all four used to fall through to 'errors.generic'.
    expect(mapErrorToKey(new Error('HOLD_QUOTA_EXCEEDED'))).toBe('booking.holdQuota');
    expect(mapErrorToKey(new Error('BEYOND_HORIZON'))).toBe('booking.beyondHorizon');
    expect(mapErrorToKey(new Error('ACCOUNT_REQUIRED'))).toBe('booking.accountRequired');
    expect(mapErrorToKey(new Error('NOT_A_HOLD'))).toBe('booking.notAHold');
  });

  it('finds codes embedded in longer messages', () => {
    expect(rpcErrorCode('error: SLOT_TAKEN (reservations_no_overlap)')).toBe('SLOT_TAKEN');
    expect(mapErrorToKey({ message: 'CANCELLATION_WINDOW: inside the window' })).toBe(
      'booking.cancellationWindow',
    );
  });

  it('maps network-ish failures to errors.network and everything else to generic', () => {
    expect(mapErrorToKey(new TypeError('Network request failed'))).toBe('errors.network');
    expect(mapErrorToKey(new Error('fetch failed'))).toBe('errors.network');
    expect(mapErrorToKey(new Error('boom'))).toBe('errors.generic');
    expect(mapErrorToKey(undefined)).toBe('errors.generic');
  });

  it('detects the degraded refusal distinctly', () => {
    expect(isDegradedRefusal('DEGRADED_LOCKOUT')).toBe(true);
    expect(isDegradedRefusal('SLOT_TAKEN')).toBe(false);
  });
});

describe('parseHoldResult', () => {
  it('parses the app.hold_slot jsonb payload', () => {
    const parsed = parseHoldResult({
      duplicate: false,
      reservation_id: 'r-1',
      hold_expires_at: '2026-09-01T10:05:00Z',
      rate_rule_id: 'rule-1',
      price_iqd: 40000,
    });
    expect(parsed).toEqual({
      duplicate: false,
      reservationId: 'r-1',
      holdExpiresAt: '2026-09-01T10:05:00Z',
      rateRuleId: 'rule-1',
      priceIqd: 40000,
    });
  });

  it('tolerates the duplicate-replay shape (no price fields)', () => {
    const parsed = parseHoldResult({
      duplicate: true,
      reservation_id: 'r-1',
      status: 'pending',
      hold_expires_at: '2026-09-01T10:05:00Z',
    });
    expect(parsed.duplicate).toBe(true);
    expect(parsed.priceIqd).toBeNull();
  });

  it('throws on malformed payloads', () => {
    expect(() => parseHoldResult(null)).toThrow('MALFORMED_HOLD_RESULT');
    expect(() => parseHoldResult({})).toThrow('MALFORMED_HOLD_RESULT');
  });
});

describe('secondsUntil', () => {
  it('counts whole seconds and clamps at zero', () => {
    const now = new Date('2026-09-01T10:00:00Z');
    expect(secondsUntil('2026-09-01T10:00:30Z', now)).toBe(30);
    expect(secondsUntil('2026-09-01T09:59:00Z', now)).toBe(0);
  });

  it('distinguishes "no deadline" (null) from "deadline passed" (0)', () => {
    // app.hold_slot returns hold_expires_at = null on the duplicate-replay path;
    // treating that as 0 rendered Review as HOLD EXPIRED the instant it opened.
    const now = new Date('2026-09-01T10:00:00Z');
    expect(secondsUntil(null, now)).toBeNull();
    expect(secondsUntil('', now)).toBeNull();
    expect(secondsUntil('not-a-date', now)).toBeNull();
  });
});

const row = (over: Partial<BookingRow>): BookingRow => ({
  id: 'id',
  court_id: 'c',
  kind: 'booking',
  status: 'confirmed',
  start_at: '2026-09-02T10:00:00Z',
  end_at: '2026-09-02T11:00:00Z',
  price_iqd: 40000,
  ...over,
});

describe('splitBookings', () => {
  const now = new Date('2026-09-01T12:00:00Z');

  it('splits live-future into upcoming, terminal/ended into past, holds into their own list', () => {
    const rows = [
      row({ id: 'up', status: 'confirmed' }),
      row({ id: 'cancelled', status: 'cancelled' }),
      row({
        id: 'ended',
        status: 'confirmed',
        start_at: '2026-08-30T10:00:00Z',
        end_at: '2026-08-30T11:00:00Z',
      }),
      row({
        id: 'hold',
        kind: 'hold',
        status: 'pending',
        hold_expires_at: '2026-09-01T12:04:00Z',
      }),
    ];
    const { holds, upcoming, past } = splitBookings(rows, now);
    expect(holds.map((r) => r.id)).toEqual(['hold']);
    expect(upcoming.map((r) => r.id)).toEqual(['up']);
    expect(past.map((r) => r.id)).toEqual(['cancelled', 'ended']);
  });

  /**
   * The bug this section exists for: a guest with three abandoned holds saw an
   * empty Bookings tab and an unexplained HOLD_QUOTA_EXCEEDED on the fourth tap.
   */
  it('surfaces every live hold, soonest first, and nothing that is spent', () => {
    const hold = (id: string, over: Partial<BookingRow>) =>
      row({ id, kind: 'hold', status: 'pending', hold_expires_at: '2026-09-01T12:05:00Z', ...over });
    const rows = [
      hold('h2', { start_at: '2026-09-02T14:00:00Z', end_at: '2026-09-02T15:00:00Z' }),
      hold('h1', { start_at: '2026-09-02T10:00:00Z', end_at: '2026-09-02T11:00:00Z' }),
      hold('swept', { status: 'expired' }),
      hold('released', { status: 'cancelled' }),
      hold('past-ttl', { hold_expires_at: '2026-09-01T11:59:00Z' }),
      hold('no-ttl', { hold_expires_at: null }),
    ];
    const { holds, upcoming, past } = splitBookings(rows, now);
    expect(holds.map((r) => r.id)).toEqual(['h1', 'h2']);
    // A hold is never a booking to look back on, live or spent.
    expect(upcoming).toEqual([]);
    expect(past).toEqual([]);
  });

  it('orders upcoming soonest-first and past most-recent-first', () => {
    const rows = [
      row({ id: 'b', start_at: '2026-09-03T10:00:00Z', end_at: '2026-09-03T11:00:00Z' }),
      row({ id: 'a', start_at: '2026-09-02T10:00:00Z', end_at: '2026-09-02T11:00:00Z' }),
      row({ id: 'old1', status: 'completed', start_at: '2026-08-01T10:00:00Z', end_at: '2026-08-01T11:00:00Z' }),
      row({ id: 'old2', status: 'completed', start_at: '2026-08-15T10:00:00Z', end_at: '2026-08-15T11:00:00Z' }),
    ];
    const { upcoming, past } = splitBookings(rows, now);
    expect(upcoming.map((r) => r.id)).toEqual(['a', 'b']);
    expect(past.map((r) => r.id)).toEqual(['old2', 'old1']);
  });
});

describe('isLiveHold', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  const hold = (over: Partial<BookingRow>) =>
    row({ kind: 'hold', status: 'pending', hold_expires_at: '2026-09-01T12:05:00Z', ...over });

  it('is true only for an unconfirmed hold whose TTL is still running', () => {
    expect(isLiveHold(hold({}), now)).toBe(true);
    // Still 'pending' in the table until the sweep runs — but gone for the guest.
    expect(isLiveHold(hold({ hold_expires_at: '2026-09-01T11:59:59Z' }), now)).toBe(false);
    expect(isLiveHold(hold({ status: 'expired' }), now)).toBe(false);
    expect(isLiveHold(hold({ hold_expires_at: null }), now)).toBe(false);
    expect(isLiveHold(hold({ hold_expires_at: 'not-a-date' }), now)).toBe(false);
    expect(isLiveHold(row({ status: 'confirmed' }), now)).toBe(false);
  });
});

describe('canCancel', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  it('mirrors the cancellation-window policy', () => {
    // starts in 22h, window 12h -> cancellable
    expect(canCancel(row({}), 12, now)).toBe(true);
    // starts in 22h, window 24h -> inside window
    expect(canCancel(row({}), 24, now)).toBe(false);
    // terminal status -> never
    expect(canCancel(row({ status: 'cancelled' }), 12, now)).toBe(false);
  });
});

describe('startProximity', () => {
  const TZ = 'Asia/Baghdad'; // UTC+3, no DST
  const now = new Date('2026-09-01T12:00:00Z');
  const at = (start: string, end = '2026-12-01T00:00:00Z') =>
    startProximity(row({ start_at: start, end_at: end }), now, TZ);

  it('counts down in minutes, then hours, then days', () => {
    expect(at('2026-09-01T12:20:00Z')).toEqual({ unit: 'minutes', value: 20 });
    expect(at('2026-09-01T15:00:00Z')).toEqual({ unit: 'hours', value: 3 });
    expect(at('2026-09-04T12:00:00Z')).toEqual({ unit: 'days', value: 3 });
  });

  it('hands off between steps with no gap', () => {
    // 59'40" rounds to 60 minutes, which is an hour — never "In 60 min".
    expect(at('2026-09-01T12:59:40Z')).toEqual({ unit: 'hours', value: 1 });
    // 23h50m rounds to 24 hours, which is a day — and 23h50m from 15:00
    // Baghdad lands on the NEXT venue date, so one day is also the calendar
    // answer. The two rules agree here; the case below is where they did not.
    expect(at('2026-09-02T11:50:00Z')).toEqual({ unit: 'days', value: 1 });
  });

  it('counts venue calendar days, not elapsed 24-hour blocks', () => {
    // The reported bug: 22 Sep 23:30 Baghdad -> 24 Sep 10:00 Baghdad is 34.5 h,
    // which rounds to one 24-hour block but is two nights on the venue's
    // calendar — and "24 Sep" is what the card prints beside this label.
    const late = new Date('2026-09-22T20:30:00Z'); // 23:30 Baghdad on the 22nd
    const row24 = row({ start_at: '2026-09-24T07:00:00Z' }); // 10:00 on the 24th
    expect(startProximity(row24, late, TZ)).toEqual({ unit: 'days', value: 2 });
  });

  it('resolves the day boundary in the venue zone, not UTC', () => {
    // 21:00 UTC on the 1st is already 00:00 on the 2nd in Baghdad, so the venue
    // dates are the 2nd -> the 3rd: ONE day. Counting the same two instants in
    // UTC gives the 1st -> the 3rd and answers two.
    const evening = new Date('2026-09-01T21:00:00Z');
    const start = row({ start_at: '2026-09-03T17:00:00Z' }); // 20:00 Baghdad
    expect(startProximity(start, evening, TZ)).toEqual({ unit: 'days', value: 1 });
  });

  it('does not move with the device timezone', () => {
    const late = new Date('2026-09-22T20:30:00Z');
    const row24 = row({ start_at: '2026-09-24T07:00:00Z' });
    const expected = { unit: 'days', value: 2 };
    // Same instants, same venue zone: the answer is a property of the venue's
    // calendar and the guest's own zone is not an input.
    expect(startProximity(row24, late, TZ)).toEqual(expected);
    expect(startProximity(row24, late, 'Asia/Baghdad')).toEqual(expected);
  });

  it('never claims less than a day once past the hours step', () => {
    // 24h05m out but the same venue date would still be a day, never zero.
    expect(at('2026-09-02T12:05:00Z')).toEqual({ unit: 'days', value: 1 });
  });

  it('is "now" inside the last minute and "live" once it has started', () => {
    expect(at('2026-09-01T12:00:30Z')).toEqual({ unit: 'now' });
    expect(at('2026-09-01T11:30:00Z', '2026-09-01T13:00:00Z')).toEqual({ unit: 'live' });
    expect(at('not-a-date')).toEqual({ unit: 'live' });
  });
});

describe('calendarDaysBetween', () => {
  it('counts whole days across months and years', () => {
    expect(calendarDaysBetween('2026-09-22', '2026-09-24')).toBe(2);
    expect(calendarDaysBetween('2026-09-30', '2026-10-01')).toBe(1);
    expect(calendarDaysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(calendarDaysBetween('2026-09-22', '2026-09-22')).toBe(0);
  });

  it('returns 0 for anything that is not a calendar date', () => {
    expect(calendarDaysBetween('nope', '2026-09-24')).toBe(0);
    expect(calendarDaysBetween('2026-9-2', '2026-09-24')).toBe(0);
  });
});

describe('playedGames / playedCount', () => {
  const past = [
    row({ id: 'done', status: 'completed' }),
    row({ id: 'in', status: 'arrived' }),
    row({ id: 'off', status: 'cancelled' }),
    row({ id: 'noshow', status: 'no_show' }),
    row({ id: 'lapsed', status: 'expired' }),
  ];

  it('counts only bookings the guest turned up for', () => {
    expect(playedCount(past)).toBe(2);
  });

  // The Played tab lists exactly what its chip counts: if these two ever
  // disagreed, the heading would promise rows the list does not have.
  it('lists the same games it counts, in the order given', () => {
    expect(playedGames(past).map((r) => r.id)).toEqual(['done', 'in']);
    expect(playedGames(past)).toHaveLength(playedCount(past));
  });

  it('keeps the source list untouched', () => {
    const games = playedGames(past);
    games.pop();
    expect(past).toHaveLength(5);
  });

  // The Cancelled tab takes cancellations and ONLY cancellations: a no-show or
  // a lapsed hold under a heading that says Cancelled would be a row whose own
  // badge contradicts it.
  it('lists cancellations without no-shows or lapsed holds', () => {
    expect(cancelledBookings(past).map((r) => r.id)).toEqual(['off']);
  });
});

describe('endedNotice', () => {
  it('explains every ending the guest did not ask for', () => {
    expect(endedNotice('cancelled')).toBe('booking.cancelledNotice');
    // The two that used to render nothing at all.
    expect(endedNotice('no_show')).toBe('booking.noShowNotice');
    expect(endedNotice('expired')).toBe('booking.expiredNotice');
  });

  // 0088. The venue taking a court back and the guest's own tap land on the
  // identical badge, and only one of them is worth a call to the desk.
  it('names who cancelled it when the actor was recorded', () => {
    expect(endedNotice('cancelled', 'guest')).toBe('booking.cancelledByYouNotice');
    expect(endedNotice('cancelled', 'staff')).toBe('booking.cancelledByVenueNotice');
  });

  // An actor nobody stored, and a value this build has never heard of, are the
  // same thing: not known. Both keep the sentence that claims nothing.
  it('falls back to the plain notice when the actor is unknown', () => {
    for (const by of [null, undefined, '', 'system']) {
      expect(endedNotice('cancelled', by)).toBe('booking.cancelledNotice');
    }
  });

  it('says nothing about a booking that is still live, or one that was played', () => {
    for (const status of ['pending', 'confirmed', 'arrived', 'completed']) {
      expect(endedNotice(status)).toBeNull();
    }
  });
});

describe('cancelActor (0088)', () => {
  it('reads the recorded actor off a cancelled row', () => {
    expect(cancelActor(row({ status: 'cancelled', cancelled_by: 'guest' }))).toBe('guest');
    expect(cancelActor(row({ status: 'cancelled', cancelled_by: 'staff' }))).toBe('staff');
  });

  // A no-show stamps cancelled_at (0075) but nobody cancelled it, so it must
  // never pick up a caption saying somebody did.
  it('is null for anything that was not cancelled, whatever the column says', () => {
    for (const status of ['pending', 'confirmed', 'arrived', 'completed', 'no_show', 'expired']) {
      expect(cancelActor(row({ status, cancelled_by: 'staff' }))).toBeNull();
    }
  });

  it('is null when the actor was never recorded or is not one this build knows', () => {
    expect(cancelActor(row({ status: 'cancelled' }))).toBeNull();
    expect(cancelActor(row({ status: 'cancelled', cancelled_by: null }))).toBeNull();
    expect(cancelActor(row({ status: 'cancelled', cancelled_by: 'system' }))).toBeNull();
  });

  it('captions a row only when it can name somebody', () => {
    expect(cancelActorLabel(row({ status: 'cancelled', cancelled_by: 'guest' }))).toBe(
      'booking.cancelledByYou',
    );
    expect(cancelActorLabel(row({ status: 'cancelled', cancelled_by: 'staff' }))).toBe(
      'booking.cancelledByVenue',
    );
    expect(cancelActorLabel(row({ status: 'cancelled' }))).toBeNull();
    expect(cancelActorLabel(row({ status: 'completed', cancelled_by: 'staff' }))).toBeNull();
  });
});

describe('visiblePast (Clear history)', () => {
  const rows = [
    row({ id: 'after', end_at: '2026-09-02T11:00:00Z' }),
    row({ id: 'boundary', end_at: '2026-09-01T12:00:00Z' }),
    row({ id: 'before', end_at: '2026-08-20T11:00:00Z' }),
  ];

  it('shows everything when history has never been cleared', () => {
    expect(visiblePast(rows, null).map((r) => r.id)).toEqual(['after', 'boundary', 'before']);
  });

  it('hides games that had already ENDED when history was cleared', () => {
    // The boundary goes: a game that ended exactly at the cut is history.
    expect(visiblePast(rows, '2026-09-01T12:00:00Z').map((r) => r.id)).toEqual(['after']);
  });

  it('falls back to showing everything on an unreadable cut', () => {
    // A corrupted storage value must not blank the list.
    expect(visiblePast(rows, 'not-a-date')).toHaveLength(3);
  });

  it('never mutates the list it was given', () => {
    const original = [...rows];
    visiblePast(rows, '2026-09-01T12:00:00Z');
    expect(rows).toEqual(original);
  });

  it('hides a booking CANCELLED before the cut, though its slot is still ahead', () => {
    // THE BUG: splitBookings files a cancelled booking under past the moment it
    // is cancelled, but the cut used to be judged on end_at -- which is next
    // Tuesday. So the row survived every clear, and the button looked broken.
    const cancelledEarly = row({
      id: 'called-off',
      status: 'cancelled',
      end_at: '2026-09-08T11:00:00Z', // a week AFTER the cut
      cancelled_at: '2026-08-30T09:00:00Z', // but called off before it
    });
    expect(visiblePast([cancelledEarly], '2026-09-01T12:00:00Z')).toEqual([]);
  });

  it('keeps a booking cancelled AFTER the cut', () => {
    // New history since the guest tidied up: it has to show, or clearing once
    // would silence every future cancellation too.
    const cancelledLate = row({
      id: 'called-off-later',
      status: 'cancelled',
      end_at: '2026-09-08T11:00:00Z',
      cancelled_at: '2026-09-03T09:00:00Z',
    });
    expect(visiblePast([cancelledLate], '2026-09-01T12:00:00Z').map((r) => r.id)).toEqual([
      'called-off-later',
    ]);
  });

  it('still judges a played game on when it ended', () => {
    // completed also stamps cancelled_at (0075), a little AFTER the slot ends.
    // The earlier of the two is when it became history, so this stays hidden.
    const played = row({
      id: 'played',
      status: 'completed',
      end_at: '2026-08-20T11:00:00Z',
      cancelled_at: '2026-08-20T11:05:00Z',
    });
    expect(visiblePast([played], '2026-09-01T12:00:00Z')).toEqual([]);
  });

  it('falls back to end_at for a terminal row with no cancelled_at', () => {
    // Pre-0075 rows, and anything a cache handed back before the RPC carried
    // the column: judged exactly as they were before.
    const old = row({ id: 'legacy', status: 'cancelled', end_at: '2026-09-08T11:00:00Z' });
    expect(visiblePast([old], '2026-09-01T12:00:00Z').map((r) => r.id)).toEqual(['legacy']);
  });
});

describe('enteredHistoryAt', () => {
  const ms = (iso: string) => new Date(iso).getTime();

  it('is the slot end when nothing closed the booking early', () => {
    expect(enteredHistoryAt(row({ end_at: '2026-09-02T11:00:00Z' }))).toBe(ms('2026-09-02T11:00:00Z'));
  });

  it('is the cancellation when that came first', () => {
    const r = row({ end_at: '2026-09-08T11:00:00Z', cancelled_at: '2026-08-30T09:00:00Z' });
    expect(enteredHistoryAt(r)).toBe(ms('2026-08-30T09:00:00Z'));
  });

  it('is the slot end when the desk closed it afterwards', () => {
    const r = row({ end_at: '2026-09-02T11:00:00Z', cancelled_at: '2026-09-02T11:05:00Z' });
    expect(enteredHistoryAt(r)).toBe(ms('2026-09-02T11:00:00Z'));
  });

  it('ignores an unparseable cancelled_at rather than returning NaN', () => {
    const r = row({ end_at: '2026-09-02T11:00:00Z', cancelled_at: 'not-a-date' });
    expect(enteredHistoryAt(r)).toBe(ms('2026-09-02T11:00:00Z'));
  });
});

describe('isCourtFeePaid', () => {
  it('is paid only when something was taken AND nothing is left', () => {
    expect(isCourtFeePaid(row({ court_paid_iqd: 30000, court_remaining_iqd: 0 }))).toBe(true);
  });

  it('is not paid while any of the fee is still owed', () => {
    expect(isCourtFeePaid(row({ court_paid_iqd: 10000, court_remaining_iqd: 20000 }))).toBe(false);
    expect(isCourtFeePaid(row({ court_paid_iqd: 0, court_remaining_iqd: 30000 }))).toBe(false);
  });

  it('does not read a pending booking as paid', () => {
    // court_fee_remaining answers 0 for a booking nobody confirmed, so
    // "nothing remaining" alone would put "payment received" on a slot no one
    // has paid for. Nothing taken means not paid.
    expect(isCourtFeePaid(row({ status: 'pending', court_paid_iqd: 0, court_remaining_iqd: 0 }))).toBe(
      false,
    );
  });

  it('treats an unknown figure as unpaid', () => {
    // A cached payload from before 0150 knows neither number. The guest is
    // shown how to pay, which is the safe way to be wrong.
    expect(isCourtFeePaid(row({}))).toBe(false);
    expect(isCourtFeePaid(row({ court_paid_iqd: 30000 }))).toBe(false);
    expect(isCourtFeePaid(row({ court_remaining_iqd: 0 }))).toBe(false);
    expect(isCourtFeePaid(row({ court_paid_iqd: null, court_remaining_iqd: null }))).toBe(false);
  });
});

describe('dayPart', () => {
  const TZ = 'Asia/Baghdad'; // UTC+3

  it('turns to evening at 17:00 venue time', () => {
    expect(dayPart(new Date('2026-09-23T13:59:00Z'), TZ)).toBe('day'); // 16:59
    expect(dayPart(new Date('2026-09-23T14:00:00Z'), TZ)).toBe('evening'); // 17:00
  });

  it('reads the venue clock, not the phone clock', () => {
    // 21:00 UTC is midnight in Baghdad: the venue is in its small hours, which
    // is 'day' by this split, however late it is where the guest is reading.
    expect(dayPart(new Date('2026-09-23T21:00:00Z'), TZ)).toBe('day');
  });
});
