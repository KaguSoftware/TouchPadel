/**
 * Recipe change requests on the work alerts page (QA MOB.STAFF_RECIPE_CHANGE.T02:
 * "requests are not real time and don't show on work alerts").
 *
 * The owner is asked to decide the waiting ones; a head sees their own, waiting
 * and decided. They read the same RPCs and cache keys as the Recipe changes
 * page, so a request sent there lands here at once, and both re-read on a short
 * timer and on every focus until the realtime topic for recipe requests exists
 * (it needs a migration; see the note in the hand-off).
 */
import { useQuery } from '@tanstack/react-query';
import type { StaffRole } from '@touch/core';
import { staffKeys } from '../keys';
import { fetchMyRecipeChanges, fetchRecipeChanges } from './api';
import { asksRecipeChanges, decidesRecipeChanges, recipeWorkOf, type RecipeWork } from './logic';

/** How often an open screen re-reads recipe requests. */
export const RECIPE_WORK_POLL_MS = 15_000;

export function useRecipeWork(
  venueId: string | null,
  role: StaffRole | null,
  allowed = true,
): RecipeWork {
  const venue = venueId ?? '';
  const r = venue !== '' && allowed ? role : null;
  const live = { refetchInterval: RECIPE_WORK_POLL_MS, refetchOnWindowFocus: 'always' as const };
  const mine = useQuery({
    queryKey: staffKeys.myRecipeChanges(venue),
    queryFn: () => fetchMyRecipeChanges(venue),
    enabled: r !== null && asksRecipeChanges(r),
    ...live,
  });
  const page = useQuery({
    queryKey: staffKeys.recipeChanges(venue, 'waiting'),
    queryFn: () => fetchRecipeChanges(venue, 'waiting'),
    enabled: r !== null && decidesRecipeChanges(r),
    ...live,
  });
  return recipeWorkOf(mine.data, page.data?.requests);
}
