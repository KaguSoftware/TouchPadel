/**
 * The store pages' reads and writes (wave5-addendum-2026-09-25 §2.8.5, §5.3):
 * the pick list, the day's store work, and the three writes, each keyed
 * (`p_idempotency_key`) so a retry replays the first answer and never adds,
 * moves or counts twice. No cost goes either way.
 */
import type { QueryClient } from '@tanstack/react-query';
import type { Json } from '@touch/db';
import { supabase } from '../../../lib/supabase';
import { staffKeys } from '../keys';
import { STOCK_KINDS } from '../stock/logic';
import {
  STOCK_LOCATIONS,
  asStore,
  type CountArgs,
  type LogArgs,
  type MoveArgs,
  type PickList,
  type StockLocation,
  type StockToday,
  type StorePurpose,
} from './logic';

export async function fetchStockPick(
  venueId: string,
  purpose: StorePurpose,
  location: StockLocation,
): Promise<PickList> {
  const { data, error } = await supabase
    .schema('app')
    .rpc('stock_pick_list', { p_purpose: purpose, p_location: location, p_venue_id: venueId });
  if (error) throw error;
  const list = data as unknown as Partial<PickList> | null;
  return { purpose, location: asStore(list?.location, location), items: list?.items ?? [] };
}

export async function fetchStockToday(venueId: string): Promise<StockToday> {
  const { data, error } = await supabase.schema('app').rpc('stock_today', { p_venue_id: venueId });
  if (error) throw error;
  const today = data as unknown as Partial<StockToday> | null;
  return {
    business_date: today?.business_date ?? '',
    transfers: today?.transfers ?? null,
    logs: today?.logs ?? null,
    driver_deliveries_waiting: today?.driver_deliveries_waiting ?? null,
    counts: today?.counts ?? null,
  };
}

export async function logStock(args: LogArgs, idempotencyKey: string): Promise<void> {
  const { error } = await supabase
    .schema('app')
    .rpc('log_stock', {
      ...args,
      p_lines: args.p_lines as unknown as Json,
      p_idempotency_key: idempotencyKey,
    });
  if (error) throw error;
}

export async function moveStock(args: MoveArgs, idempotencyKey: string): Promise<void> {
  const { error } = await supabase
    .schema('app')
    .rpc('transfer_stock', {
      ...args,
      p_lines: args.p_lines as unknown as Json,
      p_idempotency_key: idempotencyKey,
    });
  if (error) throw error;
}

export async function submitCount(args: CountArgs, idempotencyKey: string): Promise<void> {
  const { error } = await supabase
    .schema('app')
    .rpc('submit_stock_count', {
      ...args,
      p_lines: args.p_lines as unknown as Json,
      p_idempotency_key: idempotencyKey,
    });
  if (error) throw error;
}

/**
 * After a store write: the day's store work, every pick list (a move's on-hand
 * changed) and the stock page under every filter read again.
 */
export function refreshStoreReads(queryClient: QueryClient, venueId: string): void {
  void queryClient.invalidateQueries({ queryKey: staffKeys.stockToday(venueId) });
  for (const purpose of ['log', 'move', 'count'] as const) {
    for (const location of STOCK_LOCATIONS) {
      void queryClient.invalidateQueries({
        queryKey: staffKeys.stockPick(venueId, purpose, location),
      });
    }
  }
  for (const kind of ['all', ...STOCK_KINDS]) {
    void queryClient.invalidateQueries({ queryKey: staffKeys.stock(venueId, kind) });
  }
}
