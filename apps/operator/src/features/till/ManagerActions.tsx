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
import { formatIQD } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { deviceId } from '../../lib/idem';
import { mutate } from '../../lib/mutate';
import { touch } from '../../ipc/bridge';
import { supabase } from '../../lib/supabase';
import { useLocale, pickName } from '../../lib/i18n';
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
  onDone(): void;
  onClose(): void;
}) {
  const { tr, locale } = useLocale();
  const [paymentId, setPaymentId] = useState(payments[0]?.id ?? '');
  const [amount, setAmount] = useState<number>(payments[0]?.amount_iqd ?? 0);
  const [items, setItems] = useState<Record<string, number>>({});
  const [pinOpen, setPinOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const payment = payments.find((p) => p.id === paymentId);
  const max = payment?.amount_iqd ?? 0;
  const valid = !!payment && amount > 0 && amount <= max;
  const namedItems = Object.values(items).some((q) => q > 0);
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
        .map(([order_item_id, qty]) => ({ order_item_id, qty }));
      await appRpc('refund', {
        p_payment_id: paymentId,
        p_amount_iqd: amount,
        p_pin: pin,
        p_reason_code: reasonCode,
        // Naming the items is what reverses the stock movement (L453).
        p_items: chosen.length > 0 ? chosen : null,
        p_device_id: deviceId(),
      });
      touch.pinObserved(pin); // server just verified it — cache for offline unlock
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
        title={tr('op.till.refund')}
        onClose={onClose}
        footer={
          <div style={reasonedFooter}>
            <Button onClick={onClose} disabled={busy}>
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
        }
      >
        {!canRefund && (
          <PermissionRefusedNotice action={tr('ws.cashier.refund.refusedAction')} requiredRole={requiredRoleFor('refund')} style={{ marginBlockEnd: 'var(--tp-sp-3)' }} />
        )}
        {payments.length === 0 ? (
          <p style={muted}>{tr('op.till.refundNoPayments')}</p>
        ) : (
          <>
            <MessagePresenter
              tone={namedItems ? 'info' : 'refused'}
              icon="package"
              message={tr('ws.cashier.refund.consequence')}
              style={{ marginBlockEnd: 'var(--tp-sp-3)' }}
            />
            <Field label={tr('op.till.refundPayment')}>
              <Select
                value={paymentId}
                disabled={!canRefund}
                onChange={(v) => {
                  setPaymentId(v);
                  setAmount(payments.find((p) => p.id === v)?.amount_iqd ?? 0);
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
        footer={
          <div style={reasonedFooter}>
            <Button onClick={onClose} disabled={busy}>
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
        }
      >
        <p style={{ fontWeight: 600 }}>
          <bdi>{label}</bdi>
        </p>
        <div style={{ ...kvRow, ...muted, marginBlockEnd: 'var(--tp-sp-3)' }}>
          <span>{tr('op.till.overrideCurrent', { amount: '' }).trim()}</span>
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
  table: { table_number: string } | null;
  reservation: { guest_name: string | null } | null;
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
  const { tr } = useLocale();
  const [donorId, setDonorId] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  // Only open tabs other than this one can be folded in.
  const candidatesQ = useQuery({
    queryKey: ['mergeCandidates', survivorTabId],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('tabs')
        .select('id, label, table:cafe_tables(table_number), reservation:reservations(guest_name)')
        .in('status', ['open', 'awaiting_payment'])
        .is('merged_into_tab_id', null)
        .neq('id', survivorTabId)
        .order('opened_at');
      if (err) throw err;
      return data as unknown as MergeCandidate[];
    },
  });

  function nameOf(t: MergeCandidate): string {
    if (t.table) return `${tr('op.till.table')} ${t.table.table_number}`;
    return t.reservation?.guest_name ?? t.label ?? t.id.slice(0, 8);
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
      onClose={busy ? () => {} : onClose}
      size="sm"
      footer={
        <div style={reasonedFooter}>
          <Button onClick={onClose} disabled={busy}>
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
      }
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
            options={[{ value: '', label: tr('ws.cashier.merge.donor') }, ...candidates.map((t) => ({ value: t.id, label: nameOf(t) }))]}
          />
        </Field>
      )}
      <MessagePresenter tone="refused" icon="alert" message={tr('ws.cashier.merge.hint')} />
      <ErrorText error={error} />
    </Modal>
  );
}
