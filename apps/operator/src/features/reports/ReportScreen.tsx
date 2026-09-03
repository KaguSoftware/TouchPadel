/**
 * Shared scaffold for the five reports (spec 06.40–06.44): header, period +
 * comparison, ReportFilterBar, ReportTable, optional inline bars, drill-through
 * and CSV export. Each report supplies its RPC name, views and filter fields.
 *
 * RPC call shape (build plan §4): `(p_from, p_to, p_group, p_filters jsonb)`.
 * The active view, the comparison mode and the four filters travel inside
 * `p_filters` — the jsonb is the contract's extension point.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { appRpc, type AppFunctionName } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { Tabs } from '../../components/ui';
import {
  AsyncStateWrapper,
  ComparisonControl,
  DateRangeControl,
  DrillThroughPanel,
  EmptyState,
  ExportButton,
  PageHeader,
  Toolbar,
  asyncStatus,
  presetPeriod,
  type ComparisonMode,
  type Period,
  type SortState,
} from '../../components/kit';
import { downloadCsv } from '../analytics/csv';
import { HourBars } from './HourBars';
import { ReportFilterBar, type FilterField, type ReportView } from './ReportFilterBar';
import { ReportTable } from './ReportTable';
import { columnLabel, toDataColumns } from './columns';
import { reportCsv, reportFilename } from './reportCsv';
import { drillKeyFor, normalizeColumns, rowLabel, type DrillResult, type ReportFilters, type ReportGroup, type ReportName, type ReportResult, type ReportRow } from './reportTypes';

export type ReportRpc = Extract<AppFunctionName, `report_${string}`>;

const REPORT_TABS: readonly { id: ReportName; path: '/reports/revenue' | '/reports/courts' | '/reports/cafe' | '/reports/stock' | '/reports/staff' }[] = [
  { id: 'revenue', path: '/reports/revenue' },
  { id: 'courts', path: '/reports/courts' },
  { id: 'cafe', path: '/reports/cafe' },
  { id: 'stock', path: '/reports/stock' },
  { id: 'staff', path: '/reports/staff' },
];

export interface ReportScreenProps {
  name: ReportName;
  rpc: ReportRpc;
  views: readonly ReportView[];
  fields: readonly FilterField[];
  /** When false the query does not run; the caller renders the refusal notice via `notice`. */
  enabled?: boolean;
  notice?: ReactNode;
  /** Rendered between the filters and the table (e.g. the staff report's no-ranking note). */
  intro?: ReactNode;
  sortable?: boolean;
  defaultSort?: SortState | null;
  rowExtra?: (ctx: { filters: ReportFilters; period: Period }) => { header: ReactNode; render: (row: ReportRow) => ReactNode } | undefined;
  /** Extra controls beside the filter bar, given the current filters. */
  extraControls?: (ctx: { filters: ReportFilters; period: Period }) => ReactNode;
}

export function ReportScreen({ name, rpc, views, fields, enabled = true, notice, intro, sortable = true, defaultSort, rowExtra, extraControls }: ReportScreenProps) {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>(() => presetPeriod('thisMonth'));
  const [compare, setCompare] = useState<ComparisonMode>('none');
  const [group, setGroup] = useState<ReportGroup>('day');
  const [filters, setFilters] = useState<ReportFilters>({ view: views[0]?.id ?? 'default' });
  const [drill, setDrill] = useState<{ key: string; label: string } | null>(null);

  // Argument shapes follow migration 0068 exactly: only report_revenue takes
  // p_group, report_staff_activity takes p_staff_id instead of p_filters, and
  // the rest take (p_from, p_to, p_filters). Unknown jsonb keys are harmless.
  const args = useMemo(() => {
    const base = { p_from: period.from, p_to: period.to };
    if (rpc === 'report_staff_activity') return { ...base, p_staff_id: filters.staffId ?? null };
    const p_filters = {
      view: filters.view,
      compare,
      courtId: filters.courtId ?? null,
      categoryId: filters.categoryId ?? null,
      staffId: filters.staffId ?? null,
      paymentMethod: filters.paymentMethod ?? null,
    };
    return rpc === 'report_revenue' ? { ...base, p_group: group, p_filters } : { ...base, p_filters };
  }, [rpc, period, group, filters, compare]);

  const reportQ = useQuery({
    queryKey: ['reports', rpc, args],
    queryFn: () => appRpc<ReportResult>(rpc, args),
    enabled,
    refetchInterval: 120_000,
  });
  const rows: ReportRow[] = useMemo(() => reportQ.data?.rows ?? [], [reportQ.data]);
  const columns = useMemo(() => normalizeColumns(reportQ.data?.columns, rows), [reportQ.data, rows]);
  const status = enabled ? asyncStatus(reportQ, (d) => (d?.rows ?? []).length === 0) : 'ready';
  const view = views.find((v) => v.id === filters.view);

  const drillQ = useQuery({
    queryKey: ['reports', 'drill', name, drill?.key, period.from, period.to],
    // A row drill is scoped by its own key ('court:<id>' | 'item:<id>' | 'staff:<id>'); that IS the figure argument.
    queryFn: () => appRpc<DrillResult>('report_drill', { p_figure: drill?.key, p_key: null, p_from: period.from, p_to: period.to }),
    enabled: drill !== null,
  });
  const transactions: ReportRow[] = useMemo(() => drillQ.data?.transactions ?? [], [drillQ.data]);
  const drillColumns = useMemo(() => toDataColumns(normalizeColumns(null, transactions), locale, tr), [transactions, locale, tr]);

  function onDrill(row: ReportRow) {
    const key = drillKeyFor(row);
    if (!key) return;
    setDrill({ key, label: rowLabel(row, columns) });
  }

  function exportCsv() {
    const csv = reportCsv(columns, rows, reportQ.data?.totals, (c) => columnLabel(c, locale, tr), tr('ws.reports.totals'));
    downloadCsv(
      reportFilename(tr(`ws.reports.export.${name}`), period, {
        view: views.length > 1 ? filters.view : undefined,
        group: fields.includes('group') ? group : undefined,
        court: filters.courtId,
        cat: filters.categoryId,
        staff: filters.staffId,
        pay: filters.paymentMethod,
      }),
      csv,
    );
  }

  const ctx = { filters, period };
  const extra = rowExtra?.(ctx);

  return (
    <div>
      <PageHeader
        title={tr(`ws.reports.nav.${name}`)}
        eyebrow={tr('ws.reports.title')}
        subtitle={tr(`ws.reports.lead.${name}`)}
        actions={<ExportButton onExport={exportCsv} disabled={status !== 'ready'} />}
      >
        <Tabs<ReportName>
          value={name}
          onChange={(id) => {
            const target = REPORT_TABS.find((t) => t.id === id);
            if (target) void navigate({ to: target.path });
          }}
          items={REPORT_TABS.map((t) => ({ id: t.id, label: tr(`ws.reports.nav.${t.id}`) }))}
          style={{ marginBlockEnd: 0 }}
        />
      </PageHeader>
      {notice}
      <Toolbar end={<ComparisonControl mode={compare} onChange={setCompare} disabled={!enabled || reportQ.isFetching} />}>
        <DateRangeControl period={period} onChange={setPeriod} disabled={!enabled || reportQ.isFetching} />
      </Toolbar>
      <ReportFilterBar fields={fields} filters={filters} onChange={setFilters} group={group} onGroup={setGroup} views={views} disabled={!enabled} />
      {extraControls?.(ctx)}
      {intro}
      <AsyncStateWrapper
        status={status}
        error={reportQ.error}
        onRetry={() => void reportQ.refetch()}
        emptyContent={<EmptyState icon="chart" title={tr('ws.reports.emptyTitle')} body={tr('ws.reports.emptyBody')} />}
      >
        {view?.bars && <HourBars rows={rows} labelKey={view.bars.labelKey} valueKey={view.bars.valueKey} columns={columns} title={tr('ws.reports.bars.label')} />}
        <ReportTable
          aria-label={tr(`ws.reports.nav.${name}`)}
          columns={columns}
          rows={rows}
          totals={reportQ.data?.totals}
          onDrill={onDrill}
          sortable={sortable}
          defaultSort={defaultSort}
          rowExtra={extra}
        />
      </AsyncStateWrapper>
      {drill && (
        <DrillThroughPanel
          title={tr('ws.reports.drillRow', { label: drill.label })}
          status={asyncStatus(drillQ, (d) => (d?.transactions ?? []).length === 0)}
          transactions={transactions}
          columns={drillColumns}
          rowKey={(row, i) => String(row.id ?? i)}
          onClose={() => setDrill(null)}
          onRetry={() => void drillQ.refetch()}
          error={drillQ.error}
        />
      )}
    </div>
  );
}
