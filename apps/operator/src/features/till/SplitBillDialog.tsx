/**
 * SplitBillScreen (spec 06.15): one dialog, two modes.
 *   even  → app.split_evenly(p_tab_id, p_n) returns the shares (rounding
 *           remainder to the first shares) — rendered, never recomputed here.
 *   item  → SplitByItemPanel (assign lines → app.split_by_item).
 * Each share is taken as a cash payment through the tab panel's settle.
 */
import { useState } from 'react';
import { formatIQD } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Field, Modal, inputStyle } from '../../components/ui';
import { Money, SegmentedControl } from '../../components/kit';
import { SplitByItemPanel, type SplitLine } from './SplitByItemDialog';
import { kvRow, muted } from './tillStyles';

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
  onSettleShare(amountIqd: number): void;
  onClose(): void;
}) {
  const { tr } = useLocale();
  const [mode, setMode] = useState<SplitMode>('even');
  return (
    <Modal title={tr('ws.cashier.split.title')} onClose={onClose} size="lg" footer={<Button onClick={onClose}>{tr('common.close')}</Button>}>
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
  onSettleShare(amountIqd: number): void;
}) {
  const { tr, locale } = useLocale();
  const [n, setN] = useState(2);
  const [shares, setShares] = useState<number[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await appRpc<number[]>('split_evenly', { p_tab_id: tabId, p_n: n });
      setShares(res.map(Number));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2-5)' }}>
      <p style={muted}>{tr('ws.cashier.split.evenHint')}</p>
      <div style={{ display: 'flex', gap: 'var(--tp-sp-2-5)', alignItems: 'end' }}>
        <Field label={tr('ws.cashier.split.people')} style={{ marginBlockEnd: 0 }}>
          <input
            style={{ ...inputStyle, inlineSize: '6rem' }}
            type="number"
            dir="ltr"
            min={2}
            max={50}
            value={n}
            onChange={(e) => {
              setN(Math.max(2, Math.min(50, Number(e.target.value) || 2)));
              setShares(null);
            }}
          />
        </Field>
        <Button
          kind="primary"
          busy={loading}
          disabled={due <= 0}
          disabledReason={due <= 0 ? tr('ws.cashier.detail.splitNothing') : undefined}
          onClick={() => void load()}
        >
          {tr('ws.cashier.split.compute')}
        </Button>
      </div>
      <ErrorText error={error} />
      {shares && (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
          {shares.map((s, i) => (
            <div key={i} style={{ ...kvRow, alignItems: 'center' }}>
              <span>
                {tr('ws.cashier.split.share', { index: i + 1 })}: <Money amount={s} strong />
              </span>
              <Button
                icon="banknote"
                disabled={busy || due <= 0 || s > due}
                disabledReason={!busy && s > due && due > 0 ? tr('ws.cashier.split.shareOverDue') : undefined}
                onClick={() => onSettleShare(s)}
              >
                {tr('ws.cashier.split.settleShare')}
              </Button>
            </div>
          ))}
          <p style={muted}>{tr('ws.cashier.split.remaining', { amount: formatIQD(due, locale) })}</p>
        </div>
      )}
    </div>
  );
}
