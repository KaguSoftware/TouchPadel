import { describe, expect, it } from 'vitest';
import { countPhrase, formatTime, isolate, makeT } from '@touch/i18n';
import {
  earliestStartAfter,
  errorCodeOf,
  joinRefusalOf,
  keepsStartKey,
  matchErrorText,
  parseNeedTickets,
  parsePriceChanged,
  refusalKey,
  startRefusalOf,
  ticketsToBuy,
} from '../errors';
import { DepositEdgeError } from '../../deposit/logic';

/**
 * Open-match refusals (docs/design/open-matches/guest.md §4.22, §4.13): the
 * detail-aware lines, the code-only fallback through CODE_TO_KEY, and where a
 * refusal sends the guest (and whether the start's key survives it, §4.23).
 */
const tEn = makeT('en');
const tAr = makeT('ar');

/** PostgREST's error object: the code is the message, the detail rides on `details`. */
const pg = (message: string, details: string | null = null) => ({ message, details, hint: null, code: 'P0001' });

// The detail itself is `rpcErrorDetail` (features/booking/errors.ts, §1.11),
// tested in booking/__tests__/errors.test.ts.
describe('errorCodeOf', () => {
  it('reads the code the same way whatever carried it', () => {
    expect(errorCodeOf(pg('NEED_TICKETS'))).toBe('NEED_TICKETS');
    expect(errorCodeOf(new DepositEdgeError('TERMS_REQUIRED', 403, null))).toBe('TERMS_REQUIRED');
    expect(errorCodeOf(new Error('boom'))).toBeNull();
  });
});

describe('the details', () => {
  it('parses NEED_TICKETS {needed, available, buy}', () => {
    expect(parseNeedTickets('{"needed":3,"available":1,"buy":2}')).toEqual({ needed: 3, available: 1, buy: 2 });
    expect(parseNeedTickets('{"needed":3}')).toBeNull();
    expect(parseNeedTickets('nope')).toBeNull();
    expect(parseNeedTickets(null)).toBeNull();
  });

  it('parses PRICE_CHANGED {quoted_iqd, current_iqd}', () => {
    expect(parsePriceChanged('{"quoted_iqd":40000,"current_iqd":45000}')).toEqual({ quotedIqd: 40000, currentIqd: 45000 });
    expect(parsePriceChanged('x')).toBeNull();
  });

  it('rounds the earliest start up to the next half hour on the branch clock', () => {
    const now = new Date('2026-10-01T12:07:30Z');
    // + 180 min = 15:07:30 UTC → 15:30 UTC (Baghdad is a whole-hour offset).
    expect(earliestStartAfter(180, now, 'Asia/Baghdad').toISOString()).toBe('2026-10-01T15:30:00.000Z');
    // Already on a half hour: unchanged.
    expect(earliestStartAfter(60, new Date('2026-10-01T12:00:00Z'), 'Asia/Baghdad').toISOString()).toBe(
      '2026-10-01T13:00:00.000Z',
    );
    // A half-hour zone rounds on ITS clock: 10:07 UTC is 15:37 in Kolkata → 16:00 there = 10:30 UTC.
    expect(earliestStartAfter(0, new Date('2026-10-01T10:07:00Z'), 'Asia/Kolkata').toISOString()).toBe(
      '2026-10-01T10:30:00.000Z',
    );
  });
});

describe('matchErrorText', () => {
  const now = new Date('2026-10-01T12:00:00Z');

  it('reads MATCH_TOO_LATE with its minutes as the earliest start', () => {
    const at = earliestStartAfter(180, now, 'Asia/Baghdad');
    expect(matchErrorText(pg('MATCH_TOO_LATE', '180'), tEn, { locale: 'en', timezone: 'Asia/Baghdad', now })).toBe(
      tEn('matches.errors.tooLateAt', { time: formatTime(at, 'en', 'Asia/Baghdad') }),
    );
    // No usable detail: the plain line.
    expect(matchErrorText(pg('MATCH_TOO_LATE'), tEn, { locale: 'en' })).toBe(tEn('matches.errors.tooLate'));
  });

  it('reads TICKET_COUNT_INVALID wallet_limit as the wallet cap', () => {
    const err = new DepositEdgeError('TICKET_COUNT_INVALID', 400, 'wallet_limit');
    expect(matchErrorText(err, tAr, { locale: 'ar' })).toBe(tAr('matches.errors.walletLimit'));
    expect(matchErrorText(new DepositEdgeError('TICKET_COUNT_INVALID', 400, 'p_count'), tEn, { locale: 'en' })).toBe(
      tEn('matches.errors.ticketCountInvalid'),
    );
  });

  it('reads NEED_TICKETS with how many more, counted', () => {
    const err = pg('NEED_TICKETS', '{"needed":2,"available":0,"buy":2}');
    expect(matchErrorText(err, tAr, { locale: 'ar' })).toBe(
      tAr('matches.errors.needTicketsCount', { tickets: countPhrase('matches.count.tickets', 2, 'ar') }),
    );
    // The subject is the nominative dual, with no adjective after it and no
    // verb addressed to the reader (§4.24 rule 2).
    expect(matchErrorText(err, tAr, { locale: 'ar' })).toContain('تذكرتان');
    expect(matchErrorText(err, tAr, { locale: 'ar' })).not.toMatch(/تحتاج|إضافية/);
    expect(matchErrorText(err, tEn, { locale: 'en' })).toBe(
      `You need ${countPhrase('matches.count.tickets', 2, 'en')} more for this.`,
    );
    expect(matchErrorText(pg('NEED_TICKETS'), tEn, { locale: 'en' })).toBe(tEn('matches.errors.needTickets'));
  });

  it('reads DEGRADED_LOCKOUT with the branch phone when the screen has it', () => {
    expect(matchErrorText(pg('DEGRADED_LOCKOUT'), tEn, { locale: 'en', phone: '0770' })).toBe(
      tEn('degraded.bookingRefused', { phone: isolate('0770') }),
    );
    expect(matchErrorText(pg('DEGRADED_LOCKOUT'), tEn, { locale: 'en' })).toBe(tEn('degraded.bookingRefusedShort'));
  });

  it('falls back to CODE_TO_KEY for every other code', () => {
    expect(matchErrorText(pg('MATCH_TIME_CLASH'), tEn, { locale: 'en' })).toBe(tEn('matches.errors.timeClash'));
    expect(matchErrorText(pg('MATCH_FULL'), tEn, { locale: 'en' })).toBe(tEn('matches.errors.full'));
    expect(matchErrorText(pg('MATCH_SLOT_FULL'), tEn, { locale: 'en' })).toBe(tEn('matches.errors.slotFull'));
    expect(matchErrorText(pg('REQUEST_NOT_FOUND'), tEn, { locale: 'en' })).toBe(tEn('errors.requestGone'));
  });

  it('reads a reported refusal (me.refusal, quote.refusal) by the same map', () => {
    expect(refusalKey('MATCH_BANNED')).toBe('matches.errors.banned');
    expect(refusalKey('MATCH_GENDER_MISMATCH')).toBe('matches.errors.genderMismatch');
    expect(refusalKey('SOMETHING_NEW')).toBe('errors.generic');
  });
});

describe('where a refusal sends the guest', () => {
  it('maps every §4.13 start refusal', () => {
    expect(startRefusalOf('NEED_TICKETS')).toBe('tickets');
    expect(startRefusalOf('GENDER_REQUIRED')).toBe('gender');
    expect(startRefusalOf('PHONE_REQUIRED')).toBe('phone');
    expect(startRefusalOf('TERMS_REQUIRED')).toBe('terms');
    expect(startRefusalOf('PRICE_CHANGED')).toBe('priceChanged');
    expect(startRefusalOf('MATCH_TOO_LATE')).toBe('tooLate');
    expect(startRefusalOf('DEGRADED_LOCKOUT')).toBe('degraded');
    for (const code of ['SLOT_TAKEN', 'MATCH_SLOT_FULL', 'CLOSED_DATE', 'OUTSIDE_HOURS', 'SLOT_IN_PAST', 'BEYOND_HORIZON', 'NO_RATE', 'INVALID_DURATION']) {
      expect(startRefusalOf(code), code).toBe('backToSheet');
    }
    for (const code of ['MATCHES_OFF', 'MATCH_BANNED', 'MATCH_LIMIT_REACHED', 'MATCH_TIME_CLASH', 'MATCH_ALREADY_IN', null]) {
      expect(startRefusalOf(code), String(code)).toBe('inline');
    }
  });

  it('keeps the start key for the refusals the guest fixes, and a dropped connection (§4.23)', () => {
    for (const code of ['NEED_TICKETS', 'GENDER_REQUIRED', 'PHONE_REQUIRED', 'TERMS_REQUIRED', 'PRICE_CHANGED']) {
      expect(keepsStartKey(pg(code)), code).toBe(true);
    }
    expect(keepsStartKey(new TypeError('Network request failed'))).toBe(true);
    for (const code of ['MATCH_TOO_LATE', 'SLOT_TAKEN', 'MATCH_BANNED', 'DEGRADED_LOCKOUT', 'MATCH_TIME_CLASH']) {
      expect(keepsStartKey(pg(code)), code).toBe(false);
    }
  });

  it('maps the join and request refusals', () => {
    expect(joinRefusalOf('NEED_TICKETS')).toBe('tickets');
    expect(joinRefusalOf('GENDER_REQUIRED')).toBe('gender');
    expect(joinRefusalOf('MATCH_FULL')).toBe('inline');
  });

  it('buys the detail’s shortfall, or seats − wallet without one, one purchase at most', () => {
    expect(ticketsToBuy(pg('NEED_TICKETS', '{"needed":3,"available":1,"buy":2}'), { seats: 3, available: 1 })).toBe(2);
    expect(ticketsToBuy(pg('NEED_TICKETS'), { seats: 3, available: 1 })).toBe(2);
    expect(ticketsToBuy(pg('NEED_TICKETS'), { seats: 1, available: 5 })).toBe(1);
    expect(ticketsToBuy(pg('NEED_TICKETS', '{"needed":9,"available":0,"buy":9}'), { seats: 3, available: 0 })).toBe(3);
  });
});
