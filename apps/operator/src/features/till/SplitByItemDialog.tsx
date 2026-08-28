/**
 * Split a bill BY ITEM — SOW L444, "Merge tables; split a bill by item or
 * evenly". Only the even split existed, and splitting by item is the case a
 * group of friends actually asks for at the desk.
 *
 * The cashier assigns every line to a person; `app.split_by_item` (0053) then
 * returns one amount per person, with the discount, tax and any court fee
 * allocated pro-rata and the rounding remainder given to the earliest parts so
 * the shares sum exactly to the bill.
 *
 * Every live line must be assigned. The server refuses a partial assignment —
 * shares that do not add up to the bill are worse than no split — so the button
 * stays disabled until the screen agrees, rather than sending a call that will
 * be turned away.
 */
import { useMemo, useState } from 'react';
import { formatIQD } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, ErrorText, Field, Modal, Select, card, inputStyle } from '../../components/ui';

export interface SplitLine {
  id: string;
  qty: number;
  line_total_iqd: number;
  voided: boolean;
  menu_item: { name_en: string; name_ar: string } | null;
  variant: { name_en: string; name_ar: string } | null;
}

const MIN_PARTS = 2;
const MAX_PARTS = 8; // A desk splitting more than eight ways is using the even split.

export function SplitByItemDialog({
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
  /** Take one share as a payment; the panel owns settle_tab. */
  onSettleShare(amountIqd: number): void;
  onClose(): void;
}) {
  const { tr, locale } = useLocale();
  const live = useMemo(() => lines.filter((l) => !l.voided), [lines]);
  const [parts, setParts] = useState(MIN_PARTS);
  // line id -> part index. Everything starts on part 1 so the common case
  // (move a few things onto Ali's share) is two taps, not twelve.
  const [assignment, setAssignment] = useState<Record<string, number>>(() =>
    Object.fromEntries(live.map((l) => [l.id, 0])),
  );
  const [shares, setShares] = useState<number[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const unassigned = live.filter((l) => assignment[l.id] === undefined || assignment[l.id]! >= parts);
  const ready = live.length > 0 && unassigned.length === 0;

  const perPartSubtotal = useMemo(() => {
    const out = Array.from({ length: parts }, () => 0);
    for (const l of live) {
      const p = assignment[l.id];
      if (p !== undefined && p < parts) out[p]! += l.line_total_iqd;
    }
    return out;
  }, [live, assignment, parts]);

  async function compute() {
    setLoading(true);
    setError(null);
    setShares(null);
    try {
      const groups: string[][] = Array.from({ length: parts }, () => []);
      for (const l of live) {
        const p = assignment[l.id];
        if (p !== undefined && p < parts) groups[p]!.push(l.id);
      }
      const res = await appRpc<number[]>('split_by_item', { p_tab_id: tabId, p_groups: groups });
      setShares(res.map(Number));
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  function changeParts(next: number) {
    const n = Math.max(MIN_PARTS, Math.min(MAX_PARTS, next));
    setParts(n);
    setShares(null);
    // Anything assigned to a part that no longer exists comes back to part 1,
    // so reducing the count can never leave the split silently incomplete.
    setAssignment((prev) =>
      Object.fromEntries(Object.entries(prev).map(([id, p]) => [id, p >= n ? 0 : p])),
    );
  }

  return (
    <Modal title={tr('op.till.splitByItem')} onClose={onClose} wide>
      <Field label={tr('op.till.splitCount')}>
        <input
          style={inputStyle}
          type="number"
          min={MIN_PARTS}
          max={MAX_PARTS}
          value={parts}
          onChange={(e) => changeParts(Number(e.target.value) || MIN_PARTS)}
        />
      </Field>

      <div style={{ ...card, maxBlockSize: '16rem', overflowY: 'auto' }}>
        {live.map((l) => (
          <div
            key={l.id}
            style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBlockEnd: '0.3rem' }}
          >
            <span style={{ flex: 1 }}>
              {l.qty}× {pickName(locale, l.menu_item)}
              {l.variant && ` (${pickName(locale, l.variant)})`}
            </span>
            <span style={{ color: 'var(--tp-muted-fg)' }}>{formatIQD(l.line_total_iqd, locale)}</span>
            <Select
              value={String(assignment[l.id] ?? 0)}
              onChange={(v) => {
                setAssignment((prev) => ({ ...prev, [l.id]: Number(v) }));
                setShares(null);
              }}
              options={Array.from({ length: parts }, (_, i) => ({
                value: String(i),
                label: tr('op.till.splitPart', { index: i + 1 }),
              }))}
              style={{ inlineSize: '7rem' }}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBlockStart: '0.4rem' }}>
        {perPartSubtotal.map((amount, i) => (
          <span key={i} style={{ fontSize: '0.85rem', color: 'var(--tp-muted-fg)' }}>
            {tr('op.till.splitPart', { index: i + 1 })}: {formatIQD(amount, locale)}
          </span>
        ))}
      </div>

      <ErrorText error={error} />

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginBlockStart: '0.5rem' }}>
        <Button onClick={onClose}>{tr('common.cancel')}</Button>
        <Button kind="primary" disabled={!ready || loading} onClick={() => void compute()}>
          {tr('op.common.apply')}
        </Button>
      </div>

      {shares && (
        <div style={{ marginBlockStart: '0.6rem' }}>
          {/* These are the amounts to take, not the goods subtotals above: the
              discount, tax and court fee are spread across them. */}
          {shares.map((s, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBlockEnd: '0.3rem',
              }}
            >
              <span>{tr('op.till.share', { index: i + 1, amount: formatIQD(s, locale) })}</span>
              <Button disabled={busy || due <= 0 || s > due} onClick={() => onSettleShare(s)}>
                {tr('op.till.settleShare')}
              </Button>
            </div>
          ))}
          <p style={{ fontSize: '0.85rem' }}>
            {tr('op.till.remaining', { amount: formatIQD(due, locale) })}
          </p>
        </div>
      )}
    </Modal>
  );
}
