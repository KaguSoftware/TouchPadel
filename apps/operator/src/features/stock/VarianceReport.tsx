/**
 * Count differences (spec 06.36 "variance report") — Module 5's ACCEPTANCE
 * SURFACE (SOW L509-514): what the records said against what was counted,
 * per ingredient, for the period a count closed, with every movement one click
 * away. v_variance_report carries the reconciliation columns; History on each
 * row drills the period's movement ids straight into the ledger.
 *
 * The question on this screen is "what went missing, and is there an
 * explanation?", so:
 *  - the table opens on the ingredients that DIFFERED (most rows of a count
 *    match and used to bury the few that did not), with a one-line summary of
 *    how many differed above it;
 *  - Difference sits right after Counted and says whether it is missing or
 *    extra in words beside the signed quantity, not in colour alone;
 *  - the explaining columns follow under names staff use ("Expected waste",
 *    not "Allowance");
 *  - with no finished count yet, the empty state has the button that starts
 *    one.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDateTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, Select } from '../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, ExportButton, PageHeader, ResultCount, SegmentedControl, TableSkeleton, Toolbar, asyncStatus, type Column } from '../../components/kit';
import { downloadCsv, toCsv } from '../analytics/csv';
import { LedgerDrawer } from './LedgerDrawer';
import { KindFilter, matchesKind, useStockFormat, type StockKindFilter } from './stockUi';
import { SK, fetchIngredients } from './stockKeys';

interface CountOption {
  id: string;
  finalized_at: string;
}

interface VarianceRow {
  count_id: string;
  period_start: string | null;
  period_end: string;
  ingredient_id: string;
  name_en: string;
  name_ar: string;
  unit: string;
  theoretical_qty: number;
  counted_qty: number;
  variance_qty: number;
  sold_qty: number;
  expected_waste_qty: number;
  recorded_waste_qty: number;
  void_qty: number;
  expired_qty: number;
  movement_ids: number[] | null;
}

type Show = 'differed' | 'all';

export function VarianceReport() {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const navigate = useNavigate();
  const [countId, setCountId] = useState('');
  const [show, setShow] = useState<Show>('differed');
  const [kind, setKind] = useState<StockKindFilter>('all');
  // The view carries no kind; the ingredient list says which rows are shop stock.
  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const kindOf = new Map((ingredientsQ.data ?? []).map((i) => [i.id, i.kind]));
  const [drill, setDrill] = useState<VarianceRow | null>(null);

  const countsQ = useQuery({
    queryKey: SK.counts,
    queryFn: async (): Promise<CountOption[]> => {
      const { data, error } = await supabase
        .from('stock_counts')
        .select('id, finalized_at')
        .not('finalized_at', 'is', null)
        .order('finalized_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data as CountOption[];
    },
  });

  const chosen = countId || countsQ.data?.[0]?.id || '';

  const varianceQ = useQuery({
    queryKey: SK.variance(chosen),
    enabled: !!chosen,
    queryFn: async (): Promise<VarianceRow[]> => {
      const { data, error } = await supabase.from('v_variance_report').select('*').eq('count_id', chosen).order('name_en');
      if (error) throw error;
      return data as VarianceRow[];
    },
  });
  const counted = varianceQ.data ?? [];
  const hasShopStock = counted.some((r) => kindOf.get(r.ingredient_id) === 'retail');
  const all = counted.filter((r) => matchesKind(kindOf.get(r.ingredient_id), kind));
  const differed = all.filter((r) => Number(r.variance_qty) !== 0);
  const rows = show === 'differed' ? differed : all;
  const first = all[0];

  const status = countsQ.isSuccess && (countsQ.data?.length ?? 0) === 0 ? 'empty' : asyncStatus(varianceQ, (d) => d.length === 0);

  function exportCsv() {
    const headers = [
      tr('op.stock.ingredient'),
      tr('op.stock.unitLabel'),
      tr('ws.manager.stock.variance.recorded'),
      tr('ws.manager.stock.variance.counted'),
      tr('ws.manager.stock.variance.difference'),
      tr('ws.manager.stock.variance.sold'),
      tr('ws.manager.stock.variance.expectedWaste'),
      tr('ws.manager.stock.variance.waste'),
      tr('ws.manager.stock.variance.voids'),
      tr('ws.manager.stock.variance.expired'),
    ];
    const chosenCount = countsQ.data?.find((c) => c.id === chosen);
    downloadCsv(
      `count-differences-${chosenCount ? chosenCount.finalized_at.slice(0, 10) : 'count'}.csv`,
      toCsv(
        headers,
        rows.map((r) => [pickName(locale, r), fmt.unit(r.unit), r.theoretical_qty, r.counted_qty, r.variance_qty, r.sold_qty, r.expected_waste_qty, r.recorded_waste_qty, r.void_qty, r.expired_qty]),
      ),
    );
  }

  const qty = (r: VarianceRow, v: number) => <bdi>{fmt.qty(v, r.unit)}</bdi>;
  const muted = (r: VarianceRow, v: number) => <bdi style={{ color: Number(v) === 0 ? 'var(--tp-muted-fg)' : undefined }}>{fmt.qty(v, r.unit)}</bdi>;

  const columns: Column<VarianceRow>[] = [
    { key: 'ingredient', header: tr('op.stock.ingredient'), render: (r) => <bdi style={{ fontWeight: 600 }}>{pickName(locale, r)}</bdi> },
    { key: 'recorded', header: tr('ws.manager.stock.variance.recorded'), numeric: true, render: (r) => qty(r, r.theoretical_qty) },
    { key: 'counted', header: tr('ws.manager.stock.variance.counted'), numeric: true, render: (r) => qty(r, r.counted_qty) },
    {
      key: 'difference',
      header: tr('ws.manager.stock.variance.difference'),
      numeric: true,
      render: (r) => {
        const v = Number(r.variance_qty);
        if (v === 0) return <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.stock.variance.matched')}</span>;
        return (
          <span style={{ display: 'grid', justifyItems: 'end' }}>
            <bdi style={{ fontWeight: 700, color: v < 0 ? 'var(--tp-danger-fg)' : 'var(--tp-fg)' }}>{fmt.change(v, r.unit)}</bdi>
            <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{v < 0 ? tr('ws.manager.stock.variance.missing') : tr('ws.manager.stock.variance.extra')}</span>
          </span>
        );
      },
    },
    { key: 'sold', header: tr('ws.manager.stock.variance.sold'), numeric: true, render: (r) => muted(r, r.sold_qty) },
    { key: 'expectedWaste', header: tr('ws.manager.stock.variance.expectedWaste'), numeric: true, render: (r) => muted(r, r.expected_waste_qty) },
    { key: 'waste', header: tr('ws.manager.stock.variance.waste'), numeric: true, render: (r) => muted(r, r.recorded_waste_qty) },
    { key: 'voids', header: tr('ws.manager.stock.variance.voids'), numeric: true, render: (r) => muted(r, r.void_qty) },
    { key: 'expired', header: tr('ws.manager.stock.variance.expired'), numeric: true, render: (r) => muted(r, r.expired_qty) },
    {
      key: 'history',
      header: '',
      align: 'end',
      render: (r) => (
        <Button kind="ghost" size="sm" icon="fileText" onClick={() => setDrill(r)}>
          {tr('ws.manager.stock.ledger.open')}
        </Button>
      ),
    },
  ];

  const period = first
    ? first.period_start
      ? tr('ws.manager.stock.variance.period', { from: formatDateTime(new Date(first.period_start), locale), to: formatDateTime(new Date(first.period_end), locale) })
      : tr('ws.manager.stock.variance.periodFirst', { to: formatDateTime(new Date(first.period_end), locale) })
    : undefined;

  return (
    <div>
      <PageHeader title={tr('op.stockNav.variance')} subtitle={tr('ws.manager.stock.variance.lead')} actions={<ExportButton onExport={exportCsv} disabled={rows.length === 0} />} />

      <AsyncStateWrapper
        status={status}
        error={varianceQ.error ?? countsQ.error}
        onRetry={() => void (countsQ.refetch(), varianceQ.refetch())}
        skeleton={<TableSkeleton columns={columns} />}
        emptyContent={
          <EmptyState
            icon="scale"
            title={tr('ws.manager.stock.variance.noCounts')}
            body={tr('ws.manager.stock.variance.noCountsBody')}
            action={
              <Button kind="primary" icon="scale" onClick={() => void navigate({ to: '/stock/counts' })}>
                {tr('ws.manager.stock.onHand.count')}
              </Button>
            }
          />
        }
      >
        <Toolbar end={<ResultCount shown={rows.length} total={all.length} />}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
            {tr('ws.manager.stock.variance.countOf')}
            <Select
              value={chosen}
              onChange={setCountId}
              aria-label={tr('ws.manager.stock.variance.chooseCount')}
              style={{ inlineSize: 'auto', minInlineSize: '14rem' }}
              options={(countsQ.data ?? []).map((c) => ({ value: c.id, label: formatDateTime(new Date(c.finalized_at), locale) }))}
            />
          </label>
          <SegmentedControl<Show>
            value={show}
            onChange={setShow}
            aria-label={tr('ws.manager.stock.onHand.table.show')}
            options={[
              { value: 'differed', label: tr('ws.manager.stock.variance.onlyDiffered') },
              { value: 'all', label: tr('ws.manager.stock.variance.allIngredients') },
            ]}
          />
          {hasShopStock && <KindFilter value={kind} onChange={setKind} />}
        </Toolbar>

        {varianceQ.isSuccess && (
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2-5)' }}>
            <strong style={{ color: differed.length > 0 ? 'var(--tp-fg)' : 'var(--tp-success-fg)' }}>
              {differed.length > 0
                ? tr('ws.manager.stock.variance.summary', { differed: fmt.num(differed.length), total: fmt.num(all.length) })
                : tr('ws.manager.stock.variance.allMatched')}
            </strong>
            {period && (
              <>
                {' · '}
                <bdi>{period}</bdi>
              </>
            )}
          </p>
        )}

        {rows.length === 0 ? (
          <EmptyState kind="nothingToDo" icon="checkCircle" title={tr('ws.manager.stock.variance.allMatched')} action={<Button size="sm" onClick={() => setShow('all')}>{tr('ws.manager.stock.variance.allIngredients')}</Button>} />
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.ingredient_id} aria-label={tr('op.stockNav.variance')} />
        )}
      </AsyncStateWrapper>

      {drill && <LedgerDrawer ingredient={drill} movementIds={drill.movement_ids ?? []} onClose={() => setDrill(null)} />}
    </div>
  );
}

/** Route alias for the spec name. */
export const VarianceReportScreen = VarianceReport;
