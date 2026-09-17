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
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { MessageKey } from '@touch/i18n';
import { InfoTip } from '../../components/InfoTip';
import { Icon } from '../../components/icons';
import { useLocale } from '../../lib/i18n';

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

/** Id of the zone currently nearest the top of the viewport. */
export function useZoneSpy(ids: readonly string[]): string {
  const [active, setActive] = useState(ids[0] ?? '');
  const key = ids.join(',');
  useEffect(() => {
    const nodes = key
      .split(',')
      .map((id) => document.getElementById(`zone-${id}`))
      .filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0 || typeof IntersectionObserver === 'undefined') return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace('zone-', '');
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        const order = key.split(',');
        const first = order.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      // The sticky bar (tabs, jump pills, filters) is about 12rem tall: a section under it is not in view yet.
      { rootMargin: '-210px 0px -50% 0px', threshold: 0 },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [key]);
  return active;
}

const headRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--tp-sp-1)',
  borderBlockEnd: '1px solid var(--tp-border)',
  paddingBlockEnd: 'var(--tp-sp-1-5)',
};

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
export function Zone({
  zone,
  lead,
  actions,
  children,
}: {
  zone: ZoneDef;
  /** The section's answer in one or two sentences. Omitted while loading or when there is nothing to say. */
  lead?: ReactNode;
  /** Controls at the end of the heading row. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { tr } = useLocale();
  const title = tr(zone.titleKey);
  return (
    <section id={`zone-${zone.id}`} aria-labelledby={`zone-${zone.id}-title`} style={{ marginBlockEnd: 'var(--tp-sp-6)', scrollMarginBlockStart: '12.5rem' }}>
      <div style={headRow}>
        <h2 id={`zone-${zone.id}-title`} style={{ margin: 0, fontSize: 'var(--tp-fs-xl)' }}>
          {title}
        </h2>
        <InfoTip content={tr(zone.descKey)} label={tr('ws.analytics.tips.about', { title })} />
        {actions && <span style={{ marginInlineStart: 'auto' }}>{actions}</span>}
      </div>
      {lead ? (
        <p data-testid={`zone-${zone.id}-lead`} style={{ margin: 0, marginBlock: 'var(--tp-sp-2) var(--tp-sp-3)', fontSize: 'var(--tp-fs-md)', maxInlineSize: '90ch' }}>
          {lead}
        </p>
      ) : (
        <div style={{ blockSize: 'var(--tp-sp-3)' }} />
      )}
      {children}
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

/** The grid every section body uses. */
export function ZoneGrid({ columns = 2, min, children }: { columns?: number; min?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: gridColumns(columns, min), gap: 'var(--tp-sp-3)', alignItems: 'start' }}>
      {children}
    </div>
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
