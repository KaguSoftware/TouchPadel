/**
 * The sections ("zones") of a dashboard tab (operator-slice.md §5.3) plus the
 * scroll-spy that drives `ZoneNav`. One IntersectionObserver for all sections;
 * the topmost intersecting section wins, so a tall zone stays selected while it
 * fills the viewport. Each tab declares its own zone list (CAFE_ZONES here,
 * COURT_ZONES beside the courts tab) and hands it to Zone / ZoneNav.
 *
 * The zone's one-line description used to print beside the heading; it is an
 * explanation, not state, so it now sits behind the info button (read on
 * hover, focus or tap) and the heading row stays one line of type.
 */
import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { MessageKey } from '@touch/i18n';
import { InfoTip } from '../../components/InfoTip';
import { BreakdownFrame, useCardRow } from '../../components/BreakdownCards';
import { Panel } from '../../components/kit';
import { Icon } from '../../components/icons';
import { useLocale } from '../../lib/i18n';
import { BreakdownLook } from './cards/CardShell';

export interface ZoneDef {
  id: string;
  titleKey: MessageKey;
  /** The explanation behind the heading's info button. */
  descKey: MessageKey;
  /** Shorter label for the jump pill; falls back to the title. */
  navKey?: MessageKey;
}

export const CAFE_ZONES: readonly ZoneDef[] = [
  { id: 'pulse', titleKey: 'analytics.zones.pulse', descKey: 'analytics.zones.pulseDesc' },
  { id: 'ai', titleKey: 'analytics.zones.ai', descKey: 'analytics.zones.aiDesc', navKey: 'analytics.zones.aiNav' },
  { id: 'menu', titleKey: 'analytics.zones.menu', descKey: 'analytics.zones.menuDesc', navKey: 'analytics.zones.menuNav' },
  { id: 'sales', titleKey: 'analytics.zones.sales', descKey: 'analytics.zones.salesDesc', navKey: 'analytics.zones.salesNav' },
  { id: 'time', titleKey: 'analytics.zones.time', descKey: 'analytics.zones.timeDesc', navKey: 'analytics.zones.timeNav' },
];

/**
 * Height of the stuck AnalyticsBar, which is what a zone has to clear to count
 * as "at the top". The bar wraps at narrow widths and grows when the custom
 * date inputs open, so it is measured rather than guessed: the scroll target
 * (scrollMarginBlockStart) and the spy's top boundary have to agree, or a click
 * parks a section just under a boundary it never crosses and the previous chip
 * stays lit.
 */
const BAR_FALLBACK = 104;

/** Breathing room between the bar's bottom border and the zone heading. */
const LANDING_GAP = 12;

function barOffset(): number {
  const bar = document.getElementById('analytics-bar');
  return bar ? bar.getBoundingClientRect().height : BAR_FALLBACK;
}

function useBarOffset(): number {
  const [offset, setOffset] = useState(BAR_FALLBACK);
  useEffect(() => {
    const bar = document.getElementById('analytics-bar');
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setOffset(bar.getBoundingClientRect().height));
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  return offset;
}

/**
 * Zone a click asked for. The smooth scroll that follows takes ~500ms and the
 * short trailing zones can never reach the top line at all (the scroller
 * bottoms out first), so position alone would leave the previous chip lit.
 * The click wins until the next scroll gesture, which hands control back.
 */
let clicked: { id: string } | null = null;
const spies = new Set<(id: string) => void>();

/**
 * Id of the active zone: whichever one you last clicked, else the zone you have
 * scrolled to.
 *
 * Picking the first *intersecting* section does not work: a tall zone's tail
 * still overlaps the boundary band while the next zone's heading sits at the
 * top, so the previous chip stays lit. Position is instead read as the LAST
 * zone whose top has crossed the line under the bar, with the bottom of the
 * scroller selecting the final zone outright.
 */
export function useZoneSpy(ids: readonly string[]): string {
  const [active, setActive] = useState(ids[0] ?? '');
  const key = ids.join(',');
  const offset = useBarOffset();
  useEffect(() => {
    const order = key.split(',');
    const scroller = document.getElementById('tp-main');
    if (!scroller) return;
    const line = offset + LANDING_GAP + 2;

    const fromPosition = () => {
      // Scrolled to the end: the last zone is as reached as it will ever be.
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
        return order[order.length - 1] ?? '';
      }
      let current = order[0] ?? '';
      for (const id of order) {
        const node = document.getElementById(`zone-${id}`);
        if (!node) continue;
        if (node.getBoundingClientRect().top <= line) current = id;
        else break;
      }
      return current;
    };

    const read = () => setActive(clicked ? clicked.id : fromPosition());
    // A real scroll gesture means the person is browsing again, not jumping.
    const release = () => {
      clicked = null;
      read();
    };

    read();
    spies.add(setActive);
    scroller.addEventListener('scroll', read, { passive: true });
    scroller.addEventListener('wheel', release, { passive: true });
    scroller.addEventListener('touchmove', release, { passive: true });
    window.addEventListener('keydown', release);
    window.addEventListener('resize', read);
    return () => {
      spies.delete(setActive);
      scroller.removeEventListener('scroll', read);
      scroller.removeEventListener('wheel', release);
      scroller.removeEventListener('touchmove', release);
      window.removeEventListener('keydown', release);
      window.removeEventListener('resize', read);
    };
  }, [key, offset]);
  return active;
}

/** Scrolls a zone so its heading sits just below the sticky bar, and lights its chip at once. */
export function scrollToZone(id: string) {
  const node = document.getElementById(`zone-${id}`);
  if (!node) return;
  clicked = { id };
  for (const set of spies) set(id);
  node.style.scrollMarginBlockStart = `${barOffset() + LANDING_GAP}px`;
  node.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * One section of a tab: its heading, then — before any chart — the section's
 * ANSWER as a plain sentence (`lead`), e.g. "Busiest: Thursday 19:00, 82% full
 * over 4 open days". The sentence is computed from the same numbers the charts
 * plot (courts/takeaways.ts, cafe/takeaways.ts) and carries its sample, so the
 * owner can stop reading at it. What the section MEASURES stays behind the
 * info button: a description of the screen is not news.
 *
 * The heading used to carry an ordinal ("05 Courts"). Nothing referred to the
 * numbers, and the jump pills printed them again; they are gone.
 */
/**
 * The section's answer is the line most owners stop at, so it reads one step
 * up from body text and a weight heavier (2026-10-19); it used to sit at the
 * same size as every note on the page.
 */
const leadStyle: CSSProperties = { margin: 0, fontSize: 'var(--tp-fs-lg)', fontWeight: 500, lineHeight: 1.45, maxInlineSize: '80ch', color: 'var(--tp-fg)' };

/** Set by a Zone whose heading is drawn by the frame inside it (ZoneFrame). */
const ZoneHead = createContext<{ id: string; title: string; desc: string } | null>(null);

/**
 * A section's Breakdown frame that carries the section's own heading and its
 * "i" in its band, so the section draws no heading row above it (Sait,
 * 2026-10-19). Used inside <Zone headInFrame>.
 */
export function ZoneFrame({ lead, children }: { lead?: ReactNode; children: ReactNode }) {
  const { tr } = useLocale();
  const head = useContext(ZoneHead);
  if (!head) throw new Error('ZoneFrame needs a <Zone headInFrame> around it');
  return (
    <BreakdownFrame title={head.title} titleId={head.id} tip={head.desc} tipLabel={tr('ws.analytics.tips.about', { title: head.title })} lead={lead}>
      {children}
    </BreakdownFrame>
  );
}

export function Zone({
  zone,
  lead,
  actions,
  headInFrame,
  children,
}: {
  zone: ZoneDef;
  /** The heading and its "i" are drawn by the ZoneFrame inside, in its band. */
  headInFrame?: boolean;
  /** The section's answer in one or two sentences. Omitted while loading or when there is nothing to say. */
  lead?: ReactNode;
  /** Controls at the end of the heading row. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { tr } = useLocale();
  const title = tr(zone.titleKey);
  // scrollMarginBlockStart is replaced with the measured bar height by scrollToZone.
  if (headInFrame) {
    return (
      <section id={`zone-${zone.id}`} aria-labelledby={`zone-${zone.id}-title`} style={{ marginBlockEnd: 'var(--tp-sp-6)', scrollMarginBlockStart: '12.5rem' }}>
        {lead && (
          <p data-testid={`zone-${zone.id}-lead`} style={{ ...leadStyle, marginBlockEnd: 'var(--tp-sp-3)' }}>
            {lead}
          </p>
        )}
        <ZoneHead.Provider value={{ id: `zone-${zone.id}-title`, title, desc: tr(zone.descKey) }}>{children}</ZoneHead.Provider>
      </section>
    );
  }
  // Every section in the Summary's frame (Sait, 2026-10-19): a Touch Blue
  // band with the title and its "i" right after it, the section's controls
  // at the band's end, then its answer and its cards on the frame's ground.
  // The cards inside keep their own design.
  return (
    <section id={`zone-${zone.id}`} aria-labelledby={`zone-${zone.id}-title`} style={{ marginBlockEnd: 'var(--tp-sp-6)', scrollMarginBlockStart: '12.5rem' }}>
      <Panel
        title={<span id={`zone-${zone.id}-title`}>{title}</span>}
        titleEnd={<InfoTip content={tr(zone.descKey)} label={tr('ws.analytics.tips.about', { title })} style={{ marginBlock: '-0.4rem' }} />}
        actions={actions}
        band="group"
        padded={false}
        style={{ background: 'var(--tp-breakdown-frame)' }}
      >
        <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', padding: 'var(--tp-sp-4)' }}>
          {lead && (
            <p data-testid={`zone-${zone.id}-lead`} style={leadStyle}>
              {lead}
            </p>
          )}
          {/* Every card in a section wears the Breakdown look (Sait, 2026-10-19). */}
          <div>
            <BreakdownLook.Provider value="card">{children}</BreakdownLook.Provider>
          </div>
        </div>
      </Panel>
    </section>
  );
}

/**
 * `columns` columns at most, each at least `min` wide: at 1440px a section
 * sits three across, at 1100px (about 890px of page beside the rail) a
 * three-card row folds to two instead of squeezing charts to unreadable
 * widths. The page used to force 1024px of width and scroll sideways there.
 */
export function gridColumns(columns: number, min = columns >= 3 ? '17rem' : '20rem'): string {
  return `repeat(auto-fit, minmax(max(min(100%, ${min}), calc((100% - ${columns - 1} * var(--tp-sp-3)) / ${columns})), 1fr))`;
}

/**
 * A zone's cards in one sideways row, like the overview's Breakdown (Sait,
 * 2026-10-19): `columns` across, the rest a scroll away behind back/forward
 * arrows. Never narrower than `min`, so a narrow window shows fewer cards.
 * Every card in it wears the Breakdown look, coloured by its place, and the
 * row's two shared tracks (band, body) make every band one height.
 *
 * Pass `row` to put the arrows somewhere else (the zone's band, as "What
 * stands out" does); without it the row shows its own above the cards, and
 * only while some card is out of view.
 */
export function ZoneRow({
  row: given,
  columns = 3,
  min = '20rem',
  children,
}: {
  row?: ReturnType<typeof useCardRow>;
  columns?: number;
  min?: string;
  children: ReactNode;
}) {
  const own = useCardRow();
  const row = given ?? own;
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', minInlineSize: 0 }}>
      {!given && row.pager && <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{row.pager}</div>}
      <div
        ref={row.ref}
        onScroll={row.measure}
        className="tp-zone-row"
        data-testid="zone-card-row"
        style={{
          display: 'grid',
          gridAutoFlow: 'column',
          gridAutoColumns: `minmax(max(min(100%, ${min}), calc((100% - ${columns - 1} * var(--tp-sp-3)) / ${columns})), 1fr)`,
          gridTemplateRows: 'auto 1fr',
          alignItems: 'stretch',
          columnGap: 'var(--tp-sp-3)',
          overflowX: 'auto',
          // The arrows do the telling; no scrollbar band under the cards.
          scrollbarWidth: 'none',
          scrollSnapType: 'x mandatory',
        }}
      >
        <BreakdownLook.Provider value="row">{children}</BreakdownLook.Provider>
      </div>
    </div>
  );
}

/** A section body's cards: the sideways row, two across unless told otherwise. */
export function ZoneGrid({ columns = 2, min, children }: { columns?: number; min?: string; children: ReactNode }) {
  return (
    <ZoneRow columns={columns} min={min ?? (columns >= 3 ? '17rem' : '20rem')}>
      {children}
    </ZoneRow>
  );
}

/**
 * The rest of a section's charts, one click away. A section used to lay out
 * every breakdown it had (Losses alone was nine charts), all at the same
 * weight, so the one that answers the question sat among eight that refine
 * it. The first charts stay open; the refinements fold here, counted, and
 * nothing is removed. Open or closed is remembered per section for the visit.
 */
export function MoreCharts({ id, count, children }: { id: string; count: number; children: ReactNode }) {
  const { tr } = useLocale();
  const [open, setOpen] = useState(() => openSections.has(id));
  const bodyId = `more-${id}`;
  if (count === 0) return null;
  const toggle = () => {
    setOpen((v) => {
      if (v) openSections.delete(id);
      else openSections.add(id);
      return !v;
    });
  };
  return (
    <div style={{ marginBlockStart: 'var(--tp-sp-3)' }}>
      <button
        type="button"
        className="tp-btn"
        data-kind="ghost"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}
      >
        <Icon name="chevronDown" size={14} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
        {open ? tr('ws.analytics.more.hide') : tr('ws.analytics.more.show', { n: count })}
      </button>
      <div id={bodyId} hidden={!open} style={{ marginBlockStart: 'var(--tp-sp-2)', display: open ? 'grid' : undefined, gap: 'var(--tp-sp-3)' }}>
        {open && children}
      </div>
    </div>
  );
}

/** Which sections the owner opened, kept across tab switches for the visit. */
const openSections = new Set<string>();
