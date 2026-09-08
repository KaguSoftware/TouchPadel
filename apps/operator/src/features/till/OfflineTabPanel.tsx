/**
 * Offline tab detail — a tab that exists only in the durable queue. Lines and
 * totals are estimates from the cached menu (the same prices the server will
 * snapshot at replay); settling queues a tab.settle against the tab.open key.
 */
import { useState } from 'react';
import { formatIQD } from '@touch/i18n';
import { mutate } from '../../lib/mutate';
import { getOfflineTab, markOfflineSettled } from '../../lib/offlineTabs';
import { useLocale } from '../../lib/i18n';
import { AmountPad, Button, ErrorText, Field, inputStyle } from '../../components/ui';
import { ChangeDueDisplay, MessagePresenter } from '../../components/kit';
import { computeChange } from './change';
import { kvRow, muted, numeric } from './tillStyles';

export function OfflineTabPanel({ idemKey, onSettled }: { idemKey: string; onSettled: () => void }) {
  const { tr, locale } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [cashOpen, setCashOpen] = useState(false);
  const [tendered, setTendered] = useState(0);
  const tab = getOfflineTab(idemKey);
  if (!tab) return null;

  const total = tab.lines.reduce((sum, l) => sum + l.priceIqd * l.qty, 0);
  const change = computeChange(total, tendered);

  async function settleOffline(method: 'cash' | 'card', tenderedIqd: number | null) {
    setBusy(true);
    setError(null);
    try {
      await mutate('tab.settle', {
        tabIdemKey: idemKey,
        method,
        ...(total > 0 ? { amountIqd: total } : {}),
        ...(tenderedIqd != null ? { tenderedIqd } : {}),
      });
      markOfflineSettled(idemKey);
      onSettled();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={tr('ws.cashier.till.regionTab')} style={{ display: 'grid', gap: 'var(--tp-sp-2-5)', alignContent: 'start', paddingBlock: 'var(--tp-sp-3)' }}>
      <h2 style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700 }}>
        <bdi>{tab.tableNumber ? `${tr('op.till.table')} ${tab.tableNumber}` : (tab.label ?? '—')}</bdi>
      </h2>
      <MessagePresenter tone="info" icon="wifiOff" message={tr('op.till.offlineTab')} />
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
      <div style={{ ...kvRow, borderBlockStart: '1px solid var(--tp-border)', fontWeight: 700 }}>
        <span>{tr('op.till.estimatedTotal')}</span>
        <span style={numeric}>
          <bdi>{formatIQD(total, locale)}</bdi>
        </span>
      </div>
      <ErrorText error={error} />
      {tab.lines.length > 0 && !cashOpen && (
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)' }}>
          <Button kind="primary" size="lg" icon="banknote" disabled={busy} onClick={() => setCashOpen(true)}>
            {tr('op.till.payCash')}
          </Button>
          <Button size="lg" icon="card" busy={busy} onClick={() => void settleOffline('card', null)}>
            {tr('op.till.payCard')}
          </Button>
        </div>
      )}
      {cashOpen && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2-5)' }}>
          <Field label={tr('op.till.tendered')}>
            <input
              style={{ ...inputStyle, fontSize: 'var(--tp-fs-xl)', textAlign: 'end' }}
              dir="ltr"
              inputMode="numeric"
              value={tendered}
              onChange={(e) => setTendered(Number(e.target.value.replace(/\D/g, '')) || 0)}
            />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <AmountPad value={tendered} onChange={setTendered} disabled={busy} />
          </div>
          <ChangeDueDisplay due={total} tendered={tendered} change={change.sufficient ? change.changeIqd : null} short={change.sufficient ? null : change.shortByIqd} />
          <p style={muted}>{tr('ws.cashier.payment.queued')}</p>
          <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', justifyContent: 'flex-end', alignItems: 'flex-start', minBlockSize: '4rem' }}>
            <Button onClick={() => setCashOpen(false)} disabled={busy}>
              {tr('common.back')}
            </Button>
            <Button
              kind="primary"
              busy={busy}
              disabled={!change.sufficient}
              disabledReason={change.sufficient ? undefined : tr('ws.cashier.payment.shortTendered')}
              onClick={() => void settleOffline('cash', tendered)}
            >
              {tr('op.till.recordPayment')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
