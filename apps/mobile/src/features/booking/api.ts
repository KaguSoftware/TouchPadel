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

/** app.confirm_booking (0008/0021) — hold -> confirmed booking. */
export async function confirmBooking(client: Client, holdId: string) {
  const { data, error } = await client.schema('app').rpc('confirm_booking', {
    p_hold_id: holdId,
  });
  if (error) throw error;
  return data as { duplicate?: boolean; reservation_id?: string; price_iqd?: number | null };
}

/** app.cancel_reservation (0008) — guest cancel inside policy. */
export async function cancelReservation(client: Client, reservationId: string) {
  const { data, error } = await client.schema('app').rpc('cancel_reservation', {
    p_reservation_id: reservationId,
  });
  if (error) throw error;
  return data as { reservation_id?: string; status?: string };
}

/** Own reservations (RLS restricts to guest_id = auth.uid()). */
export async function fetchMyReservations(client: Client): Promise<BookingRow[]> {
  const { data, error } = await client
    .from('reservations')
    .select('id, court_id, kind, status, start_at, end_at, price_iqd')
    .order('start_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as BookingRow[];
}
