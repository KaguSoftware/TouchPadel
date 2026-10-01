import { describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { AppRpcError } from '../../lib/appRpc';
import { QK } from '../../lib/queryKeys';
import { MATCH_RESERVATION_NAME } from './matchLogic';
import {
  invalidateMatchCustomer,
  invalidateMatchMoney,
  invalidateMatchReport,
  invalidateMatchSeats,
  invalidateMatchSettings,
  invalidateTicketCashOut,
  matchBookingIds,
  mintMatchKey,
  retryNetworkOnce,
} from './useMatches';

// operator.md §5.4: what each match write refreshes.
function keysAfter(write: (qc: QueryClient) => void): string[] {
  const invalidateQueries = vi.fn();
  write({ invalidateQueries } as unknown as QueryClient);
  return invalidateQueries.mock.calls.map(([o]) => JSON.stringify((o as { queryKey: unknown[] }).queryKey)).sort();
}
const k = (key: readonly unknown[]) => JSON.stringify(key);

describe('invalidation after each match write (§5.4)', () => {
  it('seat writes: the match, both reservation lists, the booking and its bill', () => {
    expect(keysAfter((qc) => invalidateMatchSeats(qc))).toEqual(
      [QK.deskMatches.all, QK.reservation.all, QK.bookingBill.all, QK.bookingBillStates.all, QK.reservations.all, QK.reservationsMonth.all]
        .map(k)
        .sort(),
    );
  });

  it('money writes: the match, the bill and the day', () => {
    expect(keysAfter((qc) => invalidateMatchMoney(qc))).toEqual(
      [QK.deskMatches.all, QK.bookingBill.all, QK.bookingBillStates.all, QK.day].map(k).sort(),
    );
  });

  it('ban and gender, cash-out, a report decision and settings', () => {
    expect(keysAfter((qc) => invalidateMatchCustomer(qc, 'g1'))).toEqual([QK.deskMatches.all, ['customer', 'g1']].map(k).sort());
    expect(keysAfter((qc) => invalidateTicketCashOut(qc, 'g1'))).toEqual(
      [QK.deskMatches.tickets('g1'), ['customer', 'g1'], ['depositAttention']].map(k).sort(),
    );
    expect(keysAfter((qc) => invalidateMatchReport(qc, 'v1', 'g2'))).toEqual([QK.deskMatches.reports('v1'), ['customer', 'g2']].map(k).sort());
    expect(keysAfter((qc) => invalidateMatchReport(qc, 'v1', null))).toEqual([k(QK.deskMatches.reports('v1'))]);
    expect(keysAfter((qc) => invalidateMatchSettings(qc))).toEqual([k(QK.deskMatches.all)]);
  });

  it('every per-id key sits under the family root, so the root refreshes it', () => {
    for (const key of [
      QK.deskMatches.open('a', 'b'),
      QK.deskMatches.states(['r1']),
      QK.deskMatches.one('m1'),
      QK.deskMatches.tickets('g1'),
      QK.deskMatches.reports(null),
      QK.deskMatches.settings('v1'),
    ]) {
      expect(key[0]).toBe(QK.deskMatches.all[0]);
    }
  });
});

describe('mintMatchKey and matchBookingIds', () => {
  it('mints match.<action>:<uuid>, a new one each time', () => {
    const a = mintMatchKey('seat_settle');
    expect(a).toMatch(/^match\.seat_settle:[0-9a-f-]{36}$/);
    expect(mintMatchKey('seat_settle')).not.toBe(a);
  });

  it('asks about match bookings only', () => {
    const rows = [
      { id: 'r1', guest_id: null, guest_name: MATCH_RESERVATION_NAME },
      { id: 'r2', guest_id: 'g1', guest_name: null },
      { id: 'r3', guest_id: null, guest_name: 'Walk-in' },
    ];
    expect(matchBookingIds(rows)).toEqual(['r1']);
    expect(matchBookingIds([])).toEqual([]);
  });
});

describe('retryNetworkOnce', () => {
  it('retries a failure with no server code once, never a refusal', () => {
    expect(retryNetworkOnce(0, new AppRpcError('UNKNOWN', 'TypeError: Failed to fetch'))).toBe(true);
    expect(retryNetworkOnce(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(retryNetworkOnce(1, new TypeError('Failed to fetch'))).toBe(false);
    expect(retryNetworkOnce(0, new AppRpcError('MATCH_NOT_FOUND', 'MATCH_NOT_FOUND'))).toBe(false);
  });
});
