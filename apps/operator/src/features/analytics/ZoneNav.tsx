/**
 * Jump nav for a tab's zones. Lives on the inline-end side of the sticky bar
 * (desktop only) and highlights whichever zone the scroll-spy reports.
 */
import { useMemo } from 'react';
import { useLocale } from '../../lib/i18n';
import { scrollToZone, useZoneSpy, type ZoneDef } from './Zone';

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
            onClick={() => scrollToZone(zone.id)}
            style={{
              // The deck stands every control on --tp-row-h; these pills came
              // to ~30px and floated inside that band.
              minBlockSize: 'var(--tp-row-h)',
              paddingBlock: 'var(--tp-sp-1-5)',
              paddingInline: 'var(--tp-sp-3)',
              borderRadius: 'var(--tp-radius-pill)',
              border: `1px solid ${selected ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
              // Unselected chips take the same --tp-surface fill as the
              // unselected Courts | Cafe tab beside them: transparent let the
              // bar's own ground show through, so the two rows of controls on
              // one bar read as two different materials.
              background: selected ? 'var(--tp-accent)' : 'var(--tp-surface)',
              color: selected ? 'var(--tp-accent-contrast)' : 'var(--tp-muted-fg)',
              fontSize: 'var(--tp-fs-sm)',
              // The lit chip carries the weight too, so the active section is
              // legible without relying on the accent fill alone.
              fontWeight: selected ? 700 : 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {tr(zone.navKey ?? zone.titleKey)}
          </button>
        );
      })}
    </nav>
  );
}
