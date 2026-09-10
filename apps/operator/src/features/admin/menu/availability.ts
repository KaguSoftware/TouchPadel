/**
 * `blockedByStock` for the menu editor (spec 06.24).
 *
 * The server decides orderability: `menu_item_availability` (0018 → 0041)
 * folds is_active, the off-today date, sold_out AND "any required ingredient
 * has on-hand ≤ 0" into one `orderable` flag. The stock clause itself lives in
 * `app.item_required_ingredients`, which is revoked from authenticated callers,
 * so the ingredient NAME is not exposed by the view. To name it we read the
 * item's own recipe lines (`recipe_lines` is readable by managers — the recipe
 * editor already does) against `v_ingredient_on_hand`. That reproduces the
 * direct clause of the server function; the one-level expansion of an OUT
 * prepared ingredient is not reproduced, and in that case the screen says the
 * ingredient could not be named rather than guessing.
 */
import { supabase } from '../../../lib/supabase';

export interface AvailabilityRow {
  item_id: string;
  orderable: boolean;
}

export interface RecipeLineRef {
  variant_id: string | null;
  ingredient_id: string;
}

export interface OnHandRef {
  ingredient_id: string;
  name_en: string;
  name_ar: string;
  on_hand: number;
}

export interface StockBlockData {
  availability: AvailabilityRow[];
  recipeLines: RecipeLineRef[];
  onHand: OnHandRef[];
}

export const MENU_AVAILABILITY_KEY = ['adminMenu', 'availability'] as const;

export async function fetchStockBlockData(): Promise<StockBlockData> {
  const [avail, lines, onHand] = await Promise.all([
    supabase.from('menu_item_availability').select('item_id, orderable'),
    supabase.from('recipe_lines').select('variant_id, ingredient_id').not('variant_id', 'is', null),
    supabase.from('v_ingredient_on_hand').select('ingredient_id, name_en, name_ar, on_hand'),
  ]);
  for (const r of [avail, lines, onHand]) if (r.error) throw r.error;
  return {
    availability: (avail.data ?? []) as unknown as AvailabilityRow[],
    recipeLines: (lines.data ?? []) as unknown as RecipeLineRef[],
    onHand: (onHand.data ?? []) as unknown as OnHandRef[],
  };
}

export interface ItemAvailabilityInput {
  id: string;
  is_active: boolean;
  sold_out: boolean;
  unavailable_on: string | null;
  menu_item_variants: { id: string }[];
}

export interface StockBlock {
  /** The server says not orderable and none of the item's own flags explain it. */
  blocked: boolean;
  /** Names of the item's recipe ingredients with on-hand ≤ 0 (may be empty when blocked — see header). */
  ingredients: { ingredient_id: string; name_en: string; name_ar: string }[];
}

/**
 * Whether the SERVER has greyed this item for stock, and which of its own
 * ingredients are out. `todayIso` is the station's calendar date used only to
 * read the off-today flag the way the view does.
 */
export function stockBlockFor(item: ItemAvailabilityInput, data: StockBlockData | undefined, todayIso: string): StockBlock {
  if (!data) return { blocked: false, ingredients: [] };
  const row = data.availability.find((a) => a.item_id === item.id);
  const explainedByFlags = !item.is_active || item.sold_out || item.unavailable_on === todayIso;
  const blocked = row !== undefined && !row.orderable && !explainedByFlags;
  if (!blocked) return { blocked: false, ingredients: [] };

  const variantIds = new Set(item.menu_item_variants.map((v) => v.id));
  const required = new Set(data.recipeLines.filter((l) => l.variant_id && variantIds.has(l.variant_id)).map((l) => l.ingredient_id));
  const ingredients = data.onHand
    .filter((o) => required.has(o.ingredient_id) && o.on_hand <= 0)
    .map((o) => ({ ingredient_id: o.ingredient_id, name_en: o.name_en, name_ar: o.name_ar }));
  return { blocked: true, ingredients };
}

/** Station calendar date as YYYY-MM-DD (a display predicate, not time arithmetic). */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
