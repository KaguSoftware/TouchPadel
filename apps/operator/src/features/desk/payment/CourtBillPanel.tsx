/**
 * The court fee and bill for one booking, on the booking screen (0106).
 *
 * The desk takes the payment here — court fee plus any cafe items charged to
 * the booking — without the till. Every figure is app.booking_bill's; this
 * panel decides which ONE sentence describes the booking and offers the one
 * action that fits it (deskPaymentLogic.panelStateOf):
 *
 *   not charged / owed again  → Cash · Card (opens the booking's bill first)
 *   bill open                 → breakdown, Cash · Card
 *   nothing owed on a bill    → Close the bill (so the day can close)
 *   more paid than owed       → a manager refunds at the till
 *   paid / ended / no fee     → a sentence, and the payments taken
 *
 * Cash and card go through the till's own PaymentPane and mutate('tab.settle'),
 * carrying the total the clerk was shown: if the bill moved in between (an item
 * added at the till, the booking extended) the server refuses with
 * TOTAL_CHANGED and the panel shows the new figure instead of taking the old.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatIQD, formatNumber, formatTime, VENUE_TZ } from '@touch/i18n';
import { mutate } from '../../../lib/mutate';
import { AppRpcError } from '../../../lib/appRpc';
import { resultErrorCode } from '../../../lib/queueResults';
import { usePendingResults } from '../../../lib/pendingResults';
import { canAccess, permissionsFor, useAuth } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { useToast } from '../../../components/toast';
import { Button, ErrorText, Modal } from '../../../components/ui';
import { MessagePresenter, Money, Panel } from '../../../components/kit';
import { PaymentPane } from '../../till/PaymentPane';
import { AddCafeBillDialog } from './AddCafeBillDialog';
import { canAddCafeBill, canTakePayment, closeBillPlan, panelStateOf, type BookingBill } from './deskPaymentLogic';
import { useBookingBill } from './useBookingBill';

type Method = 'cash' | 'card';

export function CourtBillPanel({ reservationId, tz = VENUE_TZ }: { reservationId: string; tz?: string }) {
  const billQ = useBookingBill(reservationId);
  const { tr } = useLocale();
  const title = tr('ws.courtDesk.payment.title');

  if (billQ.isError && !billQ.data) {
    return (
      <Panel title={title}>
        <MessagePresenter tone="error" message={tr('ws.courtDesk.payment.error')} />
        <Button size="sm" style={{ marginBlockStart: 'var(--tp-sp-2)' }} onClick={() => void billQ.refetch()}>
          {tr('ws.courtDesk.payment.retry')}
        </Button>
      </Panel>
    );
  }
  if (!billQ.data) {
    return (
      <Panel title={title}>
        <p style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.courtDesk.payment.loading')}</p>
      </Panel>
    );
  }
  if (billQ.data.reservation.kind !== 'booking') return null;
  return <CourtBillView bill={billQ.data} tz={tz} onRefetch={() => billQ.refetch()} />;
}

export function CourtBillView({ bill, tz, onRefetch }: { bill: BookingBill; tz: string; onRefetch: () => Promise<unknown> }) {
  const { tr, locale } = useLocale();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { staff } = useAuth();
  const allowed = permissionsFor(staff?.role).takeCourtPayment;
  const canOpenTill = canAccess(staff?.role, '/till');

  const [paying, setPaying] = useState<Method | null>(null);
  // What the last settle did, kept on screen until the clerk chooses where to
  // go next. A toast could not carry those two choices — toast.ok() takes a
  // message and nothing else — and it took the confirmation away after three
  // seconds, which is the moment the clerk looks up from the cash drawer.
  const [settled, setSettled] = useState<{ changeIqd: number; queued: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [addingCafe, setAddingCafe] = useState(false);
  /**
   * A close that went onto the durable queue (item 9, 0120) and has not been
   * answered yet: tab id -> the envelope's localId. The Close button stays off
   * until the result lands — the ack refetches the bill, a refusal (TAB_NOT_EMPTY:
   * an item reached the bill first) is shown here, where the synchronous one
   * would have been, and the bill re-read. (The root also toasts it.)
   */
  const pendingCloses = usePendingResults<string>((_tabId, r) => {
    const code = resultErrorCode(r) ?? 'UNKNOWN';
    const detail = (r.serverResult as { details?: unknown } | null)?.details;
    setNotice(null);
    setError(new AppRpcError(code, code, undefined, typeof detail === 'string' ? detail : undefined));
    void onRefetch();
  });

  const state = panelStateOf(bill);
  const tab = bill.live_tab;
  const closePending = tab ? pendingCloses.pending.has(tab.id) : false;
  const amount = (n: number) => formatIQD(n, locale);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['bookingBill'] });
    void queryClient.invalidateQueries({ queryKey: ['bookingBillStates'] });
    void queryClient.invalidateQueries({ queryKey: ['tabs'] });
  }

  /** The booking's open bill, opening one when there is none yet. */
  async function ensureTab(): Promise<string | null> {
    if (tab) return tab.id;
    try {
      const opened = await mutate<{ tab_id: string }>('tab.open', { reservationId: bill.reservation.id });
      if (opened.queued || !opened.result) {
        setNotice(tr('ws.courtDesk.payment.openQueued'));
        return null;
      }
      return opened.result.tab_id;
    } catch (e) {
      if (e instanceof AppRpcError && e.code === 'BOOKING_TAB_OPEN' && e.details) return e.details;
      throw e;
    }
  }

  async function startPayment(method: Method) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const id = await ensureTab();
      if (!id) return;
      if (!tab) await onRefetch();
      setPaying(method);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function settle(method: Method, amountIqd: number | null, tenderedIqd: number | null) {
    if (!tab) return;
    setBusy(true);
    setError(null);
    try {
      const out = await mutate<{ change_iqd: number | null; status: string }>('tab.settle', {
        tabId: tab.id,
        method,
        ...(amountIqd != null ? { amountIqd } : {}),
        ...(tenderedIqd != null ? { tenderedIqd } : {}),
        expectedTotalIqd: tab.total_iqd,
      });
      setPaying(null);
      setSettled({ changeIqd: out.result?.change_iqd ?? 0, queued: out.queued === true });
      invalidate();
    } catch (e) {
      setError(e);
      // The bill moved under the clerk: show the new figure in the same pane.
      if (e instanceof AppRpcError && e.code === 'TOTAL_CHANGED') void onRefetch();
    } finally {
      setBusy(false);
    }
  }

  async function closeBill() {
    const plan = closeBillPlan(bill);
    if (!plan || !tab) return;
    setBusy(true);
    setError(null);
    try {
      // Item 9 (0120): both closes ride the durable queue, as the payment does.
      // Online the server answers inside the call and a refusal throws here;
      // offline the close is safe on disk and the panel waits for the ack.
      const out = await mutate(plan.mutation, { tabId: tab.id, reasonCode: plan.reason });
      setConfirmClose(false);
      if (out.queued) {
        pendingCloses.add(tab.id, out.localId);
        setNotice(tr('ws.courtDesk.payment.closeQueued'));
        toast.info(tr('ws.courtDesk.payment.closeQueuedToast'));
      } else {
        toast.ok(tr('ws.courtDesk.payment.closedToast'));
      }
      invalidate();
    } catch (e) {
      setError(e);
      void onRefetch();
    } finally {
      setBusy(false);
    }
  }

  const sentence = (() => {
    switch (state) {
      case 'notCharged':
        return tr('ws.courtDesk.payment.notCharged', { amount: amount(bill.court_remaining_iqd) });
      case 'owedAgain':
        return tr('ws.courtDesk.payment.owedAgain', { amount: amount(bill.court_remaining_iqd) });
      case 'billOpen':
        return tr('ws.courtDesk.payment.billOpen', { amount: amount(tab?.due_iqd ?? 0) });
      case 'closeBill':
        return tr('ws.courtDesk.payment.closeBill');
      case 'refundDue':
        return tr('ws.courtDesk.payment.refundDue', { amount: amount(Math.max(bill.court_refund_due_iqd, tab?.over_paid_iqd ?? 0)) });
      case 'paid':
        return tr('ws.courtDesk.payment.paid');
      case 'noFee':
        return tr('ws.courtDesk.payment.noFee');
      case 'ended':
        return tr('ws.courtDesk.payment.ended', { status: tr(`ws.kit.bookingStatus.${bill.reservation.status as 'cancelled'}`) });
    }
  })();
  // Owing money is the normal course of a booking, not a refusal: it reads as
  // information with a bill glyph. Only money owed BACK asks for attention.
  const sentenceTone = state === 'paid' ? 'success' : state === 'refundDue' ? 'refused' : 'info';
  const sentenceIcon = state === 'refundDue' ? 'alert' : state === 'closeBill' ? 'checkCircle' : canTakePayment(state) ? 'receipt' : undefined;

  const payable = allowed && canTakePayment(state);
  const dayBlocked = !bill.day_open;
  const payments = bill.settled_tabs.flatMap((t) => t.payments);

  return (
    <Panel title={tr('ws.courtDesk.payment.title')}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
        {settled && (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
            <MessagePresenter
              tone="success"
              message={
                settled.queued
                  ? tr('ws.courtDesk.payment.queuedToast')
                  : settled.changeIqd > 0
                    ? tr('ws.courtDesk.payment.paidChangeToast', { amount: amount(settled.changeIqd) })
                    : tr('ws.courtDesk.payment.paidToast')
              }
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2)' }}>
              <Button kind="primary" icon="today" onClick={() => void navigate({ to: '/desk/today' })}>
                {tr('ws.courtDesk.payment.goToToday')}
              </Button>
              <Button icon="repeat" onClick={() => setSettled(null)}>
                {tr('ws.courtDesk.payment.resume')}
              </Button>
            </div>
          </div>
        )}
        <MessagePresenter tone={sentenceTone} icon={sentenceIcon} message={sentence} />
        {dayBlocked && (canTakePayment(state) || state === 'closeBill') && <MessagePresenter tone="refused" icon="lock" message={tr('ws.courtDesk.payment.dayClosed')} />}
        {notice && <MessagePresenter tone="refused" message={notice} />}
        <ErrorText error={paying || confirmClose ? null : error} />

        {tab && (
          // A bill reads like a receipt: what each line is, and its amount on
          // the far edge, with the total set apart and what is left to pay last.
          <dl style={{ margin: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
            <BillRow label={tr('ws.courtDesk.payment.courtFee')} amount={tab.court_iqd} />
            {tab.item_count > 0 && <BillRow label={tr('ws.courtDesk.payment.cafeItems', { count: formatNumber(tab.item_count, locale) })} amount={tab.subtotal_iqd} />}
            {tab.discount_iqd > 0 && <BillRow label={tr('ws.courtDesk.payment.discount')} amount={-tab.discount_iqd} />}
            {tab.tax_iqd > 0 && <BillRow label={tr('ws.courtDesk.payment.tax')} amount={tab.tax_iqd} />}
            <BillRow label={tr('ws.courtDesk.payment.total')} amount={tab.total_iqd} strong divider />
            {tab.paid_iqd > 0 && <BillRow label={tr('ws.courtDesk.payment.paidSoFar')} amount={tab.paid_iqd} />}
            {tab.paid_iqd > 0 && <BillRow label={tr('ws.courtDesk.payment.due')} amount={tab.due_iqd} strong />}
          </dl>
        )}

        {allowed && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-2)' }}>
            {canTakePayment(state) && (
              <>
                <Button kind="primary" size="lg" icon="banknote" busy={busy && paying === null} disabled={!payable || dayBlocked || busy} disabledReason={tr('ws.courtDesk.payment.dayClosedReason')} onClick={() => void startPayment('cash')}>
                  {tr('ws.courtDesk.payment.cash')}
                </Button>
                <Button size="lg" icon="card" disabled={!payable || dayBlocked || busy} disabledReason={tr('ws.courtDesk.payment.dayClosedReason')} onClick={() => void startPayment('card')}>
                  {tr('ws.courtDesk.payment.card')}
                </Button>
              </>
            )}
            {state === 'closeBill' && (
              <Button
                kind="primary"
                icon="checkCircle"
                disabled={dayBlocked || busy || closePending}
                disabledReason={closePending ? tr('ws.courtDesk.payment.closeQueued') : tr('ws.courtDesk.payment.dayClosedReason')}
                onClick={() => setConfirmClose(true)}
              >
                {tr('ws.courtDesk.payment.closeBillAction')}
              </Button>
            )}
            {canAddCafeBill(bill) && (
              <Button icon="plus" disabled={busy} onClick={() => setAddingCafe(true)}>
                {tr('ws.courtDesk.payment.addCafeBill')}
              </Button>
            )}
            {state === 'refundDue' && canOpenTill && tab && (
              <Button icon="receipt" onClick={() => void navigate({ to: '/till', search: { tab: tab.id } as never })}>
                {tr('ws.courtDesk.payment.openTill')}
              </Button>
            )}
          </div>
        )}

        {payments.length > 0 && (
          <section>
            <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700, marginBlockEnd: 'var(--tp-sp-1)' }}>{tr('ws.courtDesk.payment.history')}</h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
              {payments.map((p) => (
                <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--tp-sp-3)', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)' }}>
                  <bdi style={{ color: 'var(--tp-muted-fg)' }}>
                    {tr('ws.courtDesk.payment.historyRow', {
                      time: formatTime(new Date(p.created_at), locale, tz),
                      method: tr(p.method === 'cash' ? 'ws.courtDesk.payment.cash' : 'ws.courtDesk.payment.card'),
                      name: p.recorded_by_name ?? tr('ws.courtDesk.payment.someone'),
                    })}
                  </bdi>
                  <Money amount={p.amount_iqd} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {paying && tab && (
        <PaymentPane mode={paying} due={tab.due_iqd} busy={busy} error={error} onCancel={() => { setPaying(null); setError(null); }} onSettle={(m, a, t) => void settle(m, a, t)} />
      )}

      {confirmClose && (
        <Modal
          title={tr('ws.courtDesk.payment.closeBillTitle')}
          dismissible={!busy}
          onClose={() => setConfirmClose(false)}
          size="sm"
          footer={
            <>
              <Button onClick={() => setConfirmClose(false)} disabled={busy}>
                {tr('ws.courtDesk.cafeBill.cancel')}
              </Button>
              <Button kind="primary" busy={busy} onClick={() => void closeBill()}>
                {tr('ws.courtDesk.payment.closeBillAction')}
              </Button>
            </>
          }
        >
          <p>{tr('ws.courtDesk.payment.closeBillBody')}</p>
          <ErrorText error={error} />
        </Modal>
      )}

      {addingCafe && (
        <AddCafeBillDialog
          reservationId={bill.reservation.id}
          liveTabId={tab?.id ?? null}
          tz={tz}
          onClose={() => setAddingCafe(false)}
          onAdded={() => {
            setAddingCafe(false);
            void onRefetch();
          }}
        />
      )}
    </Panel>
  );
}

function BillRow({ label, amount, strong, divider }: { label: string; amount: number; strong?: boolean; divider?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 'var(--tp-sp-3)',
        paddingBlockStart: divider ? 'var(--tp-sp-1-5)' : undefined,
        marginBlockStart: divider ? 'var(--tp-sp-1)' : undefined,
        borderBlockStart: divider ? '1px solid var(--tp-border)' : undefined,
        fontWeight: strong ? 700 : undefined,
      }}
    >
      <dt style={{ color: strong ? 'var(--tp-fg)' : 'var(--tp-muted-fg)' }}>
        <bdi>{label}</bdi>
      </dt>
      <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>
        <Money amount={amount} strong={strong} />
      </dd>
    </div>
  );
}
