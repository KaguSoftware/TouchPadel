/**
 * RevenueReportScreen (spec 06.40). Owner-only: the route guards it and the
 * screen states the refusal for anyone else.
 *
 * The question: **how much did we earn, how did it come in, and what went
 * back out?** The period's answer leads, in the management panel's three
 * labelled groups — Earned, Money taken, Given away — plus tax, because
 * revenue and cash + card count on different days and never add up to each
 * other. Each figure opens its transactions.
 *
 * Below, one breakdown at a time, by day, week or month. `report_revenue`
 * returns ONE row shape for every breakdown, so "Earned", "Money taken",
 * "Given away" and "Tax" are column sets over the same rows. The old screen's
 * five views sent a `view` key the server ignores and all drew the same table;
 * and because none of its declared column names matched the camelCase payload
 * except `period` and `orders`, that table showed exactly those two columns.
 * "Tax by rate" is gone: no rate is recorded, only the tax amount.
 *
 * A row opens the transactions for that day, week or month — cut to the
 * period on screen — for the breakdown's figures. The staff filter scopes the
 * drill too; the payment filter cannot (report_drill has no method key), and
 * the dialog says so.
 */
import { useState } from 'react';
import { formatMonthYear, type MessageKey } from '@touch/i18n';
import { usePermissions, requiredRoleFor } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { PermissionRefusedNotice, type ComparisonMode } from '../../components/kit';
import {
  AsyncStateWrapper,
  asyncStatus,
  changeOf,
  ColumnNotes,
  CompareFilter,
  count,
  DrillDialog,
  EmptyPeriod,
  exportTable,
  Fig,
  FigureBand,
  FigureGroup,
  formatDay,
  HeadlineFigure,
  money,
  ReportFrame,
  ReportSkeleton,
  ReportTable,
  ScopeNote,
  tableCsv,
  TableHint,
  useComparedReport,
  useReportPeriod,
  ViewSwitch,
  type DrillRequest,
  type ReportColumn,
} from './ReportParts';
import { GroupFilter, PaymentFilter, StaffFilter, useReportStaff } from './ReportFilterBar';
import { bucketRange, readRevenue, type RevenueRow } from './reportPayloads';
import type { PaymentMethodFilter, ReportGroup } from './reportTypes';

type View = 'earned' | 'taken' | 'givenAway' | 'tax';
const VIEWS: readonly View[] = ['earned', 'taken', 'givenAway', 'tax'];

/** Which drill figures each breakdown opens, first one first. Tax has none to open. */
const VIEW_FIGURES: Record<View, readonly { key: string; label: MessageKey }[]> = {
  earned: [
    { key: 'revenue', label: 'ws.reports.revenue.revenue' },
    { key: 'padelRevenue', label: 'ws.reports.revenue.padel' },
    { key: 'cafeNet', label: 'ws.reports.revenue.cafe' },
  ],
  taken: [
    { key: 'cash', label: 'ws.reports.revenue.cash' },
    { key: 'card', label: 'ws.reports.revenue.card' },
  ],
  givenAway: [
    { key: 'discounts', label: 'ws.reports.revenue.discounts' },
    { key: 'voids', label: 'ws.reports.revenue.voids' },
    { key: 'refunds', label: 'ws.reports.revenue.refunds' },
  ],
  tax: [],
};

export function RevenueReportScreen() {
  const { tr } = useLocale();
  const can = usePermissions();
  if (!can.viewFinancials) {
    return <PermissionRefusedNotice action={tr('ws.reports.refusedRevenue')} requiredRole={requiredRoleFor('viewFinancials')} />;
  }
  return <RevenueReport />;
}

function RevenueReport() {
  const { tr, locale } = useLocale();
  const { period, setPeriod, today, ready } = useReportPeriod();
  const [group, setGroup] = useState<ReportGroup>('day');
  const [method, setMethod] = useState<PaymentMethodFilter | ''>('');
  const [staffId, setStaffId] = useState('');
  const [view, setView] = useState<View>('earned');
  const [drill, setDrill] = useState<DrillRequest | null>(null);
  const staffQ = useReportStaff();

  const args = {
    p_from: period.from,
    p_to: period.to,
    p_group: group,
    p_filters: { paymentMethod: method || null, staffId: staffId || null },
  };
  const [compare, setCompare] = useState<ComparisonMode>('none');
  const q = useComparedReport('revenue', 'report_revenue', args, compare, readRevenue, ready);
  const data = q.data?.current;
  const changes = q.data?.changes;
  const status = asyncStatus(q, (d) => d.current.rows.length === 0);
  const t = data?.totals ?? null;
  const staffScope = staffId ? `staff:${staffId}` : null;
  const staffName = staffQ.data?.find((s) => s.id === staffId)?.display_name ?? '';

  /** Open one or more figures over some dates, scoped to the chosen person. */
  function open(what: string, figures: readonly { key: string; label: MessageKey }[], from: string, to: string) {
    if (figures.length === 0) return;
    setDrill({
      what,
      figures: figures.map((f) => ({ key: f.key, label: tr(f.label) })),
      scope: staffScope,
      from,
      to,
      note: method ? tr('ws.reports.drill.notByMethod') : undefined,
    });
  }
  // `field` is the totals key the server compares; a rise in what was given away is bad news.
  const figure = (key: string, label: MessageKey, value: number | null, hint?: string, field?: string, invert?: boolean) => (
    <HeadlineFigure
      label={tr(label)}
      value={money(value, locale)}
      hint={hint}
      comparison={field ? changeOf(changes, field) : null}
      format={(n) => money(n, locale)}
      invert={invert}
      drillable={value !== null}
      onDrill={() => open(tr(label), [{ key, label }], period.from, period.to)}
    />
  );

  const periodLabel = (r: RevenueRow) =>
    group === 'month' ? formatMonthYear(new Date(`${r.period}T12:00:00Z`), locale, 'UTC') : formatDay(r.period, locale);
  const columns = columnsFor(view, group, periodLabel, tr, locale);

  const notes: Record<View, MessageKey[]> = {
    earned: ['ws.reports.revenue.notes.revenue', 'ws.reports.revenue.notes.bookings'],
    taken: [],
    givenAway: ['ws.reports.revenue.notes.voids'],
    tax: ['ws.reports.revenue.notes.cafeSales'],
  };

  function exportCsv() {
    if (!data) return;
    // Every figure the row carries, whichever breakdown is on screen: the
    // breakdown is a way of reading the rows, not a limit on what is taken away.
    const all = allColumns(group, periodLabel, tr, locale);
    exportTable(tr('ws.reports.export.revenue'), period, { group, pay: method || undefined, staff: staffId || undefined }, tableCsv(all, data.rows));
  }

  return (
    <ReportFrame
      name="revenue"
      period={period}
      onPeriod={setPeriod}
      today={today}
      busy={q.isFetching && !data}
      onExport={exportCsv}
      exportDisabled={status !== 'ready'}
      comparedWith={q.data?.period ?? null}
      filters={
        <>
          <PaymentFilter value={method} onChange={setMethod} />
          <StaffFilter value={staffId} onChange={setStaffId} />
          <CompareFilter value={compare} onChange={setCompare} />
        </>
      }
    >
      {staffId && <ScopeNote>{tr('ws.reports.revenue.scopeStaff', { name: staffName })}</ScopeNote>}
      {method && <ScopeNote>{tr('ws.reports.revenue.scopeMethod', { method: tr(method === 'cash' ? 'ws.reports.filters.cash' : 'ws.reports.filters.card') })}</ScopeNote>}
      <AsyncStateWrapper
        status={status}
        error={q.error}
        onRetry={() => void q.refetch()}
        skeleton={<ReportSkeleton columns={[tr('ws.reports.revenue.columns.day'), tr('ws.reports.revenue.columns.padel'), tr('ws.reports.revenue.columns.cafe'), tr('ws.reports.revenue.columns.revenue')]} />}
        emptyContent={<EmptyPeriod title={tr('ws.reports.revenue.emptyTitle')} body={tr('ws.reports.revenue.emptyBody')} period={period} today={today} onPick={setPeriod} />}
      >
        {data && (
          <>
            <FigureBand label={tr('ws.reports.nav.revenue')} min="26rem">
              <FigureGroup title={tr('ws.reports.revenue.earned')} hint={tr('ws.reports.revenue.earnedHint')}>
                {figure('revenue', 'ws.reports.revenue.revenue', t?.totalIqd ?? null, undefined, 'totalIqd')}
                {figure('padelRevenue', 'ws.reports.revenue.padel', t?.padelIqd ?? null, t?.bookings != null ? tr('ws.reports.revenue.bookingsCount', { count: count(t.bookings, locale) }) : undefined, 'padelIqd')}
                {figure('cafeNet', 'ws.reports.revenue.cafe', t?.cafeNetIqd ?? null, t?.orders != null ? tr('ws.reports.revenue.ordersCount', { count: count(t.orders, locale) }) : undefined, 'cafeNetIqd')}
              </FigureGroup>
              <FigureGroup title={tr('ws.reports.revenue.taken')} hint={tr('ws.reports.revenue.takenHint')}>
                {figure('cash', 'ws.reports.revenue.cash', t?.cashIqd ?? null, undefined, 'cashIqd')}
                {figure('card', 'ws.reports.revenue.card', t?.cardIqd ?? null, undefined, 'cardIqd')}
              </FigureGroup>
              <FigureGroup title={tr('ws.reports.revenue.givenAway')} hint={tr('ws.reports.revenue.givenAwayHint')}>
                {figure('discounts', 'ws.reports.revenue.discounts', t?.discountsIqd ?? null, undefined, 'discountsIqd', true)}
                {figure('voids', 'ws.reports.revenue.voids', t?.voidsIqd ?? null, undefined, 'voidsIqd', true)}
                {figure('refunds', 'ws.reports.revenue.refunds', t?.refundsIqd ?? null, undefined, 'refundsIqd', true)}
              </FigureGroup>
              <FigureGroup title={tr('ws.reports.revenue.tax')} hint={tr('ws.reports.revenue.taxHint')}>
                <HeadlineFigure label={tr('ws.reports.revenue.tax')} value={money(t?.taxIqd ?? null, locale)} comparison={changeOf(changes, 'taxIqd')} format={(n) => money(n, locale)} />
              </FigureGroup>
            </FigureBand>

            <ViewSwitch<View>
              value={view}
              onChange={setView}
              options={VIEWS.map((v) => ({ value: v, label: tr(`ws.reports.revenue.views.${v}`) }))}
              lead={tr(`ws.reports.revenue.lead.${view}`)}
              // Grouping changes the rows below, not the figures above, so it sits with them.
              end={<GroupFilter value={group} onChange={setGroup} />}
            />
            {VIEW_FIGURES[view].length > 0 && <TableHint icon="arrowUpRight">{tr('ws.reports.frame.drillHint')}</TableHint>}
            <ReportTable<RevenueRow>
              label={tr(`ws.reports.revenue.views.${view}`)}
              columns={columns}
              rows={data.rows}
              rowKey={(r) => r.period}
              onRowClick={
                VIEW_FIGURES[view].length > 0
                  ? (r) => {
                      const range = bucketRange(r.period, group, period);
                      // The title's dates already name the row, so the dialog is named by the breakdown.
                      open(tr(`ws.reports.revenue.views.${view}`), VIEW_FIGURES[view], range.from, range.to);
                    }
                  : undefined
              }
            />
            <ColumnNotes notes={notes[view].map((k) => tr(k))} />
          </>
        )}
      </AsyncStateWrapper>
      {drill && <DrillDialog request={drill} onClose={() => setDrill(null)} />}
    </ReportFrame>
  );
}

type Tr = ReturnType<typeof useLocale>['tr'];
type Locale = ReturnType<typeof useLocale>['locale'];

function moneyColumn(key: keyof RevenueRow, header: string, locale: Locale, strong?: boolean): ReportColumn<RevenueRow> {
  return {
    key,
    header,
    numeric: true,
    render: (r) => <Fig value={r[key] as number | null} text={money(r[key] as number | null, locale)} strong={strong} />,
    sort: (r) => r[key] as number | null,
    csv: (r) => r[key] as number | null,
  };
}
function countColumn(key: keyof RevenueRow, header: string, locale: Locale): ReportColumn<RevenueRow> {
  return {
    key,
    header,
    numeric: true,
    render: (r) => <Fig value={r[key] as number | null} text={count(r[key] as number | null, locale)} />,
    sort: (r) => r[key] as number | null,
    csv: (r) => r[key] as number | null,
  };
}
function periodColumn(group: ReportGroup, label: (r: RevenueRow) => string, tr: Tr): ReportColumn<RevenueRow> {
  return {
    key: 'period',
    header: tr(`ws.reports.revenue.columns.${group}`),
    render: (r) => <bdi>{label(r)}</bdi>,
    sort: (r) => r.period,
    csv: (r) => r.period,
  };
}

function columnsFor(view: View, group: ReportGroup, label: (r: RevenueRow) => string, tr: Tr, locale: Locale): ReportColumn<RevenueRow>[] {
  {
    const c = (k: MessageKey) => tr(k);
    const first = periodColumn(group, label, tr);
    switch (view) {
      case 'earned':
        return [
          first,
          moneyColumn('padelIqd', c('ws.reports.revenue.columns.padel'), locale),
          moneyColumn('cafeNetIqd', c('ws.reports.revenue.columns.cafe'), locale),
          moneyColumn('totalIqd', c('ws.reports.revenue.columns.revenue'), locale, true),
          countColumn('bookings', c('ws.reports.revenue.columns.bookings'), locale),
          countColumn('orders', c('ws.reports.revenue.columns.orders'), locale),
        ];
      case 'taken':
        return [first, moneyColumn('cashIqd', c('ws.reports.revenue.columns.cash'), locale), moneyColumn('cardIqd', c('ws.reports.revenue.columns.card'), locale)];
      case 'givenAway':
        return [
          first,
          moneyColumn('discountsIqd', c('ws.reports.revenue.columns.discounts'), locale),
          moneyColumn('voidsIqd', c('ws.reports.revenue.columns.voids'), locale),
          moneyColumn('refundsIqd', c('ws.reports.revenue.columns.refunds'), locale),
        ];
      case 'tax':
        return [first, moneyColumn('cafeIqd', c('ws.reports.revenue.columns.cafeSales'), locale), moneyColumn('taxIqd', c('ws.reports.revenue.columns.tax'), locale, true)];
    }
  }
}

/** Every revenue figure, for the CSV. */
function allColumns(group: ReportGroup, label: (r: RevenueRow) => string, tr: Tr, locale: Locale): ReportColumn<RevenueRow>[] {
  return [
    periodColumn(group, label, tr),
    moneyColumn('padelIqd', tr('ws.reports.revenue.columns.padel'), locale),
    moneyColumn('cafeNetIqd', tr('ws.reports.revenue.columns.cafe'), locale),
    moneyColumn('totalIqd', tr('ws.reports.revenue.columns.revenue'), locale),
    moneyColumn('cafeIqd', tr('ws.reports.revenue.columns.cafeSales'), locale),
    moneyColumn('cashIqd', tr('ws.reports.revenue.columns.cash'), locale),
    moneyColumn('cardIqd', tr('ws.reports.revenue.columns.card'), locale),
    moneyColumn('discountsIqd', tr('ws.reports.revenue.columns.discounts'), locale),
    moneyColumn('voidsIqd', tr('ws.reports.revenue.columns.voids'), locale),
    moneyColumn('refundsIqd', tr('ws.reports.revenue.columns.refunds'), locale),
    moneyColumn('taxIqd', tr('ws.reports.revenue.columns.tax'), locale),
    countColumn('bookings', tr('ws.reports.revenue.columns.bookings'), locale),
    countColumn('orders', tr('ws.reports.revenue.columns.orders'), locale),
  ];
}
