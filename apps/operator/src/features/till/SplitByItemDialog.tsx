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
import { formatIQD, formatNumber } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, ErrorText, Select } from '../../components/ui';
import type { PaymentMethod } from './PaymentPane';
import { CountStepper, ShareRow } from './SplitParts';
import { muted, numeric } from './tillStyles';

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
  onSettleShare(amountIqd: number, method: PaymentMethod): void;
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
  const [taken, setTaken] = useState<ReadonlySet<number>>(new Set());

  const unassigned = live.filter((l) => assignment[l.id] === undefined || assignment[l.id]! >= parts);
  const ready = live.length > 0 && unassigned.length === 0;

  async function compute() {
    setLoading(true);
    setError(null);
    setShares(null);
    setTaken(new Set());
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
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <CountStepper label={tr('ws.cashier.split.people')} value={parts} min={MIN_PARTS} max={MAX_PARTS} onChange={changeParts} />

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--tp-sp-2)', marginBlockEnd: 'var(--tp-sp-1-5)' }}>
          <span style={{ fontWeight: 600 }}>{tr('ws.cashier.split.whoHadWhat')}</span>
          {/* Progress, not an alarm: nothing is wrong with a split the cashier
              has not finished making yet. */}
          <span style={{ ...muted, fontVariantNumeric: 'tabular-nums' }}>
            {tr('ws.cashier.split.assignedCount', { done: formatNumber(live.length - unassigned.length, locale), total: formatNumber(live.length, locale) })}
          </span>
        </div>
        <div style={{ border: '1px solid var(--tp-border)', borderRadius: 'var(--tp-radius-panel)', maxBlockSize: '16rem', overflowY: 'auto' }}>
          {live.map((l) => {
            const name = `${l.qty}× ${pickName(locale, l.menu_item)}${l.variant ? ` (${pickName(locale, l.variant)})` : ''}`;
            const current = assignment[l.id];
            return (
              <div
                key={l.id}
                className="tp-row"
                data-selected={current === undefined ? undefined : 'true'}
                style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center', minBlockSize: 'var(--tp-touch)', paddingBlock: 'var(--tp-sp-1-5)', paddingInline: 'var(--tp-sp-2-5)', borderBlockEnd: '1px solid var(--tp-border)' }}
              >
                <span style={{ flex: 1, minInlineSize: 0 }}>
                  <bdi>{name}</bdi>
                </span>
                <span style={{ ...muted, ...numeric, whiteSpace: 'nowrap' }}>
                  <bdi>{formatIQD(l.line_total_iqd, locale)}</bdi>
                </span>
                <Select
                  value={current === undefined || current >= parts ? '' : String(current)}
                  placeholder={tr('ws.cashier.split.choosePerson')}
                  aria-label={tr('ws.cashier.split.assignTo', { name })}
                  onChange={(v) => {
                    setAssignment((prev) => ({ ...prev, [l.id]: Number(v) }));
                    setShares(null);
                  }}
                  options={Array.from({ length: parts }, (_, i) => ({
                    value: String(i),
                    label: tr('ws.cashier.split.person', { index: i + 1 }),
                  }))}
                  style={{ inlineSize: '11rem' }}
                />
              </div>
            );
          })}
        </div>
      </div>

      <ErrorText error={error} />

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          kind="primary"
          busy={loading}
          disabled={!ready}
          disabledReason={!ready && live.length > 0 ? tr('ws.cashier.split.unallocatedHint') : undefined}
          onClick={() => void compute()}
        >
          {tr('ws.cashier.split.compute')}
        </Button>
      </div>

      {shares && (
        <div style={{ display: 'grid' }}>
          {/* These are the amounts to take, not the goods subtotals: the
              discount, tax and court fee are spread across them by the server. */}
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
            {tr('ws.cashier.split.remaining', { amount: formatIQD(due, locale) })} · {tr('ws.cashier.split.itemHint')}
          </p>
        </div>
      )}
    </div>
  );
}
