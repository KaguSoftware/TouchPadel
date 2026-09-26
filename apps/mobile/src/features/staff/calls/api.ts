/**
 * The waiter's calls (wave5-addendum-2026-09-25 §2.1.8): the venue's open
 * `waiter_calls` rows with their table label (the `waiter_calls_staff_read`
 * and `cafe_tables_staff_read` policies, 0194 and 0156), and the two
 * state-idempotent answers (0194's `ack_waiter_call` and
 * `resolve_waiter_call`: a repeat returns `duplicate: true`, no key).
 */
import { supabase } from '../../../lib/supabase';
import { readCalls, wasDuplicate, type WaiterCall } from './logic';

export async function fetchOpenCalls(venueId: string): Promise<WaiterCall[]> {
  const { data, error } = await supabase
    .from('waiter_calls')
    .select('id, reason, status, raised_at, acknowledged_by, table:cafe_tables(table_number)')
    .eq('venue_id', venueId)
    .in('status', ['raised', 'acknowledged'])
    .order('raised_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return readCalls(data);
}

/**
 * `duplicate` is true when the call was already acknowledged before this tap
 * (0032's idempotent double tap): by someone else, or by this waiter through
 * an answer the phone never received.
 */
export async function ackCall(callId: string): Promise<{ duplicate: boolean }> {
  const { data, error } = await supabase
    .schema('app')
    .rpc('ack_waiter_call', { p_call_id: callId });
  if (error) throw error;
  return { duplicate: wasDuplicate(data) };
}

export async function resolveCall(callId: string): Promise<void> {
  const { error } = await supabase.schema('app').rpc('resolve_waiter_call', { p_call_id: callId });
  if (error) throw error;
}
