/**
 * Waste entry (spec 06.34) + sub-recipe production runs.
 *
 * The reason list is the FIXED set: spill · spoilage · void after send ·
 * expired write-off. Only the first two are entered here (app.record_waste
 * accepts waste_spill / waste_spoilage); void-after-send is written by the
 * till when a sent item is voided, and the expired write-off is recorded on
 * the Expiry screen against its batch, so the variance report keeps the four
 * apart. Production: app.record_production consumes the components FEFO and
 * mints the prepared batch at computed cost.
 *
 * The page used to open with a "Reasons" panel listing all four reasons as
 * badges, two of which could not be chosen on this page. Each choice now
 * explains itself inside the select, and the two that live elsewhere are one
 * sentence with a link under the form. The quantity boxes name the unit, and
 * the form shows what is on hand for the chosen ingredient so a typo of an
 * extra zero is visible before it is recorded. They take numbers only, through
 * Goods in's keystroke filter (decimalInput.ts): digits typed on an Arabic
 * keyboard used to read as "not a number" here and hold the Record button.
 *
 * Made today (build-contracts-2026-09-23 §5.5): every batch recorded this
 * business day, from this form or from the kitchen's phones (record_batch),
 * through app.production_log_today, with who made it and no cost. Its key sits
 * under the stock root, so recording a batch here refreshes it. The payload
 * reader is madeTodayLogic.ts, with a node test.
 *
 * Wave 5 (wave5-addendum-2026-09-25 §2.8.2 D3, §5.2): both forms name a
 * store. Waste is taken from the cafe store unless the manager picks the
 * bakery store (the queued stock.waste carries it as `location`), and the
 * on-hand hint is that store's. Production is made in the bakery store by
 * default (§8 Q18): its ingredients come out of that store first, then the
 * other, and the batch lands there. Shop stock lives in the cafe store only
 * (V14), so the bakery store is off for a shop product's waste.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { appRpc } from '../../lib/appRpc';
import { mutate } from '../../lib/mutate';
import { QK } from '../../lib/queries';
import { formatTime } from '@touch/i18n';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, inputStyle, Select, Skeleton } from '../../components/ui';
import { DataTable, EmptyState, PageHeader, Panel, type Column } from '../../components/kit';
import { CardTitle } from '../ops/OpsVisuals';
import { Footnote, IngredientName, StorePicker, useStockFormat } from './stockUi';
import { SK, fetchByStore, fetchIngredients } from './stockKeys';
import { heldAt, splitByStore, type StockLocation } from './storeLogic';
import { readMade, type MadeRow } from './madeTodayLogic';
import { decimalKeystroke } from './decimalInput';

export function WasteAndProduction() {
  const { tr } = useLocale();
  return (
    <div style={{ maxInlineSize: '60rem' }}>
      <PageHeader title={tr('op.stockNav.waste')} subtitle={tr('ws.manager.stock.waste.lead')} />
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(19rem, 1fr))', alignItems: 'start' }}>
        <WasteForm />
        <ProductionForm />
        <MadeToday />
      </div>
    </div>
  );
}

/** Route alias for the spec name. */
export const WasteEntryScreen = WasteAndProduction;

/**
 * A read that failed, said where its list would be, with the way to read it
 * again: the forms' ingredient list used to come up empty ("Choose…" and
 * nothing under it) with no word about why.
 */
function ReadFailed({ q }: { q: { isError: boolean; isFetching: boolean; error: unknown; refetch: () => unknown } }) {
  const { tr } = useLocale();
  if (!q.isError) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', marginBlockEnd: 'var(--tp-sp-3)' }}>
      <ErrorText error={q.error} style={{ marginBlock: 0 }} />
      <Button size="sm" icon="refresh" busy={q.isFetching} onClick={() => void q.refetch()}>
        {tr('ws.kit.async.retry')}
      </Button>
    </div>
  );
}

/** What each store holds, per ingredient: the forms' on-hand hint is the chosen store's. */
function useStoreSplits() {
  const byStoreQ = useQuery({ queryKey: SK.byStore, queryFn: fetchByStore });
  return useMemo(() => (byStoreQ.isSuccess ? splitByStore(byStoreQ.data) : null), [byStoreQ.isSuccess, byStoreQ.data]);
}

function WasteForm() {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [ingredientId, setIngredientId] = useState('');
  const [qty, setQty] = useState('');
  const [movementType, setMovementType] = useState<'waste_spill' | 'waste_spoilage'>('waste_spill');
  const [reason, setReason] = useState('');
  /** The store the waste comes out of (wave 5): the cafe store unless the manager says otherwise. */
  const [location, setLocation] = useState<StockLocation>('cafe');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const splits = useStoreSplits();
  const ingredients = (ingredientsQ.data ?? []).filter((i) => i.is_active);
  const chosen = ingredients.find((i) => i.id === ingredientId);
  const shop = chosen?.kind === 'retail';
  // A shop product is only ever in the cafe store (V14).
  const store: StockLocation = shop ? 'cafe' : location;
  const onHand = chosen && splits ? heldAt(splits.get(chosen.id), store) : undefined;
  const qtyInvalid = qty.trim() !== '' && !(Number(qty) > 0);
  const ready = !!ingredientId && Number(qty) > 0 && reason.trim() !== '';

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // Item 9 (0120): waste rides the durable queue like every other stock
      // write — record_waste has carried an idempotency key since 0049, but
      // this screen called it direct, without key or device, until now.
      const outcome = await mutate('stock.waste', {
        ingredientId,
        qty: Number(qty),
        movementType,
        reasonCode: reason.trim(),
        location: store,
      });
      toast.ok(tr(outcome.queued ? 'ws.manager.stock.waste.queued' : 'ws.manager.stock.waste.recorded'));
      setQty('');
      setReason('');
      void queryClient.invalidateQueries({ queryKey: [...QK.stock.all] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={<CardTitle icon="ban">{tr('ws.manager.stock.waste.wasteTitle')}</CardTitle>}>
      <ReadFailed q={ingredientsQ} />
      <div style={{ marginBlockEnd: 'var(--tp-sp-4)' }}>
        <StorePicker
          label={tr('ws.stores.picker.takeFrom')}
          value={store}
          onChange={setLocation}
          disabled={busy}
          bakeryOff={shop ? tr('ws.stores.picker.shopCafeOnly') : undefined}
          data-testid="waste-store"
        />
      </div>
      <Field label={tr('ws.manager.stock.waste.ingredient')} required hint={chosen && onHand !== undefined ? <bdi>{tr(`ws.stores.waste.onHandAt.${store}`, { qty: fmt.qty(onHand, chosen.unit) })}</bdi> : undefined}>
        <Select
          value={ingredientId}
          disabled={busy}
          onChange={setIngredientId}
          options={[
            { value: '', label: tr('ws.manager.stock.goodsIn.choose') },
            ...ingredients.map((i) => ({ value: i.id, label: pickName(locale, i) })),
          ]}
        />
      </Field>
      <Field
        label={chosen ? tr('ws.manager.stock.waste.quantityIn', { unit: fmt.unit(chosen.unit) }) : tr('ws.manager.stock.waste.quantity')}
        required
        error={qtyInvalid ? tr('ws.manager.stock.waste.qtyInvalid') : undefined}
      >
        <input style={inputStyle} dir="ltr" inputMode="decimal" value={qty} disabled={busy} onChange={(e) => setQty(decimalKeystroke(e.target.value))} />
      </Field>
      <Field label={tr('ws.manager.stock.waste.what')} required>
        <Select
          value={movementType}
          disabled={busy}
          onChange={(v) => setMovementType(v as typeof movementType)}
          options={[
            { value: 'waste_spill', label: tr('ws.manager.stock.waste.spill') },
            { value: 'waste_spoilage', label: tr('ws.manager.stock.waste.spoilage') },
          ]}
        />
      </Field>
      <Field label={tr('ws.manager.stock.waste.note')} required hint={tr('ws.manager.stock.waste.noteHint')}>
        <input style={inputStyle} value={reason} disabled={busy} maxLength={300} placeholder={tr('ws.manager.stock.waste.notePlaceholder')} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorText error={error} />
      <Button kind="primary" icon="ban" busy={busy} disabled={!ready} disabledReason={tr('ws.manager.stock.waste.recordDisabled')} onClick={() => void submit()}>
        {tr('ws.manager.stock.waste.record')}
      </Button>
      <Footnote style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
        {tr('ws.manager.stock.waste.elsewhere')}{' '}
        <Button kind="ghost" size="sm" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/stock/expiry' })}>
          {tr('op.stockNav.expiry')}
        </Button>
      </Footnote>
    </Panel>
  );
}

function ProductionForm() {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [ingredientId, setIngredientId] = useState('');
  const [qty, setQty] = useState('');
  /** Where the batch is made (wave 5): the bakery store by default (§8 Q18). */
  const [location, setLocation] = useState<StockLocation>('bakery');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const splits = useStoreSplits();
  const prepared = (ingredientsQ.data ?? []).filter((i) => i.is_active && i.kind === 'prepared');
  const chosen = prepared.find((i) => i.id === ingredientId);
  const onHand = chosen && splits ? heldAt(splits.get(chosen.id), location) : undefined;
  const qtyInvalid = qty.trim() !== '' && !(Number(qty) > 0);

  async function submit() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const res = await appRpc<{ batch_id: string; unit_cost_iqd: number }>('record_production', {
        p_ingredient_id: ingredientId,
        p_qty: Number(qty),
        p_location: location,
      });
      toast.ok(tr('ws.manager.stock.waste.produced', { unit: fmt.one(chosen.unit), cost: fmt.cost(res.unit_cost_iqd) }));
      setQty('');
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={<CardTitle icon="flame">{tr('ws.manager.stock.waste.productionTitle')}</CardTitle>}>
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.manager.stock.waste.productionLead')}</p>
      <ReadFailed q={ingredientsQ} />
      {ingredientsQ.isSuccess && prepared.length === 0 ? (
        <EmptyState
          compact
          icon="flame"
          title={tr('ws.manager.stock.waste.noPrepared')}
          action={
            <Button size="sm" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/stock/ingredients' })}>
              {tr('op.stockNav.ingredients')}
            </Button>
          }
        />
      ) : (
        <>
          <div style={{ marginBlockEnd: 'var(--tp-sp-4)' }}>
            <StorePicker
              label={tr('ws.stores.picker.madeIn')}
              value={location}
              onChange={setLocation}
              disabled={busy}
              hint={tr('ws.stores.waste.productionHint')}
              data-testid="production-store"
            />
          </div>
          <Field label={tr('ws.manager.stock.waste.prepared')} required hint={chosen && onHand !== undefined ? <bdi>{tr(`ws.stores.waste.onHandAt.${location}`, { qty: fmt.qty(onHand, chosen.unit) })}</bdi> : undefined}>
            <Select
              value={ingredientId}
              disabled={busy}
              onChange={setIngredientId}
              options={[
                { value: '', label: tr('ws.manager.stock.goodsIn.choose') },
                ...prepared.map((i) => ({ value: i.id, label: pickName(locale, i) })),
              ]}
            />
          </Field>
          <Field
            label={chosen ? tr('ws.manager.stock.waste.madeIn', { unit: fmt.unit(chosen.unit) }) : tr('ws.manager.stock.waste.made')}
            required
            error={qtyInvalid ? tr('ws.manager.stock.waste.qtyInvalid') : undefined}
          >
            <input style={inputStyle} dir="ltr" inputMode="decimal" value={qty} disabled={busy} onChange={(e) => setQty(decimalKeystroke(e.target.value))} />
          </Field>
          <ErrorText error={error} />
          <Button kind="primary" icon="flame" busy={busy} disabled={!ingredientId || !(Number(qty) > 0)} disabledReason={tr('ws.manager.stock.waste.produceDisabled')} onClick={() => void submit()}>
            {tr('ws.manager.stock.waste.produce')}
          </Button>
        </>
      )}
    </Panel>
  );
}

/** Under the stock root, so the forms' ['stock'] invalidation refreshes it. */
const MADE_TODAY_KEY = ['stock', 'madeToday'] as const;

function MadeToday() {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const q = useQuery({ queryKey: MADE_TODAY_KEY, queryFn: () => appRpc<unknown>('production_log_today'), refetchInterval: 60_000 });
  const rows = useMemo(() => readMade(q.data), [q.data]);
  const columns: Column<MadeRow>[] = [
    { key: 'time', header: tr('ws.supplies.madeToday.time'), render: (r) => <bdi>{r.at ? formatTime(new Date(r.at), locale) : '—'}</bdi> },
    { key: 'item', header: tr('ws.supplies.madeToday.item'), render: (r) => <IngredientName name={pickName(locale, r)} strong /> },
    { key: 'amount', header: tr('ws.supplies.madeToday.amount'), numeric: true, render: (r) => <bdi>{fmt.qty(r.qty, r.unit)}</bdi> },
    { key: 'who', header: tr('ws.supplies.madeToday.who'), render: (r) => <bdi>{r.staff_name ?? '—'}</bdi> },
  ];
  return (
    <Panel title={<CardTitle icon="cake">{tr('ws.supplies.madeToday.title')}</CardTitle>} style={{ gridColumn: '1 / -1' }} data-testid="made-today">
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0, marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.supplies.madeToday.lead')}</p>
      <ReadFailed q={q} />
      {q.isPending ? (
        <Skeleton lines={2} />
      ) : q.isSuccess && rows.length === 0 ? (
        <EmptyState compact kind="nothingToDo" icon="cake" title={tr('ws.supplies.madeToday.empty')} />
      ) : rows.length > 0 ? (
        <DataTable<MadeRow> dense rows={rows} rowKey={(r) => String(r.movement_id)} columns={columns} aria-label={tr('ws.supplies.madeToday.title')} />
      ) : null}
    </Panel>
  );
}
