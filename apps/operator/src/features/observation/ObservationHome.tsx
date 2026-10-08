/**
 * Observation home (/observation) — the landing screen of Management's
 * Observation section, and the owner's reading of the floor right now.
 *
 * Floor now used to be a screen of its own under this one; it is an overview,
 * so it lives here (owner call, 2026-10-08). The screen answers, in order:
 *
 *  1. **Does anything need me?** One "Needs you now" list (FloorNow, the
 *     manager's Today body): the floor's alarms and the people records, then
 *     what only the owner answers and nothing else in the venue will surface:
 *       - staff requests (a person is waiting for an answer);
 *       - new staff suggestions (build-contracts-2026-09-23 §5.4);
 *       - scheduled campaigns whose start date has passed, and live campaigns
 *         whose last day has passed. Nothing moves a campaign's status on its
 *         own (app.set_campaign_status is the only writer), so a campaign
 *         "scheduled" for last week is still scheduled until someone says so.
 *     Three rows show and the rest wait behind "View more". When nothing is
 *     waiting it says so plainly rather than disappearing.
 *  2. **What is the floor doing?** The online refunds, the live floor plan,
 *     then courts, cafe, stock, closing the day and staff activity.
 *  3. **Where do I look?** The section's screens as cards, in rail order, each
 *     with one live line where there is an honest figure for it.
 *
 * Figures come from reads the other Observe screens already make:
 * `ops_overview` (under the same query key as Today, so the two share a
 * cache), `staff_requests_page`, `marketing_overview`, and the rail badges'
 * QK.protocolsWaiting and QK.suggestionsNew.
 */
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatNumber, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { canAccess, useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { SectionHome } from '../../components/SectionHome';
import { FloorNow, OPS_OVERVIEW_KEY, OPS_REFETCH_MS, useFloorNowHeading, type ExtraNeed, type FloorNowExtras } from '../ops/OperationsOverview';
import { normalizeOverview } from '../ops/opsLogic';
import { MARKETING_QUERY_KEY, overdueCampaigns, type MarketingOverview } from '../marketing/marketingTypes';
import { REQUESTS_QUERY_KEY, type StaffRequestsPage } from './requestTypes';
import { LiveFloor } from '../floor/LiveFloor';
import { QK } from '../../lib/queryKeys';
import { fetchProtocolsWaiting, protocolsWaitingTotal } from '../ops/protocolsWaiting';
import { fetchSuggestionsNew } from '../roleExtras/api';
import { newSuggestionCount } from '../roleExtras/roleExtrasLogic';
import { usePeopleRecordCounts } from '../deductions/peopleRecordCounts';
import { useShiftDifferences } from '../tillShift/useShiftDifferences';

type CardKey =
  | 'bookings' | 'tills'
  | 'staffActivity' | 'requests' | 'protocols' | 'suggestions' | 'marketing' | 'audit'
  // Wave 5 (wave5-addendum-2026-09-25 §5.2): their card words live with their screens.
  | 'deductions' | 'incidents';

/** A card's words: the wave-5 screens keep theirs in their own catalogs. */
function cardKey(key: CardKey): MessageKey {
  if (key === 'deductions') return 'ws.deductions.card';
  if (key === 'incidents') return 'ws.incidents.card';
  return `ws.owner.observationHome.cards.${key}`;
}

export function ObservationHomeScreen() {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const canMarketing = canAccess(staff?.role, '/marketing');

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
  const floorQ = useQuery({
    queryKey: OPS_OVERVIEW_KEY,
    queryFn: async () => normalizeOverview(await appRpc<unknown>('ops_overview')),
    refetchInterval: OPS_REFETCH_MS,
  });
  const canProtocols = canAccess(staff?.role, '/protocols');
  const canSuggestions = canAccess(staff?.role, '/suggestions');
  const protocolsQ = useQuery({ queryKey: QK.protocolsWaiting, queryFn: fetchProtocolsWaiting, refetchInterval: 60_000, enabled: canProtocols });
  const suggestionsQ = useQuery({ queryKey: QK.suggestionsNew, queryFn: fetchSuggestionsNew, refetchInterval: 60_000, enabled: canSuggestions });
  // Wave 5: deductions to decide, incidents to review, posts to approve.
  const people = usePeopleRecordCounts();
  // Wave 5, till shifts (§5.2, §8 Q27): today's closed short or over, to Day close.
  const shiftDiffs = useShiftDifferences(canAccess(staff?.role, '/admin/day-close'));
  const heading = useFloorNowHeading();

  const count = (n: number) => <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatNumber(n, locale)}</strong>;
  const line = (label: MessageKey, n: number) => (
    <>
      <span style={{ color: 'var(--tp-muted-fg)' }}>{tr(label)}</span>
      {count(n)}
    </>
  );

  function status(key: string): ReactNode {
    const floor = floorQ.data;
    switch (key as CardKey) {
      case 'bookings':
        return floor ? line('ws.owner.observationHome.status.bookedToday', floor.bookings.today) : null;
      case 'tills':
        return floor ? line('ws.owner.observationHome.status.openTabs', floor.cafe.openTabs) : null;
      case 'marketing':
        return marketingQ.data ? line('ws.owner.observationHome.status.liveCampaigns', marketingQ.data.counts.live) : null;
      case 'protocols':
        return protocolsQ.data !== undefined ? line('ws.owner.observationHome.status.waitingOnYou', protocolsWaitingTotal(protocolsQ.data)) : null;
      case 'suggestions':
        return suggestionsQ.data !== undefined ? line('ws.owner.observationHome.status.newSuggestions', newSuggestionCount(suggestionsQ.data)) : null;
      case 'deductions':
        return people.deductions !== undefined ? line('ws.deductions.tab.waiting', people.deductions) : null;
      case 'incidents':
        return people.incidents !== undefined ? line('ws.incidents.filter.open', people.incidents) : null;
      default:
        return null;
    }
  }

  const extras = useOwnerNeeds({
    pendingQ,
    marketingQ: canMarketing ? marketingQ : null,
    protocolsQ: canProtocols ? protocolsQ : null,
    suggestionsQ: canSuggestions ? suggestionsQ : null,
    people,
    shiftDiffs,
  });

  return (
    <SectionHome
      sectionKey="observation"
      fullWidth
      title={tr('ws.owner.observationHome.title')}
      lead={heading.subtitle}
      actions={heading.actions}
      card={(key) => tr(cardKey(key as CardKey))}
      status={status}
      screensTitle={tr('ws.owner.observationHome.screens')}
    >
      {/* The live plan sits after what needs a decision (owner request,
          2026-09-18). The Bookings and Tills cards below are the way deeper,
          so the plan does not repeat them as buttons here. */}
      <FloorNow extras={extras} afterAttention={<LiveFloor blockSize="30rem" />} />
      <div style={{ blockSize: 'var(--tp-sp-4)' }} />
    </SectionHome>
  );
}

type Read<T> = { data?: T; isPending: boolean; isError: boolean; refetch: () => unknown };

/**
 * What only the owner answers, as rows for "Needs you now". The protocol,
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
