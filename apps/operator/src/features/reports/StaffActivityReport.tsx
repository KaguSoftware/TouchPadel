/**
 * StaffActivityReportScreen (spec 06.44) — activity and exceptions ONLY.
 *
 * The question: **what did each person record, and where was discretion
 * used?** Rows stay in name order and cannot be sorted by a figure: there is
 * no rank, score or leaderboard, and no summed band up top (a venue total of
 * orders beside each person's would read as a share). Every figure sits beside
 * the days that person was active.
 *
 * Before this, all four views drew the same five-column table (orders,
 * bookings, payments), because `report_staff_activity` nests everything else
 * — discounts, voids, refunds, waiter calls, day closes, days active — and the
 * generic table read only top-level keys. Roles printed as codes
 * (`court_desk`). Each breakdown now reads its own part of the row.
 *
 * A row opens everything attributed to the person (report_drill
 * `staff:<id>`); on the discounts breakdown it opens their discounts, voids
 * and refunds. The audit log for the person stays one click away on each row.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { MessageKey } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { appRpc } from '../../lib/appRpc';
import { STAFF_ROLES, type StaffRole } from '../../lib/roleResolution';
import { Button } from '../../components/ui';
import { MessagePresenter, StatusBadge } from '../../components/kit';
import {
  AsyncStateWrapper,
  ColumnNotes,
  DrillDialog,
  EmptyPeriod,
  EmptyState,
  Fig,
  ReportFrame,
  ReportSkeleton,
  ReportTable,
  TableHint,
  ViewSwitch,
  asyncStatus,
  count,
  duration,
  exportTable,
  formatDay,
  money,
  tableCsv,
  useReportPeriod,
  type DrillRequest,
  type ReportColumn,
  type Tr,
} from './ReportParts';
import { StaffFilter } from './ReportFilterBar';
import { dayClosesOf, readStaff, type CountAmount, type DayCloseRow, type StaffRow } from './reportPayloads';

type View = 'activity' | 'exceptions' | 'calls' | 'dayCloses';
const VIEWS: readonly View[] = ['activity', 'exceptions', 'calls', 'dayCloses'];
type Locale = ReturnType<typeof useLocale>['locale'];

export function StaffActivityReportScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const { period, setPeriod, today, ready } = useReportPeriod();
  const [staffId, setStaffId] = useState('');
  const [view, setView] = useState<View>('activity');
  const [drill, setDrill] = useState<DrillRequest | null>(null);

  const args = { p_from: period.from, p_to: period.to, p_staff_id: staffId || null };
  const q = useQuery({
    queryKey: ['reports', 'report_staff_activity', args],
    queryFn: async () => readStaff(await appRpc<unknown>('report_staff_activity', args)),
    enabled: ready,
    refetchInterval: 120_000,
  });
  const rows = q.data;
  const status = asyncStatus(q, (d) => d.length === 0);
  const closes = rows ? dayClosesOf(rows) : [];

  const openAudit = (actor: string) => void navigate({ to: '/admin/audit', search: { actor } as never });
  const cols = staffColumns(tr, locale, openAudit);

  function openPerson(r: StaffRow) {
    setDrill({
      what: r.name,
      figures:
        view === 'exceptions'
          ? [
              { key: 'discounts', label: tr('ws.reports.staff.columns.discounts') },
              { key: 'voids', label: tr('ws.reports.staff.columns.voids') },
              { key: 'refunds', label: tr('ws.reports.staff.columns.refunds') },
            ]
          : [{ key: null, label: '' }],
      scope: `staff:${r.staffId}`,
      from: period.from,
      to: period.to,
    });
  }

  const notes: Record<View, MessageKey[]> = {
    activity: ['ws.reports.staff.notes.daysActive', 'ws.reports.staff.notes.busiest'],
    exceptions: ['ws.reports.staff.notes.times'],
    calls: [],
    dayCloses: ['ws.reports.staff.notes.cashDifference'],
  };

  function exportCsv() {
    if (!rows) return;
    const base = tr('ws.reports.export.staff');
    const parts = { view, staff: staffId || undefined };
    if (view === 'dayCloses') return exportTable(base, period, parts, tableCsv(cols.dayCloses, closes));
    exportTable(base, period, parts, tableCsv(cols[view], rows, view === 'exceptions' ? cols.exceptionCounts : []));
  }

  return (
    <ReportFrame
      name="staff"
      period={period}
      onPeriod={setPeriod}
      today={today}
      busy={q.isFetching && !rows}
      onExport={exportCsv}
      exportDisabled={status !== 'ready'}
      filters={<StaffFilter value={staffId} onChange={setStaffId} />}
    >
      <MessagePresenter tone="info" icon="users" message={tr('ws.reports.staff.note')} style={{ marginBlockEnd: 'var(--tp-sp-4)' }} />
      <AsyncStateWrapper
        status={status}
        error={q.error}
        onRetry={() => void q.refetch()}
        skeleton={<ReportSkeleton columns={[tr('ws.reports.staff.columns.person'), tr('ws.reports.staff.columns.daysActive'), tr('ws.reports.staff.columns.orders')]} />}
        emptyContent={<EmptyPeriod title={tr('ws.reports.staff.emptyTitle')} body={tr('ws.reports.staff.emptyBody')} period={period} today={today} onPick={setPeriod} />}
      >
        {rows && (
          <>
            <ViewSwitch<View>
              value={view}
              onChange={setView}
              options={VIEWS.map((v) => ({ value: v, label: tr(`ws.reports.staff.views.${v}`) }))}
              lead={tr(`ws.reports.staff.lead.${view}`)}
            />
            {view === 'dayCloses' ? (
              closes.length === 0 ? (
                <EmptyState compact kind="nothingToDo" icon="sun" title={tr('ws.reports.staff.noDayCloses')} />
              ) : (
                <ReportTable<DayCloseRow> label={tr('ws.reports.staff.views.dayCloses')} columns={cols.dayCloses} rows={closes} rowKey={(r) => `${r.businessDate}-${r.staffId}`} sortable={false} />
              )
            ) : (
              <>
                <TableHint icon="arrowUpRight">{tr('ws.reports.frame.drillHint')}</TableHint>
                <ReportTable<StaffRow> label={tr(`ws.reports.staff.views.${view}`)} columns={cols[view]} rows={rows} rowKey={(r) => r.staffId} onRowClick={openPerson} sortable={false} />
              </>
            )}
            <ColumnNotes notes={notes[view].map((k) => tr(k))} />
          </>
        )}
      </AsyncStateWrapper>
      {drill && <DrillDialog request={drill} onClose={() => setDrill(null)} />}
    </ReportFrame>
  );
}

function staffColumns(tr: Tr, locale: Locale, openAudit: (id: string) => void) {
  const person: ReportColumn<StaffRow> = {
    key: 'person',
    header: tr('ws.reports.staff.columns.person'),
    render: (r) => (
      <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
        <bdi style={{ fontWeight: 600 }}>{r.name}</bdi>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          {r.role && (STAFF_ROLES as readonly string[]).includes(r.role) ? tr(`op.roles.${r.role as StaffRole}`) : (r.role ?? '')}
          {!r.isActive && <StatusBadge size="sm" tone="neutral" label={tr('ws.reports.frame.formerStaff')} />}
        </span>
      </span>
    ),
    csv: (r) => r.name,
  };
  const n = (key: keyof StaffRow & string, header: MessageKey): ReportColumn<StaffRow> => ({
    key,
    header: tr(header),
    numeric: true,
    render: (r) => <Fig value={r[key] as number | null} text={count(r[key] as number | null, locale)} />,
    csv: (r) => r[key] as number | null,
  });
  /** An amount with how many times beneath it; the CSV keeps the two apart. */
  const exception = (key: 'discounts' | 'voids' | 'refunds'): ReportColumn<StaffRow> => ({
    key,
    header: tr(`ws.reports.staff.columns.${key}`),
    numeric: true,
    render: (r) => <CountAmountCell value={r[key]} locale={locale} />,
    csv: (r) => r[key].amountIqd,
  });
  const audit: ReportColumn<StaffRow> = {
    key: 'audit',
    header: '',
    render: (r) => (
      <Button size="sm" kind="ghost" icon="shield" onClick={() => openAudit(r.staffId)} aria-label={tr('ws.reports.staff.auditFor', { name: r.name })}>
        {tr('ws.reports.staff.audit')}
      </Button>
    ),
  };
  const days = n('daysActive', 'ws.reports.staff.columns.daysActive');
  return {
    activity: [
      person,
      days,
      n('ordersTaken', 'ws.reports.staff.columns.orders'),
      n('busiestDayOrders', 'ws.reports.staff.columns.busiest'),
      n('bookingsCreated', 'ws.reports.staff.columns.bookings'),
      n('paymentsTaken', 'ws.reports.staff.columns.payments'),
      audit,
    ],
    exceptions: [
      person,
      days,
      exception('discounts'),
      exception('voids'),
      exception('refunds'),
      audit,
    ],
    /** CSV only: how many times, beside each amount's column. */
    exceptionCounts: (['discounts', 'voids', 'refunds'] as const).map((k) => ({
      header: `${tr(`ws.reports.staff.columns.${k}`)} (${tr('ws.reports.columns.count')})`,
      value: (r: StaffRow) => r[k].count,
    })),
    calls: [
      person,
      days,
      n('callsAnswered', 'ws.reports.staff.columns.calls'),
      {
        key: 'answerTime',
        header: tr('ws.reports.staff.columns.answerTime'),
        numeric: true,
        render: (r) => <Fig value={r.callsAnswered ? r.avgAnswerSeconds : null} text={r.callsAnswered ? duration(r.avgAnswerSeconds, locale, tr) : '—'} />,
        csv: (r) => r.avgAnswerSeconds,
      },
      audit,
    ] as ReportColumn<StaffRow>[],
    dayCloses: [
      { key: 'businessDate', header: tr('ws.reports.staff.columns.businessDay'), render: (r) => <bdi>{formatDay(r.businessDate, locale)}</bdi>, csv: (r) => r.businessDate },
      { key: 'closedBy', header: tr('ws.reports.staff.columns.closedBy'), render: (r) => <bdi>{r.closedBy}</bdi>, csv: (r) => r.closedBy },
      {
        key: 'cash',
        header: tr('ws.reports.staff.columns.cashDifference'),
        numeric: true,
        render: (r) =>
          r.cashVarianceIqd === 0 ? (
            <span style={{ color: 'var(--tp-success-fg)', fontWeight: 600 }}>{tr('ws.reports.staff.matched')}</span>
          ) : (
            <Fig value={r.cashVarianceIqd} text={money(r.cashVarianceIqd, locale)} strong tone={r.cashVarianceIqd !== null && r.cashVarianceIqd < 0 ? 'danger' : 'warn'} />
          ),
        csv: (r) => r.cashVarianceIqd,
      },
    ] as ReportColumn<DayCloseRow>[],
  };
}

function CountAmountCell({ value, locale }: { value: CountAmount; locale: Locale }) {
  if (!value.count) return <Fig value={0} text={value.count === null ? '—' : money(value.amountIqd ?? 0, locale)} />;
  return (
    <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', justifyItems: 'end' }}>
      <span style={{ fontWeight: 600 }}>{money(value.amountIqd, locale)}</span>
      <span dir="ltr" style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
        ×{count(value.count, locale)}
      </span>
    </span>
  );
}
