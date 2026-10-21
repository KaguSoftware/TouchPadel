/**
 * The Breakdown cards (Sait, 2026-10-19): a Touch Blue frame holding a row of
 * figure cards, each in its own colour, first built for the owner overview and
 * now shared with the revenue report's figures.
 *
 * - BreakdownFrame: the frame, its back/forward pager and the note under the
 *   cards. Four cards across; the rest are a sideways scroll away.
 * - BreakdownCard: one card, a title band and an outline in its colour and a
 *   wash of it behind the rows (GlobalStyles, .tp-breakdown-*).
 * - BreakdownRows: the card's figure rows, three shown, "View more" for the
 *   rest.
 *
 * Every card takes the frame's five shared tracks through a subgrid (band,
 * three rows, "View more"), so each band and each row is as tall as its
 * neighbours'.
 */
import { createContext, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { formatNumber } from '@touch/i18n';
import { useLocale } from '../lib/i18n';
import { Button } from './ui';
import { ComparisonDelta, LIST_CAP, Panel, useListCap } from './kit';
import { Icon } from './icons';
import { InfoTip } from './InfoTip';

export type BreakdownTone = 'green' | 'violet' | 'rose' | 'sky' | 'teal' | 'gold';

/** The card colours in their place order, for a screen that colours by position. */
export const BREAKDOWN_TONES: readonly BreakdownTone[] = ['green', 'violet', 'rose', 'sky', 'teal', 'gold'];

/**
 * The cards in one row, four across; the rest are a sideways scroll away
 * rather than wrapping under (Sait, 2026-10-18). A narrow window shows fewer,
 * so no card drops below 15rem. The frame's title band carries back and
 * forward buttons (Sait picked them over edge fades and dots, then dropped the
 * "1–4 of 5" count, 2026-10-18). They only appear when some card is out of view.
 */
/** The cards' heading rank, one below their frame's. */
const CardLevel = createContext<3 | 4>(3);

/**
 * A sideways row of cards and its back/forward pager, shared by the Breakdown
 * frame and the analytics Patterns card. `ref` and `measure` (as onScroll) go
 * on the row; `pager` is null while every card is in view.
 */
export function useCardRow() {
  const { tr } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ first: 0, last: 0, total: 0 });

  // Which cards are fully in view. Re-measured after every render too: the
  // cards arrive (and some come and go) without the row changing size.
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const shown = Array.from(el.children).flatMap((card, i) => {
      const r = card.getBoundingClientRect();
      return r.left >= box.left - 1 && r.right <= box.right + 1 ? [i] : [];
    });
    const next = {
      first: shown.length ? Math.min(...shown) : 0,
      last: shown.length ? Math.max(...shown) : 0,
      total: el.children.length,
    };
    setView((v) => (v.first === next.first && v.last === next.last && v.total === next.total ? v : next));
  };
  useLayoutEffect(measure);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // One card per click, always lined up on the start edge (snapped, with the
  // row's padding as the scroll padding, which scrollIntoView honours), so the
  // card that leaves goes fully out of view instead of staying half shown
  // (Sait, 2026-10-19). Start/end, so RTL needs nothing of its own.
  const move = (forward: boolean) => {
    const target = ref.current?.children[forward ? view.first + 1 : view.first - 1];
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
  };

  const hidden = view.total > 0 && view.last - view.first + 1 < view.total;
  const pager = hidden ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }} data-testid="panel-card-pager">
      <Button size="sm" icon="arrowStart" aria-label={tr('ws.kit.breakdown.back')} title={tr('ws.kit.breakdown.back')} disabled={view.first === 0} onClick={() => move(false)} />
      <Button size="sm" icon="arrowEnd" aria-label={tr('ws.kit.breakdown.more')} title={tr('ws.kit.breakdown.more')} disabled={view.last >= view.total - 1} onClick={() => move(true)} />
    </div>
  ) : null;
  return { ref, measure, pager };
}

export function BreakdownFrame({
  title,
  level = 2,
  lead,
  titleId,
  tip,
  tipLabel,
  children,
}: {
  title: string;
  /** The frame's heading rank: 3 inside a section that owns the h2. */
  level?: 2 | 3;
  /** Lead tiles in their own row above the cards, laid out by the caller (the analytics summaries). */
  lead?: ReactNode;
  /** The title's id, for a section labelled by it. */
  titleId?: string;
  /** What the frame holds, behind an "i" right after the title. */
  tip?: ReactNode;
  tipLabel?: string;
  children: ReactNode;
}) {
  const { tr } = useLocale();
  const { ref, measure, pager } = useCardRow();

  return (
    // A grouping Panel: a Touch Blue band in both modes over its own ground,
    // the cards in their own colours on it (Sait, 2026-10-19).
    <Panel
      title={titleId ? <span id={titleId}>{title}</span> : title}
      // The frame's "i" sits right after its title, like a section heading's
      // (Sait, 2026-10-19); the cards' and tiles' sit at their bands' end.
      titleEnd={tip && <InfoTip content={tip} label={tipLabel} style={{ marginBlock: '-0.4rem' }} />}
      level={level}
      band="group"
      padded={false}
      style={{ background: 'var(--tp-breakdown-frame)' }}
      actions={pager}
    >
      {lead && <div style={{ paddingInline: 'var(--tp-sp-4)', paddingBlockStart: 'var(--tp-sp-4)' }}>{lead}</div>}
      <div
        ref={ref}
        onScroll={measure}
        data-testid="panel-card-row"
        style={{
          display: 'grid',
          gridAutoFlow: 'column',
          gridAutoColumns: 'minmax(max(15rem, calc((100% - 3 * var(--tp-sp-4)) / 4)), 1fr)',
          // Five shared tracks (band, three rows, "View more") that every
          // card takes through its subgrid, so the cards line up row by row.
          gridTemplateRows: 'repeat(5, auto)',
          columnGap: 'var(--tp-sp-4)',
          rowGap: 0,
          overflowX: 'auto',
          padding: 'var(--tp-sp-4)',
          // The pager does the telling; no scrollbar band under the cards.
          scrollbarWidth: 'none',
          // Every stop puts a card's start on the row's padding edge.
          scrollSnapType: 'x mandatory',
          scrollPaddingInline: 'var(--tp-sp-4)',
        }}
      >
        <CardLevel.Provider value={level === 3 ? 4 : 3}>{children}</CardLevel.Provider>
      </div>
      {/* The one note that the figures open, instead of an arrow on every row. */}
      <p style={{ paddingInline: 'var(--tp-sp-4)', paddingBlockEnd: 'var(--tp-sp-3)', textAlign: 'center', fontSize: 'var(--tp-fs-xs)' }}>
        {tr('ws.kit.breakdown.hint')}
      </p>
    </Panel>
  );
}

/** One card: the title band (with an optional one-line hint and an action at its end), then its rows. */
export function BreakdownCard({
  tone,
  title,
  hint,
  action,
  alone,
  bandRow,
  children,
  'data-testid': testId,
}: {
  tone: BreakdownTone;
  title: string;
  /** What the card counts, behind an info tip at the band's end. */
  hint?: string;
  action?: ReactNode;
  /** Not in a BreakdownFrame (a card beside other tiles): it stacks its own
      parts instead of taking the frame's shared tracks. */
  alone?: boolean;
  /** In a row of two shared tracks (band, body), as the analytics zone row:
      the band takes the first, everything under it the second. */
  bandRow?: boolean;
  children: ReactNode;
  'data-testid'?: string;
}) {
  const { tr } = useLocale();
  const Heading = `h${useContext(CardLevel)}` as 'h3' | 'h4';
  return (
    <section
      className="tp-breakdown-card"
      data-tone={tone}
      data-testid={testId}
      style={{
        position: 'relative',
        ...(bandRow
          ? { display: 'grid', gridRow: 'span 2', gridTemplateRows: 'subgrid', rowGap: 0 }
          : alone
            ? { display: 'flex', flexDirection: 'column' }
            : { display: 'grid', gridRow: 'span 5', gridTemplateRows: 'subgrid', rowGap: 0 }),
        borderRadius: 'var(--tp-radius-panel)',
        overflow: 'hidden',
        minInlineSize: 0,
      }}
    >
      <div
        className="tp-breakdown-head"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--tp-sp-2)',
          paddingBlock: 'var(--tp-sp-3)',
          paddingInline: 'var(--tp-sp-4)',
        }}
      >
        {/* With a button in the band, the "i" sits right after the title and
            the button takes the line's end; with none, the "i" takes the end
            (Sait, 2026-10-19). Each control's own padding is pulled back, so
            the last one's icon ends on the card's inset. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1)', minInlineSize: 0 }}>
          <Heading style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700, minInlineSize: 0 }}>{title}</Heading>
          {action && hint && <InfoTip content={hint} label={tr('ws.kit.breakdown.about', { title })} style={{ marginBlock: '-0.4rem' }} />}
        </div>
        {action ? (
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, marginInlineEnd: 'calc(-1 * var(--tp-sp-2))' }}>{action}</div>
        ) : (
          hint && <InfoTip content={hint} label={tr('ws.kit.breakdown.about', { title })} style={{ marginInlineEnd: 'calc((14px - 1.85rem) / 2)', flexShrink: 0 }} />
        )}
      </div>
      {bandRow ? <div style={{ minInlineSize: 0 }}>{children}</div> : children}
    </section>
  );
}

/** One figure row of a card. */
export interface BreakdownItem {
  key: string;
  label: string;
  /** A small note beside the label ("All branches", "54 bookings"). */
  note?: string;
  /** The value, formatted. */
  value: string;
  /** The change against the compared period; left out when not comparing. */
  change?: { changeAbs?: number | null; changePct?: number | null } | null;
  format?: (n: number) => string;
  /** A rise is bad news (waste, refunds, discounts). */
  invert?: boolean;
  /** What a click does; a row without one is not a control. */
  onOpen?: () => void;
  /** The row's tooltip ("Transactions behind this figure"). */
  openTitle?: string;
}

/**
 * The look of one figure row: label and change at the start, the value at the
 * end, the card's inset around it. Shared so a screen that draws its own row
 * (the analytics figures, with their info tips) matches these.
 */
export const breakdownRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  columnGap: 'var(--tp-sp-3)',
  inlineSize: '100%',
  blockSize: '100%',
  minBlockSize: 'var(--tp-breakdown-row)',
  paddingBlock: 'var(--tp-sp-3)',
  paddingInline: 'var(--tp-sp-4)',
  // No inline background: the class gives the row a transparent one that
  // the hover rule can still paint over (an inline one always won).
  border: 'none',
  color: 'inherit',
  textAlign: 'start',
  font: 'inherit',
};

/** A card's figure rows: label, value and change. Three show; "View more" keeps the card's size and scrolls. */
export function BreakdownRows({ items }: { items: readonly BreakdownItem[] }) {
  return <BreakdownList rows={items.map((item) => ({ key: item.key, node: <BreakdownRow item={item} /> }))} />;
}

function BreakdownRow({ item }: { item: BreakdownItem }) {
  const body = (
    <>
      <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
        <span style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 500 }}>
          {item.label}
          {item.note && (
            <>
              <span aria-hidden="true" style={{ marginInline: 'var(--tp-sp-1-5)' }}>·</span>
              <span style={{ fontSize: 'var(--tp-fs-xs)' }}>{item.note}</span>
            </>
          )}
        </span>
        {item.change && <ComparisonDelta changeAbs={item.change.changeAbs} changePct={item.change.changePct} format={item.format} invert={item.invert} />}
      </span>
      <span dir="ltr" style={{ fontSize: 'var(--tp-fs-xl)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--tp-font-numeric)' }}>
        {item.value}
      </span>
    </>
  );
  // A figure with nothing to open is not a control at all, so the keyboard
  // walks past it instead of landing on something that cannot answer
  // (rulebook 4.3). The frame's note says the rows open, so they carry no
  // arrow (Sait, 2026-10-19).
  return item.onOpen ? (
    <button type="button" className="tp-row" data-clickable="true" onClick={item.onOpen} title={item.openTitle} style={{ ...breakdownRowStyle, cursor: 'pointer' }}>
      {body}
    </button>
  ) : (
    <div style={breakdownRowStyle}>{body}</div>
  );
}

/**
 * Any card's rows, each one already drawn (`node`): the first three, then
 * "View more", which keeps the card's size and lets the whole list scroll
 * over the same area (Sait, 2026-10-19).
 */
export function BreakdownList({ rows }: { rows: readonly { key: string; node: ReactNode }[] }) {
  const { tr, locale } = useLocale();
  const cap = useListCap(rows);
  // `height`: the opened list gives each row the height it had in the card
  // row (and the extra rows the last one's), so opening moves nothing.
  const rowOf = (row: { key: string; node: ReactNode }, height?: number, revealed?: boolean) => (
    <li key={row.key} className={revealed ? 'tp-breakdown-revealed' : undefined} style={height ? { blockSize: `${height}px`, boxSizing: 'border-box' } : undefined}>
      {row.node}
    </li>
  );
  const first = rows.slice(0, LIST_CAP);
  // The three rows' heights, read as the list opens: spacers of exactly those
  // heights then hold the frame's shared tracks, so nothing resizes, and the
  // whole list opens over the same area and scrolls (Sait, 2026-10-19).
  const listRef = useRef<HTMLUListElement>(null);
  const [held, setHeld] = useState<number[]>([]);
  // The opened list's scrollbar is drawn over the rows (a thumb, not the
  // native bar), so it takes no width from them (Sait, 2026-10-19).
  const scrollRef = useRef<HTMLUListElement>(null);
  const [thumb, setThumb] = useState<{ top: number; size: number } | null>(null);
  const placeThumb = () => {
    const el = scrollRef.current;
    if (!el || el.scrollHeight <= el.clientHeight) return setThumb(null);
    const size = Math.max(24, (el.clientHeight * el.clientHeight) / el.scrollHeight);
    const top = (el.scrollTop / (el.scrollHeight - el.clientHeight)) * (el.clientHeight - size);
    setThumb({ top, size });
  };
  useLayoutEffect(placeThumb, [cap.open, held]);
  const dragThumb = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || !thumb) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startTop = el.scrollTop;
    const ratio = (el.scrollHeight - el.clientHeight) / (el.clientHeight - thumb.size);
    const onMove = (m: PointerEvent) => { el.scrollTop = startTop + (m.clientY - startY) * ratio; };
    const target = e.currentTarget;
    const stop = () => { target.removeEventListener('pointermove', onMove); target.removeEventListener('pointerup', stop); };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', stop);
  };
  // Opening and closing (Sait, 2026-10-19, an asked-for exception to
  // DESIGN.md's "nothing the operator causes animates"): opening moves
  // nothing, it only brings the scroll bar in; closing glides back to the top
  // before the list folds. Reduced motion jumps instead.
  const still = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [closing, setClosing] = useState(false);
  const toggle = () => {
    if (closing) return;
    if (!cap.open) {
      setHeld(Array.from(listRef.current?.children ?? [], (li) => li.getBoundingClientRect().height));
      cap.toggle();
      return;
    }
    const el = scrollRef.current;
    if (!el || still() || el.scrollTop === 0) return cap.toggle();
    setClosing(true);
    el.scrollTo?.({ top: 0, behavior: 'smooth' });
    window.setTimeout(() => {
      setClosing(false);
      cap.toggle();
    }, 260);
  };
  return (
    <>
      <div className="tp-breakdown-body">
      {cap.open ? (
        <ul className="tp-breakdown-rows" aria-hidden="true">
          {held.map((h, i) => (
            // No divider of their own: the opened list lies over them and draws its own.
            <li key={i} style={{ blockSize: `${h}px`, boxSizing: 'border-box', border: 'none' }} />
          ))}
        </ul>
      ) : (
        <ul ref={listRef} className="tp-breakdown-rows">
          {first.map((row) => rowOf(row))}
        </ul>
      )}
      {cap.open && (
        <ul ref={scrollRef} onScroll={placeThumb} className="tp-breakdown-rows tp-breakdown-scroll">
          {cap.shown.map((row, i) => rowOf(row, held[i] ?? held[held.length - 1], i >= LIST_CAP))}
        </ul>
      )}
      {cap.open && thumb && (
        <div aria-hidden="true" className="tp-breakdown-track">
          <div className="tp-breakdown-thumb" onPointerDown={dragThumb} style={{ insetBlockStart: `${thumb.top}px`, blockSize: `${thumb.size}px` }} />
        </div>
      )}
      </div>
      {cap.hidden > 0 && (
        <button
          type="button"
          className="tp-breakdown-more"
          aria-expanded={cap.open}
          onClick={toggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--tp-sp-2)',
            inlineSize: '100%',
            paddingBlock: 'var(--tp-sp-3)',
            paddingInline: 'var(--tp-sp-4)',
            color: 'inherit',
            font: 'inherit',
            fontSize: 'var(--tp-fs-md)',
            fontWeight: 500,
            textAlign: 'start',
            cursor: 'pointer',
          }}
        >
          {cap.open && !closing ? tr('ws.kit.list.showLess') : tr('ws.kit.list.viewMore', { count: formatNumber(cap.hidden, locale) })}
          <span className="tp-breakdown-chevron" data-open={cap.open && !closing} style={{ display: 'inline-flex' }}>
            <Icon name="chevronDown" size={14} />
          </span>
        </button>
      )}
    </>
  );
}
