/**
 * The role-spec reads that more than one screen shares, each under its QK key
 * and held as returned (build-contracts-2026-09-23 §5.2). Kept apart from the
 * screens so the shell (the rail badge) and the kitchen board (My tasks) can
 * read them without loading the pages.
 */
import { appRpc } from '../../lib/appRpc';
import { SUGGESTIONS_PAGE_SIZE } from './roleExtrasLogic';

/** QK.suggestionsNew: the New tab's first page, whose new_count is the rail badge. */
export function fetchSuggestionsNew(): Promise<unknown> {
  return appRpc<unknown>('suggestions_page', { p_filter: 'new', p_limit: SUGGESTIONS_PAGE_SIZE, p_offset: 0 });
}

/** QK.recipeChangesWaiting: the Recipe changes card on /protocols. */
export function fetchRecipeChangesWaiting(): Promise<unknown> {
  return appRpc<unknown>('recipe_changes_page', { p_filter: 'waiting' });
}

/** QK.ideasToReview: the ideas a head (their team's) or management (every team's) may start or decline. */
export function fetchIdeasToReview(): Promise<unknown> {
  return appRpc<unknown>('release_ideas_to_review', {});
}
