/**
 * The staff area's query keys: one family, all under `['staff', …]`
 * (build-contracts-2026-09-23 §6.4). Screens extend this family and never
 * inline a key array, so invalidating `staffKeys.all` refreshes the whole area
 * (Today's pull to refresh), and src/lib/queryClient.ts keeps the one root out
 * of the disk cache: a staff list is never read back from a previous account's
 * session or a previous build.
 *
 * PURE (vitest).
 */
import type { StaffMutation } from '../../lib/idempotency';

/**
 * Every staff write's mutation key. The keyed writes (StaffMutation) plus the
 * state-idempotent ones, which take no idempotency key but still need the
 * `['staff', 'mutation']` defaults: without a key under that root a write
 * would inherit the app's `offlineFirst` default and could pause offline and
 * fire later, which a staff write must never do.
 */
export type StaffMutationName =
  | StaffMutation
  | 'request'
  | 'request.withdraw'
  | 'decide'
  | 'skip'
  | 'withdraw'
  | 'tick'
  | 'run.stop'
  | 'run.withdraw'
  | 'run.cancel_schedule'
  | 'checklist.mark'
  | 'shopping.cancel'
  | 'candidate.delete'
  | 'photo'
  // Role spec (H): teachings, suggestions, recipe changes.
  | 'teaching.archive'
  | 'suggestion.seen'
  | 'recipe_change.withdraw'
  | 'recipe_change.decide'
  // Role spec (H): the head chef's OK, Delivered, requests to marketing.
  | 'shopping.decide'
  | 'purchase.deliver'
  | 'marketing_request.withdraw'
  | 'marketing_request.answer'
  // Protocol pages (H): an idea withdrawn or declined, and the owner's new
  // account at a hiring run's last step (staff-admin).
  | 'idea.withdraw'
  | 'idea.decline'
  | 'staff.create';

export const staffKeys = {
  all: ['staff'] as const,
  status: (uid: string) => ['staff', 'status', uid] as const,
  venues: (uid: string) => ['staff', 'venues', uid] as const,
  work: (venue: string) => ['staff', 'work', venue] as const,
  checklists: (venue: string) => ['staff', 'checklists', venue] as const,
  runs: (venue: string, filter: string) => ['staff', 'runs', venue, filter] as const,
  run: (id: string) => ['staff', 'run', id] as const,
  step: (id: string) => ['staff', 'step', id] as const,
  context: (stepKey: string, runId: string) => ['staff', 'context', stepKey, runId] as const,
  priceTargets: (venue: string, change: string) =>
    ['staff', 'priceTargets', venue, change] as const,
  /** The day-30 review: fetched for managers and the owner only (#54). */
  review: (runId: string) => ['staff', 'review', runId] as const,
  ingredients: (venue: string) => ['staff', 'ingredients', venue] as const,
  production: (venue: string) => ['staff', 'production', venue] as const,
  productionLog: (venue: string) => ['staff', 'productionLog', venue] as const,
  shopping: (venue: string, status: string) => ['staff', 'shopping', venue, status] as const,
  purchases: (venue: string) => ['staff', 'purchases', venue] as const,
  requests: (uid: string) => ['staff', 'requests', uid] as const,
  notes: (venue: string) => ['staff', 'notes', venue] as const,
  itemNotes: (itemId: string) => ['staff', 'itemNotes', itemId] as const,
  marketingNotes: (venue: string) => ['staff', 'marketingNotes', venue] as const,
  campaignDrafts: (venue: string) => ['staff', 'campaignDrafts', venue] as const,
  candidates: (runId: string) => ['staff', 'candidates', runId] as const,
  // Role spec (H, §6.4). `team` is the list asked for (`all`, `bar`,
  // `kitchen`), `kind` the stock filter (`all` or an ingredient kind),
  // `itemId` one menu item or `all`.
  teachings: (venue: string, team: string) => ['staff', 'teachings', venue, team] as const,
  mySuggestions: (venue: string) => ['staff', 'mySuggestions', venue] as const,
  suggestions: (venue: string, filter: string) => ['staff', 'suggestions', venue, filter] as const,
  stock: (venue: string, kind: string) => ['staff', 'stock', venue, kind] as const,
  recipes: (venue: string, itemId: string) => ['staff', 'recipes', venue, itemId] as const,
  myRecipeChanges: (venue: string) => ['staff', 'myRecipeChanges', venue] as const,
  recipeChanges: (venue: string, filter: string) =>
    ['staff', 'recipeChanges', venue, filter] as const,
  /** A 10-minute signed URL for one staff-media path (photo.ts `staffPhotoUrl`). */
  photoUrl: (path: string) => ['staff', 'photoUrl', path] as const,
  // Role spec (H, §6.4): requests to marketing (`filter` is open, answered or
  // all) and marketing's campaign results. `menuItems` is the venue's launched
  // menu items, for the pickers that name one (a request, a take, a draft).
  myMarketingRequests: (venue: string) => ['staff', 'myMarketingRequests', venue] as const,
  marketingRequests: (venue: string, filter: string) =>
    ['staff', 'marketingRequests', venue, filter] as const,
  campaignResults: (venue: string) => ['staff', 'campaignResults', venue] as const,
  menuItems: (venue: string) => ['staff', 'menuItems', venue] as const,
  // Protocol pages (H, §6.4): a barista's or chef assistant's own ideas and a
  // head's review list; the venue's cafe categories (a new item's decider) and
  // courts (a tournament plan, a court rate).
  ideas: (venue: string) => ['staff', 'ideas', venue] as const,
  ideasToReview: (venue: string) => ['staff', 'ideasToReview', venue] as const,
  cafeCategories: (venue: string) => ['staff', 'cafeCategories', venue] as const,
  courts: (venue: string) => ['staff', 'courts', venue] as const,
  /** The accounts a hiring run's add_staff step may send (protocols/api.ts `fetchNewHires`). */
  newHires: (runId: string) => ['staff', 'newHires', runId] as const,
  /** The prefix src/lib/queryClient.ts sets the staff write defaults on. */
  mutationRoot: ['staff', 'mutation'] as const,
  mutation: (name: StaffMutationName) => ['staff', 'mutation', name] as const,
};
