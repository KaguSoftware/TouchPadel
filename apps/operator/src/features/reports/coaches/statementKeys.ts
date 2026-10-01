/**
 * The statements list's feature-private query key and read (docs/design/
 * coaching/operator.md §5.4): `['reports', 'report_coach_statements', month ??
 * 'current']`. It sits under the `reports` root on purpose: the report scope
 * (ReportBranchScope) refetches every `reports…` key when the owner widens to
 * "All branches", and `report_coach_statements` matches `REPORT_RPC`, so the
 * list follows the scope with no change here. Never persisted.
 *
 * Shared by /reports/coaches and the Financial home's Coach pay card.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { appRpc } from '../../../lib/appRpc';
import { readStatements, type CoachStatements } from '../../coaching/lessonPayloads';
import { lessonRead, STATEMENTS_ROOT } from '../../coaching/useCoaching';

/** The list for one month ('YYYY-MM-01'), or the server's current month for null. */
export function statementsKey(month: string | null) {
  return [...STATEMENTS_ROOT, month ?? 'current'] as const;
}

/** app.report_coach_statements; null on a server without it (RPC_MISSING). */
export function fetchStatements(month: string | null): Promise<CoachStatements | null> {
  return lessonRead(
    () => appRpc('report_coach_statements', month ? { p_month: month } : {}),
    readStatements,
  );
}

/** The month's statements, read on mount and every minute while shown. */
export function useCoachStatements(
  month: string | null,
  enabled = true,
): UseQueryResult<CoachStatements | null> {
  return useQuery({
    queryKey: statementsKey(month),
    queryFn: () => fetchStatements(month),
    enabled,
    refetchInterval: 60_000,
  });
}
