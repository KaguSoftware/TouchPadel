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
 *
 * Wave 5 (wave5-addendum-2026-09-25 §2.8.2 D4, §5.2): every delivery names
 * its store, "Put it in: Cafe store / Bakery store", the cafe store by
 * default. The picker sits at the top of the form because it decides which
 * lines are allowed: shop stock lives in the cafe store only (V14), so the
 * bakery store is off while a shop line is on the form, and with the bakery
 * store picked the shop's products leave the ingredient list. A store with a
 * manager's count open takes no delivery (STORE_BEING_COUNTED, M5), and the
 * form says so before the whole delivery is typed. What staff added on the
 * phone waits above the form for its cost (StaffLogs.tsx).
 *
 * Invoice layout (owner's pick, 2026-09-27): the typed delivery is a table in
 * the invoice's own column order with a line total per row and the delivery's
 * total beside Record, to tick against the paper. What waits to be received
 * (scanned receipts, the driver's purchases, staff additions) folds into one
 * row of counts that opens each list in place, and Scan sits in the header.
 */
import { useId, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { formatNumber } from '@touch/i18n';
import { appRpc, AppRpcError } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { Button, ErrorText, Field, inputStyle, Select } from '../../components/ui';
import { Money, PageHeader, Panel, StatusBadge } from '../../components/kit';
import { Icon } from '../../components/icons';
import { QK } from '../../lib/queries';
import { StoreCountedNotice, StorePicker, useStockFormat } from './stockUi';
import { todayIso } from '../admin/menu/availability';
import { isBlankLine, isShort, lineProblem, parseQty, unitCostFromPack, type DeliveryLineDraft } from './stockLogic';
import { SK, fetchIngredients, fetchStaffLogs, fetchSuppliers, fetchUnfinishedCounts, type IngredientRow } from './stockKeys';
import { DriverPurchaseReceive, DriverPurchasesPanel, fetchPurchasesToReceive } from './DriverPurchases';
import { readPurchases } from './driverPurchasesLogic';
import { ReceiptsPanel, ScanReceiptButton, fetchReceipts } from './receipts/ReceiptsPanel';
import { readReceipts } from './receipts/receiptLogic';
import { ReceiptReview } from './receipts/ReceiptReview';
import { StaffLogs } from './StaffLogs';
import { beingCounted, linesNeedingCost, readStaffLogs, storesForScope, type StockLocation } from './storeLogic';
import { useStockScope } from './stockScope';
import { decimalKeystroke } from './decimalInput';
import { SupplierField } from './SupplierField';

export { isShort } from './stockLogic';

export interface DraftLine extends DeliveryLineDraft {
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
  const { purchase, receipt } = useSearch({ strict: false }) as { purchase?: string; receipt?: string };
  if (receipt && !purchase) {
    return (
      <div style={{ maxInlineSize: '80rem' }}>
        <PageHeader
          title={tr('ws.receipts.review.title')}
          actions={
            <Button kind="ghost" size="sm" icon="chevronStart" onClick={() => void navigate({ to: '/stock/receive' })}>
              {tr('ws.receipts.review.back')}
            </Button>
          }
        />
        <ReceiptReview key={receipt} receiptId={receipt} onBack={() => void navigate({ to: '/stock/receive' })} />
      </div>
    );
  }
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

/** Something waiting to be received that is not typed in here. */
type Waiting = 'receipts' | 'driver' | 'staff';

/**
 * What is waiting to be received, as one row of counts above the form: the
 * scanned receipts, the driver's purchases and what staff added on the phone
 * without a cost. Each opens its own panel beneath the row, one at a time, so
 * the delivery form is no longer pushed down by three lists. The queries are
 * the panels' own keys, so opening one reads nothing twice.
 */
function WaitingWork() {
  const { tr, locale } = useLocale();
  const [open, setOpen] = useState<Waiting | null>(null);
  const receiptsQ = useQuery({ queryKey: SK.receipts, queryFn: fetchReceipts, refetchInterval: 60_000 });
  const driverQ = useQuery({ queryKey: QK.purchasesToReceive, queryFn: fetchPurchasesToReceive, refetchInterval: 60_000 });
  const staffQ = useQuery({ queryKey: SK.staffLogs, queryFn: fetchStaffLogs, refetchInterval: 60_000 });
  const staffLogs = readStaffLogs(staffQ.data ?? []);

  const items: { key: Waiting; label: string; count: number; show: boolean; tone: string }[] = [
    { key: 'receipts', label: tr('ws.receipts.panel.title'), count: readReceipts(receiptsQ.data).length, show: false, tone: 'var(--tp-info-fg)' },
    { key: 'driver', label: tr('ws.supplies.driver.title'), count: readPurchases(driverQ.data).length, show: driverQ.isError, tone: 'var(--tp-success-mark)' },
    // Staff logs stay reachable while any exist, costed or not: the panel is
    // also where a cost already set gets corrected.
    { key: 'staff', label: tr('ws.manager.stock.goodsIn.waiting.staff'), count: linesNeedingCost(staffLogs), show: staffLogs.length > 0 || staffQ.isError, tone: 'var(--tp-warn-mark)' },
  ];
  items[0]!.show = items[0]!.count > 0 || receiptsQ.isError;
  items[1]!.show = items[1]!.show || items[1]!.count > 0;
  const shown = items.filter((i) => i.show);
  if (shown.length === 0) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <div role="group" aria-label={tr('ws.manager.stock.goodsIn.waiting.title')} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2)', alignItems: 'center' }}>
        {shown.map((item) => {
          const expanded = open === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-expanded={expanded}
              aria-controls={`goods-in-waiting-${item.key}`}
              data-testid={`goods-in-waiting-${item.key}`}
              onClick={() => setOpen(expanded ? null : item.key)}
              className="tp-hoverable"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--tp-sp-2)',
                paddingBlock: 'var(--tp-sp-1-5)',
                paddingInline: 'var(--tp-sp-3)',
                borderRadius: 'var(--tp-radius-ctl)',
                border: `1px solid ${expanded ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
                background: expanded ? 'var(--tp-accent-soft)' : 'var(--tp-surface)',
                color: expanded ? 'var(--tp-accent-soft-fg)' : 'var(--tp-fg)',
                font: 'inherit',
                fontSize: 'var(--tp-fs-sm)',
                cursor: 'pointer',
              }}
            >
              <span aria-hidden="true" style={{ inlineSize: 8, blockSize: 8, borderRadius: '50%', background: item.tone, flex: 'none' }} />
              <span>{item.label}</span>
              {item.count > 0 && <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatNumber(item.count, locale)}</strong>}
              <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={14} />
            </button>
          );
        })}
      </div>
      {open && (
        <div id={`goods-in-waiting-${open}`}>
          {open === 'receipts' && <ReceiptsPanel scan={false} />}
          {open === 'driver' && <DriverPurchasesPanel />}
          {open === 'staff' && <StaffLogs />}
        </div>
      )}
    </div>
  );
}

/** A line's value in IQD, received × cost, once both are numbers; null until then. */
function lineTotal(line: DeliveryLineDraft): number | null {
  const received = Number(line.qtyReceived);
  const cost = Number(line.unitCostIqd);
  if (line.qtyReceived.trim() === '' || line.unitCostIqd.trim() === '' || !Number.isFinite(received) || !Number.isFinite(cost)) return null;
  return Math.round(received * cost);
}

/**
 * One delivery typed in by hand, laid out like the supplier's invoice (owner's
 * pick of four, 2026-09-27): who it came from and where it goes at the top, a
 * row per line in the invoice's own column order, each line's value and the
 * delivery's total at the foot so the sum can be ticked against the paper
 * before it is recorded.
 */
function DeliveryForm() {
  const { tr, locale } = useLocale();
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
  // 0245: the café's Goods in takes café and bakery stock; the shop desk's
  // takes shop stock into the shop store and nowhere else.
  const scope = useStockScope();
  const stores = storesForScope(scope);
  /** The store the delivery goes into (wave 5): the scope's first unless the manager says otherwise. */
  const [location, setLocation] = useState<StockLocation>(() => stores[0]!);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const suppliersQ = useQuery({ queryKey: SK.suppliers, queryFn: fetchSuppliers });
  const countsQ = useQuery({ queryKey: SK.unfinishedCounts, queryFn: fetchUnfinishedCounts, refetchInterval: 60_000 });
  const suppliers = (suppliersQ.data ?? []).filter((s) => s.is_active);
  // Prepared items are made in the kitchen, not delivered — they have their
  // own form under Waste & production. Shop stock (retail) is delivered at the
  // shop desk, into the shop store only (0245).
  const deliverable = (ingredientsQ.data ?? []).filter(
    (i) => i.is_active && (scope === 'shop' ? i.kind === 'retail' : i.kind === 'purchased'),
  );
  const byId = new Map(deliverable.map((i) => [i.id, i]));
  const ingredients = deliverable;

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
  const counted = beingCounted(countsQ.data, location);
  const canRecord = started.length > 0 && problems.length === 0 && !counted;
  const totals = started.map(lineTotal);
  const total = totals.some((t) => t !== null) ? totals.reduce<number>((sum, t) => sum + (t ?? 0), 0) : null;

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
        p_location: location,
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
      if (e instanceof AppRpcError && e.code === 'STORE_BEING_COUNTED') void countsQ.refetch();
    } finally {
      setBusy(false);
    }
  }

  const th = (label: string, opts: { end?: boolean; required?: boolean; width?: string } = {}) => (
    <th
      scope="col"
      style={{
        textAlign: opts.end ? 'end' : 'start',
        inlineSize: opts.width,
        paddingBlock: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-1-5)',
        fontSize: 'var(--tp-fs-sm)',
        fontWeight: 600,
        color: 'var(--tp-muted-fg)',
        borderBlockEnd: '1px solid var(--tp-border-strong)',
        whiteSpace: 'nowrap',
      }}
    >
      <span className={opts.required ? 'tp-req' : undefined}>{label}</span>
    </th>
  );

  return (
    // Full width, like On hand: on the shop desk there is no sub-nav beside
    // it, and a cap left a band of bare page at the end of the table.
    <div>
      <PageHeader
        title={tr('op.stockNav.receive')}
        subtitle={tr('ws.manager.stock.goodsIn.lead')}
        // The café photographs its suppliers' receipts; the shop desk types its deliveries in.
        actions={scope === 'venue' ? <ScanReceiptButton /> : undefined}
      />

      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
        {scope === 'venue' && <WaitingWork />}

        <Panel title={tr('ws.manager.stock.goodsIn.linesTitle')} padded={false}>
          {/* The invoice's head: who it came from, where it goes, its number. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))',
              columnGap: 'var(--tp-sp-4)',
              alignItems: 'start',
              padding: 'var(--tp-sp-4)',
              paddingBlockEnd: 0,
            }}
          >
            <Field label={tr('ws.manager.stock.goodsIn.supplier')} optional>
              <SupplierField
                suppliers={suppliers}
                supplierId={supplierId}
                name={supplier}
                disabled={busy}
                onChange={(id, name) => {
                  setSupplierId(id);
                  setSupplier(name);
                }}
              />
            </Field>
            {stores.length > 1 && (
              <div style={{ marginBlockEnd: 'var(--tp-sp-4)' }}>
                <StorePicker
                  label={tr('ws.stores.picker.putIn')}
                  value={location}
                  onChange={setLocation}
                  disabled={busy}
                  stores={stores}
                  data-testid="goods-in-store"
                />
              </div>
            )}
            <Field label={tr('ws.manager.stock.goodsIn.notes')} optional>
              <input style={inputStyle} value={notes} disabled={busy} placeholder={tr('ws.manager.stock.goodsIn.notesPlaceholder')} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
          {counted && (
            <div style={{ paddingInline: 'var(--tp-sp-4)', marginBlockEnd: 'var(--tp-sp-3)' }}>
              <StoreCountedNotice store={location} />
            </div>
          )}

          {/* A failed ingredient read left an empty "Choose…" list with no word
              about why: say so, with the way to read it again. */}
          {ingredientsQ.isError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', paddingInline: 'var(--tp-sp-4)', marginBlockEnd: 'var(--tp-sp-3)' }}>
              <ErrorText error={ingredientsQ.error} style={{ marginBlock: 0 }} />
              <Button size="sm" icon="refresh" busy={ingredientsQ.isFetching} onClick={() => void ingredientsQ.refetch()}>
                {tr('ws.kit.async.retry')}
              </Button>
            </div>
          )}

          {/* The lines, one row each. Wider than a narrow window, so the table
              scrolls inside its own box and the page never does. */}
          <div style={{ overflowX: 'auto', paddingInline: 'var(--tp-sp-2-5)', borderBlockStart: '1px solid var(--tp-border)' }}>
            <table style={{ inlineSize: '100%', minInlineSize: '54rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {th('#', { width: '2rem' })}
                  {th(tr('ws.manager.stock.goodsIn.ingredient'), { required: true, width: '24%' })}
                  {th(tr('ws.manager.stock.goodsIn.received'), { required: true })}
                  {th(tr('ws.manager.stock.goodsIn.ordered'))}
                  {th(tr('ws.manager.stock.goodsIn.cost'), { required: true })}
                  {th(tr('ws.manager.stock.goodsIn.expiry'))}
                  {th(tr('ws.manager.stock.goodsIn.lineTotal'), { end: true })}
                  <th aria-hidden="true" style={{ inlineSize: '2.5rem', borderBlockEnd: '1px solid var(--tp-border-strong)' }} />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <DeliveryRow
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
              </tbody>
            </table>
          </div>

          <div style={{ padding: 'var(--tp-sp-3) var(--tp-sp-4)' }}>
            <Button icon="plus" disabled={busy} onClick={() => setLines((ls) => [...ls, emptyLine()])}>
              {tr('ws.manager.stock.goodsIn.addLine')}
            </Button>
          </div>

          {/* The foot: how many lines, which arrived short, the delivery's
              total, and Record. Sticks to the bottom of the window on a long
              invoice so the total and the button never scroll away. */}
          <div
            style={{
              position: 'sticky',
              insetBlockEnd: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--tp-sp-3)',
              flexWrap: 'wrap',
              padding: 'var(--tp-sp-3) var(--tp-sp-4)',
              borderBlockStart: '1px solid var(--tp-border)',
              background: 'var(--tp-surface)',
              borderEndStartRadius: 'var(--tp-radius-panel)',
              borderEndEndRadius: 'var(--tp-radius-panel)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', minInlineSize: 0 }}>
              {started.length === 0 ? (
                // The order of the work, said where the button waits for it.
                <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.stock.goodsIn.recordEmpty')}</span>
              ) : (
                <>
                  <strong>{tr('ws.manager.stock.goodsIn.lineCount', { count: formatNumber(started.length, locale) })}</strong>
                  {shortCount > 0 && (
                    <>
                      <StatusBadge tone="warn" label={tr('ws.manager.stock.goodsIn.shortCount', { count: formatNumber(shortCount, locale) })} />
                      <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.stock.goodsIn.shortLead')}</span>
                    </>
                  )}
                </>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-3)', flexWrap: 'wrap' }}>
              <span style={{ display: 'grid', justifyItems: 'end' }}>
                <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)', fontWeight: 600 }}>{tr('ws.manager.stock.goodsIn.total')}</span>
                <Money amount={total} strong style={{ fontSize: 'var(--tp-fs-lg)' }} />
              </span>
              <Button
                kind="primary"
                icon="box"
                busy={busy}
                disabled={!canRecord}
                disabledReason={counted ? tr('ws.stores.picker.held') : undefined}
                onClick={() => void submit()}
              >
                {tr('ws.manager.stock.goodsIn.record')}
              </Button>
            </div>
          </div>
          {error !== null && (
            <div style={{ paddingInline: 'var(--tp-sp-4)', paddingBlockEnd: 'var(--tp-sp-3)' }}>
              <ErrorText error={error} style={{ marginBlock: 0 }} />
            </div>
          )}
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

/**
 * The ingredient list a line picks from. The cafe/shop <optgroup> pair became
 * a prefixed flat list: SelectMenu draws its own panel and has no group row,
 * and a silent flattening would have lost which list an item came from —
 * retail and cafe ingredients can share a name.
 */
function useIngredientOptions(ingredients: IngredientRow[]) {
  const { tr, locale } = useLocale();
  return [
    { value: '', label: tr('ws.manager.stock.goodsIn.choose') },
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
  ];
}

interface LineProps {
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
}

/**
 * One table cell: the control, then either what is wrong with it or a hint.
 * The column header is the visible label; the control carries its own name
 * (with the unit) for a screen reader, since a row repeats every column.
 */
function Cell({ children, error, hint, end }: { children: (describedBy: string | undefined) => ReactNode; error?: string; hint?: ReactNode; end?: boolean }) {
  const id = useId();
  const describedBy = error ? `${id}-e` : hint ? `${id}-h` : undefined;
  return (
    <td style={{ paddingBlock: 'var(--tp-sp-1-5)', paddingInline: 'var(--tp-sp-1-5)', verticalAlign: 'top', textAlign: end ? 'end' : undefined }}>
      {children(describedBy)}
      {error ? (
        <span id={`${id}-e`} role="alert" style={{ display: 'block', marginBlockStart: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-danger-fg)', fontWeight: 600 }}>
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-h`} style={{ display: 'block', marginBlockStart: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
          {hint}
        </span>
      ) : null}
    </td>
  );
}

/** A number box with the ingredient's unit after it, so "24" is never read as the wrong unit. */
function UnitInput({ value, unit, label, describedBy, invalid, disabled, onChange }: { value: string; unit: string | null; label: string; describedBy?: string; invalid: boolean; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}>
      <input
        style={{ ...inputStyle, minInlineSize: 0 }}
        dir="ltr"
        inputMode="decimal"
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(decimalKeystroke(e.target.value))}
      />
      {unit && (
        <span aria-hidden="true" style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', flex: 'none' }}>
          {unit}
        </span>
      )}
    </span>
  );
}

/** One row of the delivery table. */
function DeliveryRow({ index, line, today, ingredients, ingredient, busy, removable, onChoose, onPatch, onRemove }: LineProps) {
  const { tr } = useLocale();
  const fmt = useStockFormat();
  const options = useIngredientOptions(ingredients);
  const problem = lineProblem(line, today);
  const short = isShort(line);
  const unit = ingredient ? fmt.unit(ingredient.unit) : null;
  const withUnit = (label: string) => (unit ? `${label} (${unit})` : label);
  const total = lineTotal(line);
  const expiryHint = !ingredient
    ? undefined
    : ingredient.shelf_life_days !== null
      ? tr('ws.manager.stock.goodsIn.expiryAuto', { days: fmt.num(ingredient.shelf_life_days) })
      : tr('ws.manager.stock.goodsIn.expiryNone');

  return (
    <tr
      data-testid="goods-in-line"
      style={{
        borderBlockEnd: '1px solid var(--tp-border)',
        // A line that arrived short is tinted, so it is found at a glance on a long invoice.
        background: short ? 'color-mix(in oklab, var(--tp-warn-soft) 55%, transparent)' : undefined,
      }}
    >
      <td style={{ paddingBlockStart: 'var(--tp-sp-3)', paddingInline: 'var(--tp-sp-1-5)', verticalAlign: 'top', color: 'var(--tp-muted-fg)', fontVariantNumeric: 'tabular-nums' }}>
        {fmt.num(index + 1)}
      </td>
      <Cell error={problem === 'ingredient' ? tr('ws.manager.stock.goodsIn.problem.ingredient') : undefined}>
        {(describedBy) => (
          <Select
            value={line.ingredientId}
            disabled={busy}
            onChange={onChoose}
            aria-label={tr('ws.manager.stock.goodsIn.ingredient')}
            aria-describedby={describedBy}
            aria-invalid={problem === 'ingredient' || undefined}
            options={options}
          />
        )}
      </Cell>
      <Cell error={problem === 'received' ? tr('ws.manager.stock.goodsIn.problem.received') : undefined}>
        {(describedBy) => (
          <UnitInput
            value={line.qtyReceived}
            unit={unit}
            label={withUnit(tr('ws.manager.stock.goodsIn.received'))}
            describedBy={describedBy}
            invalid={problem === 'received'}
            disabled={busy}
            onChange={(v) => onPatch({ qtyReceived: v })}
          />
        )}
      </Cell>
      <Cell
        error={problem === 'ordered' ? tr('ws.manager.stock.goodsIn.problem.ordered') : undefined}
        hint={short ? <span style={{ color: 'var(--tp-warn-fg)', fontWeight: 600 }}>{tr('ws.manager.stock.goodsIn.short', { qty: fmt.num(Number(line.qtyExpected) - Number(line.qtyReceived)) })}</span> : undefined}
      >
        {(describedBy) => (
          <UnitInput
            value={line.qtyExpected}
            unit={unit}
            label={withUnit(tr('ws.manager.stock.goodsIn.ordered'))}
            describedBy={describedBy}
            invalid={problem === 'ordered'}
            disabled={busy}
            onChange={(v) => onPatch({ qtyExpected: v })}
          />
        )}
      </Cell>
      <Cell
        error={problem === 'cost' ? tr('ws.manager.stock.goodsIn.problem.cost') : undefined}
        hint={
          ingredient && ingredient.pack_size !== null && ingredient.pack_cost_iqd !== null ? (
            <bdi>
              {tr('ws.manager.stock.goodsIn.packPrice', { size: fmt.qty(ingredient.pack_size, ingredient.unit) })} <Money amount={ingredient.pack_cost_iqd} />
            </bdi>
          ) : undefined
        }
      >
        {(describedBy) => (
          <UnitInput
            value={line.unitCostIqd}
            unit={ingredient ? `/ ${fmt.one(ingredient.unit)}` : null}
            label={ingredient ? tr('ws.manager.stock.goodsIn.costPer', { unit: fmt.one(ingredient.unit) }) : tr('ws.manager.stock.goodsIn.cost')}
            describedBy={describedBy}
            invalid={problem === 'cost'}
            disabled={busy}
            onChange={(v) => onPatch({ unitCostIqd: v })}
          />
        )}
      </Cell>
      <Cell error={problem === 'expiry' ? tr('ws.manager.stock.goodsIn.problem.expiry') : undefined} hint={expiryHint}>
        {(describedBy) => (
          // `min` greys out the past in the picker; lineProblem catches a typed one and holds Record.
          <input
            style={inputStyle}
            type="date"
            dir="ltr"
            min={today}
            aria-label={tr('ws.manager.stock.goodsIn.expiry')}
            aria-describedby={describedBy}
            aria-invalid={problem === 'expiry' || undefined}
            value={line.expiryDate}
            disabled={busy}
            onChange={(e) => onPatch({ expiryDate: e.target.value })}
          />
        )}
      </Cell>
      <td style={{ paddingBlockStart: 'var(--tp-sp-3)', paddingInline: 'var(--tp-sp-1-5)', verticalAlign: 'top', textAlign: 'end', whiteSpace: 'nowrap', fontWeight: 600 }}>
        <Money amount={total} unit={false} />
      </td>
      <td style={{ paddingBlockStart: 'var(--tp-sp-1-5)', verticalAlign: 'top', textAlign: 'end' }}>
        <Button
          kind="ghost"
          size="sm"
          icon="x"
          disabled={busy || !removable}
          aria-label={tr('ws.manager.stock.goodsIn.removeLine', { n: fmt.num(index + 1) })}
          title={tr('ws.manager.stock.goodsIn.removeLine', { n: fmt.num(index + 1) })}
          onClick={onRemove}
        />
      </td>
    </tr>
  );
}

/** One line of a delivery; also the scanned receipt's review lines (receipts/ReceiptReview.tsx), under `header`. */
export function LineEditor({
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
  header,
}: LineProps & {
  /** Above the ingredient: what the receipt said for this line. */
  header?: ReactNode;
}) {
  const { tr } = useLocale();
  const fmt = useStockFormat();
  const options = useIngredientOptions(ingredients);
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
      {header}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--tp-sp-2)' }}>
        <Field label={tr('ws.manager.stock.goodsIn.ingredient')} style={{ marginBlockEnd: 0, flex: 1, minInlineSize: 0 }} error={problem === 'ingredient' ? tr('ws.manager.stock.goodsIn.problem.ingredient') : undefined}>
          <Select value={line.ingredientId} disabled={busy} onChange={onChoose} options={options} />
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
