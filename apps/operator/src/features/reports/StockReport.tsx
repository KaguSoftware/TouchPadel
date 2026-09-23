/**
 * StockReportScreen (spec 06.43) — the owner's "Stock value", and Stock in the
 * manager's reports.
 *
 * The question: **what is on the shelves worth, and what needs attention?**
 *
 * Before this, the screen always said "Nothing to report for this range":
 * `report_stock` returns no `rows` at all, only named lists (0068), and the
 * generic table only ever read `rows`. Every list is now shown.
 *
 * Five of the seven lists — out of stock, running low, below par, expiring,
 * expired — are the
 * stock as it is NOW; the server does not range them. Only "Used" and "Count
 * differences" follow the period. Each list says which it is, so nobody moves
 * the dates and wonders why nothing changed. The category select is gone:
 * report_stock does not read it.
 *
 * The counts up top are the lengths of the lists the server sent; nothing is
 * added up here. Each list links to the inventory screen that acts on it,
 * because nothing here is editable and report_drill has no ingredient scope.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDateTime, type MessageKey } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { appRpc } from '../../lib/appRpc';
import { Button } from '../../components/ui';
import { STOCK_HREF } from '../ops/opsLogic';
import {
  AsyncStateWrapper,
  ColumnNotes,
  EmptyState,
  Fig,
  FigureBand,
  HeadlineFigure,
  ReportFrame,
  ReportSkeleton,
  ReportTable,
  TableHint,
  ViewSwitch,
  asyncStatus,
  count,
  exportTable,
  formatDay,
  money,
  nameIn,
  qty,
  tableCsv,
  useReportPeriod,
  type ReportColumn,
  type Tr,
} from './ReportParts';
import { dayCell, timeCell } from '../analytics/cellFormat';
import { readStock, type BelowParRow, type ConsumptionRow, type ExpiryRow, type LowStockRow, type StockReport, type VarianceRow } from './reportPayloads';

type View = 'out' | 'low' | 'belowPar' | 'expiring' | 'expired' | 'used' | 'counts';
const VIEWS: readonly View[] = ['out', 'low', 'belowPar', 'expiring', 'expired', 'used', 'counts'];
/** The lists that are the stock as it is now, whatever the period. */
const NOW: ReadonlySet<View> = new Set(['out', 'low', 'belowPar', 'expiring', 'expired']);
type Locale = ReturnType<typeof useLocale>['locale'];

const OPEN: Partial<Record<View, { href: string; label: MessageKey }>> = {
  out: { href: STOCK_HREF.out, label: 'ws.reports.stock.openInventory' },
  low: { href: STOCK_HREF.low, label: 'ws.reports.stock.openInventory' },
  belowPar: { href: STOCK_HREF.belowPar, label: 'ws.reports.stock.openInventory' },
  expiring: { href: STOCK_HREF.expiringSoon, label: 'ws.reports.stock.openExpiry' },
  expired: { href: STOCK_HREF.expired, label: 'ws.reports.stock.openExpiry' },
  counts: { href: STOCK_HREF.lastCount, label: 'ws.reports.stock.openCounts' },
};

export function StockReportScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const { period, setPeriod, today, ready } = useReportPeriod();
  const [view, setView] = useState<View>('out');
  const [onlyDifferences, setOnlyDifferences] = useState(true);

  const args = { p_from: period.from, p_to: period.to, p_filters: {} };
  const q = useQuery({
    queryKey: ['reports', 'report_stock', args],
    queryFn: async () => readStock(await appRpc<unknown>('report_stock', args)),
    enabled: ready,
    refetchInterval: 120_000,
  });
  const data = q.data;
  // Never "empty": a venue with nothing low and nothing used still has a value on the shelves.
  const status = asyncStatus(q, () => false);
  const cols = stockColumns(tr, locale);
  const variance = data ? (onlyDifferences ? data.variance.filter((v) => v.varianceQty !== 0) : data.variance) : [];

  const notes: Record<View, MessageKey[]> = {
    out: ['ws.reports.stock.notes.par'],
    low: ['ws.reports.stock.notes.alertAt', 'ws.reports.stock.notes.par'],
    belowPar: ['ws.reports.stock.notes.par'],
    expiring: [],
    expired: [],
    used: [],
    counts: ['ws.reports.stock.notes.expected'],
  };

  function exportCsv() {
    if (!data) return;
    const base = tr('ws.reports.export.stock');
    const parts = { view };
    const t = tableFor(view, data, variance, cols, tr('ws.reports.columns.unit'), tr('ws.reports.stock.columns.countedAtTime'));
    exportTable(base, locale, period, parts, t);
  }

  const open = OPEN[view];
  return (
    <ReportFrame name="stock" period={period} onPeriod={setPeriod} today={today} busy={q.isFetching && !data} onExport={exportCsv} exportDisabled={status !== 'ready'}>
      <AsyncStateWrapper
        status={status}
        error={q.error}
        onRetry={() => void q.refetch()}
        skeleton={<ReportSkeleton columns={[tr('ws.reports.stock.columns.ingredient'), tr('ws.reports.stock.columns.onHand'), tr('ws.reports.stock.columns.par')]} />}
      >
        {data && (
          <>
            <FigureBand label={tr('ws.reports.nav.stock')}>
              <HeadlineFigure label={tr('ws.reports.stock.value')} value={money(data.valueIqd, locale)} hint={tr('ws.reports.stock.valueHint')} />
              <HeadlineFigure label={tr('ws.reports.stock.out')} value={count(data.out.length, locale)} tone={data.out.length ? 'danger' : 'neutral'} />
              <HeadlineFigure label={tr('ws.reports.stock.low')} value={count(data.low.length, locale)} tone={data.low.length ? 'danger' : 'neutral'} />
              <HeadlineFigure label={tr('ws.reports.stock.belowPar')} value={count(data.belowPar.length, locale)} tone={data.belowPar.length ? 'warn' : 'neutral'} />
              <HeadlineFigure label={tr('ws.reports.stock.expiring')} value={count(data.expiringSoon.length, locale)} tone={data.expiringSoon.length ? 'warn' : 'neutral'} />
              <HeadlineFigure label={tr('ws.reports.stock.expired')} value={count(data.expired.length, locale)} tone={data.expired.length ? 'danger' : 'neutral'} />
            </FigureBand>

            <ViewSwitch<View>
              value={view}
              onChange={setView}
              options={VIEWS.map((v) => ({ value: v, label: tr(`ws.reports.stock.views.${v}`) }))}
              lead={tr(`ws.reports.stock.lead.${view}`)}
              end={
                <>
                  {view === 'counts' && data.variance.length > 0 && (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', fontSize: 'var(--tp-fs-sm)' }}>
                      <input type="checkbox" checked={onlyDifferences} onChange={(e) => setOnlyDifferences(e.target.checked)} />
                      {tr('ws.reports.stock.onlyDifferences')}
                    </label>
                  )}
                  {open && (
                    <Button size="sm" iconEnd="arrowUpRight" onClick={() => void navigate({ href: open.href })}>
                      {tr(open.label)}
                    </Button>
                  )}
                </>
              }
            />
            {NOW.has(view) && <TableHint icon="info">{tr('ws.reports.stock.now')}</TableHint>}
            <StockView view={view} data={data} variance={variance} cols={cols} tr={tr} />
            <ColumnNotes notes={notes[view].map((k) => tr(k))} />
          </>
        )}
      </AsyncStateWrapper>
    </ReportFrame>
  );
}

function StockView({ view, data, variance, cols, tr }: { view: View; data: StockReport; variance: VarianceRow[]; cols: ReturnType<typeof stockColumns>; tr: Tr }) {
  const label = tr(`ws.reports.stock.views.${view}`);
  const empty = (key: MessageKey) => <EmptyState compact kind="nothingToDo" title={tr(key)} />;
  switch (view) {
    case 'out':
      return data.out.length === 0 ? empty('ws.reports.stock.empty.out') : <ReportTable<LowStockRow> label={label} columns={cols.out} rows={data.out} rowKey={(r) => r.ingredientId} />;
    case 'low':
      return data.low.length === 0 ? empty('ws.reports.stock.empty.low') : <ReportTable<LowStockRow> label={label} columns={cols.low} rows={data.low} rowKey={(r) => r.ingredientId} />;
    case 'belowPar':
      return data.belowPar.length === 0 ? empty('ws.reports.stock.empty.belowPar') : <ReportTable<BelowParRow> label={label} columns={cols.belowPar} rows={data.belowPar} rowKey={(r) => r.ingredientId} />;
    case 'expiring':
      return data.expiringSoon.length === 0 ? empty('ws.reports.stock.empty.expiring') : <ReportTable<ExpiryRow> label={label} columns={cols.expiring} rows={data.expiringSoon} rowKey={(r) => r.batchId} />;
    case 'expired':
      return data.expired.length === 0 ? empty('ws.reports.stock.empty.expired') : <ReportTable<ExpiryRow> label={label} columns={cols.expired} rows={data.expired} rowKey={(r) => r.batchId} />;
    case 'used':
      return data.consumption.length === 0 ? empty('ws.reports.stock.empty.used') : <ReportTable<ConsumptionRow> label={label} columns={cols.used} rows={data.consumption} rowKey={(r) => r.ingredientId} />;
    case 'counts':
      if (data.variance.length === 0) return empty('ws.reports.stock.empty.counts');
      if (variance.length === 0) return empty('ws.reports.stock.empty.countsMatched');
      return <ReportTable<VarianceRow> label={label} columns={cols.counts} rows={variance} rowKey={(r, i) => `${r.countId}-${r.ingredientId}-${i}`} />;
  }
}

/** The list on screen as CSV: bare quantities, with the unit in a column of its own. */
function tableFor(view: View, data: StockReport, variance: VarianceRow[], cols: ReturnType<typeof stockColumns>, unitHeader: string, countedAtTimeHeader: string) {
  const unit = [{ header: unitHeader, value: (r: { unit: string | null }) => r.unit }];
  switch (view) {
    case 'out':
      return tableCsv(cols.out, data.out, unit);
    case 'low':
      return tableCsv(cols.low, data.low, unit);
    case 'belowPar':
      return tableCsv(cols.belowPar, data.belowPar, unit);
    case 'expiring':
      return tableCsv(cols.expiring, data.expiringSoon, unit);
    case 'expired':
      return tableCsv(cols.expired, data.expired, unit);
    case 'used':
      return tableCsv(cols.used, data.consumption, unit);
    case 'counts':
      // The clock beside the date column, so both sort the way a spreadsheet expects.
      return tableCsv(cols.counts, variance, [{ header: countedAtTimeHeader, value: (r: VarianceRow) => timeCell(r.countedAt) }, ...unit]);
  }
}

function stockColumns(tr: Tr, locale: Locale) {
  const ingredient = <T extends { name: { en: string | null; ar: string | null } }>(): ReportColumn<T> => ({
    key: 'ingredient',
    header: tr('ws.reports.stock.columns.ingredient'),
    truncate: true,
    truncateTitle: (r) => nameIn(r.name, locale),
    render: (r) => <bdi>{nameIn(r.name, locale)}</bdi>,
    sort: (r) => nameIn(r.name, locale),
    csv: (r) => nameIn(r.name, locale),
  });
  /** A quantity with the row's unit; the CSV keeps the bare number and a unit column. */
  const q = <T extends { unit: string | null }>(key: keyof T & string, header: MessageKey, opts: { strong?: boolean; tone?: 'warn' | 'danger' } = {}): ReportColumn<T> => ({
    key,
    header: tr(header),
    numeric: true,
    render: (r) => <Fig value={r[key] as number | null} text={qty(r[key] as number | null, r.unit, locale, tr)} strong={opts.strong} tone={opts.tone} />,
    sort: (r) => r[key] as number | null,
    csv: (r) => r[key] as number | null,
  });
  const money_ = <T,>(key: keyof T & string, header: MessageKey, strong?: boolean): ReportColumn<T> => ({
    key,
    header: tr(header),
    numeric: true,
    render: (r) => <Fig value={r[key] as number | null} text={money(r[key] as number | null, locale)} strong={strong} />,
    sort: (r) => r[key] as number | null,
    csv: (r) => r[key] as number | null,
  });
  const days = (header: MessageKey): ReportColumn<ExpiryRow> => ({
    key: 'days',
    header: tr(header),
    numeric: true,
    render: (r) => count(r.days, locale),
    sort: (r) => r.days,
    csv: (r) => r.days,
  });
  const useBy: ReportColumn<ExpiryRow> = {
    key: 'expiryDate',
    header: tr('ws.reports.stock.columns.useBy'),
    render: (r) => (r.expiryDate ? <bdi>{formatDay(r.expiryDate, locale)}</bdi> : '—'),
    sort: (r) => r.expiryDate,
    csv: (r) => r.expiryDate,
  };
  const screen = <T,>(c: ReportColumn<T>[]) => c;
  return {
    out: screen<LowStockRow>([ingredient(), q('onHand', 'ws.reports.stock.columns.onHand', { strong: true, tone: 'danger' }), q('parLevel', 'ws.reports.stock.columns.par')]),
    low: screen<LowStockRow>([ingredient(), q('onHand', 'ws.reports.stock.columns.onHand', { strong: true, tone: 'danger' }), q('threshold', 'ws.reports.stock.columns.alertAt'), q('parLevel', 'ws.reports.stock.columns.par')]),
    belowPar: screen<BelowParRow>([ingredient(), q('onHand', 'ws.reports.stock.columns.onHand'), q('parLevel', 'ws.reports.stock.columns.par'), q('shortfall', 'ws.reports.stock.columns.shortBy', { strong: true, tone: 'warn' })]),
    expiring: screen<ExpiryRow>([ingredient(), q('qtyRemaining', 'ws.reports.stock.columns.qty'), useBy, days('ws.reports.stock.columns.daysLeft'), money_('valueIqd', 'ws.reports.stock.columns.value', true)]),
    expired: screen<ExpiryRow>([ingredient(), q('qtyRemaining', 'ws.reports.stock.columns.qty'), useBy, days('ws.reports.stock.columns.daysPast'), money_('valueIqd', 'ws.reports.stock.columns.value', true)]),
    used: screen<ConsumptionRow>([ingredient(), q('consumedQty', 'ws.reports.stock.columns.used'), money_('costIqd', 'ws.reports.stock.columns.cost', true)]),
    counts: screen<VarianceRow>([
      {
        key: 'countedAt',
        header: tr('ws.reports.stock.columns.countedOn'),
        render: (r) => (r.countedAt ? <bdi>{formatDateTime(new Date(r.countedAt), locale)}</bdi> : '—'),
        sort: (r) => r.countedAt,
        // `2026-09-23`, not `2026-09-23T11:05:23.481Z`: a date a spreadsheet
        // sorts and groups by. The clock is the column after it.
        csv: (r) => dayCell(r.countedAt),
      },
      ingredient(),
      q('theoreticalQty', 'ws.reports.stock.columns.expected'),
      q('countedQty', 'ws.reports.stock.columns.counted'),
      q('varianceQty', 'ws.reports.stock.columns.difference', { strong: true, tone: 'warn' }),
    ]),
  };
}
