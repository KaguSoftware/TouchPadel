/**
 * /reports/staff, the "Till shifts" view (wave5-addendum §5.1: "a Till shifts
 * panel"). Every till and desk shift in the period through app.till_shift_list
 * (MGMT), in the order they started: the report's rule holds, nothing is
 * ranked or sorted by a figure. The RPC takes at most 62 days, so a longer
 * period says so instead of asking (INVALID_ARGUMENT, hint range).
 */
import { useQuery } from '@tanstack/react-query';
import { formatTime, formatTimeRange } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { EmptyState, MessagePresenter } from '../../components/kit';
import { AsyncStateWrapper, ReportSkeleton, ReportTable, asyncStatus, formatDay, money, tableCsv, type ReportColumn, type Tr } from '../reports/ReportParts';
import { fetchShiftList, tillShiftListKey } from './api';
import { DifferenceWords } from './ShiftRows';
import type { ListShift } from './tillShiftLogic';

/** till_shift_list's cap (§2.9.4). */
export const SHIFT_REPORT_MAX_DAYS = 62;

/** Inclusive days in a period of ISO dates; date arithmetic only. */
export function periodDays(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

type Locale = ReturnType<typeof useLocale>['locale'];

export function shiftColumns(tr: Tr, locale: Locale): ReportColumn<ListShift>[] {
  return [
    { key: 'day', header: tr('ws.tillShift.report.columns.day'), render: (s) => <bdi>{formatDay(s.business_date, locale)}</bdi>, csv: (s) => s.business_date },
    { key: 'person', header: tr('ws.tillShift.report.columns.person'), render: (s) => <bdi style={{ fontWeight: 600 }}>{s.staff_name}</bdi>, csv: (s) => s.staff_name },
    { key: 'station', header: tr('ws.tillShift.report.columns.station'), render: (s) => <bdi>{s.station_id}</bdi>, csv: (s) => s.station_id },
    {
      key: 'times',
      header: tr('ws.tillShift.report.columns.times'),
      render: (s) => (
        <bdi style={{ whiteSpace: 'nowrap' }}>
          {s.closed_at ? formatTimeRange(new Date(s.opened_at), new Date(s.closed_at), locale) : tr('ws.tillShift.drawer.since', { time: formatTime(new Date(s.opened_at), locale) })}
        </bdi>
      ),
      csv: (s) => `${s.opened_at} ${s.closed_at ?? ''}`.trim(),
    },
    { key: 'float', header: tr('ws.tillShift.figures.float'), numeric: true, render: (s) => money(s.opening_float_iqd, locale), csv: (s) => s.opening_float_iqd },
    { key: 'expected', header: tr('ws.tillShift.figures.expected'), numeric: true, render: (s) => money(s.cash_expected_iqd, locale), csv: (s) => s.cash_expected_iqd },
    { key: 'counted', header: tr('ws.tillShift.figures.counted'), numeric: true, render: (s) => (s.cash_counted_iqd === null ? '—' : money(s.cash_counted_iqd, locale)), csv: (s) => s.cash_counted_iqd },
    {
      key: 'difference',
      header: tr('ws.tillShift.figures.difference'),
      numeric: true,
      render: (s) =>
        s.closed_at === null ? (
          <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.tillShift.row.open')}</span>
        ) : s.closed_via === 'day_close' ? (
          <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.tillShift.row.endedWithDay')}</span>
        ) : (
          <DifferenceWords variance={s.cash_variance_iqd} />
        ),
      csv: (s) => s.cash_variance_iqd,
    },
  ];
}

/** The rows and columns the report's Export writes for this view. */
export function shiftReportCsv(tr: Tr, locale: Locale, shifts: readonly ListShift[]) {
  return tableCsv(shiftColumns(tr, locale), shifts);
}

export function ShiftReport({ from, to, staffId }: { from: string; to: string; staffId: string | null }) {
  const { tr, locale } = useLocale();
  const tooLong = periodDays(from, to) > SHIFT_REPORT_MAX_DAYS;
  const q = useQuery({
    queryKey: tillShiftListKey({ from, to, staff: staffId }),
    queryFn: () => fetchShiftList({ from, to, staff: staffId }),
    enabled: !tooLong,
    refetchInterval: 120_000,
  });
  if (tooLong) return <MessagePresenter tone="info" message={tr('ws.tillShift.report.tooLong')} />;
  const cols = shiftColumns(tr, locale);
  return (
    <AsyncStateWrapper
      status={asyncStatus(q, (d) => d.shifts.length === 0)}
      error={q.error}
      onRetry={() => void q.refetch()}
      skeleton={<ReportSkeleton columns={cols.slice(0, 4).map((c) => c.header)} />}
      emptyContent={<EmptyState compact kind="nothingToDo" icon="drawer" title={tr('ws.tillShift.report.empty')} />}
    >
      {q.data && <ReportTable<ListShift> label={tr('ws.tillShift.report.view')} columns={cols} rows={q.data.shifts} rowKey={(s) => s.id} sortable={false} />}
    </AsyncStateWrapper>
  );
}
