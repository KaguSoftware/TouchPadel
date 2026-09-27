/**
 * The PIN-and-reason cashier actions (spec 06.16 merge · 06.18 refund · price
 * override on 06.13). Each RPC has existed, granted and audited, since the
 * first drops:
 *
 *   - REFUND   (L453) `app.refund` — manager role. Naming the items is what
 *              reverses the stock movement; the consequence is rendered
 *              BEFORE the action (spec 06.18 note). `can.refund` decides the
 *              refused state; the control stays visible (R9).
 *   - OVERRIDE (L450-451) `app.override_price` via mutate('adjustment.apply').
 *   - MERGE    (L444) `app.merge_tabs`.
 *
 * All three reuse `PinReasonModal` (manager PIN + reason code) so the server
 * verifies the PIN and writes the reason to the audit log.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatIQD, formatTime } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { mutate, type MutateOutcome } from '../../lib/mutate';
import { touch } from '../../ipc/bridge';
import { supabase } from '../../lib/supabase';
import { useLocale, pickName } from '../../lib/i18n';
import { mergeDonorLabel } from './tillData';
import { requiredRoleFor } from '../../lib/auth';
import { Button, ErrorText, Field, Modal, PinReasonModal, Select, inputStyle } from '../../components/ui';
import { MessagePresenter, Money, PermissionRefusedNotice } from '../../components/kit';
import { kvRow, muted, numeric, reasonedFooter } from './tillStyles';

// ---------------------------------------------------------------------------
// Refund (06.18)
// ---------------------------------------------------------------------------

export interface RefundablePayment {
  id: string;
  method: string;
  amount_iqd: number;
  /** What has already gone back on this payment (refunds.payment_id); absent on a detail cached before the join. */
  refunds?: readonly { amount_iqd: number }[];
}

/** What is still refundable on a payment: its amount less every refund already recorded. */
export function refundableIqd(p: Pick<RefundablePayment, 'amount_iqd' | 'refunds'>): number {
  const refunded = (p.refunds ?? []).reduce((sum, r) => sum + (r.amount_iqd ?? 0), 0);
  return Math.max(0, p.amount_iqd - refunded);
}

export interface RefundableLine {
  id: string;
  qty: number;
  line_total_iqd: number;
  voided: boolean;
  menu_item: { name_en: string; name_ar: string } | null;
}

export function RefundDialog({
  payments,
  lines,
  canRefund,
  onDone,
  onClose,
}: {
  payments: readonly RefundablePayment[];
  lines: readonly RefundableLine[];
  /** `can.refund` — false renders the `refused` state; the controls stay visible. */
  canRefund: boolean;
  /**
   * `outcome.queued`: the refund is safe on the durable queue but the server has
   * not answered yet (item 9); `outcome.localId` is what its result will carry.
   */
  onDone(outcome: Pick<MutateOutcome, 'queued' | 'localId'>, paymentId: string): void;
  onClose(): void;
}) {
  const { tr, locale } = useLocale();
  const [paymentId, setPaymentId] = useState(payments[0]?.id ?? '');
  const [amount, setAmount] = useState<number>(payments[0] ? refundableIqd(payments[0]) : 0);
  const [items, setItems] = useState<Record<string, number>>({});
  const [pinOpen, setPinOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const payment = payments.find((p) => p.id === paymentId);
  // Capped at what is left on the payment, not what was paid: a second refund
  // may not exceed the remainder (the server refuses REFUND_EXCEEDS_PAYMENT too).
  const max = payment ? refundableIqd(payment) : 0;
  const valid = !!payment && amount > 0 && amount <= max;
  /*
   * Rulebook 4.3, in the order the cashier meets them. The permission case is
   * NOT repeated here: PermissionRefusedNotice already names the role at the
   * top of the dialog, and saying it twice on one screen is noise.
   */
  const refundBlockedReason =
    payments.length === 0
      ? tr('ws.cashier.refund.noPayments')
      : !canRefund
        ? undefined
        : !valid
          ? tr('ws.cashier.refund.max', { amount: formatIQD(max, locale) })
          : undefined;

  async function submit(pin: string, reasonCode: string) {
    setBusy(true);
    setError(null);
    try {
      const chosen = Object.entries(items)
        .filter(([, qty]) => qty > 0)
        .map(([orderItemId, qty]) => ({ orderItemId, qty }));
      // Item 9 (0120): the refund rides the durable queue like a discount. The
      // PIN travels in the payload and is proved to verify_manager_pin at
      // replay; online, the server answers inside the call and a refusal
      // throws here exactly as the direct RPC did.
      const outcome = await mutate('payment.refund', {
        paymentId,
        amountIqd: amount,
        pin,
        reasonCode,
        // Naming the items is what reverses the stock movement (L453).
        ...(chosen.length > 0 ? { items: chosen } : {}),
      });
      // Cache for the offline unlock only once the server has verified it.
      if (!outcome.queued) touch.pinObserved(pin);
      setPinOpen(false);
      onDone({ queued: outcome.queued, localId: outcome.localId }, paymentId);
    } catch (e) {
      setError(e);
      setPinOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        title={tr('op.till.refund')}
        onClose={onClose}
        footer={(close) => (
          <div style={reasonedFooter}>
            <Button onClick={close} disabled={busy}>
              {tr('common.cancel')}
            </Button>
            <Button
              kind="danger"
              icon="undo"
              disabled={!valid || busy || !canRefund || payments.length === 0}
              disabledReason={refundBlockedReason}
              onClick={() => setPinOpen(true)}
            >
              {tr('op.till.refund')}
            </Button>
          </div>
        )}
      >
        {!canRefund && (
          <PermissionRefusedNotice action={tr('ws.cashier.refund.refusedAction')} requiredRole={requiredRoleFor('refund')} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />
        )}
        {payments.length === 0 ? (
          <p style={muted}>{tr('op.till.refundNoPayments')}</p>
        ) : (
          <>
            {/* Info, not a warning: a money-only refund is a legitimate choice,
                and the dialog opened on an amber box before anything was done. */}
            <MessagePresenter tone="info" icon="package" message={tr('ws.cashier.refund.consequence')} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />
            <Field label={tr('op.till.refundPayment')}>
              <Select
                value={paymentId}
                disabled={!canRefund}
                onChange={(v) => {
                  setPaymentId(v);
                  const next = payments.find((p) => p.id === v);
                  setAmount(next ? refundableIqd(next) : 0);
                }}
                options={payments.map((p) => ({
                  value: p.id,
                  label: `${tr(p.method === 'cash' ? 'op.till.payCash' : 'op.till.payCard')} · ${formatIQD(p.amount_iqd, locale)}`,
                }))}
              />
            </Field>
            <Field label={tr('op.till.refundAmount')} hint={tr('op.till.refundMax', { amount: formatIQD(max, locale) })}>
              <input
                style={{ ...inputStyle, ...numeric, textAlign: 'end' }}
                dir="ltr"
                inputMode="numeric"
                disabled={!canRefund}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, '')) || 0)}
              />
            </Field>

            <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, marginBlockEnd: 'var(--tp-sp-0)' }}>{tr('op.till.refundItems')}</h3>
            <p style={{ ...muted, marginBlockEnd: 'var(--tp-sp-1-5)' }}>{tr('op.till.refundItemsHint')}</p>
            <div style={{ border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', maxBlockSize: '12rem', overflowY: 'auto' }}>
              {lines
                .filter((l) => !l.voided)
                .map((l) => (
                  <div key={l.id} style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', minBlockSize: 'var(--tp-touch)', paddingBlock: 'var(--tp-sp-1)', paddingInline: 'var(--tp-sp-2-5)', borderBlockEnd: '1px solid var(--tp-border)' }}>
                    <span style={{ flex: 1 }}>
                      {l.qty}× <bdi>{pickName(locale, l.menu_item)}</bdi>
                    </span>
                    <input
                      style={{ ...inputStyle, ...numeric, inlineSize: '4.5rem', textAlign: 'end' }}
                      dir="ltr"
                      inputMode="numeric"
                      disabled={!canRefund}
                      aria-label={pickName(locale, l.menu_item) || l.id}
                      value={items[l.id] ?? 0}
                      onChange={(e) => {
                        const qty = Math.min(Math.max(Number(e.target.value.replace(/\D/g, '')) || 0, 0), l.qty);
                        setItems((prev) => ({ ...prev, [l.id]: qty }));
                      }}
                    />
                  </div>
                ))}
            </div>
            <ErrorText error={error} />
          </>
        )}
      </Modal>

      {pinOpen && (
        <PinReasonModal title={tr('op.till.refund')} busy={busy} onSubmit={(pin, reason) => void submit(pin, reason)} onClose={() => setPinOpen(false)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Price override (06.13)
// ---------------------------------------------------------------------------

export function OverridePriceDialog({
  orderItemId,
  label,
  currentUnitPriceIqd,
  onDone,
  onClose,
}: {
  orderItemId: string;
  label: string;
  currentUnitPriceIqd: number;
  onDone(): void;
  onClose(): void;
}) {
  const { tr } = useLocale();
  const [price, setPrice] = useState(currentUnitPriceIqd);
  const [pinOpen, setPinOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(pin: string, reasonCode: string) {
    setBusy(true);
    setError(null);
    try {
      const outcome = await mutate('adjustment.apply', {
        kind: 'price_override',
        orderItemId,
        newUnitPriceIqd: price,
        pin,
        reasonCode,
      });
      // Only a server-verified pin feeds the offline cache — a queued one hasn't been checked yet.
      if (!outcome.queued) touch.pinObserved(pin);
      setPinOpen(false);
      onDone();
    } catch (e) {
      setError(e);
      setPinOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        title={tr('op.till.override')}
        onClose={onClose}
        size="sm"
        footer={(close) => (
          <div style={reasonedFooter}>
            <Button onClick={close} disabled={busy}>
              {tr('common.cancel')}
            </Button>
            <Button
              kind="primary"
              icon="tag"
              disabled={busy || price === currentUnitPriceIqd}
              disabledReason={price === currentUnitPriceIqd ? tr('ws.cashier.detail.overrideSame') : undefined}
              onClick={() => setPinOpen(true)}
            >
              {tr('op.till.override')}
            </Button>
          </div>
        )}
      >
        <p style={{ fontWeight: 600 }}>
          <bdi>{label}</bdi>
        </p>
        <div style={{ ...kvRow, ...muted, marginBlockEnd: 'var(--tp-sp-3)' }}>
          <span>{tr('op.till.overrideCurrentLabel')}</span>
          <Money amount={currentUnitPriceIqd} />
        </div>
        <Field label={tr('op.till.overrideNew')}>
          <input
            style={{ ...inputStyle, ...numeric, textAlign: 'end', fontSize: 'var(--tp-fs-lg)' }}
            dir="ltr"
            inputMode="numeric"
            autoFocus
            value={price}
            onChange={(e) => setPrice(Number(e.target.value.replace(/\D/g, '')) || 0)}
          />
        </Field>
        <ErrorText error={error} />
      </Modal>

      {pinOpen && (
        <PinReasonModal title={tr('op.till.override')} busy={busy} onSubmit={(pin, reason) => void submit(pin, reason)} onClose={() => setPinOpen(false)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Merge tables (06.16)
// ---------------------------------------------------------------------------

interface MergeCandidate {
  id: string;
  label: string | null;
  opened_at: string;
  table: { table_number: string } | null;
  reservation: { guest_name: string | null; court: { name_en: string; name_ar: string } | null } | null;
}

export function MergeTabsDialog({
  survivorTabId,
  survivorLabel,
  onDone,
  onClose,
}: {
  survivorTabId: string;
  survivorLabel: string;
  onDone(): void;
  onClose(): void;
}) {
  const { tr, locale } = useLocale();
  const [donorId, setDonorId] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Only open tabs other than this one can be folded in.
  const candidatesQ = useQuery({
    queryKey: ['mergeCandidates', survivorTabId],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('tabs')
        // The court and the open time are here so a booking tab has something
        // human to be listed under: an account holder's booking carries no
        // guest_name, and this picker used to fall back to a UUID fragment.
        .select(
          'id, label, opened_at, table:cafe_tables(table_number), reservation:reservations!tabs_reservation_id_fkey(guest_name, court:courts!reservations_court_id_fkey(name_en, name_ar))',
        )
        .in('status', ['open', 'awaiting_payment'])
        .is('merged_into_tab_id', null)
        .neq('id', survivorTabId)
        .order('opened_at');
      if (err) throw err;
      return data as unknown as MergeCandidate[];
    },
  });

  function nameOf(t: MergeCandidate): string {
    return mergeDonorLabel(
      t,
      { table: tr('op.till.table'), reservation: tr('op.till.forReservation') },
      t.reservation?.court ? pickName(locale, t.reservation.court) : null,
      formatTime(new Date(t.opened_at), locale),
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await appRpc('merge_tabs', { p_donor_tab_id: donorId, p_survivor_tab_id: survivorTabId });
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const candidates = candidatesQ.data ?? [];

  return (
    <Modal
      title={tr('ws.cashier.merge.title')}
      dismissible={!busy}
      onClose={onClose}
      size="sm"
      footer={(close) => (
        <div style={reasonedFooter}>
          <Button onClick={close} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            icon="merge"
            busy={busy}
            disabled={!donorId}
            disabledReason={donorId ? undefined : tr('ws.cashier.merge.pickDonor')}
            onClick={() => void submit()}
          >
            {tr('ws.cashier.merge.confirm')}
          </Button>
        </div>
      )}
    >
      <p style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.cashier.merge.into', { name: survivorLabel })}</p>
      <ErrorText error={candidatesQ.error} />
      {candidatesQ.isSuccess && candidates.length === 0 ? (
        <p style={muted}>{tr('ws.cashier.merge.none')}</p>
      ) : (
        <Field label={tr('ws.cashier.merge.donor')}>
          <Select
            value={donorId}
            onChange={setDonorId}
            placeholder={tr('ws.cashier.merge.choose')}
            options={candidates.map((t) => ({ value: t.id, label: nameOf(t) }))}
          />
        </Field>
      )}
      <MessagePresenter tone="refused" icon="alert" message={tr('ws.cashier.merge.hint')} />
      <ErrorText error={error} />
    </Modal>
  );
}
