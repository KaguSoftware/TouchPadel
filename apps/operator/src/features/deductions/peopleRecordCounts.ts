/**
 * The wave-5 people-record counts that /ops "Needs you now" and Observe
 * home's "Waiting on you" show (wave5-addendum-2026-09-25 §5.2): pay
 * deductions to decide, incident reports to review and, for the owner, posts
 * to approve. Each is the rail badge's own read under its QK key, so the rail,
 * the rows and the pages agree, and each is read only by a role its RPC admits
 * (the capability that mirrors its guard): a manager never reads content
 * (§8 Q14), so that count is simply absent for them.
 */
import { useQuery } from '@tanstack/react-query';
import { can, useAuth } from '../../lib/auth';
import { QK } from '../../lib/queryKeys';
import { fetchDeductionsWaiting } from './api';
import { deductionsWaitingCount } from './deductionsLogic';
import { fetchIncidentsOpen } from '../incidents/api';
import { incidentsOpenCount } from '../incidents/incidentsLogic';
import { fetchContentWaiting } from '../content/api';
import { contentWaitingCount } from '../content/contentLogic';

export interface PeopleRecordCounts {
  deductions?: number;
  incidents?: number;
  content?: number;
}

type Read = { isPending: boolean; isError: boolean; refetch: () => unknown };

export function usePeopleRecordCounts(): PeopleRecordCounts & { reads: Read[] } {
  const { staff } = useAuth();
  const role = staff?.role;
  const deductionsOn = can(role, 'decideDeductions');
  const incidentsOn = can(role, 'reviewIncidents');
  const contentOn = can(role, 'decideContent');
  const deductions = useQuery({ queryKey: QK.deductionsWaiting, queryFn: fetchDeductionsWaiting, enabled: deductionsOn, refetchInterval: 60_000 });
  const incidents = useQuery({ queryKey: QK.incidentsOpen, queryFn: fetchIncidentsOpen, enabled: incidentsOn, refetchInterval: 60_000 });
  const content = useQuery({ queryKey: QK.contentWaiting, queryFn: fetchContentWaiting, enabled: contentOn, refetchInterval: 60_000 });
  return {
    // Gated by the flag as well: a disabled query still returns what another
    // screen cached under its key.
    deductions: deductionsOn && deductions.isSuccess ? deductionsWaitingCount(deductions.data) : undefined,
    incidents: incidentsOn && incidents.isSuccess ? incidentsOpenCount(incidents.data) : undefined,
    content: contentOn && content.isSuccess ? contentWaitingCount(content.data) : undefined,
    // The reads this role makes, so a list can say when one failed.
    reads: [deductionsOn ? deductions : null, incidentsOn ? incidents : null, contentOn ? content : null].filter((q): q is typeof deductions => q !== null),
  };
}
