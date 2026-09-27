/** The suggestion box calls (build-contracts-2026-09-23 §2.24.4). */
import { supabase } from '../../../lib/supabase';
import type { MySuggestion, SuggestionFilter, SuggestionsPage } from './logic';

export async function fetchMySuggestions(venueId: string): Promise<MySuggestion[]> {
  const { data, error } = await supabase
    .schema('app')
    .rpc('my_suggestions', { p_venue_id: venueId, p_limit: 50 });
  if (error) throw error;
  return (data as unknown as { suggestions?: MySuggestion[] } | null)?.suggestions ?? [];
}

export async function fetchSuggestionsPage(
  venueId: string,
  filter: SuggestionFilter,
): Promise<SuggestionsPage> {
  const { data, error } = await supabase
    .schema('app')
    .rpc('suggestions_page', { p_venue_id: venueId, p_filter: filter, p_limit: 100 });
  if (error) throw error;
  const page = data as unknown as Partial<SuggestionsPage> | null;
  return {
    suggestions: page?.suggestions ?? [],
    new_count: page?.new_count ?? 0,
    total: page?.total ?? 0,
  };
}

export async function addSuggestion(
  venueId: string,
  body: string,
  idempotencyKey: string,
): Promise<{ id: string }> {
  const { data, error } = await supabase.schema('app').rpc('add_suggestion', {
    p_venue_id: venueId,
    p_body: body.trim(),
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  return data as unknown as { id: string };
}

/** State-idempotent: a repeat keeps the first mark. */
export async function markSuggestionSeen(id: string): Promise<{ seen_at: string }> {
  const { data, error } = await supabase.schema('app').rpc('mark_suggestion_seen', { p_id: id });
  if (error) throw error;
  return data as unknown as { seen_at: string };
}
