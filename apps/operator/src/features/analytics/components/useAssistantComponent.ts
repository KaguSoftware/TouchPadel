/**
 * useAssistantComponent — one analytics card's content from the component
 * cache (plan §5.4 steps 1–3; migration 0115; the assistant-component edge
 * function).
 *
 * On mount it READS `app.analytics_component(key, params)`: a single RPC, no
 * model, no cost. Nothing here ever generates on its own (DECIDE 12): only
 * `refresh()` and `reject()` call the edge function, and both write the answer
 * straight into the query cache so the card updates without a refetch.
 */
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InsightWire } from '@touch/core';
import { appRpc } from '../../../lib/appRpc';
import { callEdge } from '../../../lib/edge';
import { supabase } from '../../../lib/supabase';
import type { PricingMap } from '../../../lib/assistantPricing';
import { COMPONENT_PRICING_KEY, PINNED_COMPONENTS_KEY, componentQueryKey, type ComponentParams } from './params';

export interface ComponentTokens {
  model?: string;
  input?: number;
  cache_write?: number;
  cache_read?: number;
  output?: number;
  cost_micros?: number;
  calls?: number;
}

export interface ComponentSource {
  name: string;
  args: Record<string, unknown>;
  row_count: number | null;
  ms: number;
  route: string | null;
  error?: string;
}

export interface ComponentGate {
  status: 'ok' | 'unverified';
  unverified: { raw: string; value: number }[];
  checked: number;
  retried?: boolean;
}

/** What the model wrote, shaped by the component's output_schema. */
export type ComponentContent = Record<string, unknown> & {
  findings?: InsightWire[];
  paragraph?: string;
  figures?: { label: string; value: string; route: string }[];
  rows?: { figure: string; value: string; previous: string; change_pct: number | null; route: string }[];
  expiring?: string[];
  variance?: string[];
  writeoffs?: string[];
};

export interface CacheView {
  inputs_fingerprint: string;
  content: ComponentContent;
  sources: ComponentSource[] | null;
  gate: ComponentGate | null;
  generated_at: string;
  tokens: ComponentTokens | null;
}

export type ComponentVerdict =
  | ({ hit: true; key: string; params_hash: string; fresh?: boolean; degraded?: boolean } & CacheView)
  | { hit: false; key: string; params_hash: string; last: CacheView | null; degraded?: boolean; sources?: ComponentSource[] };

interface EdgeRequest {
  key: string;
  params: ComponentParams;
  force?: boolean;
  reject?: { text: string; reason?: string | null };
}

export async function fetchComponent(key: string, params: ComponentParams): Promise<ComponentVerdict> {
  const v = await appRpc<ComponentVerdict>('analytics_component', { p_key: key, p_params: params });
  if (!v || typeof v !== 'object' || typeof (v as { hit?: unknown }).hit !== 'boolean') throw new Error('analytics_component returned no verdict');
  return v;
}

export interface AssistantComponent {
  verdict: ComponentVerdict | undefined;
  status: 'loading' | 'ready' | 'error';
  error: unknown;
  /** A model call is in flight (refresh or rewrite after a rejection). */
  busy: boolean;
  /** Re-read the cache (no model). */
  reload: () => void;
  /** Ask the edge function for this card: cached when the numbers did not move, else one billed model call. */
  refresh: (force?: boolean) => Promise<ComponentVerdict>;
  /** Hide one finding: stores the rejection, then rewrites the card without it (billed). */
  reject: (text: string, reason?: string) => Promise<ComponentVerdict>;
}

export function useAssistantComponent(key: string, params: ComponentParams, enabled = true): AssistantComponent {
  const queryClient = useQueryClient();
  const queryKey = componentQueryKey(key, params);
  const query = useQuery({
    queryKey,
    queryFn: () => fetchComponent(key, params),
    enabled,
    staleTime: 60_000,
  });
  const [busy, setBusy] = useState(false);
  const [callError, setCallError] = useState<unknown>(null);

  const call = useCallback(
    async (body: EdgeRequest): Promise<ComponentVerdict> => {
      setBusy(true);
      setCallError(null);
      try {
        const res = await callEdge<EdgeRequest, ComponentVerdict>('assistant-component', body, { ttlMs: 0 });
        queryClient.setQueryData(queryKey, res);
        return res;
      } catch (e) {
        setCallError(e);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    // The key is a stable serialisation of (key, params); the array identity is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, JSON.stringify(queryKey)],
  );

  return {
    verdict: query.data,
    status: query.isPending ? 'loading' : query.isError ? 'error' : 'ready',
    error: query.error ?? callError,
    busy,
    reload: () => void query.refetch(),
    refresh: (force = false) => call({ key, params, force }),
    reject: (text, reason) => call({ key, params, reject: { text, reason: reason ?? null } }),
  };
}

// ---------------------------------------------------------------------------
// Pinned components (kind = 'pinned', under RLS) and the price list
// ---------------------------------------------------------------------------
export interface PinnedComponentRow {
  key: string;
  question: string;
  tools: string[];
  output_schema: Record<string, unknown>;
  default_params: Record<string, unknown> | null;
  created_at: string;
}

export async function fetchPinnedComponents(): Promise<PinnedComponentRow[]> {
  const { data, error } = await supabase
    .from('assistant_components')
    .select('key, question, tools, output_schema, default_params, created_at')
    .eq('kind', 'pinned')
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PinnedComponentRow[];
}

export function usePinnedComponents() {
  return useQuery({ queryKey: PINNED_COMPONENTS_KEY, queryFn: fetchPinnedComponents, staleTime: 60_000 });
}

export interface ComponentPricing {
  pricing: PricingMap;
  fallback_micros_per_mtok: number;
}

/** The venue's price list (0111), so the Refresh button can print what the last generation would cost again. */
export function useComponentPricing() {
  return useQuery({
    queryKey: COMPONENT_PRICING_KEY,
    queryFn: async () => {
      const r = await appRpc<{ pricing?: PricingMap; fallback_micros_per_mtok?: number }>('assistant_usage', {});
      return { pricing: r.pricing ?? {}, fallback_micros_per_mtok: r.fallback_micros_per_mtok ?? 0 } satisfies ComponentPricing;
    },
    staleTime: 5 * 60_000,
  });
}
