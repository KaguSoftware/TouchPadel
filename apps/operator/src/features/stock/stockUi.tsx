/**
 * Presentation pieces every stock screen shares.
 *
 * Quantities always carry their unit, in the reader's language ("2,000 g",
 * "٢ قطعة" style with Latin digits): a bare "2000" beside an ingredient is not
 * a figure anyone can act on, and the old screens printed raw codes ("(pc)")
 * in Arabic too.
 *
 * Costs per unit are fractional (2.5 IQD a gram), which the kit's `Money`
 * refuses by design — it throws on a non-integer so float bugs surface. The
 * Expiry screen and the history drawer crashed on exactly that. `cost()` here
 * formats a per-unit cost as a plain number with the currency after it; whole
 * amounts still go through `Money`.
 *
 * `AttentionList` is the stock twin of the Today screen's "Needs you now": each
 * row says how many, what, what to do in a sentence, and has one button that
 * opens exactly those items. The visual language (count block, severity only
 * on the count) is shared with ../ops/OpsVisuals on purpose.
 */
import type { CSSProperties, ReactNode } from 'react';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button } from '../../components/ui';
import { Icon, type IconName } from '../../components/icons';
import { SegmentedControl } from '../../components/kit';
import { MARK, MARK_FG, MARK_SOFT, type MarkTone } from '../ops/OpsVisuals';

const UNITS = ['g', 'ml', 'pc'] as const;
type Unit = (typeof UNITS)[number];
const isUnit = (u: string): u is Unit => (UNITS as readonly string[]).includes(u);

export function useStockFormat() {
  const { tr, locale } = useLocale();
  const unit = (u: string) => (isUnit(u) ? tr(`op.stock.unit.${u}`) : u);
  const num = (n: number) => formatNumber(Number(n), locale);
  return {
    unit,
    num,
    /** "2,000 g" */
    qty: (n: number, u: string) => tr('op.stock.qty', { qty: num(n), unit: unit(u) }),
    /** "+40 pcs" / "−40 pcs" — the sign is always printed on a change. */
    change: (n: number, u: string) =>
      tr('op.stock.qty', { qty: `${Number(n) > 0 ? '+' : Number(n) < 0 ? '−' : ''}${num(Math.abs(Number(n)))}`, unit: unit(u) }),
    /** "2.5 IQD" — per-unit costs are fractional; see the file comment. */
    cost: (n: number | null) => (n === null ? '—' : tr('op.stock.iqd', { amount: num(n) })),
  };
}

/** Name + prepared marker, the way every stock table leads a row. */
export function IngredientName({ name, prepared, strong }: { name: string; prepared?: boolean; strong?: boolean }) {
  const { tr } = useLocale();
  return (
    <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'baseline', flexWrap: 'wrap' }}>
      <bdi style={{ fontWeight: strong ? 600 : undefined }}>{name}</bdi>
      {prepared && <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('op.stock.prepared')}</span>}
    </span>
  );
}

export interface AttentionItem {
  key: string;
  count: number;
  tone: Exclude<MarkTone, 'neutral' | 'success'>;
  icon?: IconName;
  title: string;
  hint: string;
  action?: { label: string; onClick: () => void };
}

/**
 * The rows with a count above zero, or one green line when there are none.
 * `clear` is that line's sentence.
 */
export function AttentionList({ items, clear, compact }: { items: readonly AttentionItem[]; clear: string; compact?: boolean }) {
  const { locale } = useLocale();
  const live = items.filter((i) => i.count > 0);
  if (live.length === 0) {
    return (
      <p style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', fontWeight: 600, color: MARK_FG.success, margin: 0 }}>
        <Icon name="checkCircle" size={18} style={{ color: MARK.success, flex: '0 0 auto' }} />
        {clear}
      </p>
    );
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
      {live.map((a) => (
        <li
          key={a.key}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--tp-sp-3)',
            flexWrap: 'wrap',
            paddingBlock: compact ? 'var(--tp-sp-1-5)' : 'var(--tp-sp-2)',
            paddingInline: 'var(--tp-sp-2)',
            borderRadius: 'var(--tp-radius-ctl)',
            background: 'var(--tp-surface-2)',
          }}
        >
          <span
            style={{
              display: 'grid',
              placeItems: 'center',
              minInlineSize: '3rem',
              blockSize: compact ? '2.25rem' : '2.5rem',
              paddingInline: 'var(--tp-sp-2)',
              borderRadius: 'var(--tp-radius-ctl)',
              background: MARK_SOFT[a.tone],
              color: MARK_FG[a.tone],
              fontSize: 'var(--tp-fs-lg)',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatNumber(a.count, locale)}
          </span>
          <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', flex: '1 1 16rem', minInlineSize: 0 }}>
            <strong style={{ color: 'var(--tp-fg)' }}>{a.title}</strong>
            <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{a.hint}</span>
          </span>
          {a.action && (
            <Button size="sm" iconEnd="arrowUpRight" onClick={a.action.onClick}>
              {a.action.label}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A quiet sentence under a table or form — the one place a rule is explained. */
export function Footnote({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <p style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'flex-start', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', margin: 0, ...style }}>
      <Icon name="info" size={15} style={{ flex: '0 0 auto', marginBlockStart: '0.15rem' }} />
      <span>{children}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Touch Shop (0143): café stock vs shop stock on the shared stock screens.
// ---------------------------------------------------------------------------

export type StockKindFilter = 'all' | 'cafe' | 'shop';

/** 'shop' = retail stock rows; 'cafe' = everything else (purchased and prepared). */
export function matchesKind(kind: string | null | undefined, filter: StockKindFilter): boolean {
  if (filter === 'all') return true;
  return filter === 'shop' ? kind === 'retail' : kind !== 'retail';
}

/** Café / Shop / All. Screens render it only when the venue holds any shop stock. */
export function KindFilter({ value, onChange }: { value: StockKindFilter; onChange: (v: StockKindFilter) => void }) {
  const { tr } = useLocale();
  return (
    <SegmentedControl<StockKindFilter>
      value={value}
      onChange={onChange}
      aria-label={tr('ws.manager.stock.kindFilter.label')}
      options={[
        { value: 'all', label: tr('ws.manager.stock.kindFilter.all') },
        { value: 'cafe', label: tr('ws.manager.stock.kindFilter.cafe') },
        { value: 'shop', label: tr('ws.manager.stock.kindFilter.shop') },
      ]}
    />
  );
}
