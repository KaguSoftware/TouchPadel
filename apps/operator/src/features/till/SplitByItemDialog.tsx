/**
 * Split a bill BY ITEM — SOW L444. The cashier assigns every live line to a
 * person; `app.split_by_item` (0053) returns one amount per person with the
 * discount, tax and any court fee allocated pro-rata by the SERVER.
 *
 * Every live line must be assigned: the server refuses a partial assignment,
 * so the `unallocated` state (spec 06.15) blocks the compute button here
 * rather than sending a call that will be turned away.
 *
 * This is the by-item PANEL; SplitBillDialog hosts it beside the even split.
 */
import { useMemo, useState } from 'react';
import { formatIQD } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, ErrorText, Field, Select, inputStyle } from '../../components/ui';
import { MessagePresenter, Money } from '../../components/kit';
import { kvRow, muted, numeric } from './tillStyles';

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

export function SplitByItemPanel({
  tabId,
  lines,
  due,
  busy,
  onSettleShare,
}: {
  tabId: string;
  lines: readonly SplitLine[];
  due: number;
  busy: boolean;
  /** Take one share as a payment; the tab panel owns settle_tab. */
  onSettleShare(amountIqd: number): void;
}) {
  const { tr, locale } = useLocale();
  const live = useMemo(() => lines.filter((l) => !l.voided), [lines]);
  const [parts, setParts] = useState(MIN_PARTS);
  // line id -> part index, or undefined = unallocated. Nothing is pre-assigned:
  // a split the cashier did not make is a split the guests did not agree to.
  const [assignment, setAssignment] = useState<Record<string, number | undefined>>({});
  const [shares, setShares] = useState<number[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const unassigned = live.filter((l) => assignment[l.id] === undefined || assignment[l.id]! >= parts);
  const ready = live.length > 0 && unassigned.length === 0;

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
    // Anything assigned to a part that no longer exists becomes unallocated
    // again, so reducing the count can never leave the split silently wrong.
    setAssignment((prev) => Object.fromEntries(Object.entries(prev).map(([id, p]) => [id, p !== undefined && p >= n ? undefined : p])));
  }

  return (
    <div style={{ display: 'grid', gap: '0.6rem' }}>
      <p style={muted}>{tr('ws.cashier.split.itemHint')}</p>
      <Field label={tr('ws.cashier.split.people')}>
        <input
          style={{ ...inputStyle, inlineSize: '6rem' }}
          type="number"
          dir="ltr"
          min={MIN_PARTS}
          max={MAX_PARTS}
          value={parts}
          onChange={(e) => changeParts(Number(e.target.value) || MIN_PARTS)}
        />
      </Field>

      <div style={{ border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', maxBlockSize: '16rem', overflowY: 'auto' }}>
        {live.map((l) => {
          const name = `${l.qty}× ${pickName(locale, l.menu_item)}${l.variant ? ` (${pickName(locale, l.variant)})` : ''}`;
          const current = assignment[l.id];
          return (
            <div
              key={l.id}
              className="tp-row"
              data-selected={current === undefined ? undefined : 'true'}
              style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', paddingBlock: '0.35rem', paddingInline: '0.6rem', borderBlockEnd: '1px solid var(--tp-border)' }}
            >
              <span style={{ flex: 1, minInlineSize: 0 }}>
                <bdi>{name}</bdi>
              </span>
              <span style={{ ...muted, ...numeric }}>
                <bdi>{formatIQD(l.line_total_iqd, locale)}</bdi>
              </span>
              <Select
                value={current === undefined ? '' : String(current)}
                placeholder={tr('ws.cashier.split.unallocatedHint')}
                aria-label={tr('ws.cashier.split.assignTo', { name })}
                onChange={(v) => {
                  setAssignment((prev) => ({ ...prev, [l.id]: Number(v) }));
                  setShares(null);
                }}
                options={Array.from({ length: parts }, (_, i) => ({
                  value: String(i),
                  label: tr('ws.cashier.split.person', { index: i + 1 }),
                }))}
                style={{ inlineSize: '9rem' }}
              />
            </div>
          );
        })}
      </div>

      {unassigned.length > 0 && (
        <MessagePresenter tone="refused" message={<>{tr('ws.cashier.split.unallocated', { count: unassigned.length })} {tr('ws.cashier.split.unallocatedHint')}</>} />
      )}

      <ErrorText error={error} />

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button kind="primary" busy={loading} disabled={!ready} onClick={() => void compute()}>
          {tr('ws.cashier.split.compute')}
        </Button>
      </div>

      {shares && (
        <div style={{ display: 'grid', gap: '0.3rem' }}>
          {/* These are the amounts to take, not the goods subtotals: the
              discount, tax and court fee are spread across them by the server. */}
          {shares.map((s, i) => (
            <div key={i} style={{ ...kvRow, alignItems: 'center' }}>
              <span>
                {tr('ws.cashier.split.share', { index: i + 1 })}: <Money amount={s} strong />
              </span>
              <Button icon="banknote" disabled={busy || due <= 0 || s > due} onClick={() => onSettleShare(s)}>
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
