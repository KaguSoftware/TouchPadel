/**
 * Goods in (spec 06.33): one delivery per submit against
 * app.receive_delivery — per line: ingredient, ordered, received (short-
 * delivery capture), cost per unit and an EXPIRY DATE PER BATCH. One
 * ingredient may be held as several batches with different expiry dates; the
 * server keeps them apart and so does every screen that lists them.
 *
 * What changed for the person holding the invoice:
 *
 *  - Cost is asked per the ingredient's own unit ("Cost per g") and prefilled
 *    from its pack price, with the pack price shown beneath. The old box was
 *    "Cost/unit (IQD)" with no unit, and invoices quote packs, not grams.
 *  - A started line that is missing something says what, in place, and holds
 *    the Record button with the reason. The old screen silently dropped
 *    half-filled lines when the delivery was recorded.
 *  - The expiry hint says what a blank box will actually do for THIS
 *    ingredient (its shelf life, or no expiry at all), and the date cannot be
 *    in the past — the picker starts at today and a typed past date holds the
 *    Record button. Stock that is already expired never belongs on the shelf.
 *  - The supplier fills itself from the first ingredient's supplier.
 *
 * Touch Shop (0145): retail stock is received here too, and the supplier is
 * picked from the supplier list (or typed, for one not on it). Each delivery
 * carries an idempotency key, so a double tap on Record — or a retry after a
 * dropped reply — books the delivery once. Still online-only: goods-in is not
 * a queued mutation type.
 *
 * What the driver bought (0166) is listed above the form, and opening one
 * (?purchase=<id>) swaps the form for that purchase's own: its lines are the
 * driver's, and app.receive_purchase books them (DriverPurchases.tsx).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, inputStyle, Select } from '../../components/ui';
import { MessagePresenter, Money, PageHeader, Panel } from '../../components/kit';
import { useStockFormat } from './stockUi';
import { todayIso } from '../admin/menu/availability';
import { isBlankLine, isShort, lineProblem, parseQty, unitCostFromPack, type DeliveryLineDraft } from './stockLogic';
import { SK, fetchIngredients, fetchSuppliers, type IngredientRow } from './stockKeys';
import { DriverPurchaseReceive, DriverPurchasesPanel } from './DriverPurchases';
import { decimalKeystroke } from './decimalInput';

export { isShort } from './stockLogic';

interface DraftLine extends DeliveryLineDraft {
  key: string;
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
  const { tr } = useLocale();
  const navigate = useNavigate();
  const { purchase } = useSearch({ strict: false }) as { purchase?: string };
  if (purchase) {
    return (
      <div style={{ maxInlineSize: '64rem' }}>
        <PageHeader
          title={tr('ws.supplies.purchase.title')}
          actions={
            <Button kind="ghost" size="sm" icon="chevronStart" onClick={() => void navigate({ to: '/stock/receive' })}>
              {tr('ws.supplies.purchase.back')}
            </Button>
          }
        />
        <DriverPurchaseReceive key={purchase} purchaseId={purchase} onBack={() => void navigate({ to: '/stock/receive' })} />
      </div>
    );
  }
  return <DeliveryForm />;
}

/** One delivery typed in by hand, with the driver's purchases above it. */
function DeliveryForm() {
  const { tr } = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [supplier, setSupplier] = useState('');
  /** A supplier from the list; '' = none picked (the typed name, if any, is used). */
  const [supplierId, setSupplierId] = useState('');
  /** One key per delivery: kept across retries, renewed after a recorded one. */
  const [idemKey, setIdemKey] = useState(() => `receive:${crypto.randomUUID()}`);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const suppliersQ = useQuery({ queryKey: SK.suppliers, queryFn: fetchSuppliers });
  const suppliers = (suppliersQ.data ?? []).filter((s) => s.is_active);
  // Prepared items are made in the kitchen, not delivered — they have their
  // own form under Waste & production. Shop stock (retail) is delivered.
  const ingredients = (ingredientsQ.data ?? []).filter((i) => i.is_active && (i.kind === 'purchased' || i.kind === 'retail'));
  const byId = new Map(ingredients.map((i) => [i.id, i]));

  function patch(key: string, part: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...part } : l)));
  }

  function chooseIngredient(line: DraftLine, id: string) {
    const ing = byId.get(id);
    const packUnitCost = ing ? unitCostFromPack(ing.pack_size, ing.pack_cost_iqd) : null;
    patch(line.key, {
      ingredientId: id,
      // Prefill only a box the user has not typed into.
      unitCostIqd: line.unitCostIqd.trim() === '' && packUnitCost !== null ? String(packUnitCost) : line.unitCostIqd,
    });
    if (supplierId === '' && supplier.trim() === '') {
      if (ing?.supplier_id && suppliers.some((s) => s.id === ing.supplier_id)) setSupplierId(ing.supplier_id);
      else if (ing?.supplier_name) setSupplier(ing.supplier_name);
    }
  }

  // One calendar date for the whole form: the expiry boxes cannot be set
  // earlier than today, and the same date decides whether they are valid.
  const today = todayIso();
  const started = lines.filter((l) => !isBlankLine(l));
  const problems = started.filter((l) => lineProblem(l, today) !== null);
  const shortCount = lines.filter(isShort).length;
  const canRecord = started.length > 0 && problems.length === 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await appRpc<{ delivery_id: string; batch_ids: string[] }>('receive_delivery', {
        p_lines: started.map((l) => ({
          ingredient_id: l.ingredientId,
          qty_expected: parseQty(l.qtyExpected),
          qty_received: Number(l.qtyReceived),
          unit_cost_iqd: Number(l.unitCostIqd),
          expiry_date: l.expiryDate || null,
        })),
        p_supplier_name: supplierId ? null : supplier.trim() || null,
        p_supplier_id: supplierId || null,
        p_notes: notes.trim() || null,
        p_idempotency_key: idemKey,
      });
      toast.ok(tr('ws.manager.stock.goodsIn.recorded'));
      setLines([emptyLine()]);
      setSupplier('');
      setSupplierId('');
      setIdemKey(`receive:${crypto.randomUUID()}`);
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
      <PageHeader title={tr('op.stockNav.receive')} subtitle={tr('ws.manager.stock.goodsIn.lead')} />

      {/* The driver's purchases, then one delivery typed in by hand: the lines
          first, then who it came from. The supplier fills itself from the first
          ingredient chosen, so it sits under the lines, where that shows, and
          the Record button closes the form rather than sharing a row with
          "Add another ingredient" above a supplier still to check. */}
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
        <DriverPurchasesPanel />

        <Panel title={tr('ws.manager.stock.goodsIn.linesTitle')}>
          {/* The order of the work, said once at the top rather than hidden in
              the Record button's tooltip, where it only showed up too late. */}
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0, marginBlockEnd: 'var(--tp-sp-3)' }}>
            {tr('ws.manager.stock.goodsIn.recordEmpty')}
          </p>
          {/* A failed ingredient read left an empty "Choose…" list with no word
              about why: say so, with the way to read it again. */}
          {ingredientsQ.isError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', marginBlockEnd: 'var(--tp-sp-3)' }}>
              <ErrorText error={ingredientsQ.error} style={{ marginBlock: 0 }} />
              <Button size="sm" icon="refresh" busy={ingredientsQ.isFetching} onClick={() => void ingredientsQ.refetch()}>
                {tr('ws.kit.async.retry')}
              </Button>
            </div>
          )}
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
            {lines.map((l, i) => (
              <LineEditor
                key={l.key}
                index={i}
                line={l}
                today={today}
                ingredients={ingredients}
                ingredient={byId.get(l.ingredientId) ?? null}
                busy={busy}
                removable={lines.length > 1}
                onChoose={(id) => chooseIngredient(l, id)}
                onPatch={(part) => patch(l.key, part)}
                onRemove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
              />
            ))}
          </ol>

          {shortCount > 0 && (
            <MessagePresenter tone="info" icon="alert" message={tr('ws.manager.stock.goodsIn.shortLead')} style={{ marginBlockStart: 'var(--tp-sp-3)' }} />
          )}

          <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
            <Button icon="plus" disabled={busy} onClick={() => setLines((ls) => [...ls, emptyLine()])}>
              {tr('ws.manager.stock.goodsIn.addLine')}
            </Button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
              columnGap: 'var(--tp-sp-2-5)',
              marginBlockStart: 'var(--tp-sp-5)',
              paddingBlockStart: 'var(--tp-sp-4)',
              borderBlockStart: '1px solid var(--tp-border)',
            }}
          >
            <Field label={tr('ws.manager.stock.goodsIn.supplier')} optional>
              {suppliers.length > 0 ? (
                <Select
                  value={supplierId}
                  disabled={busy}
                  onChange={setSupplierId}
                  options={[
                    { value: '', label: tr('ws.manager.stock.goodsIn.supplierOther') },
                    ...suppliers.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
              ) : null}
              {supplierId === '' && (
                <input
                  style={{ ...inputStyle, ...(suppliers.length > 0 ? { marginBlockStart: 'var(--tp-sp-1-5)' } : {}) }}
                  value={supplier}
                  disabled={busy}
                  placeholder={suppliers.length > 0 ? tr('ws.manager.stock.goodsIn.supplierTyped') : undefined}
                  onChange={(e) => setSupplier(e.target.value)}
                />
              )}
            </Field>
            <Field label={tr('ws.manager.stock.goodsIn.notes')} optional>
              <input style={inputStyle} value={notes} disabled={busy} placeholder={tr('ws.manager.stock.goodsIn.notesPlaceholder')} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>

          <ErrorText error={error} />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button kind="primary" icon="box" busy={busy} disabled={!canRecord} onClick={() => void submit()}>
              {tr('ws.manager.stock.goodsIn.record')}
            </Button>
          </div>
        </Panel>

        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0 }}>
          {tr('ws.manager.stock.goodsIn.afterwards')}{' '}
          <Button kind="ghost" size="sm" iconEnd="arrowUpRight" onClick={() => void navigate({ to: '/stock' })}>
            {tr('op.stockNav.onHand')}
          </Button>
        </p>
      </div>
    </div>
  );
}

function LineEditor({
  index,
  line,
  today,
  ingredients,
  ingredient,
  busy,
  removable,
  onChoose,
  onPatch,
  onRemove,
}: {
  index: number;
  line: DraftLine;
  today: string;
  ingredients: IngredientRow[];
  ingredient: IngredientRow | null;
  busy: boolean;
  removable: boolean;
  onChoose: (id: string) => void;
  onPatch: (part: Partial<DraftLine>) => void;
  onRemove: () => void;
}) {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const problem = lineProblem(line, today);
  const short = isShort(line);
  const unit = ingredient ? fmt.unit(ingredient.unit) : null;
  const withUnit = (label: string) => (unit ? `${label} (${unit})` : label);

  const expiryHint = !ingredient
    ? undefined
    : ingredient.shelf_life_days !== null
      ? tr('ws.manager.stock.goodsIn.expiryAuto', { days: fmt.num(ingredient.shelf_life_days) })
      : tr('ws.manager.stock.goodsIn.expiryNone');

  // Quantities and costs are numbers, so the boxes take nothing else: digits
  // (an Arabic keyboard's included) and a single decimal point survive, every
  // other keystroke is dropped, and the run stops at ten digits — past that it
  // is a typo, not a delivery (decimalKeystroke, decimalInput.ts).
  return (
    <li
      style={{
        display: 'grid',
        gap: 'var(--tp-sp-1-5)',
        paddingBlock: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-2-5)',
        borderRadius: 'var(--tp-radius-ctl)',
        border: '1px solid var(--tp-border)',
        background: 'var(--tp-surface-2)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--tp-sp-2)' }}>
        <Field label={tr('ws.manager.stock.goodsIn.ingredient')} style={{ marginBlockEnd: 0, flex: 1, minInlineSize: 0 }} error={problem === 'ingredient' ? tr('ws.manager.stock.goodsIn.problem.ingredient') : undefined}>
          <Select
            value={line.ingredientId}
            disabled={busy}
            onChange={onChoose}
            options={[
              { value: '', label: tr('ws.manager.stock.goodsIn.choose') },
              // The cafe/shop <optgroup> pair became a prefixed flat list:
              // SelectMenu draws its own panel and has no group row, and a
              // silent flattening would have lost which list an item came
              // from — retail and cafe ingredients can share a name.
              ...(ingredients.some((i2) => i2.kind === 'retail')
                ? [
                    ...ingredients
                      .filter((i2) => i2.kind !== 'retail')
                      .map((i2) => ({ value: i2.id, label: `${tr('ws.manager.stock.goodsIn.groupCafe')} · ${pickName(locale, i2)}` })),
                    ...ingredients
                      .filter((i2) => i2.kind === 'retail')
                      .map((i2) => ({ value: i2.id, label: `${tr('ws.manager.stock.goodsIn.groupShop')} · ${pickName(locale, i2)}` })),
                  ]
                : ingredients.map((i2) => ({ value: i2.id, label: pickName(locale, i2) }))),
            ]}
          />
        </Field>
        <Button
          kind="ghost"
          size="sm"
          icon="x"
          disabled={busy || !removable}
          aria-label={tr('ws.manager.stock.goodsIn.removeLine', { n: fmt.num(index + 1) })}
          title={tr('ws.manager.stock.goodsIn.removeLine', { n: fmt.num(index + 1) })}
          onClick={onRemove}
          style={{ marginBlockEnd: 'var(--tp-sp-1)' }}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(9.5rem, 1fr))', gap: 'var(--tp-sp-2)', alignItems: 'start' }}>
        <Field label={withUnit(tr('ws.manager.stock.goodsIn.received'))} required style={{ marginBlockEnd: 0 }} error={problem === 'received' ? tr('ws.manager.stock.goodsIn.problem.received') : undefined}>
          <input style={inputStyle} dir="ltr" inputMode="decimal" value={line.qtyReceived} disabled={busy} onChange={(e) => onPatch({ qtyReceived: decimalKeystroke(e.target.value) })} />
        </Field>
        <Field
          label={withUnit(tr('ws.manager.stock.goodsIn.ordered'))}
          optional
          style={{ marginBlockEnd: 0 }}
          error={problem === 'ordered' ? tr('ws.manager.stock.goodsIn.problem.ordered') : undefined}
          hint={short ? <span style={{ color: 'var(--tp-warn-fg)', fontWeight: 600 }}>{tr('ws.manager.stock.goodsIn.short', { qty: fmt.num(Number(line.qtyExpected) - Number(line.qtyReceived)) })}</span> : undefined}
        >
          <input style={inputStyle} dir="ltr" inputMode="decimal" value={line.qtyExpected} disabled={busy} onChange={(e) => onPatch({ qtyExpected: decimalKeystroke(e.target.value) })} />
        </Field>
        <Field
          label={ingredient ? tr('ws.manager.stock.goodsIn.costPer', { unit: fmt.one(ingredient.unit) }) : tr('ws.manager.stock.goodsIn.cost')}
          required
          style={{ marginBlockEnd: 0 }}
          error={problem === 'cost' ? tr('ws.manager.stock.goodsIn.problem.cost') : undefined}
          hint={
            ingredient && ingredient.pack_size !== null && ingredient.pack_cost_iqd !== null ? (
              <bdi>
                {tr('ws.manager.stock.goodsIn.packPrice', { size: fmt.qty(ingredient.pack_size, ingredient.unit) })} <Money amount={ingredient.pack_cost_iqd} />
              </bdi>
            ) : undefined
          }
        >
          <input style={inputStyle} dir="ltr" inputMode="decimal" value={line.unitCostIqd} disabled={busy} onChange={(e) => onPatch({ unitCostIqd: decimalKeystroke(e.target.value) })} />
        </Field>
        <Field
          label={tr('ws.manager.stock.goodsIn.expiry')}
          optional
          hint={expiryHint}
          style={{ marginBlockEnd: 0 }}
          error={problem === 'expiry' ? tr('ws.manager.stock.goodsIn.problem.expiry') : undefined}
        >
          {/* `min` greys out the past in the picker; lineProblem catches a typed one and holds Record. */}
          <input
            style={inputStyle}
            type="date"
            dir="ltr"
            min={today}
            value={line.expiryDate}
            disabled={busy}
            onChange={(e) => onPatch({ expiryDate: e.target.value })}
          />
        </Field>
      </div>
    </li>
  );
}

/** Route alias for the spec name. */
export const GoodsReceivedScreen = ReceiveDelivery;
