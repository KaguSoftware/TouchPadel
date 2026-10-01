/**
 * The wages reads more than one screen shares (0271), kept apart from the page
 * so the shell (the rail badge), the management panel's card and Financial
 * home read them without loading it.
 *
 * QK.wagesDue holds app.wages_due as returned: its count is the badge, so the
 * rail, the panel card, Financial home and the page's "Due now" strip always
 * agree. Every other wages read sits under the same ['wages'] root, so one
 * invalidation after a pay write refreshes them all.
 */
import type { QueryKey } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';

export function fetchWagesDue(): Promise<unknown> {
  return appRpc<unknown>('wages_due', {});
}

/** `null` is the branch's current business month. */
export function fetchWagesMonth(month: string | null): Promise<unknown> {
  return appRpc<unknown>('wages_month', month === null ? {} : { p_month: month });
}

/** Feature-private keys, all under ['wages'] (QK.wagesDue is ['wages', 'due']). */
export const WK = {
  all: ['wages'] as const satisfies QueryKey,
  /** `null` is the branch's current business month. */
  month: (month: string | null) => ['wages', 'month', month ?? 'current'] as const satisfies QueryKey,
} as const;
