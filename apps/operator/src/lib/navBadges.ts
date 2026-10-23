/**
 * The live counts beside rail rows and family tabs (NavBadge in
 * lib/workspaces.ts): what waits on the signed-in person there
 * (build-contracts-2026-09-23 §5.1, §5.4). Each badge is one shared read,
 * refetched every minute and on focus, so every row, tab and screen that
 * shows the same count agrees with the others. Moved out of the shell so the
 * page header's family tabs read the same counts as the rail.
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth, can } from './auth';
import { QK } from './queryKeys';
import type { NavBadge, NavItem, NavTab } from './workspaces';
import { SK, fetchUnfinishedCounts } from '../features/stock/stockKeys';
import { phoneCountsWaiting } from '../features/stock/storeLogic';
import { fetchProtocolsWaiting, protocolsWaitingTotal } from '../features/ops/protocolsWaiting';
import { fetchSuggestionsNew } from '../features/roleExtras/api';
import { newSuggestionCount } from '../features/roleExtras/roleExtrasLogic';
import { fetchDeductionsWaiting } from '../features/deductions/api';
import { deductionsWaitingCount } from '../features/deductions/deductionsLogic';
import { fetchIncidentsOpen } from '../features/incidents/api';
import { incidentsOpenCount } from '../features/incidents/incidentsLogic';
import { CK, fetchContentWaiting } from '../features/content/api';
import { CONTENT_PAGE_SIZE, contentWaitingCount, readContentPage } from '../features/content/contentLogic';
import { appRpc } from './appRpc';
import { fetchPlan } from '../features/plan/api';
import { planToDoCount, plansWaitingCount, readPlan } from '../features/plan/planLogic';
import { fetchWagesDue } from '../features/wages/api';
import { wagesDueCount } from '../features/wages/wagesLogic';

/**
 * The badges a row counts: its own, then each of its tabs' that the person
 * may open (`canOpen`), so a family's row adds up what waits behind its tabs
 * and never counts a page its reader cannot reach.
 */
export function rowBadges(row: NavItem, canOpen: (tab: NavTab) => boolean): readonly NavBadge[] {
  const out: NavBadge[] = [];
  if (row.badge) out.push(row.badge);
  for (const tab of row.tabs ?? []) if (tab.badge && canOpen(tab) && !out.includes(tab.badge)) out.push(tab.badge);
  return out;
}

/**
 * The sum of the named badges' counts, one shared read each. A wave-5 count
 * (wave5-addendum-2026-09-25 §5.2) is read only by the role that acts on it:
 * the Incidents row sits on the desk's and the till's rail too, and
 * app.incidents_page would refuse them, so theirs carries no count.
 */
export function useBadgeSum(badges: readonly (NavBadge | undefined)[]): number {
  const { staff } = useAuth();
  const on = new Set(badges);
  const protocols = useQuery({
    queryKey: QK.protocolsWaiting,
    queryFn: fetchProtocolsWaiting,
    enabled: on.has('protocolsWaiting'),
    refetchInterval: 60_000,
  });
  const suggestions = useQuery({
    queryKey: QK.suggestionsNew,
    queryFn: fetchSuggestionsNew,
    enabled: on.has('suggestionsNew'),
    refetchInterval: 60_000,
  });
  // A row counts only what it names: a disabled query still hands back what
  // another row cached under the same key, so the flag gates the sum too.
  const deductionsOn = on.has('deductionsWaiting') && can(staff, 'decideDeductions');
  const incidentsOn = on.has('incidentsOpen') && can(staff, 'reviewIncidents');
  const contentOn = on.has('contentWaiting') && can(staff, 'decideContent');
  const wagesOn = on.has('wagesDue') && can(staff, 'manageWages');
  // 0362: the owner counts months waiting on them, marketing what it must
  // make now; both from the current month's plan read (QK.planNow).
  const planWaitingOn = on.has('planWaiting') && can(staff, 'decidePlan');
  const planToDoOn = on.has('planToDo') && can(staff, 'editPlan');
  const changesOn = on.has('contentChanges') && can(staff, 'submitContent');
  const deductions = useQuery({
    queryKey: QK.deductionsWaiting,
    queryFn: fetchDeductionsWaiting,
    enabled: deductionsOn,
    refetchInterval: 60_000,
  });
  const incidents = useQuery({
    queryKey: QK.incidentsOpen,
    queryFn: fetchIncidentsOpen,
    enabled: incidentsOn,
    refetchInterval: 60_000,
  });
  const content = useQuery({
    queryKey: QK.contentWaiting,
    queryFn: fetchContentWaiting,
    enabled: contentOn,
    refetchInterval: 60_000,
  });
  const wages = useQuery({
    queryKey: QK.wagesDue,
    queryFn: fetchWagesDue,
    enabled: wagesOn,
    refetchInterval: 60_000,
  });
  const plan = useQuery({
    queryKey: QK.planNow,
    queryFn: () => fetchPlan(null),
    enabled: planWaitingOn || planToDoOn,
    refetchInterval: 60_000,
  });
  // The Changes asked list's first page, the same read /posts makes.
  const changes = useQuery({
    queryKey: CK.page('changes', 0),
    queryFn: () => appRpc<unknown>('content_page', { p_filter: 'changes', p_limit: CONTENT_PAGE_SIZE, p_offset: 0 }),
    enabled: changesOn,
    refetchInterval: 60_000,
  });
  // The phone counts waiting on the Stock count tab: the same read the stock
  // screens make, so the rail and the screen agree.
  const stockCounts = useQuery({
    queryKey: SK.unfinishedCounts,
    queryFn: fetchUnfinishedCounts,
    enabled: on.has('stockCountsWaiting'),
    refetchInterval: 60_000,
  });
  return (
    (on.has('protocolsWaiting') ? protocolsWaitingTotal(protocols.data) : 0) +
    (on.has('suggestionsNew') ? newSuggestionCount(suggestions.data) : 0) +
    (deductionsOn && deductions.isSuccess ? deductionsWaitingCount(deductions.data) : 0) +
    (incidentsOn && incidents.isSuccess ? incidentsOpenCount(incidents.data) : 0) +
    (contentOn && content.isSuccess ? contentWaitingCount(content.data) : 0) +
    (wagesOn && wages.isSuccess ? wagesDueCount(wages.data) : 0) +
    (planWaitingOn && plan.isSuccess ? plansWaitingCount(readPlan(plan.data)) : 0) +
    (planToDoOn && plan.isSuccess ? planToDoCount(readPlan(plan.data)) : 0) +
    (changesOn && changes.isSuccess ? readContentPage(changes.data).total : 0) +
    (on.has('stockCountsWaiting') && stockCounts.isSuccess ? phoneCountsWaiting(stockCounts.data).length : 0)
  );
}
