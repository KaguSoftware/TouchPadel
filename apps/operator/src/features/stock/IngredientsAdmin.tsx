/**
 * Ingredients (spec 06.29 / 06.30): master data — unit, pack size, cost,
 * supplier, yield %, waste allowance, shelf life, par levels. Writes via
 * app.upsert_ingredient (0063) — unit/kind lock once the ledger has movements.
 *
 * On hand is shown in the editor as a figure, not a field: stock is an
 * append-only ledger and changes only through goods in, consumption, waste or
 * a count. The editor says that in one line with the link to count, where the
 * old one stacked a read-only label, a lock badge and an info box saying it.
 *
 * The editor is a dialog: beside the table it squeezed a seven-column list
 * into half the screen at 1100px. Its fourteen fields are grouped by the
 * question each answers (what is it · buying it · how much to keep · recipe
 * maths), and the ones only a manager who set up the system would understand
 * — yield, waste allowance, par, reorder point — say what they do. The unit
 * and type are disabled with the reason once the ingredient has history,
 * instead of failing on save with UNIT_LOCKED.
 */
import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, Modal, inputStyle, Select } from '../../components/ui';
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
import { BilingualFields } from '../../components/inputs';
import { Switch } from '../../components/Switch';
import { IngredientName, useStockFormat } from './stockUi';
import { matchesName, parseQty } from './stockLogic';
import { SK, fetchIngredients, fetchOnHand, type IngredientRow, type OnHandRow } from './stockKeys';

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

function numOrNull(v: string): number | null {
  return parseQty(v);
}

/** Typed, but not a number. Empty is fine: every number here is optional. */
const badNumber = (v: string) => v.trim() !== '' && parseQty(v) === null;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset style={{ border: 'none', margin: 0, padding: 0, marginBlockStart: 'var(--tp-sp-3)' }}>
      <legend style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 600, color: 'var(--tp-muted-fg)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBlockEnd: 'var(--tp-sp-2)', padding: 0 }}>
        {title}
      </legend>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))', columnGap: 'var(--tp-sp-2-5)' }}>{children}</div>
    </fieldset>
  );
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
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [nameEn, setNameEn] = useState(row?.name_en ?? '');
  const [nameAr, setNameAr] = useState(row?.name_ar ?? '');
  const [unit, setUnit] = useState<'g' | 'ml' | 'pc'>(row?.unit ?? 'g');
  const [kind, setKind] = useState<'purchased' | 'prepared'>(row?.kind === 'prepared' ? 'prepared' : 'purchased');
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

  // Unit and type lock server-side once the ledger holds a movement for this
  // ingredient; asking first lets the form say so instead of failing on save.
  const historyQ = useQuery({
    queryKey: SK.movementCheck(row?.id ?? 'new'),
    enabled: !!row,
    queryFn: async () => {
      const { data, error: err } = await supabase.from('stock_movements').select('id').eq('ingredient_id', row!.id).limit(1);
      if (err) throw err;
      return (data ?? []).length > 0;
    },
  });
  const locked = historyQ.data === true;

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

  const numbers = [packSize, packCost, shelfLife, yieldPct, wastePct, par, lowStock];
  const anyBad = numbers.some(badNumber);
  const yieldOut = parseQty(yieldPct) !== null && (parseQty(yieldPct)! <= 0 || parseQty(yieldPct)! > 100);
  const lowAbovePar = parseQty(par) !== null && parseQty(lowStock) !== null && parseQty(lowStock)! > parseQty(par)!;
  const u = fmt.unit(unit);
  const numErr = (v: string) => (badNumber(v) ? tr('ws.manager.stock.ingredients.form.notNumber') : undefined);

  async function close() {
    if (dirty && !(await confirm({
      title: tr('ws.kit.actions.dirtyLeave'),
      body: tr('ws.kit.actions.dirtyLeaveBody'),
      confirmLabel: tr('ws.kit.actions.dirtyLeaveConfirm'),
      cancelLabel: tr('ws.kit.actions.dirtyLeaveCancel'),
      kind: 'danger',
      // Beside "Keep editing", not pushed to the far edge (owner call,
      // 2026-09-23). Rulebook 7.8 spreads a destructive confirm; this one
      // loses only an unsaved draft, never stored data, and Cancel still
      // autofocuses so Enter and Esc both keep the edits.
      pairActions: true,
    }))) return;
    onCancel();
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await appRpc('upsert_ingredient', {
        p_id: row?.id ?? null,
        p_name_en: nameEn.trim(),
        p_name_ar: nameAr.trim(),
        p_unit: unit,
        p_kind: kind,
        p_pack_size: numOrNull(packSize),
        p_pack_cost_iqd: numOrNull(packCost),
        p_supplier_name: supplier.trim() || null,
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

  const disabledReason = !nameEn.trim() || !nameAr.trim() ? tr('ws.manager.disabled.namesRequired') : anyBad || yieldOut ? tr('ws.manager.stock.ingredients.form.fixErrors') : tr('ws.manager.stock.ingredients.form.nothingChanged');

  return (
    <Modal
      title={row ? tr('ws.manager.stock.ingredients.form.editTitle', { name: pickName(locale, row) }) : tr('ws.manager.stock.ingredients.add')}
      subtitle={
        row && onHand ? (
          <span>
            <bdi>{tr('ws.manager.stock.ingredients.form.onHand', { qty: fmt.qty(onHand.on_hand, row.unit) })}</bdi> {tr('ws.manager.stock.ingredients.form.onHandHow')}{' '}
            <Button kind="ghost" size="sm" onClick={() => void navigate({ to: '/stock/counts' })} style={{ verticalAlign: 'baseline' }}>
              {tr('ws.manager.stock.onHand.count')}
            </Button>
          </span>
        ) : undefined
      }
      onClose={() => void close()}
      size="lg"
      footer={
        <>
          <Button onClick={() => void close()} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="check"
            busy={busy}
            disabled={!nameEn.trim() || !nameAr.trim() || anyBad || yieldOut || (!!row && !dirty)}
            disabledReason={disabledReason}
            onClick={() => void save()}
          >
            {tr('ws.manager.stock.ingredients.form.save')}
          </Button>
        </>
      }
    >
      <Section title={tr('ws.manager.stock.ingredients.form.basics')}>
        <div style={{ gridColumn: '1 / -1' }}>
          <BilingualFields labelEn={tr('op.courts.nameEn')} labelAr={tr('op.courts.nameAr')} en={nameEn} ar={nameAr} onEn={setNameEn} onAr={setNameAr} />
        </div>
        <Field label={tr('ws.manager.stock.ingredients.form.unit')} hint={locked ? tr('ws.manager.stock.ingredients.form.locked') : undefined}>
          <Select
            value={unit}
            disabled={locked}
            onChange={(v) => setUnit(v as typeof unit)}
            options={(['g', 'ml', 'pc'] as const).map((u) => ({ value: u, label: tr(`ws.manager.stock.ingredients.form.unitName.${u}`) }))}
          />
        </Field>
        <Field label={tr('ws.manager.stock.ingredients.form.kind')} hint={locked ? tr('ws.manager.stock.ingredients.form.locked') : undefined}>
          <Select
            value={kind}
            disabled={locked}
            onChange={(v) => setKind(v as typeof kind)}
            options={[
              { value: 'purchased', label: tr('ws.manager.stock.ingredients.form.purchased') },
              { value: 'prepared', label: tr('ws.manager.stock.ingredients.form.prepared') },
            ]}
          />
        </Field>
      </Section>

      <Section title={tr('ws.manager.stock.ingredients.form.buying')}>
        <Field label={tr('ws.manager.stock.ingredients.supplier')} optional>
          <input style={inputStyle} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </Field>
        <Field label={tr('ws.manager.stock.ingredients.form.shelfLife')} optional hint={tr('ws.manager.stock.ingredients.form.shelfLifeHint')} error={numErr(shelfLife)}>
          <input style={inputStyle} dir="ltr" inputMode="numeric" value={shelfLife} onChange={(e) => setShelfLife(e.target.value)} />
        </Field>
        <Field label={tr('ws.manager.stock.ingredients.form.packSize', { unit: u })} optional error={numErr(packSize)}>
          <input style={inputStyle} dir="ltr" inputMode="decimal" value={packSize} onChange={(e) => setPackSize(e.target.value)} />
        </Field>
        <Field label={tr('ws.manager.stock.ingredients.form.packCost')} optional hint={tr('ws.manager.stock.ingredients.form.packCostHint')} error={numErr(packCost)}>
          <input style={inputStyle} dir="ltr" inputMode="numeric" value={packCost} onChange={(e) => setPackCost(e.target.value)} />
        </Field>
      </Section>

      <Section title={tr('ws.manager.stock.ingredients.form.levels')}>
        <Field label={tr('ws.manager.stock.ingredients.form.par', { unit: u })} optional hint={tr('ws.manager.stock.ingredients.form.parHint')} error={numErr(par)}>
          <input style={inputStyle} dir="ltr" inputMode="decimal" value={par} onChange={(e) => setPar(e.target.value)} />
        </Field>
        <Field
          label={tr('ws.manager.stock.ingredients.form.low', { unit: u })}
          optional
          hint={lowAbovePar ? <span style={{ color: 'var(--tp-warn-fg)' }}>{tr('ws.manager.stock.ingredients.form.lowAbovePar')}</span> : tr('ws.manager.stock.ingredients.form.lowHint')}
          error={numErr(lowStock)}
        >
          <input style={inputStyle} dir="ltr" inputMode="decimal" value={lowStock} onChange={(e) => setLowStock(e.target.value)} />
        </Field>
      </Section>

      <Section title={tr('ws.manager.stock.ingredients.form.recipeMaths')}>
        <Field label={tr('ws.manager.stock.ingredients.form.yield')} hint={tr('ws.manager.stock.ingredients.form.yieldHint')} error={numErr(yieldPct) ?? (yieldOut ? tr('ws.manager.stock.ingredients.form.yieldRange') : undefined)}>
          <input style={inputStyle} dir="ltr" inputMode="decimal" value={yieldPct} onChange={(e) => setYieldPct(e.target.value)} />
        </Field>
        <Field label={tr('ws.manager.stock.ingredients.form.waste')} hint={tr('ws.manager.stock.ingredients.form.wasteHint')} error={numErr(wastePct)}>
          <input style={inputStyle} dir="ltr" inputMode="decimal" value={wastePct} onChange={(e) => setWastePct(e.target.value)} />
        </Field>
      </Section>

      <div style={{ marginBlockStart: 'var(--tp-sp-3)', display: 'grid', gap: 'var(--tp-sp-1)' }}>
        <Switch checked={active} onChange={setActive} label={tr('ws.manager.stock.ingredients.form.active')} />
        <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.stock.ingredients.form.activeHint')}</span>
      </div>
      <ErrorText error={error} />
    </Modal>
  );
}
