/**
 * Ingredients master data (SOW L515-518: unit, pack size, cost, supplier,
 * yield %, waste allowance, shelf life, par levels). Writes via
 * app.upsert_ingredient (0063) — unit/kind lock once the ledger has movements.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, card, inputStyle } from '../../components/ui';
import { Switch } from '../../components/Switch';
import { SK, fetchIngredients, type IngredientRow } from './stockKeys';

export function IngredientsAdmin() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<IngredientRow | 'new' | null>(null);

  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const rows = ingredientsQ.data ?? [];

  return (
    <div style={{ maxInlineSize: '46rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ marginBlock: '0.4rem' }}>{tr('op.stock.ingredientsTitle')}</h2>
        <Button kind="primary" onClick={() => setEditing('new')}>
          {tr('op.common.add')}
        </Button>
      </div>

      {rows.map((r) => (
        <div
          key={r.id}
          style={{ ...card, marginBlockEnd: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}
        >
          <div style={{ flex: 1, minInlineSize: 0 }}>
            <strong>{pickName(locale, r)}</strong>{' '}
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: '0.85rem' }}>
              ({r.unit}
              {r.kind === 'prepared' ? ` · ${tr('op.stock.prepared')}` : ''})
              {!r.is_active && ` · ${tr('op.courts.inactive')}`}
            </span>
            <div style={{ color: 'var(--tp-muted-fg)', fontSize: '0.8rem' }}>
              {r.supplier_name ?? '—'}
              {r.pack_size != null && r.pack_cost_iqd != null && (
                <> · {tr('op.stock.packSummary', { size: r.pack_size, unit: r.unit, cost: r.pack_cost_iqd })}</>
              )}
            </div>
          </div>
          <Button onClick={() => setEditing(r)}>{tr('op.common.edit')}</Button>
        </div>
      ))}
      {ingredientsQ.isSuccess && rows.length === 0 && <p style={card}>{tr('op.stock.empty')}</p>}

      {editing && (
        <IngredientForm
          row={editing === 'new' ? null : editing}
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

function numOrNull(v: string): number | null {
  const n = Number(v);
  return v.trim() === '' || Number.isNaN(n) ? null : n;
}

function IngredientForm({
  row,
  onDone,
  onCancel,
}: {
  row: IngredientRow | null;
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
    <div style={{ ...card, marginBlockStart: '0.8rem' }}>
      <h3 style={{ marginBlockStart: 0 }}>
        {row ? tr('op.stock.editIngredient') : tr('op.stock.newIngredient')}
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
        <Field label={tr('op.courts.nameEn')}>
          <input style={inputStyle} value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field label={tr('op.courts.nameAr')}>
          <input style={inputStyle} dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
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
        <Button onClick={onCancel}>{tr('common.back')}</Button>
        <Button
          kind="primary"
          disabled={busy || !nameEn.trim() || !nameAr.trim()}
          onClick={() => void save()}
        >
          {tr('op.common.apply')}
        </Button>
      </div>
    </div>
  );
}
