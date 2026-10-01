/**
 * The attendance reads (0271): app.attendance_month, the manager's and the
 * owner's month of recorded late and early days. Every read sits under the
 * ['attendance'] root, so one invalidation after a write refreshes them all.
 */
import type { QueryKey } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';

/** `null` is the branch's current business month. */
export function fetchAttendanceMonth(month: string | null): Promise<unknown> {
  return appRpc<unknown>('attendance_month', month === null ? {} : { p_month: month });
}

/** Feature-private keys, all under ['attendance']. */
export const AK = {
  all: ['attendance'] as const satisfies QueryKey,
  /** `null` is the branch's current business month. */
  month: (month: string | null) => ['attendance', 'month', month ?? 'current'] as const satisfies QueryKey,
} as const;
