/**
 * On hand (spec 06.28) — the stock module's landing screen.
 *
 * WHY THIS LAYOUT
 *
 * The screen answers two questions, in the order a manager asks them:
 *
 *  1. **Does anything need me?** One list, the stock twin of Today's "Needs
 *     you now": running low, below par, sold past the records, expired,
 *     expiring, unread alerts. Each row has one button that opens exactly those
 *     items — the first three narrow the table below, the rest open the screen
 *     that resolves them. The previous version showed six tiles in two rows
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
 * `?filter=low|belowPar|countNeeded` opens the table already narrowed; the
 * Today screen links to the first two.
 */
import { useRef, useState } from 'react';
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
import { AttentionList, Footnote, IngredientName, KindFilter, matchesKind, useStockFormat, type AttentionItem, type StockKindFilter } from './stockUi';
import {
  isBelowPar,
  isLow,
  matchesName,
  matchesOnHandFilter,
  needsCount,
  onHandStatus,
  parseOnHandFilter,
  type OnHandFilter,
} from './stockLogic';
import { SK, fetchAlertCount, fetchLastCount, fetchOnHand, fetchOpenCount, fetchSummary, type OnHandRow } from './stockKeys';

export { isBelowPar, isLow } from './stockLogic';

export function OnHand() {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { filter?: unknown };
  const [filter, setFilter] = useState<OnHandFilter>(() => parseOnHandFilter(search.filter));
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<StockKindFilter>('all');
  const [open, setOpen] = useState<OnHandRow | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const onHandQ = useQuery({ queryKey: SK.onHand, queryFn: fetchOnHand, refetchInterval: 60_000 });
  const summaryQ = useQuery({ queryKey: SK.summary, queryFn: fetchSummary, refetchInterval: 60_000 });
  const alertCountQ = useQuery({ queryKey: SK.alertCount, queryFn: fetchAlertCount, refetchInterval: 60_000 });
  const lastCountQ = useQuery({ queryKey: SK.lastCount, queryFn: fetchLastCount });
  const openCountQ = useQuery({ queryKey: SK.openCount, queryFn: fetchOpenCount });

  const go = (href: string) => void navigate({ href });
  const active = (onHandQ.data ?? []).filter((r) => r.is_active);
  const hasShopStock = active.some((r) => r.kind === 'retail');
  const rows = active.filter((r) => matchesOnHandFilter(r, filter) && matchesName(r, query) && matchesKind(r.kind, kind));
  const status = asyncStatus(onHandQ, (d) => d.filter((r) => r.is_active).length === 0);

  /** Narrow the table and bring it into view — the button's promise is "show which". */
  function showWhich(next: OnHandFilter) {
    setFilter(next);
    setQuery('');
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const attention: AttentionItem[] = [
    {
      key: 'low',
      count: active.filter(isLow).length,
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
      count: active.filter(isBelowPar).length,
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
      render: (r) => (
        <span dir="ltr" style={{ fontWeight: 700 }}>
          <bdi>{fmt.qty(r.on_hand, r.unit)}</bdi>
        </span>
      ),
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

  const counting = openCountQ.data != null;

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
            <Button kind="primary" icon="box" onClick={() => go('/stock/receive')}>
              {tr('ws.manager.stock.onHand.receive')}
            </Button>
            <Button icon="ban" onClick={() => go('/stock/waste')}>
              {tr('ws.manager.stock.onHand.waste')}
            </Button>
            <Button icon="scale" onClick={() => go('/stock/counts')}>
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
            title={tr('ws.manager.stock.onHand.empty')}
            body={tr('ws.manager.stock.onHand.emptyBody')}
            action={
              <Button kind="primary" icon="plus" onClick={() => go('/stock/ingredients')}>
                {tr('ws.manager.stock.onHand.emptyAction')}
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
              <span style={{ inlineSize: '16rem', maxInlineSize: '100%' }}>
                <SearchField value={query} onChange={setQuery} placeholder={tr('ws.manager.stock.onHand.table.search')} />
              </span>
              <SegmentedControl<OnHandFilter>
                value={filter}
                onChange={setFilter}
                aria-label={tr('ws.manager.stock.onHand.table.show')}
                options={[
                  { value: 'all', label: tr('ws.kit.common.all') },
                  { value: 'low', label: tr('op.stock.status.low') },
                  { value: 'belowPar', label: tr('op.stock.status.belowPar') },
                  { value: 'countNeeded', label: tr('op.stock.status.countNeeded') },
                ]}
              />
              {hasShopStock && <KindFilter value={kind} onChange={setKind} />}
            </Toolbar>
            {rows.length === 0 ? (
              // The shelves are not empty — the search or the filter narrowed
              // them to nothing, so the way out is clearing both (rulebook 9.2).
              <EmptyState
                kind={filter !== 'all' && query.trim() === '' ? 'nothingToDo' : 'filtered'}
                icon={filter !== 'all' && query.trim() === '' ? 'checkCircle' : undefined}
                title={filter !== 'all' && query.trim() === '' ? tr(`ws.manager.stock.onHand.table.none.${filter}`) : undefined}
                onClearFilters={() => {
                  setFilter('all');
                  setQuery('');
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
              <Button kind="ghost" size="sm" onClick={() => go('/stock/counts')} style={{ verticalAlign: 'baseline' }}>
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
      <StatusBadge size="sm" tone={s === 'low' ? 'danger' : 'warn'} label={tr(`op.stock.status.${s}`)} />
      {needsCount(row) && (
        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          <bdi>{tr('ws.manager.stock.onHand.table.recordsSay', { qty: fmt.qty(row.theoretical, row.unit) })}</bdi>
        </span>
      )}
    </span>
  );
}

/** Route alias for the spec name. */
export const StockOverviewScreen = OnHand;
