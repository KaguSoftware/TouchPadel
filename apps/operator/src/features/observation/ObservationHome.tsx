/**
 * Observation home (/observation) — the landing screen of Management's
 * Observe section, and the owner's reading of the floor right now.
 *
 * Floor now is this overview's body (owner call, 2026-10-08). The screen
 * answers, in order:
 *
 *  1. **Does anything need me?** One "Needs you" list (FloorNow, the
 *     manager's Today body, rebuilt 2026-10-16): the floor's alarms, the
 *     online refunds, lesson refunds and player reports (each opening in
 *     place), and the people records, then what only the owner answers and
 *     nothing else in the venue will surface:
 *       - staff requests (a person is waiting for an answer);
 *       - new staff suggestions (build-contracts-2026-09-23 §5.4);
 *       - scheduled campaigns whose start date has passed, and live campaigns
 *         whose last day has passed. Nothing moves a campaign's status on its
 *         own (app.set_campaign_status is the only writer).
 *     Three rows show and the rest wait behind "View more". When nothing is
 *     waiting it says so plainly rather than disappearing.
 *  2. **What is the floor doing?** On the floor now with the live floor plan
 *     under it, who worked today, and so far today.
 *
 * Management rebuild (2026-10-17): the grid of one card per Observe screen is
 * gone, because the rail beside it already lists them, and "Before you close"
 * and "Stock to watch" are left to the sections that own them (FloorNow's
 * `observe` variant). Every row of "Needs you" still links to its screen.
 *
 * Figures come from reads the other Observe screens already make:
 * `ops_overview` (under the same query key as Today, so the two share a
 * cache), `staff_requests_page`, `marketing_overview`, and the rail badges'
 * QK.protocolsWaiting and QK.suggestionsNew.
 */
import { useQuery } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { canAccess, useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { PageHeader } from '../../components/kit';
import { FloorNow, useFloorNowHeading, type ExtraNeed, type FloorNowExtras } from '../ops/OperationsOverview';
import { MARKETING_QUERY_KEY, overdueCampaigns, type MarketingOverview } from '../marketing/marketingTypes';
import { REQUESTS_QUERY_KEY, type StaffRequestsPage } from './requestTypes';
import { LiveFloor } from '../floor/LiveFloor';
import { QK } from '../../lib/queryKeys';
import { fetchProtocolsWaiting } from '../ops/protocolsWaiting';
import { fetchSuggestionsNew } from '../roleExtras/api';
import { newSuggestionCount } from '../roleExtras/roleExtrasLogic';
import { usePeopleRecordCounts } from '../deductions/peopleRecordCounts';
import { useShiftDifferences } from '../tillShift/useShiftDifferences';

export function ObservationHomeScreen() {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const canMarketing = canAccess(staff, '/marketing');

  const pendingQ = useQuery({
    queryKey: [...REQUESTS_QUERY_KEY, 'pending-count'],
    queryFn: () => appRpc<StaffRequestsPage>('staff_requests_page', { p_status: 'pending', p_limit: 1, p_offset: 0 }),
    refetchInterval: 60_000,
  });
  const marketingQ = useQuery({
    queryKey: MARKETING_QUERY_KEY,
    queryFn: () => appRpc<MarketingOverview>('marketing_overview'),
    refetchInterval: 60_000,
    enabled: canMarketing,
  });
  const canProtocols = canAccess(staff, '/protocols');
  const canSuggestions = canAccess(staff, '/suggestions');
  const protocolsQ = useQuery({ queryKey: QK.protocolsWaiting, queryFn: fetchProtocolsWaiting, refetchInterval: 60_000, enabled: canProtocols });
  const suggestionsQ = useQuery({ queryKey: QK.suggestionsNew, queryFn: fetchSuggestionsNew, refetchInterval: 60_000, enabled: canSuggestions });
  // Wave 5: deductions to decide, incidents to review, posts to approve.
  const people = usePeopleRecordCounts();
  // Wave 5, till shifts (§5.2, §8 Q27): today's closed short or over, to Day close.
  const shiftDiffs = useShiftDifferences(canAccess(staff, '/admin/day-close'));
  const heading = useFloorNowHeading();

  const extras = useOwnerNeeds({
    pendingQ,
    marketingQ: canMarketing ? marketingQ : null,
    protocolsQ: canProtocols ? protocolsQ : null,
    suggestionsQ: canSuggestions ? suggestionsQ : null,
    people,
    shiftDiffs,
  });

  return (
    <div>
      <PageHeader title={tr('ws.owner.observationHome.title')} subtitle={heading.subtitle} actions={heading.actions} />
      {/* The live plan sits after what needs a decision (owner request, 2026-09-18). */}
      <FloorNow variant="observe" extras={extras} afterAttention={<LiveFloor blockSize="30rem" />} />
    </div>
  );
}

type Read<T> = { data?: T; isPending: boolean; isError: boolean; refetch: () => unknown };

/**
 * What only the owner answers, as rows for "Needs you". The protocol,
 * people-record and till-shift rows are already the floor's own; their reads
 * are passed here only so a failed one is said.
 */
function useOwnerNeeds({
  pendingQ,
  marketingQ,
  protocolsQ,
  suggestionsQ,
  people,
  shiftDiffs,
}: {
  pendingQ: Read<StaffRequestsPage>;
  /** Null when the viewer may not open marketing at all. */
  marketingQ: Read<MarketingOverview> | null;
  /** app.protocols_waiting_count and the suggestion box's New count; null when the viewer may not open them. */
  protocolsQ: Read<unknown> | null;
  suggestionsQ: Read<unknown> | null;
  /** Wave 5: the people-record counts, each present only for a role its read admits. */
  people: ReturnType<typeof usePeopleRecordCounts>;
  /** Wave 5: today's till shifts closed short or over; no read for a role that cannot open Day close. */
  shiftDiffs: ReturnType<typeof useShiftDifferences>;
}): FloorNowExtras {
  const reads = [pendingQ, marketingQ, protocolsQ, suggestionsQ, ...people.reads, shiftDiffs.read].filter((q): q is Read<unknown> => q !== null);

  const needs: ExtraNeed[] = [];
  const pending = pendingQ.data?.pending ?? 0;
  if (pending > 0) {
    needs.push({
      key: 'requests',
      count: pending,
      title: 'ws.owner.observationHome.waiting.requests',
      hint: 'ws.owner.observationHome.waiting.requestsHint',
      action: 'ws.owner.observationHome.waiting.requestsAction',
      href: '/observation/requests',
      icon: 'bell',
    });
  }
  const suggestions = suggestionsQ?.data !== undefined ? newSuggestionCount(suggestionsQ.data) : 0;
  if (suggestions > 0) {
    needs.push({
      key: 'suggestions',
      count: suggestions,
      title: 'ws.rolePages.suggestions.waiting',
      hint: 'ws.rolePages.suggestions.waitingHint',
      action: 'ws.rolePages.suggestions.waitingAction',
      href: '/suggestions',
      icon: 'note',
    });
  }
  if (marketingQ?.data) {
    const { toStart, toEnd } = overdueCampaigns(marketingQ.data.campaigns, Date.now());
    if (toStart.length > 0) {
      needs.push({
        key: 'toStart',
        count: toStart.length,
        title: 'ws.owner.observationHome.waiting.toStart',
        hint: 'ws.owner.observationHome.waiting.toStartHint',
        action: 'ws.owner.observationHome.waiting.campaignsAction',
        href: '/marketing',
        icon: 'spark',
      });
    }
    if (toEnd.length > 0) {
      needs.push({
        key: 'toEnd',
        count: toEnd.length,
        title: 'ws.owner.observationHome.waiting.toEnd',
        hint: 'ws.owner.observationHome.waiting.toEndHint',
        action: 'ws.owner.observationHome.waiting.campaignsAction',
        href: '/marketing',
        icon: 'spark',
      });
    }
  }
  return { needs, loading: reads.some((q) => q.isPending), failed: reads.filter((q) => q.isError) };
}
