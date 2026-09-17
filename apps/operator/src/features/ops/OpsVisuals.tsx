/**
 * The building blocks of the manager's Today screen (spec 06.21).
 *
 * The previous version drew a bar under almost every figure: a meter for
 * arrivals, ranked ladders for the kitchen and stock, and bars for the
 * exceptions. On a real day most of those bars were empty tracks (0 booked,
 * 0 IQD of voids) or two bars of identical length in different colours (390
 * waiting, 390 late), so the page carried a lot of ink that said nothing a
 * manager could act on. Worse, the stock card printed "Low stock 3" as its
 * large figure and then again as the first bar beneath it.
 *
 * What replaced them is deliberately plainer: a figure is a labelled row with
 * its number at the end. Two things carry meaning, and only two:
 *
 *  - **Tone appears only when a figure is non-zero, and only on the number.**
 *    A warn or danger figure at zero prints muted, so colour always means
 *    "there is something here". Labels stay quiet: when the first draft tinted
 *    them too, a busy stock card was five coloured lines and read as one alarm.
 *    Status is never colour alone — the label says what it is.
 *  - **A row that opens something looks like it does.** It is a button with a
 *    chevron and a hover state, and it opens the screen that shows exactly
 *    those items (low stock opens On hand filtered to low stock), not a
 *    general landing page the manager then has to search.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { ChevronForward, Icon, type IconName } from '../../components/icons';

/** The severities a figure can wear. */
export type MarkTone = 'neutral' | 'success' | 'warn' | 'danger';

/** Small marks (icons, dots): the `-mark` rungs, which hold contrast at 16px. */
export const MARK: Record<MarkTone, string> = {
  neutral: 'var(--tp-neutral-mark)',
  success: 'var(--tp-success-mark)',
  warn: 'var(--tp-warn-mark)',
  danger: 'var(--tp-danger-mark)',
};

/** Text. Ink tokens, never a fill. */
export const MARK_FG: Record<MarkTone, string> = {
  neutral: 'var(--tp-fg)',
  success: 'var(--tp-success-fg)',
  warn: 'var(--tp-warn-fg)',
  danger: 'var(--tp-danger-fg)',
};

/** Soft grounds, for the count block on a "needs you now" row. */
export const MARK_SOFT: Record<MarkTone, string> = {
  neutral: 'var(--tp-neutral-soft)',
  success: 'var(--tp-success-soft)',
  warn: 'var(--tp-warn-soft)',
  danger: 'var(--tp-danger-soft)',
};

const rowShell = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--tp-sp-2)',
  inlineSize: '100%',
  minBlockSize: '2.25rem',
  paddingBlock: 'var(--tp-sp-1-5)',
  paddingInline: 'var(--tp-sp-2)',
  fontSize: 'var(--tp-fs-sm)',
  border: '1px solid transparent',
  borderRadius: 'var(--tp-radius-ctl)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
} as const;

/** Whether any row in the surrounding list opens something. */
const ChevronColumn = createContext(false);

/**
 * A card's rows. `chevrons` says whether any of them opens something, so rows
 * that do not can keep the chevron's space and the numbers stay in one column.
 * Pulled out by the row padding so the row text lines up with the card's own.
 */
export function RowList({ chevrons, children }: { chevrons: boolean; children: ReactNode }) {
  return (
    <ChevronColumn.Provider value={chevrons}>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-0)', marginInline: 'calc(-1 * var(--tp-sp-2))' }}>{children}</div>
    </ChevronColumn.Provider>
  );
}

/**
 * One labelled figure.
 *
 * `value` is a number (formatted here, tinted by `tone` only when above zero),
 * `null` (the server did not report it — prints "—", never a made-up zero), or
 * any node (a time, a name, an amount).
 */
export function FigureRow({
  label,
  value,
  tone = 'neutral',
  hint,
  onOpen,
}: {
  label: string;
  value: number | null | ReactNode;
  tone?: MarkTone;
  hint?: ReactNode;
  onOpen?: () => void;
}) {
  const { locale } = useLocale();
  const chevrons = useContext(ChevronColumn);
  const isCount = typeof value === 'number' || value === null;
  const active = typeof value === 'number' && value > 0 && tone !== 'neutral';
  const printed = value === null ? '—' : typeof value === 'number' ? formatNumber(value, locale) : value;

  const body = (
    <>
      <span style={{ display: 'grid', minInlineSize: 0, textAlign: 'start' }}>
        <span style={{ color: 'var(--tp-muted-fg)' }}>{label}</span>
        {hint && <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{hint}</span>}
      </span>
      <span
        style={{
          marginInlineStart: 'auto',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'end',
          // An amount is one token: "65,000 IQD" never breaks across lines,
          // however long the hint beside it runs.
          whiteSpace: 'nowrap',
          // Zero and unreported counts recede; everything else reads at full ink.
          color: active ? MARK_FG[tone] : isCount && !value ? 'var(--tp-muted-fg)' : 'var(--tp-fg)',
        }}
      >
        {printed}
      </span>
      {onOpen && <ChevronForward size={14} style={{ color: 'var(--tp-muted-fg)', flex: '0 0 auto' }} />}
    </>
  );

  if (!onOpen) {
    // In a list where other rows carry a chevron, leave its space so every
    // number ends on the same edge.
    return <div style={{ ...rowShell, ...(chevrons ? { paddingInlineEnd: 'calc(var(--tp-sp-2) + 14px + var(--tp-sp-2))' } : null) }}>{body}</div>;
  }
  return (
    <button type="button" className="tp-tile" onClick={onOpen} style={rowShell}>
      {body}
    </button>
  );
}

/** A small caption that splits a card's rows into named groups ("Kitchen"). */
export function RowGroupLabel({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        marginBlockStart: 'var(--tp-sp-2)',
        paddingInline: 'var(--tp-sp-2)',
        fontSize: 'var(--tp-fs-xs)',
        fontWeight: 600,
        color: 'var(--tp-muted-fg)',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {children}
    </p>
  );
}

/** A panel title with its glyph. */
export function CardTitle({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
      <Icon name={icon} size={16} style={{ color: 'var(--tp-muted-fg)' }} />
      {children}
    </span>
  );
}

/**
 * One step on the way to closing the day: a tick when it is done, its number
 * when it is not, and a short status at the end of the line.
 */
export function Step({
  index,
  title,
  done,
  status,
  tone,
  children,
}: {
  index: number;
  title: string;
  done: boolean;
  status?: string;
  tone: MarkTone;
  children?: ReactNode;
}) {
  const { locale } = useLocale();
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '1.5rem 1fr', columnGap: 'var(--tp-sp-2)', rowGap: 'var(--tp-sp-2)', alignItems: 'center' }}>
      {done ? (
        <Icon name="checkCircle" size={20} style={{ color: MARK.success }} />
      ) : (
        <span
          aria-hidden="true"
          style={{
            display: 'grid',
            placeItems: 'center',
            inlineSize: '1.375rem',
            blockSize: '1.375rem',
            borderRadius: '999px',
            fontSize: 'var(--tp-fs-xs)',
            fontWeight: 700,
            background: MARK_SOFT[tone],
            color: MARK_FG[tone],
          }}
        >
          {formatNumber(index, locale)}
        </span>
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', fontSize: 'var(--tp-fs-sm)' }}>
        <span style={{ fontWeight: 600, color: done ? 'var(--tp-muted-fg)' : 'var(--tp-fg)' }}>{title}</span>
        {status && (
          <span style={{ marginInlineStart: 'auto', fontWeight: 600, color: done ? MARK_FG.success : MARK_FG[tone] }}>{status}</span>
        )}
      </div>
      {children && <div style={{ gridColumn: 2 }}>{children}</div>}
    </li>
  );
}
