/**
 * Variance report (spec 06.36) — Module 5's ACCEPTANCE SURFACE (SOW
 * L509-514): theoretical against counted per ingredient for the period a
 * count closed, with every movement one click away. v_variance_report carries
 * the reconciliation columns; the Movements button on each row drills the
 * period's movement ids straight into the ledger.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, Select } from '../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, ExportButton, FilterChips, PageHeader, ResultCount, TableSkeleton, Toolbar, asyncStatus, type Column } from '../../components/kit';
import { Switch } from '../../components/Switch';
import { downloadCsv, toCsv } from '../analytics/csv';
import { LedgerDrawer } from './LedgerDrawer';
import { SK } from './stockKeys';

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

export function VarianceReport() {
  const { tr, locale } = useLocale();
  const [countId, setCountId] = useState('');
  const [onlyVariance, setOnlyVariance] = useState(false);
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
  const all = varianceQ.data ?? [];
  const rows = onlyVariance ? all.filter((r) => r.variance_qty !== 0) : all;
  const first = all[0];

  const status = countsQ.isSuccess && (countsQ.data?.length ?? 0) === 0 ? 'empty' : asyncStatus(varianceQ, (d) => d.length === 0);

  function exportCsv() {
    const headers = [
      tr('op.stock.ingredient'),
      tr('op.stock.unit'),
      tr('op.stock.theoretical'),
      tr('op.stock.counted'),
      tr('op.stock.variance'),
      tr('op.stock.sold'),
      tr('op.stock.expectedWaste'),
      tr('op.stock.recordedWaste'),
      tr('op.stock.voids'),
      tr('op.stock.expired'),
    ];
    downloadCsv(
      `variance-${chosen.slice(0, 8)}.csv`,
      toCsv(
        headers,
        rows.map((r) => [r.name_en, r.unit, r.theoretical_qty, r.counted_qty, r.variance_qty, r.sold_qty, r.expected_waste_qty, r.recorded_waste_qty, r.void_qty, r.expired_qty]),
      ),
    );
  }

  const num = (v: number) => <span>{v}</span>;
  const columns: Column<VarianceRow>[] = [
    {
      key: 'ingredient',
      header: tr('op.stock.ingredient'),
      render: (r) => (
        <span>
          <bdi>{pickName(locale, r)}</bdi> <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>({r.unit})</span>
        </span>
      ),
    },
    { key: 'theoretical', header: tr('op.stock.theoretical'), numeric: true, render: (r) => num(r.theoretical_qty) },
    { key: 'counted', header: tr('op.stock.counted'), numeric: true, render: (r) => num(r.counted_qty) },
    {
      key: 'variance',
      header: tr('op.stock.variance'),
      numeric: true,
      render: (r) => (
        <span style={{ fontWeight: 700, color: r.variance_qty < 0 ? 'var(--tp-danger-fg)' : r.variance_qty > 0 ? 'var(--tp-success-fg)' : 'inherit' }}>
          {r.variance_qty > 0 ? '+' : ''}
          {r.variance_qty}
        </span>
      ),
    },
    { key: 'sold', header: tr('op.stock.sold'), numeric: true, render: (r) => num(r.sold_qty) },
    { key: 'allowance', header: tr('op.stock.expectedWaste'), numeric: true, render: (r) => num(r.expected_waste_qty) },
    { key: 'waste', header: tr('op.stock.recordedWaste'), numeric: true, render: (r) => num(r.recorded_waste_qty) },
    { key: 'voids', header: tr('op.stock.voids'), numeric: true, render: (r) => num(r.void_qty) },
    { key: 'expired', header: tr('op.stock.expired'), numeric: true, render: (r) => num(r.expired_qty) },
    {
      key: 'movements',
      header: '',
      align: 'end',
      render: (r) => (
        <Button kind="ghost" size="sm" icon="fileText" onClick={() => setDrill(r)}>
          {tr('op.stock.movements')}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={tr('op.stock.varianceTitle')}
        subtitle={tr('ws.manager.stock.variance.lead')}
        actions={<ExportButton onExport={exportCsv} disabled={rows.length === 0} />}
      >
        <ResultCount shown={rows.length} total={all.length} />
      </PageHeader>
      <Toolbar end={<Switch checked={onlyVariance} onChange={setOnlyVariance} label={tr('ws.manager.stock.variance.onlyVariance')} />}>
        <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>{tr('ws.manager.stock.variance.count')}</span>
        <Select
          value={chosen}
          onChange={setCountId}
          aria-label={tr('ws.manager.stock.variance.chooseCount')}
          style={{ inlineSize: 'auto', minInlineSize: '14rem' }}
          options={(countsQ.data ?? []).map((c) => ({ value: c.id, label: formatDateTime(new Date(c.finalized_at), locale) }))}
        />
        {first && (
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
            <bdi>
              {tr('op.stock.period', {
                from: first.period_start ? formatDateTime(new Date(first.period_start), locale) : '—',
                to: formatDateTime(new Date(first.period_end), locale),
              })}
            </bdi>
          </span>
        )}
      </Toolbar>
      {/* The switch is at the far end of the toolbar; the chip is where the
          rows are, which is where the reader notices the shortfall (6.6). */}
      <FilterChips
        chips={onlyVariance ? [{ id: 'variance', label: tr('ws.manager.stock.variance.onlyVariance'), text: tr('ws.manager.stock.variance.onlyVariance'), onRemove: () => setOnlyVariance(false) }] : []}
        onClearAll={() => setOnlyVariance(false)}
        style={{ marginBlockEnd: 'var(--tp-sp-2-5)' }}
      />

      <AsyncStateWrapper
        status={status}
        error={varianceQ.error ?? countsQ.error}
        onRetry={() => void (countsQ.refetch(), varianceQ.refetch())}
        skeleton={<TableSkeleton columns={columns} />}
        emptyContent={<EmptyState icon="scale" title={tr('op.stock.noCounts')} body={tr('ws.manager.stock.variance.noCountsBody')} />}
      >
        {rows.length === 0 ? (
          <EmptyState kind="filtered" onClearFilters={() => setOnlyVariance(false)} />
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.ingredient_id} aria-label={tr('op.stock.varianceTitle')} />
        )}
      </AsyncStateWrapper>

      {drill && <LedgerDrawer ingredient={drill} movementIds={drill.movement_ids ?? []} onClose={() => setDrill(null)} />}
    </div>
  );
}

/** Route alias for the spec name. */
export const VarianceReportScreen = VarianceReport;
