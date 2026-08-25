/**
 * Jump nav for the five zones. Lives on the inline-end side of the control deck
 * (desktop only) and highlights whichever zone the scroll-spy reports.
 */
import { useLocale } from '../../lib/i18n';
import { ZONES, useZoneSpy } from './Zone';

const IDS = ZONES.map((z) => z.id);

export function ZoneNav() {
  const { tr } = useLocale();
  const active = useZoneSpy(IDS);
  return (
    <nav aria-label={tr('analytics.deck.jumpTo')} style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
      {ZONES.map((zone) => {
        const selected = zone.id === active;
        return (
          <button
            key={zone.id}
            type="button"
            aria-current={selected ? 'true' : undefined}
            onClick={() => document.getElementById(`zone-${zone.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            style={{
              paddingBlock: '0.3rem',
              paddingInline: '0.6rem',
              borderRadius: '999px',
              border: `1px solid ${selected ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
              background: selected ? 'var(--tp-accent)' : 'transparent',
              color: selected ? 'var(--tp-accent-contrast)' : 'var(--tp-muted-fg)',
              fontSize: '0.8rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <span aria-hidden="true" style={{ opacity: 0.7, marginInlineEnd: '0.3rem' }}>
              {zone.ordinal}
            </span>
            {tr(zone.titleKey)}
          </button>
        );
      })}
    </nav>
  );
}
