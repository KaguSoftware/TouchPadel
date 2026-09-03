/**
 * Goods received (SOW L519-523: against a delivery, short-delivery capture,
 * expiry date per received batch). One BLOCKING app.receive_delivery call —
 * the RPC takes no idempotency key, so this stays online-only by design
 * (flagged for the offline architect in the day-14 plan).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, card, inputStyle } from '../../components/ui';
import { SK, fetchIngredients } from './stockKeys';

interface DraftLine {
  key: string;
  ingredientId: string;
  qtyExpected: string;
  qtyReceived: string;
  unitCostIqd: string;
  expiryDate: string;
}

const emptyLine = (): DraftLine => ({
  key: crypto.randomUUID(),
  ingredientId: '',
  qtyExpected: '',
  qtyReceived: '',
  unitCostIqd: '',
  expiryDate: '',
});

export function ReceiveDelivery() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [supplier, setSupplier] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const ingredients = (ingredientsQ.data ?? []).filter((i) => i.is_active && i.kind === 'purchased');

  function patch(key: string, part: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...part } : l)));
  }

  const validLines = lines.filter(
    (l) => l.ingredientId && Number(l.qtyReceived) > 0 && Number(l.unitCostIqd) >= 0 && l.unitCostIqd !== '',
  );

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await appRpc<{ delivery_id: string; batch_ids: string[] }>('receive_delivery', {
        p_lines: validLines.map((l) => ({
          ingredient_id: l.ingredientId,
          qty_expected: l.qtyExpected === '' ? null : Number(l.qtyExpected),
          qty_received: Number(l.qtyReceived),
          unit_cost_iqd: Number(l.unitCostIqd),
          expiry_date: l.expiryDate || null,
        })),
        p_supplier_name: supplier || null,
        p_notes: notes || null,
      });
      toast.ok(tr('op.stock.received', { count: res.batch_ids.length }));
      setLines([emptyLine()]);
      setSupplier('');
      setNotes('');
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxInlineSize: '52rem' }}>
      <h2 style={{ marginBlock: '0.4rem' }}>{tr('op.stock.receiveTitle')}</h2>
      <p style={{ marginBlockStart: 0, color: 'var(--tp-muted-fg)', fontSize: '0.9rem' }}>
        {tr('op.stock.receiveHint')}
      </p>

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
          <Field label={tr('op.stock.supplier')}>
            <input style={inputStyle} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          <Field label={tr('op.common.notes')}>
            <input style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>

        {lines.map((l) => {
          const short =
            l.qtyExpected !== '' &&
            l.qtyReceived !== '' &&
            Number(l.qtyReceived) < Number(l.qtyExpected);
          return (
            <div
              key={l.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto',
                gap: '0.4rem',
                alignItems: 'end',
                marginBlockEnd: '0.4rem',
              }}
            >
              <Field label={tr('op.stock.ingredient')}>
                <select
                  style={inputStyle}
                  value={l.ingredientId}
                  onChange={(e) => patch(l.key, { ingredientId: e.target.value })}
                >
                  <option value="">—</option>
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {pickName(locale, i)} ({i.unit})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr('op.stock.qtyExpected')}>
                <input style={inputStyle} dir="ltr" inputMode="decimal" value={l.qtyExpected} onChange={(e) => patch(l.key, { qtyExpected: e.target.value })} />
              </Field>
              <Field label={tr('op.stock.qtyReceived')}>
                <input style={inputStyle} dir="ltr" inputMode="decimal" value={l.qtyReceived} onChange={(e) => patch(l.key, { qtyReceived: e.target.value })} />
              </Field>
              <Field label={tr('op.stock.unitCost')}>
                <input style={inputStyle} dir="ltr" inputMode="numeric" value={l.unitCostIqd} onChange={(e) => patch(l.key, { unitCostIqd: e.target.value })} />
              </Field>
              <Field label={tr('op.stock.expiry')}>
                <input style={inputStyle} type="date" dir="ltr" value={l.expiryDate} onChange={(e) => patch(l.key, { expiryDate: e.target.value })} />
              </Field>
              <div style={{ paddingBlockEnd: '0.35rem' }}>
                {short && (
                  <span style={{ color: 'var(--tp-danger)', fontSize: '0.8rem', fontWeight: 700 }}>
                    {tr('op.stock.short', {
                      qty: Number(l.qtyExpected) - Number(l.qtyReceived),
                    })}
                  </span>
                )}
                <Button kind="ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                  ✕
                </Button>
              </div>
            </div>
          );
        })}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBlockStart: '0.5rem' }}>
          <Button onClick={() => setLines((ls) => [...ls, emptyLine()])}>
            {tr('op.stock.addLine')}
          </Button>
          <Button kind="primary" disabled={busy || validLines.length === 0} onClick={() => void submit()}>
            {tr('op.stock.receiveBtn')}
          </Button>
        </div>
        <ErrorText error={error} />
      </div>
    </div>
  );
}
