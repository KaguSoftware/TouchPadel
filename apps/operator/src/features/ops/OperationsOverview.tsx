/**
 * Operations overview (spec 06.21) — the manager's landing screen.
 *
 * One read: `app.ops_overview()` (0068), polled every 30 s and invalidated on
 * the 'floor' / 'courts' / 'kds' broadcasts. Every figure on this screen is a
 * server figure; the screen only lays them out and routes onward (bookings →
 * /desk, tills → /till/tabs, stock → /stock, day close, reports, audit log).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDate, formatDateTime, formatNumber, formatTime } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useBroadcast } from '../../lib/realtime';
import { Button } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  DescriptionList,
  EmptyState,
  HeadlineFigure,
  Money,
  PageHeader,
  Panel,
  StatusBadge,
  asyncStatus,
  type Column,
} from '../../components/kit';
import { Icon } from '../../components/icons';
import {
  auditDrillHref,
  normalizeOverview,
  tillTabHref,
  type ExceptionKey,
  type OpsOverview,
  type OpsStaffRow,
} from './opsLogic';

export const OPS_OVERVIEW_KEY = ['opsOverview'] as const;
export const OPS_REFETCH_MS = 30_000;

export function OperationsOverviewScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const overviewQ = useQuery({
    queryKey: OPS_OVERVIEW_KEY,
    queryFn: async () => normalizeOverview(await appRpc<unknown>('ops_overview')),
    refetchInterval: OPS_REFETCH_MS,
  });

  // Cache-bust hints; the poll above is the safety net while disconnected.
  useBroadcast({ topic: 'floor', isPrivate: true, invalidateKeys: [OPS_OVERVIEW_KEY] });
  useBroadcast({ topic: 'courts', isPrivate: true, invalidateKeys: [OPS_OVERVIEW_KEY] });
  useBroadcast({ topic: 'kds', isPrivate: true, invalidateKeys: [OPS_OVERVIEW_KEY] });

  const go = (href: string) => void navigate({ href });
  const status = asyncStatus(overviewQ, () => false);
  const updatedAt = overviewQ.dataUpdatedAt ? new Date(overviewQ.dataUpdatedAt) : null;

  return (
    <div>
      <PageHeader
        title={tr('ws.manager.ops.title')}
        subtitle={tr('ws.manager.ops.lead')}
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
        {overviewQ.data && <Dashboard data={overviewQ.data} go={go} />}
      </AsyncStateWrapper>
    </div>
  );
}

function Dashboard({ data, go }: { data: OpsOverview; go: (href: string) => void }) {
  const { tr, locale } = useLocale();
  const { bookings, cafe, stock, dayClose } = data;

  return (
    <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', alignItems: 'start' }}>
      {/* Bookings */}
      <Panel
        title={tr('ws.manager.ops.bookings.title')}
        actions={
          <Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => go('/desk')}>
            {tr('ws.manager.ops.bookings.open')}
          </Button>
        }
      >
        <DescriptionList
          columns={2}
          items={[
            { label: tr('ws.manager.ops.bookings.today'), value: formatNumber(bookings.today, locale), numeric: true },
            { label: tr('ws.manager.ops.bookings.arrived'), value: formatNumber(bookings.arrived, locale), numeric: true },
            { label: tr('ws.manager.ops.bookings.upcoming'), value: formatNumber(bookings.upcoming, locale), numeric: true },
            {
              label: tr('ws.manager.ops.bookings.noShows'),
              value: (
                <span style={{ color: bookings.noShows > 0 ? 'var(--tp-danger-fg)' : undefined }}>
                  {formatNumber(bookings.noShows, locale)}
                </span>
              ),
              numeric: true,
            },
          ]}
        />
        <p style={{ marginBlockStart: '0.75rem', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          <strong style={{ color: 'var(--tp-fg)' }}>{tr('ws.manager.ops.bookings.next')}:</strong>{' '}
          {bookings.nextArrivalAt ? (
            <bdi>
              {formatTime(new Date(bookings.nextArrivalAt), locale)}
              {bookings.nextArrivalLabel ? ` · ${bookings.nextArrivalLabel}` : ''}
            </bdi>
          ) : (
            tr('ws.manager.ops.bookings.nextNone')
          )}
        </p>
      </Panel>

      {/* Cafe floor */}
      <Panel
        title={tr('ws.manager.ops.cafe.title')}
        actions={
          <Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => go('/till/tabs')}>
            {tr('ws.manager.ops.cafe.open')}
          </Button>
        }
      >
        <DescriptionList
          columns={2}
          items={[
            { label: tr('ws.manager.ops.cafe.openTabs'), value: formatNumber(cafe.openTabs, locale), numeric: true },
            { label: tr('ws.manager.ops.cafe.queued'), value: formatNumber(cafe.ticketsQueued, locale), numeric: true },
            {
              label: tr('ws.manager.ops.cafe.preparing'),
              value: cafe.ticketsPreparing === null ? '—' : formatNumber(cafe.ticketsPreparing, locale),
              numeric: true,
            },
            {
              label: tr('ws.manager.ops.cafe.late'),
              value: (
                <span style={{ color: cafe.ticketsLate > 0 ? 'var(--tp-danger-fg)' : undefined, fontWeight: cafe.ticketsLate > 0 ? 700 : undefined }}>
                  {formatNumber(cafe.ticketsLate, locale)}
                </span>
              ),
              numeric: true,
            },
            {
              label: tr('ws.manager.ops.cafe.waiterCalls'),
              value: (
                <span style={{ color: cafe.waiterCallsOpen > 0 ? 'var(--tp-warn-fg)' : undefined }}>
                  {formatNumber(cafe.waiterCallsOpen, locale)}
                </span>
              ),
              numeric: true,
            },
          ]}
        />
      </Panel>

      {/* Stock */}
      <Panel
        title={tr('ws.manager.ops.stock.title')}
        actions={
          <Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => go('/stock')}>
            {tr('ws.manager.ops.stock.open')}
          </Button>
        }
      >
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBlockEnd: '0.75rem' }}>
          <StatusBadge tone={stock.low > 0 ? 'danger' : 'neutral'} label={`${tr('ws.manager.ops.stock.low')} · ${formatNumber(stock.low, locale)}`} />
          <StatusBadge tone={stock.belowPar > 0 ? 'warn' : 'neutral'} label={`${tr('ws.manager.ops.stock.belowPar')} · ${formatNumber(stock.belowPar, locale)}`} />
          <StatusBadge tone={stock.expiringSoon > 0 ? 'warn' : 'neutral'} label={`${tr('ws.manager.ops.stock.expiringSoon')} · ${formatNumber(stock.expiringSoon, locale)}`} />
          <StatusBadge tone={stock.expired > 0 ? 'danger' : 'neutral'} label={`${tr('ws.manager.ops.stock.expired')} · ${formatNumber(stock.expired, locale)}`} />
        </div>
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          <strong style={{ color: 'var(--tp-fg)' }}>{tr('ws.manager.ops.stock.lastCount')}:</strong>{' '}
          {stock.lastCountAt ? <bdi>{formatDateTime(new Date(stock.lastCountAt), locale)}</bdi> : tr('ws.manager.ops.stock.neverCounted')}
        </p>
      </Panel>

      {/* Day close */}
      <Panel
        title={tr('ws.manager.ops.dayClose.title')}
        actions={
          <Button size="sm" kind="primary" iconEnd="arrowUpRight" onClick={() => go('/admin/day-close')}>
            {tr('ws.manager.ops.dayClose.go')}
          </Button>
        }
      >
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBlockEnd: '0.6rem' }}>
          <StatusBadge tone={dayClose.open ? 'success' : 'neutral'} label={dayClose.open ? tr('ws.manager.ops.dayClose.open') : tr('ws.manager.ops.dayClose.closed')} />
          {dayClose.open && dayClose.openedAt && (
            <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
              <bdi>{tr('ws.manager.ops.dayClose.openSince', { time: formatTime(new Date(dayClose.openedAt), locale) })}</bdi>
            </span>
          )}
          {dayClose.businessDate && (
            <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
              <bdi>{tr('ws.manager.ops.dayClose.businessDate', { date: formatDate(new Date(`${dayClose.businessDate}T00:00:00`), locale) })}</bdi>
            </span>
          )}
        </div>
        <DescriptionList
          columns={2}
          items={[
            {
              label: tr('ws.manager.ops.dayClose.blockingTabs'),
              value: dayClose.blockingCount === 0 ? (
                <span style={{ color: 'var(--tp-success-fg)' }}>{tr('ws.manager.ops.dayClose.blockingNone')}</span>
              ) : (
                <span style={{ color: 'var(--tp-danger-fg)', fontWeight: 700 }}>{formatNumber(dayClose.blockingCount, locale)}</span>
              ),
            },
            {
              label: tr('ws.manager.ops.dayClose.queued'),
              value: dayClose.queued === 0 ? (
                <span style={{ color: 'var(--tp-success-fg)' }}>{tr('ws.manager.ops.dayClose.queuedNone')}</span>
              ) : (
                <span style={{ color: 'var(--tp-warn-fg)', fontWeight: 700 }}>{formatNumber(dayClose.queued, locale)}</span>
              ),
            },
          ]}
        />
        {dayClose.blockingTabs.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, marginBlockStart: '0.6rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {dayClose.blockingTabs.map((t) => (
              <li key={t.id}>
                <Button size="sm" kind="soft" icon="receipt" onClick={() => go(tillTabHref(t.id))}>
                  {tr('ws.manager.ops.dayClose.tab', { label: t.label ?? t.id.slice(0, 8) })}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Staff activity */}
      <Panel title={tr('ws.manager.ops.staff.title')} padded={false} style={{ gridColumn: '1 / -1' }}>
        <p style={{ paddingBlock: '0.5rem', paddingInline: '0.85rem', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.manager.ops.staff.lead')}
        </p>
        <StaffTable rows={data.staffActivity} />
      </Panel>

      {/* Exceptions */}
      <Panel title={tr('ws.manager.ops.exceptions.title')} style={{ gridColumn: '1 / -1' }}>
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: '0.75rem' }}>
          {tr('ws.manager.ops.exceptions.lead')}
        </p>
        <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))' }}>
          {(['discounts', 'voids', 'refunds', 'waste'] as const).map((key) => (
            <ExceptionFigure key={key} figureKey={key} data={data} go={go} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginBlockStart: '0.9rem', flexWrap: 'wrap' }}>
          <Button size="sm" icon="chart" onClick={() => go('/reports/courts')}>
            {tr('ws.manager.ops.reports')}
          </Button>
          <Button size="sm" icon="fileText" onClick={() => go('/admin/audit')}>
            {tr('ws.manager.ops.audit')}
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function ExceptionFigure({ figureKey, data, go }: { figureKey: ExceptionKey; data: OpsOverview; go: (href: string) => void }) {
  const { tr, locale } = useLocale();
  const figure = data.exceptions[figureKey];
  if (!figure) return null;
  return (
    <HeadlineFigure
      label={tr(`ws.manager.ops.exceptions.${figureKey}`)}
      value={figure.amountIqd === null ? formatNumber(figure.count, locale) : <Money amount={figure.amountIqd} />}
      hint={tr('ws.manager.ops.exceptions.count', { count: formatNumber(figure.count, locale) })}
      tone={figure.count > 0 && (figureKey === 'voids' || figureKey === 'refunds') ? 'warn' : 'neutral'}
      drillable
      onDrill={() => go(auditDrillHref(figureKey))}
    />
  );
}

function StaffTable({ rows }: { rows: OpsStaffRow[] }) {
  const { tr, locale } = useLocale();
  if (rows.length === 0) {
    return (
      <div style={{ paddingBlock: '0.5rem', paddingInline: '0.85rem', paddingBlockEnd: '0.85rem' }}>
        <EmptyState compact icon="users" title={tr('ws.manager.ops.staff.empty')} />
      </div>
    );
  }
  const columns: Column<OpsStaffRow>[] = [
    { key: 'name', header: tr('ws.manager.ops.staff.name'), render: (r) => <bdi>{r.name}</bdi> },
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

const ROLE_KEYS = ['cashier', 'prep', 'court_desk', 'manager', 'owner'] as const;
function RoleLabel({ role }: { role: string }) {
  const { tr } = useLocale();
  const known = (ROLE_KEYS as readonly string[]).includes(role);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
      <Icon name="user" size={13} />
      {known ? tr(`op.roles.${role as (typeof ROLE_KEYS)[number]}`) : role}
    </span>
  );
}
