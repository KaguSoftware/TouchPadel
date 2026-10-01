/**
 * The one error catalogue and its resolver (packages/i18n/src/errors.ts). The
 * operator, the phone and the web delegate to `errorMessageKey`; their own
 * tests pin their overrides, these pin the rule.
 */
import { describe, expect, it } from 'vitest';
import { opErrorsCodesEn } from '../catalogs/opErrors.codes.en';
import {
  ERROR_CODE_KEYS,
  GENERIC_BY_DECISION,
  SQLSTATE_KEYS,
  errorCode,
  errorMessageKey,
  isErrorCode,
  sqlStateMessageKey,
  type ErrorCode,
} from '../errors';
import { t, type MessageKey } from '../t';

/** PostgREST's error object for a `raise exception 'CODE'`. */
const pg = (message: string, code = 'P0001') => ({ message, code, details: null, hint: null });

describe('rule 1: an exact code', () => {
  it('reads the code from a PostgREST message, as the SQL raised it', () => {
    expect(errorMessageKey(pg('SLOT_TAKEN'))).toBe('op.errors.SLOT_TAKEN');
    expect(errorMessageKey(pg('  TOO_MANY_ORDERS  '))).toBe('op.errors.TOO_MANY_ORDERS');
  });

  it('reads the code from `code`, as an edge refusal or AppRpcError carries it', () => {
    expect(
      errorMessageKey({ code: 'EMAIL_IN_USE', message: 'An account with this email exists' }),
    ).toBe('op.errors.EMAIL_IN_USE');
    expect(errorMessageKey({ code: 'RECORD_INVALID', message: 'RECORD_INVALID' })).toBe(
      'op.errors.RECORD_INVALID',
    );
  });

  it('takes a bare message string', () => {
    expect(errorCode('MATCHES_OFF')).toBe('MATCHES_OFF');
    expect(errorMessageKey('CLOSED_DATE')).toBe('op.errors.CLOSED_DATE');
  });

  it('a business code beats its SQLSTATE: TAB_MOVED and RESERVATION_MOVED are raised as 40001', () => {
    expect(errorMessageKey(pg('TAB_MOVED', '40001'))).toBe('op.errors.TAB_MOVED');
    expect(errorMessageKey(pg('RESERVATION_MOVED', '40001'))).toBe('op.errors.RESERVATION_MOVED');
  });

  it('never lets a shorter code shadow a longer one', () => {
    expect(errorCode('MATCH_SLOT_FULL')).toBe('MATCH_SLOT_FULL');
    expect(errorCode('MATCH_FULL')).toBe('MATCH_FULL');
    expect(errorCode('REQUEST_NOT_PENDING')).toBe('REQUEST_NOT_PENDING');
  });
});

describe('rule 2: a code inside a longer message', () => {
  it('finds a whole code word that a wrapper put text around', () => {
    expect(errorCode('error: SLOT_TAKEN (reservations_no_overlap)')).toBe('SLOT_TAKEN');
    expect(errorCode('pg: raised SLOT_TAKEN while inserting')).toBe('SLOT_TAKEN');
    expect(errorMessageKey({ message: 'CANCELLATION_WINDOW: inside the window' })).toBe(
      'op.errors.CANCELLATION_WINDOW',
    );
  });

  it('the longest known code word wins, whatever the order', () => {
    expect(errorCode('MATCH_FULL, then MATCH_SLOT_FULL')).toBe('MATCH_SLOT_FULL');
    expect(errorCode('MATCH_SLOT_FULL, then MATCH_FULL')).toBe('MATCH_SLOT_FULL');
  });

  it('never finds a code inside a longer word', () => {
    expect(errorCode('SLOT_TAKEN_TWICE happened')).toBeNull();
    expect(errorCode('XSLOT_TAKEN')).toBeNull();
    expect(errorCode('Something went wrong')).toBeNull();
  });
});

describe('rule 3: a native Postgres error by its SQLSTATE', () => {
  it('maps the five the review named, from `code` with an English message', () => {
    expect(
      errorMessageKey(
        pg('duplicate key value violates unique constraint "profiles_phone_key"', '23505'),
      ),
    ).toBe('errors.duplicate');
    expect(
      errorMessageKey(
        pg('new row for relation "tabs" violates check constraint "tabs_total_chk"', '23514'),
      ),
    ).toBe('errors.invalidValue');
    expect(errorMessageKey(pg('invalid input syntax for type uuid: "abc"', '22P02'))).toBe(
      'errors.invalidInput',
    );
    expect(errorMessageKey(pg('deadlock detected', '40P01'))).toBe('errors.busy');
    expect(errorMessageKey(pg('canceling statement due to statement timeout', '57014'))).toBe(
      'errors.busy',
    );
  });

  it('reads `sqlState` (the operator AppRpcError keeps it there)', () => {
    expect(sqlStateMessageKey({ code: 'UNKNOWN', sqlState: '23505' })).toBe('errors.duplicate');
    expect(sqlStateMessageKey({ code: 'P0001' })).toBeNull();
  });

  it('a mapped SQLSTATE in an edge body code reads the same as the native error', () => {
    expect(errorMessageKey({ code: 'DUPLICATE', message: 'duplicate key' })).toBe(
      errorMessageKey(pg('x', '23505')),
    );
    expect(errorMessageKey({ code: 'RETRY_LATER', message: 'deadlock' })).toBe(
      errorMessageKey(pg('x', '40P01')),
    );
  });
});

describe('rule 4: the fallback', () => {
  it('an unknown code, or nothing at all, is the generic line', () => {
    expect(errorMessageKey(pg('SOME_FUTURE_CODE'))).toBe('errors.generic');
    expect(errorMessageKey(new Error('boom'))).toBe('errors.generic');
    expect(errorMessageKey(null)).toBe('errors.generic');
    expect(errorMessageKey(undefined)).toBe('errors.generic');
    expect(errorMessageKey(42)).toBe('errors.generic');
  });

  it('a transport failure is the network line only when the app says so', () => {
    const offline = new TypeError('Failed to fetch');
    expect(errorMessageKey(offline)).toBe('errors.generic');
    expect(errorMessageKey(offline, { isTransport: (e) => e instanceof TypeError })).toBe(
      'errors.network',
    );
    // A known code is never "offline".
    expect(errorMessageKey(pg('SLOT_TAKEN'), { isTransport: () => true })).toBe(
      'op.errors.SLOT_TAKEN',
    );
  });
});

describe('overrides', () => {
  it('an app’s own words for a code beat the catalogue, for that code only', () => {
    const overrides = { SLOT_TAKEN: 'booking.slotTaken' } as const;
    expect(errorMessageKey(pg('SLOT_TAKEN'), { overrides })).toBe('booking.slotTaken');
    expect(errorMessageKey(pg('error: SLOT_TAKEN (x)'), { overrides })).toBe('booking.slotTaken');
    expect(errorMessageKey(pg('HOLD_EXPIRED'), { overrides })).toBe('op.errors.HOLD_EXPIRED');
  });
});

describe('the catalogue', () => {
  const entries = Object.entries(ERROR_CODE_KEYS) as [ErrorCode, MessageKey][];

  it('every line exists in English and Arabic, and the Arabic is Arabic', () => {
    for (const [code, key] of [
      ...entries,
      ...(Object.entries(SQLSTATE_KEYS) as [string, MessageKey][]),
    ]) {
      expect(t('en', key), code).not.toBe(key);
      expect(t('ar', key), code).not.toBe(key);
      expect(t('ar', key), code).not.toBe(t('en', key));
      expect(t('ar', key), code).toMatch(/[؀-ۿ]/);
    }
  });

  it('only the owner’s decisions read as the generic line', () => {
    const generic = entries.filter(([, key]) => key === 'errors.generic').map(([code]) => code);
    expect(generic.sort()).toEqual([...GENERIC_BY_DECISION].sort());
    for (const code of GENERIC_BY_DECISION) expect(isErrorCode(code)).toBe(true);
  });

  it('every code is upper snake case, and no SQLSTATE is also a code', () => {
    for (const [code] of entries) expect(code).toMatch(/^[A-Z][A-Z0-9_]+$/);
    for (const state of Object.keys(SQLSTATE_KEYS)) expect(isErrorCode(state)).toBe(false);
  });

  it('the codes testers meet now say what happened (they read "Something went wrong" before)', () => {
    const cases: Record<string, string> = {
      TOO_MANY_ORDERS:
        'Too many orders in a short time. Please wait a moment, or ask a member of staff.',
      TOO_MANY_ITEMS:
        'This order has too many items. Send the rest as another order, or ask a member of staff.',
      TENDER_CARD: 'Cash given and change are for cash payments only.',
      DISCOUNT_REQUIRES_REFUND:
        'More has been paid than the bill would be after this discount. Refund the difference first.',
      TAB_MOVED: 'This line just moved to another bill. Refresh and try again.',
      SPLIT_INCOMPLETE: 'Every item has to go into a part of the split. Assign the rest.',
      REFUND_QTY_EXCEEDS_LINE: 'That is more than was sold on this line. Lower the quantity.',
      RESERVATION_MOVED: 'This booking was just changed. Refresh and try again.',
      SERIES_TOO_LONG: 'A series can have at most 200 bookings. Shorten the dates.',
      NO_ELIGIBLE_PROMOTION: 'No promotion applies to this tab right now.',
      TICKET_CLOSED: 'This ticket is already finished, so its items cannot change.',
      ALREADY_DELETED: 'This account has already been deleted.',
      CONFIRMATION_REQUIRED: 'Confirm that you want to delete your account, then try again.',
    };
    for (const [code, en] of Object.entries(cases)) {
      const key = errorMessageKey(pg(code));
      expect(t('en', key), code).toBe(en);
      expect(t('ar', key), code).toMatch(/[؀-ۿ]/);
    }
    for (const code of [
      'RESERVATION_NOT_STARTED',
      'SERIES_EMPTY',
      'SERIES_NOT_FOUND',
      'SERIES_UNRESOLVED_CONFLICTS',
    ]) {
      expect(errorMessageKey(pg(code)), code).toBe(`op.errors.${code}`);
    }
  });

  it('the new lines keep the wave-5 copy rule: no em dash', () => {
    for (const [code, en] of Object.entries(opErrorsCodesEn)) {
      expect(en, code).not.toContain('—');
      expect(t('ar', `op.errors.${code}` as MessageKey), code).not.toContain('—');
    }
  });
});
