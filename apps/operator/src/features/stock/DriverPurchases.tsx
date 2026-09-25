/**
 * Goods in ▸ "Bought by the driver" (build-contracts-2026-09-23 §2.15, §5.5;
 * plan §7.2). The driver records each shop visit on the phone: what was
 * bought, what was paid, where, and a photo of the receipt. Nothing reaches
 * stock until a manager receives it here.
 *
 * Two pieces, both mounted by ReceiveDelivery:
 *
 *  - DriverPurchasesPanel lists the purchases still to receive
 *    (app.purchases_to_receive), oldest first, above the ordinary delivery
 *    form. It renders nothing when there are none: the /ops row says when
 *    there are.
 *  - DriverPurchaseReceive is Goods in opened on one of them
 *    (/stock/receive?purchase=<id>). The lines are the driver's and cannot be
 *    swapped or added to; only what arrived and each batch's expiry are the
 *    manager's to say. Saving is ONE call, app.receive_purchase, which books
 *    every stock line as one delivery and marks the purchase in the same
 *    transaction. Two calls (receive, then mark) could leave a booked delivery
 *    with the purchase still "to receive", and receiving it again would book
 *    the stock twice.
 *
 * Each purchase also says whether the driver confirmed it was delivered to the
 * venue (app.confirm_purchase_delivery on the phone, purchase_delivery_confirm
 * §2.24.10, plan #70): "Delivered <time> by <name>", or not yet. Receiving
 * never waits for it: what reached the shelf is the manager's to count here,
 * and a purchase received first can still be confirmed afterwards.
 *
 * The quantities are in the ingredient's base unit (g, ml, pc), because the
 * driver's phone records them that way, and the cost per unit is the server's
 * price ÷ quantity (0166 receive_purchase), shown here so the manager sees the
 * figure that will land in stock. A line that is not stock (cleaning
 * supplies), or a stock line whose ingredient was switched off after it was
 * bought, is acknowledged instead, one by one.
 *
 * Still online-only, like the rest of Goods in: no queued mutation type. The
 * pure half (the payload reader, line kinds, draft checks, unit cost) is in
 * driverPurchasesLogic.ts, and the number boxes' keystroke filter in
 * decimalInput.ts, each with a node test.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDateTime, formatIQD, formatNumber, isolate } from '@touch/i18n';
import { appRpc, AppRpcError } from '../../lib/appRpc';
import { QK } from '../../lib/queries';
import { pickName, useLocale } from '../../lib/i18n';
import { useToast } from '../../components/toast';
import { useConfirm } from '../../components/ConfirmDialog';
import { Button, ErrorText, Field, inputStyle, Select, Skeleton } from '../../components/ui';
import { DescriptionList, EmptyState, MessagePresenter, Money, Panel, StatusBadge } from '../../components/kit';
import { Icon } from '../../components/icons';
import { CardTitle, MARK_FG } from '../ops/OpsVisuals';
import { todayIso } from '../admin/menu/availability';
import { PhotoViewer } from '../checklists/StaffPhoto';
import { IngredientName, useStockFormat } from './stockUi';
import { SK, fetchIngredients, fetchSuppliers } from './stockKeys';
import { decimalKeystroke } from './decimalInput';
import {
  deliveredWhen,
  lineDraftProblem,
  lineKind,
  readPurchases,
  unitCost,
  type DriverPurchase,
  type LineDraft,
  type PurchaseLine,
} from './driverPurchasesLogic';

/**
 * app.purchases_to_receive as returned: QK.purchasesToReceive holds the raw
 * payload, so /ops can read the same cache entry for its count, and
 * readPurchases (driverPurchasesLogic.ts) reads it defensively here.
 */
export function fetchPurchasesToReceive(): Promise<unknown> {
  return appRpc<unknown>('purchases_to_receive');
}

function lineName(l: PurchaseLine, locale: 'en' | 'ar'): string {
  if (l.name_en !== null && l.name_ar !== null) return pickName(locale, { name_en: l.name_en, name_ar: l.name_ar });
  return l.label ?? l.name_en ?? l.name_ar ?? '';
}

/** "Delivered 11:05 by Ali", or that the driver has not confirmed it yet. */
function DeliveredLine({ purchase }: { purchase: DriverPurchase }) {
  const { tr, locale } = useLocale();
  const when = deliveredWhen(purchase, locale);
  const style = { display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)' } as const;
  if (when === null) {
    return (
      <span data-delivered="no" style={{ ...style, color: 'var(--tp-muted-fg)' }}>
        <Icon name="hourglass" size={14} />
        {tr('ws.supplies.driver.notDelivered')}
      </span>
    );
  }
  return (
    <span data-delivered="yes" style={{ ...style, color: MARK_FG.success }}>
      <Icon name="checkCircle" size={14} />
      <bdi>
        {purchase.delivered_by_name
          ? tr('ws.supplies.driver.delivered', { time: when, name: isolate(purchase.delivered_by_name) })
          : tr('ws.supplies.driver.deliveredNoName', { time: when })}
      </bdi>
    </span>
  );
}

function useUnitWord() {
  const { tr } = useLocale();
  const fmt = useStockFormat();
  // A shopping-list line may be in packs, which the stock units do not have.
  // `count` 1 (or a "per" phrase) takes the unit for one: "1 pack", "per pc".
  return (u: string | null, count?: number) => {
    const single = count !== undefined && Math.abs(count) === 1;
    if (u === 'pack') return tr(single ? 'ws.supplies.unitOne.pack' : 'ws.supplies.unit.pack');
    return u ? (single ? fmt.one(u) : fmt.unit(u)) : '';
  };
}

// ---------------------------------------------------------------------------
// The list on Goods in
// ---------------------------------------------------------------------------

export function DriverPurchasesPanel() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: QK.purchasesToReceive, queryFn: fetchPurchasesToReceive, refetchInterval: 60_000 });
  const purchases = useMemo(() => readPurchases(q.data), [q.data]);

  if (purchases.length === 0 && !q.isError) return null;
  return (
    <Panel
      title={<CardTitle icon="package">{tr('ws.supplies.driver.title')}</CardTitle>}
      actions={purchases.length > 0 ? <StatusBadge tone="warn" label={tr('ws.supplies.driver.badge', { count: formatNumber(purchases.length, locale) })} /> : undefined}
      data-testid="driver-purchases"
    >
      {purchases.length === 0 ? (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <ErrorText error={q.error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
            {tr('ws.kit.async.retry')}
          </Button>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0, marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.supplies.driver.lead')}</p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {purchases.map((p) => (
              <li
                key={p.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--tp-sp-2)',
                  flexWrap: 'wrap',
                  paddingBlock: 'var(--tp-sp-1-5)',
                  paddingInline: 'var(--tp-sp-2)',
                  borderRadius: 'var(--tp-radius-ctl)',
                  background: 'var(--tp-surface-2)',
                }}
              >
                <span style={{ display: 'grid', flex: '1 1 14rem', minInlineSize: 0 }}>
                  <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                    <bdi>{p.staff_name ?? '—'}</bdi> · <bdi>{p.shop_name ?? tr('ws.supplies.driver.noShop')}</bdi>
                  </span>
                  <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                    <bdi>{p.bought_at ? formatDateTime(new Date(p.bought_at), locale) : '—'}</bdi>
                    {' · '}
                    {tr('ws.supplies.driver.items', { count: formatNumber(p.lines.filter((l) => l.status === 'to_receive').length, locale) })}
                  </span>
                  <DeliveredLine purchase={p} />
                </span>
                <Money amount={p.total_iqd} strong />
                {/* Soft, not primary: one row per purchase, and the page's one
                    primary action is Record delivery below. */}
                <Button size="sm" kind="soft" icon="box" onClick={() => void navigate({ to: '/stock/receive', search: { purchase: p.id } })}>
                  {tr('ws.supplies.driver.receive')}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Goods in opened on one purchase
// ---------------------------------------------------------------------------

export function DriverPurchaseReceive({ purchaseId, onBack }: { purchaseId: string; onBack: () => void }) {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const unitWord = useUnitWord();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const q = useQuery({ queryKey: QK.purchasesToReceive, queryFn: fetchPurchasesToReceive });
  const purchase = useMemo(() => readPurchases(q.data).find((p) => p.id === purchaseId) ?? null, [q.data, purchaseId]);
  const ingredientsQ = useQuery({ queryKey: SK.ingredients, queryFn: fetchIngredients });
  const suppliersQ = useQuery({ queryKey: SK.suppliers, queryFn: fetchSuppliers });
  const suppliers = (suppliersQ.data ?? []).filter((s) => s.is_active);
  const shelfLife = new Map((ingredientsQ.data ?? []).map((i) => [i.id, i.shelf_life_days]));

  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [supplierId, setSupplierId] = useState('');
  const [supplier, setSupplier] = useState('');
  /** One key per receive: kept across retries, renewed after a received one (§5.3). */
  const [idemKey, setIdemKey] = useState(() => `purchase.receive:${crypto.randomUUID()}`);
  const [busy, setBusy] = useState(false);
  const [ackBusy, setAckBusy] = useState<string | null>(null);
  /** The receive's refusal, shown beside Receive into stock. */
  const [error, setError] = useState<unknown>(null);
  /** A Mark checked that failed, shown under that line rather than beside a button it did not come from. */
  const [ackFailed, setAckFailed] = useState<{ lineId: string; error: unknown } | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  if (q.isPending) {
    return (
      <Panel>
        <Skeleton lines={3} />
      </Panel>
    );
  }
  // A read that failed says so and offers a retry. It is not "received
  // elsewhere": nothing is known about the purchase until a read succeeds.
  if (!purchase && q.isError) {
    return (
      <Panel data-testid="driver-purchase-read-failed">
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <ErrorText error={q.error} style={{ marginBlock: 0 }} />
          <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
            <Button size="sm" icon="refresh" busy={q.isFetching} onClick={() => void q.refetch()}>
              {tr('ws.kit.async.retry')}
            </Button>
            <Button size="sm" kind="ghost" icon="chevronStart" onClick={onBack}>
              {tr('ws.supplies.purchase.back')}
            </Button>
          </div>
        </div>
      </Panel>
    );
  }
  if (!purchase) {
    return (
      <Panel>
        <EmptyState
          icon="package"
          title={tr('ws.supplies.purchase.gone')}
          body={tr('ws.supplies.purchase.goneBody')}
          action={
            <Button icon="chevronStart" onClick={onBack}>
              {tr('ws.supplies.purchase.back')}
            </Button>
          }
        />
      </Panel>
    );
  }

  const today = todayIso();
  const pending = purchase.lines.filter((l) => l.status === 'to_receive');
  const stockLines = pending.filter((l) => lineKind(l) === 'stock');
  const otherLines = pending.filter((l) => lineKind(l) !== 'stock');
  // A switched-off line holds the receive, so it is listed inside Into stock,
  // right above the button it holds; "Not for stock" used to carry it below
  // that button, under a lead about cleaning supplies. With no stock line to
  // receive there is no button to hold, and it joins the others.
  const switchedLines = stockLines.length > 0 ? otherLines.filter((l) => lineKind(l) === 'switchedOff') : [];
  const notStockLines = stockLines.length > 0 ? otherLines.filter((l) => lineKind(l) !== 'switchedOff') : otherLines;
  const doneLines = purchase.lines.filter((l) => l.status !== 'to_receive');
  const draftOf = (l: PurchaseLine): LineDraft => drafts[l.id] ?? { received: String(l.qty), expiry: '' };
  const problems = new Map(stockLines.map((l) => [l.id, lineDraftProblem(draftOf(l), today)]));
  const switchedOff = otherLines.some((l) => lineKind(l) === 'switchedOff');
  const invalid = [...problems.values()].some((p) => p !== null);
  const blockReason = switchedOff ? tr('ws.supplies.purchase.receiveDisabled.switchedOff') : invalid ? tr('ws.supplies.purchase.receiveDisabled.invalid') : undefined;

  function patch(id: string, part: Partial<LineDraft>, line: PurchaseLine) {
    setDrafts((d) => ({ ...d, [id]: { ...draftOf(line), ...part } }));
  }

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: QK.purchasesToReceive });
    void queryClient.invalidateQueries({ queryKey: QK.stock.all });
  }

  async function receive() {
    if (!purchase || blockReason) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('receive_purchase', {
        p_purchase_id: purchase.id,
        p_lines: stockLines.map((l) => {
          const d = draftOf(l);
          return { purchase_line_id: l.id, qty_received: Number(d.received), expiry_date: d.expiry || null };
        }),
        p_supplier_id: supplierId || null,
        p_supplier_name: supplierId ? null : supplier.trim() || null,
        p_idempotency_key: idemKey,
      });
      setIdemKey(`purchase.receive:${crypto.randomUUID()}`);
      toast.ok(tr('ws.supplies.purchase.receivedToast'));
      refresh();
      // Nothing else on it to check: the purchase is done and leaves the list.
      if (otherLines.length === 0) onBack();
    } catch (e) {
      setError(e);
      // A line switched off while this form was open: re-read, so it moves to
      // the lines to mark checked.
      if (e instanceof AppRpcError && e.code === 'INGREDIENT_NOT_FOUND' && e.hint === 'lines') void q.refetch();
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge(line: PurchaseLine) {
    if (!purchase) return;
    if (lineKind(line) === 'switchedOff') {
      const ok = await confirm({
        title: tr('ws.supplies.purchase.confirmSwitchedOffTitle', { name: isolate(lineName(line, locale)) }),
        body: tr('ws.supplies.purchase.confirmSwitchedOffBody'),
        confirmLabel: tr('ws.supplies.purchase.acknowledge'),
      });
      if (!ok) return;
    }
    setAckBusy(line.id);
    setError(null);
    setAckFailed(null);
    try {
      await appRpc('acknowledge_purchase_line', { p_line_id: line.id });
      toast.ok(tr('ws.supplies.purchase.acknowledgedToast'));
      refresh();
      if (pending.length === 1) onBack();
    } catch (e) {
      setAckFailed({ lineId: line.id, error: e });
    } finally {
      setAckBusy(null);
    }
  }

  const errorIsSwitchedOff = error instanceof AppRpcError && error.code === 'INGREDIENT_NOT_FOUND' && error.hint === 'lines';

  /** A line that is only marked checked: not stock, or stock switched off since it was bought. */
  const ackRow = (l: PurchaseLine) => (
    <li
      key={l.id}
      data-line={l.id}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--tp-sp-2)',
        flexWrap: 'wrap',
        paddingBlock: 'var(--tp-sp-1-5)',
        paddingInline: 'var(--tp-sp-2)',
        borderRadius: 'var(--tp-radius-ctl)',
        background: 'var(--tp-surface-2)',
      }}
    >
      <span style={{ display: 'grid', flex: '1 1 14rem', minInlineSize: 0, gap: 'var(--tp-sp-0)' }}>
        <bdi style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{lineName(l, locale)}</bdi>
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          <bdi>
            {l.unit ? tr('op.stock.qty', { qty: fmt.num(l.qty), unit: unitWord(l.unit, l.qty) }) : fmt.num(l.qty)}
            {' · '}
            {formatIQD(l.price_iqd, locale)}
          </bdi>
        </span>
        {lineKind(l) === 'switchedOff' && <span style={{ fontSize: 'var(--tp-fs-sm)', color: MARK_FG.warn }}>{tr('ws.supplies.purchase.switchedOff')}</span>}
      </span>
      <Button size="sm" icon="check" busy={ackBusy === l.id} disabled={busy || (ackBusy !== null && ackBusy !== l.id)} onClick={() => void acknowledge(l)}>
        {tr('ws.supplies.purchase.acknowledge')}
      </Button>
      {ackFailed?.lineId === l.id && <ErrorText error={ackFailed.error} style={{ flexBasis: '100%', marginBlock: 0 }} />}
    </li>
  );

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <Panel
        title={<CardTitle icon="package">{tr('ws.supplies.purchase.detailsTitle')}</CardTitle>}
        actions={
          purchase.receipt_path ? (
            <Button size="sm" icon="receipt" onClick={() => setShowReceipt(true)}>
              {tr('ws.supplies.purchase.receipt')}
            </Button>
          ) : (
            <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.supplies.purchase.noReceipt')}</span>
          )
        }
      >
        <DescriptionList
          columns={3}
          items={[
            { label: tr('ws.supplies.purchase.boughtBy'), value: <bdi>{purchase.staff_name ?? '—'}</bdi> },
            { label: tr('ws.supplies.purchase.where'), value: <bdi>{purchase.shop_name ?? tr('ws.supplies.driver.noShop')}</bdi> },
            { label: tr('ws.supplies.purchase.when'), value: <bdi>{purchase.bought_at ? formatDateTime(new Date(purchase.bought_at), locale) : '—'}</bdi> },
            { label: tr('ws.supplies.purchase.paid'), value: <Money amount={purchase.total_iqd} strong />, numeric: true },
            { label: tr('ws.supplies.purchase.delivery'), value: <DeliveredLine purchase={purchase} /> },
          ]}
        />
      </Panel>

      {stockLines.length > 0 && (
        <Panel title={tr('ws.supplies.purchase.stockTitle')}>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0, marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.supplies.purchase.stockLead')}</p>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
            {stockLines.map((l) => {
              const d = draftOf(l);
              const problem = problems.get(l.id) ?? null;
              const unit = unitWord(l.unit);
              const received = Number(d.received);
              const shortBy = problem === null && received < l.qty ? l.qty - received : 0;
              const days = l.ingredient_id ? shelfLife.get(l.ingredient_id) : undefined;
              return (
                <li
                  key={l.id}
                  data-line={l.id}
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
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2)', alignItems: 'baseline', justifyContent: 'space-between' }}>
                    <IngredientName name={lineName(l, locale)} strong />
                    <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                      <bdi>{tr('ws.supplies.purchase.bought', { qty: fmt.qty(l.qty, l.unit ?? '') })}</bdi>
                      {' · '}
                      <bdi>{tr('ws.supplies.purchase.costEach', { amount: formatIQD(l.price_iqd, locale), cost: fmt.cost(unitCost(l)), unit: unitWord(l.unit, 1) })}</bdi>
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: 'var(--tp-sp-2)', alignItems: 'start' }}>
                    <Field
                      label={tr('ws.supplies.purchase.received', { unit })}
                      required
                      style={{ marginBlockEnd: 0 }}
                      error={problem === 'received' ? tr('ws.supplies.purchase.receivedInvalid') : undefined}
                      hint={
                        shortBy > 0 ? (
                          <span style={{ color: 'var(--tp-warn-fg)', fontWeight: 600 }}>{tr('ws.supplies.purchase.short', { qty: fmt.num(shortBy) })}</span>
                        ) : problem === null && received > l.qty ? (
                          <span style={{ color: 'var(--tp-warn-fg)', fontWeight: 600 }}>{tr('ws.supplies.purchase.over')}</span>
                        ) : undefined
                      }
                    >
                      <input
                        style={inputStyle}
                        dir="ltr"
                        inputMode="decimal"
                        value={d.received}
                        disabled={busy}
                        onChange={(e) => patch(l.id, { received: decimalKeystroke(e.target.value) }, l)}
                      />
                    </Field>
                    <Field
                      label={tr('ws.manager.stock.goodsIn.expiry')}
                      optional
                      style={{ marginBlockEnd: 0 }}
                      hint={days === undefined ? undefined : days !== null ? tr('ws.manager.stock.goodsIn.expiryAuto', { days: fmt.num(days) }) : tr('ws.manager.stock.goodsIn.expiryNone')}
                      error={problem === 'expiry' ? tr('ws.manager.stock.goodsIn.problem.expiry') : undefined}
                    >
                      <input style={inputStyle} type="date" dir="ltr" min={today} value={d.expiry} disabled={busy} onChange={(e) => patch(l.id, { expiry: e.target.value }, l)} />
                    </Field>
                  </div>
                </li>
              );
            })}
          </ol>
          {switchedLines.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)', marginBlockStart: 'var(--tp-sp-2)' }}>{switchedLines.map(ackRow)}</ul>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', columnGap: 'var(--tp-sp-2-5)', marginBlockStart: 'var(--tp-sp-3)' }}>
            <Field
              label={tr('ws.manager.stock.goodsIn.supplier')}
              optional
              hint={supplierId === '' && supplier.trim() === '' && purchase.shop_name ? <bdi>{tr('ws.supplies.purchase.supplierBlank', { shop: isolate(purchase.shop_name) })}</bdi> : undefined}
            >
              {suppliers.length > 0 ? (
                <Select
                  value={supplierId}
                  disabled={busy}
                  onChange={setSupplierId}
                  options={[{ value: '', label: tr('ws.manager.stock.goodsIn.supplierOther') }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]}
                />
              ) : null}
              {supplierId === '' && (
                <input
                  style={{ ...inputStyle, ...(suppliers.length > 0 ? { marginBlockStart: 'var(--tp-sp-1-5)' } : {}) }}
                  value={supplier}
                  maxLength={80}
                  disabled={busy}
                  placeholder={suppliers.length > 0 ? tr('ws.manager.stock.goodsIn.supplierTyped') : undefined}
                  onChange={(e) => setSupplier(e.target.value)}
                />
              )}
            </Field>
          </div>

          {errorIsSwitchedOff ? (
            <MessagePresenter tone="refused" message={tr('ws.supplies.purchase.ingredientSwitchedOff')} style={{ marginBlockEnd: 'var(--tp-sp-2)' }} />
          ) : (
            <ErrorText error={error} />
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button kind="primary" icon="box" busy={busy} disabled={Boolean(blockReason) || ackBusy !== null} disabledReason={blockReason} onClick={() => void receive()}>
              {tr('ws.supplies.purchase.receiveBtn')}
            </Button>
          </div>
        </Panel>
      )}

      {notStockLines.length > 0 && (
        <Panel title={tr('ws.supplies.purchase.notStockTitle')}>
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0, marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.supplies.purchase.notStockLead')}</p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>{notStockLines.map(ackRow)}</ul>
        </Panel>
      )}

      {doneLines.length > 0 && (
        <Panel title={tr('ws.supplies.purchase.doneTitle')} muted>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {doneLines.map((l) => (
              <li key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)' }}>
                <bdi style={{ flex: '1 1 12rem', minInlineSize: 0 }}>{lineName(l, locale)}</bdi>
                <StatusBadge size="sm" tone={l.status === 'received' ? 'success' : 'neutral'} label={tr(`work.purchase.status.${l.status}`)} />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {showReceipt && purchase.receipt_path && (
        <PhotoViewer title={tr('ws.supplies.purchase.receiptTitle')} paths={[purchase.receipt_path]} onClose={() => setShowReceipt(false)} />
      )}
    </div>
  );
}
