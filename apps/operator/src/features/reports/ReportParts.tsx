/**
 * The pieces every report is built from (spec 06.40–06.44).
 *
 * A report answers one question for a manager or owner who came looking for
 * it ("which court earns least per hour", "what sold last week"), so each
 * screen is laid out the same way, top to bottom:
 *
 *  1. **The answer for the period.** A band of the period's figures, straight
 *     from the server's totals. These are the only totals on the page: the
 *     tables below no longer repeat them in a footer row, so a figure appears
 *     once.
 *  2. **One breakdown at a time.** A "Show" switch picks the breakdown, and a
 *     sentence under it says what the rows are. The old switches changed
 *     nothing (every view drew the same server table), and the table showed
 *     every column the server had at equal weight.
 *  3. **The table**, with only the columns that breakdown is about, the
 *     identifying column first, then a short "Reading the table" note for the
 *     columns whose meaning is not obvious. Rows that open their transactions
 *     say so above the table.
 *
 * The page subtitle is the period itself ("1 Sep – 17 Sep 2026"), not a
 * description of the screen, and the period presets count from the venue's
 * business day, the same calendar the management panel and Analytics use.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { businessTodayISO, normalizeBusinessDayStart } from '@touch/core';
import { VENUE_TZ, formatDate, formatIQD, formatNumber, formatPercent, type Locale, type MessageKey } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { useCafeSettings } from '../../lib/settings';
import { Button, Field } from '../../components/ui';
import { appRpc } from '../../lib/appRpc';
import {
  AsyncStateWrapper,
  ComparisonControl,
  DataTable,
  DateRangeControl,
  EmptyState,
  ExportButton,
  HeadlineFigure,
  MessagePresenter,
  PageHeader,
  SegmentedControl,
  TableSkeleton,
  Toolbar,
  asyncStatus,
  presetPeriod,
  type Column,
  type ComparisonMode,
  type Period,
  type SortState,
} from '../../components/kit';
import { Icon } from '../../components/icons';
import { downloadCsv, toCsv, type CsvCell } from '../analytics/csv';
import { ReportTabs } from './ReportTabs';
import { reportFilename } from './reportCsv';
import { readCompared, sortBy, type Compared, type FigureChange } from './reportPayloads';
import type { ReportName } from './reportTypes';

export type Tr = ReturnType<typeof useLocale>['tr'];

// ---------------------------------------------------------------------------
// Period
// ---------------------------------------------------------------------------

function localMidnight(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/**
 * The report's period: this month so far, counted from the venue's business
 * day (a 01:00 sale belongs to the evening before). `ready` is false until the
 * business-day setting has loaded, so the first request is for the right days.
 */
export function useReportPeriod() {
  const settings = useCafeSettings();
  const ready = settings.isSuccess || settings.isError;
  const todayISO = businessTodayISO(new Date(), normalizeBusinessDayStart(settings.settings.analytics_business_day_start_hour), VENUE_TZ);
  const today = useMemo(() => localMidnight(todayISO), [todayISO]);
  const [picked, setPeriod] = useState<Period | null>(null);
  const period = picked ?? presetPeriod('thisMonth', today);
  return { period, setPeriod, today, ready: ready || picked !== null };
}

export function formatDay(iso: string, locale: Locale): string {
  return formatDate(new Date(`${iso}T12:00:00Z`), locale, 'UTC');
}

/** "1 Sep 2026 – 17 Sep 2026", or the one day. */
export function periodText(period: Period, locale: Locale, tr: Tr): string {
  if (period.from === period.to) return formatDay(period.from, locale);
  return tr('ws.reports.frame.period', { from: formatDay(period.from, locale), to: formatDay(period.to, locale) });
}

// ---------------------------------------------------------------------------
// Formatting (display only — nothing here adds figures together)
// ---------------------------------------------------------------------------

export function money(n: number | null, locale: Locale): string {
  if (n === null) return '—';
  return Number.isInteger(n) ? formatIQD(n, locale) : formatNumber(n, locale);
}
export function count(n: number | null, locale: Locale): string {
  return n === null ? '—' : formatNumber(n, locale);
}
export function percent(n: number | null, locale: Locale, tr: Tr): string {
  return n === null ? '—' : `${formatPercent(n, locale)}${tr('ws.kit.common.percent')}`;
}
/** Minutes as hours, one decimal: 930 → "15.5 h". A unit change for reading, not a new figure. */
export function hoursOf(minutes: number | null, locale: Locale, tr: Tr): string {
  if (minutes === null) return '—';
  return tr('ws.kit.common.hours', { hours: formatNumber(Math.round(minutes / 6) / 10, locale) });
}
/** A duration in seconds, the way a person would say it: "45 s", "5 min". */
export function duration(seconds: number | null, locale: Locale, tr: Tr): string {
  if (seconds === null) return '—';
  if (seconds < 60) return tr('ws.reports.frame.seconds', { seconds: formatNumber(Math.round(seconds), locale) });
  return tr('ws.kit.common.minutes', { minutes: formatNumber(Math.round(seconds / 6) / 10, locale) });
}
/** A stock quantity with its unit: "2,000 g". */
export function qty(n: number | null, unit: string | null, locale: Locale, tr: Tr): string {
  if (n === null) return '—';
  const known = unit === 'g' || unit === 'ml' || unit === 'pc';
  const u = known ? tr(`op.stock.unit.${unit}` as MessageKey) : (unit ?? '');
  return u ? tr('op.stock.qty', { qty: formatNumber(n, locale), unit: u }) : formatNumber(n, locale);
}
export function nameIn(names: { en: string | null; ar: string | null }, locale: Locale): string {
  return (locale === 'ar' ? (names.ar ?? names.en) : (names.en ?? names.ar)) ?? '—';
}

/** A figure cell: zero and unreported recede, so the non-zero figures carry the eye. */
export function Fig({ value, text, strong, tone }: { value: number | null; text: string; strong?: boolean; tone?: 'warn' | 'danger' }) {
  const quiet = value === null || value === 0;
  return (
    <span
      style={{
        fontWeight: strong && !quiet ? 700 : undefined,
        color: quiet ? 'var(--tp-muted-fg)' : tone === 'danger' ? 'var(--tp-danger-fg)' : tone === 'warn' ? 'var(--tp-warn-fg)' : undefined,
      }}
    >
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The frame: header, report tabs, period and filters
// ---------------------------------------------------------------------------

export function ReportFrame({
  name,
  period,
  onPeriod,
  today,
  busy,
  onExport,
  exportDisabled,
  filters,
  comparedWith,
  children,
}: {
  name: ReportName;
  period: Period;
  onPeriod: (p: Period) => void;
  today: Date;
  busy?: boolean;
  onExport?: () => void;
  exportDisabled?: boolean;
  /** Controls beside the period (court, category, person…), each with a visible label. */
  filters?: ReactNode;
  /** The earlier period the figures are compared with, when a comparison is on. */
  comparedWith?: { from: string; to: string } | null;
  children: ReactNode;
}) {
  const { tr, locale } = useLocale();
  return (
    <div>
      <PageHeader
        title={tr(`ws.reports.nav.${name}`)}
        eyebrow={tr('ws.reports.title')}
        subtitle={
          comparedWith
            ? tr('ws.reports.frame.comparedWith', { period: periodText(period, locale, tr), previous: periodText(comparedWith, locale, tr) })
            : periodText(period, locale, tr)
        }
        actions={onExport && <ExportButton onExport={onExport} disabled={exportDisabled} scope={tr('ws.reports.frame.exportScope')} />}
      >
        <ReportTabs value={name} />
      </PageHeader>
      <Toolbar style={{ alignItems: 'flex-end', gap: 'var(--tp-sp-3)' }}>
        <Field label={tr('ws.reports.filters.period')} group style={{ marginBlockEnd: 0 }}>
          <DateRangeControl period={period} onChange={onPeriod} disabled={busy} now={today} />
        </Field>
      </Toolbar>
      {/* A row of its own: beside the period they wrapped one at a time, half on each line. */}
      {filters && <Toolbar style={{ alignItems: 'flex-end', gap: 'var(--tp-sp-3)' }}>{filters}</Toolbar>}
      {children}
    </div>
  );
}

/** The period's figures, straight from the server's totals. */
export function FigureBand({ children, label, min = '11.5rem' }: { children: ReactNode; label: string; /** Narrowest a cell may get before the band wraps. */ min?: string }) {
  return (
    <section
      aria-label={label}
      style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}), 1fr))`, gap: 'var(--tp-sp-3) var(--tp-sp-4)', marginBlockEnd: 'var(--tp-sp-4)' }}
    >
      {children}
    </section>
  );
}

/** A labelled group of figures (revenue's Earned / Money taken / Given away). */
export function FigureGroup({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', alignContent: 'start' }}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
        <h2 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700 }}>{title}</h2>
        <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', maxInlineSize: '60ch' }}>{hint}</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: 'var(--tp-sp-2)' }}>{children}</div>
    </div>
  );
}

export { HeadlineFigure };

/** What to show under the figures: the breakdown switch and its one-line explanation. */
export function ViewSwitch<V extends string>({
  value,
  onChange,
  options,
  lead,
  end,
}: {
  value: V;
  onChange: (v: V) => void;
  options: readonly { value: V; label: string }[];
  lead: ReactNode;
  /** A control that belongs to this breakdown only (a toggle, a link out). */
  end?: ReactNode;
}) {
  const { tr } = useLocale();
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', marginBlockEnd: 'var(--tp-sp-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2) var(--tp-sp-3)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{tr('ws.reports.frame.show')}</span>
        <SegmentedControl<V> aria-label={tr('ws.reports.frame.show')} value={value} onChange={onChange} options={options} />
        {end && <div style={{ marginInlineStart: 'auto', display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>{end}</div>}
      </div>
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', maxInlineSize: '80ch' }}>{lead}</p>
    </div>
  );
}

/** The short notes under a table for the columns whose meaning is not obvious. */
export function ColumnNotes({ notes }: { notes: readonly string[] }) {
  const { tr } = useLocale();
  if (notes.length === 0) return null;
  return (
    <section aria-label={tr('ws.reports.frame.columnNotes')} style={{ marginBlockStart: 'var(--tp-sp-3)', maxInlineSize: '80ch' }}>
      <h3 style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 600, color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-1)' }}>{tr('ws.reports.frame.columnNotes')}</h3>
      <ul style={{ margin: 0, paddingInlineStart: 'var(--tp-sp-4)', display: 'grid', gap: 'var(--tp-sp-0)', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </section>
  );
}

/** A plain note above a table: where the rows open, or what a filter narrowed. */
export function TableHint({ children, icon = 'info' }: { children: ReactNode; icon?: 'info' | 'arrowUpRight' }) {
  return (
    <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-1-5)' }}>
      <Icon name={icon} size={13} />
      <span>{children}</span>
    </p>
  );
}

export function ScopeNote({ children }: { children: ReactNode }) {
  return <MessagePresenter tone="info" message={children} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** A report column: how to show it, how to sort it, and what goes in the CSV. */
export interface ReportColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  numeric?: boolean;
  /** The value to sort by; a column without one is not sortable. */
  sort?: (row: T) => string | number | null;
  /** The raw value for the CSV; a column without one is left out of it. */
  csv?: (row: T) => CsvCell;
  truncate?: boolean;
  truncateTitle?: (row: T) => string;
}

/** CSV-only fields for a table: things worth taking away that would crowd the screen. */
export interface CsvField<T> {
  header: string;
  value: (row: T) => CsvCell;
}

export function ReportTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  label,
  sortable = true,
}: {
  columns: readonly ReportColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T, i: number) => string;
  onRowClick?: (row: T) => void;
  label: string;
  sortable?: boolean;
}) {
  const [sort, setSort] = useState<SortState | null>(null);
  const active = sort ? columns.find((c) => c.key === sort.key) : undefined;
  const sorted = useMemo(() => sortBy(rows, active?.sort ?? null, sort?.dir ?? 'asc'), [rows, active, sort]);
  const dataColumns: Column<T>[] = columns.map((c) => ({
    key: c.key,
    header: c.header,
    render: c.render,
    numeric: c.numeric,
    sortable: sortable && Boolean(c.sort),
    truncate: c.truncate,
    truncateTitle: c.truncateTitle,
  }));
  return (
    <DataTable
      aria-label={label}
      columns={dataColumns}
      rows={sorted}
      rowKey={rowKey}
      sort={sortable ? sort : null}
      // A number is read biggest-first; a name or a date in its natural order.
      onSort={sortable ? (next) => setSort(sort?.key === next.key ? next : { key: next.key, dir: columns.find((c) => c.key === next.key)?.numeric ? 'desc' : 'asc' }) : undefined}
      onRowClick={onRowClick}
      dense
    />
  );
}

export function tableCsv<T>(columns: readonly ReportColumn<T>[], rows: readonly T[], extra: readonly CsvField<T>[] = []): { headers: string[]; body: CsvCell[][] } {
  const cols = columns.filter((c) => c.csv);
  return {
    headers: [...cols.map((c) => c.header), ...extra.map((e) => e.header)],
    body: rows.map((r) => [...cols.map((c) => c.csv!(r)), ...extra.map((e) => e.value(r))]),
  };
}

export function exportTable(base: string, period: Period, parts: Record<string, string | undefined | null>, table: { headers: string[]; body: CsvCell[][] }) {
  downloadCsv(reportFilename(base, period, parts), toCsv(table.headers, table.body));
}

export function ReportSkeleton({ columns }: { columns: readonly string[] }) {
  const cols: Column<unknown>[] = columns.map((header, i) => ({ key: String(i), header, numeric: i > 0 }));
  return (
    <div aria-busy="true" style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11.5rem, 1fr))', gap: 'var(--tp-sp-3)' }}>
        {[0, 1, 2, 3].map((i) => (
          <HeadlineFigure key={i} label="" value="" busy />
        ))}
      </div>
      <TableSkeleton columns={cols} rows={8} dense />
    </div>
  );
}

/** A report with nothing in it for the period: say so, and offer a longer one. */
export function EmptyPeriod({ title, body, period, today, onPick }: { title: string; body: string; period: Period; today: Date; onPick: (p: Period) => void }) {
  const { tr } = useLocale();
  const last30 = presetPeriod('last30', today);
  const preset = last30.from === period.from && last30.to === period.to ? 'lastMonth' : 'last30';
  return (
    <EmptyState
      icon="chart"
      title={title}
      body={body}
      action={<Button onClick={() => onPick(presetPeriod(preset, today))}>{tr(`ws.kit.dateRange.${preset}`)}</Button>}
    />
  );
}

export { AsyncStateWrapper, EmptyState, asyncStatus };

// ---------------------------------------------------------------------------
// Bars (courts by start time)
// ---------------------------------------------------------------------------

/**
 * One bar per row, the figure at the end. The bar is scaled against the
 * biggest row for display only; the figure beside it is the server's.
 */
export function BarList({ rows, label }: { rows: readonly { key: string; label: string; value: number | null; text: string }[]; label: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value ?? 0));
  return (
    <section aria-label={label} style={{ display: 'grid', gap: 'var(--tp-sp-1)', maxInlineSize: '46rem', padding: 'var(--tp-sp-3)', border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', background: 'var(--tp-surface)' }}>
      {rows.map((r) => {
        const width = max > 0 && r.value ? Math.max(1, (r.value / max) * 100) : 0;
        return (
          <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '3.5rem minmax(0, 1fr) 3rem', alignItems: 'center', gap: 'var(--tp-sp-2-5)', fontSize: 'var(--tp-fs-sm)' }}>
            <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'start', color: 'var(--tp-muted-fg)' }}>
              {r.label}
            </span>
            <span style={{ display: 'block', blockSize: '0.7rem', borderRadius: 'var(--tp-radius-pill)', overflow: 'hidden' }}>
              {/* No transition: bars change only because the reader changed the period. */}
              <span aria-hidden="true" style={{ display: 'block', blockSize: '100%', inlineSize: `${width}%`, background: 'var(--tp-accent)', borderRadius: 'var(--tp-radius-pill)' }} />
            </span>
            <span style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--tp-font-numeric)', textAlign: 'end', fontWeight: r.value ? 600 : undefined, color: r.value ? undefined : 'var(--tp-muted-fg)' }}>
              {r.text}
            </span>
          </div>
        );
      })}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** "Compare with", beside the report's other filters. */
export function CompareFilter({ value, onChange, disabled }: { value: ComparisonMode; onChange: (m: ComparisonMode) => void; disabled?: boolean }) {
  const { tr } = useLocale();
  return (
    <Field label={tr('ws.reports.filters.compare')} style={{ marginBlockEnd: 0 }}>
      <ComparisonControl mode={value} onChange={onChange} disabled={disabled} label={tr('ws.reports.filters.compare')} />
    </Field>
  );
}

/**
 * A report read either on its own or, with a comparison on, through
 * app.report_compare — which runs the same report for the earlier period and
 * works out each headline figure's change server-side (0103).
 */
export function useComparedReport<T>(
  report: 'revenue' | 'courts' | 'cafe',
  rpc: 'report_revenue' | 'report_courts' | 'report_cafe',
  args: Record<string, unknown>,
  compare: ComparisonMode,
  read: (raw: unknown) => T,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['reports', rpc, args, compare],
    queryFn: async (): Promise<Compared<T>> => {
      if (compare === 'none') return { current: read(await appRpc<unknown>(rpc, args)), changes: {}, period: null };
      return readCompared(await appRpc<unknown>('report_compare', { p_report: report, p_compare: compare, ...args }), read);
    },
    enabled,
    refetchInterval: 120_000,
  });
}

/** A headline figure's change, as HeadlineFigure takes it, or none. */
export function changeOf(changes: Record<string, FigureChange> | undefined, key: string): FigureChange | null {
  return changes?.[key] ?? null;
}

// ---------------------------------------------------------------------------
// Drill-through — its own module (./DrillDialog) so the management panel and
// analytics can open the same window without pulling in the report frame.
// ---------------------------------------------------------------------------

export { DrillDialog, type DrillRequest } from './DrillDialog';
