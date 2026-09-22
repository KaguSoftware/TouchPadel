/**
 * TabDetailScreen (spec 06.13) — one tab, its lines and everything done to it
 * before payment. Hosts the payment pane (06.14), split (06.15), merge (06.16),
 * charge-to-booking (06.17) and refund (06.18) dialogs.
 *
 * Money: `computeTabTotals` is the tested display mirror of
 * app.compute_tab_totals; the server re-stamps every figure at settlement and
 * the change shown after a cash payment is the server's echo.
 *
 * The court fee is the one figure the mirror cannot work out (0106: it is what
 * is still OWED on the booking, which depends on the booking's other tabs). A
 * booking tab reads it from app.booking_bill while open and from the stamped
 * `court_iqd` once settled. Until the bill has loaded, Cash, Card, Split and
 * the bill are held with a reason rather than offering a total short by the
 * court. A booking tab's settle carries the server's own total as
 * `expectedTotalIqd`, so a price that moved since the bill was read is refused
 * (TOTAL_CHANGED) and re-read instead of silently charging a different sum.
 *
 * States: loading · ready · busy · error · voidRefused (VOID_REQUIRES_REFUND —
 * the void control stays visible with the refusal beside it) · partiallyPaid ·
 * settled.
 *
 * Layout: three fixed zones — identity header, scrolling body, pay footer. The
 * cashier must be able to read WHICH tab this is and reach Pay without
 * scrolling, on a tab with two lines and on one with forty; and the pay target
 * must not move between those two tabs, or between any of the states above.
 *
 * What the body leaves out, on purpose:
 *  - An "Open" badge on an open tab (the only kind the till selects). The
 *    header says when the tab was opened and where its orders came from.
 *  - A standing paragraph about voiding sent lines. The void dialog states the
 *    consequence at the moment it applies.
 *  - Two always-visible icon buttons on every line. A line opens its own
 *    "Change price / Void" row when pressed: rare actions, one press away.
 *  - The promotion box. It took a third of the panel on every tab and is used
 *    on a few; it opens from "Promotion" among the actions.
 *  - "Due" twice. The amount still to pay after a part payment is said once,
 *    in the pay footer beside the buttons that take it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatIQD, formatTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc, AppRpcError } from '../../lib/appRpc';
import { deviceId } from '../../lib/idem';
import { mutate } from '../../lib/mutate';
import { resultErrorCode } from '../../lib/queueResults';
import { usePendingResults } from '../../lib/pendingResults';
import { QK } from '../../lib/queries';
import { touch } from '../../ipc/bridge';
import { useLocale, pickName } from '../../lib/i18n';
import { useAuth, usePermissions } from '../../lib/auth';
import { Button, ErrorText, Field, PinReasonModal, Skeleton, inputStyle } from '../../components/ui';
import { Kbd, MessagePresenter, Money, ReasonCodePrompt, SegmentedControl, StatusBadge, TabStatusIndicator } from '../../components/kit';
import { Icon } from '../../components/icons';
import { computeTabTotals, discountBreakdown } from './tabTotals';
import { BillView } from './BillView';
import { MergeTabsDialog, OverridePriceDialog, RefundDialog } from './ManagerActions';
import { SplitBillDialog } from './SplitBillDialog';
import { ChargeToBookingDialog } from './ChargeToBookingDialog';
import { PaymentPane, type PaymentMethod } from './PaymentPane';
import { TILL_MENU_QUERY, canReadBookings, tabDetailQuery, tabAnchorLabel, tabHasWebOrder, type TabLineRow } from './tillData';
import { kvRow, muted, numeric, sectionTitle } from './tillStyles';
import { DRAWER_REASONS } from './drawerReasons';

/** The part of app.booking_bill (0106) the till reads. Every figure is the server's. */
interface TillBookingBill {
  reservation: { court_name_en: string | null; court_name_ar: string | null } | null;
  live_tab: { id: string; court_iqd: number; total_iqd: number } | null;
  court_paid_iqd: number;
  court_remaining_iqd: number;
}

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
  unsentCount = 0,
  onClosedTab,
  onSwitchTab,
}: {
  tabId: string;
  /** Lines in the till's basket not yet sent to this tab — they are not on its bill. */
  unsentCount?: number;
  onClosedTab: () => void;
  /** The tab was merged into / replaced by another one — select that instead. */
  onSwitchTab: (id: string) => void;
}) {
  const { tr, locale } = useLocale();
  const can = usePermissions();
  const { staff } = useAuth();
  const bookingsVisible = canReadBookings(staff?.role);
  const [promoOpen, setPromoOpen] = useState(false);
  const [openLineId, setOpenLineId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const [discountKind, setDiscountKind] = useState<'discount_percent' | 'discount_amount'>('discount_percent');
  const [discountValue, setDiscountValue] = useState(10);
  const [promoCode, setPromoCode] = useState('');
  const [promoNotice, setPromoNotice] = useState<{ tone: 'success' | 'refused'; text: string } | null>(null);
  const [drawerNoted, setDrawerNoted] = useState(false);
  const [voidRefused, setVoidRefused] = useState(false);
  /**
   * Voids that went onto the durable queue (item 9, 0120): line id -> the
   * envelope's localId, until the server answers. A pending line shows its
   * badge and hides its actions; the ack refetches the tab (the line comes back
   * voided) and retires the entry, a refusal retires it and lands where the
   * synchronous one would have — VOID_REQUIRES_REFUND beside the lines,
   * anything else as the action error. (The root also toasts it.)
   */
  const pendingVoids = usePendingResults<string>((_lineId, r) => {
    const code = resultErrorCode(r) ?? 'UNKNOWN';
    if (code === 'VOID_REQUIRES_REFUND') setVoidRefused(true);
    else setActionError(new AppRpcError(code, code));
  });
  /**
   * Refunds on the queue, unanswered: payment id -> localId. The "saved on
   * this station" notice shows while any is held and goes with the ack (the
   * payments list refetches then) or the refusal (shown as the action error).
   */
  const pendingRefunds = usePendingResults<string>((_paymentId, r) => {
    const code = resultErrorCode(r) ?? 'UNKNOWN';
    const detail = (r.serverResult as { details?: unknown } | null)?.details;
    setActionError(new AppRpcError(code, code, undefined, typeof detail === 'string' ? detail : undefined));
  });
  const { clear: clearPendingVoids } = pendingVoids;
  const { clear: clearPendingRefunds } = pendingRefunds;
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
  const settled = tab?.status === 'settled';
  const reservationId = tab?.reservation_id ?? null;

  // The court fee still owed, from the server (see the header). Keyed like the
  // desk's booking bill so the two screens share one read and one invalidation.
  const billQ = useQuery({
    queryKey: ['bookingBill', reservationId],
    enabled: Boolean(reservationId) && tab !== undefined && !settled,
    retry: false,
    queryFn: () => appRpc<TillBookingBill>('booking_bill', { p_reservation_id: reservationId }),
  });
  const bill = billQ.data;
  // A change to the tab (a line sent, a discount) changes the bill's totals
  // too; re-read it so the expected total sent with a payment is current.
  const lastTabUpdate = useRef(0);
  useEffect(() => {
    const prev = lastTabUpdate.current;
    lastTabUpdate.current = tabQ.dataUpdatedAt;
    if (prev !== 0 && prev !== tabQ.dataUpdatedAt && reservationId) {
      void queryClient.invalidateQueries({ queryKey: ['bookingBill', reservationId] });
    }
  }, [tabQ.dataUpdatedAt, reservationId, queryClient]);

  const liveBillTab = bill?.live_tab && bill.live_tab.id === tabId ? bill.live_tab : null;
  // null = a booking tab whose court fee has not arrived yet.
  const court: number | null = !reservationId
    ? 0
    : settled
      ? (tab?.court_iqd ?? 0)
      : bill
        ? (liveBillTab?.court_iqd ?? bill.court_remaining_iqd)
        : null;
  const courtPending = tab !== undefined && court === null;
  const expectedTotalIqd = !settled && liveBillTab ? liveBillTab.total_iqd : undefined;

  const totals = useMemo(() => computeTabTotals(tab ?? null, taxCtx, court), [tab, taxCtx, court]);
  const discounts = useMemo(() => discountBreakdown(tab?.tab_adjustments ?? []), [tab]);
  const due = totals.due;

  // F4/F5 from anywhere on the till OPEN the pane (TillScreen dispatches);
  // money is confirmed by click only. Registered before any early return.
  const hotkeyGate = useRef({ settled: true, due: 0, courtPending: true });
  hotkeyGate.current = { settled: Boolean(settled), due, courtPending };
  useEffect(() => {
    function onHotkey(e: Event) {
      if (hotkeyGate.current.settled || hotkeyGate.current.courtPending || hotkeyGate.current.due <= 0) return;
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
    setPromoOpen(false);
    setOpenLineId(null);
    clearPendingVoids();
    clearPendingRefunds();
  }, [tabId, clearPendingVoids, clearPendingRefunds]);

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
        // Only a SERVER total is sent as the expectation. This panel's own
        // mirror differs from compute_tab_totals in places (tax on a
        // discounted tab), and sending it would refuse those tabs forever.
        ...(expectedTotalIqd != null ? { expectedTotalIqd } : {}),
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
      if (e instanceof AppRpcError && e.code === 'TOTAL_CHANGED') {
        // The bill moved under the payment (a price change, a line added
        // elsewhere). Nothing was taken; re-read both and let them press again.
        void queryClient.invalidateQueries({ queryKey: ['tab', tabId] });
        if (reservationId) void queryClient.invalidateQueries({ queryKey: ['bookingBill', reservationId] });
      }
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
      // Item 9 (0120): the void rides the durable queue; the PIN travels in the
      // payload and is proved at replay. Online, VOID_REQUIRES_REFUND still
      // throws here inside the call, exactly as the direct RPC did.
      const outcome = await mutate<{ duplicate: boolean; order_item_id: string }>('order_item.void', {
        orderItemId: lineId,
        pin,
        reasonCode,
      });
      if (!outcome.queued) touch.pinObserved(pin);
      else pendingVoids.add(lineId, outcome.localId);
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
  const partiallyPaid = !settled && !courtPending && totals.paid > 0 && due > 0;
  const overrideLine = overlay.kind === 'override' ? allLines.find((l) => l.id === overlay.lineId) : undefined;
  const web = tabHasWebOrder(tab);

  // Rulebook 4.3 — no dead ends. Only STATE gets a reason here: `busy` is
  // already spoken by the spinner on the control the operator just pressed.
  const nothingDue = due <= 0;
  const courtReason = courtPending
    ? billQ.isError
      ? tr('ws.cashier.payment.courtFailed')
      : tr('ws.cashier.payment.courtLoading')
    : undefined;
  const payHeld = courtPending || nothingDue;
  const payBlockedReason = courtReason ?? (nothingDue ? tr('ws.cashier.payment.nothingDue') : undefined);
  const courtName = tab.reservation?.court
    ? pickName(locale, tab.reservation.court)
    : bill?.reservation?.court_name_en && bill.reservation.court_name_ar
      ? pickName(locale, { name_en: bill.reservation.court_name_en, name_ar: bill.reservation.court_name_ar })
      : '';
  const courtLabel = courtName ? tr('ws.cashier.detail.courtFeeRow', { court: courtName }) : tr('ws.cashier.detail.courtFee');
  // A drinks tab after the court was paid on an earlier bill charges no court;
  // said once, so the cashier does not go looking for a missing fee.
  const courtPaidEarlier = Boolean(reservationId) && !settled && court === 0 && (bill?.court_paid_iqd ?? 0) > 0;

  return (
    /*
     * Three fixed zones (rulebook 5.1), and the outer flex column is what makes
     * them fixed: the identity header and the pay footer are siblings of the
     * scroller, not passengers inside it.
     */
    <section
      aria-label={tr('ws.cashier.till.regionTab')}
      aria-busy={busy || undefined}
      style={{ flex: '1 1 auto', blockSize: '100%', minBlockSize: 0, minInlineSize: 0, display: 'flex', flexDirection: 'column' }}
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
          {tab.status !== 'open' && <TabStatusIndicator status={tab.status} size="sm" />}
        </div>
        <span style={{ ...muted, display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
          {tab.opened_at && <span>{tr('ws.cashier.detail.openedAt', { time: formatTime(new Date(tab.opened_at), locale) })}</span>}
          {web && <StatusBadge tone="info" icon="globe" dot={false} size="sm" label={tr('ws.cashier.tabs.sourceWeb')} />}
          {tab.reservation_id && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>
              <Icon name="calendar" size={13} /> {tr('ws.cashier.detail.chargedTo')}
              {tab.reservation?.court && (
                <>
                  {' · '}
                  <bdi>{pickName(locale, tab.reservation.court)}</bdi>
                </>
              )}
            </span>
          )}
        </span>
      </header>

      {/* ---- zone 2: everything that grows ---- */}
      <div style={{ flex: 1, minBlockSize: 0, overflowY: 'auto', display: 'grid', gap: 'var(--tp-sp-3)', alignContent: 'start', paddingBlock: 'var(--tp-sp-3)' }}>
        {/* ---- lines (sent = not editable, void = waste) ---- */}
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          <h3 style={sectionTitle}>{tr('ws.cashier.detail.linesTitle')}</h3>
          {allLines.length === 0 && <p style={muted}>{tr('ws.cashier.detail.noLines')}</p>}
          {liveOrders.map((o) => (
            <ul key={o.id} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-0)' }}>
              {o.order_items.map((line) => (
                <TabLine
                  key={line.id}
                  line={line}
                  settled={Boolean(settled)}
                  busy={busy}
                  pending={!line.voided && pendingVoids.pending.has(line.id)}
                  open={openLineId === line.id}
                  onToggle={() => setOpenLineId((cur) => (cur === line.id ? null : line.id))}
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
          {voidRefused && <MessagePresenter tone="refused" message={tr('ws.cashier.detail.voidRefused')} />}
          {pendingRefunds.pending.size > 0 && <MessagePresenter tone="info" icon="wifiOff" message={tr('ws.cashier.detail.refundQueued')} />}
        </div>

        {/* ---- totals ---- */}
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
          {courtPending ? (
            <Row label={courtLabel} amount={null} />
          ) : totals.court > 0 ? (
            <Row label={courtLabel} amount={totals.court} />
          ) : courtPaidEarlier ? (
            <div style={{ ...kvRow, ...muted }}>
              <span>{courtLabel}</span>
              <span>{tr('ws.cashier.detail.courtPaidEarlier')}</span>
            </div>
          ) : null}
          {/* No total while the court fee is unknown: a figure short by the court is the defect this replaces. */}
          <Row label={tr('common.total')} amount={courtPending ? null : totals.total} strong />
          {totals.paid > 0 && <Row label={tr('ws.cashier.detail.paid')} amount={-totals.paid} />}
          {lastChange != null && lastChange > 0 && <Row label={tr('op.till.change')} amount={lastChange} strong tone="success" />}
        </div>

        {courtPending && billQ.isError && (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', justifyItems: 'start' }}>
            <ErrorText error={billQ.error} style={{ marginBlock: 0 }} />
            <Button size="sm" icon="refresh" onClick={() => void billQ.refetch()}>
              {tr('ws.kit.async.retry')}
            </Button>
          </div>
        )}
        {settled && <MessagePresenter tone="success" message={tr('op.till.paidInFull')} />}
        {drawerNoted && <MessagePresenter tone="success" icon="drawer" message={tr('op.till.drawerNoted')} />}
        <ErrorText error={actionError} />

        {/* ---- actions, most-used first ---- */}
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          <h3 style={sectionTitle}>{tr('ws.cashier.detail.actionsTitle')}</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1-5)', alignItems: 'flex-start' }}>
            <Button icon="receipt" disabled={busy || courtPending} disabledReason={courtReason} onClick={() => setOverlay({ kind: 'bill' })}>
              {tr('op.till.bill')}
            </Button>
            {!settled && (
              <>
                <Button
                  icon="split"
                  disabled={payHeld || busy}
                  disabledReason={courtReason ?? (nothingDue ? tr('ws.cashier.detail.splitNothing') : undefined)}
                  onClick={() => setOverlay({ kind: 'split' })}
                >
                  {tr('ws.cashier.detail.split')}
                </Button>
                <Button icon="tag" disabled={busy} onClick={() => { setPinError(null); setOverlay({ kind: 'discount' }); }}>
                  {tr('ws.cashier.detail.discount')}
                </Button>
                {allLines.length > 0 && (
                  <Button icon="spark" aria-pressed={promoOpen} disabled={busy} onClick={() => setPromoOpen((v) => !v)}>
                    {tr('ws.cashier.detail.promoTitle')}
                  </Button>
                )}
                <Button icon="merge" disabled={busy} onClick={() => setOverlay({ kind: 'merge' })}>
                  {tr('ws.cashier.detail.merge')}
                </Button>
                {!tab.reservation_id && bookingsVisible && (
                  <Button icon="calendar" disabled={busy} onClick={() => setOverlay({ kind: 'charge' })}>
                    {tr('ws.cashier.detail.chargeBooking')}
                  </Button>
                )}
              </>
            )}
            <Button icon="drawer" disabled={busy} onClick={() => setOverlay({ kind: 'drawer' })}>
              {tr('op.till.openDrawer')}
            </Button>
            {tab.payments.length > 0 && (
              // The dialog says who may refund when this role may not; the
              // same notice under the buttons said it twice.
              <Button kind="danger" icon="undo" disabled={busy} onClick={() => setOverlay({ kind: 'refund' })}>
                {tr('op.till.refund')}
              </Button>
            )}
          </div>
        </div>

        {/* ---- promotion (opened from the actions; the server chooses it) ---- */}
        {promoOpen && !settled && allLines.length > 0 && (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', padding: 'var(--tp-sp-2-5)', borderRadius: 'var(--tp-radius-ctl)', background: 'var(--tp-surface-2)' }}>
            {/* Stacked: side by side in a 20rem column the label wrapped and
                the placeholder was cut to "Leave empty for". */}
            <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', justifyItems: 'start' }}>
              <Field label={tr('ws.cashier.detail.promoCode')} style={{ marginBlockEnd: 0, inlineSize: '100%' }}>
                <input
                  style={inputStyle}
                  value={promoCode}
                  maxLength={32}
                  disabled={busy}
                  autoFocus
                  placeholder={tr('ws.cashier.detail.promoCodePlaceholder')}
                  onChange={(e) => setPromoCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !busy && void applyPromotion()}
                />
              </Field>
              <Button kind="primary" busy={busy} onClick={() => void applyPromotion()}>
                {tr('ws.cashier.detail.promoApply')}
              </Button>
            </div>
            {promoNotice && <MessagePresenter tone={promoNotice.tone} message={promoNotice.text} />}
            <p style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.cashier.detail.promoHint')}</p>
          </div>
        )}
        {!promoOpen && promoNotice && <MessagePresenter tone={promoNotice.tone} message={promoNotice.text} />}
      </div>

      {/*
        ---- zone 3: the pay footer, pinned ----
        Cash and Card land on the same coordinates on every tab in every state:
        anything that appears in the footer appears ABOVE them, and the footer
        grows upward from the bottom edge. The row also reserves the height of a
        disabled-reason line, so stating the reason cannot move the button.
      */}
      <div style={{ flex: '0 0 auto', borderBlockStart: '1px solid var(--tp-border)', paddingBlock: 'var(--tp-sp-2-5)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--tp-sp-1-5)' }}>
        {!settled ? (
          <>
            {unsentCount > 0 && (
              <MessagePresenter tone="refused" icon="flame" message={tr('ws.cashier.payment.unsentWarning')} />
            )}
            {partiallyPaid && (
              <div style={{ ...kvRow, fontWeight: 700 }}>
                <span>{tr('ws.cashier.payment.stillToPay')}</span>
                <Money amount={due} strong />
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--tp-sp-1-5)', alignItems: 'start', minBlockSize: '5rem' }}>
              <Button
                kind="primary"
                size="xl"
                icon="banknote"
                disabled={payHeld || busy}
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
                disabled={payHeld || busy}
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
        <PaymentPane mode={overlay.method} due={due} unsentCount={unsentCount} busy={busy} error={actionError} onCancel={close} onSettle={(m, a, t) => void settle(m, a, t)} />
      )}
      {overlay.kind === 'split' && (
        <SplitBillDialog
          tabId={tabId}
          lines={allLines}
          due={due}
          busy={busy}
          onSettleShare={(amount, method) => void settle(method, amount, method === 'cash' ? amount : null)}
          onClose={close}
        />
      )}
      {overlay.kind === 'bill' && (
        <BillView
          venueName={tr('common.appName')}
          heading={label}
          orders={tab.orders}
          totals={totals}
          courtLabel={courtLabel}
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
          onDone={(outcome, paymentId) => {
            close();
            refresh();
            // A refund moves the day's takings; the day panel reads QK.day.
            void queryClient.invalidateQueries({ queryKey: [...QK.day] });
            if (outcome.queued) pendingRefunds.add(paymentId, outcome.localId);
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
        <ReasonCodePrompt action={tr('ws.cashier.payment.drawerAction')} reasonCodes={DRAWER_REASONS} busy={busy} error={actionError} withNote={false} onSubmit={(code) => void recordDrawerOpen(code)} onCancel={close}>
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
          <div style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
            <SegmentedControl<typeof discountKind>
              value={discountKind}
              onChange={setDiscountKind}
              aria-label={tr('op.till.discount')}
              options={[
                { value: 'discount_percent', label: tr('op.till.discountPercent') },
                { value: 'discount_amount', label: tr('op.till.discountAmount') },
              ]}
            />
          </div>
          <Field label={discountKind === 'discount_percent' ? tr('op.till.discountPercentLabel') : tr('op.till.discountAmountLabel')} hint={tr('op.till.discountPinHint')}>
            <input
              style={{ ...inputStyle, ...numeric, textAlign: 'end' }}
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

/**
 * One sent line. Pressing it opens its own row of actions — change the price,
 * void it — rather than every line carrying two unlabelled icons all shift.
 */
function TabLine({
  line,
  settled,
  busy,
  pending = false,
  open,
  onToggle,
  onOverride,
  onVoid,
}: {
  line: TabLineRow;
  settled: boolean;
  busy: boolean;
  /** A void for this line is on the durable queue, unanswered (item 9). */
  pending?: boolean;
  open: boolean;
  onToggle: () => void;
  onOverride: () => void;
  onVoid: () => void;
}) {
  const { tr, locale } = useLocale();
  const name = `${line.qty}× ${pickName(locale, line.menu_item)}${line.variant ? ` (${pickName(locale, line.variant)})` : ''}`;
  const actionable = !line.voided && !settled && !pending;
  const body = (
    <>
      <span style={{ minInlineSize: 0, flex: 1, textAlign: 'start' }}>
        <bdi style={{ textDecoration: line.voided ? 'line-through' : 'none' }}>{name}</bdi>
        {line.voided && (
          <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)', marginInlineStart: '0.4rem', display: 'inline-block' }}>
            {tr('ws.cashier.detail.voided')}
          </span>
        )}
        {pending && (
          <span style={{ marginInlineStart: '0.4rem', display: 'inline-block', verticalAlign: 'middle' }}>
            <StatusBadge tone="info" icon="wifiOff" size="sm" label={tr('ws.cashier.detail.voidQueued')} />
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
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', flexShrink: 0 }}>
        <Money amount={line.line_total_iqd} style={line.voided ? { textDecoration: 'line-through' } : undefined} />
        {actionable && <Icon name="chevronDown" size={14} style={{ color: 'var(--tp-muted-fg)', transform: open ? 'rotate(180deg)' : undefined }} />}
      </span>
    </>
  );
  const rowStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--tp-sp-2)',
    alignItems: 'center',
    inlineSize: '100%',
    paddingBlock: 'var(--tp-sp-1)',
    paddingInline: 'var(--tp-sp-1-5)',
    marginInline: 'calc(-1 * var(--tp-sp-1-5))',
    boxSizing: 'content-box',
    color: line.voided ? 'var(--tp-muted-fg)' : 'inherit',
  } as const;
  return (
    <li>
      {actionable ? (
        <button
          type="button"
          className="tp-tile"
          aria-expanded={open}
          aria-label={tr('ws.cashier.detail.lineActions', { name })}
          onClick={onToggle}
          style={{ ...rowStyle, border: '1px solid transparent', borderRadius: 'var(--tp-radius-ctl)', background: open ? 'var(--tp-surface-2)' : 'transparent', font: 'inherit' }}
        >
          {body}
        </button>
      ) : (
        <div style={rowStyle}>{body}</div>
      )}
      {actionable && open && (
        <div style={{ display: 'flex', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap', paddingBlock: 'var(--tp-sp-1)' }}>
          <Button size="sm" icon="tag" disabled={busy} aria-label={`${tr('op.till.override')} — ${name}`} onClick={onOverride}>
            {tr('op.till.override')}
          </Button>
          <Button size="sm" kind="danger" icon="ban" disabled={busy} aria-label={`${tr('ws.cashier.detail.voidLine')} — ${name}`} onClick={onVoid}>
            {tr('ws.cashier.detail.voidLine')}
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * One totals row: <span>label</span><span>amount</span> — the e2e change assertion anchors on this shape.
 * `amount` null is a figure the server has not sent yet: "—", never a made-up number.
 */
function Row({ label, amount, strong, tone }: { label: React.ReactNode; amount: number | null; strong?: boolean; tone?: 'success' }) {
  const { locale } = useLocale();
  const negative = amount !== null && amount < 0;
  return (
    <div style={{ ...kvRow, fontWeight: strong ? 700 : 400, color: tone === 'success' ? 'var(--tp-success-fg)' : undefined }}>
      <span>{label}</span>
      <span dir="ltr" style={{ ...numeric, color: amount === null ? 'var(--tp-muted-fg)' : undefined }}>
        {amount === null ? '—' : negative ? `−${formatIQD(-amount, locale)}` : formatIQD(amount, locale)}
      </span>
    </div>
  );
}
