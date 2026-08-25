/**
 * The `['adminMenu']` query shared by the menu editor, the category editor
 * and the item form: categories, items (+ variants, + group links), modifier
 * groups/modifiers, tax groups and the manager-only `menu_item_costs` table
 * folded into a Map (no row = unknown cost, never 0).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';

export const ADMIN_MENU_KEY = ['adminMenu'] as const;

export type Highlight = 'none' | 'blue' | 'brown';

export interface CategoryRow {
  id: string;
  name_en: string;
  name_ar: string;
  tax_group_id: string;
  sort_order: number;
  is_active: boolean;
  photo_path: string | null;
}
export interface VariantRow {
  id: string;
  item_id: string;
  name_en: string;
  name_ar: string;
  price_iqd: number;
  is_default: boolean;
  sort_order: number;
}
export interface ItemRow {
  id: string;
  category_id: string;
  name_en: string;
  name_ar: string;
  description_en: string | null;
  description_ar: string | null;
  sort_order: number;
  is_active: boolean;
  unavailable_on: string | null;
  photo_path: string | null;
  photo_blur: string | null;
  hook_en: string;
  hook_ar: string;
  highlight: Highlight;
  sold_out: boolean;
  menu_item_variants: VariantRow[];
  menu_item_modifier_groups: { group_id: string }[];
}
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
export interface TaxGroupRow {
  id: string;
  name_en: string;
  name_ar: string;
}

export interface AdminMenuData {
  categories: CategoryRow[];
  items: ItemRow[];
  groups: GroupRow[];
  modifiers: ModifierRow[];
  taxGroups: TaxGroupRow[];
  /** item_id → cost_iqd; absent = unknown. */
  costs: Map<string, number>;
}

const ITEM_COLUMNS =
  'id, category_id, name_en, name_ar, description_en, description_ar, sort_order, is_active, ' +
  'unavailable_on, photo_path, photo_blur, hook_en, hook_ar, highlight, sold_out, ' +
  'menu_item_variants(id, item_id, name_en, name_ar, price_iqd, is_default, sort_order), ' +
  'menu_item_modifier_groups(group_id)';

export async function fetchAdminMenu(): Promise<AdminMenuData> {
  const [cats, items, groups, mods, taxes, costs] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name_en, name_ar, tax_group_id, sort_order, is_active, photo_path')
      .order('sort_order'),
    supabase.from('menu_items').select(ITEM_COLUMNS).order('sort_order'),
    supabase.from('modifier_groups').select('id, name_en, name_ar, min_select, max_select'),
    supabase
      .from('modifiers')
      .select('id, group_id, name_en, name_ar, price_delta_iqd, sort_order, is_active')
      .order('sort_order'),
    supabase.from('tax_groups').select('id, name_en, name_ar'),
    supabase.from('menu_item_costs').select('item_id, cost_iqd'),
  ]);
  for (const r of [cats, items, groups, mods, taxes, costs]) if (r.error) throw r.error;
  return {
    categories: (cats.data ?? []) as unknown as CategoryRow[],
    items: (items.data ?? []) as unknown as ItemRow[],
    groups: (groups.data ?? []) as unknown as GroupRow[],
    modifiers: (mods.data ?? []) as unknown as ModifierRow[],
    taxGroups: (taxes.data ?? []) as unknown as TaxGroupRow[],
    costs: new Map((costs.data ?? []).map((c) => [c.item_id, c.cost_iqd])),
  };
}

export function useAdminMenu() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ADMIN_MENU_KEY, queryFn: fetchAdminMenu });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ADMIN_MENU_KEY });
  return { ...query, refresh };
}

/** Apply a local patch to the cached items (optimistic reorder / toggles). */
export function patchCachedItems(
  queryClient: ReturnType<typeof useQueryClient>,
  patch: (items: ItemRow[]) => ItemRow[],
) {
  queryClient.setQueryData<AdminMenuData>(ADMIN_MENU_KEY, (prev) =>
    prev ? { ...prev, items: patch(prev.items) } : prev,
  );
}

export function patchCachedCategories(
  queryClient: ReturnType<typeof useQueryClient>,
  patch: (categories: CategoryRow[]) => CategoryRow[],
) {
  queryClient.setQueryData<AdminMenuData>(ADMIN_MENU_KEY, (prev) =>
    prev ? { ...prev, categories: patch(prev.categories) } : prev,
  );
}
