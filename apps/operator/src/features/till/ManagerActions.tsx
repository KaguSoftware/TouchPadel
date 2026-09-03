/**
 * The three cashier actions the contract names and the till could not perform.
 *
 * Each RPC has existed, granted and tested, since the first drops; nothing ever
 * called them, so the acceptance test "every discount, void and refund
 * traceable to a named actor" (SOW L434-439) had no refund to trace:
 *
 *   - REFUND      (L453) "Refunds by a manager role, reversing the stock
 *                 movement" — `app.refund`. The stock reversal is why the item
 *                 picker matters: refunding money without naming the items
 *                 leaves the ledger claiming they were consumed.
 *   - OVERRIDE    (L450-451) "Discounts and price overrides behind an
 *                 authorised PIN with a reason code" — `app.override_price`.
 *                 Discounts were wired; overrides never were.
 *   - MERGE       (L444) "Merge tables" — `app.merge_tabs`. The tab list even
 *                 filters on `merged_into_tab_id`, a column nothing could set.
 *
 * All three are PIN-and-reason actions, so they reuse `PinReasonModal` — the
 * same component the discount and void flows use, whose own doc comment has
 * always claimed it was "shared by discount / void / refund flows".
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
import {
  Button,
  ErrorText,
  Field,
  Modal,
  PinReasonModal,
  Select,
  card,
  inputStyle,
} from '../../components/ui';

// ---------------------------------------------------------------------------
// Refund
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
  onDone,
  onClose,
}: {
  payments: readonly RefundablePayment[];
  lines: readonly RefundableLine[];
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
        // Naming the items is what reverses the stock movement (L453). Money
        // back with no items leaves the ledger claiming they were consumed.
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
      <Modal title={tr('op.till.refund')} onClose={onClose}>
        {payments.length === 0 ? (
          <p>{tr('op.till.refundNoPayments')}</p>
        ) : (
          <>
            <Field label={tr('op.till.refundPayment')}>
              <Select
                value={paymentId}
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
            <Field label={tr('op.till.refundAmount')}>
              <input
                style={{ ...inputStyle, textAlign: 'end' }}
                dir="ltr"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, '')) || 0)}
              />
            </Field>
            <p style={{ fontSize: '0.8rem', color: 'var(--tp-muted-fg)' }}>
              {tr('op.till.refundMax', { amount: formatIQD(max, locale) })}
            </p>

            <h4 style={{ marginBlockEnd: '0.2rem' }}>{tr('op.till.refundItems')}</h4>
            <p style={{ fontSize: '0.8rem', color: 'var(--tp-muted-fg)', marginBlockStart: 0 }}>
              {tr('op.till.refundItemsHint')}
            </p>
            <div style={{ ...card, maxBlockSize: '12rem', overflowY: 'auto' }}>
              {lines
                .filter((l) => !l.voided)
                .map((l) => (
                  <div
                    key={l.id}
                    style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBlockEnd: '0.2rem' }}
                  >
                    <span style={{ flex: 1 }}>
                      {l.qty}× {pickName(locale, l.menu_item)}
                    </span>
                    <input
                      style={{ ...inputStyle, inlineSize: '4rem', textAlign: 'end' }}
                      dir="ltr"
                      inputMode="numeric"
                      aria-label={pickName(locale, l.menu_item) || l.id}
                      value={items[l.id] ?? 0}
                      onChange={(e) => {
                        const qty = Math.min(
                          Math.max(Number(e.target.value.replace(/\D/g, '')) || 0, 0),
                          l.qty,
                        );
                        setItems((prev) => ({ ...prev, [l.id]: qty }));
                      }}
                    />
                  </div>
                ))}
            </div>

            <ErrorText error={error} />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <Button onClick={onClose}>{tr('common.cancel')}</Button>
              <Button kind="danger" disabled={!valid || busy} onClick={() => setPinOpen(true)}>
                {tr('op.till.refund')}
              </Button>
            </div>
          </>
        )}
      </Modal>

      {pinOpen && (
        <PinReasonModal
          title={tr('op.till.refund')}
          busy={busy}
          onSubmit={(pin, reason) => void submit(pin, reason)}
          onClose={() => setPinOpen(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Price override
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
  const { tr, locale } = useLocale();
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
      // Only a server-verified pin feeds the offline cache — a queued one
      // hasn't been checked yet.
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
      <Modal title={tr('op.till.override')} onClose={onClose}>
        <p style={{ marginBlockStart: 0 }}>{label}</p>
        <p style={{ color: 'var(--tp-muted-fg)', marginBlockStart: 0 }}>
          {tr('op.till.overrideCurrent', { amount: formatIQD(currentUnitPriceIqd, locale) })}
        </p>
        <Field label={tr('op.till.overrideNew')}>
          <input
            style={{ ...inputStyle, textAlign: 'end' }}
            dir="ltr"
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value.replace(/\D/g, '')) || 0)}
          />
        </Field>
        <ErrorText error={error} />
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>{tr('common.cancel')}</Button>
          <Button
            kind="primary"
            disabled={busy || price === currentUnitPriceIqd}
            onClick={() => setPinOpen(true)}
          >
            {tr('op.till.override')}
          </Button>
        </div>
      </Modal>

      {pinOpen && (
        <PinReasonModal
          title={tr('op.till.override')}
          busy={busy}
          onSubmit={(pin, reason) => void submit(pin, reason)}
          onClose={() => setPinOpen(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Merge tables
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

  // Only open tabs other than this one can be folded in. `merged_into_tab_id`
  // is null for every tab that has not already been merged away.
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
    <Modal title={tr('op.till.merge')} onClose={onClose}>
      <p style={{ marginBlockStart: 0 }}>{tr('op.till.mergeInto', { name: survivorLabel })}</p>
      <ErrorText error={candidatesQ.error} />
      {candidatesQ.isSuccess && candidates.length === 0 ? (
        <p>{tr('op.till.mergeNone')}</p>
      ) : (
        <Field label={tr('op.till.mergeDonor')}>
          <Select
            value={donorId}
            onChange={setDonorId}
            placeholder={tr('op.till.mergeDonor')}
            options={[
              { value: '', label: tr('op.till.mergeDonor') },
              ...candidates.map((t) => ({ value: t.id, label: nameOf(t) })),
            ]}
          />
        </Field>
      )}
      <p style={{ fontSize: '0.8rem', color: 'var(--tp-muted-fg)' }}>{tr('op.till.mergeHint')}</p>
      <ErrorText error={error} />
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>{tr('common.cancel')}</Button>
        <Button kind="primary" disabled={!donorId || busy} onClick={() => void submit()}>
          {tr('op.till.merge')}
        </Button>
      </div>
    </Modal>
  );
}
