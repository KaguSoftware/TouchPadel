/**
 * TabDetailScreen (spec 06.13) — one tab, its lines and everything done to it
 * before payment. Hosts the payment pane (06.14), split (06.15), merge (06.16),
 * charge-to-booking (06.17) and refund (06.18) dialogs.
 *
 * Money: `computeTabTotals` is the tested display mirror of
 * app.compute_tab_totals; the server re-stamps every figure at settlement and
 * the change shown after a cash payment is the server's echo.
 *
 * States: loading · ready · busy · error · voidRefused (VOID_REQUIRES_REFUND —
 * the void control stays visible with the refusal beside it) · partiallyPaid ·
 * settled.
 *
 * Layout: three fixed zones — identity header, scrolling body, pay footer. The
 * cashier must be able to read WHICH tab this is and reach Pay without
 * scrolling, on a tab with two lines and on one with forty; and the pay target
 * must not move between those two tabs, or between any of the states above.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIQD } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc, AppRpcError } from '../../lib/appRpc';
import { deviceId } from '../../lib/idem';
import { mutate } from '../../lib/mutate';
import { touch } from '../../ipc/bridge';
import { useLocale, pickName } from '../../lib/i18n';
import { requiredRoleFor, usePermissions } from '../../lib/auth';
import { Button, ErrorText, Field, PinReasonModal, Skeleton, inputStyle } from '../../components/ui';
import { Kbd, MessagePresenter, Money, PermissionRefusedNotice, ReasonCodePrompt, TabStatusIndicator } from '../../components/kit';
import { Icon } from '../../components/icons';
import { computeTabTotals, discountBreakdown } from './tabTotals';
import { BillView } from './BillView';
import { MergeTabsDialog, OverridePriceDialog, RefundDialog } from './ManagerActions';
import { SplitBillDialog } from './SplitBillDialog';
import { ChargeToBookingDialog } from './ChargeToBookingDialog';
import { PaymentPane, type PaymentMethod } from './PaymentPane';
import { TILL_MENU_QUERY, tabDetailQuery, tabAnchorLabel, type TabLineRow } from './tillData';
import { kvRow, muted, numeric, sectionTitle } from './tillStyles';

type Overlay =
  | { kind: 'none' }
  | { kind: 'pay'; method: PaymentMethod }
  | { kind: 'split' }
  | { kind: 'discount' }
  | { kind: 'void'; lineId: string }
  | { kind: 'override'; lineId: string }
  | { kind: 'bill' }
  | { kind: 'refund' }
  | { kind: 'merge' }
  | { kind: 'charge' }
  | { kind: 'drawer' };

export function TabDetailPanel({
  tabId,
  onClosedTab,
  onSwitchTab,
}: {
  tabId: string;
  onClosedTab: () => void;
  /** The tab was merged into / replaced by another one — select that instead. */
  onSwitchTab: (id: string) => void;
}) {
  const { tr, locale } = useLocale();
  const can = usePermissions();
  const queryClient = useQueryClient();
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const [discountKind, setDiscountKind] = useState<'discount_percent' | 'discount_amount'>('discount_percent');
  const [discountValue, setDiscountValue] = useState(10);
  const [promoCode, setPromoCode] = useState('');
  const [promoNotice, setPromoNotice] = useState<{ tone: 'success' | 'refused'; text: string } | null>(null);
  const [drawerNoted, setDrawerNoted] = useState(false);
  const [voidRefused, setVoidRefused] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [pinError, setPinError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [lastChange, setLastChange] = useState<number | null>(null);

  const tabQ = useQuery(tabDetailQuery(tabId));

  // Tax rates come off the SAME ['menu'] cache the grid already holds.
  const menuForTaxQ = useQuery({ ...TILL_MENU_QUERY });
  const taxInclusiveQ = useQuery({
    queryKey: ['taxInclusive'],
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('venue_settings').select('tax_inclusive').single();
      if (error) throw error;
      return Boolean((data as { tax_inclusive: boolean }).tax_inclusive);
    },
  });
  const taxCtx = useMemo(() => {
    if (!menuForTaxQ.data || taxInclusiveQ.data === undefined) return null;
    return {
      rateByCategory: new Map(menuForTaxQ.data.categories.map((c) => [c.id, c.tax_group?.rate_bp ?? 0])),
      taxInclusive: taxInclusiveQ.data,
    };
  }, [menuForTaxQ.data, taxInclusiveQ.data]);

  const tab = tabQ.data;
  const totals = useMemo(() => computeTabTotals(tab ?? null, taxCtx), [tab, taxCtx]);
  const discounts = useMemo(() => discountBreakdown(tab?.tab_adjustments ?? []), [tab]);
  const due = totals.due;
  const settled = tab?.status === 'settled';

  // F4/F5 from anywhere on the till OPEN the pane (TillScreen dispatches);
  // money is confirmed by click only. Registered before any early return.
  const hotkeyGate = useRef({ settled: true, due: 0 });
  hotkeyGate.current = { settled: Boolean(settled), due };
  useEffect(() => {
    function onHotkey(e: Event) {
      if (hotkeyGate.current.settled || hotkeyGate.current.due <= 0) return;
      const method = (e as CustomEvent<PaymentMethod>).detail;
      setLastChange(null);
      setActionError(null);
      setOverlay({ kind: 'pay', method });
    }
    window.addEventListener('till-settle-hotkey', onHotkey);
    return () => window.removeEventListener('till-settle-hotkey', onHotkey);
  }, []);

  // A fresh tab id resets the one-shot notices.
  useEffect(() => {
    setLastChange(null);
    setPromoNotice(null);
    setVoidRefused(false);
    setDrawerNoted(false);
    setActionError(null);
    setOverlay({ kind: 'none' });
  }, [tabId]);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['tab', tabId] });
    void queryClient.invalidateQueries({ queryKey: ['tabs'] });
  }
  const close = () => setOverlay({ kind: 'none' });

  async function settle(method: PaymentMethod, amountIqd: number | null, tenderedIqd: number | null) {
    setBusy(true);
    setActionError(null);
    try {
      const outcome = await mutate<{ status: string; change_iqd: number | null }>('tab.settle', {
        tabId,
        method,
        ...(amountIqd != null ? { amountIqd } : {}),
        ...(tenderedIqd != null ? { tenderedIqd } : {}),
      });
      if (outcome.result) {
        // The change shown is the SERVER's figure.
        setLastChange(outcome.result.change_iqd ?? null);
        refresh();
        if (outcome.result.status === 'settled') close();
      } else {
        // Queued offline: durably recorded, replays on reconnect. No server
        // echo yet, so no change figure is claimed.
        setLastChange(null);
        close();
        refresh();
      }
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  }

  async function recordDrawerOpen(reasonCode: string) {
    setBusy(true);
    setActionError(null);
    try {
      await appRpc('record_drawer_open', { p_reason_code: reasonCode, p_device_id: deviceId(), p_tab_id: tabId });
      setDrawerNoted(true);
      close();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  }

  async function applyDiscount(pin: string, reasonCode: string) {
    setBusy(true);
    setPinError(null);
    try {
      // The PIN rides in the payload and is re-verified server-side at replay.
      const outcome = await mutate('adjustment.apply', {
        kind: discountKind,
        tabId,
        value: discountKind === 'discount_percent' ? discountValue * 100 : discountValue,
        pin,
        reasonCode,
      });
      if (!outcome.queued) touch.pinObserved(pin);
      close();
      refresh();
    } catch (e) {
      setPinError(e);
    } finally {
      setBusy(false);
    }
  }

  async function voidLine(lineId: string, pin: string, reasonCode: string) {
    setBusy(true);
    setPinError(null);
    setVoidRefused(false);
    try {
      await appRpc('void_after_send', {
        p_order_item_id: lineId,
        p_pin: pin,
        p_reason_code: reasonCode,
        p_device_id: deviceId(),
      });
      touch.pinObserved(pin);
      close();
      refresh();
    } catch (e) {
      if (e instanceof AppRpcError && e.code === 'VOID_REQUIRES_REFUND') {
        setVoidRefused(true);
        close();
      } else {
        setPinError(e);
      }
    } finally {
      setBusy(false);
    }
  }

  async function applyPromotion() {
    setBusy(true);
    setActionError(null);
    setPromoNotice(null);
    try {
      const res = await appRpc<{ promotionId: string; amountIqd: number }>('apply_best_promotion', {
        p_tab_id: tabId,
        p_code: promoCode.trim() || null,
        p_idempotency_key: crypto.randomUUID(),
        p_device_id: deviceId(),
      });
      setPromoNotice({ tone: 'success', text: tr('ws.cashier.detail.promoApplied', { amount: formatIQD(Number(res?.amountIqd ?? 0), locale) }) });
      setPromoCode('');
      refresh();
    } catch (e) {
      if (e instanceof AppRpcError && e.code === 'NO_ELIGIBLE_PROMOTION') {
        setPromoNotice({ tone: 'refused', text: tr('ws.cashier.detail.promoNone') });
      } else if (e instanceof AppRpcError && e.code === 'CODE_INVALID') {
        setPromoNotice({ tone: 'refused', text: tr('ws.cashier.detail.promoCodeInvalid') });
      } else {
        setActionError(e);
      }
    } finally {
      setBusy(false);
    }
  }

  // ---- render ---------------------------------------------------------------
  if (tabQ.isError && !tab) {
    return (
      <section aria-label={tr('ws.cashier.till.regionTab')} style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start', paddingBlock: 'var(--tp-sp-3)' }}>
        <ErrorText error={tabQ.error} style={{ marginBlock: 0 }} />
        <Button icon="refresh" onClick={() => void tabQ.refetch()}>
          {tr('ws.kit.async.retry')}
        </Button>
      </section>
    );
  }
  if (!tab) {
    return (
      // The skeleton stands where the panel will: an identity line, the body,
      // and the pay block's own reserved height at the end (rulebook 9.1).
      <section
        aria-label={tr('ws.cashier.till.regionTab')}
        aria-busy="true"
        style={{ flex: '1 1 auto', blockSize: '100%', minBlockSize: 0, display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-3)', paddingBlock: 'var(--tp-sp-3)' }}
      >
        <Skeleton lines={1} blockSize="var(--tp-fs-2xl)" />
        <div style={{ flex: 1, minBlockSize: 0 }}>
          <Skeleton lines={6} />
        </div>
        <Skeleton lines={1} blockSize="var(--tp-tile-min-block)" />
      </section>
    );
  }

  const label = tabAnchorLabel(tab, tr('op.till.table'), tr('op.till.forReservation'));
  const liveOrders = tab.orders.filter((o) => o.status !== 'voided');
  const allLines = liveOrders.flatMap((o) => o.order_items);
  const partiallyPaid = !settled && totals.paid > 0 && due > 0;
  const overrideLine = overlay.kind === 'override' ? allLines.find((l) => l.id === overlay.lineId) : undefined;

  // Rulebook 4.3 — no dead ends. Only STATE gets a reason here: `busy` is
  // already spoken by the spinner on the control the operator just pressed.
  const nothingDue = due <= 0;
  const payBlockedReason = nothingDue ? tr('ws.cashier.payment.nothingDue') : undefined;

  return (
    /*
     * Three fixed zones (rulebook 5.1), and the outer flex column is what makes
     * them fixed: the identity header and the pay footer are siblings of the
     * scroller, not passengers inside it. Before this the whole panel scrolled
     * as one, so Cash and Card sat wherever the line count, the promotion box
     * and five conditional notices happened to leave them — the pay target
     * stood somewhere different on a part-paid tab than on a fresh one.
     */
    <section
      aria-label={tr('ws.cashier.till.regionTab')}
      aria-busy={busy || undefined}
      style={{ flex: '1 1 auto', blockSize: '100%', minBlockSize: 0, display: 'flex', flexDirection: 'column' }}
    >
      {/* ---- zone 1: identity, always on screen (rulebook 5.2) ---- */}
      <header
        style={{
          flex: '0 0 auto',
          display: 'grid',
          gap: 'var(--tp-sp-1)',
          paddingBlock: 'var(--tp-sp-3)',
          borderBlockEnd: '1px solid var(--tp-border)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
          <h2 style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700, minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <bdi>{label}</bdi>
          </h2>
          <TabStatusIndicator status={tab.status} size="sm" />
        </div>
        {tab.reservation_id && (
          <span style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>
            <Icon name="calendar" size={13} /> {tr('ws.cashier.detail.chargedTo')}
            {tab.reservation?.court && (
              <>
                {' · '}
                <bdi>{pickName(locale, tab.reservation.court)}</bdi>
              </>
            )}
          </span>
        )}
      </header>

      {/* ---- zone 2: everything that grows ---- */}
      <div style={{ flex: 1, minBlockSize: 0, overflowY: 'auto', display: 'grid', gap: 'var(--tp-sp-3)', alignContent: 'start', paddingBlock: 'var(--tp-sp-3)' }}>
        {/* ---- lines (TabLineList, sent = not editable, void = waste) ---- */}
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          <h3 style={sectionTitle}>{tr('ws.cashier.detail.linesTitle')}</h3>
          {allLines.length === 0 && <p style={muted}>{tr('ws.cashier.detail.noLines')}</p>}
          {liveOrders.map((o) => (
            <ul key={o.id} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
              {o.order_items.map((line) => (
                <TabLine
                  key={line.id}
                  line={line}
                  settled={Boolean(settled)}
                  busy={busy}
                  onOverride={() => setOverlay({ kind: 'override', lineId: line.id })}
                  onVoid={() => {
                    setVoidRefused(false);
                    setPinError(null);
                    setOverlay({ kind: 'void', lineId: line.id });
                  }}
                />
              ))}
            </ul>
          ))}
          {allLines.length > 0 && !settled && <p style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.cashier.detail.sentHint')}</p>}
          {voidRefused && <MessagePresenter tone="refused" message={tr('ws.cashier.detail.voidRefused')} />}
        </div>

        {/* ---- totals (TabTotals + AppliedPromotionRow) ---- */}
        <div style={{ display: 'grid', gap: 'var(--tp-sp-0)', borderBlockStart: '1px solid var(--tp-border)', paddingBlockStart: 'var(--tp-sp-2)' }}>
          <Row label={tr('common.subtotal')} amount={totals.subtotal} />
          {discounts.manager > 0 && <Row label={tr('ws.cashier.detail.managerDiscount')} amount={-discounts.manager} />}
          {discounts.promotion > 0 && (
            <Row
              label={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>
                  <Icon name="tag" size={13} /> {tr('ws.cashier.detail.promoAppliedRow')}
                </span>
              }
              amount={-discounts.promotion}
            />
          )}
          {totals.tax > 0 && <Row label={taxCtx?.taxInclusive ? tr('op.till.taxIncluded') : tr('op.till.tax')} amount={totals.tax} />}
          <Row label={tr('common.total')} amount={totals.total} strong />
          {totals.paid > 0 && <Row label={tr('ws.cashier.detail.paid')} amount={-totals.paid} />}
          {totals.paid > 0 && !settled && <Row label={tr('ws.cashier.detail.due')} amount={due} strong />}
          {lastChange != null && lastChange > 0 && <Row label={tr('op.till.change')} amount={lastChange} strong tone="success" />}
        </div>

        {/*
          The five conditional notices. They live inside the scroller, which the
          pay footer is deliberately not part of, so any combination of them can
          appear without the Cash button knowing about it.
        */}
        {partiallyPaid && <MessagePresenter tone="info" icon="banknote" message={tr('ws.cashier.payment.partiallyPaid', { amount: formatIQD(due, locale) })} />}
        {settled && <MessagePresenter tone="success" message={tr('op.till.paidInFull')} />}
        {drawerNoted && <MessagePresenter tone="success" icon="drawer" message={tr('op.till.drawerNoted')} />}
        <ErrorText error={actionError} />

        {/* ---- promotion (read-only result; the server chose it) ---- */}
        {!settled && allLines.length > 0 && (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
            <h3 style={sectionTitle}>{tr('ws.cashier.detail.promoTitle')}</h3>
            <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', alignItems: 'end' }}>
              <Field label={tr('ws.cashier.detail.promoCode')} style={{ marginBlockEnd: 0, flex: 1 }}>
                <input
                  style={inputStyle}
                  value={promoCode}
                  maxLength={32}
                  disabled={busy}
                  placeholder={tr('ws.cashier.detail.promoCodePlaceholder')}
                  onChange={(e) => setPromoCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !busy && void applyPromotion()}
                />
              </Field>
              <Button icon="tag" busy={busy} onClick={() => void applyPromotion()}>
                {tr('ws.cashier.detail.promoApply')}
              </Button>
            </div>
            {promoNotice && <MessagePresenter tone={promoNotice.tone} message={promoNotice.text} />}
            <p style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.cashier.detail.promoHint')}</p>
          </div>
        )}

        {/* ---- actions ---- */}
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          <h3 style={sectionTitle}>{tr('ws.cashier.detail.actionsTitle')}</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1-5)', alignItems: 'flex-start' }}>
            {!settled && (
              <>
                <Button
                  icon="split"
                  disabled={nothingDue || busy}
                  disabledReason={nothingDue ? tr('ws.cashier.detail.splitNothing') : undefined}
                  onClick={() => setOverlay({ kind: 'split' })}
                >
                  {tr('ws.cashier.detail.split')}
                </Button>
                <Button icon="tag" disabled={busy} onClick={() => { setPinError(null); setOverlay({ kind: 'discount' }); }}>
                  {tr('ws.cashier.detail.discount')}
                </Button>
                <Button icon="merge" disabled={busy} onClick={() => setOverlay({ kind: 'merge' })}>
                  {tr('ws.cashier.detail.merge')}
                </Button>
                {!tab.reservation_id && (
                  <Button icon="calendar" disabled={busy} onClick={() => setOverlay({ kind: 'charge' })}>
                    {tr('ws.cashier.detail.chargeBooking')}
                  </Button>
                )}
              </>
            )}
            <Button icon="receipt" disabled={busy} onClick={() => setOverlay({ kind: 'bill' })}>
              {tr('op.till.bill')}
            </Button>
            <Button icon="drawer" disabled={busy} onClick={() => setOverlay({ kind: 'drawer' })}>
              {tr('op.till.openDrawer')}
            </Button>
            {tab.payments.length > 0 && (
              <Button kind="danger" icon="undo" disabled={busy} onClick={() => setOverlay({ kind: 'refund' })}>
                {tr('op.till.refund')}
              </Button>
            )}
          </div>
          {tab.payments.length > 0 && !can.refund && (
            <PermissionRefusedNotice action={tr('ws.cashier.detail.refundAction')} requiredRole={requiredRoleFor('refund')} />
          )}
        </div>
      </div>

      {/*
        ---- zone 3: the pay footer, pinned ----
        Cash and Card land on the same two coordinates on every tab in every
        state, because nothing above them is allowed to push them. The row also
        reserves the height of a disabled-reason line, so stating the reason
        cannot move the button the reason is about.
      */}
      <div style={{ flex: '0 0 auto', borderBlockStart: '1px solid var(--tp-border)', paddingBlock: 'var(--tp-sp-2-5)', display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
        {!settled ? (
          <>
            <h3 style={sectionTitle}>{tr('ws.cashier.payment.title')}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--tp-sp-1-5)', alignItems: 'start', minBlockSize: '5rem' }}>
              <Button
                kind="primary"
                size="xl"
                icon="banknote"
                disabled={nothingDue || busy}
                disabledReason={payBlockedReason}
                title="F4"
                aria-label={tr('op.till.payCash')}
                style={{ inlineSize: '100%' }}
                onClick={() => {
                  setLastChange(null);
                  setActionError(null);
                  setOverlay({ kind: 'pay', method: 'cash' });
                }}
              >
                {tr('op.till.payCash')} <Kbd>F4</Kbd>
              </Button>
              <Button
                size="xl"
                icon="card"
                disabled={nothingDue || busy}
                disabledReason={payBlockedReason}
                title="F5"
                aria-label={tr('op.till.payCard')}
                style={{ inlineSize: '100%' }}
                onClick={() => {
                  setLastChange(null);
                  setActionError(null);
                  setOverlay({ kind: 'pay', method: 'card' });
                }}
              >
                {tr('op.till.payCard')} <Kbd>F5</Kbd>
              </Button>
            </div>
          </>
        ) : (
          <Button kind="primary" size="lg" icon="x" onClick={onClosedTab} style={{ inlineSize: '100%' }}>
            {tr('ws.cashier.detail.close')}
          </Button>
        )}
      </div>

      {/* ---- overlays ---- */}
      {overlay.kind === 'pay' && (
        <PaymentPane mode={overlay.method} due={due} busy={busy} error={actionError} onCancel={close} onSettle={(m, a, t) => void settle(m, a, t)} />
      )}
      {overlay.kind === 'split' && (
        <SplitBillDialog tabId={tabId} lines={allLines} due={due} busy={busy} onSettleShare={(amount) => void settle('cash', amount, amount)} onClose={close} />
      )}
      {overlay.kind === 'bill' && (
        <BillView
          venueName={tr('common.appName')}
          heading={label}
          orders={tab.orders}
          totals={totals}
          payments={tab.payments}
          taxInclusive={Boolean(taxCtx?.taxInclusive)}
          onClose={close}
        />
      )}
      {overlay.kind === 'refund' && (
        <RefundDialog
          payments={tab.payments}
          lines={allLines}
          canRefund={can.refund}
          onDone={() => {
            close();
            refresh();
          }}
          onClose={close}
        />
      )}
      {overlay.kind === 'merge' && (
        <MergeTabsDialog
          survivorTabId={tabId}
          survivorLabel={label}
          onDone={() => {
            close();
            refresh();
          }}
          onClose={close}
        />
      )}
      {overlay.kind === 'charge' && (
        <ChargeToBookingDialog
          tabId={tabId}
          tabLabel={label}
          onDone={(newId) => {
            close();
            void queryClient.invalidateQueries({ queryKey: ['tabs'] });
            void queryClient.invalidateQueries({ queryKey: ['openTabReservations'] });
            onSwitchTab(newId);
          }}
          onClose={close}
        />
      )}
      {overlay.kind === 'drawer' && (
        <ReasonCodePrompt action={tr('ws.cashier.payment.drawerAction')} busy={busy} error={actionError} withNote={false} onSubmit={(code) => void recordDrawerOpen(code)} onCancel={close}>
          <p style={{ ...muted, marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.cashier.drawer.openHint')}</p>
        </ReasonCodePrompt>
      )}
      {overrideLine && (
        <OverridePriceDialog
          orderItemId={overrideLine.id}
          label={`${overrideLine.qty}× ${pickName(locale, overrideLine.menu_item)}`}
          currentUnitPriceIqd={overrideLine.unit_price_iqd}
          onDone={() => {
            close();
            refresh();
          }}
          onClose={close}
        />
      )}
      {overlay.kind === 'discount' && (
        <PinReasonModal
          title={tr('op.till.discount')}
          busy={busy}
          error={pinError}
          onClose={() => {
            close();
            setPinError(null);
          }}
          onSubmit={(pin, reason) => void applyDiscount(pin, reason)}
        >
          <Field label={tr('op.till.discount')}>
            <select style={inputStyle} value={discountKind} onChange={(e) => setDiscountKind(e.target.value as typeof discountKind)}>
              <option value="discount_percent">{tr('op.till.discountPercent')}</option>
              <option value="discount_amount">{tr('op.till.discountAmount')}</option>
            </select>
          </Field>
          <Field label={tr('op.till.discountValue')}>
            <input
              style={{ ...inputStyle, ...numeric }}
              type="number"
              dir="ltr"
              min={1}
              max={discountKind === 'discount_percent' ? 100 : undefined}
              value={discountValue}
              onChange={(e) => setDiscountValue(Math.max(1, Number(e.target.value) || 1))}
            />
          </Field>
        </PinReasonModal>
      )}
      {overlay.kind === 'void' && (
        <PinReasonModal
          title={tr('op.till.voidTitle')}
          busy={busy}
          error={pinError}
          reasons={['wrong_item', 'changed_mind', 'quality', 'spill', 'staff_error', 'other']}
          onClose={() => {
            close();
            setPinError(null);
          }}
          onSubmit={(pin, reason) => void voidLine(overlay.lineId, pin, reason)}
        >
          <MessagePresenter tone="refused" icon="alert" message={tr('ws.cashier.detail.voidConsequence')} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />
        </PinReasonModal>
      )}
    </section>
  );
}

function TabLine({
  line,
  settled,
  busy,
  onOverride,
  onVoid,
}: {
  line: TabLineRow;
  settled: boolean;
  busy: boolean;
  onOverride: () => void;
  onVoid: () => void;
}) {
  const { tr, locale } = useLocale();
  const name = `${line.qty}× ${pickName(locale, line.menu_item)}${line.variant ? ` (${pickName(locale, line.variant)})` : ''}`;
  return (
    <li
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '0.4rem',
        alignItems: 'center',
        textDecoration: line.voided ? 'line-through' : 'none',
        color: line.voided ? 'var(--tp-muted-fg)' : 'inherit',
      }}
    >
      <span style={{ minInlineSize: 0, flex: 1 }}>
        <bdi>{name}</bdi>
        {line.voided && (
          <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)', marginInlineStart: '0.4rem', textDecoration: 'none', display: 'inline-block' }}>
            {tr('ws.cashier.detail.voided')}
          </span>
        )}
        {line.order_item_modifiers.length > 0 && (
          <span style={{ display: 'block', ...muted, fontSize: 'var(--tp-fs-xs)' }}>
            {line.order_item_modifiers.map((m) => pickName(locale, m.modifier)).filter(Boolean).join(' · ')}
          </span>
        )}
        {line.notes && (
          <span style={{ display: 'block', ...muted, fontSize: 'var(--tp-fs-xs)', fontStyle: 'italic' }}>
            <bdi>{line.notes}</bdi>
          </span>
        )}
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem', flexShrink: 0 }}>
        <Money amount={line.line_total_iqd} />
        {!line.voided && !settled && (
          <>
            <Button kind="ghost" size="sm" icon="tag" disabled={busy} title={tr('op.till.override')} aria-label={`${tr('op.till.override')} — ${name}`} onClick={onOverride} />
            <Button kind="ghost" size="sm" icon="ban" disabled={busy} title={tr('ws.cashier.detail.voidLine')} aria-label={`${tr('ws.cashier.detail.voidLine')} — ${name}`} onClick={onVoid} />
          </>
        )}
      </span>
    </li>
  );
}

/** One totals row: <span>label</span><span>amount</span> — the e2e change assertion anchors on this shape. */
function Row({ label, amount, strong, tone }: { label: React.ReactNode; amount: number; strong?: boolean; tone?: 'success' }) {
  const { locale } = useLocale();
  const negative = amount < 0;
  return (
    <div style={{ ...kvRow, fontWeight: strong ? 700 : 400, color: tone === 'success' ? 'var(--tp-success-fg)' : undefined }}>
      <span>{label}</span>
      <span dir="ltr" style={numeric}>
        {negative ? `−${formatIQD(-amount, locale)}` : formatIQD(amount, locale)}
      </span>
    </div>
  );
}
