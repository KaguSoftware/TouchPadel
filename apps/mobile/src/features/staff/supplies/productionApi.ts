/**
 * The production calls (build-contracts-2026-09-23 §2.16). `record_batch` is
 * the phone's door to production; the manager-only public body is never
 * named here (__tests__/noStationRpc.test.ts).
 */
import { supabase } from '../../../lib/supabase';
import type { BatchArgs, ProductionItem, ProductionLogRow } from './production';

export async function fetchProductionToday(venueId: string): Promise<ProductionItem[]> {
  const { data, error } = await supabase.schema('app').rpc('production_today', { p_venue_id: venueId });
  if (error) throw error;
  return ((data as unknown as { items?: ProductionItem[] } | null)?.items ?? []);
}

export async function fetchProductionLog(venueId: string): Promise<ProductionLogRow[]> {
  const { data, error } = await supabase
    .schema('app')
    .rpc('production_log_today', { p_venue_id: venueId });
  if (error) throw error;
  return ((data as unknown as { rows?: ProductionLogRow[] } | null)?.rows ?? []);
}

export interface BatchResult {
  batch_id: string;
  qty: number;
  expiry_date: string | null;
  duplicate?: boolean;
}

/** One batch, under its intent's key: a retry replays the first answer and deducts nothing twice. */
export async function recordBatch(args: BatchArgs, idempotencyKey: string): Promise<BatchResult> {
  const { data, error } = await supabase
    .schema('app')
    .rpc('record_batch', { ...args, p_idempotency_key: idempotencyKey });
  if (error) throw error;
  return data as unknown as BatchResult;
}
