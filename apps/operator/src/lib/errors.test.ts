import { describe, expect, it } from 'vitest';
import { t } from '@touch/i18n';
import { AppRpcError, toAppRpcError } from './appRpc';
import { EdgeError } from './edge';
import { MAPPED_CODES, errorCodeToMessageKey, errorToMessageKey } from './errors';

describe('error -> i18n mapping', () => {
  it('maps known server codes to op.errors keys', () => {
    expect(errorCodeToMessageKey('SLOT_TAKEN')).toBe('op.errors.SLOT_TAKEN');
    expect(errorCodeToMessageKey('PIN_INVALID')).toBe('op.errors.PIN_INVALID');
    expect(errorCodeToMessageKey('PIN_LOCKED')).toBe('op.errors.PIN_LOCKED');
    expect(errorCodeToMessageKey('DAY_OPEN_TABS')).toBe('op.errors.DAY_OPEN_TABS');
    expect(errorCodeToMessageKey('DEGRADED_LOCKOUT')).toBe('op.errors.DEGRADED_LOCKOUT');
    expect(errorCodeToMessageKey('ALREADY_NOTIFIED')).toBe('op.errors.ALREADY_NOTIFIED');
  });

  it('falls back to errors.generic for unknown codes', () => {
    expect(errorCodeToMessageKey('SOME_FUTURE_CODE')).toBe('errors.generic');
    expect(errorCodeToMessageKey('UNKNOWN')).toBe('errors.generic');
  });

  it('every code in MAPPED_CODES resolves in BOTH catalogs (no raw key leaks)', () => {
    expect(MAPPED_CODES.size).toBeGreaterThan(50);
    for (const code of MAPPED_CODES) {
      const key = errorCodeToMessageKey(code);
      expect(key).toBe(`op.errors.${code}`);
      expect(t('en', key)).not.toBe(key);
      expect(t('ar', key)).not.toBe(key);
      expect(t('ar', key)).not.toBe(t('en', key)); // real Arabic, not copied English
    }
  });

  it('maps the nine wave-5 codes in both catalogs (wave5-addendum-2026-09-25 §3)', () => {
    const wave5 = [
      'TRANSFER_SHORT',
      'STORE_BEING_COUNTED',
      'TILL_SHIFT_ALREADY_OPEN',
      'TILL_SHIFT_STATION_BUSY',
      'TILL_SHIFT_NOT_FOUND',
      'TILL_SHIFT_CLOSED',
      'TILL_SHIFT_NOT_YOURS',
      'TILL_SHIFT_WRONG_STATION',
      'TILL_SHIFT_UNSYNCED',
    ] as const;
    for (const code of wave5) {
      expect(MAPPED_CODES.has(code), code).toBe(true);
      const key = errorCodeToMessageKey(code);
      expect(key).toBe(`op.errors.${code}`);
      expect(t('en', key)).not.toBe(key);
      expect(t('ar', key)).not.toBe(key);
      expect(t('ar', key)).not.toBe(t('en', key));
      // No em dash in new copy (docs/design/protocols/wave5-addendum-2026-09-25.md §4).
      expect(t('en', key)).not.toContain('—');
    }
    // The two rewords now fit every raiser: a deduction against oneself, a review
    // of one's own report, and a launched size's or paid add-on's name.
    expect(t('en', 'op.errors.CANNOT_DECIDE_OWN')).toBe(
      'You cannot decide something you sent or that is about you.',
    );
    expect(t('en', 'op.errors.PRICE_VIA_PROTOCOL')).toContain('size and add-on names');
  });

  it('maps the open-match codes of 0259 (tickets, cash-out) in both catalogs (operator.md §5.20)', () => {
    const expected = {
      NO_UNUSED_TICKETS: 'No unused tickets are left on that purchase.',
      TICKET_IN_USE: 'A ticket from this purchase is still in use. Cash out once it comes back.',
      CUSTOMER_NOT_FOUND: "That customer can't be found.",
    } as const;
    for (const [code, en] of Object.entries(expected)) {
      expect(MAPPED_CODES.has(code), code).toBe(true);
      const key = errorCodeToMessageKey(code);
      expect(key).toBe(`op.errors.${code}`);
      expect(t('en', key)).toBe(en);
      expect(t('ar', key)).not.toBe(key);
      expect(t('ar', key)).not.toBe(en);
    }
  });

  it('maps the open-match codes of 0262 (the desk, seat money, the café wall) in both catalogs (operator.md §5.20)', () => {
    const expected = {
      MATCHES_OFF: 'Open matches are switched off at this branch.',
      MATCH_NOT_FOUND: "That open match isn't at this branch any more.",
      MATCH_NOT_FILLING: "This match isn't filling any more. A booked match is changed from its booking.",
      MATCH_NOT_BOOKED: 'This match has no court booked.',
      MATCH_NOT_STARTED: "The game hasn't started yet.",
      MATCH_FULL: 'No seat is free in this match.',
      MATCH_TOO_LATE: 'Too close to the start for an open match. Book the court instead.',
      MATCH_SLOT_FULL: 'Enough open matches are already filling at that time. Add the players to one of them.',
      MATCH_GENDER_MISMATCH: "This player doesn't fit this match's category.",
      MATCH_SEAT_LIMIT: 'One player can hold at most three seats.',
      MATCH_BANNED: 'This customer is banned from open matches.',
      MATCH_MARK_SEATS: 'Open matches are marked player by player, under Players.',
      MATCH_ALREADY_IN: 'This customer is already in this match.',
      MATCH_BOOKING_NO_CAFE: "Café orders don't go on an open match's booking. Open a separate café bill.",
      SEAT_NOT_FOUND: 'That seat changed. The list has been refreshed.',
      SEAT_NOT_STARTED: 'A no-show can be marked once the game starts.',
      SEAT_MARK_LOCKED: "This mark can't be changed any more.",
      SEAT_OWED_CHANGED: 'What this player owes just changed. Check the new amount.',
      NOTHING_OWED: 'Nothing is owed for this seat.',
      PAYMENT_NOT_ON_MATCH: "That payment isn't on this match's booking.",
      AMOUNT_OVER_SEAT: "That's more than is left of this player's share.",
      PAYMENT_OVER_ALLOCATED: "That's more than the payment has left to assign.",
      REPORT_NOT_FOUND: "That report isn't there any more.",
      REPORT_CLOSED: 'Someone already dealt with this report.',
    } as const;
    for (const [code, en] of Object.entries(expected)) {
      expect(MAPPED_CODES.has(code), code).toBe(true);
      const key = errorCodeToMessageKey(code);
      expect(key).toBe(`op.errors.${code}`);
      expect(t('en', key)).toBe(en);
      expect(t('ar', key)).not.toBe(key);
      expect(t('ar', key)).not.toBe(en);
    }
  });

  it('parses PostgREST errors: message IS the raise-exception code', () => {
    const err = toAppRpcError({
      message: 'SLOT_TAKEN',
      hint: null,
      details: 'reservations_no_overlap',
    });
    expect(err).toBeInstanceOf(AppRpcError);
    expect(err.code).toBe('SLOT_TAKEN');
    expect(errorToMessageKey(err)).toBe('op.errors.SLOT_TAKEN');
  });

  it('treats non-code messages as UNKNOWN -> generic', () => {
    const err = toAppRpcError({ message: 'connection refused' });
    expect(err.code).toBe('UNKNOWN');
    expect(errorToMessageKey(err)).toBe('errors.generic');
  });

  it('maps fetch TypeErrors to the network message', () => {
    expect(errorToMessageKey(new TypeError('Failed to fetch'))).toBe('errors.network');
  });

  it('maps EdgeError codes to op.errors.EDGE_* in both catalogs', () => {
    const codes = [
      'NOT_CONFIGURED',
      'FORBIDDEN',
      'AUTH_REQUIRED',
      'UPSTREAM',
      'RATE_LIMITED',
      'UNKNOWN',
    ] as const;
    for (const code of codes) {
      const key = errorToMessageKey(new EdgeError(500, code, 'x'));
      expect(key).toBe(`op.errors.EDGE_${code}`);
      expect(t('en', key)).not.toBe(key);
      expect(t('ar', key)).not.toBe(key);
      expect(t('ar', key)).not.toBe(t('en', key));
    }
  });
});
