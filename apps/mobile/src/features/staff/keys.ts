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
  | 'photo';

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
  /** The prefix src/lib/queryClient.ts sets the staff write defaults on. */
  mutationRoot: ['staff', 'mutation'] as const,
  mutation: (name: StaffMutationName) => ['staff', 'mutation', name] as const,
};
