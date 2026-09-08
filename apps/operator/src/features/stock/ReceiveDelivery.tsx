/**
 * Goods received (spec 06.33): one delivery per submit against
 * app.receive_delivery — per line: ingredient, expected, received (short-
 * delivery capture), unit cost and an EXPIRY DATE PER BATCH. One ingredient
 * may be held as several batches with different expiry dates; the server
 * keeps them apart and so does every screen that lists them.
 *
 * The RPC takes no idempotency key, so this stays online-only by design
 * (flagged for the offline architect in the day-14 plan).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, inputStyle } from '../../components/ui';
import { MessagePresenter, PageHeader, Panel, StatusBadge } from '../../components/kit';
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

/** Short-delivery flag for a draft line: the received quantity is below the expected one. */
export function isShort(l: Pick<DraftLine, 'qtyExpected' | 'qtyReceived'>): boolean {
  return l.qtyExpected !== '' && l.qtyReceived !== '' && Number(l.qtyReceived) < Number(l.qtyExpected);
}

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

  const validLines = lines.filter((l) => l.ingredientId && Number(l.qtyReceived) > 0 && Number(l.unitCostIqd) >= 0 && l.unitCostIqd !== '');
  const shortCount = lines.filter(isShort).length;
  const dirty = lines.some((l) => l.ingredientId || l.qtyReceived || l.qtyExpected) || supplier !== '' || notes !== '';

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
    <div style={{ maxInlineSize: '64rem' }}>
      <PageHeader
        title={tr('op.stock.receiveTitle')}
        subtitle={tr('ws.manager.stock.goodsIn.lead')}
        actions={
          <>
            {dirty && <StatusBadge tone="warn" label={tr('ws.kit.actions.unsaved')} />}
            {shortCount > 0 && <StatusBadge tone="warn" icon="alert" label={tr('ws.manager.stock.goodsIn.shortTitle')} />}
          </>
        }
      />

      <Panel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--tp-sp-2-5)' }}>
          <Field label={tr('op.stock.supplier')}>
            <input style={inputStyle} value={supplier} disabled={busy} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          <Field label={tr('op.common.notes')}>
            <input style={inputStyle} value={notes} disabled={busy} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </Panel>

      <Panel title={tr('ws.manager.stock.goodsIn.lines')} style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
        {shortCount > 0 && (
          <MessagePresenter tone="refused" icon="alert" message={tr('ws.manager.stock.goodsIn.shortLead', { count: shortCount })} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />
        )}
        {lines.map((l) => {
          const short = isShort(l);
          return (
            <div
              key={l.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1fr 1.2fr auto',
                gap: 'var(--tp-sp-1-5)',
                alignItems: 'end',
                marginBlockEnd: 'var(--tp-sp-1-5)',
                paddingBlockEnd: 'var(--tp-sp-1-5)',
                borderBlockEnd: '1px solid var(--tp-border)',
              }}
            >
              <Field label={tr('op.stock.ingredient')} style={{ marginBlockEnd: 0 }}>
                <select style={inputStyle} value={l.ingredientId} disabled={busy} onChange={(e) => patch(l.key, { ingredientId: e.target.value })}>
                  <option value="">—</option>
                  {ingredients.map((i) => (
                    <option key={i.id} value={i.id}>
                      {pickName(locale, i)} ({i.unit})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={tr('op.stock.qtyExpected')} style={{ marginBlockEnd: 0 }}>
                <input style={inputStyle} dir="ltr" inputMode="decimal" value={l.qtyExpected} disabled={busy} onChange={(e) => patch(l.key, { qtyExpected: e.target.value })} />
              </Field>
              <Field
                label={tr('op.stock.qtyReceived')}
                style={{ marginBlockEnd: 0 }}
                error={short ? tr('op.stock.short', { qty: Number(l.qtyExpected) - Number(l.qtyReceived) }) : undefined}
              >
                <input
                  style={{ ...inputStyle, borderColor: short ? 'var(--tp-warn)' : undefined }}
                  dir="ltr"
                  inputMode="decimal"
                  value={l.qtyReceived}
                  disabled={busy}
                  onChange={(e) => patch(l.key, { qtyReceived: e.target.value })}
                />
              </Field>
              <Field label={tr('op.stock.unitCost')} style={{ marginBlockEnd: 0 }}>
                <input style={inputStyle} dir="ltr" inputMode="numeric" value={l.unitCostIqd} disabled={busy} onChange={(e) => patch(l.key, { unitCostIqd: e.target.value })} />
              </Field>
              <Field label={tr('op.stock.expiry')} hint={tr('ws.manager.stock.goodsIn.expiryHint')} style={{ marginBlockEnd: 0 }}>
                <input style={inputStyle} type="date" dir="ltr" value={l.expiryDate} disabled={busy} onChange={(e) => patch(l.key, { expiryDate: e.target.value })} />
              </Field>
              <div style={{ paddingBlockEnd: 'var(--tp-sp-0)' }}>
                <Button
                  kind="ghost"
                  size="sm"
                  icon="x"
                  disabled={busy || lines.length === 1}
                  aria-label={tr('ws.manager.stock.goodsIn.removeLine')}
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                />
              </div>
            </div>
          );
        })}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBlockStart: 'var(--tp-sp-2)', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
          <Button icon="plus" disabled={busy} onClick={() => setLines((ls) => [...ls, emptyLine()])}>
            {tr('op.stock.addLine')}
          </Button>
          <Button kind="primary" icon="package" busy={busy} disabled={validLines.length === 0} onClick={() => void submit()}>
            {tr('op.stock.receiveBtn')}
          </Button>
        </div>
        <ErrorText error={error} />
      </Panel>
    </div>
  );
}

/** Route alias for the spec name. */
export const GoodsReceivedScreen = ReceiveDelivery;
