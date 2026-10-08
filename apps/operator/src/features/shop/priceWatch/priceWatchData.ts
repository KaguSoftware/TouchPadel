/**
 * The supplier price watch's one read (0322). Under `['stock', …]` so the
 * Products screen's `['stock']` invalidation after a save refreshes it too.
 * RLS shows the rows to the owner, managers and the shop staff, at the
 * branch in scope (lib/venueScope.ts): no venue filter here.
 */
import { supabase } from '../../../lib/supabase';
import type { PriceWatchRow } from './priceWatchLogic';

export const PRICE_WATCHES_KEY = ['stock', 'priceWatches'] as const;

export async function fetchPriceWatches(): Promise<PriceWatchRow[]> {
  const { data, error } = await supabase
    .from('shop_price_watches')
    .select('variant_id, url, supplier_price_iqd, previous_price_iqd, price_changed_at, checked_at, read_ok_at, last_error');
  if (error) throw error;
  return (data ?? []) as PriceWatchRow[];
}
