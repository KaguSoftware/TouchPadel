/**
 * The main cash reads and writes (0343). Every key sits under ['main-cash'],
 * so one invalidation after any write refreshes the Safe page, Financial
 * home's card and the day-close hand-in together; the Wages page's advance
 * and pay writes invalidate the same root.
 */
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { readOverview } from './safeLogic';

export const SK = {
  all: ['main-cash'] as const satisfies QueryKey,
  /** `null` is the branch's current business month. */
  overview: (month: string | null) => ['main-cash', 'overview', month ?? 'current'] as const satisfies QueryKey,
} as const;

/** `null` is the branch's current business month. */
export function fetchOverview(month: string | null): Promise<unknown> {
  return appRpc<unknown>('main_cash_overview', month === null ? {} : { p_month: month });
}

export interface WriteResult {
  id: string;
  balance_iqd: number;
  difference_iqd?: number;
  duplicate?: boolean;
}

export const payCost = (args: Record<string, unknown>) => appRpc<WriteResult>('main_cash_pay', args);
export const moveCash = (args: Record<string, unknown>) => appRpc<WriteResult>('main_cash_move', args);
export const countSafe = (args: Record<string, unknown>) => appRpc<WriteResult>('main_cash_count', args);
export const voidEntry = (id: string, reason: string) => appRpc<WriteResult>('main_cash_void', { p_id: id, p_reason: reason });

/**
 * The safe's balance now, for a dialog that pays from it (0387, F-12): the
 * Safe page's own cached read, so both show one figure. null while unread,
 * when `enabled` is false, or for a caller the server refuses (FORBIDDEN):
 * then the dialog blocks nothing on a guess and the server is the wall.
 */
export function useSafeBalance(enabled = true): number | null {
  const q = useQuery({
    queryKey: SK.overview(null),
    queryFn: () => fetchOverview(null),
    enabled,
    staleTime: 15_000,
    retry: false,
  });
  return q.data === undefined ? null : readOverview(q.data).balanceIqd;
}
