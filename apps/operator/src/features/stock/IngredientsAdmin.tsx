/**
 * Ingredients (spec 06.29 / 06.30): master data — unit, pack size, cost,
 * supplier, yield %, waste allowance, shelf life, par levels. Writes via
 * app.upsert_ingredient (0063) — unit/kind lock once the ledger has movements.
 * On-hand is shown READ-ONLY in the editor: stock is an append-only ledger and
 * changes only through goods in, consumption, waste or a physical count.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, inputStyle } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  MessagePresenter,
  Money,
  PageHeader,
  Panel,
  SearchField,
  StatusBadge,
  Toolbar,
  asyncStatus,
  type Column,
} from '../../components/kit';
import { BilingualFields } from '../../components/inputs';
import { Switch } from '../../components/Switch';
import { SK, fetchIngredients, fetchOnHand, type IngredientRow, type OnHandRow } from './stockKeys';

export function IngredientsAdmin() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<IngredientRow | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const onHandQ = useQuery({ queryKey: SK.onHand, queryFn: fetchOnHand });
  const onHandOf = useMemo(() => new Map((onHandQ.data ?? []).map((r) => [r.ingredient_id, r])), [onHandQ.data]);

  const q = search.trim().toLowerCase();
  const rows = (ingredientsQ.data ?? [])
    .filter((r) => showInactive || r.is_active)
    .filter((r) => q === '' || r.name_en.toLowerCase().includes(q) || r.name_ar.includes(search.trim()));
  const status = asyncStatus(ingredientsQ, (d) => d.length === 0);

  const columns: Column<IngredientRow>[] = [
    {
      key: 'name',
      header: tr('op.stock.ingredient'),
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap', opacity: r.is_active ? 1 : 0.6 }}>
          <strong>
            <bdi>{pickName(locale, r)}</bdi>
          </strong>
          <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>({r.unit})</span>
          {r.kind === 'prepared' && <StatusBadge size="sm" tone="neutral" dot={false} label={tr('op.stock.prepared')} />}
        </span>
      ),
    },
    { key: 'supplier', header: tr('ws.manager.stock.ingredients.supplier'), render: (r) => <bdi>{r.supplier_name ?? '—'}</bdi> },
    {
      key: 'pack',
      header: tr('ws.manager.stock.ingredients.pack'),
      render: (r) =>
        r.pack_size != null && r.pack_cost_iqd != null ? (
          <span dir="ltr" style={{ fontSize: 'var(--tp-fs-sm)' }}>
            {r.pack_size} {r.unit} · <Money amount={r.pack_cost_iqd} />
          </span>
        ) : (
          '—'
        ),
    },
    { key: 'onHand', header: tr('op.stock.onHand'), numeric: true, render: (r) => onHandOf.get(r.id)?.on_hand ?? '—' },
    { key: 'par', header: tr('ws.manager.stock.ingredients.par'), numeric: true, render: (r) => r.par_level ?? '—' },
    {
      key: 'status',
      header: tr('ws.manager.stock.ingredients.status'),
      render: (r) => <StatusBadge size="sm" tone={r.is_active ? 'success' : 'neutral'} label={r.is_active ? tr('op.courts.active') : tr('op.courts.inactive')} />,
    },
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
        title={tr('op.stock.ingredientsTitle')}
        subtitle={tr('ws.manager.stock.ingredients.lead')}
        actions={
          <Button kind="primary" icon="plus" onClick={() => setEditing('new')}>
            {tr('op.common.add')}
          </Button>
        }
      />
      <Toolbar
        end={<Switch checked={showInactive} onChange={setShowInactive} label={tr('ws.manager.stock.ingredients.inactiveShown')} />}
      >
        <span style={{ inlineSize: '16rem' }}>
          <SearchField value={search} onChange={setSearch} placeholder={tr('ws.manager.stock.ingredients.search')} />
        </span>
      </Toolbar>

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: editing ? 'minmax(0, 1.3fr) minmax(22rem, 1fr)' : '1fr', alignItems: 'start' }}>
        <AsyncStateWrapper
          status={status}
          error={ingredientsQ.error}
          onRetry={() => void ingredientsQ.refetch()}
          emptyContent={
            <EmptyState
              icon="box"
              title={tr('op.stock.empty')}
              body={tr('ws.manager.stock.ingredients.emptyBody')}
              action={
                <Button kind="primary" icon="plus" onClick={() => setEditing('new')}>
                  {tr('op.stock.newIngredient')}
                </Button>
              }
            />
          }
        >
          <DataTable
            dense
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            selectedKey={editing && editing !== 'new' ? editing.id : null}
            onRowClick={(r) => setEditing(r)}
            aria-label={tr('op.stock.ingredientsTitle')}
          />
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
    </div>
  );
}

/** Route alias for the spec name. */
export const IngredientsScreen = IngredientsAdmin;

function numOrNull(v: string): number | null {
  const n = Number(v);
  return v.trim() === '' || Number.isNaN(n) ? null : n;
}

function IngredientForm({
  row,
  onHand,
  onDone,
  onCancel,
}: {
  row: IngredientRow | null;
  onHand: OnHandRow | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { tr } = useLocale();
  const toast = useToast();
  const [nameEn, setNameEn] = useState(row?.name_en ?? '');
  const [nameAr, setNameAr] = useState(row?.name_ar ?? '');
  const [unit, setUnit] = useState<'g' | 'ml' | 'pc'>(row?.unit ?? 'g');
  const [kind, setKind] = useState<'purchased' | 'prepared'>(row?.kind ?? 'purchased');
  const [packSize, setPackSize] = useState(row?.pack_size?.toString() ?? '');
  const [packCost, setPackCost] = useState(row?.pack_cost_iqd?.toString() ?? '');
  const [supplier, setSupplier] = useState(row?.supplier_name ?? '');
  const [shelfLife, setShelfLife] = useState(row?.shelf_life_days?.toString() ?? '');
  const [yieldPct, setYieldPct] = useState(row?.yield_percent?.toString() ?? '100');
  const [wastePct, setWastePct] = useState(row?.waste_allowance_percent?.toString() ?? '0');
  const [par, setPar] = useState(row?.par_level?.toString() ?? '');
  const [lowStock, setLowStock] = useState(row?.low_stock_threshold?.toString() ?? '');
  const [active, setActive] = useState(row?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const dirty =
    nameEn !== (row?.name_en ?? '') ||
    nameAr !== (row?.name_ar ?? '') ||
    unit !== (row?.unit ?? 'g') ||
    kind !== (row?.kind ?? 'purchased') ||
    packSize !== (row?.pack_size?.toString() ?? '') ||
    packCost !== (row?.pack_cost_iqd?.toString() ?? '') ||
    supplier !== (row?.supplier_name ?? '') ||
    shelfLife !== (row?.shelf_life_days?.toString() ?? '') ||
    yieldPct !== (row?.yield_percent?.toString() ?? '100') ||
    wastePct !== (row?.waste_allowance_percent?.toString() ?? '0') ||
    par !== (row?.par_level?.toString() ?? '') ||
    lowStock !== (row?.low_stock_threshold?.toString() ?? '') ||
    active !== (row?.is_active ?? true);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await appRpc('upsert_ingredient', {
        p_id: row?.id ?? null,
        p_name_en: nameEn,
        p_name_ar: nameAr,
        p_unit: unit,
        p_kind: kind,
        p_pack_size: numOrNull(packSize),
        p_pack_cost_iqd: numOrNull(packCost),
        p_supplier_name: supplier || null,
        p_shelf_life_days: numOrNull(shelfLife),
        p_yield_percent: numOrNull(yieldPct) ?? 100,
        p_waste_allowance_percent: numOrNull(wastePct) ?? 0,
        p_par_level: numOrNull(par),
        p_low_stock_threshold: numOrNull(lowStock),
        p_is_active: active,
      });
      toast.ok(tr('op.toast.saved'));
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title={row ? tr('op.stock.editIngredient') : tr('op.stock.newIngredient')}
      actions={dirty ? <StatusBadge size="sm" tone="warn" label={tr('ws.kit.actions.unsaved')} /> : undefined}
    >
      {row && (
        <div style={{ marginBlockEnd: '0.85rem' }}>
          <span style={{ display: 'block', fontSize: 'var(--tp-fs-sm)', fontWeight: 600, marginBlockEnd: '0.3rem' }}>{tr('ws.manager.stock.ingredients.onHandReadOnly')}</span>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--tp-fs-2xl)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }} dir="ltr">
              {onHand ? `${onHand.on_hand} ${row.unit}` : '—'}
            </span>
            <StatusBadge size="sm" tone="neutral" icon="lock" label={tr('ws.kit.common.readOnly')} />
          </div>
          <MessagePresenter tone="info" icon="scale" message={tr('ws.manager.stock.ingredients.onHandHint')} style={{ marginBlockStart: '0.5rem' }} />
        </div>
      )}
      <BilingualFields labelEn={tr('op.courts.nameEn')} labelAr={tr('op.courts.nameAr')} en={nameEn} ar={nameAr} onEn={setNameEn} onAr={setNameAr} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
        <Field label={tr('op.stock.unit')}>
          {/* Locked server-side once the ledger has movements (UNIT_LOCKED). */}
          <select style={inputStyle} value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
            <option value="g">g</option>
            <option value="ml">ml</option>
            <option value="pc">pc</option>
          </select>
        </Field>
        <Field label={tr('op.stock.kind')}>
          <select style={inputStyle} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="purchased">{tr('op.stock.purchased')}</option>
            <option value="prepared">{tr('op.stock.prepared')}</option>
          </select>
        </Field>
        <Field label={tr('op.stock.packSize')}>
          <input style={inputStyle} dir="ltr" inputMode="decimal" value={packSize} onChange={(e) => setPackSize(e.target.value)} />
        </Field>
        <Field label={tr('op.stock.packCost')}>
          <input style={inputStyle} dir="ltr" inputMode="numeric" value={packCost} onChange={(e) => setPackCost(e.target.value)} />
        </Field>
        <Field label={tr('op.stock.supplier')}>
          <input style={inputStyle} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </Field>
        <Field label={tr('op.stock.shelfLife')}>
          <input style={inputStyle} dir="ltr" inputMode="numeric" value={shelfLife} onChange={(e) => setShelfLife(e.target.value)} />
        </Field>
        <Field label={tr('op.stock.yieldPct')}>
          <input style={inputStyle} dir="ltr" inputMode="decimal" value={yieldPct} onChange={(e) => setYieldPct(e.target.value)} />
        </Field>
        <Field label={tr('op.stock.wastePct')}>
          <input style={inputStyle} dir="ltr" inputMode="decimal" value={wastePct} onChange={(e) => setWastePct(e.target.value)} />
        </Field>
        <Field label={tr('op.stock.parLevel')}>
          <input style={inputStyle} dir="ltr" inputMode="decimal" value={par} onChange={(e) => setPar(e.target.value)} />
        </Field>
        <Field label={tr('op.stock.lowThreshold')}>
          <input style={inputStyle} dir="ltr" inputMode="decimal" value={lowStock} onChange={(e) => setLowStock(e.target.value)} />
        </Field>
      </div>
      <div style={{ marginBlock: '0.5rem' }}>
        <Switch checked={active} onChange={setActive} label={tr('op.courts.active')} />
      </div>
      <ErrorText error={error} />
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button onClick={onCancel} disabled={busy}>
          {tr('common.back')}
        </Button>
        <Button kind="primary" icon="check" busy={busy} disabled={!nameEn.trim() || !nameAr.trim()} onClick={() => void save()}>
          {tr('op.common.apply')}
        </Button>
      </div>
    </Panel>
  );
}
