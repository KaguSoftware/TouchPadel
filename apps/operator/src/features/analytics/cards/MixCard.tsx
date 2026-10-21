/**
 * "Where the money came from": the whole venue's revenue for the period as
 * one ring in two parts, padel (court bookings and the Touch Shop, one income
 * since Majed 2026-10-21) and the cafe, in a Breakdown card beside the
 * summary's figure cards. Both tabs show it with the same two colours (padel
 * blue, cafe rust, as the cross-section's stacked bars already use them), so a
 * part keeps its colour across the page.
 *
 * It sits in the frame's card row but holds a picture rather than rows: its
 * band takes the row's first shared track (so every band is one height) and
 * the ring spans the other four. The figures are the venue revenue hook's
 * (useVenueRevenue), whatever the court filter says, as the "Venue revenue"
 * row beside it is.
 */
import type { BreakdownTone } from '../../../components/BreakdownCards';
import { InfoTip } from '../../../components/InfoTip';
import { Skeleton } from '../../../components/ui';
import { useLocale } from '../../../lib/i18n';
import { Donut } from '../charts/Donut';
import { useChartColors } from '../charts/colors';
import type { Formatters } from '../format';
import type { VenueRevenue } from '../useVenueRevenue';

export function MixCard({ venue, tone, f, alone }: { venue: VenueRevenue; tone: BreakdownTone; f: Formatters; alone?: boolean }) {
  const { tr } = useLocale();
  const { RING_1, RING_2 } = useChartColors();
  const v = venue.current;
  const title = tr('ws.analytics.viz.mix.title');
  const slices = v
    ? [
        { key: 'padel', label: tr('ws.analytics.viz.mix.padel'), value: v.padelIqd, color: RING_1 },
        { key: 'cafe', label: tr('ws.analytics.viz.mix.cafe'), value: v.cafeIqd, color: RING_2 },
      ]
    : [];
  return (
    <section
      className="tp-breakdown-card"
      data-tone={tone}
      data-testid="analytics-mix"
      style={{
        ...(alone ? { display: 'flex', flexDirection: 'column' } : { display: 'grid', gridRow: 'span 5', gridTemplateRows: 'subgrid', rowGap: 0 }),
        borderRadius: 'var(--tp-radius-panel)',
        overflow: 'hidden',
        minInlineSize: 0,
      }}
    >
      <div className="tp-breakdown-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', paddingBlock: 'var(--tp-sp-3)', paddingInline: 'var(--tp-sp-4)' }}>
        <h3 style={{ fontSize: 'var(--tp-fs-md)', fontWeight: 700, minInlineSize: 0, margin: 0 }}>{title}</h3>
        <InfoTip content={tr('ws.analytics.viz.mix.tip')} label={tr('ws.analytics.tips.about', { title })} style={{ marginInlineEnd: 'calc((14px - 1.85rem) / 2)', flexShrink: 0 }} />
      </div>
      <div style={{ ...(alone ? { flex: '1 1 auto' } : { gridRow: '2 / span 4' }), display: 'flex', alignItems: 'center', padding: 'var(--tp-sp-4)' }}>
        {venue.state === 'loading' ? (
          <div style={{ inlineSize: '100%' }}>
            <Skeleton lines={4} />
          </div>
        ) : venue.state === 'error' || !v ? (
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('errors.generic')}</p>
        ) : v.venueIqd <= 0 ? (
          <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.analytics.viz.mixNone')}</p>
        ) : (
          <div style={{ inlineSize: '100%' }}>
            <Donut slices={slices} format={(n) => f.compact(n)} pct={(n) => f.pct(n)} total={f.compact(v.venueIqd)} caption={tr('ws.analytics.viz.mix.caption')} label={title} layout="stack" size={148} />
          </div>
        )}
      </div>
    </section>
  );
}
