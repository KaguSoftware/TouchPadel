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
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, inputStyle } from '../../components/ui';
import { EmptyState, PageHeader, Panel, StatusBadge } from '../../components/kit';
import { SK, fetchIngredients } from './stockKeys';

export function WasteAndProduction() {
  const { tr } = useLocale();
  return (
    <div style={{ maxInlineSize: '60rem' }}>
      <PageHeader title={tr('op.stock.wasteTitle')} subtitle={tr('ws.manager.stock.waste.lead')} />
      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', alignItems: 'start' }}>
        <WasteForm />
        <div style={{ display: 'grid', gap: '1rem' }}>
          <ReasonsPanel />
          <Panel title={tr('op.stock.productionTitle')}>
            <ProductionForm />
          </Panel>
        </div>
      </div>
    </div>
  );
}

/** Route alias for the spec name. */
export const WasteEntryScreen = WasteAndProduction;

function ReasonsPanel() {
  const { tr } = useLocale();
  const navigate = useNavigate();
  const line = (label: string, hint: string | null, tone: 'accent' | 'neutral') => (
    <li style={{ display: 'grid', gap: '0.15rem', paddingBlock: '0.4rem', borderBlockEnd: '1px solid var(--tp-border)' }}>
      <StatusBadge size="sm" tone={tone} label={label} style={{ justifySelf: 'start' }} />
      {hint && <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{hint}</span>}
    </li>
  );
  return (
    <Panel title={tr('ws.manager.stock.waste.reasons')} muted>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {line(tr('ws.manager.stock.waste.spill'), null, 'accent')}
        {line(tr('ws.manager.stock.waste.spoilage'), null, 'accent')}
        {line(tr('ws.manager.stock.waste.voidAfterSend'), tr('ws.manager.stock.waste.voidAfterSendHint'), 'neutral')}
        {line(tr('ws.manager.stock.waste.expiredWriteOff'), tr('ws.manager.stock.waste.expiredWriteOffHint'), 'neutral')}
      </ul>
      <Button size="sm" icon="hourglass" style={{ marginBlockStart: '0.5rem' }} onClick={() => void navigate({ to: '/stock/expiry' })}>
        {tr('ws.manager.stock.waste.goToExpiry')}
      </Button>
    </Panel>
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
  const unit = ingredients.find((i) => i.id === ingredientId)?.unit;

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
    <Panel title={tr('op.stock.recordWasteBtn')}>
      <Field label={tr('op.stock.ingredient')} required>
        <select style={inputStyle} value={ingredientId} disabled={busy} onChange={(e) => setIngredientId(e.target.value)}>
          <option value="">—</option>
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {pickName(locale, i)} ({i.unit})
            </option>
          ))}
        </select>
      </Field>
      <Field label={tr('op.stock.qty')} hint={unit} required>
        <input style={inputStyle} dir="ltr" inputMode="decimal" value={qty} disabled={busy} onChange={(e) => setQty(e.target.value)} />
      </Field>
      <Field label={tr('op.stock.wasteKind')} required>
        <select style={inputStyle} value={movementType} disabled={busy} onChange={(e) => setMovementType(e.target.value as typeof movementType)}>
          <option value="waste_spill">{tr('op.stock.spill')}</option>
          <option value="waste_spoilage">{tr('op.stock.spoilage')}</option>
        </select>
      </Field>
      <Field label={tr('op.common.reason')} hint={tr('ws.manager.stock.waste.note')} required>
        <input style={inputStyle} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorText error={error} />
      <Button kind="primary" icon="ban" busy={busy} disabled={!ingredientId || !(Number(qty) > 0) || !reason.trim()} onClick={() => void submit()}>
        {tr('op.stock.recordWasteBtn')}
      </Button>
    </Panel>
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

  if (ingredientsQ.isSuccess && prepared.length === 0) {
    return <EmptyState compact icon="flame" title={tr('op.stock.noPrepared')} />;
  }

  return (
    <div>
      <Field label={tr('op.stock.preparedIngredient')}>
        <select style={inputStyle} value={ingredientId} disabled={busy} onChange={(e) => setIngredientId(e.target.value)}>
          <option value="">—</option>
          {prepared.map((i) => (
            <option key={i.id} value={i.id}>
              {pickName(locale, i)} ({i.unit})
            </option>
          ))}
        </select>
      </Field>
      <Field label={tr('op.stock.outputQty')}>
        <input style={inputStyle} dir="ltr" inputMode="decimal" value={qty} disabled={busy} onChange={(e) => setQty(e.target.value)} />
      </Field>
      <ErrorText error={error} />
      <Button kind="primary" icon="flame" busy={busy} disabled={!ingredientId || !(Number(qty) > 0)} onClick={() => void submit()}>
        {tr('op.stock.produceBtn')}
      </Button>
    </div>
  );
}
