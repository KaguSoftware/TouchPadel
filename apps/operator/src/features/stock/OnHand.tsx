/**
 * Stock overview (spec 06.28) — the manager's stock landing. Headline strip
 * (low / below par / expiring soon / expired / value / last count) over the
 * on-hand table; a row's Ledger button opens its full append-only history
 * (SOW L539 "every movement traceable"). Every figure is a server figure:
 * low/par flags compare the view's own columns, counts are row counts.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDateTime, formatNumber } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { useLocale, pickName } from '../../lib/i18n';
import { Button } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  HeadlineFigure,
  PageHeader,
  ResultCount,
  SegmentedControl,
  StatusBadge,
  TableSkeleton,
  Toolbar,
  asyncStatus,
  type Column,
} from '../../components/kit';
import { LedgerDrawer } from './LedgerDrawer';
import { SK, fetchOnHand, type OnHandRow } from './stockKeys';

type Filter = 'all' | 'low' | 'belowPar';

export function isLow(r: OnHandRow): boolean {
  return r.low_stock_threshold !== null && r.on_hand <= r.low_stock_threshold;
}
export function isBelowPar(r: OnHandRow): boolean {
  return r.par_level !== null && r.on_hand < r.par_level;
}

export function OnHand() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<OnHandRow | null>(null);

  const onHandQ = useQuery({ queryKey: SK.onHand, queryFn: fetchOnHand, refetchInterval: 60_000 });
  const expiringQ = useQuery({
    queryKey: SK.expiring,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_expiring_soon').select('batch_id');
      if (error) throw error;
      return (data ?? []) as { batch_id: string }[];
    },
  });
  const expiredQ = useQuery({
    queryKey: SK.expired,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_expired').select('batch_id');
      if (error) throw error;
      return (data ?? []) as { batch_id: string }[];
    },
  });
  const lastCountQ = useQuery({
    queryKey: [...SK.counts, 'latest'],
    queryFn: async (): Promise<{ finalized_at: string } | null> => {
      const { data, error } = await supabase
        .from('stock_counts')
        .select('finalized_at')
        .not('finalized_at', 'is', null)
        .order('finalized_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as { finalized_at: string } | null;
    },
  });

  const active = (onHandQ.data ?? []).filter((r) => r.is_active);
  const lowRows = active.filter(isLow);
  const belowParRows = active.filter(isBelowPar);
  const rows = filter === 'low' ? lowRows : filter === 'belowPar' ? belowParRows : active;
  const status = asyncStatus(onHandQ, (d) => d.filter((r) => r.is_active).length === 0);
  const go = (href: string) => void navigate({ href });

  const columns: Column<OnHandRow>[] = [
    {
      key: 'ingredient',
      header: tr('op.stock.ingredient'),
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', flexWrap: 'wrap' }}>
          <bdi>{pickName(locale, r)}</bdi>
          <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>({r.unit})</span>
          {r.kind === 'prepared' && <StatusBadge size="sm" tone="neutral" dot={false} label={tr('op.stock.prepared')} />}
        </span>
      ),
    },
    { key: 'onHand', header: tr('op.stock.onHand'), numeric: true, render: (r) => <span style={{ fontWeight: 700 }}>{r.on_hand}</span> },
    { key: 'theoretical', header: tr('op.stock.theoretical'), numeric: true, render: (r) => <span style={{ color: 'var(--tp-muted-fg)' }}>{r.theoretical}</span> },
    { key: 'par', header: tr('op.stock.par'), numeric: true, render: (r) => <span style={{ color: 'var(--tp-muted-fg)' }}>{r.par_level ?? '—'}</span> },
    {
      key: 'status',
      header: tr('ws.manager.stock.overview.status'),
      render: (r) =>
        isLow(r) ? (
          <StatusBadge size="sm" tone="danger" label={tr('op.stock.lowStock')} />
        ) : isBelowPar(r) ? (
          <StatusBadge size="sm" tone="warn" label={tr('op.stock.underPar')} />
        ) : (
          <StatusBadge size="sm" tone="success" label={tr('ws.manager.stock.overview.ok')} />
        ),
    },
    {
      key: 'ledger',
      header: '',
      align: 'end',
      render: (r) => (
        <Button kind="ghost" size="sm" icon="fileText" onClick={() => setOpen(r)}>
          {tr('op.stock.ledger')}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={tr('ws.manager.stock.overview.title')}
        subtitle={tr('ws.manager.stock.overview.lead')}
        actions={
          <>
            <Button icon="package" onClick={() => go('/stock/receive')}>
              {tr('ws.manager.stock.overview.receive')}
            </Button>
            <Button icon="ban" onClick={() => go('/stock/waste')}>
              {tr('ws.manager.stock.overview.waste')}
            </Button>
            <Button kind="primary" icon="scale" onClick={() => go('/stock/counts')}>
              {tr('ws.manager.stock.overview.countNow')}
            </Button>
          </>
        }
      >
        <ResultCount shown={rows.length} total={active.length} />
      </PageHeader>

      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', marginBlockEnd: 'var(--tp-sp-4)' }}>
        <HeadlineFigure
          label={tr('ws.manager.stock.overview.low')}
          value={formatNumber(lowRows.length, locale)}
          tone={lowRows.length > 0 ? 'danger' : 'neutral'}
          busy={onHandQ.isPending}
          drillable
          onDrill={() => setFilter('low')}
        />
        <HeadlineFigure
          label={tr('ws.manager.stock.overview.belowPar')}
          value={formatNumber(belowParRows.length, locale)}
          tone={belowParRows.length > 0 ? 'warn' : 'neutral'}
          busy={onHandQ.isPending}
          drillable
          onDrill={() => setFilter('belowPar')}
        />
        <HeadlineFigure
          label={tr('ws.manager.stock.overview.expiringSoon')}
          value={formatNumber(expiringQ.data?.length ?? 0, locale)}
          tone={(expiringQ.data?.length ?? 0) > 0 ? 'warn' : 'neutral'}
          busy={expiringQ.isPending}
          drillable
          onDrill={() => go('/stock/expiry')}
        />
        <HeadlineFigure
          label={tr('ws.manager.stock.overview.expired')}
          value={formatNumber(expiredQ.data?.length ?? 0, locale)}
          tone={(expiredQ.data?.length ?? 0) > 0 ? 'danger' : 'neutral'}
          busy={expiredQ.isPending}
          drillable
          onDrill={() => go('/stock/expiry')}
        />
        <HeadlineFigure label={tr('ws.manager.stock.overview.value')} value="—" hint={tr('ws.manager.stock.overview.valueUnavailable')} />
        <HeadlineFigure
          label={tr('ws.manager.stock.overview.lastCount')}
          value={
            lastCountQ.data ? (
              <span style={{ fontSize: 'var(--tp-fs-lg)' }}>
                <bdi>{formatDateTime(new Date(lastCountQ.data.finalized_at), locale)}</bdi>
              </span>
            ) : (
              tr('ws.manager.stock.overview.neverCounted')
            )
          }
          busy={lastCountQ.isPending}
          drillable
          onDrill={() => go('/stock/variance')}
        />
      </div>

      <Toolbar>
        <SegmentedControl<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: tr('ws.manager.stock.overview.allRows') },
            { value: 'low', label: tr('op.stock.lowStock') },
            { value: 'belowPar', label: tr('op.stock.belowPar') },
          ]}
        />
      </Toolbar>

      <AsyncStateWrapper
        status={status}
        error={onHandQ.error}
        onRetry={() => void onHandQ.refetch()}
        skeleton={<TableSkeleton columns={columns} />}
        emptyContent={<EmptyState icon="box" title={tr('op.stock.empty')} body={tr('ws.manager.stock.overview.emptyBody')} />}
      >
        {rows.length === 0 ? (
          // The cupboard is not empty — the segment above narrowed it to
          // nothing, so the way out is that filter (rulebook 9.2).
          <EmptyState kind="filtered" onClearFilters={() => setFilter('all')} />
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.ingredient_id} aria-label={tr('op.stock.onHandTitle')} />
        )}
      </AsyncStateWrapper>

      {open && <LedgerDrawer ingredient={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Route alias for the spec name. */
export const StockOverviewScreen = OnHand;
