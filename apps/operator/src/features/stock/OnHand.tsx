/**
 * On hand (spec 06.28) — the stock module's landing screen.
 *
 * WHY THIS LAYOUT
 *
 * The screen answers two questions, in the order a manager asks them:
 *
 *  1. **Does anything need me?** One list, the stock twin of Today's "Needs
 *     you now": out of stock, running low, below par, sold past the records,
 *     expired, expiring, unread alerts. Each row has one button that opens
 *     exactly those items — the four the table can show narrow it, the rest
 *     open the screen that resolves them. Out of stock leads because an empty
 *     shelf is already costing sales, not about to. The previous version showed six tiles in two rows
 *     (one orphaned), one of which was a permanent "Stock value — not reported
 *     by the server" even though report_stock has always returned it.
 *  2. **What do we have?** The table, searchable, one status per row. The
 *     "Theoretical" column is gone: it equalled On hand on every row except
 *     the ones sold past their records, and those now say "Count needed" in
 *     words, with the recorded figure beside it.
 *
 * The page subtitle is the situation (what the stock is worth, when it was
 * last counted), not a description of the screen. The append-only rule is
 * explained exactly once, under the table, where someone looking for an
 * editable number ends up.
 *
 * `?filter=out|low|belowPar|countNeeded` opens the table already narrowed; the
 * Today screen links to `low` and `belowPar`.
 *
 * Wave 5 (wave5-addendum-2026-09-25 §2.8, §5.2): the venue has a cafe store
 * and a bakery store. On hand stays the venue total, because what can be sold
 * and what is running low are venue-wide (D3); under it, once the bakery store
 * holds any of it, a quiet line says where it is ("Cafe store 1.5 kg · Bakery
 * store 500 g"), and a Store filter narrows the table to what one store holds.
 * Needs attention gains counts from the phone waiting to be applied and staff
 * additions with no cost.
 */
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { formatDate } from '@touch/i18n';
import { useLocale, pickName } from '../../lib/i18n';
import { Button } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  Panel,
  ResultCount,
  SearchField,
  SegmentedControl,
  StatusBadge,
  TableSkeleton,
  Toolbar,
  asyncStatus,
  type Column,
} from '../../components/kit';
import { CardTitle } from '../ops/OpsVisuals';
import { LedgerDrawer } from './LedgerDrawer';
import { AttentionList, Footnote, IngredientName, useStockFormat, type AttentionItem } from './stockUi';
import { anyInBakery, heldAt, inScope, phoneCountsWaiting, splitByStore, splitWorthShowing, type StockLocation, type StoreSplit } from './storeLogic';
import { useStockScope } from './stockScope';
import {
  matchesName,
  matchesOnHandFilter,
  needsCount,
  onHandStatus,
  parseOnHandFilter,
  stockLevel,
  type OnHandFilter,
  type StockLevel,
} from './stockLogic';
import { SK, fetchAlertCount, fetchByStore, fetchLastCount, fetchNeedsCostCount, fetchOnHand, fetchSummary, fetchUnfinishedCounts, type OnHandRow } from './stockKeys';

export { isBelowPar, isLow, isOut, stockLevel } from './stockLogic';

export function OnHand() {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { filter?: unknown };
  const [filter, setFilter] = useState<OnHandFilter>(() => parseOnHandFilter(search.filter));
  const [query, setQuery] = useState('');
  const [store, setStore] = useState<StockLocation | 'all'>('all');
  // 0245: the café's page keeps café and bakery stock, the shop desk's the shop's.
  // The stock value, alerts and costing are management's reads, not the shop desk's.
  const scope = useStockScope();
  const venue = scope === 'venue';
  const [open, setOpen] = useState<OnHandRow | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const onHandQ = useQuery({ queryKey: SK.onHand, queryFn: fetchOnHand, refetchInterval: 60_000 });
  const summaryQ = useQuery({ queryKey: SK.summary, queryFn: fetchSummary, refetchInterval: 60_000, enabled: venue });
  const alertCountQ = useQuery({ queryKey: SK.alertCount, queryFn: fetchAlertCount, refetchInterval: 60_000, enabled: venue });
  const lastCountQ = useQuery({ queryKey: SK.lastCount, queryFn: () => fetchLastCount() });
  const countsQ = useQuery({ queryKey: SK.unfinishedCounts, queryFn: fetchUnfinishedCounts, refetchInterval: 60_000 });
  const byStoreQ = useQuery({ queryKey: SK.byStore, queryFn: fetchByStore, refetchInterval: 60_000 });
  const needsCostQ = useQuery({ queryKey: SK.needsCost, queryFn: fetchNeedsCostCount, refetchInterval: 60_000, enabled: venue });
  const splits = useMemo(() => splitByStore(byStoreQ.data ?? []), [byStoreQ.data]);
  const twoStores = scope === 'venue' && anyInBakery(splits);

  const go = (href: string) => void navigate({ href });
  // Goods in and counts open the scope's own page: shop staff cannot open /stock.
  const receiveTo = venue ? '/stock/receive' : '/shop/receive';
  const countsTo = venue ? '/stock/counts' : '/shop/counts';
  // Nothing in stock yet: the café adds ingredients, the shop desk products
  // (each shop size keeps its own stock row).
  const emptyTo = venue ? '/stock/ingredients' : '/shop/products';
  const active = (onHandQ.data ?? []).filter((r) => r.is_active && inScope(r.kind, scope));
  const inStore = (r: OnHandRow) => store === 'all' || !twoStores || heldAt(splits.get(r.ingredient_id), store) > 0;
  const rows = active.filter((r) => matchesOnHandFilter(r, filter) && matchesName(r, query) && inStore(r));
  const status = asyncStatus(onHandQ, (d) => d.filter((r) => r.is_active && inScope(r.kind, scope)).length === 0);

  /** Narrow the table and bring it into view — the button's promise is "show which". */
  function showWhich(next: OnHandFilter) {
    setFilter(next);
    setQuery('');
    setStore('all');
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Counted by the rung each row is on, never by the raw predicates: an empty
  // shelf is under its reorder point AND under par, so asking those separately
  // reports the same ingredient in three rows of this list at once.
  const atLevel = (level: StockLevel) => active.filter((r) => stockLevel(r) === level).length;

  const attention: AttentionItem[] = [
    {
      key: 'out',
      count: atLevel('out'),
      tone: 'danger',
      title: tr('ws.manager.stock.onHand.now.out'),
      hint: tr('ws.manager.stock.onHand.now.outHint'),
      action: { label: tr('ws.manager.stock.onHand.now.showWhich'), onClick: () => showWhich('out') },
    },
    {
      key: 'low',
      count: atLevel('low'),
      tone: 'danger',
      title: tr('ws.manager.stock.onHand.now.low'),
      hint: tr('ws.manager.stock.onHand.now.lowHint'),
      action: { label: tr('ws.manager.stock.onHand.now.showWhich'), onClick: () => showWhich('low') },
    },
    {
      key: 'expired',
      count: summaryQ.data?.expired.length ?? 0,
      tone: 'danger',
      title: tr('ws.manager.stock.onHand.now.expired'),
      hint: tr('ws.manager.stock.onHand.now.expiredHint'),
      action: { label: tr('ws.manager.stock.onHand.now.openExpiry'), onClick: () => go('/stock/expiry') },
    },
    {
      key: 'countNeeded',
      count: active.filter(needsCount).length,
      tone: 'warn',
      title: tr('ws.manager.stock.onHand.now.countNeeded'),
      hint: tr('ws.manager.stock.onHand.now.countNeededHint'),
      action: { label: tr('ws.manager.stock.onHand.now.showWhich'), onClick: () => showWhich('countNeeded') },
    },
    {
      key: 'belowPar',
      count: atLevel('belowPar'),
      tone: 'warn',
      title: tr('ws.manager.stock.onHand.now.belowPar'),
      hint: tr('ws.manager.stock.onHand.now.belowParHint'),
      action: { label: tr('ws.manager.stock.onHand.now.showWhich'), onClick: () => showWhich('belowPar') },
    },
    {
      key: 'expiringSoon',
      count: summaryQ.data?.expiringSoon.length ?? 0,
      tone: 'warn',
      title: tr('ws.manager.stock.onHand.now.expiringSoon'),
      hint: tr('ws.manager.stock.onHand.now.expiringSoonHint'),
      action: { label: tr('ws.manager.stock.onHand.now.openExpiry'), onClick: () => go('/stock/expiry') },
    },
    {
      key: 'phoneCounts',
      count: phoneCountsWaiting(countsQ.data).length,
      tone: 'warn',
      title: tr('ws.stores.onHand.now.phoneCounts'),
      hint: tr('ws.stores.onHand.now.phoneCountsHint'),
      action: { label: tr('ws.stores.onHand.now.openCounts'), onClick: () => go(countsTo) },
    },
    {
      key: 'needsCost',
      count: needsCostQ.data ?? 0,
      tone: 'warn',
      title: tr('ws.stores.onHand.now.needsCost'),
      hint: tr('ws.stores.onHand.now.needsCostHint'),
      action: { label: tr('ws.stores.onHand.now.openGoodsIn'), onClick: () => go(receiveTo) },
    },
    {
      key: 'alerts',
      count: alertCountQ.data ?? 0,
      tone: 'warn',
      title: tr('ws.manager.stock.onHand.now.alerts'),
      hint: tr('ws.manager.stock.onHand.now.alertsHint'),
      action: { label: tr('ws.manager.stock.onHand.now.openAlerts'), onClick: () => go('/stock/alerts') },
    },
  ];

  // The situation, not a description: what the shelves are worth and how
  // recently anyone checked them. A figure that did not arrive is left out.
  const lastCount = lastCountQ.data?.finalized_at;
  const subtitleParts = [
    summaryQ.data?.stockValueIqd != null ? (
      <span key="value">
        {tr('ws.manager.stock.onHand.worth')} <Money amount={summaryQ.data.stockValueIqd} strong />
      </span>
    ) : null,
    lastCountQ.isSuccess ? (
      <span key="count">
        {lastCount ? tr('ws.manager.stock.onHand.lastCount', { date: formatDate(new Date(lastCount), locale) }) : tr('ws.manager.stock.onHand.neverCounted')}
      </span>
    ) : null,
  ].filter(Boolean);

  const columns: Column<OnHandRow>[] = [
    {
      key: 'ingredient',
      header: tr('op.stock.ingredient'),
      render: (r) => <IngredientName name={pickName(locale, r)} prepared={r.kind === 'prepared'} />,
    },
    {
      key: 'onHand',
      header: tr('ws.manager.stock.onHand.table.onHand'),
      numeric: true,
      render: (r) => {
        const split = splits.get(r.ingredient_id);
        return (
          <span style={{ display: 'grid', justifyItems: 'end' }}>
            <span dir="ltr" style={{ fontWeight: 700 }}>
              <bdi>{fmt.qty(r.on_hand, r.unit)}</bdi>
            </span>
            {splitWorthShowing(split) && <StoreSplitLine split={split!} unit={r.unit} />}
          </span>
        );
      },
    },
    {
      key: 'par',
      header: tr('ws.manager.stock.onHand.table.par'),
      numeric: true,
      render: (r) => <span style={{ color: 'var(--tp-muted-fg)' }}>{r.par_level === null ? '—' : <bdi>{fmt.qty(r.par_level, r.unit)}</bdi>}</span>,
    },
    {
      key: 'status',
      header: tr('ws.manager.stock.onHand.table.status'),
      render: (r) => <RowStatus row={r} />,
    },
    {
      key: 'history',
      header: '',
      align: 'end',
      render: (r) => (
        <Button kind="ghost" size="sm" icon="fileText" onClick={() => setOpen(r)}>
          {tr('ws.manager.stock.ledger.open')}
        </Button>
      ),
    },
  ];

  const counting = (countsQ.data ?? []).some((c) => c.source === 'operator');

  return (
    <div>
      <PageHeader
        title={tr('op.stockNav.onHand')}
        subtitle={
          subtitleParts.length > 0 ? (
            <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
              {subtitleParts.map((p, i) => (
                <span key={i} style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)' }}>
                  {i > 0 && <span aria-hidden="true">·</span>}
                  {p}
                </span>
              ))}
            </span>
          ) : undefined
        }
        actions={
          <>
            <Button kind="primary" icon="box" onClick={() => go(receiveTo)}>
              {tr('ws.manager.stock.onHand.receive')}
            </Button>
            {/* The shop desk has no Waste page (2026-10-08): the café's only. */}
            {venue && (
              <Button icon="ban" onClick={() => go('/stock/waste')}>
                {tr('ws.manager.stock.onHand.waste')}
              </Button>
            )}
            <Button icon="scale" onClick={() => go(countsTo)}>
              {counting ? tr('ws.manager.stock.onHand.continueCount') : tr('ws.manager.stock.onHand.count')}
            </Button>
          </>
        }
      />

      <AsyncStateWrapper
        status={status}
        error={onHandQ.error}
        onRetry={() => void onHandQ.refetch()}
        skeleton={<TableSkeleton columns={columns} />}
        emptyContent={
          <EmptyState
            icon="box"
            title={tr(venue ? 'ws.manager.stock.onHand.empty' : 'ws.shop.stock.empty')}
            body={tr(venue ? 'ws.manager.stock.onHand.emptyBody' : 'ws.shop.stock.emptyBody')}
            action={
              <Button kind="primary" icon={venue ? 'plus' : 'tag'} onClick={() => go(emptyTo)}>
                {tr(venue ? 'ws.manager.stock.onHand.emptyAction' : 'ws.shop.till.openProducts')}
              </Button>
            }
          />
        }
      >
        <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
          <Panel title={<CardTitle icon="alert">{tr('ws.manager.stock.onHand.now.title')}</CardTitle>}>
            <AttentionList items={attention} clear={tr('ws.manager.stock.onHand.now.clear')} />
          </Panel>

          <div ref={tableRef} style={{ scrollMarginBlockStart: 'var(--tp-sp-4)' }}>
            <Toolbar end={<ResultCount shown={rows.length} total={active.length} />}>
              <SegmentedControl<OnHandFilter>
                value={filter}
                onChange={setFilter}
                aria-label={tr('ws.manager.stock.onHand.table.show')}
                options={[
                  { value: 'all', label: tr('ws.kit.common.all') },
                  { value: 'out', label: tr('op.stock.status.out') },
                  { value: 'low', label: tr('op.stock.status.low') },
                  { value: 'belowPar', label: tr('op.stock.status.belowPar') },
                  { value: 'countNeeded', label: tr('op.stock.status.countNeeded') },
                ]}
              />
              <span style={{ inlineSize: '16rem', maxInlineSize: '100%' }}>
                <SearchField value={query} onChange={setQuery} placeholder={tr('ws.manager.stock.onHand.table.search')} />
              </span>
              {twoStores && (
                // A visible name, so the stores never read as the item-kind
                // control beside it (Café / Shop is what an item is; this is where it sits).
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
                  <span id="onhand-store-label" style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-muted-fg)' }}>
                    {tr('ws.stores.onHand.storeFilter')}
                  </span>
                  <SegmentedControl<StockLocation | 'all'>
                    value={store}
                    onChange={setStore}
                    aria-labelledby="onhand-store-label"
                    options={[
                      { value: 'all', label: tr('ws.stores.onHand.bothStores') },
                      { value: 'cafe', label: tr('work.store.cafe') },
                      { value: 'bakery', label: tr('work.store.bakery') },
                    ]}
                  />
                </span>
              )}
            </Toolbar>
            {rows.length === 0 ? (
              // The shelves are not empty — the search or the filter narrowed
              // them to nothing, so the way out is clearing both (rulebook 9.2).
              <EmptyState
                kind={filter !== 'all' && query.trim() === '' && store === 'all' ? 'nothingToDo' : 'filtered'}
                icon={filter !== 'all' && query.trim() === '' && store === 'all' ? 'checkCircle' : undefined}
                title={filter !== 'all' && query.trim() === '' && store === 'all' ? tr(`ws.manager.stock.onHand.table.none.${filter}`) : undefined}
                onClearFilters={() => {
                  setFilter('all');
                  setQuery('');
                  setStore('all');
                }}
              />
            ) : (
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(r) => r.ingredient_id}
                onRowClick={(r) => setOpen(r)}
                aria-label={tr('op.stockNav.onHand')}
              />
            )}
            <Footnote style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
              {tr('ws.manager.stock.onHand.howStockMoves')}{' '}
              <Button kind="ghost" size="sm" onClick={() => go(countsTo)} style={{ verticalAlign: 'baseline' }}>
                {counting ? tr('ws.manager.stock.onHand.continueCount') : tr('ws.manager.stock.onHand.count')}
              </Button>
            </Footnote>
          </div>
        </div>
      </AsyncStateWrapper>

      {open && <LedgerDrawer ingredient={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/**
 * One status per row, in words. A healthy row prints a quiet "OK" rather than
 * ninety green badges, so colour only ever marks a problem.
 */
function RowStatus({ row }: { row: OnHandRow }) {
  const { tr } = useLocale();
  const fmt = useStockFormat();
  const s = onHandStatus(row);
  if (s === 'ok') return <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('op.stock.status.ok')}</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', flexWrap: 'wrap' }}>
      <StatusBadge size="sm" tone={s === 'out' || s === 'low' ? 'danger' : 'warn'} label={tr(`op.stock.status.${s}`)} />
      {needsCount(row) && (
        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          <bdi>{tr('ws.manager.stock.onHand.table.recordsSay', { qty: fmt.qty(row.theoretical, row.unit) })}</bdi>
        </span>
      )}
    </span>
  );
}

/**
 * Where the venue total sits, under it: "Cafe store 1.5 kg · Bakery store
 * 500 g", a store with none left out. Shown only once the bakery store holds
 * some of it (splitWorthShowing).
 */
function StoreSplitLine({ split, unit }: { split: StoreSplit; unit: string }) {
  const { tr } = useLocale();
  const fmt = useStockFormat();
  const parts = (['cafe', 'bakery'] as const).filter((s) => split[s] > 0).map((s) => tr(`ws.stores.onHand.split.${s}`, { qty: fmt.qty(split[s], unit) }));
  return (
    <bdi data-testid="store-split" style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', fontWeight: 400, whiteSpace: 'nowrap' }}>
      {parts.join(' · ')}
    </bdi>
  );
}

/** Route alias for the spec name. */
export const StockOverviewScreen = OnHand;
