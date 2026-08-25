/** `['adminAddons']` — groups, options, item links, reveals and item names. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

export const ADMIN_ADDONS_KEY = ['adminAddons'] as const;

export interface GroupRow {
  id: string;
  name_en: string;
  name_ar: string;
  min_select: number;
  max_select: number;
}
export interface ModifierRow {
  id: string;
  group_id: string;
  name_en: string;
  name_ar: string;
  price_delta_iqd: number;
  sort_order: number;
  is_active: boolean;
}
export interface LinkRow {
  item_id: string;
  group_id: string;
}
export interface RevealRow {
  modifier_id: string;
  group_id: string;
  sort_order: number;
}
export interface ItemNameRow {
  id: string;
  name_en: string;
  name_ar: string;
  is_active: boolean;
}

export interface AddonsData {
  groups: GroupRow[];
  modifiers: ModifierRow[];
  links: LinkRow[];
  reveals: RevealRow[];
  items: ItemNameRow[];
}

export async function fetchAddons(): Promise<AddonsData> {
  const [groups, mods, links, reveals, items] = await Promise.all([
    supabase.from('modifier_groups').select('id, name_en, name_ar, min_select, max_select'),
    supabase
      .from('modifiers')
      .select('id, group_id, name_en, name_ar, price_delta_iqd, sort_order, is_active')
      .order('sort_order'),
    supabase.from('menu_item_modifier_groups').select('item_id, group_id'),
    supabase.from('modifier_reveals').select('modifier_id, group_id, sort_order'),
    supabase.from('menu_items').select('id, name_en, name_ar, is_active').order('name_en'),
  ]);
  for (const r of [groups, mods, links, reveals, items]) if (r.error) throw r.error;
  return {
    groups: (groups.data ?? []) as GroupRow[],
    modifiers: (mods.data ?? []) as ModifierRow[],
    links: (links.data ?? []) as LinkRow[],
    reveals: (reveals.data ?? []) as RevealRow[],
    items: (items.data ?? []) as ItemNameRow[],
  };
}

export function useAddons() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ADMIN_ADDONS_KEY, queryFn: fetchAddons });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ADMIN_ADDONS_KEY });
  return { ...query, refresh };
}

export function patchCachedModifiers(
  queryClient: ReturnType<typeof useQueryClient>,
  patch: (modifiers: ModifierRow[]) => ModifierRow[],
) {
  queryClient.setQueryData<AddonsData>(ADMIN_ADDONS_KEY, (prev) =>
    prev ? { ...prev, modifiers: patch(prev.modifiers) } : prev,
  );
}
