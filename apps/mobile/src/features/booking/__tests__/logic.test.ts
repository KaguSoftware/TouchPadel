import { describe, expect, it } from 'vitest';
import { isDegradedRefusal, mapErrorToKey, rpcErrorCode } from '../errors';
import {
  canCancel,
  cancelActor,
  cancelActorLabel,
  cancelledBookings,
  endedNotice,
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
  const now = new Date('2026-09-01T12:00:00Z');
  const at = (start: string, end = '2026-12-01T00:00:00Z') =>
    startProximity(row({ start_at: start, end_at: end }), now);

  it('counts down in minutes, then hours, then days', () => {
    expect(at('2026-09-01T12:20:00Z')).toEqual({ unit: 'minutes', value: 20 });
    expect(at('2026-09-01T15:00:00Z')).toEqual({ unit: 'hours', value: 3 });
    expect(at('2026-09-04T12:00:00Z')).toEqual({ unit: 'days', value: 3 });
  });

  it('hands off between steps with no gap', () => {
    // 59'40" rounds to 60 minutes, which is an hour — never "In 60 min".
    expect(at('2026-09-01T12:59:40Z')).toEqual({ unit: 'hours', value: 1 });
    // 23h50m rounds to 24 hours, which is a day — never "In 24 h".
    expect(at('2026-09-02T11:50:00Z')).toEqual({ unit: 'days', value: 1 });
  });

  it('is "now" inside the last minute and "live" once it has started', () => {
    expect(at('2026-09-01T12:00:30Z')).toEqual({ unit: 'now' });
    expect(at('2026-09-01T11:30:00Z', '2026-09-01T13:00:00Z')).toEqual({ unit: 'live' });
    expect(at('not-a-date')).toEqual({ unit: 'live' });
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
});
