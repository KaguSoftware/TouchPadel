/**
 * The deduction reads more than one screen shares, kept apart from the page so
 * the shell (the rail badge), Observe home and /ops can read them without
 * loading it (wave5-addendum-2026-09-25 §5.2).
 *
 * QK.deductionsWaiting holds the Waiting tab's first page as returned: its
 * waiting_count is the badge, so the rail, the page and the "N deductions to
 * decide" rows always agree. Every other read of the page sits under the same
 * ['deductions'] root, so one invalidation after a write refreshes them all.
 */
import type { QueryKey } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { DEDUCTIONS_PAGE_SIZE } from './deductionsLogic';

export function fetchDeductionsWaiting(): Promise<unknown> {
  return appRpc<unknown>('deductions_page', { p_filter: 'waiting', p_limit: DEDUCTIONS_PAGE_SIZE, p_offset: 0 });
}

/** Feature-private keys, all under ['deductions'] (QK.deductionsWaiting is ['deductions', 'waiting']). */
export const DK = {
  all: ['deductions'] as const satisfies QueryKey,
  page: (filter: string, offset: number) => ['deductions', 'page', filter, offset] as const satisfies QueryKey,
  /** `null` is the venue's current business month. */
  month: (month: string | null) => ['deductions', 'month', month ?? 'current'] as const satisfies QueryKey,
  targets: ['deductions', 'targets'] as const satisfies QueryKey,
} as const;
