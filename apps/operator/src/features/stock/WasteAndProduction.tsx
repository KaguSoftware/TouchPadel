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
 * extra zero is visible before it is recorded.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, inputStyle } from '../../components/ui';
import { EmptyState, PageHeader, Panel } from '../../components/kit';
import { CardTitle } from '../ops/OpsVisuals';
import { Footnote, useStockFormat } from './stockUi';
import { SK, fetchIngredients, fetchOnHand } from './stockKeys';

export function WasteAndProduction() {
  const { tr } = useLocale();
  return (
    <div style={{ maxInlineSize: '60rem' }}>
      <PageHeader title={tr('op.stockNav.waste')} subtitle={tr('ws.manager.stock.waste.lead')} />
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(19rem, 1fr))', alignItems: 'start' }}>
        <WasteForm />
        <ProductionForm />
      </div>
    </div>
  );
}

/** Route alias for the spec name. */
export const WasteEntryScreen = WasteAndProduction;

function useOnHandOf() {
  const onHandQ = useQuery({ queryKey: SK.onHand, queryFn: fetchOnHand });
  return new Map((onHandQ.data ?? []).map((r) => [r.ingredient_id, r.on_hand]));
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const onHandOf = useOnHandOf();
  const ingredients = (ingredientsQ.data ?? []).filter((i) => i.is_active);
  const chosen = ingredients.find((i) => i.id === ingredientId);
  const onHand = chosen ? onHandOf.get(chosen.id) : undefined;
  const qtyInvalid = qty.trim() !== '' && !(Number(qty) > 0);
  const ready = !!ingredientId && Number(qty) > 0 && reason.trim() !== '';

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await appRpc('record_waste', {
        p_ingredient_id: ingredientId,
        p_qty: Number(qty),
        p_movement_type: movementType,
        p_reason_code: reason.trim(),
      });
      toast.ok(tr('ws.manager.stock.waste.recorded'));
      setQty('');
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={<CardTitle icon="ban">{tr('ws.manager.stock.waste.wasteTitle')}</CardTitle>}>
      <Field label={tr('ws.manager.stock.waste.ingredient')} required hint={chosen && onHand !== undefined ? <bdi>{tr('ws.manager.stock.waste.onHand', { qty: fmt.qty(onHand, chosen.unit) })}</bdi> : undefined}>
        <select style={inputStyle} value={ingredientId} disabled={busy} onChange={(e) => setIngredientId(e.target.value)}>
          <option value="">{tr('ws.manager.stock.goodsIn.choose')}</option>
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {pickName(locale, i)}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label={chosen ? tr('ws.manager.stock.waste.quantityIn', { unit: fmt.unit(chosen.unit) }) : tr('ws.manager.stock.waste.quantity')}
        required
        error={qtyInvalid ? tr('ws.manager.stock.waste.qtyInvalid') : undefined}
      >
        <input style={inputStyle} dir="ltr" inputMode="decimal" value={qty} disabled={busy} onChange={(e) => setQty(e.target.value)} />
      </Field>
      <Field label={tr('ws.manager.stock.waste.what')} required>
        <select style={inputStyle} value={movementType} disabled={busy} onChange={(e) => setMovementType(e.target.value as typeof movementType)}>
          <option value="waste_spill">{tr('ws.manager.stock.waste.spill')}</option>
          <option value="waste_spoilage">{tr('ws.manager.stock.waste.spoilage')}</option>
        </select>
      </Field>
      <Field label={tr('ws.manager.stock.waste.note')} required hint={tr('ws.manager.stock.waste.noteHint')}>
        <input style={inputStyle} value={reason} disabled={busy} placeholder={tr('ws.manager.stock.waste.notePlaceholder')} onChange={(e) => setReason(e.target.value)} />
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const onHandOf = useOnHandOf();
  const prepared = (ingredientsQ.data ?? []).filter((i) => i.is_active && i.kind === 'prepared');
  const chosen = prepared.find((i) => i.id === ingredientId);
  const onHand = chosen ? onHandOf.get(chosen.id) : undefined;
  const qtyInvalid = qty.trim() !== '' && !(Number(qty) > 0);

  async function submit() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const res = await appRpc<{ batch_id: string; unit_cost_iqd: number }>('record_production', {
        p_ingredient_id: ingredientId,
        p_qty: Number(qty),
      });
      toast.ok(tr('ws.manager.stock.waste.produced', { unit: fmt.unit(chosen.unit), cost: fmt.cost(res.unit_cost_iqd) }));
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
          <Field label={tr('ws.manager.stock.waste.prepared')} required hint={chosen && onHand !== undefined ? <bdi>{tr('ws.manager.stock.waste.onHand', { qty: fmt.qty(onHand, chosen.unit) })}</bdi> : undefined}>
            <select style={inputStyle} value={ingredientId} disabled={busy} onChange={(e) => setIngredientId(e.target.value)}>
              <option value="">{tr('ws.manager.stock.goodsIn.choose')}</option>
              {prepared.map((i) => (
                <option key={i.id} value={i.id}>
                  {pickName(locale, i)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={chosen ? tr('ws.manager.stock.waste.madeIn', { unit: fmt.unit(chosen.unit) }) : tr('ws.manager.stock.waste.made')}
            required
            error={qtyInvalid ? tr('ws.manager.stock.waste.qtyInvalid') : undefined}
          >
            <input style={inputStyle} dir="ltr" inputMode="decimal" value={qty} disabled={busy} onChange={(e) => setQty(e.target.value)} />
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
