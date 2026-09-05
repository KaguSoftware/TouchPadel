/**
 * Shared scaffold for the five reports (spec 06.40–06.44): header, period +
 * comparison, ReportFilterBar, ReportTable, optional inline bars, drill-through
 * and CSV export. Each report supplies its RPC name, views and filter fields.
 *
 * RPC call shape (build plan §4): `(p_from, p_to, p_group, p_filters jsonb)`.
 * The active view, the comparison mode and the four filters travel inside
 * `p_filters` — the jsonb is the contract's extension point.
 *
 * Rulebook 2.2 fixes the anatomy of a list page and this is the one place all
 * five reports get it from: title + primary action and the row count, filter
 * bar, toolbar, table, pagination. The reports used to render whatever columns
 * the RPC happened to send, in whatever order, all of them, unpaged, with one
 * empty state doing the work of three.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { appRpc, type AppFunctionName } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { Button, Tabs } from '../../components/ui';
import {
  AsyncStateWrapper,
  ComparisonControl,
  DateRangeControl,
  DrillThroughPanel,
  EmptyState,
  ExportButton,
  PageHeader,
  ResultCount,
  TableSkeleton,
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
import {
  drillKeyFor,
  inferKind,
  normalizeColumns,
  rowLabel,
  sortRows,
  type DrillResult,
  type NormalizedColumn,
  type ReportFilters,
  type ReportGroup,
  type ReportName,
  type ReportResult,
  type ReportRow,
} from './reportTypes';

export type ReportRpc = Extract<AppFunctionName, `report_${string}`>;

/**
 * Enough rows to read a month of days without paging, few enough that the
 * totals row stays on screen with the figures it totals.
 */

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
  const [period, setPeriodState] = useState<Period>(() => presetPeriod('thisMonth'));
  const [compare, setCompare] = useState<ComparisonMode>('none');
  const [group, setGroupState] = useState<ReportGroup>('day');
  const [filters, setFiltersState] = useState<ReportFilters>({ view: views[0]?.id ?? 'default' });
  const [drill, setDrill] = useState<{ key: string; label: string } | null>(null);
  const [sort, setSortState] = useState<SortState | null>(defaultSort ?? null);
  const [allColumns, setAllColumns] = useState(false);

  // Anything that changes which rows exist returns the pager to the first page.
  // Clamping instead would silently put the manager back on page 4 the moment
  // they widened the range again.
  const setPeriod = (p: Period) => setPeriodState(p);
  const setGroup = (g: ReportGroup) => setGroupState(g);
  const setFilters = (f: ReportFilters) => setFiltersState(f);
  const setSort = (s: SortState) => setSortState(s);

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

  /**
   * Rulebook 6.1: columns are chosen, not inherited. The server sends every
   * column it has and the CSV below still exports all of them; the table shows
   * the ones the active view is about. If the payload has stopped carrying the
   * declared keys — a shape change, a renamed column — the server's own set
   * wins, because a one-column table is a worse answer than a wide one.
   */
  const visibleColumns = useMemo(() => {
    const declared = view?.columns;
    if (!declared || allColumns) return columns;
    const byKey = new Map(columns.map((c) => [c.key, c] as const));
    const picked = declared.map((k) => byKey.get(k)).filter((c): c is NormalizedColumn => c !== undefined);
    return picked.length >= 2 ? picked : columns;
  }, [columns, view, allColumns]);
  const columnsHidden = columns.length - visibleColumns.length;
  const canToggleColumns = Boolean(view?.columns) && (allColumns || columnsHidden > 0);

  /**
   * Rulebook 9.1: the skeleton is built from the same declared column set, so
   * the headers, the column count and the end-aligned numeric columns are
   * already in place when the rows land and nothing jumps.
   */
  const skeletonColumns = useMemo(() => {
    const declared = view?.columns;
    if (!declared) return null;
    const shape: NormalizedColumn[] = declared.map((key) => ({ key, kind: inferKind(key, null, undefined), labelEn: null, labelAr: null }));
    return toDataColumns(shape, locale, tr);
  }, [view, locale, tr]);

  const sorted = useMemo(() => sortRows(rows, sort?.key ?? null, sort?.dir ?? 'asc'), [rows, sort]);

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
    // The full column set, always: hiding a column is a reading decision on
    // this screen, not a decision about what the manager may take away.
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
  const activeFilters = [filters.courtId, filters.categoryId, filters.staffId, filters.paymentMethod].filter(Boolean).length;

  return (
    <div>
      <PageHeader
        title={tr(`ws.reports.nav.${name}`)}
        eyebrow={tr('ws.reports.title')}
        subtitle={tr(`ws.reports.lead.${name}`)}
        actions={
          <>
            {/* Rulebook 6.10. First in the actions row, which is end-aligned, so
                the export button stays exactly where it was before the count
                arrived. */}
            {status === 'ready' && <ResultCount shown={sorted.length} total={rows.length} />}
            <ExportButton onExport={exportCsv} disabled={status !== 'ready'} />
          </>
        }
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
      <Toolbar
        end={
          <>
            {canToggleColumns && (
              <Button size="sm" icon="layers" aria-pressed={allColumns} onClick={() => setAllColumns((v) => !v)}>
                {allColumns ? tr('ws.reports.columnSet.showKey') : tr('ws.reports.columnSet.showAll')}
              </Button>
            )}
            <ComparisonControl mode={compare} onChange={setCompare} disabled={!enabled || reportQ.isFetching} />
          </>
        }
      >
        <DateRangeControl period={period} onChange={setPeriod} disabled={!enabled || reportQ.isFetching} />
      </Toolbar>
      <ReportFilterBar fields={fields} filters={filters} onChange={setFilters} group={group} onGroup={setGroup} views={views} disabled={!enabled} />
      {extraControls?.(ctx)}
      {intro}
      <AsyncStateWrapper
        status={status}
        error={reportQ.error}
        onRetry={() => void reportQ.refetch()}
        skeleton={skeletonColumns ? <TableSkeleton columns={skeletonColumns} rows={8} dense /> : undefined}
        emptyContent={
          /* Rulebook 9.2, three different situations and three sentences: a
             filter that matched nothing offers the way back out of it, a view
             that lists exceptions says so positively, and only a genuinely
             empty range says there is nothing to report. */
          activeFilters > 0 ? (
            <EmptyState kind="filtered" body={tr('ws.reports.emptyBody')} onClearFilters={() => setFilters({ view: filters.view })} />
          ) : view?.emptyKind === 'nothingToDo' ? (
            <EmptyState kind="nothingToDo" />
          ) : (
            <EmptyState icon="chart" title={tr('ws.reports.emptyTitle')} body={tr('ws.reports.emptyBody')} />
          )
        }
      >
        {/* The bars summarise the whole result; the table below pages it. */}
        {view?.bars && <HourBars rows={rows} labelKey={view.bars.labelKey} valueKey={view.bars.valueKey} columns={columns} title={tr('ws.reports.bars.label')} />}
        <ReportTable
          aria-label={tr(`ws.reports.nav.${name}`)}
          columns={visibleColumns}
          rows={sorted}
          totals={reportQ.data?.totals}
          onDrill={onDrill}
          sortable={sortable}
          sort={sort}
          onSort={setSort}
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
