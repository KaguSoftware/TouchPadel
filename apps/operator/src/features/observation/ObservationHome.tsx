/**
 * Observation home (/observation) — the landing screen of Management's
 * Observation section.
 *
 * The screen answers two questions, in this order:
 *
 *  1. **Is anything waiting on me?** One list, in the /ops "needs you now"
 *     shape: how many, what, what to do about it in a sentence, and one button
 *     to the screen that resolves it. Three things in Observe stop until the
 *     owner acts, and nothing else in the venue will surface them:
 *       - staff requests (a person is waiting for an answer);
 *       - scheduled campaigns whose start date has passed, and live campaigns
 *         whose last day has passed. Nothing moves a campaign's status on its
 *         own (app.set_campaign_status is the only writer), so a campaign
 *         "scheduled" for last week is still scheduled until someone says so.
 *     When nothing is waiting it says so plainly rather than disappearing: a
 *     strip that vanishes when it is empty cannot be trusted to appear when it
 *     is not.
 *  2. **Where do I look?** The section's screens as cards, in rail order, each
 *     with one live line where there is an honest figure for it (bookings
 *     today, open tabs, live campaigns) so a card says what is there as well
 *     as what the screen is. The request count is NOT repeated on its card:
 *     it is already the first row of the list above.
 *
 * Figures come from reads the other Observe screens already make:
 * `ops_overview` (the Floor now screen's, under the same query key so the two
 * share a cache), `staff_requests_page` and `marketing_overview`.
 */
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatNumber, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { canAccess, useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { SectionHome } from '../../components/SectionHome';
import { Button, Skeleton } from '../../components/ui';
import { Panel } from '../../components/kit';
import { Icon, type IconName } from '../../components/icons';
import { CardTitle, MARK, MARK_FG, MARK_SOFT } from '../ops/OpsVisuals';
import { OPS_OVERVIEW_KEY, OPS_REFETCH_MS } from '../ops/OperationsOverview';
import { alertsFor, normalizeOverview } from '../ops/opsLogic';
import { MARKETING_QUERY_KEY, overdueCampaigns, type MarketingOverview } from '../marketing/marketingTypes';
import { REQUESTS_QUERY_KEY, type StaffRequestsPage } from './requestTypes';
import { LiveFloor } from '../floor/LiveFloor';

type CardKey =
  | 'floorNow' | 'bookings' | 'tills'
  | 'staffActivity' | 'requests' | 'marketing' | 'audit';

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
      case 'floorNow': {
        if (!floor) return null;
        const alerts = alertsFor(floor).length;
        return alerts === 0 ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', color: MARK_FG.success, fontWeight: 600 }}>
            <Icon name="checkCircle" size={14} style={{ color: MARK.success }} />
            {tr('ws.owner.observationHome.status.clear')}
          </span>
        ) : (
          <>
            <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.observationHome.status.alerts')}</span>
            <strong style={{ color: MARK_FG.warn, fontVariantNumeric: 'tabular-nums' }}>{formatNumber(alerts, locale)}</strong>
          </>
        );
      }
      case 'bookings':
        return floor ? line('ws.owner.observationHome.status.bookedToday', floor.bookings.today) : null;
      case 'tills':
        return floor ? line('ws.owner.observationHome.status.openTabs', floor.cafe.openTabs) : null;
      case 'marketing':
        return marketingQ.data ? line('ws.owner.observationHome.status.liveCampaigns', marketingQ.data.counts.live) : null;
      default:
        return null;
    }
  }

  return (
    <SectionHome
      sectionKey="observation"
      fullWidth
      title={tr('ws.owner.observationHome.title')}
      card={(key) => tr(`ws.owner.observationHome.cards.${key as CardKey}`)}
      status={status}
      screensTitle={tr('ws.owner.observationHome.screens')}
    >
      <WaitingOnYou pendingQ={pendingQ} marketingQ={canMarketing ? marketingQ : null} />
      <div style={{ blockSize: 'var(--tp-sp-4)' }} />
      {/* After what needs a decision, what the floor is doing right now (owner
          request, 2026-09-18). The Bookings and Tills cards below are the way
          deeper, so the plan does not repeat them as buttons here. */}
      <LiveFloor blockSize="30rem" />
      <div style={{ blockSize: 'var(--tp-sp-4)' }} />
    </SectionHome>
  );
}

interface Waiting {
  key: string;
  count: number;
  title: MessageKey;
  hint: MessageKey;
  action: MessageKey;
  href: string;
  icon: IconName;
}

function WaitingOnYou({
  pendingQ,
  marketingQ,
}: {
  pendingQ: { data?: StaffRequestsPage; isPending: boolean; isError: boolean; refetch: () => unknown };
  /** Null when the viewer may not open marketing at all. */
  marketingQ: { data?: MarketingOverview; isPending: boolean; isError: boolean; refetch: () => unknown } | null;
}) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();

  const loading = pendingQ.isPending || (marketingQ?.isPending ?? false);
  const failed = [pendingQ, marketingQ].filter((q): q is NonNullable<typeof q> => q !== null && q.isError);

  const rows: Waiting[] = [];
  const pending = pendingQ.data?.pending ?? 0;
  if (pending > 0) {
    rows.push({
      key: 'requests',
      count: pending,
      title: 'ws.owner.observationHome.waiting.requests',
      hint: 'ws.owner.observationHome.waiting.requestsHint',
      action: 'ws.owner.observationHome.waiting.requestsAction',
      href: '/observation/requests',
      icon: 'bell',
    });
  }
  if (marketingQ?.data) {
    const { toStart, toEnd } = overdueCampaigns(marketingQ.data.campaigns, Date.now());
    if (toStart.length > 0) {
      rows.push({
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
      rows.push({
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

  const clear = !loading && failed.length === 0 && rows.length === 0;

  return (
    <Panel title={<CardTitle icon={clear ? 'checkCircle' : 'bell'}>{tr('ws.owner.observationHome.waiting.title')}</CardTitle>}>
      {loading && rows.length === 0 ? (
        <Skeleton lines={1} blockSize="1.6rem" />
      ) : clear ? (
        <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', fontWeight: 600, color: MARK_FG.success }}>
          <Icon name="checkCircle" size={18} style={{ color: MARK.success, flex: '0 0 auto' }} />
          {tr('ws.owner.observationHome.waiting.none')}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
          {rows.map((r) => (
            <li key={r.key} style={rowStyle}>
              <span style={{ ...countBlock, background: MARK_SOFT.warn, color: MARK_FG.warn }}>{formatNumber(r.count, locale)}</span>
              <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 16rem', minInlineSize: 0 }}>
                <strong>{tr(r.title)}</strong>
                <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr(r.hint)}</span>
              </span>
              <Button size="sm" iconEnd="arrowUpRight" onClick={() => void navigate({ to: r.href })}>
                {tr(r.action)}
              </Button>
            </li>
          ))}
          {/* A check that failed is not a check that passed: say so beside the rest. */}
          {failed.length > 0 && (
            <li style={rowStyle}>
              <span style={{ ...countBlock, background: MARK_SOFT.neutral, color: MARK_FG.neutral }}>
                <Icon name="alert" size={18} style={{ color: MARK.danger }} />
              </span>
              <span style={{ flex: '1 1 16rem', minInlineSize: 0, fontWeight: 600 }}>{tr('ws.owner.observationHome.waiting.error')}</span>
              <Button size="sm" icon="refresh" onClick={() => failed.forEach((q) => void q.refetch())}>
                {tr('common.retry')}
              </Button>
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
}

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--tp-sp-3)',
  flexWrap: 'wrap',
  paddingBlock: 'var(--tp-sp-2)',
  paddingInline: 'var(--tp-sp-2)',
  borderRadius: 'var(--tp-radius-ctl)',
  background: 'var(--tp-surface-2)',
} as const;

const countBlock = {
  display: 'grid',
  placeItems: 'center',
  minInlineSize: '3rem',
  blockSize: '2.5rem',
  paddingInline: 'var(--tp-sp-2)',
  borderRadius: 'var(--tp-radius-ctl)',
  fontSize: 'var(--tp-fs-lg)',
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
} as const;
