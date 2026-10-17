/**
 * "Needs you" on the owner's Overview (/panel), above the live floor (page map,
 * Sait 2026-10-17). It moved here from the Observe overview, the owner's old
 * Floor now page, so the first screen the owner lands on says what is waiting:
 *
 *   - the floor's own rows (FloorNow's "Needs you": alarms, online and lesson
 *     refunds, player reports, people records, till shifts closed short or
 *     over);
 *   - and what only the owner answers, which nothing else in the venue will
 *     surface: staff requests, new staff suggestions, and scheduled campaigns
 *     whose start date has passed or live ones whose last day has passed
 *     (nothing moves a campaign's status on its own; app.set_campaign_status
 *     is the only writer).
 *
 * Three rows show and the rest wait behind "View more"; when nothing is
 * waiting it says so plainly. Figures come from reads other screens already
 * make: `ops_overview` (Today's query key, so the two share a cache),
 * `staff_requests_page`, `marketing_overview`, and the rail badges'
 * QK.protocolsWaiting and QK.suggestionsNew.
 */
import { useQuery } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { canAccess, useAuth } from '../../lib/auth';
import { NeedsYouNow, type ExtraNeed, type FloorNowExtras } from '../ops/OperationsOverview';
import { MARKETING_QUERY_KEY, overdueCampaigns, type MarketingOverview } from '../marketing/marketingTypes';
import { REQUESTS_QUERY_KEY, type StaffRequestsPage } from '../observation/requestTypes';
import { QK } from '../../lib/queryKeys';
import { fetchProtocolsWaiting } from '../ops/protocolsWaiting';
import { fetchSuggestionsNew } from '../roleExtras/api';
import { newSuggestionCount } from '../roleExtras/roleExtrasLogic';
import { usePeopleRecordCounts } from '../deductions/peopleRecordCounts';
import { useShiftDifferences } from '../tillShift/useShiftDifferences';

export function PanelNeedsYou() {
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

  const extras = useOwnerNeeds({
    pendingQ,
    marketingQ: canMarketing ? marketingQ : null,
    protocolsQ: canProtocols ? protocolsQ : null,
    suggestionsQ: canSuggestions ? suggestionsQ : null,
    people,
    shiftDiffs,
  });

  return <NeedsYouNow extras={extras} />;
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
