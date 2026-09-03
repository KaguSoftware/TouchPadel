/**
 * PaymentScreen (spec 06.14) — the settle pane. A dialog on purpose: taking
 * money is a focused, trapped task on a shared till, and the e2e journeys
 * address it as `dialog "Cash"` / `dialog "Card"`.
 *
 *   cash  → Tendered (typed or keypad) + ChangeDueDisplay; the change preview
 *           is `computeChange` (the existing tested helper); the figure that is
 *           SHOWN after payment is the server's echo (change_iqd).
 *   card  → the amount the terminal approved is RECORDED, not processed.
 *   part  → either method may record less than the due; the server reports the
 *           remainder (`partiallyPaid` in the tab panel).
 *
 * F4/F5 only open this pane; money is confirmed by click or Enter inside it.
 */
import { useEffect, useState } from 'react';
import { formatIQD } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { AmountPad, Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { ChangeDueDisplay, MessagePresenter, Money } from '../../components/kit';
import { Switch } from '../../components/Switch';
import { computeChange } from './change';
import { kvRow, muted, numeric } from './tillStyles';

export type PaymentMethod = 'cash' | 'card';

export function PaymentPane({
  mode,
  due,
  busy,
  error,
  onCancel,
  onSettle,
}: {
  mode: PaymentMethod;
  /** Amount still owed (server-stamped after each payment; preview before). */
  due: number;
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  /** amountIqd null = the full amount due; tenderedIqd is cash only. */
  onSettle: (method: PaymentMethod, amountIqd: number | null, tenderedIqd: number | null) => void;
}) {
  const { tr, locale } = useLocale();
  const [partial, setPartial] = useState(false);
  const [amount, setAmount] = useState(due);
  const [tendered, setTendered] = useState(0);

  // A part payment that grows past the due is just a full payment.
  useEffect(() => {
    if (!partial) setAmount(due);
  }, [due, partial]);

  const target = partial ? Math.min(amount, due) : due;
  const change = computeChange(target, tendered);
  const amountValid = target > 0 && target <= due;

  const digits = (raw: string) => Number(raw.replace(/\D/g, '')) || 0;

  const partialControl = (
    <div style={{ display: 'grid', gap: '0.4rem', marginBlockEnd: '0.75rem' }}>
      <Switch checked={partial} onChange={(v) => setPartial(v)} label={tr('ws.cashier.payment.partial')} disabled={busy} />
      {partial ? (
        <Field label={tr('ws.cashier.payment.amount')} hint={tr('ws.cashier.payment.partialHint')}>
          <input
            style={{ ...inputStyle, ...numeric, textAlign: 'end', fontSize: 'var(--tp-fs-lg)' }}
            dir="ltr"
            inputMode="numeric"
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(Math.min(digits(e.target.value), due))}
          />
        </Field>
      ) : (
        <div style={kvRow}>
          <span style={muted}>{tr('ws.cashier.payment.fullAmount')}</span>
          <Money amount={due} strong />
        </div>
      )}
    </div>
  );

  if (mode === 'card') {
    return (
      <Modal
        title={tr('op.till.payCard')}
        onClose={busy ? () => {} : onCancel}
        size="sm"
        footer={
          <>
            <Button onClick={onCancel} disabled={busy}>
              {tr('common.cancel')}
            </Button>
            <Button kind="primary" size="lg" icon="card" busy={busy} disabled={!amountValid} onClick={() => onSettle('card', partial ? target : null, null)}>
              {tr('op.till.recordPayment')}
            </Button>
          </>
        }
      >
        <MessagePresenter tone="info" icon="card" message={tr('ws.cashier.payment.cardNote')} style={{ marginBlockEnd: '0.85rem' }} />
        <div style={{ ...kvRow, fontSize: 'var(--tp-fs-xl)', fontWeight: 700, marginBlockEnd: '0.75rem' }}>
          <span>{tr('common.total')}</span>
          <Money amount={due} strong />
        </div>
        {partialControl}
        <ErrorText error={error} />
        <p style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.cashier.payment.confirmByClick')}</p>
      </Modal>
    );
  }

  return (
    <Modal
      title={tr('op.till.payCash')}
      onClose={busy ? () => {} : onCancel}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            size="lg"
            icon="banknote"
            busy={busy}
            disabled={!amountValid || !change.sufficient}
            onClick={() => onSettle('cash', partial ? target : null, tendered)}
          >
            {tr('op.till.recordPayment')}
          </Button>
        </>
      }
    >
      <div style={{ ...kvRow, fontSize: 'var(--tp-fs-xl)', fontWeight: 700, marginBlockEnd: '0.5rem' }}>
        <span>{tr('common.total')}</span>
        <Money amount={due} strong />
      </div>
      {partialControl}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '0.9rem', alignItems: 'start' }}>
        <div>
          <Field label={tr('op.till.tendered')}>
            <input
              style={{ ...inputStyle, ...numeric, fontSize: 'var(--tp-fs-2xl)', textAlign: 'end', minBlockSize: '3rem' }}
              dir="ltr"
              inputMode="numeric"
              autoFocus
              value={tendered}
              disabled={busy}
              onChange={(e) => setTendered(digits(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && amountValid && change.sufficient && !busy) {
                  e.preventDefault();
                  onSettle('cash', partial ? target : null, tendered);
                }
              }}
            />
          </Field>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBlockEnd: '0.75rem' }}>
            <Button size="sm" disabled={busy} onClick={() => setTendered(target)}>
              {tr('ws.cashier.payment.fullAmount')} · <bdi>{formatIQD(target, locale)}</bdi>
            </Button>
          </div>
        </div>
        <AmountPad value={tendered} onChange={setTendered} disabled={busy} onConfirm={() => amountValid && change.sufficient && onSettle('cash', partial ? target : null, tendered)} />
      </div>
      <ChangeDueDisplay
        due={target}
        tendered={tendered}
        change={change.sufficient ? change.changeIqd : null}
        short={change.sufficient ? null : change.shortByIqd}
      />
      <ErrorText error={error} />
      <p style={{ ...muted, fontSize: 'var(--tp-fs-xs)', marginBlockStart: '0.5rem' }}>{tr('ws.cashier.payment.confirmByClick')}</p>
    </Modal>
  );
}
