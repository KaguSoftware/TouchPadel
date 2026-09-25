/**
 * Today (spec 06.21) — the manager's landing screen, and the owner's "Floor
 * now" under Observe.
 *
 * One read: `app.ops_overview()` (0068), polled every 30 s and invalidated on
 * the 'floor' / 'courts' / 'kds' broadcasts. Every figure is a server figure,
 * except the count of writes this station has not synced yet, which only this
 * machine knows (see opsLogic.ts).
 *
 * WHY THIS LAYOUT
 *
 * The screen answers three questions, top to bottom, in the order a manager
 * asks them walking in:
 *
 *  1. **Does anything need me right now?** One list. Each row says how many,
 *     what, what to do about it in a plain sentence, and has one button that
 *     goes to the screen that fixes it. On a good day it is one green line.
 *     The previous version made these chips with a count and two words
 *     ("390 Tickets late"), and three of the five opened a screen that did not
 *     show the thing the chip named.
 *  2. **How is the day going?** One card each for courts, the cafe and stock,
 *     every figure a row with its number at the end. A row that opens
 *     something has a chevron and opens exactly those items. Each figure
 *     appears once per card — the old stock card printed "Low stock 3" as its
 *     headline and again directly beneath.
 *  3. **Can the day close, and what happened today?** Day close as the three
 *     steps it actually takes, beside today's discounts, voids, refunds and
 *     waste. Then staff activity.
 *
 * A figure can appear in tier 1 and again in its card. That is intentional:
 * tier 1 is the to-do list and the card is the context; they answer different
 * questions and the manager should not have to scroll to the card to act.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDate, formatDateTime, formatNumber, formatTime, type MessageKey } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useBroadcast } from '../../lib/realtime';
import { STAFF_ROLES, type StaffRole } from '../../lib/roleResolution';
import { touch } from '../../ipc/bridge';
import { Button } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  Panel,
  StatusBadge,
  asyncStatus,
  type Column,
} from '../../components/kit';
import { Icon, type IconName } from '../../components/icons';
import { CardTitle, FigureRow, MARK, MARK_FG, MARK_SOFT, RowGroupLabel, RowList, Step } from './OpsVisuals';
import { QK } from '../../lib/queryKeys';
import { fetchProtocolsWaiting, protocolsWaitingTotal } from './protocolsWaiting';
import { fetchPurchasesToReceive } from '../stock/DriverPurchases';
import { readPurchases } from '../stock/driverPurchasesLogic';
import {
  DAY_CLOSE_TONE,
  STOCK_HREF,
  alertsFor,
  auditDrillHref,
  workAlertsFor,
  dayCloseState,
  normalizeOverview,
  tillTabHref,
  type ExceptionKey,
  type OpsAlert,
  type OpsAlertKey,
  type OpsBlockingTab,
  type OpsOverview,
  type OpsStaffRow,
} from './opsLogic';

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

export function OperationsOverviewScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const queued = useQueuedCount();

  const overviewQ = useQuery({
    queryKey: OPS_OVERVIEW_KEY,
    queryFn: async () => normalizeOverview(await appRpc<unknown>('ops_overview')),
    refetchInterval: OPS_REFETCH_MS,
  });

  // Cache-bust hints; the poll above is the safety net while disconnected.
  useBroadcast({ topic: 'floor', isPrivate: true, invalidateKeys: [OPS_OVERVIEW_KEY] });
  useBroadcast({ topic: 'courts', isPrivate: true, invalidateKeys: [OPS_OVERVIEW_KEY] });
  useBroadcast({ topic: 'kds', isPrivate: true, invalidateKeys: [OPS_OVERVIEW_KEY] });

  const go: Go = (href) => void navigate({ href });
  const status = asyncStatus(overviewQ, () => false);
  const updatedAt = overviewQ.dataUpdatedAt ? new Date(overviewQ.dataUpdatedAt) : null;
  const day = overviewQ.data?.dayClose;

  // The page's subtitle is the business day itself — which day this is and
  // since when — rather than a description of the screen.
  const subtitle = !day
    ? undefined
    : day.open && day.businessDate && day.openedAt
      ? tr('ws.manager.ops.leadOpen', {
          date: formatDate(new Date(`${day.businessDate}T00:00:00`), locale),
          time: formatTime(new Date(day.openedAt), locale),
        })
      : day.open
        ? undefined
        : tr('ws.manager.ops.leadClosed');

  return (
    <div>
      <PageHeader
        title={tr('ws.manager.ops.title')}
        subtitle={subtitle}
        actions={
          <>
            {updatedAt && (
              <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                {tr('ws.manager.ops.updated', { time: formatTime(updatedAt, locale) })}
              </span>
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
        }
      />
      <AsyncStateWrapper status={status} error={overviewQ.error} onRetry={() => void overviewQ.refetch()}>
        {overviewQ.data && <Dashboard data={overviewQ.data} queued={queued} go={go} />}
      </AsyncStateWrapper>
    </div>
  );
}

function Dashboard({ data, queued, go }: { data: OpsOverview; queued: number; go: Go }) {
  const { tr } = useLocale();
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      <NeedsYouNow data={data} go={go} />

      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', alignItems: 'stretch' }}>
        <CourtsCard data={data} go={go} />
        <CafeCard data={data} go={go} />
        <StockCard data={data} go={go} />
      </div>

      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(22rem, 1fr))', alignItems: 'start' }}>
        <ClosingCard data={data} queued={queued} go={go} />
        <ExceptionsCard data={data} go={go} />
      </div>

      <Panel title={<CardTitle icon="users">{tr('ws.manager.ops.staff.title')}</CardTitle>}>
        <p style={{ marginBlockEnd: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.manager.ops.staff.lead')}
        </p>
        <StaffTable rows={data.staffActivity} />
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1 — Needs you now
// ---------------------------------------------------------------------------

const ALERT_COPY: Record<OpsAlertKey, { title: MessageKey; hint: MessageKey; action: MessageKey | null; icon: IconName }> = {
  dayNotOpen: { title: 'ws.manager.ops.now.dayNotOpen', hint: 'ws.manager.ops.now.dayNotOpenHint', action: 'ws.manager.ops.now.dayNotOpenAction', icon: 'lock' },
  waiterCalls: { title: 'ws.manager.ops.now.waiterCalls', hint: 'ws.manager.ops.now.waiterCallsHint', action: 'ws.manager.ops.now.waiterCallsAction', icon: 'bell' },
  ticketsLate: { title: 'ws.manager.ops.now.ticketsLate', hint: 'ws.manager.ops.now.ticketsLateHint', action: null, icon: 'clock' },
  low: { title: 'ws.manager.ops.now.low', hint: 'ws.manager.ops.now.lowHint', action: 'ws.manager.ops.now.lowAction', icon: 'package' },
  expired: { title: 'ws.manager.ops.now.expired', hint: 'ws.manager.ops.now.expiredHint', action: 'ws.manager.ops.now.expiredAction', icon: 'package' },
  protocols: { title: 'ws.manager.ops.now.protocols', hint: 'ws.manager.ops.now.protocolsHint', action: 'ws.manager.ops.now.protocolsAction', icon: 'split' },
  purchases: { title: 'ws.manager.ops.now.purchases', hint: 'ws.manager.ops.now.purchasesHint', action: 'ws.manager.ops.now.purchasesAction', icon: 'package' },
};

function NeedsYouNow({ data, go }: { data: OpsOverview; go: Go }) {
  const { tr } = useLocale();
  // Their own reads, shared with the rail badge and Goods in (§5.4).
  const protocolsQ = useQuery({ queryKey: QK.protocolsWaiting, queryFn: fetchProtocolsWaiting, refetchInterval: 60_000 });
  const purchasesQ = useQuery({ queryKey: QK.purchasesToReceive, queryFn: fetchPurchasesToReceive, refetchInterval: 60_000 });
  const alerts = [
    ...alertsFor(data),
    ...workAlertsFor({ protocols: protocolsWaitingTotal(protocolsQ.data), purchases: readPurchases(purchasesQ.data).length }),
  ];

  return (
    <Panel title={<CardTitle icon={alerts.length === 0 ? 'checkCircle' : 'alert'}>{tr('ws.manager.ops.now.title')}</CardTitle>}>
      {alerts.length === 0 ? (
        <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', fontWeight: 600, color: MARK_FG.success }}>
          <Icon name="checkCircle" size={18} style={{ color: MARK.success, flex: '0 0 auto' }} />
          {tr('ws.manager.ops.now.clear')}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
          {alerts.map((a) => (
            <AlertRow key={a.key} alert={a} go={go} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AlertRow({ alert, go }: { alert: OpsAlert; go: Go }) {
  const { tr, locale } = useLocale();
  const copy = ALERT_COPY[alert.key];
  // "The day is not open" is a state, not a count of one.
  const showCount = alert.key !== 'dayNotOpen';
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--tp-sp-3)',
        flexWrap: 'wrap',
        paddingBlock: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-2)',
        borderRadius: 'var(--tp-radius-ctl)',
        background: 'var(--tp-surface-2)',
      }}
    >
      <span
        style={{
          display: 'grid',
          placeItems: 'center',
          minInlineSize: '3rem',
          blockSize: '2.5rem',
          paddingInline: 'var(--tp-sp-2)',
          borderRadius: 'var(--tp-radius-ctl)',
          background: MARK_SOFT[alert.severity],
          color: MARK_FG[alert.severity],
          fontSize: 'var(--tp-fs-lg)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {showCount ? formatNumber(alert.count, locale) : <Icon name={copy.icon} size={18} style={{ color: MARK[alert.severity] }} />}
      </span>
      <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 16rem', minInlineSize: 0 }}>
        <strong style={{ color: 'var(--tp-fg)' }}>{tr(copy.title)}</strong>
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr(copy.hint)}</span>
      </span>
      {copy.action && alert.href && (
        // One button style for every row: the count block already carries the
        // severity, and a blue button on some rows and not others read as a
        // ranking the table order does not make.
        <Button size="sm" iconEnd="arrowUpRight" onClick={() => go(alert.href!)}>
          {tr(copy.action)}
        </Button>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// 2 — How the day is going
// ---------------------------------------------------------------------------

/** A card: its rows, then one button to the screen that owns the area. */
function AreaCard({
  icon,
  title,
  openLabel,
  onOpen,
  chevrons,
  children,
}: {
  icon: IconName;
  title: string;
  openLabel: string;
  onOpen: () => void;
  chevrons: boolean;
  children: ReactNode;
}) {
  // `fill` + an auto margin keep the three cards' buttons on one line even
  // though the cafe card has more rows than the other two.
  return (
    <Panel fill title={<CardTitle icon={icon}>{title}</CardTitle>}>
      <RowList chevrons={chevrons}>{children}</RowList>
      <div style={{ marginBlockStart: 'auto', paddingBlockStart: 'var(--tp-sp-3)' }}>
        <Button size="sm" iconEnd="arrowUpRight" onClick={onOpen}>
          {openLabel}
        </Button>
      </div>
    </Panel>
  );
}

function CourtsCard({ data, go }: { data: OpsOverview; go: Go }) {
  const { tr, locale } = useLocale();
  const b = data.bookings;
  const court = locale === 'ar' ? (b.nextArrivalCourtAr ?? b.nextArrivalCourtEn) : (b.nextArrivalCourtEn ?? b.nextArrivalCourtAr);
  const next = b.nextArrivalAt
    ? [formatTime(new Date(b.nextArrivalAt), locale), court, b.nextArrivalLabel].filter(Boolean).join(' · ')
    : null;
  return (
    <AreaCard icon="court" title={tr('ws.manager.ops.courts.title')} openLabel={tr('ws.manager.ops.courts.open')} onOpen={() => go('/desk')} chevrons={false}>
      <FigureRow label={tr('ws.manager.ops.courts.booked')} value={b.today} />
      <FigureRow label={tr('ws.manager.ops.courts.arrived')} value={b.arrived} />
      <FigureRow label={tr('ws.manager.ops.courts.upcoming')} value={b.upcoming} />
      <FigureRow label={tr('ws.manager.ops.courts.noShows')} value={b.noShows} tone="danger" />
      <FigureRow label={tr('ws.manager.ops.courts.cancelled')} value={b.cancelledToday} tone="warn" />
      <FigureRow
        label={tr('ws.manager.ops.courts.next')}
        value={
          next ? (
            <bdi>{next}</bdi>
          ) : (
            <span style={{ fontWeight: 400, color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.ops.courts.nextNone')}</span>
          )
        }
      />
    </AreaCard>
  );
}

function CafeCard({ data, go }: { data: OpsOverview; go: Go }) {
  const { tr } = useLocale();
  const c = data.cafe;
  return (
    <AreaCard icon="flame" title={tr('ws.manager.ops.cafe.title')} openLabel={tr('ws.manager.ops.cafe.open')} onOpen={() => go('/till/tabs')} chevrons>
      <FigureRow label={tr('ws.manager.ops.cafe.openTabs')} value={c.openTabs} />
      <FigureRow label={tr('ws.manager.ops.cafe.ordersToday')} value={c.ordersToday} />
      <FigureRow label={tr('ws.manager.ops.cafe.waiterCalls')} value={c.waiterCallsOpen} tone="warn" onOpen={() => go('/till/tabs')} />
      {/* These three overlap — a late ticket is also a waiting or preparing
          one — so they are listed, never added up. */}
      <RowGroupLabel>{tr('ws.manager.ops.cafe.kitchen')}</RowGroupLabel>
      <FigureRow label={tr('ws.manager.ops.cafe.queued')} value={c.ticketsQueued} />
      <FigureRow label={tr('ws.manager.ops.cafe.preparing')} value={c.ticketsPreparing} />
      <FigureRow label={tr('ws.manager.ops.cafe.late')} value={c.ticketsLate} tone="danger" />
    </AreaCard>
  );
}

function StockCard({ data, go }: { data: OpsOverview; go: Go }) {
  const { tr, locale } = useLocale();
  const s = data.stock;
  return (
    <AreaCard icon="package" title={tr('ws.manager.ops.stock.title')} openLabel={tr('ws.manager.ops.stock.open')} onOpen={() => go('/stock')} chevrons>
      <FigureRow label={tr('ws.manager.ops.stock.low')} value={s.low} tone="danger" onOpen={() => go(STOCK_HREF.low)} />
      <FigureRow label={tr('ws.manager.ops.stock.belowPar')} value={s.belowPar} tone="warn" onOpen={() => go(STOCK_HREF.belowPar)} />
      <FigureRow label={tr('ws.manager.ops.stock.expiringSoon')} value={s.expiringSoon} tone="warn" onOpen={() => go(STOCK_HREF.expiringSoon)} />
      <FigureRow label={tr('ws.manager.ops.stock.expired')} value={s.expired} tone="danger" onOpen={() => go(STOCK_HREF.expired)} />
      {s.openAlerts !== null && (
        <FigureRow label={tr('ws.manager.ops.stock.alerts')} value={s.openAlerts} tone="warn" onOpen={() => go(STOCK_HREF.alerts)} />
      )}
      <FigureRow
        label={tr('ws.manager.ops.stock.lastCount')}
        value={s.lastCountAt ? <bdi>{formatDateTime(new Date(s.lastCountAt), locale)}</bdi> : tr('ws.manager.ops.stock.neverCounted')}
        onOpen={() => go(STOCK_HREF.lastCount)}
      />
    </AreaCard>
  );
}

// ---------------------------------------------------------------------------
// 3 — Closing the day, and what happened today
// ---------------------------------------------------------------------------

/**
 * How many open tabs get their own button before the rest fold into one. The
 * exact count is already in the step's status; the buttons are a shortcut.
 */
const BLOCKING_TABS_SHOWN = 4;

function tabName(t: OpsBlockingTab, tr: ReturnType<typeof useLocale>['tr']): string {
  if (t.tableNumber) return tr('ws.manager.ops.close.tab', { label: t.tableNumber });
  // Never an id: a booking made by a signed-in account carries no guest_name,
  // so this used to name the tab `3f2a1b9c` on the one screen that exists to
  // tell a manager WHICH tab is holding the day open.
  return t.guestName ?? t.label ?? tr('op.till.forReservation');
}

function ClosingCard({ data, queued, go }: { data: OpsOverview; queued: number; go: Go }) {
  const { tr, locale } = useLocale();
  const d = data.dayClose;
  const state = dayCloseState(d, queued);

  return (
    <Panel
      title={<CardTitle icon="sun">{tr('ws.manager.ops.close.title')}</CardTitle>}
      actions={<StatusBadge tone={DAY_CLOSE_TONE[state]} label={tr(`ws.manager.dayClose.state.${state}`)} />}
    >
      {!d.open ? (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', justifyItems: 'start' }}>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.ops.close.closedLead')}</p>
          <Button kind="primary" size="sm" iconEnd="arrowUpRight" onClick={() => go('/admin/day-close')}>
            {tr('ws.manager.ops.close.openDay')}
          </Button>
        </div>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <Step
            index={1}
            title={tr('ws.manager.ops.close.stepTabs')}
            done={d.blockingCount === 0}
            tone="danger"
            status={
              d.blockingCount === 0
                ? tr('ws.manager.ops.close.tabsDone')
                : tr('ws.manager.ops.close.tabsLeft', { count: formatNumber(d.blockingCount, locale) })
            }
          >
            {d.blockingTabs.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
                {d.blockingTabs.slice(0, BLOCKING_TABS_SHOWN).map((t) => (
                  <li key={t.id} style={{ minInlineSize: 0, maxInlineSize: '100%' }}>
                    <Button size="sm" kind="soft" icon="receipt" onClick={() => go(tillTabHref(t.id))} style={{ maxInlineSize: '100%' }}>
                      <bdi style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tabName(t, tr)}</bdi>
                    </Button>
                  </li>
                ))}
                {d.blockingTabs.length > BLOCKING_TABS_SHOWN && (
                  <li>
                    <Button size="sm" kind="ghost" onClick={() => go('/till/tabs')}>
                      {tr('ws.manager.ops.close.moreTabs', { count: formatNumber(d.blockingTabs.length - BLOCKING_TABS_SHOWN, locale) })}
                    </Button>
                  </li>
                )}
              </ul>
            )}
          </Step>
          <Step
            index={2}
            title={tr('ws.manager.ops.close.stepSync')}
            done={queued === 0}
            tone="warn"
            status={queued === 0 ? tr('ws.manager.ops.close.syncDone') : tr('ws.manager.ops.close.syncLeft', { count: formatNumber(queued, locale) })}
          />
          <Step index={3} title={tr('ws.manager.ops.close.stepCount')} done={false} tone={state === 'ready' ? 'success' : 'neutral'}>
            <Button kind={state === 'ready' ? 'primary' : 'default'} size="sm" iconEnd="arrowUpRight" onClick={() => go('/admin/day-close')}>
              {tr('ws.manager.ops.close.go')}
            </Button>
          </Step>
        </ol>
      )}
    </Panel>
  );
}

const EXCEPTION_KEYS = ['discounts', 'voids', 'refunds', 'waste'] as const satisfies readonly ExceptionKey[];

function ExceptionsCard({ data, go }: { data: OpsOverview; go: Go }) {
  const { tr, locale } = useLocale();
  // `waste` can be absent from the payload; an absent figure is no row rather
  // than a zero the server never sent.
  const present = EXCEPTION_KEYS.filter((k) => data.exceptions[k] !== null);
  return (
    <Panel title={<CardTitle icon="fileText">{tr('ws.manager.ops.exceptions.title')}</CardTitle>}>
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2)' }}>
        {tr('ws.manager.ops.exceptions.lead')}
      </p>
      <RowList chevrons>
        {present.map((k) => {
          const f = data.exceptions[k]!;
          return (
            <FigureRow
              key={k}
              label={tr(`ws.manager.ops.exceptions.${k}`)}
              hint={tr('ws.manager.ops.exceptions.count', { count: formatNumber(f.count, locale) })}
              value={f.amountIqd === null ? f.count : <Money amount={f.amountIqd} />}
              onOpen={() => go(auditDrillHref(k))}
            />
          );
        })}
      </RowList>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', marginBlockStart: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
        <Button size="sm" icon="chart" onClick={() => go('/reports/courts')}>
          {tr('ws.manager.ops.reports')}
        </Button>
        <Button size="sm" icon="fileText" onClick={() => go('/admin/audit')}>
          {tr('ws.manager.ops.audit')}
        </Button>
      </div>
    </Panel>
  );
}

/**
 * Deliberately a plain table with no bars: a proportional bar beside each
 * person's order count is exactly how a record of the shift becomes a
 * leaderboard.
 */
function StaffTable({ rows }: { rows: OpsStaffRow[] }) {
  const { tr, locale } = useLocale();
  // Nobody has recorded anything yet is not a fault and not a filter.
  if (rows.length === 0) {
    return <EmptyState compact kind="nothingToDo" icon="users" title={tr('ws.manager.ops.staff.empty')} />;
  }
  const columns: Column<OpsStaffRow>[] = [
    { key: 'name', header: tr('ws.manager.ops.staff.name'), truncate: true, truncateTitle: (r) => r.name, render: (r) => <bdi>{r.name}</bdi> },
    {
      key: 'role',
      header: tr('ws.manager.ops.staff.role'),
      render: (r) => (r.role ? <RoleLabel role={r.role} /> : '—'),
    },
    { key: 'orders', header: tr('ws.manager.ops.staff.orders'), numeric: true, render: (r) => formatNumber(r.ordersTaken, locale) },
    { key: 'bookings', header: tr('ws.manager.ops.staff.bookings'), numeric: true, render: (r) => formatNumber(r.bookingsCreated, locale) },
    {
      key: 'payments',
      header: tr('ws.manager.ops.staff.payments'),
      numeric: true,
      render: (r) => (r.paymentsTaken === null ? '—' : formatNumber(r.paymentsTaken, locale)),
    },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(r, i) => r.staffId || String(i)} dense aria-label={tr('ws.manager.ops.staff.title')} />;
}

function RoleLabel({ role }: { role: string }) {
  const { tr } = useLocale();
  const known = (STAFF_ROLES as readonly string[]).includes(role);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
      <Icon name="user" size={13} />
      {known ? tr(`op.roles.${role as StaffRole}`) : role}
    </span>
  );
}
