/**
 * Offline tab detail — a tab that exists only in the durable queue. Lines are
 * priced from the cached menu (the same prices the server will snapshot at
 * replay) and the bill is worked out the way the server will (offlineTotals,
 * F-06): tax per group at the cached rate, and any discount queued here.
 *
 * Taking the money (F-09) goes through the till's own payment pane, so it
 * meets the same till-shift gate the online path does, shows the amount, and
 * is confirmed with a press — Card used to settle in one tap with no amount.
 * The queued settle carries that amount as `expectedTotalIqd`: the server
 * charges exactly it or refuses TOTAL_CHANGED, and a refusal comes back here
 * as a row the cashier can take again at the server's total or have a manager
 * set aside (lib/offlineTabs, refusedSettle.ts).
 *
 * Discount is always offered (F-09): a whole-tab discount rides the queue as
 * adjustment.apply against the tab.open key, its manager PIN checked against
 * the station's own PIN cache on the spot when offline (F-05), never queued
 * on trust to fail after reconnect.
 *
 * Basket lines not yet sent are not on this bill: Cash and Card ask first
 * (UnsentLinesGuard, F-32).
 */
import { useMemo, useState } from 'react';
import { formatIQD } from '@touch/i18n';
import { mutate } from '../../lib/mutate';
import { appendOfflineAdjustment, getOfflineTab, markOfflineSettled, removeOfflineTab } from '../../lib/offlineTabs';
import { assertManagerPinOffline } from '../../lib/offlinePin';
import { errorCodeToMessageKey } from '../../lib/errors';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Field, PinReasonModal, inputStyle } from '../../components/ui';
import { MessagePresenter, PinPromptOverlay, SegmentedControl } from '../../components/kit';
import { PaymentPane, type PaymentMethod } from './PaymentPane';
import { UnsentLinesGuard, needsUnsentConfirm } from './UnsentLinesGuard';
import { discountAmountIqd, offlineSettlePayload, offlineTabTotals } from './offlineTotals';
import { resolveRefusedRow } from './refusedSettle';
import { useTaxContext } from './useTaxContext';
import { kvRow, muted, numeric } from './tillStyles';

type Overlay =
  | { kind: 'none' }
  | { kind: 'unsent'; method: PaymentMethod }
  | { kind: 'pay'; method: PaymentMethod; due: number }
  | { kind: 'discount' }
  | { kind: 'resolve' };

export function OfflineTabPanel({
  idemKey,
  onSettled,
  unsentCount = 0,
}: {
  idemKey: string;
  onSettled: () => void;
  /** Lines in the till's basket not yet sent to this tab — they are not on its bill (F-32). */
  unsentCount?: number;
}) {
  const { tr, locale } = useLocale();
  const taxCtx = useTaxContext();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const [discountKind, setDiscountKind] = useState<'discount_percent' | 'discount_amount'>('discount_percent');
  const [discountValue, setDiscountValue] = useState(10);
  const tab = getOfflineTab(idemKey);
  const totals = useMemo(() => (tab ? offlineTabTotals(tab, taxCtx) : null), [tab, taxCtx]);
  if (!tab || !totals) return null;

  const close = () => setOverlay({ kind: 'none' });
  const settleFailure = tab.failure?.on === 'settle' ? tab.failure : null;
  const openFailure = tab.failure && !settleFailure ? tab.failure : null;
  const payable = tab.lines.length > 0 && !tab.settled && !tab.failure;

  /** Cash or Card pressed: unsent basket lines first, then the pane. */
  function startPay(method: PaymentMethod, due: number) {
    setError(null);
    if (needsUnsentConfirm(unsentCount)) setOverlay({ kind: 'unsent', method });
    else setOverlay({ kind: 'pay', method, due });
  }

  async function settleOffline(method: PaymentMethod, due: number, tenderedIqd: number | null) {
    setBusy(true);
    setError(null);
    try {
      const outcome = await mutate('tab.settle', offlineSettlePayload({ tabIdemKey: idemKey, method, totalIqd: due, tenderedIqd }));
      // Queued: the tab stays, marked settled, until this settle acks
      // (lib/offlineTabs). Acked inside mutate()'s wait: its result has already
      // fired before we could record the key, so retire it here.
      if (outcome.queued) markOfflineSettled(idemKey, outcome.idempotencyKey, { method, amountIqd: due, tenderedIqd });
      else removeOfflineTab(idemKey);
      close();
      onSettled();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function applyDiscount(pin: string, reasonCode: string) {
    if (!tab || !totals) return;
    setBusy(true);
    setError(null);
    try {
      // F-05: offline, a wrong PIN is refused here and now, before anything queues.
      await assertManagerPinOffline(pin);
      const value = discountKind === 'discount_percent' ? discountValue * 100 : discountValue;
      const outcome = await mutate('adjustment.apply', { kind: discountKind, tabIdemKey: idemKey, value, pin, reasonCode });
      appendOfflineAdjustment(idemKey, {
        kind: discountKind,
        value,
        amountIqd: discountAmountIqd(discountKind, value, totals.subtotal),
        idemKey: outcome.idempotencyKey,
      });
      setNotice(tr('ws.cashier.offlinePay.discountQueued'));
      close();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function resolve(pin: string) {
    if (!settleFailure?.settleIdemKey) return;
    setBusy(true);
    setError(null);
    try {
      await resolveRefusedRow(settleFailure.settleIdemKey, pin);
      removeOfflineTab(idemKey);
      close();
      onSettled();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const retryDue = settleFailure?.serverTotalIqd ?? totals.total;

  return (
    <section aria-label={tr('ws.cashier.till.regionTab')} style={{ display: 'grid', gap: 'var(--tp-sp-2-5)', alignContent: 'start', paddingBlock: 'var(--tp-sp-3)' }}>
      <h2 style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700 }}>
        <bdi>{tab.tableNumber ? `${tr('op.till.table')} ${tab.tableNumber}` : (tab.label ?? '—')}</bdi>
      </h2>
      {settleFailure ? (
        <div data-testid="offline-settle-refused" style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          <MessagePresenter
            tone="error"
            icon="alert"
            message={
              <>
                <strong>{tr('ws.cashier.offlinePay.refusedTitle')}</strong>{' '}
                {tr('ws.cashier.offlinePay.refusedBody', {
                  amount: formatIQD(tab.settle?.amountIqd ?? totals.total, locale),
                  reason: tr(errorCodeToMessageKey(settleFailure.code ?? 'UNKNOWN')),
                })}
              </>
            }
          />
          <p style={{ ...muted, margin: 0 }}>
            {settleFailure.serverTotalIqd != null
              ? tr('ws.cashier.offlinePay.refusedTotal', { amount: formatIQD(settleFailure.serverTotalIqd, locale) })
              : tr('ws.cashier.offlinePay.refusedNoTotal')}
          </p>
        </div>
      ) : openFailure ? (
        <MessagePresenter tone="error" icon="alert" message={tr('ws.cashier.till.rail.failed')} />
      ) : tab.settled ? (
        <MessagePresenter tone="info" icon="clock" message={tr('ws.cashier.till.rail.settledAwaitingSync')} />
      ) : (
        <MessagePresenter tone="info" icon="wifiOff" message={tr('op.till.offlineTab')} />
      )}
      {tab.lines.map((l, i) => (
        <div key={i} style={kvRow}>
          <span>
            {l.qty}× {l.name}
          </span>
          <span style={numeric}>
            <bdi>{formatIQD(l.priceIqd * l.qty, locale)}</bdi>
          </span>
        </div>
      ))}
      {totals.discount > 0 && (
        <div style={kvRow} data-testid="offline-discount-row">
          <span>{tr('common.discount')}</span>
          <span style={numeric}>
            <bdi>−{formatIQD(totals.discount, locale)}</bdi>
          </span>
        </div>
      )}
      {totals.tax > 0 && (
        <div style={kvRow} data-testid="offline-tax-row">
          <span>{taxCtx?.taxInclusive ? tr('op.till.taxIncluded') : tr('op.till.tax')}</span>
          <span style={numeric}>
            <bdi>{formatIQD(totals.tax, locale)}</bdi>
          </span>
        </div>
      )}
      <div style={{ ...kvRow, borderBlockStart: '1px solid var(--tp-border)', fontWeight: 700 }}>
        <span>{tr('op.till.estimatedTotal')}</span>
        <span style={numeric} data-testid="offline-total">
          <bdi>{formatIQD(totals.total, locale)}</bdi>
        </span>
      </div>
      {payable && <p style={{ ...muted, margin: 0, fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.cashier.offlinePay.chargeNote')}</p>}
      {notice && <MessagePresenter tone="success" message={notice} />}
      {overlay.kind === 'none' && <ErrorText error={error} />}

      {/* A settled tab is never offered Card or Cash again: the payment is
          already queued, and a second one would charge the guest twice. A
          refused OPEN cannot be paid here either; day close holds its row,
          and the cashier may take it off this till once that is seen to. */}
      {openFailure && (
        <div>
          <Button icon="trash" onClick={() => removeOfflineTab(idemKey)}>
            {tr('ws.cashier.till.rail.dismissFailed')}
          </Button>
        </div>
      )}
      {/* A refused SETTLE (F-09): take it again at the server's total, or a
          manager sets the refused row aside. */}
      {settleFailure && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
            <Button kind="primary" icon="refresh" disabled={busy || retryDue <= 0} onClick={() => startPay(tab.settle?.method ?? 'cash', retryDue)} data-testid="offline-settle-retry">
              {tr('ws.cashier.offlinePay.retry')}
            </Button>
            {settleFailure.settleIdemKey && (
              <Button icon="lock" disabled={busy} onClick={() => { setError(null); setOverlay({ kind: 'resolve' }); }} data-testid="offline-settle-resolve">
                {tr('ws.cashier.offlinePay.resolve')}
              </Button>
            )}
          </div>
          <p style={{ ...muted, margin: 0, fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.cashier.offlinePay.retryHint')}</p>
          {settleFailure.settleIdemKey && <p style={{ ...muted, margin: 0, fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.cashier.offlinePay.resolveHint')}</p>}
        </div>
      )}
      {payable && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <div style={{ display: 'flex', gap: 'var(--tp-sp-2)' }}>
            <Button kind="primary" size="lg" icon="banknote" disabled={busy || totals.total <= 0} onClick={() => startPay('cash', totals.total)}>
              {tr('op.till.payCash')}
            </Button>
            <Button size="lg" icon="card" disabled={busy || totals.total <= 0} onClick={() => startPay('card', totals.total)}>
              {tr('op.till.payCard')}
            </Button>
          </div>
          <div>
            <Button icon="tag" disabled={busy} onClick={() => { setError(null); setOverlay({ kind: 'discount' }); }} data-testid="offline-discount">
              {tr('ws.cashier.detail.discount')}
            </Button>
          </div>
        </div>
      )}

      {overlay.kind === 'unsent' && (
        <UnsentLinesGuard
          count={unsentCount}
          onCancel={close}
          onProceed={() => setOverlay({ kind: 'pay', method: overlay.method, due: settleFailure ? retryDue : totals.total })}
        />
      )}
      {overlay.kind === 'pay' && (
        <PaymentPane
          mode={overlay.method}
          due={overlay.due}
          busy={busy}
          error={error}
          allowPartial={false}
          subtitle={tr('ws.cashier.payment.queued')}
          onCancel={() => {
            close();
            setError(null);
          }}
          onSettle={(m, _amount, tendered) => void settleOffline(m, overlay.due, tendered)}
        />
      )}
      {overlay.kind === 'discount' && (
        <PinReasonModal title={tr('op.till.discount')} busy={busy} error={error} onClose={() => { close(); setError(null); }} onSubmit={(pin, reason) => void applyDiscount(pin, reason)}>
          <div style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
            <SegmentedControl<typeof discountKind>
              value={discountKind}
              onChange={(k) => {
                // A value typed for one kind means nothing in the other.
                setDiscountKind(k);
                setDiscountValue(10);
              }}
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
              aria-label={discountKind === 'discount_percent' ? tr('op.till.discountPercentLabel') : tr('op.till.discountAmountLabel')}
              onChange={(e) => {
                const v = Math.max(1, Math.floor(Number(e.target.value)) || 1);
                setDiscountValue(discountKind === 'discount_percent' ? Math.min(v, 100) : v);
              }}
            />
          </Field>
        </PinReasonModal>
      )}
      {overlay.kind === 'resolve' && (
        <PinPromptOverlay action={tr('ws.cashier.offlinePay.resolveAction')} busy={busy} error={error} onSubmit={(pin) => void resolve(pin)} onCancel={close} />
      )}
    </section>
  );
}
