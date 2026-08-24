import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';

/**
 * Menu read model shared by the public /menu page (server-rendered) and the
 * cafe table flow (client-fetched). Reads only anon-visible rows: active
 * categories/items/variants, modifier groups, allergens, and the
 * menu_item_availability view (ingredient-out greying — 0013/0018).
 */

export interface MenuModifier {
  id: string;
  name_en: string;
  name_ar: string;
  price_delta_iqd: number;
  sort_order: number;
}

export interface MenuModifierGroup {
  id: string;
  name_en: string;
  name_ar: string;
  min_select: number;
  max_select: number;
  sort_order: number; // link sort order on the item
  modifiers: MenuModifier[];
}

export interface MenuVariant {
  id: string;
  name_en: string;
  name_ar: string;
  price_iqd: number;
  is_default: boolean;
  sort_order: number;
}

export interface MenuAllergen {
  code: string;
  label_en: string;
  label_ar: string;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name_en: string;
  name_ar: string;
  description_en: string | null;
  description_ar: string | null;
  photo_path: string | null;
  sort_order: number;
  orderable: boolean;
  variants: MenuVariant[];
  allergens: MenuAllergen[];
  modifierGroups: MenuModifierGroup[];
  /** addon_suggestions (0013): suggested item ids in sort order — "goes well with" chips. */
  suggestedItemIds: string[];
}

export interface MenuCategory {
  id: string;
  name_en: string;
  name_ar: string;
  sort_order: number;
  items: MenuItem[];
}

const bySort = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order;

export async function fetchMenu(client: SupabaseClient<Database>): Promise<MenuCategory[]> {
  const [categoriesRes, itemsRes, availabilityRes, suggestionsRes] = await Promise.all([
    client
      .from('menu_categories')
      .select('id, name_en, name_ar, sort_order')
      .eq('is_active', true),
    client
      .from('menu_items')
      .select(
        `id, category_id, name_en, name_ar, description_en, description_ar, photo_path, sort_order,
         menu_item_variants ( id, name_en, name_ar, price_iqd, is_default, sort_order ),
         menu_item_allergens ( allergens ( code, label_en, label_ar ) ),
         menu_item_modifier_groups ( sort_order,
           modifier_groups ( id, name_en, name_ar, min_select, max_select,
             modifiers ( id, name_en, name_ar, price_delta_iqd, sort_order, is_active ) ) )`,
      )
      .eq('is_active', true),
    client.from('menu_item_availability').select('item_id, orderable'),
    client
      .from('addon_suggestions')
      .select('item_id, suggested_item_id, sort_order')
      .order('sort_order'),
  ]);

  if (categoriesRes.error) throw categoriesRes.error;
  if (itemsRes.error) throw itemsRes.error;
  // Availability is a progressive enhancement — a failed read greys nothing.
  const orderableById = new Map<string, boolean>();
  for (const row of availabilityRes.data ?? []) {
    if (row.item_id) orderableById.set(row.item_id, row.orderable ?? true);
  }
  // Suggestions are a progressive enhancement too — a failed read shows no chips.
  const suggestionsById = new Map<string, string[]>();
  for (const row of suggestionsRes.data ?? []) {
    const list = suggestionsById.get(row.item_id) ?? [];
    list.push(row.suggested_item_id);
    suggestionsById.set(row.item_id, list);
  }

  const items: MenuItem[] = (itemsRes.data ?? []).map((row) => ({
    id: row.id,
    category_id: row.category_id,
    name_en: row.name_en,
    name_ar: row.name_ar,
    description_en: row.description_en,
    description_ar: row.description_ar,
    photo_path: row.photo_path,
    sort_order: row.sort_order,
    orderable: orderableById.get(row.id) ?? true,
    suggestedItemIds: suggestionsById.get(row.id) ?? [],
    variants: (row.menu_item_variants ?? [])
      .map((v) => ({
        id: v.id,
        name_en: v.name_en,
        name_ar: v.name_ar,
        price_iqd: v.price_iqd,
        is_default: v.is_default,
        sort_order: v.sort_order,
      }))
      .sort(bySort),
    allergens: (row.menu_item_allergens ?? [])
      .map((link) => link.allergens)
      .filter((a): a is NonNullable<typeof a> => a != null)
      .map((a) => ({ code: a.code, label_en: a.label_en, label_ar: a.label_ar })),
    modifierGroups: (row.menu_item_modifier_groups ?? [])
      .map((link) => {
        const group = link.modifier_groups;
        if (!group) return null;
        return {
          id: group.id,
          name_en: group.name_en,
          name_ar: group.name_ar,
          min_select: group.min_select,
          max_select: group.max_select,
          sort_order: link.sort_order,
          modifiers: (group.modifiers ?? [])
            .filter((m) => m.is_active)
            .map((m) => ({
              id: m.id,
              name_en: m.name_en,
              name_ar: m.name_ar,
              price_delta_iqd: m.price_delta_iqd,
              sort_order: m.sort_order,
            }))
            .sort(bySort),
        };
      })
      .filter((g): g is MenuModifierGroup => g !== null)
      .sort(bySort),
  }));

  return (categoriesRes.data ?? [])
    .map((c) => ({
      id: c.id,
      name_en: c.name_en,
      name_ar: c.name_ar,
      sort_order: c.sort_order,
      items: items.filter((i) => i.category_id === c.id).sort(bySort),
    }))
    .filter((c) => c.items.length > 0)
    .sort(bySort);
}

export interface VenueOpeningHours {
  venue_name: string;
  opening_hours: Record<string, [string, string][]>;
  closed_dates: string[];
}

/** Opening hours & venue name from the anon-safe venue_settings_public view. */
export async function fetchVenuePublic(
  client: SupabaseClient<Database>,
): Promise<VenueOpeningHours | null> {
  const { data, error } = await client
    .from('venue_settings_public')
    .select('venue_name, opening_hours, closed_dates')
    .maybeSingle();
  if (error || !data) return null;
  return {
    venue_name: data.venue_name ?? 'Touch Padel',
    opening_hours: (data.opening_hours ?? {}) as Record<string, [string, string][]>,
    closed_dates: data.closed_dates ?? [],
  };
}
