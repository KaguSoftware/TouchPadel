/**
 * The recipe calls (build-contracts-2026-09-23 §2.24.6, §2.24.7). The owner's
 * approve goes through `decide_recipe_change`, which writes the recipe on the
 * server; no staff file names the recipe writer itself (noStationRpc.test.ts).
 */
import { supabase } from '../../../lib/supabase';
import type {
  IngredientOption,
  MyRecipeChange,
  RecipeChangeArgs,
  RecipeChangeFilter,
  RecipeChangesPage,
  RecipeView,
} from './logic';

export async function fetchRecipeView(venueId: string): Promise<RecipeView> {
  const { data, error } = await supabase.schema('app').rpc('recipe_view', { p_venue_id: venueId });
  if (error) throw error;
  const view = data as unknown as Partial<RecipeView> | null;
  return { items: view?.items ?? [], prepared: view?.prepared ?? [] };
}

/**
 * The venue's ingredients (`staff_ingredient_options`), kept as the RPC
 * returns them, `{ingredients}`: the shopping page caches the same key.
 */
export async function fetchIngredientOptions(venueId: string): Promise<{ ingredients: IngredientOption[] }> {
  const { data, error } = await supabase
    .schema('app')
    .rpc('staff_ingredient_options', { p_venue_id: venueId });
  if (error) throw error;
  return { ingredients: (data as unknown as { ingredients?: IngredientOption[] } | null)?.ingredients ?? [] };
}

export async function fetchMyRecipeChanges(venueId: string): Promise<MyRecipeChange[]> {
  const { data, error } = await supabase
    .schema('app')
    .rpc('my_recipe_changes', { p_venue_id: venueId, p_limit: 50 });
  if (error) throw error;
  return (data as unknown as { requests?: MyRecipeChange[] } | null)?.requests ?? [];
}

export async function fetchRecipeChanges(
  venueId: string,
  filter: RecipeChangeFilter,
): Promise<RecipeChangesPage> {
  const { data, error } = await supabase
    .schema('app')
    .rpc('recipe_changes_page', { p_venue_id: venueId, p_filter: filter, p_limit: 100 });
  if (error) throw error;
  const page = data as unknown as Partial<RecipeChangesPage> | null;
  return {
    requests: page?.requests ?? [],
    waiting_count: page?.waiting_count ?? 0,
    total: page?.total ?? 0,
  };
}

export async function requestRecipeChange(
  args: RecipeChangeArgs,
  idempotencyKey: string,
): Promise<{ id: string }> {
  const { data, error } = await supabase.schema('app').rpc('request_recipe_change', {
    ...args,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  return data as unknown as { id: string };
}

export async function withdrawRecipeChange(id: string): Promise<void> {
  const { error } = await supabase.schema('app').rpc('withdraw_recipe_change', { p_id: id });
  if (error) throw error;
}

export async function decideRecipeChange(
  id: string,
  approve: boolean,
  reason: string | null,
): Promise<{ status: string; lines_written: number }> {
  const { data, error } = await supabase.schema('app').rpc('decide_recipe_change', {
    p_id: id,
    p_approve: approve,
    ...(reason ? { p_reason: reason } : {}),
  });
  if (error) throw error;
  return data as unknown as { status: string; lines_written: number };
}
