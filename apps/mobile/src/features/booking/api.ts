/**
 * Booking writes — ALL through app.* RPCs (schema('app').rpc, mirroring
 * packages/db/tests/helpers.ts appRpc). Query fns take the typed client so the
 * logic stays testable; hooks.ts binds the app singleton.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import { parseHoldResult, type BookingRow, type HoldResult } from './logic';

type Client = SupabaseClient<Database>;

export interface HoldSlotArgs {
  courtId: string;
  startAt: Date;
  durationMin: number;
  idempotencyKey?: string;
}

/** app.hold_slot (0008) — TTL hold; SLOT_TAKEN when the exclusion check loses. */
export async function holdSlot(client: Client, args: HoldSlotArgs): Promise<HoldResult> {
  const { data, error } = await client.schema('app').rpc('hold_slot', {
    p_court_id: args.courtId,
    p_start_at: args.startAt.toISOString(),
    p_duration_min: args.durationMin,
    p_idempotency_key: args.idempotencyKey,
  });
  if (error) throw error;
  return parseHoldResult(data);
}

/**
 * app.confirm_booking (0008/0021) — hold -> confirmed booking.
 *
 * Sends `p_hold_id` only. Padel is always four players (owner call), so the app
 * never asks for a group size and never sends `p_players`; the server keeps
 * that parameter only as an ignored, deprecated one for older builds.
 */
export async function confirmBooking(client: Client, holdId: string) {
  const { data, error } = await client.schema('app').rpc('confirm_booking', {
    p_hold_id: holdId,
  });
  if (error) throw error;
  return data as { duplicate?: boolean; reservation_id?: string; price_iqd?: number | null };
}

/**
 * app.cancel_reservation (0008/0088) — guest cancel inside policy.
 *
 * `cancelled_by` comes back as 'guest' from this path by construction; the
 * screens read it off the refetched row rather than from here, because the
 * same column on a booking the DESK cancelled is the case that matters and
 * that one never passes through this function.
 */
export async function cancelReservation(client: Client, reservationId: string) {
  const { data, error } = await client.schema('app').rpc('cancel_reservation', {
    p_reservation_id: reservationId,
  });
  if (error) throw error;
  return data as { reservation_id?: string; status?: string; cancelled_by?: string };
}

/**
 * app.release_hold (0058) — hand an OWN unconfirmed hold back to the grid.
 * cancel_reservation cannot do this: its cancellation_window_hours guard
 * refuses a same-day hold, which is why abandoned holds used to sit on the
 * slot for the whole TTL and burn the guest's per-account hold quota.
 * Idempotent server-side, so a release that races the countdown is not an error.
 */
export async function releaseHold(client: Client, reservationId: string) {
  const { data, error } = await client.schema('app').rpc('release_hold', {
    p_reservation_id: reservationId,
  });
  if (error) throw error;
  return data as { reservation_id?: string; status?: string; released?: boolean };
}

/**
 * Own reservations, newest first (app.my_reservations, 0150).
 *
 * A table read would do for everything here EXCEPT the two payment figures:
 * `reservations` records what a booking costs and nothing about what was paid,
 * and the tables that do (`tabs`, `payments`) are staff-only by RLS. The RPC is
 * the guest-side counterpart of the desk's `booking_bill`, guarded by
 * `guest_id = auth.uid()` inside its own body.
 */
export async function fetchMyReservations(client: Client): Promise<BookingRow[]> {
  const { data, error } = await client.schema('app').rpc('my_reservations', {});
  if (error) throw error;
  return (data ?? []) as BookingRow[];
}

/** One own reservation by id (0150). Null when not found / not ours. */
export async function fetchReservationById(client: Client, id: string): Promise<BookingRow | null> {
  const { data, error } = await client
    .schema('app')
    .rpc('my_reservations', { p_reservation_id: id });
  if (error) throw error;
  return ((data ?? [])[0] as BookingRow | undefined) ?? null;
}
