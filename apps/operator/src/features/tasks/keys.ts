/**
 * My tasks' own query keys (build-contracts-2026-09-23 §5.2). The protocol
 * reads sit under the ['protocols'] root, so any protocol write that
 * invalidates it (a submit here, a decision on /protocols) refreshes this page
 * and the kitchen board's My tasks count with it. Each holds its RPC's payload
 * as returned.
 */
import type { QueryKey } from '@tanstack/react-query';

export const TK = {
  /** app.my_protocol_work: To do, Waiting, Decided; the kitchen board counts To do. */
  work: ['protocols', 'myWork'] as const satisfies QueryKey,
  /** app.protocol_step_detail for one of my steps. */
  step: (runStepId: string) => ['protocols', 'taskStep', runStepId] as const satisfies QueryKey,
  /** The test form's size picker: app.release_test_context (the context panel reads through PK.context). */
  context: (read: string, id: string) => ['protocols', 'taskContext', read, id] as const satisfies QueryKey,
  /** app.price_promo_targets for one change kind. */
  targets: (change: string) => ['protocols', 'taskTargets', change] as const satisfies QueryKey,
  /** The option lists a form offers (courts, menu, campaign drafts). */
  options: (what: string) => ['taskOptions', what] as const satisfies QueryKey,
} as const;
