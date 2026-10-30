/**
 * The café menu read (the guest's view-only menu). Plain table reads, no RPC: categories, items
 * and their sizes are anon-visible for an open branch (0225), the same rows the web menu shows.
 * Takes the typed client so the call shape is testable under plain node; hooks.ts binds the app
 * singleton.
 *
 * Only `kind = 'cafe'` sections: Touch Shop sections are sold at the counter (0144). Availability
 * (`menu_item_availability`) is a progressive enhancement, as on the web: a failed read greys
 * nothing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import { assembleMenu, type MenuViewSection } from './logic';

type Client = SupabaseClient<Database>;

export async function fetchCafeMenu(client: Client, venueId: string): Promise<MenuViewSection[]> {
  const [categories, items, availability] = await Promise.all([
    client
      .from('menu_categories')
      .select('id, name_en, name_ar, sort_order')
      .eq('is_active', true)
      .eq('kind', 'cafe')
      .eq('venue_id', venueId),
    client
      .from('menu_items')
      .select(
        `id, category_id, name_en, name_ar, hook_en, hook_ar, description_en, description_ar, sold_out, serve_temp, photo_path, sort_order,
         menu_item_variants ( id, name_en, name_ar, price_iqd, is_default, sort_order ),
         menu_item_allergens ( allergens ( code, label_en, label_ar ) )`,
      )
      .eq('is_active', true)
      .eq('venue_id', venueId),
    client.from('menu_item_availability').select('item_id, orderable'),
  ]);
  if (categories.error) throw categories.error;
  if (items.error) throw items.error;
  return assembleMenu(categories.data ?? [], items.data ?? [], availability.data ?? []);
}
