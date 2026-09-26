/**
 * The suggestion box (build-contracts-2026-09-23 §2.24.4, plan #63). Every
 * role posts, signed, and sees its own with whether it was seen; the manager
 * and the owner also read everyone's and mark them seen. No photo, no reply,
 * no guest data.
 *
 * PURE (vitest): no react-native, no supabase.
 */
import type { StaffRole } from '@touch/core';

export const BODY_MAX = 1000;
export const SUGGESTION_FILTERS = ['new', 'seen', 'all'] as const;
export type SuggestionFilter = (typeof SUGGESTION_FILTERS)[number];

/** Who reads everyone's suggestions and marks them seen. */
export function readsAllSuggestions(role: StaffRole): boolean {
  return role === 'manager' || role === 'owner';
}

/** One row of `my_suggestions`. */
export interface MySuggestion {
  id: string;
  body: string;
  created_at: string;
  seen: boolean;
  seen_at: string | null;
}

/** One row of `suggestions_page` (MGMT). */
export interface TeamSuggestion {
  id: string;
  author_name: string | null;
  author_role: StaffRole | null;
  body: string;
  created_at: string;
  seen_by_name: string | null;
  seen_at: string | null;
}

export interface SuggestionsPage {
  suggestions: TeamSuggestion[];
  new_count: number;
  total: number;
}

/** What is wrong with a typed suggestion, or null when it can be sent. */
export function suggestionIssue(body: string): 'required' | 'tooLong' | null {
  const text = body.trim();
  if (!text) return 'required';
  return text.length > BODY_MAX ? 'tooLong' : null;
}

/** The intent a suggestion's key is kept under: the text as sent, at that venue. */
export function suggestionIntent(venueId: string, body: string): string {
  return `suggestion:${venueId}:${body.trim()}`;
}

/**
 * Marking one seen, reflected in the page before the refetch: a `new` list
 * drops it, any other list shows who saw it.
 */
export function applySeen(
  page: SuggestionsPage,
  id: string,
  filter: SuggestionFilter,
  seenAt: string,
  seenByName: string,
): SuggestionsPage {
  const row = page.suggestions.find((s) => s.id === id);
  if (!row || row.seen_at) return page;
  const suggestions =
    filter === 'new'
      ? page.suggestions.filter((s) => s.id !== id)
      : page.suggestions.map((s) => (s.id === id ? { ...s, seen_at: seenAt, seen_by_name: seenByName } : s));
  return {
    suggestions,
    new_count: Math.max(0, page.new_count - 1),
    total: filter === 'new' ? Math.max(0, page.total - 1) : page.total,
  };
}
