/**
 * Feature-private query keys of the role-spec screens
 * (build-contracts-2026-09-23 §5.2). Each list sits under the root its shared
 * QK key uses, so one invalidation reaches both: a seen mark refreshes the
 * rail badge (QK.suggestionsNew) and the page's other tabs together, and a
 * recipe decision the card (QK.recipeChangesWaiting) and its sheet.
 *
 * The phone copies on /tasks sit under ['roleExtras', …]: read-only, and no
 * write on the operator touches them.
 */
import type { QueryKey } from '@tanstack/react-query';

export const RK = {
  suggestions: (filter: string, offset: number) => ['suggestions', 'list', filter, offset] as const satisfies QueryKey,
  recipeChanges: (filter: string, offset: number) => ['recipeChanges', 'list', filter, offset] as const satisfies QueryKey,
  /** One phone copy on /tasks (teachings, stock, recipes, requests, results …). */
  phone: (section: string) => ['roleExtras', section] as const satisfies QueryKey,
} as const;
