/**
 * CafeReportScreen (spec 06.42).
 *
 * The question: **what sold, what did it earn, and what did it cost?**
 *
 * The period's figures lead: revenue, orders, average order, items sold,
 * gross profit and margin, and prep time. Profit and margin say which items
 * they cover — `report_cafe` counts profit only on items that have a recorded
 * cost, and the old screen printed an 86% margin with no hint that it rested
 * on 21 of 58 items.
 *
 * Breakdowns: best sellers, cost & profit, by category (`byCategory`, which
 * the old screen never showed), and waste by reason (`wasteByReason`, ditto —
 * its "Waste by reason" view drew the item table again). "Prep times by
 * station" is gone as a view: the server sends one average and a 90th
 * percentile for all tickets, not per station, so it is a figure up top.
 *
 * The payment-method and day/week/month controls are gone: report_cafe reads
 * only `categoryId` (0096), so they changed nothing.
 *
 * An item row opens its sold lines (report_drill `item:<id>`); the waste
 * breakdown opens every write-off in the period.
 */
import { useState } from 'react';
import type { MessageKey } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import type { ComparisonMode } from '../../components/kit';
import { knownReason } from '../admin/dayCloseLogic';
import {
  AsyncStateWrapper,
  asyncStatus,
  changeOf,
  ColumnNotes,
  CompareFilter,
  count,
  DrillDialog,
  duration,
  EmptyPeriod,
  EmptyState,
  exportTable,
  Fig,
  FigureBand,
  HeadlineFigure,
  money,
  nameIn,
  percent,
  ReportFrame,
  ReportSkeleton,
  ReportTable,
  tableCsv,
  TableHint,
  useComparedReport,
  useReportPeriod,
  ViewSwitch,
  type DrillRequest,
  type ReportColumn,
  type Tr,
} from './ReportParts';
import { CategoryFilter } from './ReportFilterBar';
import { cafeIsEmpty, readCafe, type CafeCategoryRow, type CafeItemRow, type WasteReasonRow } from './reportPayloads';

type View = 'items' | 'profit' | 'categories' | 'waste';
const VIEWS: readonly View[] = ['items', 'profit', 'categories', 'waste'];
type Locale = ReturnType<typeof useLocale>['locale'];

const MOVEMENTS = ['waste_spill', 'waste_spoilage', 'void_after_send', 'expired_writeoff'] as const;

/** A waste reason as staff would say it: the movement's name, a known reason code, or the code itself. */
export function wasteReasonWords(code: string, tr: Tr): string {
  if ((MOVEMENTS as readonly string[]).includes(code)) return tr(`op.stock.movement.${code as (typeof MOVEMENTS)[number]}`);
  const known = knownReason(code);
  return known ? tr(`op.reasons.${known}`) : code;
}

export function CafeReportScreen() {
  const { tr, locale } = useLocale();
  const { period, setPeriod, today, ready } = useReportPeriod();
  const [categoryId, setCategoryId] = useState('');
  const [view, setView] = useState<View>('items');
  const [drill, setDrill] = useState<DrillRequest | null>(null);

  const args = { p_from: period.from, p_to: period.to, p_filters: { categoryId: categoryId || null } };
  const [compare, setCompare] = useState<ComparisonMode>('none');
  const q = useComparedReport('cafe', 'report_cafe', args, compare, readCafe, ready);
  const data = q.data?.current;
  const changes = q.data?.changes;
  const status = asyncStatus(q, (d) => cafeIsEmpty(d.current));
  const s = data?.summary ?? null;
  // Profit and margin rest only on items with a recorded cost; when that is
  // not all of them, the tile says how many it is.
  const partlyCosted = s?.itemsWithCogs != null && s.itemsTotal != null && s.itemsWithCogs < s.itemsTotal;
  const marginText = percent(s?.marginPct ?? null, locale, tr);
  const profitHint = !s?.itemsWithCogs
    ? undefined
    : partlyCosted
      ? tr('ws.reports.cafe.profitHintCosted', { margin: marginText, with: count(s.itemsWithCogs, locale), total: count(s.itemsTotal, locale) })
      : tr('ws.reports.cafe.profitHint', { margin: marginText });

  const columns = cafeColumns(tr, locale);
  const notes: Record<View, MessageKey[]> = {
    items: ['ws.reports.cafe.notes.revenue', 'ws.reports.cafe.notes.orders'],
    profit: ['ws.reports.cafe.notes.cost', 'ws.reports.cafe.notes.margin'],
    categories: ['ws.reports.cafe.notes.cost', 'ws.reports.cafe.notes.margin'],
    waste: [],
  };

  function openItem(r: CafeItemRow) {
    setDrill({ what: nameIn(r.name, locale), figures: [{ key: null, label: '' }], scope: `item:${r.itemId}`, from: period.from, to: period.to });
  }
  function openWaste() {
    setDrill({ what: tr('ws.reports.cafe.views.waste'), figures: [{ key: 'waste', label: '' }], scope: null, from: period.from, to: period.to });
  }

  function exportCsv() {
    if (!data) return;
    const base = tr('ws.reports.export.cafe');
    const parts = { view, cat: categoryId || undefined };
    if (view === 'categories') return exportTable(base, period, parts, tableCsv(columns.categories, data.categories));
    if (view === 'waste') return exportTable(base, period, parts, tableCsv(columns.waste, data.waste));
    // Items: sales and cost together, whichever of the two item breakdowns is showing.
    exportTable(base, period, parts, tableCsv([...columns.items, ...columns.profit.slice(2)], data.items));
  }

  return (
    <ReportFrame
      name="cafe"
      period={period}
      onPeriod={setPeriod}
      today={today}
      busy={q.isFetching && !data}
      onExport={exportCsv}
      exportDisabled={status !== 'ready'}
      comparedWith={q.data?.period ?? null}
      filters={
        <>
          <CategoryFilter value={categoryId} onChange={setCategoryId} />
          <CompareFilter value={compare} onChange={setCompare} />
        </>
      }
    >
      <AsyncStateWrapper
        status={status}
        error={q.error}
        onRetry={() => void q.refetch()}
        skeleton={<ReportSkeleton columns={[tr('ws.reports.cafe.columns.item'), tr('ws.reports.cafe.columns.sold'), tr('ws.reports.cafe.columns.revenue')]} />}
        emptyContent={<EmptyPeriod title={tr('ws.reports.cafe.emptyTitle')} body={tr('ws.reports.cafe.emptyBody')} period={period} today={today} onPick={setPeriod} />}
      >
        {data && (
          <>
            <FigureBand label={tr('ws.reports.nav.cafe')}>
              <HeadlineFigure label={tr('ws.reports.cafe.revenue')} value={money(s?.revenueIqd ?? null, locale)} hint={tr('ws.reports.cafe.revenueHint')} comparison={changeOf(changes, 'revenueIqd')} format={(n) => money(n, locale)} />
              <HeadlineFigure label={tr('ws.reports.cafe.orders')} value={count(s?.orders ?? null, locale)} comparison={changeOf(changes, 'orders')} format={(n) => count(n, locale)} />
              <HeadlineFigure label={tr('ws.reports.cafe.avgOrder')} value={money(s?.avgOrderValueIqd ?? null, locale)} comparison={changeOf(changes, 'avgOrderValueIqd')} format={(n) => money(n, locale)} />
              <HeadlineFigure label={tr('ws.reports.cafe.itemsSold')} value={count(s?.qty ?? null, locale)} comparison={changeOf(changes, 'qty')} format={(n) => count(n, locale)} />
              <HeadlineFigure label={tr('ws.reports.cafe.profit')} value={money(s?.itemsWithCogs ? s.grossProfitIqd : null, locale)} hint={profitHint} />
              <HeadlineFigure
                label={tr('ws.reports.cafe.prep')}
                // No timed tickets is "—", not "0 s".
                value={data.prep?.count ? duration(data.prep.avgSeconds, locale, tr) : '—'}
                hint={data.prep?.count && data.prep.p90Seconds != null ? tr('ws.reports.cafe.prepHint', { p90: duration(data.prep.p90Seconds, locale, tr) }) : undefined}
              />
            </FigureBand>

            <ViewSwitch<View>
              value={view}
              onChange={setView}
              options={VIEWS.map((v) => ({ value: v, label: tr(`ws.reports.cafe.views.${v}`) }))}
              lead={tr(`ws.reports.cafe.lead.${view}`)}
              end={
                view === 'waste' && data.waste.length > 0 ? (
                  <Button size="sm" iconEnd="arrowUpRight" onClick={openWaste}>
                    {tr('ws.reports.cafe.seeWaste')}
                  </Button>
                ) : undefined
              }
            />
            {view === 'items' || view === 'profit' ? (
              data.items.length === 0 ? (
                <EmptyState compact icon="chart" title={tr('ws.reports.cafe.emptyTitle')} />
              ) : (
                <>
                  <TableHint icon="arrowUpRight">{tr('ws.reports.frame.drillHint')}</TableHint>
                  <ReportTable<CafeItemRow> label={tr(`ws.reports.cafe.views.${view}`)} columns={columns[view]} rows={data.items} rowKey={(r) => r.itemId} onRowClick={openItem} />
                </>
              )
            ) : view === 'categories' ? (
              <ReportTable<CafeCategoryRow> label={tr('ws.reports.cafe.views.categories')} columns={columns.categories} rows={data.categories} rowKey={(r) => r.categoryId} />
            ) : data.waste.length === 0 ? (
              <EmptyState compact kind="nothingToDo" title={tr('ws.reports.cafe.noWaste')} />
            ) : (
              <ReportTable<WasteReasonRow> label={tr('ws.reports.cafe.views.waste')} columns={columns.waste} rows={data.waste} rowKey={(r) => r.reason} />
            )}
            <ColumnNotes notes={notes[view].map((k) => tr(k))} />
          </>
        )}
      </AsyncStateWrapper>
      {drill && <DrillDialog request={drill} onClose={() => setDrill(null)} />}
    </ReportFrame>
  );
}

function cafeColumns(tr: Tr, locale: Locale) {
  const name = <T extends { name: { en: string | null; ar: string | null } }>(key: string, header: MessageKey): ReportColumn<T> => ({
    key,
    header: tr(header),
    truncate: true,
    truncateTitle: (r) => nameIn(r.name, locale),
    render: (r) => <bdi>{nameIn(r.name, locale)}</bdi>,
    sort: (r) => nameIn(r.name, locale),
    csv: (r) => nameIn(r.name, locale),
  });
  const n = <T,>(key: keyof T & string, header: MessageKey, fmt: (v: number | null) => string, strong?: boolean): ReportColumn<T> => ({
    key,
    header: tr(header),
    numeric: true,
    render: (r) => <Fig value={r[key] as number | null} text={fmt(r[key] as number | null)} strong={strong} />,
    sort: (r) => r[key] as number | null,
    csv: (r) => r[key] as number | null,
  });
  const m = (v: number | null) => money(v, locale);
  const c = (v: number | null) => count(v, locale);
  const p = (v: number | null) => percent(v, locale, tr);
  const category: ReportColumn<CafeItemRow> = {
    key: 'category',
    header: tr('ws.reports.cafe.columns.category'),
    truncate: true,
    truncateTitle: (r) => nameIn(r.category, locale),
    render: (r) => <bdi style={{ color: 'var(--tp-muted-fg)' }}>{nameIn(r.category, locale)}</bdi>,
    sort: (r) => nameIn(r.category, locale),
    csv: (r) => nameIn(r.category, locale),
  };
  return {
    items: [
      name<CafeItemRow>('item', 'ws.reports.cafe.columns.item'),
      category,
      n<CafeItemRow>('qty', 'ws.reports.cafe.columns.sold', c),
      n<CafeItemRow>('orders', 'ws.reports.cafe.columns.orders', c),
      n<CafeItemRow>('revenueIqd', 'ws.reports.cafe.columns.revenue', m, true),
    ],
    profit: [
      name<CafeItemRow>('item', 'ws.reports.cafe.columns.item'),
      n<CafeItemRow>('revenueIqd', 'ws.reports.cafe.columns.revenue', m),
      n<CafeItemRow>('cogsIqd', 'ws.reports.cafe.columns.cost', m),
      n<CafeItemRow>('grossProfitIqd', 'ws.reports.cafe.columns.profit', m, true),
      n<CafeItemRow>('marginPct', 'ws.reports.cafe.columns.margin', p),
    ],
    categories: [
      name<CafeCategoryRow>('category', 'ws.reports.cafe.columns.category'),
      n<CafeCategoryRow>('items', 'ws.reports.cafe.columns.items', c),
      n<CafeCategoryRow>('qty', 'ws.reports.cafe.columns.sold', c),
      n<CafeCategoryRow>('revenueIqd', 'ws.reports.cafe.columns.revenue', m, true),
      n<CafeCategoryRow>('cogsIqd', 'ws.reports.cafe.columns.cost', m),
      n<CafeCategoryRow>('grossProfitIqd', 'ws.reports.cafe.columns.profit', m),
      n<CafeCategoryRow>('marginPct', 'ws.reports.cafe.columns.margin', p),
    ],
    waste: [
      {
        key: 'reason',
        header: tr('ws.reports.cafe.columns.reason'),
        render: (r) => <bdi>{wasteReasonWords(r.reason, tr)}</bdi>,
        sort: (r) => wasteReasonWords(r.reason, tr),
        // The words, not `wrong_item`: the file says what the screen says.
        csv: (r) => wasteReasonWords(r.reason, tr),
      },
      n<WasteReasonRow>('count', 'ws.reports.cafe.columns.times', c),
      n<WasteReasonRow>('costIqd', 'ws.reports.cafe.columns.cost', m, true),
    ] as ReportColumn<WasteReasonRow>[],
  };
}
