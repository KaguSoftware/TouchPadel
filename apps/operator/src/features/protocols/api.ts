/**
 * The Protocols page's reads, one hook each (build-contracts-2026-09-23 §2.7,
 * §5.2). Every write in this feature goes through `appRpc` and then
 * `invalidateProtocols`, which refreshes the whole ['protocols'] tree: the
 * cards, the lists, the open run and step, their context reads and the rail's
 * waiting count.
 */
import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { PriceChangeKind } from '@touch/core/protocols';
import { appRpc } from '../../lib/appRpc';
import { QK, fetchActiveCourts } from '../../lib/queries';
import { supabase } from '../../lib/supabase';
import { PK, PROTOCOLS_ROOT, PROTOCOL_REFETCH_MS } from './keys';
import { readOverview, readRunDetail, readRunsPage, readStepDetail, readTemplateDetail } from './protocolLogic';
import { readTargets } from './priceTargets';

export const RUNS_PAGE_SIZE = 25;

export function invalidateProtocols(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries({ queryKey: PROTOCOLS_ROOT });
}

export function useOverview() {
  return useQuery({
    queryKey: PK.overview,
    queryFn: async () => readOverview(await appRpc<unknown>('protocols_overview', { p_venue_id: null })),
    refetchInterval: PROTOCOL_REFETCH_MS,
  });
}

export function useRunsPage(filter: 'waiting' | 'active' | 'finished', kind: string | null, page: number) {
  return useQuery({
    queryKey: PK.runs(filter, kind, page),
    queryFn: async () =>
      readRunsPage(
        await appRpc<unknown>('protocol_runs_page', {
          p_venue_id: null,
          p_filter: filter,
          p_kind: kind,
          p_limit: RUNS_PAGE_SIZE,
          p_offset: page * RUNS_PAGE_SIZE,
        }),
      ),
    refetchInterval: PROTOCOL_REFETCH_MS,
    placeholderData: (prev) => prev,
  });
}

export function useRunDetail(runId: string | null) {
  return useQuery({
    queryKey: PK.run(runId ?? ''),
    enabled: Boolean(runId),
    queryFn: async () => readRunDetail(await appRpc<unknown>('protocol_run_detail', { p_run_id: runId })),
    refetchInterval: PROTOCOL_REFETCH_MS,
  });
}

export function useStepDetail(stepId: string | null) {
  return useQuery({
    queryKey: PK.step(stepId ?? ''),
    enabled: Boolean(stepId),
    queryFn: async () => readStepDetail(await appRpc<unknown>('protocol_step_detail', { p_run_step_id: stepId })),
    refetchInterval: PROTOCOL_REFETCH_MS,
  });
}

export function useTemplateDetail(templateId: string | null) {
  return useQuery({
    queryKey: PK.template(templateId ?? ''),
    enabled: Boolean(templateId),
    queryFn: async () => readTemplateDetail(await appRpc<unknown>('protocol_template_detail', { p_template_id: templateId })),
    // An open editor must not be refilled under the owner's typing.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
}

export function useTargets(change: PriceChangeKind | null) {
  return useQuery({
    queryKey: PK.targets(change ?? 'price'),
    // A new promotion names nothing that exists yet.
    enabled: change !== null && change !== 'promotion',
    queryFn: async () => readTargets(await appRpc<unknown>('price_promo_targets', { p_change: change, p_venue_id: null })),
  });
}

/** A context read of one step (§2.9-§2.13): its key names the step it serves. */
export function useStepRead<T>(stepKey: string, runId: string, fn: () => Promise<T>, enabled = true) {
  return useQuery({
    queryKey: PK.context(stepKey, runId),
    enabled: enabled && runId !== '',
    queryFn: fn,
    refetchInterval: PROTOCOL_REFETCH_MS,
    retry: false,
  });
}

// ── The pickers ─────────────────────────────────────────────────────────────

export interface NamedRow {
  id: string;
  name_en: string;
  name_ar: string;
}

/** The venue's active cafe sections: where a new item is filed (release `propose` `category_id`). */
export function useCafeCategories(enabled = true) {
  return useQuery({
    queryKey: PK.options('cafeCategories'),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('menu_categories')
        .select('id, name_en, name_ar, kind, is_active, sort_order')
        .eq('kind', 'cafe')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as unknown as NamedRow[];
    },
  });
}

/** Every section, for a promotion's scope. */
export function useAllCategories(enabled = true) {
  return useQuery({
    queryKey: PK.options('categories'),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('menu_categories').select('id, name_en, name_ar, sort_order').order('sort_order');
      if (error) throw error;
      return (data ?? []) as unknown as NamedRow[];
    },
  });
}

/** Menu items on sale, for a promotion's scope. */
export function useMenuItems(enabled = true) {
  return useQuery({
    queryKey: PK.options('menuItems'),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('menu_items').select('id, name_en, name_ar, is_active').eq('is_active', true).order('name_en');
      if (error) throw error;
      return (data ?? []) as unknown as NamedRow[];
    },
  });
}

export function useCourts(enabled = true) {
  return useQuery({ queryKey: QK.courts, queryFn: fetchActiveCourts, enabled });
}

export interface IngredientOption extends NamedRow {
  unit: string;
}

/** app.staff_ingredient_options: names and units only, no cost (§2.5). */
export function useIngredients(enabled = true) {
  return useQuery({
    queryKey: PK.options('ingredients'),
    enabled,
    queryFn: async () => {
      const res = await appRpc<{ ingredients?: IngredientOption[] }>('staff_ingredient_options', { p_venue_id: null, p_query: null });
      return res?.ingredients ?? [];
    },
  });
}

/**
 * The venue's campaigns, to name one on a marketing step. Management reads
 * them; for anyone else the read comes back empty and the field is left out.
 */
export function useCampaigns(enabled = true) {
  return useQuery({
    queryKey: PK.options('campaigns'),
    enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_campaigns')
        .select('id, name_en, name_ar, status')
        .in('status', ['draft', 'scheduled', 'live'])
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) return [] as NamedRow[];
      return (data ?? []) as unknown as NamedRow[];
    },
  });
}
