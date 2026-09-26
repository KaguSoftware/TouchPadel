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
