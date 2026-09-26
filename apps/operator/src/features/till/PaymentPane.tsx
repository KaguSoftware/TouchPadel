/**
 * PaymentScreen (spec 06.14) — the settle pane. A dialog on purpose: taking
 * money is a focused, trapped task on a shared till, and the e2e journeys
 * address it as `dialog "Cash"` / `dialog "Card"`.
 *
 *   cash  → Tendered (typed, keypad, or one of the note buttons) and the
 *           change to give; the preview is `computeChange` (the existing
 *           tested helper); the figure SHOWN after payment is the server's
 *           echo (change_iqd).
 *   card  → the amount the terminal approved is RECORDED, not processed.
 *   part  → either method may record less than the due; the server reports the
 *           remainder (the pay footer's "Still to pay").
 *
 * The amount to pay is printed ONCE. The previous pane printed it five times
 * on a cash payment — as "Total", as "Full amount", on the "Full amount"
 * button, as "Due" in a three-box readout, and inside "Short by …" — and
 * opened on a yellow "Short by 18,000 IQD" before the cashier had touched a
 * key. It now opens on the amount, a tendered field, the notes a guest
 * usually hands over, and a single line that answers the only question left:
 * how much change to give.
 *
 * F4/F5 only open this pane; money is confirmed by click or Enter inside it.
 *
 * THE SHIFT GATE (wave5-addendum §2.9, §5.1, §8 Q30). Inside the shell, a
 * cashier or the desk with no shift of their own open at this station meets
 * the start panel here first ("Start your shift to take payment"), and the
 * tender once it is open; someone else's open shift is closed first with a
 * manager's PIN. A manager or owner is never asked and gets one line saying
 * whose drawer the money goes into. The gate FAILS OPEN: loading, a failed
 * read or an offline station shows the tender as before. The till's and the
 * desk's payments both come through here (the desk's own cash box, §2.9.9);
 * OfflineTabPanel takes its own and is never gated. Outside the shell (these
 * screen tests) there is no shift context and nothing is gated.
 */
import { useEffect, useState } from 'react';
import { formatIQD, isolate } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { AmountPad, Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { MessagePresenter, Money } from '../../components/kit';
import { Switch } from '../../components/Switch';
import { useTillShiftOptional } from '../tillShift/shiftContext';
import { ShiftDialog } from '../tillShift/ShiftDialog';
import { gateBlocks, type GateBanner } from '../tillShift/tillShiftLogic';
import { computeChange } from './change';
import { kvRow, muted, numeric, reasonedFooter } from './tillStyles';

export type PaymentMethod = 'cash' | 'card';

/** How one payment went: taken in full, taken in part, saved on the queue, or refused. */
export type SettleResult = 'settled' | 'partial' | 'queued' | 'failed';

/** Iraqi dinar banknotes a guest hands over, smallest first. */
const NOTES_IQD = [5_000, 10_000, 25_000, 50_000] as const;

/**
 * Quick-tender amounts for a target: the exact amount, then the next few
 * round sums a guest pays it with — the smallest multiple of each banknote
 * that covers it. Distinct and ascending, at most `limit`. Presentation only:
 * the change is still `computeChange`, and the server re-stamps it.
 */
export function quickTenders(target: number, limit = 4): number[] {
  if (target <= 0) return [];
  const out = new Set<number>([target]);
  for (const note of NOTES_IQD) out.add(Math.ceil(target / note) * note);
  return [...out].sort((a, b) => a - b).slice(0, limit);
}

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
  /** Basket lines not yet sent to this tab — they are not in `due`. */
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

  const shift = useTillShiftOptional();
  if (shift && gateBlocks(shift.gate)) {
    // The shift first; once one is open the gate passes and this pane renders
    // the tender in its place, so finishing here needs no call back.
    return <ShiftDialog entry={{ kind: 'gate', onReady: noop }} onClose={onCancel} onDone={noop} />;
  }
  const banner = shift?.gate.kind === 'ok' ? shift.gate.banner : null;

  const target = partial ? Math.min(amount, due) : due;
  const change = computeChange(target, tendered);
  const amountValid = target > 0 && target <= due;

  const digits = (raw: string) => Number(raw.replace(/\D/g, '')) || 0;

  /*
   * Rulebook 4.3. The two ways to reach a dead-ended Record payment are a
   * zeroed part-payment amount and a tender that does not cover the target;
   * both are the operator's own typing, so the reason sits ON the control.
   */
  const recordBlockedReason = !amountValid
    ? tr('ws.cashier.payment.enterAmount')
    : tendered === 0
      ? tr('ws.cashier.payment.enterTendered')
      : !change.sufficient
        ? tr('ws.cashier.payment.shortTendered')
        : undefined;

  const amountBlock = (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)', marginBlockEnd: 'var(--tp-sp-3)' }}>
      <div style={{ ...kvRow, alignItems: 'center', fontSize: 'var(--tp-fs-xl)', fontWeight: 700 }}>
        <span>{partial ? tr('ws.cashier.payment.thisPayment') : tr('ws.cashier.payment.toPay')}</span>
        {partial ? (
          <input
            style={{ ...inputStyle, ...numeric, textAlign: 'end', fontSize: 'var(--tp-fs-lg)', inlineSize: '11rem' }}
            dir="ltr"
            inputMode="numeric"
            aria-label={tr('ws.cashier.payment.amount')}
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(Math.min(digits(e.target.value), due))}
          />
        ) : (
          <Money amount={due} strong />
        )}
      </div>
      <Switch checked={partial} onChange={(v) => setPartial(v)} label={tr('ws.cashier.payment.partial')} disabled={busy} />
      {partial && (
        <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>
          {tr('ws.cashier.payment.partialOf', { amount: formatIQD(due, locale) })}
        </span>
      )}
    </div>
  );

  if (mode === 'card') {
    return (
      <Modal
        title={tr('op.till.payCard')}
        dismissible={!busy}
        onClose={onCancel}
        size="sm"
        footer={
          <div style={reasonedFooter}>
            <Button onClick={onCancel} disabled={busy}>
              {tr('common.cancel')}
            </Button>
            <Button
              kind="primary"
              size="lg"
              icon="card"
              busy={busy}
              disabled={!amountValid}
              disabledReason={amountValid ? undefined : tr('ws.cashier.payment.enterAmount')}
              onClick={() => onSettle('card', partial ? target : null, null)}
            >
              {tr('op.till.recordPayment')}
            </Button>
          </div>
        }
      >
        <DrawerBanner banner={banner} />
        {amountBlock}
        <p style={{ ...muted, marginBlockEnd: 'var(--tp-sp-2)' }}>{tr('ws.cashier.payment.cardNote')}</p>
        <ErrorText error={error} />
      </Modal>
    );
  }

  const confirmCash = () => {
    if (amountValid && change.sufficient && tendered > 0 && !busy) onSettle('cash', partial ? target : null, tendered);
  };

  return (
    <Modal
      title={tr('op.till.payCash')}
      dismissible={!busy}
      onClose={onCancel}
      footer={
        <div style={reasonedFooter}>
          <Button onClick={onCancel} disabled={busy}>
            {tr('common.cancel')}
          </Button>
          <Button
            kind="primary"
            size="lg"
            icon="banknote"
            busy={busy}
            disabled={!amountValid || !change.sufficient || tendered === 0}
            disabledReason={recordBlockedReason}
            onClick={confirmCash}
          >
            {tr('op.till.recordPayment')}
          </Button>
        </div>
      }
    >
      <DrawerBanner banner={banner} />
      {amountBlock}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--tp-sp-4)', alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', alignContent: 'start' }}>
          <Field label={tr('op.till.tendered')} style={{ marginBlockEnd: 0 }}>
            <input
              style={{ ...inputStyle, ...numeric, fontSize: 'var(--tp-fs-2xl)', textAlign: 'end', minBlockSize: 'var(--tp-touch)' }}
              dir="ltr"
              inputMode="numeric"
              autoFocus
              value={tendered || ''}
              placeholder="0"
              disabled={busy}
              onChange={(e) => setTendered(digits(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirmCash();
                }
              }}
            />
          </Field>
          {/* The notes a guest pays this with, so the common case is one press
              instead of five digits. */}
          <div role="group" aria-label={tr('ws.cashier.payment.quickTender')} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--tp-sp-1-5)' }}>
            {quickTenders(target).map((v, i) => (
              <Button key={v} size="lg" disabled={busy} aria-pressed={tendered === v} onClick={() => setTendered(v)} style={{ minBlockSize: 'var(--tp-touch)' }}>
                {i === 0 ? tr('ws.cashier.payment.exact') : <bdi dir="ltr">{formatIQD(v, locale)}</bdi>}
              </Button>
            ))}
          </div>
          <ChangeLine tendered={tendered} change={change} />
        </div>
        <AmountPad value={tendered} onChange={setTendered} disabled={busy} onConfirm={confirmCash} />
      </div>
      <ErrorText error={error} />
    </Modal>
  );
}

/**
 * The one answer the cash pane owes: how much change to hand back. Neutral
 * until something is tendered; a short tender says by how much.
 */
function ChangeLine({ tendered, change }: { tendered: number; change: ReturnType<typeof computeChange> }) {
  const { tr } = useLocale();
  const tone = tendered === 0 ? 'neutral' : change.sufficient ? 'success' : 'warn';
  return (
    <div
      role="status"
      style={{
        ...kvRow,
        alignItems: 'center',
        minBlockSize: '3.25rem',
        paddingInline: 'var(--tp-sp-3)',
        borderRadius: 'var(--tp-radius-ctl)',
        background: tone === 'success' ? 'var(--tp-success-soft)' : tone === 'warn' ? 'var(--tp-warn-soft)' : 'var(--tp-surface-2)',
        color: tone === 'success' ? 'var(--tp-success-fg)' : tone === 'warn' ? 'var(--tp-warn-fg)' : 'var(--tp-muted-fg)',
        fontWeight: 700,
      }}
    >
      {tendered === 0 ? (
        // The reason Record is disabled is said under Record; here the figure
        // simply is not known yet.
        <>
          <span>{tr('ws.cashier.payment.changeToGive')}</span>
          <span aria-hidden="true">—</span>
        </>
      ) : change.sufficient ? (
        <>
          <span>{tr('ws.cashier.payment.changeToGive')}</span>
          <Money amount={change.changeIqd} strong style={{ fontSize: 'var(--tp-fs-xl)' }} />
        </>
      ) : (
        <>
          <span>{tr('ws.cashier.payment.short')}</span>
          <Money amount={change.shortByIqd} strong style={{ fontSize: 'var(--tp-fs-xl)' }} />
        </>
      )}
    </div>
  );
}

const noop = () => {};

/**
 * payOnOthersShift (§5.2): a manager or owner at a drawer that is not their own
 * shift is told, once, whose drawer the money goes into; with no shift open,
 * that it lands outside one (the next handover counts it, V18).
 */
function DrawerBanner({ banner }: { banner: GateBanner | null }) {
  const { tr } = useLocale();
  if (!banner) return null;
  if (banner.kind === 'othersDrawer') {
    return (
      <MessagePresenter
        tone="info"
        icon="drawer"
        message={tr('ws.tillShift.gate.othersDrawer', { name: isolate(banner.name) })}
        style={{ marginBlockEnd: 'var(--tp-sp-3)' }}
      />
    );
  }
  return <p style={{ ...muted, fontSize: 'var(--tp-fs-sm)', marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.tillShift.gate.noShift')}</p>;
}
