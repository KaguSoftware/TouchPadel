/**
 * Today (/ops): the manager's landing screen in Management, rebuilt from zero
 * on 2026-10-16 ("you are Majed": the old one was eight boxes of equal weight,
 * four to-do lists in three designs, the same figure in two or three places,
 * red and amber on things nothing can undo, and buttons and chevrons you could
 * not predict). The owner reads the same body (FloorNow) on Observe's overview,
 * with their own rows added to "Needs you" and the live floor plan under the
 * floor; an owner who opens /ops is sent there.
 *
 * HOW IT READS
 *
 *   ┌ the day not open: one banner, the page's only primary button ──────┐
 *   ├ NOW (wide)                         ┬ THE DAY (narrow)              ┤
 *   │  Needs you: the ONE to-do list     │  Before you close              │
 *   │  On the floor now                  │  Stock to watch                │
 *   │  (Observe: the live floor plan)    │  So far today                  │
 *   │  Who worked today                  │                                │
 *   └────────────────────────────────────┴───────────────────────────────┘
 *
 * Below about a 1220px screen the two columns stack, now first.
 *
 * THE RULES IT KEEPS (each answers one thing the old page got wrong)
 *
 *  1. One to-do list. Everything that needs a person is a row of "Needs you"
 *     in one shape with one action, including the online refunds, lesson
 *     refunds and player reports, which open in place (NeedsYou.tsx).
 *  2. Every figure appears once (TodaySections.tsx).
 *  3. Colour means act: only "Needs you" and the checks before closing carry it.
 *  4. Clickable looks clickable: a whole row with a chevron, or one link in a
 *     panel's header, named for where it goes.
 *  5. The day not open is one banner, not a row and a card saying it twice.
 *
 * One read drives the page: `app.ops_overview()` (0068 … 0292), polled every
 * 30 s and invalidated on the 'floor' / 'courts' / 'kds' broadcasts. Every
 * figure is the server's, except the writes this station has not sent yet,
 * which only this machine knows (opsLogic.ts).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatTime } from '@touch/i18n';
import { canAccess, useAuth } from '../../lib/auth';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useBroadcast } from '../../lib/realtime';
import { touch } from '../../ipc/bridge';
import { Button } from '../../components/ui';
import { AsyncStateWrapper, PageHeader, asyncStatus } from '../../components/kit';
import { normalizeOverview, type OpsOverview } from './opsLogic';
import { NeedsYou, type FloorNowExtras } from './NeedsYou';
import { BeforeYouClose, DayClosedBanner, FloorPanel, SoFarToday, StockToWatch, WhoWorked, daySubtitle } from './TodaySections';

export type { ExtraNeed, FloorNowExtras } from './NeedsYou';

export const OPS_OVERVIEW_KEY = ['opsOverview'] as const;
export const OPS_REFETCH_MS = 30_000;

type Go = (href: string) => void;

/**
 * Writes this station has queued and not yet synced. Read exactly the way the
 * day-close screen reads them, so both screens agree on whether the day can
 * close. Browser mode has no queue and reports none.
 */
function useQueuedCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      touch
        .getQueueRows()
        .then((rows) => {
          if (!cancelled) setCount(rows.length);
        })
        .catch(() => {});
    };
    load();
    const unsubscribe = touch.onQueueUpdate(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return count;
}

function useOpsOverview() {
  return useQuery({
    queryKey: OPS_OVERVIEW_KEY,
    queryFn: async () => normalizeOverview(await appRpc<unknown>('ops_overview')),
    refetchInterval: OPS_REFETCH_MS,
  });
}

/**
 * The heading's two live parts: the business day as the subtitle (which day
 * and since when, not a description of the screen), and the last-updated time
 * beside a refresh button. Observe's overview uses the same.
 */
function useFloorNowHeading(): { subtitle: string | undefined; actions: ReactNode } {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const overviewQ = useOpsOverview();
  const updatedAt = overviewQ.dataUpdatedAt ? new Date(overviewQ.dataUpdatedAt) : null;
  const subtitle = overviewQ.data ? daySubtitle(overviewQ.data, tr, locale) : undefined;

  const actions = (
    <>
      {updatedAt && (
        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.ops.updated', { time: formatTime(updatedAt, locale) })}</span>
      )}
      <Button
        icon="refresh"
        size="sm"
        busy={overviewQ.isFetching && overviewQ.data !== undefined}
        onClick={() => void queryClient.invalidateQueries({ queryKey: OPS_OVERVIEW_KEY })}
      >
        {tr('ws.kit.actions.refresh')}
      </Button>
    </>
  );
  return { subtitle, actions };
}

export function OperationsOverviewScreen() {
  const { staff } = useAuth();
  const navigate = useNavigate();
  // The owner reads what needs them on the Overview (/panel, page map
  // 2026-10-17), so /ops is not a second copy of it: Today is the manager's
  // home in Management, and an owner who lands here goes on to the Overview.
  const toOverview = canAccess(staff, '/panel');
  useEffect(() => {
    if (toOverview) void navigate({ to: '/panel', replace: true });
  }, [toOverview, navigate]);
  return toOverview ? null : <TodayScreen />;
}

function TodayScreen() {
  const { tr } = useLocale();
  const heading = useFloorNowHeading();
  return (
    <div>
      <PageHeader title={tr('ws.manager.ops.title')} subtitle={heading.subtitle} actions={heading.actions} />
      <FloorNow />
    </div>
  );
}

/** Live reads of the floor: the overview, refreshed when the floor, the courts or the kitchen move. */
function useLiveOpsOverview() {
  const overviewQ = useOpsOverview();
  // Cache-bust hints; the poll above is the safety net while disconnected.
  useBroadcast({ topic: 'floor', isPrivate: true, invalidateKeys: [OPS_OVERVIEW_KEY] });
  useBroadcast({ topic: 'courts', isPrivate: true, invalidateKeys: [OPS_OVERVIEW_KEY] });
  useBroadcast({ topic: 'kds', isPrivate: true, invalidateKeys: [OPS_OVERVIEW_KEY] });
  return overviewQ;
}

/** The manager's floor right now: the body of Today. */
export function FloorNow() {
  const navigate = useNavigate();
  const queued = useQueuedCount();
  const overviewQ = useLiveOpsOverview();
  const go: Go = (href) => void navigate({ href });
  const status = asyncStatus(overviewQ, () => false);

  return (
    <AsyncStateWrapper status={status} error={overviewQ.error} onRetry={() => void overviewQ.refetch()}>
      {overviewQ.data && <Day data={overviewQ.data} queued={queued} go={go} />}
    </AsyncStateWrapper>
  );
}

/**
 * "Needs you" on its own, for the owner's Overview (page map, 2026-10-17):
 * the floor's alarms and the people records, with `extras`, what only the
 * owner answers. It used to be the top of the owner's Floor now page.
 */
export function NeedsYouNow({ extras }: { extras?: FloorNowExtras }) {
  const navigate = useNavigate();
  const overviewQ = useLiveOpsOverview();
  const go: Go = (href) => void navigate({ href });
  const status = asyncStatus(overviewQ, () => false);

  return (
    <AsyncStateWrapper status={status} error={overviewQ.error} onRetry={() => void overviewQ.refetch()}>
      {overviewQ.data && <NeedsYou data={overviewQ.data} go={go} extras={extras} />}
    </AsyncStateWrapper>
  );
}

function Day({ data, queued, go }: { data: OpsOverview; queued: number; go: Go }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      {!data.dayClose.open && <DayClosedBanner go={go} />}
      {/* Two columns that stack once "now" would be narrower than 58% of the
          page (about a 1220px screen): a flex sidebar, no media query. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 'var(--tp-sp-4)' }}>
        <div style={{ flex: '999 1 0', minInlineSize: '58%', display: 'grid', gap: 'var(--tp-sp-4)' }}>
          <NeedsYou data={data} go={go} />
          <FloorPanel data={data} go={go} />
          <WhoWorked rows={data.staffActivity} />
        </div>
        <div style={{ flex: '1 1 22rem', minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-4)' }}>
          {data.dayClose.open && <BeforeYouClose data={data} queued={queued} go={go} />}
          <StockToWatch data={data} go={go} />
          <SoFarToday data={data} go={go} />
        </div>
      </div>
    </div>
  );
}
