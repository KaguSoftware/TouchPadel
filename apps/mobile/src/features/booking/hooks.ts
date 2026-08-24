import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { reservationIdemKey } from '../../lib/idempotency';
import { cancelReservation, confirmBooking, fetchMyReservations, holdSlot } from './api';
import type { HoldResult } from './logic';

export const bookingKeys = {
  mine: ['my-bookings'] as const,
};

export function useMyBookings() {
  return useQuery({
    queryKey: bookingKeys.mine,
    queryFn: () => fetchMyReservations(supabase),
    staleTime: 15_000,
  });
}

export function useHoldSlot() {
  const queryClient = useQueryClient();
  return useMutation<HoldResult, Error, { courtId: string; startAt: Date; durationMin: number }>({
    mutationFn: (vars) =>
      holdSlot(supabase, { ...vars, idempotencyKey: reservationIdemKey() }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useConfirmBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (holdId: string) => confirmBooking(supabase, holdId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bookingKeys.mine });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useCancelReservation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reservationId: string) => cancelReservation(supabase, reservationId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bookingKeys.mine });
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}
