/** The stock read (build-contracts-2026-09-23 §2.24.5): quantities only. */
import { supabase } from '../../../lib/supabase';
import type { StockFilter, StockView } from './logic';
import { stockKindArg } from './logic';

export async function fetchStock(venueId: string, filter: StockFilter): Promise<StockView> {
  const kind = stockKindArg(filter);
  const { data, error } = await supabase
    .schema('app')
    .rpc('staff_stock_view', { p_venue_id: venueId, ...(kind ? { p_kind: kind } : {}) });
  if (error) throw error;
  const view = data as unknown as Partial<StockView> | null;
  return { as_of: view?.as_of ?? new Date().toISOString(), items: view?.items ?? [] };
}
