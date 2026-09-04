/**
 * The five numbered zones of the dashboard (operator-slice.md §5.3) plus the
 * scroll-spy that drives `ZoneNav`. One IntersectionObserver for all sections;
 * the topmost intersecting section wins, so a tall zone stays selected while it
 * fills the viewport.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { MessageKey } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';

export interface ZoneDef {
  id: string;
  /** "01".."05" — a stable ordinal, not a translated string. */
  ordinal: string;
  titleKey: MessageKey;
  descKey: MessageKey;
}

export const ZONES: readonly ZoneDef[] = [
  { id: 'pulse', ordinal: '01', titleKey: 'analytics.zones.pulse', descKey: 'analytics.zones.pulseDesc' },
  { id: 'ai', ordinal: '02', titleKey: 'analytics.zones.ai', descKey: 'analytics.zones.aiDesc' },
  { id: 'menu', ordinal: '03', titleKey: 'analytics.zones.menu', descKey: 'analytics.zones.menuDesc' },
  { id: 'sales', ordinal: '04', titleKey: 'analytics.zones.sales', descKey: 'analytics.zones.salesDesc' },
  { id: 'time', ordinal: '05', titleKey: 'analytics.zones.time', descKey: 'analytics.zones.timeDesc' },
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
      { rootMargin: '-72px 0px -55% 0px', threshold: 0 },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [key]);
  return active;
}

const headRow: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 'var(--tp-sp-2-5)',
  marginBlockEnd: 'var(--tp-sp-3)',
  borderBlockEnd: '1px solid var(--tp-border)',
  paddingBlockEnd: 'var(--tp-sp-1-5)',
};

export function Zone({ zone, children }: { zone: ZoneDef; children: ReactNode }) {
  const { tr } = useLocale();
  return (
    <section id={`zone-${zone.id}`} aria-labelledby={`zone-${zone.id}-title`} style={{ marginBlockEnd: 'var(--tp-sp-6)', scrollMarginBlockStart: '5rem' }}>
      <div style={headRow}>
        {/* --tp-muted is a SURFACE step (86% lightness); as ink on the page
            ground the ordinal was all but invisible. */}
        <span aria-hidden="true" style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700, color: 'var(--tp-muted-fg)' }}>
          {zone.ordinal}
        </span>
        <h2 id={`zone-${zone.id}-title`} style={{ margin: 0, fontSize: 'var(--tp-fs-xl)' }}>
          {tr(zone.titleKey)}
        </h2>
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr(zone.descKey)}</span>
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
