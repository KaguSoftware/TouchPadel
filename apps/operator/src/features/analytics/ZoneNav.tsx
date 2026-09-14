/**
 * Jump nav for a tab's zones. Lives on the inline-end side of the sticky bar
 * (desktop only) and highlights whichever zone the scroll-spy reports.
 */
import { useMemo } from 'react';
import { useLocale } from '../../lib/i18n';
import { useZoneSpy, type ZoneDef } from './Zone';

export function ZoneNav({ zones }: { zones: readonly ZoneDef[] }) {
  const { tr } = useLocale();
  const ids = useMemo(() => zones.map((z) => z.id), [zones]);
  const active = useZoneSpy(ids);
  return (
    <nav aria-label={tr('analytics.deck.jumpTo')} style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
      {zones.map((zone) => {
        const selected = zone.id === active;
        return (
          <button
            key={zone.id}
            type="button"
            aria-current={selected ? 'true' : undefined}
            onClick={() => document.getElementById(`zone-${zone.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            style={{
              // The deck stands every control on --tp-row-h; these pills came
              // to ~30px and floated inside that band.
              minBlockSize: 'var(--tp-row-h)',
              paddingBlock: 'var(--tp-sp-1-5)',
              paddingInline: 'var(--tp-sp-3)',
              borderRadius: 'var(--tp-radius-pill)',
              border: `1px solid ${selected ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
              background: selected ? 'var(--tp-accent)' : 'transparent',
              color: selected ? 'var(--tp-accent-contrast)' : 'var(--tp-muted-fg)',
              fontSize: 'var(--tp-fs-sm)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <span aria-hidden="true" style={{ opacity: 0.7, marginInlineEnd: 'var(--tp-sp-1-5)' }}>
              {zone.ordinal}
            </span>
            {tr(zone.navKey ?? zone.titleKey)}
          </button>
        );
      })}
    </nav>
  );
}
