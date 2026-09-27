/**
 * Ingredients (spec 06.29 / 06.30): master data — unit, pack size, cost,
 * supplier, yield %, waste allowance, shelf life, par levels. The row editor
 * is `IngredientForm`, in its own module to keep this one to the table.
 *
 * The editor is a dialog: beside the table it squeezed a seven-column list
 * into half the screen at 1100px.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, pickName } from '../../lib/i18n';
import { Button } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  ResultCount,
  SearchField,
  StatusBadge,
  TableSkeleton,
  Toolbar,
  asyncStatus,
  type Column,
} from '../../components/kit';
import { Switch } from '../../components/Switch';
import { IngredientForm } from './IngredientForm';
import { IngredientName, useStockFormat } from './stockUi';
import { matchesName } from './stockLogic';
import { SK, fetchIngredients, fetchOnHand, type IngredientRow } from './stockKeys';

export function IngredientsAdmin() {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<IngredientRow | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const onHandQ = useQuery({ queryKey: SK.onHand, queryFn: fetchOnHand });
  const onHandOf = new Map((onHandQ.data ?? []).map((r) => [r.ingredient_id, r]));

  // Touch Shop stock rows (kind 'retail') are managed with their product, under Products.
  const all = (ingredientsQ.data ?? []).filter((r) => r.kind !== 'retail');
  const inactiveCount = all.filter((r) => !r.is_active).length;
  const rows = all.filter((r) => (showInactive || r.is_active) && matchesName(r, search));
  const status = asyncStatus(ingredientsQ, (d) => d.length === 0);

  const columns: Column<IngredientRow>[] = [
    {
      key: 'name',
      header: tr('op.stock.ingredient'),
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', flexWrap: 'wrap' }}>
          <IngredientName name={pickName(locale, r)} prepared={r.kind === 'prepared'} strong />
          {!r.is_active && <StatusBadge size="sm" tone="neutral" label={tr('ws.manager.stock.ingredients.inactive')} />}
        </span>
      ),
    },
    { key: 'supplier', header: tr('ws.manager.stock.ingredients.supplier'), truncate: true, truncateTitle: (r) => r.supplier_name ?? '', render: (r) => (r.supplier_name ? <bdi>{r.supplier_name}</bdi> : '—') },
    {
      key: 'pack',
      header: tr('ws.manager.stock.ingredients.pack'),
      render: (r) =>
        r.pack_size != null && r.pack_cost_iqd != null ? (
          <span style={{ display: 'grid', fontSize: 'var(--tp-fs-sm)' }}>
            <bdi>{fmt.qty(r.pack_size, r.unit)}</bdi>
            <Money amount={r.pack_cost_iqd} style={{ color: 'var(--tp-muted-fg)' }} />
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'onHand',
      header: tr('ws.manager.stock.onHand.table.onHand'),
      numeric: true,
      render: (r) => {
        const oh = onHandOf.get(r.id);
        return oh ? <bdi>{fmt.qty(oh.on_hand, r.unit)}</bdi> : '—';
      },
    },
    { key: 'par', header: tr('ws.manager.stock.onHand.table.par'), numeric: true, render: (r) => (r.par_level === null ? '—' : <bdi>{fmt.qty(r.par_level, r.unit)}</bdi>) },
    {
      key: 'edit',
      header: '',
      align: 'end',
      render: (r) => (
        <Button size="sm" kind="ghost" icon="note" onClick={() => setEditing(r)}>
          {tr('op.common.edit')}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={tr('op.stockNav.ingredients')}
        subtitle={tr('ws.manager.stock.ingredients.lead')}
        actions={
          <Button kind="primary" icon="plus" onClick={() => setEditing('new')}>
            {tr('ws.manager.stock.ingredients.add')}
          </Button>
        }
      />
      <AsyncStateWrapper
        status={status}
        error={ingredientsQ.error}
        onRetry={() => void ingredientsQ.refetch()}
        skeleton={<TableSkeleton columns={columns} />}
        emptyContent={
          <EmptyState
            icon="box"
            title={tr('ws.manager.stock.ingredients.empty')}
            body={tr('ws.manager.stock.ingredients.emptyBody')}
            action={
              <Button kind="primary" icon="plus" onClick={() => setEditing('new')}>
                {tr('ws.manager.stock.ingredients.add')}
              </Button>
            }
          />
        }
      >
        <Toolbar end={<ResultCount shown={rows.length} total={all.length} />}>
          <span style={{ inlineSize: '16rem', maxInlineSize: '100%' }}>
            <SearchField value={search} onChange={setSearch} placeholder={tr('ws.manager.stock.onHand.table.search')} />
          </span>
          {inactiveCount > 0 && (
            <Switch checked={showInactive} onChange={setShowInactive} label={tr('ws.manager.stock.ingredients.showInactive', { count: fmt.num(inactiveCount) })} />
          )}
        </Toolbar>
        {rows.length === 0 ? (
          <EmptyState
            kind="filtered"
            onClearFilters={() => {
              setSearch('');
              setShowInactive(false);
            }}
          />
        ) : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={(r) => setEditing(r)} aria-label={tr('op.stockNav.ingredients')} />
        )}
      </AsyncStateWrapper>

      {editing && (
        <IngredientForm
          key={editing === 'new' ? 'new' : editing.id}
          row={editing === 'new' ? null : editing}
          onHand={editing === 'new' ? null : (onHandOf.get(editing.id) ?? null)}
          onDone={() => {
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: ['stock'] });
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Route alias for the spec name. */
export const IngredientsScreen = IngredientsAdmin;
