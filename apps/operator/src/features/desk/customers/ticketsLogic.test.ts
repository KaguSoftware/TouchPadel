import { describe, expect, it } from 'vitest';
import { t, type MessageKey, type TParams } from '@touch/i18n';
import { AppRpcError } from '../../../lib/appRpc';
import { errorToMessageKey } from '../../../lib/errors';
import type { TicketCashout } from '../../matches/matchPayloads';
import type { CustomerMatchRow } from '../deskTypes';
import {
  cashoutRefusal,
  cashoutRefusalRefetches,
  cashoutStateOf,
  cashoutWaitLine,
  editableFlags,
  isHereMatch,
  isMatchBanned,
  playsAsLine,
  playsAsOf,
  purchaseRefundState,
  recordMatches,
  seatKindKey,
  seatStatusKey,
  walletRows,
} from './ticketsLogic';

const tr = (key: MessageKey, params?: TParams) => t('en', key, params);

function cashout(over: Partial<TicketCashout> = {}): TicketCashout {
  return { allowed: false, reason: null, tickets: 2, amount_iqd: 20000, until_at: null, ...over };
}

describe('walletRows', () => {
  it('lists the five counts in reading order, keeping a missing count null', () => {
    const rows = walletRows({ available: 2, reserved: 0, in_use: 1, forfeited: null, cashed_out: 3 });
    expect(rows.map((r) => [r.id, r.count])).toEqual([
      ['available', 2],
      ['reserved', 0],
      ['in_use', 1],
      ['forfeited', null],
      ['cashed_out', 3],
    ]);
    expect(rows.map((r) => tr(r.key))).toEqual(['Available', 'Held for a request', 'In a match', 'Lost', 'Cashed out']);
  });
});

describe('purchaseRefundState', () => {
  it('reads the refund from the payment status', () => {
    expect(purchaseRefundState({ status: 'refund_pending', refunded_at: null })).toEqual({ kind: 'requested' });
    expect(purchaseRefundState({ status: 'refund_failed', refunded_at: null })).toEqual({ kind: 'failed' });
    expect(purchaseRefundState({ status: 'refunded', refunded_at: '2026-09-28T10:00:00Z' })).toEqual({ kind: 'refunded', at: '2026-09-28T10:00:00Z' });
    expect(purchaseRefundState({ status: 'succeeded', refunded_at: null })).toBeNull();
  });
});

describe('cashoutStateOf (R13), one case per cashout.reason', () => {
  it('allowed: the button with the server’s count and amount', () => {
    expect(cashoutStateOf(cashout({ allowed: true }))).toEqual({ kind: 'allowed', tickets: 2, amount: 20000 });
  });

  it('in_use: waits until the time the server gave', () => {
    const s = cashoutStateOf(cashout({ reason: 'in_use', until_at: '2026-09-29T21:00:00Z' }));
    expect(s).toMatchObject({ kind: 'waiting', reason: 'in_use', line: { key: 'ws.matches.errors.ticketInUse.in_use', timeAt: '2026-09-29T21:00:00Z' } });
  });

  it('reserved: held for a request until the time given', () => {
    const s = cashoutStateOf(cashout({ reason: 'reserved', until_at: '2026-09-29T18:00:00Z' }));
    expect(s).toMatchObject({ kind: 'waiting', line: { key: 'ws.matches.errors.ticketInUse.reserved', timeAt: '2026-09-29T18:00:00Z' } });
  });

  it('restorable: waits for the day close and names no time', () => {
    const s = cashoutStateOf(cashout({ reason: 'restorable', until_at: '2026-09-29T21:00:00Z' }));
    expect(s).toMatchObject({ kind: 'waiting', line: { key: 'ws.matches.errors.ticketInUse.restorable' } });
    expect(s.kind === 'waiting' && s.line.timeAt).toBeFalsy();
  });

  it('a wait with no known end falls back to the plain "still in use" line', () => {
    expect(cashoutWaitLine('in_use', null)).toEqual({ key: 'ws.matches.customers.cashout.waiting' });
    expect(cashoutWaitLine('reserved', undefined)).toEqual({ key: 'ws.matches.customers.cashout.waiting' });
  });

  it('none_unused, not_succeeded, done, an unknown reason and no cashout at all: no button', () => {
    for (const reason of ['none_unused', 'not_succeeded', 'done', 'something_new']) {
      expect(cashoutStateOf(cashout({ reason }))).toEqual({ kind: 'none' });
    }
    expect(cashoutStateOf(null)).toEqual({ kind: 'none' });
  });
});

describe('cashoutRefusal (the TICKET_IN_USE detail parse)', () => {
  const inUse = (detail: string) => new AppRpcError('TICKET_IN_USE', 'TICKET_IN_USE', undefined, detail);

  it('reads Money’s JSON detail into the same sentence as the waiting button', () => {
    expect(cashoutRefusal(inUse('{"reason":"in_use","count":1,"until_at":"2026-09-29T21:00:00Z"}'))).toEqual({
      key: 'ws.matches.errors.ticketInUse.in_use',
      timeAt: '2026-09-29T21:00:00Z',
    });
    expect(cashoutRefusal(inUse('{"reason":"reserved","count":1,"until_at":null}'))).toEqual({ key: 'ws.matches.customers.cashout.waiting' });
    expect(cashoutRefusal(inUse('{"reason":"restorable","count":1,"until_at":null}'))).toEqual({ key: 'ws.matches.errors.ticketInUse.restorable' });
  });

  it('an unreadable detail or another code falls back to the code’s own line', () => {
    const garbled = inUse('not json');
    expect(cashoutRefusal(garbled).key).toBe(errorToMessageKey(garbled));
    const none = new AppRpcError('NO_UNUSED_TICKETS', 'NO_UNUSED_TICKETS');
    expect(cashoutRefusal(none).key).toBe(errorToMessageKey(none));
  });

  it('refetches the purchases after a refusal that means the reading is stale', () => {
    expect(cashoutRefusalRefetches(inUse('{}'))).toBe(true);
    expect(cashoutRefusalRefetches(new AppRpcError('NO_UNUSED_TICKETS', 'x'))).toBe(true);
    expect(cashoutRefusalRefetches(new AppRpcError('FORBIDDEN', 'x'))).toBe(false);
    expect(cashoutRefusalRefetches(new Error('offline'))).toBe(false);
  });
});

describe('plays as', () => {
  it('reads the gender and who set it', () => {
    expect(playsAsLine(playsAsOf({ gender: 'female', gender_set_by: 'guest' }), tr)).toBe('Woman · set by the guest');
    expect(playsAsLine(playsAsOf({ gender: 'male', gender_set_by: 'staff' }), tr)).toBe('Man · set at the desk');
    expect(playsAsLine(playsAsOf({ gender: 'male', gender_set_by: null }), tr)).toBe('Man');
    expect(playsAsLine(playsAsOf({ gender: null, gender_set_by: null }), tr)).toBe('Not set');
  });

  it('is unknown on a server that sends no gender key (no match block)', () => {
    expect(playsAsOf({}).known).toBe(false);
    expect(playsAsOf({ gender: null }).known).toBe(true);
    // Anything but female / male is "not declared".
    expect(playsAsOf({ gender: 'other', gender_set_by: 'guest' })).toEqual({ known: true, gender: null, source: null });
  });
});

describe('ban and flags', () => {
  it('reads the ban from the match_ban flag, and keeps it out of the flag editor', () => {
    const flags = [{ type: 'vip' }, { type: 'match_ban', label: 'reported' }];
    expect(isMatchBanned(flags)).toBe(true);
    expect(isMatchBanned([{ type: 'vip' }])).toBe(false);
    expect(editableFlags(flags)).toEqual([{ type: 'vip' }]);
  });
});

describe('recordMatches', () => {
  const row = (over: Partial<CustomerMatchRow>): CustomerMatchRow => ({
    match_id: 'm',
    reservation_id: null,
    venue_id: 'v1',
    status: 'filling',
    start_at: '2026-09-30T18:00:00Z',
    end_at: '2026-09-30T19:30:00Z',
    category: 'open',
    seat_status: 'in',
    kind: 'account',
    ...over,
  });
  const now = Date.parse('2026-09-29T12:00:00Z');

  it('live matches still to end come up soonest first; the rest are recent, newest first', () => {
    const rows = [
      row({ match_id: 'later', start_at: '2026-10-02T18:00:00Z', end_at: '2026-10-02T19:30:00Z', status: 'booked' }),
      row({ match_id: 'soon' }),
      row({ match_id: 'played', status: 'played', start_at: '2026-09-20T18:00:00Z', end_at: '2026-09-20T19:30:00Z' }),
      row({ match_id: 'cancelledFuture', status: 'cancelled' }),
      row({ match_id: 'old', status: 'expired', start_at: '2026-09-10T18:00:00Z', end_at: '2026-09-10T19:30:00Z' }),
    ];
    const { upcoming, recent } = recordMatches(rows, now);
    expect(upcoming.map((r) => r.match_id)).toEqual(['soon', 'later']);
    expect(recent.map((r) => r.match_id)).toEqual(['cancelledFuture', 'played', 'old']);
  });

  it('a booked match that has ended is recent even before it is marked played', () => {
    const { upcoming, recent } = recordMatches([row({ status: 'booked', start_at: '2026-09-29T09:00:00Z', end_at: '2026-09-29T10:30:00Z' })], now);
    expect(upcoming).toEqual([]);
    expect(recent).toHaveLength(1);
  });

  it('opens only this branch’s matches', () => {
    expect(isHereMatch({ venue_id: 'v1' }, 'v1')).toBe(true);
    expect(isHereMatch({ venue_id: 'v2' }, 'v1')).toBe(false);
    expect(isHereMatch({ venue_id: 'v2' }, null)).toBe(true);
  });

  it('words the seat status and kind, leaving an unknown status to print as sent', () => {
    expect(tr(seatStatusKey('no_show')!)).toBe("Didn't come");
    expect(seatStatusKey('mystery')).toBeNull();
    expect(tr(seatKindKey('friend')!)).toBe('friend seat');
    expect(seatKindKey('account')).toBeNull();
  });
});
