/**
 * Waste with a mandatory reason (SOW L529-530: spill or spoilage, never a bare
 * number) and sub-recipe production runs (app.record_production consumes the
 * components FEFO and mints the prepared batch at computed cost).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, card, inputStyle } from '../../components/ui';
import { SK, fetchIngredients } from './stockKeys';

export function WasteAndProduction() {
  const { tr } = useLocale();
  return (
    <div style={{ maxInlineSize: '30rem' }}>
      <h2 style={{ marginBlock: '0.4rem' }}>{tr('op.stock.wasteTitle')}</h2>
      <WasteForm />
      <h2 style={{ marginBlock: '0.6rem' }}>{tr('op.stock.productionTitle')}</h2>
      <ProductionForm />
    </div>
  );
}

function WasteForm() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [ingredientId, setIngredientId] = useState('');
  const [qty, setQty] = useState('');
  const [movementType, setMovementType] = useState<'waste_spill' | 'waste_spoilage'>('waste_spill');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const ingredients = (ingredientsQ.data ?? []).filter((i) => i.is_active);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await appRpc('record_waste', {
        p_ingredient_id: ingredientId,
        p_qty: Number(qty),
        p_movement_type: movementType,
        p_reason_code: reason,
      });
      toast.ok(tr('op.toast.saved'));
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
    <div style={card}>
      <Field label={tr('op.stock.ingredient')}>
        <select style={inputStyle} value={ingredientId} onChange={(e) => setIngredientId(e.target.value)}>
          <option value="">—</option>
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {pickName(locale, i)} ({i.unit})
            </option>
          ))}
        </select>
      </Field>
      <Field label={tr('op.stock.qty')}>
        <input style={inputStyle} dir="ltr" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
      </Field>
      <Field label={tr('op.stock.wasteKind')}>
        <select
          style={inputStyle}
          value={movementType}
          onChange={(e) => setMovementType(e.target.value as typeof movementType)}
        >
          <option value="waste_spill">{tr('op.stock.spill')}</option>
          <option value="waste_spoilage">{tr('op.stock.spoilage')}</option>
        </select>
      </Field>
      <Field label={tr('op.common.reason')}>
        <input style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorText error={error} />
      <Button
        kind="primary"
        disabled={busy || !ingredientId || !(Number(qty) > 0) || !reason.trim()}
        onClick={() => void submit()}
      >
        {tr('op.stock.recordWasteBtn')}
      </Button>
    </div>
  );
}

function ProductionForm() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [ingredientId, setIngredientId] = useState('');
  const [qty, setQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const prepared = (ingredientsQ.data ?? []).filter((i) => i.is_active && i.kind === 'prepared');

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await appRpc<{ batch_id: string; unit_cost_iqd: number }>('record_production', {
        p_ingredient_id: ingredientId,
        p_qty: Number(qty),
      });
      toast.ok(tr('op.stock.produced', { cost: res.unit_cost_iqd }));
      setQty('');
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (prepared.length === 0) {
    return <p style={card}>{tr('op.stock.noPrepared')}</p>;
  }

  return (
    <div style={card}>
      <Field label={tr('op.stock.preparedIngredient')}>
        <select style={inputStyle} value={ingredientId} onChange={(e) => setIngredientId(e.target.value)}>
          <option value="">—</option>
          {prepared.map((i) => (
            <option key={i.id} value={i.id}>
              {pickName(locale, i)} ({i.unit})
            </option>
          ))}
        </select>
      </Field>
      <Field label={tr('op.stock.outputQty')}>
        <input style={inputStyle} dir="ltr" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
      </Field>
      <ErrorText error={error} />
      <Button kind="primary" disabled={busy || !ingredientId || !(Number(qty) > 0)} onClick={() => void submit()}>
        {tr('op.stock.produceBtn')}
      </Button>
    </div>
  );
}
