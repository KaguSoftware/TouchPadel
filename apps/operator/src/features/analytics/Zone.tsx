/**
 * The numbered zones of a dashboard tab (operator-slice.md §5.3) plus the
 * scroll-spy that drives `ZoneNav`. One IntersectionObserver for all sections;
 * the topmost intersecting section wins, so a tall zone stays selected while it
 * fills the viewport. Each tab declares its own zone list (CAFE_ZONES here,
 * COURT_ZONES beside the courts tab) and hands it to Zone / ZoneNav.
 *
 * The zone's one-line description used to print beside the heading; it is an
 * explanation, not state, so it now sits behind the info button (read on
 * hover, focus or tap) and the heading row stays one line of type.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { MessageKey } from '@touch/i18n';
import { InfoTip } from '../../components/InfoTip';
import { useLocale } from '../../lib/i18n';

export interface ZoneDef {
  id: string;
  /** "01".."08" — a stable ordinal, not a translated string. */
  ordinal: string;
  titleKey: MessageKey;
  /** The explanation behind the heading's info button. */
  descKey: MessageKey;
  /** Shorter label for the jump pill; falls back to the title. */
  navKey?: MessageKey;
}

export const CAFE_ZONES: readonly ZoneDef[] = [
  { id: 'pulse', ordinal: '01', titleKey: 'analytics.zones.pulse', descKey: 'analytics.zones.pulseDesc' },
  { id: 'ai', ordinal: '02', titleKey: 'analytics.zones.ai', descKey: 'analytics.zones.aiDesc' },
  { id: 'menu', ordinal: '03', titleKey: 'analytics.zones.menu', descKey: 'analytics.zones.menuDesc' },
  { id: 'sales', ordinal: '04', titleKey: 'analytics.zones.sales', descKey: 'analytics.zones.salesDesc' },
  { id: 'time', ordinal: '05', titleKey: 'analytics.zones.time', descKey: 'analytics.zones.timeDesc' },
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

const headRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--tp-sp-2-5)',
  marginBlockEnd: 'var(--tp-sp-3)',
  borderBlockEnd: '1px solid var(--tp-border)',
  paddingBlockEnd: 'var(--tp-sp-1-5)',
};

export function Zone({ zone, actions, children }: { zone: ZoneDef; /** Controls at the end of the heading row (the Pulse CSV). */ actions?: ReactNode; children: ReactNode }) {
  const { tr } = useLocale();
  const title = tr(zone.titleKey);
  // scrollMarginBlockStart is replaced with the measured bar height by scrollToZone.
  return (
    <section id={`zone-${zone.id}`} aria-labelledby={`zone-${zone.id}-title`} style={{ marginBlockEnd: 'var(--tp-sp-6)', scrollMarginBlockStart: `${BAR_FALLBACK}px` }}>
      <div style={headRow}>
        {/* --tp-muted is a SURFACE step (86% lightness); as ink on the page
            ground the ordinal was all but invisible. */}
        <span aria-hidden="true" style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700, color: 'var(--tp-muted-fg)' }}>
          {zone.ordinal}
        </span>
        <h2 id={`zone-${zone.id}-title`} style={{ margin: 0, fontSize: 'var(--tp-fs-xl)' }}>
          {title}
        </h2>
        <InfoTip content={tr(zone.descKey)} label={tr('ws.analytics.tips.about', { title })} />
        {actions && <span style={{ marginInlineStart: 'auto' }}>{actions}</span>}
      </div>
      {children}
    </section>
  );
}

/** Responsive-free desktop grid used by every zone body (page is min 1024px wide). */
export function ZoneGrid({ columns = 2, children }: { columns?: number; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 'var(--tp-sp-3)', alignItems: 'start' }}>
      {children}
    </div>
  );
}
