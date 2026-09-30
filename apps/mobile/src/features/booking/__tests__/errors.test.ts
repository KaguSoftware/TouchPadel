/**
 * The open-matches codes in CODE_TO_KEY (docs/design/open-matches/guest.md
 * §4.22). Each commit whose SQL raises a code adds its case here (build
 * contracts R11, R28); the booking and deposit codes are in logic.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { t } from '@touch/i18n';
import { mapErrorToKey, rpcErrorCode, rpcErrorDetail } from '../errors';
import { DepositEdgeError } from '../../deposit/logic';

/** PostgREST's error object: the code is the message, the detail rides on `details`. */
const pg = (message: string, details: string | null = null) => ({ message, details, hint: null, code: 'P0001' });

describe('rpcErrorDetail (build contracts §1.11)', () => {
  it('reads PostgREST’s details and an edge refusal’s detail, trimmed', () => {
    expect(rpcErrorDetail(pg('MATCH_TOO_LATE', '180'))).toBe('180');
    expect(rpcErrorDetail(pg('PRICE_CHANGED', ' {"current_price_iqd":45000} '))).toBe('{"current_price_iqd":45000}');
    expect(rpcErrorDetail(new DepositEdgeError('TICKET_COUNT_INVALID', 400, 'wallet_limit'))).toBe('wallet_limit');
  });

  it('is null for a blank or missing detail, and for anything that is not an error object', () => {
    expect(rpcErrorDetail(pg('MATCH_FULL'))).toBeNull();
    expect(rpcErrorDetail(pg('MATCH_FULL', '  '))).toBeNull();
    expect(rpcErrorDetail(new DepositEdgeError('TERMS_REQUIRED', 403, null))).toBeNull();
    expect(rpcErrorDetail({ details: 42 })).toBeNull();
    expect(rpcErrorDetail('MATCH_FULL')).toBeNull();
    expect(rpcErrorDetail(null)).toBeNull();
    expect(rpcErrorDetail(undefined)).toBeNull();
  });
});

describe('open-matches error codes', () => {
  it('0256: GENDER_ALREADY_SET reads that the desk can change it', () => {
    expect(mapErrorToKey(new Error('GENDER_ALREADY_SET'))).toBe('matches.errors.genderAlreadySet');
    expect(t('en', 'matches.errors.genderAlreadySet')).toMatch(/front desk/);
    expect(t('ar', 'matches.errors.genderAlreadySet')).toMatch(/الاستقبال/);
  });

  it('0259: the ticket purchase refusals (edge ticket-begin) have their own lines', () => {
    const cases = {
      TICKET_COUNT_INVALID: ['matches.errors.ticketCountInvalid', 'You can buy 1 to 3 tickets at a time.'],
      MATCHES_OFF: ['matches.errors.off', "Open matches aren't available at this branch right now."],
      TERMS_REQUIRED: ['matches.errors.termsRequired', 'Accept the updated terms to use open matches.'],
      MATCH_BANNED: ['matches.errors.banned', "Open matches aren't available on your account. Please contact the venue."],
    } as const;
    for (const [code, [key, en]] of Object.entries(cases)) {
      // An edge refusal arrives as an Error whose message is the code.
      expect(mapErrorToKey(new Error(code)), code).toBe(key);
      expect(t('en', key)).toBe(en);
      expect(t('ar', key)).not.toBe(en);
      expect(t('ar', key)).not.toBe(key);
    }
    // The wallet_limit detail's own line exists in both languages.
    expect(t('en', 'matches.errors.walletLimit')).toMatch(/unused tickets/);
    expect(t('ar', 'matches.errors.walletLimit')).toMatch(/التذاكر/);
    // MATCHES_OFF is not swallowed by a longer MATCH_ code.
    expect(rpcErrorCode('MATCHES_OFF')).toBe('MATCHES_OFF');
  });

  it('0260: the match core refusals (match_guest, match_lock, ticket_pick) have their own lines', () => {
    const cases = {
      GENDER_REQUIRED: ['matches.errors.genderRequired', "To play open matches, tell us once whether you're a woman or a man."],
      MATCH_NOT_FOUND: ['matches.errors.notFound', "This match isn't available."],
      NEED_TICKETS: ['matches.errors.needTickets', "You don't have enough tickets for this. Buy tickets to continue."],
    } as const;
    for (const [code, [key, en]] of Object.entries(cases)) {
      expect(mapErrorToKey(new Error(code)), code).toBe(key);
      expect(t('en', key)).toBe(en);
      expect(t('ar', key)).not.toBe(en);
      expect(t('ar', key)).not.toBe(key);
    }
    // The NEED_TICKETS detail's own line carries the counted phrase in both languages.
    expect(t('en', 'matches.errors.needTicketsCount')).toContain('{tickets}');
    expect(t('ar', 'matches.errors.needTicketsCount')).toContain('{tickets}');
    // Never swallowed by a longer or shorter code.
    expect(rpcErrorCode('MATCH_NOT_FOUND')).toBe('MATCH_NOT_FOUND');
    expect(rpcErrorCode('GENDER_REQUIRED')).toBe('GENDER_REQUIRED');
  });

  it('0261: the guest open-match refusals have their own lines, EN and AR', () => {
    const cases = {
      MATCH_CLOSED: ['matches.errors.closed', "This match isn't taking players any more."],
      MATCH_FULL: ['matches.errors.full', 'This match is full.'],
      MATCH_SLOT_FULL: ['matches.errors.slotFull', 'There are already as many open matches at this time as free courts. Join one of them instead.'],
      MATCH_TOO_LATE: ['matches.errors.tooLate', "It's too late to start an open match for this time. Pick a later time."],
      MATCH_LIMIT_REACHED: ['matches.errors.limitReached', "You already have as many open matches filling as you're allowed."],
      MATCH_SEAT_LIMIT: ['matches.errors.seatLimit', 'You can take up to 3 seats. The last seat is always for another player.'],
      MATCH_APPROVAL_REQUIRED: ['matches.errors.approvalRequired', 'The organiser approves each player in this match. Ask to join instead.'],
      MATCH_NOT_APPROVAL: ['matches.errors.notApproval', 'Anyone can join this match. Join it directly.'],
      MATCH_ALREADY_IN: ['matches.errors.alreadyIn', 'You already have a seat in this match.'],
      MATCH_GENDER_MISMATCH: ['matches.errors.genderMismatch', 'This match is for a different group of players.'],
      MATCH_UNAVAILABLE: ['matches.errors.unavailable', "You can't join this match."],
      MATCH_TIME_CLASH: ['matches.errors.timeClash', "You're already in another open match at this time."],
      MATCH_BOOKED: ['matches.errors.booked', "The court is booked now, so the match can't be cancelled here. You can leave it, or call the venue."],
      NOT_ORGANISER: ['matches.errors.notOrganiser', 'Only the organiser can do that.'],
      REQUEST_CLOSED: ['matches.errors.requestClosed', 'This request was already answered or withdrawn.'],
      REQUESTER_INELIGIBLE: ['matches.errors.requesterIneligible', "This request can't be approved right now. You can decline it."],
      REQUEST_LIMIT: ['matches.errors.requestLimit', 'You have too many requests waiting. Withdraw one or wait for an answer.'],
      SEAT_NOT_FOUND: ['matches.errors.seatNotFound', "That seat isn't in this match any more."],
      SEAT_HOLDER_REQUIRED: ['matches.errors.seatHolderRequired', "Your friends' seats can't stay without yours. Leave all your seats instead."],
      SEAT_STARTED: ['matches.errors.seatStarted', 'The match has started. Please speak to the front desk.'],
      REPORT_TARGET_INVALID: ['matches.errors.reportTargetInvalid', "You can't report that player from this match."],
      BLOCK_TARGET_INVALID: ['matches.errors.blockTargetInvalid', "You can't block that player from here."],
    } as const;
    for (const [code, [key, en]] of Object.entries(cases)) {
      expect(mapErrorToKey(new Error(code)), code).toBe(key);
      expect(rpcErrorCode(code), code).toBe(code);
      expect(t('en', key)).toBe(en);
      expect(t('ar', key)).not.toBe(en);
      expect(t('ar', key)).not.toBe(key);
      expect(t('ar', key)).toMatch(/[؀-ۿ]/);
    }
    // MATCH_FULL never shadows MATCH_SLOT_FULL, and the reverse.
    expect(rpcErrorCode('MATCH_SLOT_FULL')).toBe('MATCH_SLOT_FULL');
    expect(rpcErrorCode('MATCH_FULL')).toBe('MATCH_FULL');
    // The MATCH_TOO_LATE detail's own line carries the earliest time in both languages.
    expect(t('en', 'matches.errors.tooLateAt')).toContain('{time}');
    expect(t('ar', 'matches.errors.tooLateAt')).toContain('{time}');
  });

  it('R6: REQUEST_NOT_FOUND is one neutral line for a staff request and a match request', () => {
    expect(mapErrorToKey(new Error('REQUEST_NOT_FOUND'))).toBe('errors.requestGone');
    expect(t('en', 'errors.requestGone')).toBe('That request no longer exists. Please refresh.');
    expect(t('ar', 'errors.requestGone')).not.toBe(t('en', 'errors.requestGone'));
    // Never swallowed by a longer or shorter request code.
    expect(rpcErrorCode('REQUEST_NOT_PENDING')).toBe('REQUEST_NOT_PENDING');
    expect(rpcErrorCode('REQUEST_ALREADY_PENDING')).toBe('REQUEST_ALREADY_PENDING');
  });

  it('R6: RATE_LIMITED and the edge-only RETRY_LATER have their own lines', () => {
    expect(mapErrorToKey(new Error('RATE_LIMITED'))).toBe('errors.tooManyRequests');
    expect(mapErrorToKey({ message: 'RETRY_LATER' })).toBe('deposit.errors.providerUnavailable');
  });
});
