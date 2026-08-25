/** Pure rules for the suggested-items editor (cap, no self, distinct). */

export const SUGGESTION_CAP = 6;

export type AddError = 'self' | 'duplicate' | 'cap' | null;

export function canAddSuggestion(
  itemId: string,
  current: readonly string[],
  candidate: string,
): AddError {
  if (candidate === itemId) return 'self';
  if (current.includes(candidate)) return 'duplicate';
  if (current.length >= SUGGESTION_CAP) return 'cap';
  return null;
}

export interface CandidateItem {
  id: string;
  name_en: string;
  name_ar: string;
  is_active: boolean;
}

/** Active items matching the query that may still be added, first `limit`. */
export function suggestionCandidates<T extends CandidateItem>(
  itemId: string,
  current: readonly string[],
  items: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  return items
    .filter(
      (i) =>
        i.is_active &&
        i.id !== itemId &&
        !current.includes(i.id) &&
        (i.name_en.toLowerCase().includes(q) || i.name_ar.toLowerCase().includes(q)),
    )
    .slice(0, limit);
}
