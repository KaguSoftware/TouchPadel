/**
 * The main cash reads and writes (0343). Every key sits under ['main-cash'],
 * so one invalidation after any write refreshes the Safe page, Financial
 * home's card and the day-close hand-in together; the Wages page's advance
 * and pay writes invalidate the same root.
 */
import type { QueryKey } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';

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
