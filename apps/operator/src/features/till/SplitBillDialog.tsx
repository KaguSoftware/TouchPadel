/**
 * SplitBillScreen (spec 06.15): one dialog, two modes.
 *   even  → app.split_evenly(p_tab_id, p_n) returns the shares (rounding
 *           remainder to the first shares) — rendered, never recomputed here.
 *   item  → SplitByItemPanel (assign lines → app.split_by_item).
 * Each share is taken as a payment through the tab panel's settle — by cash
 * or by card: a group splitting a bill rarely pays it all the same way, and
 * cash was the only choice.
 *
 * The even split asks the server again whenever the number of people changes,
 * so there is no "Compute shares" press between choosing four people and
 * seeing four amounts.
 */
import { useEffect, useState } from 'react';
import { formatIQD } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Modal } from '../../components/ui';
import { SegmentedControl } from '../../components/kit';
import type { PaymentMethod } from './PaymentPane';
import { SplitByItemPanel, type SplitLine } from './SplitByItemDialog';
import { CountStepper, ShareRow } from './SplitParts';
import { muted } from './tillStyles';

type SplitMode = 'even' | 'item';

export function SplitBillDialog({
  tabId,
  lines,
  due,
  busy,
  onSettleShare,
  onClose,
}: {
  tabId: string;
  lines: readonly SplitLine[];
  due: number;
  busy: boolean;
  onSettleShare(amountIqd: number, method: PaymentMethod): void;
  onClose(): void;
}) {
  const { tr } = useLocale();
  const [mode, setMode] = useState<SplitMode>('even');
  return (
    <Modal title={tr('ws.cashier.split.title')} onClose={onClose} size="lg" footer={(close) => (<Button onClick={close}>{tr('common.close')}</Button>)}>
      <div style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
        <SegmentedControl<SplitMode>
          value={mode}
          onChange={setMode}
          aria-label={tr('ws.cashier.split.title')}
          options={[
            { value: 'even', label: tr('ws.cashier.split.modeEven'), icon: 'users' },
            { value: 'item', label: tr('ws.cashier.split.modeItem'), icon: 'receipt' },
          ]}
        />
      </div>
      {mode === 'even' ? (
        <SplitEvenlyPanel tabId={tabId} due={due} busy={busy} onSettleShare={onSettleShare} />
      ) : (
        <SplitByItemPanel tabId={tabId} lines={lines} due={due} busy={busy} onSettleShare={onSettleShare} />
      )}
    </Modal>
  );
}

function SplitEvenlyPanel({
  tabId,
  due,
  busy,
  onSettleShare,
}: {
  tabId: string;
  due: number;
  busy: boolean;
  onSettleShare(amountIqd: number, method: PaymentMethod): void;
}) {
  const { tr, locale } = useLocale();
  const [n, setN] = useState(2);
  const [shares, setShares] = useState<number[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const [taken, setTaken] = useState<ReadonlySet<number>>(new Set());
  const hasDue = due > 0;

  // Ask again whenever the head-count changes. NOT when the amount due
  // changes: taking the first person's share lowers it, and re-splitting
  // then would halve the second person's share.
  useEffect(() => {
    setTaken(new Set());
    if (!hasDue) {
      setShares(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    appRpc<number[]>('split_evenly', { p_tab_id: tabId, p_n: n })
      .then((res) => {
        if (!cancelled) setShares(res.map(Number));
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above: `due` is deliberately not a trigger.
  }, [tabId, n]);

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }} aria-busy={loading || undefined}>
      <CountStepper label={tr('ws.cashier.split.people')} value={n} min={2} max={50} onChange={setN} />
      <ErrorText error={error} />
      {shares && (
        <div style={{ display: 'grid' }}>
          {shares.map((s, i) => (
            <ShareRow
              key={i}
              index={i}
              amount={s}
              due={due}
              busy={busy}
              taken={taken.has(i)}
              onSettle={(m) => {
                setTaken((prev) => new Set(prev).add(i));
                onSettleShare(s, m);
              }}
            />
          ))}
          <p style={{ ...muted, marginBlockStart: 'var(--tp-sp-2)' }}>
            {tr('ws.cashier.split.remaining', { amount: formatIQD(due, locale) })} · {tr('ws.cashier.split.evenHint')}
          </p>
        </div>
      )}
    </div>
  );
}
