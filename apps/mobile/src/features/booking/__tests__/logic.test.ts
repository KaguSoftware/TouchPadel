import { describe, expect, it } from 'vitest';
import { isDegradedRefusal, mapErrorToKey, rpcErrorCode } from '../errors';
import { canCancel, parseHoldResult, secondsUntil, splitBookings, type BookingRow } from '../logic';

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
    expect(secondsUntil(null, now)).toBe(0);
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

  it('splits live-future into upcoming, terminal/ended into past, hides holds', () => {
    const rows = [
      row({ id: 'up', status: 'confirmed' }),
      row({ id: 'cancelled', status: 'cancelled' }),
      row({
        id: 'ended',
        status: 'confirmed',
        start_at: '2026-08-30T10:00:00Z',
        end_at: '2026-08-30T11:00:00Z',
      }),
      row({ id: 'hold', kind: 'hold', status: 'pending' }),
    ];
    const { upcoming, past } = splitBookings(rows, now);
    expect(upcoming.map((r) => r.id)).toEqual(['up']);
    expect(past.map((r) => r.id)).toEqual(['cancelled', 'ended']);
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
