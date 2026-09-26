/**
 * The two server reads behind desk payment (0106). Keys match the
 * invalidations in lib/queueResults.ts, so a settle, open or booking change
 * — from this screen, the till, or a replayed queue row — refreshes them.
 */
import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { appRpc } from '../../../lib/appRpc';
import type { BillStateRow, BookingBill } from './deskPaymentLogic';

export function useBookingBill(reservationId: string | undefined): UseQueryResult<BookingBill> {
  return useQuery({
    queryKey: ['bookingBill', reservationId ?? ''],
    enabled: Boolean(reservationId),
    queryFn: () => appRpc<BookingBill>('booking_bill', { p_reservation_id: reservationId }),
    retry: false,
    refetchInterval: 30_000,
  });
}

/**
 * One state per booking for the board. A failure degrades to "unknown" (the
 * cell prints "—"), never to a broken board.
 */
export function useBookingBillStates(reservationIds: readonly string[]): UseQueryResult<BillStateRow[]> {
  const ids = useMemo(() => [...reservationIds].sort(), [reservationIds]);
  return useQuery({
    queryKey: ['bookingBillStates', ids],
    enabled: ids.length > 0,
    queryFn: () => appRpc<BillStateRow[]>('booking_bill_states', { p_reservation_ids: ids }),
    retry: false,
    refetchInterval: 60_000,
  });
}
