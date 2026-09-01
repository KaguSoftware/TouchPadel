import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { clearIdemKey, idemKeyFor } from '../../lib/idempotency';
import { useAuth } from '../auth/context';
import {
  cancelReservation,
  confirmBooking,
  fetchMyReservations,
  fetchReservationById,
  holdSlot,
} from './api';
import type { HoldResult } from './logic';

export const bookingKeys = {
  mine: ['my-bookings'] as const,
  one: (id: string) => ['reservation', id] as const,
};

/** Own reservations — only while signed in (RLS returns nothing otherwise). */
export function useMyBookings() {
  const { session } = useAuth();
  return useQuery({
    queryKey: bookingKeys.mine,
    queryFn: () => fetchMyReservations(supabase),
    enabled: !!session,
    staleTime: 30_000,
  });
}

/**
 * One reservation by id. Booking detail used to `find` it in the 100-row list,
 * so a push-tap deep link to an older booking rendered "not found".
 */
export function useReservation(id: string | undefined) {
  const { session } = useAuth();
  return useQuery({
    queryKey: bookingKeys.one(id ?? ''),
    queryFn: () => fetchReservationById(supabase, id ?? ''),
    enabled: !!session && !!id,
    staleTime: 15_000,
  });
}

type HoldVars = { courtId: string; startAt: Date; durationMin: number };
const intentOf = (v: HoldVars) => `${v.courtId}|${v.startAt.toISOString()}|${v.durationMin}`;

/**
 * hold_slot with an idempotency key minted ONCE per intent (court + start +
 * duration) and reused across the mutation's transport retry. Minting inside
 * the mutationFn meant every retry carried a new key, so a call that committed
 * server-side but lost its response created a SECOND hold. The key is dropped
 * once the attempt settles: a later tap on the same slot is a new intent.
 */
export function useHoldSlot() {
  const queryClient = useQueryClient();
  return useMutation<HoldResult, Error, HoldVars>({
    mutationFn: (vars) => holdSlot(supabase, { ...vars, idempotencyKey: idemKeyFor(intentOf(vars)) }),
    onSettled: (_data, _error, vars) => {
      clearIdemKey(intentOf(vars));
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
    },
  });
}

export function useConfirmBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (holdId: string) => confirmBooking(supabase, holdId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
      void queryClient.invalidateQueries({ queryKey: bookingKeys.mine });
      void queryClient.invalidateQueries({ queryKey: ['reservation'] });
    },
  });
}

export function useCancelReservation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reservationId: string) => cancelReservation(supabase, reservationId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['availability'] });
      void queryClient.invalidateQueries({ queryKey: bookingKeys.mine });
      void queryClient.invalidateQueries({ queryKey: ['reservation'] });
    },
  });
}
