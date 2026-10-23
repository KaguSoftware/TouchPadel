/**
 * The plan's reads and writes (0362). Every key sits under ['plan'] (QK.planNow
 * is the current month as the badges read it), so one invalidation after any
 * write refreshes the page, the rail and Needs you together. A result sent for
 * an idea is a content item, so a send invalidates ['content'] too.
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { CK } from '../content/api';

export const PK = {
  all: ['plan'] as const satisfies QueryKey,
  /** One month, by its first day ('YYYY-MM-01'), or null for the branch's current month. */
  month: (month: string | null) => ['plan', 'month', month] as const satisfies QueryKey,
} as const;

export function fetchPlan(month: string | null): Promise<unknown> {
  return appRpc<unknown>('marketing_plan', { p_month: month });
}

export function refreshPlan(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: PK.all });
  void qc.invalidateQueries({ queryKey: CK.all });
}
