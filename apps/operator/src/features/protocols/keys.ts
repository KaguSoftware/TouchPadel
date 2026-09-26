/**
 * The Protocols page's own query keys (build-contracts-2026-09-23 §5.2), all
 * under the ['protocols'] root that QK.protocolsWaiting shares, so one
 * invalidation of ['protocols'] after any write refreshes the cards, the
 * lists, the open run and step, and the rail's waiting count together.
 *
 * The context reads each step form shows (§2.9-§2.13) sit here too: a
 * decision or a resubmission changes what they return.
 */
import type { QueryKey } from '@tanstack/react-query';
import type { PriceChangeKind } from '@touch/core/protocols';

export const PROTOCOLS_ROOT = ['protocols'] as const satisfies QueryKey;

export const PK = {
  overview: ['protocols', 'overview'] as const satisfies QueryKey,
  runs: (filter: string, kind: string | null, page: number) => ['protocols', 'runs', filter, kind, page] as const satisfies QueryKey,
  run: (id: string) => ['protocols', 'run', id] as const satisfies QueryKey,
  step: (id: string) => ['protocols', 'step', id] as const satisfies QueryKey,
  template: (id: string) => ['protocols', 'template', id] as const satisfies QueryKey,
  /** One step's context read (release_cost, tournament_context, price_promo_numbers, …), by the step it serves. */
  context: (stepKey: string, runId: string) => ['protocols', 'context', stepKey, runId] as const satisfies QueryKey,
  /** app.price_promo_targets for one change kind. */
  targets: (change: PriceChangeKind) => ['protocols', 'targets', change] as const satisfies QueryKey,
  /** app.release_review, MGMT only (#54). */
  review: (runId: string) => ['protocols', 'review', runId] as const satisfies QueryKey,
  /** The pickers the forms fill from: cafe sections, courts, ingredients, campaigns. */
  options: (what: string) => ['protocols', 'options', what] as const satisfies QueryKey,
} as const;

/** Protocol reads refetch every minute and on focus (§5.2: no realtime). */
export const PROTOCOL_REFETCH_MS = 60_000;
