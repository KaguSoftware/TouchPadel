/**
 * Stock query keys + fetchers — one key, one shape (lib/queries.ts doctrine),
 * feature-private under the ['stock', …] tree. Everything reads the 0017-0019
 * tables/views; every write is an app.* RPC from the screens.
 */
import { supabase } from '../../lib/supabase';

export const SK = {
  onHand: ['stock', 'onHand'] as const,
  ingredients: ['stock', 'ingredients'] as const,
  ledger: (ingredientId: string) => ['stock', 'ledger', ingredientId] as const,
  recipes: (target: string, id: string) => ['stock', 'recipes', target, id] as const,
  openCount: ['stock', 'openCount'] as const,
  counts: ['stock', 'counts'] as const,
  variance: (countId: string) => ['stock', 'variance', countId] as const,
  margins: ['stock', 'margins'] as const,
  alerts: ['stock', 'alerts'] as const,
  expiring: ['stock', 'expiring'] as const,
  expired: ['stock', 'expired'] as const,
};

export interface OnHandRow {
  ingredient_id: string;
  name_en: string;
  name_ar: string;
  unit: 'g' | 'ml' | 'pc';
  kind: 'purchased' | 'prepared';
  on_hand: number;
  theoretical: number;
  par_level: number | null;
  low_stock_threshold: number | null;
  is_active: boolean;
}

export async function fetchOnHand(): Promise<OnHandRow[]> {
  const { data, error } = await supabase
    .from('v_ingredient_on_hand')
    .select('*')
    .order('name_en');
  if (error) throw error;
  return data as OnHandRow[];
}

export interface IngredientRow {
  id: string;
  kind: 'purchased' | 'prepared';
  name_en: string;
  name_ar: string;
  unit: 'g' | 'ml' | 'pc';
  pack_size: number | null;
  pack_cost_iqd: number | null;
  supplier_name: string | null;
  shelf_life_days: number | null;
  yield_percent: number;
  waste_allowance_percent: number;
  par_level: number | null;
  low_stock_threshold: number | null;
  is_active: boolean;
}

export async function fetchIngredients(): Promise<IngredientRow[]> {
  const { data, error } = await supabase.from('ingredients').select('*').order('name_en');
  if (error) throw error;
  return data as IngredientRow[];
}

export interface MovementRow {
  id: number;
  at: string;
  movement_type: string;
  qty_delta: number;
  unit_cost_iqd: number | null;
  reason_code: string | null;
  order_item_id: string | null;
  delivery_line_id: string | null;
  count_id: string | null;
}

export const LEDGER_PAGE = 50;

export async function fetchLedger(ingredientId: string, page = 0): Promise<MovementRow[]> {
  const { data, error } = await supabase
    .from('stock_movements')
    .select('id, at, movement_type, qty_delta, unit_cost_iqd, reason_code, order_item_id, delivery_line_id, count_id')
    .eq('ingredient_id', ingredientId)
    .order('at', { ascending: false })
    .range(page * LEDGER_PAGE, (page + 1) * LEDGER_PAGE - 1);
  if (error) throw error;
  return data as MovementRow[];
}
